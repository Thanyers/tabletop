import { describe, expect, it } from 'vitest';
import type { CollaborationSpace } from './collaboration-space';
import type { ToolProjectionGrant } from './tool-connection';
import { resolveDeepLink } from './space-deep-link';

/** F080 / JT-4A: a link cannot be used to reach more than the read would give. */

const SPACE = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const EPOCH = 3;

function space(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: 1,
    spaceId: 'activity-room',
    title: 'ห้อง',
    sharedToolWorkspaceId: SPACE,
    managerActorId: 'actor-a',
    members: [{ actorId: 'actor-a', name: 'A', role: 'maker', joinedAt: 1 }],
    sources: [],
    revision: 4,
    epoch: 1,
    createdAt: 1,
    updatedAt: 4,
    ...overrides,
  } as CollaborationSpace;
}

function grant(overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: 'grant-budget',
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: '22222222-2222-4222-8222-222222222222',
    sourceEpoch: EPOCH,
    sourceDataRevision: 7,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room'], maxRows: 10 }],
    actions: [],
    exportAllowed: false,
    ...overrides,
  };
}

function resolve(overrides: Partial<Parameters<typeof resolveDeepLink>[0]> = {}) {
  return resolveDeepLink({
    space: space(),
    actorId: 'actor-a',
    spaceWorkspaceId: SPACE,
    grant: grant(),
    target: { grantId: 'grant-budget', portId: 'budget' },
    sourceEpoch: EPOCH,
    ...overrides,
  });
}

describe('a deep link asks the same three questions as a read', () => {
  it('resolves a granted port for a member, and says what to do next', () => {
    expect(resolve()).toEqual({ ok: true, portId: 'budget', resolve: 'read-source' });
  });

  it('keeps a row id for the source to verify, never answering it here', () => {
    const verdict = resolve({ target: { grantId: 'grant-budget', portId: 'budget', rowId: 'row-1' } });
    expect(verdict).toMatchObject({ ok: true, rowId: 'row-1' });
  });

  it('refuses a non-member', () => {
    expect(resolve({ actorId: 'outsider' })).toMatchObject({ ok: false, code: 'SPACE_NOT_MEMBER' });
  });

  it('refuses a port the grant does not expose, and a grant this room does not hold', () => {
    expect(resolve({ target: { grantId: 'grant-budget', portId: 'plan' } })).toMatchObject({ ok: false, code: 'SPACE_GRANT_PORT' });
    expect(resolve({ target: { grantId: 'grant-other', portId: 'budget' } })).toMatchObject({ ok: false, code: 'SPACE_GRANT_NOT_FOUND' });
    expect(resolve({ grant: undefined })).toMatchObject({ ok: false, code: 'SPACE_GRANT_NOT_FOUND' });
  });

  it('refuses a grant issued to another workspace', () => {
    expect(resolve({ spaceWorkspaceId: OTHER })).toMatchObject({ ok: false, code: 'SPACE_GRANT_NOT_FOUND' });
  });

  it('refuses after a revoke or a source reset', () => {
    expect(resolve({ grant: grant({ status: 'revoked', revokedAt: 2_000 }) })).toMatchObject({ ok: false, code: 'SPACE_GRANT_REVOKED' });
    expect(resolve({ sourceEpoch: EPOCH + 1 })).toMatchObject({ ok: false, code: 'SPACE_GRANT_STALE_EPOCH' });
  });

  it('refuses an actor outside a named audience', () => {
    expect(resolve({ grant: grant({ audience: { kind: 'actors', actorIds: ['actor-b'] } }) }))
      .toMatchObject({ ok: false, code: 'SPACE_GRANT_AUDIENCE' });
  });
});
