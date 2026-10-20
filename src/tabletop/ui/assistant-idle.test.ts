import { describe, expect, it } from 'vitest';
import { ASSISTANT_IDLE_MS, assistantIdleMs } from './assistant-idle';

describe('assistant idle setting', () => {
  it('defaults to twenty seconds and accepts a bounded override or off', () => {
    expect(ASSISTANT_IDLE_MS).toBe(20_000);
    expect(assistantIdleMs(null)).toBe(20_000);
    expect(assistantIdleMs('')).toBe(20_000);
    expect(assistantIdleMs('off')).toBeNull();
    expect(assistantIdleMs(' OFF ')).toBeNull();
    expect(assistantIdleMs('1500')).toBe(1500);
    for (const bad of ['0', '999', '600001', '2.5', 'soon', '-5']) expect(assistantIdleMs(bad)).toBe(20_000);
  });
});
