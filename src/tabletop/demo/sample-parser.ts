import { encounterRuleSchema } from '../domain/encounter';
import { physicsParamsSchema } from '../domain/physics';
import type { EncounterRule, InvoiceLine, PhysicsParams, Shipment, Zone } from '../shared/contracts';
import type { PracticeFileKind } from './sample-files';

export const MAX_PRACTICE_FILE_BYTES = 128 * 1024;
export const MAX_PRACTICE_FILE_ROWS = 100;
export const MAX_PRACTICE_FILE_EXCERPT = 2_000;

export type ParsedShipment = Pick<Shipment, 'id' | 'zone' | 'date' | 'weightGram' | 'remote'>;
export type ParsedInvoiceLine = Pick<InvoiceLine, 'id' | 'billedSatang' | 'currency'>;

export interface ParsedPracticeRate {
  op: 'setZoneBase' | 'setWeightStep' | 'setSurcharge';
  id: string;
  zone: Zone | '*';
  amountSatang: number;
  from: string;
  to: string | null;
}

export type ParsedPracticeFile =
  | { caseKind: 'invoice'; kind: 'shipments'; excerpt: string; shipments: ParsedShipment[] }
  | { caseKind: 'invoice'; kind: 'invoice'; excerpt: string; invoiceLines: ParsedInvoiceLine[] }
  | { caseKind: 'invoice'; kind: 'rate-card'; excerpt: string; rates: ParsedPracticeRate[] }
  | { caseKind: 'teaching'; kind: 'teaching-lesson'; excerpt: string; parameters: PhysicsParams }
  | { caseKind: 'encounter'; kind: 'encounter-plan'; excerpt: string; rule: EncounterRule; target: 'mira' | 'pip' };

export class PracticeFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PracticeFileError';
  }
}

function safeFilename(filename: string): string {
  const basename = filename.split(/[\\/]/).pop()?.trim() ?? '';
  if (!basename || basename.length > 260 || /[\u0000-\u001f]/.test(basename)) {
    throw new PracticeFileError('Choose a file with a short, readable filename.');
  }
  return basename;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '\n' || character === '\r') throw new PracticeFileError('Multiline CSV cells are not supported so source row numbers stay accurate.');
      if (character === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }
    if (character === '"') {
      if (field.length > 0) throw new PracticeFileError('A quoted CSV value must begin at the start of its field.');
      quoted = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field);
      field = '';
      if (row.some((cell) => cell.length > 0)) rows.push(row);
      else if (source.slice(index + 1).trim().length > 0) throw new PracticeFileError('Remove blank lines inside the CSV so source row numbers stay accurate.');
      row = [];
      if (rows.length > MAX_PRACTICE_FILE_ROWS + 1) throw new PracticeFileError('This practice file may contain at most 100 data rows.');
    } else {
      field += character;
    }
  }
  if (quoted) throw new PracticeFileError('The CSV file ends inside a quoted value.');
  row.push(field);
  if (row.some((cell) => cell.length > 0)) rows.push(row);
  if (rows.length < 2) throw new PracticeFileError('The file needs a header and at least one data row.');
  if (rows.length > MAX_PRACTICE_FILE_ROWS + 1) throw new PracticeFileError('This practice file may contain at most 100 data rows.');
  const columnCount = rows[0].length;
  if (columnCount === 0 || columnCount > 12 || rows.some((item) => item.length !== columnCount)) {
    throw new PracticeFileError('Every CSV row must have the same number of columns, with at most 12 columns.');
  }
  return rows;
}

function requireHeaders(rows: readonly string[][], expected: readonly string[]): void {
  const headers = rows[0];
  if (!headers || headers.length !== expected.length || headers.some((header, index) => header.trim() !== expected[index])) {
    throw new PracticeFileError(`Expected CSV columns: ${expected.join(', ')}.`);
  }
}

function parseWholeNumber(value: string, label: string, minimum: number, maximum: number): number {
  const normalized = value.trim();
  if (!/^-?\d+$/.test(normalized)) throw new PracticeFileError(`${label} must be a whole number.`);
  const number = Number(normalized);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new PracticeFileError(`${label} is outside the supported range.`);
  }
  return number;
}

function parseBoolean(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw new PracticeFileError(`${label} must be true or false.`);
}

function parseDate(value: string, label: string): string {
  const normalized = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new PracticeFileError(`${label} must use YYYY-MM-DD.`);
  const date = new Date(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== normalized) {
    throw new PracticeFileError(`${label} is not a calendar date.`);
  }
  return normalized;
}

function parseAmountSatang(value: string, label: string): number {
  const normalized = value.trim();
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match) throw new PracticeFileError(`${label} must be a THB amount with at most two decimal places.`);
  const satang = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(satang) || satang > 1_000_000_000_000) {
    throw new PracticeFileError(`${label} is outside the supported range.`);
  }
  return satang;
}

function parseRowId(value: string, label: string): string {
  const id = value.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(id)) throw new PracticeFileError(`${label} must be a bounded record ID.`);
  return id;
}

function parseInvoiceCsv(filename: string, text: string): ParsedPracticeFile {
  const rows = parseCsv(text);
  const excerpt = text.slice(0, MAX_PRACTICE_FILE_EXCERPT);
  if (rows[0]?.join(',') === 'shipment_id,zone,service_date,weight_gram,remote') {
    requireHeaders(rows, ['shipment_id', 'zone', 'service_date', 'weight_gram', 'remote']);
    const ids = new Set<string>();
    const shipments = rows.slice(1).map((cells, index): ParsedShipment => {
      const id = parseRowId(cells[0] ?? '', `Shipment row ${index + 2} ID`);
      if (ids.has(id)) throw new PracticeFileError(`Shipment ID ${id} appears more than once.`);
      ids.add(id);
      const zoneText = cells[1]?.trim() ?? '';
      const zone: Zone | null = zoneText === '' ? null : zoneText === 'bangkok' || zoneText === 'regional' ? zoneText : (() => { throw new PracticeFileError(`Shipment row ${index + 2} zone is not supported.`); })();
      const weightText = cells[3]?.trim() ?? '';
      return {
        id,
        zone,
        date: parseDate(cells[2] ?? '', `Shipment row ${index + 2} date`),
        weightGram: weightText === '' ? null : parseWholeNumber(weightText, `Shipment row ${index + 2} weight`, 0, 1_000_000_000),
        remote: parseBoolean(cells[4] ?? '', `Shipment row ${index + 2} remote flag`),
      };
    });
    return { caseKind: 'invoice', kind: 'shipments', excerpt, shipments };
  }
  if (rows[0]?.join(',') === 'shipment_id,billed_thb,currency') {
    requireHeaders(rows, ['shipment_id', 'billed_thb', 'currency']);
    const ids = new Set<string>();
    const invoiceLines = rows.slice(1).map((cells, index): ParsedInvoiceLine => {
      const id = parseRowId(cells[0] ?? '', `Invoice row ${index + 2} ID`);
      if (ids.has(id)) throw new PracticeFileError(`Invoice ID ${id} appears more than once.`);
      ids.add(id);
      const amount = cells[1]?.trim() ?? '';
      const currency = (cells[2] ?? '').trim();
      if (!/^[A-Z]{3}$/.test(currency)) throw new PracticeFileError(`Invoice row ${index + 2} currency must be a three-letter uppercase code.`);
      return { id, billedSatang: amount === '' ? null : parseAmountSatang(amount, `Invoice row ${index + 2} amount`), currency };
    });
    return { caseKind: 'invoice', kind: 'invoice', excerpt, invoiceLines };
  }
  if (rows[0]?.join(',') === 'rule_kind,zone,amount_thb,effective_from,effective_to') {
    requireHeaders(rows, ['rule_kind', 'zone', 'amount_thb', 'effective_from', 'effective_to']);
    const rates = rows.slice(1).map((cells, index): ParsedPracticeRate => {
      const rawKind = cells[0]?.trim();
      const rawZone = cells[1]?.trim();
      const op = rawKind === 'base' ? 'setZoneBase' : rawKind === 'step' ? 'setWeightStep' : rawKind === 'surcharge' ? 'setSurcharge' : null;
      if (!op) throw new PracticeFileError(`Rate row ${index + 2} rule kind is not supported.`);
      const zone: Zone | '*' = rawZone === '*' || rawZone === 'bangkok' || rawZone === 'regional' ? rawZone : (() => { throw new PracticeFileError(`Rate row ${index + 2} zone is not supported.`); })();
      const from = parseDate(cells[3] ?? '', `Rate row ${index + 2} start date`);
      const rawTo = cells[4]?.trim() ?? '';
      const to = rawTo === '' ? null : parseDate(rawTo, `Rate row ${index + 2} end date`);
      if (to !== null && from >= to) throw new PracticeFileError(`Rate row ${index + 2} must use a non-empty half-open date range.`);
      if (op === 'setZoneBase' && zone === '*') throw new PracticeFileError(`Rate row ${index + 2} base rule must name a zone.`);
      return {
        op,
        id: `practice-rate-${rawKind}-${rawZone}-${index + 2}`,
        zone,
        amountSatang: parseAmountSatang(cells[2] ?? '', `Rate row ${index + 2} amount`),
        from,
        to,
      };
    });
    return { caseKind: 'invoice', kind: 'rate-card', excerpt, rates };
  }
  throw new PracticeFileError(`The CSV columns in ${filename} are not a supported practice file.`);
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new PracticeFileError('The JSON practice file must contain an object.');
  return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function parseTeachingJson(text: string): ParsedPracticeFile {
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { throw new PracticeFileError('The lesson file is not valid JSON.'); }
  const record = asRecord(decoded);
  if (!hasExactKeys(record, ['kind', 'version', 'parameters']) || record.kind !== 'teaching-lesson' || record.version !== 1) {
    throw new PracticeFileError('The lesson JSON must have kind teaching-lesson, version 1, and parameters.');
  }
  const parametersRecord = asRecord(record.parameters);
  const parameters = physicsParamsSchema.safeParse(parametersRecord);
  if (!parameters.success) throw new PracticeFileError('Lesson force, mass, and time are outside the supported values.');
  return { caseKind: 'teaching', kind: 'teaching-lesson', excerpt: text.slice(0, MAX_PRACTICE_FILE_EXCERPT), parameters: parameters.data };
}

function parseEncounterJson(text: string): ParsedPracticeFile {
  let decoded: unknown;
  try { decoded = JSON.parse(text); } catch { throw new PracticeFileError('The encounter file is not valid JSON.'); }
  const record = asRecord(decoded);
  if (!hasExactKeys(record, ['kind', 'version', 'rule', 'target']) || record.kind !== 'encounter-plan' || record.version !== 1) {
    throw new PracticeFileError('The encounter JSON must have kind encounter-plan, version 1, a rule, and a target.');
  }
  const rule = encounterRuleSchema.safeParse(record.rule);
  if (!rule.success) throw new PracticeFileError('The shield rule contains unsupported values.');
  if (record.target !== 'mira' && record.target !== 'pip') throw new PracticeFileError('The encounter target must be Mira or Pip.');
  return { caseKind: 'encounter', kind: 'encounter-plan', excerpt: text.slice(0, MAX_PRACTICE_FILE_EXCERPT), rule: rule.data, target: record.target };
}

export function parsePracticeFile(filename: string, text: string, caseKind: 'invoice'): Extract<ParsedPracticeFile, { caseKind: 'invoice' }>;
export function parsePracticeFile(filename: string, text: string, caseKind: 'teaching'): Extract<ParsedPracticeFile, { caseKind: 'teaching' }>;
export function parsePracticeFile(filename: string, text: string, caseKind: 'encounter'): Extract<ParsedPracticeFile, { caseKind: 'encounter' }>;
export function parsePracticeFile(filename: string, text: string, caseKind: 'invoice' | 'teaching' | 'encounter'): ParsedPracticeFile;
export function parsePracticeFile(filename: string, text: string, caseKind: 'invoice' | 'teaching' | 'encounter'): ParsedPracticeFile {
  const normalizedFilename = safeFilename(filename);
  if (typeof text !== 'string' || text.length === 0) throw new PracticeFileError('Choose a non-empty text or CSV practice file.');
  if (new TextEncoder().encode(text).byteLength > MAX_PRACTICE_FILE_BYTES) throw new PracticeFileError('Practice files must be 128 KB or smaller.');
  if (normalizedFilename.toLowerCase().endsWith('.csv') && caseKind === 'invoice') return parseInvoiceCsv(normalizedFilename, text);
  if (normalizedFilename.toLowerCase().endsWith('.json') && caseKind === 'teaching') return parseTeachingJson(text);
  if (normalizedFilename.toLowerCase().endsWith('.json') && caseKind === 'encounter') return parseEncounterJson(text);
  const expected: PracticeFileKind[] = caseKind === 'invoice' ? ['shipments', 'invoice', 'rate-card'] : caseKind === 'teaching' ? ['teaching-lesson'] : ['encounter-plan'];
  throw new PracticeFileError(`Unsupported practice file for ${caseKind}. Accepted file kinds: ${expected.join(', ')}.`);
}
