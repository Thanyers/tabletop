import { describe, expect, it } from 'vitest';
import type { ControlsViewDescriptor } from '../../src/tabletop/shared/generative-contracts.js';
import type { TableChange, TableProgram } from '../../src/tabletop/shared/table-contracts.js';
import { applyTableChange, createTableState, tableChangeSchema } from '../../src/tabletop/domain/table.js';
import { evaluateGenerativeCanvas } from '../../src/tabletop/runtime/generative/evaluator.js';
import { validateGenerativeProgram } from '../../src/tabletop/runtime/generative/validation.js';
import { TABLE_DICE_EXAMPLE, TABLE_SCHEMA_GUIDE } from './table-schema-guide.js';

const heroBinding = { kind: 'record' as const, collection: 'heroes', recordId: 'hero-1' };

/** The form card from the guide's prose: same action, same action parameter, different controls view. */
const formView: ControlsViewDescriptor = {
  id: 'damage-form',
  kind: 'controls',
  title: 'Apply damage',
  controls: [{
    id: 'damage-form',
    kind: 'form',
    label: 'Apply damage',
    actionId: 'apply_damage',
    inputs: { hero: heroBinding, damage: { kind: 'control' } },
  }],
};

function diceProgram(): TableProgram {
  return {
    version: 1,
    title: 'Dice damage duel',
    description: 'Program built from the F049 prompt-guide example',
    collections: [{ id: 'heroes', title: 'Heroes', fields: [{ id: 'hp', label: 'HP', type: 'number', required: true, min: 0, max: 1000 }] }],
    actions: [{
      id: 'apply_damage',
      title: 'Apply damage',
      description: 'Subtract the rolled damage from the hero',
      roles: ['owner', 'participant'],
      parameters: [
        { id: 'hero', label: 'Hero', type: 'record', collection: 'heroes' },
        { id: 'damage', label: 'Damage', type: 'number', min: 0, max: 100 },
      ],
      conditions: [],
      effects: [{
        record: 'hero', field: 'hp', op: 'add',
        value: { expression: { op: 'math', fn: 'multiply', args: [{ op: 'literal', value: -1 }, { op: 'input', id: 'damage' }] } },
      }],
      requireTurn: false,
      advanceTurn: false,
    }],
    invariants: [],
    turnOrder: [],
    evidence: [],
    assumptions: [],
    canvas: { version: 1, views: [structuredClone(TABLE_DICE_EXAMPLE), structuredClone(formView)] },
  };
}

function diceChange(): TableChange {
  return { kind: 'table', program: diceProgram(), initialRecords: { heroes: [{ id: 'hero-1', values: { hp: 100 } }] } };
}

describe('F049 dice prompt guide', () => {
  it('teaches the dice control and embeds the exact example', () => {
    expect(TABLE_SCHEMA_GUIDE).toContain('dice{kind:"dice",parameter,faces:2..100,count:1..10');
    expect(TABLE_SCHEMA_GUIDE).toContain('DICE: dice must bind one number PARAM');
    expect(TABLE_SCHEMA_GUIDE).toContain(JSON.stringify(TABLE_DICE_EXAMPLE));
  });

  it('accepts a program built from the exact example plus a form on the same action', () => {
    const change = diceChange();

    expect(tableChangeSchema.safeParse(change).success).toBe(true);
    expect(validateGenerativeProgram(change.program, change.initialRecords)).toEqual([]);

    const state = applyTableChange(createTableState(), structuredClone(change));
    const program = state.program;
    if (!program?.canvas) throw new Error('Expected an active dice canvas.');

    const views = evaluateGenerativeCanvas(program.canvas, { program, records: state.records, actor: 'test-actor', turn: null });
    const dice = views.find(view => view.id === 'damage-die');
    const form = views.find(view => view.id === 'damage-form');
    if (dice?.kind !== 'controls' || form?.kind !== 'controls') throw new Error('Expected the dice and form controls views.');

    expect(dice.controls[0].descriptor).toMatchObject({ kind: 'dice', actionId: 'apply_damage', parameter: 'damage', faces: 6, count: 2, modifier: 1 });
    expect(form.controls[0].descriptor).toMatchObject({ kind: 'form', actionId: 'apply_damage' });
  });

  it('still validates the form control on the same action without the dice view', () => {
    const change = diceChange();
    const formOnly: TableProgram = { ...change.program, canvas: { version: 1, views: [structuredClone(formView)] } };

    expect(validateGenerativeProgram(formOnly, change.initialRecords)).toEqual([]);
  });
});
