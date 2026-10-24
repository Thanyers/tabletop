import type { ApiError, CommandAck, CommandEnvelope, WorkspaceView } from '../../src/tabletop/shared/contracts.js';

export interface RepositoryConformanceState {
  workspace: { epoch: number; revision: number; stateHash: string };
  snapshots: readonly { epoch: number; revision: number; stateHash: string }[];
  events: readonly { eventId: string; epoch: number; actorId: string; commandId: string }[];
  receipts: readonly { epoch: number; actorId: string; commandId: string; payloadHash: string; eventId: string }[];
  outbox: readonly { outboxId: string; epoch: number; eventId: string }[];
}

export type RepositoryConformanceResult =
  | { kind: 'success'; ack: CommandAck }
  | { kind: 'error'; error: ApiError };

export type RepositoryConformanceFault =
  | { kind: 'callback-after-command' }
  | { kind: 'outbox-id-collision'; outboxId: string };

export interface RepositoryConformanceAdapter {
  readonly workspaceId: string;
  readonly revokedActorId: string;
  currentView(): Promise<WorkspaceView>;
  execute(
    envelope: CommandEnvelope,
    options?: { actorId?: string; fault?: RepositoryConformanceFault },
  ): Promise<RepositoryConformanceResult>;
  inspect(): Promise<RepositoryConformanceState>;
  revokeMember(actorId: string): Promise<void>;
  close(): Promise<void>;
}

export interface RepositoryConformanceScenario {
  readonly name: string;
  run(adapter: RepositoryConformanceAdapter): Promise<void>;
}

const commandIds = {
  duplicate: '00000000-0000-4000-8000-000000000001',
  mismatch: '00000000-0000-4000-8000-000000000002',
  competingFirst: '00000000-0000-4000-8000-000000000003',
  competingSecond: '00000000-0000-4000-8000-000000000004',
  callbackFailure: '00000000-0000-4000-8000-000000000005',
  commitFailureSeed: '00000000-0000-4000-8000-000000000006',
  commitFailure: '00000000-0000-4000-8000-000000000007',
  reset: '00000000-0000-4000-8000-000000000008',
  staleEpoch: '00000000-0000-4000-8000-000000000009',
  revokedMember: '00000000-0000-4000-8000-000000000010',
} as const;

const initialForce = 12;
const changedForce = 18;
const competingForces = [20, 24] as const;
const mass = 2;
const time = 2;

function command(view: WorkspaceView, commandId: string, force: number): CommandEnvelope {
  return {
    commandId,
    expectedRevision: view.revision,
    expectedEpoch: view.epoch,
    type: 'teaching.setParameters',
    payload: { force, mass, time },
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`REPOSITORY_CONFORMANCE_FAILED:${message}`);
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`REPOSITORY_CONFORMANCE_FAILED:${message}`);
  }
}

function canonicalJson(value: unknown): string | undefined {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function assertSuccess(result: RepositoryConformanceResult, message: string): CommandAck {
  assert(result.kind === 'success', message);
  return result.ack;
}

function assertError(result: RepositoryConformanceResult, errorCode: string, message: string): void {
  assert(result.kind === 'error', message);
  assertEqual(result.error.errorCode, errorCode, message);
}

function rowsForCommand<T extends { commandId: string }>(rows: readonly T[], commandId: string): readonly T[] {
  return rows.filter((row) => row.commandId === commandId);
}

const scenarios: readonly RepositoryConformanceScenario[] = [
  {
    name: 'replays the same receipt without creating another event',
    async run(adapter) {
      const envelope = command(await adapter.currentView(), commandIds.duplicate, initialForce);
      const first = assertSuccess(await adapter.execute(envelope), 'first command should commit');
      const afterFirst = await adapter.inspect();
      const receipt = rowsForCommand(afterFirst.receipts, envelope.commandId)[0];
      assert(receipt, 'first command receipt should be present');
      assertEqual(rowsForCommand(afterFirst.events, envelope.commandId).length, 1, 'first command should create one event');
      assertEqual(afterFirst.outbox.filter((row) => row.eventId === receipt.eventId).length, 1, 'first command should create one outbox row');

      const replay = assertSuccess(await adapter.execute(envelope), 'exact retry should return its receipt');
      assert(replay.duplicate, 'exact retry should be marked duplicate');
      assertEqual({ ...replay, duplicate: false }, first, 'exact retry should return the original acknowledgement');
      const afterReplay = await adapter.inspect();
      assertEqual(afterReplay, afterFirst, 'exact retry must not add repository rows');
      assertEqual(rowsForCommand(afterReplay.receipts, envelope.commandId).length, 1, 'exact retry should keep one receipt');
      assertEqual(rowsForCommand(afterReplay.events, envelope.commandId).length, 1, 'exact retry should keep one event');
    },
  },
  {
    name: 'rejects a changed payload for an existing command ID without writing',
    async run(adapter) {
      const view = await adapter.currentView();
      const envelope = command(view, commandIds.mismatch, initialForce);
      assertSuccess(await adapter.execute(envelope), 'first command should commit');
      const beforeMismatch = await adapter.inspect();
      const changed = { ...envelope, payload: { force: changedForce, mass, time } };
      assertError(await adapter.execute(changed), 'IDEMPOTENCY_MISMATCH', 'changed payload should be rejected');
      assertEqual(await adapter.inspect(), beforeMismatch, 'mismatched retry must not write repository rows');
    },
  },
  {
    name: 'allows only one command for a shared expected revision',
    async run(adapter) {
      const view = await adapter.currentView();
      const before = await adapter.inspect();
      const attempts = await Promise.all([
        adapter.execute(command(view, commandIds.competingFirst, competingForces[0])),
        adapter.execute(command(view, commandIds.competingSecond, competingForces[1])),
      ]);
      const successes = attempts.filter((result) => result.kind === 'success');
      const failures = attempts.filter((result) => result.kind === 'error');
      assertEqual(successes.length, 1, 'exactly one competing command should commit');
      assertEqual(failures.length, 1, 'exactly one competing command should be stale');
      assertError(failures[0]!, 'STALE_REVISION', 'losing command should report stale revision');
      const after = await adapter.inspect();
      assertEqual(after.workspace.revision, before.workspace.revision + 1, 'one command should advance revision');
      assertEqual(after.snapshots.length, before.snapshots.length + 1, 'one command should add one snapshot');
      assertEqual(after.events.length, before.events.length + 1, 'one command should add one event');
      assertEqual(after.receipts.length, before.receipts.length + 1, 'one command should add one receipt');
      assertEqual(after.outbox.length, before.outbox.length + 1, 'one command should add one outbox row');
    },
  },
  {
    name: 'rolls back state, snapshot, event, receipt, and outbox when the transaction callback fails',
    async run(adapter) {
      const before = await adapter.inspect();
      const envelope = command(await adapter.currentView(), commandIds.callbackFailure, initialForce);
      const failed = await adapter.execute(envelope, { fault: { kind: 'callback-after-command' } });
      assert(failed.kind === 'error', 'injected callback failure should reject the command');
      assertEqual(await adapter.inspect(), before, 'callback failure must roll back every repository record');

      const retry = assertSuccess(await adapter.execute(envelope), 'command should be retryable after rollback');
      assertEqual(retry.commandId, envelope.commandId, 'retry should commit the original command ID');
    },
  },
  {
    name: 'rolls back every repository record when outbox persistence fails late in commit',
    async run(adapter) {
      const seed = assertSuccess(await adapter.execute(
        command(await adapter.currentView(), commandIds.commitFailureSeed, initialForce),
      ), 'seed command should commit');
      const before = await adapter.inspect();
      const collidingOutbox = before.outbox.find((row) => row.eventId === before.receipts.find(
        (receipt) => receipt.commandId === seed.commandId,
      )?.eventId)?.outboxId;
      assert(collidingOutbox, 'seed command should leave an outbox row for collision injection');
      const envelope = command(await adapter.currentView(), commandIds.commitFailure, changedForce);
      const failed = await adapter.execute(envelope, {
        fault: { kind: 'outbox-id-collision', outboxId: collidingOutbox },
      });
      assert(failed.kind === 'error', 'outbox collision should reject the command');
      assertEqual(await adapter.inspect(), before, 'late commit failure must roll back every repository record');

      assertSuccess(await adapter.execute(envelope), 'command should be retryable after failed commit');
    },
  },
  {
    name: 'rejects a command from an earlier workspace epoch',
    async run(adapter) {
      const beforeReset = await adapter.currentView();
      const reset = assertSuccess(await adapter.execute({
        commandId: commandIds.reset,
        expectedRevision: beforeReset.revision,
        expectedEpoch: beforeReset.epoch,
        type: 'workspace.reset',
        payload: {},
      }), 'reset should commit');
      const afterReset = await adapter.inspect();
      assertEqual(reset.workspace.epoch, beforeReset.epoch + 1, 'reset should advance the workspace epoch');

      const staleEnvelope = command(beforeReset, commandIds.staleEpoch, changedForce);
      assertError(await adapter.execute(staleEnvelope), 'STALE_EPOCH', 'command from the earlier epoch should be rejected');
      assertEqual(await adapter.inspect(), afterReset, 'stale epoch rejection must not write repository rows');
    },
  },
  {
    name: 'rejects commands from a revoked member',
    async run(adapter) {
      const before = await adapter.inspect();
      await adapter.revokeMember(adapter.revokedActorId);
      const envelope = command(await adapter.currentView(), commandIds.revokedMember, changedForce);
      assertError(await adapter.execute(envelope, { actorId: adapter.revokedActorId }),
        'MEMBERSHIP_REVOKED', 'revoked member should no longer execute commands');
      assertEqual(await adapter.inspect(), before, 'revoked membership command must not write repository rows');
    },
  },
];

export function repositoryConformanceScenarios(): readonly RepositoryConformanceScenario[] {
  return scenarios;
}
