import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import {
  TOOL_BEHAVIOR_LIMITS,
  ToolBehaviorRunError,
  readToolBehaviorResult,
  toolBehaviorRequestSchema,
  type ToolBehaviorRequest,
  type ToolBehaviorResult,
} from '../src/tabletop/shared/tool-behavior.js';
import { TOOL_BEHAVIOR_ENTRY } from '../src/tabletop/runtime/tools/behavior-entry.js';

/**
 * The local JavaScript engine is workerd, with no host bindings and denied egress. The outer
 * Miniflare Worker exists only to own the `workerLoaders` binding: the behaviour itself runs in
 * a nested isolate loaded with the same options the Cloudflare runner uses, so a local test
 * proves the same boundary the deployed runner enforces.
 */
export async function runLocalToolBehavior(request: ToolBehaviorRequest, signal?: AbortSignal): Promise<ToolBehaviorResult> {
  if (signal?.aborted) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_TIMEOUT');
  const parsed = toolBehaviorRequestSchema.safeParse(request);
  if (!parsed.success) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_FAILED');
  const loaded = parsed.data;
  const entry = `export default {async fetch(request, env) {
    const body = await request.json();
    const worker = env.LOADER.load({compatibilityDate:'2026-10-18',mainModule:'entry.js',
      modules:{'entry.js':${JSON.stringify(TOOL_BEHAVIOR_ENTRY)},'module.js':body.moduleSource},
      env:{},globalOutbound:null,limits:{cpuMs:2000,subRequests:0}});
    return worker.getEntrypoint().fetch('https://tool-behavior.invalid/',{method:'POST',body:JSON.stringify({entry:body.entry,inputs:body.inputs})});
  }};`;
  const runtime = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    script: entry,
    compatibilityDate: '2026-10-18',
    workerLoaders: { LOADER: {} },
  }));
  let stopped = false;
  const stop = () => { stopped = true; void runtime.dispose().catch(() => undefined); };
  signal?.addEventListener('abort', stop, { once: true });
  // Local workerd does not enforce the cloud CPU option, so a measured wall clock also
  // disposes the process for a tight synchronous loop (not just an outstanding fetch).
  const timeout = setTimeout(stop, TOOL_BEHAVIOR_LIMITS.timeoutMs + 1_000);
  try {
    const response = await runtime.dispatchFetch('https://tool-behavior.invalid/', {
      method: 'POST',
      body: JSON.stringify({ moduleSource: loaded.moduleSource, entry: loaded.entry, inputs: loaded.inputs }),
    });
    const body = await response.text();
    if (new TextEncoder().encode(body).byteLength > TOOL_BEHAVIOR_LIMITS.maxOutputBytes) {
      throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
    }
    // 413 is the entry's "unserialisable, non-finite or over the byte cap" answer.
    if (!response.ok) throw new ToolBehaviorRunError(response.status === 413 ? 'TOOL_OUTPUT_INVALID' : 'TOOL_BEHAVIOR_FAILED');
    return readToolBehaviorResult(body);
  } catch (error) {
    if (stopped || signal?.aborted) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_TIMEOUT', { cause: error });
    // Every rejection leaving this module is typed, so a caller never has to inspect prose.
    if (error instanceof ToolBehaviorRunError) throw error;
    throw new ToolBehaviorRunError('TOOL_BEHAVIOR_FAILED', { cause: error });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', stop);
    await runtime.dispose();
  }
}
