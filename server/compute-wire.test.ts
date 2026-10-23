import { describe, expect, it } from 'vitest';
import { computeInputValues, parseComputeWireResult } from './compute-wire.js';
import type { ComputeRunnerRequest } from '../src/tabletop/shared/table-compute.js';

describe('compute wire protocol', () => {
  it('passes the actual typed values to generated code', () => {
    const request: ComputeRunnerRequest = { moduleId: 'calc', moduleVersion: 1, runtimeProfile: 'tabletop-compute-1', runtime: 'python', source: 'def compute(inputs): return inputs', inputs: { amount: { type: 'number', value: 12.5 } }, outputs: [] };
    expect(computeInputValues(request)).toEqual({ amount: 12.5 });
  });
  it('rejects nonfinite output and executable-shaped payloads', () => {
    expect(() => parseComputeWireResult('{"outputs":{"n":1e999}}')).toThrow('COMPUTE_INVALID_OUTPUT');
    expect(() => parseComputeWireResult('{"outputs":{"n":{"script":"alert(1)"}}}')).toThrow('COMPUTE_INVALID_OUTPUT');
  });
});
