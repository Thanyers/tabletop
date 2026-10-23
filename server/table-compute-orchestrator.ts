import type { ActorContext, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import {
  COMPUTE_LIMITS,
  computeDerivedCollections,
  computeModuleOrder,
  currentComputeRun,
  resolveComputeInput,
  validateComputeOutputs,
  type ComputeInputProvenance,
  type ComputeModule,
  type ComputePortValue,
  type ComputeRunRecord,
  type ComputeRunner,
  type ComputeRunnerRequest,
  type ComputeRuntimeProfile,
  type TableComputeProgram,
} from '../src/tabletop/shared/table-compute.js';
import type { AuthenticatedSession } from './authority.js';

export interface ComputeWorkspaceSnapshot {
  workspace: WorkspaceView;
  context: ActorContext;
  ownerActorId: string;
}

export interface TableComputeOrchestratorOptions {
  runner: ComputeRunner;
  onWorkScheduled?(workspaceId: string): void;
  getSnapshot(workspaceId: string, actorId?: string): Promise<ComputeWorkspaceSnapshot>;
  executeTrusted(
    actorId: string,
    workspaceId: string,
    type: 'table.compute.queue' | 'table.compute.update',
    payload: unknown,
  ): Promise<void>;
  reauthenticate(session: AuthenticatedSession): Promise<AuthenticatedSession>;
}

interface ScheduledComputeDrain {
  epoch: number;
  session?: AuthenticatedSession;
  dirty: boolean;
  task: Promise<void>;
}

interface ComputePlan {
  request: ComputeRunnerRequest;
  inputHash: string;
  sourceIds: string[];
  inputProvenance: ComputeInputProvenance[];
  dataRevision: number;
  ruleRevision: number;
}

function tableSnapshot(snapshot: ComputeWorkspaceSnapshot) {
  if (snapshot.workspace.kind !== 'table' || snapshot.workspace.domain.kind !== 'table') return null;
  const state = snapshot.workspace.domain;
  const program = state.program?.compute;
  if (!program) return null;
  return { state, program };
}

function currentRunOutputs(snapshot: ComputeWorkspaceSnapshot): Map<string, ComputePortValue> {
  const current = tableSnapshot(snapshot);
  if (!current) return new Map();
  const { state, program } = current;
  const runs = state.computeRuns ?? [];
  const outputs = new Map<string, ComputePortValue>();
  for (const module of computeModuleOrder(program)) {
    const run = currentComputeRun(program, module.id, runs, state.dataRevision, state.ruleRevision);
    if (!run) continue;
    const validated = validateComputeOutputs(module, {
      outputs: Object.fromEntries((run.outputs ?? []).map(output => [output.outputId, output.value])),
    });
    for (const [outputId, value] of Object.entries(validated.outputs)) {
      outputs.set(`${module.id}.${outputId}`, value);
    }
  }
  return outputs;
}

function upstreamModule(program: TableComputeProgram, module: ComputeModule, inputId: string): string | undefined {
  const input = module.inputs.find(port => port.id === inputId);
  if (!input) return undefined;
  if (input.binding.kind === 'result') return input.binding.moduleId;
  if (input.binding.kind !== 'collection') return undefined;
  const collectionId = input.binding.collectionId;
  return program.modules.find(candidate => candidate.outputs.some(output => output.collectionId === collectionId))?.id;
}

function planFor(
  snapshot: ComputeWorkspaceSnapshot,
  module: ComputeModule,
  actor: ActorContext,
): ComputePlan | null {
  const current = tableSnapshot(snapshot);
  if (!current || snapshot.workspace.epoch !== actor.epoch) return null;
  const { state, program } = current;
  const ordered = computeModuleOrder(program);
  const derivedCollections = computeDerivedCollections(program, state.computeRuns ?? [], state.dataRevision, state.ruleRevision);
  const outputs = currentRunOutputs(snapshot);
  const inputs: ComputeRunnerRequest['inputs'] = {};
  const runs = state.computeRuns ?? [];
  const inputProvenance = module.inputs.map((input): ComputeInputProvenance => {
    const upstreamId = upstreamModule(program, module, input.id);
    const upstream = upstreamId
      ? currentComputeRun(program, upstreamId, runs, state.dataRevision, state.ruleRevision)
      : undefined;
    const value = resolveComputeInput(input, {
      collections: state.program?.collections ?? [],
      records: state.records,
      sources: state.sources,
      outputs,
      program,
      derivedCollections,
      actor: { role: actor.role, seat: actor.seat ?? null },
      dataRevision: state.dataRevision,
    });
    inputs[input.id] = { type: input.type, value };
    const provenanceSourceIds = input.binding.kind === 'provenance' && input.binding.property === 'sourceIds' && Array.isArray(value)
      ? value.filter((item: unknown): item is string => typeof item === 'string')
      : [];
    const sourceIds = input.binding.kind === 'source'
      ? [input.binding.sourceId]
      : upstream?.sourceIds ?? provenanceSourceIds;
    return {
      inputId: input.id,
      type: input.type,
      binding: input.binding,
      sourceIds: [...new Set(sourceIds)].slice(0, 4),
      ...(upstream ? { upstreamRunId: upstream.runId } : {}),
    };
  });
  // `ordered` is evaluated here so corrupt persisted graphs fail closed before invoking a runner.
  if (!ordered.some(item => item.id === module.id)) return null;
  const sourceIds = [...new Set(inputProvenance.flatMap(item => item.sourceIds))].slice(0, 4);
  const runtimeProfile: ComputeRuntimeProfile = module.runtimeProfile ?? 'tabletop-compute-1';
  const signature = {
    moduleId: module.id,
    moduleVersion: module.version,
    sourceHash: actor.hash(module.source),
    runtime: module.runtime,
    runtimeProfile,
    inputs,
    inputProvenance,
  };
  const inputHash = actor.hash(signature);
  if (new TextEncoder().encode(JSON.stringify(inputs)).byteLength > COMPUTE_LIMITS.inputBytes) {
    throw new Error('COMPUTE_FAILED');
  }
  return {
    request: {
      moduleId: module.id,
      moduleVersion: module.version,
      runtime: module.runtime,
      runtimeProfile,
      source: module.source,
      inputs,
      outputs: module.outputs,
    },
    inputHash,
    sourceIds,
    inputProvenance,
    dataRevision: state.dataRevision,
    ruleRevision: state.ruleRevision,
  };
}

function safePlanFor(snapshot: ComputeWorkspaceSnapshot, module: ComputeModule): ComputePlan | null {
  try {
    return planFor(snapshot, module, snapshot.context);
  } catch {
    return null;
  }
}

function failureCode(error: unknown): ComputeRunRecord['errorCode'] {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    if (error.message === 'COMPUTE_UNAVAILABLE') return 'COMPUTE_UNAVAILABLE';
    if (error.message === 'COMPUTE_INVALID_OUTPUT') return 'COMPUTE_INVALID_OUTPUT';
  }
  return 'COMPUTE_FAILED';
}

function permittedToCompute(snapshot: ComputeWorkspaceSnapshot): boolean {
  return snapshot.context.permissions?.has('data.compute') === true;
}

export class TableComputeOrchestrator {
  private readonly options: TableComputeOrchestratorOptions;
  private readonly tasks = new Map<string, ScheduledComputeDrain>();
  private readonly activeRuns = new Set<string>();
  private readonly aborters = new Map<string, AbortController>();
  private closed = false;

  constructor(options: TableComputeOrchestratorOptions) {
    this.options = options;
  }

  schedule(workspaceId: string, epoch: number, session?: AuthenticatedSession): Promise<void> {
    if (this.closed) return Promise.resolve();
    const active = this.tasks.get(workspaceId);
    if (active) {
      active.epoch = epoch;
      if (session) active.session = session;
      active.dirty = true;
      return active.task;
    }
    const scheduled: ScheduledComputeDrain = {
      epoch,
      ...(session ? { session } : {}),
      dirty: false,
      task: Promise.resolve(),
    };
    this.tasks.set(workspaceId, scheduled);
    scheduled.task = this.drainScheduled(workspaceId, scheduled);
    return scheduled.task;
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.aborters.values()) controller.abort();
    await Promise.allSettled([...this.tasks.values()].map(task => task.task));
  }

  private async drainScheduled(workspaceId: string, scheduled: ScheduledComputeDrain): Promise<void> {
    while (!this.closed) {
      scheduled.dirty = false;
      const epoch = scheduled.epoch;
      const session = scheduled.session;
      try {
        await this.drain(workspaceId, epoch, session);
      } catch {
        // The persisted queue/run state is recovered by the next schedule or room alarm.
      }
      if (!scheduled.dirty) break;
    }
    if (this.tasks.get(workspaceId) === scheduled) this.tasks.delete(workspaceId);
  }

  private async drain(workspaceId: string, epoch: number, session?: AuthenticatedSession): Promise<void> {
    if (session) await this.options.reauthenticate(session);
    const failedInThisDrain = new Set<string>();
    while (!this.closed) {
      const snapshot = await this.options.getSnapshot(workspaceId);
      if (snapshot.workspace.epoch !== epoch) return;
      const current = tableSnapshot(snapshot);
      if (!current) return;
      const { state, program } = current;
      let order: ComputeModule[];
      try {
        order = computeModuleOrder(program);
      } catch {
        return;
      }

      const interrupted = (state.computeRuns ?? []).find(run => run.status === 'running' && !this.activeRuns.has(run.runId));
      if (interrupted) {
        this.options.onWorkScheduled?.(workspaceId);
        const actorSnapshot = await this.options.getSnapshot(workspaceId, interrupted.actorId).catch(() => null);
        const module = program.modules.find(item => item.id === interrupted.moduleId);
        let plan: ComputePlan | null = null;
        if (module && actorSnapshot) plan = safePlanFor(actorSnapshot, module);
        if (actorSnapshot && plan && plan.inputHash === interrupted.inputHash
            && plan.dataRevision === interrupted.dataRevision && plan.ruleRevision === interrupted.ruleRevision
            && permittedToCompute(actorSnapshot)) {
          await this.runExisting(workspaceId, epoch, snapshot.ownerActorId, interrupted, module!, plan, session);
        } else {
          await this.update(snapshot.ownerActorId, workspaceId, interrupted.runId, 'stale');
        }
        continue;
      }

      const orphanedQueue = (state.computeRuns ?? []).find(run => run.status === 'queued' && !program.modules.some(module => module.id === run.moduleId));
      if (orphanedQueue) {
        this.options.onWorkScheduled?.(workspaceId);
        await this.update(snapshot.ownerActorId, workspaceId, orphanedQueue.runId, 'stale');
        continue;
      }

      let progressed = false;
      for (const module of order) {
        const queued = (state.computeRuns ?? []).find(run => run.moduleId === module.id && run.status === 'queued');
        if (queued) {
          this.options.onWorkScheduled?.(workspaceId);
          const actorSnapshot = await this.options.getSnapshot(workspaceId, queued.actorId).catch(() => null);
          let plan: ComputePlan | null = null;
          if (actorSnapshot) plan = safePlanFor(actorSnapshot, module);
          if (!plan) {
            await this.update(snapshot.ownerActorId, workspaceId, queued.runId, 'failed', 'COMPUTE_FAILED');
            progressed = true;
            break;
          }
          if (!actorSnapshot || !permittedToCompute(actorSnapshot)) {
            await this.update(snapshot.ownerActorId, workspaceId, queued.runId, 'failed', 'COMPUTE_FAILED');
          } else {
            await this.startAndRun(snapshot.ownerActorId, workspaceId, epoch, queued, module, plan, session);
            failedInThisDrain.add(queued.runId);
          }
          progressed = true;
          break;
        }

        const latest = (state.computeRuns ?? []).find(run => run.moduleId === module.id);
        const actorBound = module.inputs.some(input => input.binding.kind === 'actor');
        const planningSnapshot = actorBound && latest
          ? await this.options.getSnapshot(workspaceId, latest.actorId).catch(() => null)
          : snapshot;
        // A saved actor binding keeps the identity of the latest authorized requester. If that
        // member was revoked or lost compute permission, do not silently substitute the owner.
        if (!planningSnapshot || !permittedToCompute(planningSnapshot)) continue;
        const plan = safePlanFor(planningSnapshot, module);
        if (!plan) continue;
        const currentRun = currentComputeRun(program, module.id, state.computeRuns ?? [], state.dataRevision, state.ruleRevision);
        if (currentRun?.inputHash === plan.inputHash) continue;
        const failedSameInput = latest?.status === 'failed' && latest.inputHash === plan.inputHash
          && latest.moduleVersion === module.version && latest.runtimeProfile === (module.runtimeProfile ?? 'tabletop-compute-1')
          && latest.dataRevision === state.dataRevision && latest.ruleRevision === state.ruleRevision
          && (latest.errorCode !== 'COMPUTE_UNAVAILABLE' || failedInThisDrain.has(latest.runId));
        if (failedSameInput) continue;
        this.options.onWorkScheduled?.(workspaceId);
        await this.options.executeTrusted(planningSnapshot.context.actorId, workspaceId, 'table.compute.queue', {
          moduleId: module.id,
          runId: crypto.randomUUID(),
        });
        progressed = true;
        break;
      }
      if (!progressed) return;
    }
  }

  private async startAndRun(
    systemActorId: string,
    workspaceId: string,
    epoch: number,
    run: ComputeRunRecord,
    module: ComputeModule,
    plan: ComputePlan,
    session?: AuthenticatedSession,
  ): Promise<void> {
    await this.options.executeTrusted(systemActorId, workspaceId, 'table.compute.update', {
      runId: run.runId,
      status: 'running',
      inputHash: plan.inputHash,
      sourceIds: plan.sourceIds,
      inputProvenance: plan.inputProvenance,
      dataRevision: plan.dataRevision,
      ruleRevision: plan.ruleRevision,
      runtimeProfile: plan.request.runtimeProfile,
    });
    await this.runExisting(workspaceId, epoch, systemActorId, { ...run, status: 'running', inputHash: plan.inputHash }, module, plan, session);
  }

  private async runExisting(
    workspaceId: string,
    epoch: number,
    systemActorId: string,
    run: ComputeRunRecord,
    module: ComputeModule,
    plan: ComputePlan,
    session?: AuthenticatedSession,
  ): Promise<void> {
    this.activeRuns.add(run.runId);
    const controller = new AbortController();
    this.aborters.set(run.runId, controller);
    try {
      if (session && session.record.actorId === run.actorId) await this.options.reauthenticate(session);
      const authorized = await this.options.getSnapshot(workspaceId, run.actorId);
      const authorizedTable = tableSnapshot(authorized);
      const authorizedModule = authorizedTable?.program.modules.find(item => item.id === run.moduleId);
      if (!authorizedTable || !authorizedModule || !permittedToCompute(authorized)) {
        await this.update(systemActorId, workspaceId, run.runId, 'failed', 'COMPUTE_FAILED');
        return;
      }
      const authorizedPlan = safePlanFor(authorized, authorizedModule);
      if (!authorizedPlan || authorized.workspace.epoch !== epoch || authorizedModule.version !== module.version
          || authorizedPlan.inputHash !== plan.inputHash || authorizedPlan.dataRevision !== plan.dataRevision
          || authorizedPlan.ruleRevision !== plan.ruleRevision) {
        await this.update(systemActorId, workspaceId, run.runId, 'stale');
        return;
      }
      const result = await this.options.runner.run(plan.request, controller.signal);
      const checked = validateComputeOutputs(module, result);
      if (session && session.record.actorId === run.actorId) await this.options.reauthenticate(session);
      const fresh = await this.options.getSnapshot(workspaceId, run.actorId).catch(() => null);
      const current = fresh ? tableSnapshot(fresh) : null;
      const currentModule = current?.program.modules.find(item => item.id === run.moduleId);
      const currentPlan = fresh && currentModule ? safePlanFor(fresh, currentModule) : null;
      if (!fresh || fresh.workspace.epoch !== epoch || !currentModule || !currentPlan
          || currentModule.version !== module.version || !permittedToCompute(fresh)
          || currentPlan.inputHash !== plan.inputHash
          || currentPlan.dataRevision !== plan.dataRevision || currentPlan.ruleRevision !== plan.ruleRevision) {
        await this.update(systemActorId, workspaceId, run.runId, 'stale');
        return;
      }
      await this.options.executeTrusted(systemActorId, workspaceId, 'table.compute.update', {
        runId: run.runId,
        status: 'succeeded',
        outputs: Object.entries(checked.outputs).map(([outputId, value]) => ({ outputId, value })),
      });
    } catch (error) {
      await this.update(systemActorId, workspaceId, run.runId, 'failed', failureCode(error));
    } finally {
      this.aborters.delete(run.runId);
      this.activeRuns.delete(run.runId);
    }
  }

  private async update(
    actorId: string,
    workspaceId: string,
    runId: string,
    status: 'failed' | 'stale',
    errorCode?: ComputeRunRecord['errorCode'],
  ): Promise<void> {
    await this.options.executeTrusted(actorId, workspaceId, 'table.compute.update', {
      runId,
      status,
      ...(errorCode ? { errorCode } : {}),
    });
  }
}
