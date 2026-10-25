import { describe, expect, it } from 'vitest';
import {
  CONNECTION_STATUSES,
  TOOL_CONNECTION_PROTOCOL,
  adjudicateInFlight,
  authorizeProjectionRead,
  connectionIsTerminal,
  connectionTransition,
  effectiveRevocationAt,
  grantIsLive,
  projectionUsableAt,
  type ToolProjectionGrant,
} from './tool-connection';

const SOURCE_EPOCH = 3;
const SOURCE_WORKSPACE = '22222222-2222-4222-8222-222222222222';

function grant(overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: 'grant-1',
    spaceId: 'activity-room',
    spaceWorkspaceId: '11111111-1111-4111-8111-111111111111',
    sourceWorkspaceId: SOURCE_WORKSPACE,
    sourceEpoch: SOURCE_EPOCH,
    sourceDataRevision: 7,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [
      { portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 50 },
    ],
    actions: [{ actionId: 'reserve' }],
    ...overrides,
  };
}

describe('the protocol note is one machine-readable copy', () => {
  it('states the boundaries the plan requires and no global snapshot', () => {
    expect(TOOL_CONNECTION_PROTOCOL.atomicity).toContain('ไม่มี distributed atomicity');
    expect(TOOL_CONNECTION_PROTOCOL.commitment).toContain('หนึ่ง target authority');
    expect(TOOL_CONNECTION_PROTOCOL.inFlight).toContain('ปฏิเสธ');
    expect(TOOL_CONNECTION_PROTOCOL.recovery).toContain('rebind');
    expect(TOOL_CONNECTION_PROTOCOL.freshness).toContain('ไม่มี global snapshot');
  });
});

describe('a read is authorized per port, per audience, at the live epoch', () => {
  it('allows a space member through a granted port', () => {
    const verdict = authorizeProjectionRead(grant(), { sourceEpoch: SOURCE_EPOCH, actorId: 'actor-a', portId: 'budget', membershipVerifiedBy: 'destination' as const });
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.projection.fields).toEqual(['room', 'price']);
  });

  it('refuses a port the grant does not expose', () => {
    const verdict = authorizeProjectionRead(grant(), { sourceEpoch: SOURCE_EPOCH, actorId: 'actor-a', portId: 'plan', membershipVerifiedBy: 'destination' as const });
    expect(verdict).toMatchObject({ ok: false, code: 'GRANT_FIELD_NOT_PERMITTED' });
  });

  it('refuses a non-member, and a member outside a named audience', () => {
    expect(authorizeProjectionRead(grant(), {
      sourceEpoch: SOURCE_EPOCH,
      actorId: 'actor-a',
      portId: 'budget',
      // Simulates a caller that never established membership: the read must be refused.
      membershipVerifiedBy: undefined as unknown as 'destination',
    })).toMatchObject({ ok: false, code: 'GRANT_AUDIENCE' });
    const named = grant({ audience: { kind: 'actors', actorIds: ['actor-b'] } });
    expect(authorizeProjectionRead(named, { sourceEpoch: SOURCE_EPOCH, actorId: 'actor-a', portId: 'budget', membershipVerifiedBy: 'destination' as const })).toMatchObject({ ok: false, code: 'GRANT_AUDIENCE' });
    expect(authorizeProjectionRead(named, { sourceEpoch: SOURCE_EPOCH, actorId: 'actor-b', portId: 'budget', membershipVerifiedBy: 'destination' as const }).ok).toBe(true);
  });

  it('refuses after a source reset even when the grant was never revoked', () => {
    expect(authorizeProjectionRead(grant(), { sourceEpoch: SOURCE_EPOCH + 1, actorId: 'actor-a', portId: 'budget', membershipVerifiedBy: 'destination' as const })).toMatchObject({ ok: false, code: 'GRANT_STALE_EPOCH' });
    expect(grantIsLive(grant(), SOURCE_EPOCH + 1)).toBe(false);
  });

  it('reports revoked before anything else, so a stale epoch cannot mask a revocation', () => {
    const revoked = grant({ status: 'revoked', revokedAt: 2_000, revokedBy: 'actor-b' });
    const verdict = authorizeProjectionRead(revoked, { sourceEpoch: SOURCE_EPOCH + 5, actorId: 'actor-a', portId: 'budget', membershipVerifiedBy: 'destination' as const });
    expect(verdict).toMatchObject({ ok: false, code: 'GRANT_REVOKED' });
  });
});

describe('revocation has an effective point and a cache cannot outlive it', () => {
  it('reports no revocation point while the grant is live', () => {
    expect(effectiveRevocationAt(grant())).toBeUndefined();
    expect(projectionUsableAt(grant(), 99_999)).toBe(true);
  });

  it('fails closed when the timestamp is missing', () => {
    // A stored record that lost revokedAt must not resurrect access.
    const legacy = grant({ status: 'revoked', revokedAt: undefined });
    expect(projectionUsableAt(legacy, 1)).toBe(false);
    expect(projectionUsableAt(legacy, 99_999)).toBe(false);
  });

  it('stops serving a projection from the revocation moment onwards', () => {
    const revoked = grant({ status: 'revoked', revokedAt: 2_000 });
    expect(effectiveRevocationAt(revoked)).toBe(2_000);
    expect(projectionUsableAt(revoked, 1_999)).toBe(true);
    expect(projectionUsableAt(revoked, 2_000)).toBe(false);
    expect(projectionUsableAt(revoked, 5_000)).toBe(false);
  });
});

describe('in-flight requests are adjudicated, not raced', () => {
  it('lets a request proceed while the grant is live', () => {
    expect(adjudicateInFlight(grant(), { sourceEpoch: SOURCE_EPOCH, now: 1_500 })).toEqual({ ok: true });
  });

  it('rejects a request whose grant was revoked before it committed', () => {
    const revoked = grant({ status: 'revoked', revokedAt: 2_000 });
    expect(adjudicateInFlight(revoked, { sourceEpoch: SOURCE_EPOCH, now: 2_001 })).toMatchObject({ ok: false, code: 'GRANT_REVOKED' });
  });

  it('rejects a request when the source was reset while it was in flight', () => {
    expect(adjudicateInFlight(grant(), { sourceEpoch: SOURCE_EPOCH + 1, now: 1_500 })).toMatchObject({ ok: false, code: 'GRANT_STALE_EPOCH' });
  });
});

describe('the connection lifecycle is closed', () => {
  it('only allows the declared transitions', () => {
    expect(connectionTransition('proposed', 'granted')).toBe('granted');
    expect(connectionTransition('granted', 'active')).toBe('active');
    expect(connectionTransition('active', 'revoked')).toBe('revoked');
    expect(connectionTransition('proposed', 'active')).toBeUndefined();
    expect(connectionTransition('revoked', 'active')).toBeUndefined();
    expect(connectionTransition('revoked', 'granted')).toBeUndefined();
  });

  it('treats revoked as terminal and missing as recoverable', () => {
    expect(connectionIsTerminal('revoked')).toBe(true);
    expect(connectionIsTerminal('missing')).toBe(false);
    expect(connectionTransition('missing', 'granted')).toBe('granted');
  });

  it('declares every status once', () => {
    expect(new Set(CONNECTION_STATUSES).size).toBe(CONNECTION_STATUSES.length);
    for (const status of CONNECTION_STATUSES) expect(connectionTransition(status, status)).toBeUndefined();
  });
});
