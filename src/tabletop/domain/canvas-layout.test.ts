import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain, projectDomain } from './index';
import { applyTableChange, createTableState, handleTableCommand } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext } from '../shared/contracts';
import { handleCanvasLayout } from './canvas-layout';
import { MAX_SHARED_CHAT_POSITIONS } from '../shared/canvas-layout-ids';

const owner: ActorContext = { actorId: 'test-owner', name: 'Fixture', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1, hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') };
const participant: ActorContext = { ...owner, actorId: 'test-member', role: 'participant', seat: 'member-1' };
function active() {
  const state = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
  return applyTableChange(state, equipmentChange(state.sources[0].id));
}
const move = (revision: number, x: number) => ({ expectedLayoutRevision: revision, positions: { 'table.collection.equipment': { x, y: 240, pinned: true } } });

describe('shared arrangement authority', () => {
  it('persists participant geometry independently from data and rejects stale geometry', () => {
    const state = active();
    const next = handleCanvasLayout(state, move(0, 520), participant).state;
    expect(next.canvasLayout).toEqual({ revision: 1, positions: move(0, 520).positions });
    expect(next.records).toEqual(state.records);
    expect(next.dataRevision).toBe(state.dataRevision);
    expect(next.ruleRevision).toBe(state.ruleRevision);
    expect(next.actionRevision).toBe(state.actionRevision);
    expect(() => handleCanvasLayout(next, move(0, 920), owner)).toThrow('arrangement changed');
    expect(handleCanvasLayout(next, move(1, 920), owner).state.canvasLayout.positions['table.collection.equipment'].x).toBe(920);
  });
  it('shares people and history immediately, and rules only after activation (F007)', () => {
    const blank = createTableState();
    const placed = handleCanvasLayout(blank, { expectedLayoutRevision: 0, positions: {
      'workspace.people': { x: 600, y: 40, pinned: true },
      'workspace.history': { x: 600, y: 420, pinned: true },
    } }, participant).state;
    expect(Object.keys(placed.canvasLayout!.positions).sort()).toEqual(['workspace.history', 'workspace.people']);
    const projected = projectDomain(placed, participant);
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(projected.canvasLayout?.positions['workspace.people']).toEqual({ x: 600, y: 40, pinned: true });
    const withRules = handleCanvasLayout(active(), { expectedLayoutRevision: 0, positions: { 'table.rules': { x: 10, y: 20 } } }, owner).state;
    expect(withRules.canvasLayout?.positions['table.rules']).toEqual({ x: 10, y: 20 });
  });
  it('private policy: keeps draft-only Rules geometry private, including geometry saved by an older client', () => {
    const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    const draft = decideDomain(imported, { type: 'evolve.propose', payload: { change: equipmentChange(imported.sources[0].id) } }, owner).state;
    if (draft.kind !== 'table') throw Error('Expected table');
    expect(draft.program).toBeNull();
    expect(draft.candidate).not.toBeNull();
    for (const actor of [owner, participant]) {
      expect(() => handleCanvasLayout(draft, { expectedLayoutRevision: 0, positions: { 'table.rules': { x: 40, y: 40 } } }, actor, 'private')).toThrow('Only active shared objects');
    }
    draft.canvasLayout = { revision: 1, positions: { 'table.rules': { x: 40, y: 40 } } };
    const projected = projectDomain(draft, participant, 'private');
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(projected.candidate).toBeNull();
    expect(projected.canvasLayout?.positions).toEqual({});
  });
  it('open policy: shares draft-only Rules and chat card geometry with every member (F034)', () => {
    const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    const draft = decideDomain(imported, { type: 'evolve.propose', payload: { change: equipmentChange(imported.sources[0].id) } }, owner).state;
    if (draft.kind !== 'table') throw Error('Expected table');
    const chatId = `table.chat.${'a'.repeat(64)}`;
    const moved = handleCanvasLayout(draft, { expectedLayoutRevision: 0, positions: { 'table.rules': { x: 40, y: 40 }, [chatId]: { x: 900, y: 80 } } }, participant, 'open').state;
    const seen = projectDomain(moved, owner, 'open');
    if (seen.kind !== 'table') throw Error('Expected table');
    expect(seen.canvasLayout?.positions).toEqual({ 'table.rules': { x: 40, y: 40 }, [chatId]: { x: 900, y: 80 } });
    expect(() => handleCanvasLayout(draft, { expectedLayoutRevision: 0, positions: { [chatId]: { x: 1, y: 1 } } }, participant, 'private')).toThrow('Only active shared objects');
    const privateView = projectDomain(moved, participant, 'private');
    if (privateView.kind !== 'table') throw Error('Expected table');
    expect(privateView.canvasLayout?.positions).toEqual({});
  });
  it('open policy: keeps only the newest chat card positions', () => {
    let state = createTableState();
    for (let index = 0; index < MAX_SHARED_CHAT_POSITIONS + 5; index += 1) {
      const id = `table.chat.${index.toString(16).padStart(64, '0')}`;
      state = handleCanvasLayout(state, { expectedLayoutRevision: state.canvasLayout?.revision ?? 0, positions: { [id]: { x: index, y: 0 } } }, participant, 'open').state;
    }
    const ids = Object.keys(state.canvasLayout?.positions ?? {});
    expect(ids).toHaveLength(MAX_SHARED_CHAT_POSITIONS);
    expect(ids[0]).toBe(`table.chat.${(5).toString(16).padStart(64, '0')}`);
  });
  it('rejects unavailable, private and arbitrary geometry without mutating existing positions', () => {
    const state = active();
    for (const id of ['table.trial', 'workspace.ai', 'chat.answer-1', 'assistant', 'table.collection.missing', 'table.view.missing', '__proto__']) {
      expect(() => handleCanvasLayout(state, { expectedLayoutRevision: 0, positions: { [id]: { x: 0, y: 0 } } }, participant)).toThrow();
    }
    expect(() => handleCanvasLayout(state, move(0, Infinity), owner)).toThrow();
    expect(() => handleCanvasLayout(state, move(0, 90_001), owner)).toThrow();
    expect(() => handleCanvasLayout(state, move(0, 0), { ...owner, role: 'learner' })).toThrow();
    expect(state.canvasLayout).toBeUndefined();
  });
  it('private policy: filters old/private geometry from projections and preserves an in-progress rule proof', () => {
    let state = active();
    const edit = equipmentChange(state.sources[0].id);
    edit.initialRecords = {};
    edit.program.description = 'Updated explanation';
    for (const command of [
      { type: 'evolve.propose', payload: { change: edit } },
      { type: 'evolve.simulate', payload: {} },
      { type: 'evolve.validate', payload: {} },
      { type: 'evolve.approve', payload: {} },
    ]) {
      const next = decideDomain(state, command, owner).state;
      if (next.kind !== 'table') throw Error('Expected table');
      state = next;
    }
    const moved = handleCanvasLayout(state, move(0, 900), participant).state;
    expect(() => decideDomain(moved, { type: 'evolve.activate', payload: {} }, owner)).not.toThrow();
    moved.canvasLayout.positions['chat.answer-1'] = { x: 150, y: 20 };
    moved.canvasLayout.positions['table.view.retired'] = { x: 450, y: 20 };
    const projected = projectDomain(moved, participant, 'private');
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(Object.keys(projected.canvasLayout!.positions)).toEqual(['table.collection.equipment']);
    expect(projected.sources).toEqual(moved.sources);
  });
  it('open policy (F034): every member still gets retired and auxiliary geometry dropped, while the rest of the state is shared', () => {
    const moved = handleCanvasLayout(active(), move(0, 900), participant).state;
    moved.canvasLayout.positions['chat.answer-1'] = { x: 150, y: 20 };
    moved.canvasLayout.positions['table.view.retired'] = { x: 450, y: 20 };
    for (const actor of [owner, participant]) {
      const projected = projectDomain(moved, actor, 'open');
      if (projected.kind !== 'table') throw Error('Expected table');
      expect(projected.canvasLayout).toEqual({ revision: 1, positions: { 'table.collection.equipment': { x: 900, y: 240, pinned: true } } });
      expect({ ...projected, canvasLayout: moved.canvasLayout }).toEqual(moved);
      expect(projectDomain(moved, actor)).toEqual(projected);
    }
    expect(Object.keys(moved.canvasLayout.positions)).toContain('table.view.retired');
  });
  it('shares the Files card position once the table has files (F008)', () => {
    expect(() => handleCanvasLayout(createTableState(), { expectedLayoutRevision: 0, positions: { 'table.sources': { x: 0, y: 0 } } }, participant)).toThrow();
    const placed = handleCanvasLayout(active(), { expectedLayoutRevision: 0, positions: { 'table.sources': { x: 40, y: 60, pinned: true } } }, participant).state;
    const projected = projectDomain(placed, participant);
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(projected.canvasLayout?.positions['table.sources']).toEqual({ x: 40, y: 60, pinned: true });
  });
});

describe('soft delete (trash) in the shared arrangement', () => {
  const chat = `table.chat.${'a'.repeat(64)}`;
  it('anyone deletes and restores a chat card; the label says how to get it back', () => {
    const state = active();
    const deleted = handleCanvasLayout(state, { expectedLayoutRevision: 0, trash: { [chat]: true } }, participant, 'open');
    expect(deleted.label).toContain('restore from Objects');
    expect(deleted.state.canvasLayout?.trashed).toEqual({ [chat]: { by: 'test-member', at: 1 } });
    expect(deleted.state.dataRevision).toBe(state.dataRevision);
    const projected = projectDomain(deleted.state, owner);
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(Object.keys(projected.canvasLayout?.trashed ?? {})).toEqual([chat]);
    const restored = handleCanvasLayout(deleted.state, { expectedLayoutRevision: 1, trash: { [chat]: false } }, owner, 'open');
    expect(restored.label).toBe('Restored a card');
    expect(restored.state.canvasLayout?.trashed).toBeUndefined();
  });
  it('only the owner deletes data tables and views; the table frame can only be hidden', () => {
    const state = active();
    expect(() => handleCanvasLayout(state, { expectedLayoutRevision: 0, trash: { 'table.collection.equipment': true } }, participant, 'open')).toThrow();
    expect(handleCanvasLayout(state, { expectedLayoutRevision: 0, trash: { 'table.collection.equipment': true } }, owner, 'open').state.canvasLayout?.trashed).toHaveProperty(['table.collection.equipment']);
    for (const id of ['table.rules', 'table.actions', 'workspace.people', 'workspace.history']) {
      expect(() => handleCanvasLayout(state, { expectedLayoutRevision: 0, trash: { [id]: true } }, owner, 'open')).toThrow('only be hidden');
    }
  });
  it('rejects an empty command and keeps positions of deleted cards', () => {
    const state = active();
    expect(() => handleCanvasLayout(state, { expectedLayoutRevision: 0 }, owner, 'open')).toThrow();
    const placed = handleCanvasLayout(state, move(0, 520), owner, 'open').state;
    const deleted = handleCanvasLayout(placed, { expectedLayoutRevision: 1, trash: { 'table.collection.equipment': true } }, owner, 'open').state;
    expect(deleted.canvasLayout?.positions['table.collection.equipment']?.x).toBe(520);
  });
});
