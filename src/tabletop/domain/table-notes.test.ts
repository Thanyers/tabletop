import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain } from './index';
import { MAX_TABLE_NOTES, createTableState, handleTableCommand } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext, DomainState } from '../shared/contracts';
import type { TableNote, TableState } from '../shared/table-contracts';

const owner: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'account-b', name: 'Participant', role: 'participant', seat: 'member-1', now: 2000 };

function run(state: TableState, type: string, payload: unknown, ctx: ActorContext = member) {
  return handleTableCommand(state, type, payload, ctx)!;
}
function notes(state: TableState): TableNote[] { return state.notes ?? []; }

describe('shared canvas notes (F037)', () => {
  it('lets a member add, edit, recolour, move and remove a note', () => {
    let state: TableState = createTableState();
    expect(notes(state)).toEqual([]);

    state = run(state, 'table.addNote', { text: 'Lend only to staff', color: 'sky', x: 120, y: -40 }).state;
    const [note] = notes(state);
    expect(note).toMatchObject({ text: 'Lend only to staff', color: 'sky', x: 120, y: -40, createdBy: member.actorId, createdAt: 2000 });
    expect(note.id).toMatch(/^note_[a-z0-9]{6,16}$/u);

    state = run(state, 'table.updateNote', { noteId: note.id, text: 'Lend only to trained staff', color: 'rose' }, { ...member, now: 3000 }).state;
    expect(notes(state)[0]).toMatchObject({ text: 'Lend only to trained staff', color: 'rose', updatedAt: 3000 });

    state = run(state, 'table.moveNote', { noteId: note.id, x: -20, y: 640 }).state;
    expect(notes(state)[0]).toMatchObject({ x: -20, y: 640 });

    state = run(state, 'table.removeNote', { noteId: note.id }).state;
    expect(notes(state)).toEqual([]);
  });

  it('keeps the owner and every member on the same notes', () => {
    let state: TableState = createTableState();
    state = run(state, 'table.addNote', { text: 'Owner idea', x: 0, y: 0 }, owner).state;
    state = run(state, 'table.addNote', { text: 'Member idea', x: 40, y: 40 }).state;
    expect(notes(state).map(note => note.text)).toEqual(['Owner idea', 'Member idea']);

    // Both roles may edit a note the other created; notes are shared, unlike private chat.
    state = run(state, 'table.updateNote', { noteId: notes(state)[0].id, text: 'Owner idea, improved' }, member).state;
    expect(notes(state)[0].text).toBe('Owner idea, improved');
  });

  it('does not touch rule or data revisions, so a pending rule draft stays usable', () => {
    let state: TableState = createTableState();
    const before = { ruleRevision: state.ruleRevision, dataRevision: state.dataRevision };
    state = run(state, 'table.addNote', { text: 'Unrelated', x: 0, y: 0 }).state;
    state = run(state, 'table.moveNote', { noteId: notes(state)[0].id, x: 10, y: 10 }).state;
    expect(state.ruleRevision).toBe(before.ruleRevision);
    expect(state.dataRevision).toBe(before.dataRevision);
  });

  it('bounds text, colours, coordinates and the number of notes', () => {
    let state: TableState = createTableState();
    expect(() => handleTableCommand(state, 'table.addNote', { text: 'x'.repeat(501), x: 0, y: 0 }, member)).toThrow();
    expect(() => handleTableCommand(state, 'table.addNote', { text: 'ok', color: 'purple', x: 0, y: 0 }, member)).toThrow();
    expect(() => handleTableCommand(state, 'table.addNote', { text: 'ok', x: 90_001, y: 0 }, member)).toThrow();
    expect(() => handleTableCommand(state, 'table.updateNote', { noteId: 'note_missing' }, member)).toThrow();
    expect(() => handleTableCommand(state, 'table.removeNote', { noteId: 'note_missing' }, member)).toThrow();

    for (let index = 0; index < MAX_TABLE_NOTES; index += 1) {
      state = handleTableCommand(state, 'table.addNote', { text: `note ${index}`, x: index, y: index }, member)!.state;
    }
    expect(notes(state)).toHaveLength(MAX_TABLE_NOTES);
    expect(() => handleTableCommand(state, 'table.addNote', { text: 'one too many', x: 0, y: 0 }, member)).toThrow();
  });

  it('rejects unknown roles such as a learner on a table', () => {
    const learner = { ...member, role: 'learner' as const };
    expect(() => handleTableCommand(createTableState(), 'table.addNote', { text: 'no', x: 0, y: 0 }, learner)).toThrow();
  });

  it('survives a rule edit because notes live outside the program', () => {
    let state: TableState = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    state = run(state, 'table.addNote', { text: 'keep me', x: 5, y: 5 }).state;
    const change = equipmentChange(state.sources[0].id);
    let domain: DomainState = state;
    for (const [type, payload] of [['evolve.propose', { change }], ['evolve.simulate', {}], ['evolve.validate', {}], ['evolve.approve', {}], ['evolve.activate', {}]] as const) {
      domain = decideDomain(domain, { type, payload }, owner).state;
    }
    expect(domain.kind).toBe('table');
    if (domain.kind !== 'table') throw new Error('wrong kind');
    expect(domain.program).not.toBeNull();
    expect(notes(domain).map(note => note.text)).toEqual(['keep me']);
  });
});
