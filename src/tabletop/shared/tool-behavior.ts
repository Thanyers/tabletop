import { z } from 'zod';
import {
  TOOL_PACKAGE_LIMITS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  toolWriteDeclarationSchema,
  type ToolPackageRuntimeProfile,
  type ToolWriteDeclaration,
} from './tool-package';

/**
 * F080 slice C2: the contract between the host and a tool behaviour runner.
 *
 * A behaviour is untrusted code. It receives only the declared inputs, runs in an isolate with
 * no bindings and no outbound network, and everything it proposes is checked here against the
 * behaviour's write declarations and the target resource schema before a single row may be
 * committed. "Zero writes unless declared" is enforced by {@link validateToolBehaviorOutput},
 * not by trusting the module.
 *
 * This module is deliberately a leaf (zod + the package contract) so the browser, the Node
 * server, the Worker and both runners share one definition of the wire.
 */

export const TOOL_BEHAVIOR_LIMITS = {
  /** Bytes of serialised output a behaviour may return before the host refuses it. */
  maxOutputBytes: 64 * 1024,
  /** Proposed changes one run may carry. */
  maxChanges: 200,
  /** Wall clock the host allows one run, including isolate start. */
  timeoutMs: 5_000,
  /** Characters of compiled module source the sandbox will load. */
  maxModuleChars: 120_000,
} as const;

/** A behaviour input value: the same scalars the package may declare, never a record or array. */
export type ToolBehaviorInputValue = string | number | boolean;

/** A cell a behaviour may propose. `null` clears a field; `undefined` is not expressible on the wire. */
export type ToolBehaviorValue = string | number | boolean | null;

export type ToolBehaviorFieldType = 'text' | 'number' | 'boolean' | 'list';

export interface ToolBehaviorField {
  id: string;
  type: ToolBehaviorFieldType;
}

/** The writable field allowlist of one resource, as the authority resolved it for this run. */
export interface ToolBehaviorResourceSchema {
  fields: ToolBehaviorField[];
}

export type ToolBehaviorResourceSchemaMap = Record<string, ToolBehaviorResourceSchema>;

/** `self` = the workspace the instance lives in; otherwise an `in` port bound to a connection. */
export type ToolBehaviorTarget = 'self' | string;

export type ToolBehaviorOperation = 'create' | 'update' | 'delete';

/**
 * One change a behaviour proposes. `rowId` identifies an existing row for `update`/`delete`;
 * `values` carries the cells for `create`/`update`. The two are never both present.
 */
export interface ToolBehaviorProposedChange {
  target: ToolBehaviorTarget;
  resource: string;
  operation: ToolBehaviorOperation;
  rowId?: string;
  values?: Record<string, ToolBehaviorValue>;
}

/** Everything a runner needs, and nothing else: no database, no actor, no secret. */
export interface ToolBehaviorRequest {
  packageId: string;
  packageVersion: number;
  contentHash: string;
  runtimeProfile: ToolPackageRuntimeProfile;
  /** Compiled ES module for the package's behaviour entry (local helpers already bundled). */
  moduleSource: string;
  /** Exported function name inside that module. */
  entry: string;
  inputs: Record<string, ToolBehaviorInputValue>;
  declaredWrites: ToolWriteDeclaration[];
  /** Field allowlist per resource a declaration may write. */
  resourceSchema: ToolBehaviorResourceSchemaMap;
  /** The revisions the caller authorized; a behaviour may read them but never change them. */
  expected: { instanceRevision: number; grantVersion: number };
}

/** D-039: a behaviour may propose one declared action instead of (or with) row changes. */
export interface ToolBehaviorProposal {
  actionId: string;
  inputs: Record<string, string | number | boolean>;
}

/** Runner output is untrusted: it must pass {@link validateToolBehaviorOutput} before commit. */
export interface ToolBehaviorResult {
  output: ToolBehaviorProposedChange[];
  /**
   * D-039: the action this run wants the authority to perform. Until this channel existed the
   * proposal had to be built by the caller, so no real behaviour could produce one.
   */
  proposal?: ToolBehaviorProposal;
}

/** The adapter both hosts implement; one fresh isolate per `run`. */
export interface ToolBehaviorRunner {
  run(request: ToolBehaviorRequest, signal?: AbortSignal): Promise<ToolBehaviorResult>;
}

/** The stable codes a run can fail with; they match `TOOL_INTENT_REJECTIONS` in the protocol. */
export type ToolBehaviorErrorCode =
  | 'TOOL_BEHAVIOR_FAILED'
  | 'TOOL_BEHAVIOR_TIMEOUT'
  | 'TOOL_OUTPUT_INVALID'
  | 'TOOL_BEHAVIOR_UNAVAILABLE';

/**
 * A typed runner failure. The message is the code, so a caller can branch on `error.code`
 * without parsing prose, and no input, module source or stack detail leaks into a log line.
 */
export class ToolBehaviorRunError extends Error {
  readonly code: ToolBehaviorErrorCode;

  constructor(code: ToolBehaviorErrorCode, options?: { cause?: unknown }) {
    super(code, options);
    this.name = 'ToolBehaviorRunError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------------------------------------
 * Wire schemas.
 * ---------------------------------------------------------------------------------------------- */

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u, 'Use lowercase letters, digits and dashes, starting with a letter.');
const entrySchema = z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/u, 'Use an exported function name.');
const rowIdSchema = z.string().min(1).max(80);
const valueSchema: z.ZodType<ToolBehaviorValue> = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const inputValueSchema: z.ZodType<ToolBehaviorInputValue> = z.union([z.string().max(2_000), z.number().finite(), z.boolean()]);

const fieldSchema: z.ZodType<ToolBehaviorField> = z.strictObject({
  id: idSchema,
  type: z.enum(['text', 'number', 'boolean', 'list']),
});

const resourceSchema: z.ZodType<ToolBehaviorResourceSchema> = z.strictObject({
  // A resource is projected through a package port, so its allowlist shares the port ceiling.
  fields: z.array(fieldSchema).max(TOOL_PACKAGE_LIMITS.maxPortFields),
});

export const toolBehaviorProposedChangeSchema: z.ZodType<ToolBehaviorProposedChange> = z.strictObject({
  target: z.union([z.literal('self'), idSchema]),
  resource: idSchema,
  operation: z.enum(['create', 'update', 'delete']),
  rowId: rowIdSchema.optional(),
  values: z.record(idSchema, valueSchema).optional(),
});

export const toolBehaviorProposalSchema: z.ZodType<ToolBehaviorProposal> = z.strictObject({
  actionId: z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/u),
  inputs: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,39}$/u), inputValueSchema),
});

export const toolBehaviorResultSchema: z.ZodType<ToolBehaviorResult> = z.strictObject({
  output: z.array(toolBehaviorProposedChangeSchema).max(TOOL_BEHAVIOR_LIMITS.maxChanges),
  proposal: toolBehaviorProposalSchema.optional(),
});

export const toolBehaviorRequestSchema: z.ZodType<ToolBehaviorRequest> = z.strictObject({
  packageId: idSchema,
  packageVersion: z.number().int().positive().max(10_000),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  runtimeProfile: z.literal(TOOL_PACKAGE_RUNTIME_PROFILE),
  moduleSource: z.string().min(1).max(TOOL_BEHAVIOR_LIMITS.maxModuleChars),
  entry: entrySchema,
  inputs: z.record(idSchema, inputValueSchema),
  declaredWrites: z.array(toolWriteDeclarationSchema).max(TOOL_PACKAGE_LIMITS.maxWritesPerBehavior),
  resourceSchema: z.record(idSchema, resourceSchema),
  expected: z.strictObject({
    instanceRevision: z.number().int().nonnegative(),
    grantVersion: z.number().int().nonnegative(),
  }),
}).superRefine((request, context) => {
  if (Object.keys(request.inputs).length > TOOL_PACKAGE_LIMITS.maxBehaviorInputs) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: `At most ${TOOL_PACKAGE_LIMITS.maxBehaviorInputs} inputs.` });
  }
  // Two declarations for one target/resource would make "how many rows may this run write?"
  // ambiguous, so the row budget must be answerable from exactly one declaration.
  const seen = new Set<string>();
  for (const [index, write] of request.declaredWrites.entries()) {
    const key = `${write.target}\u0000${write.resource}`;
    if (seen.has(key)) {
      context.addIssue({ code: 'custom', path: ['declaredWrites', index], message: 'Declare one write per target and resource.' });
    }
    seen.add(key);
  }
  for (const [resourceId, schema] of Object.entries(request.resourceSchema)) {
    const fields = new Set(schema.fields.map(field => field.id));
    if (fields.size !== schema.fields.length) {
      context.addIssue({ code: 'custom', path: ['resourceSchema', resourceId, 'fields'], message: 'Field ids must be unique.' });
    }
  }
});

/* ------------------------------------------------------------------------------------------------
 * Untrusted output.
 * ---------------------------------------------------------------------------------------------- */

export type ToolBehaviorOutputProblemCode = 'TOOL_OUTPUT_INVALID' | 'TOOL_WRITE_OUT_OF_SCOPE';

export type ToolBehaviorOutputValidation =
  | { ok: true; changes: ToolBehaviorProposedChange[]; proposal?: ToolBehaviorProposal }
  | { ok: false; code: ToolBehaviorOutputProblemCode; problems: string[] };

interface OutputProblem {
  code: ToolBehaviorOutputProblemCode;
  message: string;
}

/**
 * True when a proposed cell can be stored in a field of that type.
 *
 * `null` is always allowed: it clears a field rather than inventing a value. A `list` field
 * cannot carry a scalar, and this wire has no array cells, so a behaviour can only clear one.
 */
function valueMatchesField(type: ToolBehaviorFieldType, value: ToolBehaviorValue): boolean {
  if (value === null) return true;
  if (type === 'text') return typeof value === 'string';
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return false;
}

function serialisedBytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

/**
 * Check one run's proposed changes against the behaviour's declarations.
 *
 * Rejections are classified so the caller can answer with the same code the frame sees:
 * a write that was never declared (`TOOL_WRITE_OUT_OF_SCOPE`) is a refused authorization,
 * while a malformed or mistyped change (`TOOL_OUTPUT_INVALID`) is a refused shape. When both
 * appear in one run, scope wins: the security-relevant refusal is the one reported.
 *
 * Nothing here is best-effort: on `ok: false` no change list is returned, so a caller cannot
 * accidentally commit the valid prefix of a rejected run.
 */
export function validateToolBehaviorOutput(result: unknown, request: ToolBehaviorRequest): ToolBehaviorOutputValidation {
  const problems: OutputProblem[] = [];
  const reject = (code: ToolBehaviorOutputProblemCode, message: string): void => { problems.push({ code, message }); };
  const conclude = (): ToolBehaviorOutputValidation => {
    const code: ToolBehaviorOutputProblemCode = problems.some(problem => problem.code === 'TOOL_WRITE_OUT_OF_SCOPE')
      ? 'TOOL_WRITE_OUT_OF_SCOPE'
      : 'TOOL_OUTPUT_INVALID';
    return { ok: false, code, problems: problems.map(problem => problem.message) };
  };

  if (typeof result !== 'object' || result === null || Array.isArray(result)) {
    return { ok: false, code: 'TOOL_OUTPUT_INVALID', problems: ['output: a behaviour result is an object with an output array.'] };
  }
  const raw = result as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (key !== 'output' && key !== 'proposal') reject('TOOL_OUTPUT_INVALID', `output: unexpected key "${key}".`);
  }
  // D-039: a proposal is optional and is checked again by `planToolBehaviorAction`; here it only has
  // to be well formed, so a run cannot smuggle an arbitrary object into the commit path.
  let proposal: ToolBehaviorProposal | undefined;
  if (raw.proposal !== undefined) {
    const parsedProposal = toolBehaviorProposalSchema.safeParse(raw.proposal);
    if (!parsedProposal.success) {
      for (const issue of parsedProposal.error.issues) {
        reject('TOOL_OUTPUT_INVALID', `proposal.${issue.path.join('.')}: ${issue.message}`);
      }
    } else {
      proposal = parsedProposal.data;
    }
  }
  if (!Array.isArray(raw.output)) {
    reject('TOOL_OUTPUT_INVALID', 'output: the changes must be an array.');
    return conclude();
  }
  if (raw.output.length > TOOL_BEHAVIOR_LIMITS.maxChanges) {
    reject('TOOL_OUTPUT_INVALID', `output: ${raw.output.length} changes exceeds the limit of ${TOOL_BEHAVIOR_LIMITS.maxChanges}.`);
    return conclude();
  }

  const declarations = new Map(request.declaredWrites.map(write => [`${write.target}\u0000${write.resource}`, write]));
  const rowCounts = new Map<string, number>();
  const changes: ToolBehaviorProposedChange[] = [];

  // `for..of entries()` visits holes in a sparse array as `undefined`, which the schema then
  // rejects; `forEach` would silently skip them and accept a shorter change list.
  for (const [index, entry] of raw.output.entries()) {
    const path = `output.${index}`;
    const parsed = toolBehaviorProposedChangeSchema.safeParse(entry);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        reject('TOOL_OUTPUT_INVALID', `${path}${issue.path.length ? `.${issue.path.join('.')}` : ''}: ${issue.message}`);
      }
      continue;
    }
    const change = parsed.data;
    const key = `${change.target}\u0000${change.resource}`;
    const declaration = declarations.get(key);
    if (!declaration) {
      reject('TOOL_WRITE_OUT_OF_SCOPE', `${path}: the behaviour did not declare a write to ${change.target}/${change.resource}.`);
      continue;
    }
    if (!declaration.operations.includes(change.operation)) {
      reject('TOOL_WRITE_OUT_OF_SCOPE', `${path}: the declaration for ${change.target}/${change.resource} does not allow ${change.operation}.`);
      continue;
    }
    const rows = (rowCounts.get(key) ?? 0) + 1;
    rowCounts.set(key, rows);
    if (rows > declaration.maxRows) {
      reject('TOOL_WRITE_OUT_OF_SCOPE', `${path}: the declaration for ${change.target}/${change.resource} allows ${declaration.maxRows} rows.`);
      continue;
    }

    // Shape per operation: a create has no row id, an update names a row and writes cells, and
    // a delete names a row and writes nothing. Mixing either way is a malformed proposal.
    if (change.operation === 'create') {
      if (change.rowId !== undefined) reject('TOOL_OUTPUT_INVALID', `${path}: a create must not name a rowId.`);
    } else if (change.rowId === undefined) {
      reject('TOOL_OUTPUT_INVALID', `${path}: a ${change.operation} must name a rowId.`);
    }
    if (change.operation === 'delete') {
      if (change.values !== undefined) reject('TOOL_OUTPUT_INVALID', `${path}: a delete must not carry values.`);
    } else if (!change.values || Object.keys(change.values).length === 0) {
      reject('TOOL_OUTPUT_INVALID', `${path}: a ${change.operation} must carry at least one value.`);
    }

    if (change.values) {
      const schema = request.resourceSchema[change.resource];
      if (!schema) {
        reject('TOOL_OUTPUT_INVALID', `${path}: the request declares no schema for ${change.resource}.`);
        continue;
      }
      for (const [fieldId, value] of Object.entries(change.values)) {
        const field = schema.fields.find(candidate => candidate.id === fieldId);
        if (!field) {
          reject('TOOL_WRITE_OUT_OF_SCOPE', `${path}.values: "${fieldId}" is not a declared field of ${change.resource}.`);
          continue;
        }
        if (!valueMatchesField(field.type, value)) {
          reject('TOOL_OUTPUT_INVALID', `${path}.values.${fieldId}: the value does not match the ${field.type} field type.`);
        }
      }
    }

    changes.push(change);
  }

  if (problems.length > 0) return conclude();
  const shaped = proposal === undefined ? { output: changes } : { output: changes, proposal };
  if (serialisedBytes(shaped) > TOOL_BEHAVIOR_LIMITS.maxOutputBytes) {
    return { ok: false, code: 'TOOL_OUTPUT_INVALID', problems: [`output: the changes exceed ${TOOL_BEHAVIOR_LIMITS.maxOutputBytes} bytes.`] };
  }
  return proposal === undefined ? { ok: true, changes } : { ok: true, changes, proposal };
}

const toolBehaviorWireSchema = z.strictObject({ changes: z.array(z.unknown()), proposal: z.unknown().optional() });

/**
 * Read the body a sandbox produced. The runner has already byte-capped it, but the wire is
 * still untrusted: JSON, the `{ changes }` envelope and every change are re-validated here so
 * a caller can never receive a `ToolBehaviorResult` the schema would not accept.
 */
export function readToolBehaviorResult(body: string): ToolBehaviorResult {
  if (new TextEncoder().encode(body).byteLength > TOOL_BEHAVIOR_LIMITS.maxOutputBytes) {
    throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
  }
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
  }
  const wire = toolBehaviorWireSchema.safeParse(value);
  if (!wire.success) throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
  const parsed = toolBehaviorResultSchema.safeParse({
    output: wire.data.changes,
    ...(wire.data.proposal === undefined ? {} : { proposal: wire.data.proposal }),
  });
  if (!parsed.success) throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
  return parsed.data;
}
