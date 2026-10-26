/**
 * F080 / JT-X: exporting data and joined results the caller is allowed to export.
 *
 * Two rules shape this module. First, exporting is its own permission: being able to read a
 * projection never implies being able to take a file away. Second, a file is only honest if every
 * value in it comes from the same declared revision set — a CSV that mixes rev 7 rows with rev 9
 * totals is worse than no file.
 */

export const TOOL_EXPORT_LIMITS = {
  maxRows: 5_000,
  maxColumns: 64,
  maxCellChars: 4_000,
  /** Bytes one produced document may take before the export is refused. */
  maxDocumentBytes: 2 * 1024 * 1024,
} as const;

export type ToolExportFormat = 'csv' | 'html';

export interface ToolExportColumn {
  id: string;
  label: string;
  type: 'text' | 'number' | 'boolean';
}

export type ToolExportValue = string | number | boolean | null;

export interface ToolExportTable {
  /** Logical collection name; also the file name stem. */
  id: string;
  title: string;
  columns: ToolExportColumn[];
  rows: { id: string; values: Record<string, ToolExportValue> }[];
}

/** The revisions every file in one export must share. */
export interface ToolExportSnapshot {
  dataRevision: number;
  ruleRevision: number;
  /** Package version per tool whose projections contributed rows. */
  packageVersions: Record<string, number>;
  /** Where each table's rows came from, for the manifest; labels only, never workspace ids. */
  sources: { tableId: string; label: string; dataRevision: number }[];
  readAt: number;
}

export interface ToolExportPermission {
  /** Export is granted by the source, separately from read. */
  granted: boolean;
  /** The grant version the decision was made at; a stale grant may not be used to export. */
  grantVersion: number;
  currentGrantVersion: number;
  /** Fields the export permission covers; anything else is withheld. */
  fields: readonly string[];
}

export type ToolExportProblemCode =
  | 'EXPORT_NOT_PERMITTED'
  | 'EXPORT_REVISION_MISMATCH'
  | 'EXPORT_LIMIT'
  | 'EXPORT_EMPTY';

export type ToolExportResult =
  | {
    ok: true;
    files: { filename: string; format: ToolExportFormat; content: string; bytes: number }[];
    manifest: {
      snapshot: ToolExportSnapshot;
      tables: { id: string; rows: number; withheldFields: string[] }[];
      producedAt: number;
    };
  }
  | { ok: false; code: ToolExportProblemCode; message: string };

/** CSV needs a guard for cells a spreadsheet would treat as a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvCell(value: ToolExportValue, guardFormula = true): string {
  if (value === null) return '';
  let text = typeof value === 'boolean' ? (value ? 'true' : 'false') : String(value);
  if (text.length > TOOL_EXPORT_LIMITS.maxCellChars) text = text.slice(0, TOOL_EXPORT_LIMITS.maxCellChars);
  if (guardFormula && FORMULA_PREFIXES.includes(text.charAt(0))) {
    // Prefix with a quote so a spreadsheet shows the text instead of evaluating it.
    text = `'${text}`;
  }
  if (/[",\r\n]/u.test(text)) return `"${text.replace(/"/gu, '""')}"`;
  return text;
}

function csvHeader(columns: readonly ToolExportColumn[]): string {
  return columns.map(column => escapeCsvCell(column.label, false)).join(',');
}

function csvRows(table: ToolExportTable, columns: readonly ToolExportColumn[]): string[] {
  return table.rows.map(row => columns.map(column => escapeCsvCell(row.values[column.id] ?? null)).join(','));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/gu, character => (
    character === '&' ? '&amp;'
      : character === '<' ? '&lt;'
        : character === '>' ? '&gt;'
          : character === '"' ? '&quot;'
            : '&#39;'
  ));
}

/**
 * UTF-8 BOM: Excel on Windows reads a BOM-less UTF-8 CSV as the ANSI code page, which turns Thai
 * text into mojibake. The BOM is one flag so a caller that knows its consumer can turn it off.
 */
export const CSV_BOM = '\uFEFF';

export function toolExportCsv(table: ToolExportTable, columns: readonly ToolExportColumn[], options: { bom?: boolean } = {}): string {
  const lines = [csvHeader(columns), ...csvRows(table, columns)];
  const body = `${lines.join('\r\n')}\r\n`;
  return options.bom === false ? body : `${CSV_BOM}${body}`;
}

export function toolExportHtml(table: ToolExportTable, columns: readonly ToolExportColumn[], snapshot: ToolExportSnapshot): string {
  const head = columns.map(column => `<th scope="col">${escapeHtml(column.label)}</th>`).join('');
  const body = table.rows.map(row => `<tr>${columns.map(column => {
    const value = row.values[column.id];
    const text = value === null || value === undefined ? '' : String(value);
    return `<td>${escapeHtml(text)}</td>`;
  }).join('')}</tr>`).join('');
  return `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${escapeHtml(table.title)}</title><style>body{font:15px/1.7 system-ui,sans-serif;margin:32px;color:#243548}h1{font-size:22px}table{border-collapse:collapse;width:100%;font-size:13px}td,th{padding:8px;border:1px solid #ccd3d8;text-align:left}caption{text-align:left;padding-bottom:8px;color:#5a6b7b;font-size:12px}</style></head>`
    + `<body><h1>${escapeHtml(table.title)}</h1><table><caption>ข้อมูล revision ${snapshot.dataRevision} · กฎ revision ${snapshot.ruleRevision} · ส่งออกเมื่อ ${new Date(snapshot.readAt).toISOString()}</caption>`
    + `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export interface ToolExportInput {
  tables: readonly ToolExportTable[];
  snapshot: ToolExportSnapshot;
  /** The revision set the caller asked to export; it must equal every table's own revision. */
  requested: { dataRevision: number; ruleRevision: number };
  permission: ToolExportPermission;
  format: ToolExportFormat;
  producedAt: number;
  /** Sets the BOM for CSV; defaults to on. */
  bom?: boolean;
}

/**
 * Build the export.
 *
 * Refusals come before any file is produced: no permission, a stale grant, an empty selection, a
 * revision mismatch between the snapshot and what was requested, or a limit breach.
 */
export function buildToolExport(input: ToolExportInput): ToolExportResult {
  const { permission } = input;
  if (!permission.granted || permission.grantVersion !== permission.currentGrantVersion) {
    return { ok: false, code: 'EXPORT_NOT_PERMITTED', message: 'This export needs its own permission, granted at the current version.' };
  }
  if (input.tables.length === 0) {
    return { ok: false, code: 'EXPORT_EMPTY', message: 'There is nothing selected to export.' };
  }
  if (input.snapshot.dataRevision !== input.requested.dataRevision || input.snapshot.ruleRevision !== input.requested.ruleRevision) {
    return {
      ok: false,
      code: 'EXPORT_REVISION_MISMATCH',
      message: `The export was requested at data ${input.requested.dataRevision}/rules ${input.requested.ruleRevision} but the snapshot is data ${input.snapshot.dataRevision}/rules ${input.snapshot.ruleRevision}.`,
    };
  }
  for (const source of input.snapshot.sources) {
    if (source.dataRevision !== input.snapshot.dataRevision) {
      return {
        ok: false,
        code: 'EXPORT_REVISION_MISMATCH',
        message: `Table "${source.label}" was read at revision ${source.dataRevision}, not ${input.snapshot.dataRevision}.`,
      };
    }
  }

  const files: { filename: string; format: ToolExportFormat; content: string; bytes: number }[] = [];
  const tableReport: { id: string; rows: number; withheldFields: string[] }[] = [];

  for (const table of input.tables) {
    if (table.rows.length > TOOL_EXPORT_LIMITS.maxRows) {
      return { ok: false, code: 'EXPORT_LIMIT', message: `"${table.title}" has ${table.rows.length} rows; the limit is ${TOOL_EXPORT_LIMITS.maxRows}.` };
    }
    if (table.columns.length > TOOL_EXPORT_LIMITS.maxColumns) {
      return { ok: false, code: 'EXPORT_LIMIT', message: `"${table.title}" has ${table.columns.length} columns; the limit is ${TOOL_EXPORT_LIMITS.maxColumns}.` };
    }
    const permitted = table.columns.filter(column => permission.fields.includes(column.id));
    const withheldFields = table.columns.filter(column => !permission.fields.includes(column.id)).map(column => column.id);
    if (permitted.length === 0) {
      return { ok: false, code: 'EXPORT_NOT_PERMITTED', message: `The export permission covers none of the fields of "${table.title}".` };
    }
    const content = input.format === 'csv'
      ? toolExportCsv(table, permitted, { bom: input.bom })
      : toolExportHtml(table, permitted, input.snapshot);
    const bytes = new TextEncoder().encode(content).byteLength;
    if (bytes > TOOL_EXPORT_LIMITS.maxDocumentBytes) {
      return { ok: false, code: 'EXPORT_LIMIT', message: `"${table.title}" produced ${bytes} bytes; the limit is ${TOOL_EXPORT_LIMITS.maxDocumentBytes}.` };
    }
    files.push({ filename: `${table.id}.${input.format}`, format: input.format, content, bytes });
    tableReport.push({ id: table.id, rows: table.rows.length, withheldFields });
  }

  return {
    ok: true,
    files,
    manifest: { snapshot: input.snapshot, tables: tableReport, producedAt: input.producedAt },
  };
}
