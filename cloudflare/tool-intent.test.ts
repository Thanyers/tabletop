import { env } from 'cloudflare:workers';
import { TOOL_INTENT_REJECTIONS } from '../src/tabletop/shared/tool-protocol.js';
import { runInDurableObject } from 'cloudflare:test';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandAck, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { ToolPackageDefinition } from '../src/tabletop/shared/tool-package.js';
import { toolPackageContentCanonical, TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION } from '../src/tabletop/shared/tool-package.js';
import { randomId, randomToken, sha256 } from '../server/codec.js';
import { SESSION_HARD_MS } from './contracts.js';
import type { Env } from './contracts.js';
import { cookieName, csrfForToken } from './auth.js';
import worker from './index.js';
import type { Room } from './room.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';

/**
 * F080 / D-038 — a room member runs one behaviour of the room's installed tool, end to end.
 *
 * Everything below the route is production code: the Worker answers membership, the room re-proves
 * the installed content hash, compiles the stored definition, runs the behaviour in an isolate,
 * validates its output, plans the declared action and commits it through the ordinary `table.act`
 * command. A refusal must arrive as a code and leave the table — and the command log — untouched.
 */

const bindings = env as Env;

interface Actor {
  id: string;
  headers: Record<string, string>;
}

async function seedActor(name: string): Promise<Actor> {
  const id = randomId();
  const token = randomToken();
  const now = Date.now();
  await bindings.DB.batch([
    bindings.DB.prepare('INSERT INTO users(id,provider_sub,email,name,created_at) VALUES(?,?,?,?,?)')
      .bind(id, `fixture:${id}`, `${id}@example.test`, name, now),
    bindings.DB.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?)')
      .bind(sha256(token), sha256(csrfForToken(token)), id, now, now, now + SESSION_HARD_MS, null),
  ]);
  return {
    id,
    headers: {
      Cookie: `${cookieName(bindings, 'session')}=${token}`,
      Origin: bindings.PUBLIC_ORIGIN,
      'X-CSRF-Token': csrfForToken(token),
      'Content-Type': 'application/json',
    },
  };
}

function request(path: string, actor: Actor, init: { method?: string; body?: unknown } = {}): Request {
  return new Request(`${bindings.PUBLIC_ORIGIN}${path}`, {
    method: init.method ?? 'GET',
    headers: actor.headers,
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

async function createWorkspace(actor: Actor, title: string): Promise<WorkspaceView> {
  const response = await worker.fetch(request('/api/workspaces', actor, { method: 'POST', body: { kind: 'table', title } }), bindings);
  expect(response.status).toBe(201);
  return await response.json() as WorkspaceView;
}

async function viewOf(actor: Actor, workspaceId: string): Promise<WorkspaceView> {
  const response = await worker.fetch(request(`/api/workspaces/${workspaceId}`, actor), bindings);
  expect(response.status).toBe(200);
  return await response.json() as WorkspaceView;
}

async function command(actor: Actor, workspace: WorkspaceView, type: string, payload: unknown): Promise<CommandAck> {
  const response = await worker.fetch(request(`/api/workspaces/${workspace.id}/commands`, actor, {
    method: 'POST',
    body: { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, type, payload },
  }), bindings);
  const body = await response.json() as CommandAck & { errorCode?: string };
  if (response.status !== 200) throw new Error(`${type} failed: ${response.status} ${body.errorCode ?? ''}`);
  return body;
}

interface IntentAnswer {
  status: number;
  body: { ok: boolean; actionId?: string; revision?: string; duplicate?: boolean; code?: string; message?: string };
}

async function intent(actor: Actor, workspaceId: string, body: unknown): Promise<IntentAnswer> {
  const response = await worker.fetch(request(`/api/workspaces/${workspaceId}/space/tool/intent`, actor, { method: 'POST', body }), bindings);
  return { status: response.status, body: await response.json() as IntentAnswer['body'] };
}

function roomStub(workspaceId: string): DurableObjectStub<Room> {
  return bindings.ROOMS.get(bindings.ROOMS.idFromName(workspaceId)) as DurableObjectStub<Room>;
}

async function inspectRoom<T>(stub: DurableObjectStub<Room>, query: string): Promise<T[]> {
  return runInDurableObject(stub, (instance) => instance.repository.storage.sql.exec<T & Record<string, SqlStorageValue>>(query).toArray());
}

/** The command log is the room's own proof that something committed; refusals must not add to it. */
async function committedCommands(stub: DurableObjectStub<Room>): Promise<number> {
  const rows = await inspectRoom<{ total: number }>(stub, 'SELECT COUNT(*) AS total FROM room_commands');
  return rows[0]?.total ?? 0;
}

const UI_SOURCE = 'export function Tool(){ return <p>equipment</p>; }\n';

/** A behaviour that proposes exactly one action; the host decides whether it may run it. */
function behaviorSource(actionId: string): string {
  return `export function reserve() { return { changes: [], proposal: { actionId: "${actionId}", inputs: { item: "camera" } } }; }\n`;
}

function packageDefinition(proposedAction: string): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'room-planner',
    version: 1,
    title: 'Room planner',
    description: 'reserve equipment from the joined data',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: UI_SOURCE },
      { path: 'behavior/run.ts', language: 'ts', text: behaviorSource(proposedAction) },
    ],
    ports: [],
    behaviors: [{
      id: 'reserve',
      label: 'Reserve',
      entry: 'reserve',
      inputs: [],
      writes: [{ target: 'self', resource: 'equipment', operations: ['update'], maxRows: 1 }],
      actions: ['borrow'],
    }],
    imports: { react: '19.3.0' },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'human', createdAt: 1_760_000_000_000 },
  };
}

/** The hash the room itself proves: sha256 over the canonical package text. */
function contentHashOf(definition: ToolPackageDefinition): string {
  return sha256(toolPackageContentCanonical(definition));
}

/** A table with an active program and rows, built the way a person would. */
async function equipmentTable(owner: Actor): Promise<WorkspaceView> {
  const created = await createWorkspace(owner, 'Equipment');
  const imported = await command(owner, created, 'table.import', {
    filename: tableScenarioSources.equipment.filename,
    text: tableScenarioSources.equipment.text,
  });
  let current = imported.workspace;
  const sourceId = (current.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
  if (!sourceId) throw new Error('EQUIPMENT_SOURCE_MISSING');
  const steps = [
    ['evolve.propose', { change: equipmentChange(sourceId) }],
    ['evolve.simulate', {}],
    ['evolve.validate', {}],
    ['evolve.approve', {}],
    ['evolve.activate', {}],
  ] as const;
  for (const [type, payload] of steps) current = (await command(owner, current, type, payload)).workspace;
  return current;
}

/** The same table with a collaboration space, but no tool installed. */
async function spaceRoom(owner: Actor): Promise<WorkspaceView> {
  const table = await equipmentTable(owner);
  const created = await command(owner, table, 'space.create', {
    spaceId: 'equipment-room',
    title: 'Equipment room',
    sharedToolWorkspaceId: table.id,
  });
  return created.workspace;
}

/** Install the package the way the product does: the definition travels with its proven hash. */
async function installTool(owner: Actor, workspace: WorkspaceView, definition: ToolPackageDefinition): Promise<WorkspaceView> {
  const installed = await command(owner, workspace, 'space.installTool', {
    tool: {
      packageId: definition.packageId,
      version: definition.version,
      contentHash: contentHashOf(definition),
      route: 'human',
      title: definition.title,
      definition,
    },
  });
  return installed.workspace;
}

async function roomWithTool(owner: Actor, definition: ToolPackageDefinition): Promise<WorkspaceView> {
  const room = await spaceRoom(owner);
  return installTool(owner, room, definition);
}

const availability = (view: WorkspaceView): unknown => (view.domain as unknown as {
  records?: Record<string, { id: string; values: { available?: unknown } }[]>;
}).records?.equipment?.find(row => row.id === 'camera')?.values.available;

const dataRevision = (view: WorkspaceView): unknown => (view.domain as { dataRevision?: unknown }).dataRevision;

describe('running a behaviour of the installed tool', () => {
  it('refuses a room with no installed tool, and changes nothing', async () => {
    const owner = await seedActor('No-tool owner');
    const room = await spaceRoom(owner);
    const stub = roomStub(room.id);
    const before = await committedCommands(stub);

    const answer = await intent(owner, room.id, { behaviorId: 'reserve', inputs: {} });
    expect(answer.body).toMatchObject({ ok: false, code: 'TOOL_NOT_INSTALLED' });
    expect(answer.status).toBe(404);

    // Nothing was planned, so nothing was committed: same revisions, same command log.
    const after = await viewOf(owner, room.id);
    expect(after.revision).toBe(room.revision);
    expect(dataRevision(after)).toBe(dataRevision(room));
    expect(await committedCommands(stub)).toBe(before);
  });

  it('refuses an installation whose definition no longer hashes to its reference', async () => {
    const owner = await seedActor('Hash owner');
    // A reference that does not support this definition cannot be written by the command API any
    // more (D-037), so the mismatch is staged the way an old or tampered record would look.
    const room = await roomWithTool(owner, packageDefinition('borrow'));
    const stub = roomStub(room.id);
    const before = await committedCommands(stub);
    await runInDurableObject(stub, (instance) => {
      instance.repository.storage.sql.exec(
        `UPDATE room_workspaces SET domain_state =
           json_set(domain_state, '$.collaborationSpace.tool.contentHash', ?) WHERE id = ?`,
        'b'.repeat(64), room.id,
      );
    });

    const answer = await intent(owner, room.id, { behaviorId: 'reserve', inputs: {} });
    expect(answer.body).toMatchObject({ ok: false, code: 'TOOL_HASH_MISMATCH' });
    expect(answer.status).toBe(409);

    const after = await viewOf(owner, room.id);
    expect(dataRevision(after)).toBe(dataRevision(room));
    expect(await committedCommands(stub)).toBe(before);
  });

  it('refuses a behaviour that proposes an action the package did not declare, with zero write', async () => {
    const owner = await seedActor('Undeclared owner');
    // `return` is a real action of this table; the package only declared `borrow`, so the plan refuses.
    const room = await roomWithTool(owner, packageDefinition('return'));
    const stub = roomStub(room.id);
    const before = await committedCommands(stub);

    const answer = await intent(owner, room.id, { behaviorId: 'reserve', inputs: {} });
    expect(answer.body).toMatchObject({ ok: false, code: 'ACTION_NOT_DECLARED' });
    expect(answer.status).toBe(422);

    const after = await viewOf(owner, room.id);
    expect(dataRevision(after)).toBe(dataRevision(room));
    expect(availability(after)).toBe(true);
    expect(await committedCommands(stub)).toBe(before);
  });

  it('commits a declared proposal through table.act, and the target row really changes', async () => {
    const owner = await seedActor('Commit owner');
    const room = await roomWithTool(owner, packageDefinition('borrow'));
    const stub = roomStub(room.id);
    const before = await committedCommands(stub);
    expect(availability(room)).toBe(true);

    const answer = await intent(owner, room.id, { behaviorId: 'reserve', inputs: {} });
    expect(answer.body, JSON.stringify(answer.body)).toMatchObject({ ok: true, actionId: 'borrow', duplicate: false });
    expect(answer.status).toBe(200);

    const after = await viewOf(owner, room.id);
    expect(availability(after)).toBe(false);
    expect(after.revision).not.toBe(room.revision);
    expect(await committedCommands(stub)).toBe(before + 1);
    // The commit is the ordinary action command, under the caller's own actor id.
    const events = await inspectRoom<{ actor_id: string; event_type: string }>(stub,
      'SELECT actor_id, event_type FROM room_events ORDER BY workspace_sequence DESC LIMIT 1');
    expect(events[0]).toMatchObject({ actor_id: owner.id, event_type: 'table.act' });
  });

  it('reports a refusal code rather than throwing, and executes no command, for each refusal', async () => {
    const owner = await seedActor('Refusal owner');

    const noTool = await spaceRoom(owner);
    const tampered = await roomWithTool(owner, packageDefinition('borrow'));
    const tampStub = roomStub(tampered.id);
    // The title is part of the canonical text, so editing it breaks the reference without touching
    // the recorded hash; the room must notice before any stored source reaches the isolate.
    await runInDurableObject(tampStub, (instance) => {
      instance.repository.storage.sql.exec(
        `UPDATE room_workspaces SET domain_state =
           json_set(domain_state, '$.collaborationSpace.tool.definition.title', ?) WHERE id = ?`,
        'Tampered planner', tampered.id,
      );
    });
    const undeclared = await roomWithTool(owner, packageDefinition('return'));

    const cases: { room: WorkspaceView; code: string }[] = [
      { room: noTool, code: 'TOOL_NOT_INSTALLED' },
      { room: tampered, code: 'TOOL_HASH_MISMATCH' },
      { room: undeclared, code: 'ACTION_NOT_DECLARED' },
    ];
    for (const testCase of cases) {
      const stub = roomStub(testCase.room.id);
      const before = await committedCommands(stub);
      const answer = await intent(owner, testCase.room.id, { behaviorId: 'reserve', inputs: {} });
      expect(answer.status).toBeGreaterThanOrEqual(400);
      expect(answer.status).toBeLessThan(500);
      expect(answer.body.ok).toBe(false);
      expect(answer.body.code).toBe(testCase.code);
      expect(typeof answer.body.message).toBe('string');
      expect(await committedCommands(stub)).toBe(before);
      const after = await viewOf(owner, testCase.room.id);
      expect(dataRevision(after)).toBe(dataRevision(testCase.room));
      expect(availability(after)).toBe(true);
    }
  });
});

/**
 * D-040 drift test: the route answers with codes, and a package branches on them, so every code the
 * route can return has to exist in the shared vocabulary. Keep this list next to the route.
 */
describe('the intent route speaks the shared refusal vocabulary', () => {
  const routeCodes = [
    'TOOL_INTENT_PAYLOAD',
    'TOOL_NOT_INSTALLED',
    'TOOL_NOT_AUTHORIZED',
    'TOOL_HASH_MISMATCH',
    'TOOL_COMPILE_FAILED',
    'TOOL_UNKNOWN_BEHAVIOR',
    'TOOL_BEHAVIOR_FAILED',
    'TOOL_BEHAVIOR_TIMEOUT',
    'TOOL_OUTPUT_INVALID',
    'TOOL_WRITE_OUT_OF_SCOPE',
    'ACTION_NOT_DECLARED',
    'ACTION_NOT_FOUND',
    'INPUT_NOT_DECLARED',
    'INPUT_MISSING',
    'INPUT_WRONG_TYPE',
    'NO_PROPOSAL',
  ];

  it('uses only codes declared in TOOL_INTENT_REJECTIONS', () => {
    const vocabulary = new Set<string>(TOOL_INTENT_REJECTIONS);
    const missing = routeCodes.filter(code => !vocabulary.has(code));
    expect(missing).toEqual([]);
  });
});
