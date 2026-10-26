import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceView } from '../shared/contracts';
import { createSpaceRoomDeps } from './space-room-deps';

/**
 * F080 / JT-V: the adapter is the one place the real transport meets the room screen.
 *
 * These tests pin the two mistakes this layer can make: asking the wrong URL, and inventing a
 * connection instead of using what the source reported.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

function viewWithSpace(): WorkspaceView {
  return {
    id: SPACE,
    title: 'ห้องวางผังกิจกรรม',
    kind: 'table',
    epoch: 1,
    revision: 'rev-1',
    actor: { actorId: 'actor-a', name: 'A', role: 'owner' },
    members: [],
    domain: {
      kind: 'table',
      collaborationSpace: {
        schemaVersion: 1,
        spaceId: 'activity-room',
        title: 'ห้อง',
        sharedToolWorkspaceId: SPACE,
        managerActorId: 'actor-a',
        members: [{ actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 }],
        sources: [{ workspaceId: SOURCE, epoch: 1, addedBy: 'actor-a', addedAt: 1, status: 'linked' }],
        revision: 4,
        epoch: 1,
        createdAt: 1,
        updatedAt: 4,
      },
    },
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
  } as unknown as WorkspaceView;
}

function recapResponse() {
  return {
    ok: true,
    recap: {
      headline: 'มี 1 แหล่งที่ข้อมูลเปลี่ยนไปหลังเชื่อม',
      incomplete: false,
      changed: [{ workspaceId: SOURCE, grantId: 'grant-budget', from: 4, to: 9 }],
      withdrawn: [],
      members: [{ actorId: 'actor-a', unseen: true }],
    },
    connections: [{ workspaceId: SOURCE, grantId: 'grant-budget', ports: ['budget'] }],
  };
}

describe('the room adapter', () => {
  it('loads the space from the workspace domain', async () => {
    const deps = createSpaceRoomDeps({ loadWorkspace: async () => viewWithSpace(), actorId: 'actor-a', viewerLabel: 'คุณกานต์' });
    const space = await deps.loadSpace(SPACE);
    expect(space?.title).toBe('ห้องวางผังกิจกรรม');
    expect(space?.space.sources).toHaveLength(1);
  });

  it('turns a load failure into nothing, not an exception', async () => {
    const deps = createSpaceRoomDeps({
      loadWorkspace: async () => { throw new Error('403'); },
      actorId: 'actor-a',
      viewerLabel: 'A',
    });
    expect(await deps.loadSpace(SPACE)).toBeUndefined();
  });

  it('asks the recap route with credentials and reuses the answer for connections', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), ...(init ? { init } : {}) });
      return new Response(JSON.stringify(recapResponse()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const deps = createSpaceRoomDeps({ loadWorkspace: async () => viewWithSpace(), actorId: 'actor-a', viewerLabel: 'A', fetchImpl });

    const recap = await deps.loadRecap(SPACE);
    const connections = await deps.loadConnections(SPACE);

    expect(recap?.headline).toContain('1 แหล่ง');
    expect(connections).toEqual([{ workspaceId: SOURCE, grantId: 'grant-budget', ports: ['budget'] }]);
    // One request, not two: the second call reuses the first answer.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`/api/workspaces/${SPACE}/space/recap`);
    expect(calls[0]?.init?.credentials).toBe('include');
  });

  it('reports no connections when the room is not readable, instead of guessing one', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 403 })) as unknown as typeof fetch;
    const deps = createSpaceRoomDeps({ loadWorkspace: async () => viewWithSpace(), actorId: 'actor-a', viewerLabel: 'A', fetchImpl });
    expect(await deps.loadConnections(SPACE)).toEqual([]);
    expect(await deps.loadRecap(SPACE)).toBeUndefined();
  });

  it('keeps the viewer label a display string rather than an identity', async () => {
    const deps = createSpaceRoomDeps({ loadWorkspace: async () => viewWithSpace(), actorId: 'actor-a', viewerLabel: 'คุณกานต์' });
    expect(deps.viewerLabel(deps.actorId)).toBe('คุณกานต์');
  });
});
