import { z } from 'zod';

/**
 * F064 — DeepSeek Search adapter.
 *
 * Search results are untrusted data. Everything returned here is bounded, normalized and
 * ranked before it can reach a prompt or a shared table:
 * - URLs lose tracking noise, fragments and the provider's `(accessed …)` suffix, so a
 *   citation the model rewrote still resolves to the result it saw.
 * - Low-signal results are dropped so a PDF parked next to a keyword cannot outrank NIST.
 * - Citations are matched against what the model was actually shown, never taken on trust.
 */

const SEARCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/search';
export const MAX_SEARCH_QUERY_CHARS = 128;
export const SEARCH_RESULT_COUNT = 5;
export const KEPT_RESULTS = 3;
export const MAX_SUMMARY_CHARS = 400;
const MAX_RESPONSE_BYTES = 256_000;
const DEFAULT_TIMEOUT_MS = 15_000;
const MAX_TIMEOUT_MS = 60_000;
const MIN_SCORE = 1.5;
const MIN_AUTHORITY = 3;

const resultSchema = z.object({
  title: z.string().max(1_000).optional(),
  url: z.string().max(8_192).optional(),
  snippet: z.string().max(4_000).optional(),
  summary: z.string().max(20_000).optional(),
  site_name: z.string().max(300).nullable().optional(),
  date: z.string().max(64).nullable().optional(),
  authority: z.number().int().min(-1).max(4).optional(),
  rerank_score: z.number().min(0).max(100).optional(),
}).passthrough();

const responseSchema = z.object({
  // `results` is always present in a successful reply; a body without it is a provider change, not "no matches".
  results: z.array(resultSchema).max(50),
}).passthrough();

export interface WebSearchResult {
  title: string;
  url: string;
  normalizedUrl: string;
  siteName: string | null;
  date: string | null;
  authority: number;
  score: number;
  summary: string;
}

export interface WebSearchOutcome {
  query: string;
  results: WebSearchResult[];
  dropped: number;
}

export interface WebSearchOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
  count?: number;
  keep?: number;
}

/** Error codes reuse the provider vocabulary the worker already maps. */
export class WebSearchError extends Error {
  constructor(readonly code: 'WEB_SEARCH_NOT_CONFIGURED' | 'WEB_SEARCH_REQUEST_FAILED' | 'WEB_SEARCH_TIMEOUT' | 'WEB_SEARCH_RESPONSE_INVALID', message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}

const TRACKING_PARAMS = new Set([
  'fbclid', 'gclid', 'msclkid', 'mc_cid', 'mc_eid', 'ref', 'ref_src', 'spm', 'utm_source',
  'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'utm_id',
]);

/**
 * Canonical form used for dedupe and citation matching.
 * Handles the provider's malformed `…&lang=EN(accessed` URL and any `#fragment` tail.
 */
export function normalizeSearchUrl(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  let value = raw.trim();
  if (value.length === 0 || value.length > 8_192) return null;
  value = value.replace(/\(accessed[^)]*\)?/gi, '').replace(/[\s)]+$/g, '');
  value = value.replace(/#.*$/, '');
  if (value.startsWith('//')) value = `https:${value}`;
  else if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `https://${value.replace(/^\/+/, '')}`;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname.includes('.')) return null;
  parsed.hash = '';
  parsed.username = '';
  parsed.password = '';
  for (const key of [...parsed.searchParams.keys()]) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) parsed.searchParams.delete(key);
  }
  parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.pathname !== '/' && parsed.pathname.endsWith('/')) parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  const search = parsed.searchParams.toString();
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}${search ? `?${search}` : ''}`;
}

function titleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u0e00-\u0e7f]+/g, ' ').trim();
}

function clampSummary(value: string): string {
  return value.length <= MAX_SUMMARY_CHARS ? value : `${value.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…`;
}

/** Drops low-signal rows, collapses duplicates and keeps the best few. */
export function rankSearchResults(rows: unknown[], keep = KEPT_RESULTS): { kept: WebSearchResult[]; dropped: number } {
  const seen = new Set<string>();
  const candidates: WebSearchResult[] = [];
  for (const row of rows) {
    const parsed = resultSchema.safeParse(row);
    if (!parsed.success) continue;
    const value = parsed.data;
    const normalizedUrl = normalizeSearchUrl(value.url ?? '');
    if (!normalizedUrl || seen.has(normalizedUrl)) continue;
    const authority = value.authority ?? -1;
    const score = value.rerank_score ?? 0;
    if (authority < MIN_AUTHORITY && score < MIN_SCORE) continue;
    seen.add(normalizedUrl);
    candidates.push({
      title: (value.title ?? '').trim().slice(0, 300) || normalizedUrl,
      url: (value.url ?? '').trim(),
      normalizedUrl,
      siteName: value.site_name ?? null,
      date: value.date ?? null,
      authority,
      score,
      summary: clampSummary((value.summary ?? value.snippet ?? '').replace(/\s+/g, ' ').trim()),
    });
  }
  candidates.sort((left, right) => (
    right.authority - left.authority || right.score - left.score
  ));
  return { kept: candidates.slice(0, Math.max(1, keep)), dropped: rows.length - candidates.length };
}

async function readBoundedText(response: Response): Promise<string> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new WebSearchError('WEB_SEARCH_RESPONSE_INVALID', 'The search response exceeds the allowed size.');
  }
  return text;
}

/** One bounded search request. Returns ranked, prompt-safe results. */
export async function searchWeb(query: string, options: WebSearchOptions): Promise<WebSearchOutcome> {
  const apiKey = options.apiKey;
  if (typeof apiKey !== 'string' || apiKey.length === 0 || apiKey.length > 4_096 || /\s/.test(apiKey)) {
    throw new WebSearchError('WEB_SEARCH_NOT_CONFIGURED', 'The search provider is not configured.');
  }
  const boundedQuery = query.replace(/\s+/g, ' ').trim().slice(0, MAX_SEARCH_QUERY_CHARS);
  if (boundedQuery.length === 0) return { query: '', results: [], dropped: 0 };
  const timeoutMs = Math.max(1, Math.min(options.timeoutMs ?? DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS));
  const count = Math.max(1, Math.min(options.count ?? SEARCH_RESULT_COUNT, 50));
  const keep = Math.max(1, Math.min(options.keep ?? KEPT_RESULTS, 10));
  const fetchImpl = options.fetchImpl ?? fetch.bind(globalThis);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abortFromCaller = () => controller.abort();
  options.signal?.addEventListener('abort', abortFromCaller, { once: true });
  try {
    const response = await fetchImpl(SEARCH_ENDPOINT, {
      method: 'POST',
      headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: boundedQuery, count, need_content: false }),
      redirect: 'manual',
      signal: controller.signal,
    });
    if (response.status !== 200) {
      void response.body?.cancel().catch(() => undefined);
      throw new WebSearchError('WEB_SEARCH_REQUEST_FAILED', 'The search provider rejected the request.');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBoundedText(response)) as unknown;
    } catch (error) {
      if (error instanceof WebSearchError) throw error;
      throw new WebSearchError('WEB_SEARCH_RESPONSE_INVALID', 'The search provider returned an invalid response.');
    }
    const body = responseSchema.safeParse(parsed);
    if (!body.success) throw new WebSearchError('WEB_SEARCH_RESPONSE_INVALID', 'The search provider returned an invalid response.');
    const ranked = rankSearchResults(body.data.results ?? [], keep);
    return { query: boundedQuery, results: ranked.kept, dropped: ranked.dropped };
  } catch (error) {
    if (error instanceof WebSearchError) throw error;
    if (controller.signal.aborted) throw new WebSearchError('WEB_SEARCH_TIMEOUT', 'The search request timed out.');
    throw new WebSearchError('WEB_SEARCH_REQUEST_FAILED', 'The search request failed.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortFromCaller);
  }
}

export interface Citation {
  title?: string;
  url: string;
}

export interface CitationMatch {
  citation: Citation;
  result: WebSearchResult;
  matchedBy: 'url' | 'title';
}

export interface CitationReport {
  matched: CitationMatch[];
  unmatched: Citation[];
}

/**
 * Matches model-proposed citations against the results the model was shown.
 * A rewritten URL (dropped fragment, stripped suffix, http→https) still matches.
 */
export function matchCitations(citations: Citation[], results: WebSearchResult[]): CitationReport {
  const byUrl = new Map(results.map((result) => [result.normalizedUrl, result]));
  const byTitle = new Map(results.map((result) => [titleKey(result.title), result]));
  const matched: CitationMatch[] = [];
  const unmatched: Citation[] = [];
  for (const citation of citations) {
    if (!citation || typeof citation.url !== 'string') {
      unmatched.push(citation);
      continue;
    }
    const normalized = normalizeSearchUrl(citation.url);
    const byNormalized = normalized ? byUrl.get(normalized) : undefined;
    if (byNormalized) {
      matched.push({ citation, result: byNormalized, matchedBy: 'url' });
      continue;
    }
    const titled = citation.title ? byTitle.get(titleKey(citation.title)) : undefined;
    if (titled) {
      matched.push({ citation, result: titled, matchedBy: 'title' });
      continue;
    }
    unmatched.push(citation);
  }
  return { matched, unmatched };
}
