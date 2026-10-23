import type { ComputeRunner, ComputeRunnerRequest, ComputeRunnerResult } from '../src/tabletop/shared/table-compute.js';
import { COMPUTE_EXECUTION_TIMEOUT_MS } from '../src/tabletop/shared/compute-runtime-profiles.js';
import { COMPUTE_PYTHON_ENTRY, COMPUTE_WORKER_ENTRY, readComputeBody } from '../server/compute-program.js';
import { computeInputValues, computeWireRequest, parseComputeWireResult } from '../server/compute-wire.js';

interface ComputeEnvironment { loader?: WorkerLoader; container?: Container }

/** Execution receives no database, cookies, secrets, application bindings or network capability. */
export function createCloudflareComputeRunner(environment: ComputeEnvironment): ComputeRunner {
  let pythonTail: Promise<unknown> = Promise.resolve();
  return {
    async run(request, signal) {
      const controller = new AbortController();
      const cancel = () => controller.abort();
      if (signal?.aborted) controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(cancel, COMPUTE_EXECUTION_TIMEOUT_MS);
      try {
        if (request.runtime === 'javascript') return await runJavaScript(environment.loader, request, controller.signal);
        // A Room owns one container. Serial execution and destruction keep runs from sharing files.
        const next = pythonTail.catch(() => undefined).then(() => runPython(environment.container, request, controller.signal));
        pythonTail = next;
        return await next;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

async function runJavaScript(loader: WorkerLoader | undefined, request: ComputeRunnerRequest, signal: AbortSignal): Promise<ComputeRunnerResult> {
  if (!loader) throw new Error('COMPUTE_UNAVAILABLE');
  if (signal.aborted) throw new Error('COMPUTE_TIMEOUT');
  // Fresh isolate on every invocation: reusing a warm generated global could disclose prior inputs.
  const worker = loader.load({
    compatibilityDate: '2026-10-18',
    mainModule: 'entry.js',
    modules: { 'entry.js': COMPUTE_WORKER_ENTRY, 'module.js': request.source },
    env: {}, globalOutbound: null,
    limits: { cpuMs: 1_000, subRequests: 0 },
  });
  const response = await worker.getEntrypoint().fetch('https://compute.invalid/', {
    method: 'POST', body: JSON.stringify(computeInputValues(request)), signal,
  });
  const body = await readComputeBody(response.body);
  if (!response.ok) throw new Error('COMPUTE_FAILED');
  return parseComputeWireResult(body);
}

async function runPython(container: Container | undefined, request: ComputeRunnerRequest, signal: AbortSignal): Promise<ComputeRunnerResult> {
  if (!container) throw new Error('COMPUTE_UNAVAILABLE');
  if (signal.aborted) throw new Error('COMPUTE_TIMEOUT');
  try {
    if (container.running) await container.destroy();
    if (!container.images.compute) throw new Error('COMPUTE_UNAVAILABLE');
    container.start({ image: container.images.compute, enableInternet: false, instance: 'basic' });
    await container.setInactivityTimeout(COMPUTE_EXECUTION_TIMEOUT_MS + 5_000);
    const process = await container.exec(['timeout', '--kill-after=2', '30', 'python3', '-I', '-c', COMPUTE_PYTHON_ENTRY], {
      user: '10001:10001', cwd: '/tmp', signal,
      stdin: new Response(computeWireRequest(request)).body ?? undefined,
      stdout: 'pipe', stderr: 'ignore',
    });
    const body = await readComputeBody(process.stdout);
    if (await process.exitCode !== 0) throw new Error('COMPUTE_FAILED');
    return parseComputeWireResult(body);
  } finally {
    await container.destroy().catch(() => undefined);
  }
}
