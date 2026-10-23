import type { ComputedColumn, ComputedExpression, TableField, TableProgram, TableRecord, TableValue } from './table-contracts';

export const MAX_COMPUTED_COLUMNS = 6;
export const MAX_COMPUTED_DEPTH = 12;
export const MAX_COMPUTED_NODES = 64;
export const MAX_COMPUTED_LABEL_CHARS = 40;

const COLUMN_ID = /^[a-z][a-z0-9_-]{0,39}$/u;

type ValueType = 'number' | 'text' | 'boolean';

/** Depth and node budget; keeps evaluation cheap and bounded. */
export function computedWithinBounds(expression: ComputedExpression): boolean {
  let nodes = 0;
  const walk = (node: ComputedExpression, depth: number): boolean => {
    nodes += 1;
    if (nodes > MAX_COMPUTED_NODES || depth > MAX_COMPUTED_DEPTH) return false;
    switch (node.op) {
      case 'field':
      case 'literal':
      case 'text':
        return true;
      case 'round':
      case 'negate':
      case 'ceil':
      case 'floor':
      case 'abs':
        return walk(node.value, depth + 1);
      case 'if':
        return walk(node.condition, depth + 1) && walk(node.then, depth + 1) && walk(node.else, depth + 1);
      default:
        return walk(node.left, depth + 1) && walk(node.right, depth + 1);
    }
  };
  return walk(expression, 1);
}

/** The static type of an expression, or the first reason it cannot be typed. */
function typeOf(expression: ComputedExpression, fields: Map<string, TableField['type']>): { type: ValueType } | { error: string } {
  const need = (node: ComputedExpression, expected: ValueType, context: string): string | null => {
    const typed = typeOf(node, fields);
    if ('error' in typed) return typed.error;
    if (typed.type !== expected) return `${context} needs a ${expected} value, not ${typed.type}.`;
    return null;
  };
  switch (expression.op) {
    case 'literal': return Number.isFinite(expression.value) ? { type: 'number' } : { error: 'Numbers must be finite.' };
    case 'text': return { type: 'text' };
    case 'field': {
      const type = fields.get(expression.field);
      if (!type) return { error: `Unknown field "${expression.field}".` };
      if (type === 'list') return { error: `"${expression.field}" is a list; computed columns need a number or text field.` };
      return { type };
    }
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max': {
      const problem = need(expression.left, 'number', `"${expression.op}"`) ?? need(expression.right, 'number', `"${expression.op}"`);
      return problem ? { error: problem } : { type: 'number' };
    }
    case 'negate':
    case 'ceil':
    case 'floor':
    case 'abs':
    case 'round': {
      const problem = need(expression.value, 'number', `"${expression.op}"`);
      return problem ? { error: problem } : { type: 'number' };
    }
    case 'compare': {
      const left = typeOf(expression.left, fields);
      const right = typeOf(expression.right, fields);
      if ('error' in left) return left;
      if ('error' in right) return right;
      if (expression.compare === 'eq' || expression.compare === 'neq') return { type: 'boolean' };
      if (left.type !== right.type) return { error: `"${expression.compare}" needs two values of the same type.` };
      if (left.type !== 'number' && left.type !== 'text') return { error: `"${expression.compare}" works on numbers or text.` };
      return { type: 'boolean' };
    }
    case 'if': {
      const condition = typeOf(expression.condition, fields);
      if ('error' in condition) return condition;
      if (condition.type !== 'boolean') return { error: 'IF() needs a comparison as its first argument.' };
      const then = typeOf(expression.then, fields);
      const otherwise = typeOf(expression.else, fields);
      if ('error' in then) return then;
      if ('error' in otherwise) return otherwise;
      if (then.type !== otherwise.type) return { error: 'Both IF() results must have the same type.' };
      return { type: then.type };
    }
    case 'and':
    case 'or': {
      const problem = need(expression.left, 'boolean', `"${expression.op}"`) ?? need(expression.right, 'boolean', `"${expression.op}"`);
      return problem ? { error: problem } : { type: 'boolean' };
    }
  }
}

function expressionProblems(expression: ComputedExpression, fields: Map<string, TableField['type']>): string[] {
  const typed = typeOf(expression, fields);
  if ('error' in typed) return [typed.error];
  if (typed.type !== 'number') return ['A computed column must produce a number.'];
  return [];
}

/** Every field reference must exist in the column's collection; results must be numeric. */
function fieldProblems(expression: ComputedExpression, fields: Map<string, TableField['type']>): string[] {
  return expressionProblems(expression, fields);
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
    const fields = new Map<string, TableField['type']>(collection.fields.map((field) => [field.id, field.type]));
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
    const fields = new Map<string, TableField['type']>(collection.fields.map((field) => [field.id, field.type]));
    if (!computedWithinBounds(column.expression)) continue;
    if (fieldProblems(column.expression, fields).length > 0) continue;
    valid.push(column);
  }
  return valid;
}

type EvalValue = number | string | boolean | null;
type ReadField = (field: string) => number | string | boolean | null;

function sameValue(left: EvalValue, right: EvalValue): boolean {
  if (typeof left !== typeof right) return false;
  return left === right;
}

function evaluateNode(expression: ComputedExpression, readField: ReadField): EvalValue {
  switch (expression.op) {
    case 'literal': return Number.isFinite(expression.value) ? expression.value : null;
    case 'text': return expression.value;
    case 'field': return readField(expression.field);
    case 'add':
    case 'subtract':
    case 'multiply':
    case 'divide':
    case 'min':
    case 'max': {
      const left = evaluateNode(expression.left, readField);
      const right = evaluateNode(expression.right, readField);
      if (typeof left !== 'number' || typeof right !== 'number') return null;
      if (expression.op === 'add') return left + right;
      if (expression.op === 'subtract') return left - right;
      if (expression.op === 'multiply') return left * right;
      if (expression.op === 'min') return Math.min(left, right);
      if (expression.op === 'max') return Math.max(left, right);
      return right === 0 ? null : left / right;
    }
    case 'round': {
      const value = evaluateNode(expression.value, readField);
      if (typeof value !== 'number') return null;
      const factor = 10 ** expression.digits;
      return Math.round(value * factor) / factor;
    }
    case 'negate':
    case 'ceil':
    case 'floor':
    case 'abs': {
      const value = evaluateNode(expression.value, readField);
      if (typeof value !== 'number') return null;
      if (expression.op === 'negate') return -value;
      if (expression.op === 'ceil') return Math.ceil(value);
      if (expression.op === 'floor') return Math.floor(value);
      return Math.abs(value);
    }
    case 'compare': {
      const left = evaluateNode(expression.left, readField);
      const right = evaluateNode(expression.right, readField);
      if (left === null || right === null) return null;
      if (expression.compare === 'eq') return sameValue(left, right);
      if (expression.compare === 'neq') return !sameValue(left, right);
      if (typeof left !== typeof right || (typeof left !== 'number' && typeof left !== 'string')) return null;
      if (expression.compare === 'lt') return left < right;
      if (expression.compare === 'lte') return left <= right;
      if (expression.compare === 'gt') return left > right;
      return left >= right;
    }
    case 'if': {
      const condition = evaluateNode(expression.condition, readField);
      if (typeof condition !== 'boolean') return null;
      return evaluateNode(condition ? expression.then : expression.else, readField);
    }
    case 'and': {
      const left = evaluateNode(expression.left, readField);
      if (left === false) return false;
      if (typeof left !== 'boolean') return null;
      const right = evaluateNode(expression.right, readField);
      return typeof right === 'boolean' ? right : null;
    }
    case 'or': {
      const left = evaluateNode(expression.left, readField);
      if (left === true) return true;
      if (typeof left !== 'boolean') return null;
      const right = evaluateNode(expression.right, readField);
      return typeof right === 'boolean' ? right : null;
    }
  }
}

/** Rounds to 4 decimals; null means "not computable" (missing field, divide by zero, too large). */
export function evaluateComputedColumn(column: ComputedColumn, values: Record<string, TableValue>): number | null {
  const value = evaluateNode(column.expression, (field) => {
    const raw = values[field];
    return typeof raw === 'number' || typeof raw === 'string' || typeof raw === 'boolean' ? raw : null;
  });
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e9) return null;
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
