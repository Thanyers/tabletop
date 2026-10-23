// Local, disposable proof for F055: the authority holds a formula, imports a CSV,
// and every projection recomputes the same numbers the contract says. No AI, no network.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { parseCsv } from '../src/tabletop/ui/table-row-import.ts';
import { parseComputedFormula } from '../src/tabletop/shared/computed-formula.ts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from '../src/tabletop/domain/table.ts';
import { projectDomain } from '../src/tabletop/domain/projections.ts';

const FORMULA = 'IF(goods_total >= 5000, 0, IF(zone = "BKK", 35, IF(zone = "REG", 45, 45)) + IF(zone = "REM", 7.5, 0) + IF(weight_kg > 3, CEIL(weight_kg - 3) * 10, 0))';

const fields = [
  { id: 'order_id', label: 'Order ID', type: 'text', required: true },
  { id: 'zone', label: 'Zone', type: 'text', required: true },
  { id: 'weight_kg', label: 'Weight (kg)', type: 'number', required: false },
  { id: 'goods_total', label: 'Goods total', type: 'number', required: true },
  { id: 'declared_shipping', label: 'Declared shipping', type: 'number', required: true },
];

const change = {
  kind: 'table',
  program: {
    version: 1,
    title: 'Vendor orders (NS-SHIP-2026)',
    description: 'Local fixture: shipping fee from a contract formula.',
    collections: [{ id: 'orders', title: 'Orders', fields }],
    actions: [{
      id: 'set_weight', title: 'Set weight', description: 'Change one order weight.', roles: ['owner'],
      parameters: [
        { id: 'order', label: 'Order', type: 'record', collection: 'orders' },
        { id: 'weight', label: 'Weight (kg)', type: 'number', min: 0, max: 1000 },
      ],
      conditions: [], effects: [{ record: 'order', field: 'weight_kg', op: 'set', value: { input: 'weight' } }],
      requireTurn: false, advanceTurn: false,
    }],
    invariants: [], turnOrder: [], evidence: [], assumptions: [],
  },
  initialRecords: { orders: [] },
};

const owner = {
  actorId: 'local-owner', name: 'Local owner', role: 'owner', workspaceId: 'local-vendor', epoch: 1,
  now: 1_800_000_000_000,
  hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
};

const csv = parseCsv(await readFile(resolve('docs/examples/vendor-orders.csv'), 'utf8'));
const headers = csv.headers.map((header) => header.trim());
const rows = csv.rows.map((cells) => {
  const raw = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? '']));
  return {
    order_id: raw.order_id,
    zone: raw.zone,
    weight_kg: raw.weight_kg === '' ? null : Number(raw.weight_kg),
    goods_total: Number(raw.goods_total),
    declared_shipping: Number(raw.declared_shipping),
  };
});

const parsed = parseComputedFormula(FORMULA, fields);
if (!parsed.ok) throw new Error(parsed.error);

let state = applyTableChange(createTableState(), parseBoundedTableChange(change));
state = handleTableCommand(state, 'table.setComputedColumns', {
  columns: [{ id: 'shipping_fee', collection: 'orders', label: 'Shipping fee', expression: parsed.expression }],
}, owner).state;
state = handleTableCommand(state, 'table.importRows', { collection: 'orders', rows }, owner).state;

const statusOf = (fee, declared) => fee === null ? 'unresolved' : Math.abs(fee - declared) < 0.005 ? 'match' : 'check';

function snapshot(label) {
  const view = projectDomain(state, owner);
  const fees = view.computedValues?.values.orders ?? {};
  const output = view.records.orders.map((record) => {
    const fee = fees[record.id]?.shipping_fee ?? null;
    return {
      order_id: record.values.order_id, zone: record.values.zone, weight_kg: record.values.weight_kg,
      goods_total: record.values.goods_total, declared_shipping: record.values.declared_shipping,
      shipping_fee: fee, status: statusOf(fee, record.values.declared_shipping),
    };
  });
  const total = output.reduce((sum, row) => sum + (typeof row.shipping_fee === 'number' ? row.shipping_fee : 0), 0);
  return { label, rows: output, total: Math.round(total * 100) / 100, revision: view.dataRevision, computedRevision: view.computedValues?.revision };
}

const first = snapshot('initial import');
const secondRow = first.rows.find((row) => row.order_id === 'NS-1002');
const secondRecord = (() => {
  const view = projectDomain(state, owner);
  return view.records.orders.find((record) => record.values.order_id === 'NS-1002');
})();
// Same formula, new data: weight 5.2 -> 3.0 turns a "check" row into a matching 45.00 fee.
state = handleTableCommand(state, 'table.act', { actionId: 'set_weight', inputs: { order: secondRecord.id, weight: 3 } }, owner).state;
const updated = snapshot('after weight change');

const report = {
  generatedAt: new Date().toISOString(),
  formula: FORMULA,
  source: 'docs/examples/vendor-orders.csv',
  expectedFromContract: { total: 252.5, check: ['NS-1002'], unresolved: ['NS-1006'] },
  initial: first,
  afterWeightChange: { order: 'NS-1002', from: secondRow, to: updated.rows.find((row) => row.order_id === 'NS-1002'), total: updated.total },
  checks: {
    totalIs252_50: first.total === 252.5,
    oneCheckRow: first.rows.filter((row) => row.status === 'check').map((row) => row.order_id).join(',') === 'NS-1002',
    oneUnresolvedRow: first.rows.filter((row) => row.status === 'unresolved').map((row) => row.order_id).join(',') === 'NS-1006',
    weightChangeRecomputes: updated.rows.find((row) => row.order_id === 'NS-1002')?.shipping_fee === 45,
    totalAfterWeightChange: updated.total === 222.5,
  },
};
await mkdir('test-results', { recursive: true });
await writeFile('test-results/vendor-computed-local.json', JSON.stringify(report, null, 2));

console.table(first.rows);
console.log(JSON.stringify({ total: first.total, checks: report.checks, afterWeightChange: report.afterWeightChange.to }, null, 2));
const failed = Object.entries(report.checks).filter(([, ok]) => !ok);
if (failed.length > 0) { console.error('FAILED', failed.map(([name]) => name)); process.exitCode = 1; }
