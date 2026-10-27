import type { Asset, Category, LedgerEntry } from './types';

export interface SourceConnection {
  id: string;
  kind: 'database' | 'excel';
  name: string;
  resource: string;
  rowCount: number;
  period: string;
  fields: { source: string; target: string }[];
  mode: 'demo-snapshot' | 'local-file';
}

interface DemoDatabaseResult {
  assets: Asset[];
  connection: SourceConnection;
}

interface DemoWorkbookResult {
  ledger: LedgerEntry[];
  connection: SourceConnection;
}

type NumericMarker = { $number: 'NaN' };

const DATABASE_RESOURCE = 'accounting.fixed_assets';
const DATABASE_URL = '/data/northstar-db-snapshot.json';
const WORKBOOK_URL = '/data/general-ledger-2026-09.xlsx';
const WORKBOOK_RESOURCE = 'general-ledger-2026-09.xlsx · GL postings';
const WORKBOOK_SHEET = 'GL postings';
const DEMO_PERIOD = '2026-09';
const DEMO_ASSET_ROW_COUNT = 96;
const DEMO_LEDGER_ROW_COUNT = 96;
const LEDGER_HEADERS = ['id', 'assetId', 'period', 'account', 'amount'] as const;
const ASSET_FIELDS: (keyof Asset)[] = [
  'rowId', 'assetId', 'description', 'category', 'acquisitionDate', 'inServiceDate', 'cost',
  'usefulLifeMonths', 'method', 'accumulatedDepreciation', 'recordedMonthlyDepreciation', 'glAccount', 'department',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string, allowBlank = false): string {
  if (typeof value !== 'string' || (!allowBlank && value.trim() === '')) {
    throw new Error(`Demo source field "${field}" must be ${allowBlank ? 'a string' : 'a non-empty string'}.`);
  }
  return value;
}

function requireNullableString(value: unknown, field: string): string | null {
  if (value === null) return null;
  return requireString(value, field, true);
}

function isNaNMarker(value: unknown): value is NumericMarker {
  return isRecord(value) && value.$number === 'NaN';
}

function requireNumber(value: unknown, field: string, allowNaN = false): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (allowNaN && isNaNMarker(value)) return Number.NaN;
  throw new Error(`Demo source field "${field}" must be a finite number${allowNaN ? ' or the NaN marker' : ''}.`);
}

function requireCategory(value: unknown): Category {
  if (value === 'Laptop' || value === 'Furniture' || value === 'Equipment' || value === 'Vehicle' || value === 'Unknown') {
    return value;
  }
  throw new Error('Demo source field "category" has an unsupported value.');
}

function validateExactKeys(record: Record<string, unknown>, expected: readonly string[], label: string): void {
  const actualKeys = Object.keys(record).sort();
  const expectedKeys = [...expected].sort();
  if (actualKeys.length !== expectedKeys.length || actualKeys.some((key, index) => key !== expectedKeys[index])) {
    throw new Error(`${label} does not match the expected schema.`);
  }
}

function parseSnapshotAsset(value: unknown, index: number): Asset {
  if (!isRecord(value)) throw new Error(`Database snapshot row ${index + 1} must be an object.`);
  validateExactKeys(value, ASSET_FIELDS, `Database snapshot row ${index + 1}`);
  const method = requireString(value.method, 'method');
  if (method !== 'straight-line') throw new Error(`Database snapshot row ${index + 1} has an unsupported method.`);
  const usefulLifeMonths = requireNumber(value.usefulLifeMonths, 'usefulLifeMonths');
  if (!Number.isInteger(usefulLifeMonths)) throw new Error(`Database snapshot row ${index + 1} has an invalid useful life.`);
  return {
    rowId: requireString(value.rowId, 'rowId'),
    assetId: requireString(value.assetId, 'assetId'),
    description: requireString(value.description, 'description', true),
    category: requireCategory(value.category),
    acquisitionDate: requireNullableString(value.acquisitionDate, 'acquisitionDate'),
    inServiceDate: requireNullableString(value.inServiceDate, 'inServiceDate'),
    cost: requireNumber(value.cost, 'cost', true),
    usefulLifeMonths,
    method,
    accumulatedDepreciation: requireNumber(value.accumulatedDepreciation, 'accumulatedDepreciation'),
    recordedMonthlyDepreciation: requireNumber(value.recordedMonthlyDepreciation, 'recordedMonthlyDepreciation'),
    glAccount: requireString(value.glAccount, 'glAccount', true),
    department: requireString(value.department, 'department', true),
  };
}

async function fetchDemoResource(url: string): Promise<Response> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not load bundled demo source (${response.status}).`);
  return response;
}

export async function loadDemoDatabase(): Promise<DemoDatabaseResult> {
  const response = await fetchDemoResource(DATABASE_URL);
  const snapshot: unknown = await response.json();
  if (!isRecord(snapshot)
    || snapshot.snapshotType !== 'bundled-synthetic-demo'
    || snapshot.resource !== DATABASE_RESOURCE
    || snapshot.period !== DEMO_PERIOD
    || !Array.isArray(snapshot.fields)
    || !Array.isArray(snapshot.rows)) {
    throw new Error('Bundled database snapshot metadata or schema is invalid.');
  }

  const declaredFields: unknown[] = snapshot.fields;
  const snapshotRows: unknown[] = snapshot.rows;
  if (declaredFields.length !== ASSET_FIELDS.length
    || declaredFields.some((field, index) => field !== ASSET_FIELDS[index])) {
    throw new Error('Bundled database snapshot field list is invalid.');
  }
  const assets = snapshotRows.map(parseSnapshotAsset);
  if (assets.length !== DEMO_ASSET_ROW_COUNT) {
    throw new Error(`Bundled database snapshot must contain ${DEMO_ASSET_ROW_COUNT} fixed-asset rows.`);
  }
  const rowIds = new Set(assets.map((asset) => asset.rowId));
  if (rowIds.size !== assets.length) throw new Error('Bundled database snapshot contains duplicate rowId values.');

  return {
    assets,
    connection: {
      id: 'northstar-fixed-assets-snapshot',
      kind: 'database',
      name: 'Northstar fixed-assets database snapshot',
      resource: DATABASE_RESOURCE,
      rowCount: assets.length,
      period: DEMO_PERIOD,
      fields: ASSET_FIELDS.map((field) => ({ source: field, target: field })),
      mode: 'demo-snapshot',
    },
  };
}

function parseCellString(value: unknown, field: string, allowBlank = false): string {
  if (allowBlank && (value === null || value === undefined)) return '';
  return requireString(value, field, allowBlank);
}

export function parseLedgerRows(rows: readonly (readonly unknown[])[]): LedgerEntry[] {
  const header = rows[0];
  if (header === undefined
    || header.length !== LEDGER_HEADERS.length
    || LEDGER_HEADERS.some((expected, index) => header[index] !== expected)) {
    throw new Error(`Workbook sheet "${WORKBOOK_SHEET}" must have columns in this order: ${LEDGER_HEADERS.join(', ')}.`);
  }

  const dataRows = rows.slice(1).filter((row) => row.some((value) => value !== null && value !== undefined && value !== ''));
  if (dataRows.length === 0) throw new Error('Workbook sheet "GL postings" has no ledger rows.');
  const ids = new Set<string>();
  let selectedPeriod: string | undefined;
  return dataRows.map((row, index) => {
    if (row.length !== LEDGER_HEADERS.length) throw new Error(`Workbook ledger row ${index + 2} must have exactly five cells.`);
    const id = parseCellString(row[0], 'id');
    const assetId = parseCellString(row[1], 'assetId');
    const period = parseCellString(row[2], 'period');
    const account = parseCellString(row[3], 'account', true);
    const amount = row[4];
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) throw new Error(`Workbook ledger row ${index + 2} has an invalid period.`);
    if (selectedPeriod !== undefined && period !== selectedPeriod) throw new Error('Workbook must contain postings for a single reporting month.');
    if (typeof amount !== 'number' || !Number.isFinite(amount)) throw new Error(`Workbook ledger row ${index + 2} amount must be a finite number.`);
    if (ids.has(id)) throw new Error(`Workbook contains duplicate ledger id "${id}".`);
    ids.add(id);
    selectedPeriod = period;
    return { id, assetId, period, account, amount };
  });
}

export async function readLedgerWorkbook(file: Blob): Promise<LedgerEntry[]> {
  const { readSheet } = await import('read-excel-file/universal');
  const rows = await readSheet(file, WORKBOOK_SHEET);
  return parseLedgerRows(rows);
}

export async function loadDemoWorkbook(): Promise<DemoWorkbookResult> {
  const response = await fetchDemoResource(WORKBOOK_URL);
  const ledger = await readLedgerWorkbook(await response.blob());
  if (ledger.length !== DEMO_LEDGER_ROW_COUNT || ledger.some((entry) => entry.period !== DEMO_PERIOD)) {
    throw new Error(`Bundled general-ledger workbook must contain ${DEMO_LEDGER_ROW_COUNT} ${DEMO_PERIOD} postings.`);
  }
  return {
    ledger,
    connection: {
      id: 'northstar-general-ledger-workbook',
      kind: 'excel',
      name: 'Northstar general-ledger workbook',
      resource: WORKBOOK_RESOURCE,
      rowCount: ledger.length,
      period: DEMO_PERIOD,
      fields: LEDGER_HEADERS.map((field) => ({ source: field, target: field })),
      mode: 'local-file',
    },
  };
}
