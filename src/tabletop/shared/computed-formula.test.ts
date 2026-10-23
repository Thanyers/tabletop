import { describe, expect, it } from 'vitest';
import type { ComputedColumn, TableField } from './table-contracts';
import { computedColumnProblems, evaluateComputedColumn } from './computed-columns';
import { computedFormulaFields, formatComputedExpression, parseComputedFormula } from './computed-formula';

const fields: TableField[] = [
  { id: 'order_id', label: 'Order ID', type: 'text', required: true },
  { id: 'zone', label: 'Zone', type: 'text', required: true },
  { id: 'weight_kg', label: 'Weight (kg)', type: 'number', required: false },
  { id: 'goods_total', label: 'Goods total', type: 'number', required: true },
  { id: 'declared_shipping', label: 'Declared shipping', type: 'number', required: true },
];

function column(formula: string): ComputedColumn {
  const parsed = parseComputedFormula(formula, fields);
  if (!parsed.ok) throw new Error(parsed.error);
  return { id: 'fee', collection: 'orders', label: 'Shipping fee', expression: parsed.expression };
}

function value(formula: string, values: Record<string, string | number | null>): number | null {
  return evaluateComputedColumn(column(formula), values);
}

// The formula a buyer would write from the fictional NS-SHIP-2026 contract.
const CONTRACT_FEE = 'IF(goods_total >= 5000, 0, IF(zone = "BKK", 35, IF(zone = "REG", 45, 45)) + IF(zone = "REM", 7.5, 0) + IF(weight_kg > 3, CEIL(weight_kg - 3) * 10, 0))';

const orders = [
  { order_id: 'NS-1001', zone: 'BKK', weight_kg: 2.4, goods_total: 1820, declared_shipping: 35 },
  { order_id: 'NS-1002', zone: 'REG', weight_kg: 5.2, goods_total: 2450, declared_shipping: 55 },
  { order_id: 'NS-1003', zone: 'REM', weight_kg: 3, goods_total: 990, declared_shipping: 52.5 },
  { order_id: 'NS-1004', zone: 'BKK', weight_kg: 7.8, goods_total: 5200, declared_shipping: 0 },
  { order_id: 'NS-1005', zone: 'REG', weight_kg: 0.8, goods_total: 610, declared_shipping: 45 },
  { order_id: 'NS-1006', zone: 'REM', weight_kg: null, goods_total: 1200, declared_shipping: 60 },
  { order_id: 'NS-1007', zone: 'BKK', weight_kg: 3.01, goods_total: 1500, declared_shipping: 45 },
];

describe('computed formula parser', () => {
  it('applies precedence, parentheses and unary minus', () => {
    expect(value('2 + 3 * 4', {})).toBe(14);
    expect(value('(2 + 3) * 4', {})).toBe(20);
    expect(value('-(2 + 3) * -2', {})).toBe(10);
    expect(value('10 / 4', {})).toBe(2.5);
  });

  it('reads fields and text literals case-insensitively for functions only', () => {
    expect(value('if(zone = "BKK", 1, 0)', { zone: 'BKK' })).toBe(1);
    expect(value('IF(zone = "bkk", 1, 0)', { zone: 'BKK' })).toBe(0);
    expect(value('IF(zone <> "BKK", 1, 0)', { zone: 'REG' })).toBe(1);
  });

  it('supports IF, CEIL, FLOOR, ABS, ROUND, MIN, MAX, AND and OR', () => {
    expect(value('CEIL(weight_kg - 3)', { weight_kg: 5.2 })).toBe(3);
    expect(value('CEIL(weight_kg - 3)', { weight_kg: 3 })).toBe(0);
    expect(value('FLOOR(weight_kg)', { weight_kg: 5.9 })).toBe(5);
    expect(value('ABS(weight_kg - 10)', { weight_kg: 7 })).toBe(3);
    expect(value('ROUND(weight_kg / 3, 2)', { weight_kg: 10 })).toBe(3.33);
    expect(value('MIN(weight_kg, 4) + MAX(weight_kg, 4)', { weight_kg: 2 })).toBe(6);
    expect(value('IF(AND(weight_kg > 1, zone = "BKK"), 1, 0)', { weight_kg: 2, zone: 'BKK' })).toBe(1);
    expect(value('IF(OR(weight_kg > 1, zone = "BKK"), 1, 0)', { weight_kg: 0, zone: 'REG' })).toBe(0);
  });

  it('reports syntax and reference errors with a usable message', () => {
    expect(parseComputedFormula('weight_kg +', fields)).toEqual({ ok: false, error: 'The formula ends too early.' });
    expect(parseComputedFormula('1 + (2 * 3', fields)).toMatchObject({ ok: false, error: expect.stringContaining('Expected ")"') });
    expect(parseComputedFormula('nope + 1', fields)).toMatchObject({ ok: false, error: 'Unknown field "nope".' });
    expect(parseComputedFormula('SUM(weight_kg)', fields)).toMatchObject({ ok: false, error: expect.stringContaining('Unknown function') });
    expect(parseComputedFormula('IF(weight_kg > 1, 1)', fields)).toMatchObject({ ok: false, error: 'IF() takes 3 arguments.' });
    expect(parseComputedFormula('"open', fields)).toMatchObject({ ok: false, error: expect.stringContaining('not closed') });
    expect(parseComputedFormula('', fields)).toMatchObject({ ok: false, error: 'Write a formula.' });
  });

  it('round-trips a parsed formula back to editable text', () => {
    const parsed = parseComputedFormula(CONTRACT_FEE, fields);
    if (!parsed.ok) throw new Error(parsed.error);
    const text = formatComputedExpression(parsed.expression);
    expect(text).toContain('CEIL(');
    expect(computedFormulaFields(parsed.expression)).toEqual(['goods_total', 'zone', 'weight_kg']);
    const reparsed = parseComputedFormula(text, fields);
    expect(reparsed.ok).toBe(true);
    expect(reparsed.ok && evaluateComputedColumn({ id: 'fee', collection: 'orders', label: 'Fee', expression: reparsed.expression }, orders[1])).toBe(75);
  });
});

describe('contract-shaped computed column', () => {
  it('computes every order exactly like the contract reference', () => {
    const fee = column(CONTRACT_FEE);
    const values = orders.map((row) => evaluateComputedColumn(fee, row));
    expect(values).toEqual([35, 75, 52.5, 0, 45, null, 45]);
    const total = values.reduce<number>((sum, item) => sum + (item ?? 0), 0);
    expect(Math.round(total * 100) / 100).toBe(252.5);
    expect(values.filter((item) => item === null)).toHaveLength(1);
  });

  it('recomputes when data changes without touching the definition', () => {
    const fee = column(CONTRACT_FEE);
    expect(evaluateComputedColumn(fee, { ...orders[1], weight_kg: 3 })).toBe(45);
    expect(evaluateComputedColumn(fee, { ...orders[1], weight_kg: 8.1 })).toBe(105);
    expect(evaluateComputedColumn(fee, { ...orders[1], goods_total: 5000 })).toBe(0);
    expect(evaluateComputedColumn(fee, { ...orders[1], zone: 'REM' })).toBe(82.5);
  });

  it('rejects a formula whose result is not a number or whose condition is not boolean', () => {
    const program = { version: 1 as const, title: 'Orders', description: 'Orders.', collections: [{ id: 'orders', title: 'Orders', fields }], actions: [], invariants: [], turnOrder: [], evidence: [], assumptions: [] };
    const textResult = parseComputedFormula('IF(zone = "BKK", "yes", "no")', fields);
    expect(textResult.ok).toBe(true);
    if (!textResult.ok) return;
    expect(computedColumnProblems([{ id: 'bad', collection: 'orders', label: 'Bad', expression: textResult.expression }], program).join()).toContain('must produce a number');
    const numberCondition = parseComputedFormula('IF(weight_kg, 1, 0)', fields);
    expect(numberCondition.ok).toBe(true);
    if (!numberCondition.ok) return;
    expect(computedColumnProblems([{ id: 'bad', collection: 'orders', label: 'Bad', expression: numberCondition.expression }], program).join()).toContain('comparison');
  });
});
