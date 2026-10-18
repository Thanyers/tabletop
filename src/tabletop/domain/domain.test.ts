import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  DomainError,
  type ActorContext,
  type DomainState,
  type EncounterState,
  type InvoiceState,
  type Role,
  type Seat,
  type TeachingState,
} from '../shared/contracts';
import { calculatePhysics, createDomain, decideDomain, projectDomain, reconcileInvoice } from './index';

function context(role: Role, actorId: string, seat?: Seat, now = 1_800_000_000_000): ActorContext {
  return {
    actorId,
    name: `Name ${actorId}`,
    role,
    ...(seat ? { seat } : {}),
    workspaceId: 'workspace-r1',
    epoch: 7,
    now,
    hash(value: unknown) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      return createHash('sha256').update(text).digest('hex');
    },
  };
}

it('does not expose another learner view, answer count or difficulty through projection metadata', () => {
  const teacher = context('teacher', 'teacher');
  const own = context('learner', 'own', 'learner-1');
  const other = context('learner', 'other', 'learner-2');
  let state = createDomain('teaching', teacher) as TeachingState;
  const before = projectDomain(state, own);
  state = decideDomain(state, { type: 'teaching.setRepresentation', payload: { actorId: other.actorId, representation: 'graph', difficulty: 'advanced' } }, teacher).state as TeachingState;
  state = decideDomain(state, { type: 'teaching.answer', payload: { questionId: state.questionId, lessonRevision: state.ruleRevision, value: 10 } }, other).state as TeachingState;
  expect(projectDomain(state, own)).toEqual(before);
  const visible = projectDomain(state, other) as TeachingState;
  expect(visible.answers).toHaveLength(1);
  expect(visible.representations).toEqual({ other: 'graph' });
});

function step(state: InvoiceState, type: string, payload: unknown, actor: ActorContext): InvoiceState;
function step(state: TeachingState, type: string, payload: unknown, actor: ActorContext): TeachingState;
function step(state: EncounterState, type: string, payload: unknown, actor: ActorContext): EncounterState;
function step(state: DomainState, type: string, payload: unknown, actor: ActorContext): DomainState;
function step(state: DomainState, type: string, payload: unknown, actor: ActorContext): DomainState {
  const result = decideDomain(state, { type, payload }, actor).state;
  if (result.kind !== state.kind) throw new Error('Domain command changed case kind.');
  return result;
}

function evolve(state: DomainState, change: unknown, actor: ActorContext): DomainState {
  let next = step(state, 'evolve.propose', { change }, actor);
  next = step(next, 'evolve.simulate', {}, actor);
  next = step(next, 'evolve.validate', {}, actor);
  expect(next.candidate?.proof?.passed).toBe(true);
  next = step(next, 'evolve.approve', {}, actor);
  return step(next, 'evolve.activate', {}, actor);
}

function invoiceState(state: DomainState) {
  if (state.kind !== 'invoice') throw new Error('Expected invoice state.');
  return state;
}

function teachingState(state: DomainState) {
  if (state.kind !== 'teaching') throw new Error('Expected teaching state.');
  return state;
}

function encounterState(state: DomainState) {
  if (state.kind !== 'encounter') throw new Error('Expected encounter state.');
  return state;
}

describe('R1 domain engines', () => {
  it('reconciles the dated THB satang fixture and groups missing remote evidence', () => {
    const owner = context('owner', 'owner-1');
    const original = invoiceState(createDomain('invoice', owner));
    const serializedBefore = JSON.stringify(original);
    const result = reconcileInvoice(original);
    const currentBkk = result.rows.find((row) => row.shipmentId === 'S-BKK-1100');
    const priorBkk = result.rows.find((row) => row.shipmentId === 'S-BKK-1000');
    const remote = result.rows.filter((row) => row.shipmentId.startsWith('S-') && row.reasons.includes('missing_or_ambiguous_remote_surcharge'));

    expect(currentBkk?.expectedSatang).toBe(4500);
    expect(currentBkk?.deltaSatang).toBe(500);
    expect(priorBkk?.expectedSatang).toBe(4000);
    expect(priorBkk?.deltaSatang).toBe(0);
    expect(remote).toHaveLength(2);
    expect(remote.every((row) => row.expectedSatang === null && row.deltaSatang === null)).toBe(true);
    expect(result.gaps).toHaveLength(1);
    expect(result.gaps[0].status).toBe('missing');
    expect(result.gaps[0].affectedRecordIds).toEqual(['S-BKK-REMOTE-1100', 'S-REMOTE-1100']);
    expect(result.knownExpectedSatang).toBe(8_500);
    expect(result.knownBilledSatang).toBe(22_000);
    expect(result.deltaSatang).toBe(500);
    expect(result.unknownCount).toBe(2);
    expect(JSON.stringify(original)).toBe(serializedBefore);
  });

  it('keeps imports provided until review, then activates a surcharge with exact proof and surface delta', () => {
    const owner = context('owner', 'owner-1');
    let state = invoiceState(createDomain('invoice', owner));
    const original = JSON.stringify(state);
    state = invoiceState(step(state, 'invoice.import', {
      artifact: {
        id: 'remote-addendum', filename: 'remote-addendum.txt', kind: 'rate-card', status: 'provided',
        sha256: 'a'.repeat(64), pages: [{ number: 1, text: 'Bangkok remote service surcharge: 750 satang from 2026-10-20.' }],
        excerpt: 'Remote surcharge of 750 satang effective 2026-10-20.', createdAt: owner.now,
      },
    }, owner));
    expect(state.sources.find((source) => source.id === 'remote-addendum')?.status).toBe('provided');
    expect(state.candidate).toBeNull();
    expect(JSON.stringify(invoiceState(createDomain('invoice', owner)))).toBe(original);

    state = invoiceState(step(state, 'invoice.reviewSource', { sourceId: 'remote-addendum', status: 'verified' }, owner));
    const change = {
      kind: 'invoice',
      operations: [{ op: 'setSurcharge', id: 'bangkok-remote-750', zone: 'bangkok', amountSatang: 750, from: '2026-10-20', to: null, sourceId: 'remote-addendum' }],
    };
    state = invoiceState(step(state, 'evolve.propose', { change }, owner));
    expect(reconcileInvoice(state).rows.find((row) => row.shipmentId === 'S-BKK-REMOTE-1100')?.expectedSatang).toBeNull();
    state = invoiceState(step(state, 'evolve.simulate', {}, owner));
    const simulation = state.candidate?.simulation;
    expect(JSON.stringify(simulation?.before)).toContain('missing_or_ambiguous_remote_surcharge');
    expect(JSON.stringify(simulation?.after)).toContain('surchargeSatang');
    expect(JSON.stringify(simulation?.after)).toContain('5250');
    expect(state.rules.some((rule) => rule.id === 'bangkok-remote-750')).toBe(false);

    state = invoiceState(step(state, 'evolve.validate', {}, owner));
    expect(state.candidate?.proof?.passed).toBe(true);
    expect(() => step(state, 'evolve.activate', {}, owner)).toThrowError(DomainError);
    state = invoiceState(step(state, 'evolve.approve', {}, owner));
    state = invoiceState(step(state, 'evolve.activate', {}, owner));
    const surchargeRow = reconcileInvoice(state).rows.find((row) => row.shipmentId === 'S-BKK-REMOTE-1100');
    expect(state.ruleRevision).toBe(1);
    expect(surchargeRow?.expectedSatang).toBe(5_250);
    expect(surchargeRow?.deltaSatang).toBe(750);
    expect(state.revisions.at(-1)?.snapshot.kind).toBe('invoice');

    state = invoiceState(step(state, 'evolve.rollback', { revision: 0 }, owner));
    state = invoiceState(step(state, 'evolve.simulate', {}, owner));
    state = invoiceState(step(state, 'evolve.validate', {}, owner));
    state = invoiceState(step(state, 'evolve.approve', {}, owner));
    state = invoiceState(step(state, 'evolve.activate', {}, owner));
    expect(state.ruleRevision).toBe(2);
    expect(reconcileInvoice(state).rows.find((row) => row.shipmentId === 'S-BKK-REMOTE-1100')?.expectedSatang).toBeNull();
    expect(state.revisions.at(-1)?.snapshot.kind).toBe('invoice');
  });

  it('blocks overlapping invoice rules and retains unresolved duplicate and unmatched rows', () => {
    const owner = context('owner', 'owner-1');
    const base = invoiceState(createDomain('invoice', owner));
    const duplicated = structuredClone(base);
    const first = duplicated.shipments[0];
    if (!first) throw new Error('Missing fixture row.');
    duplicated.shipments.push({ ...first, row: 6 });
    duplicated.shipments.push({ id: 'S-MISSING-WEIGHT', zone: 'bangkok', date: '2026-10-15', weightGram: null, remote: false, sourceId: first.sourceId, row: 7 });
    duplicated.invoiceLines.push({ id: 'ORPHAN', billedSatang: 100, currency: 'USD', sourceId: duplicated.invoiceLines[0].sourceId, row: 8 });
    const result = reconcileInvoice(duplicated);
    expect(result.rows.filter((row) => row.shipmentId === first.id).every((row) => row.reasons.includes('duplicate_shipment_id') && row.deltaSatang === null)).toBe(true);
    expect(result.rows.find((row) => row.shipmentId === 'S-MISSING-WEIGHT')?.reasons).toContain('missing_weight');
    expect(result.rows.find((row) => row.shipmentId === 'ORPHAN')?.reasons).toEqual(['unmatched_invoice_line', 'unsupported_currency']);

    let candidate = step(base, 'evolve.propose', { change: {
      kind: 'invoice', operations: [{ op: 'setZoneBase', id: 'base-bangkok-from-15', zone: 'bangkok', amountSatang: 3700, from: '2026-10-14', to: null, sourceId: 'sample_rate_card' }],
    } }, owner);
    candidate = step(candidate, 'evolve.simulate', {}, owner);
    candidate = step(candidate, 'evolve.validate', {}, owner);
    expect(candidate.candidate?.proof?.passed).toBe(false);
    expect(candidate.candidate?.simulation?.checks.some((check) => check.id === 'domain-invariants' && !check.passed)).toBe(true);
    expect(invoiceState(candidate).rules.find((rule) => rule.id === 'base-bangkok-from-15')?.amountSatang).toBe(3500);
  });

  it('keeps source status separate from review and retains prior runs when loading another sample', () => {
    const owner = context('owner', 'owner-1');
    let state = invoiceState(createDomain('invoice', owner));
    state = invoiceState(step(state, 'invoice.saveRun', {}, owner));
    const priorRun = state.runs[0];
    expect(priorRun).toBeDefined();
    state = invoiceState(step(state, 'invoice.sample', {}, { ...owner, now: owner.now + 1 }));
    expect(state.runs).toHaveLength(1);
    expect(state.runs[0]?.id).toBe(priorRun?.id);
    expect(state.dataRevision).toBe(2);
    expect(new Set(state.sources.map((source) => source.id)).size).toBe(state.sources.length);
    expect(state.rules.some((rule) => rule.id === 'started-kg-step')).toBe(true);

    const nextOwner = { ...owner, now: owner.now + 2 };
    state = invoiceState(step(state, 'invoice.import', {
      artifact: {
        id: 'new-shipments', filename: 'new-shipments.csv', kind: 'shipments', status: 'provided',
        sha256: 'b'.repeat(64), pages: [], excerpt: 'Shipment rows awaiting review.', createdAt: nextOwner.now,
      },
      shipments: [{ id: 'ALT-1', zone: 'bangkok', date: '2026-10-15', weightGram: 1000, remote: false, sourceId: 'new-shipments', row: 9 }],
    }, nextOwner));
    expect(state.sources.find((source) => source.id === 'new-shipments')?.status).toBe('provided');
    expect(state.shipments.at(-1)?.row).toBe(9);
    state = invoiceState(step(state, 'invoice.reviewSource', { sourceId: 'new-shipments', status: 'verified' }, { ...nextOwner, now: nextOwner.now + 1 }));
    expect(state.sources.find((source) => source.id === 'new-shipments')?.reviewedBy).toBe(owner.actorId);
  });

  it('uses bounded analytic physics, rejects stale learner answers, and projects only the learner own answer', () => {
    const teacher = context('teacher', 'teacher-1');
    const learner1 = context('learner', 'learner-1-actor', 'learner-1');
    const learner2 = context('learner', 'learner-2-actor', 'learner-2');
    expect(calculatePhysics({ force: 10, mass: 2, time: 2 })).toEqual({ acceleration: 5, velocity: 10, position: 10 });
    expect(calculatePhysics({ force: 10, mass: 5, time: 2 })).toEqual({ acceleration: 2, velocity: 4, position: 4 });
    expect(() => calculatePhysics({ force: 10, mass: 0, time: 2 })).toThrowError(DomainError);

    let state = teachingState(createDomain('teaching', teacher));
    const oldQuestionId = state.questionId;
    state = teachingState(step(state, 'teaching.setParameters', { force: 10, mass: 5, time: 2 }, teacher));
    expect(state.ruleRevision).toBe(1);
    expect(state.questionId).not.toBe(oldQuestionId);
    expect(() => step(state, 'teaching.answer', { questionId: oldQuestionId, lessonRevision: 0, value: 10 }, learner1)).toThrowError(DomainError);
    state = teachingState(step(state, 'teaching.answer', { questionId: state.questionId, lessonRevision: 1, value: 4 }, learner1));
    state = teachingState(step(state, 'teaching.answer', { questionId: state.questionId, lessonRevision: 1, value: 8 }, learner2));
    state = teachingState(step(state, 'teaching.saveNote', { text: 'private teacher note' }, teacher));
    state = teachingState(step(state, 'teaching.setRepresentation', { actorId: 'learner-2-actor', representation: 'graph', difficulty: 'advanced' }, teacher));
    expect(state.representations['learner-2-actor']).toBe('graph');
    const learnerView = projectDomain(state, learner1);
    expect(learnerView.kind).toBe('teaching');
    if (learnerView.kind === 'teaching') {
      expect(learnerView.answers.map((answer) => answer.actorId)).toEqual(['learner-1-actor']);
      expect(learnerView.answers[0]?.name).toBe('Name learner-1-actor');
      expect('teacherNote' in learnerView).toBe(false);
      expect(learnerView.candidate).toBeNull();
    }
    expect(() => projectDomain(state, context('owner', 'not-a-teacher'))).toThrowError(DomainError);
  });

  it('rejects stale and forged evolution proofs and expired approval, while rollback creates a new revision', () => {
    const teacher = context('teacher', 'teacher-1');
    const change = { kind: 'teaching', parameters: { force: 10, mass: 5, time: 2 } };
    let state = teachingState(createDomain('teaching', teacher));
    state = teachingState(step(state, 'evolve.propose', { change }, teacher));
    state = teachingState(step(state, 'evolve.simulate', {}, teacher));
    state = teachingState(step(state, 'evolve.validate', {}, teacher));
    const forged = structuredClone(state);
    if (forged.candidate?.proof) forged.candidate.proof.hash = 'forged';
    expect(() => step(forged, 'evolve.approve', {}, teacher)).toThrowError(DomainError);

    state = teachingState(step(state, 'evolve.approve', {}, teacher));
    const changed = teachingState(step(state, 'teaching.setParameters', { force: 8, mass: 4, time: 2 }, teacher));
    expect(() => step(changed, 'evolve.activate', {}, teacher)).toThrowError(DomainError);
    expect(changed.parameters).toEqual({ force: 8, mass: 4, time: 2 });

    let rollbackBase = teachingState(createDomain('teaching', teacher));
    rollbackBase = teachingState(step(rollbackBase, 'teaching.setParameters', { force: 10, mass: 5, time: 2 }, teacher));
    rollbackBase = teachingState(step(rollbackBase, 'evolve.rollback', { revision: 0 }, teacher));
    rollbackBase = teachingState(step(rollbackBase, 'evolve.simulate', {}, teacher));
    rollbackBase = teachingState(step(rollbackBase, 'evolve.validate', {}, teacher));
    rollbackBase = teachingState(step(rollbackBase, 'evolve.approve', {}, teacher));
    const approved = rollbackBase;
    const expiredTeacher = { ...teacher, now: (approved.candidate?.approval?.expiresAt ?? teacher.now) };
    expect(() => step(approved, 'evolve.activate', {}, expiredTeacher)).toThrowError(DomainError);
    rollbackBase = teachingState(step(rollbackBase, 'evolve.activate', {}, teacher));
    expect(rollbackBase.ruleRevision).toBe(2);
    expect(rollbackBase.parameters).toEqual({ force: 10, mass: 2, time: 2 });
    expect(rollbackBase.revisions.at(-1)?.revision).toBe(2);
  });

  it('revalidates encounter shields, commits deterministic damage, resets AP on own turns, and hides DM state', () => {
    const baseNow = 1_800_000_000_000;
    const dm = context('dm', 'dm-1', undefined, baseNow);
    const mira = context('player', 'mira-actor', 'mira', baseNow + 15);
    let state = encounterState(createDomain('encounter', dm));
    const actor = (offset: number) => ({ ...dm, now: baseNow + offset });

    state = encounterState(step(state, 'encounter.declareHit', { target: 'pip' }, actor(10)));
    expect(() => step(state, 'encounter.shield', { target: 'pip' }, mira)).toThrowError(DomainError);
    state = encounterState(step(state, 'encounter.resolve', {}, actor(11)));
    expect(state.characters.find((character) => character.id === 'pip')?.hp).toBe(6);

    state = encounterState(evolve(state, { kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } }, dm));
    expect(JSON.stringify(state.candidate?.simulation?.before)).toContain('"hpAfter":6');
    expect(JSON.stringify(state.candidate?.simulation?.after)).toContain('"hpAfter":8');
    const active = state.candidate;
    expect(active?.status).toBe('active');
    expect(state.revisions.at(-1)?.snapshot.kind).toBe('encounter');

    state = encounterState(step(state, 'encounter.endTurn', {}, actor(12)));
    state = encounterState(step(state, 'encounter.endTurn', {}, mira));
    state = encounterState(step(state, 'encounter.endTurn', {}, context('player', 'pip-actor', 'pip', baseNow + 13)));
    state = encounterState(step(state, 'encounter.declareHit', { target: 'pip' }, actor(14)));
    state = encounterState(step(state, 'encounter.saveNote', { text: 'secret dm phrase' }, actor(15)));
    const actualRoll = state.pendingHit?.roll;
    const playerView = projectDomain(state, mira);
    expect(JSON.stringify(playerView)).not.toContain('secret dm phrase');
    expect(JSON.stringify(playerView)).not.toContain('"id":"goblin"');
    expect(JSON.stringify(playerView)).not.toContain(String(state.seed));
    if (playerView.kind === 'encounter') {
      expect(playerView.seed).toBe(0);
      expect(playerView.characters.some((character) => character.id === 'goblin')).toBe(false);
      expect(playerView.pendingHit?.roll).toBeNull();
      expect(playerView.pendingHit?.damage).toBeNull();
    }
    expect(actualRoll).toBeGreaterThanOrEqual(1);
    expect(actualRoll).toBeLessThanOrEqual(20);
    state = encounterState(step(state, 'encounter.shield', { target: 'pip' }, mira));
    state = encounterState(step(state, 'encounter.resolve', {}, actor(16)));
    expect(state.characters.find((character) => character.id === 'pip')?.hp).toBe(4);
    expect(state.characters.find((character) => character.id === 'mira')?.ap).toBe(1);

    state = encounterState(step(state, 'encounter.endTurn', {}, actor(17)));
    expect(state.turn).toBe('mira');
    expect(state.characters.find((character) => character.id === 'mira')?.ap).toBe(2);
    expect(state.characters.find((character) => character.id === 'mira')?.turnGeneration).toBe(2);
    expect(state.characters.find((character) => character.id === 'mira')?.shieldUsedGeneration).toBeNull();
    expect(() => step(state, 'encounter.endTurn', {}, context('player', 'pip-actor', 'pip', baseNow + 18))).toThrowError(DomainError);
  });

  it('rechecks an open shield intent when a new encounter rule activates and uses a repeatable seed', () => {
    const baseNow = 1_800_000_000_000;
    const dm = context('dm', 'dm-1', undefined, baseNow);
    const mira = context('player', 'mira-actor', 'mira', baseNow + 2);
    let state = encounterState(createDomain('encounter', dm));
    const repeat = encounterState(createDomain('encounter', dm));
    const actor = (offset: number) => ({ ...dm, now: baseNow + offset });

    state = encounterState(evolve(state, { kind: 'encounter', rule: { allyTarget: true, apCost: 0, oncePerTurn: false } }, dm));
    state = encounterState(step(state, 'encounter.declareHit', { target: 'pip' }, actor(1)));
    const sameSeedOutcome = encounterState(step(repeat, 'encounter.declareHit', { target: 'pip' }, actor(1)));
    expect(state.pendingHit?.roll).toBe(sameSeedOutcome.pendingHit?.roll);
    state = encounterState(step(state, 'encounter.shield', { target: 'pip' }, mira));
    expect(state.pendingHit?.shields).toHaveLength(1);

    state = encounterState(evolve(state, { kind: 'encounter', rule: { allyTarget: false, apCost: 0, oncePerTurn: false } }, actor(3)));
    expect(state.pendingHit?.shields).toHaveLength(0);
    expect(state.characters.find((character) => character.id === 'mira')?.ap).toBe(2);
    state = encounterState(step(state, 'encounter.resolve', {}, actor(4)));
    expect(state.characters.find((character) => character.id === 'pip')?.hp).toBe(6);
  });

  it('rejects unknown keys, unsafe amounts, and commands from the wrong role', () => {
    const owner = context('owner', 'owner-1');
    const teacher = context('teacher', 'teacher-1');
    const state = invoiceState(createDomain('invoice', owner));
    expect(() => step(state, 'invoice.saveRun', { extra: true }, owner)).toThrowError(DomainError);
    expect(() => step(state, 'invoice.saveRun', {}, teacher)).toThrowError(DomainError);
    expect(() => step(state, 'evolve.propose', { extra: true, change: { kind: 'invoice', operations: [] } }, owner)).toThrowError(DomainError);
    expect(() => step(state, 'evolve.propose', { change: {
      kind: 'invoice', operations: [{ op: 'setWeightStep', id: 'bad-step', zone: '*', amountSatang: -1, from: '2026-01-01', to: null, sourceId: 'sample_rate_card' }],
    } }, owner)).toThrowError(DomainError);
    const dm = context('dm', 'dm-1');
    const encounter = encounterState(createDomain('encounter', dm));
    expect(() => step(encounter, 'encounter.declareHit', { target: 'pip', roll: 20 }, dm)).toThrowError(DomainError);
  });
});
