import { describe, expect, it } from 'vitest';
import { jsonWithinBudget } from './json-budget';

describe('untrusted JSON parsing budget', () => {
  it('allows ordinary records and bounded nested expressions', () => {
    let expression: unknown = { op: 'literal', value: 1 };
    for (let index = 0; index < 31; index += 1) expression = { op: 'math', fn: 'abs', args: [expression] };
    expect(jsonWithinBudget({ program: { expression }, rows: [{ id: 'item', value: null }] })).toBe(true);
  });

  it('rejects deep and broad input before a recursive parser runs', () => {
    let deep: unknown = 0;
    for (let index = 0; index < 2000; index += 1) deep = { child: deep };
    expect(jsonWithinBudget(deep)).toBe(false);
    expect(jsonWithinBudget(Array.from({ length: 30_001 }, () => 0))).toBe(false);
  });

  it('rejects cycles, unsafe keys, non-JSON values and non-finite numbers', () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    for (const value of [cycle, JSON.parse('{"__proto__":{}}'), { value: undefined }, { value: Infinity }, new Date()]) {
      expect(jsonWithinBudget(value)).toBe(false);
    }
  });
});
