import { describe, expect, it } from 'vitest';
import { authorizeSpaceAction, type ToolProjectionGrant } from './tool-connection';

/**
 * F080 / C7: calling a source action through a connection.
 *
 * An action is the half of a connection that changes data, so it is authorized with the same grant
 * the read uses, plus the action allowlist. Everything here is a refusal path except one: the
 * source decides, and an action that was not granted simply cannot be called.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';
const EPOCH = 3;

function grant(overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: 'grant-budget',
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: SOURCE,
    sourceEpoch: EPOCH,
    sourceDataRevision: 7,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 25 }],
    actions: [{ actionId: 'reserve' }],
    ...overrides,
  };
}

function input(overrides: Partial<Parameters<typeof authorizeSpaceAction>[1]> = {}) {
  return {
    spaceWorkspaceId: SPACE,
    sourceEpoch: EPOCH,
    actorId: 'actor-a',
    actionId: 'reserve',
    membershipVerifiedBy: 'destination' as const,
    ...overrides,
  };
}

describe('an action is authorized by the same grant as the read', () => {
  it('allows a granted action from a member the destination vouched for', () => {
    expect(authorizeSpaceAction(grant(), input())).toEqual({ ok: true });
  });

  it('refuses an action the grant does not expose', () => {
    expect(authorizeSpaceAction(grant(), input({ actionId: 'delete-table' })))
      .toMatchObject({ ok: false, code: 'GRANT_ACTION_NOT_PERMITTED' });
  });

  it('refuses after revocation, before looking at anything else', () => {
    const revoked = grant({ status: 'revoked', revokedAt: 2_000 });
    expect(authorizeSpaceAction(revoked, input({ actionId: 'delete-table', sourceEpoch: 99, actorId: 'stranger' })))
      .toMatchObject({ ok: false, code: 'GRANT_REVOKED' });
  });

  it('refuses another workspace that reuses the slug', () => {
    expect(authorizeSpaceAction(grant(), input({ spaceWorkspaceId: '99999999-9999-4999-8999-999999999999' })))
      .toMatchObject({ ok: false, code: 'GRANT_NOT_FOUND' });
  });

  it('refuses after a source reset', () => {
    expect(authorizeSpaceAction(grant(), input({ sourceEpoch: EPOCH + 1 })))
      .toMatchObject({ ok: false, code: 'GRANT_STALE_EPOCH' });
  });

  it('refuses a caller that did not prove membership', () => {
    expect(authorizeSpaceAction(grant(), input({ membershipVerifiedBy: undefined as unknown as 'destination' })))
      .toMatchObject({ ok: false, code: 'GRANT_AUDIENCE' });
  });

  it('refuses an actor outside a named audience', () => {
    const named = grant({ audience: { kind: 'actors', actorIds: ['actor-b'] } });
    expect(authorizeSpaceAction(named, input({ actorId: 'actor-a' }))).toMatchObject({ ok: false, code: 'GRANT_AUDIENCE' });
    expect(authorizeSpaceAction(named, input({ actorId: 'actor-b' }))).toEqual({ ok: true });
  });
});
