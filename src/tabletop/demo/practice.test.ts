import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../domain';
import { DomainError, type EncounterState, type InvoiceState, type TeachingState } from '../shared/contracts';
import { calculatePhysics, reconcileInvoice } from '../domain';
import { PracticeRuntime, PRACTICE_REPLAY_INTERVAL_MS } from './practice';
import { PRACTICE_SCENARIOS } from './scenarios';

function invoiceView(runtime: PracticeRuntime): InvoiceState {
  const state = runtime.getSnapshot().view.domain;
  if (state.kind !== 'invoice') throw new Error('Expected an invoice practice view.');
  return state;
}

function teachingView(runtime: PracticeRuntime): TeachingState {
  const state = runtime.getSnapshot().view.domain;
  if (state.kind !== 'teaching') throw new Error('Expected a teaching practice view.');
  return state;
}

function encounterView(runtime: PracticeRuntime): EncounterState {
  const state = runtime.getSnapshot().view.domain;
  if (state.kind !== 'encounter') throw new Error('Expected an encounter practice view.');
  return state;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('Expected an object in the exported practice transcript.');
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error('Expected an array in the exported practice transcript.');
  return value as unknown[];
}

function runEveryStep(runtime: PracticeRuntime): void {
  const snapshot = runtime.getSnapshot();
  const stepCount = snapshot.scenario.steps.length - snapshot.stepIndex;
  for (let index = 0; index < stepCount; index += 1) runtime.next();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('public practice runtime', () => {
  it('runs the dated invoice rule through simulation, validation, approval, activation and a saved reconciliation', () => {
    const runtime = new PracticeRuntime('invoice-rules');
    const initialSnapshot = runtime.getSnapshot();

    expect(runtime.getSnapshot()).toBe(initialSnapshot);
    expect(initialSnapshot.view.members.map((member) => member.actorId)).toEqual(['practice-owner']);

    runEveryStep(runtime);

    const snapshot = runtime.getSnapshot();
    const state = invoiceView(runtime);
    const result = reconcileInvoice(state);
    const movedBoundary = state.rules.find((rule) => rule.id === 'base-bangkok-from-15');
    const affectedLine = result.rows.find((row) => row.shipmentId === 'S-BKK-1000');

    expect(snapshot.mode).toBe('complete');
    expect(snapshot.stepIndex).toBe(PRACTICE_SCENARIOS[0].steps.length);
    expect(state.ruleRevision).toBe(1);
    expect(movedBoundary?.from).toBe('2026-10-14');
    expect(affectedLine).toMatchObject({ expectedSatang: 3_500, deltaSatang: 500 });
    expect(result.knownExpectedSatang).toBe(8_000);
    expect(result.unknownCount).toBe(2);
    expect(state.runs).toHaveLength(1);
    expect(snapshot.history.every((event) => event.outcome === 'applied')).toBe(true);
    expect(snapshot.view.revision).toBe(`practice-${snapshot.view.epoch}-${PRACTICE_SCENARIOS[0].steps.length}`);
    expect(runtime.exportHistory()).toContain('currentView');
    runtime.dispose();
  });

  it('updates the shared physics lesson, records separate answers, and applies role projections', () => {
    const runtime = new PracticeRuntime('teaching-physics');

    runtime.next();
    expect(runtime.getSnapshot().mode).toBe('paused');
    expect(runtime.getSnapshot().stepIndex).toBe(1);
    expect(calculatePhysics(teachingView(runtime).parameters).position).toBe(4);
    expect(runtime.getSnapshot().view.members.map((member) => member.actorId)).toEqual([
      'practice-teacher', 'practice-learner-1', 'practice-learner-2',
    ]);

    runEveryStep(runtime);

    const completed = runtime.getSnapshot();
    expect(completed.mode).toBe('complete');
    expect(completed.history.at(-1)).toMatchObject({ outcome: 'rejected', type: 'teaching.setParameters' });
    expect(completed.view.actor.actorId).toBe('practice-learner-2');
    expect(teachingView(runtime).answers.map((answer) => answer.actorId)).toEqual(['practice-learner-2']);
    expect('teacherNote' in teachingView(runtime)).toBe(false);

    runtime.selectActor('practice-teacher');
    expect(runtime.getSnapshot().mode).toBe('manual');
    expect(teachingView(runtime).answers.map((answer) => answer.actorId)).toEqual([
      'practice-learner-1', 'practice-learner-2',
    ]);
    expect(teachingView(runtime).teacherNote).toBe('คำตอบอ้างอิง: 4 เมตร');

    runtime.selectActor('practice-learner-1');
    const learner = teachingView(runtime);
    expect(learner.answers.map((answer) => answer.actorId)).toEqual(['practice-learner-1']);
    expect(learner.representations).toEqual({ 'practice-learner-1': 'graph' });
    expect('teacherNote' in learner).toBe(false);
    runtime.dispose();
  });

  it('supports manual lesson edits and answers through the same reducer while preserving role denial', async () => {
    const runtime = new PracticeRuntime('teaching-physics');
    runtime.next();
    runtime.takeOver();

    const edited = await runtime.command('teaching.setParameters', { force: 12, mass: 3, time: 2 });
    expect(edited?.domain.kind).toBe('teaching');
    expect(calculatePhysics(teachingView(runtime).parameters).position).toBe(8);

    runtime.selectActor('practice-learner-1');
    const learnerBeforeAnswer = teachingView(runtime);
    const answerResult = await runtime.command('teaching.answer', {
      questionId: learnerBeforeAnswer.questionId,
      lessonRevision: learnerBeforeAnswer.ruleRevision,
      value: 8,
    });
    expect(answerResult?.actor.actorId).toBe('practice-learner-1');
    expect(teachingView(runtime).answers).toHaveLength(1);

    const stateBeforeDeniedEdit = structuredClone(teachingView(runtime));
    const denied = await runtime.command('teaching.setParameters', { force: 8, mass: 4, time: 2 });
    expect(denied).toBeNull();
    expect(teachingView(runtime)).toEqual(stateBeforeDeniedEdit);
    expect(runtime.getSnapshot().history.at(-1)).toMatchObject({ outcome: 'rejected', actor: 'ฟ้า' });
    expect(runtime.getSnapshot().mode).toBe('manual');
    runtime.dispose();
  });

  it('evolves the encounter shield, resolves Mira protecting Pip, then lets the DM advance the turn', async () => {
    const runtime = new PracticeRuntime('encounter-shield');
    runEveryStep(runtime);

    const completed = runtime.getSnapshot();
    const state = encounterView(runtime);
    expect(completed.mode).toBe('complete');
    expect(state.ruleRevision).toBe(1);
    expect(state.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
    expect(state.phase).toBe('action.resolved');
    expect(state.pendingHit).toBeNull();
    expect(state.characters.find((character) => character.id === 'pip')).toMatchObject({ hp: 8, ap: 2 });
    expect(state.characters.find((character) => character.id === 'mira')).toMatchObject({ hp: 10, ap: 1 });
    expect(completed.history.find((event) => event.actor === 'Mira' && event.type === 'encounter.shield')?.outcome).toBe('applied');

    const advanced = await runtime.command('encounter.endTurn', {});
    expect(advanced?.domain.kind).toBe('encounter');
    expect(encounterView(runtime).turn).toBe('mira');
    runtime.dispose();
  });

  it('stops on an unexpected reducer rejection without committing state or accepting more scripted steps', () => {
    const runtime = new PracticeRuntime('invoice-rules');
    const initialState = structuredClone(invoiceView(runtime));
    vi.spyOn(domain, 'decideDomain').mockImplementationOnce(() => {
      throw new DomainError('PRACTICE_TEST_REJECTION', 'controlled reducer failure');
    });

    runtime.next();

    const blocked = runtime.getSnapshot();
    expect(blocked.mode).toBe('blocked');
    expect(blocked.stepIndex).toBe(0);
    expect(blocked.history).toHaveLength(1);
    expect(blocked.history[0]).toMatchObject({ outcome: 'rejected', step: 1 });
    expect(invoiceView(runtime)).toEqual(initialState);
    runtime.next();
    expect(runtime.getSnapshot().stepIndex).toBe(0);
    expect(invoiceView(runtime)).toEqual(initialState);
    runtime.dispose();
  });

  it('exports a bounded all-role transcript with aligned events and commands plus the selected projection', async () => {
    const runtime = new PracticeRuntime('teaching-physics');
    const teacherCommandCount = 204;
    const historyLimit = 200;

    for (let index = 0; index < teacherCommandCount; index += 1) {
      await runtime.command('teaching.setParameters', { force: 10, mass: 2, time: 2 });
    }
    runtime.selectActor('practice-learner-1');
    const learnerProjection = teachingView(runtime);
    await runtime.command('teaching.answer', {
      questionId: learnerProjection.questionId,
      lessonRevision: learnerProjection.ruleRevision,
      value: calculatePhysics(learnerProjection.parameters).position,
    });
    runtime.selectActor('practice-learner-2');

    const transcript: unknown = JSON.parse(runtime.exportHistory());
    const transcriptRecord = asRecord(transcript);
    const metadata = asRecord(transcriptRecord.metadata);
    const events = asArray(transcriptRecord.events);
    const commands = asArray(transcriptRecord.commands);
    const firstEvent = asRecord(events[0]);
    const lastEvent = asRecord(events.at(-1));
    const firstCommand = asRecord(commands[0]);
    const lastCommand = asRecord(commands.at(-1));
    const currentView = asRecord(transcriptRecord.currentView);

    expect(metadata).toMatchObject({
      scope: 'all-synthetic-roles-in-this-tab',
      historyLimit,
      totalEventCount: 205,
      omittedEventCount: 5,
      truncated: true,
    });
    expect(events).toHaveLength(historyLimit);
    expect(commands).toHaveLength(historyLimit);
    expect(firstEvent.id).toBe('practice-event-1-6');
    expect(firstCommand.eventId).toBe(firstEvent.id);
    expect(lastEvent.id).toBe('practice-event-1-205');
    expect(lastEvent.actor).toBe('ฟ้า');
    expect(lastCommand.eventId).toBe(lastEvent.id);
    expect(currentView).toEqual(runtime.getSnapshot().view);
    expect(asRecord(currentView.actor).actorId).toBe('practice-learner-2');
    runtime.dispose();
  });

  it('cancels queued playback on pause, actor takeover, restart and dispose', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-19T00:00:00.000Z'));
    const runtime = new PracticeRuntime('teaching-physics');
    const listener = vi.fn();
    runtime.subscribe(listener);

    runtime.play();
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS - 1);
    expect(runtime.getSnapshot().stepIndex).toBe(0);
    runtime.pause();
    const paused = runtime.getSnapshot();
    const callsAtPause = listener.mock.calls.length;
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS * 2);
    expect(runtime.getSnapshot()).toBe(paused);
    expect(listener).toHaveBeenCalledTimes(callsAtPause);

    runtime.play();
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS);
    expect(runtime.getSnapshot().stepIndex).toBe(1);
    runtime.selectActor('practice-learner-1');
    const takenOver = runtime.getSnapshot();
    const callsAtTakeover = listener.mock.calls.length;
    expect(takenOver.mode).toBe('manual');
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS * 2);
    expect(runtime.getSnapshot()).toBe(takenOver);
    expect(listener).toHaveBeenCalledTimes(callsAtTakeover);
    runtime.next();
    expect(runtime.getSnapshot().stepIndex).toBe(1);
    expect(runtime.getSnapshot().mode).toBe('manual');

    runtime.restart('invoice-rules');
    const restarted = runtime.getSnapshot();
    expect(restarted.mode).toBe('ready');
    expect(restarted.stepIndex).toBe(0);
    expect(restarted.history).toHaveLength(0);
    expect(restarted.view.kind).toBe('invoice');
    expect(restarted.view.epoch).toBe(takenOver.view.epoch + 1);
    expect(restarted.view.id).not.toBe(takenOver.view.id);

    runtime.play();
    const disposing = runtime.getSnapshot();
    runtime.dispose();
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS * 2);
    expect(runtime.getSnapshot()).toBe(disposing);
  });
});
