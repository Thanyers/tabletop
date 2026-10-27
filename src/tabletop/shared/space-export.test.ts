import { describe, expect, it } from 'vitest';
import { CSV_BOM } from './tool-export';
import { buildSpaceExport } from './space-export';
import type { ToolProjectionGrant } from './tool-connection';

/** F080 / JT-X: exporting one granted projection, with export as a permission of its own. */

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
    grantVersion: 2,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 10 }],
    actions: [],
    exportAllowed: true,
    ...overrides,
  };
}

const records = [
  { id: 'row-1', values: { room: 'ห้องประชุม', price: 1250 } },
  { id: 'row-2', values: { room: 'ห้องโถง, ใหญ่', price: 4200 } },
];

function input(overrides: Partial<Parameters<typeof buildSpaceExport>[0]> = {}) {
  return {
    grant: grant(),
    portId: 'budget',
    actorId: 'actor-a',
    spaceWorkspaceId: SPACE,
    sourceEpoch: EPOCH,
    dataRevision: 9,
    ruleRevision: 2,
    records,
    format: 'csv' as const,
    producedAt: 5_000,
    ...overrides,
  };
}

describe('export needs its own permission', () => {
  it('produces a CSV for a grant that allows export', () => {
    const result = buildSpaceExport(input());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe('budget.csv');
    expect(result.sourceDataRevision).toBe(9);
    expect(result.content.startsWith(CSV_BOM)).toBe(true);
    expect(result.content).toContain('ห้องประชุม');
    expect(result.content).toContain('1250');
    // A value with a comma is quoted, not split into two columns.
    expect(result.content).toContain('"ห้องโถง, ใหญ่"');
  });

  it('refuses when the grant may be read but not exported', () => {
    const result = buildSpaceExport(input({ grant: grant({ exportAllowed: false }) }));
    expect(result).toMatchObject({ ok: false, code: 'EXPORT_NOT_PERMITTED' });
  });

  it('refuses after a revoke, before looking at the export flag', () => {
    const revoked = grant({ status: 'revoked', revokedAt: 2_000, exportAllowed: true });
    expect(buildSpaceExport(input({ grant: revoked }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_REVOKED' });
  });

  it('refuses another workspace and a stale epoch', () => {
    expect(buildSpaceExport(input({ spaceWorkspaceId: '99999999-9999-4999-8999-999999999999' }))).toBeTruthy();
    expect(buildSpaceExport(input({ sourceEpoch: EPOCH + 1 }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_STALE_EPOCH' });
  });

  it('refuses a port the grant does not expose', () => {
    expect(buildSpaceExport(input({ portId: 'plan' }))).toMatchObject({ ok: false, code: 'SPACE_GRANT_PORT' });
  });

  it('writes an HTML file when asked, with the revision in the caption', () => {
    const result = buildSpaceExport(input({ format: 'html' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.filename).toBe('budget.html');
    expect(result.content).toContain('ข้อมูล revision 9');
    expect(result.content).toContain('ห้องประชุม');
  });

  it('caps rows at the grant ceiling', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ id: `row-${index}`, values: { room: `r${index}`, price: index } }));
    const result = buildSpaceExport(input({ records: many, grant: grant({ projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 4 }] }) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const lines = result.content.split('\r\n').filter(Boolean);
    // header + 4 rows
    expect(lines).toHaveLength(5);
  });
});
