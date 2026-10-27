import { describe, expect, it } from 'vitest';
import { evaluateComputedColumn } from './computed-columns';

/**
 * F080 / ORACLE-01 (formula surface): an independent evaluator checks the stored formula results.
 *
 * The point is that the arithmetic below is written here, from the specification, instead of calling
 * the engine under test. If the engine's meaning of an operation drifts, this disagrees.
 */

type Expression =
  | { op: 'field'; field: string }
  | { op: 'literal'; value: number }
  | { op: 'add' | 'subtract' | 'multiply' | 'divide'; left: Expression; right: Expression };

/** A deliberately small evaluator: only the operations this test declares are supported. */
function evaluate(value: Expression, row: Record<string, unknown>): number {
  switch (value.op) {
    case 'field': {
      const raw = row[value.field];
      if (typeof raw !== 'number') throw new Error(`field ${value.field} is not a number`);
      return raw;
    }
    case 'literal':
      return value.value;
    case 'add':
      return evaluate(value.left, row) + evaluate(value.right, row);
    case 'subtract':
      return evaluate(value.left, row) - evaluate(value.right, row);
    case 'multiply':
      return evaluate(value.left, row) * evaluate(value.right, row);
    case 'divide': {
      const right = evaluate(value.right, row);
      if (right === 0) throw new Error('division by zero');
      return evaluate(value.left, row) / right;
    }
    default:
      throw new Error('unsupported operation');
  }
}

const row = { price: 1250, quantity: 3, discount: 250 };

const CASES: { name: string; expression: Expression }[] = [
  { name: 'a field on its own', expression: { op: 'field', field: 'price' } },
  { name: 'a literal', expression: { op: 'literal', value: 42 } },
  { name: 'price times quantity', expression: { op: 'multiply', left: { op: 'field', field: 'price' }, right: { op: 'field', field: 'quantity' } } },
  { name: 'total minus discount', expression: { op: 'subtract', left: { op: 'multiply', left: { op: 'field', field: 'price' }, right: { op: 'field', field: 'quantity' } }, right: { op: 'field', field: 'discount' } } },
  { name: 'a nested addition', expression: { op: 'add', left: { op: 'literal', value: 10 }, right: { op: 'add', left: { op: 'field', field: 'quantity' }, right: { op: 'field', field: 'discount' } } } },
];

describe('a formula result agrees with an independent evaluation', () => {
  for (const testCase of CASES) {
    it(testCase.name, () => {
      const engine = evaluateComputedColumn({ id: 'total', collection: 'items', field: 'total', expression: testCase.expression } as never, row);
      expect(engine).toBe(evaluate(testCase.expression, row));
    });
  }

  it('never divides by zero silently', () => {
    const zeroRow = { ...row, quantity: 0 };
    const expression: Expression = { op: 'divide', left: { op: 'field', field: 'price' }, right: { op: 'field', field: 'quantity' } };
    expect(() => evaluate(expression, zeroRow)).toThrow();
  });
});
