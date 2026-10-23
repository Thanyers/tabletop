import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_TABLE_NOTES, createTableState, handleTableCommand } from './table';
import { MAX_TABLE_IMAGES } from '../shared/canvas-images';
import { DomainError, type ActorContext } from '../shared/contracts';
import type { TableNote, TableState } from '../shared/table-contracts';

const owner: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'account-b', name: 'Participant', role: 'participant', seat: 'member-1', now: 2000 };
const other: ActorContext = { ...owner, actorId: 'account-c', name: 'Other', role: 'participant', seat: 'member-2', now: 3000 };

function run(state: TableState, type: string, payload: unknown, ctx: ActorContext = member) {
  return handleTableCommand(state, type, payload, ctx)!;
}
function notes(state: TableState): TableNote[] { return state.notes ?? []; }
function imageIdFor(index: number): string { return `img_${index.toString(16).padStart(32, '0')}`; }
function codeOf(action: () => unknown): string {
  try { action(); } catch (error) {
    if (error instanceof DomainError) return error.code;
    throw error;
  }
  throw new Error('expected a DomainError');
}

describe('image cards on the canvas (F073)', () => {
  it('adds an image note that carries its imageId and an image label', () => {
    const result = run(createTableState(), 'table.addNote', { imageId: imageIdFor(1), x: 10, y: 20, width: 320, height: 332 });
    expect(result.label).toBe('Image added.');
    const [note] = notes(result.state);
    expect(note).toMatchObject({ imageId: imageIdFor(1), text: '', x: 10, y: 20, width: 320, height: 332, createdBy: member.actorId });
    // A plain text note has no imageId key at all.
    const text = run(result.state, 'table.addNote', { text: 'plain', x: 0, y: 0 });
    expect(text.label).toBe('Note added.');
    expect('imageId' in notes(text.state)[1]!).toBe(false);
  });

  it('rejects malformed image ids', () => {
    const state = createTableState();
    for (const imageId of ['img_short', `img_${'A'.repeat(32)}`, `IMG_${'a'.repeat(32)}`, `img_${'a'.repeat(33)}`, '', 42, null]) {
      expect(codeOf(() => handleTableCommand(state, 'table.addNote', { imageId, x: 0, y: 0 }, member)), String(imageId)).toBe('INVALID_COMMAND');
    }
  });

  it('rejects the same image twice on one table', () => {
    const state = run(createTableState(), 'table.addNote', { imageId: imageIdFor(7), x: 0, y: 0 }).state;
    expect(codeOf(() => handleTableCommand(state, 'table.addNote', { imageId: imageIdFor(7), x: 300, y: 300 }, other))).toBe('TABLE_DUPLICATE_NOTE');
  });

  it('counts image cards and text notes against separate limits', () => {
    expect(MAX_TABLE_IMAGES).toBe(20);
    let state = createTableState();
    for (let index = 0; index < MAX_TABLE_NOTES; index += 1) {
      state = run(state, 'table.addNote', { text: `note ${index}`, x: index, y: 0 }).state;
    }
    expect(codeOf(() => handleTableCommand(state, 'table.addNote', { text: 'one too many', x: 0, y: 0 }, member))).toBe('TABLE_LIMIT');
    // A full set of text notes does not block pictures.
    for (let index = 0; index < MAX_TABLE_IMAGES; index += 1) {
      state = run(state, 'table.addNote', { imageId: imageIdFor(index), x: index, y: 500 }).state;
    }
    expect(notes(state)).toHaveLength(MAX_TABLE_NOTES + MAX_TABLE_IMAGES);
    expect(codeOf(() => handleTableCommand(state, 'table.addNote', { imageId: imageIdFor(999), x: 0, y: 0 }, member))).toBe('TABLE_LIMIT');
  });

  it('a full set of pictures does not block text notes', () => {
    let state = createTableState();
    for (let index = 0; index < MAX_TABLE_IMAGES; index += 1) {
      state = run(state, 'table.addNote', { imageId: imageIdFor(index), x: index, y: 0 }).state;
    }
    state = run(state, 'table.addNote', { text: 'still room for words', x: 0, y: 900 }).state;
    expect(notes(state).filter(note => !note.imageId).map(note => note.text)).toEqual(['still room for words']);
  });

  it('frees an image slot again once a picture is removed', () => {
    let state = createTableState();
    for (let index = 0; index < MAX_TABLE_IMAGES; index += 1) {
      state = run(state, 'table.addNote', { imageId: imageIdFor(index), x: index, y: 0 }).state;
    }
    const removed = run(state, 'table.removeNote', { noteId: notes(state)[0]!.id });
    expect(removed.label).toBe('Image removed.');
    state = run(removed.state, 'table.addNote', { imageId: imageIdFor(500), x: 0, y: 0 }).state;
    expect(notes(state).filter(note => note.imageId)).toHaveLength(MAX_TABLE_IMAGES);
  });

  it('lets only the person who pinned a picture or the owner remove it', () => {
    let state = run(createTableState(), 'table.addNote', { imageId: imageIdFor(1), x: 0, y: 0 }).state;
    state = run(state, 'table.addNote', { imageId: imageIdFor(2), x: 50, y: 0 }).state;
    const [first, second] = notes(state);

    expect(codeOf(() => handleTableCommand(state, 'table.removeNote', { noteId: first!.id }, other))).toBe('FORBIDDEN');

    const byCreator = run(state, 'table.removeNote', { noteId: first!.id }, member);
    expect(notes(byCreator.state).map(note => note.id)).toEqual([second!.id]);

    const byOwner = run(state, 'table.removeNote', { noteId: second!.id }, owner);
    expect(notes(byOwner.state).map(note => note.id)).toEqual([first!.id]);
  });

  it('still lets any participant remove a text note someone else wrote', () => {
    const state = run(createTableState(), 'table.addNote', { text: 'shared idea', x: 0, y: 0 }, member).state;
    const removed = run(state, 'table.removeNote', { noteId: notes(state)[0]!.id }, other);
    expect(removed.label).toBe('Note removed.');
    expect(notes(removed.state)).toEqual([]);
  });

  it('lets any participant move or resize a picture card', () => {
    let state = run(createTableState(), 'table.addNote', { imageId: imageIdFor(3), x: 0, y: 0 }).state;
    const id = notes(state)[0]!.id;
    state = run(state, 'table.moveNote', { noteId: id, x: 200, y: 100 }, other).state;
    state = run(state, 'table.updateNote', { noteId: id, width: 400, height: 400 }, other).state;
    expect(notes(state)[0]).toMatchObject({ x: 200, y: 100, width: 400, height: 400, imageId: imageIdFor(3) });
  });

  it('rejects an imageId on updateNote so a card cannot swap its picture', () => {
    const state = run(createTableState(), 'table.addNote', { imageId: imageIdFor(4), x: 0, y: 0 }).state;
    expect(codeOf(() => handleTableCommand(state, 'table.updateNote', { noteId: notes(state)[0]!.id, imageId: imageIdFor(5) }, member))).toBe('INVALID_COMMAND');
  });
});
