import type { ComputedColumn, ComputedExpression, TableProgram, TableRecord, TableValue } from './table-contracts';

export const MAX_COMPUTED_COLUMNS = 6;
export const MAX_COMPUTED_DEPTH = 8;
export const MAX_COMPUTED_NODES = 32;
export const MAX_COMPUTED_LABEL_CHARS = 40;

const COLUMN_ID = /^[a-z][a-z0-9_-]{0,39}$/u;

/** Depth and node budget; keeps evaluation cheap and bounded. */
export function computedWithinBounds(expression: ComputedExpression): boolean {
  let nodes = 0;
  const walk = (node: ComputedExpression, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_COMPUTED_NODES || depth > MAX_COMPUTED_DEPTH) return false;
    if (node.op === 'field' || node.op === 'literal') return true;
    return walk(node.left, depth + 1) && walk(node.right, depth + 1);
  };
  return walk(expression, 1);
}

/** Every field reference must exist in the column's collection and hold a number. */
function fieldProblems(expression: ComputedExpression, fields: Map<string, string>): string[] {
  if (expression.op === 'field') {
    const type = fields.get(expression.field);
    if (!type) return [`Unknown field "${expression.field}".`];
    if (type !== 'number') return [`"${expression.field}" is not a number field.`];
    return [];
  }
  if (expression.op === 'literal') return Number.isFinite(expression.value) ? [] : ['Numbers must be finite.'];
  return [...fieldProblems(expression.left, fields), ...fieldProblems(expression.right, fields)];
}

/** Structural problems for a replacement set; empty when the columns are acceptable. */
export function computedColumnProblems(columns: readonly ComputedColumn[], program: TableProgram): string[] {
  const problems: string[] = [];
  if (columns.length > MAX_COMPUTED_COLUMNS) problems.push(`Use at most ${MAX_COMPUTED_COLUMNS} computed columns.`);
  const seen = new Set<string>();
  for (const column of columns) {
    if (!COLUMN_ID.test(column.id)) problems.push(`Computed column id "${column.id}" is invalid.`);
    if (seen.has(column.id)) problems.push(`Computed column id "${column.id}" is duplicated.`);
    seen.add(column.id);
    const label = column.label.trim();
    if (!label || label.length > MAX_COMPUTED_LABEL_CHARS) problems.push(`Computed column "${column.id}" needs a label of 1-${MAX_COMPUTED_LABEL_CHARS} characters.`);
    const collection = program.collections.find((item) => item.id === column.collection);
    if (!collection) { problems.push(`Computed column "${column.id}" targets an unknown collection.`); continue; }
    if (!computedWithinBounds(column.expression)) problems.push(`Computed column "${column.id}" is too large or too deeply nested.`);
    const fields = new Map(collection.fields.map((field) => [field.id, field.type]));
    for (const problem of fieldProblems(column.expression, fields)) problems.push(`Computed column "${column.id}": ${problem}`);
  }
  return problems;
}

/** Drops definitions whose collection or fields no longer exist after a rule edit. */
export function retainComputedColumns(columns: readonly ComputedColumn[] | undefined, program: TableProgram | null): ComputedColumn[] {
  if (!columns?.length || !program) return [];
  const valid: ComputedColumn[] = [];
  for (const column of columns) {
    const collection = program.collections.find((item) => item.id === column.collection);
    if (!collection) continue;
    const fields = new Map(collection.fields.map((field) => [field.id, field.type]));
    if (!computedWithinBounds(column.expression)) continue;
    if (fieldProblems(column.expression, fields).length > 0) continue;
    valid.push(column);
  }
  return valid;
}

function evaluateNode(expression: ComputedExpression, readField: (field: string) => number | null): number | null {
  if (expression.op === 'literal') return Number.isFinite(expression.value) ? expression.value : null;
  if (expression.op === 'field') return readField(expression.field);
  const left = evaluateNode(expression.left, readField);
  const right = evaluateNode(expression.right, readField);
  if (left === null || right === null) return null;
  if (expression.op === 'add') return left + right;
  if (expression.op === 'subtract') return left - right;
  if (expression.op === 'multiply') return left * right;
  return right === 0 ? null : left / right;
}

/** Rounds to 4 decimals; null means "not computable" (missing field, divide by zero, too large). */
export function evaluateComputedColumn(column: ComputedColumn, values: Record<string, TableValue>): number | null {
  const value = evaluateNode(column.expression, (field) => {
    const raw = values[field];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
  });
  if (value === null || !Number.isFinite(value) || Math.abs(value) > 1e9) return null;
  return Math.round(value * 10_000) / 10_000;
}

/** Computed values for every column that applies to this row's collection. */
export function computeRecordValues(columns: readonly ComputedColumn[] | undefined, collectionId: string, values: Record<string, TableValue>): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  for (const column of columns ?? []) {
    if (column.collection !== collectionId) continue;
    out[column.id] = evaluateComputedColumn(column, values);
  }
  return out;
}

/** Convenience for callers that already hold a record. */
export function computeRecordRow(columns: readonly ComputedColumn[] | undefined, collectionId: string, row: TableRecord): Record<string, number | null> {
  return computeRecordValues(columns, collectionId, row.values);
}
