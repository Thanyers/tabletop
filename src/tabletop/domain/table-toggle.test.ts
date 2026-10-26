import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState, handleTableCommand, tableChangeIssues } from './table';
import type { ActorContext } from '../shared/contracts';
import type { TableChange, TableProgram } from '../shared/table-contracts';

const owner: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };

function todo(effect: unknown): TableChange {
  const program = {
    version: 1, title: 'Todo', description: 'Things to do.',
    collections: [{ id: 'tasks', title: 'Tasks', fields: [
      { id: 'task', label: 'Task', type: 'text', required: true },
      { id: 'done', label: 'Done', type: 'boolean', required: true },
    ] }],
    actions: [{ id: 'toggle_done', title: 'Toggle done', description: 'Check or uncheck a task.', roles: ['owner', 'participant'],
      parameters: [{ id: 'task', label: 'Task', type: 'record', collection: 'tasks' }], conditions: [], effects: [effect], requireTurn: false, advanceTurn: false }],
    invariants: [], turnOrder: [], evidence: [], assumptions: [],
  } as unknown as TableProgram;
  return { kind: 'table', program, initialRecords: { tasks: [{ id: 't1', values: { task: 'Book the boat', done: false } }] } };
}

describe('F081 toggle effect', () => {
  it('flips a yes/no field each time the same action runs', () => {
    let state = applyTableChange(createTableState(), todo({ record: 'task', field: 'done', op: 'toggle' }));
    const press = () => { state = handleTableCommand(state, 'table.act', { actionId: 'toggle_done', inputs: { task: 't1' } }, owner)!.state; return state.records.tasks[0]!.values.done; };
    expect(press()).toBe(true);
    expect(press()).toBe(false);
    expect(press()).toBe(true);
  });

  it('rejects a toggle on a field that is not yes/no, and a toggle that also carries a value', () => {
    expect(tableChangeIssues(createTableState(), todo({ record: 'task', field: 'task', op: 'toggle' })).join(' ')).toContain('Only a yes/no field can be toggled.');
    expect(tableChangeIssues(createTableState(), todo({ record: 'task', field: 'done', op: 'toggle', value: { literal: true } }))).not.toEqual([]);
  });

  it('keeps set and add effects working beside it', () => {
    const state = applyTableChange(createTableState(), todo({ record: 'task', field: 'done', op: 'set', value: { literal: true } }));
    expect(handleTableCommand(state, 'table.act', { actionId: 'toggle_done', inputs: { task: 't1' } }, owner)!.state.records.tasks[0]!.values.done).toBe(true);
  });
});
