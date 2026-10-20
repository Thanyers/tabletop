import type { DomainState, EncounterState, InvoiceState, PhysicsParams, TeachingState, WorkspaceView } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import { calculatePhysics, reconcileInvoice } from '../domain';
import { z } from 'zod';

export type Visibility = 'private' | 'shared';
export interface Port { valueType: string; required: boolean; visibility: Visibility }
export interface PlanNode { id: string; capability: string; title: string; position: { x: number; y: number }; inputs: Record<string, unknown>; visibility: Visibility; version: 1; visible?: boolean }
export interface Binding { id: string; from: { node: string; port: string }; to: { node: string; port: string }; valueType: string }
export interface Manifest { version: 1; kind: DomainState['kind']; nodes: PlanNode[]; bindings: Binding[] }
export interface Capability { version: 1; inputs: Record<string, Port>; outputs: Record<string, Port>; evaluate(inputs: Record<string, unknown>): Record<string, unknown> }
export interface ExecutablePlan extends Manifest { order: string[]; outputs: Record<string, Record<string, unknown>> }
export interface Diagnostic { code: string; node?: string; port?: string; message: string }
type Compilation = { ok: true; plan: ExecutablePlan } | { ok: false; diagnostics: Diagnostic[] };
export interface ReviewItem { id: string; shipmentId: string; reason: string; sourceIds: string[] }
const port = (valueType: string, visibility: Visibility = 'shared', required = true): Port => ({ valueType, visibility, required });
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const object = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const stateKind = (value: unknown, kind: DomainState['kind']) => object(value) && value.kind === kind && Number.isSafeInteger(value.dataRevision) && Number.isSafeInteger(value.ruleRevision);
const validators: Record<string, (value: unknown) => boolean> = {
  TableStateV1: v => stateKind(v, 'table'), TableRowsV1: v => Array.isArray(v) && v.length <= 100 && v.every(r => object(r) && typeof r.id === 'string' && object(r.values)), RuleRevisionV1: v => Number.isSafeInteger(v) && Number(v) >= 0,
  InvoiceStateV1: v => stateKind(v, 'invoice'), TeachingStateV1: v => stateKind(v, 'teaching'), EncounterStateV1: v => stateKind(v, 'encounter'),
  InvoiceResultV1: v => object(v) && Array.isArray(v.rows) && Array.isArray(v.gaps) && finite(v.knownExpectedSatang) && finite(v.unknownCount),
  'ReviewItemV1[]': v => Array.isArray(v) && v.every(x => object(x) && typeof x.id === 'string' && typeof x.shipmentId === 'string' && typeof x.reason === 'string' && Array.isArray(x.sourceIds)),
  PhysicsParametersV1: v => object(v) && finite(v.force) && finite(v.mass) && finite(v.time) && v.force >= 0 && v.force <= 20 && v.mass >= .5 && v.mass <= 10 && v.time >= 0 && v.time <= 5,
  PhysicsResultV1: v => object(v) && Object.values(v).every(x => finite(x) || Array.isArray(x)),
  EncounterBoardV1: v => object(v) && Array.isArray(v.characters) && typeof v.phase === 'string',
};
const identity = (key: string) => (inputs: Record<string, unknown>) => ({ [key]: inputs[key] });
const identifierSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,159}$/);
const endpointSchema = z.strictObject({ node: identifierSchema, port: z.string().regex(/^[a-z][a-zA-Z0-9]{0,79}$/) });
const manifestSchema = z.strictObject({
  version: z.literal(1), kind: z.enum(['invoice', 'teaching', 'encounter', 'table']),
  nodes: z.array(z.strictObject({
    id: identifierSchema.max(80), capability: identifierSchema, title: z.string().min(1).max(160),
    position: z.strictObject({ x: z.number().finite(), y: z.number().finite() }),
    inputs: z.record(z.string(), z.unknown()), visibility: z.enum(['private', 'shared']),
    version: z.literal(1), visible: z.boolean().optional(),
  })).min(1).max(24),
  bindings: z.array(z.strictObject({ id: z.string().min(1).max(300), from: endpointSchema, to: endpointSchema, valueType: z.string().min(1).max(80) })).max(96),
});
export const capabilityRegistry: Readonly<Record<string, Capability>> = {
  'table.sources': { version: 1, inputs: { state: port('TableStateV1', 'private') }, outputs: {}, evaluate: () => ({}) },
  'table.rules': { version: 1, inputs: { state: port('TableStateV1', 'private') }, outputs: { revision: port('RuleRevisionV1') }, evaluate: i => ({ revision: (i.state as TableState).ruleRevision }) },
  'table.collection': { version: 1, inputs: { rows: port('TableRowsV1'), revision: port('RuleRevisionV1') }, outputs: { rows: port('TableRowsV1') }, evaluate: identity('rows') },
  'table.actions': { version: 1, inputs: { revision: port('RuleRevisionV1') }, outputs: {}, evaluate: () => ({}) },
  'invoice.source': { version: 1, inputs: { state: port('InvoiceStateV1', 'private') }, outputs: { invoice: port('InvoiceStateV1', 'private') }, evaluate: i => ({ invoice: i.state }) },
  'invoice.reconcile': { version: 1, inputs: { invoice: port('InvoiceStateV1', 'private') }, outputs: { result: port('InvoiceResultV1', 'private'), exceptions: port('ReviewItemV1[]', 'private'), surchargeExceptions: port('ReviewItemV1[]', 'private') }, evaluate: i => {
    const result = reconcileInvoice(i.invoice as InvoiceState);
    const items: ReviewItem[] = result.rows.filter(r => r.reasons.length > 0 || (r.deltaSatang !== null && r.deltaSatang !== 0)).map(r => ({ id: r.key, shipmentId: r.shipmentId, reason: r.reasons.join('; ') || 'ยอดเรียกเก็บต่างจากกฎที่ตรวจแล้ว', sourceIds: r.sourceIds }));
    return { result, exceptions: items, surchargeExceptions: result.rows.filter(r => (r.surchargeSatang ?? 0) > 0).map(r => ({ id: `surcharge:${r.key}`, shipmentId: r.shipmentId, reason: 'ตรวจรายการค่าบริการเพิ่มเติมกับหลักฐาน', sourceIds: r.sourceIds })) };
  } },
  'invoice.table': { version: 1, inputs: { result: port('InvoiceResultV1', 'private') }, outputs: { result: port('InvoiceResultV1', 'private') }, evaluate: identity('result') },
  'review.merge': { version: 1, inputs: { base: port('ReviewItemV1[]', 'private'), extra: port('ReviewItemV1[]', 'private') }, outputs: { items: port('ReviewItemV1[]', 'private') }, evaluate: i => ({ items: [...i.base as ReviewItem[], ...i.extra as ReviewItem[]] }) },
  'invoice.review': { version: 1, inputs: { items: port('ReviewItemV1[]', 'private') }, outputs: { items: port('ReviewItemV1[]', 'private') }, evaluate: identity('items') },
  'invoice.rules': { version: 1, inputs: { state: port('InvoiceStateV1', 'private') }, outputs: {}, evaluate: () => ({}) },
  'lesson.source': { version: 1, inputs: { parameters: port('PhysicsParametersV1') }, outputs: { parameters: port('PhysicsParametersV1') }, evaluate: identity('parameters') },
  'physics.model': { version: 1, inputs: { parameters: port('PhysicsParametersV1') }, outputs: { physics: port('PhysicsResultV1') }, evaluate: i => ({ physics: calculatePhysics(i.parameters as PhysicsParams) }) },
  'lesson.scene': { version: 1, inputs: { physics: port('PhysicsResultV1') }, outputs: { physics: port('PhysicsResultV1') }, evaluate: identity('physics') },
  'lesson.graph': { version: 1, inputs: { physics: port('PhysicsResultV1') }, outputs: { physics: port('PhysicsResultV1') }, evaluate: identity('physics') },
  'lesson.question': { version: 1, inputs: { state: port('TeachingStateV1', 'private') }, outputs: {}, evaluate: () => ({}) },
  'encounter.source': { version: 1, inputs: { state: port('EncounterStateV1', 'private') }, outputs: { board: port('EncounterBoardV1') }, evaluate: i => { const s = i.state as EncounterState; return { board: { characters: s.characters, phase: s.phase, pendingHit: s.pendingHit, turn: s.turn, events: s.events, rule: s.rule } } } },
  'encounter.board': { version: 1, inputs: { board: port('EncounterBoardV1') }, outputs: { board: port('EncounterBoardV1') }, evaluate: identity('board') },
  'encounter.actions': { version: 1, inputs: { board: port('EncounterBoardV1') }, outputs: {}, evaluate: () => ({}) },
};

/** Compile a bounded, curated graph. A failure returns no partially executable plan. */
export function compileManifest(rawManifest: unknown, registry: Readonly<Record<string, Capability>> = capabilityRegistry): Compilation {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, node?: string, name?: string) => diagnostics.push({ code, message, node, port: name });
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) return { ok: false, diagnostics: [{ code: 'SCHEMA', message: 'Unsupported manifest shape/version or resource limit' }] };
  const manifest: Manifest = parsed.data;
  const nodes = new Map<string, PlanNode>();
  const incoming = new Map<string, Binding>(); const edges = new Map<string, string[]>();
  for (const node of manifest.nodes) {
    if (!/^[a-z][a-z0-9._-]{0,79}$/.test(node.id) || nodes.has(node.id)) fail('DUPLICATE_ID', 'Node IDs must be unique bounded identifiers', node.id);
    nodes.set(node.id, node); edges.set(node.id, []);
    const cap = registry[node.capability];
    if (!cap || cap.version !== node.version) { fail('CAPABILITY', 'Unknown capability or incompatible version', node.id); continue }
    if (!object(node.inputs) || !node.position || !finite(node.position.x) || !finite(node.position.y) || !['shared', 'private'].includes(node.visibility)) { fail('SCHEMA', 'Invalid node inputs/layout/policy', node.id); continue }
    for (const [name, value] of Object.entries(node.inputs)) {
      const target = cap.inputs[name];
      if (!target) fail('PORT', 'Unknown literal input', node.id, name);
      else if (!validators[target.valueType]?.(value)) fail('INPUT_TYPE', 'Literal input does not match its typed port', node.id, name);
    }
  }
  const bindingIds = new Set<string>();
  for (const binding of manifest.bindings) {
    if (bindingIds.has(binding.id)) fail('DUPLICATE_ID', 'Binding IDs must be unique'); bindingIds.add(binding.id);
    const source = nodes.get(binding.from.node), target = nodes.get(binding.to.node);
    const output = source && registry[source.capability]?.outputs[binding.from.port], input = target && registry[target.capability]?.inputs[binding.to.port];
    if (!source || !target || !output || !input) { fail('REFERENCE', 'Binding endpoint or port is missing', binding.to.node, binding.to.port); continue }
    if (output.valueType !== input.valueType || input.valueType !== binding.valueType) fail('BINDING_TYPE', 'Binding types are incompatible', target.id, binding.to.port);
    if (output.visibility === 'private' && (input.visibility === 'shared' || target.visibility === 'shared')) fail('PRIVATE_FLOW', 'Private output cannot flow into a shared view', target.id, binding.to.port);
    const key = `${target.id}:${binding.to.port}`;
    if (incoming.has(key) || Object.hasOwn(target.inputs, binding.to.port)) fail('MULTIPLE_INPUTS', 'An input must have exactly one provider', target.id, binding.to.port);
    incoming.set(key, binding); edges.get(source.id)?.push(target.id);
  }
  for (const node of manifest.nodes) for (const [name, input] of Object.entries(registry[node.capability]?.inputs ?? {})) if (input.required && !Object.hasOwn(node.inputs, name) && !incoming.has(`${node.id}:${name}`)) fail('REQUIRED_INPUT', 'Required input is unresolved', node.id, name);
  const marks = new Map<string, number>(), order: string[] = [];
  const visit = (id: string) => { if (marks.get(id) === 1) { fail('CYCLE', 'Computed bindings must form a DAG', id); return } if (marks.get(id) === 2) return; marks.set(id, 1); for (const next of edges.get(id) ?? []) visit(next); marks.set(id, 2); order.unshift(id) };
  for (const id of nodes.keys()) visit(id);
  if (diagnostics.length) return { ok: false, diagnostics };
  const outputs: ExecutablePlan['outputs'] = {}; const evaluated = new Map<string, PlanNode>();
  for (const id of order) {
    const node = nodes.get(id)!; const cap = registry[node.capability]; const inputs = { ...node.inputs };
    for (const name of Object.keys(cap.inputs)) { const binding = incoming.get(`${id}:${name}`); if (binding) inputs[name] = outputs[binding.from.node]?.[binding.from.port] }
    try {
      for (const [name, input] of Object.entries(cap.inputs)) if ((input.required || inputs[name] !== undefined) && !validators[input.valueType]?.(inputs[name])) throw new Error(`Invalid input ${name}`);
      outputs[id] = cap.evaluate(inputs);
      for (const [name, output] of Object.entries(cap.outputs)) if (!validators[output.valueType]?.(outputs[id][name])) throw new Error(`Invalid output ${name}`);
      evaluated.set(id, { ...node, inputs });
    } catch { fail('EVALUATION', 'Capability rejected its input; previous active plan must remain in use', id); break }
  }
  return diagnostics.length ? { ok: false, diagnostics } : { ok: true, plan: { ...manifest, nodes: manifest.nodes.map(n => evaluated.get(n.id)!), order, outputs } };
}
const node = (id: string, capability: string, title: string, x: number, y: number, inputs: Record<string, unknown> = {}, visibility: Visibility = 'shared', visible = true): PlanNode => ({ id, capability, title, position: { x, y }, inputs, visibility, version: 1, visible });
const binding = (from: string, output: string, to: string, input: string, valueType: string): Binding => ({ id: `${from}.${output}-${to}.${input}`, from: { node: from, port: output }, to: { node: to, port: input }, valueType });
export function manifestForWorkspace(view: WorkspaceView): Manifest {
  const state = view.domain;
  if (state.kind === 'table') {
    const nodes = [node('table.rules', 'table.rules', 'Rules', 40, 480, { state }, 'private')];
    if (view.actor.role === 'owner') nodes.unshift(node('table.sources', 'table.sources', 'Files', 40, 40, { state }, 'private'));
    const bindings: Binding[] = [];
    for (const [index, collection] of (state.program?.collections ?? []).entries()) {
      const collectionNode = `table.collection.${collection.id}`;
      nodes.push(node(collectionNode, 'table.collection', collection.title, 580 + Math.floor(index / 2) * 540, 40 + index % 2 * 520, { rows: state.records[collection.id] ?? [] }));
      bindings.push(binding('table.rules', 'revision', collectionNode, 'revision', 'RuleRevisionV1'));
    }
    if (state.program) {
      nodes.push(node('table.actions', 'table.actions', 'Actions', 580 + Math.ceil(state.program.collections.length / 2) * 540, 40));
      bindings.push(binding('table.rules', 'revision', 'table.actions', 'revision', 'RuleRevisionV1'));
    }
    return { version: 1, kind: 'table', nodes, bindings };
  }
  if (state.kind === 'invoice') {
    const nodes = [node('invoice.source', 'invoice.source', 'เอกสารและหลักฐาน', 40, 40, { state }, 'private'), node('invoice.reconcile', 'invoice.reconcile', 'ตรวจยอดตามหลักฐาน', 460, 40, {}, 'private', false), node('invoice.table', 'invoice.table', 'รายการตรวจยอด', 460, 40, {}, 'private'), node('invoice.rules', 'invoice.rules', 'กฎที่ใช้และข้อเสนอ', 1240, 40, { state }, 'private')];
    const bindings = [binding('invoice.source', 'invoice', 'invoice.reconcile', 'invoice', 'InvoiceStateV1'), binding('invoice.reconcile', 'result', 'invoice.table', 'result', 'InvoiceResultV1')];
    const hasSurcharge = state.rules.some(r => r.kind === 'surcharge' && r.enabled);
    if (hasSurcharge) { nodes.push(node('invoice.merge', 'review.merge', 'รวมรายการตรวจ', 460, 620, {}, 'private', false)); bindings.push(binding('invoice.reconcile', 'exceptions', 'invoice.merge', 'base', 'ReviewItemV1[]'), binding('invoice.reconcile', 'surchargeExceptions', 'invoice.merge', 'extra', 'ReviewItemV1[]')) }
    if (state.shipments.length || state.invoiceLines.length) { nodes.push(node('invoice.review', 'invoice.review', 'รายการที่ต้องตรวจหลักฐาน', 460, 650, {}, 'private')); bindings.push(binding(hasSurcharge ? 'invoice.merge' : 'invoice.reconcile', hasSurcharge ? 'items' : 'exceptions', 'invoice.review', 'items', 'ReviewItemV1[]')) }
    return { version: 1, kind: state.kind, nodes, bindings };
  }
  if (state.kind === 'teaching') {
    const learner = view.actor.role === 'learner'; const representation = (state as TeachingState).representations[view.actor.actorId] ?? 'scene';
    const nodes = [node('lesson.source', 'lesson.source', 'แรง มวล และการเคลื่อนที่', 40, 40, { parameters: state.parameters }), node('physics.model', 'physics.model', 'แบบจำลอง F = ma', 500, 40, {}, 'shared', false), node('lesson.question', 'lesson.question', learner ? 'ลองตอบด้วยตัวเอง' : 'คำตอบและวิธีสอน', 1180, 40, { state }, 'private')];
    const bindings = [binding('lesson.source', 'parameters', 'physics.model', 'parameters', 'PhysicsParametersV1')];
    if (!learner || representation !== 'graph') { nodes.push(node('lesson.scene', 'lesson.scene', representation === 'text' ? 'อธิบายจากแบบจำลองเดียวกัน' : 'ทดลองบนราง', 500, 40)); bindings.push(binding('physics.model', 'physics', 'lesson.scene', 'physics', 'PhysicsResultV1')) }
    if (!learner || representation === 'graph') { nodes.push(node('lesson.graph', 'lesson.graph', 'กราฟจากแบบจำลองเดียวกัน', 500, 550)); bindings.push(binding('physics.model', 'physics', 'lesson.graph', 'physics', 'PhysicsResultV1')) }
    return { version: 1, kind: state.kind, nodes, bindings };
  }
  return { version: 1, kind: 'encounter', nodes: [node('encounter.source', 'encounter.source', 'กติกาและบันทึกโต๊ะ', 40, 40, { state }, 'private'), node('encounter.board', 'encounter.board', 'การเผชิญหน้าที่เชื่อมกัน', 500, 40), node('encounter.actions', 'encounter.actions', 'เลือกการกระทำ', 1180, 40)], bindings: [binding('encounter.source', 'board', 'encounter.board', 'board', 'EncounterBoardV1'), binding('encounter.board', 'board', 'encounter.actions', 'board', 'EncounterBoardV1')] };
}
export function planForWorkspace(view: WorkspaceView): ExecutablePlan {
  const result = compileManifest(manifestForWorkspace(view));
  if (!result.ok) throw new Error(result.diagnostics.map(d => `${d.node ?? 'workspace'}: ${d.message}`).join('; '));
  return result.plan;
}
