import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TABLE_TURN_SEATS, type ActorContext } from '../shared/contracts';
import type { GenerativeExpression } from '../shared/generative-contracts';
import type { TableChange, TableState } from '../shared/table-contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange, tableRecordsSchema } from './table';
import { createGenerativeExpressionSession, evaluateGenerativeCanvas, evaluateGenerativeExpression } from '../runtime/generative/evaluator';
import { generativeExpressionSchema, generativeIdSchema } from '../runtime/generative/schema';
import { expressionWithinBounds } from '../runtime/generative/validation';
import { cafeQueueChange, cooperativeWaterChange, lightShadowChange, loanAmortizationChange } from '../testing/generative-scenarios';

const owner: ActorContext = { actorId: 'owner-1', name: 'Owner', role: 'owner', workspaceId: 'generative-test', epoch: 1, now: 10, hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') };
const firstSeat: ActorContext = { ...owner, actorId: 'member-1', name: 'Member 1', role: 'participant', seat: 'member-1' };
const secondSeat: ActorContext = { ...owner, actorId: 'member-2', name: 'Member 2', role: 'participant', seat: 'member-2' };

function activate(change: TableChange): TableState { return applyTableChange(createTableState(), structuredClone(change)); }
function run(state: TableState, actionId: string, inputs: Record<string, string | number | boolean>, actor = owner): TableState {
  const result = handleTableCommand(state, 'table.act', { actionId, inputs }, actor);
  if (!result || result.state.kind !== 'table') throw new Error('Table action was not handled.');
  return result.state;
}
function views(state: TableState) {
  if (!state.program?.canvas) throw new Error('Expected a generated canvas.');
  return evaluateGenerativeCanvas(state.program.canvas, { program: state.program, records: state.records, actor: owner.actorId, turn: state.turn });
}
describe('bounded generic generative runtime', () => {
  it('runs cafe queue and staffing behavior against authoritative rows', () => {
    const state = activate(cafeQueueChange);
    const after = run(state, 'start_service', { order: 'order-1', staff: 'staff-1', clock: 'clock-1' });
    expect(after.records.queue[0].values).toMatchObject({ status: 'serving', wait_minutes: 12 });
    expect(after.records.staff[0].values.available).toBe(0);
    const canvas = views(after);
    expect(canvas.find(view => view.id === 'average-wait')).toMatchObject({ kind: 'metric', value: 12 });
    expect(canvas.find(view => view.id === 'queue-chart')).toMatchObject({ kind: 'chart', points: [{ category: 'serving', value: 12 }] });
    expect(after.records.clock[0].values.minute).toBe(20);
  });

  it('computes shadow geometry and carries resolved drag/slider inputs from the same records', () => {
    const state = activate(lightShadowChange);
    const canvas = views(state);
    const scene = canvas.find(view => view.id === 'light-shadow-scene');
    if (scene?.kind !== 'scene') throw new Error('Expected the shadow scene.');
    const shadow = scene.elements.find(element => element.id === 'shadow');
    if (shadow?.shape !== 'polygon') throw new Error('Expected a projected shadow polygon.');
    // 20 + ((90 - 10) * (50 - 20)) / (50 - 10) = 80.
    expect(shadow.points[1].x).toBe(80);
    const light = scene.elements.find(element => element.id === 'light-source');
    if (light?.shape !== 'circle') throw new Error('Expected a draggable light source.');
    expect(light.drag).toMatchObject({ actionId: 'move_light', xParameter: 'x', yParameter: 'y', inputs: { light: 'light-1' } });
    const controls = canvas.find(view => view.id === 'light-controls');
    if (controls?.kind !== 'controls') throw new Error('Expected light controls.');
    expect(controls.controls.map(control => control.value)).toEqual([20, 10]);
    expect(controls.controls[0].inputValues).toEqual({ light: 'light-1', y: 10 });
    const moved = run(state, 'move_light', { light: 'light-1', x: 30, y: 20 });
    const movedViews = views(moved);
    const tip = movedViews.find(view => view.id === 'shadow-tip');
    // 30 + ((90 - 20) * (50 - 30)) / (50 - 20) = 76.666...
    expect(tip?.kind === 'metric' ? tip.value : null).toBeCloseTo(76.6666666667, 8);
  });

  it('applies cooperative water turns, rejects overdraw, and preserves the prior state on failure', () => {
    let state = activate(cooperativeWaterChange);
    state = run(state, 'withdraw_water', { reservoir: 'north-well', team: 'team-north', amount: 10 }, firstSeat);
    expect(state.records.reservoirs[0].values.water).toBe(90);
    expect(state.records.teams[0].values.delivered).toBe(10);
    expect(state.turn).toBe('member-2');
    expect(views(state).find(view => view.id === 'water-stock')).toMatchObject({ kind: 'metric', value: 90 });
    expect(() => run(state, 'withdraw_water', { reservoir: 'north-well', team: 'team-north', amount: 10 }, firstSeat)).toThrow('Wait for your turn');
    const before = JSON.stringify(state);
    const afterOneMore = run(state, 'withdraw_water', { reservoir: 'north-well', team: 'team-north', amount: 50 }, secondSeat);
    expect(afterOneMore.records.reservoirs[0].values.water).toBe(40);
    expect(JSON.stringify(state)).toBe(before);
    expect(() => run(afterOneMore, 'withdraw_water', { reservoir: 'north-well', team: 'team-north', amount: 50 }, firstSeat)).toThrow('does not hold enough water');
    expect(afterOneMore.records.reservoirs[0].values.water).toBe(40);
  });

  it('supports a novel amortization formula rather than scenario-specific behavior', () => {
    const state = activate(loanAmortizationChange);
    const after = run(state, 'recalculate', { loan: 'loan-1' });
    expect(after.records.loans[0].values.payment).toBeCloseTo(88.8487886783, 8);
  });

  it('evaluates conditional, filter, map, reduce, and trigonometric expressions with bounded fuel', () => {
    const state = activate(loanAmortizationChange);
    if (!state.program) throw new Error('Expected the loan program.');
    const context = { program: state.program, records: state.records, actor: 'tester', turn: null };
    const expressionValue: GenerativeExpression = {
      op: 'if',
      test: { op: 'compare', fn: 'gt', left: { op: 'selectedField', parameter: 'loan', field: 'principal' }, right: { op: 'literal', value: 0 } },
      then: {
        op: 'reduce',
        source: { op: 'filter', source: { op: 'collection', id: 'loans' }, as: 'loan-row', where: { op: 'compare', fn: 'gte', left: { op: 'field', record: 'loan-row', field: 'principal' }, right: { op: 'literal', value: 0 } } },
        as: 'loan-row', accumulator: 'sum', initial: { op: 'literal', value: 0 },
        value: { op: 'math', fn: 'add', args: [{ op: 'variable', name: 'sum' }, { op: 'field', record: 'loan-row', field: 'principal' }] },
      },
      otherwise: { op: 'literal', value: 0 },
    };
    const action = state.program.actions[0];
    expect(evaluateGenerativeExpression(expressionValue, { ...context, action, inputs: { loan: 'loan-1' } })).toBe(1000);
    const mapped = evaluateGenerativeExpression({ op: 'map', source: { op: 'collection', id: 'loans' }, as: 'loan-row', value: { op: 'math', fn: 'sin', args: [{ op: 'field', record: 'loan-row', field: 'annual_rate' }] } }, context);
    expect(mapped).toEqual([Math.sin(0.12)]);
    expect(evaluateGenerativeExpression({ op: 'aggregate', source: { op: 'collection', id: 'loans' }, fn: 'count', as: 'loan-row', where: { op: 'compare', fn: 'gt', left: { op: 'field', record: 'loan-row', field: 'months' }, right: { op: 'literal', value: 0 } } }, context)).toBe(1);
    const emptyFilteredSum = {
      op: 'aggregate', fn: 'sum', as: 'loan-row',
      source: { op: 'filter', source: { op: 'collection', id: 'loans' }, as: 'candidate', where: { op: 'compare', fn: 'gt', left: { op: 'field', record: 'candidate', field: 'principal' }, right: { op: 'literal', value: 10_000 } } },
      value: { op: 'field', record: 'loan-row', field: 'principal' },
    } satisfies GenerativeExpression;
    expect(evaluateGenerativeExpression(emptyFilteredSum, context)).toBe(0);
    for (const fn of ['mean', 'min', 'max'] as const) {
      expect(() => evaluateGenerativeExpression({ ...emptyFilteredSum, fn }, context)).toThrow('at least one matching row');
    }
    expect(() => evaluateGenerativeExpression({ op: 'map', source: { op: 'collection', id: 'loans' }, as: 'loan-row', value: { op: 'field', record: 'loan-row', field: 'principal' } }, context, { fuel: 2 })).toThrow('fuel');
    const session = createGenerativeExpressionSession(context, { fuel: 1 });
    expect(session({ op: 'literal', value: 1 })).toBe(1);
    expect(() => session({ op: 'literal', value: 2 })).toThrow('fuel');
  });

  it('rejects malicious identifiers, unknown bindings, unsafe outputs, and deep trees before recursive parsing', () => {
    expect(generativeIdSchema.safeParse('constructor').success).toBe(false);
    expect(generativeIdSchema.safeParse('toString').success).toBe(false);
    expect(generativeExpressionSchema.safeParse({ op: 'variable', name: '__proto__' }).success).toBe(false);
    expect(generativeExpressionSchema.safeParse({ op: 'math', fn: 'abs', args: [{ op: 'literal', value: 1 }], host: 'fetch' }).success).toBe(false);
    const harmlessText = { op: 'literal', value: 'Function("return fetch()")()' } satisfies GenerativeExpression;
    const loanState = activate(loanAmortizationChange);
    if (!loanState.program) throw new Error('Expected a program.');
    const loanProgram = loanState.program;
    expect(evaluateGenerativeExpression(harmlessText, { program: loanProgram, records: loanState.records, actor: owner.actorId, turn: null })).toBe('Function("return fetch()")()');
    expect(() => evaluateGenerativeExpression({ op: 'math', fn: 'multiply', args: [{ op: 'literal', value: 1_000_000_000 }, { op: 'literal', value: 2 }] }, { program: loanProgram, records: loanState.records, actor: owner.actorId, turn: null })).toThrow('number limit');

    const invalidBinding = structuredClone(cafeQueueChange);
    const controlView = invalidBinding.program.canvas?.views.find(view => view.kind === 'controls');
    if (controlView?.kind !== 'controls') throw new Error('Expected controls.');
    controlView.controls[0].actionId = 'missing_action';
    expect(() => activate(invalidBinding)).toThrow('unknown action');

    const invalidView = structuredClone(lightShadowChange);
    const metric = invalidView.program.canvas?.views.find(view => view.kind === 'metric');
    if (metric?.kind !== 'metric') throw new Error('Expected a metric.');
    metric.value = { op: 'math', fn: 'divide', args: [{ op: 'literal', value: 1 }, { op: 'literal', value: 0 }] };
    expect(() => activate(invalidView)).toThrow('Division by zero');

    let deep: GenerativeExpression = { op: 'literal', value: true };
    for (let depth = 0; depth < 40; depth += 1) deep = { op: 'not', value: deep };
    expect(expressionWithinBounds(deep)).toBe(false);
    const tooDeep = structuredClone(cafeQueueChange);
    Object.assign(tooDeep.program.actions[0].effects[0], { value: { expression: deep } });
    expect(() => parseBoundedTableChange(tooDeep)).toThrow('depth');

    const cyclic: { op: string; value?: unknown } = { op: 'not' };
    cyclic.value = cyclic;
    expect(expressionWithinBounds(cyclic)).toBe(false);
    const failedAction = structuredClone(loanAmortizationChange);
    Object.assign(failedAction.program.actions[0].effects[0], { value: { expression: { op: 'math', fn: 'divide', args: [{ op: 'literal', value: 1 }, { op: 'literal', value: 0 }] } } });
    const before = activate(failedAction);
    const snapshot = JSON.stringify(before);
    expect(() => run(before, 'recalculate', { loan: 'loan-1' })).toThrow('Division by zero');
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it('shares action fuel and output budgets across all conditions and effects, rolling back on exhaustion', () => {
    const aggregate: GenerativeExpression = {
      op: 'aggregate', source: { op: 'collection', id: 'items' }, fn: 'sum', as: 'item',
      value: { op: 'math', fn: 'add', args: [{ op: 'field', record: 'item', field: 'value' }, { op: 'field', record: 'item', field: 'other' }] },
    };
    const fuelChange: TableChange = {
      kind: 'table',
      program: {
        version: 1, title: 'Fuel test', description: 'Fuel test',
        collections: [{ id: 'items', title: 'Items', fields: [
          { id: 'value', label: 'Value', type: 'number', required: true },
          { id: 'other', label: 'Other', type: 'number', required: true },
          { id: 'total', label: 'Total', type: 'number', required: true },
        ] }],
        actions: [{ id: 'calculate', title: 'Calculate', description: 'Calculate', roles: ['owner'], parameters: [{ id: 'row', label: 'Row', type: 'record', collection: 'items' }],
          conditions: Array.from({ length: 24 }, () => ({ left: { expression: structuredClone(aggregate) }, op: 'gte' as const, right: { literal: 0 }, message: 'The total must be non-negative.' })),
          effects: [{ record: 'row', field: 'total', op: 'set', value: { expression: aggregate } }], requireTurn: false, advanceTurn: false }],
        invariants: [], turnOrder: [], evidence: [], assumptions: [],
      },
      initialRecords: { items: Array.from({ length: 100 }, (_, index) => ({ id: `item_${index}`, values: { value: 0, other: 0, total: 0 } })) },
    };
    const fuelState = activate(fuelChange);
    const fuelSnapshot = JSON.stringify(fuelState);
    expect(() => run(fuelState, 'calculate', { row: 'item_0' })).toThrow('fuel');
    expect(JSON.stringify(fuelState)).toBe(fuelSnapshot);

    const longText = 'x'.repeat(500);
    const textFields = Array.from({ length: 9 }, (_, index) => ({ id: `field_${index}`, label: `Field ${index}`, type: 'text' as const, required: true }));
    const outputChange: TableChange = {
      kind: 'table', program: {
        version: 1, title: 'Output test', description: 'Output test',
        collections: [{ id: 'items', title: 'Items', fields: textFields }],
        actions: [{ id: 'write', title: 'Write', description: 'Write', roles: ['owner'], parameters: [{ id: 'row', label: 'Row', type: 'record', collection: 'items' }],
          conditions: Array.from({ length: 24 }, () => ({ left: { expression: { op: 'literal' as const, value: longText } }, op: 'eq' as const, right: { literal: longText }, message: 'Text did not match.' })),
          effects: textFields.map(field => ({ record: 'row', field: field.id, op: 'set' as const, value: { expression: { op: 'literal' as const, value: longText } } })), requireTurn: false, advanceTurn: false }],
        invariants: [], turnOrder: [], evidence: [], assumptions: [],
      },
      initialRecords: { items: [{ id: 'item-1', values: Object.fromEntries(textFields.map(field => [field.id, 'before'])) }] },
    };
    const outputState = activate(outputChange);
    const outputSnapshot = JSON.stringify(outputState);
    expect(() => run(outputState, 'write', { row: 'item-1' })).toThrow('output exceeds deterministic bounds');
    expect(JSON.stringify(outputState)).toBe(outputSnapshot);
  });

  it('bounds provider records and the aggregate evaluated canvas before returning output', () => {
    const many = Object.fromEntries(Array.from({ length: 3 }, (_, group) => [`rows_${group}`, Array.from({ length: 100 }, (_, index) => ({ id: `row_${index}`, values: { value: index } }))]));
    expect(tableRecordsSchema.safeParse(many).success).toBe(false);
    const wideValues = Object.fromEntries(Array.from({ length: 400 }, (_, index) => [`field_${index}`, 'x'.repeat(500)]));
    expect(tableRecordsSchema.safeParse({ rows: [{ id: 'wide-row', values: wideValues }] }).success).toBe(false);
    const state = activate(cafeQueueChange);
    const program = state.program;
    if (!program?.canvas) throw new Error('Expected a generated canvas.');
    const canvas = program.canvas;
    const output = evaluateGenerativeCanvas(canvas, { program, records: state.records, actor: owner.actorId, turn: state.turn });
    expect(output.map(view => view.id)).toEqual(['cafe-floor', 'average-wait', 'queue-chart', 'service-controls']);
    expect(() => evaluateGenerativeCanvas(canvas, { program, records: state.records, actor: owner.actorId, turn: state.turn }, { fuel: 2 })).toThrow('fuel');
    const oversizedCanvas = structuredClone(cafeQueueChange);
    const scene = oversizedCanvas.program.canvas?.views.find(view => view.kind === 'scene');
    if (scene?.kind !== 'scene') throw new Error('Expected a scene.');
    scene.elements = Array.from({ length: 128 }, (_, index) => ({ id: `scene_${index}`, shape: 'circle' as const, cx: 0, cy: 0, r: 1 }));
    oversizedCanvas.program.canvas!.views.unshift({ id: 'extra-scene', kind: 'scene', title: 'Extra scene', width: 10, height: 10, elements: scene.elements });
    expect(() => activate(oversizedCanvas)).toThrow('Scene output exceeds the element limit');

    const oversizedManifest = structuredClone(cafeQueueChange);
    const templateCollection = oversizedManifest.program.collections[0];
    while (oversizedManifest.program.collections.length < 6) {
      const index = oversizedManifest.program.collections.length;
      oversizedManifest.program.collections.push({ ...structuredClone(templateCollection), id: `extra_collection_${index}` });
    }
    const templateAction = oversizedManifest.program.actions[0];
    while (oversizedManifest.program.actions.length < 16) {
      const index = oversizedManifest.program.actions.length;
      oversizedManifest.program.actions.push({ ...structuredClone(templateAction), id: `extra_action_${index}` });
    }
    const manifestCanvas = oversizedManifest.program.canvas;
    if (!manifestCanvas) throw new Error('Expected a canvas.');
    while (manifestCanvas.views.length < 12) {
      const index = manifestCanvas.views.length;
      manifestCanvas.views.push({ id: `extra_view_${index}`, kind: 'scene', title: 'Empty scene', width: 10, height: 10, elements: [] });
    }
    expect(() => activate(oversizedManifest)).toThrow('manifest node limit');
  });

  it('validates canvas output against maximum JSON-escaped actor IDs and explicit actor, seat, and turn branches', () => {
    const message = 'x'.repeat(500);
    const makeChange = (expression: GenerativeExpression, count: number): TableChange => ({
      kind: 'table',
      program: {
        version: 1, title: 'Identity output check', description: 'Probe identity-dependent canvas output.',
        collections: [{ id: 'items', title: 'Items', fields: [
          { id: 'message', label: 'Message', type: 'text', required: true },
          { id: 'actor_id', label: 'Actor ID', type: 'text', required: true },
        ] }],
        actions: [{ id: 'pass', title: 'Pass', description: 'Advance the turn.', roles: ['owner'], parameters: [], conditions: [], effects: [], requireTurn: false, advanceTurn: true }],
        invariants: [], turnOrder: ['host', 'member-7'], evidence: [], assumptions: [],
        canvas: { version: 1, views: [{ id: 'identity-check', kind: 'scene', title: 'Identity check', width: 100, height: 100,
          elements: Array.from({ length: count }, (_, index) => ({ id: `label_${index}`, shape: 'text' as const, x: 0, y: 0, text: expression })) }] },
      },
      initialRecords: { items: [{ id: 'item-1', values: { message, actor_id: 'different-actor' } }] },
    });

    // JSON.stringify expands each NUL into six ASCII bytes even though the valid ID has 160 code units.
    expect(() => activate(makeChange({ op: 'system', value: 'actor' }, 20))).toThrow('Canvas output exceeds deterministic bounds');

    const conditionalText = (system: 'actor' | 'seat' | 'turn', value: string): GenerativeExpression => ({
      op: 'if',
      test: { op: 'compare', fn: 'eq', left: { op: 'system', value: system }, right: { op: 'literal', value } },
      then: { op: 'recordField', collection: 'items', recordId: 'item-1', field: 'message' },
      otherwise: { op: 'literal', value: 'ok' },
    });
    for (const [system, value] of [['actor', owner.actorId], ['seat', 'learner-1'], ['turn', 'member-7']] as const) {
      expect(() => activate(makeChange(conditionalText(system, value), 30))).toThrow('Canvas output exceeds deterministic bounds');
    }

    const actorFromRecord: GenerativeExpression = {
      op: 'if',
      test: { op: 'compare', fn: 'eq', left: { op: 'system', value: 'actor' }, right: { op: 'recordField', collection: 'items', recordId: 'item-1', field: 'actor_id' } },
      then: { op: 'recordField', collection: 'items', recordId: 'item-1', field: 'message' },
      otherwise: { op: 'literal', value: 'ok' },
    };
    const actorRecordChange = makeChange(actorFromRecord, 30);
    actorRecordChange.program.actions[0].parameters = [{ id: 'row', label: 'Row', type: 'record', collection: 'items' }];
    actorRecordChange.program.actions[0].effects = [{ record: 'row', field: 'actor_id', op: 'set', value: { system: 'actor' } }];
    const state = activate(actorRecordChange);
    const before = JSON.stringify(state);
    expect(() => handleTableCommand(state, 'table.act', { actionId: 'pass', inputs: { row: 'item-1' } }, owner)).toThrow('Canvas output exceeds deterministic bounds');
    expect(JSON.stringify(state)).toBe(before);
  });

  it('keeps identity validation within budget for a full twelve-member turn order and still probes every named seat', () => {
    const fullTurnOrder = [...TABLE_TURN_SEATS];
    const message = 'x'.repeat(500);
    const identityChange = (elements: GenerativeExpression[], turnOrder: string[] = fullTurnOrder, seatRecord = 'member-1'): TableChange => ({
      kind: 'table',
      program: {
        version: 1, title: 'Twelve seats', description: 'Every seat takes a turn.',
        collections: [{ id: 'items', title: 'Items', fields: [
          { id: 'message', label: 'Message', type: 'text', required: true },
          { id: 'seat_name', label: 'Seat', type: 'text', required: true },
        ] }],
        actions: [{ id: 'pass', title: 'Pass', description: 'Advance the turn.', roles: ['owner', 'participant'], parameters: [], conditions: [], effects: [], requireTurn: false, advanceTurn: true }],
        invariants: [], turnOrder, evidence: [], assumptions: [],
        canvas: { version: 1, views: [{ id: 'identity', kind: 'scene', title: 'Identity', width: 100, height: 100,
          elements: elements.map((text, index) => ({ id: `label_${index}`, shape: 'text' as const, x: 0, y: 0, text })) }] },
      },
      initialRecords: { items: [{ id: 'item-1', values: { message, seat_name: seatRecord } }] },
    });
    const equals = (left: GenerativeExpression, right: GenerativeExpression): GenerativeExpression => ({
      op: 'if', test: { op: 'compare', fn: 'eq', left, right }, then: { op: 'literal', value: 'same' }, otherwise: { op: 'literal', value: 'different' },
    });
    const actor: GenerativeExpression = { op: 'system', value: 'actor' };
    const seat: GenerativeExpression = { op: 'system', value: 'seat' };
    const turn: GenerativeExpression = { op: 'system', value: 'turn' };
    // Actor, seat and turn branches plus a few literals across a turn order with every seat.
    const busy = identityChange([
      equals(actor, seat), equals(seat, turn), equals(actor, turn),
      equals(seat, { op: 'literal', value: 'member-12' }), equals(turn, { op: 'literal', value: 'host' }),
      equals(actor, { op: 'literal', value: 'owner-1' }), equals(actor, { op: 'literal', value: 'guest-a' }),
    ]);
    expect(() => activate(busy)).not.toThrow();
    const state = activate(busy);
    const twelfth: ActorContext = { ...owner, actorId: 'member-12-account', role: 'participant', seat: 'member-12' };
    let current = state;
    for (let step = 0; step < fullTurnOrder.length; step += 1) current = run(current, 'pass', {}, step === 0 ? owner : twelfth);
    expect(current.turn).toBe('host');

    // A seat that only a literal names is still probed, so its branch is checked.
    const heavyFor = (test: GenerativeExpression): GenerativeExpression => ({
      op: 'if', test, then: { op: 'recordField', collection: 'items', recordId: 'item-1', field: 'message' }, otherwise: { op: 'literal', value: 'ok' },
    });
    const many = (expression: GenerativeExpression) => Array.from({ length: 30 }, () => expression);
    expect(() => activate(identityChange(many(heavyFor({ op: 'compare', fn: 'eq', left: seat, right: { op: 'literal', value: 'member-12' } })), ['host'])))
      .toThrow('Canvas output exceeds deterministic bounds');
    // A seat named only in the rows is probed too.
    const fromRecord: GenerativeExpression = { op: 'recordField', collection: 'items', recordId: 'item-1', field: 'seat_name' };
    expect(() => activate(identityChange(many(heavyFor({ op: 'compare', fn: 'eq', left: seat, right: fromRecord })), ['host'], 'member-11')))
      .toThrow('Canvas output exceeds deterministic bounds');
  });
});
