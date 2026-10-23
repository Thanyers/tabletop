import { z } from 'zod';
import type { TableField, TableRecord, TableSource, TableValue } from './table-contracts';

/** F066: supported generated code runtimes. Execution is supplied by a server adapter. */
export type ComputeRuntime = 'javascript' | 'python';
export type ComputeRuntimeProfile = 'tabletop-compute-1';
export type ComputeScalar = string | number | boolean | null | string[];
export type ComputePortType = 'text' | 'number' | 'boolean' | 'text-list' | 'table';

export interface ComputeTableColumn {
  id: string;
  label: string;
  type: 'text' | 'number' | 'boolean' | 'list';
}

export interface ComputeTableValue {
  columns: ComputeTableColumn[];
  rows: Array<Record<string, TableValue>>;
}

export type ComputePortValue = ComputeScalar | ComputeTableValue;

export type ComputeInputBinding =
  | { kind: 'literal'; value: ComputeScalar }
  | { kind: 'collection'; collectionId: string }
  | { kind: 'source'; sourceId: string }
  | { kind: 'result'; moduleId: string; outputId: string }
  | { kind: 'actor'; property: 'role' | 'seat' }
  | { kind: 'provenance'; property: 'dataRevision' | 'sourceIds' };

export interface ComputeInputPort {
  id: string;
  label: string;
  type: ComputePortType;
  binding: ComputeInputBinding;
}

export interface ComputeOutputPort {
  id: string;
  label: string;
  type: ComputePortType;
  /** Table outputs can point at an existing collection for a canvas card or a downstream module. */
  collectionId?: string;
  columns?: ComputeTableColumn[];
}

export interface ComputeModule {
  id: string;
  name: string;
  description: string;
  runtime: ComputeRuntime;
  /** Defaults to the current pinned profile for legacy definitions. */
  runtimeProfile?: ComputeRuntimeProfile;
  /** Incremented when source or port contracts change. */
  version: number;
  source: string;
  inputs: ComputeInputPort[];
  outputs: ComputeOutputPort[];
}

export interface TableComputeProgram {
  version: 1;
  modules: ComputeModule[];
}

export interface ComputeActorContext {
  role: string;
  seat: string | null;
}

export interface ComputeInputValue {
  type: ComputePortType;
  value: ComputePortValue;
}

/** The only input sent to an execution adapter. All values are resolved by the authority. */
export interface ComputeRunnerRequest {
  moduleId: string;
  moduleVersion: number;
  runtime: ComputeRuntime;
  runtimeProfile: ComputeRuntimeProfile;
  source: string;
  inputs: Record<string, ComputeInputValue>;
  outputs: ComputeOutputPort[];
}

/** Adapter output is untrusted and must pass validateComputeOutputs before persistence. */
export interface ComputeRunnerResult {
  outputs: Record<string, ComputePortValue>;
}

export interface ComputeRunner {
  run(request: ComputeRunnerRequest, signal?: AbortSignal): Promise<ComputeRunnerResult>;
}

export interface ComputeInputProvenance {
  inputId: string;
  type: ComputePortType;
  binding: ComputeInputBinding;
  sourceIds: string[];
  upstreamRunId?: string;
}

export interface ComputeRunOutput {
  outputId: string;
  value: ComputePortValue;
}

export interface ComputeRunRecord {
  runId: string;
  moduleId: string;
  moduleVersion: number;
  inputHash?: string;
  sourceIds?: string[];
  inputProvenance?: ComputeInputProvenance[];
  dataRevision?: number;
  ruleRevision?: number;
  runtimeProfile: ComputeRuntimeProfile;
  actorId: string;
  role: string;
  seat: string | null;
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'stale';
  startedAt: number;
  completedAt?: number;
  outputs?: ComputeRunOutput[];
  errorCode?: 'COMPUTE_UNAVAILABLE' | 'COMPUTE_FAILED' | 'COMPUTE_INVALID_OUTPUT' | 'COMPUTE_STALE';
}

export const COMPUTE_LIMITS = {
  modules: 12,
  portsPerModule: 8,
  sourceBytes: 24 * 1024,
  inputBytes: 64 * 1024,
  outputBytes: 64 * 1024,
  runHistory: 24,
  outputsPerModule: 8,
  tableColumns: 32,
  tableRows: 500,
  textChars: 16 * 1024,
} as const;

export const computeModuleIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u);
const idSchema = computeModuleIdSchema;
const safeTextSchema = z.string().min(1).max(500)
  .refine(value => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(value));
const computeValueSchema: z.ZodType<ComputeScalar> = z.union([
  z.string().max(COMPUTE_LIMITS.textChars),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.string().max(500)).max(COMPUTE_LIMITS.tableRows),
]);

const computeTableColumnSchema: z.ZodType<ComputeTableColumn> = z.strictObject({
  id: idSchema,
  label: safeTextSchema,
  type: z.enum(['text', 'number', 'boolean', 'list']),
});

const computeTableValueSchema: z.ZodType<ComputeTableValue> = z.strictObject({
  columns: z.array(computeTableColumnSchema).min(1).max(COMPUTE_LIMITS.tableColumns),
  rows: z.array(z.record(idSchema, z.union([
    z.string().max(COMPUTE_LIMITS.textChars),
    z.number().finite(), z.boolean(), z.null(), z.array(z.string().max(500)).max(COMPUTE_LIMITS.tableRows),
  ]))).max(COMPUTE_LIMITS.tableRows),
}).superRefine((table, context) => {
  const ids = new Set<string>();
  for (const [index, column] of table.columns.entries()) {
    if (ids.has(column.id)) context.addIssue({ code: 'custom', path: ['columns', index, 'id'], message: 'Table column identifiers must be unique.' });
    ids.add(column.id);
  }
  for (const [rowIndex, row] of table.rows.entries()) {
    for (const key of Object.keys(row)) {
      if (!ids.has(key)) context.addIssue({ code: 'custom', path: ['rows', rowIndex, key], message: 'A result row refers to an unknown column.' });
    }
  }
});

export const computePortTypeSchema: z.ZodType<ComputePortType> = z.enum(['text', 'number', 'boolean', 'text-list', 'table']);
export const computePortValueSchema: z.ZodType<ComputePortValue> = z.union([computeValueSchema, computeTableValueSchema]);

export const computeInputBindingSchema: z.ZodType<ComputeInputBinding> = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('literal'), value: computeValueSchema }),
  z.strictObject({ kind: z.literal('collection'), collectionId: idSchema }),
  z.strictObject({ kind: z.literal('source'), sourceId: z.string().min(1).max(100) }),
  z.strictObject({ kind: z.literal('result'), moduleId: idSchema, outputId: idSchema }),
  z.strictObject({ kind: z.literal('actor'), property: z.enum(['role', 'seat']) }),
  z.strictObject({ kind: z.literal('provenance'), property: z.enum(['dataRevision', 'sourceIds']) }),
]);

export const computeInputPortSchema: z.ZodType<ComputeInputPort> = z.strictObject({
  id: idSchema,
  label: safeTextSchema,
  type: computePortTypeSchema,
  binding: computeInputBindingSchema,
});

export const computeOutputPortSchema: z.ZodType<ComputeOutputPort> = z.strictObject({
  id: idSchema,
  label: safeTextSchema,
  type: computePortTypeSchema,
  collectionId: idSchema.optional(),
  columns: z.array(computeTableColumnSchema).min(1).max(COMPUTE_LIMITS.tableColumns).optional(),
}).superRefine((output, context) => {
  if (output.type === 'table' && !output.columns) {
    context.addIssue({ code: 'custom', path: ['columns'], message: 'Table outputs require a declared column schema.' });
  }
  if (output.type !== 'table' && (output.columns !== undefined || output.collectionId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Only table outputs can declare columns or bind to a collection.' });
  }
});

export const computeModuleSchema: z.ZodType<ComputeModule> = z.strictObject({
  id: idSchema,
  name: safeTextSchema,
  description: safeTextSchema,
  runtime: z.enum(['javascript', 'python']),
  runtimeProfile: z.literal('tabletop-compute-1').optional(),
  version: z.number().int().positive(),
  source: z.string().min(1).max(COMPUTE_LIMITS.sourceBytes),
  inputs: z.array(computeInputPortSchema).max(COMPUTE_LIMITS.portsPerModule),
  outputs: z.array(computeOutputPortSchema).min(1).max(COMPUTE_LIMITS.outputsPerModule),
});

export const tableComputeProgramSchema: z.ZodType<TableComputeProgram> = z.strictObject({
  version: z.literal(1),
  modules: z.array(computeModuleSchema).max(COMPUTE_LIMITS.modules),
});

export const computeRunRecordSchema: z.ZodType<ComputeRunRecord> = z.strictObject({
  runId: z.string().uuid(),
  moduleId: idSchema,
  moduleVersion: z.number().int().positive(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  sourceIds: z.array(z.string().min(1).max(100)).max(4).optional(),
  inputProvenance: z.array(z.strictObject({
    inputId: idSchema,
    type: computePortTypeSchema,
    binding: computeInputBindingSchema,
    sourceIds: z.array(z.string().min(1).max(100)).max(4),
    upstreamRunId: z.string().uuid().optional(),
  })).max(COMPUTE_LIMITS.portsPerModule).optional(),
  dataRevision: z.number().int().nonnegative().optional(),
  ruleRevision: z.number().int().nonnegative().optional(),
  runtimeProfile: z.literal('tabletop-compute-1'),
  actorId: z.string().min(1).max(160),
  role: z.string().min(1).max(40),
  seat: z.string().max(40).nullable(),
  status: z.enum(['queued', 'running', 'succeeded', 'failed', 'stale']),
  startedAt: z.number().int().nonnegative(),
  completedAt: z.number().int().nonnegative().optional(),
  outputs: z.array(z.strictObject({ outputId: idSchema, value: computePortValueSchema })).max(COMPUTE_LIMITS.outputsPerModule).optional(),
  errorCode: z.enum(['COMPUTE_UNAVAILABLE', 'COMPUTE_FAILED', 'COMPUTE_INVALID_OUTPUT', 'COMPUTE_STALE']).optional(),
});

export const computeRunInputSchema = z.strictObject({
  runId: z.string().uuid(),
  moduleId: idSchema,
  moduleVersion: z.number().int().positive(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export interface ComputeGraphProblem {
  code: 'COMPUTE_SCHEMA' | 'COMPUTE_CYCLE' | 'COMPUTE_BINDING';
  message: string;
}

function typeOfScalar(value: ComputeScalar): Exclude<ComputePortType, 'table'> {
  if (value === null || typeof value === 'string') return 'text';
  if (Array.isArray(value)) return 'text-list';
  return typeof value === 'number' ? 'number' : 'boolean';
}

function portCompatible(actual: ComputePortType, expected: ComputePortType): boolean {
  return actual === expected;
}

function collectionTable(collection: { fields: TableField[] }, records: readonly TableRecord[]): ComputeTableValue {
  return {
    columns: collection.fields.map(field => ({ id: field.id, label: field.label, type: field.type })),
    rows: records.map(record => structuredClone(record.values)),
  };
}

export interface ComputeBindingContext {
  collections: ReadonlyArray<{ id: string; fields: TableField[] }>;
  records: Record<string, TableRecord[]>;
  sources: readonly TableSource[];
  outputs: ReadonlyMap<string, ComputePortValue>;
  /** Current modules, used to distinguish raw collections from compute-owned derived collections. */
  program?: TableComputeProgram;
  derivedCollections?: ReadonlyMap<string, ComputeTableValue>;
  actor: ComputeActorContext;
  dataRevision: number;
}

export function resolveComputeInput(port: ComputeInputPort, context: ComputeBindingContext): ComputePortValue {
  const binding = port.binding;
  let value: ComputePortValue;
  if (binding.kind === 'literal') value = structuredClone(binding.value);
  else if (binding.kind === 'collection') {
    const collection = context.collections.find(item => item.id === binding.collectionId);
    if (!collection) throw new Error('COMPUTE_BINDING');
    const hasComputeWriter = context.program?.modules.some(module =>
      module.outputs.some(output => output.collectionId === collection.id)) ?? false;
    const derived = context.derivedCollections?.get(collection.id);
    if (hasComputeWriter && !derived) throw new Error('COMPUTE_BINDING');
    value = derived ?? collectionTable(collection, context.records[collection.id] ?? []);
  } else if (binding.kind === 'source') {
    const source = context.sources.find(item => item.id === binding.sourceId);
    if (!source) throw new Error('COMPUTE_BINDING');
    value = source.text;
  } else if (binding.kind === 'result') {
    const key = `${binding.moduleId}.${binding.outputId}`;
    const result = context.outputs.get(key);
    if (result === undefined) throw new Error('COMPUTE_BINDING');
    value = structuredClone(result);
  } else if (binding.kind === 'actor') {
    value = binding.property === 'role' ? context.actor.role : context.actor.seat;
  } else {
    value = binding.property === 'dataRevision' ? context.dataRevision : context.sources.map(source => source.id);
  }
  const actualType = isComputeTableValue(value) ? 'table' : typeOfScalar(value);
  if (!portCompatible(actualType, port.type)) throw new Error('COMPUTE_BINDING');
  return value;
}

export function isComputeTableValue(value: ComputePortValue): value is ComputeTableValue {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'columns' in value && 'rows' in value;
}

export function computeModuleOrder(program: TableComputeProgram): ComputeModule[] {
  const modules = new Map(program.modules.map(module => [module.id, module]));
  const collectionWriters = new Map<string, ComputeModule>();
  for (const module of program.modules) {
    for (const output of module.outputs) {
      if (!output.collectionId) continue;
      if (collectionWriters.has(output.collectionId)) throw new Error('COMPUTE_COLLECTION_WRITER');
      collectionWriters.set(output.collectionId, module);
    }
  }
  const visited = new Set<string>();
  const active = new Set<string>();
  const ordered: ComputeModule[] = [];
  const visit = (module: ComputeModule): void => {
    if (visited.has(module.id)) return;
    if (active.has(module.id)) throw new Error('COMPUTE_CYCLE');
    active.add(module.id);
    for (const input of module.inputs) {
      const dependency = input.binding.kind === 'result'
        ? modules.get(input.binding.moduleId)
        : input.binding.kind === 'collection' ? collectionWriters.get(input.binding.collectionId) : undefined;
      if (dependency) visit(dependency);
    }
    active.delete(module.id);
    visited.add(module.id);
    ordered.push(module);
  };
  for (const module of program.modules) visit(module);
  return ordered;
}

export function currentComputeRun(
  program: TableComputeProgram,
  moduleId: string,
  runs: readonly ComputeRunRecord[],
  dataRevision: number,
  ruleRevision: number,
): ComputeRunRecord | undefined {
  const module = program.modules.find(item => item.id === moduleId);
  if (!module) return undefined;
  const profile = module.runtimeProfile ?? 'tabletop-compute-1';
  return runs.find(run => run.moduleId === module.id && run.status === 'succeeded'
    && run.moduleVersion === module.version && run.runtimeProfile === profile
    && run.dataRevision === dataRevision && run.ruleRevision === ruleRevision);
}

/** Latest successful, schema-checked table outputs for collection cards that are current to this snapshot. */
export function computeDerivedCollections(
  program: TableComputeProgram,
  runs: readonly ComputeRunRecord[],
  dataRevision: number,
  ruleRevision: number,
): Map<string, ComputeTableValue> {
  const derived = new Map<string, ComputeTableValue>();
  for (const module of program.modules) {
    const run = currentComputeRun(program, module.id, runs, dataRevision, ruleRevision);
    if (!run) continue;
    try {
      const validated = validateComputeOutputs(module, {
        outputs: Object.fromEntries((run.outputs ?? []).map(output => [output.outputId, output.value])),
      });
      for (const output of module.outputs) {
        if (!output.collectionId) continue;
        const value = validated.outputs[output.id];
        if (value && isComputeTableValue(value)) derived.set(output.collectionId, value);
      }
    } catch {
      // Persisted run records remain untrusted at read boundaries; an invalid result is unavailable.
    }
  }
  return derived;
}

export function computeProgramProblems(
  program: TableComputeProgram,
  collections: ReadonlyArray<{ id: string; fields: TableField[] }>,
  sources?: readonly TableSource[],
): ComputeGraphProblem[] {
  const problems: ComputeGraphProblem[] = [];
  const collectionWriters = new Map<string, string>();
  const moduleIds = new Set<string>();
  const moduleById = new Map<string, ComputeModule>();
  for (const module of program.modules) {
    if (moduleIds.has(module.id)) problems.push({ code: 'COMPUTE_SCHEMA', message: 'Compute module identifiers must be unique.' });
    moduleIds.add(module.id);
    moduleById.set(module.id, module);
    if (new TextEncoder().encode(module.source).byteLength > COMPUTE_LIMITS.sourceBytes) {
      problems.push({ code: 'COMPUTE_SCHEMA', message: `${module.name} exceeds the source size limit.` });
    }
    if (new Set(module.inputs.map(port => port.id)).size !== module.inputs.length
        || new Set(module.outputs.map(port => port.id)).size !== module.outputs.length) {
      problems.push({ code: 'COMPUTE_SCHEMA', message: `${module.name} has duplicate port identifiers.` });
    }
  }
  for (const module of program.modules) {
    for (const input of module.inputs) {
      const binding = input.binding;
      if (binding.kind === 'literal') {
        if (typeOfScalar(binding.value) !== input.type) problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} has a literal with the wrong type.` });
      } else if (binding.kind === 'collection') {
        const collection = collections.find(item => item.id === binding.collectionId);
        if (!collection || input.type !== 'table') problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} must bind to an existing collection as a table.` });
      } else if (binding.kind === 'source') {
        if ((sources && !sources.some(source => source.id === binding.sourceId)) || input.type !== 'text') problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} must bind to an existing source as text.` });
      } else if (binding.kind === 'result') {
        const upstream = moduleById.get(binding.moduleId);
        const output = upstream?.outputs.find(item => item.id === binding.outputId);
        if (!upstream || !output || !portCompatible(output.type, input.type)) {
          problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} refers to an incompatible compute output.` });
        }
      } else if (binding.kind === 'actor') {
        if (input.type !== 'text') problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} must bind actor role or seat as text.` });
      } else if ((binding.property === 'dataRevision' && input.type !== 'number')
          || (binding.property === 'sourceIds' && input.type !== 'text-list')) {
        problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${input.label} has a provenance binding with the wrong type.` });
      }
    }
    for (const output of module.outputs) {
      if (output.collectionId) {
        const writer = collectionWriters.get(output.collectionId);
        if (writer) problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${output.label} shares a derived collection with another compute rule.` });
        else collectionWriters.set(output.collectionId, module.id);
      }
      if (output.type === 'table') {
        if (!output.columns || new Set(output.columns.map(column => column.id)).size !== output.columns.length) {
          problems.push({ code: 'COMPUTE_SCHEMA', message: `${module.name}.${output.label} needs unique declared table columns.` });
        }
        if (output.collectionId) {
          const collection = collections.find(item => item.id === output.collectionId);
          const outputSchema = output.columns?.map(column => ({ id: column.id, type: column.type }));
          const targetSchema = collection?.fields.map(field => ({ id: field.id, type: field.type }));
          if (!collection || JSON.stringify(outputSchema) !== JSON.stringify(targetSchema)) {
            problems.push({ code: 'COMPUTE_BINDING', message: `${module.name}.${output.label} does not match its target collection.` });
          }
        }
      }
    }
  }
  try {
    computeModuleOrder(program);
  } catch (error) {
    problems.push(error instanceof Error && error.message === 'COMPUTE_COLLECTION_WRITER'
      ? { code: 'COMPUTE_BINDING', message: 'Only one compute rule can write to a derived collection.' }
      : { code: 'COMPUTE_CYCLE', message: 'Compute modules cannot depend on one another in a cycle.' });
  }
  return problems;
}

export function validateComputeOutputs(
  module: ComputeModule,
  raw: unknown,
): ComputeRunnerResult {
  const resultSchema = z.strictObject({ outputs: z.record(idSchema, computePortValueSchema) });
  const parsed = resultSchema.safeParse(raw);
  if (!parsed.success) throw new Error('COMPUTE_INVALID_OUTPUT');
  const declared = new Map(module.outputs.map(output => [output.id, output]));
  if (Object.keys(parsed.data.outputs).length !== declared.size) throw new Error('COMPUTE_INVALID_OUTPUT');
  for (const [outputId, value] of Object.entries(parsed.data.outputs)) {
    const output = declared.get(outputId);
    if (!output) throw new Error('COMPUTE_INVALID_OUTPUT');
    const actualType = isComputeTableValue(value) ? 'table' : typeOfScalar(value);
    if (actualType !== output.type) throw new Error('COMPUTE_INVALID_OUTPUT');
    if (isComputeTableValue(value)) {
      const expected = output.columns?.map(column => ({ id: column.id, type: column.type }));
      const actual = value.columns.map(column => ({ id: column.id, type: column.type }));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('COMPUTE_INVALID_OUTPUT');
      for (const row of value.rows) {
        for (const column of value.columns) {
          const cell = row[column.id];
          if (cell === undefined || !matchesColumnType(column, cell)) throw new Error('COMPUTE_INVALID_OUTPUT');
        }
      }
    }
  }
  if (new TextEncoder().encode(JSON.stringify(parsed.data.outputs)).byteLength > COMPUTE_LIMITS.outputBytes) {
    throw new Error('COMPUTE_INVALID_OUTPUT');
  }
  return parsed.data;
}

function matchesColumnType(column: ComputeTableColumn, value: TableValue): boolean {
  if (value === null) return true;
  if (column.type === 'list') return Array.isArray(value);
  if (Array.isArray(value)) return false;
  if (column.type === 'text') return typeof value === 'string';
  if (column.type === 'number') return typeof value === 'number';
  return typeof value === 'boolean';
}
