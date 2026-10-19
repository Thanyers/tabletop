import { calculateMonthly, reconcile } from './accounting';
import { resolveCategoryPolicy } from './policy';
import type { Asset, Category, Dataset, Evaluation, EvaluationCase, GovernedCategory, Impact, Policy } from './types';

const EXPECTED_LAPTOP_THRESHOLD = 15_000;
const EXPECTED_LAPTOP_USEFUL_LIFE_MONTHS = 36;
const EVALUATION_PERIOD = '2026-09';
const REPORT_TIMESTAMP_SUFFIX = '-01T00:00:00.000Z';

function laptopFixture(rowId: string, cost: number, inServiceDate: string, accumulatedDepreciation = 0): Asset {
  return {
    rowId,
    assetId: rowId.replace('REQ-', 'FA-'),
    description: `Northstar laptop requirement ${rowId}`,
    category: 'Laptop',
    acquisitionDate: '2026-08-01',
    inServiceDate,
    cost,
    usefulLifeMonths: EXPECTED_LAPTOP_USEFUL_LIFE_MONTHS,
    method: 'straight-line',
    accumulatedDepreciation,
    recordedMonthlyDepreciation: 0,
    glAccount: '1500-LAPTOP',
    department: 'Technology',
  };
}

function retainedCategoryFixture(category: Exclude<Category, 'Laptop' | 'Unknown'>): Asset {
  const descriptionByCategory: Record<typeof category, string> = {
    Furniture: 'Northstar office desk regression',
    Equipment: 'Northstar network equipment regression',
    Vehicle: 'Northstar service vehicle regression',
  };
  const accountByCategory: Record<typeof category, string> = {
    Furniture: '1510-FURNITURE',
    Equipment: '1520-EQUIPMENT',
    Vehicle: '1530-VEHICLE',
  };
  return {
    rowId: `REG-${category.toUpperCase()}`,
    assetId: `FA-REG-${category.toUpperCase()}`,
    description: descriptionByCategory[category],
    category,
    acquisitionDate: '2021-01-01',
    inServiceDate: '2021-01-15',
    cost: 60_000,
    usefulLifeMonths: 60,
    method: 'straight-line',
    accumulatedDepreciation: 0,
    recordedMonthlyDepreciation: 1_000,
    glAccount: accountByCategory[category],
    department: 'Operations',
  };
}

function testCase(
  id: string,
  title: string,
  group: EvaluationCase['group'],
  expected: EvaluationCase['expected'],
  actual: EvaluationCase['actual'],
  passed: boolean,
): EvaluationCase {
  return { id, title, group, expected, actual, passed };
}

function cents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100);
}

function categoryRuleChanged(before: Policy, candidate: Policy, category: Category): boolean {
  if (category === 'Laptop' || category === 'Unknown') return false;
  const beforeRule = before.categoryRules?.[category] ?? {};
  const candidateRule = candidate.categoryRules?.[category] ?? {};
  return beforeRule.threshold !== candidateRule.threshold
    || beforeRule.usefulLifeMonths !== candidateRule.usefulLifeMonths
    || beforeRule.start !== candidateRule.start;
}

function configuredCategoryCases(before: Policy, candidate: Policy): EvaluationCase[] {
  const categories = new Set<GovernedCategory>([
    ...(Object.keys(before.categoryRules ?? {}) as GovernedCategory[]),
    ...(Object.keys(candidate.categoryRules ?? {}) as GovernedCategory[]),
  ]);
  const cases: EvaluationCase[] = [];
  for (const category of categories) {
    const base = retainedCategoryFixture(category);
    const resolved = resolveCategoryPolicy(candidate, base);
    const isValid = Number.isFinite(resolved.threshold)
      && resolved.threshold >= 0
      && Number.isInteger(resolved.usefulLifeMonths)
      && resolved.usefulLifeMonths > 0
      && resolved.usefulLifeMonths <= 600
      && (resolved.start === 'in-service' || resolved.start === 'following-month');
    cases.push(testCase(
      `category-policy-valid-${category.toLowerCase()}`,
      `${category} policy values are usable`,
      'new',
      true,
      isValid,
      isValid,
    ));

    const thresholdCost = resolved.threshold > 0 ? resolved.threshold : 100;
    const thresholdAsset: Asset = {
      ...base,
      rowId: `REQ-${category.toUpperCase()}-THRESHOLD`,
      assetId: `FA-REQ-${category.toUpperCase()}-THRESHOLD`,
      cost: thresholdCost,
      inServiceDate: '2026-08-15',
      accumulatedDepreciation: 0,
    };
    const thresholdExpected = isValid && thresholdCost >= resolved.threshold
      ? Math.round((thresholdCost / resolved.usefulLifeMonths + Number.EPSILON) * 100) / 100
      : -1;
    const thresholdActual = calculateMonthly(thresholdAsset, candidate, EVALUATION_PERIOD);
    cases.push(testCase(
      `category-policy-threshold-${category.toLowerCase()}`,
      `${category} depreciates at its resolved threshold`,
      'new',
      thresholdExpected,
      thresholdActual,
      cents(thresholdActual) === cents(thresholdExpected),
    ));

    const scheduledCost = Math.max(30_000, resolved.threshold + 1);
    const scheduleAsset: Asset = {
      ...base,
      rowId: `REQ-${category.toUpperCase()}-LIFE`,
      assetId: `FA-REQ-${category.toUpperCase()}-LIFE`,
      cost: scheduledCost,
      inServiceDate: '2026-08-15',
      accumulatedDepreciation: 0,
    };
    const scheduleExpected = isValid
      ? Math.round((scheduledCost / resolved.usefulLifeMonths + Number.EPSILON) * 100) / 100
      : -1;
    const scheduleActual = calculateMonthly(scheduleAsset, candidate, EVALUATION_PERIOD);
    cases.push(testCase(
      `category-policy-life-${category.toLowerCase()}`,
      `${category} uses its resolved useful life`,
      'new',
      scheduleExpected,
      scheduleActual,
      cents(scheduleActual) === cents(scheduleExpected),
    ));

    const serviceMonthAsset: Asset = {
      ...scheduleAsset,
      rowId: `REQ-${category.toUpperCase()}-START`,
      assetId: `FA-REQ-${category.toUpperCase()}-START`,
      inServiceDate: '2026-09-15',
    };
    const serviceMonthExpected = isValid && resolved.start === 'in-service' ? scheduleExpected : 0;
    const serviceMonthActual = calculateMonthly(serviceMonthAsset, candidate, EVALUATION_PERIOD);
    cases.push(testCase(
      `category-policy-start-${category.toLowerCase()}`,
      `${category} follows its resolved depreciation start rule`,
      'new',
      serviceMonthExpected,
      serviceMonthActual,
      cents(serviceMonthActual) === cents(serviceMonthExpected),
    ));
  }
  return cases;
}

function buildCases(
  before: Policy,
  candidate: Policy,
  beforeReconciliation: ReturnType<typeof reconcile>,
  afterReconciliation: ReturnType<typeof reconcile>,
): EvaluationCase[] {
  const cases: EvaluationCase[] = [];
  for (const category of ['Furniture', 'Equipment', 'Vehicle'] as const) {
    if (categoryRuleChanged(before, candidate, category)) continue;
    const asset = retainedCategoryFixture(category);
    const beforeValue = calculateMonthly(asset, before, EVALUATION_PERIOD);
    const afterValue = calculateMonthly(asset, candidate, EVALUATION_PERIOD);
    const expected = 1_000;
    cases.push(testCase(
      `regression-${category.toLowerCase()}`,
      `${category} remains on the existing 60-month schedule`,
      'regression',
      expected,
      afterValue,
      cents(beforeValue) === cents(expected) && cents(afterValue) === cents(expected),
    ));
  }

  const afterRowsByRowId = new Map(afterReconciliation.rows.map((row) => [row.asset.rowId, row]));
  for (const beforeRow of beforeReconciliation.rows) {
    if (beforeRow.asset.category === 'Laptop' || beforeRow.status !== 'matched') continue;
    if (categoryRuleChanged(before, candidate, beforeRow.asset.category)) continue;
    const afterRow = afterRowsByRowId.get(beforeRow.asset.rowId);
    const actualCalculation = afterRow?.calculated ?? 0;
    const actualStatus = afterRow?.status ?? 'missing';
    cases.push(testCase(
      `regression-data-calculation-${beforeRow.asset.rowId}`,
      `Previously matched ${beforeRow.asset.category} asset ${beforeRow.asset.assetId} keeps its calculated amount`,
      'regression',
      beforeRow.calculated,
      actualCalculation,
      afterRow !== undefined && cents(actualCalculation) === cents(beforeRow.calculated),
    ));
    cases.push(testCase(
      `regression-data-status-${beforeRow.asset.rowId}`,
      `Previously matched ${beforeRow.asset.category} asset ${beforeRow.asset.assetId} stays matched`,
      'regression',
      'matched',
      actualStatus,
      actualStatus === 'matched',
    ));
  }

  cases.push(testCase(
    'proposal-laptop-threshold',
    'Laptop capitalization threshold is ฿15,000',
    'new',
    EXPECTED_LAPTOP_THRESHOLD,
    candidate.laptop.threshold,
    cents(candidate.laptop.threshold) === cents(EXPECTED_LAPTOP_THRESHOLD),
  ));
  cases.push(testCase(
    'proposal-laptop-life',
    'Laptop useful life is 36 months',
    'new',
    EXPECTED_LAPTOP_USEFUL_LIFE_MONTHS,
    candidate.laptop.usefulLifeMonths,
    candidate.laptop.usefulLifeMonths === EXPECTED_LAPTOP_USEFUL_LIFE_MONTHS,
  ));
  cases.push(testCase(
    'proposal-laptop-start',
    'Laptop depreciation starts in its service month',
    'new',
    'in-service',
    candidate.laptop.start,
    candidate.laptop.start === 'in-service',
  ));

  const thresholdAsset = laptopFixture('REQ-THRESHOLD', 15_000, '2026-08-01');
  const thresholdActual = calculateMonthly(thresholdAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'laptop-threshold-inclusive',
    'A laptop costing exactly ฿15,000 depreciates',
    'new',
    416.67,
    thresholdActual,
    cents(thresholdActual) === cents(416.67),
  ));

  const usefulLifeAsset = laptopFixture('REQ-LIFE', 36_000, '2026-08-01');
  const usefulLifeActual = calculateMonthly(usefulLifeAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'laptop-36-month-calculation',
    'A ฿36,000 laptop depreciates by ฿1,000 per month',
    'new',
    1_000,
    usefulLifeActual,
    cents(usefulLifeActual) === cents(1_000),
  ));

  const serviceMonthAsset = laptopFixture('REQ-SERVICE-MONTH', 18_000, '2026-09-15');
  const serviceMonthActual = calculateMonthly(serviceMonthAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'laptop-in-service-month',
    'Depreciation begins in the in-service month',
    'new',
    500,
    serviceMonthActual,
    cents(serviceMonthActual) === cents(500),
  ));

  const belowThresholdAsset = laptopFixture('REQ-BELOW-THRESHOLD', 14_999, '2026-08-01');
  const belowThresholdActual = calculateMonthly(belowThresholdAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'laptop-below-threshold',
    'A laptop below the threshold has no depreciation',
    'new',
    0,
    belowThresholdActual,
    cents(belowThresholdActual) === 0,
  ));

  const remainingValueAsset = laptopFixture('REQ-REMAINING-VALUE', 18_000, '2026-08-01', 17_900);
  const remainingValueActual = calculateMonthly(remainingValueAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'remaining-value-cap',
    'Monthly depreciation is capped at the remaining carrying value',
    'new',
    100,
    remainingValueActual,
    cents(remainingValueActual) === cents(100),
  ));

  const futureServiceAsset = laptopFixture('REQ-FUTURE-SERVICE', 18_000, '2026-10-01');
  const futureServiceActual = calculateMonthly(futureServiceAsset, candidate, EVALUATION_PERIOD);
  cases.push(testCase(
    'before-service-month',
    'No depreciation is recorded before the service month',
    'new',
    0,
    futureServiceActual,
    cents(futureServiceActual) === 0,
  ));
  cases.push(...configuredCategoryCases(before, candidate));
  return cases;
}

function makeImpact(rowId: string, assetId: string, before: number, after: number): Impact {
  return {
    rowId,
    assetId,
    before,
    after,
    difference: Math.round((after - before + Number.EPSILON) * 100) / 100,
  };
}

export function evaluateProposal(dataset: Dataset, before: Policy, candidate: Policy): Evaluation {
  const beforeReconciliation = reconcile(dataset, before);
  const afterReconciliation = reconcile(dataset, candidate);
  const beforeByRowId = new Map(beforeReconciliation.rows.map((row) => [row.asset.rowId, row]));
  const impacts = afterReconciliation.rows.flatMap((afterRow) => {
    const beforeRow = beforeByRowId.get(afterRow.asset.rowId);
    if (beforeRow === undefined || cents(beforeRow.calculated) === cents(afterRow.calculated)) return [];
    return [makeImpact(afterRow.asset.rowId, afterRow.asset.assetId, beforeRow.calculated, afterRow.calculated)];
  });
  const cases = buildCases(before, candidate, beforeReconciliation, afterReconciliation);
  const passed = cases.filter((item) => item.passed).length;
  const regressions = cases.filter((item) => item.group === 'regression' && !item.passed).length;
  return {
    cases,
    passed,
    failed: cases.length - passed,
    regressions,
    impacts,
    beforeExceptions: beforeReconciliation.summary.exceptions,
    afterExceptions: afterReconciliation.summary.exceptions,
    ranAt: `${dataset.period}${REPORT_TIMESTAMP_SUFFIX}`,
  };
}
