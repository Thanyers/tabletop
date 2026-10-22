import { describe, expect, it } from 'vitest';
import { normalizeGeneratedId, normalizeGeneratedTableChange } from './id-normalization';
import { applyTableChange, createTableState, tableChangeSchema } from './table';

/** Every id here is one the model plausibly invents and the schema rejects: camelCase, a bad row id. */
function camelChange() {
  return {
    kind: 'table',
    program: {
      version: 1,
      title: 'Cookie jar',
      description: 'Track cookies per jar.',
      collections: [{
        id: 'jarList',
        title: 'Jars',
        fields: [
          { id: 'jarName', label: 'Name', type: 'text', required: true },
          { id: 'cookieCount', label: 'Cookies', type: 'number', required: true, min: 0, max: 100, default: 0 },
        ],
      }],
      actions: [{
        id: 'addCookies',
        title: 'Add cookies',
        description: 'Add cookies to one jar.',
        roles: ['owner', 'participant'],
        parameters: [
          { id: 'jarRef', label: 'Jar', type: 'record', collection: 'jarList' },
          { id: 'addCount', label: 'Count', type: 'number' },
        ],
        conditions: [],
        effects: [{ record: 'jarRef', field: 'cookieCount', op: 'add', value: { input: 'addCount' } }],
        requireTurn: false,
        advanceTurn: false,
      }],
      invariants: [{ id: 'uniqueJarName', collection: 'jarList', fields: ['jarName'], message: 'One row per jar.' }],
      turnOrder: ['host'],
      evidence: [],
      assumptions: [],
      canvas: {
        version: 1,
        views: [
          {
            id: 'totalCookies',
            kind: 'metric',
            title: 'Total cookies',
            value: { op: 'recordField', collection: 'jarList', recordId: 'jarOne', field: 'cookieCount' },
          },
          {
            id: 'cookiesByJar',
            kind: 'chart',
            title: 'Cookies by jar',
            chart: 'bar',
            collection: 'jarList',
            categoryField: 'jarName',
            value: { op: 'field', record: 'row', field: 'cookieCount' },
            relatedTo: { views: ['totalCookies'], collections: ['jarList'] },
          },
        ],
      },
    },
    initialRecords: {
      jarList: [{ id: 'jarOne', values: { jarName: 'Blue jar', cookieCount: 3 } }],
    },
  };
}

describe('normalizeGeneratedId', () => {
  it('turns camelCase and punctuation into a schema-valid id', () => {
    expect(normalizeGeneratedId('totalProfit')).toBe('total_profit');
    expect(normalizeGeneratedId('Sales 2026')).toBe('sales_2026');
    expect(normalizeGeneratedId('order.id')).toBe('order_id');
    expect(normalizeGeneratedId('2026sales')).toBe('x_2026sales');
    expect(normalizeGeneratedId('constructor')).toBe('constructor_1');
  });

  it('leaves a valid id alone', () => {
    expect(normalizeGeneratedId('total_profit')).toBe('total_profit');
  });
});

describe('normalizeGeneratedTableChange', () => {
  it('rejects the raw camelCase draft first, then makes it valid', () => {
    const raw = camelChange();
    expect(tableChangeSchema.safeParse(raw).success).toBe(false);

    const normalized = normalizeGeneratedTableChange(raw);
    expect(tableChangeSchema.safeParse(normalized).success).toBe(true);
    expect(() => applyTableChange(createTableState(), normalized as never)).not.toThrow();
  });

  it('rewrites every reference together with its definition', () => {
    const normalized = normalizeGeneratedTableChange(camelChange()) as ReturnType<typeof camelChange>;
    const program = normalized.program;
    const [collection] = program.collections;
    expect(collection.id).toBe('jar_list');
    expect(collection.fields.map(field => field.id)).toEqual(['jar_name', 'cookie_count']);

    const [action] = program.actions;
    expect(action.id).toBe('add_cookies');
    expect(action.parameters.map(parameter => parameter.id)).toEqual(['jar_ref', 'add_count']);
    expect(action.parameters[0].collection).toBe('jar_list');
    expect(action.effects[0]).toMatchObject({ record: 'jar_ref', field: 'cookie_count' });
    expect(action.effects[0].value).toEqual({ input: 'add_count' });

    expect(program.invariants[0]).toMatchObject({ id: 'unique_jar_name', collection: 'jar_list', fields: ['jar_name'] });

    const [metric, chart] = program.canvas!.views;
    expect(metric).toMatchObject({ id: 'total_cookies' });
    expect((metric as { value: unknown }).value).toEqual({
      op: 'recordField', collection: 'jar_list', recordId: 'jar_one', field: 'cookie_count',
    });
    expect(chart).toMatchObject({ id: 'cookies_by_jar', collection: 'jar_list', categoryField: 'jar_name' });
    expect((chart as { value: unknown }).value).toEqual({ op: 'field', record: 'row', field: 'cookie_count' });
    expect((chart as { relatedTo: unknown }).relatedTo).toEqual({ views: ['total_cookies'], collections: ['jar_list'] });

    const records = normalized.initialRecords as Record<string, { id: string; values: Record<string, unknown> }[]>;
    expect(Object.keys(records)).toEqual(['jar_list']);
    expect(records.jar_list[0]).toEqual({ id: 'jar_one', values: { jar_name: 'Blue jar', cookie_count: 3 } });
  });

  it('returns the draft untouched when two ids would collapse into one', () => {
    const raw = camelChange();
    raw.program.collections[0].fields = [
      { id: 'jarName', label: 'Name', type: 'text', required: true },
      { id: 'JarName', label: 'Other', type: 'text', required: true },
      { id: 'cookieCount', label: 'Cookies', type: 'number', required: true, min: 0, max: 100, default: 0 },
    ];
    expect(normalizeGeneratedTableChange(raw)).toEqual(raw);
  });

  it('does not touch a draft whose ids are already valid', () => {
    const raw = camelChange();
    const normalized = normalizeGeneratedTableChange(raw) as ReturnType<typeof camelChange>;
    const again = normalizeGeneratedTableChange(normalized);
    expect(again).toEqual(normalized);
  });

  it('ignores anything that is not a table draft', () => {
    expect(normalizeGeneratedTableChange({ kind: 'clarify', question: 'x', options: ['a', 'b', 'c'] }))
      .toEqual({ kind: 'clarify', question: 'x', options: ['a', 'b', 'c'] });
    expect(normalizeGeneratedTableChange(null)).toBeNull();
  });
});
