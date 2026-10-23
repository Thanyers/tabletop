import { COMPUTE_RUNTIME_PROFILES } from '../shared/compute-runtime-profiles';
import { isComputeTableValue, type ComputeInputPort, type ComputeModule, type ComputePortType, type ComputePortValue, type ComputeRunRecord } from '../shared/table-compute';
import type { TableState } from '../shared/table-contracts';

export function computePortTypeLabel(type: ComputePortType): string {
  return type === 'text-list' ? 'list of text' : type === 'table' ? 'table' : type === 'boolean' ? 'yes or no' : type;
}

/** A label for the configured source, never an invented copy of the resolved value. */
export function computeInputSourceLabel(
  input: ComputeInputPort,
  state: TableState,
  modules: readonly ComputeModule[],
  program = state.program,
  actor?: { actorId: string; name: string },
  members: readonly { actorId: string; name: string }[] = [],
): string {
  const binding = input.binding;
  if (binding.kind === 'literal') return `Fixed value · ${computeValueSummary(binding.value)}`;
  if (binding.kind === 'collection') {
    const collection = program?.collections.find((item) => item.id === binding.collectionId);
    if (!collection) return 'Table no longer available';
    if (!state.program?.collections.some((item) => item.id === binding.collectionId)) return `${collection.title} table · not active yet`;
    const writer = state.dataProvenance?.collections[binding.collectionId];
    const changedBy = writer ? ` · Last changed by ${provenanceActorName(writer.actorId, actor, members)}` : '';
    return `${collection.title} table · ${state.records[collection.id]?.length ?? 0} rows${changedBy}`;
  }
  if (binding.kind === 'source') {
    const source = state.sources.find((item) => item.id === binding.sourceId);
    if (!source) return 'Source file no longer available';
    const writer = state.dataProvenance?.sources[binding.sourceId];
    return `${source.filename}${writer ? ` · Added by ${provenanceActorName(writer.actorId, actor, members)}` : ''}`;
  }
  if (binding.kind === 'result') {
    const sourceModule = modules.find((item) => item.id === binding.moduleId);
    const output = sourceModule?.outputs.find((item) => item.id === binding.outputId);
    return sourceModule && output ? `${sourceModule.name} · ${output.label}` : 'Earlier result no longer available';
  }
  if (binding.kind === 'actor') return binding.property === 'role' ? 'The person running this calculation · role' : 'The person running this calculation · seat';
  return binding.property === 'dataRevision' ? 'Current table version' : 'Source files attached to this table';
}

function provenanceActorName(actorId: string, actor?: { actorId: string; name: string }, members: readonly { actorId: string; name: string }[] = []): string {
  if (actor?.actorId === actorId) return actor.name;
  return members.find((member) => member.actorId === actorId)?.name ?? 'a table member';
}

export function computeStatusLabel(status: ComputeRunRecord['status']): string {
  if (status === 'queued') return 'Waiting to run';
  if (status === 'running') return 'Running';
  if (status === 'succeeded') return 'Completed';
  if (status === 'stale') return 'Data changed during the run';
  return 'Could not complete';
}

export function computeErrorLabel(errorCode: ComputeRunRecord['errorCode']): string | null {
  if (errorCode === 'COMPUTE_UNAVAILABLE') return 'The selected runtime is not available on this table yet.';
  if (errorCode === 'COMPUTE_INVALID_OUTPUT') return 'The result did not match the output columns and types declared for this module.';
  if (errorCode === 'COMPUTE_STALE') return 'The table changed before this result could be saved. Run it again to use the latest data.';
  if (errorCode === 'COMPUTE_FAILED') return 'This calculation did not finish. Its previous successful result is still available.';
  return null;
}

export function computeValueSummary(value: ComputePortValue): string {
  if (isComputeTableValue(value)) return `${value.rows.length} ${value.rows.length === 1 ? 'row' : 'rows'}`;
  if (value === null) return 'No value';
  if (Array.isArray(value)) return `${value.length} ${value.length === 1 ? 'item' : 'items'}`;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  return value.length > 100 ? `${value.slice(0, 99)}…` : value;
}

export function computeScalarCell(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'number') return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value);
  if (typeof value === 'string') return value;
  return '—';
}

export function computeRunActorName(run: ComputeRunRecord, actor: { actorId: string; name: string }, members: readonly { actorId: string; name: string }[]): string {
  if (run.actorId === actor.actorId) return actor.name;
  return members.find((member) => member.actorId === run.actorId)?.name ?? (run.role === 'owner' ? 'Table owner' : 'A table member');
}

export function computeRunTime(run: ComputeRunRecord): string {
  const timestamp = run.completedAt ?? run.startedAt;
  return new Date(timestamp).toLocaleString();
}

export function computeRuntimeDetails(runtime: ComputeModule['runtime']): { name: string; libraries: string[] } {
  const profile = COMPUTE_RUNTIME_PROFILES[runtime];
  return { name: profile.name, libraries: [...profile.libraries] };
}

export function computeLatestRun(moduleId: string, runs: readonly ComputeRunRecord[] = [], module?: Pick<ComputeModule, 'version' | 'runtimeProfile'>): ComputeRunRecord | undefined {
  return runs.find((run) => run.moduleId === moduleId && (!module || computeRunMatchesModule(run, module)));
}

export function computeLatestSuccessfulRun(moduleId: string, runs: readonly ComputeRunRecord[] = [], module?: Pick<ComputeModule, 'version' | 'runtimeProfile'>): ComputeRunRecord | undefined {
  return runs.find((run) => run.moduleId === moduleId && (!module || computeRunMatchesModule(run, module)) && run.status === 'succeeded' && (run.outputs?.length ?? 0) > 0);
}

/** Old results stay useful after a failed run, but never after the module contract changes. */
export function computeRunMatchesModule(run: ComputeRunRecord, module: Pick<ComputeModule, 'version' | 'runtimeProfile'>): boolean {
  return run.moduleVersion === module.version && run.runtimeProfile === (module.runtimeProfile ?? 'tabletop-compute-1');
}

export function computeRunMatchesSnapshot(run: ComputeRunRecord, module: Pick<ComputeModule, 'version' | 'runtimeProfile'>, state: Pick<TableState, 'dataRevision' | 'ruleRevision'>): boolean {
  return computeRunMatchesModule(run, module) && run.dataRevision === state.dataRevision && run.ruleRevision === state.ruleRevision;
}

export function computeRunOutput(run: ComputeRunRecord | undefined, outputId: string): ComputePortValue | undefined {
  return run?.outputs?.find((output) => output.outputId === outputId)?.value;
}
