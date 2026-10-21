import type { DomainState, EncounterState, InvoiceState, PhysicsParams, TeachingState, WorkspaceView } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import { GENERATIVE_LIMITS, type GenerativeCanvas, type GenerativeViewDescriptor } from '../shared/generative-contracts';
import { calculatePhysics, reconcileInvoice } from '../domain';
import { generativeCanvasSchema, generativeIdSchema, generativeViewDescriptorSchema } from './generative/schema';
import { z } from 'zod';
import { VISIBILITY_POLICY } from '../shared/visibility';

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
  TableActionsV1: v => Array.isArray(v) && v.length <= 32 && v.every(action => object(action) && typeof action.id === 'string' && typeof action.title === 'string' && typeof action.description === 'string' && Array.isArray(action.roles) && action.roles.every(role => role === 'owner' || role === 'participant') && Array.isArray(action.parameters) && Array.isArray(action.conditions) && Array.isArray(action.effects) && typeof action.requireTurn === 'boolean' && typeof action.advanceTurn === 'boolean'),
  GenerativeCanvasV1: v => generativeCanvasSchema.safeParse(v).success,
  GenerativeViewDescriptorV1: v => generativeViewDescriptorSchema.safeParse(v).success,
  GenerativeViewIdV1: v => generativeIdSchema.safeParse(v).success,
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
  })).max(24),
  bindings: z.array(z.strictObject({ id: z.string().min(1).max(300), from: endpointSchema, to: endpointSchema, valueType: z.string().min(1).max(80) })).max(96),
});
export const capabilityRegistry: Readonly<Record<string, Capability>> = {
  'table.sources': { version: 1, inputs: { state: port('TableStateV1', 'private') }, outputs: {}, evaluate: () => ({}) },
  'table.rules': { version: 1, inputs: { state: port('TableStateV1', 'private') }, outputs: { revision: port('RuleRevisionV1') }, evaluate: i => ({ revision: (i.state as TableState).ruleRevision }) },
  'table.collection': { version: 1, inputs: { rows: port('TableRowsV1'), revision: port('RuleRevisionV1') }, outputs: { rows: port('TableRowsV1') }, evaluate: identity('rows') },
  'table.actions': { version: 1, inputs: { revision: port('RuleRevisionV1'), actions: port('TableActionsV1') }, outputs: { actions: port('TableActionsV1') }, evaluate: identity('actions') },
  'table.canvas': { version: 1, inputs: { canvas: port('GenerativeCanvasV1') }, outputs: { canvas: port('GenerativeCanvasV1') }, evaluate: identity('canvas') },
  'table.generated-view.scene': generatedViewCapability('scene'),
  'table.generated-view.chart': generatedViewCapability('chart'),
  'table.generated-view.metric': generatedViewCapability('metric'),
  'table.generated-view.controls': generatedViewCapability('controls'),
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

function generatedViewCapability(kind: GenerativeViewDescriptor['kind']): Capability {
  const relationInputs: Record<string, Port> = {};
  for (let index = 0; index < 6; index += 1) relationInputs[`relatedRows${index}`] = port('TableRowsV1', 'shared', false);
  for (let index = 0; index < GENERATIVE_LIMITS.canvasViews; index += 1) relationInputs[`relatedViews${index}`] = port('GenerativeViewDescriptorV1', 'shared', false);
  return {
    version: 1,
    inputs: {
      canvas: port('GenerativeCanvasV1'),
      viewId: port('GenerativeViewIdV1'),
      rows: port('TableRowsV1', 'shared', false),
      actions: port('TableActionsV1', 'shared', false),
      ...relationInputs,
    },
    outputs: { descriptor: port('GenerativeViewDescriptorV1') },
    evaluate: inputs => {
      const canvas = inputs.canvas as GenerativeCanvas;
      const descriptor = canvas.views.find(view => view.id === inputs.viewId);
      if (!descriptor || descriptor.kind !== kind) throw new Error('Generated view descriptor is missing or incompatible.');
      if (descriptor.kind === 'chart' && !Array.isArray(inputs.rows)) throw new Error('Generated chart rows are unresolved.');
      if (descriptor.kind === 'controls' && !Array.isArray(inputs.actions)) throw new Error('Generated table actions are unresolved.');
      return { descriptor };
    },
  };
}

/** Compile a bounded, curated graph. A failure returns no partially executable plan. */
export function compileManifest(rawManifest: unknown, registry: Readonly<Record<string, Capability>> = capabilityRegistry): Compilation {
  const diagnostics: Diagnostic[] = [];
  const fail = (code: string, message: string, node?: string, name?: string) => diagnostics.push({ code, message, node, port: name });
  const parsed = manifestSchema.safeParse(rawManifest);
  if (!parsed.success) return { ok: false, diagnostics: [{ code: 'SCHEMA', message: 'Unsupported manifest shape/version or resource limit' }] };
  const manifest: Manifest = parsed.data;
  if (manifest.kind !== 'table' && manifest.nodes.length === 0) return { ok: false, diagnostics: [{ code: 'SCHEMA', message: 'Unsupported manifest shape/version or resource limit' }] };
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
    const nodes: PlanNode[] = [];
    if (state.sources.length > 0) nodes.push(node('table.sources', 'table.sources', 'Files', 40, 40, { state }));
    if (state.program !== null || ((view.actor.role === 'owner' || VISIBILITY_POLICY === 'open') && state.candidate !== null)) nodes.push(node('table.rules', 'table.rules', 'Rules', 40, 480, { state }, 'private'));
    const bindings: Binding[] = [];
    const collectionNodeIds = new Map<string, string>();
    for (const [index, collection] of (state.program?.collections ?? []).entries()) {
      const collectionNode = `table.collection.${collection.id}`;
      nodes.push(node(collectionNode, 'table.collection', collection.title, 580 + Math.floor(index / 2) * 540, 40 + index % 2 * 520, { rows: state.records[collection.id] ?? [] }));
      collectionNodeIds.set(collection.id, collectionNode);
      bindings.push(binding('table.rules', 'revision', collectionNode, 'revision', 'RuleRevisionV1'));
    }
    if (state.program) {
      nodes.push(node('table.actions', 'table.actions', 'Actions', 580 + Math.ceil(state.program.collections.length / 2) * 540, 40, { actions: state.program.actions }));
      bindings.push(binding('table.rules', 'revision', 'table.actions', 'revision', 'RuleRevisionV1'));
    }

    const canvas = state.program?.canvas;
    if (canvas && nodes.length < 24) {
      const canvasNodeId = 'table.canvas';
      nodes.push(node(canvasNodeId, 'table.canvas', 'Generated views', 0, 0, { canvas }, 'shared', false));
      const parsedCanvas = generativeCanvasSchema.safeParse(canvas);
      if (parsedCanvas.success) {
        const availableViews = Math.max(0, 24 - nodes.length);
        const generatedViews = parsedCanvas.data.views.slice(0, Math.min(GENERATIVE_LIMITS.canvasViews, availableViews));
        const generatedNodeIds = new Map(generatedViews.map(descriptor => [descriptor.id, `table.view.${descriptor.id}`]));
        const nodePositions = new Map(nodes.map(item => [item.id, item.position]));
        const viewPositions = new Map<string, { x: number; y: number }>();
        const occupiedAnchors = new Map<string, number>();
        const positionForView = (descriptor: GenerativeViewDescriptor, index: number): { x: number; y: number } => {
          const chartAnchor = descriptor.kind === 'chart' ? descriptor.collection : undefined;
          const collectionAnchor = chartAnchor ?? descriptor.relatedTo?.collections?.find(id => collectionNodeIds.has(id));
          const viewAnchor = descriptor.relatedTo?.views?.find(id => viewPositions.has(id));
          const anchorId = collectionAnchor ? collectionNodeIds.get(collectionAnchor) : viewAnchor ? generatedNodeIds.get(viewAnchor) : undefined;
          const anchor = anchorId ? nodePositions.get(anchorId) ?? viewPositions.get(collectionAnchor ?? viewAnchor ?? '') : undefined;
          if (!anchor) return { x: 580 + Math.floor(index / 2) * 540, y: 40 + index % 2 * 360 };
          const key = anchorId ?? 'canvas';
          const offset = occupiedAnchors.get(key) ?? 0;
          occupiedAnchors.set(key, offset + 1);
          return { x: anchor.x + 540, y: anchor.y + offset * 340 };
        };

        for (const [index, descriptor] of generatedViews.entries()) {
          const id = generatedNodeIds.get(descriptor.id)!;
          const position = positionForView(descriptor, index);
          viewPositions.set(descriptor.id, position);
          nodePositions.set(id, position);
          nodes.push(node(id, `table.generated-view.${descriptor.kind}`, descriptor.title.slice(0, 160), position.x, position.y, { viewId: descriptor.id }));
          if (bindings.length < 96) bindings.push(binding(canvasNodeId, 'canvas', id, 'canvas', 'GenerativeCanvasV1'));

          if (descriptor.kind === 'chart' && collectionNodeIds.has(descriptor.collection) && bindings.length < 96) {
            bindings.push(binding(collectionNodeIds.get(descriptor.collection)!, 'rows', id, 'rows', 'TableRowsV1'));
          }
          if (descriptor.kind === 'controls' && state.program && bindings.length < 96) {
            bindings.push(binding('table.actions', 'actions', id, 'actions', 'TableActionsV1'));
          }
          for (const [relationIndex, collectionId] of (descriptor.relatedTo?.collections ?? []).entries()) {
            const sourceId = collectionNodeIds.get(collectionId);
            if (!sourceId || relationIndex >= 6 || bindings.length >= 96) continue;
            if (descriptor.kind === 'chart' && collectionId === descriptor.collection) continue;
            bindings.push(binding(sourceId, 'rows', id, `relatedRows${relationIndex}`, 'TableRowsV1'));
          }
        }

        const relationPairs = new Set<string>();
        const viewIndex = new Map(generatedViews.map((descriptor, index) => [descriptor.id, index]));
        for (const descriptor of generatedViews) {
          for (const relatedId of descriptor.relatedTo?.views ?? []) {
            const fromIndex = viewIndex.get(descriptor.id);
            const toIndex = viewIndex.get(relatedId);
            if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) continue;
            const [earlierId, laterId] = fromIndex < toIndex ? [descriptor.id, relatedId] : [relatedId, descriptor.id];
            relationPairs.add(`${earlierId}\u0000${laterId}`);
          }
        }
        const incomingViewRelations = new Map<string, number>();
        for (const pair of relationPairs) {
          const [sourceViewId, targetViewId] = pair.split('\u0000');
          const slot = incomingViewRelations.get(targetViewId) ?? 0;
          if (slot >= GENERATIVE_LIMITS.canvasViews || bindings.length >= 96) continue;
          const sourceNodeId = generatedNodeIds.get(sourceViewId);
          const targetNodeId = generatedNodeIds.get(targetViewId);
          if (!sourceNodeId || !targetNodeId) continue;
          incomingViewRelations.set(targetViewId, slot + 1);
          bindings.push(binding(sourceNodeId, 'descriptor', targetNodeId, `relatedViews${slot}`, 'GenerativeViewDescriptorV1'));
        }
      }
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
