// F045: bounded, redacted progress and timeout evidence for a rule-draft job.
// A running job keeps counters plus the last part of the model's thinking; a failed job may also
// keep a short partial answer. This module never describes a full chain of thought or a full reply.

/** A job keeps at most this much thinking text, so the job row stays small and private. */
export const MAX_JOB_THINKING_TAIL_CHARS = 600;
/** A failed job keeps at most this much of the answer it had already received. */
export const MAX_JOB_PARTIAL_CONTENT_CHARS = 4_000;
/** Counters share the assistant progress bound so one bad provider reply cannot inflate a job row. */
export const MAX_JOB_STREAM_CHARS = 1_000_000;
/** A timeout can only be blamed on our own deadline or on the provider closing the stream. */
export const MODEL_TIMEOUT_SOURCES = ['server', 'provider'] as const;
export type ModelTimeoutSource = (typeof MODEL_TIMEOUT_SOURCES)[number];

/** Live provider progress for one model job; refreshed about once a second. */
export interface ModelJobProgress {
  /** Answer characters received so far. */
  receivedChars: number;
  /** Thinking characters received so far (only the count is kept for running jobs). */
  reasoningChars: number;
  /** Last characters of the model's thinking, already redacted by the server. */
  thinkingTail?: string;
  updatedAt: number;
}

/**
 * Why a model job failed and how far it got. `timedOutBy: 'server'` means our own deadline
 * stopped it (the card shows "stopped at our Ns limit"); `'provider'` means the provider
 * closed or broke the stream before finishing.
 */
export interface ModelFailureDetails {
  timedOutBy: ModelTimeoutSource;
  limitMs: number;
  elapsedMs: number;
  receivedChars: number;
  reasoningChars: number;
  /** Bounded, redacted answer text the provider had already sent. */
  partialContent?: string;
  /** Bounded, redacted thinking text; never the whole chain of thought. */
  thinkingTail?: string;
}

/** Cut without splitting a surrogate pair, so a bounded string is always valid UTF-16. */
function cutBeforeSurrogate(value: string, end: number): string {
  if (end <= 0) return '';
  const code = value.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? value.slice(0, end - 1) : value.slice(0, end);
}

/** The first `maxChars` characters, never a lone high surrogate. */
export function headWithin(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  return value.length <= maxChars ? value : cutBeforeSurrogate(value, maxChars);
}

/** The last `maxChars` characters, never a lone low surrogate. */
export function tailWithin(value: string, maxChars: number): string {
  if (maxChars <= 0) return '';
  if (value.length <= maxChars) return value;
  const start = value.length - maxChars;
  const code = value.charCodeAt(start);
  return value.slice(code >= 0xdc00 && code <= 0xdfff ? start + 1 : start);
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_JOB_STREAM_CHARS;
}

function isTimeoutSource(value: unknown): value is ModelTimeoutSource {
  return typeof value === 'string' && (MODEL_TIMEOUT_SOURCES as readonly string[]).includes(value);
}

function boundedText(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = headWithin(value, maxChars);
  return text.length ? text : undefined;
}

/** Rebuild a stored progress record, dropping anything an older or hostile row could carry. */
export function parseModelJobProgress(value: unknown): ModelJobProgress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isCount(record.receivedChars) || !isCount(record.reasoningChars)) return null;
  if (typeof record.updatedAt !== 'number' || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) return null;
  const thinkingTail = boundedText(record.thinkingTail, MAX_JOB_THINKING_TAIL_CHARS);
  return {
    receivedChars: record.receivedChars,
    reasoningChars: record.reasoningChars,
    ...(thinkingTail ? { thinkingTail } : {}),
    updatedAt: record.updatedAt,
  };
}

/** Rebuild stored failure details, dropping anything out of bounds. */
export function parseModelFailureDetails(value: unknown): ModelFailureDetails | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isTimeoutSource(record.timedOutBy)) return null;
  if (!isCount(record.receivedChars) || !isCount(record.reasoningChars)) return null;
  const limitMs = record.limitMs;
  const elapsedMs = record.elapsedMs;
  if (typeof limitMs !== 'number' || !Number.isSafeInteger(limitMs) || limitMs < 1 || limitMs > 600_000) return null;
  if (typeof elapsedMs !== 'number' || !Number.isSafeInteger(elapsedMs) || elapsedMs < 0 || elapsedMs > 600_000) return null;
  const partialContent = boundedText(record.partialContent, MAX_JOB_PARTIAL_CONTENT_CHARS);
  const thinkingTail = boundedText(record.thinkingTail, MAX_JOB_THINKING_TAIL_CHARS);
  return {
    timedOutBy: record.timedOutBy,
    limitMs,
    elapsedMs,
    receivedChars: record.receivedChars,
    reasoningChars: record.reasoningChars,
    ...(partialContent ? { partialContent } : {}),
    ...(thinkingTail ? { thinkingTail } : {}),
  };
}
