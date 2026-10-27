import { TOOL_BRIDGE_LIMITS, TOOL_PROTOCOL_VERSION, type ToolProtocolVersion } from '../../shared/tool-bridge';
import type { ToolBridgeParse, ToolBridgeParseFailure, ToolHostMessage } from '../../shared/tool-protocol';

/**
 * F080 / D-044: the messages between the host page and a tool frame served from its own origin.
 *
 * Once the frame document lives on another origin, it can no longer be handed a whole document: its
 * own static script reports that it is up, and then the host sends one init message carrying the
 * runtime text and the boot payload. The two shapes below are the entire handshake, and they are
 * deliberately outside the bridge protocol (`tool-protocol.ts`) because they exist before a runtime
 * does — the handshake carries no nonce, so the parent checks window identity and nothing else.
 *
 * This module imports the wire constants, never the parser: the sandbox origin's script must stay
 * small, and the full schema check of the boot payload belongs to the runtime that reads it
 * (`bootstrap.ts`). Everything here is pure, so the limits are testable without a browser.
 */

/** The element the frame runtime reads its boot payload from, in either document form. */
export const TOOL_SANDBOX_BOOT_ELEMENT_ID = 'tool-boot';

/** The boot payload: the init message the runtime validates before it renders anything. */
export type ToolSandboxInitHook = Extract<ToolHostMessage, { kind: 'init' }>;

/** Host -> frame, once the frame reports `ready`. */
export interface ToolSandboxInitMessage {
  protocol: ToolProtocolVersion;
  kind: 'init';
  /**
   * The bundled runtime as text. D-047: absent when the frame is served from the sandbox origin, which
   * loads its own `/runtime.js`; the srcdoc document still receives it inline.
   */
  runtimeScript?: string;
  modules: Record<string, string>;
  uiEntry: string;
  init: ToolSandboxInitHook;
}

/** Frame -> host: it is up, or it refused to start and says why. */
export type ToolSandboxFrameHello = { kind: 'ready' } | { kind: 'blocked'; reason: string };

export interface ToolSandboxInitInput {
  /** D-047: omitted when the frame loads the runtime from its own origin. */
  runtimeScript?: string;
  compiled: { modules: Record<string, string>; uiEntry: string };
  init: ToolSandboxInitHook;
}

function failure(code: ToolBridgeParseFailure, detail: string): { ok: false; code: ToolBridgeParseFailure; detail: string } {
  return { ok: false, code, detail };
}

/**
 * The frame document's URL for a configured sandbox origin.
 *
 * `undefined` unless the value is a bare http(s) origin: a value carrying a path would silently point
 * the frame at something other than the sandbox, and a non-web scheme is never a sandbox at all.
 */
export function toolSandboxFrameUrl(sandboxOrigin: string): string | undefined {
  let url: URL;
  try {
    url = new URL(sandboxOrigin);
  } catch {
    return undefined;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined;
  if (url.pathname !== '/' || url.search !== '' || url.hash !== '') return undefined;
  return `${url.origin}/frame.html`;
}

function isModuleText(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(text => typeof text === 'string');
}

/**
 * The envelope check the frame can afford to run before it evaluates anything.
 *
 * It is deliberately not the bridge schema: that schema (and every port, revision and locale rule in
 * it) is applied by the runtime the moment it starts, so a package still cannot be rendered from a
 * malformed payload. What this refuses is a frame starting on a message that is not an init message
 * at all, or on one with no runtime text, no entry module or no usable presentation.
 */
function isBootPayload(value: unknown): value is ToolSandboxInitHook {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const presentation = candidate.presentation;
  const locale = typeof presentation === 'object' && presentation !== null
    ? (presentation as Record<string, unknown>).locale
    : undefined;
  return candidate.kind === 'init'
    && typeof candidate.nonce === 'string' && candidate.nonce.length > 0
    && (locale === 'th' || locale === 'en');
}

/**
 * Validate an init message.
 *
 * The frame runs this on everything the parent sends before it starts, and the host runs it on what it
 * is about to send (`buildToolSandboxInitMessage`), so one function owns the rules for both sides.
 */
export function parseToolSandboxInitMessage(value: unknown): ToolBridgeParse<ToolSandboxInitMessage> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return failure('BRIDGE_NOT_OBJECT', 'A sandbox init message is an object.');
  }
  const candidate = value as Record<string, unknown>;
  if (candidate.protocol !== TOOL_PROTOCOL_VERSION) {
    return failure('BRIDGE_SCHEMA', 'protocol: the frame speaks the bridge protocol it was built for.');
  }
  if (candidate.kind !== 'init') {
    return failure('BRIDGE_SCHEMA', 'kind: the frame starts only on an init message.');
  }
  const runtimeScript = candidate.runtimeScript;
  if (runtimeScript !== undefined) {
    if (typeof runtimeScript !== 'string' || runtimeScript.length === 0) {
      return failure('BRIDGE_SCHEMA', 'runtimeScript: when sent, the runtime text must be a non-empty string.');
    }
    if (runtimeScript.length > TOOL_BRIDGE_LIMITS.maxRuntimeScriptChars) {
      return failure('BRIDGE_TOO_LARGE', `runtimeScript: the runtime text exceeds ${TOOL_BRIDGE_LIMITS.maxRuntimeScriptChars} characters.`);
    }
  }
  if (!isModuleText(candidate.modules)) {
    return failure('BRIDGE_SCHEMA', 'modules: every module is text the frame can instantiate.');
  }
  const uiEntry = candidate.uiEntry;
  if (typeof uiEntry !== 'string' || uiEntry.length === 0) {
    return failure('BRIDGE_SCHEMA', 'uiEntry: the frame needs the module it mounts.');
  }
  if (!isBootPayload(candidate.init)) {
    return failure('BRIDGE_SCHEMA', 'init: the frame needs an init message with a nonce and a presentation.');
  }
  return {
    ok: true,
    message: {
      protocol: TOOL_PROTOCOL_VERSION,
      kind: 'init',
      runtimeScript,
      modules: candidate.modules,
      uiEntry,
      init: candidate.init,
    },
  };
}

/** Build the init message the host posts, refusing to send one the frame would have to reject. */
export function buildToolSandboxInitMessage(input: ToolSandboxInitInput): ToolBridgeParse<ToolSandboxInitMessage> {
  return parseToolSandboxInitMessage({
    protocol: TOOL_PROTOCOL_VERSION,
    kind: 'init',
    ...(input.runtimeScript === undefined ? {} : { runtimeScript: input.runtimeScript }),
    modules: input.compiled.modules,
    uiEntry: input.compiled.uiEntry,
    init: input.init,
  });
}

/**
 * Read a handshake message from the frame.
 *
 * `undefined` for everything else, including the runtime's own `{protocol, kind:'ready', nonce}`: the
 * handshake carries no `protocol` field, which is what keeps the two `ready` messages apart.
 */
export function parseToolSandboxFrameHello(value: unknown): ToolSandboxFrameHello | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const candidate = value as Record<string, unknown>;
  if ('protocol' in candidate) return undefined;
  if (candidate.kind === 'ready') return { kind: 'ready' };
  if (candidate.kind !== 'blocked') return undefined;
  const reason = typeof candidate.reason === 'string' && candidate.reason.trim().length > 0
    // A frame reports why it could not start; the host shows it, so it is bounded like any diagnostic.
    ? candidate.reason.slice(0, TOOL_BRIDGE_LIMITS.maxDiagnosticChars)
    : 'The tool frame refused to start and gave no reason.';
  return { kind: 'blocked', reason };
}
