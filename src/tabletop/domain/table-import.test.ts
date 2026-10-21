import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from './table';

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

function active() {
  return applyTableChange(createTableState(), parseBoundedTableChange(inventoryChange()));
}

describe('table.importRows', () => {
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
