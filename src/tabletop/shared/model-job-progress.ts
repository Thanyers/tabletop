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

/** F064: the phases a native web-research step reports while a rule draft waits. */
export const SEARCH_PROGRESS_PHASES = ['searching', 'reading', 'done'] as const;
export type SearchProgressPhase = (typeof SEARCH_PROGRESS_PHASES)[number];
/** F064: the search query kept on a running job, measured after redaction and clamping. */
export const MAX_JOB_SEARCH_QUERY_CHARS = 180;
/** F064: the top result title kept on a running job, measured after redaction and clamping. */
export const MAX_JOB_SEARCH_TITLE_CHARS = 120;
/** F064: both search text fields together, so one event can never grow a job row past F050's budget. */
export const MAX_JOB_SEARCH_TEXT_CHARS = MAX_JOB_SEARCH_QUERY_CHARS + MAX_JOB_SEARCH_TITLE_CHARS;
/** F064: a search answers with at most 50 rows and keeps at most 10; this is the stored ceiling. */
export const MAX_JOB_SEARCH_RESULTS = 100;
/** F064 slice B: sources kept on a finished draft, matching the research step's own ceiling. */
export const MAX_JOB_RESEARCH_SOURCES = 12;
/** F064 slice B: search queries kept with the sources, for history and later evidence work. */
export const MAX_JOB_RESEARCH_QUERIES = 12;
/** F064 slice B: a source title is display text, redacted and clamped like any provider text. */
export const MAX_JOB_RESEARCH_TITLE_CHARS = 200;
/** F064 slice B: long enough for real URLs, short enough that a job row cannot be inflated. */
export const MAX_JOB_RESEARCH_URL_CHARS = 500;
/** F064 slice B: an ISO date from the provider; anything longer is not a date. */
export const MAX_JOB_RESEARCH_DATE_CHARS = 40;
/** F064: DeepSeek reports authority 0-4, where 4 is an official source. */
export const MAX_SOURCE_AUTHORITY = 4;
/** F064 slice C: the provider summary kept as the citable text of a web source. */
export const MAX_JOB_RESEARCH_SUMMARY_CHARS = 800;

/** F064 slice B: one web source the draft used. `url` is always http(s) after validation. */
export interface ModelJobResearchSource {
  title: string;
  url: string;
  date: string | null;
  authority: number;
  /** F064 slice C: the evidence text a verified source would carry (title + summary). */
  summary?: string;
}

/** F064 slice B: what the research step searched and which sources the draft kept. Display only. */
export interface ModelJobResearch {
  queries: string[];
  sources: ModelJobResearchSource[];
}

/**
 * F064: what the research step is doing right now. The query and top title come from the model and
 * the public web, so the worker redacts them like any other provider text before storing.
 */
export interface ModelJobSearchProgress {
  phase: SearchProgressPhase;
  /** The query the model asked for, redacted and bounded. */
  query: string;
  /** Results the provider returned (`reading`) or sources the draft kept (`done`). */
  resultsCount: number;
  /** Title of the top-ranked result, redacted and bounded. */
  topTitle?: string;
}

/** Live provider progress for one model job; refreshed about once a second. */
export interface ModelJobProgress {
  /** Answer characters received so far. */
  receivedChars: number;
  /** Thinking characters received so far (only the count is kept for running jobs). */
  reasoningChars: number;
  /** Last characters of the model's thinking, already redacted by the server. */
  thinkingTail?: string;
  /** F064: the latest web-research step (phase, query, count), already redacted by the server. */
  search?: ModelJobSearchProgress;
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

function isSearchPhase(value: unknown): value is SearchProgressPhase {
  return typeof value === 'string' && (SEARCH_PROGRESS_PHASES as readonly string[]).includes(value);
}

/** F064: rebuild one stored search event, dropping anything an older or hostile row could carry. */
export function parseModelJobSearchProgress(value: unknown): ModelJobSearchProgress | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  if (!isSearchPhase(record.phase)) return undefined;
  const query = boundedText(record.query, MAX_JOB_SEARCH_QUERY_CHARS);
  if (!query) return undefined;
  const count = record.resultsCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > MAX_JOB_SEARCH_RESULTS) {
    return undefined;
  }
  const topTitle = boundedText(record.topTitle, MAX_JOB_SEARCH_TITLE_CHARS);
  return {
    phase: record.phase,
    query,
    resultsCount: count,
    ...(topTitle ? { topTitle } : {}),
  };
}

/**
 * F064 slice B: the only URLs a card may turn into a link. Everything else (javascript:, data:,
 * credentials, dotless hosts) is dropped, so a stored job row can never inject a scheme.
 */
export function safeExternalUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_JOB_RESEARCH_URL_CHARS) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null;
  if (parsed.username || parsed.password) return null;
  return parsed.toString();
}

/** F064 slice B: a readable host for a source that arrived without a title. */
export function externalHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return '';
  }
}

/** F064 slice B: rebuild stored research, dropping anything out of bounds or unsafe to link. */
export function parseModelJobResearch(value: unknown): ModelJobResearch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const rawSources = Array.isArray(record.sources) ? record.sources : [];
  const sources: ModelJobResearchSource[] = [];
  for (const entry of rawSources) {
    if (sources.length >= MAX_JOB_RESEARCH_SOURCES) break;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue;
    const source = entry as Record<string, unknown>;
    const url = safeExternalUrl(source.url);
    if (!url) continue;
    const authority = source.authority;
    if (typeof authority !== 'number' || !Number.isSafeInteger(authority)
        || authority < 0 || authority > MAX_SOURCE_AUTHORITY) continue;
    const title = boundedText(source.title, MAX_JOB_RESEARCH_TITLE_CHARS) ?? externalHost(url);
    const date = typeof source.date === 'string' ? headWithin(source.date, MAX_JOB_RESEARCH_DATE_CHARS) : '';
    // F064 C: the summary is the citable text of a web source, so it is bounded with the rest.
    const summary = boundedText(source.summary, MAX_JOB_RESEARCH_SUMMARY_CHARS);
    sources.push({ title, url, date: date || null, authority, ...(summary ? { summary } : {}) });
  }
  if (!sources.length) return undefined;
  const queries = (Array.isArray(record.queries) ? record.queries : [])
    .map((query) => boundedText(query, MAX_JOB_SEARCH_QUERY_CHARS))
    .filter((query): query is string => Boolean(query))
    .slice(0, MAX_JOB_RESEARCH_QUERIES);
  return { queries, sources };
}

/** Rebuild a stored progress record, dropping anything an older or hostile row could carry. */
export function parseModelJobProgress(value: unknown): ModelJobProgress | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (!isCount(record.receivedChars) || !isCount(record.reasoningChars)) return null;
  if (typeof record.updatedAt !== 'number' || !Number.isSafeInteger(record.updatedAt) || record.updatedAt < 0) return null;
  const thinkingTail = boundedText(record.thinkingTail, MAX_JOB_THINKING_TAIL_CHARS);
  const search = parseModelJobSearchProgress(record.search);
  return {
    receivedChars: record.receivedChars,
    reasoningChars: record.reasoningChars,
    ...(thinkingTail ? { thinkingTail } : {}),
    ...(search ? { search } : {}),
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
