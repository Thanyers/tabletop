import { describe, expect, it } from 'vitest';
import type { ToolProjectionGrant } from './tool-connection';
import { resolveSpaceProjectionRead, type SpaceProjectionReadInput } from './space-projection-read';

const SOURCE = '22222222-2222-4222-8222-222222222222';
const EPOCH = 3;

function grant(overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: 'grant-budget',
    spaceId: 'activity-room',
    spaceWorkspaceId: '11111111-1111-4111-8111-111111111111',
    sourceWorkspaceId: SOURCE,
    sourceEpoch: EPOCH,
    sourceDataRevision: 7,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 50 }],
    actions: [],
    ...overrides,
  };
}

const SPACE_WORKSPACE = '11111111-1111-4111-8111-111111111111';

function input(overrides: Partial<SpaceProjectionReadInput> = {}): SpaceProjectionReadInput {
  return {
    grants: [grant()],
    grantId: 'grant-budget',
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE_WORKSPACE,
    sourceWorkspaceId: SOURCE,
    sourceEpoch: EPOCH,
    actorId: 'actor-a',
    portId: 'budget',
    membership: { verifiedBy: 'destination' as const, actorId: 'actor-a' },
    now: 2_000,
    ...overrides,
  };
}

describe('a space projection read is decided in one place', () => {
  it('serves a live grant to a member the destination vouched for', () => {
    const result = resolveSpaceProjectionRead(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.fields).toEqual(['room', 'price']);
    expect(result.sourceDataRevision).toBe(7);
    expect(result.grantVersion).toBe(1);
  });

  it('refuses when the destination did not vouch for this actor', () => {
    expect(resolveSpaceProjectionRead(input({ membership: { verifiedBy: 'destination', actorId: 'actor-z' } })))
      .toMatchObject({ ok: false, code: 'SPACE_GRANT_AUDIENCE' });
    expect(resolveSpaceProjectionRead(input({ membership: undefined })))
      .toMatchObject({ ok: false, code: 'SPACE_GRANT_AUDIENCE' });
  });

  it('refuses a grant issued to another workspace, and one for another source', () => {
    // Impersonation: knowing the space slug and the source id is not enough, because the grant
    // names the workspace the source authorized.
    expect(resolveSpaceProjectionRead(input({ spaceWorkspaceId: '99999999-9999-4999-8999-999999999999' })))
      .toMatchObject({ ok: false, code: 'SPACE_GRANT_NOT_FOUND' });
    expect(resolveSpaceProjectionRead(input({ sourceWorkspaceId: '33333333-3333-4333-8333-333333333333' })))
      .toMatchObject({ ok: false, code: 'SPACE_GRANT_NOT_FOUND' });
  });

  it('still serves a renamed space, because the slug is not the identity', () => {
    // Renaming a room must not sever access; the workspace id is what the source authorized.
    expect(resolveSpaceProjectionRead(input({ spaceId: 'renamed-room' })).ok).toBe(true);
  });

  it('refuses after revocation, at the effective point', () => {
    const revoked = [grant({ status: 'revoked', revokedAt: 1_500 })];
    expect(resolveSpaceProjectionRead(input({ grants: revoked, now: 1_400 }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_REVOKED' });
    expect(resolveSpaceProjectionRead(input({ grants: revoked, now: 1_500 }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_REVOKED' });
  });

  it('refuses a source reset even when the grant was never revoked', () => {
    expect(resolveSpaceProjectionRead(input({ sourceEpoch: EPOCH + 1 }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_STALE_EPOCH' });
  });

  it('refuses a port the grant does not expose', () => {
    expect(resolveSpaceProjectionRead(input({ portId: 'plan' }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_PORT' });
  });

  it('reports the exact revision the caller must quote back, so freshness is checkable', () => {
    const result = resolveSpaceProjectionRead(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The read carries the source revision and the grant version: a caller that caches must quote both.
    expect(result.readAt).toBe(2_000);
    expect(result.grantVersion).toBe(1);
  });
});
