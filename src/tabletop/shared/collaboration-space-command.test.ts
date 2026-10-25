import { describe, expect, it } from 'vitest';
import { SPACE_COMMANDS, isSpaceCommand, parseSpaceCommand } from './collaboration-space-command';

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
  it.todo('is in the closed command vocabulary');
  it.todo('parses a revision and nothing else');
  it.todo('rejects a negative, fractional or missing revision');
  it.todo('bumps the space revision like every other space command');
  it.todo('records the calling actor only — a member cannot mark last-seen for someone else');
  it.todo('keeps the previous value when the same actor asks for an older revision');
});
