import { describe, expect, it } from 'vitest';
import type { ControlsViewDescriptor } from '../../src/tabletop/shared/generative-contracts.js';
import type { TableChange, TableProgram } from '../../src/tabletop/shared/table-contracts.js';
import { applyTableChange, createTableState, TABLE_LIMITS, tableChangeSchema } from '../../src/tabletop/domain/table.js';
import { evaluateGenerativeCanvas } from '../../src/tabletop/runtime/generative/evaluator.js';
import { validateGenerativeProgram } from '../../src/tabletop/runtime/generative/validation.js';
import { GENERATIVE_LIMITS } from '../../src/tabletop/shared/generative-contracts.js';
import { TABLE_DICE_EXAMPLE, TABLE_SCHEMA_GUIDE } from './table-schema-guide.js';
import { MAX_COMPUTED_COLUMNS } from '../../src/tabletop/shared/computed-columns.js';

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
    expect(TABLE_SCHEMA_GUIDE).toContain('DICE: dice must bind one number PARAM or one roll PARAM');
    expect(TABLE_SCHEMA_GUIDE).toContain(JSON.stringify(TABLE_DICE_EXAMPLE));
  });

  it('documents derived fields and the safe required-field promotion rule', () => {
    expect(TABLE_SCHEMA_GUIDE).toContain(`computedColumns<=${MAX_COMPUTED_COLUMNS}`);
    expect(TABLE_SCHEMA_GUIDE).toContain('PROGRAM{version:1,title:<=100 chars,description,collections,actions,invariants,turnOrder,evidence,assumptions,computedColumns?,canvas?,compute?}');
    expect(TABLE_SCHEMA_GUIDE).toContain('remove only that FIELD and upsert a same-id, same-collection COMPUTED_COLUMN');
    expect(TABLE_SCHEMA_GUIDE).toContain('every saved value equals the formula');
    expect(TABLE_SCHEMA_GUIDE).toContain('update any action, invariant, formula or canvas view that referred to the old stored field in the same change');
    expect(TABLE_SCHEMA_GUIDE).toContain('a retained invalid reference is rejected');
    expect(TABLE_SCHEMA_GUIDE).toContain('cannot depend on each other or form cycles');
    expect(TABLE_SCHEMA_GUIDE).toContain('not supplied in imported rows');
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

function changeWith(collections: number, fieldsPerCollection = 1, rows = 0) {
  return {
    kind: 'table',
    program: {
      version: 1,
      title: 'Limits',
      description: 'Checks that the prompt advertises the limits the schema enforces.',
      collections: Array.from({ length: collections }, (_, collection) => ({
        id: `c${collection}`,
        title: `Collection ${collection}`,
        fields: Array.from({ length: fieldsPerCollection }, (_, field) => ({
          id: `f${field}`,
          label: `Field ${field}`,
          type: 'text',
          required: false,
        })),
      })),
      actions: [{
        id: 'noop',
        title: 'Noop',
        description: 'Nothing.',
        roles: ['owner'],
        parameters: [],
        conditions: [],
        effects: [],
        requireTurn: false,
        advanceTurn: true,
      }],
      invariants: [],
      turnOrder: ['host'],
      evidence: [],
      assumptions: [],
    },
    initialRecords: {
      c0: Array.from({ length: rows }, (_, row) => ({ id: `r${row}`, values: {} })),
    },
  };
}

describe('table schema guide (F047)', () => {
  it('advertises every numeric limit the validator enforces', () => {
    const guide = TABLE_SCHEMA_GUIDE;
    expect(guide).toContain(`collections<=${TABLE_LIMITS.collections}`);
    expect(guide).toContain(`fields<=${TABLE_LIMITS.fieldsPerCollection} per collection`);
    expect(guide).toContain(`actions<=${TABLE_LIMITS.actions}`);
    expect(guide).toContain(`parameters<=${TABLE_LIMITS.parametersPerAction} per action`);
    expect(guide).toContain(`creates<=${TABLE_LIMITS.createsPerAction} per action`);
    expect(guide).toContain(`conditions<=${TABLE_LIMITS.conditionsPerAction} per action`);
    expect(guide).toContain(`effects<=${TABLE_LIMITS.effectsPerAction} per action`);
    expect(guide).toContain(`invariants<=${TABLE_LIMITS.invariants}`);
    expect(guide).toContain(`turnOrder<=${TABLE_LIMITS.turnOrder} seats`);
    expect(guide).toContain(`evidence<=${TABLE_LIMITS.evidence}`);
    expect(guide).toContain(`assumptions<=${TABLE_LIMITS.assumptions}`);
    expect(guide).toContain(`views<=${GENERATIVE_LIMITS.canvasViews}`);
    expect(guide).toContain(`canvas manifest nodes (2 + collections + actions + views)<=${GENERATIVE_LIMITS.manifestNodes}`);
    expect(guide).toContain(`expression depth<=${GENERATIVE_LIMITS.expressionDepth}`);
    expect(guide).toContain(`expression nodes<=${GENERATIVE_LIMITS.expressionNodes}`);
    expect(guide).toContain(`scene elements<=${GENERATIVE_LIMITS.sceneElements}`);
    expect(guide).toContain(`controls<=${GENERATIVE_LIMITS.controlsPerView} per view`);
    expect(guide).toContain(`rows<=${TABLE_LIMITS.rowsPerCollection} per collection and <=${TABLE_LIMITS.rowsTotal} total`);
    expect(guide).toContain(`|n|<=${GENERATIVE_LIMITS.numberMagnitude}`);
  });

  it('keeps the collection limit it advertises', () => {
    expect(tableChangeSchema.safeParse(changeWith(TABLE_LIMITS.collections)).success).toBe(true);
    expect(tableChangeSchema.safeParse(changeWith(TABLE_LIMITS.collections + 1)).success).toBe(false);
  });

  it('keeps the field limit it advertises', () => {
    expect(tableChangeSchema.safeParse(changeWith(1, TABLE_LIMITS.fieldsPerCollection)).success).toBe(true);
    expect(tableChangeSchema.safeParse(changeWith(1, TABLE_LIMITS.fieldsPerCollection + 1)).success).toBe(false);
  });

  it('keeps the row limit it advertises', () => {
    expect(tableChangeSchema.safeParse(changeWith(1, 1, TABLE_LIMITS.rowsPerCollection)).success).toBe(true);
    expect(tableChangeSchema.safeParse(changeWith(1, 1, TABLE_LIMITS.rowsPerCollection + 1)).success).toBe(false);
  });
});
