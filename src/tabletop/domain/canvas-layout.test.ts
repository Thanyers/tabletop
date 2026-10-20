import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain, projectDomain } from './index';
import { applyTableChange, createTableState, handleTableCommand } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext } from '../shared/contracts';
import { handleCanvasLayout } from './canvas-layout';

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
  it('rejects unavailable, private and arbitrary geometry without mutating existing positions', () => {
    const state = active();
    for (const id of ['table.sources', 'table.rules', 'assistant', 'table.collection.missing', 'table.view.missing', '__proto__']) {
      expect(() => handleCanvasLayout(state, { expectedLayoutRevision: 0, positions: { [id]: { x: 0, y: 0 } } }, participant)).toThrow();
    }
    expect(() => handleCanvasLayout(state, move(0, Infinity), owner)).toThrow();
    expect(() => handleCanvasLayout(state, move(0, 90_001), owner)).toThrow();
    expect(() => handleCanvasLayout(state, move(0, 0), { ...owner, role: 'learner' })).toThrow();
    expect(state.canvasLayout).toBeUndefined();
  });
  it('filters old/private geometry from projections and preserves an in-progress rule proof', () => {
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
    moved.canvasLayout.positions['table.sources'] = { x: 150, y: 20 };
    moved.canvasLayout.positions['table.view.retired'] = { x: 450, y: 20 };
    const projected = projectDomain(moved, participant);
    if (projected.kind !== 'table') throw Error('Expected table');
    expect(Object.keys(projected.canvasLayout!.positions)).toEqual(['table.collection.equipment']);
    expect(projected.sources).toEqual([]);
  });
});
