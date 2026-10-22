import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain } from './index';
import { createTableState, handleTableCommand } from './table';
import { equipmentChange, shiftsChange, tableScenarioSources } from '../testing/table-scenarios';
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
