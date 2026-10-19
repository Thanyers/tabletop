import {
  DomainError,
  type ActorContext,
  type Artifact,
  type CaseKind,
  type DomainState,
  type InvoiceState,
  type Member,
  type Role,
  type Seat,
  type WorkspaceView,
} from '../shared/contracts';
import { createDomain, decideDomain, projectDomain } from '../domain';
import { canonicalJson } from '../domain/helpers';
import { PRACTICE_SCENARIOS, type PracticeImportedSampleContext, type PracticeScenario, type PracticeScenarioStepDefinition } from './scenarios';
import { MAX_PRACTICE_FILE_EXCERPT, parsePracticeFile, PracticeFileError, type ParsedPracticeFile } from './sample-parser';
import { findPracticeSample, type PracticeFileKind } from './sample-files';

const PRACTICE_PLAY_INTERVAL_MS = 3_200;
const PRACTICE_COMMAND_CLOCK_ADVANCE_MS = 1_000;
const PRACTICE_WORKSPACE_TTL_MS = 24 * 60 * 60 * 1_000;
const PRACTICE_HISTORY_LIMIT = 200;
const PRACTICE_EVENT_MESSAGE_LIMIT = 600;
const PRACTICE_EXPORTED_INPUT_LIMIT = 12_000;
const PRACTICE_IMPORTED_FILE_LIMIT = 20;
const PRACTICE_OBJECT_IDS: Record<CaseKind, readonly string[]> = {
  invoice: ['invoice.source', 'invoice.table', 'invoice.rules', 'invoice.review', 'workspace.history', 'workspace.people'],
  teaching: ['lesson.source', 'lesson.scene', 'lesson.graph', 'lesson.question', 'lesson.rules', 'workspace.history', 'workspace.people'],
  encounter: ['encounter.source', 'encounter.board', 'encounter.actions', 'workspace.history', 'workspace.people'],
};

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

export interface PracticeFile {
  id: string;
  filename: string;
  kind: CaseKind;
  fileKind: PracticeFileKind;
  text: string;
  sha256: string;
  importedAt: number;
  sampleId?: string;
  sourceId?: string;
}

export interface PracticeSnapshot {
  view: WorkspaceView;
  scenario: PracticeScenario;
  mode: PracticeMode;
  stepIndex: number;
  history: PracticeEvent[];
  visibleNodeIds: readonly string[];
  files: readonly PracticeFile[];
  focusNodeId: string | null;
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

interface PracticeImportInput {
  filename: string;
  text: string;
  sampleId?: string;
}

export const PRACTICE_REPLAY_INTERVAL_MS = PRACTICE_PLAY_INTERVAL_MS;

const SYNTHETIC_MEMBERS: Record<CaseKind, readonly Member[]> = {
  invoice: [{ actorId: 'practice-owner', name: 'คุณอ้อม', role: 'owner' }],
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
  // Stable local-only context hash; it is not a security proof or an auth token.
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

async function sha256(text: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new PracticeFileError('This browser cannot calculate a local file fingerprint.');
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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

function createPracticeDomain(kind: CaseKind, context: ActorContext): DomainState {
  const state = createDomain(kind, context);
  if (state.kind !== 'invoice') return state;
  const change = { kind: 'invoice' as const, operations: [] };
  const revision = state.revisions[0];
  if (!revision) throw new Error('The invoice domain did not create its initial revision.');
  const blank: InvoiceState = {
    ...state,
    dataRevision: 0,
    ruleRevision: 0,
    candidate: null,
    shipments: [],
    invoiceLines: [],
    sources: [],
    rules: [],
    runs: [],
    revisions: [{
      ...revision,
      change,
      candidateHash: context.hash({ workspaceId: context.workspaceId, revision: 0, change, actorId: context.actorId, time: context.now }),
      snapshot: { kind: 'invoice', rules: [] },
    }],
  };
  return blank;
}

function importedDomainCommand(parsed: ParsedPracticeFile, sourceId: string | undefined, filename: string, fingerprint: string, createdAt: number): { type: string; payload: unknown } {
  if (parsed.caseKind === 'invoice') {
    if (!sourceId) throw new PracticeFileError('The invoice source ID could not be prepared.');
    const artifactKind: Artifact['kind'] = parsed.kind === 'shipments' ? 'shipments' : parsed.kind === 'invoice' ? 'invoice' : 'rate-card';
    const artifact: Artifact = {
      id: sourceId,
      filename: filename.split(/[\\/]/).pop() ?? filename,
      kind: artifactKind,
      status: 'provided',
      sha256: fingerprint,
      pages: parsed.excerpt ? [{ number: 1, text: parsed.excerpt }] : [],
      excerpt: parsed.excerpt,
      createdAt,
    };
    if (parsed.kind === 'shipments') {
      return { type: 'invoice.import', payload: { artifact, shipments: parsed.shipments.map((shipment, index) => ({ ...shipment, sourceId, row: index + 2 })) } };
    }
    if (parsed.kind === 'invoice') {
      return { type: 'invoice.import', payload: { artifact, invoiceLines: parsed.invoiceLines.map((line, index) => ({ ...line, sourceId, row: index + 2 })) } };
    }
    return { type: 'invoice.import', payload: { artifact } };
  }
  if (parsed.caseKind === 'teaching') return { type: 'teaching.setParameters', payload: parsed.parameters };
  return { type: 'evolve.propose', payload: { change: { kind: 'encounter', rule: parsed.rule } } };
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
  private fileSequence = 0;
  private stepIndex = 0;
  private mode: PracticeMode = 'ready';
  private history: PracticeEvent[] = [];
  private exportedCommands: ExportedPracticeCommand[] = [];
  private files: PracticeFile[] = [];
  private importedContexts: PracticeImportedSampleContext[] = [];
  private visibleNodeIds: string[] = [];
  private focusNodeId: string | null = null;
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
    this.domainState = createPracticeDomain(this.scenario.kind, this.contextFor(firstMember, this.now));
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

  async next(): Promise<void> {
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
    await this.runScenarioStep(token);
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
    this.fileSequence = 0;
    this.stepIndex = 0;
    this.mode = 'ready';
    this.history = [];
    this.exportedCommands = [];
    this.files = [];
    this.importedContexts = [];
    this.visibleNodeIds = [];
    this.focusNodeId = null;
    this.notice = null;
    this.hasTakenOver = false;
    this.now = Date.now();
    this.createdAt = this.now;
    this.domainState = createPracticeDomain(nextScenario.kind, this.contextFor(firstMember, this.now));
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
    const token = this.beginManualInteraction();
    const member = memberForActor(this.members, this.activeActorId);
    if (!member) {
      this.notice = 'The selected synthetic actor is unavailable.';
      this.publish();
      return null;
    }
    if (!this.isAllowedDomainCommand(type)) {
      this.recordRejected(member, type, payload, 'This command is not available through the local practice workbench.', type);
      return null;
    }
    if (!this.isCurrentOperation(token, this.epoch)) return null;
    return this.applyManualDomainCommand(member, type, payload);
  }

  async importSample(sampleId: string): Promise<WorkspaceView | null> {
    if (this.disposed) return null;
    const token = this.beginManualInteraction();
    const sample = findPracticeSample(sampleId, this.scenario.kind);
    if (!sample) {
      this.recordRejected(this.activeMember(), 'practice.importSample', { sampleId }, 'That sample file is not available for this practice table.', 'practice.importSample');
      return null;
    }
    return this.importFileManually({ filename: sample.filename, text: sample.text, sampleId }, token, this.epoch, this.activeMember());
  }

  async ingestFile(filename: string, text: string): Promise<WorkspaceView | null> {
    if (this.disposed) return null;
    const token = this.beginManualInteraction();
    return this.importFileManually({ filename, text }, token, this.epoch, this.activeMember());
  }

  addObject(id: string): boolean {
    if (this.disposed) return false;
    if (!PRACTICE_OBJECT_IDS[this.scenario.kind].includes(id)) {
      this.notice = 'That container is not part of this local practice table.';
      this.publish();
      return false;
    }
    const member = this.activeMember();
    this.beginManualInteraction();
    if (this.visibleNodeIds.includes(id)) {
      this.notice = 'This container is already on the Canvas.';
      this.publish();
      return false;
    }
    const message = this.applyObject(id, member);
    this.focusNodeId = id;
    this.addHistoryEvent({
      actor: member.name,
      actorId: member.actorId,
      payload: { id },
      title: 'Add Canvas container',
      type: 'practice.addObject',
      outcome: 'applied',
      message,
    });
    this.notice = `Added ${id} to the Canvas.`;
    this.publish();
    return true;
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
      visibleNodeIds: this.visibleNodeIds.slice(),
      files: this.files.slice(),
      focusNodeId: this.focusNodeId,
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

  private beginManualInteraction(): number {
    const token = this.cancelScheduledWork();
    this.hasTakenOver = true;
    this.mode = 'manual';
    this.notice = 'Manual control is active. Commands now run as the selected synthetic actor.';
    this.publish();
    return token;
  }

  private isCurrentOperation(token: number, epoch: number): boolean {
    return !this.disposed && token === this.runToken && epoch === this.epoch;
  }

  private isCurrentRun(token: number): boolean {
    return this.isCurrentOperation(token, this.epoch) && this.mode === 'playing';
  }

  private scheduleNextStep(token: number): void {
    if (!this.isCurrentRun(token)) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.isCurrentRun(token)) return;
      void this.runScenarioStep(token).then(() => {
        if (this.isCurrentRun(token)) this.scheduleNextStep(token);
      });
    }, PRACTICE_PLAY_INTERVAL_MS);
  }

  private async runScenarioStep(token: number): Promise<void> {
    if (!this.isCurrentOperation(token, this.epoch)) return;
    const runEpoch = this.epoch;
    const step = this.scenario.steps[this.stepIndex] as PracticeScenarioStepDefinition | undefined;
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
    const type = step.command.type;
    let payload = step.command.payload;

    try {
      payload = step.command.payloadFromState?.(this.domainState, this.importedContexts) ?? step.command.payload;
      let label: string;
      if (type === 'practice.importSample') {
        const sampleId = this.sampleIdFromPayload(payload);
        const sample = findPracticeSample(sampleId, this.scenario.kind);
        if (!sample) throw new PracticeFileError('The scripted sample file is not available for this table.');
        label = await this.importFile({ filename: sample.filename, text: sample.text, sampleId }, token, runEpoch, member);
      } else if (type === 'practice.addObject') {
        const id = this.objectIdFromPayload(payload);
        label = this.applyObject(id, member);
      } else {
        if (!this.isAllowedDomainCommand(type)) throw new PracticeFileError('The script requested an unavailable local command.');
        const decision = decideDomain(this.domainState, { type, payload }, this.contextFor(member, this.now));
        if (expectedOutcome === 'rejected') {
          this.blockOnUnexpectedResult(step, member.actorId, 'The reducer applied a command that the script expected to reject; its result was discarded.', payload);
          return;
        }
        this.commitDomainDecision(decision.state, member);
        label = decision.label;
      }

      if (!this.isCurrentOperation(token, runEpoch)) return;
      if (expectedOutcome === 'rejected') {
        this.blockOnUnexpectedResult(step, member.actorId, 'The script expected this command to be rejected by the domain.', payload);
        return;
      }
      this.addHistoryEvent({
        step: this.stepIndex + 1,
        actor: member.name,
        actorId: member.actorId,
        payload,
        title: step.title,
        type,
        outcome: 'applied',
        message: label,
      });
      this.notice = label;
      this.stepIndex += 1;
      this.finishStepIfComplete();
      this.publish();
    } catch (error) {
      if (!this.isCurrentOperation(token, runEpoch)) return;
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
          type,
          outcome: 'rejected',
          message,
        });
        this.notice = message;
        this.stepIndex += 1;
        this.finishStepIfComplete();
        this.publish();
      } else {
        this.blockOnUnexpectedResult(step, member.actorId, message, payload);
      }
    }
  }

  private finishStepIfComplete(): void {
    if (this.stepIndex >= this.scenario.steps.length) {
      this.mode = 'complete';
      this.notice = 'The walkthrough is complete.';
    }
  }

  private async importFile(
    input: PracticeImportInput,
    token: number,
    runEpoch: number,
    member: Member,
  ): Promise<string> {
      if (this.files.length >= PRACTICE_IMPORTED_FILE_LIMIT) throw new PracticeFileError('This practice table can hold at most 20 imported files.');
      const parsed = parsePracticeFile(input.filename, input.text, this.scenario.kind);
      const fingerprint = await sha256(input.text);
      if (!this.isCurrentOperation(token, runEpoch)) throw new PracticeFileError('This import was cancelled because the practice table changed.');

      const fileSequence = this.fileSequence + 1;
      const fileId = `practice-file-${runEpoch}-${fileSequence}`;
      const sourceId = parsed.caseKind === 'invoice' ? `practice-source-${runEpoch}-${fileSequence}` : undefined;
      const importedContext: PracticeImportedSampleContext = {
        id: fileId,
        ...(input.sampleId === undefined ? {} : { sampleId: input.sampleId }),
        kind: parsed.kind,
        ...(sourceId === undefined ? {} : { sourceId }),
        parsed,
      };
      const command = importedDomainCommand(parsed, sourceId, input.filename, fingerprint, this.now);
      const decision = decideDomain(this.domainState, command, this.contextFor(member, this.now));
      const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
      const nextProjection = projectDomain(decision.state, this.contextFor(member, nextNow));
      if (!this.isCurrentOperation(token, runEpoch)) throw new PracticeFileError('This import was cancelled because the practice table changed.');

      const file: PracticeFile = {
        id: fileId,
        filename: input.filename.split(/[\\/]/).pop() ?? input.filename,
        kind: parsed.caseKind,
        fileKind: parsed.kind,
        text: input.text.slice(0, MAX_PRACTICE_FILE_EXCERPT),
        sha256: fingerprint,
        importedAt: this.now,
        ...(input.sampleId === undefined ? {} : { sampleId: input.sampleId }),
        ...(sourceId === undefined ? {} : { sourceId }),
      };

      this.domainState = decision.state;
      this.revisionCounter += 1;
      this.now = nextNow;
      this.projectedDomain = nextProjection;
      this.fileSequence = fileSequence;
      this.files.push(file);
      this.importedContexts.push(importedContext);
      this.revealNode('practice.files');
      this.revealNode(this.sourceNodeId());
      this.focusNodeId = 'practice.files';
      return decision.label;
  }

  private async importFileManually(input: PracticeImportInput, token: number, runEpoch: number, member: Member): Promise<WorkspaceView | null> {
    const type = input.sampleId === undefined ? 'practice.ingestFile' : 'practice.importSample';
    const title = input.sampleId === undefined ? 'Import local practice file' : 'Import practice sample';
    try {
      const message = await this.importFile(input, token, runEpoch, member);
      if (!this.isCurrentOperation(token, runEpoch)) return null;
      this.addHistoryEvent({
        actor: member.name,
        actorId: member.actorId,
        payload: input.sampleId === undefined
          ? { filename: input.filename, text: input.text }
          : { sampleId: input.sampleId, filename: input.filename, text: input.text },
        title,
        type,
        outcome: 'applied',
        message,
      });
      this.notice = message;
      this.publish();
      return this.snapshot.view;
    } catch (error) {
      if (!this.isCurrentOperation(token, runEpoch)) return null;
      this.recordRejected(member, type, input.sampleId === undefined ? { filename: input.filename, text: input.text } : { sampleId: input.sampleId, filename: input.filename, text: input.text }, errorMessage(error), title);
      return null;
    }
  }

  private async applyManualDomainCommand(member: Member, type: string, payload: unknown): Promise<WorkspaceView | null> {
    try {
      const decision = decideDomain(this.domainState, { type, payload }, this.contextFor(member, this.now));
      this.commitDomainDecision(decision.state, member);
      this.addHistoryEvent({ actor: member.name, actorId: member.actorId, payload, title: type, type, outcome: 'applied', message: decision.label });
      this.notice = decision.label;
      this.publish();
      return this.snapshot.view;
    } catch (error) {
      this.recordRejected(member, type, payload, errorMessage(error), type);
      return null;
    }
  }

  private commitDomainDecision(nextState: DomainState, member: Member): void {
    const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
    const nextProjection = projectDomain(nextState, this.contextFor(member, nextNow));
    this.domainState = nextState;
    this.revisionCounter += 1;
    this.now = nextNow;
    this.projectedDomain = nextProjection;
  }

  private recordRejected(member: Member, type: string, payload: unknown, message: string, title: string, step?: number): void {
    const nextNow = this.now + PRACTICE_COMMAND_CLOCK_ADVANCE_MS;
    try {
      this.projectedDomain = projectDomain(this.domainState, this.contextFor(member, nextNow));
      this.now = nextNow;
    } catch {
      // Rejected commands do not alter domain state if a projection is unavailable.
    }
    this.addHistoryEvent({
      ...(step === undefined ? {} : { step }),
      actor: member.name,
      actorId: member.actorId,
      payload,
      title,
      type,
      outcome: 'rejected',
      message,
    });
    this.notice = message;
    this.publish();
  }

  private applyObject(id: string, member: Member): string {
    if (!PRACTICE_OBJECT_IDS[this.scenario.kind].includes(id)) throw new PracticeFileError('The requested Canvas container is not part of this practice table.');
    if (this.visibleNodeIds.includes(id)) throw new PracticeFileError(`The Canvas container ${id} is already present.`);
    this.projectedDomain = projectDomain(this.domainState, this.contextFor(member, this.now));
    this.visibleNodeIds.push(id);
    this.focusNodeId = id;
    this.revisionCounter += 1;
    return `Added ${id} to this practice Canvas.`;
  }

  private revealNode(id: string): void {
    if (!this.visibleNodeIds.includes(id)) this.visibleNodeIds.push(id);
  }

  private sourceNodeId(): string {
    if (this.scenario.kind === 'invoice') return 'invoice.source';
    if (this.scenario.kind === 'teaching') return 'lesson.source';
    return 'encounter.source';
  }

  private activeMember(): Member {
    const member = memberForActor(this.members, this.activeActorId);
    if (!member) throw new Error('The selected synthetic actor is unavailable.');
    return member;
  }

  private sampleIdFromPayload(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new PracticeFileError('The scripted sample ID is missing.');
    const sampleId = (payload as Record<string, unknown>).sampleId;
    if (typeof sampleId !== 'string') throw new PracticeFileError('The scripted sample ID is missing.');
    return sampleId;
  }

  private objectIdFromPayload(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new PracticeFileError('The scripted Canvas container ID is missing.');
    const id = (payload as Record<string, unknown>).id;
    if (typeof id !== 'string') throw new PracticeFileError('The scripted Canvas container ID is missing.');
    return id;
  }

  private isAllowedDomainCommand(type: string): boolean {
    if (typeof type !== 'string' || type.startsWith('practice.') || type === 'invoice.import' || type === 'invoice.sample') return false;
    if (type.startsWith('evolve.')) return true;
    return this.scenario.kind === 'invoice'
      ? type.startsWith('invoice.')
      : this.scenario.kind === 'teaching'
        ? type.startsWith('teaching.')
        : type.startsWith('encounter.');
  }

  private blockOnUnexpectedResult(step: PracticeScenarioStepDefinition, actorId: string, message: string, payload: unknown = step.command.payload): void {
    const member = memberForActor(this.members, actorId);
    if (member) {
      this.activeActorId = member.actorId;
      try {
        this.projectedDomain = projectDomain(this.domainState, this.contextFor(member, this.now));
      } catch {
        // Keep the last valid projection if this error path also fails projection.
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
