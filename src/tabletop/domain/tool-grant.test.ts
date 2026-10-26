import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { Permission } from '../shared/permissions';
import { TOOL_CONNECTION_LIMITS } from '../shared/tool-connection';
import { createTableState } from './table';
import { handleSourceGrantCommand, readGrantedProjection } from './tool-grant';

const SPACE_ID = 'activity-room';
const SOURCE_WORKSPACE = '22222222-2222-4222-8222-222222222222';

function actor(overrides: Partial<ActorContext> = {}): ActorContext {
  return {
    actorId: 'actor-b',
    name: 'B',
    role: 'owner',
    workspaceId: SOURCE_WORKSPACE,
    epoch: 3,
    now: 1_000,
    hash: (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'),
    ...overrides,
  };
}

function withPermission(permissions: Permission[], overrides: Partial<ActorContext> = {}): ActorContext {
  return { ...actor(overrides), permissions: new Set(permissions) };
}

const grantPayload = {
  grantId: 'grant-budget',
  spaceId: SPACE_ID,
  spaceWorkspaceId: '11111111-1111-4111-8111-111111111111',
  audience: { kind: 'space-members' },
  projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 50 }],
  actions: [{ actionId: 'reserve' }],
};

function grantOnce(state = createTableState(), ctx = actor()) {
  const decision = handleSourceGrantCommand(state, 'source.grantProjection', grantPayload, ctx);
  if (!decision) throw new Error('grant refused');
  return decision.state;
}

function throwsCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect((error as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`expected a DomainError with code ${code}`);
}

describe('a grant is stamped by the source, never by the client', () => {
  it('fills epoch, data revision, issuer, time and version from the live state', () => {
    const state = grantOnce();
    const grant = state.spaceGrants?.[0];
    expect(grant).toMatchObject({
      grantId: 'grant-budget',
      spaceId: SPACE_ID,
      sourceWorkspaceId: SOURCE_WORKSPACE,
      sourceEpoch: 3,
      sourceDataRevision: state.dataRevision,
      grantedBy: 'actor-b',
      issuedAt: 1_000,
      grantVersion: 1,
      status: 'granted',
    });
    expect(grant?.projections).toEqual([{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 50 }]);
  });

  it('refuses a payload that tries to supply the derived fields', () => {
    throwsCode(
      () => handleSourceGrantCommand(createTableState(), 'source.grantProjection', { ...grantPayload, sourceEpoch: 99 }, actor()),
      'SOURCE_GRANT_PAYLOAD',
    );
    throwsCode(
      () => handleSourceGrantCommand(createTableState(), 'source.grantProjection', { ...grantPayload, grantVersion: 9 }, actor()),
      'SOURCE_GRANT_PAYLOAD',
    );
  });

  it('requires sharing authority at the source', () => {
    const participant = withPermission(['table.act'], { role: 'participant' });
    throwsCode(() => handleSourceGrantCommand(createTableState(), 'source.grantProjection', grantPayload, participant), 'FORBIDDEN');
    // A member with members.invite may grant.
    const editor = withPermission(['members.invite'], { role: 'participant' });
    expect(handleSourceGrantCommand(createTableState(), 'source.grantProjection', grantPayload, editor)).not.toBeNull();
  });

  it('refuses a duplicate grant id and caps the number of live grants', () => {
    const state = grantOnce();
    throwsCode(() => handleSourceGrantCommand(state, 'source.grantProjection', grantPayload, actor()), 'SOURCE_GRANT_EXISTS');

    let many = createTableState();
    for (let index = 0; index < TOOL_CONNECTION_LIMITS.maxGrantsPerSource; index += 1) {
      const next = handleSourceGrantCommand(many, 'source.grantProjection', { ...grantPayload, grantId: `grant-${index}` }, actor());
      if (!next) throw new Error('grant refused');
      many = next.state;
    }
    throwsCode(() => handleSourceGrantCommand(many, 'source.grantProjection', { ...grantPayload, grantId: 'grant-one-too-many' }, actor()), 'SOURCE_GRANT_LIMIT');
  });
});

describe('revocation is recorded at the source and is idempotent', () => {
  it('bumps the grant version and records who and when', () => {
    const state = grantOnce();
    const decision = handleSourceGrantCommand(state, 'source.revokeProjection', { grantId: 'grant-budget' }, actor({ now: 2_000 }));
    if (!decision) throw new Error('revoke refused');
    const grant = decision.state.spaceGrants?.[0];
    expect(grant).toMatchObject({ status: 'revoked', revokedAt: 2_000, revokedBy: 'actor-b', grantVersion: 2 });
    expect(decision.label).toContain('revoked');
  });

  it('is a no-op the second time and refuses an unknown grant', () => {
    const revoked = handleSourceGrantCommand(grantOnce(), 'source.revokeProjection', { grantId: 'grant-budget' }, actor());
    if (!revoked) throw new Error('revoke refused');
    const again = handleSourceGrantCommand(revoked.state, 'source.revokeProjection', { grantId: 'grant-budget' }, actor({ now: 3_000 }));
    expect(again?.label).toContain('already revoked');
    expect(again?.state.spaceGrants?.[0]?.revokedAt).toBe(1_000);
    throwsCode(() => handleSourceGrantCommand(grantOnce(), 'source.revokeProjection', { grantId: 'grant-missing' }, actor()), 'SOURCE_GRANT_NOT_FOUND');
  });
});

describe('reads and in-flight work go through the same grant check', () => {
  const read = (state: ReturnType<typeof createTableState>, overrides: Partial<Parameters<typeof readGrantedProjection>[1]> = {}) =>
    readGrantedProjection(state, { grantId: 'grant-budget', actorId: 'actor-a', portId: 'budget', membershipVerifiedBy: 'destination' as const, sourceEpoch: 3, ...overrides });

  it('serves a live projection', () => {
    const result = read(grantOnce());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.projection.fields).toEqual(['room', 'price']);
  });

  it('stops serving immediately after the revoke', () => {
    const revoked = handleSourceGrantCommand(grantOnce(), 'source.revokeProjection', { grantId: 'grant-budget' }, actor());
    if (!revoked) throw new Error('revoke refused');
    expect(read(revoked.state)).toMatchObject({ ok: false, code: 'GRANT_REVOKED' });
  });

  it('refuses a non-member, an unexposed port and a stale epoch', () => {
    const state = grantOnce();
    expect(read(state, { membershipVerifiedBy: undefined })).toMatchObject({ ok: false, code: 'GRANT_AUDIENCE' });
    expect(read(state, { portId: 'plan' })).toMatchObject({ ok: false, code: 'GRANT_FIELD_NOT_PERMITTED' });
    expect(read(state, { sourceEpoch: 4 })).toMatchObject({ ok: false, code: 'GRANT_STALE_EPOCH' });
  });

  it('refuses a grant id that is not on this table', () => {
    expect(read(grantOnce(), { grantId: 'grant-other' })).toMatchObject({ ok: false, code: 'GRANT_NOT_FOUND' });
  });
});

describe('grant bookkeeping stays bounded and cannot be dictated by the client', () => {
  it('keeps the audit trail bounded once many grants were revoked', () => {
    let state = createTableState();
    for (let index = 0; index < TOOL_CONNECTION_LIMITS.maxGrantsPerSource; index += 1) {
      const granted = handleSourceGrantCommand(state, 'source.grantProjection', { ...grantPayload, grantId: `grant-${index}` }, actor());
      if (!granted) throw new Error('grant refused');
      state = granted.state;
      const revoked = handleSourceGrantCommand(state, 'source.revokeProjection', { grantId: `grant-${index}` }, actor({ now: 2_000 }));
      if (!revoked) throw new Error('revoke refused');
      state = revoked.state;
    }
    expect(state.spaceGrants).toHaveLength(TOOL_CONNECTION_LIMITS.maxGrantsPerSource);
    const next = handleSourceGrantCommand(state, 'source.grantProjection', { ...grantPayload, grantId: 'grant-final' }, actor());
    if (!next) throw new Error('grant refused');
    // The new grant is stored and the old revoked ones do not grow the list without bound.
    expect(next.state.spaceGrants?.length).toBeLessThanOrEqual(TOOL_CONNECTION_LIMITS.maxGrantsPerSource + 1);
    expect(next.state.spaceGrants?.some(entry => entry.grantId === 'grant-final')).toBe(true);
  });
});
