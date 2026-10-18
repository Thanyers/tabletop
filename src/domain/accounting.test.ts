import { describe, expect, it } from 'vitest';
import { calculateMonthly, reconcile } from './accounting';
import { BASE_POLICY, createDataset } from './seed';
import type { Asset, Dataset, LedgerEntry, Policy } from './types';

const V2_POLICY: Policy = {
  ...BASE_POLICY,
  version: 2,
  laptop: { threshold: 15_000, usefulLifeMonths: 36, start: 'in-service' },
  source: 'test',
  parentVersion: 1,
};

function asset(overrides: Partial<Asset> = {}): Asset {
  return {
    rowId: 'TEST-001',
    assetId: 'FA-TEST-001',
    description: 'Northstar Laptop test',
    category: 'Laptop',
    acquisitionDate: '2026-08-01',
    inServiceDate: '2026-09-15',
    cost: 18_000,
    usefulLifeMonths: 36,
    method: 'straight-line',
    accumulatedDepreciation: 0,
    recordedMonthlyDepreciation: 500,
    glAccount: '1500-LAPTOP',
    department: 'Technology',
    ...overrides,
  };
}

function dataset(assets: Asset[], ledger: LedgerEntry[]): Dataset {
  return { id: 'test', name: 'Test data', period: '2026-09', assets, ledger, source: 'synthetic' };
}

describe('calculateMonthly', () => {
  it('applies the capitalization threshold inclusively and rounds to cents', () => {
    expect(calculateMonthly(asset({ cost: 15_000 }), V2_POLICY, '2026-09')).toBe(416.67);
    expect(calculateMonthly(asset({ cost: 14_999 }), V2_POLICY, '2026-09')).toBe(0);
  });

  it('uses the service month for laptops and the following month for retained categories', () => {
    expect(calculateMonthly(asset(), V2_POLICY, '2026-09')).toBe(500);
    const furniture = asset({ category: 'Furniture', description: 'Northstar office desk', cost: 60_000, usefulLifeMonths: 60 });
    expect(calculateMonthly(furniture, V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(furniture, V2_POLICY, '2026-10')).toBe(1_000);
  });

  it('returns zero before service and caps depreciation at the remaining carrying value', () => {
    expect(calculateMonthly(asset({ inServiceDate: '2026-10-01' }), V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(asset({ accumulatedDepreciation: 17_900 }), V2_POLICY, '2026-09')).toBe(100);
    expect(calculateMonthly(asset({ accumulatedDepreciation: 18_000 }), V2_POLICY, '2026-09')).toBe(0);
  });

  it('does not calculate invalid, negative, or non-finite amounts or invalid dates', () => {
    expect(calculateMonthly(asset({ cost: -1 }), V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(asset({ cost: Number.NaN }), V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(asset({ accumulatedDepreciation: Number.POSITIVE_INFINITY }), V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(asset({ inServiceDate: '2026-02-30' }), V2_POLICY, '2026-09')).toBe(0);
    expect(calculateMonthly(asset(), V2_POLICY, '2026-13')).toBe(0);
  });
});

describe('reconcile', () => {
  it('counts duplicated ledger identifiers once in the ledger summary', () => {
    const entry: LedgerEntry = {
      id: 'LEDGER-ONE', assetId: 'FA-TEST-001', period: '2026-09', account: '1500-LAPTOP', amount: 500,
    };
    const result = reconcile(dataset([asset()], [entry, { ...entry }]), V2_POLICY);
    expect(result.summary.ledger).toBe(500);
    expect(result.rows[0]?.ledgerAmount).toBe(500);
    expect(result.rows[0]?.findings.map((finding) => finding.code)).toContain('duplicate-ledger-entry-id');
    expect(result.rows[0]?.status).toBe('review');
  });

  it('reports active-period ledger postings with no asset while keeping matched asset counts separate', () => {
    const matchedAsset = asset();
    const entries: LedgerEntry[] = [
      { id: 'LEDGER-MATCHED', assetId: matchedAsset.assetId, period: '2026-09', account: '1500-LAPTOP', amount: 500 },
      { id: 'LEDGER-ORPHAN', assetId: 'FA-MISSING', period: '2026-09', account: '1500-LAPTOP', amount: 25 },
    ];

    const result = reconcile(dataset([matchedAsset], entries), V2_POLICY);

    expect(result.rows[0]?.status).toBe('matched');
    expect(result.ledgerFindings).toHaveLength(1);
    expect(result.ledgerFindings[0]?.entry.id).toBe('LEDGER-ORPHAN');
    expect(result.ledgerFindings[0]?.finding).toMatchObject({
      code: 'orphan-ledger-entry',
      severity: 'error',
    });
    expect(result.ledgerFindings[0]?.finding.message).toContain('FA-MISSING');
    expect(result.ledgerFindings[0]?.finding.message).toMatch(/no asset record/i);
    expect(result.summary.exceptions).toBe(1);
    expect(result.summary.matched).toBe(1);
    expect(result.summary.ledger).toBe(525);
  });

  it('flags a remaining carrying value after the effective useful life without changing depreciation', () => {
    const aged = asset({
      inServiceDate: '2022-09-01',
      accumulatedDepreciation: 9_000,
      recordedMonthlyDepreciation: 500,
    });
    const result = reconcile(dataset([aged], [
      { id: 'LEDGER-AGED', assetId: aged.assetId, period: '2026-09', account: '1500-LAPTOP', amount: 500 },
    ]), V2_POLICY);

    expect(result.rows[0]?.calculated).toBe(500);
    expect(result.rows[0]?.findings.map((finding) => finding.code)).toContain('life-exhausted-with-balance');
    expect(result.rows[0]?.findings.find((finding) => finding.code === 'life-exhausted-with-balance')?.message).toMatch(/review.*catch-up/i);
  });

  it('rejects negative and non-finite recorded, accumulated, and ledger amounts', () => {
    const invalidAsset = asset({ recordedMonthlyDepreciation: -1, accumulatedDepreciation: Number.POSITIVE_INFINITY });
    const invalidEntry: LedgerEntry = {
      id: 'LEDGER-INVALID', assetId: invalidAsset.assetId, period: '2026-09', account: '1500-LAPTOP', amount: Number.NaN,
    };
    const result = reconcile(dataset([invalidAsset], [invalidEntry]), V2_POLICY);
    const codes = new Set(result.rows[0]?.findings.map((finding) => finding.code));
    expect(codes.has('negative-recorded-depreciation')).toBe(true);
    expect(codes.has('invalid-accumulated-depreciation')).toBe(true);
    expect(codes.has('invalid-ledger-amount')).toBe(true);
    expect(result.rows[0]?.status).toBe('review');
    expect(Number.isFinite(result.summary.recorded)).toBe(true);
    expect(Number.isFinite(result.summary.ledger)).toBe(true);
  });

  it('flags duplicate assets, missing ledger, missing GL, and ambiguous GL without assigning a false match', () => {
    const first = asset({ rowId: 'DUP-1', assetId: 'FA-DUP' });
    const second = asset({ rowId: 'DUP-2', assetId: 'FA-DUP' });
    const missingLedger = asset({ rowId: 'MISS-LEDGER', assetId: 'FA-MISS' });
    const noAccount = asset({ rowId: 'NO-GL', assetId: 'FA-NO-GL', glAccount: '' });
    const ambiguous = asset({ rowId: 'AMBIG', assetId: 'FA-AMBIG' });
    const ledger: LedgerEntry[] = [
      { id: 'DUP-L1', assetId: 'FA-DUP', period: '2026-09', account: '1500-LAPTOP', amount: 500 },
      { id: 'DUP-L2', assetId: 'FA-DUP', period: '2026-09', account: '1500-LAPTOP', amount: 500 },
      { id: 'NO-GL-L1', assetId: 'FA-NO-GL', period: '2026-09', account: '', amount: 500 },
      { id: 'AMBIG-L1', assetId: 'FA-AMBIG', period: '2026-09', account: '1500-LAPTOP', amount: 500 },
      { id: 'AMBIG-L2', assetId: 'FA-AMBIG', period: '2026-09', account: '9999-SUSPENSE', amount: 0 },
    ];
    const result = reconcile(dataset([first, second, missingLedger, noAccount, ambiguous], ledger), V2_POLICY);
    expect(result.rows.slice(0, 2).every((row) => row.ledgerAmount === null)).toBe(true);
    expect(result.rows[0]?.findings.map((finding) => finding.code)).toContain('duplicate-asset-id');
    expect(result.rows[2]?.findings.map((finding) => finding.code)).toContain('missing-ledger-entry');
    expect(result.rows[3]?.findings.map((finding) => finding.code)).toContain('missing-asset-gl-account');
    expect(result.rows[4]?.findings.map((finding) => finding.code)).toContain('ambiguous-ledger-gl-account');
    expect(result.rows.every((row) => row.status === 'review')).toBe(true);
  });

  it('shows the v2 seed ledger mismatch under v1 and matches the first laptop under v2', () => {
    const seeded = createDataset();
    const before = reconcile(seeded, BASE_POLICY);
    const after = reconcile(seeded, V2_POLICY);
    const baselineRow = before.rows.find((row) => row.asset.rowId === 'ROW-001');
    const candidateRow = after.rows.find((row) => row.asset.rowId === 'ROW-001');
    expect(baselineRow?.calculated).toBe(0);
    expect(baselineRow?.recorded).toBe(500);
    expect(baselineRow?.ledgerAmount).toBe(500);
    expect(baselineRow?.status).toBe('review');
    expect(candidateRow?.calculated).toBe(500);
    expect(candidateRow?.status).toBe('matched');
    expect(after.summary.difference).toBeLessThan(before.summary.difference);
    expect(after.summary.ledger).toBe(before.summary.ledger);
  });

  it('surfaces the seeded date, category, amount, useful-life, threshold, and account anomalies', () => {
    const result = reconcile(createDataset(), V2_POLICY);
    const findingsByRowId = new Map(result.rows.map((row) => [row.asset.rowId, new Set(row.findings.map((finding) => finding.code))]));
    expect(findingsByRowId.get('ROW-008')?.has('missing-acquisition-date')).toBe(true);
    expect(findingsByRowId.get('ROW-010')?.has('invalid-acquisition-date')).toBe(true);
    expect(findingsByRowId.get('ROW-011')?.has('missing-category')).toBe(true);
    expect(findingsByRowId.get('ROW-027')?.has('category-description-mismatch')).toBe(true);
    expect(findingsByRowId.get('ROW-016')?.has('abnormal-useful-life')).toBe(true);
    expect(findingsByRowId.get('ROW-015')?.has('asset-gl-account-mismatch')).toBe(true);
    expect(findingsByRowId.get('ROW-015')?.has('ledger-asset-account-mismatch')).toBe(true);
    expect(findingsByRowId.get('ROW-019')?.has('negative-cost')).toBe(true);
    expect(findingsByRowId.get('ROW-020')?.has('invalid-cost')).toBe(true);
    expect(findingsByRowId.get('ROW-025')?.has('recorded-calculation-mismatch')).toBe(true);
    expect(findingsByRowId.get('ROW-031')?.has('depreciated-below-threshold')).toBe(true);
  });
});
