import { z } from 'zod';
import { jsonWithinBudget } from './json-budget';

/**
 * F080: the typed channel between the host and one generated tool instance.
 *
 * The protocol is deliberately small and closed. A frame may only send the four messages
 * below, always stamped with the nonce it was initialised with; the host may only send four.
 * Everything else is dropped before it can reach a reducer, so a compromised or buggy frame
 * cannot invent a method, a revision or an actor.
 */

export const TOOL_PROTOCOL_VERSION = 1 as const;
export type ToolProtocolVersion = typeof TOOL_PROTOCOL_VERSION;

export const TOOL_BRIDGE_LIMITS = {
  /** Characters of one serialised message. Larger messages are dropped, not truncated. */
  maxMessageChars: 64 * 1024,
  /** Rows one port snapshot may carry into the frame. */
  maxRowsPerPort: 200,
  /** Ports announced in one message. */
  maxPorts: 8,
  /** Pending intents the host accepts from one instance before it starts rejecting. */
  maxPendingIntents: 8,
  /** Characters of one log line accepted from the frame. */
  maxLogChars: 400,
  /** Log lines kept per instance. */
  maxLogEntries: 50,
  /** Rendered height the frame may request, in CSS pixels. */
  maxHeightPx: 4_000,
  /** Characters of one diagnostic message returned to the author. */
  maxDiagnosticChars: 1_000,
  /** An intent that has not been answered in this many milliseconds is reported as abandoned. */
  intentTimeoutMs: 15_000,
} as const;

/** Why a projection is what it is; the frame renders the difference instead of guessing. */
export type ToolPortStatus = 'live' | 'stale' | 'missing' | 'revoked';

/** The revision a projection was authorized and read at. */
export interface ToolPortRevision {
  dataRevision: number;
  ruleRevision: number;
  /** Bumped whenever the source grant changes; a bump invalidates cached rows. */
  grantVersion: number;
  readAt: number;
}

export type ToolScalar = string | number | boolean | null;

export interface ToolPortRow {
  /** Stable row identity at the source; never a display position. */
  id: string;
  values: Record<string, ToolScalar>;
}

/**
 * One authorized projection. Scalar ports use `value`; records ports use `rows` and the
 * declared field allowlist. `sourceLabel` is the only thing the frame learns about where
 * the data came from: the source workspace id stays in the host.
 */
export interface ToolPortSnapshot {
  portId: string;
  kind: 'records' | 'number' | 'text' | 'boolean';
  status: ToolPortStatus;
  revision: ToolPortRevision;
  sourceLabel: string;
  rows?: ToolPortRow[];
  value?: ToolScalar;
}

export interface ToolPresentation {
  locale: 'th' | 'en';
  reducedMotion: boolean;
  /** Rows the host will actually deliver per records port after the authority clamp. */
  maxRows: number;
}

/** Host -> frame. */
export type ToolHostMessage =
  | {
    protocol: ToolProtocolVersion;
    kind: 'init';
    instanceId: string;
    nonce: string;
    packageId: string;
    packageVersion: number;
    contentHash: string;
    ports: ToolPortSnapshot[];
    presentation: ToolPresentation;
  }
  | { protocol: ToolProtocolVersion; kind: 'ports'; ports: ToolPortSnapshot[] }
  | {
    protocol: ToolProtocolVersion;
    kind: 'outcome';
    requestId: string;
    behaviorId: string;
    status: 'committed' | 'rejected';
    /** Present when rejected: a stable code the package can branch on. */
    code?: string;
    message?: string;
    /** New length of the instance history after a commit, so the UI can show freshness. */
    instanceRevision?: number;
  }
  | { protocol: ToolProtocolVersion; kind: 'dispose'; reason: 'unmount' | 'revoked' | 'replaced' };

/** Frame -> host. */
export type ToolFrameMessage =
  | { protocol: ToolProtocolVersion; kind: 'ready'; nonce: string }
  | {
    protocol: ToolProtocolVersion;
    kind: 'intent';
    nonce: string;
    requestId: string;
    behaviorId: string;
    inputs: Record<string, ToolScalar>;
  }
  | { protocol: ToolProtocolVersion; kind: 'resize'; nonce: string; height: number }
  | { protocol: ToolProtocolVersion; kind: 'log'; nonce: string; level: 'info' | 'warn' | 'error'; message: string };

export const TOOL_HOST_METHODS = ['init', 'ports', 'outcome', 'dispose'] as const;
export const TOOL_FRAME_METHODS = ['ready', 'intent', 'resize', 'log'] as const;

export type ToolHostMethod = typeof TOOL_HOST_METHODS[number];
export type ToolFrameMethod = typeof TOOL_FRAME_METHODS[number];

const nonceSchema = z.string().regex(/^[a-f0-9]{32}$/u, 'A bridge nonce is 32 hexadecimal characters.');
const requestIdSchema = z.string().regex(/^[a-z0-9-]{8,40}$/u, 'A request id is lowercase letters, digits and dashes.');
const portIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u);
const scalarSchema: z.ZodType<ToolScalar> = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);

export const toolPortRevisionSchema: z.ZodType<ToolPortRevision> = z.strictObject({
  dataRevision: z.number().int().nonnegative(),
  ruleRevision: z.number().int().nonnegative(),
  grantVersion: z.number().int().nonnegative(),
  readAt: z.number().int().nonnegative(),
});

export const toolPortSnapshotSchema: z.ZodType<ToolPortSnapshot> = z.strictObject({
  portId: portIdSchema,
  kind: z.enum(['records', 'number', 'text', 'boolean']),
  status: z.enum(['live', 'stale', 'missing', 'revoked']),
  revision: toolPortRevisionSchema,
  sourceLabel: z.string().min(1).max(80),
  rows: z.array(z.strictObject({
    id: z.string().min(1).max(80),
    values: z.record(z.string().min(1).max(40), scalarSchema),
  })).max(TOOL_BRIDGE_LIMITS.maxRowsPerPort).optional(),
  value: scalarSchema.optional(),
}).superRefine((snapshot, context) => {
  if (snapshot.kind === 'records' && !snapshot.rows) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'A records port snapshot needs rows.' });
  }
  if (snapshot.kind !== 'records' && snapshot.rows !== undefined) {
    context.addIssue({ code: 'custom', path: ['rows'], message: 'Only a records port snapshot carries rows.' });
  }
});

const presentationSchema: z.ZodType<ToolPresentation> = z.strictObject({
  locale: z.enum(['th', 'en']),
  reducedMotion: z.boolean(),
  maxRows: z.number().int().positive().max(TOOL_BRIDGE_LIMITS.maxRowsPerPort),
});

export const toolHostMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('init'),
    instanceId: portIdSchema,
    nonce: nonceSchema,
    packageId: portIdSchema,
    packageVersion: z.number().int().positive(),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    ports: z.array(toolPortSnapshotSchema).max(TOOL_BRIDGE_LIMITS.maxPorts),
    presentation: presentationSchema,
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('ports'),
    ports: z.array(toolPortSnapshotSchema).max(TOOL_BRIDGE_LIMITS.maxPorts),
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('outcome'),
    requestId: requestIdSchema,
    behaviorId: portIdSchema,
    status: z.enum(['committed', 'rejected']),
    code: z.string().min(1).max(60).optional(),
    message: z.string().max(TOOL_BRIDGE_LIMITS.maxDiagnosticChars).optional(),
    instanceRevision: z.number().int().nonnegative().optional(),
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('dispose'),
    reason: z.enum(['unmount', 'revoked', 'replaced']),
  }),
]);

export const toolFrameMessageSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('ready'),
    nonce: nonceSchema,
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('intent'),
    nonce: nonceSchema,
    requestId: requestIdSchema,
    behaviorId: portIdSchema,
    inputs: z.record(z.string().min(1).max(40), scalarSchema),
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('resize'),
    nonce: nonceSchema,
    height: z.number().int().positive().max(TOOL_BRIDGE_LIMITS.maxHeightPx),
  }),
  z.strictObject({
    protocol: z.literal(TOOL_PROTOCOL_VERSION),
    kind: z.literal('log'),
    nonce: nonceSchema,
    level: z.enum(['info', 'warn', 'error']),
    message: z.string().min(1).max(TOOL_BRIDGE_LIMITS.maxLogChars),
  }),
]);

export type ToolBridgeParseFailure =
  | 'BRIDGE_TOO_LARGE'
  | 'BRIDGE_NOT_OBJECT'
  | 'BRIDGE_SCHEMA';

export type ToolBridgeParse<Message> =
  | { ok: true; message: Message }
  | { ok: false; code: ToolBridgeParseFailure; detail: string };

function parseWith<Message>(schema: z.ZodType<Message>, value: unknown): ToolBridgeParse<Message> {
  if (typeof value === 'string' && value.length > TOOL_BRIDGE_LIMITS.maxMessageChars) {
    return { ok: false, code: 'BRIDGE_TOO_LARGE', detail: 'The message exceeds the bridge size limit.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, code: 'BRIDGE_NOT_OBJECT', detail: 'A bridge message is an object.' };
  }
  // `jsonWithinBudget` guards untrusted wire values and treats `undefined` as unusable, while a
  // JS object legitimately spells an absent optional field as `undefined`. Probe the JSON view,
  // which is what actually crosses the bridge.
  let probe: unknown;
  try {
    probe = JSON.parse(JSON.stringify(value));
  } catch {
    return { ok: false, code: 'BRIDGE_TOO_LARGE', detail: 'The message cannot be serialised.' };
  }
  if (!jsonWithinBudget(probe, 16, 4_000)) {
    return { ok: false, code: 'BRIDGE_TOO_LARGE', detail: 'The message is nested too deeply or has too many nodes.' };
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return { ok: false, code: 'BRIDGE_SCHEMA', detail: first ? `${first.path.join('.') || 'message'}: ${first.message}` : 'Invalid bridge message.' };
  }
  return { ok: true, message: parsed.data };
}

/** Validate a host message before it is posted into a frame. */
export function parseToolHostMessage(value: unknown): ToolBridgeParse<ToolHostMessage> {
  return parseWith(toolHostMessageSchema, value);
}

/**
 * Validate a frame message before it reaches the host.
 *
 * This only checks the shape. The caller must also confirm `event.source` is the frame it
 * created, that the nonce equals the live instance nonce, and that the instance still exists;
 * a shape-valid message from a recycled frame must still be dropped.
 */
export function parseToolFrameMessage(value: unknown): ToolBridgeParse<ToolFrameMessage> {
  return parseWith(toolFrameMessageSchema, value);
}

/**
 * True when a frame message carries the nonce of the instance that is actually mounted.
 *
 * A frame that reloaded, or a frame the host replaced, still holds the old nonce; its
 * messages must be dropped even when they are shape-valid.
 */
export function toolFrameNonceMatches(message: ToolFrameMessage, nonce: string): boolean {
  return message.nonce === nonce;
}

/** Characters a serialised message would cost; used to reject before `postMessage`. */
export function toolBridgeMessageSize(message: unknown): number {
  try {
    return JSON.stringify(message).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * The single place that turns a rejected intent into the code the frame sees, so every
 * refusal keeps the same vocabulary and a package can handle them without string matching.
 */
export const TOOL_INTENT_REJECTIONS = [
  'TOOL_UNKNOWN_BEHAVIOR',
  'TOOL_BEHAVIOR_INPUT_INVALID',
  'TOOL_NOT_AUTHORIZED',
  'TOOL_STALE_REVISION',
  'TOOL_SOURCE_REVOKED',
  'TOOL_WRITE_OUT_OF_SCOPE',
  'TOOL_BEHAVIOR_FAILED',
  'TOOL_BEHAVIOR_TIMEOUT',
  'TOOL_OUTPUT_INVALID',
  'TOOL_BUSY',
] as const;

export type ToolIntentRejection = typeof TOOL_INTENT_REJECTIONS[number];

export function isToolIntentRejection(value: unknown): value is ToolIntentRejection {
  return typeof value === 'string' && (TOOL_INTENT_REJECTIONS as readonly string[]).includes(value);
}

/**
 * What a package receives after asking for a behaviour. `abandoned` exists because a frame can
 * disappear or the host can unmount while a request is in flight; a package must be able to
 * finish that promise instead of hanging forever.
 */
export interface ToolIntentOutcome {
  requestId: string;
  behaviorId: string;
  status: 'committed' | 'rejected' | 'abandoned';
  code?: string;
  message?: string;
  instanceRevision?: number;
}
