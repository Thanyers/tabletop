/**
 * F078-T16: the draft/answer polling loop, extracted from `useTableChat`'s
 * effect. The loop is the racy part of the chat — it waits an interval, polls
 * once, keeps going through errors, stops when the caller goes inactive, and
 * reports a timeout only if it is still active when the limit passes. With the
 * clock and the wait injected, those rules are testable without a mounted chat.
 *
 * Behavior is the previous loop's, unchanged: the limit is checked before each
 * wait, an inactive caller stops without a timeout patch, and an error keeps the
 * loop running.
 */

export interface JobPollLoopOptions {
  intervalMs: number;
  limitMs: number;
  now(): number;
  wait(ms: number): Promise<void>;
  /** One poll. Resolves `true` when the job needs no more polling. */
  attempt(): Promise<boolean>;
  /** False once the caller cancelled or the viewed table changed. */
  isActive(): boolean;
  onError(error: unknown): void;
  onTimeout(): void;
}

export type JobPollOutcome = 'settled' | 'timed-out' | 'stopped';

export async function runJobPollLoop(options: JobPollLoopOptions): Promise<JobPollOutcome> {
  const startedAt = options.now();
  while (options.isActive() && options.now() - startedAt < options.limitMs) {
    await options.wait(options.intervalMs);
    if (!options.isActive()) return 'stopped';
    try {
      if (await options.attempt()) return 'settled';
    } catch (error) {
      if (!options.isActive()) return 'stopped';
      options.onError(error);
    }
  }
  if (!options.isActive()) return 'stopped';
  options.onTimeout();
  return 'timed-out';
}
