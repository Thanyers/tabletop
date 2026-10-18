import { readFile } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDataset } from './seed';
import { loadDemoDatabase, loadDemoWorkbook, parseLedgerRows, readLedgerWorkbook } from './connections';

const DATABASE_FIXTURE = new URL('../../public/data/northstar-db-snapshot.json', import.meta.url);
const WORKBOOK_FIXTURE = new URL('../../public/data/general-ledger-2026-09.xlsx', import.meta.url);

afterEach(() => vi.unstubAllGlobals());

describe('local demo source connections', () => {
  it('loads all fixed-asset snapshot rows and revives the intentional NaN marker', async () => {
    const snapshotText = await readFile(DATABASE_FIXTURE, 'utf8');
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/data/northstar-db-snapshot.json');
      return new Response(snapshotText, { headers: { 'content-type': 'application/json' } });
    }));

    const loaded = await loadDemoDatabase();
    const seeded = createDataset('2026-09');
    expect(loaded.assets).toHaveLength(96);
    expect(loaded.assets).toEqual(seeded.assets);
    expect(loaded.assets.some((asset) => asset.assetId === 'FA-017')).toBe(true);
    expect(new Set(loaded.assets.map((asset) => asset.assetId)).size).toBeLessThan(loaded.assets.length);
    expect(Number.isNaN(loaded.assets.find((asset) => asset.rowId === 'ROW-020')?.cost)).toBe(true);
    expect(loaded.connection).toMatchObject({
      kind: 'database',
      resource: 'accounting.fixed_assets',
      rowCount: 96,
      mode: 'demo-snapshot',
    });
    expect(loaded.connection.name.toLowerCase()).toContain('snapshot');
  });

  it('parses the actual 96-row GL workbook and matches the seeded ledger', async () => {
    const workbookBytes = await readFile(WORKBOOK_FIXTURE);
    const workbookBlob = new Blob([new Uint8Array(workbookBytes)]);
    const parsedLedger = await readLedgerWorkbook(workbookBlob);
    const seeded = createDataset('2026-09');
    const expectedCents = seeded.ledger.reduce((total, entry) => total + Math.round(entry.amount * 100), 0);
    const parsedCents = parsedLedger.reduce((total, entry) => total + Math.round(entry.amount * 100), 0);

    expect(parsedLedger).toHaveLength(96);
    expect(parsedLedger).toEqual(seeded.ledger);
    expect(parsedCents).toBe(expectedCents);

    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/data/general-ledger-2026-09.xlsx');
      return new Response(workbookBytes, {
        headers: { 'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
      });
    }));
    const loaded = await loadDemoWorkbook();
    expect(loaded.ledger).toEqual(seeded.ledger);
    expect(loaded.connection).toMatchObject({
      kind: 'excel',
      resource: 'general-ledger-2026-09.xlsx · GL postings',
      rowCount: 96,
      mode: 'local-file',
    });
    expect(loaded.connection.fields).toEqual([
      { source: 'id', target: 'id' },
      { source: 'assetId', target: 'assetId' },
      { source: 'period', target: 'period' },
      { source: 'account', target: 'account' },
      { source: 'amount', target: 'amount' },
    ]);
  });

  it('rejects a malformed ledger schema and mixed reporting months', () => {
    const validHeaders = ['id', 'assetId', 'period', 'account', 'amount'];
    expect(() => parseLedgerRows([
      ['assetId', 'id', 'period', 'account', 'amount'],
      ['LEDGER-1', 'FA-001', '2026-09', '1500-LAPTOP', 500],
    ])).toThrow(/must have columns in this order/);
    expect(() => parseLedgerRows([
      validHeaders,
      ['LEDGER-1', 'FA-001', '2026-09', '1500-LAPTOP', 500],
      ['LEDGER-2', 'FA-002', '2026-10', '1500-LAPTOP', 500],
    ])).toThrow(/single reporting month/);
    expect(() => parseLedgerRows([
      validHeaders,
      ['LEDGER-1', 'FA-001', '2026-09', '1500-LAPTOP', 500],
      ['LEDGER-1', 'FA-002', '2026-09', '1500-LAPTOP', 600],
    ])).toThrow(/duplicate ledger id/);
  });

  it('rejects a malformed workbook before treating it as a ledger source', async () => {
    await expect(readLedgerWorkbook(new Blob(['not an XLSX workbook']))).rejects.toThrow();
  });
});
