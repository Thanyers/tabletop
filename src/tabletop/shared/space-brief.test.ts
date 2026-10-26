import { describe, expect, it } from 'vitest';
import type { CollaborationSpace } from './collaboration-space';
import type { ToolProjectionGrant } from './tool-connection';
import { aiContextFor } from './space-brief';

/** F080 / CTX-01: the room can say what an AI request would carry, and what it leaves out. */

const SPACE = '11111111-1111-4111-8111-111111111111';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';
const C = '44444444-4444-4444-8444-444444444444';

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
      { workspaceId: C, epoch: 1, addedBy: 'actor-a', addedAt: 1, status: 'left' },
    ] as CollaborationSpace['sources'],
    revision: 4,
    epoch: 1,
    createdAt: 1,
    updatedAt: 4,
    ...overrides,
  } as CollaborationSpace;
}

function grant(workspaceId: string, overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: `grant-${workspaceId.slice(0, 4)}`,
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: workspaceId,
    sourceEpoch: 1,
    sourceDataRevision: 6,
    grantedBy: 'actor-b',
    issuedAt: 1,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'plan', resource: 'rooms', fields: ['name'], maxRows: 5 }],
    actions: [],
    exportAllowed: false,
    ...overrides,
  };
}

describe('an AI context report names what goes and what stays', () => {
  it('works without a brief and says so', () => {
    const report = aiContextFor({ space: space(), grants: [grant(A), grant(B)] });
    expect(report.briefAbsent).toBe(true);
    expect(report.summary).toContain('ยังไม่มี brief');
    expect(report.included.every(entry => entry.kind === 'source')).toBe(true);
    expect(report.included).toHaveLength(2);
  });

  it('includes the brief when the room has one', () => {
    const report = aiContextFor({
      space: space(),
      brief: { text: '  จัดผังห้องให้ผู้จัดกิจกรรมได้ลงทะเบียน ', updatedBy: 'actor-a', updatedAt: 9 },
      grants: [grant(A)],
    });
    const brief = report.included.find(entry => entry.kind === 'brief');
    expect(brief?.label).toBe('จัดผังห้องให้ผู้จัดกิจกรรมได้ลงทะเบียน');
    expect(report.briefAbsent).toBe(false);
  });

  it('omits a source that was unlinked, and one that has no grant', () => {
    const report = aiContextFor({ space: space(), grants: [grant(A)] });
    // B is linked but has no grant here; C was unlinked.
    expect(report.included.filter(entry => entry.kind === 'source')).toHaveLength(1);
    expect(report.omitted.filter(entry => entry.reason === 'not-connected')).toHaveLength(2);
  });

  it('omits a withdrawn connection and says why', () => {
    const report = aiContextFor({ space: space(), grants: [grant(A), grant(B, { status: 'revoked' })] });
    expect(report.omitted.some(entry => entry.reason === 'withdrawn')).toBe(true);
  });

  it('never claims to send chat, the member list or another room', () => {
    const report = aiContextFor({ space: space(), grants: [grant(A)], brief: { text: 'x', updatedBy: 'a', updatedAt: 1 } });
    const text = JSON.stringify(report);
    expect(text).not.toContain('"chat":');
    expect(text).not.toContain('members');
    for (const what of ['chat and notes', 'member list', 'other rooms']) {
      expect(report.omitted.some(entry => entry.what === what)).toBe(true);
    }
  });

  it('carries the revision of each source it would send', () => {
    const report = aiContextFor({ space: space(), grants: [grant(A, { sourceDataRevision: 42 })] });
    const source = report.included.find(entry => entry.kind === 'source');
    expect(source?.dataRevision).toBe(42);
  });
});
