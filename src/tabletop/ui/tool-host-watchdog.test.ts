import { describe, expect, it, vi } from 'vitest';
import { createToolHostWatchdog } from './tool-host-watchdog';

/**
 * F080 / D-041: a frame that never answers must become a message, not a blank box.
 */

function harness(timeoutMs = 3000) {
  const timers: { callback: () => void; ms: number }[] = [];
  const cleared: unknown[] = [];
  const onTimeout = vi.fn();
  const watchdog = createToolHostWatchdog({
    timeoutMs,
    onTimeout,
    setTimer: (callback, ms) => {
      timers.push({ callback, ms });
      return timers.length - 1;
    },
    clearTimer: handle => { cleared.push(handle); },
  });
  return { watchdog, timers, cleared, onTimeout };
}

function fire(timers: { callback: () => void }[], index = 0) {
  timers[index]!.callback();
}

describe('the tool host watchdog', () => {
  it('reports a frame that never answers', () => {
    const { watchdog, timers, onTimeout } = harness();
    watchdog.started();
    expect(timers).toHaveLength(1);
    expect(timers[0]!.ms).toBe(3000);
    fire(timers);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(watchdog.timedOut).toBe(true);
  });

  it('stays quiet once the frame says anything', () => {
    const { watchdog, timers, onTimeout } = harness();
    watchdog.started();
    watchdog.heard();
    fire(timers);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(watchdog.timedOut).toBe(false);
  });

  it('ignores a late timeout after the frame answered, and never re-arms', () => {
    const { watchdog, timers, onTimeout } = harness();
    watchdog.started();
    watchdog.heard();
    watchdog.started();
    expect(timers).toHaveLength(1);
    fire(timers);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('does nothing before the frame reports load', () => {
    const { watchdog, timers } = harness();
    expect(timers).toHaveLength(0);
    watchdog.heard();
    expect(timers).toHaveLength(0);
  });

  it('clears its timer when disposed', () => {
    const { watchdog, timers, cleared, onTimeout } = harness();
    watchdog.started();
    watchdog.dispose();
    expect(cleared).toEqual([0]);
    fire(timers);
    expect(onTimeout).not.toHaveBeenCalled();
  });
});
