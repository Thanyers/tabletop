/**
 * F055: Excel-like formula text for computed columns.
 *
 * The text is parsed into the bounded `ComputedExpression` tree (never `eval`), so the server
 * can validate it once and both the projection and the UI read the same definition.
 *
 * Grammar (case-insensitive function names):
 *   comparison  := additive (('=' | '<>' | '<' | '<=' | '>' | '>=') additive)?
 *   additive    := multiplicative (('+' | '-') multiplicative)*
 *   multiplicative := unary (('*' | '/') unary)*
 *   unary       := ('-' | '+')? primary
 *   primary     := number | string | field | function '(' arguments ')' | '(' comparison ')'
 *   functions   := IF(c, a, b) | CEIL(x) | FLOOR(x) | ABS(x) | ROUND(x[, digits])
 *                | MIN(a, b) | MAX(a, b) | AND(a, b) | OR(a, b)
 */
import type { ComputedComparison, ComputedExpression } from './table-contracts';

export interface FormulaField { id: string; type: 'text' | 'number' | 'boolean' | 'list' }
export type FormulaParseResult = { ok: true; expression: ComputedExpression } | { ok: false; error: string };

type Token = { kind: 'number' | 'string' | 'ident' | 'op'; value: string; at: number };

const COMPARE_SYMBOLS: Record<string, ComputedComparison> = {
  '=': 'eq', '==': 'eq', '<>': 'neq', '!=': 'neq',
  '<': 'lt', '<=': 'lte', '>': 'gt', '>=': 'gte',
};

const COMPARE_TEXT: Record<ComputedComparison, string> = {
  eq: '=', neq: '<>', lt: '<', lte: '<=', gt: '>', gte: '>=',
};

class FormulaError extends Error {}

/** Longest field id that starts at `at`, so ids like `travel-fee` survive tokenizing. */
function matchField(source: string, at: number, fieldIds: readonly string[]): string | null {
  const lower = source.toLowerCase();
  let best: string | null = null;
  for (const id of fieldIds) {
    if (!lower.startsWith(id.toLowerCase(), at)) continue;
    const end = at + id.length;
    const next = source[end];
    if (next && /[A-Za-z0-9_-]/u.test(next)) continue;
    if (!best || id.length > best.length) best = id;
  }
  return best;
}

function tokenize(source: string, fieldIds: readonly string[]): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < source.length) {
    const char = source[index];
    if (/\s/u.test(char)) { index += 1; continue; }
    if (/[0-9]/u.test(char) || (char === '.' && /[0-9]/u.test(source[index + 1] ?? ''))) {
      const start = index;
      while (index < source.length && /[0-9]/u.test(source[index])) index += 1;
      if (source[index] === '.') {
        index += 1;
        while (index < source.length && /[0-9]/u.test(source[index])) index += 1;
      }
      tokens.push({ kind: 'number', value: source.slice(start, index), at: start });
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      const start = index;
      index += 1;
      let value = '';
      let closed = false;
      while (index < source.length) {
        const current = source[index];
        if (current === quote) {
          if (source[index + 1] === quote) { value += quote; index += 2; continue; }
          index += 1; closed = true; break;
        }
        if (current === '\\' && index + 1 < source.length) { value += source[index + 1]; index += 2; continue; }
        value += current; index += 1;
      }
      if (!closed) throw new FormulaError(`String at position ${start + 1} is not closed.`);
      tokens.push({ kind: 'string', value, at: start });
      continue;
    }
    const field = matchField(source, index, fieldIds);
    if (field) {
      tokens.push({ kind: 'ident', value: field, at: index });
      index += field.length;
      continue;
    }
    if (/[A-Za-z_]/u.test(char)) {
      const start = index;
      while (index < source.length && /[A-Za-z0-9_]/u.test(source[index])) index += 1;
      tokens.push({ kind: 'ident', value: source.slice(start, index), at: start });
      continue;
    }
    const two = source.slice(index, index + 2);
    if (two === '<=' || two === '>=' || two === '<>' || two === '!=' || two === '==') {
      tokens.push({ kind: 'op', value: two, at: index }); index += 2; continue;
    }
    if ('+-*/<>=(),'.includes(char)) {
      tokens.push({ kind: 'op', value: char, at: index }); index += 1; continue;
    }
    throw new FormulaError(`Unexpected character "${char}" at position ${index + 1}.`);
  }
  return tokens;
}

class Parser {
  private at = 0;
  constructor(private readonly tokens: Token[], private readonly fields: ReadonlyMap<string, FormulaField>) {}

  parse(): ComputedExpression {
    if (this.tokens.length === 0) throw new FormulaError('Write a formula.');
    const expression = this.comparison();
    if (this.peek()) throw new FormulaError(`Unexpected "${this.peek()!.value}" at position ${this.peek()!.at + 1}.`);
    return expression;
  }

  private peek(offset = 0): Token | undefined { return this.tokens[this.at + offset]; }

  private take(): Token {
    const token = this.tokens[this.at];
    if (!token) throw new FormulaError('The formula ends too early.');
    this.at += 1;
    return token;
  }

  private takeOp(value: string): boolean {
    const token = this.peek();
    if (token?.kind === 'op' && token.value === value) { this.at += 1; return true; }
    return false;
  }

  private expectOp(value: string): void {
    if (!this.takeOp(value)) throw new FormulaError(`Expected "${value}"${this.describeHere()}.`);
  }

  private describeHere(): string {
    const token = this.peek();
    return token ? ` at position ${token.at + 1}` : ' at the end';
  }

  private comparison(): ComputedExpression {
    const left = this.additive();
    const token = this.peek();
    if (token?.kind === 'op' && COMPARE_SYMBOLS[token.value]) {
      this.at += 1;
      return { op: 'compare', compare: COMPARE_SYMBOLS[token.value], left, right: this.additive() };
    }
    return left;
  }

  private additive(): ComputedExpression {
    let left = this.multiplicative();
    for (;;) {
      if (this.takeOp('+')) left = { op: 'add', left, right: this.multiplicative() };
      else if (this.takeOp('-')) left = { op: 'subtract', left, right: this.multiplicative() };
      else return left;
    }
  }

  private multiplicative(): ComputedExpression {
    let left = this.unary();
    for (;;) {
      if (this.takeOp('*')) left = { op: 'multiply', left, right: this.unary() };
      else if (this.takeOp('/')) left = { op: 'divide', left, right: this.unary() };
      else return left;
    }
  }

  private unary(): ComputedExpression {
    if (this.takeOp('-')) return { op: 'negate', value: this.unary() };
    if (this.takeOp('+')) return this.unary();
    return this.primary();
  }

  private primary(): ComputedExpression {
    const token = this.take();
    if (token.kind === 'number') {
      const value = Number(token.value);
      if (!Number.isFinite(value)) throw new FormulaError(`"${token.value}" is not a usable number.`);
      return { op: 'literal', value };
    }
    if (token.kind === 'string') {
      if (!token.value.trim()) throw new FormulaError(`The text at position ${token.at + 1} is empty.`);
      return { op: 'text', value: token.value };
    }
    if (token.kind === 'op' && token.value === '(') {
      const expression = this.comparison();
      this.expectOp(')');
      return expression;
    }
    if (token.kind === 'ident') {
      if (this.takeOp('(')) return this.call(token.value, token.at);
      const field = this.fields.get(token.value);
      if (!field) throw new FormulaError(`Unknown field "${token.value}".`);
      return { op: 'field', field: field.id };
    }
    throw new FormulaError(`Unexpected "${token.value}" at position ${token.at + 1}.`);
  }

  private arguments(): ComputedExpression[] {
    const values: ComputedExpression[] = [];
    if (this.takeOp(')')) return values;
    for (;;) {
      values.push(this.comparison());
      if (this.takeOp(')')) return values;
      this.expectOp(',');
    }
  }

  private call(name: string, at: number): ComputedExpression {
    const upper = name.toUpperCase();
    const args = this.arguments();
    const need = (count: number): void => {
      if (args.length !== count) throw new FormulaError(`${upper}() takes ${count} argument${count === 1 ? '' : 's'}.`);
    };
    if (upper === 'IF') { need(3); return { op: 'if', condition: args[0], then: args[1], else: args[2] }; }
    if (upper === 'CEIL' || upper === 'CEILING') { need(1); return { op: 'ceil', value: args[0] }; }
    if (upper === 'FLOOR') { need(1); return { op: 'floor', value: args[0] }; }
    if (upper === 'ABS') { need(1); return { op: 'abs', value: args[0] }; }
    if (upper === 'MIN') { need(2); return { op: 'min', left: args[0], right: args[1] }; }
    if (upper === 'MAX') { need(2); return { op: 'max', left: args[0], right: args[1] }; }
    if (upper === 'AND') { need(2); return { op: 'and', left: args[0], right: args[1] }; }
    if (upper === 'OR') { need(2); return { op: 'or', left: args[0], right: args[1] }; }
    if (upper === 'ROUND') {
      if (args.length !== 1 && args.length !== 2) throw new FormulaError('ROUND() takes 1 or 2 arguments.');
      let digits = 0;
      if (args.length === 2) {
        const second = args[1];
        if (second.op !== 'literal' || !Number.isInteger(second.value) || second.value < 0 || second.value > 6) {
          throw new FormulaError('ROUND() digits must be a whole number from 0 to 6.');
        }
        digits = second.value;
      }
      return { op: 'round', value: args[0], digits };
    }
    throw new FormulaError(`Unknown function "${name}"${at >= 0 ? '' : ''}. Try IF, CEIL, FLOOR, ABS, ROUND, MIN, MAX, AND or OR.`);
  }
}

export function parseComputedFormula(source: string, fields: readonly FormulaField[]): FormulaParseResult {
  try {
    const fieldMap = new Map(fields.map((field) => [field.id.toLowerCase(), { ...field }]));
    const tokens = tokenize(source, fields.map((field) => field.id));
    const expression = new Parser(tokens, fieldMap).parse();
    return { ok: true, expression };
  } catch (error) {
    if (error instanceof FormulaError) return { ok: false, error: error.message };
    throw error;
  }
}

/** Renders a stored expression as an editable formula. */
export function formatComputedExpression(expression: ComputedExpression): string {
  const wrap = (value: ComputedExpression): string => {
    const text = formatComputedExpression(value);
    return value.op === 'field' || value.op === 'literal' || value.op === 'text' ? text : `(${text})`;
  };
  switch (expression.op) {
    case 'field': return expression.field;
    case 'literal': return String(expression.value);
    case 'text': return JSON.stringify(expression.value);
    case 'add': return `${wrap(expression.left)} + ${wrap(expression.right)}`;
    case 'subtract': return `${wrap(expression.left)} - ${wrap(expression.right)}`;
    case 'multiply': return `${wrap(expression.left)} * ${wrap(expression.right)}`;
    case 'divide': return `${wrap(expression.left)} / ${wrap(expression.right)}`;
    case 'min': return `MIN(${wrap(expression.left)}, ${wrap(expression.right)})`;
    case 'max': return `MAX(${wrap(expression.left)}, ${wrap(expression.right)})`;
    case 'negate': return `-(${formatComputedExpression(expression.value)})`;
    case 'ceil': return `CEIL(${formatComputedExpression(expression.value)})`;
    case 'floor': return `FLOOR(${formatComputedExpression(expression.value)})`;
    case 'abs': return `ABS(${formatComputedExpression(expression.value)})`;
    case 'round': return `ROUND(${formatComputedExpression(expression.value)}, ${expression.digits})`;
    case 'compare': return `${wrap(expression.left)} ${COMPARE_TEXT[expression.compare]} ${wrap(expression.right)}`;
    case 'if': return `IF(${wrap(expression.condition)}, ${wrap(expression.then)}, ${wrap(expression.else)})`;
    case 'and': return `AND(${wrap(expression.left)}, ${wrap(expression.right)})`;
    case 'or': return `OR(${wrap(expression.left)}, ${wrap(expression.right)})`;
  }
}

/** Field ids in first-seen order, for the editor's field reference list. */
export function computedFormulaFields(expression: ComputedExpression): string[] {
  const seen = new Set<string>();
  const visit = (node: ComputedExpression): void => {
    switch (node.op) {
      case 'field': seen.add(node.field); return;
      case 'literal': case 'text': return;
      case 'round': case 'negate': case 'ceil': case 'floor': case 'abs': visit(node.value); return;
      case 'if': visit(node.condition); visit(node.then); visit(node.else); return;
      default: visit(node.left); visit(node.right);
    }
  };
  visit(expression);
  return [...seen];
}
