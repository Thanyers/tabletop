import { describe, expect, it } from 'vitest';
import { parseCsv, tableFromRows } from './sourceTable';

describe('bounded source preview', () => {
  it('retains a small preview while counting every row and column', () => {
    const columns = Array.from({ length: 35 }, (_, i) => `c${i}`);
    const csv = [columns.join(','), ...Array.from({ length: 5000 }, (_, i) => columns.map(() => i).join(','))].join('\n');
    const result = parseCsv(csv);
    expect(result.totalRows).toBe(5000);
    expect(result.totalColumns).toBe(35);
    expect(result.rows).toHaveLength(100);
    expect(result.headers).toHaveLength(30);
    expect(result.rows[99].c0).toBe('99');
  });
  it('preserves quoted multiline fields and still validates rows beyond the preview', () => {
    expect(parseCsv('id,note\r\n1,"a,b\n""quoted"""').rows).toEqual([{ id: '1', note: 'a,b\n"quoted"' }]);
    const valid = 'id,note\n' + Array.from({ length: 101 }, () => '1,ok').join('\n');
    expect(() => parseCsv(valid + '\nwrong')).toThrow('row width');
  });
  it('converts only the retained XLSX rows and columns', () => {
    const header = Array.from({ length: 35 }, (_, i) => `c${i}`);
    const result = tableFromRows([header, ...Array.from({ length: 1000 }, () => header)]);
    expect(result).toMatchObject({ totalRows: 1000, totalColumns: 35 });
    expect(result.rows).toHaveLength(100);
    expect(Object.keys(result.rows[0])).toHaveLength(30);
  });
});
