import type { ModelJob } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import { MAX_JOB_PARTIAL_CONTENT_CHARS, MAX_JOB_RESEARCH_SOURCES, MAX_JOB_RESEARCH_SUMMARY_CHARS, MAX_JOB_RESEARCH_URL_CHARS, MAX_JOB_THINKING_TAIL_CHARS, headWithin, parseModelJobResearch, tailWithin, type ModelFailureDetails, type ModelJobResearch, type ModelJobSearchProgress, type ModelTimeoutSource } from '../shared/model-job-progress';
import { classifyChatIntent } from '../shared/chat-intent';
import { MAX_TABLE_SOURCES } from '../shared/table-source-limits';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';

export interface TableChatRequestContext {
  prompt: string;
  hasCreateAction: boolean;
  /** A canvas card the message is about (chat reference). */
  referencedCard?: boolean;
  /** A specific rule/module the message is about (stable server-resolved reference). */
  referencedRule?: boolean;
}

const CARD_CHANGE = /\b(?:harder|easier|more|less|remove|rename|add|make|change|edit|extend)\b|ยาก|ง่าย|ลด|ลบ|เปลี่ยน|เอาออก|เพิ่ม|ปรับ|แก้/iu;
const QUESTION_LEAD = /^(?:(?:how many|how much|what|which|why|when|who|where|explain|summari[sz]e)\b|อธิบาย|สรุป|ทำไม|มี.{0,32}กี่|กี่)/iu;
const RULE_BEHAVIOR_QUESTION = /(?:กฎ|สูตร|โมดูล)(?:นี้|นั้น)?[\s\S]{0,80}(?:(?:รับ|ใช้|อ่าน|คำนวณ|คืนค่า|ทำงาน|ส่งผล|เปลี่ยนผล|ทำ)[\s\S]{0,24}(?:อะไร|ไหน|ตรงไหน|อย่างไร|ยังไง|เท่าไร|เท่าไหร่)|(?:ตรงไหน|อย่างไร|ยังไง|เท่าไร|เท่าไหร่))[?？]?$/iu;
const RULE_EDIT_LEAD = /^(?:(?:please|could you|can you)\s+)?(?:change|edit|make|set|add|remove|extend)\b|^(?:(?:ช่วย|กรุณา)\s*)?(?:เปลี่ยน|แก้|ปรับ|เพิ่ม|ลด|ลบ|เอาออก)/iu;

export function tableChatMode(role: 'owner' | 'participant', hasActiveProgram: boolean, explicitDraft: boolean, request?: TableChatRequestContext): 'draft' | 'ask' {
  if (role !== 'owner') return 'ask';
  if (!hasActiveProgram || explicitDraft) return 'draft';
  if (!request) return 'ask';
  const prompt = request.prompt.trim();
  // Some Thai behavior questions mention a change the rule makes, but still ask for an
  // explanation. Keep explicit edit requests (and the Change this rule flow) authoritative.
  if (request.referencedRule && RULE_BEHAVIOR_QUESTION.test(prompt) && !RULE_EDIT_LEAD.test(prompt)) return 'ask';
  // A requested change about one exact rule is a draft, unless it is phrased as a question.
  if (request.referencedRule && CARD_CHANGE.test(prompt) && !QUESTION_LEAD.test(prompt)) return 'draft';
  // Keep the original behavior for general canvas cards such as a collection or chart.
  if (request.referencedCard && CARD_CHANGE.test(prompt) && !QUESTION_LEAD.test(prompt)) return 'draft';
  // F047: one classifier shared by every entry point; build/edit become a rule draft, ask/act stay
  // conversational because an action still needs the person's explicit confirmation.
  const intent = classifyChatIntent({
    prompt,
    hasActiveProgram,
    hasCreateAction: request.hasCreateAction,
  });
  return intent === 'build' || intent === 'edit' ? 'draft' : 'ask';
}

export interface ChatRequestScope {
  id: string;
  epoch: number;
  kind: string;
  actor: { actorId: string; role: string; seat?: string };
}

/** Same-command retries may use an older revision only for the same seat and table epoch. */
export function sameChatRequestScope(snapshot: ChatRequestScope, current: ChatRequestScope): boolean {
  return snapshot.id === current.id
    && snapshot.epoch === current.epoch
    && snapshot.kind === current.kind
    && snapshot.actor.actorId === current.actor.actorId
    && snapshot.actor.role === current.actor.role
    && snapshot.actor.seat === current.actor.seat;
}

/** A delayed read may not replace a newer projection or a different private scope. */
export function canApplyWorkspaceRefresh(
  expected: ChatRequestScope,
  current: ChatRequestScope | null,
  received: ChatRequestScope,
  requestSequence: number,
  currentSequence: number,
): boolean {
  return current !== null
    && requestSequence === currentSequence
    && sameChatRequestScope(expected, current)
    && sameChatRequestScope(expected, received);
}

export interface ChatCard {
  id: string;
  kind: 'draft' | 'answer';
  prompt: string;
  createdAt: number;
  /** `queued`: a rule request waiting for the table's current rule draft to finish (F038). */
  phase: 'queued' | 'sending' | 'waiting' | 'complete' | 'failed';
  requestCommandId?: ReturnType<typeof crypto.randomUUID>;
  /** In-memory snapshot used only to retry an uncertain request with its original body. */
  requestView?: WorkspaceView;
  requestUncertain?: boolean;
  requestError?: string;
  modelJob?: ModelJob;
  job?: TableAssistantJob;
  error?: string;
  pollError?: string;
  pollTimedOut?: boolean;
  checking?: boolean;
  confirmId?: ReturnType<typeof crypto.randomUUID>;
  confirming?: boolean;
  confirmationPending?: boolean;
  confirmationError?: string;
}

export function historyCard(job: TableAssistantJob, id: string): ChatCard {
  return {
    id,
    kind: 'answer',
    prompt: job.prompt,
    createdAt: job.createdAt,
    phase: job.status === 'running' ? 'waiting' : job.status === 'failed' ? 'failed' : 'complete',
    job,
    error: job.status === 'failed' ? job.message ?? 'The assistant request failed.' : undefined,
    confirmationPending: job.confirmationStatus === 'processing',
  };
}

/** A rule request from history (F034): the asker's own or another member's, newest status from the server. */
export function draftHistoryCard(job: ModelJob, id: string): ChatCard {
  const phase: ChatCard['phase'] = job.status === 'failed' ? 'failed' : job.status === 'completed' || job.status === 'complete' ? 'complete' : 'waiting';
  return {
    id,
    kind: 'draft',
    prompt: job.prompt ?? 'Rule request',
    createdAt: job.createdAt ?? 0,
    phase,
    modelJob: job,
    error: job.status === 'failed' ? job.message ?? 'The draft could not be prepared.' : undefined,
  };
}

const historyKey = (card: ChatCard) => card.job?.id ?? card.modelJob?.id ?? card.id;

/** Merge only by an exact server job ID; the history contract does not expose command IDs. */
export function mergeChatHistory(current: readonly ChatCard[], incoming: readonly ChatCard[]): ChatCard[] {
  const merged = new Map<string, ChatCard>();
  for (const card of current) merged.set(historyKey(card), card);
  for (const card of incoming) {
    const key = historyKey(card);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, card);
      continue;
    }
    if (card.kind === 'draft' && card.modelJob) {
      // Rule requests: keep the local card (and its id) but take the server's latest status.
      merged.set(key, {
        ...existing,
        prompt: existing.prompt || card.prompt,
        createdAt: card.createdAt || existing.createdAt,
        modelJob: card.modelJob,
        phase: existing.phase === 'sending' ? existing.phase : card.phase,
        error: card.error ?? (card.phase === 'failed' ? existing.error : undefined),
      });
      continue;
    }
    const job = card.job ?? existing.job;
    merged.set(key, {
      ...card,
      ...existing,
      id: existing.id,
      prompt: existing.prompt || card.prompt,
      createdAt: card.createdAt || existing.createdAt,
      job,
      phase: job?.status === 'running' ? 'waiting' : job?.status === 'failed' ? 'failed' : job ? 'complete' : existing.phase,
      error: job?.status === 'failed' ? job.message ?? existing.error ?? 'The assistant request failed.' : undefined,
      requestError: job ? undefined : existing.requestError,
      requestUncertain: job ? false : existing.requestUncertain,
      pollError: job ? undefined : existing.pollError,
      pollTimedOut: job ? false : existing.pollTimedOut,
      checking: job ? false : existing.checking,
      confirmationPending: job?.confirmationStatus === 'processing',
      confirmationError: job?.confirmationStatus === 'available' && existing.confirmationPending
        ? 'No action was confirmed. Review the current table before trying again.'
        : job?.confirmationStatus === 'confirmed' || job?.confirmationStatus === 'stale' || job?.confirmationStatus === 'rejected'
          ? undefined
          : existing.confirmationError,
    });
  }
  return [...merged.values()].sort((left, right) => right.createdAt - left.createdAt);
}

export function isUncertainRequest(card: ChatCard): boolean {
  return card.requestUncertain === true && !card.job && !card.modelJob;
}

/** Apply draft-refresh results only while they still belong to the current private table scope. */
export function draftRefreshPatch(targetScope: string, currentScope: string, error?: string): Pick<ChatCard, 'checking' | 'pollError' | 'pollTimedOut'> | null {
  if (!targetScope || targetScope !== currentScope) return null;
  return error
    ? { checking: false, pollError: `The draft is ready, but the table could not refresh: ${error}` }
    : { checking: false, pollError: undefined, pollTimedOut: false };
}

/** F025: when a concurrent projection wins the race, wait briefly and reapply instead of failing the draft. */
export function draftRefreshBackoffMs(attempt: number): number {
  return 150 * (attempt + 1);
}

/**
 * F038: a table holds one rule draft at a time and a draft that finishes after the table changed
 * is discarded, so rule requests run one after another. A draft still refreshing the table counts
 * as running; the next request must start from the refreshed revision.
 */
export function draftInFlight(cards: readonly ChatCard[]): boolean {
  return cards.some((card) => card.kind === 'draft' && (card.phase === 'sending' || card.phase === 'waiting' || card.checking === true));
}

/** The oldest queued rule request, once nothing else is drafting. Cards are kept newest first. */
export function nextQueuedDraft(cards: readonly ChatCard[]): ChatCard | undefined {
  if (draftInFlight(cards)) return undefined;
  for (let index = cards.length - 1; index >= 0; index -= 1) {
    const card = cards[index];
    if (card?.kind === 'draft' && card.phase === 'queued') return card;
  }
  return undefined;
}

/** F045: the configured whole-job stop used when the server view does not carry one. */
export const DRAFT_LIMIT_MS_DEFAULT = 240_000;
/** F045: the client polls this long past the server limit, so the final status always reaches the card. */
export const DRAFT_POLL_GRACE_MS = 70_000;

/** Milliseconds a rule draft may run: the server's configured limit, else the 240s default. */
export function draftLimitMs(job?: Pick<ModelJob, 'limitMs'>): number {
  const value = job?.limitMs;
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.round(value) : DRAFT_LIMIT_MS_DEFAULT;
}

/** That same limit in whole seconds, for the "12s / 240s server limit" label. */
export function draftLimitSeconds(job?: Pick<ModelJob, 'limitMs'>): number {
  return Math.max(1, Math.round(draftLimitMs(job) / 1000));
}

/** How long a draft is polled: the server's own limit plus the grace period for its final status. */
export function draftPollLimitMs(job?: Pick<ModelJob, 'limitMs'>): number {
  return draftLimitMs(job) + DRAFT_POLL_GRACE_MS;
}

export interface DraftFailureSummary {
  /** `server`: our own deadline stopped the draft. `provider`: the provider closed the stream. */
  timedOutBy: ModelTimeoutSource;
  /** The configured whole-job stop behind `limitLabel`, so the card can expose it to browser tests. */
  limitMs: number;
  /** The same limit the server names in its message, e.g. "240s". */
  limitLabel: string;
  /** Characters of the partial answer kept for display; never more than MAX_JOB_PARTIAL_CONTENT_CHARS. */
  partialChars: number;
  /** Characters of the thinking tail kept for display; never more than MAX_JOB_THINKING_TAIL_CHARS. */
  thinkingChars: number;
  /** The bounded partial answer, absent when no draft text had arrived. */
  partialText?: string;
  /** The bounded thinking tail, absent when the job kept none. */
  thinkingText?: string;
}

/**
 * F045: a readable summary of a failed draft, or null when the job carries no failure details.
 * Text is re-bounded here too, so an oversized or older payload can never grow the card.
 */
export function draftFailureSummary(details: ModelFailureDetails | undefined): DraftFailureSummary | null {
  if (!details) return null;
  const partialText = headWithin(details.partialContent ?? '', MAX_JOB_PARTIAL_CONTENT_CHARS);
  const thinkingText = tailWithin(details.thinkingTail ?? '', MAX_JOB_THINKING_TAIL_CHARS);
  return {
    timedOutBy: details.timedOutBy,
    limitMs: details.limitMs,
    limitLabel: `${Math.max(1, Math.round(details.limitMs / 1000))}s`,
    partialChars: partialText.length,
    thinkingChars: thinkingText.length,
    ...(partialText ? { partialText } : {}),
    ...(thinkingText ? { thinkingText } : {}),
  };
}

/** The one line that keeps our own deadline apart from the provider closing the connection. */
export function draftStopReason(summary: DraftFailureSummary): string {
  return summary.timedOutBy === 'server'
    ? `Why it stopped: our own ${summary.limitLabel} server limit, not the AI provider.`
    : `Why it stopped: the AI provider closed the connection before our ${summary.limitLabel} server limit.`;
}

/** Label for the collapsed partial answer; it names the bound so a short block never looks complete. */
export function draftPartialLabel(summary: DraftFailureSummary): string {
  return summary.partialChars > 0
    ? `Show the ${summary.partialChars.toLocaleString()} characters of the draft that arrived before it stopped`
    : 'No draft text had arrived before it stopped';
}

/** Label for the collapsed thinking tail; the count keeps the bound visible. */
export function draftThinkingLabel(summary: DraftFailureSummary): string {
  return `Show the last ${summary.thinkingChars.toLocaleString()} characters of the model's thinking`;
}

/** F050: how much of the live thinking the waiting card shows as one readable line. */
export const LIVE_THINKING_LINE_CHARS = 280;

/**
 * F050: one line saying what the model is doing right now, from the bounded live tail.
 * Whitespace is collapsed and the line keeps the newest text, so the card streams forward
 * instead of growing a wall of chain-of-thought. Returns null when the job kept no text.
 */
export function liveThinkingLine(tail: string | undefined, maxChars = LIVE_THINKING_LINE_CHARS): string | null {
  if (!tail) return null;
  const collapsed = tail.replace(/\s+/gu, ' ').trim();
  if (!collapsed) return null;
  if (collapsed.length <= maxChars) return collapsed;
  // Keep the tail: the newest words are what "what is it doing" means.
  const window = tailWithin(collapsed, maxChars);
  // Start on a word boundary so a cut never leaves half a word at the front.
  const space = window.indexOf(' ');
  const kept = space > 0 && space < 60 ? window.slice(space + 1) : window;
  return `…${kept.trimStart()}`;
}

/** F064: how much of the search query the waiting card shows as one line. */
export const LIVE_SEARCH_QUERY_CHARS = 160;

/**
 * F064: the pieces of that line, so the card can ellipsise only the query. On a 320px card the
 * "· เจอ N" count would otherwise be the first thing cut, and it is the half users watch.
 */
export interface LiveSearchParts {
  /** The glyph the agreed copy uses (`🔎` while working, `✓` when finished). */
  icon: string;
  /** Copy around the query: `กำลังค้น:` while working, `ใช้ 3 แหล่ง` when finished. */
  text: string;
  /** The bounded query, only while searching or reading. */
  query?: string;
  /** How many results the adapter kept, only while reading. */
  found?: number;
}

/**
 * F064: split the live search line so the found count can never be ellipsised away.
 * Re-bounded here as well, so an older or hostile job row cannot grow the card.
 */
export function liveSearchParts(search: ModelJobSearchProgress | undefined, maxQueryChars = LIVE_SEARCH_QUERY_CHARS): LiveSearchParts | null {
  if (!search) return null;
  if (search.phase === 'done') return { icon: '✓', text: `ใช้ ${search.resultsCount} แหล่ง` };
  const query = headWithin(search.query.replace(/\s+/gu, ' ').trim(), maxQueryChars).trim();
  if (!query) return null;
  return search.phase === 'reading'
    ? { icon: '🔎', text: 'กำลังค้น:', query, found: search.resultsCount }
    : { icon: '🔎', text: 'กำลังค้น:', query };
}

/**
 * F064: one line saying what the research step is doing: what it searches, what it found, and then
 * what the draft actually used. Returns null when there is nothing worth showing.
 */
export function liveSearchLine(search: ModelJobSearchProgress | undefined, maxQueryChars = LIVE_SEARCH_QUERY_CHARS): string | null {
  const parts = liveSearchParts(search, maxQueryChars);
  if (!parts) return null;
  if (parts.query === undefined) return `${parts.icon} ${parts.text}`;
  const tail = parts.found === undefined ? '' : ` · เจอ ${parts.found}`;
  return `${parts.icon} ${parts.text} ${parts.query}${tail}`;
}

/** F064 slice B: how much of a source title the card shows before the row wraps. */
export const DRAFT_SOURCE_TITLE_CHARS = 140;

/** F064 slice B: one source row, already re-validated and re-bounded for display. */
export interface DraftSource {
  title: string;
  url: string;
  /** Publication date as a readable label, or an empty string when the provider had none. */
  dateLabel: string;
  /** 0-4, where 4 is an official source. */
  authority: number;
  /** F064 slice C: the bounded evidence text a verified web source would carry; '' when absent. */
  summary: string;
}

/** F064 slice C: a source from a finished draft that can become a table source (non-empty summary). */
export interface AddableWebSource {
  title: string;
  url: string;
  date: string | null;
  authority: number;
  summary: string;
}

/**
 * F064 slice C: the sources a finished draft may offer as table evidence. The summary is the
 * citable text, so a source without one cannot be added; parseModelJobResearch re-validates the
 * URL and bounds every field before this list reaches the command.
 */
export function addableWebSources(research: ModelJobResearch | undefined): AddableWebSource[] {
  const parsed = parseModelJobResearch(research);
  if (!parsed) return [];
  return parsed.sources
    .map((source) => ({ source, summary: (source.summary ?? '').trim() }))
    // A normalized URL can gain one trailing slash; the command schema still caps it at 500.
    .filter((entry) => entry.summary.length > 0 && entry.source.url.length <= MAX_JOB_RESEARCH_URL_CHARS)
    .slice(0, MAX_JOB_RESEARCH_SOURCES)
    .map(({ source, summary }) => ({
      title: source.title,
      url: source.url,
      date: source.date,
      authority: source.authority,
      summary: headWithin(summary, MAX_JOB_RESEARCH_SUMMARY_CHARS),
    }));
}

/**
 * F086: the researched sources that are not on the table yet. A draft the server put into use on its own (F039) is
 * otherwise "finished" and leaves the canvas, which took its sources (and the only way to add them) with it.
 * URLs compare the way the server stores them (fragment dropped).
 */
export function webSourcesNotOnTable(research: ModelJobResearch | undefined, tableSources: readonly { url?: string }[]): AddableWebSource[] {
  const onTable = new Set(tableSources.flatMap((source) => source.url ? [comparableUrl(source.url)] : []));
  // A table holds at most MAX_TABLE_SOURCES sources; offering more than fit would leave the card asking forever.
  const room = Math.max(0, MAX_TABLE_SOURCES - tableSources.length);
  return addableWebSources(research).filter((source) => !onTable.has(comparableUrl(source.url))).slice(0, room);
}

function comparableUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/** F064 slice B: `26 Jul 2026`, or nothing when the provider gave no usable date. */
export function formatSourceDate(value: string | null | undefined): string {
  if (!value) return '';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** F064 slice B: the collapsed label; the count tells a member whether it is worth opening. */
export function draftSourcesLabel(count: number): string {
  return `Sources (${count})`;
}

/**
 * F064 slice B: the sources a finished draft shows, re-validated and re-bounded here as well, so an
 * older or hostile job row can never render a link the server would refuse.
 */
export function draftSources(research: ModelJobResearch | undefined): DraftSource[] {
  const parsed = parseModelJobResearch(research);
  if (!parsed) return [];
  return parsed.sources.map((source) => ({
    title: headWithin(source.title, DRAFT_SOURCE_TITLE_CHARS),
    url: source.url,
    dateLabel: formatSourceDate(source.date),
    authority: source.authority,
    summary: headWithin(source.summary ?? '', MAX_JOB_RESEARCH_SUMMARY_CHARS),
  }));
}

/** F070: a chat card that came from picking one option under another chat card. */
export interface ChatFollowUp { parentCardId: string; option: string }

const FOLLOW_UP_ID_CHARS = 240;
const FOLLOW_UP_OPTION_CHARS = 120;

/** F070: keep only well-formed links from this browser's private state; the newest `limit` survive. */
export function parseChatFollowUps(value: unknown, limit: number): Record<string, ChatFollowUp> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
  const links: Array<[string, ChatFollowUp]> = [];
  for (const [childId, link] of Object.entries(value)) {
    if (typeof link !== 'object' || link === null) continue;
    const { parentCardId, option } = link as { parentCardId?: unknown; option?: unknown };
    if (typeof parentCardId !== 'string' || typeof option !== 'string') continue;
    if (!childId || childId.length > FOLLOW_UP_ID_CHARS || !parentCardId || parentCardId.length > FOLLOW_UP_ID_CHARS || parentCardId === childId) continue;
    if (!option.trim() || option.length > FOLLOW_UP_OPTION_CHARS) continue;
    links.push([childId, { parentCardId, option }]);
  }
  return Object.fromEntries(links.slice(-limit));
}

/**
 * F070: the options already picked under `parentId`, each mapped to the follow-up card it opened.
 * A link whose follow-up card is gone (dismissed, another table) does not count, so the option can be picked again.
 */
export function chosenFollowUps(parentId: string, cards: readonly Pick<ChatCard, 'id'>[], followUps: Readonly<Record<string, ChatFollowUp>>): Map<string, string> {
  const present = new Set(cards.map((card) => card.id));
  const chosen = new Map<string, string>();
  for (const [childId, link] of Object.entries(followUps)) {
    if (link.parentCardId === parentId && present.has(childId) && !chosen.has(link.option)) chosen.set(link.option, childId);
  }
  return chosen;
}
