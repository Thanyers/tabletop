import { z } from 'zod';
import { DomainError, type ActorContext } from '../shared/contracts';
import type { TableAction, TableChange, TableField, TableOperand, TableProgram, TableRecord, TableState, TableValue } from '../shared/table-contracts';
import { assert, canonicalJson, hasRole, parsePayload } from './helpers';

export const TABLE_FILE_BYTES = 32 * 1024;
export const TABLE_TOTAL_SOURCE_BYTES = 64 * 1024;
const id = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(x => !['constructor', 'prototype', '__proto__'].includes(x));
const text = z.string().min(1).max(500);
const value: z.ZodType<TableValue> = z.union([z.string().max(500), z.number().finite().min(-1e9).max(1e9), z.boolean(), z.null(), z.array(z.string().max(100)).max(32)]);
const fieldSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'list']), required: z.boolean(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(32).optional() });
const parameterSchema = z.strictObject({ id, label: text, type: z.enum(['text', 'number', 'boolean', 'record']), collection: id.optional(), min: z.number().finite().min(-1e9).max(1e9).optional(), max: z.number().finite().min(-1e9).max(1e9).optional(), choices: z.array(z.string().max(100)).min(1).max(32).optional() });
const operand: z.ZodType<TableOperand> = z.union([z.strictObject({ literal: value }), z.strictObject({ input: id }), z.strictObject({ record: id, field: id }), z.strictObject({ system: z.enum(['actor', 'seat', 'turn']) })]);
export const tableProgramSchema: z.ZodType<TableProgram> = z.strictObject({
  version: z.literal(1), title: z.string().min(1).max(100), description: text,
  collections: z.array(z.strictObject({ id, title: text, fields: z.array(fieldSchema).min(1).max(12) })).min(1).max(6),
  actions: z.array(z.strictObject({
    id, title: text, description: text, roles: z.array(z.enum(['owner', 'participant'])).min(1).max(2),
    parameters: z.array(parameterSchema).max(8),
    conditions: z.array(z.strictObject({ left: operand, op: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains']), right: operand, message: text })).max(24),
    effects: z.array(z.strictObject({ record: id, field: id, op: z.enum(['set', 'add']), value: operand })).max(24),
    requireTurn: z.boolean(), advanceTurn: z.boolean(),
  })).min(1).max(16),
  invariants: z.array(z.strictObject({ id, collection: id, fields: z.array(id).min(1).max(6), message: text })).max(12),
  turnOrder: z.array(z.string().regex(/^(host|member-[1-7])$/)).max(8),
  evidence: z.array(z.strictObject({ sourceId: z.string().min(1).max(100), quote: z.string().min(1).max(500) })).max(20),
  assumptions: z.array(text).max(12),
});
const rowSchema = z.strictObject({ id, values: z.record(id, value) });
export const tableChangeSchema = z.strictObject({ kind: z.literal('table'), program: tableProgramSchema, initialRecords: z.record(id, z.array(rowSchema).max(100)) });
const sourceInput = z.strictObject({ filename: z.string().min(1).max(120).regex(/^[^/\\\p{Cc}]+\.(csv|json|txt|md)$/iu), text: z.string().min(1).max(TABLE_FILE_BYTES) });
const runInput = z.strictObject({ actionId: id, inputs: z.record(id, value) });
const bytes = (s: string) => new TextEncoder().encode(s).byteLength;

export function createTableState(): TableState {
  return { kind: 'table', sources: [], program: null, records: {}, turn: null, actionRevision: 0, activity: [], dataRevision: 0, ruleRevision: 0, candidate: null, revisions: [] };
}
function unique(items: string[], label: string) { assert(new Set(items).size === items.length, 'TABLE_SCHEMA', `${label} must be unique.`); }
function validValue(field: Pick<TableField, 'type' | 'required' | 'min' | 'max' | 'choices'>, v: TableValue | undefined) {
  if (v === null || v === undefined) return !field.required;
  if (field.type === 'list') return Array.isArray(v) && v.every(x => typeof x === 'string');
  if (field.type === 'number') return typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e9 && (field.min === undefined || v >= field.min) && (field.max === undefined || v <= field.max);
  if (field.type === 'boolean') return typeof v === 'boolean';
  return typeof v === 'string' && (!field.choices || field.choices.includes(v));
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
    for (const f of c.fields) assert((f.min === undefined && f.max === undefined || f.type === 'number') && (f.min === undefined || f.max === undefined || f.min <= f.max) && (!f.choices || f.type === 'text'), 'TABLE_SCHEMA', 'Field bounds do not match its type.');
  }
  for (const action of program.actions) {
    unique(action.parameters.map(p => p.id), 'Action parameter identifiers');
    unique(action.effects.map(e => `${e.record}.${e.field}`), 'Action effect targets');
    assert(action.effects.length > 0 || action.advanceTurn, 'TABLE_SCHEMA', 'An action must change a field or advance the turn.');
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
  }
  for (const i of program.invariants) {
    const c = program.collections.find(c => c.id === i.collection);
    assert(c && i.fields.every(key => c.fields.some(f => f.id === key)), 'TABLE_SCHEMA', 'Unique constraint refers to an unknown field.');
  }
}

export function applyTableChange(state: TableState, raw: TableChange): TableState {
  const change = parsePayload(tableChangeSchema, raw);
  assert(bytes(JSON.stringify(change.program)) <= 64 * 1024 && bytes(JSON.stringify(change.initialRecords)) <= 128 * 1024, 'TABLE_LIMIT', 'The proposed rules or records exceed the table size limit.');
  checkProgram(change.program);
  assert(change.program.evidence.length > 0, 'TABLE_EVIDENCE', 'Cite at least one uploaded source.');
  for (const evidence of change.program.evidence) assert(state.sources.some(s => s.id === evidence.sourceId && s.text.includes(evidence.quote)), 'TABLE_EVIDENCE', 'A cited quotation is missing from the source.');
  if (state.program) {
    assert(Object.keys(change.initialRecords).length === 0, 'TABLE_PRESERVE_DATA', 'A rule edit must preserve current records; initialRecords must be empty.');
    assert(canonicalJson(state.program.collections) === canonicalJson(change.program.collections), 'TABLE_PRESERVE_DATA', 'A rule edit must retain the current collections and field definitions.');
    assert(state.turn === null || change.program.turnOrder.includes(state.turn), 'TABLE_PRESERVE_TURN', 'A rule edit must retain the current turn.');
  }
  const records = structuredClone(state.program ? state.records : change.initialRecords);
  for (const c of change.program.collections) records[c.id] ??= [];
  checkRows(change.program, records);
  return { ...structuredClone(state), program: structuredClone(change.program), records, turn: state.turn ?? change.program.turnOrder[0] ?? null };
}
export function tableChangeIssues(state: TableState, change: TableChange): string[] {
  try { applyTableChange(state, change); return [] } catch (e) { return [e instanceof Error ? e.message : 'Invalid table program.'] }
}
function resolve(action: TableAction, state: TableState, inputs: Record<string, TableValue>, o: TableOperand, ctx: ActorContext): TableValue {
  if ('literal' in o) return o.literal;
  if ('system' in o) return o.system === 'actor' ? ctx.actorId : o.system === 'seat' ? ctx.seat ?? 'host' : state.turn;
  if ('input' in o) return inputs[o.input];
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
    hasRole(ctx, ['owner']);
    const input = parsePayload(sourceInput, payload);
    assert(bytes(input.text) <= TABLE_FILE_BYTES && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/u.test(input.text), 'TABLE_FILE', 'Choose a UTF-8 text file up to 32 KiB.');
    assert(state.sources.length < 4 && state.sources.reduce((n, s) => n + bytes(s.text), bytes(input.text)) <= TABLE_TOTAL_SOURCE_BYTES, 'TABLE_LIMIT', 'Use at most four files and 64 KiB of source text.');
    if (/\.json$/iu.test(input.filename)) {
      let parsed: unknown; try { parsed = JSON.parse(input.text) } catch { throw new DomainError('TABLE_FILE', 'This JSON file is not valid.'); }
      assert(parsed && typeof parsed === 'object', 'TABLE_FILE', 'JSON must contain an object or an array.');
    }
    const sha256 = ctx.hash(input.text), sourceId = `source_${sha256.slice(0, 32)}`;
    assert(!state.sources.some(s => s.id === sourceId), 'TABLE_DUPLICATE_SOURCE', 'This source is already on the table.');
    return { state: { ...structuredClone(state), sources: [...state.sources, { ...input, id: sourceId, sha256, createdAt: ctx.now }], dataRevision: state.dataRevision + 1, candidate: null }, label: `Source added: ${input.filename}. Review it before asking AI to propose a table.` };
  }
  if (type === 'table.removeSource') {
    hasRole(ctx, ['owner']); const input = parsePayload(z.strictObject({ sourceId: z.string().min(1).max(100) }), payload);
    assert(state.sources.some(s => s.id === input.sourceId), 'TABLE_FILE', 'Source not found.');
    assert(!state.program?.evidence.some(e => e.sourceId === input.sourceId)
      && !state.revisions.some(r => r.snapshot.kind === 'table' && r.snapshot.program.evidence.some(e => e.sourceId === input.sourceId)),
      'TABLE_EVIDENCE', 'An active or retained rule revision cites this source. Keep it with the room.');
    return { state: { ...structuredClone(state), sources: state.sources.filter(s => s.id !== input.sourceId), dataRevision: state.dataRevision + 1, candidate: null }, label: 'Unused source removed.' };
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
  for (const c of action.conditions) assert(conditionPass(c.op, resolve(action, state, input.inputs, c.left, ctx), resolve(action, state, input.inputs, c.right, ctx)), 'TABLE_CONDITION', c.message);
  const next = structuredClone(state), touched = new Set<string>();
  // Resolve all effects against the same before-state. A swap is one atomic action.
  for (const effect of action.effects) {
    const p = action.parameters.find(p => p.id === effect.record)!;
    const row = next.records[p.collection!].find(row => row.id === input.inputs[p.id])!;
    const key = `${p.collection}.${row.id}.${effect.field}`;
    assert(!touched.has(key), 'TABLE_INPUT', 'Two parameters point at the same effect target.'); touched.add(key);
    const resolved = resolve(action, state, input.inputs, effect.value, ctx);
    if (effect.op === 'add') { const old = row.values[effect.field]; assert(typeof old === 'number' && typeof resolved === 'number', 'TABLE_VALUE', 'Only numeric values can be added.'); row.values[effect.field] = old + resolved; }
    else row.values[effect.field] = structuredClone(resolved);
  }
  checkRows(program, next.records);
  if (action.advanceTurn) next.turn = program.turnOrder[(program.turnOrder.indexOf(state.turn ?? '') + 1) % program.turnOrder.length];
  next.dataRevision += 1; next.actionRevision = (next.actionRevision ?? 0) + 1; next.candidate = null;
  assert(Number.isSafeInteger(next.actionRevision), 'TABLE_LIMIT', 'The table action counter reached its limit.');
  next.activity = [...next.activity, { actorId: ctx.actorId, action: action.title, at: ctx.now }].slice(-100);
  return { state: next, label: action.title };
}
