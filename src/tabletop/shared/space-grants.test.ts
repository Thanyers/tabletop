import { describe, expect, it } from 'vitest';
import type { ToolProjectionGrant } from './tool-connection';
import { latestGrantPerSource, selectGrantsForSpace } from './space-grants';

/** F080 / JT-4A: a destination asks a source which connections it holds, and gets ids only. */

const SPACE = '11111111-1111-4111-8111-111111111111';
const OTHER = '99999999-9999-4999-8999-999999999999';
const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

function grant(overrides: Partial<ToolProjectionGrant> = {}): ToolProjectionGrant {
  return {
    grantId: 'grant-a',
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: A,
    sourceEpoch: 2,
    sourceDataRevision: 4,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 1,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'plan', resource: 'rooms', fields: ['name'], maxRows: 10 }],
    actions: [{ actionId: 'reserve' }],
    exportAllowed: false,
    ...overrides,
  };
}

describe('which connections a room holds', () => {
  it('returns only the grants issued to that room, with ids and counters', () => {
    const result = selectGrantsForSpace([
      grant(),
      grant({ grantId: 'grant-b', sourceWorkspaceId: B, grantVersion: 3, exportAllowed: true }),
      grant({ grantId: 'grant-other', spaceWorkspaceId: OTHER }),
    ], SPACE);
    expect(result.map(entry => entry.grantId)).toEqual(['grant-a', 'grant-b']);
    expect(result[1]).toEqual({
      grantId: 'grant-b',
      sourceWorkspaceId: B,
      grantedRevision: 4,
      status: 'granted',
      grantVersion: 3,
      exportAllowed: true,
      actions: ['reserve'],
      ports: ['plan'],
    });
  });

  it('keeps a withdrawn grant so a recap can explain it', () => {
    const result = selectGrantsForSpace([grant({ status: 'revoked' })], SPACE);
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe('revoked');
  });

  it('never returns rows or field values: ids, counters and port names only', () => {
    const text = JSON.stringify(selectGrantsForSpace([grant()], SPACE));
    expect(text).not.toContain('rows');
    expect(text).not.toContain('values');
    expect(text).not.toContain('rooms');
  });

  it('answers nothing for a room that holds no connection here', () => {
    expect(selectGrantsForSpace([grant()], OTHER)).toEqual([]);
  });
});

describe('the newest live connection wins per source', () => {
  it('prefers a live grant over a revoked one for the same source', () => {
    const result = latestGrantPerSource([
      grant({ grantId: 'old', status: 'revoked', grantVersion: 1 }),
      grant({ grantId: 'new', status: 'granted', grantVersion: 2 }),
    ]);
    expect(result.map(entry => entry.grantId)).toEqual(['new']);
  });

  it('keeps the revoked grant when a source has nothing live left', () => {
    const result = latestGrantPerSource([grant({ grantId: 'gone', status: 'revoked' })]);
    expect(result.map(entry => `${entry.grantId}:${entry.status}`)).toEqual(['gone:revoked']);
  });

  it('prefers the higher version among live grants and keeps sources apart', () => {
    const result = latestGrantPerSource([
      grant({ grantId: 'v1', grantVersion: 1 }),
      grant({ grantId: 'v2', grantVersion: 2 }),
      grant({ grantId: 'b1', sourceWorkspaceId: B }),
    ]);
    expect(result.map(entry => entry.grantId).sort()).toEqual(['b1', 'v2']);
  });
});
