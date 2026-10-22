import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain } from './index';
import { createTableState, handleTableCommand } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext, DomainState } from '../shared/contracts';
import { permissionsFor, type Permission } from '../shared/permissions';

const owner: ActorContext = { actorId: 'test-owner', name: 'Fixture', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1, hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'test-member', role: 'participant', seat: 'member-1', permissions: new Set<Permission>(['rules.draft']) };

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
