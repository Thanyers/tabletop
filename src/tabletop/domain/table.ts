import { z } from 'zod';
import { DomainError, SEATS, TABLE_TURN_SEATS, TABLE_TURN_SEAT_PATTERN, type ActorContext, type Seat } from '../shared/contracts';
import type { TableAction, TableChange, TableField, TableOperand, TableProgram, TableRecord, TableState, TableValue, TableSource } from '../shared/table-contracts';
import { GENERATIVE_FORBIDDEN_IDENTIFIERS, type GenerativeExpression, type GenerativeOutput, type GenerativeScalar } from '../shared/generative-contracts';
import { ROLL_LIMITS, rollSpecProblems, type RollGroup, type RollSpec, type RollResult, type TablePendingRoll } from '../shared/roll';
import { assert, canonicalJson, hasRole, requirePermission, ID_SCHEMA, parsePayload } from './helpers';
import { liveCanvasCardIds, pruneCardMeta, touchCardMeta } from './table-card-meta';
import { assertPendingRoll, consumePendingRolls, createRoll, retainPendingRolls } from './roll';
import { createGenerativeExpressionSession, evaluateGenerativeCanvas } from '../runtime/generative/evaluator';
import { generativeCanvasSchema, generativeExpressionSchema } from '../runtime/generative/schema';
import { expressionWithinBounds, getGenerativeExpressionType, validateGenerativeProgram } from '../runtime/generative/validation';
import { preserveCanvasViews } from '../runtime/generative/preserve';
import { IMAGE_ID_PATTERN, MAX_TABLE_IMAGES } from '../shared/canvas-images';
import { MAX_COMPUTED_COLUMNS, computedColumnProblems, retainComputedColumns } from '../shared/computed-columns';
import type { ComputedColumn, ComputedExpression } from '../shared/table-contracts';
import { computeInputBindingSchema, computeProgramProblems, computeRunRecordSchema, tableComputeProgramSchema, validateComputeOutputs, isComputeTableValue, COMPUTE_LIMITS, type ComputeRunRecord, type ComputeRuntimeProfile } from '../shared/table-compute';

export const TABLE_FILE_BYTES = 32 * 1024;
export const TABLE_TOTAL_SOURCE_BYTES = 64 * 1024;
// F066: kept in a leaf module so Worker startup can never read it before it is set.
export { TABLE_AI_INPUT_BYTES } from '../shared/ai-request-limits';
/** F037: shared notes are bounded so they stay cheap to render and to send to the model as context. */
export const MAX_TABLE_NOTES = 20;
export const MAX_NOTE_TEXT = 500;
const NOTE_COLORS = ['yellow', 'rose', 'sky', 'mint', 'lavender', 'sand'] as const;
const NOTE_COORD = z.number().finite().min(-90_000).max(90_000);
const noteColor = z.enum(NOTE_COLORS);
const noteText = z.string().max(MAX_NOTE_TEXT).refine(t => !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(t), 'Use printable text only.');
const noteId = z.string().regex(/^note_[a-z0-9_-]{6,40}$/u);
/** F073: the id the image upload route returned; the bytes live in the room, never in table state. */
const imageId = z.string().regex(IMAGE_ID_PATTERN);
/** F037: notes are resizable; the paper grows but stays bounded so layout stays usable. */
const noteWidth = z.number().int().min(160).max(480);
const noteHeight = z.number().int().min(110).max(560);
const NOTE_DEFAULT_WIDTH = 236;
const NOTE_DEFAULT_HEIGHT = 172;
const forbiddenIdentifiers = new Set<string>(GENERATIVE_FORBIDDEN_IDENTIFIERS);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(x => !forbiddenIdentifiers.has(x));
const text = z.string().min(1).max(500);
const value: z.ZodType<TableValue> = z.union([z.string().max(500), z.number().finite().min(-1e9).max(1e9), z.boolean(), z.null(), z.array(z.string().max(100)).max(32)]);
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
/**
 * F047: one source of truth for the limits the prompt advertises and the schema enforces.
 * The Zen of the old design was two hand-kept lists (prompt guide + zod), and they drifted:
 * `manifestNodes <= 24` was enforced but never advertised.
 */
export const TABLE_LIMITS = {
  collections: 6,
  fieldsPerCollection: 12,
  fieldChoices: 32,
  actions: 16,
  parametersPerAction: 8,
  conditionsPerAction: 24,
  effectsPerAction: 24,
  createsPerAction: 12,
  invariants: 12,
  invariantFields: 6,
  turnOrder: TABLE_TURN_SEATS.length,
  evidence: 20,
  assumptions: 12,
  rowsPerCollection: 100,
  rowsTotal: 200,
  recordsBytes: 128 * 1024,
  programBytes: 64 * 1024,
} as const;
const MAX_TABLE_ACTION_CREATES = TABLE_LIMITS.createsPerAction;
const TABLE_RECORD_ID_PREFIX = 'record_';
const TABLE_RECORD_ID_HASH_LENGTH = 12;
const TABLE_RECORD_ORDINAL_WIDTH = String(MAX_TABLE_ACTION_CREATES - 1).length;
const fieldSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'list']), required: z.boolean(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(TABLE_LIMITS.fieldChoices).optional(), default: value.optional() });
/** F048: one to four groups of identical dice plus an optional whole-number modifier. */
const rollGroupSchema: z.ZodType<RollGroup> = z.strictObject({
  count: z.number().int().min(1).max(ROLL_LIMITS.dicePerGroup),
  faces: z.number().int().min(ROLL_LIMITS.facesMin).max(ROLL_LIMITS.facesMax),
});
const rollSpecSchema: z.ZodType<RollSpec> = z.strictObject({
  groups: z.array(rollGroupSchema).min(1).max(ROLL_LIMITS.groups),
  modifier: z.number().int().min(-ROLL_LIMITS.modifier).max(ROLL_LIMITS.modifier).optional(),
}).superRefine((spec, refinement) => {
  for (const problem of rollSpecProblems(spec)) refinement.addIssue({ code: 'custom', message: problem });
});
const parameterSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'record', 'roll']), collection: id.optional(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(TABLE_LIMITS.fieldChoices).optional(), roll: rollSpecSchema.optional() })
  .superRefine((parameter, refinement) => {
    if (parameter.type === 'roll') {
      if (!parameter.roll) refinement.addIssue({ code: 'custom', path: ['roll'], message: 'A roll parameter needs a roll spec.' });
      if (parameter.collection !== undefined || parameter.min !== undefined || parameter.max !== undefined || parameter.choices !== undefined) {
        refinement.addIssue({ code: 'custom', message: 'A roll parameter takes only a roll spec.' });
      }
    } else if (parameter.roll !== undefined) {
      refinement.addIssue({ code: 'custom', path: ['roll'], message: 'Only a roll parameter takes a roll spec.' });
    }
  });
const operand: z.ZodType<TableOperand> = z.union([z.strictObject({ literal: value }), z.strictObject({ input: id }), z.strictObject({ record: id, field: id }), z.strictObject({ system: z.enum(['actor', 'seat', 'turn']) }), z.strictObject({ expression: generativeExpressionSchema })]);
const computedExpressionSchema: z.ZodType<ComputedExpression> = z.lazy(() => z.union([
  z.strictObject({ op: z.literal('field'), field: id }),
  z.strictObject({ op: z.literal('literal'), value: z.number().finite().min(-1e9).max(1e9) }),
  z.strictObject({ op: z.literal('text'), value: z.string().min(1).max(100) }),
  ...(['add', 'subtract', 'multiply', 'divide', 'min', 'max', 'and', 'or'] as const).map((op) => z.strictObject({
    op: z.literal(op), left: computedExpressionSchema, right: computedExpressionSchema,
  })),
  ...(['negate', 'ceil', 'floor', 'abs'] as const).map((op) => z.strictObject({
    op: z.literal(op), value: computedExpressionSchema,
  })),
  z.strictObject({ op: z.literal('round'), value: computedExpressionSchema, digits: z.number().int().min(0).max(6) }),
  z.strictObject({ op: z.literal('compare'), compare: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte']), left: computedExpressionSchema, right: computedExpressionSchema }),
  z.strictObject({ op: z.literal('if'), condition: computedExpressionSchema, then: computedExpressionSchema, else: computedExpressionSchema }),
]));
const computedColumnSchema: z.ZodType<ComputedColumn> = z.strictObject({ id, collection: id, label: z.string().min(1).max(40), expression: computedExpressionSchema });
export const tableProgramSchema: z.ZodType<TableProgram> = z.strictObject({
  version: z.literal(1), title: z.string().min(1).max(100), description: text,
  collections: z.array(z.strictObject({ id, title: text, fields: z.array(fieldSchema).min(1).max(TABLE_LIMITS.fieldsPerCollection) })).min(1).max(TABLE_LIMITS.collections),
  actions: z.array(z.strictObject({
    id, title: text, description: text, roles: z.array(z.enum(['owner', 'participant'])).min(1).max(2),
    parameters: z.array(parameterSchema).max(TABLE_LIMITS.parametersPerAction),
    conditions: z.array(z.strictObject({ left: operand, op: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains']), right: operand, message: text })).max(TABLE_LIMITS.conditionsPerAction),
    effects: z.array(z.strictObject({ record: id, field: id, op: z.enum(['set', 'add']), value: operand })).max(TABLE_LIMITS.effectsPerAction),
    creates: z.array(z.strictObject({ collection: id, values: z.record(id, operand) })).max(MAX_TABLE_ACTION_CREATES).optional(),
    requireTurn: z.boolean(), advanceTurn: z.boolean(),
  })).max(TABLE_LIMITS.actions),
  invariants: z.array(z.strictObject({ id, collection: id, fields: z.array(id).min(1).max(TABLE_LIMITS.invariantFields), message: text })).max(TABLE_LIMITS.invariants),
  turnOrder: z.array(z.string().regex(TABLE_TURN_SEAT_PATTERN)).max(TABLE_LIMITS.turnOrder),
  evidence: z.array(z.strictObject({ sourceId: z.string().min(1).max(100), quote: z.string().min(1).max(500) })).max(TABLE_LIMITS.evidence),
  assumptions: z.array(text).max(TABLE_LIMITS.assumptions),
  canvas: generativeCanvasSchema.optional(),
  compute: tableComputeProgramSchema.optional(),
}).superRefine((program, refinement) => {
  if (program.actions.length === 0 && !program.compute?.modules.length) {
    refinement.addIssue({ code: 'custom', path: ['actions'], message: 'A table needs at least one action or saved compute rule.' });
  }
  if (program.compute) {
    const problems = computeProgramProblems(program.compute, program.collections, undefined);
    for (const problem of problems) refinement.addIssue({ code: 'custom', path: ['compute'], message: problem.message });
  }
});
export const tableRowSchema = z.strictObject({ id, values: z.record(id, value) });
export const tableRecordsSchema = z.record(id, z.array(tableRowSchema).max(TABLE_LIMITS.rowsPerCollection)).superRefine((records, ctx) => {
  const rowCount = Object.values(records).reduce((count, rows) => count + rows.length, 0);
  if (rowCount > TABLE_LIMITS.rowsTotal) ctx.addIssue({ code: 'custom', message: `A table supports at most ${TABLE_LIMITS.rowsTotal} records.` });
  if (bytes(JSON.stringify(records)) > TABLE_LIMITS.recordsBytes) ctx.addIssue({ code: 'custom', message: 'The records exceed the 128 KiB table limit.' });
});
export const tableChangeSchema = z.strictObject({ kind: z.literal('table'), program: tableProgramSchema, initialRecords: tableRecordsSchema });
/** F046: the program without its canvas, validated like the rest of the program. */
function withoutCanvas(program: TableProgram): TableProgram {
  const next = { ...program } as TableProgram & { canvas?: TableProgram['canvas'] };
  delete next.canvas;
  return next as TableProgram;
}

/** F046: records keyed by every collection, so a program can be validated without a table state. */
function emptyRecords(program: TableProgram): Record<string, TableRecord[]> {
  return Object.fromEntries(program.collections.map(collection => [collection.id, []]));
}

/** F046: drop links to a removed view or collection; links are hints, so they never block a removal. */
function dropRuleItemLinks(program: TableProgram, kind: 'view' | 'collection', removedId: string): void {
  for (const descriptor of program.canvas?.views ?? []) {
    const related = descriptor.relatedTo;
    if (!related) continue;
    if (kind === 'view' && related.views) {
      related.views = related.views.filter(item => item !== removedId);
      if (!related.views.length) delete related.views;
    }
    if (kind === 'collection' && related.collections) {
      related.collections = related.collections.filter(item => item !== removedId);
      if (!related.collections.length) delete related.collections;
    }
    if (!related.views && !related.collections) delete descriptor.relatedTo;
  }
}

/** F046: one view removed, and every link that pointed at it cleaned up. */
function withoutView(program: TableProgram, viewId: string): TableProgram {
  const views = (program.canvas?.views ?? [])
    .filter(view => view.id !== viewId)
    .map(view => structuredClone(view));
  const next = { ...program } as TableProgram & { canvas?: TableProgram['canvas'] };
  if (views.length) next.canvas = { version: 1, views };
  else delete next.canvas;
  if (next.canvas) dropRuleItemLinks(next, 'view', viewId);
  return next as TableProgram;
}

/** F046: view issues that do not already exist in the program without a canvas. */
function viewIssues(program: TableProgram, coreIssues: ReadonlySet<string>): string[] {
  if (!program.canvas || program.canvas.views.length === 0) return [];
  return validateGenerativeProgram(program, emptyRecords(program))
    .filter(issue => !coreIssues.has(issue));
}

/** F046: the runtime check (probe contexts) for views the static program check accepted. */
function viewOutputIssues(program: TableProgram): string[] {
  if (!program.canvas) return [];
  try {
    validateGenerativeOutput(program, emptyRecords(program));
    return [];
  } catch (error) {
    return [error instanceof Error ? error.message : 'Generated table views are invalid.'];
  }
}

/**
 * F046: drop views until the people left in the canvas validate, trying one removal at a time first
 * and dropping the last view only when no single removal helps (a plateau of independent bad views).
 * Views are judged as a set because `relatedTo` links them, and a link to a dropped view is removed,
 * so one bad view cannot take its neighbours with it.
 */
function salvageViewSet(program: TableProgram, check: (candidate: TableProgram) => string[]): TableProgram {
  if (check(program).length === 0) return program;
  let current = program;
  const limit = program.canvas?.views.length ?? 0;
  for (let guard = 0; guard < limit; guard += 1) {
    const views = current.canvas?.views ?? [];
    if (views.length === 0) return current;
    for (const view of views) {
      const candidate = withoutView(current, view.id);
      if (check(candidate).length === 0) return candidate;
    }
    current = withoutView(current, views[views.length - 1]!.id);
  }
  return current;
}

/**
 * F046: keep the table and drop only the canvas views that fail semantic validation.
 *
 * F023 salvaged schema errors only, so a view that parsed but was semantically wrong ("scene text
 * must be text", a metric that is not a scalar, a control bound to an unknown action) still rejected
 * the whole draft. A program whose own core is invalid is left untouched here: dropping views could
 * not fix it, and the caller must report the real issue.
 */
function salvageInvalidViews(change: TableChange): TableChange {
  const program = change.program;
  if (!program.canvas || program.canvas.views.length === 0) return change;
  const records = emptyRecords(program);
  const coreIssues = new Set(validateGenerativeProgram(withoutCanvas(program), records));
  if (coreIssues.size > 0) return change;
  const staticIssues = viewIssues(program, coreIssues);
  if (staticIssues.length === 0 && viewOutputIssues(program).length === 0) return change;

  const trimmed = salvageViewSet(program, candidate => viewIssues(candidate, coreIssues));
  const evaluated = salvageViewSet(trimmed, viewOutputIssues);
  return { ...change, program: evaluated } as TableChange;
}

/** F023: drop only canvas views that fail the schema so one broken view cannot sink the whole draft. */
function canvasSalvagedChange(value: unknown): TableChange | null {
  if (typeof value !== 'object' || value === null) return null;
  const raw = value as { kind?: unknown; program?: unknown };
  if (raw.kind !== 'table' || typeof raw.program !== 'object' || raw.program === null) return null;
  const program = raw.program as Record<string, unknown>;
  const canvas = program.canvas;
  if (typeof canvas !== 'object' || canvas === null || !Array.isArray((canvas as { views?: unknown }).views)) return null;
  const { canvas: _dropped, ...core } = program;
  // Depth/node limits still apply to the salvaged core; only the views are allowed to be broken.
  if (!expressionWithinBounds({ ...raw, program: core })) return null;
  let base: TableChange;
  try { base = parsePayload(tableChangeSchema, { ...raw, program: core }); } catch { return null; }
  const kept: unknown[] = [];
  for (const view of (canvas as { views: unknown[] }).views) {
    if (!expressionWithinBounds(view)) continue;
    try {
      parsePayload(tableChangeSchema, { ...raw, program: { ...core, canvas: { version: 1, views: [view] } } });
      kept.push(view);
    } catch { /* an unrepresentable view is skipped, not fatal */ }
  }
  const change = { ...base, program: { ...core, ...(kept.length ? { canvas: { version: 1, views: kept } } : {}) } as TableProgram };
  // F046: the surviving views still have to mean something.
  return salvageInvalidViews(change);
}

/** F023/F046: provider-side parse that tolerates malformed or semantically invalid canvas views. */
export function parseTableChangeSalvagingCanvas(value: unknown): TableChange | null {
  const direct = tableChangeSchema.safeParse(value);
  return direct.success ? salvageInvalidViews(direct.data) : canvasSalvagedChange(value);
}

export function parseBoundedTableChange(value: unknown): TableChange {
  try {
    assert(expressionWithinBounds(value), 'TABLE_LIMIT', 'The generated expressions exceed deterministic depth, node, or array limits.');
    return parsePayload(tableChangeSchema, value);
  } catch (error) {
    const salvaged = canvasSalvagedChange(value);
    if (salvaged) return salvaged;
    throw error;
  }
}
const sourceInput = z.strictObject({ filename: z.string().min(1).max(120).regex(/^[^/\\\p{Cc}]+\.(csv|json|txt|md)$/iu), text: z.string().min(1).max(TABLE_FILE_BYTES) });
const runInput = z.strictObject({ actionId: id, inputs: z.record(id, value) });
/** F048: the client names the roll it wants; the server supplies every die. */
const rollInput = z.strictObject({ actionId: id, parameterId: id });

export function createTableState(): TableState {
  return { kind: 'table', sources: [], program: null, records: {}, turn: null, actionRevision: 0, activity: [], dataRevision: 0, ruleRevision: 0, candidate: null, revisions: [] };
}
function unique(items: string[], label: string) { assert(new Set(items).size === items.length, 'TABLE_SCHEMA', `${label} must be unique.`); }
function validValue(field: Pick<TableField, 'type' | 'required' | 'min' | 'max' | 'choices'>, v: TableValue | undefined) {
  if (v === null || v === undefined) return !field.required;
  if (field.type === 'list') return Array.isArray(v) && v.every(x => typeof x === 'string');
  if (field.type === 'number') return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 && (field.min === undefined || v >= field.min) && (field.max === undefined || v <= field.max);
  if (field.type === 'boolean') return typeof v === 'boolean';
  return typeof v === 'string' && (!field.required || v.trim().length > 0) && (!field.choices || field.choices.includes(v));
}
function checkRows(program: TableProgram, records: Record<string, TableRecord[]>) {
  assert(bytes(JSON.stringify(records)) <= TABLE_LIMITS.recordsBytes, 'TABLE_LIMIT', 'The records exceed the 128 KiB table limit. No action was applied.');
  assert(Object.keys(records).every(key => program.collections.some(c => c.id === key)), 'TABLE_SCHEMA', 'Records refer to an unknown collection.');
  assert(Object.values(records).reduce((n, rows) => n + rows.length, 0) <= 200, 'TABLE_LIMIT', 'A table supports at most 200 records.');
  for (const collection of program.collections) {
    const rows = records[collection.id] ?? [];
    assert(rows.length <= 100, 'TABLE_LIMIT', 'A collection supports at most 100 records.');
    unique(rows.map(row => row.id), 'Record identifiers');
    for (const row of rows) {
      assert(Object.keys(row.values).every(key => collection.fields.some(f => f.id === key)), 'TABLE_SCHEMA', 'A record has an unknown field.');
      for (const field of collection.fields) assert(validValue(field, row.values[field.id]), 'TABLE_VALUE', `${collection.title}: ${field.label} has an invalid value.`);
    }
  }
  for (const invariant of program.invariants) {
    const seen = new Set<string>();
    for (const row of records[invariant.collection] ?? []) {
      const values = invariant.fields.map(f => row.values[f] ?? null);
      // Unassigned optional fields do not occupy a unique slot.
      if (values.some(v => v === null || v === '')) continue;
      const key = canonicalJson(values);
      assert(!seen.has(key), 'TABLE_INVARIANT', invariant.message); seen.add(key);
    }
  }
}
export function checkProgram(program: TableProgram, sources?: readonly TableSource[]) {
  unique(program.collections.map(c => c.id), 'Collection identifiers'); unique(program.actions.map(a => a.id), 'Action identifiers'); unique(program.turnOrder, 'Turn seats'); unique(program.invariants.map(i => i.id), 'Invariant identifiers');
  for (const c of program.collections) {
    unique(c.fields.map(f => f.id), 'Field identifiers');
    // F020: one message per problem, naming the field, so an AI repair (and the owner) can fix it.
    for (const f of c.fields) {
      assert(f.min === undefined && f.max === undefined || f.type === 'number', 'TABLE_SCHEMA', `${c.title}: ${f.label} is a ${f.type} field; only number fields can have min or max.`);
      assert(f.min === undefined || f.max === undefined || f.min <= f.max, 'TABLE_SCHEMA', `${c.title}: ${f.label} has min greater than max.`);
      assert(!f.choices || f.type === 'text', 'TABLE_SCHEMA', `${c.title}: ${f.label} is a ${f.type} field; only text fields can have choices.`);
    }
    for (const f of c.fields) if (f.default !== undefined) assert(validValue(f, f.default), 'TABLE_VALUE', `${c.title}: ${f.label} has an invalid default.`);
  }
  for (const action of program.actions) {
    unique(action.parameters.map(p => p.id), 'Action parameter identifiers');
    unique(action.effects.map(e => `${e.record}.${e.field}`), 'Action effect targets');
    assert(action.parameters.filter(p => p.type === 'roll').length <= 1, 'TABLE_SCHEMA', 'An action can use at most one server roll parameter.');
    assert(action.effects.length > 0 || (action.creates?.length ?? 0) > 0 || action.advanceTurn, 'TABLE_SCHEMA', 'An action must change a field, create a record, or advance the turn.');
    assert(!(action.requireTurn || action.advanceTurn) || program.turnOrder.length > 0, 'TABLE_SCHEMA', 'Turn actions need a turn order.');
    const resolveField = (parameter: string, field: string) => {
      const p = action.parameters.find(p => p.id === parameter && p.type === 'record');
      const f = program.collections.find(c => c.id === p?.collection)?.fields.find(f => f.id === field);
      assert(f, 'TABLE_SCHEMA', 'An action refers to an unknown record field.'); return f;
    };
    for (const p of action.parameters) {
      assert((p.type === 'record') === (p.collection !== undefined), 'TABLE_SCHEMA', 'Record parameters need a collection.');
      if (p.collection) assert(program.collections.some(c => c.id === p.collection), 'TABLE_SCHEMA', 'Unknown parameter collection.');
      assert((p.min === undefined && p.max === undefined || p.type === 'number') && (p.min === undefined || p.max === undefined || p.min <= p.max) && (!p.choices || p.type === 'text'), 'TABLE_SCHEMA', 'Parameter bounds do not match its type.');
      assert((p.type === 'roll') === (p.roll !== undefined), 'TABLE_SCHEMA', 'Only a roll parameter takes a roll spec, and a roll parameter needs one.');
      if (p.roll) {
        const problems = rollSpecProblems(p.roll);
        assert(problems.length === 0, 'TABLE_SCHEMA', problems[0] ?? 'The roll bounds are invalid.');
      }
    }
    const operandType = (o: TableOperand): string => {
      if ('literal' in o) return o.literal === null ? 'null' : Array.isArray(o.literal) ? 'list' : typeof o.literal === 'string' ? 'text' : typeof o.literal;
      if ('expression' in o) return getGenerativeExpressionType(o.expression, program, action);
      if ('system' in o) return 'text';
      if ('record' in o) return resolveField(o.record, o.field).type;
      const p = action.parameters.find(p => p.id === o.input); assert(p, 'TABLE_SCHEMA', 'Unknown input reference.'); return p.type === 'record' ? 'text' : p.type === 'roll' ? 'number' : p.type;
    };
    for (const c of action.conditions) {
      const l = operandType(c.left), r = operandType(c.right);
      assert(c.op === 'eq' || c.op === 'neq' ? l === r || l === 'null' || r === 'null' : c.op === 'contains' ? l === 'list' && r === 'text' : l === 'number' && r === 'number', 'TABLE_SCHEMA', 'Condition operand types are incompatible.');
    }
    for (const e of action.effects) {
      const f = resolveField(e.record, e.field), t = operandType(e.value);
      assert(e.op === 'add' ? f.type === 'number' && t === 'number' : t === f.type || t === 'null' && !f.required, 'TABLE_SCHEMA', 'Effect value does not match its field.');
    }
    for (const create of action.creates ?? []) {
      const collection = program.collections.find(c => c.id === create.collection);
      assert(collection, 'TABLE_SCHEMA', 'A create action refers to an unknown collection.');
      for (const [fieldId, createValue] of Object.entries(create.values)) {
        const field = collection.fields.find(f => f.id === fieldId);
        assert(field, 'TABLE_SCHEMA', 'A create action refers to an unknown field.');
        const type = operandType(createValue);
        assert(type === field.type || type === 'null' && !field.required, 'TABLE_SCHEMA', 'Create value does not match its field.');
      }
      for (const field of collection.fields) assert(Object.hasOwn(create.values, field.id) || field.default !== undefined || !field.required, 'TABLE_SCHEMA', `${field.label} must have a create value or a default.`);
    }
  }
  for (const i of program.invariants) {
    const c = program.collections.find(c => c.id === i.collection);
    assert(c && i.fields.every(key => c.fields.some(f => f.id === key)), 'TABLE_SCHEMA', 'Unique constraint refers to an unknown field.');
  }
  if (program.compute) {
    unique(program.compute.modules.map(module => module.id), 'Compute module identifiers');
    const problems = computeProgramProblems(program.compute, program.collections, sources);
    assert(problems.length === 0, 'TABLE_SCHEMA', problems[0]?.message ?? 'The compute modules are invalid.');
    const derivedCollections = new Set(program.compute.modules.flatMap(module =>
      module.outputs.flatMap(output => output.collectionId ? [output.collectionId] : [])));
    for (const action of program.actions) {
      assert(!action.parameters.some(parameter => parameter.collection && derivedCollections.has(parameter.collection))
        && !(action.creates ?? []).some(create => derivedCollections.has(create.collection)),
      'TABLE_SCHEMA', 'Actions cannot select or write rows in a derived compute collection.');
    }
    assert(!program.invariants.some(invariant => derivedCollections.has(invariant.collection)),
      'TABLE_SCHEMA', 'Checks cannot target rows in a derived compute collection.');
  }
}

export function applyTableChange(state: TableState, raw: TableChange, actor?: Pick<ActorContext, 'actorId' | 'seat'>): TableState {
  const change = parseBoundedTableChange(raw);
  assert(bytes(JSON.stringify(change.program)) <= TABLE_LIMITS.programBytes && bytes(JSON.stringify(change.initialRecords)) <= TABLE_LIMITS.recordsBytes, 'TABLE_LIMIT', 'The proposed rules or records exceed the table size limit.');
  checkProgram(change.program, state.sources);
  if (state.program?.compute) {
    const nextModules = new Map((change.program.compute?.modules ?? []).map(module => [module.id, module]));
    for (const previous of state.program.compute.modules) {
      const next = nextModules.get(previous.id);
      assert(next, 'TABLE_PRESERVE_COMPUTE', 'Keep ' + previous.name + ' in an evolved program; remove it with the Rules card so its dependencies and run history can be checked.');
      const previousBehavior = canonicalJson({ runtime: previous.runtime, runtimeProfile: previous.runtimeProfile ?? 'tabletop-compute-1', source: previous.source, inputs: previous.inputs, outputs: previous.outputs });
      const nextBehavior = canonicalJson({ runtime: next.runtime, runtimeProfile: next.runtimeProfile ?? 'tabletop-compute-1', source: next.source, inputs: next.inputs, outputs: next.outputs });
      assert(next.version >= previous.version && (previousBehavior === nextBehavior || next.version > previous.version), 'TABLE_COMPUTE_VERSION', 'Increment the version of ' + previous.name + ' when its code or port bindings change.');
    }
  }
  if (state.sources.length === 0) assert(change.program.evidence.length === 0, 'TABLE_EVIDENCE', 'Prompt-only tables cannot cite a source that is not on the table.');
  else {
    assert(change.program.evidence.length > 0, 'TABLE_EVIDENCE', 'Cite at least one uploaded source.');
    for (const evidence of change.program.evidence) assert(state.sources.some(s => s.id === evidence.sourceId && s.text.includes(evidence.quote)), 'TABLE_EVIDENCE', 'A cited quotation is missing from the source.');
  }
  if (state.program) {
    assert(Object.keys(change.initialRecords).length === 0, 'TABLE_PRESERVE_DATA', 'A rule edit must preserve current records; initialRecords must be empty.');
    for (const previousCollection of state.program.collections) {
      const nextCollection = change.program.collections.find(collection => collection.id === previousCollection.id);
      assert(nextCollection, 'TABLE_PRESERVE_DATA', 'A rule edit must retain every current collection.');
      for (const previousField of previousCollection.fields) {
        const nextField = nextCollection.fields.find(field => field.id === previousField.id);
        assert(nextField && canonicalJson(nextField) === canonicalJson(previousField), 'TABLE_PRESERVE_DATA', 'A rule edit must retain every current field definition.');
      }
    }
    for (const previousInvariant of state.program.invariants) {
      const nextInvariant = change.program.invariants.find(invariant => invariant.id === previousInvariant.id);
      assert(nextInvariant && canonicalJson(nextInvariant) === canonicalJson(previousInvariant), 'TABLE_PRESERVE_DATA', 'A rule edit must retain every current invariant.');
    }
    assert(state.turn === null || change.program.turnOrder.includes(state.turn), 'TABLE_PRESERVE_TURN', 'A rule edit must retain the current turn.');
  }
  const records = structuredClone(state.program ? state.records : change.initialRecords);
  for (const c of change.program.collections) records[c.id] ??= [];
  if (state.program) {
    for (const previousCollection of state.program.collections) {
      const nextCollection = change.program.collections.find(collection => collection.id === previousCollection.id)!;
      const addedFields = nextCollection.fields.filter(field => !previousCollection.fields.some(previous => previous.id === field.id));
      const rows = records[previousCollection.id];
      for (const field of addedFields) {
        if (field.required && rows.length > 0) assert(field.default !== undefined, 'TABLE_PRESERVE_DATA', `A default is required to add ${field.label} to existing records.`);
        if (field.default !== undefined) for (const row of rows) row.values[field.id] = structuredClone(field.default);
      }
    }
  }
  checkRows(change.program, records);
  // F018: carry views the AI dropped while evolving rules; the new program wins on conflicts.
  const preservedCanvas = preserveCanvasViews(state.program?.canvas, change.program.canvas, change.program, records);
  if (preservedCanvas) change.program.canvas = preservedCanvas;
  else delete change.program.canvas;
  const generativeIssues = validateGenerativeProgram(change.program, records);
  assert(generativeIssues.length === 0, 'TABLE_SCHEMA', generativeIssues[0] ?? 'Generated table program is invalid.');
  const turn = state.turn ?? change.program.turnOrder[0] ?? null;
  validateGenerativeOutput(change.program, records, actor ? { actor: actor.actorId, ...(actor.seat ? { seat: actor.seat } : {}), turn } : undefined, state.computeRuns, state);
  const computedColumns = retainComputedColumns(state.computedColumns, change.program);
  return { ...structuredClone(state), program: structuredClone(change.program), records, turn, computedColumns };
}
export type RuleItemKind = 'action' | 'invariant' | 'view' | 'collection' | 'compute';

/**
 * F039: the active program without one action, unique constraint, view or collection. Removing a collection
 * also removes its records and computed columns. Anything that still refers to the removed item (an action
 * on that collection, a view showing it) blocks the removal, so the program stays valid.
 */
export function removeTableRuleItem(state: TableState, kind: RuleItemKind, id: string): TableState {
  assert(state.program, 'TABLE_INACTIVE', 'There are no active rules to change.');
  const program = structuredClone(state.program);
  const records = structuredClone(state.records);
  let found = false;
  if (kind === 'action') { found = program.actions.some(item => item.id === id); program.actions = program.actions.filter(item => item.id !== id); }
  if (kind === 'invariant') { found = program.invariants.some(item => item.id === id); program.invariants = program.invariants.filter(item => item.id !== id); }
  if (kind === 'collection') { found = program.collections.some(item => item.id === id); program.collections = program.collections.filter(item => item.id !== id); delete records[id]; }
  if (kind === 'compute' && program.compute) {
    found = program.compute.modules.some(item => item.id === id);
    program.compute.modules = program.compute.modules.filter(item => item.id !== id);
    if (program.compute.modules.length === 0) delete program.compute;
  }
  if (kind === 'view' && program.canvas) {
    found = program.canvas.views.some(item => item.id === id);
    program.canvas.views = program.canvas.views.filter(item => item.id !== id);
    if (program.canvas.views.length === 0) delete program.canvas;
  }
  assert(found, 'RULE_ITEM_NOT_FOUND', 'That rule is no longer on this table.');
  // F046: links between views are only hints, so drop links to what was removed instead of blocking.
  if (kind === 'view' || kind === 'collection') dropRuleItemLinks(program, kind, id);
  // Inspect a removed module's output bindings before discarding its definition.
  const users = ruleItemUsers(kind === 'compute' ? state.program : program, kind, id);
  if (users.length > 0) throw new DomainError('RULE_ITEM_IN_USE', `Remove ${users.join(', ')} first; it still uses this.`);
  try {
    checkProgram(program, state.sources);
    checkRows(program, records);
    const issues = validateGenerativeProgram(program, records);
    assert(issues.length === 0, 'TABLE_SCHEMA', issues[0] ?? 'The remaining rules are invalid.');
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'The remaining rules are invalid.';
    throw new DomainError('RULE_ITEM_IN_USE', `Something else on this table still uses it. Remove that first. (${reason})`);
  }
  const computedColumns = retainComputedColumns(state.computedColumns, program);
  return { ...structuredClone(state), program, records, computedColumns };
}

/** Names of the rules that still use an action or collection, so the removal message can say what to remove first. */
function referencesComputeResult(value: unknown, moduleId: string): boolean {
  if (Array.isArray(value)) return value.some(item => referencesComputeResult(item, moduleId));
  if (value === null || typeof value !== 'object') return false;
  const object = value as Record<string, unknown>;
  if (object.op === 'computeResult' && object.moduleId === moduleId) return true;
  return Object.values(object).some(item => referencesComputeResult(item, moduleId));
}

function ruleItemUsers(program: TableProgram, kind: RuleItemKind, id: string): string[] {
  const views = program.canvas?.views ?? [];
  const mentions = (value: unknown, key: string) => JSON.stringify(value).includes(`${JSON.stringify(key)}:${JSON.stringify(id)}`);
  if (kind === 'action') return views.filter(view => mentions(view, 'actionId')).map(view => `the view “${view.title}”`);
  if (kind === 'compute') {
    const removed = program.compute?.modules.find(module => module.id === id);
    const derivedIds = new Set(removed?.outputs.flatMap(output => output.collectionId ? [output.collectionId] : []) ?? []);
    return [
      ...(program.compute?.modules.filter(module => module.id !== id && module.inputs.some(input =>
        input.binding.kind === 'result' && input.binding.moduleId === id
        || input.binding.kind === 'collection' && derivedIds.has(input.binding.collectionId)))
        .map(module => 'the compute rule “' + module.name + '”') ?? []),
      ...(program.canvas?.views.filter(view => referencesComputeResult(view, id)
        || 'collection' in view && derivedIds.has(view.collection))
        .map(view => 'the view “' + view.title + '”') ?? []),
    ];
  }
  if (kind !== 'collection') return [];
  return [
    ...(program.compute?.modules.filter(module => module.inputs.some(input => input.binding.kind === 'collection' && input.binding.collectionId === id)
      || module.outputs.some(output => output.collectionId === id)).map(module => 'the compute rule “' + module.name + '”') ?? []),
    ...program.actions.filter(action => action.parameters.some(p => p.collection === id) || (action.creates ?? []).some(create => create.collection === id)).map(action => `the action “${action.title}”`),
    ...program.invariants.filter(invariant => invariant.collection === id).map(invariant => `the check “${invariant.message}”`),
    ...views.filter(view => mentions(view, 'collection')).map(view => `the view “${view.title}”`),
  ];
}

export function tableChangeIssues(state: TableState, change: TableChange): string[] {
  try { applyTableChange(state, change); return [] } catch (e) { return [e instanceof Error ? e.message : 'Invalid table program.'] }
}

const fixedOperand = (operand: TableOperand): boolean => 'literal' in operand || ('expression' in operand && operand.expression.op === 'literal');

/**
 * F068: an action with no inputs and no conditions whose rows are all typed-in values makes the same rows on
 * every press, and numbers the model worked out from records go stale. Only actions a draft adds or changes are
 * checked, so an older table that already has one can still be edited, rolled back, or trimmed.
 */
export function repeatableFixedCreateIssues(program: TableProgram, previous: TableProgram | null): string[] {
  const unchanged = (action: TableAction) => previous?.actions.some(old => old.id === action.id && canonicalJson(old) === canonicalJson(action)) ?? false;
  return program.actions
    .filter(action => action.parameters.length === 0 && action.conditions.length === 0 && (action.creates?.length ?? 0) > 0
      && (action.creates ?? []).every(create => Object.values(create.values).every(fixedOperand)) && !unchanged(action))
    .map(action => {
      const collection = action.creates?.[0]?.collection ?? 'the collection';
      return `“${action.title}” has no inputs or conditions and creates the same fixed rows on every press, so a second press duplicates them. `
        + `Add a condition that blocks a second run, for example {"left":{"expression":{"op":"aggregate","source":{"op":"collection","id":"${collection}"},"fn":"count"}},"op":"eq","right":{"literal":0},"message":"Already added."}. `
        + 'If the numbers come from current records (totals, shares, balances), compute them with {"expression":...} or show them in a metric or chart instead of typing them in.';
    });
}

/** F068: what an AI draft must pass. Manual proposals and rollbacks keep using `tableChangeIssues`. */
export function aiTableChangeIssues(state: TableState, change: TableChange): string[] {
  const issues = tableChangeIssues(state, change);
  return issues.length > 0 ? issues : repeatableFixedCreateIssues(change.program, state.program);
}
function isGenerativeArray(value: GenerativeOutput): value is readonly GenerativeScalar[] { return Array.isArray(value); }
/** The longest seat id any runtime can hand out; probing it bounds output that embeds the seat. */
const LONGEST_SEAT: Seat = [...SEATS].sort((left, right) => right.length - left.length)[0]!;
const MAX_SUPPORTED_ACTOR_ID_LENGTH = 160; // ID_SCHEMA permits actor IDs up to this length.
const MAX_ACTOR_ID = '\u0000'.repeat(MAX_SUPPORTED_ACTOR_ID_LENGTH); // JSON escapes each NUL as six UTF-8 bytes.
// Probes grow with the seats a program names (about five per named seat), so a full twelve-member
// turn order with actor, seat and turn branches needs about 68 contexts (64 was the seven-seat budget);
// 96 keeps headroom for actor literals.
const MAX_GENERATIVE_VALIDATION_CONTEXTS = 96;

interface GenerativeValidationContext {
  actor: string;
  seat?: Seat;
  turn: string | null;
}

/**
 * Seats worth probing: every seat id the program or its rows mention (turn order, literals, record
 * values) plus the longest seat id. A seat nothing mentions cannot select a branch of its own, so
 * probing all twelve member seats on every canvas would only spend the validation budget.
 */
function mentionedSeats(program: TableProgram, records: Record<string, TableRecord[]>): Seat[] {
  const mentioned = new Set<string>();
  const pending: unknown[] = [program, records];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === 'string') mentioned.add(current);
    else if (Array.isArray(current)) pending.push(...current);
    else if (current && typeof current === 'object') pending.push(...Object.values(current as Record<string, unknown>));
  }
  const seats = SEATS.filter((seat) => mentioned.has(seat));
  // Prefer a mentioned seat that is as long as the longest one so the length probe adds no context.
  const longest = seats.find((seat) => seat.length === LONGEST_SEAT.length) ?? LONGEST_SEAT;
  return [longest, ...seats.filter((seat) => seat !== longest)];
}

function generativeValidationContexts(program: TableProgram, canvas: NonNullable<TableProgram['canvas']>, records: Record<string, TableRecord[]>, actualContext?: GenerativeValidationContext): GenerativeValidationContext[] {
  const systemValues = new Set<'actor' | 'seat' | 'turn'>();
  const probeSeats = mentionedSeats(program, records);
  const actorCandidates = new Set<string>([MAX_ACTOR_ID, 'host', ...probeSeats, ...program.turnOrder]);
  const pending: unknown[] = [canvas];
  while (pending.length > 0) {
    const current = pending.pop();
    if (Array.isArray(current)) {
      pending.push(...current);
    } else if (current && typeof current === 'object') {
      const object = current as Record<string, unknown>;
      if (object.op === 'system' && (object.value === 'actor' || object.value === 'seat' || object.value === 'turn')) systemValues.add(object.value);
      if (object.op === 'literal') {
        const literal = object.value;
        const values = typeof literal === 'string' ? [literal] : Array.isArray(literal) ? literal : [];
        for (const value of values) if (typeof value === 'string' && ID_SCHEMA.safeParse(value).success) actorCandidates.add(value);
      }
      pending.push(...Object.values(object));
    }
  }

  const maximumSeat = probeSeats[0];
  const maximumTurn = [...program.turnOrder].sort((left, right) => right.length - left.length)[0] ?? null;
  const contexts: GenerativeValidationContext[] = [];
  const seen = new Set<string>();
  const add = (context: GenerativeValidationContext) => {
    const key = JSON.stringify([context.actor, context.seat ?? null, context.turn]);
    if (!seen.has(key)) {
      assert(contexts.length < MAX_GENERATIVE_VALIDATION_CONTEXTS, 'TABLE_GENERATIVE', `Canvas identity validation is limited to ${MAX_GENERATIVE_VALIDATION_CONTEXTS} contexts.`);
      seen.add(key);
      contexts.push(context);
    }
  };

  // Probe maximum supported lengths and values that can select explicit system-value branches.
  // These axis-wise probes are deliberately bounded and are not an exhaustive proof over every
  // possible conjunction of system values or data-dependent comparison.
  if (systemValues.has('actor')) {
    for (const actor of actorCandidates) add({ actor, seat: maximumSeat, turn: maximumTurn });
  }
  if (systemValues.has('seat')) {
    add({ actor: MAX_ACTOR_ID, turn: maximumTurn }); // An omitted seat evaluates to "host".
    for (const seat of probeSeats) add({ actor: MAX_ACTOR_ID, seat, turn: maximumTurn });
  }
  if (systemValues.has('turn')) {
    add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn: null });
    for (const turn of program.turnOrder) add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn });
  }

  // Equality between system values can select a branch when their values coincide. Probe each
  // supported shared value without constructing the full actor × seat × turn product.
  const sharedValues = new Set<string>(['host', ...probeSeats, ...program.turnOrder]);
  for (const value of sharedValues) {
    const seat = probeSeats.find((candidate) => candidate === value);
    const turn = program.turnOrder.includes(value) ? value : null;
    if (systemValues.has('actor') && (systemValues.has('seat') || systemValues.has('turn'))) add({ actor: value, ...(seat ? { seat } : {}), turn });
    if (systemValues.has('seat') && systemValues.has('turn') && seat && program.turnOrder.includes(value)) add({ actor: MAX_ACTOR_ID, seat, turn: value });
  }
  if (actualContext) add(actualContext);
  if (contexts.length === 0) add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn: maximumTurn });
  return contexts;
}

function validateGenerativeOutput(program: TableProgram, records: Record<string, TableRecord[]>, actualContext?: GenerativeValidationContext, computeRuns?: TableState['computeRuns'], revisions?: Pick<TableState, 'dataRevision' | 'ruleRevision'>): void {
  if (!program.canvas) return;
  try {
    for (const context of generativeValidationContexts(program, program.canvas, records, actualContext)) {
      evaluateGenerativeCanvas(program.canvas, { program, records, ...(computeRuns ? { computeRuns } : {}), ...(revisions ? { dataRevision: revisions.dataRevision, ruleRevision: revisions.ruleRevision } : {}), allowPendingDerivedCollections: true, ...context });
    }
  } catch (error) {
    throw new DomainError('TABLE_GENERATIVE', error instanceof Error ? error.message : 'The generated canvas could not be evaluated.');
  }
}
function resolve(action: TableAction, state: TableState, inputs: Record<string, TableValue>, o: TableOperand, ctx: ActorContext, evaluateExpression: (expression: GenerativeExpression) => GenerativeOutput): TableValue {
  if ('literal' in o) return o.literal;
  if ('system' in o) return o.system === 'actor' ? ctx.actorId : o.system === 'seat' ? ctx.seat ?? 'host' : state.turn;
  if ('input' in o) return inputs[o.input];
  if ('expression' in o) {
    let output: GenerativeOutput;
    try {
      output = evaluateExpression(o.expression);
    } catch (error) {
      throw new DomainError('TABLE_EXPRESSION', error instanceof Error ? error.message : 'The expression could not be evaluated.');
    }
    if (!isGenerativeArray(output)) return output;
    const strings: string[] = [];
    for (const value of output) { assert(typeof value === 'string', 'TABLE_VALUE', 'Only text arrays can be stored in table list fields.'); strings.push(value); }
    return strings;
  }
  const p = action.parameters.find(p => p.id === o.record)!;
  return state.records[p.collection!].find(row => row.id === inputs[o.record])!.values[o.field] ?? null;
}
function conditionPass(op: string, l: TableValue, r: TableValue): boolean {
  if (op === 'eq') return canonicalJson(l) === canonicalJson(r);
  if (op === 'neq') return canonicalJson(l) !== canonicalJson(r);
  if (op === 'contains') return Array.isArray(l) && typeof r === 'string' && l.includes(r);
  if (typeof l !== 'number' || typeof r !== 'number') return false;
  return op === 'lt' ? l < r : op === 'lte' ? l <= r : op === 'gt' ? l > r : op === 'gte' && l >= r;
}
/** F037: shared canvas notes. They live beside the program, never inside it, so rule edits keep them. */
function handleNoteCommand(state: TableState, type: string, payload: unknown, ctx: ActorContext): { state: TableState; label: string } {
  const notes = state.notes ?? [];
  if (type === 'table.addNote') {
    const input = parsePayload(z.strictObject({ text: noteText.optional(), color: noteColor.optional(), x: NOTE_COORD, y: NOTE_COORD, width: noteWidth.optional(), height: noteHeight.optional(), imageId: imageId.optional() }), payload);
    // F073: picture cards have their own allowance, so pinning photos never uses up the room for text notes.
    if (input.imageId) {
      assert(notes.filter(note => note.imageId).length < MAX_TABLE_IMAGES, 'TABLE_LIMIT', `A table can hold at most ${MAX_TABLE_IMAGES} images.`);
      assert(!notes.some(note => note.imageId === input.imageId), 'TABLE_DUPLICATE_NOTE', 'That image is already on the table.');
    } else {
      assert(notes.filter(note => !note.imageId).length < MAX_TABLE_NOTES, 'TABLE_LIMIT', `A table can hold at most ${MAX_TABLE_NOTES} notes.`);
    }
    const id = `note_${ctx.hash(canonicalJson([ctx.actorId, ctx.now, input.text ?? '', input.x, input.y, input.imageId ?? null])).slice(0, 16)}`;
    assert(!notes.some(note => note.id === id), 'TABLE_DUPLICATE_NOTE', 'That note already exists.');
    const note = {
      id, text: input.text ?? '', color: input.color ?? 'yellow' as const, x: input.x, y: input.y,
      width: input.width ?? NOTE_DEFAULT_WIDTH, height: input.height ?? NOTE_DEFAULT_HEIGHT,
      createdBy: ctx.actorId, createdAt: ctx.now, updatedAt: ctx.now,
      ...(input.imageId ? { imageId: input.imageId } : {}),
    };
    return { state: { ...structuredClone(state), notes: [...notes, note] }, label: input.imageId ? 'Image added.' : 'Note added.' };
  }
  if (type === 'table.updateNote') {
    const input = parsePayload(z.strictObject({ noteId, text: noteText.optional(), color: noteColor.optional(), width: noteWidth.optional(), height: noteHeight.optional() }), payload);
    assert(input.text !== undefined || input.color !== undefined || input.width !== undefined || input.height !== undefined, 'TABLE_INPUT', 'Change the note text, colour or size.');
    assert(notes.some(note => note.id === input.noteId), 'TABLE_NOTE', 'Note not found.');
    return {
      state: {
        ...structuredClone(state),
        notes: notes.map(note => note.id === input.noteId ? {
          ...note,
          ...(input.text === undefined ? {} : { text: input.text }),
          ...(input.color === undefined ? {} : { color: input.color }),
          ...(input.width === undefined ? {} : { width: input.width }),
          ...(input.height === undefined ? {} : { height: input.height }),
          updatedAt: ctx.now,
        } : note),
      },
      label: 'Note updated.',
    };
  }
  if (type === 'table.moveNote') {
    const input = parsePayload(z.strictObject({ noteId, x: NOTE_COORD, y: NOTE_COORD }), payload);
    assert(notes.some(note => note.id === input.noteId), 'TABLE_NOTE', 'Note not found.');
    return {
      state: { ...structuredClone(state), notes: notes.map(note => note.id === input.noteId ? { ...note, x: input.x, y: input.y } : note) },
      label: 'Note moved.',
    };
  }
  const input = parsePayload(z.strictObject({ noteId }), payload);
  const target = notes.find(note => note.id === input.noteId);
  assert(target, 'TABLE_NOTE', 'Note not found.');
  // F073: a picture is removed only by whoever pinned it or the table owner.
  if (target.imageId) assert(target.createdBy === ctx.actorId || ctx.role === 'owner', 'FORBIDDEN', 'Only the person who added this image or the table owner can remove it.');
  return { state: { ...structuredClone(state), notes: notes.filter(note => note.id !== input.noteId) }, label: target.imageId ? 'Image removed.' : 'Note removed.' };
}

export interface TableCommandDecision {
  state: TableState;
  label: string;
  /** F048: the roll this command issued (`table.roll`) or consumed (`table.act`). */
  roll?: RollResult;
  rollParameterId?: string;
}

function derivedComputeRunId(ctx: ActorContext, moduleId: string, runs: readonly ComputeRunRecord[]): string {
  const digest = ctx.hash(canonicalJson([ctx.workspaceId, ctx.actorId, ctx.now, moduleId, runs[0]?.runId ?? null])).slice(0, 32).padEnd(32, '0');
  return digest.slice(0, 8) + '-' + digest.slice(8, 12) + '-4' + digest.slice(13, 16) + '-8' + digest.slice(17, 20) + '-' + digest.slice(20, 32);
}

function queueComputeRun(state: TableState, payload: unknown, ctx: ActorContext, userRequested: boolean): TableCommandDecision {
  if (userRequested) requirePermission(ctx, 'data.compute', ['owner', 'participant']);
  hasRole(ctx, ['owner', 'participant']);
  const input = parsePayload(z.strictObject({ moduleId: id, runId: z.string().uuid().optional() }), payload);
  const program = state.program?.compute;
  assert(program, 'TABLE_COMPUTE_NOT_FOUND', 'There are no saved compute rules on this table.');
  const module = program.modules.find(item => item.id === input.moduleId);
  assert(module, 'TABLE_COMPUTE_NOT_FOUND', 'That compute rule is no longer on this table.');
  const problems = computeProgramProblems(program, state.program!.collections, state.sources);
  assert(problems.length === 0, 'TABLE_SCHEMA', problems[0]?.message ?? 'The compute rules are invalid.');
  const runs = state.computeRuns ?? [];
  const unfinished = runs.filter(run => run.status === 'queued' || run.status === 'running');
  assert(!unfinished.some(run => run.moduleId === module.id) && unfinished.length < COMPUTE_LIMITS.runHistory,
    'TABLE_COMPUTE_BUSY', 'This calculation already has a pending run. Wait for it to finish.');
  const runId = input.runId ?? derivedComputeRunId(ctx, module.id, runs);
  assert(!runs.some(run => run.runId === runId), 'TABLE_COMPUTE_DUPLICATE', 'That compute run already exists.');
  const profile: ComputeRuntimeProfile = module.runtimeProfile ?? 'tabletop-compute-1';
  const run: ComputeRunRecord = {
    runId, moduleId: module.id, moduleVersion: module.version, runtimeProfile: profile,
    actorId: ctx.actorId, role: ctx.role, seat: ctx.seat ?? null,
    status: 'queued', startedAt: ctx.now,
  };
  computeRunRecordSchema.parse(run);
  const next = structuredClone(state);
  let terminalSlots = COMPUTE_LIMITS.runHistory - unfinished.length - 1;
  next.computeRuns = [run, ...runs].filter(item => item.status === 'queued' || item.status === 'running' || terminalSlots-- > 0);
  return { state: next, label: 'Queued ' + module.name + '.' };
}

function updateComputeRun(state: TableState, payload: unknown, ctx: ActorContext): TableCommandDecision {
  hasRole(ctx, ['owner', 'participant']);
  const input = parsePayload(z.strictObject({
    runId: z.string().uuid(),
    status: z.enum(['running', 'succeeded', 'failed', 'stale']),
    inputHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
    sourceIds: z.array(z.string().min(1).max(100)).max(4).optional(),
    inputProvenance: z.array(z.strictObject({
      inputId: id, type: z.enum(['text', 'number', 'boolean', 'text-list', 'table']),
      binding: computeInputBindingSchema,
      sourceIds: z.array(z.string().min(1).max(100)).max(4),
      upstreamRunId: z.string().uuid().optional(),
    })).max(COMPUTE_LIMITS.portsPerModule).optional(),
    dataRevision: z.number().int().nonnegative().optional(),
    ruleRevision: z.number().int().nonnegative().optional(),
    runtimeProfile: z.literal('tabletop-compute-1').optional(),
    outputs: z.array(z.strictObject({ outputId: id, value: z.unknown() })).max(COMPUTE_LIMITS.outputsPerModule).optional(),
    errorCode: z.enum(['COMPUTE_UNAVAILABLE', 'COMPUTE_FAILED', 'COMPUTE_INVALID_OUTPUT', 'COMPUTE_STALE']).optional(),
  }), payload);
  const next = structuredClone(state);
  const runIndex = (next.computeRuns ?? []).findIndex(run => run.runId === input.runId);
  assert(runIndex >= 0, 'TABLE_COMPUTE_NOT_FOUND', 'That compute run has expired from the run history.');
  const run = next.computeRuns![runIndex]!;
  const module = next.program?.compute?.modules.find(item => item.id === run.moduleId);
  if (input.status === 'running') {
    assert(module && module.version === run.moduleVersion
      && run.status === 'queued' && input.inputHash && input.sourceIds && input.inputProvenance
      && input.dataRevision !== undefined && input.ruleRevision !== undefined
      && input.runtimeProfile === (module.runtimeProfile ?? 'tabletop-compute-1'),
    'TABLE_COMPUTE_STATE', 'The queued run has incomplete or stale input details.');
    Object.assign(run, {
      status: 'running', inputHash: input.inputHash, sourceIds: input.sourceIds,
      inputProvenance: input.inputProvenance, dataRevision: input.dataRevision,
      ruleRevision: input.ruleRevision, runtimeProfile: input.runtimeProfile, startedAt: ctx.now,
    });
  } else if (input.status === 'succeeded') {
    if (run.status === 'running' && (!module || module.version !== run.moduleVersion
        || run.dataRevision !== next.dataRevision || run.ruleRevision !== next.ruleRevision)) {
      Object.assign(run, { status: 'stale', errorCode: 'COMPUTE_STALE', completedAt: ctx.now });
      delete run.outputs;
      return { state: next, label: 'The input changed before this result could be saved.' };
    }
    assert(module && module.version === run.moduleVersion && run.status === 'running',
      'TABLE_COMPUTE_STALE', 'The compute rule changed before its run could finish.');
    assert(input.outputs, 'TABLE_COMPUTE_STATE', 'A successful compute run must include outputs.');
    let result: ReturnType<typeof validateComputeOutputs>;
    try {
      result = validateComputeOutputs(module, { outputs: Object.fromEntries(input.outputs.map(output => [output.outputId, output.value])) });
      // Derived cards obey the target collection's field contract even though source rows stay untouched.
      for (const port of module.outputs) {
        if (!port.collectionId) continue;
        const collection = next.program!.collections.find(item => item.id === port.collectionId);
        const table = result.outputs[port.id];
        if (!collection || !isComputeTableValue(table)) throw new Error('COMPUTE_INVALID_OUTPUT');
        for (const row of table.rows) for (const field of collection.fields) {
          if (!value.safeParse(row[field.id]).success || !validValue(field, row[field.id])) throw new Error('COMPUTE_INVALID_OUTPUT');
        }
      }
    } catch {
      throw new DomainError('COMPUTE_INVALID_OUTPUT', 'The compute result does not match its declared outputs.');
    }
    run.status = 'succeeded';
    run.completedAt = ctx.now;
    run.outputs = Object.entries(result.outputs).map(([outputId, value]) => ({ outputId, value }));
    delete run.errorCode;
  } else {
    assert(run.status === 'queued' || run.status === 'running', 'TABLE_COMPUTE_STATE', 'Only an unfinished compute job can fail or become stale.');
    run.status = input.status;
    run.completedAt = ctx.now;
    assert(input.status === 'stale' || input.errorCode !== 'COMPUTE_STALE', 'TABLE_COMPUTE_STATE', 'A failed compute run cannot use the stale error code.');
    run.errorCode = input.status === 'stale' ? 'COMPUTE_STALE' : (input.errorCode ?? 'COMPUTE_FAILED');
  }
  computeRunRecordSchema.parse(run);
  return { state: next, label: input.status === 'succeeded' ? 'Compute run completed.' : 'Compute run ' + input.status + '.' };
}

export function handleTableCommand(state: TableState, type: string, payload: unknown, ctx: ActorContext): TableCommandDecision | null {
  if (type === 'table.compute.run') return queueComputeRun(state, payload, ctx, true);
  if (type === 'table.compute.queue') return queueComputeRun(state, payload, ctx, false);
  if (type === 'table.compute.update') return updateComputeRun(state, payload, ctx);
  if (type === 'table.import') {
    // F008: any member may add a file; removal stays with the owner.
    requirePermission(ctx, 'files.add', ['owner', 'participant']);
    const input = parsePayload(sourceInput, payload);
    assert(bytes(input.text) <= TABLE_FILE_BYTES && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(input.text), 'TABLE_FILE', 'Choose a UTF-8 text file up to 32 KiB.');
    assert(state.sources.length < 4 && state.sources.reduce((n, s) => n + bytes(s.text), bytes(input.text)) <= TABLE_TOTAL_SOURCE_BYTES, 'TABLE_LIMIT', 'Use at most four files and 64 KiB of source text.');
    if (/\.json$/iu.test(input.filename)) {
      let parsed: unknown; try { parsed = JSON.parse(input.text) } catch { throw new DomainError('TABLE_FILE', 'This JSON file is not valid.'); }
      assert(parsed && typeof parsed === 'object', 'TABLE_FILE', 'JSON must contain an object or an array.');
    }
    const sha256 = ctx.hash(input.text), sourceId = `source_${sha256.slice(0, 32)}`;
    assert(!state.sources.some(s => s.id === sourceId), 'TABLE_DUPLICATE_SOURCE', 'This source is already on the table.');
    const next: TableState = { ...structuredClone(state), sources: [...state.sources, { ...input, id: sourceId, sha256, createdAt: ctx.now }], dataRevision: state.dataRevision + 1, candidate: ctx.role === 'owner' ? null : state.candidate };
    // F054: a file added by a person stamps the Files card; the simulator never writes timestamps.
    next.cardMeta = pruneCardMeta(touchCardMeta(state.cardMeta, 'table.sources', ctx.now, ctx.actorId, 'human'), liveCanvasCardIds(next));
    return { state: next, label: `Source added: ${input.filename}. Review it before asking AI to propose a table.` };
  }
  if (type === 'table.removeSource') {
    requirePermission(ctx, 'files.remove', ['owner']); const input = parsePayload(z.strictObject({ sourceId: z.string().min(1).max(100) }), payload);
    assert(state.sources.some(s => s.id === input.sourceId), 'TABLE_FILE', 'Source not found.');
    const computeSourceUsed = (program: TableProgram | null | undefined) => program?.compute?.modules.some(module =>
      module.inputs.some(port => port.binding.kind === 'source' && port.binding.sourceId === input.sourceId)) ?? false;
    const computeRunSourceUsed = (state.computeRuns ?? []).some(run => run.sourceIds?.includes(input.sourceId));
    assert(!state.program?.evidence.some(e => e.sourceId === input.sourceId)
      && !computeSourceUsed(state.program)
      && !computeRunSourceUsed
      && !state.revisions.some(r => r.snapshot.kind === 'table'
        && (r.snapshot.program.evidence.some(e => e.sourceId === input.sourceId) || computeSourceUsed(r.snapshot.program))),
      'TABLE_EVIDENCE', 'An active or retained rule revision cites this source. Keep it with the room.');
    const next: TableState = { ...structuredClone(state), sources: state.sources.filter(s => s.id !== input.sourceId), dataRevision: state.dataRevision + 1, candidate: null };
    // F054: removing a file moves the Files card's update time, but never invents a creation time.
    if (state.cardMeta) next.cardMeta = pruneCardMeta(touchCardMeta(state.cardMeta, 'table.sources', ctx.now, ctx.actorId, 'human'), liveCanvasCardIds(next));
    return { state: next, label: 'Unused source removed.' };
  }
  if (type === 'table.setComputedColumns') {
    requirePermission(ctx, 'data.columns', ['owner']);
    const input = parsePayload(z.strictObject({ columns: z.array(computedColumnSchema).max(MAX_COMPUTED_COLUMNS) }), payload);
    const program = state.program;
    assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
    const problems = computedColumnProblems(input.columns, program);
    assert(problems.length === 0, 'TABLE_SCHEMA', problems[0] ?? 'The computed columns are invalid.');
    const next = structuredClone(state);
    next.computedColumns = structuredClone(input.columns);
    next.dataRevision += 1;
    next.activity = [...next.activity, { actorId: ctx.actorId, action: `Computed columns updated (${input.columns.length})`, at: ctx.now }].slice(-100);
    return { state: next, label: `Computed columns updated (${input.columns.length}).` };
  }
  if (type === 'table.importRows') {
    // Direct row import changes shared data, so it stays with the owner; members add files (F008).
    requirePermission(ctx, 'data.import', ['owner']);
    const input = parsePayload(z.strictObject({
      collection: id,
      mode: z.enum(['append', 'replace']).optional(),
      rows: z.array(z.record(z.string().min(1).max(100), value)).max(100),
    }).superRefine((request, context) => {
      if ((request.mode ?? 'append') === 'append' && request.rows.length === 0) {
        context.addIssue({ code: 'custom', path: ['rows'], message: 'Add at least one row when appending.' });
      }
    }), payload);
    const program = state.program;
    assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
    const collection = program.collections.find(item => item.id === input.collection);
    assert(collection, 'TABLE_SCHEMA', 'Choose an existing collection.');
    assert(!program.compute?.modules.some(module => module.outputs.some(output => output.collectionId === collection.id)),
      'TABLE_INPUT', 'Import rows into a raw collection, not a derived compute output.');
    const nextActionRevision = (state.actionRevision ?? 0) + 1;
    assert(Number.isSafeInteger(nextActionRevision), 'TABLE_LIMIT', 'The table action counter reached its limit.');
    const next = structuredClone(state);
    const existing = input.mode === 'replace' ? [] : next.records[collection.id] ?? [];
    const created: TableRecord[] = [];
    input.rows.forEach((raw, index) => {
      const rowNumber = index + 1;
      for (const key of Object.keys(raw)) {
        assert(collection.fields.some(field => field.id === key), 'TABLE_INPUT', `Row ${rowNumber}: unknown field "${key}".`);
      }
      const values: Record<string, TableValue> = {};
      for (const field of collection.fields) {
        const supplied = raw[field.id];
        if (supplied === undefined || supplied === null) {
          if (field.default !== undefined) values[field.id] = structuredClone(field.default);
          else if (field.required) throw new DomainError('TABLE_INPUT', `Row ${rowNumber}: ${field.label} is required.`);
          else values[field.id] = null;
          continue;
        }
        assert(validValue(field, supplied), 'TABLE_INPUT', `Row ${rowNumber}: ${field.label} is invalid.`);
        values[field.id] = structuredClone(supplied);
      }
      const digest = ctx.hash(canonicalJson(['importRows', collection.id, index, values])).toLowerCase();
      const suffix = digest.replace(/[^a-z0-9_-]/g, '').slice(0, TABLE_RECORD_ID_HASH_LENGTH) || 'x';
      const recordId = `${TABLE_RECORD_ID_PREFIX}${nextActionRevision}_${String(index).padStart(TABLE_RECORD_ORDINAL_WIDTH, '0')}_${suffix}`;
      assert(id.safeParse(recordId).success, 'TABLE_LIMIT', 'A bounded record identifier could not be generated.');
      assert(!existing.some(row => row.id === recordId) && !created.some(row => row.id === recordId), 'TABLE_INPUT', 'A generated record identifier collision prevented this import. No rows were imported.');
      created.push({ id: recordId, values });
    });
    next.records[collection.id] = input.mode === 'replace' ? created : [...existing, ...created];
    // Validate the whole table once, so a limit or unique violation imports nothing.
    checkRows(program, next.records);
    validateGenerativeOutput(program, next.records, { actor: ctx.actorId, ...(ctx.seat ? { seat: ctx.seat } : {}), turn: next.turn }, state.computeRuns, state);
    next.dataRevision += 1; next.actionRevision = nextActionRevision; next.candidate = null;
    next.activity = [...next.activity, { actorId: ctx.actorId, action: `Imported ${created.length} rows into ${collection.title}`, at: ctx.now }].slice(-100);
    return { state: next, label: input.mode === 'replace'
      ? `Replaced ${collection.title} with ${created.length} rows.`
      : `Imported ${created.length} rows into ${collection.title}.` };
  }
  if (type === 'table.addNote' || type === 'table.updateNote' || type === 'table.moveNote' || type === 'table.removeNote') {
    // F037: any member may keep shared notes on the canvas.
    hasRole(ctx, ['owner', 'participant']);
    return handleNoteCommand(state, type, payload, ctx);
  }
  if (type === 'table.roll') {
    // F048: only a member who may use the action may roll for it. Tables have no paused/defeated
    // state; the same role, permission, and turn gates as `table.act` apply.
    requirePermission(ctx, 'table.act', ['owner', 'participant']);
    const input = parsePayload(rollInput, payload);
    const program = state.program;
    assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
    const action = program.actions.find(a => a.id === input.actionId);
    assert(action && action.roles.some(role => role === ctx.role), 'FORBIDDEN', 'Your role cannot perform this action.');
    const parameter = action.parameters.find(p => p.id === input.parameterId);
    assert(parameter && parameter.type === 'roll' && parameter.roll, 'TABLE_INPUT', 'Choose a roll parameter of this action.');
    assert(!action.requireTurn || state.turn === (ctx.seat ?? 'host'), 'TABLE_TURN', 'Wait for your turn.');
    assert(Number.isSafeInteger(ctx.now) && ctx.now >= 0 && Number.isSafeInteger(ctx.now + ROLL_LIMITS.pendingTtlMs), 'INVALID_CLOCK', 'The server clock is outside the supported range.');
    const roll = createRoll(parameter.roll);
    const pending: TablePendingRoll = {
      actorId: ctx.actorId, actionId: action.id, parameterId: parameter.id,
      groups: roll.groups, values: roll.values, total: roll.total,
      modifier: parameter.roll.modifier ?? 0, dataRevision: state.dataRevision,
      createdAt: ctx.now, expiresAt: ctx.now + ROLL_LIMITS.pendingTtlMs,
    };
    // A re-roll replaces the actor's earlier pending roll for the same parameter without using a slot.
    const retained = retainPendingRolls(state.pendingRolls, ctx.now, pending);
    assert(retained.length < ROLL_LIMITS.pendingPerTable, 'TABLE_LIMIT', 'Too many unused rolls are waiting on this table; finish or wait out an earlier one.');
    const next = structuredClone(state);
    next.pendingRolls = [...retained, pending];
    const dice = roll.groups.map(group => `${group.count}d${group.faces}`).join(' + ');
    const modifier = parameter.roll.modifier;
    const modifierText = modifier === undefined || modifier === 0 ? '' : modifier > 0 ? ` + ${modifier}` : ` - ${Math.abs(modifier)}`;
    return { state: next, label: `Rolled ${dice}${modifierText} = ${roll.total}.`, roll, rollParameterId: parameter.id };
  }
  if (type !== 'table.act') return null;
  requirePermission(ctx, 'table.act', ['owner', 'participant']);
  const input = parsePayload(runInput, payload);
  const program = state.program;
  assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
  const action = program.actions.find(a => a.id === input.actionId);
  assert(action && action.roles.some(role => role === ctx.role), 'FORBIDDEN', 'Your role cannot perform this action.');
  const rollParameters = action.parameters.filter(p => p.type === 'roll');
  // F048: the rolled value is server-issued. Naming it in the submission is a spoof attempt.
  for (const p of rollParameters) {
    assert(!Object.hasOwn(input.inputs, p.id), 'TABLE_ROLL_CLIENT_VALUE', 'A roll parameter is filled by the server; do not send a value for it.');
  }
  assert(Object.keys(input.inputs).length === action.parameters.length - rollParameters.length && Object.keys(input.inputs).every(key => action.parameters.some(p => p.id === key)), 'TABLE_INPUT', 'Provide exactly the required action inputs.');
  for (const p of action.parameters) {
    if (p.type === 'roll') continue;
    const v = input.inputs[p.id];
    if (p.type === 'record') assert(typeof v === 'string' && state.records[p.collection!]?.some(row => row.id === v), 'TABLE_INPUT', 'Choose an existing record.');
    else assert(validValue({ ...p, type: p.type, required: true }, v), 'TABLE_INPUT', `${p.label} is invalid.`);
  }
  assert(!action.requireTurn || state.turn === (ctx.seat ?? 'host'), 'TABLE_TURN', 'Wait for your turn.');
  // F048: consume the pending roll atomically — single use, same data revision, not expired.
  const resolvedInputs: Record<string, TableValue> = { ...input.inputs };
  let consumedRoll: RollResult | undefined;
  let consumedRollParameterId: string | undefined;
  for (const p of rollParameters) {
    assert(p.roll, 'TABLE_SCHEMA', 'A roll parameter needs a roll spec.');
    const pending = (state.pendingRolls ?? []).find(item => item.actorId === ctx.actorId && item.actionId === action.id && item.parameterId === p.id);
    assert(pending, 'TABLE_ROLL_REQUIRED', 'Roll this action parameter on the server before sending the action.');
    assert(pending.dataRevision === state.dataRevision, 'TABLE_ROLL_STALE', 'The table changed after that roll; roll again.');
    assert(pending.expiresAt > ctx.now, 'TABLE_ROLL_EXPIRED', 'That roll expired; roll again.');
    assertPendingRoll(pending, p.roll);
    resolvedInputs[p.id] = pending.total;
    consumedRoll = { groups: pending.groups.map(group => ({ count: group.count, faces: group.faces })), values: [...pending.values], total: pending.total };
    consumedRollParameterId = p.id;
  }
  const nextActionRevision = (state.actionRevision ?? 0) + 1;
  assert(Number.isSafeInteger(nextActionRevision), 'TABLE_LIMIT', 'The table action counter reached its limit.');
  const evaluateExpression = createGenerativeExpressionSession({ program, records: state.records, inputs: resolvedInputs, action, actor: ctx.actorId, seat: ctx.seat, turn: state.turn, computeRuns: state.computeRuns, dataRevision: state.dataRevision, ruleRevision: state.ruleRevision });
  for (const c of action.conditions) assert(conditionPass(c.op, resolve(action, state, resolvedInputs, c.left, ctx, evaluateExpression), resolve(action, state, resolvedInputs, c.right, ctx, evaluateExpression)), 'TABLE_CONDITION', c.message);
  const next = structuredClone(state), touched = new Set<string>();
  if (consumedRoll && consumedRollParameterId) {
    const remaining = consumePendingRolls(next.pendingRolls, { actorId: ctx.actorId, actionId: action.id, parameterId: consumedRollParameterId });
    if (remaining) next.pendingRolls = remaining;
    else delete next.pendingRolls;
  }
  // Resolve all effects against the same before-state. A swap is one atomic action.
  for (const effect of action.effects) {
    const p = action.parameters.find(p => p.id === effect.record)!;
    const row = next.records[p.collection!].find(row => row.id === input.inputs[p.id])!;
    const key = `${p.collection}.${row.id}.${effect.field}`;
    assert(!touched.has(key), 'TABLE_INPUT', 'Two parameters point at the same effect target.'); touched.add(key);
    const resolved = resolve(action, state, resolvedInputs, effect.value, ctx, evaluateExpression);
    if (effect.op === 'add') { const old = row.values[effect.field]; assert(typeof old === 'number' && typeof resolved === 'number', 'TABLE_VALUE', 'Only numeric values can be added.'); row.values[effect.field] = old + resolved; }
    else row.values[effect.field] = structuredClone(resolved);
  }
  const createdIds = new Map<string, Set<string>>();
  for (const [index, create] of (action.creates ?? []).entries()) {
    const collection = program.collections.find(item => item.id === create.collection)!;
    const values: Record<string, TableValue> = {};
    for (const field of collection.fields) {
      const createValue = create.values[field.id];
      if (createValue !== undefined) values[field.id] = structuredClone(resolve(action, state, resolvedInputs, createValue, ctx, evaluateExpression));
      else if (field.default !== undefined) values[field.id] = structuredClone(field.default);
    }
    const digest = ctx.hash(canonicalJson([action.id, index])).toLowerCase();
    const suffix = digest.replace(/[^a-z0-9_-]/g, '').slice(0, TABLE_RECORD_ID_HASH_LENGTH) || 'x';
    const ordinal = String(index).padStart(TABLE_RECORD_ORDINAL_WIDTH, '0');
    const recordId = `${TABLE_RECORD_ID_PREFIX}${nextActionRevision}_${ordinal}_${suffix}`;
    assert(id.safeParse(recordId).success, 'TABLE_LIMIT', 'A bounded record identifier could not be generated.');
    const ids = createdIds.get(collection.id) ?? new Set<string>();
    assert(!ids.has(recordId) && !next.records[collection.id].some(row => row.id === recordId), 'TABLE_INPUT', 'A generated record identifier collision prevented this action. No action was applied.');
    ids.add(recordId);
    createdIds.set(collection.id, ids);
    next.records[collection.id].push({ id: recordId, values });
  }
  checkRows(program, next.records);
  if (action.advanceTurn) next.turn = program.turnOrder[(program.turnOrder.indexOf(state.turn ?? '') + 1) % program.turnOrder.length];
  validateGenerativeOutput(program, next.records, { actor: ctx.actorId, ...(ctx.seat ? { seat: ctx.seat } : {}), turn: next.turn }, state.computeRuns, state);
  next.dataRevision += 1; next.actionRevision = nextActionRevision; next.candidate = null;
  next.activity = [...next.activity, { actorId: ctx.actorId, action: action.title, at: ctx.now }].slice(-100);
  return {
    state: next,
    label: action.title,
    ...(consumedRoll ? { roll: consumedRoll } : {}),
    ...(consumedRollParameterId ? { rollParameterId: consumedRollParameterId } : {}),
  };
}
