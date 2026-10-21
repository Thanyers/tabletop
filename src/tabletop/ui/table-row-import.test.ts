import { describe, expect, it } from 'vitest';
import type { TableField } from '../shared/table-contracts';
import { autoMapping, buildImportRows, cellValue, parseCsv } from './table-row-import';

const fields: TableField[] = [
  { id: 'sku', label: 'SKU', type: 'text', required: true },
  { id: 'qty', label: 'Qty', type: 'number', required: true, min: 0, max: 100 },
  { id: 'active', label: 'Active', type: 'boolean', required: false, default: true },
  { id: 'note', label: 'Note', type: 'text', required: false },
];

describe('parseCsv', () => {
  it('parses headers, CRLF, quoted commas and escaped quotes', () => {
    const parsed = parseCsv('\uFEFFsku,qty,note\r\nA,1,"first, second"\r\nB,2,"He said ""hi"""\r\n');
    expect(parsed.headers).toEqual(['sku', 'qty', 'note']);
    expect(parsed.rows).toEqual([['A', '1', 'first, second'], ['B', '2', 'He said "hi"']]);
  });

  it('keeps newlines inside quotes and drops blank lines', () => {
    const parsed = parseCsv('a,b\n"line1\nline2",2\n\n');
    expect(parsed.rows).toEqual([['line1\nline2', '2']]);
  });
});

describe('autoMapping', () => {
  it('matches field ids and labels, ignoring case, spaces and underscores', () => {
    expect(autoMapping(['SKU', 'Qty', 'Active', 'Note'], fields)).toEqual({ 0: 'sku', 1: 'qty', 2: 'active', 3: 'note' });
    expect(autoMapping(['unknown', 'qty'], fields)).toEqual({ 1: 'qty' });
  });
});

describe('cellValue', () => {
  it('converts values by type and applies defaults', () => {
    expect(cellValue(fields[0], 'A-1')).toEqual({ ok: true, value: 'A-1' });
    expect(cellValue(fields[1], ' 12 ')).toEqual({ ok: true, value: 12 });
    expect(cellValue(fields[2], 'yes')).toEqual({ ok: true, value: true });
    expect(cellValue(fields[3], '')).toEqual({ ok: true, value: null });
    expect(cellValue(fields[2], '')).toEqual({ ok: true, value: true });
  });

  it('rejects invalid numbers, ranges, booleans and required empties', () => {
    expect(cellValue(fields[1], 'abc').ok).toBe(false);
    expect(cellValue(fields[1], '101').ok).toBe(false);
    expect(cellValue(fields[1], '-1').ok).toBe(false);
    expect(cellValue(fields[2], 'maybe').ok).toBe(false);
    expect(cellValue(fields[0], ' ').ok).toBe(false);
  });
});

describe('buildImportRows', () => {
  it('builds rows, reports invalid rows separately and lists ignored headers', () => {
    const table = parseCsv('SKU,Qty,Unknown\nA,1,x\nB,bad,y\nC,3,z\n');
    const preview = buildImportRows(table, autoMapping(table.headers, fields), fields);
    expect(preview.rows).toEqual([
      { sku: 'A', qty: 1, active: true, note: null },
      { sku: 'C', qty: 3, active: true, note: null },
    ]);
    expect(preview.invalid).toHaveLength(1);
    expect(preview.invalid[0]).toMatchObject({ row: 2 });
    expect(preview.ignoredHeaders).toEqual(['Unknown']);
  });
});
