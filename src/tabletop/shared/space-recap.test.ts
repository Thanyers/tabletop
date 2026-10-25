import { describe, expect, it } from 'vitest';
import type { CollaborationSpace } from './collaboration-space';
import type { ToolProjectionGrant } from './tool-connection';
import { buildSpaceRecap } from './space-recap';

/** F080 / JT-4A: a recap may only say what the room actually holds. */

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

function grant(workspaceId: string, overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: `grant-${workspaceId.slice(0, 4)}`,
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: workspaceId,
    sourceEpoch: 2,
    sourceDataRevision: 4,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'plan', resource: 'rooms', fields: ['name'], maxRows: 10 }],
    actions: [],
    exportAllowed: false,
    ...overrides,
  };
}

describe('a recap reports what the room holds', () => {
  it('says the data matches when every source answers at the granted revision', () => {
    const recap = buildSpaceRecap({
      space: space(),
      grants: [{ grant: grant(A), liveDataRevision: 4 }, { grant: grant(B), liveDataRevision: 4 }],
    });
    expect(recap.revision).toBe(7);
    expect(recap.current).toHaveLength(2);
    expect(recap.changed).toEqual([]);
    expect(recap.withdrawn).toEqual([]);
    expect(recap.incomplete).toBe(false);
    expect(recap.headline).toBe('ข้อมูลตรงกับที่เชื่อมไว้');
  });

  it('names the sources that moved and by how much', () => {
    const recap = buildSpaceRecap({
      space: space(),
      grants: [{ grant: grant(A), liveDataRevision: 9 }, { grant: grant(B), liveDataRevision: 4 }],
    });
    expect(recap.changed).toEqual([{ workspaceId: A, grantId: 'grant-2222', from: 4, to: 9 }]);
    expect(recap.headline).toContain('1 แหล่ง');
  });

  it('counts a withdrawn connection separately from a change', () => {
    const recap = buildSpaceRecap({
      space: space(),
      grants: [{ grant: grant(A, { status: 'revoked' }), liveDataRevision: 4 }, { grant: grant(B), liveDataRevision: 4 }],
    });
    expect(recap.withdrawn).toHaveLength(1);
    expect(recap.current).toHaveLength(1);
    expect(recap.headline).toContain('ถูกถอน');
  });

  it('marks itself incomplete rather than guessing when a source could not be read', () => {
    const recap = buildSpaceRecap({ space: space(), grants: [{ grant: grant(A) }] });
    expect(recap.incomplete).toBe(true);
    expect(recap.current).toEqual([]);
    expect(recap.changed).toEqual([]);
    expect(recap.headline).toContain('อ่านบางแหล่งไม่ได้');
  });

  it('does not leak rows or other rooms: the recap carries ids and counters only', () => {
    const recap = buildSpaceRecap({ space: space(), grants: [{ grant: grant(A), liveDataRevision: 4 }] });
    const text = JSON.stringify(recap);
    expect(text).not.toContain('rows');
    expect(text).not.toContain('values');
    expect(text).not.toContain('costs');
  });

  it('says there is nothing yet for an empty room', () => {
    const recap = buildSpaceRecap({ space: space({ sources: [] }), grants: [] });
    expect(recap.headline).toBe('ห้องนี้ยังไม่มีแหล่งข้อมูลที่เชื่อมอยู่');
  });
});
