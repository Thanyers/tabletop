import { describe, expect, it } from 'vitest';
import { SPACE_COMMANDS, isSpaceCommand, parseSpaceCommand } from './collaboration-space-command';
import { COLLABORATION_SPACE_SCHEMA_VERSION, decideSpace, type CollaborationSpace } from './collaboration-space';

const WORKSPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

describe('space command vocabulary is closed', () => {
  it('recognises exactly the declared commands', () => {
    for (const command of SPACE_COMMANDS) expect(isSpaceCommand(command)).toBe(true);
    expect(isSpaceCommand('space.deleteEverything')).toBe(false);
    expect(isSpaceCommand('table.act')).toBe(false);
  });
});

describe('payloads are parsed at the boundary', () => {
  it('parses create with a uuid workspace and a title', () => {
    expect(parseSpaceCommand('space.create', { spaceId: 'activity-room', title: 'ห้อง', sharedToolWorkspaceId: WORKSPACE })).toEqual({
      ok: true,
      type: 'space.create',
      spaceId: 'activity-room',
      title: 'ห้อง',
      sharedToolWorkspaceId: WORKSPACE,
    });
  });

  it('refuses a create whose workspace id is not a uuid', () => {
    expect(parseSpaceCommand('space.create', { spaceId: 'activity-room', title: 'ห้อง', sharedToolWorkspaceId: 'not-a-uuid' })).toMatchObject({
      ok: false,
      code: 'SPACE_PAYLOAD',
    });
  });

  it('refuses extra keys instead of ignoring them', () => {
    expect(parseSpaceCommand('space.rename', { title: 'ห้อง', promoteToManager: 'actor-z' })).toMatchObject({ ok: false, code: 'SPACE_PAYLOAD' });
  });

  it('refuses a role that is not in the matrix', () => {
    expect(parseSpaceCommand('space.setRole', { actorId: 'actor-b', role: 'superuser' })).toMatchObject({ ok: false, code: 'SPACE_PAYLOAD' });
    expect(parseSpaceCommand('space.setRole', { actorId: 'actor-b', role: 'maker' })).toMatchObject({ ok: true, role: 'maker' });
  });

  it('accepts an added member only in the linked state', () => {
    const base = { workspaceId: SOURCE, epoch: 1, addedBy: 'actor-a', addedAt: 5 };
    expect(parseSpaceCommand('space.addSource', { source: { ...base, status: 'linked' } }).ok).toBe(true);
    expect(parseSpaceCommand('space.addSource', { source: { ...base, status: 'revoked' } })).toMatchObject({ ok: false, code: 'SPACE_PAYLOAD' });
  });

  it('reports an unknown command rather than treating it as a no-op', () => {
    expect(parseSpaceCommand('space.inviteEveryone', {})).toMatchObject({ ok: false, code: 'SPACE_PAYLOAD' });
  });

  it('parses the simple member commands', () => {
    expect(parseSpaceCommand('space.removeMember', { actorId: 'actor-b' })).toEqual({ ok: true, type: 'space.removeMember', actorId: 'actor-b' });
    expect(parseSpaceCommand('space.transferManager', { actorId: 'actor-b' })).toEqual({ ok: true, type: 'space.transferManager', actorId: 'actor-b' });
    expect(parseSpaceCommand('space.leaveSource', { workspaceId: SOURCE })).toEqual({ ok: true, type: 'space.leaveSource', workspaceId: SOURCE });
  });
});

/**
 * The contract for storing last-seen (decision D-021), written before the chain exists so the
 * behaviour is agreed instead of improvised. These are `todo` on purpose: a skipped test is honest,
 * a passing test that asserts nothing is not.
 */
describe('space.seen records how far a member has read', () => {
  const space = (overrides: Partial<CollaborationSpace> = {}): CollaborationSpace => ({
    schemaVersion: COLLABORATION_SPACE_SCHEMA_VERSION,
    spaceId: 'activity-room',
    title: 'ห้อง',
    sharedToolWorkspaceId: '99999999-9999-4999-8999-999999999999',
    managerActorId: 'actor-a',
    members: [
      { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
      { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 2 },
    ],
    sources: [],
    revision: 7,
    epoch: 1,
    createdAt: 1,
    updatedAt: 7,
    ...overrides,
  });

  it('is in the closed command vocabulary', () => {
    expect(SPACE_COMMANDS).toContain('space.seen');
    expect(isSpaceCommand('space.seen')).toBe(true);
  });

  it('parses a revision and nothing else', () => {
    expect(parseSpaceCommand('space.seen', { revision: 5 })).toEqual({ ok: true, type: 'space.seen', revision: 5 });
    expect(parseSpaceCommand('space.seen', { revision: 5, extra: true }).ok).toBe(false);
  });

  it('rejects a negative, fractional or missing revision', () => {
    expect(parseSpaceCommand('space.seen', { revision: -1 }).ok).toBe(false);
    expect(parseSpaceCommand('space.seen', { revision: 1.5 }).ok).toBe(false);
    expect(parseSpaceCommand('space.seen', {}).ok).toBe(false);
  });

  it('records the calling actor and bumps the space revision', () => {
    const decision = decideSpace(space(), 'actor-b', { type: 'space.seen', revision: 5 }, 100);
    expect(decision.ok).toBe(true);
    if (!decision.ok) return;
    expect(decision.space.seen).toEqual({ 'actor-b': 5 });
    expect(decision.space.revision).toBe(8);
    // A member cannot record a position for someone else.
    expect(decision.space.seen).not.toHaveProperty('actor-a');
  });

  it('never moves a reading position backwards', () => {
    const earlier = decideSpace(space({ seen: { 'actor-b': 6 } }), 'actor-b', { type: 'space.seen', revision: 3 }, 100);
    expect(earlier.ok).toBe(true);
    if (!earlier.ok) return;
    expect(earlier.space.seen).toEqual({ 'actor-b': 6 });
  });
});
