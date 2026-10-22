// F045: one configured deadline for the rule-draft path.
// The provider timeout, the job's own limit, job recovery and the client poll all derive from it,
// so a card never shows one number while the server stops at another.
import type { Env } from './contracts.js';

/** Default stop for a whole rule-draft job (all repair attempts together). */
export const DEFAULT_AI_TABLE_DEADLINE_MS = 240_000;
/** The hard ceiling: a longer job risks the wall-clock limits of the platform. */
export const MAX_AI_TABLE_DEADLINE_MS = 300_000;
/** Below this a single table attempt cannot finish, so it is treated as unset. */
export const MIN_AI_TABLE_DEADLINE_MS = 60_000;
/** A job is declared interrupted only after its deadline plus this grace. */
export const MODEL_JOB_RECOVERY_GRACE_MS = 120_000;
/** The client keeps polling this long past the deadline so it always receives the final status. */
export const DRAFT_POLL_GRACE_MS = 70_000;

/**
 * Read `AI_TABLE_DEADLINE_MS`. Unset, malformed or out-of-range values fall back to the default
 * or the ceiling, so a bad config can never shorten or lengthen the path silently.
 */
export function aiTableDeadlineMs(env: Pick<Env, 'AI_TABLE_DEADLINE_MS'>): number {
  const raw = env.AI_TABLE_DEADLINE_MS;
  if (typeof raw !== 'string' || !/^\d{1,7}$/u.test(raw.trim())) return DEFAULT_AI_TABLE_DEADLINE_MS;
  const value = Number(raw.trim());
  if (!Number.isSafeInteger(value) || value < MIN_AI_TABLE_DEADLINE_MS) return DEFAULT_AI_TABLE_DEADLINE_MS;
  return Math.min(value, MAX_AI_TABLE_DEADLINE_MS);
}

/** When a running job of this deadline is treated as interrupted. */
export function modelJobRecoveryMs(deadlineMs: number): number {
  return deadlineMs + MODEL_JOB_RECOVERY_GRACE_MS;
}

/** How long a client should keep polling for a draft before offering "Check status". */
export function draftPollLimitMs(deadlineMs: number): number {
  return deadlineMs + DRAFT_POLL_GRACE_MS;
}
