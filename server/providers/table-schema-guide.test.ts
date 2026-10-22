import { describe, expect, it } from 'vitest';
import { TABLE_SCHEMA_GUIDE } from './table-schema-guide';
import { TABLE_LIMITS, tableChangeSchema } from '../../src/tabletop/domain/table';
import { GENERATIVE_LIMITS } from '../../src/tabletop/shared/generative-contracts';

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
