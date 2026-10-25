import type { Asset, Category, Dataset, Finding, Policy, Reconciliation } from './types';
import { resolveCategoryPolicy } from './policy';

const CENTS_PER_UNIT = 100;
const MONEY_TOLERANCE_CENTS = 1;
const MONTHS_PER_YEAR = 12;
const MAX_SUPPORTED_USEFUL_LIFE_MONTHS = 600;
const STANDARD_USEFUL_LIFE_MONTHS = 60;
const EXPECTED_ACCOUNT_BY_CATEGORY: Partial<Record<Category, string>> = {
  Laptop: '1500-LAPTOP',
  Furniture: '1510-FURNITURE',
  Equipment: '1520-EQUIPMENT',
  Vehicle: '1530-VEHICLE',
};

interface ParsedPeriod {
  year: number;
  month: number;
}

function parsePeriod(period: string): ParsedPeriod | null {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]) };
}

function parseDate(value: string | null): Date | null {
  if (value === null) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;
  return date;
}

function amountInCents(amount: number): number | null {
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round((amount + Number.EPSILON) * CENTS_PER_UNIT);
  return Number.isSafeInteger(cents) ? cents : null;
}

function fromCents(cents: number): number {
  return cents / CENTS_PER_UNIT;
}

function monthIndex(date: Date): number {
  return date.getUTCFullYear() * MONTHS_PER_YEAR + date.getUTCMonth();
}

function isUsableLife(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= MAX_SUPPORTED_USEFUL_LIFE_MONTHS;
}

function isAmountMismatch(left: number, right: number): boolean {
  const leftCents = amountInCents(left);
  const rightCents = amountInCents(right);
  if (leftCents === null || rightCents === null) return true;
  return Math.abs(leftCents - rightCents) > MONEY_TOLERANCE_CENTS;
}

function expectedCategory(description: string): Category | null {
  const normalized = description.toLowerCase();
  if (/\b(laptop|notebook)\b/.test(normalized)) return 'Laptop';
  if (/\b(desk|chair|furniture|cabinet|table)\b/.test(normalized)) return 'Furniture';
  if (/\b(vehicle|car|van|truck)\b/.test(normalized)) return 'Vehicle';
  if (/\b(equipment|printer|monitor|network|machine)\b/.test(normalized)) return 'Equipment';
  return null;
}

function addFinding(findings: Finding[], code: string, message: string, severity: Finding['severity'] = 'warning'): void {
  if (findings.some((finding) => finding.code === code)) return;
  findings.push({ code, message, severity });
}

export function calculateMonthly(asset: Asset, policy: Policy, period: string): number {
  const parsedPeriod = parsePeriod(period);
  const inServiceDate = parseDate(asset.inServiceDate);
  const costCents = amountInCents(asset.cost);
  const accumulatedCents = amountInCents(asset.accumulatedDepreciation);
  const categoryPolicy = resolveCategoryPolicy(policy, asset);
  const thresholdCents = amountInCents(categoryPolicy.threshold);
  const usefulLifeMonths = categoryPolicy.usefulLifeMonths;

  if (
    parsedPeriod === null
    || inServiceDate === null
    || costCents === null
    || accumulatedCents === null
    || thresholdCents === null
    || costCents < 0
    || accumulatedCents < 0
    || thresholdCents < 0
    || !isUsableLife(usefulLifeMonths)
    || asset.method !== 'straight-line'
  ) return 0;

  if (costCents < thresholdCents || costCents === 0) return 0;

  const serviceMonth = monthIndex(inServiceDate);
  const reportMonth = parsedPeriod.year * MONTHS_PER_YEAR + parsedPeriod.month - 1;
  const effectiveStartMonth = categoryPolicy.start === 'in-service'
    ? serviceMonth
    : serviceMonth + 1;
  if (reportMonth < effectiveStartMonth) return 0;

  const remainingCents = Math.max(0, costCents - accumulatedCents);
  if (remainingCents === 0) return 0;

  const monthlyCents = Math.round(costCents / usefulLifeMonths);
  if (!Number.isSafeInteger(monthlyCents) || monthlyCents <= 0) return 0;
  return fromCents(Math.min(monthlyCents, remainingCents));
}

export function reconcile(dataset: Dataset, policy: Policy): Reconciliation {
  const selectedEntries = dataset.ledger.filter((entry) => entry.period === dataset.period);
  const assetIds = new Set(dataset.assets.map((asset) => asset.assetId));
  const ledgerFindings = selectedEntries
    .filter((entry) => !assetIds.has(entry.assetId))
    .map((entry) => ({
      entry,
      finding: {
        code: 'orphan-ledger-entry',
        message: `No asset record exists for ledger asset ID ${entry.assetId} in period ${dataset.period}.`,
        severity: 'error' as const,
      },
    }));
  const seenLedgerIds = new Set<string>();
  const uniqueLedgerEntries: typeof selectedEntries = [];
  const duplicateLedgerIds = new Set<string>();
  const ledgerIds = new Set<string>();
  for (const entry of selectedEntries) {
    if (entry.id.trim() === '') {
      uniqueLedgerEntries.push(entry);
      continue;
    }
    if (ledgerIds.has(entry.id)) duplicateLedgerIds.add(entry.id);
    ledgerIds.add(entry.id);
    if (!seenLedgerIds.has(entry.id)) {
      seenLedgerIds.add(entry.id);
      uniqueLedgerEntries.push(entry);
    }
  }

  const assetIdCounts = new Map<string, number>();
  const rowIdCounts = new Map<string, number>();
  for (const asset of dataset.assets) {
    if (asset.assetId.trim() !== '') assetIdCounts.set(asset.assetId, (assetIdCounts.get(asset.assetId) ?? 0) + 1);
    if (asset.rowId.trim() !== '') rowIdCounts.set(asset.rowId, (rowIdCounts.get(asset.rowId) ?? 0) + 1);
  }
  const ledgerByAsset = new Map<string, typeof uniqueLedgerEntries>();
  for (const entry of uniqueLedgerEntries) {
    const entries = ledgerByAsset.get(entry.assetId) ?? [];
    entries.push(entry);
    ledgerByAsset.set(entry.assetId, entries);
  }
  const duplicateEntryAssets = new Set(
    selectedEntries.filter((entry) => duplicateLedgerIds.has(entry.id)).map((entry) => entry.assetId),
  );

  const rows = dataset.assets.map((asset) => {
    const findings: Finding[] = [];
    const categoryPolicy = resolveCategoryPolicy(policy, asset);
    const calculated = calculateMonthly(asset, policy, dataset.period);
    const recorded = asset.recordedMonthlyDepreciation;
    const matchingEntries = ledgerByAsset.get(asset.assetId) ?? [];
    const accountNames = new Set(matchingEntries.map((entry) => entry.account.trim()).filter((account) => account !== ''));
    const hasBlankLedgerAccount = matchingEntries.some((entry) => entry.account.trim() === '');
    const hasDuplicateAssetId = asset.assetId.trim() !== '' && (assetIdCounts.get(asset.assetId) ?? 0) > 1;
    const hasDuplicateRowId = asset.rowId.trim() !== '' && (rowIdCounts.get(asset.rowId) ?? 0) > 1;
    const expectedAccount = EXPECTED_ACCOUNT_BY_CATEGORY[asset.category];
    let ledgerAmount: number | null = null;

    if (asset.rowId.trim() === '') addFinding(findings, 'missing-row-id', 'Asset row identifier is missing.', 'error');
    if (hasDuplicateRowId) addFinding(findings, 'duplicate-row-id', 'Asset row identifier is shared by more than one asset row.', 'error');
    if (asset.assetId.trim() === '') addFinding(findings, 'missing-asset-id', 'Asset identifier is missing.', 'error');
    if (hasDuplicateAssetId) addFinding(findings, 'duplicate-asset-id', 'Asset identifier is shared by more than one asset row.', 'error');

    if (asset.acquisitionDate === null) {
      addFinding(findings, 'missing-acquisition-date', 'Acquisition date is missing.');
    } else if (parseDate(asset.acquisitionDate) === null) {
      addFinding(findings, 'invalid-acquisition-date', 'Acquisition date is not a valid calendar date.', 'error');
    }
    if (asset.inServiceDate === null) {
      addFinding(findings, 'missing-in-service-date', 'In-service date is missing.');
    } else if (parseDate(asset.inServiceDate) === null) {
      addFinding(findings, 'invalid-in-service-date', 'In-service date is not a valid calendar date.', 'error');
    }
    const acquisitionDate = parseDate(asset.acquisitionDate);
    const inServiceDate = parseDate(asset.inServiceDate);
    if (acquisitionDate !== null && inServiceDate !== null && acquisitionDate.getTime() > inServiceDate.getTime()) {
      addFinding(findings, 'service-before-acquisition', 'In-service date occurs before acquisition date.', 'error');
    }

    if (asset.category === 'Unknown') addFinding(findings, 'missing-category', 'Asset category is not classified.');
    const descriptionCategory = expectedCategory(asset.description);
    if (descriptionCategory !== null && descriptionCategory !== asset.category) {
      addFinding(findings, 'category-description-mismatch', `Description suggests ${descriptionCategory}, but the recorded category is ${asset.category}.`);
    }

    const costCents = amountInCents(asset.cost);
    if (costCents === null) addFinding(findings, 'invalid-cost', 'Asset cost is not a finite, safely representable amount.', 'error');
    else if (costCents < 0) addFinding(findings, 'negative-cost', 'Asset cost cannot be negative.', 'error');
    const accumulatedCents = amountInCents(asset.accumulatedDepreciation);
    if (accumulatedCents === null) addFinding(findings, 'invalid-accumulated-depreciation', 'Accumulated depreciation is not a finite, safely representable amount.', 'error');
    else if (accumulatedCents < 0) addFinding(findings, 'negative-accumulated-depreciation', 'Accumulated depreciation cannot be negative.', 'error');
    else if (costCents !== null && accumulatedCents > costCents) {
      addFinding(findings, 'accumulated-exceeds-cost', 'Accumulated depreciation exceeds asset cost.', 'error');
    }

    const recordedCents = amountInCents(recorded);
    if (recordedCents === null) addFinding(findings, 'invalid-recorded-depreciation', 'Recorded monthly depreciation is not a finite, safely representable amount.', 'error');
    else if (recordedCents < 0) addFinding(findings, 'negative-recorded-depreciation', 'Recorded monthly depreciation cannot be negative.', 'error');

    if (
      !Number.isInteger(asset.usefulLifeMonths)
      || asset.usefulLifeMonths <= 0
      || asset.usefulLifeMonths > MAX_SUPPORTED_USEFUL_LIFE_MONTHS
    ) {
      addFinding(findings, 'abnormal-useful-life', 'Useful life must be a positive whole number of months within the supported range.');
    } else if (asset.category === 'Laptop' && asset.usefulLifeMonths !== categoryPolicy.usefulLifeMonths) {
      addFinding(findings, 'abnormal-useful-life', `Laptop useful life differs from the active policy (${categoryPolicy.usefulLifeMonths} months).`);
    } else if (asset.category !== 'Laptop' && asset.category !== 'Unknown') {
      const configuredLife = policy.categoryRules?.[asset.category]?.usefulLifeMonths;
      const expectedLife = configuredLife ?? STANDARD_USEFUL_LIFE_MONTHS;
      if (asset.usefulLifeMonths !== expectedLife) {
        const schedule = configuredLife === undefined
          ? `retained ${STANDARD_USEFUL_LIFE_MONTHS}-month schedule`
          : `active ${asset.category} policy (${configuredLife} months)`;
        addFinding(findings, 'abnormal-useful-life', `Useful life differs from the ${schedule}.`);
      }
    }

    const reportPeriod = parsePeriod(dataset.period);
    if (
      reportPeriod !== null
      && inServiceDate !== null
      && costCents !== null
      && costCents >= 0
      && accumulatedCents !== null
      && accumulatedCents >= 0
      && isUsableLife(categoryPolicy.usefulLifeMonths)
    ) {
      const reportMonth = reportPeriod.year * MONTHS_PER_YEAR + reportPeriod.month - 1;
      const effectiveStartMonth = categoryPolicy.start === 'in-service'
        ? monthIndex(inServiceDate)
        : monthIndex(inServiceDate) + 1;
      const remainingCents = Math.max(0, costCents - accumulatedCents);
      if (reportMonth >= effectiveStartMonth + categoryPolicy.usefulLifeMonths && remainingCents > 0) {
        addFinding(
          findings,
          'life-exhausted-with-balance',
          'Useful life has elapsed but carrying value remains; review the catch-up treatment.',
        );
      }
    }

    if (asset.glAccount.trim() === '') addFinding(findings, 'missing-asset-gl-account', 'Asset GL account is missing.');
    if (expectedAccount !== undefined && asset.glAccount.trim() !== '' && asset.glAccount !== expectedAccount) {
      addFinding(findings, 'asset-gl-account-mismatch', `Asset GL account does not match the ${asset.category} account mapping.`);
    }

    if (matchingEntries.length === 0) {
      addFinding(findings, 'missing-ledger-entry', 'No ledger entry exists for this asset and reporting period.');
    } else {
      if (matchingEntries.some((entry) => entry.id.trim() === '')) {
        addFinding(findings, 'missing-ledger-entry-id', 'A matching ledger entry has no identifier.', 'error');
      }
      if (hasBlankLedgerAccount) addFinding(findings, 'missing-ledger-gl-account', 'A matching ledger entry has no GL account.');
      if (accountNames.size > 1) addFinding(findings, 'ambiguous-ledger-gl-account', 'Matching ledger entries use more than one GL account.');
      if (duplicateEntryAssets.has(asset.assetId)) addFinding(findings, 'duplicate-ledger-entry-id', 'A ledger entry identifier is duplicated; the summary counts it once.', 'error');
      for (const entry of matchingEntries) {
        if (expectedAccount !== undefined && entry.account !== expectedAccount) {
          addFinding(findings, 'ledger-category-account-mismatch', `Ledger GL account does not match the ${asset.category} account mapping.`);
        }
        if (asset.glAccount.trim() !== '' && entry.account !== asset.glAccount) {
          addFinding(findings, 'ledger-asset-account-mismatch', 'Ledger GL account differs from the asset record.');
        }
        const entryCents = amountInCents(entry.amount);
        if (entryCents === null) addFinding(findings, 'invalid-ledger-amount', 'Ledger amount is not a finite, safely representable amount.', 'error');
        else if (entryCents < 0) addFinding(findings, 'negative-ledger-amount', 'Ledger amount cannot be negative.', 'error');
      }
      if (!hasDuplicateAssetId && accountNames.size === 1 && !hasBlankLedgerAccount) {
        const validAmounts = matchingEntries.map((entry) => amountInCents(entry.amount));
        if (validAmounts.every((amount): amount is number => amount !== null)) {
          ledgerAmount = fromCents(validAmounts.reduce((total, amount) => total + amount, 0));
        }
      }
    }

    const thresholdCents = amountInCents(categoryPolicy.threshold);
    if (costCents !== null && thresholdCents !== null && costCents < thresholdCents && recordedCents !== null && recordedCents > 0) {
      addFinding(findings, 'depreciated-below-threshold', 'Recorded depreciation exists below the active capitalization threshold.');
    }
    if (recordedCents !== null && recordedCents >= 0 && isAmountMismatch(calculated, recorded)) {
      addFinding(findings, 'recorded-calculation-mismatch', 'Recorded monthly depreciation differs from the active calculation.');
    }
    if (ledgerAmount !== null && recordedCents !== null && isAmountMismatch(ledgerAmount, recorded)) {
      addFinding(findings, 'recorded-ledger-mismatch', 'Recorded depreciation differs from the GL ledger amount.');
    }

    const difference = recordedCents === null || recordedCents < 0
      ? 0
      : fromCents((amountInCents(calculated) ?? 0) - recordedCents);
    return {
      asset,
      calculated,
      recorded,
      ledgerAmount,
      difference,
      findings,
      status: findings.length === 0 ? 'matched' as const : 'review' as const,
      ruleVersion: policy.version,
    };
  });

  const categories = Array.from(new Set(dataset.assets.map((asset) => asset.category))).map((category) => {
    const categoryRows = rows.filter((row) => row.asset.category === category);
    return {
      category,
      calculated: sumValid(categoryRows.map((row) => row.calculated)),
      recorded: sumValid(categoryRows.map((row) => row.recorded)),
      count: categoryRows.length,
    };
  });

  const ledger = sumValid(uniqueLedgerEntries.map((entry) => entry.amount));
  const calculated = sumValid(rows.map((row) => row.calculated));
  const recorded = sumValid(rows.map((row) => row.recorded));
  return {
    rows,
    ledgerFindings,
    summary: {
      totalAssets: dataset.assets.length,
      calculated,
      recorded,
      ledger,
      difference: sumValid(rows.map((row) => Math.abs(row.difference))),
      exceptions: rows.filter((row) => row.status === 'review').length + ledgerFindings.length,
      matched: rows.filter((row) => row.status === 'matched').length,
    },
    categories,
  };
}

function sumValid(values: number[]): number {
  const cents = values.reduce((total, value) => {
    const valueCents = amountInCents(value);
    return valueCents === null ? total : total + valueCents;
  }, 0);
  return fromCents(cents);
}
