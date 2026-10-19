import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseAssetCSV, parseLedgerCSV, toCSV } from './csv';
import { reconcile } from './accounting';
import { BASE_POLICY, createDataset } from './seed';

const ASSET_HEADER = 'rowId,assetId,description,category,acquisitionDate,inServiceDate,cost,usefulLifeMonths,method,accumulatedDepreciation,recordedMonthlyDepreciation,glAccount,department';

function readSample(filename: string): string {
  return readFileSync(new URL(`../../public/data/${filename}`, import.meta.url), 'utf8');
}

describe('CSV import and export', () => {
  it('parses canonical asset columns, quoted commas, and empty nullable dates', () => {
    const csv = `${ASSET_HEADER}\r\nROW-1,FA-1,"Northstar, laptop",Laptop,,2026-09-01,18000,36,straight-line,0,500,1500-LAPTOP,Technology`;
    expect(parseAssetCSV(csv)).toEqual([{
      rowId: 'ROW-1',
      assetId: 'FA-1',
      description: 'Northstar, laptop',
      category: 'Laptop',
      acquisitionDate: null,
      inServiceDate: '2026-09-01',
      cost: 18_000,
      usefulLifeMonths: 36,
      method: 'straight-line',
      accumulatedDepreciation: 0,
      recordedMonthlyDepreciation: 500,
      glAccount: '1500-LAPTOP',
      department: 'Technology',
    }]);
  });

  it('rejects duplicate row identifiers but allows duplicate asset identifiers', () => {
    const repeatedAssetId = `${ASSET_HEADER}\nROW-1,FA-1,Laptop,Laptop,,2026-09-01,18000,36,straight-line,0,500,1500-LAPTOP,Technology\nROW-2,FA-1,Laptop,Laptop,,2026-09-01,18000,36,straight-line,0,500,1500-LAPTOP,Technology`;
    expect(parseAssetCSV(repeatedAssetId)).toHaveLength(2);

    const repeatedRowId = `${ASSET_HEADER}\nROW-1,FA-1,Laptop,Laptop,,2026-09-01,18000,36,straight-line,0,500,1500-LAPTOP,Technology\nROW-1,FA-2,Laptop,Laptop,,2026-09-01,18000,36,straight-line,0,500,1500-LAPTOP,Technology`;
    expect(() => parseAssetCSV(repeatedRowId)).toThrow(/duplicate rowId/i);
  });

  it('parses ledger rows and rejects invalid schemas, numbers, and quoted fields', () => {
    expect(parseLedgerCSV('id,assetId,period,account,amount\nL1,FA-1,2026-09,1500-LAPTOP,500')).toEqual([
      { id: 'L1', assetId: 'FA-1', period: '2026-09', account: '1500-LAPTOP', amount: 500 },
    ]);
    expect(() => parseAssetCSV('rowId,assetId,wrong\n')).toThrow(/columns must be/);
    expect(() => parseLedgerCSV('id,assetId,period,account,amount\nL1,FA-1,2026-09,1500-LAPTOP,NaN')).toThrow(/finite number/);
    expect(() => parseLedgerCSV('id,assetId,period,account,amount\nL1,FA-1,2026-09,"1500-LAPTOP,500')).toThrow(/unterminated/);
  });

  it('keeps both public periods aligned with the import schemas', () => {
    for (const period of ['2026-09', '2026-10']) {
      const seeded = createDataset(period);
      const assets = parseAssetCSV(readSample(`assets-${period}.csv`));
      const ledger = parseLedgerCSV(readSample(`ledger-${period}.csv`));
      expect(assets).toHaveLength(96);
      expect(ledger).toHaveLength(seeded.ledger.length);
      expect(assets.map((asset) => asset.rowId)).toEqual(seeded.assets.map((asset) => asset.rowId));
      expect(ledger.map((entry) => entry.id)).toEqual(seeded.ledger.map((entry) => entry.id));

      const importedResult = reconcile({ ...seeded, assets, ledger }, BASE_POLICY);
      const seededResult = reconcile(seeded, BASE_POLICY);
      expect(importedResult.summary).toEqual(seededResult.summary);
    }
  });

  it('quotes CSV cells and protects spreadsheet formula-like text', () => {
    const csv = toCSV([{ description: 'Northstar, "laptop"', note: ' =SUM(A1:A2)', amount: 500 }]);
    expect(csv).toBe('description,note,amount\r\n"Northstar, ""laptop""",\' =SUM(A1:A2),500');
    expect(() => toCSV([{ amount: Number.POSITIVE_INFINITY }])).toThrow(/non-finite/);
  });
});
