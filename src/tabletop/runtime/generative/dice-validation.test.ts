import { describe, expect, it } from 'vitest';
import type { ControlDescriptor } from '../../shared/generative-contracts';
import type { ActorContext } from '../../shared/contracts';
import type { TableAction, TableParameter, TableProgram } from '../../shared/table-contracts';
import { applyTableChange, createTableState, handleTableCommand, parseBoundedTableChange } from '../../domain/table';
import { diceDuelChange } from '../../testing/generative-scenarios';
import { rollDiceCardChange } from '../../testing/table-scenarios';
import { evaluateGenerativeCanvas } from './evaluator';
import { generativeCanvasSchema } from './schema';
import { validateGenerativeProgram } from './validation';

type DiceDescriptor = Extract<ControlDescriptor, { kind: 'dice' }>;

const numberParameter: TableParameter = { id: 'damage', label: 'Damage', type: 'number', min: 1, max: 20 };
const rollParameter: TableParameter = { id: 'damage', label: 'Damage roll', type: 'roll', roll: { groups: [{ count: 2, faces: 6 }], modifier: 3 } };

const validDice: DiceDescriptor = {
  id: 'damage-dice', kind: 'dice', label: 'Damage die', actionId: 'roll_attack', parameter: 'damage', faces: 6, count: 2, modifier: 1,
  inputs: { damage: { kind: 'control' } },
};

function diceProgram(control: ControlDescriptor, parameters: TableParameter[] = [numberParameter]): TableProgram {
  const rollAttack: TableAction = {
    id: 'roll_attack', title: 'Roll attack', description: 'Roll the damage die', roles: ['owner', 'participant'],
    parameters, conditions: [], effects: [], requireTurn: false, advanceTurn: false,
  };
  return {
    version: 1, title: 'Dice table', description: 'Dice validation table', collections: [], actions: [rollAttack],
    invariants: [], turnOrder: [], evidence: [], assumptions: [],
    canvas: { version: 1, views: [{ id: 'dice-view', kind: 'controls', title: 'Dice', controls: [control] }] },
  };
}

function diceWith(overrides: Partial<DiceDescriptor>): ControlDescriptor {
  return { ...validDice, ...overrides };
}

function canvasFor(control: ControlDescriptor): unknown {
  return { version: 1, views: [{ id: 'dice-view', kind: 'controls', title: 'Dice', controls: [control] }] };
}

describe('dice program validation', () => {
  it('accepts a dice control bounded to a numeric action parameter', () => {
    expect(validateGenerativeProgram(diceProgram(validDice))).toEqual([]);
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 100, count: 10, modifier: -1000 })))).toEqual([]);
  });

  it('rejects faces outside 2..100', () => {
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 1 }))).join(' ')).toContain('Dice faces must be a whole number from 2 to 100.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 101 }))).join(' ')).toContain('Dice faces must be a whole number from 2 to 100.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 6.5 }))).join(' ')).toContain('Dice faces must be a whole number from 2 to 100.');
  });

  it('rejects count outside 1..10', () => {
    expect(validateGenerativeProgram(diceProgram(diceWith({ count: 0 }))).join(' ')).toContain('Dice count must be a whole number from 1 to 10.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ count: 11 }))).join(' ')).toContain('Dice count must be a whole number from 1 to 10.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ count: 2.5 }))).join(' ')).toContain('Dice count must be a whole number from 1 to 10.');
  });

  it('rejects a modifier outside -1000..1000', () => {
    expect(validateGenerativeProgram(diceProgram(diceWith({ modifier: 1001 }))).join(' ')).toContain('Dice modifier must be a whole number from -1000 to 1000.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ modifier: -1001 }))).join(' ')).toContain('Dice modifier must be a whole number from -1000 to 1000.');
  });

  it('accepts a dice control bound to a server roll parameter', () => {
    expect(validateGenerativeProgram(diceProgram(validDice, [rollParameter]))).toEqual([]);
    // The card's own faces/count stay valid but are not authoritative for a roll parameter.
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 8, count: 3, modifier: -2 }), [rollParameter]))).toEqual([]);
  });

  it('rejects a parameter that the action does not declare', () => {
    expect(validateGenerativeProgram(diceProgram(diceWith({ parameter: 'missing' }))).join(' ')).toContain('Dice must bind a number or roll action parameter.');
  });

  it('rejects a parameter with a non-numeric, non-roll type', () => {
    const textParameter: TableParameter = { id: 'damage', label: 'Damage', type: 'text' };
    const issues = validateGenerativeProgram(diceProgram(diceWith({ parameter: 'damage' }), [textParameter])).join(' ');

    expect(issues).toContain('Dice must bind a number or roll action parameter.');
  });

  it('still rejects out-of-range faces and count even when bound to a roll parameter', () => {
    expect(validateGenerativeProgram(diceProgram(diceWith({ faces: 101 }), [rollParameter])).join(' ')).toContain('Dice faces must be a whole number from 2 to 100.');
    expect(validateGenerativeProgram(diceProgram(diceWith({ count: 11 }), [rollParameter])).join(' ')).toContain('Dice count must be a whole number from 1 to 10.');
  });

  it('requires the dice parameter to be bound as the interactive control', () => {
    const literalBinding = diceWith({ inputs: { damage: { kind: 'literal', value: 5 } } });
    const issues = validateGenerativeProgram(diceProgram(literalBinding)).join(' ');

    expect(issues).not.toEqual('');
    expect(issues).toContain('A control must bind every interactive input exactly once.');
  });

  it('keeps the zod schema in step with the limits', () => {
    expect(generativeCanvasSchema.safeParse(canvasFor(validDice)).success).toBe(true);
    expect(generativeCanvasSchema.safeParse(canvasFor(diceWith({ faces: 101 }))).success).toBe(false);
    expect(generativeCanvasSchema.safeParse(canvasFor(diceWith({ faces: 2.5 }))).success).toBe(false);
    expect(generativeCanvasSchema.safeParse(canvasFor(diceWith({ count: 11 }))).success).toBe(false);
    expect(generativeCanvasSchema.safeParse(canvasFor(diceWith({ modifier: 1001 }))).success).toBe(false);
    expect(generativeCanvasSchema.safeParse(canvasFor(diceWith({ modifier: -1000 }))).success).toBe(true);
  });

  it('lets a dice program through domain validation and projects its control', () => {
    const state = applyTableChange(createTableState(), structuredClone(diceDuelChange));
    const program = state.program;
    if (!program?.canvas) throw new Error('Expected an active canvas.');

    const views = evaluateGenerativeCanvas(program.canvas, { program, records: state.records, actor: 'test-actor', turn: null });
    const diceView = views.find(view => view.id === 'damage-dice');
    if (diceView?.kind !== 'controls') throw new Error('Expected the dice controls view.');

    expect(diceView.controls[0].descriptor).toMatchObject({ kind: 'dice', faces: 6, count: 2, modifier: 1, parameter: 'damage' });
  });

  it('submits a dice total through the bound action from another card', () => {
    const state = applyTableChange(createTableState(), structuredClone(diceDuelChange));
    const actor: ActorContext = { actorId: 'test-actor', name: 'Test actor', role: 'owner', workspaceId: 'dice-validation-test', epoch: 1, now: 0, hash: () => 'test-hash' };

    const result = handleTableCommand(structuredClone(state), 'table.act', { actionId: 'apply_damage', inputs: { hero: 'hero-1', damage: 9 } }, actor);

    expect(result).not.toBeNull();
    expect(result?.state.records.heroes[0].values.hp).toBe(91);
  });

  it('activates a roll-parameter dice card and submits the server roll without a client value', () => {
    const change = parseBoundedTableChange(structuredClone(rollDiceCardChange()));
    const state = applyTableChange(createTableState(), change);
    const actor: ActorContext = { actorId: 'test-actor', name: 'Test actor', role: 'owner', workspaceId: 'dice-validation-test', epoch: 1, now: 1_800_000_000_000, hash: () => 'test-hash' };

    const rolled = handleTableCommand(structuredClone(state), 'table.roll', { actionId: 'attack', parameterId: 'damage' }, actor);
    if (!rolled?.roll) throw new Error('Expected the server to issue a roll.');
    const applied = handleTableCommand(rolled.state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, actor);

    expect(rolled.roll.total).toBeGreaterThanOrEqual(5);
    expect(applied?.state.records.fighters[0].values.damage_taken).toBe(rolled.roll.total);
    expect(applied?.state.records.hits.at(-1)?.values.damage).toBe(rolled.roll.total);
  });
});
