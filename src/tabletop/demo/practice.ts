import { DomainError, type ActorContext, type CaseKind, type DomainState, type Member, type Role, type Seat, type WorkspaceView } from '../shared/contracts';
import { createDomain, decideDomain, projectDomain } from '../domain';
import { canonicalJson } from '../domain/helpers';
import { PRACTICE_SCENARIOS, type PracticeScenario, type PracticeScenarioStep } from './scenarios';

const PRACTICE_PLAY_INTERVAL_MS = 3_200;
const PRACTICE_COMMAND_CLOCK_ADVANCE_MS = 1_000;
const PRACTICE_WORKSPACE_TTL_MS = 24 * 60 * 60 * 1_000;
const PRACTICE_HISTORY_LIMIT = 200;
const PRACTICE_EVENT_MESSAGE_LIMIT = 600;
const PRACTICE_EXPORTED_INPUT_LIMIT = 12_000;

export type PracticeMode = 'ready' | 'playing' | 'paused' | 'manual' | 'complete' | 'blocked';

export interface PracticeEvent {
  id: string;
  step?: number;
  actor: string;
  title: string;
  type: string;
  outcome: 'applied' | 'rejected';
  message: string;
}

export interface PracticeSnapshot {
  view: WorkspaceView;
  scenario: PracticeScenario;
  mode: PracticeMode;
  stepIndex: number;
  history: PracticeEvent[];
  notice: string | null;
  now: number;
}

interface ExportedPracticeCommand {
  eventId: string;
  actorId: string;
  type: string;
  outcome: PracticeEvent['outcome'];
  payload: unknown;
}

export const PRACTICE_REPLAY_INTERVAL_MS = PRACTICE_PLAY_INTERVAL_MS;

const SYNTHETIC_MEMBERS: Record<CaseKind, readonly Member[]> = {
  invoice: [
    { actorId: 'practice-owner', name: 'คุณอ้อม', role: 'owner' },
  ],
  teaching: [
    { actorId: 'practice-teacher', name: 'ครูเมย์', role: 'teacher' },
    { actorId: 'practice-learner-1', name: 'ฟ้า', role: 'learner', seat: 'learner-1' },
    { actorId: 'practice-learner-2', name: 'ต้น', role: 'learner', seat: 'learner-2' },
  ],
  encounter: [
    { actorId: 'practice-dm', name: 'DM', role: 'dm' },
    { actorId: 'practice-mira', name: 'Mira', role: 'player', seat: 'mira' },
    { actorId: 'practice-pip', name: 'Pip', role: 'player', seat: 'pip' },
  ],
};

function localPracticeHash(value: unknown): string {
  // This two-lane hash keeps browser-only practice identifiers repeatable. It is not a security proof or an auth token.
  const input = typeof value === 'string' ? value : canonicalJson(value);
  let left = 2_166_136_261;
  let right = 2_654_435_761;
  for (let index = 0; index < input.length; index += 1) {
    const unit = input.charCodeAt(index);
    left = Math.imul(left ^ unit, 16_777_619);
    right = Math.imul(right ^ (unit + index), 2_246_822_519);
  }
  const leftHex = (left >>> 0).toString(16).padStart(8, '0');
  const rightHex = (right >>> 0).toString(16).padStart(8, '0');
  return `practice-${leftHex}${rightHex}`;
}

function freezeSnapshotValue<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  if (Array.isArray(value)) {
    for (const item of value as readonly unknown[]) freezeSnapshotValue(item);
    return value;
  }
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) freezeSnapshotValue(record[key]);
  return value;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The local domain reducer rejected this command.';
  return message.length <= PRACTICE_EVENT_MESSAGE_LIMIT
    ? message
    : `${message.slice(0, PRACTICE_EVENT_MESSAGE_LIMIT - 1)}…`;
}

function exportablePayload(payload: unknown): unknown {
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined || serialized.length > PRACTICE_EXPORTED_INPUT_LIMIT) {
      return '[input omitted: it exceeded the local export limit]';
    }
    return structuredClone(payload);
  } catch {
    return '[input omitted: it could not be serialized]';
  }
}

function findScenario(scenarioId: string): PracticeScenario {
  const scenario = PRACTICE_SCENARIOS.find((item) => item.id === scenarioId);
  if (!scenario) throw new RangeError(`Unknown practice scenario: ${scenarioId}`);
  return scenario;
}

function memberForActor(members: readonly Member[], actorId: string): Member | undefined {
  return members.find((member) => member.actorId === actorId);
}

function roleSeat(member: Member): { role: Role; seat?: Seat } {
  return member.seat === undefined ? { role: member.role } : { role: member.role, seat: member.seat };
}

export class PracticeRuntime {
  private scenario: PracticeScenario;
  private members: Member[];
  private activeActorId: string;
  private domainState: DomainState;
  private projectedDomain: DomainState;
  private epoch = 0;
  private revisionCounter = 0;
  private eventSequence = 0;
  private stepIndex = 0;
  private mode: PracticeMode = 'ready';
  private history: PracticeEvent[] = [];
  private exportedCommands: ExportedPracticeCommand[] = [];
  private notice: string | null = null;
  private now: number;
  private createdAt: number;
  private disposed = false;
  private hasTakenOver = false;
  private runToken = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  private snapshot: PracticeSnapshot;

  constructor(scenarioId: string = PRACTICE_SCENARIOS[0].id) {
    this.scenario = findScenario(scenarioId);
    this.members = SYNTHETIC_MEMBERS[this.scenario.kind].map((member) => ({ ...member }));
    const firstMember = this.members[0];
    if (!firstMember) throw new Error('A practice scenario must define at least one synthetic member.');
    this.activeActorId = firstMember.actorId;
    this.now = Date.now();
    this.createdAt = this.now;
    this.epoch = 1;
    this.domainState = createDomain(this.scenario.kind, this.contextFor(firstMember, this.now));
    this.projectedDomain = projectDomain(this.domainState, this.contextFor(firstMember, this.now));
    this.snapshot = this.buildSnapshot();
  }

  getSnapshot(): PracticeSnapshot {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  play(): void {
    if (this.disposed) return;
    if (this.hasTakenOver || this.mode === 'manual') {
      this.notice = 'Manual control is active. Restart the walkthrough to play its script again.';
      this.publish();
      return;
    }
    if (this.mode === 'complete' || this.mode === 'blocked') {
      this.notice = this.mode === 'complete'
        ? 'The walkthrough is complete. Restart it to play again.'
        : 'The walkthrough stopped on an unexpected command result. Restart it to try again.';
      this.publish();
      return;
    }
    if (this.mode === 'playing') return;

    const token = this.cancelScheduledWork();
    this.mode = 'playing';
    this.notice = 'Playing the next shared-workbench step.';
    this.publish();
    if (this.isCurrentRun(token)) this.scheduleNextStep(token);
  }

  pause(): void {
    if (this.disposed || this.mode !== 'playing') return;
    this.cancelScheduledWork();
    this.mode = 'paused';
    this.notice = 'Playback paused. Use Next for one step or Play to continue.';
    this.publish();
  }

  takeOver(): void {
    if (this.disposed) return;
    this.cancelScheduledWork();
    this.hasTakenOver = true;
    this.mode = 'manual';
    this.notice = 'Manual control is active. Commands now run as the selected synthetic actor.';
    this.publish();
  }

  next(): void {
    if (this.disposed) return;
    if (this.hasTakenOver || this.mode === 'manual') {
      this.notice = 'Manual control is active. Restart the walkthrough before running scripted steps.';
      this.publish();
      return;
    }
    if (this.mode === 'complete' || this.mode === 'blocked') {
      this.notice = this.mode === 'complete'
        ? 'The walkthrough is complete. Restart it to play again.'
        : 'The walkthrough stopped on an unexpected command result. Restart it to try again.';
      this.publish();
      return;
    }

    const token = this.cancelScheduledWork();
    this.mode = 'paused';
    this.runScenarioStep(token);
  }

  restart(scenarioId?: string): void {
    if (this.disposed) return;
    const nextScenario = findScenario(scenarioId ?? this.scenario.id);
    this.cancelScheduledWork();

    this.scenario = nextScenario;
    this.members = SYNTHETIC_MEMBERS[nextScenario.kind].map((member) => ({ ...member }));
    const firstMember = this.members[0];
    if (!firstMember) throw new Error('A practice scenario must define at least one synthetic member.');
    this.activeActorId = firstMember.actorId;
    this.epoch += 1;
    this.revisionCounter = 0;
    this.eventSequence = 0;
    this.stepIndex = 0;
    this.mode = 'ready';
    this.history = [];
    this.exportedCommands = [];
    this.notice = null;
    this.hasTakenOver = false;
    this.now = Date.now();
    this.createdAt = this.now;
    this.domainState = createDomain(nextScenario.kind, this.contextFor(firstMember, this.now));
    this.projectedDomain = projectDomain(this.domainState, this.contextFor(firstMember, this.now));
    this.publish();
  }

  selectActor(actorId: string): void {
    if (this.disposed) return;
    const member = memberForActor(this.members, actorId);
    if (!member) {
      this.notice = 'That synthetic actor is not available in this walkthrough.';
      this.publish();
      return;
    }

    try {
      const projection = projectDomain(this.domainState, this.contextFor(member, this.now));
      this.cancelScheduledWork();
      this.hasTakenOver = true;
      this.mode = 'manual';
      this.activeActorId = member.actorId;
      this.projectedDomain = projection;
      this.notice = 'Manual control is active. The workbench now shows this actor\'s projection.';
    } catch (error) {
      this.notice = errorMessage(error);
    }
    this.publish();
  }

  async command(type: string, payload: unknown): Promise<WorkspaceView | null> {
    if (this.disposed) return null;
    this.cancelScheduledWork();
    this.hasTakenOver = true;
    this.mode = 'manual';
    const member = memberForActor(this.members, this.activeActorId);
    if (!member) {
      this.notice = 'The selected synthetic actor is unavailable.';
      this.publish();
      return null;
    }

    const context = this.contextFor(member, this.now);
    try {
      const decision = decideDomain(this.domainState, { type, payload }, context);
      const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
      const nextProjection = projectDomain(decision.state, this.contextFor(member, nextNow));
      this.domainState = decision.state;
      this.revisionCounter += 1;
      this.now = nextNow;
      this.projectedDomain = nextProjection;
      this.addHistoryEvent({ actor: member.name, actorId: member.actorId, payload, title: type, type, outcome: 'applied', message: decision.label });
      this.notice = decision.label;
      this.publish();
      return this.snapshot.view;
    } catch (error) {
      const message = errorMessage(error);
      const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
      try {
        const nextProjection = projectDomain(this.domainState, this.contextFor(member, nextNow));
        this.now = nextNow;
        this.projectedDomain = nextProjection;
      } catch (projectionError) {
        this.notice = errorMessage(projectionError);
        this.addHistoryEvent({ actor: member.name, actorId: member.actorId, payload, title: type, type, outcome: 'rejected', message: this.notice });
        this.publish();
        return null;
      }
      this.addHistoryEvent({ actor: member.name, actorId: member.actorId, payload, title: type, outcome: 'rejected', message, type });
      this.notice = message;
      this.publish();
      return null;
    }
  }

  exportHistory(): string {
    const omittedEventCount = Math.max(0, this.eventSequence - this.history.length);
    return JSON.stringify({
      format: 'tabletop-practice-history-v1',
      scenarioId: this.scenario.id,
      metadata: {
        scope: 'all-synthetic-roles-in-this-tab',
        historyLimit: PRACTICE_HISTORY_LIMIT,
        totalEventCount: this.eventSequence,
        omittedEventCount,
        truncated: omittedEventCount > 0,
      },
      events: this.history,
      commands: this.exportedCommands,
      currentView: this.snapshot.view,
    }, null, 2);
  }

  dispose(): void {
    if (this.disposed) return;
    this.cancelScheduledWork();
    this.disposed = true;
    this.listeners.clear();
  }

  private contextFor(member: Member, now: number): ActorContext {
    const seat = roleSeat(member);
    return {
      actorId: member.actorId,
      name: member.name,
      role: seat.role,
      ...(seat.seat === undefined ? {} : { seat: seat.seat }),
      workspaceId: `practice-${this.scenario.id}-${this.epoch}`,
      epoch: this.epoch,
      now,
      hash: localPracticeHash,
    };
  }

  private buildSnapshot(): PracticeSnapshot {
    const actor = memberForActor(this.members, this.activeActorId);
    if (!actor) throw new Error('The active synthetic actor is unavailable.');
    const workspaceId = `practice-${this.scenario.id}-${this.epoch}`;
    const view: WorkspaceView = {
      id: workspaceId,
      title: this.scenario.title,
      kind: this.scenario.kind,
      epoch: this.epoch,
      revision: `practice-${this.epoch}-${this.revisionCounter}`,
      actor: { ...actor },
      members: this.members.map((member) => ({ ...member })),
      domain: this.projectedDomain,
      createdAt: this.createdAt,
      expiresAt: this.createdAt + PRACTICE_WORKSPACE_TTL_MS,
    };
    return freezeSnapshotValue({
      view,
      scenario: this.scenario,
      mode: this.mode,
      stepIndex: this.stepIndex,
      history: this.history.slice(),
      notice: this.notice,
      now: this.now,
    });
  }

  private publish(): void {
    if (this.disposed) return;
    this.snapshot = this.buildSnapshot();
    for (const listener of this.listeners) listener();
  }

  private addHistoryEvent(event: Omit<PracticeEvent, 'id' | 'step'> & {
    step?: number;
    actorId: string;
    payload: unknown;
  }): void {
    this.eventSequence += 1;
    const entry: PracticeEvent = {
      id: `practice-event-${this.epoch}-${this.eventSequence}`,
      ...(event.step === undefined ? {} : { step: event.step }),
      actor: event.actor,
      title: event.title,
      type: event.type,
      outcome: event.outcome,
      message: event.message,
    };
    this.history.push(entry);
    this.exportedCommands.push({
      eventId: entry.id,
      actorId: event.actorId,
      type: entry.type,
      outcome: entry.outcome,
      payload: exportablePayload(event.payload),
    });
    if (this.history.length > PRACTICE_HISTORY_LIMIT) {
      const overflow = this.history.length - PRACTICE_HISTORY_LIMIT;
      this.history.splice(0, overflow);
      this.exportedCommands.splice(0, overflow);
    }
  }

  private cancelScheduledWork(): number {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.runToken += 1;
    return this.runToken;
  }

  private isCurrentRun(token: number): boolean {
    return !this.disposed && this.mode === 'playing' && token === this.runToken;
  }

  private scheduleNextStep(token: number): void {
    if (!this.isCurrentRun(token)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.isCurrentRun(token)) return;
      this.runScenarioStep(token);
      if (this.isCurrentRun(token)) this.scheduleNextStep(token);
    }, PRACTICE_PLAY_INTERVAL_MS);
  }

  private runScenarioStep(token: number): void {
    if (token !== this.runToken || this.disposed) return;
    const step: PracticeScenarioStep | undefined = this.scenario.steps[this.stepIndex];
    if (!step) {
      this.mode = 'complete';
      this.notice = 'The walkthrough is complete.';
      this.publish();
      return;
    }
    const member = memberForActor(this.members, step.actorId);
    if (!member) {
      this.blockOnUnexpectedResult(step, step.actorId, 'The scripted actor is not part of this scenario.');
      return;
    }
    this.activeActorId = member.actorId;
    const expectedOutcome = step.expectedOutcome ?? 'applied';
    const context = this.contextFor(member, this.now);
    let payload = step.command.payload;

    try {
      payload = step.command.payloadFromState?.(this.domainState) ?? step.command.payload;
      const decision = decideDomain(this.domainState, { type: step.command.type, payload }, context);
      if (expectedOutcome === 'rejected') {
        this.blockOnUnexpectedResult(step, member.actorId, 'The reducer applied a command that the script expected to reject; its result was discarded.', payload);
        return;
      }

      const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
      const nextProjection = projectDomain(decision.state, this.contextFor(member, nextNow));
      this.domainState = decision.state;
      this.revisionCounter += 1;
      this.now = nextNow;
      this.projectedDomain = nextProjection;
      this.addHistoryEvent({
        step: this.stepIndex + 1,
        actor: member.name,
        actorId: member.actorId,
        payload,
        title: step.title,
        type: step.command.type,
        outcome: 'applied',
        message: decision.label,
      });
      this.notice = decision.label;
      this.stepIndex += 1;
      if (this.stepIndex >= this.scenario.steps.length) {
        this.mode = 'complete';
        this.notice = 'The walkthrough is complete.';
      }
    } catch (error) {
      const message = errorMessage(error);
      if (expectedOutcome === 'rejected' && error instanceof DomainError && error.code === step.expectedErrorCode) {
        const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
        let nextProjection: DomainState;
        try {
          nextProjection = projectDomain(this.domainState, this.contextFor(member, nextNow));
        } catch (projectionError) {
          this.blockOnUnexpectedResult(step, member.actorId, errorMessage(projectionError), payload);
          return;
        }
        this.now = nextNow;
        this.projectedDomain = nextProjection;
        this.addHistoryEvent({
          step: this.stepIndex + 1,
          actor: member.name,
          actorId: member.actorId,
          payload,
          title: step.title,
          type: step.command.type,
          outcome: 'rejected',
          message,
        });
        this.notice = message;
        this.stepIndex += 1;
        if (this.stepIndex >= this.scenario.steps.length) {
          this.mode = 'complete';
          this.notice = 'The walkthrough is complete.';
        }
      } else {
        this.blockOnUnexpectedResult(step, member.actorId, message, payload);
        return;
      }
    }
    this.publish();
  }

  private blockOnUnexpectedResult(step: PracticeScenarioStep, actorId: string, message: string, payload: unknown = step.command.payload): void {
    const member = memberForActor(this.members, actorId);
    if (member) {
      this.activeActorId = member.actorId;
      try {
        this.projectedDomain = projectDomain(this.domainState, this.contextFor(member, this.now));
      } catch {
        // The current domain state remains authoritative if its scripted projection also fails.
      }
    }
    this.cancelScheduledWork();
    this.mode = 'blocked';
    this.addHistoryEvent({
      step: this.stepIndex + 1,
      actor: member?.name ?? actorId,
      actorId,
      payload,
      title: step.title,
      type: step.command.type,
      outcome: 'rejected',
      message,
    });
    this.notice = `Script stopped: ${message}`;
    this.publish();
  }
}
