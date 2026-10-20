import type { ControlDescriptor, GenerativeExpression, ScenePrimitive } from '../shared/generative-contracts';
import type { TableAction, TableChange, TableCollection, TableField, TableOperand, TableProgram, TableRecord } from '../shared/table-contracts';

const numberField = (id: string, min = -1_000_000, max = 1_000_000): TableField => ({ id, label: id, type: 'number', required: true, min, max });
const textField = (id: string, choices?: string[]): TableField => ({ id, label: id, type: 'text', required: true, ...(choices ? { choices } : {}) });
const selected = (parameter: string, field: string): TableOperand => ({ record: parameter, field });
const expression = (value: GenerativeExpression): TableOperand => ({ expression: value });
const selectedField = (parameter: string, field: string): GenerativeExpression => ({ op: 'selectedField', parameter, field });
const literal = (value: string | number | boolean): TableOperand => ({ literal: value });
const recordField = (collection: string, recordId: string, field: string): GenerativeExpression => ({ op: 'recordField', collection, recordId, field });
const math = (fn: Extract<GenerativeExpression, { op: 'math' }>['fn'], ...args: GenerativeExpression[]): GenerativeExpression => ({ op: 'math', fn, args });

function action(id: string, parameters: TableAction['parameters'], effects: TableAction['effects'], options: Partial<Pick<TableAction, 'conditions' | 'requireTurn' | 'advanceTurn'>> = {}): TableAction {
  return { id, title: id, description: id, roles: ['owner', 'participant'], parameters, conditions: options.conditions ?? [], effects, requireTurn: options.requireTurn ?? false, advanceTurn: options.advanceTurn ?? false };
}
function program(title: string, collections: TableCollection[], actions: TableAction[], turnOrder: string[] = [], canvas?: TableProgram['canvas']): TableProgram {
  return { version: 1, title, description: title, collections, actions, invariants: [], turnOrder, evidence: [], assumptions: [], ...(canvas ? { canvas } : {}) };
}
function change(programValue: TableProgram, records: Record<string, TableRecord[]>): TableChange { return { kind: 'table', program: programValue, initialRecords: records }; }
const recordParameter = (id: string, collection: string) => ({ id, label: id, type: 'record' as const, collection });
const control = (value: ControlDescriptor): ControlDescriptor => value;

const cafeCollections: TableCollection[] = [
  { id: 'clock', title: 'Cafe clock', fields: [numberField('minute', 0, 1440)] },
  { id: 'queue', title: 'Queue', fields: [numberField('arrived_at', 0, 1440), textField('status', ['waiting', 'serving', 'served']), numberField('wait_minutes', 0, 1440)] },
  { id: 'staff', title: 'Staff', fields: [numberField('available', 0, 20)] },
];
const cafeActions: TableAction[] = [
  action('advance_time', [recordParameter('clock', 'clock'), { id: 'minutes', label: 'Minutes', type: 'number', min: 1, max: 60 }], [
    { record: 'clock', field: 'minute', op: 'add', value: { input: 'minutes' } },
  ]),
  action('start_service', [recordParameter('order', 'queue'), recordParameter('staff', 'staff'), recordParameter('clock', 'clock')], [
    { record: 'order', field: 'status', op: 'set', value: literal('serving') },
    { record: 'order', field: 'wait_minutes', op: 'set', value: expression(math('subtract', selectedField('clock', 'minute'), selectedField('order', 'arrived_at'))) },
    { record: 'staff', field: 'available', op: 'add', value: literal(-1) },
  ], { conditions: [
    { left: selected('order', 'status'), op: 'eq', right: literal('waiting'), message: 'Choose an order still waiting.' },
    { left: selected('staff', 'available'), op: 'gt', right: literal(0), message: 'No staff member is available.' },
  ] }),
];
const cafeElements: ScenePrimitive[] = [
  { id: 'queue-card', shape: 'rect', x: 24, y: 28, width: 170, height: 64, rx: 8, fill: '#fff7ed', stroke: '#f97316' },
  { id: 'queue-status', shape: 'text', x: 36, y: 54, text: recordField('queue', 'order-1', 'status'), fontSize: 16, fill: '#7c2d12' },
  { id: 'staff-count', shape: 'circle', cx: 270, cy: 56, r: recordField('staff', 'staff-1', 'available'), fill: '#0f766e' },
];
const cafeForm: ControlDescriptor = control({ id: 'start-order', kind: 'form', label: 'Start service', actionId: 'start_service', inputs: { order: { kind: 'control' }, staff: { kind: 'control' }, clock: { kind: 'record', collection: 'clock', recordId: 'clock-1' } } });
export const cafeQueueChange = change(program('Cafe queue and staffing simulation', cafeCollections, cafeActions, [], { version: 1, views: [
  { id: 'cafe-floor', kind: 'scene', title: 'Cafe floor', width: 360, height: 150, elements: cafeElements, relatedTo: { collections: ['queue', 'staff'] } },
  { id: 'average-wait', kind: 'metric', title: 'Average queue wait', value: { op: 'aggregate', source: { op: 'collection', id: 'queue' }, fn: 'mean', as: 'order', value: { op: 'field', record: 'order', field: 'wait_minutes' } }, format: 'number', relatedTo: { collections: ['queue'] } },
  { id: 'queue-chart', kind: 'chart', title: 'Queue waits', chart: 'bar', collection: 'queue', categoryField: 'status', value: { op: 'field', record: 'row', field: 'wait_minutes' }, relatedTo: { views: ['average-wait'], collections: ['queue'] } },
  { id: 'service-controls', kind: 'controls', title: 'Service controls', controls: [
    control({ id: 'time-step', kind: 'button', label: 'Advance 5 minutes', actionId: 'advance_time', inputs: { clock: { kind: 'record', collection: 'clock', recordId: 'clock-1' }, minutes: { kind: 'literal', value: 5 } } }),
    cafeForm,
  ] },
] }), {
  clock: [{ id: 'clock-1', values: { minute: 20 } }],
  queue: [{ id: 'order-1', values: { arrived_at: 8, status: 'waiting', wait_minutes: 0 } }],
  staff: [{ id: 'staff-1', values: { available: 1 } }],
});

const shadowCollection: TableCollection = { id: 'lights', title: 'Light and object', fields: [numberField('light_x', 0, 100), numberField('light_y', 0, 100), numberField('object_x', 0, 100), numberField('top_y', 1, 100), numberField('ground_y', 1, 120)] };
const lightRecord = 'light-1';
const shadowX = math('add', recordField('lights', lightRecord, 'light_x'), math('divide', math('multiply', math('subtract', recordField('lights', lightRecord, 'ground_y'), recordField('lights', lightRecord, 'light_y')), math('subtract', recordField('lights', lightRecord, 'object_x'), recordField('lights', lightRecord, 'light_x'))), math('subtract', recordField('lights', lightRecord, 'top_y'), recordField('lights', lightRecord, 'light_y'))));
const moveLight = action('move_light', [recordParameter('light', 'lights'), { id: 'x', label: 'Light x', type: 'number', min: 0, max: 100 }, { id: 'y', label: 'Light y', type: 'number', min: 0, max: 100 }], [
  { record: 'light', field: 'light_x', op: 'set', value: { input: 'x' } },
  { record: 'light', field: 'light_y', op: 'set', value: { input: 'y' } },
]);
const lightDrag = { actionId: 'move_light', xParameter: 'x', yParameter: 'y', inputs: { light: { kind: 'record' as const, collection: 'lights', recordId: lightRecord }, x: { kind: 'control' as const }, y: { kind: 'control' as const } } };
export const lightShadowChange = change(program('Prompt-driven light and shadow geometry', [shadowCollection], [moveLight], [], { version: 1, views: [
  { id: 'light-shadow-scene', kind: 'scene', title: 'Light and shadow', width: 420, height: 180, relatedTo: { collections: ['lights'] }, elements: [
    { id: 'light-source', shape: 'circle', cx: recordField('lights', lightRecord, 'light_x'), cy: recordField('lights', lightRecord, 'light_y'), r: 8, fill: '#facc15', drag: lightDrag },
    { id: 'object', shape: 'rect', x: recordField('lights', lightRecord, 'object_x'), y: recordField('lights', lightRecord, 'top_y'), width: 12, height: math('subtract', recordField('lights', lightRecord, 'ground_y'), recordField('lights', lightRecord, 'top_y')), fill: '#334155' },
    { id: 'shadow', shape: 'polygon', points: [
      { x: recordField('lights', lightRecord, 'object_x'), y: recordField('lights', lightRecord, 'ground_y') },
      { x: shadowX, y: recordField('lights', lightRecord, 'ground_y') },
      { x: recordField('lights', lightRecord, 'object_x'), y: recordField('lights', lightRecord, 'top_y') },
    ], fill: '#94a3b8' },
  ] },
  { id: 'shadow-tip', kind: 'metric', title: 'Shadow tip x', value: shadowX, format: 'number', relatedTo: { views: ['light-shadow-scene'] } },
  { id: 'light-controls', kind: 'controls', title: 'Move light', relatedTo: { views: ['light-shadow-scene'] }, controls: [
    control({ id: 'light-x', kind: 'slider', label: 'Light x', actionId: 'move_light', parameter: 'x', min: 0, max: 100, value: recordField('lights', lightRecord, 'light_x'), inputs: { light: { kind: 'record', collection: 'lights', recordId: lightRecord }, x: { kind: 'control' }, y: { kind: 'expression', value: recordField('lights', lightRecord, 'light_y') } } }),
    control({ id: 'light-y', kind: 'slider', label: 'Light y', actionId: 'move_light', parameter: 'y', min: 0, max: 100, value: recordField('lights', lightRecord, 'light_y'), inputs: { light: { kind: 'record', collection: 'lights', recordId: lightRecord }, x: { kind: 'expression', value: recordField('lights', lightRecord, 'light_x') }, y: { kind: 'control' } } }),
  ] },
] }), { lights: [{ id: lightRecord, values: { light_x: 20, light_y: 10, object_x: 50, top_y: 50, ground_y: 90 } }] });

const waterCollections: TableCollection[] = [
  { id: 'reservoirs', title: 'Shared reservoir', fields: [numberField('water', 0, 10_000)] },
  { id: 'teams', title: 'Cooperative teams', fields: [numberField('delivered', 0, 10_000)] },
];
const withdrawWater = action('withdraw_water', [recordParameter('reservoir', 'reservoirs'), recordParameter('team', 'teams'), { id: 'amount', label: 'Water amount', type: 'number', min: 1, max: 50 }], [
  { record: 'reservoir', field: 'water', op: 'add', value: expression(math('multiply', { op: 'literal', value: -1 }, { op: 'input', id: 'amount' })) },
  { record: 'team', field: 'delivered', op: 'add', value: { input: 'amount' } },
], { conditions: [{ left: selected('reservoir', 'water'), op: 'gte', right: { input: 'amount' }, message: 'The reservoir does not hold enough water.' }], requireTurn: true, advanceTurn: true });
export const cooperativeWaterChange = change(program('Cooperative water allocation', waterCollections, [withdrawWater], ['member-1', 'host', 'member-2'], { version: 1, views: [
  { id: 'water-stock', kind: 'metric', title: 'Water remaining', value: { op: 'aggregate', source: { op: 'collection', id: 'reservoirs' }, fn: 'sum', as: 'reservoir', value: { op: 'field', record: 'reservoir', field: 'water' } }, relatedTo: { collections: ['reservoirs'] } },
  { id: 'south-delivery', kind: 'metric', title: 'South team delivered', value: recordField('teams', 'team-south', 'delivered'), format: 'number', relatedTo: { collections: ['teams'] } },
  { id: 'water-controls', kind: 'controls', title: 'Take your turn', relatedTo: { collections: ['reservoirs', 'teams'] }, controls: [
    control({ id: 'withdrawal', kind: 'slider', label: 'Withdraw water', actionId: 'withdraw_water', parameter: 'amount', min: 1, max: 50, value: { op: 'literal', value: 10 }, inputs: { reservoir: { kind: 'record', collection: 'reservoirs', recordId: 'north-well' }, team: { kind: 'record', collection: 'teams', recordId: 'team-north' }, amount: { kind: 'control' } } }),
    control({ id: 'withdrawal-form', kind: 'form', label: 'Choose a team and amount', actionId: 'withdraw_water', inputs: { reservoir: { kind: 'record', collection: 'reservoirs', recordId: 'north-well' }, team: { kind: 'control' }, amount: { kind: 'control' } } }),
  ] },
] }), {
  reservoirs: [{ id: 'north-well', values: { water: 100 } }],
  teams: [{ id: 'team-north', values: { delivered: 0 } }, { id: 'team-south', values: { delivered: 0 } }],
});

const loanRate = math('divide', selectedField('loan', 'annual_rate'), { op: 'literal', value: 12 });
const loanFactor = math('power', math('add', { op: 'literal', value: 1 }, loanRate), selectedField('loan', 'months'));
const monthlyPayment = math('divide', math('multiply', math('multiply', selectedField('loan', 'principal'), loanRate), loanFactor), math('subtract', loanFactor, { op: 'literal', value: 1 }));
const loanCollection: TableCollection = { id: 'loans', title: 'Loan terms', fields: [numberField('principal', 0, 1_000_000), numberField('annual_rate', 0, 1), numberField('months', 1, 600), numberField('payment', 0, 1_000_000)] };
export const loanAmortizationChange = change(program('Loan amortization calculator', [loanCollection], [action('recalculate', [recordParameter('loan', 'loans')], [
  { record: 'loan', field: 'payment', op: 'set', value: expression(monthlyPayment) },
])]), { loans: [{ id: 'loan-1', values: { principal: 1000, annual_rate: 0.12, months: 12, payment: 0 } }] });
