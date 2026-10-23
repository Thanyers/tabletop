import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import type { ComputeRunnerRequest, ComputeRunnerResult } from '../src/tabletop/shared/table-compute.js';
import { COMPUTE_WORKER_ENTRY } from './compute-program.js';
import { computeWireRequest, parseComputeWireResult } from './compute-wire.js';

/** The local JavaScript engine is workerd, with no host bindings and denied egress. */
export async function runLocalJavaScript(request: ComputeRunnerRequest, signal?: AbortSignal): Promise<ComputeRunnerResult> {
  if (signal?.aborted) throw new Error('COMPUTE_TIMEOUT');
  const entry = `export default {async fetch(request, env) {
    const {source, inputs} = await request.json();
    const worker = env.LOADER.load({compatibilityDate:'2026-10-18',mainModule:'entry.js',
      modules:{'entry.js':${JSON.stringify(COMPUTE_WORKER_ENTRY)},'module.js':source},
      env:{},globalOutbound:null,limits:{cpuMs:1000,subRequests:0}});
    return worker.getEntrypoint().fetch('https://compute.invalid/',{method:'POST',body:JSON.stringify(inputs)});
  }};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: entry,
    compatibilityDate: '2026-10-18',
    workerLoaders: { LOADER: {} },
  }));
  const stop = () => { void runtime.dispose().catch(() => undefined); };
  signal?.addEventListener('abort', stop, { once: true });
  // Local workerd does not enforce the cloud CPU option. A measured 2s wall limit
  // also disposes the process for a tight synchronous loop (not just a fetch abort).
  const timeout = setTimeout(stop, 2_000);
  try {
    const response = await runtime.dispatchFetch('https://compute.invalid/', { method: 'POST', body: computeWireRequest(request) });
    if (!response.ok) throw new Error('COMPUTE_FAILED');
    return parseComputeWireResult(await response.text());
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
    await runtime.dispose();
  }
}
