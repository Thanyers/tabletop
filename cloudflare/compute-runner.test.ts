import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createCloudflareComputeRunner } from './compute-runner.js';
import type { ComputeRunnerRequest } from '../src/tabletop/shared/table-compute.js';

const bindings = env as { COMPUTE_LOADER: WorkerLoader };
const request: ComputeRunnerRequest = {
  moduleId: 'sum', moduleVersion: 1, runtimeProfile: 'tabletop-compute-1', runtime: 'javascript',
  source: 'export default function compute(inputs) { return {total:inputs.left + inputs.right}; }',
  inputs: { left: { type: 'number', value: 3 }, right: { type: 'number', value: 7 } },
  outputs: [{ id: 'total', label: 'Total', type: 'number' }],
};

describe('real isolated generated JavaScript', () => {
  it('runs accepted source twice with new inputs', async () => {
    const runner = createCloudflareComputeRunner({ loader: bindings.COMPUTE_LOADER });
    expect(await runner.run(request)).toEqual({ outputs: { total: 10 } });
    expect(await runner.run({ ...request, inputs: { left: { type: 'number', value: 40 }, right: { type: 'number', value: 2 } } })).toEqual({ outputs: { total: 42 } });
  });
  it('does not retain generated globals across invocations', async () => {
    const runner = createCloudflareComputeRunner({ loader: bindings.COMPUTE_LOADER });
    const count = { ...request, source: 'let calls=0; export default () => ({total:++calls});' };
    expect(await runner.run(count)).toEqual({ outputs: { total: 1 } });
    expect(await runner.run(count)).toEqual({ outputs: { total: 1 } });
  });
  it('denies generated outbound network access', async () => {
    const runner = createCloudflareComputeRunner({ loader: bindings.COMPUTE_LOADER });
    const network = { ...request, source: 'export default async () => { try { await fetch("https://example.test/"); return {total:0}; } catch { return {total:1}; } };' };
    expect(await runner.run(network)).toEqual({ outputs: { total: 1 } });
  });
  it('fails closed when the requested runner is unavailable', async () => {
    await expect(createCloudflareComputeRunner({}).run(request)).rejects.toThrow('COMPUTE_UNAVAILABLE');
    await expect(createCloudflareComputeRunner({}).run({ ...request, runtime: 'python' })).rejects.toThrow('COMPUTE_UNAVAILABLE');
  });
});
