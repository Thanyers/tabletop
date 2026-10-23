import type { TableField, TableValue } from '../shared/table-contracts';

export interface CsvTable { headers: string[]; rows: string[][] }

/** Converts the selected first worksheet to the same bounded text cells as CSV import. */
export function worksheetToCsvTable(sheet: readonly (readonly unknown[])[]): CsvTable {
  const [headerRow = [], ...body] = sheet;
  const headers = headerRow.map(cellText).map((value) => value.trim());
  const rows = body
    .filter((row) => row.some((value) => cellText(value).trim().length > 0))
    .map((row) => headers.map((_, index) => cellText(row[index])));
  return { headers, rows };
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'boolean') return String(value);
  return '';
}

/** RFC 4180 style parser: quotes, escaped quotes, commas and newlines inside quotes, CRLF, BOM. */
export function parseCsv(text: string): CsvTable {
  const source = text.replace(/^\uFEFF/u, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"' && field.length === 0) { quoted = true; continue; }
    if (char === ',') { row.push(field); field = ''; continue; }
    if (char === '\r') { continue; }
    if (char === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += char;
  }
  row.push(field);
  rows.push(row);
  const cleaned = rows.filter((cells) => cells.some((cell) => cell.trim().length > 0));
  const [headers = [], ...body] = cleaned;
  return { headers: headers.map((header) => header.trim()), rows: body };
}

export function normalizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/gu, '');
}

/** Maps each CSV column to a field id by exact id or label (case/space/underscore-insensitive). */
export function autoMapping(headers: string[], fields: TableField[]): Record<number, string> {
  const mapping: Record<number, string> = {};
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const normalized = normalizeHeader(header);
    const field = fields.find((item) => !used.has(item.id)
      && (normalizeHeader(item.id) === normalized || normalizeHeader(item.label) === normalized));
    if (field) { mapping[index] = field.id; used.add(field.id); }
  });
  return mapping;
}

export function cellValue(field: TableField, raw: string): { ok: true; value: TableValue } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (trimmed === '') {
    if (field.default !== undefined) return { ok: true, value: structuredClone(field.default) };
    if (field.required) return { ok: false, message: `${field.label} is required.` };
    return { ok: true, value: null };
  }
  if (field.type === 'number') {
    const value = Number(trimmed);
    if (!Number.isFinite(value) || Math.abs(value) > 1e9) return { ok: false, message: `${field.label} must be a number.` };
    if (field.min !== undefined && value < field.min) return { ok: false, message: `${field.label} must be at least ${field.min}.` };
    if (field.max !== undefined && value > field.max) return { ok: false, message: `${field.label} must be at most ${field.max}.` };
    return { ok: true, value };
  }
  if (field.type === 'boolean') {
    const lower = trimmed.toLowerCase();
    if (['true', 'yes', '1', 'y'].includes(lower)) return { ok: true, value: true };
    if (['false', 'no', '0', 'n'].includes(lower)) return { ok: true, value: false };
    return { ok: false, message: `${field.label} must be true or false.` };
  }
  if (field.type === 'list') {
    if (field.choices) {
      for (const item of trimmed.split('|')) {
        if (!field.choices.includes(item.trim())) return { ok: false, message: `${field.label} contains a value that is not offered.` };
      }
    }
    return { ok: true, value: trimmed.split('|').map((item) => item.trim()).filter(Boolean) };
  }
  if (field.choices && !field.choices.includes(trimmed)) return { ok: false, message: `${field.label} must be one of the offered values.` };
  return { ok: true, value: trimmed };
}

export interface ImportPreview {
  rows: Record<string, TableValue>[];
  invalid: { row: number; message: string }[];
  ignoredHeaders: string[];
}

/** Builds the typed rows for `table.importRows`; the server still validates every value. */
export function buildImportRows(table: CsvTable, mapping: Record<number, string>, fields: TableField[]): ImportPreview {
  const invalid: ImportPreview['invalid'] = [];
  const rows: Record<string, TableValue>[] = [];
  table.rows.forEach((cells, index) => {
    const values: Record<string, TableValue> = {};
    const problems: string[] = [];
    for (const field of fields) {
      const entry = Object.entries(mapping).find(([, fieldId]) => fieldId === field.id);
      const raw = entry ? cells[Number(entry[0])] ?? '' : '';
      const result = cellValue(field, raw);
      if (result.ok) values[field.id] = result.value;
      else problems.push(result.message);
    }
    if (problems.length > 0) invalid.push({ row: index + 1, message: problems.join(' ') });
    else rows.push(values);
  });
  const ignoredHeaders = table.headers.filter((_, index) => !mapping[index]);
  return { rows, invalid, ignoredHeaders };
}
