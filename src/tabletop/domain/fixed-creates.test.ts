import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { TableAction, TableChange, TableCondition, TableProgram } from '../shared/table-contracts';
import { evaluateGenerativeCanvas } from '../runtime/generative/evaluator';
import { aiTableChangeIssues, applyTableChange, createTableState, handleTableCommand, repeatableFixedCreateIssues, tableChangeIssues } from './table';

// F066: a neutral shared-expenses table; nothing here names a demo scenario.
const ctx: ActorContext = {
  actorId: 'actor-1', name: 'Owner', role: 'owner', workspaceId: 'workspace-1', epoch: 1, now: 1_800_000_000_000,
  hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
};

const emptyGuard: TableCondition = {
  left: { expression: { op: 'aggregate', source: { op: 'collection', id: 'summary' }, fn: 'count' } },
  op: 'eq', right: { literal: 0 }, message: 'Already added.',
};

function seedAction(conditions: TableCondition[] = []): TableAction {
  return {
    id: 'seed_summary', title: 'Add summary rows', description: 'Add the summary rows.', roles: ['owner'],
    parameters: [], conditions, effects: [],
    creates: [{ collection: 'summary', values: { name: { literal: 'A' }, balance: { literal: 120 } } }],
    requireTurn: false, advanceTurn: false,
  };
}

const paidBy = (name: string) => ({
  op: 'aggregate' as const, source: { op: 'collection' as const, id: 'expenses' }, fn: 'sum' as const, as: 'e',
  where: { op: 'compare' as const, fn: 'eq' as const, left: { op: 'field' as const, record: 'e', field: 'paid_by' }, right: name === 'row'
    ? { op: 'field' as const, record: 'row', field: 'name' } : { op: 'literal' as const, value: name } },
  value: { op: 'field' as const, record: 'e', field: 'amount' },
});

function program(actions: TableAction[]): TableProgram {
  return {
    version: 1, title: 'Shared expenses', description: 'Who paid what.',
    collections: [
      { id: 'people', title: 'People', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] },
      { id: 'expenses', title: 'Expenses', fields: [
        { id: 'paid_by', label: 'Paid by', type: 'text', required: true },
        { id: 'amount', label: 'Amount', type: 'number', required: true },
      ] },
      { id: 'summary', title: 'Summary', fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'balance', label: 'Balance', type: 'number', required: true },
      ] },
    ],
    actions: [{
      id: 'add_expense', title: 'Add expense', description: 'Record one expense.', roles: ['owner', 'participant'],
      parameters: [{ id: 'paid_by', label: 'Paid by', type: 'text' }, { id: 'amount', label: 'Amount', type: 'number', min: 0 }],
      conditions: [], effects: [],
      creates: [{ collection: 'expenses', values: { paid_by: { input: 'paid_by' }, amount: { input: 'amount' } } }],
      requireTurn: false, advanceTurn: false,
    }, ...actions],
    invariants: [], turnOrder: [], evidence: [], assumptions: [],
    canvas: { version: 1, views: [{ id: 'paid_chart', kind: 'chart', title: 'Paid per person', chart: 'bar', collection: 'people', categoryField: 'name', value: paidBy('row') }] },
  };
}

const rows = {
  people: [{ id: 'p1', values: { name: 'A' } }, { id: 'p2', values: { name: 'B' } }],
  expenses: [{ id: 'e1', values: { paid_by: 'A', amount: 300 } }, { id: 'e2', values: { paid_by: 'B', amount: 100 } }],
  summary: [],
};
const create = (actions: TableAction[]): TableChange => ({ kind: 'table', program: program(actions), initialRecords: rows });

describe('F066 fixed rows from AI drafts', () => {
  it('rejects a new no-input action that types in the same rows on every press, naming a guard', () => {
    const issues = aiTableChangeIssues(createTableState(), create([seedAction()]));
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('“Add summary rows”');
    expect(issues[0]).toContain('"fn":"count"');
  });

  it('keeps the manual and rollback path unchanged', () => {
    expect(tableChangeIssues(createTableState(), create([seedAction()]))).toEqual([]);
  });

  it('accepts the guarded action, and the guard stops a second press', () => {
    const change = create([seedAction([emptyGuard])]);
    expect(aiTableChangeIssues(createTableState(), change)).toEqual([]);
    const active = applyTableChange(createTableState(), change);
    const once = handleTableCommand(active, 'table.act', { actionId: 'seed_summary', inputs: {} }, ctx)!.state;
    expect(once.records.summary).toHaveLength(1);
    expect(() => handleTableCommand(once, 'table.act', { actionId: 'seed_summary', inputs: {} }, ctx)).toThrow('Already added.');
  });

  it('accepts create values computed from records, which follow the data at press time', () => {
    const live: TableAction = { ...seedAction([emptyGuard]), id: 'snapshot', conditions: [emptyGuard],
      creates: [{ collection: 'summary', values: { name: { literal: 'A' }, balance: { expression: paidBy('A') } } }] };
    const unguarded = { ...live, conditions: [] };
    expect(aiTableChangeIssues(createTableState(), create([unguarded]))).toEqual([]);
    const active = applyTableChange(createTableState(), create([live]));
    const added = handleTableCommand(active, 'table.act', { actionId: 'add_expense', inputs: { paid_by: 'A', amount: 50 } }, ctx)!.state;
    const pressed = handleTableCommand(added, 'table.act', { actionId: 'snapshot', inputs: {} }, ctx)!.state;
    expect(pressed.records.summary[0]?.values.balance).toBe(350);
  });

  it('lets an edit keep an older unguarded action but not add a new one', () => {
    const older = applyTableChange(createTableState(), create([seedAction()]));
    const keep: TableChange = { kind: 'table', program: program([seedAction()]), initialRecords: {} };
    expect(aiTableChangeIssues(older, keep)).toEqual([]);
    const changed: TableChange = { kind: 'table', program: program([{ ...seedAction(), title: 'Add summary rows again' }]), initialRecords: {} };
    expect(repeatableFixedCreateIssues(changed.program, older.program)).toHaveLength(1);
  });

  it('computes a per-person chart live from another collection', () => {
    const active = applyTableChange(createTableState(), create([]));
    const values = () => {
      const [view] = evaluateGenerativeCanvas(active.program!.canvas!, { program: active.program!, records: state.records, actor: 'actor-1', turn: null });
      return view?.kind === 'chart' ? view.points.map(point => [point.category, point.value]) : [];
    };
    let state = active;
    expect(values()).toEqual([['A', 300], ['B', 100]]);
    state = handleTableCommand(active, 'table.act', { actionId: 'add_expense', inputs: { paid_by: 'B', amount: 40 } }, ctx)!.state;
    expect(values()).toEqual([['A', 300], ['B', 140]]);
  });
});
