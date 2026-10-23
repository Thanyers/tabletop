import { describe, expect, it } from 'vitest';
import { applyTablePatch, tablePatchSchema, type TablePatch } from './table-patch';
import { tableChangeSchema } from './table';
import { equipmentChange } from '../testing/table-scenarios';

const current = (() => {
  const change = equipmentChange('source_equipment');
  if (change.kind !== 'table') throw new Error('Expected a table change.');
  return change.program;
})();
const patch = (value: Omit<TablePatch, 'kind'>): TablePatch => tablePatchSchema.parse({ kind: 'table-patch', ...value });
const merged = (value: Omit<TablePatch, 'kind'>) => {
  const result = applyTablePatch(current, patch(value));
  if ('issues' in result) throw new Error(result.issues.join(' '));
  return tableChangeSchema.parse(result.change).program;
};
const view = { id: 'heatmap', kind: 'scene', title: 'Heatmap', width: 200, height: 100, elements: [{ id: 'cell', shape: 'rect', x: 0, y: 0, width: 10, height: 10, fill: '#40c463' }] };

describe('table patch (F065)', () => {
  it('upserts and removes formula columns through the same validated patch path', () => {
    const program = structuredClone(current);
    program.collections[0]!.fields.push({ id: 'quantity', label: 'Quantity', type: 'number', required: false });
    const formula = {
      id: 'quantity_total', collection: 'equipment', label: 'Quantity total',
      expression: { op: 'field', field: 'quantity' },
    };
    const added = applyTablePatch(program, patch({ upsert: { computedColumns: [formula] } }));
    if ('issues' in added) throw new Error(added.issues.join(' '));
    expect(tableChangeSchema.parse(added.change).program.computedColumns).toEqual([formula]);

    const removed = applyTablePatch(tableChangeSchema.parse(added.change).program, patch({ remove: { computedColumns: ['quantity_total'] } }));
    if ('issues' in removed) throw new Error(removed.issues.join(' '));
    expect(tableChangeSchema.parse(removed.change).program.computedColumns).toEqual([]);
  });

  it('adds, preserves, edits and removes reusable modules through the same validated patch path', () => {
    const module = { id: 'double', name: 'Double a number', description: 'Multiply a number by two.', version: 1, runtime: 'javascript', source: 'export default inputs => ({total:inputs.amount*2});', inputs: [{ id: 'amount', label: 'Amount', type: 'number', binding: { kind: 'literal', value: 7 } }], outputs: [{ id: 'total', label: 'Total', type: 'number' }] };
    const first = merged({ upsert: { computeModules: [module] } });
    expect(first.compute?.modules[0].id).toBe('double');
    const unrelated = applyTablePatch(first, patch({ set: { title: 'New title' } }));
    if ('issues' in unrelated) throw new Error('Expected a merged patch');
    expect(tableChangeSchema.parse(unrelated.change).program.compute).toEqual(first.compute);
    const removed = applyTablePatch(first, patch({ remove: { computeModules: ['double'] } }));
    if ('issues' in removed) throw new Error('Expected a merged patch');
    expect(tableChangeSchema.parse(removed.change).program.compute?.modules).toEqual([]);
  });

  it('adds a view and keeps every other part of the program as it was', () => {
    const program = merged({ upsert: { views: [view] } });
    expect(program.canvas?.views.map((item) => item.id)).toEqual([...(current.canvas?.views ?? []).map((item) => item.id), 'heatmap']);
    expect(program.actions).toEqual(current.actions);
    expect(program.collections).toEqual(current.collections);
    expect(program.evidence).toEqual(current.evidence);
  });

  it('replaces an item with the same id in place, removes by id, and sets fields', () => {
    const action = { ...current.actions[0], title: 'Borrow now' };
    const program = merged({
      upsert: { actions: [action] },
      remove: { invariants: current.invariants.map((item) => item.id) },
      set: { title: 'Gear desk' },
      addAssumptions: ['Loans last one day.'],
    });
    expect(program.actions[0]?.title).toBe('Borrow now');
    expect(program.actions).toHaveLength(current.actions.length);
    expect(program.invariants).toEqual([]);
    expect(program.title).toBe('Gear desk');
    expect(program.assumptions.at(-1)).toBe('Loans last one day.');
  });

  it('explains a patch that cannot apply instead of guessing', () => {
    const result = applyTablePatch(current, patch({ remove: { actions: ['missing'] }, upsert: { views: [view, view] } }));
    expect('issues' in result && result.issues.join(' ')).toMatch(/"missing" is not in the current program/u);
    expect('issues' in result && result.issues.join(' ')).toMatch(/appears twice/u);
    const empty = applyTablePatch(current, patch({}));
    expect('issues' in empty && empty.issues[0]).toMatch(/changes nothing/u);
  });

  it('still fails ordinary validation after merging, e.g. removing every action', () => {
    const result = applyTablePatch(current, patch({ remove: { actions: current.actions.map((item) => item.id) } }));
    if ('issues' in result) throw new Error('Expected a merged change.');
    expect(tableChangeSchema.safeParse(result.change).success).toBe(false);
  });
});
