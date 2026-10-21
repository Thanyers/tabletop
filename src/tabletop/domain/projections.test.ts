import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { DomainError, type ActorContext, type DomainState, type EncounterState, type Role, type Seat, type TeachingState } from '../shared/contracts';
import type { VisibilityPolicy } from '../shared/visibility';
import { VISIBILITY_POLICY } from '../shared/visibility';
import { createDomain, decideDomain, projectDomain } from './index';
import { createTableState, handleTableCommand } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';

// F015: projectDomain shares one membership/role gate; 'open' returns the whole state to members,
// 'private' keeps the earlier role projections (covered field by field in domain/table/helpdesk tests).

function ctx(role: Role, actorId: string, seat?: Seat): ActorContext {
  return {
    actorId, name: `Name ${actorId}`, role, ...(seat ? { seat } : {}), workspaceId: 'workspace-f015', epoch: 3, now: 1_800_000_000_000,
    hash: (value) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex'),
  };
}
const step = (state: DomainState, type: string, payload: unknown, actor: ActorContext) => decideDomain(state, { type, payload }, actor).state;
const policies: VisibilityPolicy[] = ['open', 'private'];

function tableWithDraft(owner: ActorContext): DomainState {
  const imported = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
  return step(imported, 'evolve.propose', { change: equipmentChange(imported.sources[0].id) }, owner);
}

describe('projectDomain visibility policy (F015)', () => {
  it('defaults to the open policy', () => {
    expect(VISIBILITY_POLICY).toBe('open');
  });

  it('open: table members receive the owner draft, history and evidence', () => {
    const owner = ctx('owner', 'owner-a');
    const state = tableWithDraft(owner);
    if (state.kind !== 'table') throw Error('Expected table');
    expect(state.candidate).not.toBeNull();
    for (const member of [owner, ctx('participant', 'member-a', 'member-1')]) {
      expect(projectDomain(state, member, 'open')).toEqual(state);
      expect(projectDomain(state, member)).toEqual(state);
    }
    const privateView = projectDomain(state, ctx('participant', 'member-a', 'member-1'), 'private');
    if (privateView.kind !== 'table') throw Error('Expected table');
    expect(privateView.candidate).toBeNull();
  });

  it('open: every learner receives other answers, representations and the teacher note', () => {
    const teacher = ctx('teacher', 'teacher-a');
    const learner1 = ctx('learner', 'learner-a', 'learner-1');
    const learner2 = ctx('learner', 'learner-b', 'learner-2');
    let state = createDomain('teaching', teacher) as TeachingState;
    state = step(state, 'teaching.answer', { questionId: state.questionId, lessonRevision: state.ruleRevision, value: 3 }, learner1) as TeachingState;
    state = step(state, 'teaching.saveNote', { text: 'teacher answer key' }, teacher) as TeachingState;
    state = step(state, 'teaching.setRepresentation', { actorId: learner1.actorId, representation: 'graph', difficulty: 'advanced' }, teacher) as TeachingState;
    const seen = projectDomain(state, learner2, 'open') as TeachingState;
    expect(seen).toEqual(state);
    expect(seen.answers.map((answer) => answer.actorId)).toEqual([learner1.actorId]);
    expect(seen.teacherNote).toBe('teacher answer key');
    expect(projectDomain(state, teacher, 'open')).toEqual(state);
    const hidden = projectDomain(state, learner2, 'private') as TeachingState;
    expect(hidden.answers).toEqual([]);
    expect('teacherNote' in hidden).toBe(false);
  });

  it('open: seated players receive the DM note, goblin, seed and pending roll/damage', () => {
    const dm = ctx('dm', 'dm-a');
    const mira = ctx('player', 'mira-a', 'mira');
    let state = createDomain('encounter', dm) as EncounterState;
    state = step(state, 'encounter.declareHit', { target: 'pip' }, dm) as EncounterState;
    state = step(state, 'encounter.saveNote', { text: 'dm only phrase' }, dm) as EncounterState;
    expect(state.pendingHit?.roll).toEqual(expect.any(Number));
    const seen = projectDomain(state, mira, 'open') as EncounterState;
    expect(seen).toEqual(state);
    expect(seen.characters.some((character) => character.id === 'goblin')).toBe(true);
    expect(seen.pendingHit?.roll).toBe(state.pendingHit?.roll);
    expect(seen.pendingHit?.damage).toBe(state.pendingHit?.damage);
    expect(seen.dmNote).toBe('dm only phrase');
    expect(seen.seed).toBe(state.seed);
    const hidden = projectDomain(state, mira, 'private') as EncounterState;
    expect(hidden.pendingHit?.roll).toBeNull();
    expect(hidden.dmNote).toBeUndefined();
  });

  it('open: the invoice owner receives the full invoice', () => {
    const owner = ctx('owner', 'owner-i');
    const state = createDomain('invoice', owner);
    expect(projectDomain(state, owner, 'open')).toEqual(state);
    expect(projectDomain(state, owner, 'private')).toEqual(state);
  });

  it.each(policies)('%s: non-members and wrong roles are still FORBIDDEN for every kind', (policy) => {
    const owner = ctx('owner', 'owner-x');
    const forbidden: Array<[DomainState, ActorContext]> = [
      [tableWithDraft(owner), ctx('learner', 'outsider-1', 'learner-1')],
      [tableWithDraft(owner), ctx('dm', 'outsider-2')],
      [createDomain('teaching', ctx('teacher', 'teacher-x')), ctx('owner', 'outsider-3')],
      [createDomain('teaching', ctx('teacher', 'teacher-x')), ctx('participant', 'outsider-4', 'member-1')],
      [createDomain('encounter', ctx('dm', 'dm-x')), ctx('player', 'unseated')],
      [createDomain('encounter', ctx('dm', 'dm-x')), ctx('player', 'wrong-seat', 'learner-1')],
      [createDomain('encounter', ctx('dm', 'dm-x')), ctx('owner', 'outsider-5')],
      [createDomain('invoice', owner), ctx('participant', 'outsider-6', 'member-1')],
      [createDomain('invoice', owner), ctx('teacher', 'outsider-7')],
    ];
    for (const [state, actor] of forbidden) {
      let error: unknown;
      try { projectDomain(state, actor, policy); } catch (caught) { error = caught; }
      expect(error, `${state.kind} as ${actor.role}`).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe('FORBIDDEN');
    }
  });

  it('open: the projection is a copy, so a member cannot mutate the authority state', () => {
    const owner = ctx('owner', 'owner-c');
    const state = tableWithDraft(owner);
    const seen = projectDomain(state, ctx('participant', 'member-c', 'member-1'), 'open');
    if (seen.kind !== 'table' || state.kind !== 'table') throw Error('Expected table');
    seen.candidate = null;
    expect(state.candidate).not.toBeNull();
  });
});
