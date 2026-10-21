// Model-job failure codes and the messages a requester sees (F016).
// Validation failures keep up to three short, sanitized reasons so the owner can see
// what the AI's draft got wrong instead of one generic sentence. A job is only visible
// to the actor who asked for it, and the reasons describe that actor's own table.
import { AuthorityError } from '../server/errors.js';
import { DomainError } from '../src/tabletop/shared/contracts.js';

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

export function modelFailureMessage(failure: unknown, reasons: readonly string[] = []): string {
  if (failure === 'SOURCE_REQUIRED') return 'Import a source file before asking for a proposal.';
  if (failure === 'TABLE_READ_ONLY') return 'This table workspace is currently read-only. The proposal was not applied.';
  if (failure === 'MODEL_PROVIDER_INPUT_TOO_LARGE') return 'The files and request are too large. Shorten them or remove a file, then try again.';
  if (failure === 'MODEL_PROVIDER_OUTPUT_REJECTED' || (typeof failure === 'string' && failure.startsWith('TABLE_'))) {
    const shown = cleanReasons(reasons);
    if (!shown.length) return 'The proposed table rules did not pass validation. Review the sources or revise the request, then try again.';
    return `The proposed table rules did not pass validation: ${shown.join(' · ')} Revise the request and try again.`;
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
        || code === 'MODEL_PROVIDER_OUTPUT_REJECTED' || code === 'MODEL_PROVIDER_TIMEOUT'
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
