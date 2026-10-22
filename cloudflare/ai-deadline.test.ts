import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AI_TABLE_DEADLINE_MS,
  MAX_AI_TABLE_DEADLINE_MS,
  aiTableDeadlineMs,
  draftPollLimitMs,
  modelJobRecoveryMs,
} from './ai-deadline.js';

function env(value?: string) {
  return value === undefined ? {} : { AI_TABLE_DEADLINE_MS: value };
}

describe('F045 rule-draft deadline config', () => {
  it('defaults to 240s when the variable is unset or unusable', () => {
    expect(aiTableDeadlineMs(env())).toBe(240_000);
    expect(aiTableDeadlineMs(env())).toBe(DEFAULT_AI_TABLE_DEADLINE_MS);
    for (const bad of ['', '  ', 'abc', '180000ms', '-1000', '1e5', '4000000000']) {
      expect(aiTableDeadlineMs(env(bad))).toBe(DEFAULT_AI_TABLE_DEADLINE_MS);
    }
  });

  it('honours a configured value inside the supported range and clamps at 300s', () => {
    expect(aiTableDeadlineMs(env('120000'))).toBe(120_000);
    expect(aiTableDeadlineMs(env(' 240000 '))).toBe(240_000);
    expect(aiTableDeadlineMs(env('300000'))).toBe(300_000);
    expect(aiTableDeadlineMs(env('300001'))).toBe(MAX_AI_TABLE_DEADLINE_MS);
    expect(aiTableDeadlineMs(env('9999999'))).toBe(MAX_AI_TABLE_DEADLINE_MS);
    // A value too short for one table attempt is treated as unset rather than silently shortening it.
    expect(aiTableDeadlineMs(env('59000'))).toBe(DEFAULT_AI_TABLE_DEADLINE_MS);
  });

  it('keeps job recovery and the client poll aligned with the same deadline', () => {
    expect(modelJobRecoveryMs(240_000)).toBe(360_000);
    expect(draftPollLimitMs(240_000)).toBe(310_000);
    expect(modelJobRecoveryMs(300_000)).toBe(420_000);
    expect(draftPollLimitMs(300_000)).toBe(370_000);
    // Recovery must stay after the deadline, and recovery must outlast the client poll.
    for (const deadline of [60_000, 180_000, 240_000, 300_000]) {
      expect(modelJobRecoveryMs(deadline)).toBeGreaterThan(deadline + 60_000);
      expect(modelJobRecoveryMs(deadline)).toBeGreaterThan(draftPollLimitMs(deadline));
    }
  });
});
