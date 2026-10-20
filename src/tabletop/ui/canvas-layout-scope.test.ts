import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState } from '../domain/table';
import type { WorkspaceView } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import { cafeQueueChange } from '../testing/generative-scenarios';
import { canvasLayoutScopeKey, isSharedCanvasNodeForView, missingSharedCanvasNodeIds } from './canvas-layout-scope';

function workspace(domain: TableState, actor: WorkspaceView['actor'] = { actorId: 'owner-a', name: 'Owner', role: 'owner' }): WorkspaceView {
  return {
    id: 'table-a', title: 'Test table', kind: 'table', epoch: 1, revision: 'revision-1', actor,
    members: [], domain, createdAt: 0, expiresAt: 1000,
  };
}

describe('shared Canvas layout scope', () => {
  it('isolates layout queues and local state by room, epoch, actor, role, and seat', () => {
    const base = workspace(createTableState());
    const revisionChangedView: WorkspaceView = { ...base, revision: 'revision-2' };
    expect(canvasLayoutScopeKey(base)).toBe(canvasLayoutScopeKey(revisionChangedView));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, id: 'table-b' }));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, kind: 'encounter' }));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, epoch: 2 }));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, actor: { actorId: 'owner-b', name: 'Other', role: 'owner' } }));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, actor: { actorId: 'owner-a', name: 'Owner', role: 'participant', seat: 'member-1' } }));
    expect(canvasLayoutScopeKey(base)).not.toBe(canvasLayoutScopeKey({ ...base, actor: { ...base.actor, seat: 'member-2' } }));
  });

  it('keeps a candidate-only Rules card private and promotes it after activation', () => {
    const empty = workspace(createTableState());
    const candidate = workspace({ ...createTableState(), candidate: {
      id: 'candidate-1', change: structuredClone(cafeQueueChange), baseDataRevision: 0, baseRuleRevision: 0,
      hash: 'candidate-hash', planDeltaHash: 'plan-hash', status: 'draft', createdBy: 'owner-a', createdAt: 1,
      simulation: null, proof: null, approval: null,
    } });
    const active = workspace(applyTableChange(createTableState(), structuredClone(cafeQueueChange)));

    expect(isSharedCanvasNodeForView('table.rules', empty)).toBe(false);
    expect(isSharedCanvasNodeForView('table.rules', candidate)).toBe(false);
    expect(isSharedCanvasNodeForView('table.rules', active)).toBe(true);
  });

  it('leaves private-only empty projections unmarked and discovers later eligible shared nodes', () => {
    const active = workspace(applyTableChange(createTableState(), structuredClone(cafeQueueChange)));
    const noPositions: Record<string, unknown> = {};
    const pending = new Set<string>();
    const dragging = new Set<string>();

    expect(missingSharedCanvasNodeIds([{ id: 'chat.answer.owner-a' }, { id: 'table.sources' }], active, noPositions, pending, dragging, null)).toEqual([]);
    expect(missingSharedCanvasNodeIds([
      { id: 'chat.answer.owner-a' }, { id: 'table.rules' }, { id: 'workspace.people' },
    ], active, noPositions, pending, dragging, null)).toEqual(['table.rules', 'workspace.people']);
    expect(missingSharedCanvasNodeIds([
      { id: 'table.rules' }, { id: 'workspace.people' }, { id: 'table.view.cafe-floor' },
    ], active, { 'table.rules': { x: 1, y: 2 } }, new Set(['workspace.people']), dragging, 'table.view.cafe-floor')).toEqual([]);

    // A previously-seeded node becomes eligible again after pruning removes its canonical position.
    expect(missingSharedCanvasNodeIds([{ id: 'table.view.cafe-floor' }], active, {}, pending, dragging, null))
      .toEqual(['table.view.cafe-floor']);
  });
});
