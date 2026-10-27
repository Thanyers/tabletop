/**
 * F080 / D-044: where the tool sandbox document is served from.
 *
 * The sandbox has its own origin so the app page can keep `script-src 'self'` (D-041/D-043). The
 * value that names it is configuration, but it decides which origin an `<iframe>` loads, so one
 * function owns the rules and both sides apply them: the Worker before it publishes the field, and
 * the client before it uses it.
 *
 * Nothing here throws. A value that is absent, or that cannot be vouched for, is reported as a
 * problem, and every caller treats that as "no sandbox origin": the room keeps the `srcDoc` frame it
 * had before this field existed.
 */

/** Longer than a Workers hostname needs; a longer value is a mistake, not a sandbox. */
export const TOOL_SANDBOX_ORIGIN_MAX_LENGTH = 200;

/** Why a configured origin is not used. `absent` is the documented default, not a fault. */
export type ToolSandboxOriginProblem =
  | 'absent'
  | 'too-long'
  | 'not-a-url'
  | 'not-https'
  | 'credentials'
  | 'query'
  | 'fragment'
  | 'not-an-origin'
  | 'untrusted-host';

export type ToolSandboxOriginRead =
  | { ok: true; origin: string }
  | { ok: false; problem: ToolSandboxOriginProblem };

/** The host a URL names, for the "same host as the app" rule; `undefined` when it is not a URL. */
function hostOf(origin: string): string | undefined {
  try {
    return new URL(origin).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Read the configured sandbox origin.
 *
 * `appOrigin` is the origin the app itself is served from. A sandbox on the app's own host is
 * allowed — one deployment may serve both — and everything else has to be a `.workers.dev` host,
 * which is where the sandbox Worker is deployed. The value must be a bare `https` origin: it is used
 * as `${origin}/frame.html`, so a path, a port, a query or a fragment would send the frame somewhere
 * other than the sandbox that was reviewed.
 */
export function readToolSandboxOrigin(value: unknown, appOrigin: string): ToolSandboxOriginRead {
  if (value === undefined || value === null) return { ok: false, problem: 'absent' };
  if (typeof value !== 'string') return { ok: false, problem: 'not-a-url' };
  const text = value.trim();
  // An empty variable is one an operator cleared, not one they set wrong.
  if (text.length === 0) return { ok: false, problem: 'absent' };
  if (text.length > TOOL_SANDBOX_ORIGIN_MAX_LENGTH) return { ok: false, problem: 'too-long' };
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return { ok: false, problem: 'not-a-url' };
  }
  if (url.protocol !== 'https:') return { ok: false, problem: 'not-https' };
  if (url.username !== '' || url.password !== '') return { ok: false, problem: 'credentials' };
  if (url.search !== '') return { ok: false, problem: 'query' };
  if (url.hash !== '') return { ok: false, problem: 'fragment' };
  if (url.pathname !== '/' || url.port !== '') return { ok: false, problem: 'not-an-origin' };
  const host = url.host.toLowerCase();
  if (!host.endsWith('.workers.dev') && host !== hostOf(appOrigin)) return { ok: false, problem: 'untrusted-host' };
  return { ok: true, origin: url.origin };
}
