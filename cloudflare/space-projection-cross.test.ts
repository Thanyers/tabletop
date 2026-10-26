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
