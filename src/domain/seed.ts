import type { Asset, Category, Dataset, LedgerEntry, Policy } from './types';
import { calculateMonthly } from './accounting';

const CREATED_AT = '2026-09-01T00:00:00.000Z';
const ASSET_ROW_COUNT = 96;
const LAPTOP_ASSET_COUNT = 24;
const MONTHS_PER_YEAR = 12;
const SERVICE_DAY_RANGE = 27;
const ACCUMULATED_DEPRECIATION_PERCENT = 30;
const PERCENTAGE_SCALE = 100;
const DEFAULT_USEFUL_LIFE_MONTHS = 60;
const LAPTOP_USEFUL_LIFE_MONTHS = 36;
const SAMPLE_START_PERIOD = '2026-09';
const BASE_LAPTOP_COST = 9_000;
const LAPTOP_COST_STEP = 3_791;
const LAPTOP_COST_VARIANCE = 50_000;
const BASE_FURNITURE_COST = 12_000;
const FURNITURE_COST_STEP = 1_731;
const FURNITURE_COST_VARIANCE = 88_000;
const BASE_EQUIPMENT_COST = 15_000;
const EQUIPMENT_COST_STEP = 2_317;
const EQUIPMENT_COST_VARIANCE = 110_000;
const BASE_VEHICLE_COST = 35_000;
const VEHICLE_COST_STEP = 11_003;
const VEHICLE_COST_VARIANCE = 265_000;
const LEDGER_ACCOUNT_BY_CATEGORY: Record<Exclude<Category, 'Unknown'>, string> = {
  Laptop: '1500-LAPTOP',
  Furniture: '1510-FURNITURE',
  Equipment: '1520-EQUIPMENT',
  Vehicle: '1530-VEHICLE',
};
const DEPARTMENTS = ['Finance', 'Operations', 'People', 'Technology'] as const;

export const BASE_POLICY: Policy = {
  version: 1,
  defaultThreshold: 20_000,
  laptop: {
    threshold: 20_000,
    usefulLifeMonths: DEFAULT_USEFUL_LIFE_MONTHS,
    start: 'following-month',
  },
  createdAt: CREATED_AT,
  source: 'synthetic-seed',
};
Object.freeze(BASE_POLICY.laptop);
Object.freeze(BASE_POLICY);

const EMBEDDED_V2_POLICY: Policy = {
  version: 2,
  defaultThreshold: 20_000,
  laptop: {
    threshold: 15_000,
    usefulLifeMonths: LAPTOP_USEFUL_LIFE_MONTHS,
    start: 'in-service',
  },
  createdAt: '2026-09-01T00:00:00.000Z',
  source: 'synthetic-ledger',
  parentVersion: 1,
};

function periodStart(period: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) throw new Error(`Invalid period "${period}". Expected YYYY-MM.`);
  return Number(match[1]) * MONTHS_PER_YEAR + Number(match[2]) - 1;
}

function accountFor(category: Category): string {
  return category === 'Unknown' ? '' : LEDGER_ACCOUNT_BY_CATEGORY[category];
}

function categoryFor(index: number): Category {
  if (index <= LAPTOP_ASSET_COUNT) return 'Laptop';
  const retained: Exclude<Category, 'Laptop' | 'Unknown'>[] = ['Furniture', 'Equipment', 'Vehicle'];
  return retained[(index - 25) % retained.length];
}

function descriptionFor(category: Category, index: number): string {
  if (category === 'Unknown') return `Northstar Laptop ${String(index).padStart(3, '0')}`;
  const labelByCategory: Record<Category, string> = {
    Laptop: 'Laptop',
    Furniture: 'Office desk',
    Equipment: 'Network equipment',
    Vehicle: 'Service vehicle',
    Unknown: 'Unclassified asset',
  };
  return `Northstar ${labelByCategory[category]} ${String(index).padStart(3, '0')}`;
}

function dateFor(index: number): { acquisitionDate: string | null; inServiceDate: string | null } {
  const serviceYear = 2022 + (index % 4);
  const serviceMonth = ((index * 5) % MONTHS_PER_YEAR) + 1;
  const serviceDay = ((index * 7) % SERVICE_DAY_RANGE) + 1;
  const month = String(serviceMonth).padStart(2, '0');
  const day = String(serviceDay).padStart(2, '0');
  return {
    acquisitionDate: `${serviceYear - 1}-${month}-${day}`,
    inServiceDate: `${serviceYear}-${month}-${day}`,
  };
}

function costFor(category: Category, index: number): number {
  if (category === 'Laptop') return BASE_LAPTOP_COST + ((index * LAPTOP_COST_STEP) % LAPTOP_COST_VARIANCE);
  if (category === 'Furniture') return BASE_FURNITURE_COST + ((index * FURNITURE_COST_STEP) % FURNITURE_COST_VARIANCE);
  if (category === 'Equipment' || category === 'Unknown') return BASE_EQUIPMENT_COST + ((index * EQUIPMENT_COST_STEP) % EQUIPMENT_COST_VARIANCE);
  return BASE_VEHICLE_COST + ((index * VEHICLE_COST_STEP) % VEHICLE_COST_VARIANCE);
}

function createAsset(index: number, period: string): Asset {
  let category = categoryFor(index);
  const description = descriptionFor(category, index);
  let { acquisitionDate, inServiceDate } = dateFor(index);
  let cost = costFor(category, index);
  let usefulLifeMonths = category === 'Laptop' ? LAPTOP_USEFUL_LIFE_MONTHS : DEFAULT_USEFUL_LIFE_MONTHS;
  let glAccount = accountFor(category);
  let recordedMonthlyDepreciation = 0;
  let accumulatedDepreciation = Math.round(cost * ACCUMULATED_DEPRECIATION_PERCENT) / PERCENTAGE_SCALE;
  const rowId = `ROW-${String(index).padStart(3, '0')}`;
  const assetId = index === 18 ? 'FA-017' : `FA-${String(index).padStart(3, '0')}`;

  if (index === 1) {
    cost = 18_000;
    acquisitionDate = '2024-09-01';
    inServiceDate = '2026-09-01';
    accumulatedDepreciation = 0;
  }
  if (index === 2) {
    cost = 24_000;
    acquisitionDate = '2024-08-01';
    inServiceDate = '2026-08-15';
    accumulatedDepreciation = 0;
  }
  if (index === 3) {
    cost = 15_000;
    acquisitionDate = '2026-08-20';
    inServiceDate = '2026-09-30';
    accumulatedDepreciation = 0;
  }
  if (index === 4) {
    cost = 14_999;
    acquisitionDate = '2026-08-20';
    inServiceDate = '2026-09-01';
    accumulatedDepreciation = 0;
  }
  if (index === 8) acquisitionDate = null;
  if (index === 9) inServiceDate = null;
  if (index === 10) acquisitionDate = '2026-02-30';
  if (index === 11) category = 'Unknown';
  if (index === 14) glAccount = '';
  if (index === 15) glAccount = '9999-SUSPENSE';
  if (index === 16) usefulLifeMonths = 12;
  if (index === 19) cost = -500;
  if (index === 20) cost = Number.NaN;
  if (index === 31) cost = 19_000;
  if (index === 27) return {
    rowId,
    assetId,
    description: `Northstar Laptop ${String(index).padStart(3, '0')}`,
    category: 'Equipment',
    acquisitionDate,
    inServiceDate,
    cost,
    usefulLifeMonths,
    method: 'straight-line',
    accumulatedDepreciation,
    recordedMonthlyDepreciation,
    glAccount,
    department: DEPARTMENTS[(index - 1) % DEPARTMENTS.length],
  };

  if (index === ASSET_ROW_COUNT) accumulatedDepreciation = 0;
  if (period === '2026-10' && index === ASSET_ROW_COUNT) {
    acquisitionDate = '2026-10-01';
    inServiceDate = '2026-10-01';
  } else if (index === ASSET_ROW_COUNT) {
    acquisitionDate = '2026-09-01';
    inServiceDate = '2026-09-01';
  }

  return {
    rowId,
    assetId,
    description,
    category,
    acquisitionDate,
    inServiceDate,
    cost,
    usefulLifeMonths,
    method: 'straight-line',
    accumulatedDepreciation,
    recordedMonthlyDepreciation,
    glAccount,
    department: DEPARTMENTS[(index - 1) % DEPARTMENTS.length],
  };
}

export function createDataset(period = '2026-09'): Dataset {
  const selectedPeriod = periodStart(period);
  if (selectedPeriod < periodStart(SAMPLE_START_PERIOD)) {
    throw new Error(`Synthetic Northstar data is available from ${SAMPLE_START_PERIOD} onward.`);
  }
  const assets = Array.from({ length: ASSET_ROW_COUNT }, (_, offset) => createAsset(offset + 1, period));
  const ledger: LedgerEntry[] = [];

  for (const asset of assets) {
    const embeddedAmount = calculateMonthly(asset, EMBEDDED_V2_POLICY, period);
    const recordedMonthlyDepreciation = asset.rowId === 'ROW-025'
      ? 0
      : asset.rowId === 'ROW-031'
        ? 250
        : embeddedAmount;
    asset.recordedMonthlyDepreciation = recordedMonthlyDepreciation;
    if (asset.rowId === 'ROW-022') continue;

    const entryAccount = asset.rowId === 'ROW-015'
      ? accountFor(asset.category)
      : asset.glAccount;
    ledger.push({
      id: `LEDGER-${asset.rowId}-${period}`,
      assetId: asset.assetId,
      period,
      account: entryAccount,
      amount: asset.rowId === 'ROW-031' ? 250 : embeddedAmount,
    });

    if (asset.rowId === 'ROW-023') {
      ledger.push({
        id: `LEDGER-${asset.rowId}-ALT-${period}`,
        assetId: asset.assetId,
        period,
        account: '9999-SUSPENSE',
        amount: 0,
      });
    }
  }

  return {
    id: `northstar-${period}`,
    name: `Northstar fixed assets — ${period}`,
    period,
    assets,
    ledger,
    source: 'synthetic',
  };
}
