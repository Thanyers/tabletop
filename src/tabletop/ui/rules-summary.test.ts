import { describe, expect, it } from 'vitest';
import type { TableProgram } from '../shared/table-contracts';
import { describeProgramDiff, diffProgram, ruleBadge } from './rules-summary';

function program(patch: Partial<TableProgram> = {}): TableProgram {
  return {
    version: 1,
    title: 'Community equipment',
    description: 'Lend and return equipment.',
    collections: [{
      id: 'equipment',
      title: 'Equipment',
      fields: [
        { id: 'name', label: 'Name', type: 'text', required: true },
        { id: 'available', label: 'Available', type: 'boolean', required: true },
      ],
    }],
    actions: [{
      id: 'borrow',
      title: 'Borrow equipment',
      description: 'Reserve one available item.',
      roles: ['owner', 'participant'],
      parameters: [{ id: 'item', label: 'Item', type: 'record', collection: 'equipment' }],
      conditions: [{ left: { record: 'item', field: 'available' }, op: 'eq', right: { literal: true }, message: 'Already reserved.' }],
      effects: [{ record: 'item', field: 'available', op: 'set', value: { literal: false } }],
      requireTurn: false,
      advanceTurn: false,
    }],
    invariants: [],
    turnOrder: [],
    evidence: [],
    assumptions: [],
    ...patch,
  };
}

describe('diffProgram', () => {
  it('describes a first proposal as new rules, new tables and starting rows', () => {
    const diff = diffProgram(null, program(), { startingRows: 2 });
    expect(diff.firstProposal).toBe(true);
    expect(diff.newRules).toBe(1);
    expect(diff.newTables).toBe(1);
    expect(diff.startingRows).toBe(2);
    expect(describeProgramDiff(diff)).toBe('1 new rule · 1 new table · 2 starting rows');
    // Nothing in a first proposal needs a "new" badge: the whole proposal is new.
    expect(ruleBadge(diff, 'action', 'borrow')).toBeUndefined();
    expect(ruleBadge(diff, 'table', 'equipment')).toBeUndefined();
  });

  it('separates new, edited and removed rules', () => {
    const before = program();
    const after = program({
      actions: [
        { ...before.actions[0]!, description: 'Reserve one available item for yourself.' },
        {
          id: 'return',
          title: 'Return equipment',
          description: 'Give an item back.',
          roles: ['participant'],
          parameters: [{ id: 'item', label: 'Item', type: 'record', collection: 'equipment' }],
          conditions: [],
          effects: [{ record: 'item', field: 'available', op: 'set', value: { literal: true } }],
          requireTurn: false,
          advanceTurn: false,
        },
      ],
      collections: [...before.collections, {
        id: 'people',
        title: 'People',
        fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
      }],
      invariants: [{ id: 'one_owner', collection: 'equipment', fields: ['name'], message: 'One borrower per item.' }],
    });
    const diff = diffProgram(before, after, { startingRows: 1 });
    expect(ruleBadge(diff, 'action', 'borrow')).toBe('changed');
    expect(ruleBadge(diff, 'action', 'return')).toBe('new');
    expect(ruleBadge(diff, 'table', 'people')).toBe('new');
    expect(ruleBadge(diff, 'check', 'one_owner')).toBe('new');
    expect(diff.newRules).toBe(2);
    expect(diff.editedRules).toBe(1);
    expect(diff.removedRules).toBe(0);
    expect(diff.newTables).toBe(1);
    expect(describeProgramDiff(diff)).toBe('2 new rules · 1 rule edited · 1 new table · 1 starting row');
  });

  it('counts a rule that disappeared from the proposal', () => {
    const before = program();
    const after = program({ actions: [], collections: [] });
    const diff = diffProgram(before, after);
    expect(ruleBadge(diff, 'action', 'borrow')).toBe('removed');
    expect(ruleBadge(diff, 'table', 'equipment')).toBe('removed');
    expect(diff.removedRules).toBe(1);
    expect(diff.removedTables).toBe(1);
    expect(describeProgramDiff(diff)).toBe('1 rule removed · 1 table removed');
  });

  it('says nothing when the proposal matches the rules in use', () => {
    const diff = diffProgram(program(), program());
    expect(diff.badges.size).toBe(0);
    expect(describeProgramDiff(diff)).toBe('');
  });
});
