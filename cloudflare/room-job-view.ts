import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { tableAssistantResultSchema, type TableAssistantJob } from '../src/tabletop/shared/table-assistant-contracts.js';
import {
  externalHost,
  headWithin,
  parseModelFailureDetails,
  parseModelJobProgress,
  parseModelJobResearch,
  safeExternalUrl,
  tailWithin,
  MAX_JOB_PARTIAL_CONTENT_CHARS,
  MAX_JOB_RESEARCH_DATE_CHARS,
  MAX_JOB_RESEARCH_QUERIES,
  MAX_JOB_RESEARCH_SOURCES,
  MAX_JOB_RESEARCH_SUMMARY_CHARS,
  MAX_JOB_RESEARCH_TITLE_CHARS,
  MAX_JOB_SEARCH_QUERY_CHARS,
  MAX_JOB_SEARCH_RESULTS,
  MAX_JOB_SEARCH_TITLE_CHARS,
  MAX_JOB_THINKING_TAIL_CHARS,
  MAX_SOURCE_AUTHORITY,
  type ModelFailureDetails,
  type ModelJobProgress,
  type ModelJobResearch,
  type ModelJobSearchProgress,
} from '../src/tabletop/shared/model-job-progress.js';
import { createIdentityReplacements, redactString, type IdentityReplacement } from './table-assistant.js';
import { cleanReasons, modelFailureMessage, safeAssistantFailureCode, tableAssistantFailureMessage } from './model-failure.js';
import { AuthorityError } from '../server/errors.js';
import { isRecord } from '../server/codec.js';
import type { RoomModelJob } from './room-repository.js';

/**
 * F078-T6a — the Room's *job view/progress projection*.
 *
 * `Room` used to own the HTTP/socket/alarm transport, the authority wiring, the AI job lifecycles
 * and this read-side projection in one class. This module is only the read half: given a stored
 * job row it produces the public view a member receives, applying the same redaction and bounds
 * regardless of whether the member asked for the job or is reading someone else's under open
 * visibility.
 *
 * Deliberate properties, because clients and stored history depend on them:
 *
 * - Every function here is free: no `this`, no storage, no clock, no alarm. The Room keeps the
 *   routing decisions (the `202`/`200` split, `ctx.waitUntil`, alarm scheduling) and the
 *   open-vs-private scope selection.
 * - Object key order and conditional spreads are part of the response contract, because the body
 *   is JSON-encoded. A key that was absent must stay absent rather than become `undefined`.
 * - A malformed stored row throws `INTERNAL_ERROR` instead of degrading to a default view, so a
 *   corrupt job is a loud server error rather than a quiet lie to the member.
 * - Redaction happens before clamping, so a replacement can never push kept text past its bound.
 *   A `null` identity set means redaction could not be built, and the text is dropped entirely.
 */

/** Job ids are opaque 64-hex tokens; a stored row that does not match is corrupt. */
export const MODEL_JOB_ID_PATTERN = /^[a-f0-9]{64}$/u;
/** Projection/revision cursors share the same opaque token shape. */
export const PROJECTION_CURSOR_PATTERN = /^[a-f0-9]{64}$/u;
/** The assistant prompt bound; stored history must never exceed what a request could carry. */
import { MAX_ASSISTANT_PROMPT_CHARS } from '../src/tabletop/shared/ai-prompt-limits.js';
export const MAX_TABLE_ASSISTANT_PROMPT_CHARS = MAX_ASSISTANT_PROMPT_CHARS;

export interface PublicModelJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  message?: string;
  candidateId?: string;
  /** A question with answer choices when the model asked instead of drafting (F012). */
  clarification?: { question: string; options: string[] };
  /** Who asked, when and what, so open visibility (F034) can show rule requests to the table. */
  askedBy?: string;
  createdAt?: number;
  prompt?: string;
  /** F038: the machine-readable failure, so a rule-draft card can quote it like an answer card. */
  failureCode?: string;
  /** F039: whether the draft went into use on its own, or needs a manual review (and why). */
  autoApply?: 'applied' | 'needs-review';
  autoApplyReasons?: string[];
  /** F045: live counters while the draft is still running. */
  progress?: ModelJobProgress;
  /** F045: the configured whole-job deadline this draft runs under. */
  limitMs?: number;
  /** F045: bounded, redacted evidence of how far a failed draft got. */
  failureDetails?: ModelFailureDetails;
  /** F064 slice B: what the draft searched and which sources it used (display only, no evidence). */
  research?: ModelJobResearch;
}

export function tableAssistantConfirmationMessage(status: unknown, failure: unknown): string | undefined {
  if (failure === 'IDEMPOTENCY_MISMATCH') {
    return 'This confirmation conflicted with an earlier command. No suggested action was applied. Ask for a fresh suggestion.';
  }
  if (failure === 'CONFIRMATION_INTERRUPTED') {
    return 'The confirmation expired before the action could be applied. Ask for a fresh suggestion.';
  }
  if (status === 'stale') return 'The table changed before this suggestion was confirmed. Ask again for an updated suggestion.';
  if (status === 'rejected') return 'The table rules rejected this action. The suggestion was not applied.';
  return undefined;
}

/** Every assistant job view names who asked, so open history (F034) can label other members' chats. */
export function tableAssistantJobView(job: RoomModelJob): TableAssistantJob {
  return { ...tableAssistantJobViewFor(job), askedBy: job.actorId };
}

export function tableAssistantJobViewFor(job: RoomModelJob): TableAssistantJob {
  const expectedRevision = typeof job.data.expectedRevision === 'string' ? job.data.expectedRevision : '';
  const prompt = typeof job.data.prompt === 'string' ? job.data.prompt : '';
  if (!MODEL_JOB_ID_PATTERN.test(job.id) || !PROJECTION_CURSOR_PATTERN.test(expectedRevision)
      || job.data.expectedEpoch !== job.epoch || prompt.length === 0
      || prompt.length > MAX_TABLE_ASSISTANT_PROMPT_CHARS) throw new AuthorityError('INTERNAL_ERROR');
  if (job.status === 'failed' || job.status === 'revoked') {
    const failureReasons = cleanReasons(job.data.reasons);
    return {
      id: job.id,
      createdAt: job.createdAt,
      prompt,
      status: 'failed',
      expectedRevision,
      expectedEpoch: job.epoch,
      message: tableAssistantFailureMessage(job.data.failure, failureReasons),
      failureCode: safeAssistantFailureCode(job.data.failure),
      ...(failureReasons.length ? { failureReasons } : {}),
      ...(typeof job.data.failedAt === 'number' && job.data.failedAt >= job.createdAt
        ? { durationMs: Math.min(3_600_000, Math.round(job.data.failedAt - job.createdAt)) }
        : {}),
    };
  }
  if (job.status === 'running') {
    const progress = job.data.progress;
    const live = isRecord(progress)
      && Number.isSafeInteger(progress.receivedChars) && (progress.receivedChars as number) >= 0 && (progress.receivedChars as number) <= 1_000_000
      && Number.isSafeInteger(progress.reasoningChars) && (progress.reasoningChars as number) >= 0 && (progress.reasoningChars as number) <= 1_000_000
      && Number.isSafeInteger(progress.updatedAt) && (progress.updatedAt as number) >= 0
      ? {
        receivedChars: progress.receivedChars as number,
        reasoningChars: progress.reasoningChars as number,
        updatedAt: progress.updatedAt as number,
      }
      : null;
    return {
      id: job.id,
      createdAt: job.createdAt,
      prompt,
      status: 'running',
      expectedRevision,
      expectedEpoch: job.epoch,
      ...(live ? { progress: live } : {}),
    };
  }
  const parsed = tableAssistantResultSchema.safeParse(job.data.result);
  if (!parsed.success) throw new AuthorityError('INTERNAL_ERROR');
  return {
    id: job.id,
    createdAt: job.createdAt,
    prompt,
    status: 'completed',
    expectedRevision,
    expectedEpoch: job.epoch,
    result: parsed.data,
    ...(typeof job.data.serverOmittedConversationEntries === 'number'
      ? { serverOmittedConversationEntries: job.data.serverOmittedConversationEntries } : {}),
    ...(typeof job.data.providerOmittedConversationEntries === 'number'
      ? { providerOmittedConversationEntries: job.data.providerOmittedConversationEntries } : {}),
    ...(parsed.data.kind === 'action-proposal'
      ? {
        confirmationStatus: job.data.confirmationStatus === 'confirmed' ? 'confirmed' as const
          : job.data.confirmationStatus === 'stale' ? 'stale' as const
            : job.data.confirmationStatus === 'rejected' ? 'rejected' as const
              : job.status === 'committing' ? 'processing' as const : 'available' as const,
        ...(tableAssistantConfirmationMessage(job.data.confirmationStatus, job.data.confirmationFailure)
          ? { message: tableAssistantConfirmationMessage(job.data.confirmationStatus, job.data.confirmationFailure) } : {}),
      }
      : {}),
  };
}

/** Adds who asked, when, and what, so open visibility (F015) can show rule requests to the table. */
export function modelJobView(job: RoomModelJob, limitMs: number): PublicModelJob {
  return {
    ...modelJobStatusView(job, limitMs),
    askedBy: job.actorId,
    createdAt: job.createdAt,
    ...(typeof job.data.prompt === 'string' ? { prompt: job.data.prompt } : {}),
  };
}

export function modelJobStatusView(job: RoomModelJob, limitMs: number): PublicModelJob {
  if (job.status === 'revoked') return { id: job.id, status: 'failed', message: 'This proposal was cancelled.' };
  if (job.status === 'failed') {
    const reasons = Array.isArray(job.data.reasons) ? job.data.reasons : [];
    const details = parseModelFailureDetails(job.data.failureDetails);
    return {
      id: job.id,
      status: 'failed',
      message: modelFailureMessage(job.data.failure, reasons, details),
      failureCode: safeAssistantFailureCode(job.data.failure),
      ...(details ? { failureDetails: details } : {}),
    };
  }
  if (job.status === 'running' || job.status === 'committing') {
    const progress = parseModelJobProgress(job.data.progress);
    // F045: the card needs the same limit the job runs under, not a client-side guess.
    return { id: job.id, status: 'running', limitMs, ...(progress ? { progress } : {}) };
  }
  const research = parseModelJobResearch(job.data.research);
  return {
    id: job.id,
    status: 'completed',
    ...(typeof job.data.candidateId === 'string' ? { candidateId: job.data.candidateId } : {}),
    ...(publicClarification(job.data.clarification) ?? {}),
    ...(job.data.autoApply === 'applied' || job.data.autoApply === 'needs-review' ? { autoApply: job.data.autoApply } : {}),
    ...(Array.isArray(job.data.autoApplyReasons) ? { autoApplyReasons: job.data.autoApplyReasons.filter((item): item is string => typeof item === 'string').slice(0, 6) } : {}),
    // F064 slice B: the editor may still be unknown; the card renders it only when present.
    ...(research ? { research } : {}),
  };
}

/**
 * F045: identity tokens are replaced before any member reads a partial draft.
 * `null` means the identity set could not be built, so the text is dropped instead of stored raw.
 */
export function draftIdentityReplacements(workspace: WorkspaceView): IdentityReplacement[] | null {
  if (workspace.domain.kind !== 'table') return [];
  try {
    return createIdentityReplacements(workspace);
  } catch {
    return null;
  }
}

/** F045: redact first, then clamp, so a replacement can never push kept text past its bound. */
export function boundedFailureDetails(details: ModelFailureDetails, replacements: IdentityReplacement[] | null): ModelFailureDetails {
  const base: ModelFailureDetails = {
    timedOutBy: details.timedOutBy,
    limitMs: details.limitMs,
    elapsedMs: details.elapsedMs,
    receivedChars: details.receivedChars,
    reasoningChars: details.reasoningChars,
  };
  if (replacements === null) return base;
  const partialContent = details.partialContent
    ? headWithin(redactString(details.partialContent, replacements), MAX_JOB_PARTIAL_CONTENT_CHARS) : '';
  const thinkingTail = details.thinkingTail
    ? tailWithin(redactString(details.thinkingTail, replacements), MAX_JOB_THINKING_TAIL_CHARS) : '';
  return {
    ...base,
    ...(partialContent ? { partialContent } : {}),
    ...(thinkingTail ? { thinkingTail } : {}),
  };
}

/**
 * F064: one research event, redacted then clamped so a stored search line never exceeds its budget.
 * `null` replacements mean the identity set could not be built, so the event is dropped unseen.
 */
export function boundedSearchProgress(
  search: ModelJobSearchProgress | undefined,
  replacements: IdentityReplacement[] | null,
): ModelJobSearchProgress | undefined {
  if (!search || replacements === null) return undefined;
  const query = headWithin(redactString(search.query, replacements), MAX_JOB_SEARCH_QUERY_CHARS).trim();
  if (!query) return undefined;
  const topTitle = search.topTitle
    ? headWithin(redactString(search.topTitle, replacements), MAX_JOB_SEARCH_TITLE_CHARS).trim() : '';
  const resultsCount = Number.isSafeInteger(search.resultsCount) && search.resultsCount >= 0
    ? Math.min(search.resultsCount, MAX_JOB_SEARCH_RESULTS) : 0;
  return {
    phase: search.phase,
    query,
    resultsCount,
    ...(topTitle ? { topTitle } : {}),
  };
}

/**
 * F064 slice B: the sources a finished card may list, redacted then clamped like the live search
 * line. A URL that is not plain http(s) after redaction is dropped; `null` replacements drop it all.
 */
export function boundedResearch(
  research: ModelJobResearch | undefined,
  replacements: IdentityReplacement[] | null,
): ModelJobResearch | undefined {
  if (!research || replacements === null) return undefined;
  const sources: ModelJobResearch['sources'] = [];
  for (const source of research.sources) {
    if (sources.length >= MAX_JOB_RESEARCH_SOURCES) break;
    const url = safeExternalUrl(redactString(source.url, replacements));
    if (!url) continue;
    const title = headWithin(redactString(source.title, replacements), MAX_JOB_RESEARCH_TITLE_CHARS).trim();
    const date = typeof source.date === 'string' ? headWithin(source.date, MAX_JOB_RESEARCH_DATE_CHARS) : '';
    const authority = Number.isSafeInteger(source.authority)
      ? Math.min(Math.max(source.authority, 0), MAX_SOURCE_AUTHORITY) : 0;
    // F064 C: the summary becomes the citable text of a web source, so it travels redacted too.
    const summary = source.summary
      ? headWithin(redactString(source.summary, replacements), MAX_JOB_RESEARCH_SUMMARY_CHARS).trim() : '';
    sources.push({
      title: title || externalHost(url), url, date: date || null, authority,
      ...(summary ? { summary } : {}),
    });
  }
  if (sources.length === 0) return undefined;
  const queries = research.queries
    .slice(0, MAX_JOB_RESEARCH_QUERIES)
    .map((query) => headWithin(redactString(query, replacements), MAX_JOB_SEARCH_QUERY_CHARS).trim())
    .filter((query) => query.length > 0);
  return { queries, sources };
}

export function publicClarification(value: unknown): { clarification: { question: string; options: string[] } } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question, options } = value as { question?: unknown; options?: unknown };
  if (typeof question !== 'string' || !Array.isArray(options) || !options.every((item) => typeof item === 'string')) return null;
  return { clarification: { question, options: options as string[] } };
}
