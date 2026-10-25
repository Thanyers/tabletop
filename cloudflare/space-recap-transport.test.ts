import { describe, expect, it } from 'vitest';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import type { GrantedConnection } from '../src/tabletop/shared/space-grants.js';
import { handleSpaceRecap, type SourceRecapAnswer, type SpaceRecapDeps } from './space-recap-transport.js';

/** F080 / JT-4A: the recap route answers honestly, including when a source will not answer. */

const SPACE = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

function space(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: 1,
    spaceId: 'activity-room',
    title: 'ห้อง',
    sharedToolWorkspaceId: SPACE,
    managerActorId: 'actor-a',
    members: [{ actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 }],
    sources: [
      { workspaceId: A, epoch: 1, addedBy: 'actor-a', addedAt: 1, status: 'linked' },
      { workspaceId: B, epoch: 1, addedBy: 'actor-a', addedAt: 1, status: 'linked' },
    ],
    revision: 7,
    epoch: 1,
    createdAt: 1,
    updatedAt: 7,
    ...overrides,
  };
}

function view(collaborationSpace: CollaborationSpace | undefined): WorkspaceView {
  return {
    id: SPACE,
    title: 'Space',
    kind: 'table',
    epoch: 1,
    revision: 'rev-1',
    actor: { actorId: 'actor-a', name: 'A', role: 'owner' },
    members: [],
    domain: (collaborationSpace ? { kind: 'table', collaborationSpace } : { kind: 'table' }) as WorkspaceView['domain'],
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
  };
}

function connection(overrides: Partial<GrantedConnection> = {}): GrantedConnection {
  return {
    grantId: 'grant-a',
    sourceWorkspaceId: A,
    grantedRevision: 4,
    status: 'granted',
    grantVersion: 1,
    exportAllowed: false,
    actions: [],
    ports: ['plan'],
    ...overrides,
  };
}

function deps(answers: Record<string, SourceRecapAnswer[]>, overrides: Partial<SpaceRecapDeps> = {}): SpaceRecapDeps {
  return {
    authenticate: async () => ({ actorId: 'actor-a' }),
    workspaceView: async () => view(space()),
    listSourceGrants: async (_request, sourceWorkspaceId) => answers[sourceWorkspaceId] ?? [],
    ...overrides,
  };
}

function request(method = 'GET'): Request {
  return new Request(`https://tabletop.test/api/workspaces/${SPACE}/space/recap`, { method });
}

async function body(response: Response): Promise<{ ok: boolean; recap?: Record<string, unknown> }> {
  return await response.json() as { ok: boolean; recap?: Record<string, unknown> };
}

describe('the recap route', () => {
  it('reports a stable room when both sources answer at the granted revision', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 4 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload.recap).toMatchObject({ spaceId: 'activity-room', revision: 7, incomplete: false });
    expect(String(payload.recap?.headline)).toContain('ตรงกับที่เชื่อมไว้');
  });

  it('reports a moved source with its own numbers', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 9 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    const payload = await body(response);
    expect(payload.recap?.changed).toEqual([{ workspaceId: A, grantId: 'grant-a', from: 4, to: 9 }]);
  });

  it('says incomplete when a source cannot be asked, instead of pretending it is fine', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 4 }],
      // B throws.
    }, { listSourceGrants: async (_r, sourceWorkspaceId) => {
      if (sourceWorkspaceId === B) throw new Error('room unavailable');
      return [{ connection: connection(), liveDataRevision: 4 }];
    } }), { spaceId: SPACE });
    const payload = await body(response);
    expect(payload.recap?.incomplete).toBe(true);
    expect(String(payload.recap?.headline)).toContain('อ่านบางแหล่งไม่ได้');
  });

  it('keeps a withdrawn connection visible', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection({ status: 'revoked' }), liveDataRevision: 4 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    const payload = await body(response);
    expect(payload.recap?.withdrawn).toHaveLength(1);
  });

  it('refuses an outsider, an unauthenticated caller and a non-GET method', async () => {
    expect((await handleSpaceRecap(request(), deps({}, { authenticate: async () => undefined }), { spaceId: SPACE })).status).toBe(401);
    expect((await handleSpaceRecap(request(), deps({}, { authenticate: async () => ({ actorId: 'outsider' }) }), { spaceId: SPACE })).status).toBe(403);
    expect((await handleSpaceRecap(request('POST'), deps({}), { spaceId: SPACE })).status).toBe(405);
  });

  it('carries impact only for the sources that actually changed or were withdrawn', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 9 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    const payload = await response.json() as { impact: { workspaceId: string; ports: unknown[]; summary: string }[] };
    expect(payload.impact).toHaveLength(1);
    expect(payload.impact[0]?.workspaceId).toBe(A);
    expect(payload.impact[0]?.ports).toHaveLength(1);
    expect(payload.impact[0]?.summary).toContain('ข้อมูลใหม่');
  });

  it('carries no impact when nothing moved', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 4 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    const payload = await response.json() as { impact: unknown[] };
    expect(payload.impact).toEqual([]);
  });

  it('carries no rows or field values anywhere in the answer', async () => {
    const response = await handleSpaceRecap(request(), deps({
      [A]: [{ connection: connection(), liveDataRevision: 4 }],
      [B]: [{ connection: connection({ grantId: 'grant-b', sourceWorkspaceId: B }), liveDataRevision: 4 }],
    }), { spaceId: SPACE });
    const text = await response.text();
    expect(text).not.toContain('rows');
    expect(text).not.toContain('values');
  });
});
