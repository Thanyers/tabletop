import { env } from 'cloudflare:workers';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandAck, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { randomId, randomToken, sha256 } from '../server/codec.js';
import { SESSION_HARD_MS } from './contracts.js';
import type { Env } from './contracts.js';
import { cookieName, csrfForToken } from './auth.js';
import worker from './index.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import { spaceProjectionUrl } from '../src/tabletop/shared/space-projection-url.js';

/**
 * F080 / C6 — the cross-workspace projection read, end to end, through the real Worker entry.
 *
 * Two independent workspaces, two sessions, real Durable Objects and the real internal route. The
 * thing this file exists to prove is the authorization identity: a grant names the *workspace* the
 * source authorized, so a workspace that reuses another space's slug cannot read through it.
 */

const bindings = env as Env;

interface Actor { id: string; headers: Record<string, string> }

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

async function readProjection(actor: Actor, spaceId: string, query: { source: string; grant: string; port: string }) {
  // Built by the same helper the browser fetcher uses: this test and the client cannot drift apart.
  const response = await worker.fetch(request(spaceProjectionUrl(spaceId, query), actor), bindings);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

interface Fixture {
  owner: Actor;
  sourceOwner: Actor;
  space: string;
  source: string;
  slug: string;
}

/** One space workspace (owner A) and one source workspace (owner B), with a grant linking them. */
async function fixture(): Promise<Fixture> {
  const owner = await seedActor('Space owner');
  const sourceOwner = await seedActor('Source owner');
  const space = await createWorkspace(owner, 'Activity room');
  const source = await createWorkspace(sourceOwner, 'Budget');
  const slug = 'activity-room';

  await command(sourceOwner, source, 'source.grantProjection', {
    grantId: 'grant-budget',
    spaceId: slug,
    spaceWorkspaceId: space.id,
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 25 }],
    actions: [],
  });
  const created = await command(owner, space, 'space.create', {
    spaceId: slug,
    title: 'ห้องวางผังกิจกรรม',
    sharedToolWorkspaceId: space.id,
  });
  await command(owner, created.workspace, 'space.addSource', {
    source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
  });
  return { owner, sourceOwner, space: space.id, source: source.id, slug };
}

/** A table with an active program and rows, built the way a person would: import a source, then activate a change. */
async function createEquipmentTable(owner: Actor): Promise<WorkspaceView> {
  const created = await createWorkspace(owner, 'Equipment');
  const imported = await command(owner, created, 'table.import', {
    filename: tableScenarioSources.equipment.filename,
    text: tableScenarioSources.equipment.text,
  });
  let current = imported.workspace;
  const sourceId = (current.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
  if (!sourceId) throw new Error('EQUIPMENT_SOURCE_MISSING');
  const change = equipmentChange(sourceId);
  const steps = [
    ['evolve.propose', { change }],
    ['evolve.simulate', {}],
    ['evolve.validate', {}],
    ['evolve.approve', {}],
    ['evolve.activate', {}],
  ] as const;
  for (const [type, payload] of steps) {
    const result = await command(owner, current, type, payload);
    current = result.workspace;
  }
  return current;
}

describe('two workspaces, one granted projection', () => {
  it('serves the descriptor and rows at the live revision', async () => {
    const setup = await fixture();
    const result = await readProjection(setup.owner, setup.space, { source: setup.source, grant: 'grant-budget', port: 'budget' });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ ok: true, grantId: 'grant-budget', portId: 'budget' });
    const projection = result.body.projection as { fields: string[] };
    expect(projection.fields).toEqual(['room', 'price']);
    // The data half: rows are attached by the source at its own revision (empty before any data).
    expect(result.body.rows).toEqual([]);
    const sourceView = await viewOf(setup.sourceOwner, setup.source);
    const domain = sourceView.domain as { dataRevision: number };
    expect(result.body.sourceDataRevision).toBe(domain.dataRevision);
  });

  it('refuses a workspace that reuses the slug but was never granted', async () => {
    const setup = await fixture();
    const copycat = await createWorkspace(setup.owner, 'Copycat');
    const created = await command(setup.owner, copycat, 'space.create', {
      spaceId: setup.slug,
      title: 'ห้องปลอม',
      sharedToolWorkspaceId: copycat.id,
    });
    await command(setup.owner, created.workspace, 'space.addSource', {
      source: { workspaceId: setup.source, epoch: 1, addedBy: setup.owner.id, addedAt: Date.now(), status: 'linked' },
    });
    const stolen = await readProjection(setup.owner, copycat.id, { source: setup.source, grant: 'grant-budget', port: 'budget' });
    expect(stolen.status).toBe(404);
    expect(stolen.body).toMatchObject({ ok: false, errorCode: 'SPACE_GRANT_NOT_FOUND' });

    const real = await readProjection(setup.owner, setup.space, { source: setup.source, grant: 'grant-budget', port: 'budget' });
    expect(real.status).toBe(200);
  });

  it('refuses after a revoke on the very next read', async () => {
    const setup = await fixture();
    const source = await viewOf(setup.sourceOwner, setup.source);
    await command(setup.sourceOwner, source, 'source.revokeProjection', { grantId: 'grant-budget' });
    const result = await readProjection(setup.owner, setup.space, { source: setup.source, grant: 'grant-budget', port: 'budget' });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, errorCode: 'SPACE_GRANT_REVOKED' });
  });

  it('refuses a port the grant does not expose, and an unknown grant', async () => {
    const setup = await fixture();
    const wrongPort = await readProjection(setup.owner, setup.space, { source: setup.source, grant: 'grant-budget', port: 'plan' });
    expect(wrongPort.status).toBe(404);
    expect(wrongPort.body).toMatchObject({ errorCode: 'SPACE_GRANT_PORT' });

    const unknown = await readProjection(setup.owner, setup.space, { source: setup.source, grant: 'grant-other', port: 'budget' });
    expect(unknown.status).toBe(404);
    expect(unknown.body).toMatchObject({ errorCode: 'SPACE_GRANT_NOT_FOUND' });
  });

  it('refuses a source the space never linked', async () => {
    const setup = await fixture();
    const other = await createWorkspace(setup.sourceOwner, 'Another table');
    const result = await readProjection(setup.owner, setup.space, { source: other.id, grant: 'grant-budget', port: 'budget' });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ errorCode: 'SPACE_SOURCE_NOT_LINKED' });
  });

  it('serves real rows from a source that has data, with only the granted fields', async () => {
    const owner = await seedActor('Rows owner');
    const sourceOwner = await seedActor('Rows source');
    const space = await createWorkspace(owner, 'Rows space');
    const source = await createEquipmentTable(sourceOwner);

    const granted = await command(sourceOwner, source, 'source.grantProjection', {
      grantId: 'grant-equipment',
      spaceId: 'rows-room',
      spaceWorkspaceId: space.id,
      audience: { kind: 'space-members' },
      // `available` is deliberately not granted.
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
      actions: [],
    });
    const created = await command(owner, space, 'space.create', {
      spaceId: 'rows-room',
      title: 'ห้องข้อมูลจริง',
      sharedToolWorkspaceId: space.id,
    });
    await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    const result = await readProjection(owner, space.id, { source: source.id, grant: 'grant-equipment', port: 'equipment' });
    expect(result.status).toBe(200);
    const rows = result.body.rows as { id: string; values: Record<string, unknown> }[];
    expect(rows.length).toBeGreaterThan(0);
    // Only the granted field travels; the schema the grant withheld stays behind.
    for (const row of rows) expect(Object.keys(row.values)).toEqual(['name']);
    const liveRevision = (source.domain as { dataRevision: number }).dataRevision;
    expect(result.body.sourceDataRevision).toBe(liveRevision);
    expect(granted.workspace.revision).toBeTruthy();
  });

  it('reports a moved source revision on the next read', async () => {
    const owner = await seedActor('Fresh owner');
    const sourceOwner = await seedActor('Fresh source');
    const space = await createWorkspace(owner, 'Fresh space');
    const source = await createEquipmentTable(sourceOwner);

    await command(sourceOwner, source, 'source.grantProjection', {
      grantId: 'grant-fresh',
      spaceId: 'fresh-room',
      spaceWorkspaceId: space.id,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
      actions: [],
    });
    const created = await command(owner, space, 'space.create', {
      spaceId: 'fresh-room', title: 'ห้องสด', sharedToolWorkspaceId: space.id,
    });
    const linked = await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    const before = await readProjection(owner, space.id, { source: source.id, grant: 'grant-fresh', port: 'equipment' });
    expect(before.status).toBe(200);
    const beforeRevision = Number(before.body.sourceDataRevision);

    // Change the source through its own command path; the space is not told anything.
    const current = await viewOf(sourceOwner, source.id);
    await command(sourceOwner, current, 'table.import', {
      filename: 'notes.txt',
      text: 'A second file on the source table.',
    });

    const after = await readProjection(owner, space.id, { source: source.id, grant: 'grant-fresh', port: 'equipment' });
    expect(after.status).toBe(200);
    expect(Number(after.body.sourceDataRevision)).toBeGreaterThan(beforeRevision);
    expect(linked.workspace.id).toBe(space.id);
  });

  it('refuses someone who is not in the space', async () => {
    const setup = await fixture();
    const outsider = await seedActor('Outsider');
    const result = await readProjection(outsider, setup.space, { source: setup.source, grant: 'grant-budget', port: 'budget' });
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ errorCode: 'SPACE_NOT_MEMBER' });
  });
});

/** An active equipment table granted to a space, with the `borrow` action allowed. */
async function actionFixture(): Promise<{ owner: Actor; sourceOwner: Actor; space: string; source: string }> {
  const owner = await seedActor('Action owner');
  const sourceOwner = await seedActor('Action source');
  const space = await createWorkspace(owner, 'Action space');
  const source = await createEquipmentTable(sourceOwner);
  await command(sourceOwner, source, 'source.grantProjection', {
    grantId: 'grant-actions',
    spaceId: 'action-room',
    spaceWorkspaceId: space.id,
    audience: { kind: 'space-members' },
    projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
    actions: [{ actionId: 'borrow' }],
  });
  const created = await command(owner, space, 'space.create', {
    spaceId: 'action-room', title: 'ห้องลงมือ', sharedToolWorkspaceId: space.id,
  });
  await command(owner, created.workspace, 'space.addSource', {
    source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
  });
  return { owner, sourceOwner, space: space.id, source: source.id };
}

async function callAction(actor: Actor, spaceId: string, body: {
  source: string; grant: string; actionId: string; inputs: Record<string, unknown>; idempotencyKey: string;
}) {
  const response = await worker.fetch(request(`/api/workspaces/${spaceId}/space/action`, actor, { method: 'POST', body }), bindings);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('an action through a connection, end to end', () => {
  it('commits on the source and replays the receipt on a retry', async () => {
    const setup = await actionFixture();
    const payload = { source: setup.source, grant: 'grant-actions', actionId: 'borrow', inputs: { item: 'camera' }, idempotencyKey: 'e2e-retry-1' };

    const first = await callAction(setup.owner, setup.space, payload);
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, committed: true, duplicate: false });

    // The source row really changed.
    const sourceView = await viewOf(setup.sourceOwner, setup.source);
    const equipment = (sourceView.domain as { records: Record<string, { id: string; values: { available?: unknown } }[]> }).records.equipment;
    expect(equipment?.find(row => row.id === 'camera')?.values.available).toBe(false);

    const retry = await callAction(setup.owner, setup.space, payload);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ ok: true, duplicate: true });
    expect(retry.body.revision).toBe(first.body.revision);
  });

  it('refuses after the grant is revoked', async () => {
    const setup = await actionFixture();
    const source = await viewOf(setup.sourceOwner, setup.source);
    await command(setup.sourceOwner, source, 'source.revokeProjection', { grantId: 'grant-actions' });
    const result = await callAction(setup.owner, setup.space, {
      source: setup.source, grant: 'grant-actions', actionId: 'borrow', inputs: { item: 'camera' }, idempotencyKey: 'e2e-revoked-1',
    });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ ok: false, errorCode: 'SPACE_ACTION_REVOKED' });
  });

  it('refuses an action the grant does not list, and someone outside the space', async () => {
    const setup = await actionFixture();
    const notGranted = await callAction(setup.owner, setup.space, {
      source: setup.source, grant: 'grant-actions', actionId: 'giveBack', inputs: { item: 'camera' }, idempotencyKey: 'e2e-ungranted-1',
    });
    expect(notGranted.status).toBe(404);
    expect(notGranted.body).toMatchObject({ errorCode: 'SPACE_ACTION_NOT_GRANTED' });

    const outsider = await seedActor('Action outsider');
    const refused = await callAction(outsider, setup.space, {
      source: setup.source, grant: 'grant-actions', actionId: 'borrow', inputs: { item: 'camera' }, idempotencyKey: 'e2e-outsider-1',
    });
    expect(refused.status).toBe(403);
    expect(refused.body).toMatchObject({ errorCode: 'SPACE_NOT_MEMBER' });
  });

  it('refuses a table the space never linked', async () => {
    const setup = await actionFixture();
    const other = await createWorkspace(setup.sourceOwner, 'Unlinked table');
    const result = await callAction(setup.owner, setup.space, {
      source: other.id, grant: 'grant-actions', actionId: 'borrow', inputs: { item: 'camera' }, idempotencyKey: 'e2e-unlinked-1',
    });
    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ errorCode: 'SPACE_SOURCE_NOT_LINKED' });
  });
});
