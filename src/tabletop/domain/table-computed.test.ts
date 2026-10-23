import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from './table';

function inventoryChange(): unknown {
  return {
    kind: 'table',
    program: {
      version: 1, title: 'Inventory', description: 'Items with a computed total.',
      collections: [{
        id: 'items', title: 'Items',
        fields: [
          { id: 'sku', label: 'SKU', type: 'text', required: true },
          { id: 'qty', label: 'Qty', type: 'number', required: true, min: 0, max: 1000 },
          { id: 'price', label: 'Price', type: 'number', required: false, min: 0, max: 1000 },
        ],
      }],
      actions: [{
        id: 'add_item', title: 'Add item', description: 'Add one item.', roles: ['owner'],
        parameters: [], conditions: [], effects: [],
        creates: [{ collection: 'items', values: { sku: { literal: 'default' }, qty: { literal: 1 } } }],
        requireTurn: false, advanceTurn: false,
      }],
      invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
    },
    initialRecords: { items: [] },
  };
}

function actorContext(role: ActorContext['role'] = 'owner'): ActorContext {
  return {
    actorId: 'actor-1', name: 'Room owner', role,
    workspaceId: 'workspace-1', epoch: 1, now: 1_800_000_000_000,
    hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

const totalColumn = {
  id: 'total', collection: 'items', label: 'Total',
  expression: { op: 'multiply', left: { op: 'field', field: 'qty' }, right: { op: 'field', field: 'price' } },
};

function active() {
  return applyTableChange(createTableState(), parseBoundedTableChange(inventoryChange()));
}

describe('table.setComputedColumns', () => {
  it('stores definitions on the state and bumps dataRevision', () => {
    const before = active();
    const result = handleTableCommand(before, 'table.setComputedColumns', { columns: [totalColumn] }, actorContext());
    expect(result).not.toBeNull();
    expect(result!.state.computedColumns).toEqual([totalColumn]);
    expect(result!.state.dataRevision).toBe(before.dataRevision + 1);
    expect(result!.state.activity.at(-1)?.action).toBe('Computed columns updated (1)');
    // The program itself is untouched, so older writers can still read it.
    expect(result!.state.program).toEqual(before.program);
  });

  it('replaces the whole set and accepts an empty list to clear it', () => {
    const withColumn = handleTableCommand(active(), 'table.setComputedColumns', { columns: [totalColumn] }, actorContext())!.state;
    const cleared = handleTableCommand(withColumn, 'table.setComputedColumns', { columns: [] }, actorContext())!;
    expect(cleared.state.computedColumns).toEqual([]);
    const other = { ...totalColumn, id: 'total2', label: 'Total 2' };
    const replaced = handleTableCommand(withColumn, 'table.setComputedColumns', { columns: [other] }, actorContext())!;
    expect(replaced.state.computedColumns).toEqual([other]);
  });

  it('keeps definitions across row imports and rule edits', () => {
    const withColumn = handleTableCommand(active(), 'table.setComputedColumns', { columns: [totalColumn] }, actorContext())!.state;
    const imported = handleTableCommand(withColumn, 'table.importRows', { collection: 'items', rows: [{ sku: 'A', qty: 2, price: 3 }] }, actorContext())!.state;
    expect(imported.computedColumns).toEqual([totalColumn]);
    expect(imported.records.items).toHaveLength(1);
    const ruleEdit = { ...(inventoryChange() as { program: unknown }), initialRecords: {} };
    const reApplied = applyTableChange(imported, parseBoundedTableChange(ruleEdit));
    expect(reApplied.computedColumns).toEqual([totalColumn]);
  });

  it('rejects bad definitions, other roles and inactive tables', () => {
    const state = active();
    const run = (payload: unknown, role: ActorContext['role'] = 'owner') => () => handleTableCommand(state, 'table.setComputedColumns', payload, actorContext(role));
    expect(run({ columns: [totalColumn] }, 'participant')).toThrow('cannot perform');
    expect(run({ columns: [{ ...totalColumn, collection: 'missing' }] })).toThrow('unknown collection');
    expect(run({ columns: [{ ...totalColumn, expression: { op: 'field', field: 'missing' } }] })).toThrow('Unknown field');
    expect(run({ columns: [{ ...totalColumn, expression: { op: 'field', field: 'sku' } }] })).toThrow('must produce a number');
    expect(run({ columns: Array.from({ length: 7 }, (_, index) => ({ ...totalColumn, id: `total${index}` })) })).toThrow();
    expect(() => handleTableCommand(createTableState(), 'table.setComputedColumns', { columns: [totalColumn] }, actorContext())).toThrow('Review and activate');
  });
});
