import { describe, expect, it } from 'vitest';
import {
  COLLABORATION_SPACE_SCHEMA_VERSION,
  SPACE_ROLES,
  SPACE_ROLE_VERBS,
  SPACE_VERBS,
  decideSpace,
  readCollaborationSpace,
  spaceAllows,
  spaceMayExportData,
  spaceMayReadSource,
  spaceMembershipGrantsSourceData,
  spaceRoleOf,
  validateCollaborationSpace,
  type CollaborationSpace,
} from './collaboration-space';

const SPACE_ID = 'activity-room';
const SHARED_TOOL_WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE_A = '22222222-2222-4222-8222-222222222222';
const SOURCE_B = '33333333-3333-4333-8333-333333333333';

function makeSpace(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: COLLABORATION_SPACE_SCHEMA_VERSION,
    spaceId: SPACE_ID,
    title: 'ห้องวางผังกิจกรรม',
    sharedToolWorkspaceId: SHARED_TOOL_WORKSPACE,
    managerActorId: 'actor-a',
    members: [
      { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
      { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 2 },
      { actorId: 'actor-c', name: 'C', role: 'participant', joinedAt: 3 },
    ],
    sources: [{ workspaceId: SOURCE_B, epoch: 1, addedBy: 'actor-b', addedAt: 4, status: 'linked' }],
    revision: 5,
    epoch: 1,
    createdAt: 1,
    updatedAt: 5,
    ...overrides,
  };
}

describe('space role x verb matrix', () => {
  it('keeps the plan matrix: only the manager administers the space', () => {
    for (const role of SPACE_ROLES) expect(spaceAllows(role, 'space.view'), role).toBe(true);
    expect(spaceAllows('viewer', 'space.manageMembers')).toBe(false);
    expect(spaceAllows('participant', 'space.manageMembers')).toBe(false);
    expect(spaceAllows('maker', 'space.manageMembers')).toBe(false);
    expect(spaceAllows('manager', 'space.manageMembers')).toBe(true);
    expect(spaceAllows('manager', 'space.delete')).toBe(true);
    expect(spaceAllows('maker', 'space.delete')).toBe(false);
  });

  it('lets a participant run tools but not author or rebind them', () => {
    expect(spaceAllows('participant', 'tool.run')).toBe(true);
    expect(spaceAllows('participant', 'tool.author')).toBe(false);
    expect(spaceAllows('participant', 'tool.bind')).toBe(false);
    expect(spaceAllows('viewer', 'tool.run')).toBe(false);
    expect(spaceAllows('maker', 'tool.author')).toBe(true);
    expect(spaceAllows('maker', 'tool.bind')).toBe(true);
  });

  it('never lets a space role decide a source grant', () => {
    for (const role of SPACE_ROLES) {
      for (const verb of SPACE_VERBS) {
        expect(verb).not.toMatch(/^source\.(grant|read)/u);
      }
      expect(SPACE_ROLE_VERBS[role].length).toBeGreaterThan(0);
    }
    expect(spaceMembershipGrantsSourceData()).toBe(false);
  });
});

describe('export is a separate permission', () => {
  it('is refused even for the manager without a source permission', () => {
    expect(spaceMayExportData('manager', { granted: false, grantVersion: 1 }, 1)).toBe(false);
    expect(spaceMayExportData('maker', { granted: true, grantVersion: 2 }, 1)).toBe(false);
    expect(spaceMayExportData('maker', { granted: true, grantVersion: 1 }, 1)).toBe(true);
  });
});

describe('membership is not a data grant', () => {
  it('requires the source grant as well as membership', () => {
    const space = makeSpace();
    expect(spaceMayReadSource(space, 'actor-b', { workspaceId: SOURCE_B, sourceGrantActive: true, actorGranted: true })).toBe(true);
    expect(spaceMayReadSource(space, 'actor-b', { workspaceId: SOURCE_B, sourceGrantActive: true, actorGranted: false })).toBe(false);
    expect(spaceMayReadSource(space, 'actor-b', { workspaceId: SOURCE_A, sourceGrantActive: true, actorGranted: true })).toBe(false);
    expect(spaceMayReadSource(space, 'outsider', { workspaceId: SOURCE_B, sourceGrantActive: true, actorGranted: true })).toBe(false);
    expect(spaceMayReadSource(space, 'actor-b', { workspaceId: SOURCE_B, sourceGrantActive: false, actorGranted: true })).toBe(false);
  });

  it('stops reading after the source link is marked left', () => {
    const space = makeSpace({ sources: [{ workspaceId: SOURCE_B, epoch: 1, addedBy: 'actor-b', addedAt: 4, status: 'left' }] });
    expect(spaceMayReadSource(space, 'actor-b', { workspaceId: SOURCE_B, sourceGrantActive: true, actorGranted: true })).toBe(false);
  });
});

describe('space validation', () => {
  it('accepts a well-formed space', () => {
    const result = validateCollaborationSpace(makeSpace());
    expect(result.ok).toBe(true);
  });

  it('requires exactly the declared manager among the members', () => {
    const noManager = makeSpace({ members: [{ actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 1 }] });
    expect(validateCollaborationSpace(noManager).ok).toBe(false);
    const twoManagers = makeSpace({
      members: [
        { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
        { actorId: 'actor-b', name: 'B', role: 'manager', joinedAt: 2 },
      ],
    });
    expect(validateCollaborationSpace(twoManagers).ok).toBe(false);
  });

  it('rejects duplicate members and duplicate sources', () => {
    const duplicated = makeSpace({
      members: [
        { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
        { actorId: 'actor-a', name: 'A again', role: 'viewer', joinedAt: 2 },
      ],
    });
    expect(validateCollaborationSpace(duplicated).ok).toBe(false);
    const sameSourceTwice = makeSpace({
      sources: [
        { workspaceId: SOURCE_B, epoch: 1, addedBy: 'actor-b', addedAt: 4, status: 'linked' },
        { workspaceId: SOURCE_B, epoch: 1, addedBy: 'actor-b', addedAt: 5, status: 'linked' },
      ],
    });
    expect(validateCollaborationSpace(sameSourceTwice).ok).toBe(false);
  });

  it('refuses to treat the shared-tool workspace as a source', () => {
    const selfSource = makeSpace({
      sources: [{ workspaceId: SHARED_TOOL_WORKSPACE, epoch: 1, addedBy: 'actor-b', addedAt: 4, status: 'linked' }],
    });
    expect(validateCollaborationSpace(selfSource).ok).toBe(false);
  });

  it('rejects unknown fields instead of storing them', () => {
    expect(validateCollaborationSpace({ ...makeSpace(), hiddenPolicy: 'trust-me' }).ok).toBe(false);
  });
});

describe('space commands keep source links unchanged when membership changes', () => {
  it('adds a member without touching the sources', () => {
    const space = makeSpace();
    const decision = decideSpace(space, 'actor-a', { type: 'space.addMember', member: { actorId: 'actor-d', name: 'D', role: 'viewer', joinedAt: 9 } }, 10);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.space.members.map(member => member.actorId)).toContain('actor-d');
    expect(decision.space.sources).toEqual(space.sources);
    expect(decision.space.revision).toBe(space.revision + 1);
  });

  it('changes a role without granting a source', () => {
    const space = makeSpace();
    const decision = decideSpace(space, 'actor-a', { type: 'space.setRole', actorId: 'actor-c', role: 'maker' }, 10);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(spaceRoleOf(decision.space, 'actor-c')).toBe('maker');
    expect(decision.space.sources).toEqual(space.sources);
  });

  it('refuses a second manager and requires transfer instead', () => {
    const space = makeSpace();
    const addManager = decideSpace(space, 'actor-a', { type: 'space.addMember', member: { actorId: 'actor-e', name: 'E', role: 'manager', joinedAt: 9 } }, 10);
    expect(addManager).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
    const promote = decideSpace(space, 'actor-a', { type: 'space.setRole', actorId: 'actor-c', role: 'manager' }, 10);
    expect(promote).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
  });

  it('transfers management and demotes the previous manager to maker', () => {
    const space = makeSpace();
    const decision = decideSpace(space, 'actor-a', { type: 'space.transferManager', actorId: 'actor-b' }, 10);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.space.managerActorId).toBe('actor-b');
    expect(spaceRoleOf(decision.space, 'actor-b')).toBe('manager');
    expect(spaceRoleOf(decision.space, 'actor-a')).toBe('maker');
    expect(decision.space.sources).toEqual(space.sources);
  });

  it('refuses every administrative command from a non-member or a maker', () => {
    const space = makeSpace();
    expect(decideSpace(space, 'outsider', { type: 'space.rename', title: 'x' }, 10)).toMatchObject({ ok: false, code: 'SPACE_NOT_MEMBER' });
    expect(decideSpace(space, 'actor-b', { type: 'space.rename', title: 'x' }, 10)).toMatchObject({ ok: false, code: 'SPACE_FORBIDDEN' });
    expect(decideSpace(space, 'actor-b', { type: 'space.addMember', member: { actorId: 'actor-z', name: 'Z', role: 'viewer', joinedAt: 9 } }, 10)).toMatchObject({ ok: false, code: 'SPACE_FORBIDDEN' });
    expect(decideSpace(space, 'actor-c', { type: 'space.addSource', source: { workspaceId: SOURCE_A, epoch: 1, addedBy: '', addedAt: 0, status: 'linked' } }, 10)).toMatchObject({ ok: false, code: 'SPACE_FORBIDDEN' });
  });

  it('marks a source left instead of deleting the history', () => {
    const space = makeSpace();
    const decision = decideSpace(space, 'actor-a', { type: 'space.leaveSource', workspaceId: SOURCE_B }, 10);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.space.sources).toHaveLength(1);
    expect(decision.space.sources[0]?.status).toBe('left');
  });

  it('never mutates the input space', () => {
    const space = makeSpace();
    const before = structuredClone(space);
    decideSpace(space, 'actor-a', { type: 'space.rename', title: 'ใหม่' }, 10);
    expect(space).toEqual(before);
  });
});

describe('space reader compatibility', () => {
  it('treats a workspace that never had a space as empty, not broken', () => {
    expect(readCollaborationSpace(undefined)).toEqual({ space: undefined, problems: [] });
  });

  it('refuses a newer schema instead of guessing', () => {
    const result = readCollaborationSpace({ ...makeSpace(), schemaVersion: 2 });
    expect(result.space).toBeUndefined();
    expect(result.problems[0]?.path).toBe('schemaVersion');
  });

  it('keeps readable entries and reports the ones it skipped', () => {
    const stored = { ...makeSpace(), members: [makeSpace().members[0], { actorId: 'broken' }] };
    const result = readCollaborationSpace(stored);
    expect(result.problems.some(problem => problem.path === 'members.1')).toBe(true);
    expect(result.space?.members).toHaveLength(1);
  });
});

describe('installing the room tool (D-036)', () => {
  const hash = 'a'.repeat(64);
  const install = (overrides: Record<string, unknown> = {}) => ({
    type: 'space.installTool' as const,
    tool: { packageId: 'room-planner', version: 1, contentHash: hash, route: 'human' as const, title: 'Room planner', ...overrides },
  });

  it('lets a maker install a version and records who and when', () => {
    const space = makeSpace();
    const decision = decideSpace(space, 'actor-b', install(), 42);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.space.tool).toEqual({
      packageId: 'room-planner',
      version: 1,
      contentHash: hash,
      route: 'human',
      title: 'Room planner',
      installedBy: 'actor-b',
      installedAt: 42,
    });
    expect(decision.space.revision).toBe(space.revision + 1);
    // Installing a tool does not touch the sources or their grants.
    expect(decision.space.sources).toEqual(space.sources);
  });

  it('refuses a participant, an outsider and a payload without the version hash', () => {
    const space = makeSpace();
    expect(decideSpace(space, 'actor-c', install(), 10)).toMatchObject({ ok: false, code: 'SPACE_FORBIDDEN' });
    expect(decideSpace(space, 'outsider', install(), 10)).toMatchObject({ ok: false, code: 'SPACE_NOT_MEMBER' });
    expect(decideSpace(space, 'actor-b', install({ contentHash: 'nope' }), 10)).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
    expect(decideSpace(space, 'actor-b', install({ version: 0 }), 10)).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
    expect(decideSpace(space, 'actor-b', install({ packageId: 'Bad Id' }), 10)).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
  });

  it('allows a new version of the same package and refuses swapping the package silently', () => {
    const installed = decideSpace(makeSpace(), 'actor-b', install(), 10);
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;

    const upgraded = decideSpace(installed.space, 'actor-b', install({ version: 2, contentHash: 'b'.repeat(64) }), 20);
    expect(upgraded.ok).toBe(true);
    if (!upgraded.ok) return;
    expect(upgraded.space.tool?.version).toBe(2);

    const swapped = decideSpace(installed.space, 'actor-b', install({ packageId: 'other-tool' }), 20);
    expect(swapped).toMatchObject({ ok: false, code: 'SPACE_INVALID' });
  });

  it('removes the tool on request and is a no-op for a room without one', () => {
    const installed = decideSpace(makeSpace(), 'actor-b', install(), 10);
    if (!installed.ok) throw new Error('install should succeed');
    const removed = decideSpace(installed.space, 'actor-b', { type: 'space.uninstallTool' }, 30);
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;
    expect(removed.space.tool).toBeUndefined();

    const empty = decideSpace(makeSpace(), 'actor-b', { type: 'space.uninstallTool' }, 30);
    expect(empty.ok).toBe(true);
    if (!empty.ok) return;
    expect(empty.space.tool).toBeUndefined();
  });

  it('keeps validating rooms that were written before the field existed', () => {
    const result = readCollaborationSpace(makeSpace());
    expect(result.problems).toEqual([]);
    expect(result.space?.tool).toBeUndefined();
  });
});
