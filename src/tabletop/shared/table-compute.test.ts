import { describe, expect, it } from 'vitest';
import {
  computeDerivedCollections,
  computeModuleOrder,
  computeProgramProblems,
  resolveComputeInput,
  validateComputeOutputs,
  type ComputeModule,
  type ComputeRunRecord,
  type ComputeTableValue,
  type TableComputeProgram,
} from './table-compute';

const module = (id: string, inputs: ComputeModule['inputs'], outputs: ComputeModule['outputs']): ComputeModule => ({
  id, name: id, description: 'Test computation.', runtime: 'javascript', version: 1,
  source: 'export default function compute(inputs) { return {}; }', inputs, outputs,
});
const tableOutput = [{ id: 'rows', label: 'Rows', type: 'table' as const, collectionId: 'derived', columns: [{ id: 'value', label: 'Value', type: 'number' as const }] }];

function runRecord(moduleId: string, outputValue: ComputeTableValue): ComputeRunRecord {
  return {
    runId: '11111111-1111-4111-8111-111111111111', moduleId, moduleVersion: 1,
    runtimeProfile: 'tabletop-compute-1', actorId: 'owner', role: 'owner', seat: null,
    status: 'succeeded', startedAt: 1, completedAt: 2, dataRevision: 4, ruleRevision: 2,
    outputs: [{ outputId: 'rows', value: outputValue }],
  };
}

describe('reusable compute contracts', () => {
  it('orders collection readers after the unique derived writer and resolves its table result', () => {
    const writer = module('writer', [], tableOutput);
    const reader = module('reader', [{ id: 'items', label: 'Items', type: 'table', binding: { kind: 'collection', collectionId: 'derived' } }], [
      { id: 'count', label: 'Count', type: 'number' },
    ]);
    const program: TableComputeProgram = { version: 1, modules: [reader, writer] };
    expect(computeModuleOrder(program).map(item => item.id)).toEqual(['writer', 'reader']);
    const rawValue: ComputeTableValue = { columns: [{ id: 'value', label: 'Value', type: 'number' }], rows: [{ value: 3 }] };
    const run = runRecord('writer', rawValue);
    const derived = computeDerivedCollections(program, [run], 4, 2);
    expect(derived.get('derived')).toEqual(rawValue);
    const value = resolveComputeInput(reader.inputs[0]!, {
      collections: [{ id: 'derived', fields: [{ id: 'value', label: 'Value', type: 'number', required: true }] }],
      records: { derived: [{ id: 'raw', values: { value: 99 } }] },
      sources: [], outputs: new Map(), program, derivedCollections: derived,
      actor: { role: 'owner', seat: null }, dataRevision: 4,
    });
    expect(value).toEqual(rawValue);
  });

  it('blocks a collection-owned read until the writer has a current successful result', () => {
    const writer = module('writer', [], tableOutput);
    const reader = module('reader', [{ id: 'items', label: 'Items', type: 'table', binding: { kind: 'collection', collectionId: 'derived' } }], [
      { id: 'count', label: 'Count', type: 'number' },
    ]);
    const program: TableComputeProgram = { version: 1, modules: [writer, reader] };
    const input = reader.inputs[0]!;
    expect(() => resolveComputeInput(input, {
      collections: [{ id: 'derived', fields: [{ id: 'value', label: 'Value', type: 'number', required: true }] }],
      records: { derived: [{ id: 'raw', values: { value: 99 } }] }, sources: [], outputs: new Map(), program,
      actor: { role: 'owner', seat: null }, dataRevision: 4,
    })).toThrow('COMPUTE_BINDING');
    expect(computeDerivedCollections(program, [runRecord('writer', { columns: [{ id: 'value', label: 'Value', type: 'number' }], rows: [] })], 5, 2)).toEqual(new Map());
  });

  it('rejects duplicate writers, cycles and malformed runner outputs', () => {
    const first = module('first', [], tableOutput);
    const second = module('second', [], [{ ...tableOutput[0]!, id: 'other' }]);
    const duplicateWriter: TableComputeProgram = { version: 1, modules: [first, second] };
    expect(computeProgramProblems(duplicateWriter, [{ id: 'derived', fields: [{ id: 'value', label: 'Value', type: 'number', required: true }] }])
      .some(problem => problem.code === 'COMPUTE_BINDING')).toBe(true);
    expect(() => validateComputeOutputs(first, { outputs: { rows: { columns: [{ id: 'value', label: 'Value', type: 'number' }], rows: [{ value: 'wrong' }] } } }))
      .toThrow('COMPUTE_INVALID_OUTPUT');
    const cycle: TableComputeProgram = {
      version: 1,
      modules: [
        module('a', [{ id: 'in', label: 'Input', type: 'table', binding: { kind: 'collection', collectionId: 'derived' } }], tableOutput),
      ],
    };
    expect(computeProgramProblems(cycle, [{ id: 'derived', fields: [{ id: 'value', label: 'Value', type: 'number', required: true }] }])
      .some(problem => problem.code === 'COMPUTE_CYCLE')).toBe(true);
  });
});
