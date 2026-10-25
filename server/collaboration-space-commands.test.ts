import { describe, expect, it } from 'vitest';
import { SPACE_COMMANDS } from '../src/tabletop/shared/collaboration-space-command';
import { SOURCE_GRANT_COMMANDS } from '../src/tabletop/domain/tool-grant';
import { assertIdentityFieldsAbsent, commandAllowed, commandNamesItsOwnTarget } from './authority';
import { PERMISSION_LABELS } from '../src/tabletop/shared/permissions';

/**
 * F080: the space commands must be reachable through the existing command route.
 *
 * This is a wiring test, not a behaviour test: it fails if someone adds a space command and
 * forgets the authority allowlist, which would leave the feature dead with no error.
 */
describe('space commands are allowed exactly where they belong', () => {
  it('is reachable for a table workspace without a trusted operation', () => {
    for (const command of SPACE_COMMANDS) {
      expect(commandAllowed('table', command, null), command).toBe(true);
    }
  });

  it('is not reachable from another workspace kind', () => {
    for (const command of SPACE_COMMANDS) {
      expect(commandAllowed('invoice', command, null), command).toBe(false);
      expect(commandAllowed('teaching', command, null), command).toBe(false);
      expect(commandAllowed('encounter', command, null), command).toBe(false);
    }
  });

  it('treats a trusted operation as additive and never as a bypass for a non-public command', () => {
    // A trusted operation does not narrow the public surface: the same public commands stay
    // reachable, and the domain still checks the actor. What it must not do is open a command that
    // is not public at all.
    for (const command of SPACE_COMMANDS) {
      expect(commandAllowed('table', command, 'table-compute'), command).toBe(true);
      expect(commandAllowed('table', command, 'artifact-import'), command).toBe(true);
    }
    expect(commandAllowed('table', 'table.compute.queue', null)).toBe(false);
    expect(commandAllowed('table', 'table.compute.queue', 'table-compute')).toBe(true);
    expect(commandAllowed('invoice', 'table.compute.queue', 'table-compute')).toBe(false);
    expect(commandAllowed('table', 'invoice.import', 'table-compute')).toBe(false);
  });

  it('does not open the allowlist for an invented space command', () => {
    expect(commandAllowed('table', 'space.grantSourceAccess', null)).toBe(false);
    expect(commandAllowed('table', 'space.deleteEverything', null)).toBe(false);
  });
});

describe('grant commands reach the source table only', () => {
  it('is allowed for a table workspace', () => {
    for (const command of SOURCE_GRANT_COMMANDS) expect(commandAllowed('table', command, null), command).toBe(true);
  });

  it('is not allowed from another kind or through a trusted operation', () => {
    for (const command of SOURCE_GRANT_COMMANDS) {
      expect(commandAllowed('invoice', command, null), command).toBe(false);
      expect(commandAllowed('teaching', command, null), command).toBe(false);
      expect(commandAllowed('encounter', command, null), command).toBe(false);
    }
    expect(commandAllowed('table', 'source.grantToEveryone', null)).toBe(false);
  });
});

describe('the space matrix never borrows a table permission', () => {
  it('keeps the permission vocabulary unchanged', () => {
    // If a space feature ever needs a table permission, that is a product decision, not a side effect.
    expect(Object.keys(PERMISSION_LABELS)).not.toContain('space.manage');
    expect(Object.keys(PERMISSION_LABELS)).not.toContain('source.grant');
  });
});

describe('the identity-spoof guard does not swallow commands that name a target', () => {
  it('exempts exactly the commands whose payload names a target', () => {
    // These four were silently rejected before the exemption: the guard saw `actorId`/`role`/
    // `workspaceId` and refused the command before the domain could run.
    for (const command of ['space.removeMember', 'space.setRole', 'space.transferManager', 'space.leaveSource']) {
      expect(commandNamesItsOwnTarget(command), command).toBe(true);
    }
    for (const command of SOURCE_GRANT_COMMANDS) expect(commandNamesItsOwnTarget(command), command).toBe(true);
    expect(commandNamesItsOwnTarget('access.assign')).toBe(true);
    expect(commandNamesItsOwnTarget('teaching.setRepresentation')).toBe(true);
  });

  it('does not exempt ordinary commands', () => {
    for (const command of ['table.act', 'table.roll', 'canvas.layout', 'workspace.reset', 'evolve.propose']) {
      expect(commandNamesItsOwnTarget(command), command).toBe(false);
    }
  });

  it('still rejects a spoofed identity on a command that does not name a target', () => {
    expect(() => assertIdentityFieldsAbsent({ actorId: 'someone-else' })).toThrowError(/COMMAND_IDENTITY_SPOOF|identity/i);
    expect(() => assertIdentityFieldsAbsent({ epoch: 9 })).toThrowError(/COMMAND_IDENTITY_SPOOF|identity/i);
    // ... and accepts a payload that only names a target, which is what the exempt commands send.
    expect(() => assertIdentityFieldsAbsent({ member: { actorId: 'actor-b' } })).not.toThrow();
  });
});
