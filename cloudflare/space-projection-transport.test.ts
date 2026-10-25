import { describe, expect, it } from 'vitest';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import { handleSpaceProjectionRead, type SpaceProjectionTransportDeps } from './space-projection-transport.js';

/**
 * F080 / C6: the Worker side of the cross-workspace read, with the Rooms replaced by fakes.
 *
 * The source Room's own decision is covered by the pure resolver tests; this file covers the part
 * the Worker owns — who may ask, which table a space may ask about, and how a refusal is reported.
 */

const SPACE_WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';

function space(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: 1,
    spaceId: 'activity-room',
    title: 'ห้องวางผังกิจกรรม',
    sharedToolWorkspaceId: SPACE_WORKSPACE,
    managerActorId: 'actor-a',
    members: [
      { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
      { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 2 },
    ],
    sources: [{ workspaceId: SOURCE, epoch: 3, addedBy: 'actor-a', addedAt: 1, status: 'linked' }],
    revision: 5,
    epoch: 1,
    createdAt: 1,
    updatedAt: 5,
    ...overrides,
  };
}

function view(collaborationSpace: CollaborationSpace | undefined): WorkspaceView {
  return {
    id: SPACE_WORKSPACE,
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

function deps(overrides: Partial<SpaceProjectionTransportDeps> = {}): SpaceProjectionTransportDeps {
  return {
    authenticate: async () => ({ actorId: 'actor-a' }),
    workspaceView: async () => view(space()),
    readSourceProjection: async () => ({
      ok: true,
      grantId: 'grant-budget',
      projection: { portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 50 },
      sourceDataRevision: 7,
      grantVersion: 1,
      readAt: 5_000,
    }),
    ...overrides,
  };
}

function request(query: string, method = 'GET'): Request {
  return new Request(`https://tabletop.test/api/workspaces/${SPACE_WORKSPACE}/space/projection?${query}`, { method });
}

const good = `source=${SOURCE}&grant=grant-budget&port=budget&space=${SPACE_WORKSPACE}`;

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('who may ask', () => {
  it('serves a space member reading a linked source', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps());
    expect(response.status).toBe(200);
    const payload = await body(response);
    expect(payload).toMatchObject({ ok: true, grantId: 'grant-budget', sourceDataRevision: 7, grantVersion: 1 });
  });

  it('refuses an unauthenticated caller', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({ authenticate: async () => undefined }));
    expect(response.status).toBe(401);
    expect(await body(response)).toMatchObject({ code: 'SESSION_EXPIRED' });
  });

  it('refuses a signed-in person who is not a member of the space', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({ authenticate: async () => ({ actorId: 'outsider' }) }));
    expect(response.status).toBe(403);
    expect(await body(response)).toMatchObject({ code: 'SPACE_NOT_MEMBER' });
  });

  it('refuses when the destination will not serve its own view (not a member there either)', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({ workspaceView: async () => undefined }));
    expect(response.status).toBe(403);
  });

  it('refuses a workspace that holds no space', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({ workspaceView: async () => view(undefined) }));
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({ code: 'SPACE_NOT_FOUND' });
  });
});

describe('which table a space may ask about', () => {
  it('refuses a workspace the space does not reference', async () => {
    const response = await handleSpaceProjectionRead(
      request(`source=${OTHER}&grant=grant-budget&port=budget&space=${SPACE_WORKSPACE}`),
      deps(),
    );
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({ code: 'SPACE_SOURCE_NOT_LINKED' });
  });

  it('refuses a source whose link was marked left', async () => {
    const left = space({ sources: [{ workspaceId: SOURCE, epoch: 3, addedBy: 'actor-a', addedAt: 1, status: 'left' }] });
    const response = await handleSpaceProjectionRead(request(good), deps({ workspaceView: async () => view(left) }));
    expect(response.status).toBe(404);
    expect(await body(response)).toMatchObject({ code: 'SPACE_SOURCE_NOT_LINKED' });
  });

  it('rejects malformed parameters before asking anyone anything', async () => {
    const asked: string[] = [];
    const response = await handleSpaceProjectionRead(
      request(`source=not-a-uuid&grant=grant-budget&port=budget&space=${SPACE_WORKSPACE}`),
      deps({ readSourceProjection: async (_r, id) => { asked.push(id); throw new Error('must not be called'); } }),
    );
    expect(response.status).toBe(400);
    expect(asked).toEqual([]);
  });

  it('refuses a non-GET request', async () => {
    const response = await handleSpaceProjectionRead(request(good, 'POST'), deps());
    expect(response.status).toBe(405);
  });
});

describe('how the source answer is reported', () => {
  it('reports a revocation as a conflict, not as a missing resource', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({
      readSourceProjection: async () => ({ ok: false, code: 'SPACE_GRANT_REVOKED', message: 'The source revoked this connection at 4000.' }),
    }));
    expect(response.status).toBe(409);
    expect(await body(response)).toMatchObject({ ok: false, code: 'SPACE_GRANT_REVOKED' });
  });

  it('reports a stale epoch as a conflict', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({
      readSourceProjection: async () => ({ ok: false, code: 'SPACE_GRANT_STALE_EPOCH', message: 'reset' }),
    }));
    expect(response.status).toBe(409);
  });

  it('reports an unknown grant as not found', async () => {
    const response = await handleSpaceProjectionRead(request(good), deps({
      readSourceProjection: async () => ({ ok: false, code: 'SPACE_GRANT_NOT_FOUND', message: 'nope' }),
    }));
    expect(response.status).toBe(404);
  });

  it('passes the acting actor and the space identity to the source, never a caller-supplied one', async () => {
    const calls: { source: string; body: { grantId: string; spaceId: string; actorId: string; portId: string } }[] = [];
    await handleSpaceProjectionRead(request(good), deps({
      readSourceProjection: async (_request, source, body) => {
        calls.push({ source, body });
        return { ok: false, code: 'SPACE_GRANT_NOT_FOUND', message: 'stop' };
      },
    }));
    expect(calls[0]?.source).toBe(SOURCE);
    // The actor comes from the session and the space id from the stored space, not from the query.
    expect(calls[0]?.body).toEqual({ grantId: 'grant-budget', spaceId: 'activity-room', actorId: 'actor-a', portId: 'budget' });
  });
});
