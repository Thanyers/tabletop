import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState, parseBoundedTableChange } from './table';

const metric = { id: 'total_view', kind: 'metric', title: 'Total items', value: { op: 'literal', value: 1 } };
const chart = { id: 'sku_chart', kind: 'chart', title: 'By SKU', chart: 'bar', collection: 'items', categoryField: 'sku', value: { op: 'literal', value: 1 } };

function change(canvas?: unknown, initialRecords: Record<string, unknown[]> = { items: [] }): unknown {
  return {
    kind: 'table',
    program: {
      version: 1, title: 'Inventory', description: 'Items.',
      collections: [{ id: 'items', title: 'Items', fields: [{ id: 'sku', label: 'SKU', type: 'text', required: true }] }],
      actions: [{
        id: 'add_item', title: 'Add item', description: 'Add one item.', roles: ['owner'],
        parameters: [], conditions: [], effects: [],
        creates: [{ collection: 'items', values: { sku: { literal: 'sample' } } }],
        requireTurn: false, advanceTurn: false,
      }], invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
      ...(canvas ? { canvas } : {}),
    },
    initialRecords,
  };
}

describe('canvas views during evolve', () => {
  it('keeps views when a rule edit omits the canvas entirely', () => {
    const active = applyTableChange(createTableState(), parseBoundedTableChange(change({ version: 1, views: [metric, chart] })));
    expect(active.program?.canvas?.views).toHaveLength(2);
    const next = applyTableChange(active, parseBoundedTableChange(change(undefined, {})));
    expect(next.program?.canvas?.views.map((view) => view.id)).toEqual(['total_view', 'sku_chart']);
    // Records and the rest of the program are untouched by the carry.
    expect(next.records.items).toEqual(active.records.items);
    expect(next.program?.collections).toEqual(active.program?.collections);
  });

  it('lets the returned view win while carrying the missing one', () => {
    const active = applyTableChange(createTableState(), parseBoundedTableChange(change({ version: 1, views: [metric, chart] })));
    const renamed = { ...metric, title: 'Renamed total' };
    const next = applyTableChange(active, parseBoundedTableChange(change({ version: 1, views: [renamed] }, {})));
    expect(next.program?.canvas?.views.map((view) => view.id)).toEqual(['total_view', 'sku_chart']);
    expect(next.program?.canvas?.views[0]).toEqual(renamed);
  });

  it('does not invent a canvas when the table never had one', () => {
    const active = applyTableChange(createTableState(), parseBoundedTableChange(change()));
    expect(active.program?.canvas).toBeUndefined();
    const next = applyTableChange(active, parseBoundedTableChange(change(undefined, {})));
    expect(next.program?.canvas).toBeUndefined();
  });
});
