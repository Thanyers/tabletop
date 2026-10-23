import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { TableChange, TableState } from '../shared/table-contracts';
import type { ComputeModule, ComputeRunRecord } from '../shared/table-compute';
import { createTableState, handleTableCommand, applyTableChange, removeTableRuleItem } from './table';
import { evaluateGenerativeCanvas } from '../runtime/generative/evaluator';

const owner: ActorContext = {
  actorId: 'owner', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000,
  hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
};
const module: ComputeModule = {
  id: 'totals', name: 'Totals', description: 'Calculate total.', runtime: 'javascript', version: 1,
  source: 'export default function compute(inputs) { return { total: 42 }; }', inputs: [],
  outputs: [{ id: 'total', label: 'Total', type: 'number' }],
};
const change: TableChange = {
  kind: 'table',
  program: {
    version: 1, title: 'Totals', description: 'Reusable compute test.',
    collections: [{ id: 'items', title: 'Items', fields: [{ id: 'value', label: 'Value', type: 'number', required: true }] }],
    actions: [], invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
    compute: { version: 1, modules: [module] },
    canvas: { version: 1, views: [{ id: 'total_metric', kind: 'metric', title: 'Total', value: { op: 'computeResult', moduleId: 'totals', outputId: 'total' } }] },
  },
  initialRecords: { items: [{ id: 'record_1', values: { value: 7 } }] },
};
const runId = '11111111-1111-4111-8111-111111111111';

function start(state: TableState): TableState {
  const run = handleTableCommand(state, 'table.compute.run', { moduleId: 'totals', runId }, owner)!.state;
  return handleTableCommand(run, 'table.compute.update', {
    runId, status: 'running', inputHash: 'a'.repeat(64), sourceIds: [], inputProvenance: [],
    dataRevision: state.dataRevision, ruleRevision: state.ruleRevision, runtimeProfile: 'tabletop-compute-1',
  }, owner)!.state;
}
function succeed(state: TableState, value = 42): TableState {
  return handleTableCommand(state, 'table.compute.update', {
    runId, status: 'succeeded', outputs: [{ outputId: 'total', value }],
  }, owner)!.state;
}

describe('compute run domain lifecycle', () => {
  it('rejects repeated pending requests and never evicts an in-flight run to trim history', () => {
    const state = start(applyTableChange(createTableState(), change));
    for (let index = 0; index < 25; index += 1) {
      expect(() => handleTableCommand(state, 'table.compute.run', { moduleId: 'totals' }, owner)).toThrow(/pending run/u);
    }
    const active = state.computeRuns![0];
    const terminal: ComputeRunRecord[] = Array.from({ length: 23 }, (_, index) => ({
      ...active, runId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, status: 'failed' as const,
      errorCode: 'COMPUTE_FAILED' as const, completedAt: owner.now,
    }));
    state.computeRuns = [...terminal, active];
    state.program!.compute!.modules.push({ ...module, id: 'second_total' });
    const next = handleTableCommand(state, 'table.compute.queue', { moduleId: 'second_total' }, owner)!.state;
    expect(next.computeRuns).toHaveLength(24);
    expect(next.computeRuns?.find(run => run.runId === runId)?.status).toBe('running');
    expect(succeed(next).computeRuns?.find(run => run.runId === runId)?.status).toBe('succeeded');
  });

  it('marks a completion stale atomically if inputs changed after the orchestrator read', () => {
    const state = start(applyTableChange(createTableState(), change));
    state.dataRevision += 1;
    const next = succeed(state);
    expect(next.computeRuns?.[0]).toMatchObject({ status: 'stale', errorCode: 'COMPUTE_STALE' });
    expect(next.computeRuns?.[0]?.outputs).toBeUndefined();
  });

  it('rejects a lower module version when changing its behavior', () => {
    const initial = structuredClone(change);
    initial.program.compute!.modules[0].version = 3;
    const state = applyTableChange(createTableState(), initial);
    const revised = structuredClone(initial);
    revised.initialRecords = {};
    revised.program.compute!.modules[0].version = 2;
    revised.program.compute!.modules[0].source += '\n// changed';
    expect(() => applyTableChange(state, revised)).toThrow(/Increment the version/u);
  });

  it('rejects derived rows that violate a linked collection required or range constraint', () => {
    const linked = structuredClone(change);
    linked.program.compute!.modules[0].outputs = [{ id: 'rows', label: 'Rows', type: 'table', collectionId: 'items', columns: [{ id: 'value', label: 'Value', type: 'number' }] }];
    linked.program.collections[0].fields[0].min = 0;
    delete linked.program.canvas;
    const state = start(applyTableChange(createTableState(), linked));
    for (const cell of [null, -1]) {
      expect(() => handleTableCommand(state, 'table.compute.update', { runId, status: 'succeeded', outputs: [{ outputId: 'rows', value: { columns: [{ id: 'value', label: 'Value', type: 'number' }], rows: [{ value: cell }] } }] }, owner)).toThrow(/does not match/u);
    }
    expect(state.computeRuns?.[0]?.status).toBe('running');
  });

  it('supports compute-only tables, persists validated scalar results, and exposes them to metrics', () => {
    let state = applyTableChange(createTableState(), change);
    expect(state.records.items).toEqual(change.initialRecords.items);
    state = succeed(start(state));
    expect(state.computeRuns?.[0]).toMatchObject({ status: 'succeeded', dataRevision: 0, ruleRevision: 0, outputs: [{ outputId: 'total', value: 42 }] });
    const program = state.program;
    if (!program?.canvas) throw new Error('Expected metric canvas.');
    expect(evaluateGenerativeCanvas(program.canvas, {
      program, records: state.records, computeRuns: state.computeRuns,
      dataRevision: state.dataRevision, ruleRevision: state.ruleRevision,
      actor: owner.actorId, turn: state.turn,
    })).toMatchObject([{ id: 'total_metric', kind: 'metric', value: 42 }]);
  });

  it('keeps the last good result after a failed rerun but hides it after input revision changes', () => {
    let state = succeed(start(applyTableChange(createTableState(), change)));
    const failedId = '22222222-2222-4222-8222-222222222222';
    state = handleTableCommand(state, 'table.compute.queue', { moduleId: 'totals', runId: failedId }, owner)!.state;
    state = handleTableCommand(state, 'table.compute.update', { runId: failedId, status: 'failed', errorCode: 'COMPUTE_FAILED' }, owner)!.state;
    expect(state.computeRuns?.[0]?.status).toBe('failed');
    const program = state.program;
    if (!program?.canvas) throw new Error('Expected metric canvas.');
    const current = { program, records: state.records, computeRuns: state.computeRuns, dataRevision: state.dataRevision, ruleRevision: state.ruleRevision, actor: owner.actorId, turn: state.turn };
    expect(evaluateGenerativeCanvas(program.canvas, current)[0]).toMatchObject({ kind: 'metric', value: 42 });
    expect(evaluateGenerativeCanvas(program.canvas, { ...current, dataRevision: state.dataRevision + 1 })[0]).toMatchObject({ kind: 'metric', value: null });
  });

  it('allows a removed or changed running module to finish as stale without trusting its output', () => {
    let state = start(applyTableChange(createTableState(), change));
    const edited = structuredClone(change);
    edited.initialRecords = {};
    const currentModule = edited.program.compute!.modules[0]!;
    edited.program.compute!.modules[0] = { ...currentModule, version: 2, source: currentModule.source + ' // revised' };
    state = applyTableChange(state, edited);
    state = handleTableCommand(state, 'table.compute.update', { runId, status: 'stale' }, owner)!.state;
    expect(state.computeRuns?.[0]).toMatchObject({ status: 'stale', errorCode: 'COMPUTE_STALE' });
    expect(state.computeRuns?.[0]?.outputs).toBeUndefined();
  });

  it('renders a current linked table result over raw collection rows without overwriting them', () => {
    const derivedChange = structuredClone(change);
    derivedChange.program.compute!.modules.push({
      id: 'derived_rows', name: 'Derived rows', description: 'Prepare rows for a linked collection card.',
      runtime: 'javascript', version: 1, source: 'export default function compute(inputs) { return {}; }', inputs: [],
      outputs: [{ id: 'rows', label: 'Rows', type: 'table', collectionId: 'items', columns: [{ id: 'value', label: 'Value', type: 'number' }] }],
    });
    derivedChange.program.canvas!.views.push({
      id: 'items_chart', kind: 'chart', title: 'Computed items', chart: 'bar', collection: 'items',
      categoryField: 'value', value: { op: 'literal', value: 1 },
    });
    let state = applyTableChange(createTableState(), derivedChange);
    const derivedRunId = '33333333-3333-4333-8333-333333333333';
    state = handleTableCommand(state, 'table.compute.run', { moduleId: 'derived_rows', runId: derivedRunId }, owner)!.state;
    state = handleTableCommand(state, 'table.compute.update', {
      runId: derivedRunId, status: 'running', inputHash: 'b'.repeat(64), sourceIds: [], inputProvenance: [],
      dataRevision: state.dataRevision, ruleRevision: state.ruleRevision, runtimeProfile: 'tabletop-compute-1',
    }, owner)!.state;
    state = handleTableCommand(state, 'table.compute.update', {
      runId: derivedRunId, status: 'succeeded', outputs: [{ outputId: 'rows', value: {
        columns: [{ id: 'value', label: 'Value', type: 'number' }], rows: [{ value: 3 }],
      } }],
    }, owner)!.state;
    const activeProgram = state.program;
    if (!activeProgram?.canvas) throw new Error('Expected chart canvas.');
    const evaluated = evaluateGenerativeCanvas(activeProgram.canvas, {
      program: activeProgram, records: state.records, computeRuns: state.computeRuns,
      dataRevision: state.dataRevision, ruleRevision: state.ruleRevision,
      actor: owner.actorId, turn: state.turn,
    });
    expect(evaluated.find(view => view.id === 'items_chart')).toMatchObject({ points: [{ category: 3, value: 1 }] });
    expect(state.records.items).toEqual([{ id: 'record_1', values: { value: 7 } }]);
    expect(() => removeTableRuleItem(state, 'compute', 'derived_rows')).toThrow(/still uses/u);
    expect(() => evaluateGenerativeCanvas(activeProgram.canvas!, {
      program: activeProgram, records: state.records, computeRuns: state.computeRuns,
      dataRevision: state.dataRevision + 1, ruleRevision: state.ruleRevision,
      actor: owner.actorId, turn: state.turn,
    })).toThrow('no current successful compute result');
  });

  it('supports atomic replacement of raw rows while default append behavior stays intact', () => {
    const inputChange = structuredClone(change);
    inputChange.program.collections.push({
      id: 'archive', title: 'Archive', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }],
    });
    inputChange.initialRecords.archive = [{ id: 'archive_1', values: { name: 'keep' } }];
    const state = applyTableChange(createTableState(), inputChange);
    const appended = handleTableCommand(state, 'table.importRows', {
      collection: 'items', rows: [{ value: 8 }],
    }, owner)!.state;
    expect(appended.records.items).toHaveLength(2);
    const replaced = handleTableCommand(state, 'table.importRows', {
      collection: 'items', mode: 'replace', rows: [{ value: 9 }],
    }, owner)!.state;
    expect(replaced.records.items.map(row => row.values.value)).toEqual([9]);
    expect(replaced.records.archive).toEqual(state.records.archive);
    expect(replaced.dataRevision).toBe(state.dataRevision + 1);
    expect(() => handleTableCommand(state, 'table.importRows', {
      collection: 'items', mode: 'replace', rows: [{ unknown: 'invalid' }],
    }, owner)).toThrow();
    expect(state.records.items.map(row => row.values.value)).toEqual([7]);
  });

  it('blocks removal while a view still consumes the module result', () => {
    const state = applyTableChange(createTableState(), change);
    expect(() => removeTableRuleItem(state, 'compute', 'totals')).toThrow('view “Total”');
  });

  it('rejects invalid runner output as a domain error without persisting it', () => {
    let state = start(applyTableChange(createTableState(), change));
    let caught: unknown;
    try {
      handleTableCommand(state, 'table.compute.update', {
        runId, status: 'succeeded', outputs: [{ outputId: 'total', value: 'not a number' }],
      }, owner);
    } catch (error) { caught = error; }
    expect(caught).toMatchObject({ code: 'COMPUTE_INVALID_OUTPUT' });
    expect(state.computeRuns?.[0]?.status).toBe('running');
  });

  it('requires the compute permission on the public queue command', () => {
    expect(() => handleTableCommand(applyTableChange(createTableState(), change), 'table.compute.run', { moduleId: 'totals', runId }, { ...owner, permissions: new Set() }))
      .toThrow('cannot do this');
  });
});
