import { z } from 'zod';
import { DomainError, type ActorContext, type Seat } from '../shared/contracts';
import type { TableAction, TableChange, TableField, TableOperand, TableProgram, TableRecord, TableState, TableValue } from '../shared/table-contracts';
import { GENERATIVE_FORBIDDEN_IDENTIFIERS, type GenerativeExpression, type GenerativeOutput, type GenerativeScalar } from '../shared/generative-contracts';
import { assert, canonicalJson, hasRole, ID_SCHEMA, parsePayload } from './helpers';
import { createGenerativeExpressionSession, evaluateGenerativeCanvas } from '../runtime/generative/evaluator';
import { generativeCanvasSchema, generativeExpressionSchema } from '../runtime/generative/schema';
import { expressionWithinBounds, getGenerativeExpressionType, validateGenerativeProgram } from '../runtime/generative/validation';
import { preserveCanvasViews } from '../runtime/generative/preserve';
import { MAX_COMPUTED_COLUMNS, computedColumnProblems, retainComputedColumns } from '../shared/computed-columns';
import type { ComputedColumn, ComputedExpression } from '../shared/table-contracts';

export const TABLE_FILE_BYTES = 32 * 1024;
export const TABLE_TOTAL_SOURCE_BYTES = 64 * 1024;
const forbiddenIdentifiers = new Set<string>(GENERATIVE_FORBIDDEN_IDENTIFIERS);
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(x => !forbiddenIdentifiers.has(x));
const text = z.string().min(1).max(500);
const value: z.ZodType<TableValue> = z.union([z.string().max(500), z.number().finite().min(-1e9).max(1e9), z.boolean(), z.null(), z.array(z.string().max(100)).max(32)]);
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;
const MAX_TABLE_ACTION_CREATES = 12;
const TABLE_RECORD_ID_PREFIX = 'record_';
const TABLE_RECORD_ID_HASH_LENGTH = 12;
const TABLE_RECORD_ORDINAL_WIDTH = String(MAX_TABLE_ACTION_CREATES - 1).length;
const fieldSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'list']), required: z.boolean(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(32).optional(), default: value.optional() });
const parameterSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'record']), collection: id.optional(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(32).optional() });
const operand: z.ZodType<TableOperand> = z.union([z.strictObject({ literal: value }), z.strictObject({ input: id }), z.strictObject({ record: id, field: id }), z.strictObject({ system: z.enum(['actor', 'seat', 'turn']) }), z.strictObject({ expression: generativeExpressionSchema })]);
const computedExpressionSchema: z.ZodType<ComputedExpression> = z.lazy(() => z.union([
  z.strictObject({ op: z.literal('field'), field: id }),
  z.strictObject({ op: z.literal('literal'), value: z.number().finite().min(-1e9).max(1e9) }),
  ...(['add', 'subtract', 'multiply', 'divide'] as const).map((op) => z.strictObject({
    op: z.literal(op), left: computedExpressionSchema, right: computedExpressionSchema,
  })),
]));
const computedColumnSchema: z.ZodType<ComputedColumn> = z.strictObject({ id, collection: id, label: z.string().min(1).max(40), expression: computedExpressionSchema });
export const tableProgramSchema: z.ZodType<TableProgram> = z.strictObject({
  version: z.literal(1), title: z.string().min(1).max(100), description: text,
  collections: z.array(z.strictObject({ id, title: text, fields: z.array(fieldSchema).min(1).max(12) })).min(1).max(6),
  actions: z.array(z.strictObject({
    id, title: text, description: text, roles: z.array(z.enum(['owner', 'participant'])).min(1).max(2),
    parameters: z.array(parameterSchema).max(8),
    conditions: z.array(z.strictObject({ left: operand, op: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains']), right: operand, message: text })).max(24),
    effects: z.array(z.strictObject({ record: id, field: id, op: z.enum(['set', 'add']), value: operand })).max(24),
    creates: z.array(z.strictObject({ collection: id, values: z.record(id, operand) })).max(MAX_TABLE_ACTION_CREATES).optional(),
    requireTurn: z.boolean(), advanceTurn: z.boolean(),
  })).min(1).max(16),
  invariants: z.array(z.strictObject({ id, collection: id, fields: z.array(id).min(1).max(6), message: text })).max(12),
  turnOrder: z.array(z.string().regex(/^(host|member-[1-7])$/)).max(8),
  evidence: z.array(z.strictObject({ sourceId: z.string().min(1).max(100), quote: z.string().min(1).max(500) })).max(20),
  assumptions: z.array(text).max(12),
  canvas: generativeCanvasSchema.optional(),
});
export const tableRowSchema = z.strictObject({ id, values: z.record(id, value) });
export const tableRecordsSchema = z.record(id, z.array(tableRowSchema).max(100)).superRefine((records, ctx) => {
  const rowCount = Object.values(records).reduce((count, rows) => count + rows.length, 0);
  if (rowCount > 200) ctx.addIssue({ code: 'custom', message: 'A table supports at most 200 records.' });
  if (bytes(JSON.stringify(records)) > 128 * 1024) ctx.addIssue({ code: 'custom', message: 'The records exceed the 128 KiB table limit.' });
});
export const tableChangeSchema = z.strictObject({ kind: z.literal('table'), program: tableProgramSchema, initialRecords: tableRecordsSchema });
export function parseBoundedTableChange(value: unknown): TableChange {
  assert(expressionWithinBounds(value), 'TABLE_LIMIT', 'The generated expressions exceed deterministic depth, node, or array limits.');
  return parsePayload(tableChangeSchema, value);
}
const sourceInput = z.strictObject({ filename: z.string().min(1).max(120).regex(/^[^/\\\p{Cc}]+\.(csv|json|txt|md)$/iu), text: z.string().min(1).max(TABLE_FILE_BYTES) });
const runInput = z.strictObject({ actionId: id, inputs: z.record(id, value) });

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
  assert(bytes(JSON.stringify(records)) <= 128 * 1024, 'TABLE_LIMIT', 'The records exceed the 128 KiB table limit. No action was applied.');
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
function checkProgram(program: TableProgram) {
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
    }
    const operandType = (o: TableOperand): string => {
      if ('literal' in o) return o.literal === null ? 'null' : Array.isArray(o.literal) ? 'list' : typeof o.literal === 'string' ? 'text' : typeof o.literal;
      if ('expression' in o) return getGenerativeExpressionType(o.expression, program, action);
      if ('system' in o) return 'text';
      if ('record' in o) return resolveField(o.record, o.field).type;
      const p = action.parameters.find(p => p.id === o.input); assert(p, 'TABLE_SCHEMA', 'Unknown input reference.'); return p.type === 'record' ? 'text' : p.type;
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
}

export function applyTableChange(state: TableState, raw: TableChange, actor?: Pick<ActorContext, 'actorId' | 'seat'>): TableState {
  const change = parseBoundedTableChange(raw);
  assert(bytes(JSON.stringify(change.program)) <= 64 * 1024 && bytes(JSON.stringify(change.initialRecords)) <= 128 * 1024, 'TABLE_LIMIT', 'The proposed rules or records exceed the table size limit.');
  checkProgram(change.program);
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
  validateGenerativeOutput(change.program, records, actor ? { actor: actor.actorId, ...(actor.seat ? { seat: actor.seat } : {}), turn } : undefined);
  const computedColumns = retainComputedColumns(state.computedColumns, change.program);
  return { ...structuredClone(state), program: structuredClone(change.program), records, turn, computedColumns };
}
export function tableChangeIssues(state: TableState, change: TableChange): string[] {
  try { applyTableChange(state, change); return [] } catch (e) { return [e instanceof Error ? e.message : 'Invalid table program.'] }
}
function isGenerativeArray(value: GenerativeOutput): value is readonly GenerativeScalar[] { return Array.isArray(value); }
const GENERATIVE_SEATS = ['learner-1', 'learner-2', 'mira', 'pip', 'member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6', 'member-7'] as const satisfies readonly Seat[];
const MAX_SUPPORTED_ACTOR_ID_LENGTH = 160; // ID_SCHEMA permits actor IDs up to this length.
const MAX_ACTOR_ID = '\u0000'.repeat(MAX_SUPPORTED_ACTOR_ID_LENGTH); // JSON escapes each NUL as six UTF-8 bytes.
const MAX_GENERATIVE_VALIDATION_CONTEXTS = 64;

interface GenerativeValidationContext {
  actor: string;
  seat?: Seat;
  turn: string | null;
}

function generativeValidationContexts(program: TableProgram, canvas: NonNullable<TableProgram['canvas']>, actualContext?: GenerativeValidationContext): GenerativeValidationContext[] {
  const systemValues = new Set<'actor' | 'seat' | 'turn'>();
  const actorCandidates = new Set<string>([MAX_ACTOR_ID, 'host', ...GENERATIVE_SEATS, ...program.turnOrder]);
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

  const maximumSeat = [...GENERATIVE_SEATS].sort((left, right) => right.length - left.length)[0];
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
    for (const seat of GENERATIVE_SEATS) add({ actor: MAX_ACTOR_ID, seat, turn: maximumTurn });
  }
  if (systemValues.has('turn')) {
    add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn: null });
    for (const turn of program.turnOrder) add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn });
  }

  // Equality between system values can select a branch when their values coincide. Probe each
  // supported shared value without constructing the full actor × seat × turn product.
  const sharedValues = new Set(['host', ...GENERATIVE_SEATS, ...program.turnOrder]);
  for (const value of sharedValues) {
    const seat = (GENERATIVE_SEATS as readonly string[]).includes(value) ? value as Seat : undefined;
    const turn = program.turnOrder.includes(value) ? value : null;
    if (systemValues.has('actor') && (systemValues.has('seat') || systemValues.has('turn'))) add({ actor: value, ...(seat ? { seat } : {}), turn });
    if (systemValues.has('seat') && systemValues.has('turn') && seat && program.turnOrder.includes(value)) add({ actor: MAX_ACTOR_ID, seat, turn: value });
  }
  if (actualContext) add(actualContext);
  if (contexts.length === 0) add({ actor: MAX_ACTOR_ID, seat: maximumSeat, turn: maximumTurn });
  return contexts;
}

function validateGenerativeOutput(program: TableProgram, records: Record<string, TableRecord[]>, actualContext?: GenerativeValidationContext): void {
  if (!program.canvas) return;
  try {
    for (const context of generativeValidationContexts(program, program.canvas, actualContext)) {
      evaluateGenerativeCanvas(program.canvas, { program, records, ...context });
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
export function handleTableCommand(state: TableState, type: string, payload: unknown, ctx: ActorContext): { state: TableState; label: string } | null {
  if (type === 'table.import') {
    // F008: any member may add a file; removal stays with the owner.
    hasRole(ctx, ['owner', 'participant']);
    const input = parsePayload(sourceInput, payload);
    assert(bytes(input.text) <= TABLE_FILE_BYTES && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(input.text), 'TABLE_FILE', 'Choose a UTF-8 text file up to 32 KiB.');
    assert(state.sources.length < 4 && state.sources.reduce((n, s) => n + bytes(s.text), bytes(input.text)) <= TABLE_TOTAL_SOURCE_BYTES, 'TABLE_LIMIT', 'Use at most four files and 64 KiB of source text.');
    if (/\.json$/iu.test(input.filename)) {
      let parsed: unknown; try { parsed = JSON.parse(input.text) } catch { throw new DomainError('TABLE_FILE', 'This JSON file is not valid.'); }
      assert(parsed && typeof parsed === 'object', 'TABLE_FILE', 'JSON must contain an object or an array.');
    }
    const sha256 = ctx.hash(input.text), sourceId = `source_${sha256.slice(0, 32)}`;
    assert(!state.sources.some(s => s.id === sourceId), 'TABLE_DUPLICATE_SOURCE', 'This source is already on the table.');
    return { state: { ...structuredClone(state), sources: [...state.sources, { ...input, id: sourceId, sha256, createdAt: ctx.now }], dataRevision: state.dataRevision + 1, candidate: ctx.role === 'owner' ? null : state.candidate }, label: `Source added: ${input.filename}. Review it before asking AI to propose a table.` };
  }
  if (type === 'table.removeSource') {
    hasRole(ctx, ['owner']); const input = parsePayload(z.strictObject({ sourceId: z.string().min(1).max(100) }), payload);
    assert(state.sources.some(s => s.id === input.sourceId), 'TABLE_FILE', 'Source not found.');
    assert(!state.program?.evidence.some(e => e.sourceId === input.sourceId)
      && !state.revisions.some(r => r.snapshot.kind === 'table' && r.snapshot.program.evidence.some(e => e.sourceId === input.sourceId)),
      'TABLE_EVIDENCE', 'An active or retained rule revision cites this source. Keep it with the room.');
    return { state: { ...structuredClone(state), sources: state.sources.filter(s => s.id !== input.sourceId), dataRevision: state.dataRevision + 1, candidate: null }, label: 'Unused source removed.' };
  }
  if (type === 'table.setComputedColumns') {
    hasRole(ctx, ['owner']);
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
    hasRole(ctx, ['owner']);
    const input = parsePayload(z.strictObject({
      collection: id,
      rows: z.array(z.record(z.string().min(1).max(100), value)).min(1).max(100),
    }), payload);
    const program = state.program;
    assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
    const collection = program.collections.find(item => item.id === input.collection);
    assert(collection, 'TABLE_SCHEMA', 'Choose an existing collection.');
    const nextActionRevision = (state.actionRevision ?? 0) + 1;
    assert(Number.isSafeInteger(nextActionRevision), 'TABLE_LIMIT', 'The table action counter reached its limit.');
    const next = structuredClone(state);
    const existing = next.records[collection.id] ?? [];
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
    next.records[collection.id] = [...existing, ...created];
    // Validate the whole table once, so a limit or unique violation imports nothing.
    checkRows(program, next.records);
    validateGenerativeOutput(program, next.records, { actor: ctx.actorId, ...(ctx.seat ? { seat: ctx.seat } : {}), turn: next.turn });
    next.dataRevision += 1; next.actionRevision = nextActionRevision; next.candidate = null;
    next.activity = [...next.activity, { actorId: ctx.actorId, action: `Imported ${created.length} rows into ${collection.title}`, at: ctx.now }].slice(-100);
    return { state: next, label: `Imported ${created.length} rows into ${collection.title}.` };
  }
  if (type !== 'table.act') return null;
  hasRole(ctx, ['owner', 'participant']);
  const input = parsePayload(runInput, payload);
  const program = state.program;
  assert(program, 'TABLE_INACTIVE', 'Review and activate the table rules first.');
  const action = program.actions.find(a => a.id === input.actionId);
  assert(action && action.roles.some(role => role === ctx.role), 'FORBIDDEN', 'Your role cannot perform this action.');
  assert(Object.keys(input.inputs).length === action.parameters.length && Object.keys(input.inputs).every(key => action.parameters.some(p => p.id === key)), 'TABLE_INPUT', 'Provide exactly the required action inputs.');
  for (const p of action.parameters) {
    const v = input.inputs[p.id];
    if (p.type === 'record') assert(typeof v === 'string' && state.records[p.collection!]?.some(row => row.id === v), 'TABLE_INPUT', 'Choose an existing record.');
    else assert(validValue({ ...p, type: p.type, required: true }, v), 'TABLE_INPUT', `${p.label} is invalid.`);
  }
  assert(!action.requireTurn || state.turn === (ctx.seat ?? 'host'), 'TABLE_TURN', 'Wait for your turn.');
  const nextActionRevision = (state.actionRevision ?? 0) + 1;
  assert(Number.isSafeInteger(nextActionRevision), 'TABLE_LIMIT', 'The table action counter reached its limit.');
  const evaluateExpression = createGenerativeExpressionSession({ program, records: state.records, inputs: input.inputs, action, actor: ctx.actorId, seat: ctx.seat, turn: state.turn });
  for (const c of action.conditions) assert(conditionPass(c.op, resolve(action, state, input.inputs, c.left, ctx, evaluateExpression), resolve(action, state, input.inputs, c.right, ctx, evaluateExpression)), 'TABLE_CONDITION', c.message);
  const next = structuredClone(state), touched = new Set<string>();
  // Resolve all effects against the same before-state. A swap is one atomic action.
  for (const effect of action.effects) {
    const p = action.parameters.find(p => p.id === effect.record)!;
    const row = next.records[p.collection!].find(row => row.id === input.inputs[p.id])!;
    const key = `${p.collection}.${row.id}.${effect.field}`;
    assert(!touched.has(key), 'TABLE_INPUT', 'Two parameters point at the same effect target.'); touched.add(key);
    const resolved = resolve(action, state, input.inputs, effect.value, ctx, evaluateExpression);
    if (effect.op === 'add') { const old = row.values[effect.field]; assert(typeof old === 'number' && typeof resolved === 'number', 'TABLE_VALUE', 'Only numeric values can be added.'); row.values[effect.field] = old + resolved; }
    else row.values[effect.field] = structuredClone(resolved);
  }
  const createdIds = new Map<string, Set<string>>();
  for (const [index, create] of (action.creates ?? []).entries()) {
    const collection = program.collections.find(item => item.id === create.collection)!;
    const values: Record<string, TableValue> = {};
    for (const field of collection.fields) {
      const createValue = create.values[field.id];
      if (createValue !== undefined) values[field.id] = structuredClone(resolve(action, state, input.inputs, createValue, ctx, evaluateExpression));
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
  validateGenerativeOutput(program, next.records, { actor: ctx.actorId, ...(ctx.seat ? { seat: ctx.seat } : {}), turn: next.turn });
  next.dataRevision += 1; next.actionRevision = nextActionRevision; next.candidate = null;
  next.activity = [...next.activity, { actorId: ctx.actorId, action: action.title, at: ctx.now }].slice(-100);
  return { state: next, label: action.title };
}
