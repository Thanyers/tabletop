import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState, parseBoundedTableChange, parseTableChangeSalvagingCanvas } from './table';

const metric = { id: 'total_view', kind: 'metric', title: 'Total items', value: { op: 'literal', value: 1 } };
/** Scene text must be text; a number here is invalid and used to be fatal for the whole draft. */
const brokenScene = {
  id: 'jar_scene', kind: 'scene', title: 'Jar', width: 320, height: 220,
  elements: [{ kind: 'text', x: 10, y: 10, text: { op: 'literal', value: 3 } }],
};

function change(canvas?: unknown): unknown {
  return {
    kind: 'table',
    program: {
      version: 1, title: 'Cookie Jar', description: 'Add cookies.',
      collections: [{ id: 'jars', title: 'Jars', fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'cookies', label: 'Cookies', type: 'number', required: true, min: 0, max: 100, default: 0 },
      ] }],
      actions: [{
        id: 'add_cookies', title: 'Add cookies', description: 'Add cookies to a jar.', roles: ['owner', 'participant'],
        parameters: [
          { id: 'jar', label: 'Jar', type: 'record', collection: 'jars' },
          { id: 'count', label: 'Count', type: 'number' },
        ],
        conditions: [], effects: [{ record: 'jar', field: 'cookies', op: 'add', value: { input: 'count' } }],
        requireTurn: false, advanceTurn: false,
      }],
      invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
      ...(canvas ? { canvas } : {}),
    },
    initialRecords: { jars: [] },
  };
}

describe('canvas salvage (F023)', () => {
  it('keeps the table and drops only the invalid view', () => {
    const state = applyTableChange(createTableState(), parseBoundedTableChange(change({ version: 1, views: [metric, brokenScene] })));
    expect(state.program?.canvas?.views.map((view) => view.id)).toEqual(['total_view']);
    expect(state.program?.collections[0].id).toBe('jars');
  });

  it('drops the whole canvas when every view is invalid', () => {
    const state = applyTableChange(createTableState(), parseBoundedTableChange(change({ version: 1, views: [brokenScene] })));
    expect(state.program?.canvas).toBeUndefined();
  });

  it('still rejects a program whose core is invalid', () => {
    const invalid = change({ version: 1, views: [brokenScene] }) as { program: { actions: { effects: { field: string }[] }[] } };
    invalid.program.actions[0].effects[0].field = 'missing';
    expect(() => applyTableChange(createTableState(), parseBoundedTableChange(invalid))).toThrow();
  });

  it('leaves a fully valid canvas untouched', () => {
    const state = applyTableChange(createTableState(), parseBoundedTableChange(change({ version: 1, views: [metric] })));
    expect(state.program?.canvas?.views).toHaveLength(1);
  });
});

describe('provider parse salvage (F023)', () => {
  it('returns the table with the valid views when only a view is malformed', () => {
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [metric, brokenScene] }));
    expect(salvaged?.program.canvas?.views.map((view) => view.id)).toEqual(['total_view']);
  });

  it('returns null when the core itself is invalid', () => {
    const invalid = change({ version: 1, views: [metric] }) as { program: { collections: { fields: unknown[] }[] } };
    invalid.program.collections[0].fields = [];
    expect(parseTableChangeSalvagingCanvas(invalid)).toBeNull();
  });
});

/** Schema-valid text primitive whose expression returns a number: only semantic validation catches it. */
const numericTextScene = {
  id: 'jar_scene', kind: 'scene', title: 'Jar', width: 320, height: 220,
  elements: [{ id: 'jar_label', shape: 'text', x: 10, y: 10, text: { op: 'literal', value: 3 } }],
};

describe('semantic view salvage (F046)', () => {
  it('drops a view that parses but means nothing', () => {
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [metric, numericTextScene] }));
    expect(salvaged?.program.canvas?.views.map((view) => view.id)).toEqual(['total_view']);
  });

  it('keeps two views that link to each other', () => {
    const first = { ...metric, id: 'first_view', relatedTo: { views: ['second_view'] } };
    const second = { ...metric, id: 'second_view', relatedTo: { views: ['first_view'] } };
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [first, second] }));
    expect(salvaged?.program.canvas?.views.map((view) => view.id)).toEqual(['first_view', 'second_view']);
  });

  it('does not take a valid neighbour down with the dropped view', () => {
    const neighbour = { ...metric, id: 'neighbour_view', relatedTo: { views: ['jar_scene'] } };
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [numericTextScene, neighbour] }));
    expect(salvaged?.program.canvas?.views.map((view) => view.id)).toEqual(['neighbour_view']);
    expect(salvaged?.program.canvas?.views[0].relatedTo).toBeUndefined();
  });

  it('drops a view that points at a view that does not exist', () => {
    const dangling = { ...metric, id: 'dangling_view', relatedTo: { views: ['missing_view'] } };
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [dangling, metric] }));
    expect(salvaged?.program.canvas?.views.map((view) => view.id)).toEqual(['total_view']);
  });

  it('leaves the canvas alone when the program core is the thing that is wrong', () => {
    const invalid = change({ version: 1, views: [metric] }) as {
      program: { actions: { effects: { field: string }[] }[] };
    };
    invalid.program.actions[0].effects[0].field = 'missing';
    const parsed = parseTableChangeSalvagingCanvas(invalid);
    expect(parsed?.program.canvas?.views.map((view) => view.id)).toEqual(['total_view']);
    expect(() => applyTableChange(createTableState(), parsed!)).toThrow();
  });

  it('drops the whole canvas when every view is semantically invalid', () => {
    const salvaged = parseTableChangeSalvagingCanvas(change({ version: 1, views: [numericTextScene] }));
    expect(salvaged?.program.canvas).toBeUndefined();
  });
});

