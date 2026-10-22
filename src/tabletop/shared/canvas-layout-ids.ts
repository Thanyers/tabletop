// Which Canvas cards share one position for everyone at a table (F007).
// Private cards (a person's chat answers, the owner's draft trial) stay per browser.

export const SHARED_CANVAS_ID_PATTERN = /^table\.(collection|view)\.[a-z][a-z0-9_-]{0,39}$|^table\.(actions|rules|sources)$|^workspace\.(people|history)$|^table\.note\.[a-z0-9_-]{6,40}$|^table\.chat\.[a-f0-9]{64}$/;

/** Under open visibility (F034) chat cards are shared too, keyed by their job id so every member places the same card. */
export const SHARED_CHAT_CANVAS_ID_PATTERN = /^table\.chat\.[a-f0-9]{64}$/;

/** The table keeps positions for at most this many chat cards; older ones fall back to the default layout. */
export const MAX_SHARED_CHAT_POSITIONS = 40;

export function sharedChatCanvasId(jobId: string): string | null {
  const id = `table.chat.${jobId}`;
  return SHARED_CHAT_CANVAS_ID_PATTERN.test(id) ? id : null;
}

export function isSharedChatCanvasId(id: string): boolean {
  return SHARED_CHAT_CANVAS_ID_PATTERN.test(id);
}

/** Rules remain private until a program is active; these cards are always shared. */
export const ALWAYS_SHARED_CANVAS_IDS = ['workspace.people', 'workspace.history'] as const;

export function isSharedCanvasId(id: string): boolean {
  return SHARED_CANVAS_ID_PATTERN.test(id);
}
