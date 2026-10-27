/**
 * F080 / D-041: notice a tool frame that never starts.
 *
 * The room page's Content-Security-Policy can block the sandbox document (an `about:srcdoc` frame
 * inherits it), and a blocked frame looks exactly like a slow one: an empty box with no error. This
 * watchdog turns "nothing happened" into a message, and it is a pure object so the timing rule can be
 * tested without a browser.
 */

export interface ToolHostWatchdog {
  /** A message from the frame proves the frame started; the watchdog then never fires. */
  heard(): void;
  /** Call once the frame reports `load`. */
  started(): void;
  /** Stop the timer (unmount). */
  dispose(): void;
  /** True when the frame never said anything within the window. */
  readonly timedOut: boolean;
}

export function createToolHostWatchdog(options: {
  timeoutMs: number;
  onTimeout: (message: string) => void;
  setTimer?: (callback: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}): ToolHostWatchdog {
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let handle: unknown;
  let answered = false;
  let timedOut = false;
  let disposed = false;

  return {
    get timedOut() {
      return timedOut;
    },
    heard() {
      answered = true;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
    },
    started() {
      if (handle !== undefined || answered || disposed) return;
      handle = setTimer(() => {
        handle = undefined;
        if (answered || disposed) return;
        timedOut = true;
        options.onTimeout('The tool frame did not answer. The page security policy may be blocking it, so the tool cannot start here.');
      }, options.timeoutMs);
    },
    dispose() {
      disposed = true;
      if (handle !== undefined) {
        clearTimer(handle);
        handle = undefined;
      }
    },
  };
}
