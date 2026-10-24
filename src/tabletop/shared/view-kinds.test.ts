import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState } from '../domain/table';
import { evaluateGenerativeCanvas } from '../runtime/generative/evaluator';
import { generativeViewDescriptorSchema, generativeViewSchemaOptions } from '../runtime/generative/schema';
import { validateGenerativeProgram } from '../runtime/generative/validation';
import { capabilityRegistry, manifestForWorkspace } from '../runtime';
import type { WorkspaceView } from './contracts';
import type { TableState } from './table-contracts';
import type { GenerativeCanvas, GenerativeViewDescriptor } from './generative-contracts';
import { GENERATIVE_LIMITS } from './generative-contracts';
import { TABLE_CAPABILITIES } from './table-capabilities';
import { cafeQueueChange } from '../testing/generative-scenarios';
import {
  GENERATIVE_VIEW_CAPABILITY_PREFIX,
  GENERATIVE_VIEW_KINDS,
  GENERATIVE_VIEW_KIND_METADATA,
  generativeViewKindListSentence,
  type GenerativeViewKind,
} from './view-kinds';

/** One minimal wire-valid descriptor per kind, keyed so a kind without an entry fails to compile. */
const MINIMAL_VIEWS: { readonly [K in GenerativeViewKind]: Extract<GenerativeViewDescriptor, { kind: K }> } = {
  scene: { id: 'min-scene', kind: 'scene', title: 'Scene', width: 320, height: 200, elements: [] },
  chart: { id: 'min-chart', kind: 'chart', title: 'Chart', chart: 'bar', collection: 'rows', categoryField: 'label', value: { op: 'literal', value: 1 } },
  metric: { id: 'min-metric', kind: 'metric', title: 'Metric', value: { op: 'literal', value: 1 } },
  controls: { id: 'min-controls', kind: 'controls', title: 'Controls', controls: [] },
};

const generatedCapabilityId = (kind: GenerativeViewKind) => `${GENERATIVE_VIEW_CAPABILITY_PREFIX}${kind}`;

function tableWorkspace(domain: TableState): WorkspaceView {
  return {
    id: 'view-kind-registry', title: 'View kind registry', kind: 'table', epoch: 1, revision: 'revision-1',
    actor: { actorId: 'test-actor', name: 'Test actor', role: 'owner' }, members: [], domain, createdAt: 0, expiresAt: 1000,
  };
}

describe('Canvas view kind registry (F078-T8)', () => {
  it('pins the built-in kinds, so adding one is a deliberate wire-contract change', () => {
    expect([...GENERATIVE_VIEW_KINDS]).toEqual(['scene', 'chart', 'metric', 'controls']);
    expect(Object.keys(GENERATIVE_VIEW_KIND_METADATA)).toEqual([...GENERATIVE_VIEW_KINDS]);
  });

  it('accepts exactly the registered kinds in the wire schema', () => {
    for (const kind of GENERATIVE_VIEW_KINDS) {
      const parsed = generativeViewDescriptorSchema.safeParse(MINIMAL_VIEWS[kind]);
      expect(parsed.success, `${kind} descriptor must parse`).toBe(true);
    }
    // The discriminated union is built from the same record, branch for branch.
    expect(generativeViewSchemaOptions).toHaveLength(GENERATIVE_VIEW_KINDS.length);
    // An unregistered discriminator is still rejected rather than silently ignored.
    expect(generativeViewDescriptorSchema.safeParse({ ...MINIMAL_VIEWS.metric, kind: 'timeline' }).success).toBe(false);
  });

  it('keeps every branch a strict object with the literal discriminator', () => {
    for (const kind of GENERATIVE_VIEW_KINDS) {
      expect(generativeViewDescriptorSchema.safeParse({ ...MINIMAL_VIEWS[kind], extraKey: true }).success).toBe(false);
      // Another kind's payload under this literal is not accepted.
      if (kind !== 'controls') expect(generativeViewDescriptorSchema.safeParse({ ...MINIMAL_VIEWS.controls, kind }).success).toBe(false);
      // The bound id pattern still applies to every kind.
      expect(generativeViewDescriptorSchema.safeParse({ ...MINIMAL_VIEWS[kind], id: 'Min-Scene' }).success).toBe(false);
    }
  });

  it('gives every kind one plan capability whose manifest wiring follows the registry metadata', () => {
    for (const kind of GENERATIVE_VIEW_KINDS) {
      const capability = capabilityRegistry[generatedCapabilityId(kind)];
      expect(capability, `${kind} must be a plan capability`).toBeDefined();
      if (!capability) continue;
      expect(capability.version).toBe(1);
      expect(capability.outputs.descriptor.valueType).toBe('GenerativeViewDescriptorV1');
      // Row and action inputs exist for every kind but stay optional; the metadata decides who binds them.
      expect(capability.inputs.rows.required).toBe(false);
      expect(capability.inputs.actions.required).toBe(false);
      expect(capability.inputs.canvas.required).toBe(true);
      expect(capability.inputs.viewId.required).toBe(true);
    }
    const registered = Object.keys(capabilityRegistry).filter(id => id.startsWith(GENERATIVE_VIEW_CAPABILITY_PREFIX)).sort();
    expect(registered).toEqual(GENERATIVE_VIEW_KINDS.map(generatedCapabilityId).sort());

    const state = applyTableChange(createTableState(), structuredClone(cafeQueueChange));
    if (!state.program?.canvas) throw new Error('Expected the cafe scenario to carry a canvas program.');
    const manifest = manifestForWorkspace(tableWorkspace(state));
    for (const descriptor of state.program.canvas.views) {
      const nodeId = `table.view.${descriptor.id}`;
      const metadata = GENERATIVE_VIEW_KIND_METADATA[descriptor.kind];
      expect(manifest.nodes.find(item => item.id === nodeId)?.capability).toBe(generatedCapabilityId(descriptor.kind));
      expect(manifest.bindings.some(item => item.to.node === nodeId && item.to.port === 'rows')).toBe(metadata.needsRows);
      expect(manifest.bindings.some(item => item.to.node === nodeId && item.to.port === 'actions')).toBe(metadata.needsActions);
    }
  });

  it('refuses to hand out a descriptor while a declared input is unresolved', () => {
    const canvas: GenerativeCanvas = { version: 1, views: GENERATIVE_VIEW_KINDS.map(kind => MINIMAL_VIEWS[kind]) };
    for (const kind of GENERATIVE_VIEW_KINDS) {
      const capability = capabilityRegistry[generatedCapabilityId(kind)];
      const metadata = GENERATIVE_VIEW_KIND_METADATA[kind];
      const inputs: Record<string, unknown> = { canvas, viewId: MINIMAL_VIEWS[kind].id };
      if (metadata.needsRows) expect(() => capability.evaluate(inputs)).toThrow('Generated chart rows are unresolved.');
      if (metadata.needsActions) expect(() => capability.evaluate(inputs)).toThrow('Generated table actions are unresolved.');
      if (!metadata.needsRows && !metadata.needsActions) expect(capability.evaluate(inputs).descriptor).toEqual(MINIMAL_VIEWS[kind]);
      const resolved = { ...inputs, ...(metadata.needsRows ? { rows: [] } : {}), ...(metadata.needsActions ? { actions: [] } : {}) };
      expect(capability.evaluate(resolved).descriptor).toEqual(MINIMAL_VIEWS[kind]);
    }
  });

  it('round-trips every descriptor through schema, semantic validation and evaluation', () => {
    const state = applyTableChange(createTableState(), structuredClone(cafeQueueChange));
    const program = state.program;
    const canvas = program?.canvas;
    if (!program || !canvas) throw new Error('Expected the cafe scenario to carry a canvas program.');
    const issues = validateGenerativeProgram(program, state.records);
    expect(issues).toEqual([]);

    const seen = new Set<string>();
    for (const descriptor of canvas.views) {
      const parsed = generativeViewDescriptorSchema.safeParse(descriptor);
      expect(parsed.success, `${descriptor.id} must survive the wire schema`).toBe(true);
      if (!parsed.success) continue;
      seen.add(parsed.data.kind);
    }
    expect([...seen].sort()).toEqual([...GENERATIVE_VIEW_KINDS].sort());

    const evaluated = evaluateGenerativeCanvas(canvas, { program, records: state.records, actor: 'test-actor', turn: null });
    expect(evaluated.map(view => view.kind).sort()).toEqual([...GENERATIVE_VIEW_KINDS].sort());
    for (const view of evaluated) {
      const descriptor = canvas.views.find(item => item.id === view.id);
      expect(descriptor?.kind).toBe(view.kind);
    }
  });

  it('keeps the capability summary prose derived from the registry', () => {
    const canvasCapability = TABLE_CAPABILITIES.supported.find(item => item.id === 'canvas');
    expect(canvasCapability?.detail).toBe(`Scene, chart, metric and controls descriptors; up to ${GENERATIVE_LIMITS.canvasViews} views, kept when rules evolve.`);
    expect(generativeViewKindListSentence()).toBe('Scene, chart, metric and controls');
  });
});
