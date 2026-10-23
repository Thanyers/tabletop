import { describe, expect, it } from 'vitest';
import type { TableProgram, TableState } from '../shared/table-contracts';
import type { ComputeModule, ComputeRunRecord } from '../shared/table-compute';
import {
  computeErrorLabel, computeInputSourceLabel, computeLatestRun, computeLatestSuccessfulRun,
  computePortTypeLabel, computeRunActorName, computeRunMatchesSnapshot, computeRunOutput, computeRuntimeDetails,
  computeStatusLabel, computeValueSummary,
} from './table-compute-ui';

const module: ComputeModule = {
  id: 'open_orders', name: 'Open orders', description: 'Find orders that still need attention.',
  runtime: 'python', version: 2, source: 'def compute(inputs): return {}',
  inputs: [
    { id: 'orders', label: 'Order rows', type: 'table', binding: { kind: 'collection', collectionId: 'orders' } },
    { id: 'revision', label: 'Data version', type: 'number', binding: { kind: 'provenance', property: 'dataRevision' } },
  ],
  outputs: [{ id: 'open', label: 'Open orders', type: 'number' }],
};

const program: TableProgram = {
  version: 1, title: 'Board game', description: '', collections: [{ id: 'orders', title: 'Orders', fields: [] }],
  actions: [], invariants: [], turnOrder: [], evidence: [], assumptions: [], compute: { version: 1, modules: [module] },
};

const state: TableState = {
  kind: 'table', dataRevision: 7, ruleRevision: 2, candidate: null, revisions: [], sources: [],
  program, records: { orders: [{ id: 'one', values: {} }, { id: 'two', values: {} }] }, turn: null,
  actionRevision: 0, activity: [],
};

const run = (patch: Partial<ComputeRunRecord> = {}): ComputeRunRecord => ({
  runId: '00000000-0000-4000-8000-000000000001', moduleId: module.id, moduleVersion: 2,
  inputHash: 'a'.repeat(64), sourceIds: [], inputProvenance: [], dataRevision: 7, ruleRevision: 2, runtimeProfile: 'tabletop-compute-1', actorId: 'actor-b', role: 'participant', seat: 'member-1',
  status: 'succeeded', startedAt: 1_700_000_000_000,
  outputs: [{ outputId: 'open', value: 4 }], ...patch,
});

describe('compute card copy and run summaries', () => {
  it('shows configured source, row count, and plain input type without exposing a resolved input value', () => {
    expect(computeInputSourceLabel(module.inputs[0]!, state, [module])).toBe('Orders table · 2 rows');
    expect(computeInputSourceLabel(module.inputs[1]!, state, [module])).toBe('Current table version');
    expect(computePortTypeLabel('text-list')).toBe('list of text');
    expect(computePortTypeLabel('boolean')).toBe('yes or no');
  });

  it('shows source uploader, latest collection editor, and fixed input values without claiming original authorship', () => {
    const withProvenance: TableState = {
      ...state,
      sources: [{ id: 'shipment', filename: 'shipments.csv', text: '', sha256: 'hash', createdAt: 1 }],
      dataProvenance: {
        sources: { shipment: { actorId: 'actor-b', at: 1, origin: 'human' } },
        collections: { orders: { actorId: 'actor-c', at: 2, origin: 'ai' } },
      },
    };
    const member = { actorId: 'actor-b', name: 'Sam' };
    const currentActor = { actorId: 'owner', name: 'Owner' };
    const source = { id: 'file', label: 'Source file', type: 'text' as const, binding: { kind: 'source' as const, sourceId: 'shipment' } };
    const fixed = { id: 'fixed', label: 'Status', type: 'text' as const, binding: { kind: 'literal' as const, value: 'Ready' } };

    expect(computeInputSourceLabel(source, withProvenance, [module], program, currentActor, [member])).toBe('shipments.csv · Added by Sam');
    expect(computeInputSourceLabel(module.inputs[0]!, withProvenance, [module], program, currentActor, [{ actorId: 'actor-c', name: 'Pat' }])).toBe('Orders table · 2 rows · Last changed by Pat');
    expect(computeInputSourceLabel(fixed, withProvenance, [module], program, currentActor, [member])).toBe('Fixed value · Ready');
  });

  it('keeps the newest run status distinct from the latest successful output', () => {
    const latest = run({ runId: '00000000-0000-4000-8000-000000000002', status: 'failed', errorCode: 'COMPUTE_FAILED', outputs: undefined });
    const lastSuccess = run();
    expect(computeLatestRun(module.id, [latest, lastSuccess])).toBe(latest);
    expect(computeLatestSuccessfulRun(module.id, [latest, lastSuccess])).toBe(lastSuccess);
    expect(computeRunOutput(lastSuccess, 'open')).toBe(4);
    expect(computeStatusLabel('queued')).toBe('Waiting to run');
    expect(computeStatusLabel('stale')).toBe('Data changed during the run');
    expect(computeErrorLabel('COMPUTE_FAILED')).toContain('previous successful result is still available');
  });

  it('keeps prior results only while the module version and pinned runtime profile still match', () => {
    const oldVersion = run({ moduleVersion: 1 });
    const failedCurrent = run({ status: 'failed', outputs: undefined });
    expect(computeLatestRun(module.id, [oldVersion], module)).toBeUndefined();
    expect(computeLatestSuccessfulRun(module.id, [oldVersion], module)).toBeUndefined();
    expect(computeLatestRun(module.id, [failedCurrent, oldVersion], module)).toBe(failedCurrent);
    const lastSuccess = run();
    expect(computeLatestSuccessfulRun(module.id, [failedCurrent, lastSuccess], module)).toBe(lastSuccess);
    expect(computeLatestSuccessfulRun(module.id, [lastSuccess], { version: 2, runtimeProfile: 'tabletop-compute-1' })).toBe(lastSuccess);
    expect(computeRunMatchesSnapshot(lastSuccess, module, state)).toBe(true);
    expect(computeRunMatchesSnapshot(lastSuccess, module, { ...state, dataRevision: 8 })).toBe(false);
    expect(computeRunMatchesSnapshot(lastSuccess, module, { ...state, ruleRevision: 3 })).toBe(false);
  });

  it('names the run actor and exposes only the configured runtime profile', () => {
    expect(computeRunActorName(run(), { actorId: 'owner', name: 'Owner' }, [{ actorId: 'actor-b', name: 'Sam' }])).toBe('Sam');
    expect(computeRunActorName(run(), { actorId: 'actor-b', name: 'Sam' }, [])).toBe('Sam');
    expect(computeRuntimeDetails('python')).toEqual(expect.objectContaining({ name: 'Python', libraries: expect.arrayContaining(['pandas 2.3.3', 'numpy 2.3.4']) }));
    expect(computeRuntimeDetails('javascript').libraries).toEqual(['ECMAScript standard library']);
  });

  it('summarizes results by shape rather than dumping large tables into the rules card', () => {
    expect(computeValueSummary({ columns: [{ id: 'name', label: 'Name', type: 'text' }], rows: [{ name: 'Ada' }, { name: 'Bo' }] })).toBe('2 rows');
    expect(computeValueSummary(['one', 'two'])).toBe('2 items');
    expect(computeValueSummary(1200)).toBe('1,200');
  });
});
