import type { Asset, Category, LedgerEntry } from './types';

const ASSET_HEADERS = [
  'rowId',
  'assetId',
  'description',
  'category',
  'acquisitionDate',
  'inServiceDate',
  'cost',
  'usefulLifeMonths',
  'method',
  'accumulatedDepreciation',
  'recordedMonthlyDepreciation',
  'glAccount',
  'department',
] as const;
const LEDGER_HEADERS = ['id', 'assetId', 'period', 'account', 'amount'] as const;
const CATEGORIES: readonly Category[] = ['Laptop', 'Furniture', 'Equipment', 'Vehicle', 'Unknown'];

function parseRecords(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      if (fieldStarted || field !== '') throw new Error('CSV contains a quote inside an unquoted field.');
      quoted = true;
      fieldStarted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
      fieldStarted = false;
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      record.push(field);
      if (!(record.length === 1 && record[0] === '')) records.push(record);
      record = [];
      field = '';
      fieldStarted = false;
    } else {
      field += character;
      fieldStarted = true;
    }
  }

  if (quoted) throw new Error('CSV contains an unterminated quoted field.');
  if (record.length > 0 || field !== '' || fieldStarted) {
    record.push(field);
    if (!(record.length === 1 && record[0] === '')) records.push(record);
  }
  return records;
}

function requireHeaders(records: string[][], expected: readonly string[], kind: string): string[][] {
  const header = records[0];
  if (header === undefined) throw new Error(`${kind} CSV is empty; expected a header row.`);
  if (new Set(header).size !== header.length) throw new Error(`${kind} CSV contains duplicate column names.`);
  const actual = header.join('\u0000');
  const expectedValue = expected.join('\u0000');
  if (actual !== expectedValue) {
    throw new Error(`${kind} CSV columns must be: ${expected.join(', ')}.`);
  }
  const rows = records.slice(1);
  for (const [index, row] of rows.entries()) {
    if (row.length !== expected.length) {
      throw new Error(`${kind} CSV row ${index + 2} has ${row.length} values; expected ${expected.length}.`);
    }
  }
  return rows;
}

function requiredText(value: string, column: string, rowNumber: number): string {
  if (value.trim() === '') throw new Error(`CSV row ${rowNumber}: ${column} is required.`);
  return value;
}

function parseFiniteNumber(value: string, column: string, rowNumber: number): number {
  if (value.trim() === '') throw new Error(`CSV row ${rowNumber}: ${column} is required.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`CSV row ${rowNumber}: ${column} must be a finite number.`);
  return parsed;
}

function recordByHeader(headers: readonly string[], values: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((header, index) => {
    record[header] = values[index] ?? '';
  });
  return record;
}

export function parseAssetCSV(text: string): Asset[] {
  const records = parseRecords(text);
  const rows = requireHeaders(records, ASSET_HEADERS, 'Asset');
  const assets: Asset[] = rows.map((values, index) => {
    const rowNumber = index + 2;
    const row = recordByHeader(ASSET_HEADERS, values);
    const category = row.category as Category;
    if (!CATEGORIES.includes(category)) {
      throw new Error(`CSV row ${rowNumber}: category must be one of ${CATEGORIES.join(', ')}.`);
    }
    if (row.method !== 'straight-line') {
      throw new Error(`CSV row ${rowNumber}: method must be straight-line.`);
    }
    return {
      rowId: requiredText(row.rowId, 'rowId', rowNumber),
      assetId: requiredText(row.assetId, 'assetId', rowNumber),
      description: row.description,
      category,
      acquisitionDate: row.acquisitionDate === '' ? null : row.acquisitionDate,
      inServiceDate: row.inServiceDate === '' ? null : row.inServiceDate,
      cost: parseFiniteNumber(row.cost, 'cost', rowNumber),
      usefulLifeMonths: parseFiniteNumber(row.usefulLifeMonths, 'usefulLifeMonths', rowNumber),
      method: 'straight-line',
      accumulatedDepreciation: parseFiniteNumber(row.accumulatedDepreciation, 'accumulatedDepreciation', rowNumber),
      recordedMonthlyDepreciation: parseFiniteNumber(row.recordedMonthlyDepreciation, 'recordedMonthlyDepreciation', rowNumber),
      glAccount: row.glAccount,
      department: row.department,
    };
  });
  const firstRowById = new Map<string, number>();
  for (const [index, asset] of assets.entries()) {
    const rowNumber = index + 2;
    const normalizedRowId = asset.rowId.trim();
    const firstRow = firstRowById.get(normalizedRowId);
    if (firstRow !== undefined) {
      throw new Error(`Asset CSV row ${rowNumber}: duplicate rowId "${asset.rowId}" (first seen on row ${firstRow}).`);
    }
    firstRowById.set(normalizedRowId, rowNumber);
  }
  return assets;
}

export function parseLedgerCSV(text: string): LedgerEntry[] {
  const records = parseRecords(text);
  const rows = requireHeaders(records, LEDGER_HEADERS, 'Ledger');
  return rows.map((values, index) => {
    const rowNumber = index + 2;
    const row = recordByHeader(LEDGER_HEADERS, values);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(row.period)) {
      throw new Error(`CSV row ${rowNumber}: period must use YYYY-MM format.`);
    }
    return {
      id: requiredText(row.id, 'id', rowNumber),
      assetId: requiredText(row.assetId, 'assetId', rowNumber),
      period: row.period,
      account: row.account,
      amount: parseFiniteNumber(row.amount, 'amount', rowNumber),
    };
  });
}

function cellValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (typeof value === 'string') {
    text = /^[\s\u0000-\u001f]*[=+\-@]/.test(value) ? `'${value}` : value;
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('CSV cannot export a non-finite number.');
    text = String(value);
  } else if (typeof value === 'boolean' || typeof value === 'bigint') {
    text = String(value);
  } else {
    const serialized = JSON.stringify(value);
    text = serialized ?? '';
    if (/^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCSV(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const headers = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  const lines = [headers.map((header) => cellValue(header)).join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => cellValue(row[header])).join(','));
  }
  return lines.join('\r\n');
}
