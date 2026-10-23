import { describe, expect, it } from 'vitest';
import { createNodeComputeRunner } from './compute-runner.js';
import type { ComputeRunnerRequest } from '../src/tabletop/shared/table-compute.js';

const request: ComputeRunnerRequest = {
  moduleId: 'sum', moduleVersion: 1, runtimeProfile: 'tabletop-compute-1', runtime: 'javascript',
  source: 'export default inputs => ({total:inputs.amount*2});',
  inputs: { amount: { type: 'number', value: 6 } },
  outputs: [{ id: 'total', label: 'Total', type: 'number' }],
};

describe('local isolated compute', () => {
  it('runs generated JavaScript with the same protocol as the Cloudflare adapter', async () => {
    expect(await createNodeComputeRunner().run(request)).toEqual({ outputs: { total: 12 } });
  });
  it('does not expose Node host imports to generated code', async () => {
    await expect(createNodeComputeRunner().run({ ...request, source: 'import fs from "node:fs"; export default () => ({total:fs.readFileSync("/etc/passwd").length});' })).rejects.toThrow();
  });
  it('stops a CPU-bound generated function within the local wall budget', async () => {
    const started = Date.now();
    await expect(createNodeComputeRunner().run({ ...request, source: 'export default () => { while (true) {} };' })).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(4_000);
  }, 5_000);
});
