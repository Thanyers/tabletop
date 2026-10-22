import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain } from './index';
import { createTableState, handleTableCommand } from './table';
import { equipmentChange, shiftsChange, tableScenarioSources } from '../testing/table-scenarios';
import { cafeQueueChange } from '../testing/generative-scenarios';
import type { ActorContext, DomainState } from '../shared/contracts';
import { permissionsFor, type Permission } from '../shared/permissions';

const owner: ActorContext = { actorId: 'test-owner', name: 'Fixture', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1, hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'test-member', role: 'participant', seat: 'member-1', permissions: new Set<Permission>(['rules.draft']) };

function activeShifts(): DomainState {
  const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.shifts, owner)!.state;
  const draft = decideDomain(imported, { type: 'evolve.propose', payload: { change: shiftsChange(imported.sources[0].id) } }, owner).state;
  return decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, owner).state;
}

function drafted(by: ActorContext): DomainState {
  const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
  return decideDomain(imported, { type: 'evolve.propose', payload: { change: equipmentChange(imported.sources[0].id) } }, by).state;
}

describe('F039 evolve.autoApply', () => {
  it('runs every review step and activates the asker\'s own draft as a new rule revision', () => {
    const draft = drafted(owner);
    const result = decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, owner);
    expect(result.state.ruleRevision).toBe(draft.ruleRevision + 1);
    expect(result.state.candidate?.status).toBe('active');
    expect(result.state.candidate?.approval?.actorId).toBe(owner.actorId);
    if (result.state.kind !== 'table') throw Error('Expected table');
    expect(result.state.program).not.toBeNull();
  });

  it('lets a member who may only draft rules apply their own draft', () => {
    const draft = drafted(member);
    const result = decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, member);
    expect(result.state.candidate?.status).toBe('active');
  });

  it('refuses someone else\'s draft and a member without rules.draft', () => {
    const draft = drafted(owner);
    expect(() => decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, member)).toThrow(/Only the person who asked/u);
    const viewer = { ...member, permissions: new Set<Permission>(permissionsFor('table').filter(p => p !== 'rules.draft')) };
    expect(() => decideDomain(drafted(member), { type: 'evolve.autoApply', payload: {} }, viewer)).toThrow();
  });
});

describe('F039 evolve.removeItem', () => {
  const active = () => decideDomain(drafted(owner), { type: 'evolve.autoApply', payload: {} }, owner).state;

  it('removes one rule as a new revision that history can restore', () => {
    const state = activeShifts();
    if (state.kind !== 'table' || !state.program) throw Error('Expected an active table');
    const removable = state.program.invariants[0];
    expect(removable?.id).toBe('slot_unique');
    const result = decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'invariant', id: removable!.id } }, member);
    if (result.state.kind !== 'table') throw Error('Expected table');
    expect(result.state.program?.invariants.some(item => item.id === removable!.id)).toBe(false);
    expect(result.state.ruleRevision).toBe(state.ruleRevision + 1);
    expect(result.state.revisions.at(-1)?.revision).toBe(result.state.ruleRevision);
  });

  it('refuses to remove a collection that an action still uses', () => {
    const state = active();
    if (state.kind !== 'table' || !state.program) throw Error('Expected an active table');
    expect(() => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'collection', id: 'equipment' } }, owner)).toThrow(/Remove the action/u);
  });

  it('removes an action and an unknown id is refused', () => {
    const state = active();
    if (state.kind !== 'table' || !state.program) throw Error('Expected an active table');
    const outcomes = state.program.actions.map(action => {
      try { decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'action', id: action.id } }, owner); return 'removed'; } catch (error) { return (error as Error).message; }
    });
    expect(outcomes).toContain('removed');
    expect(() => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'action', id: 'missing' } }, owner)).toThrow(/no longer on this table/u);
  });
});

describe('F039 evolve.autoApply on every case kind', () => {
  it('applies a teacher\'s lesson change and a DM\'s encounter rule, and waits while an encounter is paused', () => {
    const teacher: ActorContext = { ...owner, actorId: 'test-teacher', role: 'teacher' };
    const lesson = createDomain('teaching', teacher);
    if (lesson.kind !== 'teaching') throw Error('Expected teaching');
    const proposed = decideDomain(lesson, { type: 'evolve.propose', payload: { change: { kind: 'teaching', parameters: { ...lesson.parameters, mass: lesson.parameters.mass + 1 } } } }, teacher).state;
    const applied = decideDomain(proposed, { type: 'evolve.autoApply', payload: {} }, teacher).state;
    expect(applied.ruleRevision).toBe(lesson.ruleRevision + 1);
    expect(applied.candidate?.status).toBe('active');

    const dm: ActorContext = { ...owner, actorId: 'test-dm', role: 'dm' };
    const encounter = createDomain('encounter', dm);
    if (encounter.kind !== 'encounter') throw Error('Expected encounter');
    const ruleDraft = decideDomain(encounter, { type: 'evolve.propose', payload: { change: { kind: 'encounter', rule: { ...encounter.rule, apCost: encounter.rule.apCost === 1 ? 2 : 1 } } } }, dm).state;
    expect(decideDomain(ruleDraft, { type: 'evolve.autoApply', payload: {} }, dm).state.candidate?.status).toBe('active');
    const paused = decideDomain(decideDomain(encounter, { type: 'encounter.pause', payload: {} }, dm).state, { type: 'evolve.propose', payload: { change: { kind: 'encounter', rule: { ...encounter.rule, apCost: encounter.rule.apCost === 1 ? 2 : 1 } } } }, dm).state;
    expect(() => decideDomain(paused, { type: 'evolve.autoApply', payload: {} }, dm)).toThrow(/Resume the encounter/u);
  });
});

function codeOf(run: () => unknown): string {
  try { run(); } catch (error) { return (error as { code?: string }).code ?? 'NO_CODE'; }
  return 'NO_ERROR';
}

/** A prompt-only cafe table with views, plus one collection that no action or view uses. */
function activeCafe(): DomainState {
  const change = structuredClone(cafeQueueChange);
  change.program.collections.push({ id: 'tips', title: 'Tip jar', fields: [{ id: 'amount', label: 'Amount', type: 'number', required: true, min: 0, max: 1000 }] });
  change.initialRecords.tips = [{ id: 'tip-1', values: { amount: 20 } }, { id: 'tip-2', values: { amount: 35 } }];
  const draft = decideDomain(createTableState(), { type: 'evolve.propose', payload: { change } }, owner).state;
  return decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, owner).state;
}

describe('F039 evolve.autoApply when a check fails or the draft is not ready', () => {
  it('leaves the rules unchanged when existing records break a new unique rule', () => {
    const active = decideDomain(drafted(owner), { type: 'evolve.autoApply', payload: {} }, owner).state;
    if (active.kind !== 'table' || !active.program) throw Error('Expected an active table');
    const stricter = structuredClone(active.program);
    // Both items are available, so a rule "only one available item" is broken by the current records.
    stricter.invariants = [{ id: 'one_available', collection: 'equipment', fields: ['available'], message: 'Only one item may be available.' }];
    const draft = decideDomain(active, { type: 'evolve.propose', payload: { change: { kind: 'table', program: stricter, initialRecords: {} } } }, owner).state;
    const before = structuredClone(draft);
    // The broken rule fails while the draft is previewed, so the whole command is rejected with the reason;
    // the Room turns that reason into autoApplyReasons on the job.
    expect(() => decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, owner)).toThrow(/Only one item may be available/u);
    expect(codeOf(() => decideDomain(draft, { type: 'evolve.autoApply', payload: {} }, owner))).toBe('TABLE_INVARIANT');
    expect(draft).toEqual(before);
    if (draft.kind !== 'table') throw Error('Expected table');
    expect(draft.ruleRevision).toBe(active.ruleRevision);
    expect(draft.program).toEqual(active.program);
    expect(draft.candidate?.status).toBe('draft');
  });

  it('refuses a draft based on a rule revision that is no longer active', () => {
    const active = decideDomain(drafted(owner), { type: 'evolve.autoApply', payload: {} }, owner).state;
    if (active.kind !== 'table' || !active.program) throw Error('Expected an active table');
    const draft = decideDomain(active, { type: 'evolve.propose', payload: { change: { kind: 'table', program: structuredClone(active.program), initialRecords: {} } } }, owner).state;
    const moved = decideDomain(draft, { type: 'evolve.removeItem', payload: { kind: 'action', id: 'return' } }, owner).state;
    expect(moved.candidate?.baseRuleRevision).toBeLessThan(moved.ruleRevision);
    expect(codeOf(() => decideDomain(moved, { type: 'evolve.autoApply', payload: {} }, owner))).toBe('STALE_CANDIDATE');
  });

  it('refuses a candidate that is already in review or already in use', () => {
    const simulated = decideDomain(drafted(owner), { type: 'evolve.simulate', payload: {} }, owner).state;
    expect(simulated.candidate?.status).toBe('simulated');
    expect(codeOf(() => decideDomain(simulated, { type: 'evolve.autoApply', payload: {} }, owner))).toBe('CANDIDATE_NOT_DRAFT');
    const active = decideDomain(drafted(owner), { type: 'evolve.autoApply', payload: {} }, owner).state;
    expect(codeOf(() => decideDomain(active, { type: 'evolve.autoApply', payload: {} }, owner))).toBe('CANDIDATE_NOT_DRAFT');
  });

  it('refuses a table with no draft, and a payload', () => {
    const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    expect(codeOf(() => decideDomain(imported, { type: 'evolve.autoApply', payload: {} }, owner))).toBe('CANDIDATE_NOT_FOUND');
    expect(() => decideDomain(drafted(owner), { type: 'evolve.autoApply', payload: { force: true } }, owner)).toThrow();
  });
});

describe('F039 evolve.removeItem for views and collections', () => {
  it('removes a view nothing else points at', () => {
    const state = activeCafe();
    if (state.kind !== 'table' || !state.program?.canvas) throw Error('Expected an active table with views');
    const result = decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'view', id: 'cafe-floor' } }, member).state;
    if (result.kind !== 'table') throw Error('Expected table');
    expect(result.program?.canvas?.views.map(view => view.id)).toEqual(state.program.canvas.views.map(view => view.id).filter(id => id !== 'cafe-floor'));
    expect(result.ruleRevision).toBe(state.ruleRevision + 1);
    expect(result.dataRevision).toBe(state.dataRevision);
    expect(result.records).toEqual(state.records);
  });

  it('removes a view another view relates to and drops only that link', () => {
    const state = activeCafe();
    if (state.kind !== 'table' || !state.program?.canvas) throw Error('Expected an active table with views');
    expect(state.program.canvas.views.find(view => view.id === 'queue-chart')?.relatedTo).toEqual({ views: ['average-wait'], collections: ['queue'] });
    const result = decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'view', id: 'average-wait' } }, owner).state;
    if (result.kind !== 'table') throw Error('Expected table');
    const views = result.program?.canvas?.views ?? [];
    expect(views.some(view => view.id === 'average-wait')).toBe(false);
    expect(views.find(view => view.id === 'queue-chart')?.relatedTo).toEqual({ collections: ['queue'] });
  });

  it('names the view that still uses an action, and the actions and views that still use a collection', () => {
    const state = activeCafe();
    const action = () => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'action', id: 'start_service' } }, owner);
    expect(codeOf(action)).toBe('RULE_ITEM_IN_USE');
    expect(action).toThrow('Remove the view “Service controls” first; it still uses this.');
    const collection = () => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'collection', id: 'queue' } }, owner);
    expect(codeOf(collection)).toBe('RULE_ITEM_IN_USE');
    expect(collection).toThrow(/^Remove the action “start_service”, .*the view “Queue waits”.* first; it still uses this\.$/u);
  });

  it('removes an unused collection with its records and moves the data revision', () => {
    const state = activeCafe();
    if (state.kind !== 'table') throw Error('Expected table');
    expect(state.records.tips).toHaveLength(2);
    const result = decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'collection', id: 'tips' } }, owner).state;
    if (result.kind !== 'table') throw Error('Expected table');
    expect(result.program?.collections.some(collection => collection.id === 'tips')).toBe(false);
    expect(Object.hasOwn(result.records, 'tips')).toBe(false);
    expect(result.dataRevision).toBe(state.dataRevision + 1);
    expect(result.ruleRevision).toBe(state.ruleRevision + 1);
    expect(result.revisions.at(-1)?.snapshot).toEqual({ kind: 'table', program: result.program });
  });

  it('rolls back to the revision before a removal and gets the view and collection back', () => {
    const state = activeCafe();
    if (state.kind !== 'table' || !state.program) throw Error('Expected an active table');
    const before = state.ruleRevision;
    const withoutView = decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'view', id: 'cafe-floor' } }, owner).state;
    const withoutBoth = decideDomain(withoutView, { type: 'evolve.removeItem', payload: { kind: 'collection', id: 'tips' } }, owner).state;
    const rollback = decideDomain(withoutBoth, { type: 'evolve.rollback', payload: { revision: before } }, owner).state;
    const restored = decideDomain(rollback, { type: 'evolve.autoApply', payload: {} }, owner).state;
    if (restored.kind !== 'table' || !restored.program) throw Error('Expected an active table');
    expect(restored.ruleRevision).toBe(before + 3);
    expect(restored.program.canvas?.views.some(view => view.id === 'cafe-floor')).toBe(true);
    expect(restored.program.collections.some(collection => collection.id === 'tips')).toBe(true);
    // The rules come back; the removed rows do not, because removing a collection deletes its data.
    expect(restored.records.tips).toEqual([]);
  });

  it('refuses a member without rules.draft, a workspace that is not a table, and an unknown kind', () => {
    const state = activeCafe();
    const viewer = { ...member, permissions: new Set<Permission>(permissionsFor('table').filter(p => p !== 'rules.draft')) };
    expect(codeOf(() => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'view', id: 'cafe-floor' } }, viewer))).toBe('FORBIDDEN');
    expect(codeOf(() => decideDomain(createDomain('invoice', owner), { type: 'evolve.removeItem', payload: { kind: 'action', id: 'x' } }, owner))).toBe('RULE_ITEM_UNSUPPORTED');
    expect(codeOf(() => decideDomain(state, { type: 'evolve.removeItem', payload: { kind: 'turn', id: 'x' } }, owner))).not.toBe('NO_ERROR');
  });
});
