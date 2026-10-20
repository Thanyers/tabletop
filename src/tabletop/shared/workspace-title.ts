import type { CaseKind } from './contracts';

// One rule for table names on every runtime and in the browser (F002).

export const WORKSPACE_TITLE_MAX_CHARS = 100;

export const DEFAULT_WORKSPACE_TITLES: Readonly<Record<CaseKind, string>> = {
  invoice: 'Invoice Review',
  teaching: 'Physics Lesson',
  encounter: 'Encounter Table',
  table: 'Shared Table',
};

export function defaultWorkspaceTitle(kind: CaseKind): string {
  return DEFAULT_WORKSPACE_TITLES[kind];
}

/** Trimmed title, or null when it is empty, too long or contains control characters. */
export function normalizeWorkspaceTitle(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const title = raw.trim();
  if (title === '' || /\p{Cc}/u.test(title)) return null;
  return Array.from(title).length <= WORKSPACE_TITLE_MAX_CHARS ? title : null;
}

/**
 * A name the owner chose wins. Until then a shared table shows the title of its
 * active rules, and every other table shows its default name.
 */
export function displayWorkspaceTitle(kind: CaseKind, title: string, programTitle?: string | null): string {
  const fromProgram = kind === 'table' ? programTitle?.trim() : undefined;
  return fromProgram && title === defaultWorkspaceTitle(kind) ? fromProgram : title;
}
