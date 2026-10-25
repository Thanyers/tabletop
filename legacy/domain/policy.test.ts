import { describe, expect, it } from 'vitest';
import { reconcile } from './accounting';
import { resolveCategoryPolicy, withCategoryPolicy } from './policy';
import { BASE_POLICY, createDataset } from './seed';
import type { Asset, Policy } from './types';

function asset(category: Asset['category'], usefulLifeMonths = 60): Asset {
  return {
    rowId: 'POLICY-ROW',
    assetId: 'FA-POLICY',
    description: category === 'Unknown' ? 'Unclassified item' : `Northstar ${category}`,
    category,
    acquisitionDate: '2025-01-01',
    inServiceDate: '2025-01-15',
    cost: 60_000,
    usefulLifeMonths,
    method: 'straight-line',
    accumulatedDepreciation: 0,
    recordedMonthlyDepreciation: 1_000,
    glAccount: category === 'Laptop' ? '1500-LAPTOP' : '1510-FURNITURE',
    department: 'Operations',
  };
}

describe('category policy', () => {
  it('uses the legacy threshold, per-asset life, and following-month start when no category rule exists', () => {
    const resolved = resolveCategoryPolicy(BASE_POLICY, asset('Furniture', 48));

    expect(resolved).toEqual({
      threshold: BASE_POLICY.defaultThreshold,
      usefulLifeMonths: 48,
      start: 'following-month',
      configured: false,
      usesSourceLife: true,
    });
  });

  it('merges category overrides without mutating the source policy or other categories', () => {
    const existing = withCategoryPolicy(BASE_POLICY, 'Furniture', { threshold: 15_000 });
    const candidate = withCategoryPolicy(existing, 'Furniture', { usefulLifeMonths: 48, start: 'in-service' });
    const resolved = resolveCategoryPolicy(candidate, asset('Furniture', 60));

    expect(existing.categoryRules?.Furniture).toEqual({ threshold: 15_000 });
    expect(candidate.categoryRules?.Furniture).toEqual({ threshold: 15_000, usefulLifeMonths: 48, start: 'in-service' });
    expect(resolveCategoryPolicy(candidate, asset('Furniture'))).toMatchObject({
      threshold: 15_000,
      usefulLifeMonths: 48,
      start: 'in-service',
      configured: true,
      usesSourceLife: false,
    });
    expect(resolveCategoryPolicy(candidate, asset('Equipment', 36))).toMatchObject({
      threshold: BASE_POLICY.defaultThreshold,
      usefulLifeMonths: 36,
      start: 'following-month',
      configured: false,
      usesSourceLife: true,
    });
    expect(resolved.threshold).toBe(15_000);
    expect(BASE_POLICY.categoryRules).toBeUndefined();
  });

  it('keeps Laptop on its established rule and Unknown visible for review', () => {
    const candidate: Policy = withCategoryPolicy(BASE_POLICY, 'Furniture', { threshold: 10_000 });
    const laptop = resolveCategoryPolicy(candidate, asset('Laptop', 60));
    const unknown = resolveCategoryPolicy(candidate, asset('Unknown', 24));

    expect(laptop).toMatchObject({
      threshold: BASE_POLICY.laptop.threshold,
      usefulLifeMonths: BASE_POLICY.laptop.usefulLifeMonths,
      start: BASE_POLICY.laptop.start,
    });
    expect(unknown).toMatchObject({
      threshold: BASE_POLICY.defaultThreshold,
      usefulLifeMonths: 24,
      usesSourceLife: true,
    });
    expect(reconcile(createDataset(), candidate).rows.find((row) => row.asset.category === 'Unknown')?.findings.map((finding) => finding.code)).toContain('missing-category');
  });
});
