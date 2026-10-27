import { TOOL_BRIDGE_LIMITS } from '../../shared/tool-bridge';
import {
  TOOL_SANDBOX_BOOT_ELEMENT_ID,
  parseToolSandboxInitMessage,
  type ToolSandboxFrameHello,
  type ToolSandboxInitMessage,
} from './frame-message';

/**
 * F080 / D-044: the script the sandbox's own origin serves (`/frame.js`).
 *
 * The frame document cannot be an `about:srcdoc` string any more: it has to live on an origin whose
 * Content-Security-Policy is its own, so the app page keeps `script-src 'self'` (D-041/D-043). This
 * file is therefore a static asset with no inline script anywhere: it announces itself, waits for
 * exactly one init message from its parent, and only then instantiates the runtime the host sent.
 *
 * It is built by `scripts/build-tool-sandbox-runtime.mjs` into `sandbox-assets/frame.js`; the asset
 * directory is a worker of its own (`wrangler.sandbox.jsonc`), never part of the app's origin.
 */

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const limit = TOOL_BRIDGE_LIMITS.maxDiagnosticChars;
  return message.length > limit ? `${message.slice(0, limit)}…` : message;
}

/** Report a refusal through the one channel the host watches, so a blank frame is never silent. */
function reportBlocked(reason: string): void {
  const message: ToolSandboxFrameHello = { kind: 'blocked', reason };
  window.parent.postMessage(message, '*');
}

/** True when a message that failed validation was meant to be the init message after all. */
function isInitAttempt(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as Record<string, unknown>).kind === 'init';
}

/**
 * Hand the runtime its boot payload the way the inline document did, then start it.
 *
 * The element is created through the DOM rather than parsed from markup, so the JSON cannot close a
 * tag; the runtime still reads the same `#tool-boot` element it always did.
 */
/** D-047: the runtime this origin serves, used when the host does not inline it. */
async function loadOwnRuntime(): Promise<string> {
  const response = await fetch('/runtime.js', { credentials: 'omit' });
  if (!response.ok) throw new Error(`TOOL_RUNTIME_UNAVAILABLE: ${response.status}`);
  return response.text();
}

async function startRuntime(message: ToolSandboxInitMessage): Promise<void> {
  document.documentElement.lang = message.init.presentation.locale;
  // The runtime is the sandbox's own asset on this origin; the srcdoc document still receives it inline.
  const runtimeScript = message.runtimeScript ?? await loadOwnRuntime();
  const boot = document.createElement('script');
  boot.type = 'application/json';
  boot.id = TOOL_SANDBOX_BOOT_ELEMENT_ID;
  boot.textContent = JSON.stringify({ modules: message.modules, uiEntry: message.uiEntry, init: message.init });
  document.body.appendChild(boot);
  // `'unsafe-eval'` on this origin is what lets the runtime run; no other script here needs it.
  new Function(runtimeScript)();
  const start = globalThis.__TOOL_SANDBOX_START__;
  if (typeof start !== 'function') throw new Error('The sandbox runtime installed no start function.');
  start();
}

let started = false;
let reportedRuntimeError = false;

/**
 * D-045: once the runtime is running, anything it throws surfaces here.
 *
 * A cross-origin script that throws is sanitised by the browser to "Script error." before the host
 * sees it, which hides the real reason from the person and from us. This origin is the one place that
 * can read the message, so it forwards it through the same `blocked` channel the host already shows.
 */
window.addEventListener('error', event => {
  if (!started || reportedRuntimeError) return;
  reportedRuntimeError = true;
  const where = event.filename ? ` (${event.filename}:${event.lineno ?? 0})` : '';
  reportBlocked(`${event.message || 'The tool threw an error.'}${where}`);
});
window.addEventListener('unhandledrejection', event => {
  if (!started || reportedRuntimeError) return;
  reportedRuntimeError = true;
  const promiseEvent = event as PromiseRejectionEvent;
  reportBlocked(`Unhandled rejection: ${describeError(promiseEvent.reason)}`);
});

window.addEventListener('message', event => {
  // This frame runs in an opaque origin (`sandbox="allow-scripts"` without `allow-same-origin`), so
  // `event.origin` is "null" and cannot name the parent; window identity is the check available here,
  // and the payload is validated below rather than trusted.
  if (started || event.source !== window.parent) return;
  const parsed = parseToolSandboxInitMessage(event.data);
  if (!parsed.ok) {
    // Anything that is not an init attempt (a stray message, an early projection push) is not ours.
    if (!isInitAttempt(event.data)) return;
    started = true;
    reportBlocked(`The tool sandbox message was rejected: ${parsed.code} ${parsed.detail}`);
    return;
  }
  started = true;
  // D-047: the runtime may have to be fetched from this origin first, so starting is asynchronous.
  void startRuntime(parsed.message).catch((error: unknown) => {
    reportBlocked(describeError(error));
  });
});

// The host waits for this before it posts the payload; without it a blocked frame is just a blank box.
window.parent.postMessage({ kind: 'ready' } satisfies ToolSandboxFrameHello, '*');
