// Which Canvas cards share one position for everyone at a table (F007).
// Private cards (an owner's source files, a person's chat answers) stay per browser.

export const SHARED_CANVAS_ID_PATTERN = /^table\.(collection|view)\.[a-z][a-z0-9_-]{0,39}$|^table\.(actions|rules)$|^workspace\.(people|history)$/;

/** Cards every member sees, so their position is part of the table. */
export const ALWAYS_SHARED_CANVAS_IDS = ['table.rules', 'workspace.people', 'workspace.history'] as const;

export function isSharedCanvasId(id: string): boolean {
  return SHARED_CANVAS_ID_PATTERN.test(id);
}
