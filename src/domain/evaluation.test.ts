import { describe, expect, it } from 'vitest';
import { evaluateProposal } from './evaluation';
import { withCategoryPolicy } from './policy';
import { BASE_POLICY, createDataset } from './seed';
import type { Policy } from './types';

const CANDIDATE_POLICY: Policy = {
  ...BASE_POLICY,
  version: 2,
  laptop: { threshold: 15_000, usefulLifeMonths: 36, start: 'in-service' },
  source: 'proposal',
  parentVersion: 1,
};

describe('evaluateProposal', () => {
  it('passes authored v2 boundary cases and preserves retained category schedules', () => {
    const result = evaluateProposal(createDataset(), BASE_POLICY, CANDIDATE_POLICY);
    expect(result.failed).toBe(0);
    expect(result.regressions).toBe(0);
    expect(result.cases.some((item) => item.id.startsWith('regression-data-calculation-'))).toBe(true);
    expect(result.cases.filter((item) => item.id.startsWith('regression-data-')).every((item) => item.passed)).toBe(true);
    expect(result.beforeExceptions).toBeGreaterThan(result.afterExceptions);
    expect(result.impacts.some((impact) => impact.rowId === 'ROW-001' && impact.before === 0 && impact.after === 500)).toBe(true);
    expect(result.ranAt).toBe('2026-09-01T00:00:00.000Z');
  });

  const invalidLaptopPolicies: Array<[string, Policy['laptop']]> = [
    ['threshold', { threshold: 16_000, usefulLifeMonths: 36, start: 'in-service' }],
    ['useful life', { threshold: 15_000, usefulLifeMonths: 60, start: 'in-service' }],
    ['start rule', { threshold: 15_000, usefulLifeMonths: 36, start: 'following-month' }],
  ];
  it.each(invalidLaptopPolicies)('fails a candidate with an incorrect laptop %s', (_label, laptop) => {
    const invalidCandidate: Policy = { ...CANDIDATE_POLICY, laptop };
    const result = evaluateProposal(createDataset(), BASE_POLICY, invalidCandidate);
    expect(result.failed).toBeGreaterThan(0);
    expect(result.cases.some((item) => !item.passed && item.id.startsWith('proposal-laptop-'))).toBe(true);
  });

  it('fails with regressions when a higher default threshold breaks previously matched retained assets', () => {
    const changedDefault: Policy = { ...CANDIDATE_POLICY, defaultThreshold: 30_000 };
    const result = evaluateProposal(createDataset(), BASE_POLICY, changedDefault);
    expect(result.regressions).toBeGreaterThan(0);
    expect(result.cases.some((item) => item.group === 'regression' && !item.passed && item.id.startsWith('regression-data-'))).toBe(true);
  });

  it('tests configured Furniture rules directly while preserving unchanged Equipment and Vehicle rows', () => {
    let candidate = withCategoryPolicy(CANDIDATE_POLICY, 'Furniture', { threshold: 15_000 });
    candidate = withCategoryPolicy(candidate, 'Furniture', { usefulLifeMonths: 48, start: 'in-service' });

    const result = evaluateProposal(createDataset(), BASE_POLICY, candidate);
    const furnitureCases = result.cases.filter((item) => item.id.includes('furniture'));
    const unchangedRows = result.cases.filter((item) => item.id.includes('ROW-') && item.group === 'regression');

    expect(furnitureCases).toHaveLength(4);
    expect(furnitureCases.every((item) => item.passed)).toBe(true);
    expect(result.cases.some((item) => item.id === 'regression-equipment')).toBe(true);
    expect(result.cases.some((item) => item.id === 'regression-vehicle')).toBe(true);
    expect(unchangedRows.every((item) => item.passed)).toBe(true);
    expect(result.impacts.some((impact) => impact.rowId !== 'ROW-001')).toBe(true);
  });
});
