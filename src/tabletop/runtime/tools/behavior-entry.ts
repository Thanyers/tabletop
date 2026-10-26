import { TOOL_BEHAVIOR_LIMITS } from '../../shared/tool-behavior';

/**
 * F080 slice C2: the sandbox entry that mounts one compiled behaviour module.
 *
 * Mirrors `COMPUTE_WORKER_ENTRY`: the package source is an ES-module string loaded as
 * `module.js` beside this entry, the module is imported statically (never `eval`), and the only
 * input that crosses the boundary is the declared inputs object. The entry itself is a pure
 * string constant so the Worker, the Node runner and the tests mount exactly the same code.
 *
 * Status codes carry the failure class the host must report:
 * - 422 the behaviour threw, the request was unreadable, or the entry export is missing
 *   (`TOOL_BEHAVIOR_FAILED`),
 * - 413 the output was not serialisable, contained a non-finite number, or exceeded the byte cap
 *   (`TOOL_OUTPUT_INVALID`).
 *
 * Nothing here validates scope: a change outside the declared writes is still returned and is
 * refused by `validateToolBehaviorOutput` on the host, where the declarations live.
 */
export const TOOL_BEHAVIOR_ENTRY = `import * as behaviour from './module.js';
export default { async fetch(request) {
  let body;
  try { body = await request.json(); } catch { return new Response('The behaviour request is not JSON.', {status:422}); }
  const run = behaviour[body.entry];
  if (typeof run !== 'function') return new Response('The behaviour entry is missing.', {status:422});
  let result;
  try { result = await run(body.inputs); } catch { return new Response('The behaviour failed.', {status:422}); }
  // D-039: a behaviour may return the legacy change list, or { changes, proposal }.
  const payload = Array.isArray(result)
    ? { changes: result }
    : { changes: result && Array.isArray(result.changes) ? result.changes : [], ...(result && result.proposal !== undefined ? { proposal: result.proposal } : {}) };
  let encoded;
  try {
    encoded = JSON.stringify(payload, (_key, value) => {
      if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite output');
      return value;
    });
  } catch { return new Response('The behaviour output is not serialisable.', {status:413}); }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > ${TOOL_BEHAVIOR_LIMITS.maxOutputBytes}) {
    return new Response('The behaviour output exceeds the execution limit.', {status:413});
  }
  return new Response(encoded, {headers:{'content-type':'application/json'}});
} };`;
