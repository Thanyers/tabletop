import { describe, expect, it } from 'vitest';
import type { ComputedColumn, ComputedExpression, TableProgram } from './table-contracts';
import { computeRecordValues, computedColumnProblems, computedWithinBounds, evaluateComputedColumn, retainComputedColumns } from './computed-columns';

function program(fields = [
  { id: 'sku', label: 'SKU', type: 'text' as const, required: true },
  { id: 'qty', label: 'Qty', type: 'number' as const, required: true },
  { id: 'price', label: 'Price', type: 'number' as const, required: false },
]): TableProgram {
  return {
    version: 1, title: 'Inventory', description: 'Items.',
    collections: [{ id: 'items', title: 'Items', fields }],
    actions: [], invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
  };
}

function total(): ComputedColumn {
  return {
    id: 'total', collection: 'items', label: 'Total',
    expression: { op: 'multiply', left: { op: 'field', field: 'qty' }, right: { op: 'field', field: 'price' } },
  };
}

describe('computed columns', () => {
  it('evaluates row arithmetic and returns null when a value cannot be computed', () => {
    expect(evaluateComputedColumn(total(), { qty: 2.5, price: 5 })).toBe(12.5);
    expect(evaluateComputedColumn(total(), { qty: 2, price: null })).toBeNull();
    expect(evaluateComputedColumn(total(), { qty: 2 })).toBeNull();
    const divided: ComputedColumn = { id: 'ratio', collection: 'items', label: 'Ratio', expression: { op: 'divide', left: { op: 'field', field: 'qty' }, right: { op: 'literal', value: 0 } } };
    expect(evaluateComputedColumn(divided, { qty: 4 })).toBeNull();
    const rounded: ComputedColumn = { id: 'third', collection: 'items', label: 'Third', expression: { op: 'divide', left: { op: 'literal', value: 1 }, right: { op: 'literal', value: 3 } } };
    expect(evaluateComputedColumn(rounded, {})).toBe(0.3333);
    expect(computeRecordValues([total()], 'items', { qty: 3, price: 2 })).toEqual({ total: 6 });
    expect(computeRecordValues([total()], 'other', { qty: 3, price: 2 })).toEqual({});
  });

  it('rejects unknown collections and fields, non-number fields, bad labels and too many columns', () => {
    expect(computedColumnProblems([total()], program())).toEqual([]);
    expect(computedColumnProblems([{ ...total(), collection: 'missing' }], program()).join()).toContain('unknown collection');
    expect(computedColumnProblems([{ ...total(), expression: { op: 'field', field: 'missing' } }], program()).join()).toContain('Unknown field');
    expect(computedColumnProblems([{ ...total(), expression: { op: 'field', field: 'sku' } }], program()).join()).toContain('not a number field');
    expect(computedColumnProblems([{ ...total(), label: '' }], program()).join()).toContain('needs a label');
    expect(computedColumnProblems([total(), { ...total(), id: 'total' }], program()).join()).toContain('duplicated');
    const many = Array.from({ length: 7 }, (_, index) => ({ ...total(), id: `total${index}` }));
    expect(computedColumnProblems(many, program()).join()).toContain('at most 6');
  });

  it('bounds expression size and depth', () => {
    const small: ComputedExpression = { op: 'add', left: { op: 'field', field: 'qty' }, right: { op: 'literal', value: 1 } };
    expect(computedWithinBounds(small)).toBe(true);
    let deep: ComputedExpression = { op: 'literal', value: 1 };
    for (let index = 0; index < 12; index += 1) deep = { op: 'add', left: deep, right: { op: 'literal', value: 1 } };
    expect(computedWithinBounds(deep)).toBe(false);
    expect(computedColumnProblems([{ ...total(), expression: deep }], program()).join()).toContain('too large');
  });

  it('drops definitions whose collection or fields disappear', () => {
    const kept = retainComputedColumns([total()], program());
    expect(kept).toHaveLength(1);
    const withoutPrice = retainComputedColumns([total()], program([
      { id: 'sku', label: 'SKU', type: 'text', required: true },
      { id: 'qty', label: 'Qty', type: 'number', required: true },
    ]));
    expect(withoutPrice).toEqual([]);
    expect(retainComputedColumns([total()], null)).toEqual([]);
  });
});
