import { afterEach, describe, expect, it, vi } from 'vitest';
import * as domain from '../domain';
import { DomainError, type EncounterState, type InvoiceState, type TeachingState } from '../shared/contracts';
import { calculatePhysics, reconcileInvoice } from '../domain';
import { PRACTICE_SAMPLE_FILES } from './sample-files';
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
  return value;
}

async function runEveryStep(runtime: PracticeRuntime): Promise<void> {
  const stepCount = runtime.getSnapshot().scenario.steps.length - runtime.getSnapshot().stepIndex;
  for (let index = 0; index < stepCount; index += 1) await runtime.next();
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('public practice runtime', () => {
  it('starts with a genuinely empty invoice Canvas and imports sample rows through invoice.import', async () => {
    const runtime = new PracticeRuntime('invoice-rules');
    const initial = runtime.getSnapshot();
    expect(runtime.getSnapshot()).toBe(initial);
    expect(initial.visibleNodeIds).toEqual([]);
    expect(initial.files).toEqual([]);
    expect(invoiceView(runtime)).toMatchObject({ shipments: [], invoiceLines: [], sources: [], rules: [], runs: [] });

    await runtime.next();
    const imported = runtime.getSnapshot();
    const state = invoiceView(runtime);
    expect(imported.stepIndex).toBe(1);
    expect(imported.files).toHaveLength(1);
    expect(imported.files[0]).toMatchObject({ filename: 'october-shipments.csv', kind: 'invoice', fileKind: 'shipments' });
    expect(imported.files[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(imported.visibleNodeIds).toEqual(['practice.files', 'invoice.source']);
    expect(imported.focusNodeId).toBe('practice.files');
    expect(state.shipments).toHaveLength(4);
    expect(state.invoiceLines).toHaveLength(0);
    expect(state.sources[0]).toMatchObject({ status: 'provided', kind: 'shipments', filename: 'october-shipments.csv' });
    runtime.dispose();
  });

  it('runs the invoice files and dated rule through review, approval, activation and saved reconciliation', async () => {
    const runtime = new PracticeRuntime('invoice-rules');
    await runEveryStep(runtime);

    const snapshot = runtime.getSnapshot();
    const state = invoiceView(runtime);
    const result = reconcileInvoice(state);
    const movedBoundary = state.rules.find((rule) => rule.kind === 'base' && rule.zone === 'bangkok' && rule.from === '2026-10-14');
    const affectedLine = result.rows.find((row) => row.shipmentId === 'S-BKK-1000');

    expect(snapshot.mode).toBe('complete');
    expect(snapshot.stepIndex).toBe(PRACTICE_SCENARIOS[0].steps.length);
    expect(state.ruleRevision).toBe(1);
    expect(movedBoundary?.from).toBe('2026-10-14');
    expect(affectedLine).toMatchObject({ expectedSatang: 3_500, deltaSatang: 500 });
    expect(result.knownExpectedSatang).toBe(8_000);
    expect(result.unknownCount).toBe(2);
    expect(state.runs).toHaveLength(1);
    expect(snapshot.history).toHaveLength(snapshot.stepIndex);
    expect(snapshot.history.every((event) => event.outcome === 'applied')).toBe(true);
    expect(snapshot.visibleNodeIds).toContain('invoice.rules');
    expect(snapshot.visibleNodeIds).toContain('workspace.history');
    expect(snapshot.view.revision).toBe(`practice-${snapshot.view.epoch}-${snapshot.scenario.steps.length}`);
    expect(runtime.exportHistory()).toContain('currentView');
    runtime.dispose();
  });

  it('imports a local file into the same reducers and rejects malformed files without data mutation', async () => {
    const runtime = new PracticeRuntime('invoice-rules');
    const imported = await runtime.ingestFile(PRACTICE_SAMPLE_FILES[0].filename, PRACTICE_SAMPLE_FILES[0].text);
    expect(imported?.domain.kind).toBe('invoice');
    expect(invoiceView(runtime).shipments).toHaveLength(4);
    const before = structuredClone(invoiceView(runtime));

    const rejected = await runtime.ingestFile('bad.csv', 'nope\n');
    expect(rejected).toBeNull();
    expect(invoiceView(runtime)).toEqual(before);
    expect(runtime.getSnapshot().history.at(-1)).toMatchObject({ outcome: 'rejected', type: 'practice.ingestFile' });
    runtime.dispose();
  });

  it('updates the shared lesson, records separate answers, and applies role projections', async () => {
    const runtime = new PracticeRuntime('teaching-physics');
    await runEveryStep(runtime);

    const completed = runtime.getSnapshot();
    expect(completed.mode).toBe('complete');
    expect(teachingView(runtime).parameters).toEqual({ force: 10, mass: 5, time: 2 });
    expect(completed.history.find((event) => event.type === 'teaching.setParameters' && event.outcome === 'rejected')).toBeDefined();
    expect(completed.visibleNodeIds).toContain('lesson.question');
    expect(completed.visibleNodeIds).toContain('lesson.rules');
    expect(completed.visibleNodeIds).toContain('workspace.history');
    expect(teachingView(runtime).answers.map((answer) => answer.actorId)).toEqual(['practice-learner-1', 'practice-learner-2']);

    runtime.selectActor('practice-teacher');
    expect(runtime.getSnapshot().mode).toBe('manual');
    expect(teachingView(runtime).teacherNote).toBe('คำตอบอ้างอิง: 4 เมตร');

    runtime.selectActor('practice-learner-1');
    const learner = teachingView(runtime);
    expect(learner.answers.map((answer) => answer.actorId)).toEqual(['practice-learner-1']);
    expect(learner.representations).toEqual({ 'practice-learner-1': 'graph' });
    expect('teacherNote' in learner).toBe(false);
    runtime.dispose();
  });

  it('supports staged manual physics edits and learner answers through the same domain reducer', async () => {
    const runtime = new PracticeRuntime('teaching-physics');
    await runtime.next();
    runtime.takeOver();
    expect(runtime.addObject('lesson.rules')).toBe(true);

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

  it('evolves the encounter shield from the imported plan and resolves the hit with the domain state', async () => {
    const runtime = new PracticeRuntime('encounter-shield');
    await runEveryStep(runtime);

    const completed = runtime.getSnapshot();
    const state = encounterView(runtime);
    expect(completed.mode).toBe('complete');
    expect(state.ruleRevision).toBe(1);
    expect(state.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
    expect(state.phase).toBe('action.resolved');
    expect(state.pendingHit).toBeNull();
    expect(state.characters.find((character) => character.id === 'pip')?.hp).toBe(8);
    expect(state.characters.find((character) => character.id === 'mira')?.ap).toBe(1);
    expect(completed.history.find((event) => event.actor === 'Mira' && event.type === 'encounter.shield')?.outcome).toBe('applied');
    expect(completed.visibleNodeIds).toContain('workspace.history');

    const advanced = await runtime.command('encounter.endTurn', {});
    expect(advanced?.domain.kind).toBe('encounter');
    expect(encounterView(runtime).turn).toBe('mira');
    runtime.dispose();
  });

  it('stops on an unexpected reducer rejection without committing state or accepting more scripted steps', async () => {
    const runtime = new PracticeRuntime('invoice-rules');
    const initialState = structuredClone(invoiceView(runtime));
    vi.spyOn(domain, 'decideDomain').mockImplementationOnce(() => {
      throw new DomainError('PRACTICE_TEST_REJECTION', 'controlled reducer failure');
    });

    await runtime.next();

    const blocked = runtime.getSnapshot();
    expect(blocked.mode).toBe('blocked');
    expect(blocked.stepIndex).toBe(0);
    expect(blocked.history).toHaveLength(1);
    expect(blocked.history[0]).toMatchObject({ outcome: 'rejected', step: 1 });
    expect(invoiceView(runtime)).toEqual(initialState);
    await runtime.next();
    expect(runtime.getSnapshot().stepIndex).toBe(0);
    expect(invoiceView(runtime)).toEqual(initialState);
    runtime.dispose();
  });

  it('exports a bounded all-role transcript with aligned events and commands plus the selected projection', async () => {
    const runtime = new PracticeRuntime('teaching-physics');
    const commandCount = 204;
    const historyLimit = 200;

    for (let index = 0; index < commandCount; index += 1) {
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

  it('cancels queued playback and in-flight imports on pause, actor takeover, restart and dispose', async () => {
    vi.useFakeTimers();
    vi.spyOn(globalThis.crypto.subtle, 'digest').mockResolvedValue(new ArrayBuffer(32));
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
    await vi.advanceTimersByTimeAsync(PRACTICE_REPLAY_INTERVAL_MS);
    expect(runtime.getSnapshot().stepIndex).toBe(1);
    runtime.selectActor('practice-learner-1');
    const takenOver = runtime.getSnapshot();
    const callsAtTakeover = listener.mock.calls.length;
    expect(takenOver.mode).toBe('manual');
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS * 2);
    expect(runtime.getSnapshot()).toBe(takenOver);
    expect(listener).toHaveBeenCalledTimes(callsAtTakeover);
    await runtime.next();
    expect(runtime.getSnapshot().stepIndex).toBe(1);
    expect(runtime.getSnapshot().mode).toBe('manual');

    const inFlight = runtime.ingestFile('shared-physics-lesson.json', PRACTICE_SAMPLE_FILES[3].text);
    runtime.restart('invoice-rules');
    expect(await inFlight).toBeNull();
    const restarted = runtime.getSnapshot();
    expect(restarted.mode).toBe('ready');
    expect(restarted.stepIndex).toBe(0);
    expect(restarted.history).toHaveLength(0);
    expect(restarted.files).toHaveLength(0);
    expect(restarted.visibleNodeIds).toEqual([]);
    expect(restarted.view.kind).toBe('invoice');
    expect(invoiceView(runtime).shipments).toHaveLength(0);
    expect(restarted.view.epoch).toBe(takenOver.view.epoch + 1);
    expect(restarted.view.id).not.toBe(takenOver.view.id);

    runtime.play();
    const disposing = runtime.getSnapshot();
    runtime.dispose();
    vi.advanceTimersByTime(PRACTICE_REPLAY_INTERVAL_MS * 2);
    expect(runtime.getSnapshot()).toBe(disposing);
  });
});
