import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import { createTableState, handleTableCommand } from './table';
import { applySpaceCommand, createSpaceState, readSpaceFromState } from './collaboration-space';

const SHARED_TOOL_WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

const owner: ActorContext = {
  actorId: 'actor-a',
  name: 'Owner',
  role: 'owner',
  workspaceId: 'fixture',
  epoch: 1,
  now: 1_700_000_000_000,
  hash: (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'),
};

const other: ActorContext = { ...owner, actorId: 'actor-b', name: 'B', role: 'participant' };

function workspaceWithSpace() {
  const created = createSpaceState(createTableState(), {
    spaceId: 'activity-room',
    title: 'ห้องวางผังกิจกรรม',
    sharedToolWorkspaceId: SHARED_TOOL_WORKSPACE,
    actor: owner,
    now: 1_700_000_000_000,
  });
  if (!created.ok) throw new Error('fixture space was not created');
  return created.state;
}

describe('a workspace without a space still reads cleanly', () => {
  it('treats an absent field as no space, not as broken state', () => {
    const state = createTableState();
    expect(readSpaceFromState(state)).toEqual({ space: undefined, problems: [] });
    expect(state.collaborationSpace).toBeUndefined();
  });

  it('refuses a space command on a workspace that has none', () => {
    expect(applySpaceCommand({ state: createTableState(), actor: owner, now: 1 }, { type: 'space.rename', title: 'x' })).toMatchObject({
      ok: false,
      code: 'SPACE_NOT_FOUND',
    });
  });
});

describe('creating a space is additive and keeps the workspace intact', () => {
  it('makes the actor the only manager and bumps the action revision', () => {
    const before = createTableState();
    const created = createSpaceState(before, {
      spaceId: 'activity-room',
      title: '  ห้องวางผังกิจกรรม  ',
      sharedToolWorkspaceId: SHARED_TOOL_WORKSPACE,
      actor: owner,
      now: 1_700_000_000_000,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.space.title).toBe('ห้องวางผังกิจกรรม');
    expect(created.space.managerActorId).toBe('actor-a');
    expect(created.space.members).toEqual([{ actorId: 'actor-a', name: 'Owner', role: 'manager', joinedAt: 1_700_000_000_000 }]);
    expect(created.state.actionRevision).toBe(before.actionRevision + 1);
    expect(created.state.activity.at(-1)?.action).toBe('space.create');
    // The workspace itself is untouched apart from the two additions.
    expect(created.state.program).toBe(before.program);
    expect(created.state.records).toEqual(before.records);
  });

  it('refuses a second space on the same workspace', () => {
    const state = workspaceWithSpace();
    expect(createSpaceState(state, { spaceId: 'other-space', title: 'x', sharedToolWorkspaceId: SHARED_TOOL_WORKSPACE, actor: owner, now: 2 })).toMatchObject({
      ok: false,
      code: 'SPACE_EXISTS',
    });
  });
});

describe('space commands go through the matrix and never touch sources by accident', () => {
  it('lets the manager add a member and leaves the source list byte-identical', () => {
    const state = workspaceWithSpace();
    const withSource = applySpaceCommand({ state, actor: owner, now: 10 }, {
      type: 'space.addSource',
      source: { workspaceId: SOURCE, epoch: 1, addedBy: 'actor-a', addedAt: 10, status: 'linked' },
    });
    expect(withSource.ok).toBe(true);
    if (!withSource.ok) return;
    const sourcesBefore = structuredClone(withSource.space.sources);

    const added = applySpaceCommand({ state: withSource.state, actor: owner, now: 11 }, {
      type: 'space.addMember',
      member: { actorId: 'actor-b', name: 'B', role: 'participant', joinedAt: 11 },
    });
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.space.sources).toEqual(sourcesBefore);
    expect(added.space.members.map(member => member.actorId)).toEqual(['actor-a', 'actor-b']);
    const reread = readSpaceFromState(added.state);
    expect(reread.space?.members).toHaveLength(2);
    expect(reread.problems).toEqual([]);
  });

  it('refuses administrative commands from a non-manager', () => {
    const state = workspaceWithSpace();
    expect(applySpaceCommand({ state, actor: other, now: 10 }, { type: 'space.rename', title: 'x' })).toMatchObject({ ok: false, code: 'SPACE_NOT_MEMBER' });
  });

  it('marks a source left instead of dropping the history', () => {
    const state = workspaceWithSpace();
    const linked = applySpaceCommand({ state, actor: owner, now: 10 }, {
      type: 'space.addSource',
      source: { workspaceId: SOURCE, epoch: 1, addedBy: 'actor-a', addedAt: 10, status: 'linked' },
    });
    if (!linked.ok) throw new Error('link failed');
    const left = applySpaceCommand({ state: linked.state, actor: owner, now: 11 }, { type: 'space.leaveSource', workspaceId: SOURCE });
    expect(left.ok).toBe(true);
    if (!left.ok) return;
    expect(left.space.sources).toEqual([{ workspaceId: SOURCE, epoch: 1, addedBy: 'actor-a', addedAt: 10, status: 'left' }]);
  });
});

describe('stored state round-trips and tolerates a newer schema', () => {
  it('survives a JSON round trip unchanged', () => {
    const state = workspaceWithSpace();
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(readSpaceFromState(restored).space).toEqual(state.collaborationSpace);
  });

  it('reports a newer space schema without discarding the workspace', () => {
    const state = workspaceWithSpace();
    const tampered = { ...state, collaborationSpace: { ...state.collaborationSpace!, schemaVersion: 99 } } as unknown as typeof state;
    const read = readSpaceFromState(tampered);
    expect(read.space).toBeUndefined();
    expect(read.problems.join(' ')).toContain('schemaVersion');
  });
});

/** Assert the stable code a DomainError carries, not its human message. */
function throwsCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected a DomainError with code ${code}`);
}

describe('space commands travel through handleTableCommand', () => {
  const createPayload = { spaceId: 'activity-room', title: 'ห้องวางผังกิจกรรม', sharedToolWorkspaceId: SHARED_TOOL_WORKSPACE };

  it('creates the space for the owner and returns a label', () => {
    const decision = handleTableCommand(createTableState(), 'space.create', createPayload, owner);
    expect(decision).not.toBeNull();
    expect(decision?.state.collaborationSpace?.managerActorId).toBe('actor-a');
    expect(decision?.label).toContain('Space created');
  });

  it('refuses creation by a non-owner with a stable code', () => {
    throwsCode(() => handleTableCommand(createTableState(), 'space.create', createPayload, other), 'SPACE_FORBIDDEN');
  });

  it('lets the manager add a member through the same entry point', () => {
    const created = handleTableCommand(createTableState(), 'space.create', createPayload, owner);
    if (!created) throw new Error('create failed');
    const added = handleTableCommand(created.state, 'space.addMember', {
      member: { actorId: 'actor-b', name: 'B', role: 'participant', joinedAt: 5 },
    }, owner);
    expect(added?.state.collaborationSpace?.members.map(member => member.actorId)).toEqual(['actor-a', 'actor-b']);
    expect(added?.label).toContain('Member added');
  });

  it('refuses an actor who is not in the space', () => {
    const created = handleTableCommand(createTableState(), 'space.create', createPayload, owner);
    if (!created) throw new Error('create failed');
    throwsCode(() => handleTableCommand(created.state, 'space.rename', { title: 'x' }, other), 'SPACE_NOT_MEMBER');
  });

  it('refuses an administrative command from a participant who joined', () => {
    const created = handleTableCommand(createTableState(), 'space.create', createPayload, owner);
    if (!created) throw new Error('create failed');
    const added = handleTableCommand(created.state, 'space.addMember', {
      member: { actorId: 'actor-b', name: 'B', role: 'participant', joinedAt: 5 },
    }, owner);
    if (!added) throw new Error('add failed');
    throwsCode(() => handleTableCommand(added.state, 'space.rename', { title: 'x' }, other), 'SPACE_FORBIDDEN');
  });

  it('lets a participant run but not author: the matrix holds through the command path', () => {
    const created = handleTableCommand(createTableState(), 'space.create', createPayload, owner);
    if (!created) throw new Error('create failed');
    const added = handleTableCommand(created.state, 'space.addMember', {
      member: { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 5 },
    }, owner);
    if (!added) throw new Error('add failed');
    const linked = handleTableCommand(added.state, 'space.addSource', {
      source: { workspaceId: SOURCE, epoch: 1, addedBy: 'actor-b', addedAt: 6, status: 'linked' },
    }, other);
    expect(linked?.state.collaborationSpace?.sources).toHaveLength(1);
    // A maker may link, but not manage members.
    throwsCode(() => handleTableCommand(linked!.state, 'space.addMember', {
      member: { actorId: 'actor-c', name: 'C', role: 'viewer', joinedAt: 7 },
    }, other), 'SPACE_FORBIDDEN');
  });

  it('rejects a malformed payload before touching state', () => {
    throwsCode(() => handleTableCommand(createTableState(), 'space.create', { spaceId: 'activity-room' }, owner), 'SPACE_PAYLOAD');
  });

  it('leaves every other command untouched', () => {
    // The normal chain still validates its own payloads ...
    throwsCode(() => handleTableCommand(createTableState(), 'table.act', {}, owner), 'INVALID_COMMAND');
    // ... and an unknown type is still "not mine", not a space error.
    expect(handleTableCommand(createTableState(), 'totally.unknown', {}, owner)).toBeNull();
  });
});
