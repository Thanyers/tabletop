import { describe, expect, it } from 'vitest';
import type { ActorContext, Member, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { decideDomain } from '../src/tabletop/domain/index.js';
import { createTableState } from '../src/tabletop/domain/table.js';
import { gameChange } from '../src/tabletop/testing/table-scenarios.js';
import type { ComputeRunner, ComputeRunnerResult, ComputeTableValue } from '../src/tabletop/shared/table-compute.js';
import type { Permission } from '../src/tabletop/shared/permissions.js';
import { hashValue } from './codec.js';
import { TableComputeOrchestrator, type ComputeWorkspaceSnapshot } from './table-compute-orchestrator.js';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const RUN_ID = '22222222-2222-4222-8222-222222222222';

function createFixture() {
  const change = gameChange('');
  change.program.evidence = [];
  change.program.compute = {
    version: 1,
    modules: [{
      id: 'total_score',
      name: 'Total score',
      description: 'Add the boat scores.',
      runtime: 'javascript',
      version: 1,
      source: 'export default function compute(inputs) { return { total: 0 }; }',
      inputs: [{ id: 'scores', label: 'Scores', type: 'table', binding: { kind: 'collection', collectionId: 'boats' } }],
      outputs: [{ id: 'total', label: 'Total', type: 'number' }],
    }],
  };
  const state = createTableState();
  state.program = change.program;
  state.records = structuredClone(change.initialRecords);
  state.ruleRevision = 1;
  const owner: Member = { actorId: 'owner', name: 'Owner', role: 'owner' };
  let participantCanCompute = false;
  let revision = 1;
  const actorContext = (actorId: string): ActorContext => ({
    actorId,
    name: actorId === 'owner' ? 'Owner' : 'Participant',
    role: actorId === 'owner' ? 'owner' : 'participant',
    ...(actorId === 'participant' ? { seat: 'member-1' as const } : {}),
    workspaceId: WORKSPACE_ID,
    epoch: 1,
    now: revision,
    hash: hashValue,
    permissions: new Set<Permission>(actorId === 'owner' || participantCanCompute ? ['data.compute'] : []),
  });
  const snapshot = (actorId = 'owner'): ComputeWorkspaceSnapshot => {
    const workspace: WorkspaceView = {
      id: WORKSPACE_ID,
      title: 'Test table',
      kind: 'table',
      epoch: 1,
      revision: String(revision),
      actor: owner,
      members: [owner],
      domain: structuredClone(state),
      createdAt: 0,
      expiresAt: 9_999_999_999_999,
    };
    return { workspace, context: actorContext(actorId), ownerActorId: owner.actorId };
  };
  return {
    snapshot,
    get state() { return state; },
    setParticipantComputePermission(allowed: boolean): void {
      participantCanCompute = allowed;
    },
    bumpData(): void {
      const boat = state.records.boats?.[0];
      if (!boat) throw new Error('Test fixture is missing the first boat.');
      boat.values.score = 4;
      state.dataRevision += 1;
      revision += 1;
    },
    async executeTrusted(actorId: string, type: 'table.compute.queue' | 'table.compute.update', payload: unknown): Promise<void> {
      if (type === 'table.compute.update' && actorId !== owner.actorId) throw new Error('Internal compute updates must use the owner actor.');
      const decision = decideDomain(state, { type, payload }, actorContext(actorId));
      Object.assign(state, decision.state);
      revision += 1;
    },
    async queueRun(): Promise<void> {
      const decision = decideDomain(state, {
        type: 'table.compute.run',
        payload: { moduleId: 'total_score', runId: RUN_ID },
      }, actorContext('owner'));
      Object.assign(state, decision.state);
      revision += 1;
    },
  };
}

function runnerFor(requests: Array<ComputeTableValue>): ComputeRunner {
  return {
    async run(request) {
      const input = request.inputs.scores?.value;
      if (!input || typeof input !== 'object' || Array.isArray(input) || !('rows' in input)) {
        throw new Error('Expected resolved score rows.');
      }
      requests.push(structuredClone(input));
      const total = input.rows.reduce((sum, row) => sum + (typeof row.score === 'number' ? row.score : 0), 0);
      return { outputs: { total } };
    },
  };
}

describe('table compute orchestration', () => {
  it('rechecks a workspace changed while an empty drain is finishing', async () => {
    const fixture = createFixture();
    const computeProgram = fixture.state.program?.compute;
    if (!computeProgram || !fixture.state.program) throw new Error('Expected a compute program.');
    delete fixture.state.program.compute;
    let releaseSnapshot: (() => void) | undefined;
    let notifySnapshot: (() => void) | undefined;
    const firstSnapshot = new Promise<void>(resolve => { notifySnapshot = resolve; });
    const snapshotGate = new Promise<void>(resolve => { releaseSnapshot = resolve; });
    let gateFirstSnapshot = true;
    const orchestrator = new TableComputeOrchestrator({
      runner: runnerFor([]),
      getSnapshot: async (_workspaceId, actorId) => {
        const snapshot = fixture.snapshot(actorId);
        if (gateFirstSnapshot) {
          gateFirstSnapshot = false;
          notifySnapshot?.();
          await snapshotGate;
        }
        return snapshot;
      },
      executeTrusted: (actorId, workspaceId, type, payload) => fixture.executeTrusted(actorId, type, payload),
    });
    try {
      const firstDrain = orchestrator.schedule(WORKSPACE_ID, 1);
      await firstSnapshot;
      fixture.state.program.compute = computeProgram;
      const activationSchedule = orchestrator.schedule(WORKSPACE_ID, 1);
      releaseSnapshot?.();
      await Promise.all([firstDrain, activationSchedule]);
      expect(fixture.state.computeRuns?.[0]).toMatchObject({ status: 'succeeded', outputs: [{ outputId: 'total', value: 0 }] });
    } finally {
      await orchestrator.close();
    }
  });

  it('persists a successful run and automatically reruns when an input collection changes', async () => {
    const fixture = createFixture();
    const requests: ComputeTableValue[] = [];
    const orchestrator = new TableComputeOrchestrator({
      runner: runnerFor(requests),
      getSnapshot: async (_workspaceId, actorId) => fixture.snapshot(actorId),
      executeTrusted: (actorId, workspaceId, type, payload) => fixture.executeTrusted(actorId, type, payload),
    });
    try {
      await fixture.queueRun();
      await orchestrator.schedule(WORKSPACE_ID, 1);
      expect(fixture.state.computeRuns?.[0]).toMatchObject({
        runId: RUN_ID,
        status: 'succeeded',
        moduleId: 'total_score',
        inputHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
        outputs: [{ outputId: 'total', value: 0 }],
      });
      expect(fixture.state.records.boats?.[0]?.values.score).toBe(0);

      fixture.bumpData();
      await orchestrator.schedule(WORKSPACE_ID, 1);
      expect(fixture.state.computeRuns?.[0]).toMatchObject({ status: 'succeeded', outputs: [{ outputId: 'total', value: 4 }] });
      expect(fixture.state.computeRuns).toHaveLength(2);
      expect(requests.map(table => table.rows[0]?.score)).toEqual([0, 4]);
      expect(fixture.state.computeRuns?.[0]?.inputProvenance?.[0]).toMatchObject({
        inputId: 'scores',
        binding: { kind: 'collection', collectionId: 'boats' },
      });
    } finally {
      await orchestrator.close();
    }
  });

  it('keeps an authorized requesting seat for actor-bound automatic reruns', async () => {
    const fixture = createFixture();
    const module = fixture.state.program?.compute?.modules[0];
    if (!module) throw new Error('Expected a compute module.');
    module.inputs.push({ id: 'seat', label: 'Seat', type: 'text', binding: { kind: 'actor', property: 'seat' } });
    fixture.setParticipantComputePermission(true);
    const actorRunId = '33333333-3333-4333-8333-333333333333';
    const queued = decideDomain(fixture.state, {
      type: 'table.compute.run',
      payload: { moduleId: module.id, runId: actorRunId },
    }, fixture.snapshot('participant').context);
    Object.assign(fixture.state, queued.state);
    const observedSeats: Array<string | null> = [];
    const orchestrator = new TableComputeOrchestrator({
      runner: {
        async run(request) {
          const seat = request.inputs.seat?.value;
          observedSeats.push(typeof seat === 'string' ? seat : null);
          return { outputs: { total: seat === 'member-1' ? 4 : 1 } };
        },
      },
      getSnapshot: async (_workspaceId, actorId) => fixture.snapshot(actorId),
      executeTrusted: (actorId, _workspaceId, type, payload) => fixture.executeTrusted(actorId, type, payload),
    });
    try {
      await orchestrator.schedule(WORKSPACE_ID, 1);
      expect(fixture.state.computeRuns?.[0]).toMatchObject({
        actorId: 'participant', role: 'participant', seat: 'member-1', status: 'succeeded',
        outputs: [{ outputId: 'total', value: 4 }],
      });
      expect(observedSeats).toEqual(['member-1']);

      fixture.bumpData();
      await orchestrator.schedule(WORKSPACE_ID, 1);
      expect(fixture.state.computeRuns?.[0]).toMatchObject({
        actorId: 'participant', role: 'participant', seat: 'member-1', status: 'succeeded',
        outputs: [{ outputId: 'total', value: 4 }],
      });
      expect(observedSeats).toEqual(['member-1', 'member-1']);
    } finally {
      await orchestrator.close();
    }
  });

  it('fails a persisted queued job when its initiating actor loses compute permission', async () => {
    const fixture = createFixture();
    const requests: ComputeTableValue[] = [];
    const orchestrator = new TableComputeOrchestrator({
      runner: runnerFor(requests),
      getSnapshot: async (_workspaceId, actorId) => fixture.snapshot(actorId),
      executeTrusted: (actorId, _workspaceId, type, payload) => fixture.executeTrusted(actorId, type, payload),
    });
    try {
      const decision = decideDomain(fixture.state, {
        type: 'table.compute.run',
        payload: { moduleId: 'total_score', runId: RUN_ID },
      }, {
        ...fixture.snapshot('participant').context,
        permissions: new Set<Permission>(['data.compute']),
      });
      Object.assign(fixture.state, decision.state);
      expect(fixture.state.computeRuns?.[0]?.actorId).toBe('participant');
      // The queued member loses permission before the persisted job is resumed.
      await orchestrator.schedule(WORKSPACE_ID, 1);
      expect(fixture.state.computeRuns?.find(run => run.runId === RUN_ID)).toMatchObject({ status: 'failed', errorCode: 'COMPUTE_FAILED' });
      expect(fixture.state.computeRuns?.[0]).toMatchObject({ actorId: 'owner', status: 'succeeded' });
      expect(requests).toHaveLength(1);
    } finally {
      await orchestrator.close();
    }
  });

  it('marks an in-flight result stale after an input changes and runs the fresh snapshot', async () => {
    const fixture = createFixture();
    const requests: ComputeTableValue[] = [];
    let releaseFirstRun: ((result: ComputeRunnerResult) => void) | undefined;
    let notifyFirstRun: (() => void) | undefined;
    const firstRunStarted = new Promise<void>(resolve => { notifyFirstRun = resolve; });
    const firstRun = new Promise<ComputeRunnerResult>(resolve => { releaseFirstRun = resolve; });
    const fallbackRunner = runnerFor(requests);
    let invocations = 0;
    const runner: ComputeRunner = {
      async run(request) {
        if (invocations++ === 0) {
          const result = await fallbackRunner.run(request);
          notifyFirstRun?.();
          return firstRun.then(() => result);
        }
        return fallbackRunner.run(request);
      },
    };
    const orchestrator = new TableComputeOrchestrator({
      runner,
      getSnapshot: async (_workspaceId, actorId) => fixture.snapshot(actorId),
      executeTrusted: (actorId, _workspaceId, type, payload) => fixture.executeTrusted(actorId, type, payload),
    });
    try {
      await fixture.queueRun();
      const task = orchestrator.schedule(WORKSPACE_ID, 1);
      await firstRunStarted;
      fixture.bumpData();
      releaseFirstRun?.({ outputs: { total: 0 } });
      await task;

      expect(fixture.state.computeRuns?.find(run => run.runId === RUN_ID)).toMatchObject({ status: 'stale', errorCode: 'COMPUTE_STALE' });
      expect(fixture.state.computeRuns?.[0]).toMatchObject({ status: 'succeeded', outputs: [{ outputId: 'total', value: 4 }] });
      expect(requests.map(table => table.rows[0]?.score)).toEqual([0, 4]);
    } finally {
      await orchestrator.close();
    }
  });
});
