import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext, DomainState } from '../shared/contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from './table';
import { decideDomain } from './index';
import { projectDomain } from './projections';

function inventoryChange(): unknown {
  return {
    kind: 'table',
    program: {
      version: 1,
      title: 'Inventory',
      description: 'Track equipment rows imported from a file.',
      collections: [{
        id: 'items',
        title: 'Items',
        fields: [
          { id: 'sku', label: 'SKU', type: 'text', required: true },
          { id: 'qty', label: 'Qty', type: 'number', required: true, min: 0, max: 100 },
          { id: 'note', label: 'Note', type: 'text', required: false },
          { id: 'active', label: 'Active', type: 'boolean', required: false, default: true },
        ],
      }],
      actions: [{
        id: 'add_item', title: 'Add item', description: 'Add one item.', roles: ['owner'],
        parameters: [], conditions: [], effects: [],
        creates: [{ collection: 'items', values: { sku: { literal: 'default' }, qty: { literal: 1 } } }],
        requireTurn: false, advanceTurn: false,
      }],
      invariants: [{ id: 'unique_sku', collection: 'items', fields: ['sku'], message: 'SKU must be unique.' }],
      turnOrder: ['host'],
      evidence: [],
      assumptions: [],
    },
    initialRecords: { items: [] },
  };
}

function actorContext(options: { role?: ActorContext['role']; hash?: ActorContext['hash'] } = {}): ActorContext {
  return {
    actorId: 'actor-1', name: 'Room owner', role: options.role ?? 'owner',
    workspaceId: 'workspace-1', epoch: 1, now: 1_800_000_000_000,
    hash: options.hash ?? (value => createHash('sha256').update(JSON.stringify(value)).digest('hex')),
  };
}

function activateChange(state: DomainState, change: unknown): DomainState {
  const actor = actorContext();
  const draft = decideDomain(state, { type: 'evolve.propose', payload: { change } }, actor).state;
  return decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, actor).state;
}

function active() {
  return applyTableChange(createTableState(), parseBoundedTableChange(inventoryChange()));
}

function salesChange(
  withComputedTotal: boolean,
  initialRecords: Record<string, unknown[]> = withComputedTotal ? {} : { sales: [] },
  referencesTotal = false,
  totalExpression?: unknown,
  incrementQuantityBy?: number,
  totalDefault?: number,
): unknown {
  const fields: Record<string, unknown>[] = [
    { id: 'sale_id', label: 'Sale ID', type: 'text', required: true },
    { id: 'branch', label: 'Branch', type: 'text', required: true },
    { id: 'product', label: 'Product', type: 'text', required: true },
    { id: 'quantity', label: 'Quantity', type: 'number', required: true, min: 0 },
    { id: 'unit_price', label: 'Unit price', type: 'number', required: true, min: 0 },
    { id: 'total', label: 'Total', type: 'number', required: true, min: 0 },
  ];
  if (totalDefault !== undefined) fields.find(field => field.id === 'total')!.default = totalDefault;
  if (withComputedTotal) fields.pop();
  const program: Record<string, unknown> = {
    version: 1,
    title: 'Sales',
    description: 'Track sales rows and calculate totals from quantity and unit price.',
    collections: [{ id: 'sales', title: 'Sales', fields }],
    actions: [{
      id: 'mark_north',
      title: 'Mark north branch',
      description: 'Mark one sale as a North branch sale.',
      roles: ['owner'],
      parameters: [{ id: 'sale', label: 'Sale', type: 'record', collection: 'sales' }],
      conditions: [],
      effects: [{
        record: 'sale',
        field: incrementQuantityBy === undefined ? referencesTotal ? 'total' : 'branch' : 'quantity',
        op: incrementQuantityBy === undefined ? 'set' : 'add',
        value: { literal: incrementQuantityBy ?? (referencesTotal ? 1 : 'North') },
      }],
      requireTurn: false,
      advanceTurn: false,
    }],
    invariants: [],
    turnOrder: [],
    evidence: [],
    assumptions: [],
  };
  if (withComputedTotal) {
    program.computedColumns = [{
      id: 'total',
      collection: 'sales',
      label: 'Total',
      expression: totalExpression ?? {
        op: 'multiply',
        left: { op: 'field', field: 'quantity' },
        right: { op: 'field', field: 'unit_price' },
      },
    }];
  }
  return { kind: 'table', program, initialRecords };
}

function salesTotalMetric(value: unknown): unknown {
  return {
    id: 'sales_total',
    kind: 'metric',
    title: 'Sales total',
    value: {
      op: 'aggregate',
      source: { op: 'collection', id: 'sales' },
      fn: 'sum',
      as: 'sale',
      value,
    },
  };
}

describe('table.importRows', () => {
  it('accepts saved formulas as passive table rules but rejects tables with no rules', () => {
    const formulaOnly = salesChange(true) as { program: { actions: unknown[] } };
    formulaOnly.program.actions = [];
    expect(() => parseBoundedTableChange(formulaOnly)).not.toThrow();

    const emptyPassive = salesChange(true) as { program: { actions: unknown[]; computedColumns: unknown[] } };
    emptyPassive.program.actions = [];
    emptyPassive.program.computedColumns = [];
    expect(() => parseBoundedTableChange(emptyPassive)).toThrow(/needs at least one action or saved compute rule/iu);
  });

  it('repairs a required total into an expression field and imports the canonical sales rows', () => {
    const original = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false)));
    const rows = [
      { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25 },
      { sale_id: 's2', branch: 'South', product: 'coffee', quantity: 5, unit_price: 30 },
    ];

    expect(() => handleTableCommand(original, 'table.importRows', { collection: 'sales', rows }, actorContext()))
      .toThrow('Total is required');

    const repaired = applyTableChange(original, parseBoundedTableChange(salesChange(true)));
    expect(repaired.program?.collections[0]?.fields.map(field => field.id)).toEqual([
      'sale_id', 'branch', 'product', 'quantity', 'unit_price',
    ]);
    expect(repaired.program?.computedColumns).toMatchObject([{ id: 'total', collection: 'sales' }]);

    const imported = handleTableCommand(repaired, 'table.importRows', { collection: 'sales', rows }, actorContext())!;
    const view = projectDomain(imported.state, actorContext());
    if (view.kind !== 'table') throw new Error('Expected a table projection.');
    const totals = Object.fromEntries(view.records.sales.map(row => [row.values.sale_id, view.computedValues?.values.sales?.[row.id]?.total]));

    expect(totals).toEqual({ s1: 75, s2: 150 });
    expect(imported.state.records.sales.every(row => !Object.hasOwn(row.values, 'total'))).toBe(true);
    expect(() => handleTableCommand(repaired, 'table.importRows', {
      collection: 'sales', rows: [{ sale_id: 's3', branch: 'East', product: 'water', quantity: 1, unit_price: 10, total: 10 }],
    }, actorContext())).toThrow(/unknown field/iu);
    const initialDerivedValue = salesChange(true, { sales: [{
      id: 'saved_sale_1',
      values: { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 },
    }] });
    expect(() => applyTableChange(createTableState(), parseBoundedTableChange(initialDerivedValue)))
      .toThrow(/must not supply computed field/iu);
  });

  it('promotes only a matching saved total and preserves every retained row value', () => {
    const storedRows = [{
      id: 'saved_sale_1',
      values: { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 },
    }];
    const original = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false, { sales: storedRows })));
    const repaired = applyTableChange(original, parseBoundedTableChange(salesChange(true)));

    expect(repaired.records.sales).toEqual(original.records.sales);
    expect(Object.hasOwn(repaired.records.sales[0]!.values, 'total')).toBe(true);
    const view = projectDomain(repaired, actorContext());
    if (view.kind !== 'table') throw new Error('Expected a table projection.');
    expect(view.computedValues?.values.sales?.saved_sale_1?.total).toBe(75);
    expect(view.records.sales[0]?.values).not.toHaveProperty('total');
  });

  it('replaces a metric that sums the stored total in the same promotion edit', () => {
    const storedRows = [{
      id: 'saved_sale_1',
      values: { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 },
    }];
    const originalChange = salesChange(false, { sales: storedRows }) as { program: Record<string, unknown> };
    originalChange.program.canvas = { version: 1, views: [salesTotalMetric({ op: 'field', record: 'sale', field: 'total' })] };
    originalChange.program.invariants = [{ id: 'unique_total', collection: 'sales', fields: ['total'], message: 'Totals must be unique.' }];
    const original = applyTableChange(createTableState(), parseBoundedTableChange(originalChange));

    const repairChange = salesChange(true) as { program: Record<string, unknown> };
    repairChange.program.canvas = {
      version: 1,
      views: [salesTotalMetric({
        op: 'math',
        fn: 'multiply',
        args: [
          { op: 'field', record: 'sale', field: 'quantity' },
          { op: 'field', record: 'sale', field: 'unit_price' },
        ],
      })],
    };
    repairChange.program.invariants = [{ id: 'unique_total', collection: 'sales', fields: ['sale_id'], message: 'Sale ids must be unique.' }];
    const repaired = applyTableChange(original, parseBoundedTableChange(repairChange));

    expect(repaired.records.sales).toEqual(original.records.sales);
    expect(repaired.program?.canvas?.views).toEqual([{
      id: 'sales_total',
      kind: 'metric',
      title: 'Sales total',
      value: {
        op: 'aggregate',
        source: { op: 'collection', id: 'sales' },
        fn: 'sum',
        as: 'sale',
        value: {
          op: 'math',
          fn: 'multiply',
          args: [
            { op: 'field', record: 'sale', field: 'quantity' },
            { op: 'field', record: 'sale', field: 'unit_price' },
          ],
        },
      },
    }]);
  });

  it('rejects a candidate that keeps a metric reference to the removed raw total', () => {
    const storedRows = [{
      id: 'saved_sale_1',
      values: { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 },
    }];
    const original = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false, { sales: storedRows })));
    const repairChange = salesChange(true) as { program: Record<string, unknown> };
    repairChange.program.canvas = { version: 1, views: [salesTotalMetric({ op: 'field', record: 'sale', field: 'total' })] };

    expect(() => applyTableChange(original, parseBoundedTableChange(repairChange)))
      .toThrow(/unknown field|unknown record field/iu);
    expect(original.program?.collections[0]?.fields.some(field => field.id === 'total')).toBe(true);
  });

  it('imports and reads a promoted value through authority, then rolls back without reviving a formula alias', () => {
    const legacyColumn = {
      id: 'legacy_total',
      collection: 'sales',
      label: 'Legacy total view',
      expression: {
        op: 'multiply',
        left: { op: 'field', field: 'quantity' },
        right: { op: 'field', field: 'unit_price' },
      },
    };
    let state = activateChange(createTableState(), salesChange(false));
    state = decideDomain(state, { type: 'table.setComputedColumns', payload: { columns: [legacyColumn] } }, actorContext()).state;
    state = decideDomain(state, {
      type: 'table.importRows',
      payload: { collection: 'sales', rows: [{ sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 }] },
    }, actorContext()).state;

    const promoted = activateChange(state, salesChange(true));
    if (promoted.kind !== 'table') throw new Error('Expected the promoted table.');
    expect(promoted.program?.computedColumns?.map(column => column.id)).toEqual(['total']);
    expect(promoted.computedColumns).toEqual([legacyColumn]);
    expect(promoted.records.sales[0]?.values.total).toBe(75);
    const promotedView = projectDomain(promoted, actorContext());
    if (promotedView.kind !== 'table') throw new Error('Expected a table projection.');
    expect(promotedView.computedColumns?.map(column => column.id)).toEqual(['total', 'legacy_total']);
    expect(promotedView.computedValues?.values.sales?.[promoted.records.sales[0]!.id]).toMatchObject({ total: 75, legacy_total: 75 });
    expect(promotedView.records.sales[0]?.values).not.toHaveProperty('total');

    const rollbackDraft = decideDomain(promoted, { type: 'evolve.rollback', payload: { revision: 1 } }, actorContext()).state;
    const restored = decideDomain(rollbackDraft, { type: 'evolve.autoApply', payload: {} }, actorContext()).state;
    if (restored.kind !== 'table') throw new Error('Expected a table after rollback.');
    expect(restored.program?.computedColumns).toBeUndefined();
    expect(restored.computedColumns).toEqual([legacyColumn]);
    expect(restored.records.sales[0]?.values.total).toBe(75);
    const restoredView = projectDomain(restored, actorContext());
    if (restoredView.kind !== 'table') throw new Error('Expected a table projection after rollback.');
    expect(restoredView.computedColumns?.map(column => column.id)).toEqual(['legacy_total']);
    expect(restoredView.computedValues?.values.sales?.[restored.records.sales[0]!.id]).toMatchObject({ legacy_total: 75 });
    expect(restoredView.computedValues?.values.sales?.[restored.records.sales[0]!.id]).not.toHaveProperty('total');
  });

  it('rejects rollback when a promoted field no longer matches its current formula', () => {
    const actor = actorContext();
    let state = activateChange(createTableState(), salesChange(false, { sales: [] }, false, undefined, 1));
    state = decideDomain(state, {
      type: 'table.importRows',
      payload: {
        collection: 'sales',
        rows: [
          { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 },
          { sale_id: 's2', branch: 'South', product: 'coffee', quantity: 5, unit_price: 30, total: 150 },
        ],
      },
    }, actor).state;
    state = activateChange(state, salesChange(true, {}, false, undefined, 1));

    const firstSale = state.kind === 'table' ? state.records.sales.find(row => row.values.sale_id === 's1') : undefined;
    if (!firstSale) throw new Error('Expected the first sale after import.');
    const adjusted = decideDomain(state, {
      type: 'table.act',
      payload: { actionId: 'mark_north', inputs: { sale: firstSale.id } },
    }, actor).state;
    if (adjusted.kind !== 'table') throw new Error('Expected the adjusted table.');
    expect(adjusted.records.sales.find(row => row.id === firstSale.id)?.values).toMatchObject({ quantity: 4, total: 75 });
    const adjustedBefore = structuredClone(adjusted);

    const rollbackDraft = decideDomain(adjusted, { type: 'evolve.rollback', payload: { revision: 1 } }, actor).state;
    const rollbackDraftBefore = structuredClone(rollbackDraft);
    expect(() => decideDomain(rollbackDraft, { type: 'evolve.autoApply', payload: {} }, actor))
      .toThrow(/saved value.*current formula|current formula.*saved value/iu);
    expect(rollbackDraft).toEqual(rollbackDraftBefore);
    expect(adjusted).toEqual(adjustedBefore);
    expect(adjusted.records.sales.find(row => row.id === firstSale.id)?.values).toMatchObject({ quantity: 4, total: 75 });
  });

  it('does not use an old field default when rollback has no matching historical value', () => {
    const actor = actorContext();
    let state = activateChange(createTableState(), salesChange(false, { sales: [] }, false, undefined, undefined, 0));
    state = decideDomain(state, {
      type: 'table.importRows',
      payload: { collection: 'sales', rows: [{ sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 75 }] },
    }, actor).state;
    state = activateChange(state, salesChange(true));
    state = decideDomain(state, {
      type: 'table.importRows',
      payload: { collection: 'sales', rows: [{ sale_id: 's2', branch: 'South', product: 'coffee', quantity: 2, unit_price: 10 }] },
    }, actor).state;
    if (state.kind !== 'table') throw new Error('Expected the active computed table.');
    expect(state.records.sales.find(row => row.values.sale_id === 's2')?.values).not.toHaveProperty('total');
    const rollbackDraft = decideDomain(state, { type: 'evolve.rollback', payload: { revision: 1 } }, actor).state;
    const rollbackDraftBefore = structuredClone(rollbackDraft);

    expect(() => decideDomain(rollbackDraft, { type: 'evolve.autoApply', payload: {} }, actor))
      .toThrow(/saved value.*current formula|current formula.*saved value/iu);
    expect(rollbackDraft).toEqual(rollbackDraftBefore);
    expect(state.records.sales.find(row => row.values.sale_id === 's2')?.values).not.toHaveProperty('total');
  });

  it('rejects promotion when a saved value differs and leaves the active state unchanged', () => {
    const storedRows = [{
      id: 'saved_sale_1',
      values: { sale_id: 's1', branch: 'North', product: 'tea', quantity: 3, unit_price: 25, total: 74 },
    }];
    const original = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false, { sales: storedRows })));
    const before = structuredClone(original);

    expect(() => applyTableChange(original, parseBoundedTableChange(salesChange(true))))
      .toThrow(/saved.*total|total.*saved|computed value/iu);
    expect(original).toEqual(before);
  });

  it('does not allow formula promotion to remove unrelated fields or referenced fields', () => {
    const original = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false)));
    const unrelatedRemoval = salesChange(true);
    const unrelatedProgram = (unrelatedRemoval as { program: { collections: Array<{ fields: Array<{ id: string }> }> } }).program;
    unrelatedProgram.collections[0]!.fields = unrelatedProgram.collections[0]!.fields.filter(field => field.id !== 'total' && field.id !== 'quantity');
    expect(() => applyTableChange(original, parseBoundedTableChange(unrelatedRemoval))).toThrow(/same id and collection|field definition|Unknown field/iu);

    const dependent = applyTableChange(createTableState(), parseBoundedTableChange(salesChange(false, { sales: [] }, true)));
    expect(() => applyTableChange(dependent, parseBoundedTableChange(salesChange(true, {}, true))))
      .toThrow(/unknown record field|unknown field/u);
  });

  it('rejects computed formulas that reference removed or other computed fields', () => {
    const cyclic = salesChange(true);
    const program = (cyclic as { program: { collections: Array<{ fields: Array<{ id: string }> }>; computedColumns: Array<{ id: string; collection: string; label: string; expression: unknown }> } }).program;
    program.collections[0]!.fields = program.collections[0]!.fields.filter(field => !['total', 'net_total'].includes(field.id));
    program.computedColumns = [
      { id: 'total', collection: 'sales', label: 'Total', expression: { op: 'field', field: 'net_total' } },
      { id: 'net_total', collection: 'sales', label: 'Net total', expression: { op: 'field', field: 'total' } },
    ];

    expect(() => parseBoundedTableChange(cyclic)).toThrow(/Unknown field/u);
  });

  it('imports typed rows, fills defaults, and keeps existing rows', () => {
    const before = active();
    const result = handleTableCommand(before, 'table.importRows', {
      collection: 'items',
      rows: [{ sku: 'CAM-1', qty: 3 }, { sku: 'TRIPOD-1', qty: 2, note: 'fragile' }],
    }, actorContext());
    expect(result).not.toBeNull();
    const rows = result!.state.records.items;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ values: { sku: 'CAM-1', qty: 3, note: null, active: true } });
    expect(rows[1]).toMatchObject({ values: { sku: 'TRIPOD-1', qty: 2, note: 'fragile', active: true } });
    for (const row of rows) expect(row.id).toMatch(/^record_[0-9]+_[0-9]{2}_[a-z0-9_-]{1,12}$/);
    expect(result!.state.dataRevision).toBe(before.dataRevision + 1);
    expect(result!.state.actionRevision).toBe((before.actionRevision ?? 0) + 1);
    expect(result!.state.activity.at(-1)?.action).toBe('Imported 2 rows into Items');
    expect(result!.label).toBe('Imported 2 rows into Items.');
    // The import does not touch the source table or the active program.
    expect(result!.state.program).toEqual(before.program);
    expect(result!.state.sources).toEqual(before.sources);
  });

  it('adds rows after existing records without touching them', () => {
    const seeded = applyTableChange(createTableState(), parseBoundedTableChange({
      ...(inventoryChange() as { program: unknown }),
      initialRecords: { items: [{ id: 'record_0_00_seed00000001', values: { sku: 'SEED-1', qty: 9, note: null, active: true } }] },
    }));
    const result = handleTableCommand(seeded, 'table.importRows', {
      collection: 'items', rows: [{ sku: 'NEW-1', qty: 1 }],
    }, actorContext());
    expect(result!.state.records.items.map(row => row.values.sku)).toEqual(['SEED-1', 'NEW-1']);
    expect(result!.state.records.items[0]).toEqual(seeded.records.items[0]);
  });

  it('rejects unknown fields, wrong types, out-of-range numbers and missing required values', () => {
    const state = active();
    const run = (rows: unknown[]) => () => handleTableCommand(state, 'table.importRows', { collection: 'items', rows }, actorContext());
    expect(run([{ sku: 'A', qty: 1, unknown: 'x' }])).toThrow('unknown field');
    expect(run([{ sku: 'A', qty: 'one' }])).toThrow('Qty is invalid');
    expect(run([{ sku: 'A', qty: 101 }])).toThrow('Qty is invalid');
    expect(run([{ sku: 'A', qty: -1 }])).toThrow('Qty is invalid');
    expect(run([{ qty: 1 }])).toThrow('SKU is required');
    expect(run([{ sku: '', qty: 1 }])).toThrow('SKU is invalid');
  });

  it('rejects duplicate unique values atomically', () => {
    const state = active();
    expect(() => handleTableCommand(state, 'table.importRows', {
      collection: 'items', rows: [{ sku: 'DUP', qty: 1 }, { sku: 'DUP', qty: 2 }],
    }, actorContext())).toThrow('SKU must be unique');
    expect(state.records.items).toEqual([]);
  });

  it('enforces the owner role and an active program', () => {
    const state = active();
    expect(() => handleTableCommand(state, 'table.importRows', { collection: 'items', rows: [{ sku: 'A', qty: 1 }] }, actorContext({ role: 'participant' })))
      .toThrow('cannot perform');
    expect(() => handleTableCommand(createTableState(), 'table.importRows', { collection: 'items', rows: [{ sku: 'A', qty: 1 }] }, actorContext()))
      .toThrow('Review and activate');
  });

  it('rejects imports that would exceed the collection or table row limits', () => {
    const state = active();
    expect(() => handleTableCommand(state, 'table.importRows', {
      collection: 'items', rows: Array.from({ length: 101 }, (_, index) => ({ sku: `S-${index}`, qty: 1 })),
    }, actorContext())).toThrow();
    const almostFull = applyTableChange(createTableState(), parseBoundedTableChange({
      ...(inventoryChange() as { program: unknown }),
      initialRecords: {
        items: Array.from({ length: 100 }, (_, index) => ({ id: `record_0_${String(index).padStart(2, '0')}_seed${String(index).padStart(8, '0')}`, values: { sku: `S-${index}`, qty: 1, note: null, active: true } })),
      },
    }));
    expect(() => handleTableCommand(almostFull, 'table.importRows', { collection: 'items', rows: [{ sku: 'ONE-MORE', qty: 1 }] }, actorContext()))
      .toThrow('at most 100 records');
  });
});
