import {
  TOOL_BEHAVIOR_LIMITS,
  ToolBehaviorRunError,
  readToolBehaviorResult,
  toolBehaviorRequestSchema,
  type ToolBehaviorRequest,
  type ToolBehaviorResult,
  type ToolBehaviorRunner,
} from '../src/tabletop/shared/tool-behavior.js';
import { TOOL_BEHAVIOR_ENTRY } from '../src/tabletop/runtime/tools/behavior-entry.js';

interface ToolBehaviorEnvironment {
  loader?: WorkerLoader;
}

function unavailable(): ToolBehaviorRunError {
  // Never log the package id, inputs or module source: a run log must not carry workspace data.
  console.warn('TABLE_TOOL_BEHAVIOR_UNAVAILABLE', { reason: 'loader_binding_missing' });
  return new ToolBehaviorRunError('TOOL_BEHAVIOR_UNAVAILABLE');
}

/**
 * A behaviour runs exactly like generated compute code: a fresh isolate per invocation, no
 * bindings, no outbound network and a CPU ceiling. The isolate receives only the declared
 * inputs; the host re-validates every proposed change before anything can be committed.
 */
export function createCloudflareToolBehaviorRunner(environment: ToolBehaviorEnvironment): ToolBehaviorRunner {
  return {
    async run(request, signal) {
      const loader = environment.loader;
      if (!loader) throw unavailable();
      if (signal?.aborted) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_TIMEOUT');
      // The request is host-built; a shape the contract rejects never reaches an isolate.
      const parsed = toolBehaviorRequestSchema.safeParse(request);
      if (!parsed.success) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_FAILED');
      const controller = new AbortController();
      let timedOut = false;
      const cancel = () => controller.abort();
      signal?.addEventListener('abort', cancel, { once: true });
      const timeout = setTimeout(() => { timedOut = true; cancel(); }, TOOL_BEHAVIOR_LIMITS.timeoutMs);
      try {
        return await runInIsolate(loader, parsed.data, controller.signal);
      } catch (error) {
        if (timedOut || signal?.aborted) throw new ToolBehaviorRunError('TOOL_BEHAVIOR_TIMEOUT', { cause: error });
        throw error;
      } finally {
        clearTimeout(timeout);
        signal?.removeEventListener('abort', cancel);
      }
    },
  };
}

async function runInIsolate(loader: WorkerLoader, request: ToolBehaviorRequest, signal: AbortSignal): Promise<ToolBehaviorResult> {
  try {
    const response = await fetchBehaviour(loader, request, signal);
    const body = await readToolBehaviorBody(response.body);
    // 413 is the entry's "unserialisable, non-finite or over the byte cap" answer.
    if (!response.ok) throw new ToolBehaviorRunError(response.status === 413 ? 'TOOL_OUTPUT_INVALID' : 'TOOL_BEHAVIOR_FAILED');
    return readToolBehaviorResult(body);
  } catch (error) {
    // Every rejection leaving this module is typed, so a caller never has to inspect prose.
    if (error instanceof ToolBehaviorRunError) throw error;
    throw new ToolBehaviorRunError(signal.aborted ? 'TOOL_BEHAVIOR_TIMEOUT' : 'TOOL_BEHAVIOR_FAILED', { cause: error });
  }
}

async function fetchBehaviour(loader: WorkerLoader, request: ToolBehaviorRequest, signal: AbortSignal): Promise<Response> {
  // Fresh isolate on every invocation: reusing a warm generated global could disclose prior inputs.
  const worker = loader.load({
    compatibilityDate: '2026-10-18',
    mainModule: 'entry.js',
    modules: { 'entry.js': TOOL_BEHAVIOR_ENTRY, 'module.js': request.moduleSource },
    env: {}, globalOutbound: null,
    limits: { cpuMs: 2_000, subRequests: 0 },
  });
  try {
    return await worker.getEntrypoint().fetch('https://tool-behavior.invalid/', {
      method: 'POST', body: JSON.stringify({ entry: request.entry, inputs: request.inputs }), signal,
    });
  } catch (error) {
    throw new ToolBehaviorRunError(signal.aborted ? 'TOOL_BEHAVIOR_TIMEOUT' : 'TOOL_BEHAVIOR_FAILED', { cause: error });
  }
}

/** Read the untrusted body with a hard byte cap, so a runaway behaviour cannot exhaust memory. */
async function readToolBehaviorBody(stream: ReadableStream<Uint8Array> | null): Promise<string> {
  if (!stream) throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > TOOL_BEHAVIOR_LIMITS.maxOutputBytes) {
        await reader.cancel();
        throw new ToolBehaviorRunError('TOOL_OUTPUT_INVALID');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result);
}
