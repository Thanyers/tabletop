import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { TableField } from '../shared/table-contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from './table';
import { projectDomain } from './projections';
import { parseComputedFormula } from '../shared/computed-formula';

const fields: TableField[] = [
  { id: 'order_id', label: 'Order ID', type: 'text', required: true },
  { id: 'zone', label: 'Zone', type: 'text', required: true },
  { id: 'weight_kg', label: 'Weight (kg)', type: 'number', required: false },
  { id: 'goods_total', label: 'Goods total', type: 'number', required: true },
  { id: 'declared_shipping', label: 'Declared shipping', type: 'number', required: true },
];

const FORMULA = 'IF(goods_total >= 5000, 0, IF(zone = "BKK", 35, IF(zone = "REG", 45, 45)) + IF(zone = "REM", 7.5, 0) + IF(weight_kg > 3, CEIL(weight_kg - 3) * 10, 0))';

const orders = [
  { order_id: 'NS-1001', zone: 'BKK', weight_kg: 2.4, goods_total: 1820, declared_shipping: 35 },
  { order_id: 'NS-1002', zone: 'REG', weight_kg: 5.2, goods_total: 2450, declared_shipping: 55 },
  { order_id: 'NS-1003', zone: 'REM', weight_kg: 3, goods_total: 990, declared_shipping: 52.5 },
  { order_id: 'NS-1004', zone: 'BKK', weight_kg: 7.8, goods_total: 5200, declared_shipping: 0 },
  { order_id: 'NS-1005', zone: 'REG', weight_kg: 0.8, goods_total: 610, declared_shipping: 45 },
  { order_id: 'NS-1006', zone: 'REM', weight_kg: null, goods_total: 1200, declared_shipping: 60 },
  { order_id: 'NS-1007', zone: 'BKK', weight_kg: 3.01, goods_total: 1500, declared_shipping: 45 },
];

function change(): unknown {
  return {
    kind: 'table',
    program: {
      version: 1, title: 'Vendor orders', description: 'Orders priced by the NS-SHIP-2026 contract.',
      collections: [{ id: 'orders', title: 'Orders', fields }],
      actions: [{
        id: 'add_manual', title: 'Add manual order', description: 'Adds one placeholder order.', roles: ['owner'],
        parameters: [], conditions: [], effects: [],
        creates: [{ collection: 'orders', values: {
          order_id: { literal: 'NS-9999' }, zone: { literal: 'BKK' }, weight_kg: { literal: 1 }, goods_total: { literal: 100 }, declared_shipping: { literal: 35 },
        } }],
        requireTurn: false, advanceTurn: false,
      }],
      invariants: [], turnOrder: [], evidence: [], assumptions: [],
    },
    initialRecords: { orders: [] },
  };
}

function context(role: ActorContext['role'], actorId: string): ActorContext {
  return {
    actorId, name: role === 'owner' ? 'Owner' : 'Member', role, seat: role === 'owner' ? undefined : 'member-1',
    workspaceId: 'workspace-1', epoch: 1, now: 1_800_000_000_000,
    hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

function activated() {
  const state = applyTableChange(createTableState(), parseBoundedTableChange(change()));
  const parsed = parseComputedFormula(FORMULA, fields);
  if (!parsed.ok) throw new Error(parsed.error);
  const withColumn = handleTableCommand(state, 'table.setComputedColumns', {
    columns: [{ id: 'shipping_fee', collection: 'orders', label: 'Shipping fee', expression: parsed.expression }],
  }, context('owner', 'actor-1'))!.state;
  return handleTableCommand(withColumn, 'table.importRows', { collection: 'orders', rows: orders }, context('owner', 'actor-1'))!.state;
}

describe('server-projected computed values (F055)', () => {
  it('computes every row for the owner and the member, and never stores the values', () => {
    const state = activated();
    expect(state.computedValues).toBeUndefined();
    const ownerView = projectDomain(state, context('owner', 'actor-1'));
    const memberView = projectDomain(state, context('participant', 'actor-2'));
    if (ownerView.kind !== 'table' || memberView.kind !== 'table') throw new Error('Expected table projections.');
    const fees = ownerView.computedValues?.values.orders;
    expect(fees).toBeDefined();
    const rows = ownerView.records.orders;
    const byOrder = Object.fromEntries(rows.map((record) => [record.values.order_id, fees?.[record.id]?.shipping_fee]));
    expect(byOrder).toEqual({
      'NS-1001': 35, 'NS-1002': 75, 'NS-1003': 52.5, 'NS-1004': 0, 'NS-1005': 45, 'NS-1006': null, 'NS-1007': 45,
    });
    const total = Object.values(byOrder).reduce<number>((sum, value) => sum + (typeof value === 'number' ? value : 0), 0);
    expect(Math.round(total * 100) / 100).toBe(252.5);
    expect(memberView.computedValues).toEqual(ownerView.computedValues);
  });

  it('recomputes from changed data without redefining the formula', () => {
    const before = activated();
    const after = handleTableCommand(before, 'table.importRows', {
      collection: 'orders',
      rows: [{ order_id: 'NS-1008', zone: 'REM', weight_kg: 4.2, goods_total: 800, declared_shipping: 52.5 }],
    }, context('owner', 'actor-1'))!.state;
    const view = projectDomain(after, context('owner', 'actor-1'));
    if (view.kind !== 'table') throw new Error('Expected a table projection.');
    const added = view.records.orders.find((record) => record.values.order_id === 'NS-1008');
    expect(added).toBeDefined();
    expect(view.computedValues?.values.orders[added!.id]?.shipping_fee).toBe(72.5);
    // The earlier rows keep their values; data did not change them.
    const second = view.records.orders.find((record) => record.values.order_id === 'NS-1002');
    expect(view.computedValues?.values.orders[second!.id]?.shipping_fee).toBe(75);
    expect(view.computedColumns?.[0]?.expression).toEqual(before.computedColumns?.[0]?.expression);
  });

  it('drops computed values when the formula is cleared', () => {
    const cleared = handleTableCommand(activated(), 'table.setComputedColumns', { columns: [] }, context('owner', 'actor-1'))!.state;
    const view = projectDomain(cleared, context('owner', 'actor-1'));
    expect(view.kind === 'table' && view.computedValues).toBeFalsy();
  });
});
