import { COMPUTE_WIRE_BYTES } from '../src/tabletop/shared/compute-runtime-profiles.js';

/** Both runners use the same JSON protocol; generated source never becomes a shell command. */
export const COMPUTE_WORKER_ENTRY = `import compute from './module.js';
export default { async fetch(request) {
  try {
    const inputs = await request.json();
    const outputs = await compute(inputs);
    const body = JSON.stringify({ outputs }, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite output');
      return value;
    });
    if (!body || new TextEncoder().encode(body).byteLength > ${COMPUTE_WIRE_BYTES}) return new Response('Output exceeds the execution limit.', {status:422});
    return new Response(body, {headers:{'content-type':'application/json'}});
  } catch { return new Response('The function failed. Check its inputs and code in Advanced.', {status:422}); }
} };`;

export const COMPUTE_PYTHON_ENTRY = `import contextlib, json, sys, resource
resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
resource.setrlimit(resource.RLIMIT_FSIZE, (${COMPUTE_WIRE_BYTES}, ${COMPUTE_WIRE_BYTES}))
request = json.load(sys.stdin)
scope = {"__name__": "tabletop_compute"}
class DiscardOutput:
    def write(self, text): return len(text)
    def flush(self): pass
with contextlib.redirect_stdout(DiscardOutput()), contextlib.redirect_stderr(DiscardOutput()):
    exec(compile(request["source"], "tabletop-function.py", "exec"), scope)
    outputs = scope["compute"](request["inputs"])
body = json.dumps({"outputs": outputs}, allow_nan=False, ensure_ascii=False)
if len(body.encode("utf-8")) > ${COMPUTE_WIRE_BYTES}:
    raise ValueError("Output exceeds the execution limit")
sys.stdout.write(body)
`;

export async function readComputeBody(stream: ReadableStream<Uint8Array> | null, maximum = COMPUTE_WIRE_BYTES): Promise<string> {
  if (!stream) throw new Error('The compute runner returned no output.');
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new Error('The compute output exceeds the execution limit.');
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(result);
}
