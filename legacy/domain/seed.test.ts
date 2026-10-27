import { describe, expect, it } from 'vitest';
import { BASE_POLICY, createDataset } from './seed';

describe('synthetic Northstar seed', () => {
  it('uses a static v1 baseline policy and returns 96 deterministic asset rows', () => {
    expect(BASE_POLICY).toMatchObject({
      version: 1,
      defaultThreshold: 20_000,
      laptop: { threshold: 20_000, usefulLifeMonths: 60, start: 'following-month' },
      createdAt: '2026-09-01T00:00:00.000Z',
    });
    const first = createDataset();
    expect(first).toEqual(createDataset());
    expect(first.assets).toHaveLength(96);
    expect(new Set(first.assets.map((asset) => asset.rowId)).size).toBe(96);
    expect(new Set(first.assets.map((asset) => asset.assetId)).size).toBeLessThan(96);
  });

  it('includes the flagship policy edge and v2 ledger while preserving source anomalies', () => {
    const dataset = createDataset();
    const flagship = dataset.assets.find((asset) => asset.rowId === 'ROW-001');
    expect(flagship).toMatchObject({ rowId: 'ROW-001', assetId: 'FA-001', category: 'Laptop', cost: 18_000, inServiceDate: '2026-09-01' });
    expect(flagship?.recordedMonthlyDepreciation).toBe(500);
    expect(dataset.ledger.find((entry) => entry.assetId === 'FA-001')?.amount).toBe(500);
    expect(dataset.assets.some((asset) => asset.acquisitionDate === null)).toBe(true);
    expect(dataset.assets.some((asset) => asset.category === 'Unknown')).toBe(true);
    expect(dataset.assets.some((asset) => Number.isNaN(asset.cost))).toBe(true);
  });

  it('keeps October synthetic data at 96 rows and changes its newly in-service asset', () => {
    const september = createDataset('2026-09');
    const october = createDataset('2026-10');
    const septemberLast = september.assets.find((asset) => asset.rowId === 'ROW-096');
    const octoberLast = october.assets.find((asset) => asset.rowId === 'ROW-096');
    expect(october.assets).toHaveLength(96);
    expect(october.period).toBe('2026-10');
    expect(octoberLast?.inServiceDate).toBe('2026-10-01');
    expect(septemberLast?.inServiceDate).toBe('2026-09-01');
    expect(october.ledger.every((entry) => entry.period === '2026-10')).toBe(true);
  });

  it('rejects periods before the deterministic sample range', () => {
    expect(() => createDataset('2026-08')).toThrow(/available from 2026-09/);
    expect(() => createDataset('2026-13')).toThrow(/Expected YYYY-MM/);
  });
});
