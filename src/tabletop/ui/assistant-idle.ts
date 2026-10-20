// When the table assistant collapses into its round button. Viewers (and test
// fixtures) can turn auto-collapse off or shorten it through local storage.

export const ASSISTANT_IDLE_MS = 20_000;
export const ASSISTANT_IDLE_STORAGE_KEY = 'tabletop.assistant.idleMs';

/** Returns null when auto-collapse is turned off. */
export function assistantIdleMs(stored: string | null): number | null {
  if (stored === null || stored.trim() === '') return ASSISTANT_IDLE_MS;
  if (stored.trim().toLowerCase() === 'off') return null;
  const value = Number(stored);
  return Number.isInteger(value) && value >= 1_000 && value <= 600_000 ? value : ASSISTANT_IDLE_MS;
}

export function readAssistantIdleMs(): number | null {
  try { return assistantIdleMs(window.localStorage.getItem(ASSISTANT_IDLE_STORAGE_KEY)); }
  catch { return ASSISTANT_IDLE_MS; }
}

/** The island stays open while someone is in it, has unsent text, or waits on a request. */
export function assistantIsInUse(panel: HTMLElement, active: Element | null): boolean {
  if (active && panel.contains(active)) return true;
  if (panel.querySelector('[aria-busy="true"], .tt-spin')) return true;
  return [...panel.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>('textarea, input[type="text"], input:not([type])')]
    .some((field) => field.value.trim() !== '');
}
