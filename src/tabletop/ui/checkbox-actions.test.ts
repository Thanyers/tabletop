import { describe, expect, it } from 'vitest';
import type { TableAction } from '../shared/table-contracts';
import { checkboxAction } from './checkbox-actions';

const base = { description: '', conditions: [], requireTurn: false, advanceTurn: false, roles: ['owner', 'participant'] as TableAction['roles'] };
const param = [{ id: 'task', label: 'Task', type: 'record' as const, collection: 'tasks' }];
const markDone: TableAction = { ...base, id: 'done', title: 'Mark done', parameters: param, effects: [{ record: 'task', field: 'done', op: 'set', value: { literal: true } }] };
const undo: TableAction = { ...base, id: 'undo', title: 'Undo', parameters: param, effects: [{ record: 'task', field: 'done', op: 'set', value: { literal: false } }] };
const toggle: TableAction = { ...base, id: 'toggle', title: 'Toggle', parameters: param, effects: [{ record: 'task', field: 'done', op: 'toggle' }] };

describe('F081 checkbox action matching', () => {
  it('uses the set rule that matches the click direction', () => {
    expect(checkboxAction([markDone, undo], 'tasks', 'done', false, 'participant')?.action.id).toBe('done');
    expect(checkboxAction([markDone, undo], 'tasks', 'done', true, 'participant')?.action.id).toBe('undo');
    expect(checkboxAction([markDone], 'tasks', 'done', true, 'participant')).toBeNull();
  });

  it('prefers a toggle rule, which works both ways', () => {
    expect(checkboxAction([markDone, toggle], 'tasks', 'done', false, 'owner')?.action.id).toBe('toggle');
    expect(checkboxAction([toggle], 'tasks', 'done', true, 'owner')?.action.id).toBe('toggle');
  });

  it('skips rules for other roles, other fields, turns or extra inputs', () => {
    const ownerOnly = { ...toggle, id: 'owner_only', roles: ['owner'] as TableAction['roles'] };
    const otherField: TableAction = { ...toggle, id: 'other', effects: [{ record: 'task', field: 'urgent', op: 'toggle' }] };
    const turn = { ...toggle, id: 'turn', requireTurn: true };
    const extra: TableAction = { ...toggle, id: 'extra', parameters: [...param, { id: 'note', label: 'Note', type: 'text' }] };
    expect(checkboxAction([ownerOnly, otherField, turn, extra], 'tasks', 'done', false, 'participant')).toBeNull();
  });
});
