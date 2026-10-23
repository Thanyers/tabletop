import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
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
  it('rejects non-finite table cells before JSON can silently turn them into null', async () => {
    const runner = createCloudflareComputeRunner({ loader: bindings.COMPUTE_LOADER });
    await expect(runner.run({ ...request, source: 'export default () => ({total:{columns:[{id:"amount",label:"Amount",type:"number"}],rows:[{amount:NaN}]}});' })).rejects.toThrow('COMPUTE_FAILED');
  });
  it('denies generated outbound network access', async () => {
    const runner = createCloudflareComputeRunner({ loader: bindings.COMPUTE_LOADER });
    const network = { ...request, source: 'export default async () => { try { await fetch("https://example.test/"); return {total:0}; } catch { return {total:1}; } };' };
    expect(await runner.run(network)).toEqual({ outputs: { total: 1 } });
  });
  it('fails closed when the requested runner is unavailable', async () => {
    await expect(createCloudflareComputeRunner({}).run(request)).rejects.toThrow('COMPUTE_UNAVAILABLE');
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(createCloudflareComputeRunner({}).run({ ...request, runtime: 'python' })).rejects.toThrow('COMPUTE_UNAVAILABLE');
      expect(warning).toHaveBeenCalledWith('TABLE_COMPUTE_UNAVAILABLE', { runtime: 'python', reason: 'container_binding_missing' });
    } finally {
      warning.mockRestore();
    }
  });

  it('runs Python through the Durable Object container image and streaming exec contract', async () => {
    const pythonRequest: ComputeRunnerRequest = {
      ...request,
      runtime: 'python',
      source: 'def compute(inputs):\n    return {"total": inputs["left"] + inputs["right"]}',
    };
    let startup: ContainerStartupOptions | undefined;
    let execOptions: ContainerExecOptions | undefined;
    let execCommand: string[] = [];
    let configuredTimeout = 0;
    let destroyed = false;
    let imageAvailable = true;
    const container: Container = {
      get running() { return false; },
      get images() { return imageAvailable ? { compute: 'cloudflare-managed-image' } : {}; },
      start(options) { startup = options; },
      async monitor() {},
      async destroy() { destroyed = true; },
      signal() {},
      getTcpPort() { throw new Error('Unexpected network access.'); },
      async setInactivityTimeout(durationMs) { configuredTimeout = Number(durationMs); },
      async interceptOutboundHttp() {},
      async interceptAllOutboundHttp() {},
      async snapshotContainer() { throw new Error('Unexpected container snapshot.'); },
      async interceptOutboundHttps() {},
      async exec(command, options) {
        execCommand = command;
        execOptions = options;
        return {
          stdin: null,
          stdout: new Response(JSON.stringify({ outputs: { total: 42 } })).body,
          stderr: null,
          pid: 1,
          isPty: false,
          exitCode: Promise.resolve(0),
          async output() { return { stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 }; },
          kill() {},
          resize() {},
        };
      },
      async inspect() { return null; },
    };
    const runner = createCloudflareComputeRunner({ container });

    await expect(runner.run(pythonRequest)).resolves.toEqual({ outputs: { total: 42 } });

    expect(startup).toMatchObject({ image: 'cloudflare-managed-image', enableInternet: false, instance: 'standard-1' });
    expect(configuredTimeout).toBeGreaterThan(0);
    expect(execCommand.slice(0, 5)).toEqual(['timeout', '--kill-after=2', '30', 'python3', '-I']);
    expect(execCommand.at(-2)).toBe('-c');
    expect(execOptions).toMatchObject({ user: '10001:10001', cwd: '/tmp', stdout: 'pipe', stderr: 'ignore' });
    const stdin = execOptions?.stdin;
    expect(stdin).toBeInstanceOf(ReadableStream);
    if (!(stdin instanceof ReadableStream)) throw new Error('The Python process did not receive a streamed request.');
    expect(JSON.parse(await new Response(stdin).text())).toEqual({
      source: pythonRequest.source,
      inputs: { left: 3, right: 7 },
    });
    expect(destroyed).toBe(true);

    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      imageAvailable = false;
      await expect(runner.run(pythonRequest)).rejects.toThrow('COMPUTE_UNAVAILABLE');
      expect(warning).toHaveBeenCalledWith('TABLE_COMPUTE_UNAVAILABLE', { runtime: 'python', reason: 'named_image_missing' });
    } finally {
      warning.mockRestore();
    }
  });

  it('resolves a container that becomes available after runner construction', async () => {
    const pythonRequest: ComputeRunnerRequest = {
      ...request,
      runtime: 'python',
      source: 'def compute(inputs):\n    return {"total": inputs["left"] + inputs["right"]}',
    };
    const containerReference: { value?: Container } = {};
    const runner = createCloudflareComputeRunner({ getContainer: () => containerReference.value });
    expect(containerReference.value).toBeUndefined();
    containerReference.value = {
      get running() { return false; },
      get images() { return { compute: 'cloudflare-managed-image' }; },
      start() {},
      async monitor() {},
      async destroy() {},
      signal() {},
      getTcpPort() { throw new Error('Unexpected network access.'); },
      async setInactivityTimeout() {},
      async interceptOutboundHttp() {},
      async interceptAllOutboundHttp() {},
      async snapshotContainer() { throw new Error('Unexpected container snapshot.'); },
      async interceptOutboundHttps() {},
      async exec() {
        return {
          stdin: null,
          stdout: new Response(JSON.stringify({ outputs: { total: 42 } })).body,
          stderr: null,
          pid: 1,
          isPty: false,
          exitCode: Promise.resolve(0),
          async output() { return { stdout: new ArrayBuffer(0), stderr: new ArrayBuffer(0), exitCode: 0 }; },
          kill() {},
          resize() {},
        };
      },
      async inspect() { return null; },
    };

    await expect(runner.run(pythonRequest)).resolves.toEqual({ outputs: { total: 42 } });
  });
});
