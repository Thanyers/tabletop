// Model-job failure codes and the messages a requester sees (F016).
// Validation failures keep up to three short, sanitized reasons so the owner can see
// what the AI's draft got wrong instead of one generic sentence. A job is only visible
// to the actor who asked for it, and the reasons describe that actor's own table.
import { AuthorityError } from '../server/errors.js';
import { DomainError } from '../src/tabletop/shared/contracts.js';
import type { ModelFailureDetails } from '../src/tabletop/shared/model-job-progress.js';

export const MAX_FAILURE_REASONS = 3;
export const MAX_FAILURE_REASON_CHARS = 240;

/** A DomainError that also carries the validation issues behind it. */
export class ReasonedDomainError extends DomainError {
  constructor(code: string, message: string, readonly reasons: readonly string[]) { super(code, message); }
}

// Repair instructions written for the AI (server/providers/deepseek-changes.ts) read as orders
// to a person; show what went wrong instead.
const AI_FACING_REASONS: Readonly<Record<string, string>> = {
  'Return a complete JSON object, without Markdown.': 'The AI did not return a complete draft.',
  'Reduce expression nesting and program size to the documented limits.': 'The draft was too large or too deeply nested.',
};

function cleanReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const reason = AI_FACING_REASONS[value.trim()] ?? value;
  // Drop control characters and collapse whitespace; keep the text short and on one line.
  const text = reason.replace(/[\u0000-\u001f\u007f]+/gu, ' ').replace(/\s+/gu, ' ').trim();
  if (!text) return null;
  const short = text.length > MAX_FAILURE_REASON_CHARS ? `${text.slice(0, MAX_FAILURE_REASON_CHARS - 1)}…` : text;
  // End every reason as a sentence so the joined message reads cleanly.
  return /[.!?…]$/u.test(short) ? short : `${short}.`;
}

export function cleanReasons(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const reason = cleanReason(value);
    if (reason && !seen.has(reason)) { seen.add(reason); out.push(reason); }
    if (out.length === MAX_FAILURE_REASONS) break;
  }
  return out;
}

/** F027: validation reasons that point at an unsupported cross-record/cross-collection lookup. */
const STRUCTURAL_REASON = /unknown record field|unknown field|cross-collection|join|lookup/iu;
export const STRUCTURAL_HINT = 'This table cannot join rows across collections yet; keep the data in one collection or attach a CSV file.';

function limitSeconds(limitMs: number): string {
  return `${Math.max(1, Math.round(limitMs / 1000))}s`;
}

/**
 * F045: a rule draft that stopped early says whether our own deadline or the provider ended it,
 * and how far the reply got, so the card can show the partial text instead of a bare timeout.
 */
function draftStopMessage(failure: unknown, details: ModelFailureDetails): string | null {
  if (failure === 'MODEL_PROVIDER_TIMEOUT' && details.timedOutBy === 'server') {
    const received = details.receivedChars > 0
      ? ` It had received ${details.receivedChars.toLocaleString('en-US')} characters of the draft.`
      : ' It had not returned any draft text yet.';
    return `Stopped at our ${limitSeconds(details.limitMs)} limit for one rule draft.${received}`;
  }
  if (failure === 'MODEL_PROVIDER_REQUEST_FAILED' && details.timedOutBy === 'provider') {
    const received = details.receivedChars > 0
      ? ` after ${details.receivedChars.toLocaleString('en-US')} characters`
      : ' before any text arrived';
    return `The provider closed the connection${received}. That is the provider, not our ${limitSeconds(details.limitMs)} limit.`;
  }
  return null;
}

export function modelFailureMessage(failure: unknown, reasons: readonly string[] = [], details?: ModelFailureDetails | null): string {
  if (details) {
    const stopped = draftStopMessage(failure, details);
    // Only point at a block that exists: a stopped draft may have produced no answer text at all.
    if (stopped) return details.partialContent ? `${stopped} The partial text is kept below.` : stopped;
  }
  if (failure === 'SOURCE_REQUIRED') return 'Import a source file before asking for a proposal.';
  if (failure === 'TABLE_READ_ONLY') return 'This table workspace is currently read-only. The proposal was not applied.';
  if (failure === 'MODEL_PROVIDER_INPUT_TOO_LARGE') return 'The files and request are too large. Shorten them or remove a file, then try again.';
  if (failure === 'MODEL_PROVIDER_OUTPUT_REJECTED' || (typeof failure === 'string' && failure.startsWith('TABLE_'))) {
    const shown = cleanReasons(reasons);
    if (!shown.length) return 'The proposed table rules did not pass validation. Review the sources or revise the request, then try again.';
    const hint = STRUCTURAL_REASON.test(shown.join(' ')) ? ` ${STRUCTURAL_HINT}` : '';
    return `The proposed table rules did not pass validation: ${shown.join(' · ')}${hint} Revise the request and try again.`;
  }
  if (failure === 'MODEL_PROVIDER_TIMEOUT') return 'The proposal timed out. Try again.';
  if (failure === 'MODEL_NOT_CONFIGURED' || failure === 'MODEL_PROVIDER_NOT_CONFIGURED') {
    return 'AI proposals are not configured for this workspace.';
  }
  if (failure === 'BILLING_BUDGET') return 'The configured AI budget has been reached.';
  if (failure === 'BILLING_QUOTA') return 'The AI request limit has been reached. Try again later.';
  if (failure === 'AI_BILLING_UNCERTAIN' || failure === 'AI_BILLING_UNAVAILABLE') {
    return 'The billing service could not confirm this proposal. No draft was created.';
  }
  if (failure === 'STALE_WORKSPACE') return 'The workspace changed while the proposal was running. Review the latest state and try again.';
  if (failure === 'MODEL_JOB_INTERRUPTED' || failure === 'MODEL_PROPOSAL_FAILED') {
    return 'The proposal could not be completed. Review the files and request, then try again.';
  }
  return 'The proposal could not be completed.';
}

export function safeModelFailureCode(error: unknown): string {
  if (error instanceof AuthorityError && error.code === 'TABLE_READ_ONLY') return error.code;
  if (error instanceof DomainError) {
    const code = error.code;
    if (code === 'SOURCE_REQUIRED' || code === 'MODEL_PROVIDER_INPUT_TOO_LARGE'
        || code === 'TABLE_READ_ONLY'
        || code === 'MODEL_PROVIDER_OUTPUT_REJECTED' || code === 'MODEL_PROVIDER_OUTPUT_TRUNCATED' || code === 'MODEL_PROVIDER_TIMEOUT'
        || code === 'MODEL_PROVIDER_INPUT_INVALID' || code === 'MODEL_PROVIDER_RESPONSE_INVALID'
        || code === 'MODEL_PROVIDER_RESPONSE_TOO_LARGE' || code === 'MODEL_PROVIDER_HTTP_ERROR'
        || code === 'MODEL_PROVIDER_REQUEST_FAILED' || code === 'MODEL_PROVIDER_ABORTED'
        || code === 'MODEL_PROVIDER_NOT_CONFIGURED' || code === 'MODEL_NOT_CONFIGURED'
        || code === 'BILLING_BUDGET' || code === 'BILLING_QUOTA'
        || code === 'AI_BILLING_UNCERTAIN' || code === 'AI_BILLING_UNAVAILABLE') return code;
    if (code.startsWith('TABLE_')) return 'MODEL_PROVIDER_OUTPUT_REJECTED';
  }
  return 'MODEL_PROPOSAL_FAILED';
}


/** Reasons worth showing for a validation failure; empty for every other failure. */
export function safeModelFailureReasons(error: unknown): string[] {
  if (safeModelFailureCode(error) !== 'MODEL_PROVIDER_OUTPUT_REJECTED') return [];
  if (error instanceof ReasonedDomainError) return cleanReasons(error.reasons);
  // A TABLE_* rule violation raised while applying the draft is its own reason.
  if (error instanceof DomainError && error.code.startsWith('TABLE_')) return cleanReasons([error.message]);
  return [];
}

/** A failure code safe to show and to assert on; anything unexpected becomes UNKNOWN. */
export function safeAssistantFailureCode(failure: unknown): string {
  return typeof failure === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/u.test(failure) ? failure : 'UNKNOWN';
}

/**
 * The table assistant always says which failure it hit and keeps the code visible, so a screenshot
 * is enough to tell a user mistake from a provider, billing or interruption fault.
 */
export function tableAssistantFailureMessage(failure: unknown, reasons: readonly string[] = []): string {
  const code = safeAssistantFailureCode(failure);
  const said = (message: string) => `${message} (code ${code})`;
  if (failure === 'STALE_WORKSPACE' || failure === 'STALE_REVISION') return said('The table changed while the assistant was working; nothing was applied. Ask again.');
  if (failure === 'TABLE_READ_ONLY') return said('This table is read-only right now; nothing was applied.');
  if (failure === 'ACTION_REJECTED') return said('The suggested action is not valid for the current table state.');
  if (failure === 'IDEMPOTENCY_MISMATCH') return said('A repeated confirmation conflicted with the first one; no action was applied. Ask for a fresh suggestion.');
  if (failure === 'CONFIRMATION_INTERRUPTED') return said('The confirmation expired before the action could be applied. Ask for a fresh suggestion.');
  if (failure === 'ASSISTANT_INTERRUPTED') return said('The assistant stopped before it finished; nothing was changed. Ask again.');
  if (failure === 'ROOM_RESET') return said('The room was reloaded while the assistant was working; nothing was changed.');
  if (failure === 'MODEL_PROVIDER_TIMEOUT') return said('The AI took too long to answer and was stopped. Ask again.');
  if (failure === 'MODEL_PROVIDER_OUTPUT_TRUNCATED') return said('The AI ran out of output space before it finished. Ask again or split the request into smaller steps.');
  if (failure === 'MODEL_PROVIDER_INPUT_TOO_LARGE') return said('This request is too large for the AI. Remove a file or shorten the question.');
  if (failure === 'MODEL_PROVIDER_INPUT_INVALID') return said('The request sent to the AI was rejected as invalid.');
  if (failure === 'MODEL_PROVIDER_NOT_CONFIGURED' || failure === 'MODEL_NOT_CONFIGURED') return said('AI is not configured for this table.');
  if (failure === 'BILLING_BUDGET') return said('The configured AI budget has been reached.');
  if (failure === 'BILLING_QUOTA') return said('The AI request limit has been reached. Try again later.');
  if (failure === 'AI_BILLING_UNCERTAIN' || failure === 'AI_BILLING_UNAVAILABLE') return said('Billing could not confirm this request, so it was not completed.');
  if (failure === 'MODEL_PROVIDER_HTTP_ERROR') return said('The AI provider returned an error. Try again in a moment.');
  if (failure === 'MODEL_PROVIDER_RESPONSE_INVALID' || failure === 'MODEL_PROVIDER_RESPONSE_TOO_LARGE') return said('The AI returned a response this table cannot use.');
  if (failure === 'MODEL_PROVIDER_REQUEST_FAILED' || failure === 'MODEL_PROVIDER_ABORTED') return said('The connection to the AI failed before an answer arrived.');
  if (failure === 'MODEL_PROVIDER_OUTPUT_REJECTED'
      || (typeof failure === 'string' && (failure.startsWith('TABLE_') || failure.startsWith('MODEL_ASSISTANT_')))) {
    const shown = cleanReasons(reasons);
    return said(shown.length
      ? `The assistant's answer did not pass table validation: ${shown.join(' · ')}`
      : "The assistant's answer did not pass table validation.");
  }
  if (failure === 'MODEL_PROPOSAL_FAILED' || failure === 'MODEL_JOB_INTERRUPTED') return said('The assistant could not finish this request; nothing was changed.');
  return said('The assistant failed before it could answer; nothing was changed.');
}
