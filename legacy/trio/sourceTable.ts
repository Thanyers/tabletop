export type CsvTable = { headers: string[]; rows: Record<string, string>[]; totalRows: number; totalColumns: number };
export const MAX_PREVIEW_ROWS = 100;
export const MAX_PREVIEW_COLUMNS = 30;

export function parseCsv(text: string, expectedHeaders?: readonly string[]): CsvTable {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let totalRows = 0;
  let width = 0;
  const retain = (values: string[]) => {
    if (!records.length) { width = values.length; records.push(values.slice(0, MAX_PREVIEW_COLUMNS)); return; }
    if (values.length !== width) throw new Error('Unexpected CSV row width.');
    totalRows += 1;
    if (totalRows <= MAX_PREVIEW_ROWS) records.push(values.slice(0, MAX_PREVIEW_COLUMNS));
  };
  let record: string[] = [];
  let field = '';
  let quoted = false;

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
    } else if (character === '"') {
      if (field !== '') throw new Error('Invalid CSV quote.');
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      record.push(field);
      if (!(record.length === 1 && record[0] === '')) retain(record);
      record = [];
      field = '';
    } else {
      field += character;
    }
  }

  if (quoted) throw new Error('Unclosed CSV quote.');
  if (record.length > 0 || field !== '') {
    record.push(field);
    if (!(record.length === 1 && record[0] === '')) retain(record);
  }

  const headers = records[0];
  if (!headers || headers.length === 0 || (expectedHeaders && (headers.length !== expectedHeaders.length || headers.some((header, index) => header !== expectedHeaders[index])))) {
    throw new Error('Unexpected CSV columns.');
  }

  const rows = records.slice(1).map((values) => {
    if (values.length !== headers.length) throw new Error('Unexpected CSV row width.');
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });

  return { headers, rows, totalRows, totalColumns: width };
}

function cellText(value: unknown) {
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString().slice(0, 10);
  if (value === null || value === undefined) return '';
  return String(value);
}

export function tableFromRows(values: readonly (readonly unknown[])[]): CsvTable {
  const headers = values[0]?.slice(0, MAX_PREVIEW_COLUMNS).map((value) => cellText(value).trim()) ?? [];
  if (!headers.length || headers.some((header) => !header)) throw new Error('ไม่พบแถวหัวคอลัมน์ในชีตนี้');
  const rows = values.slice(1, MAX_PREVIEW_ROWS + 1).map((cells) => Object.fromEntries(headers.map((header, index) => [header, cellText(cells[index])] as const)));
  return { headers, rows, totalRows: Math.max(0, values.length - 1), totalColumns: values[0]?.length ?? 0 };
}


