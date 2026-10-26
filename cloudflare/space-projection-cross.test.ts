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
import { planToolBehaviorAction } from '../src/tabletop/shared/tool-action-proposal.js';

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

/** An equipment table whose connection may or may not allow export. */
async function exportFixture(exportAllowed: boolean): Promise<{ owner: Actor; sourceOwner: Actor; space: string; source: string }> {
  const owner = await seedActor('Export owner');
  const sourceOwner = await seedActor('Export source');
  const space = await createWorkspace(owner, 'Export space');
  const source = await createEquipmentTable(sourceOwner);
  await command(sourceOwner, source, 'source.grantProjection', {
    grantId: 'grant-export',
    spaceId: 'export-room',
    spaceWorkspaceId: space.id,
    audience: { kind: 'space-members' },
    projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 10 }],
    actions: [],
    exportAllowed,
  });
  const created = await command(owner, space, 'space.create', {
    spaceId: 'export-room', title: 'ห้องส่งออก', sharedToolWorkspaceId: space.id,
  });
  await command(owner, created.workspace, 'space.addSource', {
    source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
  });
  return { owner, sourceOwner, space: space.id, source: source.id };
}

async function downloadExport(actor: Actor, spaceId: string, source: string, query = 'grant=grant-export&port=equipment') {
  const response = await worker.fetch(request(`/api/workspaces/${spaceId}/space/export?source=${source}&${query}`, actor), bindings);
  return { status: response.status, headers: response.headers, text: await response.text() };
}

describe('exporting a granted projection', () => {
  it('downloads a CSV with the source rows when the grant allows export', async () => {
    const setup = await exportFixture(true);
    const result = await downloadExport(setup.owner, setup.space, setup.source);
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('text/csv');
    expect(result.headers.get('content-disposition')).toContain('attachment');
    expect(result.headers.get('x-source-data-revision')).toBeTruthy();
    // The real rows travel: the equipment scenario names the field camera.
    expect(result.text).toContain('Field camera');
    // Only the granted field is a column.
    expect(result.text.split('\r\n')[0]).toBe('name');
  });

  it('serves an HTML file when asked', async () => {
    const setup = await exportFixture(true);
    const result = await downloadExport(setup.owner, setup.space, setup.source, 'grant=grant-export&port=equipment&format=html');
    expect(result.status).toBe(200);
    expect(result.headers.get('content-type')).toContain('text/html');
    expect(result.text).toContain('Field camera');
  });

  it('refuses a read-only grant with its own code', async () => {
    const setup = await exportFixture(false);
    const result = await downloadExport(setup.owner, setup.space, setup.source);
    expect(result.status).toBe(403);
    expect(result.text).toContain('EXPORT_NOT_PERMITTED');
  });

  it('refuses after the grant is revoked', async () => {
    const setup = await exportFixture(true);
    const source = await viewOf(setup.sourceOwner, setup.source);
    await command(setup.sourceOwner, source, 'source.revokeProjection', { grantId: 'grant-export' });
    const result = await downloadExport(setup.owner, setup.space, setup.source);
    expect(result.status).toBe(409);
    expect(result.text).toContain('SPACE_GRANT_REVOKED');
  });

  it('refuses someone outside the space', async () => {
    const setup = await exportFixture(true);
    const outsider = await seedActor('Export outsider');
    const result = await downloadExport(outsider, setup.space, setup.source);
    expect(result.status).toBe(403);
    expect(result.text).toContain('SPACE_NOT_MEMBER');
  });
});

/** Grant one projection from a source table to a space workspace. */
async function grantProjection(
  sourceOwner: Actor,
  source: WorkspaceView,
  input: { grantId: string; spaceId: string; spaceWorkspaceId: string; portId: string; resource?: string },
): Promise<void> {
  await command(sourceOwner, source, 'source.grantProjection', {
    grantId: input.grantId,
    spaceId: input.spaceId,
    spaceWorkspaceId: input.spaceWorkspaceId,
    audience: { kind: 'space-members' },
    projections: [{ portId: input.portId, resource: input.resource ?? 'equipment', fields: ['name'], maxRows: 10 }],
    actions: [],
  });
}

describe('three tables and rebinding', () => {
  it('serves three independent sources at their own revisions', async () => {
    const owner = await seedActor('Topology owner');
    const space = await createWorkspace(owner, 'Topology space');
    const created = await command(owner, space, 'space.create', {
      spaceId: 'topology-room', title: 'ห้องสามโต๊ะ', sharedToolWorkspaceId: space.id,
    });
    let current = created.workspace;

    const sources: { id: string; grant: string }[] = [];
    for (const index of [1, 2, 3]) {
      const sourceOwner = await seedActor(`Source ${index}`);
      const source = await createEquipmentTable(sourceOwner);
      const grantId = `grant-t${index}`;
      await grantProjection(sourceOwner, source, { grantId, spaceId: 'topology-room', spaceWorkspaceId: space.id, portId: `port${index}` });
      const linked = await command(owner, current, 'space.addSource', {
        source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
      });
      current = linked.workspace;
      sources.push({ id: source.id, grant: grantId });
    }

    // All three are linked, and each answers with its own live revision.
    const spaceView = await viewOf(owner, space.id);
    const spaceState = (spaceView.domain as { collaborationSpace?: { sources: { workspaceId: string; status: string }[] } }).collaborationSpace;
    expect(spaceState?.sources).toHaveLength(3);
    expect(spaceState?.sources.every(source => source.status === 'linked')).toBe(true);

    for (const [index, source] of sources.entries()) {
      const result = await readProjection(owner, space.id, { source: source.id, grant: source.grant, port: `port${index + 1}` });
      expect(result.status, `source ${index + 1}`).toBe(200);
      expect((result.body.rows as unknown[]).length).toBeGreaterThan(0);
    }
  });

  it('stops reaching a disconnected table and serves a newly linked one instead', async () => {
    const owner = await seedActor('Rebind owner');
    const firstOwner = await seedActor('First source');
    const secondOwner = await seedActor('Second source');
    const space = await createWorkspace(owner, 'Rebind space');
    const first = await createEquipmentTable(firstOwner);
    const second = await createEquipmentTable(secondOwner);

    const created = await command(owner, space, 'space.create', {
      spaceId: 'rebind-room', title: 'ห้องเชื่อมใหม่', sharedToolWorkspaceId: space.id,
    });
    await grantProjection(firstOwner, first, { grantId: 'grant-first', spaceId: 'rebind-room', spaceWorkspaceId: space.id, portId: 'first' });
    await grantProjection(secondOwner, second, { grantId: 'grant-second', spaceId: 'rebind-room', spaceWorkspaceId: space.id, portId: 'second' });
    const linkedFirst = await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: first.id, epoch: first.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    const before = await readProjection(owner, space.id, { source: first.id, grant: 'grant-first', port: 'first' });
    expect(before.status).toBe(200);

    // Disconnect the first table: the space keeps existing, but that source is no longer reachable.
    await command(owner, linkedFirst.workspace, 'space.leaveSource', { workspaceId: first.id });
    const afterLeave = await readProjection(owner, space.id, { source: first.id, grant: 'grant-first', port: 'first' });
    expect(afterLeave.status).toBe(404);
    expect(afterLeave.body).toMatchObject({ errorCode: 'SPACE_SOURCE_NOT_LINKED' });
    // No last-known values are served through the refusal.
    expect(afterLeave.body.rows).toBeUndefined();

    // Rebind to a different table and read from it.
    const currentSpace = await viewOf(owner, space.id);
    await command(owner, currentSpace, 'space.addSource', {
      source: { workspaceId: second.id, epoch: second.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });
    const rebound = await readProjection(owner, space.id, { source: second.id, grant: 'grant-second', port: 'second' });
    expect(rebound.status).toBe(200);
    expect((rebound.body.rows as unknown[]).length).toBeGreaterThan(0);
  });
});

async function readRecap(actor: Actor, spaceId: string) {
  const response = await worker.fetch(request(`/api/workspaces/${spaceId}/space/recap`, actor), bindings);
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

describe('a room recap', () => {
  it('reports a stable connection, then a change, then a withdrawal', async () => {
    const owner = await seedActor('Recap owner');
    const sourceOwner = await seedActor('Recap source');
    const space = await createWorkspace(owner, 'Recap space');
    const source = await createEquipmentTable(sourceOwner);

    await command(sourceOwner, source, 'source.grantProjection', {
      grantId: 'grant-recap',
      spaceId: 'recap-room',
      spaceWorkspaceId: space.id,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
      actions: [],
    });
    const created = await command(owner, space, 'space.create', {
      spaceId: 'recap-room', title: 'ห้องสรุป', sharedToolWorkspaceId: space.id,
    });
    await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    // Nothing has changed since the grant was issued, so the room is stable.
    const stable = await readRecap(owner, space.id);
    expect(stable.status).toBe(200);
    const stableRecap = stable.body.recap as { headline: string; incomplete: boolean; current: unknown[] };
    expect(stableRecap.incomplete).toBe(false);

    // The source moves; the recap must say so with real numbers.
    const current = await viewOf(sourceOwner, source.id);
    await command(sourceOwner, current, 'table.import', { filename: 'more.txt', text: 'a second file' });
    const moved = await readRecap(owner, space.id);
    const movedRecap = moved.body.recap as { changed: { from: number; to: number }[]; headline: string };
    expect(movedRecap.changed.length).toBeGreaterThan(0);
    expect(movedRecap.changed[0]!.to).toBeGreaterThan(movedRecap.changed[0]!.from);

    // Withdrawing shows up as a withdrawal, not as a change.
    const latest = await viewOf(sourceOwner, source.id);
    await command(sourceOwner, latest, 'source.revokeProjection', { grantId: 'grant-recap' });
    const withdrawn = await readRecap(owner, space.id);
    const withdrawnRecap = withdrawn.body.recap as { withdrawn: unknown[] };
    expect(withdrawnRecap.withdrawn.length).toBe(1);
  });

  it('refuses someone outside the space', async () => {
    const owner = await seedActor('Recap outsider owner');
    const space = await createWorkspace(owner, 'Recap space 2');
    const outsider = await seedActor('Recap outsider');
    const result = await readRecap(outsider, space.id);
    expect(result.status).toBe(403);
  });
});

/**
 * F080 / TOPO-01: what three linked sources actually cost.
 *
 * This measures the read path the room uses, not a benchmark of the platform: sequential reads from
 * one Worker entry against real Durable Objects, with the per-grant row ceiling asserted every time.
 * The numbers are reported, never asserted as a capacity claim.
 */
describe('three tables under repeated reads', () => {
  it('serves repeated reads within the per-grant limits and reports its own timing', async () => {
    const owner = await seedActor('Load owner');
    const space = await createWorkspace(owner, 'Load space');
    const created = await command(owner, space, 'space.create', {
      spaceId: 'load-room', title: 'ห้องวัดโหลด', sharedToolWorkspaceId: space.id,
    });
    let current = created.workspace;
    const sources: { id: string; grant: string; port: string }[] = [];

    for (const index of [1, 2, 3]) {
      const sourceOwner = await seedActor(`Load source ${index}`);
      const source = await createEquipmentTable(sourceOwner);
      const grantId = `grant-load-${index}`;
      const portId = `port${index}`;
      // A small ceiling on purpose: the measurement must show the cap being honoured.
      await command(sourceOwner, source, 'source.grantProjection', {
        grantId,
        spaceId: 'load-room',
        spaceWorkspaceId: space.id,
        audience: { kind: 'space-members' },
        projections: [{ portId, resource: 'equipment', fields: ['name'], maxRows: 2 }],
        actions: [],
      });
      const linked = await command(owner, current, 'space.addSource', {
        source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
      });
      current = linked.workspace;
      sources.push({ id: source.id, grant: grantId, port: portId });
    }

    const started = Date.now();
    let reads = 0;
    let rowsSeen = 0;
    for (let round = 0; round < 5; round += 1) {
      for (const source of sources) {
        const result = await readProjection(owner, space.id, { source: source.id, grant: source.grant, port: source.port });
        expect(result.status, `round ${round}`).toBe(200);
        const rows = result.body.rows as unknown[];
        // The grant ceiling is honoured on every single read, not only the first.
        expect(rows.length).toBeLessThanOrEqual(2);
        rowsSeen += rows.length;
        reads += 1;
      }
    }
    const elapsed = Date.now() - started;
    expect(reads).toBe(15);
    // A generous ceiling that still catches a pathological regression (seconds per read).
    expect(elapsed / reads).toBeLessThan(2_000);
    console.log(JSON.stringify({ reads, rowsSeen, elapsedMs: elapsed, averageMs: Math.round(elapsed / reads) }));
  });
});

/**
 * F080 / EVOLVE-01: the second update edits the program the table holds.
 *
 * domain/table.ts:508 requires every retained field to be byte-identical to its previous definition,
 * so a program rebuilt from the scenario source is refused as a rule change. Editing the stored
 * program is the path a person takes in the UI, and the one this test follows.
 */
describe('an additive program update keeps identities', () => {
  it('keeps record ids, actions and canvas views when a field is added', async () => {
    const owner = await seedActor('Evolve additive owner');
    const created = await createWorkspace(owner, 'Evolve additive table');
    const imported = await command(owner, created, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    const sourceId = (imported.workspace.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('EVOLVE_SOURCE_MISSING');

    const runCycle = async (start: typeof created, change: unknown) => {
      let workspace = start;
      for (const [type, payload] of [
        ['evolve.propose', { change }],
        ['evolve.simulate', {}],
        ['evolve.validate', {}],
        ['evolve.approve', {}],
        ['evolve.activate', {}],
      ] as const) {
        const result = await command(owner, workspace, type, payload);
        workspace = result.workspace;
      }
      return workspace;
    };

    const first = await runCycle(imported.workspace, equipmentChange(sourceId));
    const snapshot = (view: typeof created) => {
      const domain = view.domain as unknown as {
        records?: Record<string, { id: string }[]>;
        program?: { actions?: { id: string }[]; canvas?: { views?: { id: string }[] }; collections?: { id: string; fields: { id: string }[] }[] };
        dataRevision?: number;
      };
      return {
        recordIds: (domain.records?.equipment ?? []).map(row => row.id).sort(),
        actionIds: (domain.program?.actions ?? []).map(action => action.id).sort(),
        viewIds: (domain.program?.canvas?.views ?? []).map(entry => entry.id).sort(),
        fieldIds: (domain.program?.collections?.find(collection => collection.id === 'equipment')?.fields ?? []).map(field => field.id).sort(),
      };
    };
    const before = snapshot(first);
    expect(before.recordIds.length).toBeGreaterThan(0);

    const stored = (first.domain as unknown as {
      program: { collections: { id: string; fields: unknown[] }[] } & Record<string, unknown>;
    }).program;
    const secondProgram = {
      ...stored,
      collections: stored.collections.map(collection => (collection.id === 'equipment'
        ? { ...collection, fields: [...collection.fields, { id: 'note', label: 'Note', type: 'text', required: false }] }
        : collection)),
    };
    // A rule edit must not carry initial records; the existing rows stay as they are.
    const second = await runCycle(first, { kind: 'table', program: secondProgram, initialRecords: {} });
    const after = snapshot(second);

    expect(after.recordIds).toEqual(before.recordIds);
    expect(after.actionIds).toEqual(before.actionIds);
    expect(after.viewIds).toEqual(before.viewIds);
    expect(after.fieldIds).toEqual([...before.fieldIds, 'note'].sort());
  });
});

/**
 * F080 / G4-01 (first half): a preview must not write back to the real table.
 *
 * Proposing and simulating a change is what a person does to see an outcome. If simulating already
 * moved the table, the "preview" would be an edit; the check is that the table's own data, program and
 * revisions are untouched while the proposal exists.
 */
describe('a preview does not touch the table', () => {
  it('leaves program, records and revisions unchanged after propose and simulate', async () => {
    const owner = await seedActor('Preview owner');
    const created = await createWorkspace(owner, 'Preview table');
    const imported = await command(owner, created, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    const sourceId = (imported.workspace.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('PREVIEW_SOURCE_MISSING');
    const before = await viewOf(owner, imported.workspace.id);

    const proposed = await command(owner, before, 'evolve.propose', { change: equipmentChange(sourceId) });
    const simulated = await command(owner, proposed.workspace, 'evolve.simulate', {});

    const domainOf = (view: typeof before) => view.domain as unknown as {
      program?: unknown;
      records?: Record<string, unknown[]>;
      dataRevision?: number;
      ruleRevision?: number;
    };
    const beforeDomain = domainOf(before);
    const afterDomain = domainOf(simulated.workspace);

    // The table's own content is untouched by a preview.
    expect(afterDomain.program).toEqual(beforeDomain.program);
    expect(afterDomain.records).toEqual(beforeDomain.records);
    expect(afterDomain.dataRevision).toBe(beforeDomain.dataRevision);
    expect(afterDomain.ruleRevision).toBe(beforeDomain.ruleRevision);
  });

});

/**
 * F080 / G4-01 (second half): promote refuses a change that breaks a dependency.
 *
 * The change is built from the scenario's own program (so it is a wire-valid program) and only adds
 * an action whose parameter points at a collection that does not exist. Nothing else is edited, so a
 * refusal can only come from the dependency check, and the table must still hold no program after.
 */
describe('a broken dependency never promotes', () => {
  it('refuses a change whose action references a missing collection', async () => {
    const owner = await seedActor('Dependency owner');
    const created = await createWorkspace(owner, 'Dependency table');
    const imported = await command(owner, created, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    const sourceId = (imported.workspace.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('DEPENDENCY_SOURCE_MISSING');

    const change = equipmentChange(sourceId);
    change.program.actions = [...change.program.actions, {
      id: 'ghost-action',
      title: 'Ghost',
      description: 'points at a collection that does not exist',
      roles: ['owner'],
      parameters: [{ id: 'target', label: 'Target', type: 'record', collection: 'ghost-collection' }],
      conditions: [],
      effects: [],
      requireTurn: false,
      advanceTurn: false,
    }];

    const proposed = await command(owner, imported.workspace, 'evolve.propose', { change });
    let refused: { status: number; code: string } | undefined;
    try {
      await command(owner, proposed.workspace, 'evolve.simulate', {});
      await command(owner, proposed.workspace, 'evolve.validate', {});
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = /failed: (\d+) (\w+)/u.exec(message);
      refused = { status: Number(match?.[1] ?? 0), code: match?.[2] ?? message };
    }
    expect(refused, 'a change with a missing collection must not validate').toBeDefined();
    expect(refused?.status).toBe(422);
    expect(refused?.code.startsWith('TABLE_')).toBe(true);

    // Nothing was promoted: a refused change leaves no program behind.
    const after = await viewOf(owner, imported.workspace.id);
    expect((after.domain as { program?: unknown }).program ?? null).toBeNull();
  });
});

/**
 * F080 / SCENARIO-01: a saved comparison cannot quietly write, and a stale promotion is refused.
 *
 * The first half is covered by the preview test (the table does not move). This second half sends a
 * command carrying an outdated revision and expects a refusal with no state change, which is what
 * "promote a stale scenario safely" has to mean.
 */
describe('a stale promotion is refused', () => {
  it('rejects a command built on an outdated revision and leaves the table untouched', async () => {
    const owner = await seedActor('Stale owner');
    const created = await createWorkspace(owner, 'Stale table');
    const staleView = await viewOf(owner, created.id);

    // Move the table on by one command, so the captured revision is now history.
    await command(owner, staleView, 'workspace.rename', { title: 'Renamed after capture' });
    const current = await viewOf(owner, created.id);
    expect(current.revision).not.toBe(staleView.revision);

    const response = await worker.fetch(request(`/api/workspaces/${created.id}/commands`, owner, {
      method: 'POST',
      body: {
        commandId: randomUUID(),
        expectedRevision: staleView.revision,
        expectedEpoch: current.epoch,
        type: 'workspace.rename',
        payload: { title: 'Should never apply' },
      },
    }), bindings);
    const body = await response.json() as { errorCode?: string; code?: string };
    expect(response.status).toBe(409);
    const code = body.errorCode ?? body.code;
    expect(code === 'STALE_REVISION' || code === 'REVISION_CONFLICT').toBe(true);

    // The refused command did not apply.
    const after = await viewOf(owner, created.id);
    expect(after.title).toBe(current.title);
    expect(after.revision).toBe(current.revision);
  });
});

/**
 * F080 / ORACLE-01 (connection surface): what the route served can be recomputed from the source.
 *
 * The check is deliberately outside the route: read the source table's own records, project them with
 * the same granted fields, and compare against the HTTP answer at the revision it claims. If the two
 * disagree, either the route or the projection is wrong. A second read after the source moves must
 * report a different revision, which is what freshness means here.
 */
describe('an independent oracle checks the connection surface', () => {
  it('recomputes the served rows from the source and notices when the source moves', async () => {
    const owner = await seedActor('Oracle owner');
    const sourceOwner = await seedActor('Oracle source');
    const space = await createWorkspace(owner, 'Oracle space');
    const source = await createEquipmentTable(sourceOwner);
    await command(sourceOwner, source, 'source.grantProjection', {
      grantId: 'grant-oracle',
      spaceId: 'oracle-room',
      spaceWorkspaceId: space.id,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
      actions: [],
    });
    const created = await command(owner, space, 'space.create', {
      spaceId: 'oracle-room', title: 'ห้องตรวจสอบ', sharedToolWorkspaceId: space.id,
    });
    await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    const served = await readProjection(owner, space.id, { source: source.id, grant: 'grant-oracle', port: 'equipment' });
    expect(served.status).toBe(200);

    // The oracle reads the source directly and projects the same fields itself.
    const sourceView = await viewOf(sourceOwner, source.id);
    const sourceDomain = sourceView.domain as unknown as {
      records?: Record<string, { id: string; values: Record<string, unknown> }[]>;
      dataRevision?: number;
    };
    const expectedRows = (sourceDomain.records?.equipment ?? []).map(row => ({ id: row.id, values: { name: row.values.name } }));

    expect(served.body.rows).toEqual(expectedRows);
    expect(served.body.sourceDataRevision).toBe(sourceDomain.dataRevision);

    // The source moves; the oracle must see a different revision on the next read.
    const current = await viewOf(sourceOwner, source.id);
    await command(sourceOwner, current, 'table.import', { filename: 'oracle-extra.txt', text: 'one more file' });
    const afterMove = await readProjection(owner, space.id, { source: source.id, grant: 'grant-oracle', port: 'equipment' });
    expect(afterMove.status).toBe(200);
    expect(Number(afterMove.body.sourceDataRevision)).toBeGreaterThan(Number(served.body.sourceDataRevision));
  });
});

/**
 * F080 / ORACLE-01 (export surface): two independent paths must agree on the same data.
 *
 * The projection and the export are produced by different code and different requests. Comparing them
 * catches a serializer or a narrowing that drifted on one side only, which no single-path test can.
 */
describe('the export agrees with the projection', () => {
  it('serves the same rows in the same order through both paths', async () => {
    const owner = await seedActor('Export oracle owner');
    const sourceOwner = await seedActor('Export oracle source');
    const space = await createWorkspace(owner, 'Export oracle space');
    const source = await createEquipmentTable(sourceOwner);
    await command(sourceOwner, source, 'source.grantProjection', {
      grantId: 'grant-cross',
      spaceId: 'cross-room',
      spaceWorkspaceId: space.id,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 5 }],
      actions: [],
      exportAllowed: true,
    });
    const created = await command(owner, space, 'space.create', {
      spaceId: 'cross-room', title: 'ห้องเทียบสองทาง', sharedToolWorkspaceId: space.id,
    });
    await command(owner, created.workspace, 'space.addSource', {
      source: { workspaceId: source.id, epoch: source.epoch, addedBy: owner.id, addedAt: Date.now(), status: 'linked' },
    });

    const projected = await readProjection(owner, space.id, { source: source.id, grant: 'grant-cross', port: 'equipment' });
    expect(projected.status).toBe(200);
    const projectionRows = (projected.body.rows as { id: string; values: Record<string, unknown> }[]).map(row => String(row.values.name));

    const exported = await downloadExport(owner, space.id, source.id, 'grant=grant-cross&port=equipment');
    expect(exported.status).toBe(200);
    const lines = exported.text.replace(/^\uFEFF/u, '').split('\r\n').filter(Boolean);
    // Header is the granted field, then one line per row, in the same order.
    expect(lines[0]).toBe('name');
    expect(lines.slice(1)).toEqual(projectionRows);
    // The file's provenance header matches the revision the projection reported.
    expect(exported.headers.get('x-source-data-revision')).toBe(String(projected.body.sourceDataRevision));
  });
});

/**
 * F080 / CTX-01: the brief is written through the normal command path and is there after a reload.
 *
 * The second clause of the criterion asks that an edit by someone with permission is visible after a
 * reload and to another member. A separate member needs an invite flow that this file does not drive,
 * so this proves the persisted half: the value a fresh read returns is the one that was committed.
 */
describe('the room brief survives a reload', () => {
  it('stores the brief with its author, and clears it again', async () => {
    const owner = await seedActor('Brief owner');
    const space = await createWorkspace(owner, 'Brief space');
    const created = await command(owner, space, 'space.create', {
      spaceId: 'brief-room', title: 'ห้องมี brief', sharedToolWorkspaceId: space.id,
    });

    const saved = await command(owner, created.workspace, 'space.setBrief', { text: 'วางผังห้องให้ผู้จัดกิจกรรมลงทะเบียน' });
    const reloaded = await viewOf(owner, space.id);
    const state = (reloaded.domain as { collaborationSpace?: { brief?: { text: string; updatedBy: string; updatedAt: number } } }).collaborationSpace;
    expect(state?.brief?.text).toBe('วางผังห้องให้ผู้จัดกิจกรรมลงทะเบียน');
    expect(state?.brief?.updatedBy).toBe(owner.id);
    expect(state?.brief?.updatedAt).toBeGreaterThan(0);

    const cleared = await command(owner, saved.workspace, 'space.clearBrief', {});
    const after = (await viewOf(owner, space.id)).domain as { collaborationSpace?: { brief?: unknown } };
    expect(after.collaborationSpace?.brief ?? null).toBeNull();
    expect(cleared.workspace.revision).toBeTruthy();
  });
});

/**
 * F080 / G2-01: adding data later and editing twice must leave everything outside the edit alone.
 *
 * The scope of the edit is one new field per round. Everything else - existing record ids and their
 * values, the action ids, the canvas view ids and the sources already on the table - must survive both
 * the second import and the second activation.
 */
describe('later files and a second edit keep the rest intact', () => {
  it('keeps values, row ids, actions, views and earlier sources across two edits and a new file', async () => {
    const owner = await seedActor('G2 owner');
    const created = await createWorkspace(owner, 'G2 table');
    const imported = await command(owner, created, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    const sourceId = (imported.workspace.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('G2_SOURCE_MISSING');

    const activate = async (start: typeof created, change: unknown) => {
      let workspace = start;
      for (const [type, payload] of [
        ['evolve.propose', { change }],
        ['evolve.simulate', {}],
        ['evolve.validate', {}],
        ['evolve.approve', {}],
        ['evolve.activate', {}],
      ] as const) {
        const result = await command(owner, workspace, type, payload);
        workspace = result.workspace;
      }
      return workspace;
    };

    const snapshot = (view: typeof created) => {
      const domain = view.domain as unknown as {
        records?: Record<string, { id: string; values: Record<string, unknown> }[]>;
        program?: { actions?: { id: string }[]; canvas?: { views?: { id: string }[] }; collections?: { id: string; fields: { id: string }[] }[] };
        sources?: { id: string }[];
      };
      return {
        rows: (domain.records?.equipment ?? []).map(row => ({ id: row.id, values: row.values })),
        actionIds: (domain.program?.actions ?? []).map(action => action.id).sort(),
        viewIds: (domain.program?.canvas?.views ?? []).map(entry => entry.id).sort(),
        fieldIds: (domain.program?.collections?.find(collection => collection.id === 'equipment')?.fields ?? []).map(field => field.id).sort(),
        sourceIds: (domain.sources ?? []).map(source => source.id).sort(),
      };
    };

    // Round one: add one field.
    const firstChange = equipmentChange(sourceId);
    const collection = firstChange.program.collections?.[0];
    if (!collection) throw new Error('G2_COLLECTION_MISSING');
    collection.fields = [...collection.fields, { id: 'note', label: 'Note', type: 'text', required: false }];
    const afterFirst = await activate(imported.workspace, firstChange);
    const before = snapshot(afterFirst);
    expect(before.rows.length).toBeGreaterThan(0);

    // A new file arrives, then a second edit adds one more field.
    const afterImport = await command(owner, afterFirst, 'table.import', {
      filename: 'second-file.txt',
      text: 'A second file for the same table.',
    });
    const stored = (afterImport.workspace.domain as unknown as {
      program: { collections: { id: string; fields: unknown[] }[] } & Record<string, unknown>;
    }).program;
    const secondProgram = {
      ...stored,
      collections: stored.collections.map(entry => (entry.id === 'equipment'
        ? { ...entry, fields: [...entry.fields, { id: 'tag', label: 'Tag', type: 'text', required: false }] }
        : entry)),
    };
    const afterSecond = await activate(afterImport.workspace, { kind: 'table', program: secondProgram, initialRecords: {} });
    const after = snapshot(afterSecond);

    // Everything outside the edit is untouched.
    expect(after.rows).toEqual(before.rows);
    expect(after.actionIds).toEqual(before.actionIds);
    expect(after.viewIds).toEqual(before.viewIds);
    // Both earlier sources are still on the table, plus the new file.
    expect(after.sourceIds).toEqual(expect.arrayContaining(before.sourceIds));
    expect(after.sourceIds.length).toBe(before.sourceIds.length + 1);
    // Exactly the two fields that were added.
    // 'note' was added in the first round and is already part of before; only 'tag' is new.
    expect(after.fieldIds).toEqual([...before.fieldIds, 'tag'].sort());
  });
});

/**
 * F080 / G2-02: a stale epoch is refused and nothing is written.
 *
 * The revision guard is covered by the stale-promotion test; this is the other half of the same
 * contract - an epoch that no longer matches must not apply anything either.
 */
describe('a wrong epoch is refused without a partial write', () => {
  it('rejects a command carrying an epoch the table does not have', async () => {
    const owner = await seedActor('Epoch owner');
    const created = await createWorkspace(owner, 'Epoch table');
    const current = await viewOf(owner, created.id);

    const response = await worker.fetch(request(`/api/workspaces/${created.id}/commands`, owner, {
      method: 'POST',
      body: {
        commandId: randomUUID(),
        expectedRevision: current.revision,
        expectedEpoch: current.epoch + 1,
        type: 'workspace.rename',
        payload: { title: 'Should never apply' },
      },
    }), bindings);
    const body = await response.json() as { errorCode?: string; code?: string };
    expect(response.status).toBeGreaterThanOrEqual(400);
    const code = body.errorCode ?? body.code ?? '';
    expect(code.includes('EPOCH') || code.includes('STALE')).toBe(true);

    // Nothing was applied: same title, same revision, same epoch.
    const after = await viewOf(owner, created.id);
    expect(after.title).toBe(current.title);
    expect(after.revision).toBe(current.revision);
    expect(after.epoch).toBe(current.epoch);
  });
});

/**
 * F080 / EXEC-01: the plan gates the commit, and the commit is the ordinary table.act command.
 *
 * A declared action proposal is applied through the authority (the row really changes); an undeclared
 * one never produces a command, so the table does not move at all.
 */
describe('a behaviour proposal is gated before the commit', () => {
  it('commits through the declared action, and refuses out of scope with zero write', async () => {
    const owner = await seedActor('Proposal owner');
    const created = await createWorkspace(owner, 'Proposal table');
    const imported = await command(owner, created, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    const sourceId = (imported.workspace.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('PROPOSAL_SOURCE_MISSING');
    let current = imported.workspace;
    for (const [type, payload] of [
      ['evolve.propose', { change: equipmentChange(sourceId) }],
      ['evolve.simulate', {}],
      ['evolve.validate', {}],
      ['evolve.approve', {}],
      ['evolve.activate', {}],
    ] as const) {
      const result = await command(owner, current, type, payload);
      current = result.workspace;
    }

    const programActions = (current.domain as { program?: { actions?: unknown[] } }).program?.actions ?? [];
    const declared = ['borrow'];
    const proposed = planToolBehaviorAction({
      declaredActions: declared,
      programActions: programActions as never,
      proposal: { actionId: 'borrow', inputs: { item: 'camera' } },
    });
    expect(proposed, JSON.stringify(proposed)).toMatchObject({ ok: true });

    // The commit is the ordinary action command, not a new write path.
    const committed = await command(owner, current, 'table.act', {
      actionId: 'borrow',
      inputs: { item: 'camera' },
    });
    const afterCommit = committed.workspace;
    const availability = (view: typeof afterCommit) => (view.domain as unknown as {
      records?: Record<string, { id: string; values: { available?: unknown } }[]>;
    }).records?.equipment?.find(row => row.id === 'camera')?.values.available;
    expect(availability(afterCommit)).toBe(false);

    // An action the package never declared is refused by the plan, so no command is sent.
    const refused = planToolBehaviorAction({
      declaredActions: declared,
      programActions: programActions as never,
      proposal: { actionId: 'giveBack', inputs: { item: 'camera' } },
    });
    expect(refused).toMatchObject({ ok: false, code: 'ACTION_NOT_DECLARED' });

    const untouched = await viewOf(owner, afterCommit.id);
    expect((untouched.domain as { dataRevision?: number }).dataRevision)
      .toBe((afterCommit.domain as { dataRevision?: number }).dataRevision);
    expect(availability(untouched)).toBe(false);
  });
});
