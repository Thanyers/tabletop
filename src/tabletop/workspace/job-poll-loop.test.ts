import { describe, expect, it, vi } from 'vitest';
import { runJobPollLoop } from './job-poll-loop';

/**
 * F078-T16: the draft/answer polling loop lived inside a `useEffect` in
 * `useTableChat`, so its timeout, error-continue and cancellation rules could
 * only be exercised through a mounted chat. The loop is a module now, with the
 * clock and the wait injected.
 */

function clock(start = 1_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => { now += ms; },
  };
}

describe('job poll loop', () => {
  it('stops after the first settled attempt', async () => {
    const time = clock();
    const attempts = vi.fn(async () => true);
    const onTimeout = vi.fn();
    const waited: number[] = [];

    const result = await runJobPollLoop({
      intervalMs: 1_200, limitMs: 10_000, now: time.now,
      wait: async (ms) => { waited.push(ms); time.advance(ms); },
      attempt: attempts, isActive: () => true, onError: vi.fn(), onTimeout,
    });

    expect(result).toBe('settled');
    expect(attempts).toHaveBeenCalledTimes(1);
    expect(waited).toEqual([1_200]);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('keeps polling while the job is unsettled', async () => {
    const time = clock();
    let calls = 0;
    const result = await runJobPollLoop({
      intervalMs: 1_000, limitMs: 60_000, now: time.now,
      wait: async (ms) => { time.advance(ms); },
      attempt: async () => { calls += 1; return calls === 3; },
      isActive: () => true, onError: vi.fn(), onTimeout: vi.fn(),
    });

    expect(result).toBe('settled');
    expect(calls).toBe(3);
  });

  it('times out at the limit and reports it once', async () => {
    const time = clock();
    const onTimeout = vi.fn();
    const result = await runJobPollLoop({
      intervalMs: 1_000, limitMs: 3_500, now: time.now,
      wait: async (ms) => { time.advance(ms); },
      attempt: async () => false,
      isActive: () => true, onError: vi.fn(), onTimeout,
    });

    expect(result).toBe('timed-out');
    expect(onTimeout).toHaveBeenCalledTimes(1);
  });

  it('keeps polling after a failed attempt and reports the error', async () => {
    const time = clock();
    const onError = vi.fn();
    let calls = 0;
    const result = await runJobPollLoop({
      intervalMs: 1_000, limitMs: 60_000, now: time.now,
      wait: async (ms) => { time.advance(ms); },
      attempt: async () => {
        calls += 1;
        if (calls === 1) throw new Error('network lost');
        return true;
      },
      isActive: () => true, onError, onTimeout: vi.fn(),
    });

    expect(result).toBe('settled');
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]?.[0] as Error).message).toBe('network lost');
  });

  it('stops when the caller becomes inactive and does not report a timeout', async () => {
    const time = clock();
    const onTimeout = vi.fn();
    const onError = vi.fn();
    const attempts = vi.fn(async () => false);
    const result = await runJobPollLoop({
      intervalMs: 1_000, limitMs: 60_000, now: time.now,
      wait: async (ms) => { time.advance(ms); },
      attempt: attempts,
      isActive: () => time.now() < 2_500, onError, onTimeout,
    });

    expect(result).toBe('stopped');
    expect(attempts.mock.calls.length).toBeLessThanOrEqual(2);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not attempt again when it becomes inactive during a wait', async () => {
    const time = clock();
    let active = true;
    const attempts = vi.fn(async () => false);
    const result = await runJobPollLoop({
      intervalMs: 1_000, limitMs: 60_000, now: time.now,
      wait: async (ms) => { active = false; time.advance(ms); },
      attempt: attempts, isActive: () => active, onError: vi.fn(), onTimeout: vi.fn(),
    });

    expect(result).toBe('stopped');
    expect(attempts).not.toHaveBeenCalled();
  });
});
