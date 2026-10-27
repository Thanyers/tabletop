import { describe, expect, it } from 'vitest';
import {
  CSV_BOM,
  TOOL_EXPORT_LIMITS,
  buildToolExport,
  escapeCsvCell,
  toolExportCsv,
  toolExportHtml,
  type ToolExportColumn,
  type ToolExportInput,
  type ToolExportSnapshot,
  type ToolExportTable,
} from './tool-export';

const columns: ToolExportColumn[] = [
  { id: 'room', label: 'ห้อง', type: 'text' },
  { id: 'price', label: 'ราคา', type: 'number' },
  { id: 'note', label: 'หมายเหตุ', type: 'text' },
];

const table: ToolExportTable = {
  id: 'placements',
  title: 'ผังพื้นที่กิจกรรม',
  columns,
  rows: [
    { id: 'row-1', values: { room: 'ห้องประชุม', price: 1250, note: 'ชั้น 2' } },
    { id: 'row-2', values: { room: 'ห้องโถง, ใหญ่', price: 9999.5, note: 'มี "อัญประกาศ"' } },
  ],
};

const snapshot: ToolExportSnapshot = {
  dataRevision: 7,
  ruleRevision: 2,
  packageVersions: { 'activity-layout': 3 },
  sources: [{ tableId: 'placements', label: 'ผังกิจกรรม', dataRevision: 7 }],
  readAt: 1_760_000_000_000,
};

const permission = { granted: true, grantVersion: 2, currentGrantVersion: 2, fields: ['room', 'price', 'note'] };

function input(overrides: Partial<ToolExportInput> = {}): ToolExportInput {
  return {
    tables: [table],
    snapshot,
    requested: { dataRevision: 7, ruleRevision: 2 },
    permission,
    format: 'csv',
    producedAt: 1_760_000_100_000,
    ...overrides,
  };
}

describe('CSV cells survive Thai text, numbers and spreadsheets', () => {
  it('quotes commas, quotes and newlines', () => {
    expect(escapeCsvCell('ห้องโถง, ใหญ่')).toBe('"ห้องโถง, ใหญ่"');
    expect(escapeCsvCell('มี "อัญประกาศ"')).toBe('"มี ""อัญประกาศ"""');
    expect(escapeCsvCell('บรรทัด 1\nบรรทัด 2')).toBe('"บรรทัด 1\nบรรทัด 2"');
  });

  it('leaves plain text and numbers untouched, and renders null as empty', () => {
    expect(escapeCsvCell('ห้องประชุม')).toBe('ห้องประชุม');
    expect(escapeCsvCell(1250)).toBe('1250');
    expect(escapeCsvCell(9999.5)).toBe('9999.5');
    expect(escapeCsvCell(null)).toBe('');
    expect(escapeCsvCell(true)).toBe('true');
  });

  it('defuses a cell a spreadsheet would evaluate', () => {
    for (const dangerous of ['=1+1', '+66', '-5', '@SUM(A1)', '\tcmd']) {
      const safe = escapeCsvCell(dangerous);
      expect(safe, dangerous).not.toBe(dangerous);
      expect(safe.startsWith("'"), dangerous).toBe(true);
    }
    // A negative number is a legitimate value; guarding is a display rule, so the guard is explicit.
    expect(escapeCsvCell('-5', false)).toBe('-5');
  });

  it('caps one cell instead of producing an unbounded file', () => {
    const long = 'ก'.repeat(TOOL_EXPORT_LIMITS.maxCellChars + 50);
    expect(escapeCsvCell(long).length).toBeLessThanOrEqual(TOOL_EXPORT_LIMITS.maxCellChars);
  });
});

describe('CSV and HTML documents', () => {
  it('writes a header, CRLF rows and a UTF-8 BOM for Excel', () => {
    const csv = toolExportCsv(table, columns);
    expect(csv.startsWith(CSV_BOM)).toBe(true);
    const lines = csv.slice(CSV_BOM.length).split('\r\n').filter(Boolean);
    expect(lines[0]).toBe('ห้อง,ราคา,หมายเหตุ');
    expect(lines).toHaveLength(3);
    expect(csv.slice(CSV_BOM.length).startsWith('ห้อง,ราคา,หมายเหตุ')).toBe(true);
    expect(toolExportCsv(table, columns, { bom: false }).startsWith(CSV_BOM)).toBe(false);
  });

  it('renders HTML with escaped values and no external resource', () => {
    const html = toolExportHtml({ ...table, rows: [{ id: 'r', values: { room: '<script>alert(1)</script>', price: 1, note: null } }] }, columns, snapshot);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain("default-src 'none'");
    expect(html).toContain('ข้อมูล revision 7');
  });
});

describe('export refuses before producing a file', () => {
  it('needs its own permission at the current grant version', () => {
    expect(buildToolExport(input({ permission: { ...permission, granted: false } }))).toMatchObject({ ok: false, code: 'EXPORT_NOT_PERMITTED' });
    expect(buildToolExport(input({ permission: { ...permission, grantVersion: 1 } }))).toMatchObject({ ok: false, code: 'EXPORT_NOT_PERMITTED' });
  });

  it('refuses an empty selection', () => {
    expect(buildToolExport(input({ tables: [] }))).toMatchObject({ ok: false, code: 'EXPORT_EMPTY' });
  });

  it('refuses to mix revisions in one file', () => {
    expect(buildToolExport(input({ requested: { dataRevision: 9, ruleRevision: 2 } }))).toMatchObject({ ok: false, code: 'EXPORT_REVISION_MISMATCH' });
    const mixed = { ...snapshot, sources: [{ tableId: 'other', label: 'งบประมาณ', dataRevision: 9 }] };
    expect(buildToolExport(input({ snapshot: mixed }))).toMatchObject({ ok: false, code: 'EXPORT_REVISION_MISMATCH' });
  });

  it('refuses a table whose fields the permission does not cover', () => {
    expect(buildToolExport(input({ permission: { ...permission, fields: ['other'] } }))).toMatchObject({ ok: false, code: 'EXPORT_NOT_PERMITTED' });
  });

  it('refuses a file over the row limit', () => {
    const rows = Array.from({ length: TOOL_EXPORT_LIMITS.maxRows + 1 }, (_, index) => ({ id: `r${index}`, values: { room: 'x', price: index, note: null } }));
    expect(buildToolExport(input({ tables: [{ ...table, rows }] }))).toMatchObject({ ok: false, code: 'EXPORT_LIMIT' });
  });
});

describe('a successful export is revision-consistent and reports what it withheld', () => {
  it('writes one file per table plus a manifest of the snapshot used', () => {
    const result = buildToolExport(input({ permission: { ...permission, fields: ['room', 'price'] } }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files).toHaveLength(1);
    expect(result.files[0]?.filename).toBe('placements.csv');
    expect(result.files[0]?.content).not.toContain('ชั้น 2');
    expect(result.manifest.tables).toEqual([{ id: 'placements', rows: 2, withheldFields: ['note'] }]);
    expect(result.manifest.snapshot.dataRevision).toBe(7);
    expect(result.manifest.producedAt).toBe(1_760_000_100_000);
  });

  it('produces one file per collection rather than one merged blob', () => {
    const second: ToolExportTable = { id: 'budget', title: 'งบประมาณ', columns, rows: [{ id: 'b1', values: { room: 'ห้องประชุม', price: 4200, note: null } }] };
    const result = buildToolExport(input({ tables: [table, second], format: 'html' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.files.map(file => file.filename)).toEqual(['placements.html', 'budget.html']);
    expect(result.manifest.tables.map(entry => entry.rows)).toEqual([2, 1]);
  });
});
