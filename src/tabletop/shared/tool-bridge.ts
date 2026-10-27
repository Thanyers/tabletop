/**
 * F080: the wire constants of the tool bridge, kept apart from its schema.
 *
 * `tool-protocol.ts` owns the parsers and therefore imports a schema library. The sandbox document
 * served from its own origin (D-044) needs the version and the limits but never the parser, so they
 * live here and the protocol module re-exports them: one owner, two entry points.
 */

export const TOOL_PROTOCOL_VERSION = 1 as const;
export type ToolProtocolVersion = typeof TOOL_PROTOCOL_VERSION;

export const TOOL_BRIDGE_LIMITS = {
  /** Characters of one serialised message. Larger messages are dropped, not truncated. */
  maxMessageChars: 64 * 1024,
  /**
   * Characters of the bundled sandbox runtime (D-044).
   *
   * The runtime travels as text: inline in the document on the `srcDoc` path, and as one init message
   * to a frame served from the sandbox's own origin. It is a build artifact, not a bridge message, so
   * it has its own ceiling instead of `maxMessageChars` (which bounds structured-cloned data).
   */
  maxRuntimeScriptChars: 2 * 1024 * 1024,
  /** Rows one port snapshot may carry into the frame. */
  maxRowsPerPort: 200,
  /** Ports announced in one message. */
  maxPorts: 8,
  /** Pending intents the host accepts from one instance before it starts rejecting. */
  maxPendingIntents: 8,
  /** Characters of one log line accepted from the frame. */
  maxLogChars: 400,
  /** Rendered height the frame may request, in CSS pixels. */
  maxHeightPx: 4_000,
  /** Characters of one diagnostic message returned to the author. */
  maxDiagnosticChars: 1_000,
  /** An intent that has not been answered in this many milliseconds is reported as abandoned. */
  intentTimeoutMs: 15_000,
} as const;
