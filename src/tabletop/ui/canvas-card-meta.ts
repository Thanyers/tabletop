import { useSyncExternalStore } from 'react';
import type { CanvasCardMeta } from '../shared/table-contracts';

// F052: how a canvas card says when it was created, when it last changed, and who did it.
// This module is presentation only: it formats already-resolved meta and never invents a time.
// Relative lines share one minute clock, so a table of cards re-renders the meta lines only.

/** After a week a relative label is worse than the date: "12 Oct" beats "37d ago". */
export const RELATIVE_LIMIT_MS = 7 * 24 * 60 * 60 * 1000;
/** Every meta line follows this one clock; nothing polls per card. */
export const CARD_CLOCK_INTERVAL_MS = 60_000;
const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const UNRECORDED = 'not recorded';

const shortDate = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
const absoluteDate = new Intl.DateTimeFormat(undefined, {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
});

/** `12 Oct` in the reader's locale; deliberately without a year, which the tooltip carries. */
export function formatShortDate(at: number): string {
  return shortDate.format(at);
}

/**
 * `just now` / `5m ago` / `2h ago` / `3d ago`, then the short date. A timestamp from the future
 * (clock skew between server and browser) reads as `just now` instead of a negative age.
 */
export function formatRelative(at: number, now: number): string {
  const elapsed = now - at;
  if (elapsed < MINUTE_MS) return 'just now';
  if (elapsed < HOUR_MS) return `${Math.floor(elapsed / MINUTE_MS)}m ago`;
  if (elapsed < DAY_MS) return `${Math.floor(elapsed / HOUR_MS)}h ago`;
  if (elapsed < RELATIVE_LIMIT_MS) return `${Math.floor(elapsed / DAY_MS)}d ago`;
  return formatShortDate(at);
}

export interface CardMetaOptions {
  now: number;
  /** The person to name: whoever last touched the card (creator when it was never updated). */
  actorName?: string;
  /** The named person is the viewer, so the tooltip can say "(you)". */
  self?: boolean;
}

/** True once someone changed the card after creating it. */
function wasUpdated(meta: CanvasCardMeta): boolean {
  return meta.updatedAt > meta.createdAt;
}

/** Inferred times come from retained revisions, not a recorded stamp, so they carry `~`. */
function mark(meta: CanvasCardMeta): string {
  return meta.source === 'inferred' ? '~' : '';
}

/** `AI`, the person's name, or the fallback token. Only the fallback is uppercased. */
function originToken(meta: CanvasCardMeta, actorName: string | undefined): string {
  if (meta.origin === 'ai') return 'AI';
  if (meta.origin === 'system') return 'SYSTEM';
  if (meta.origin === 'demo') return 'DEMO';
  return actorName ?? 'MEMBER';
}

/**
 * One muted line: `AI · Mali · 12 Oct → 2h ago`, `MEMBER · created 12 Oct`,
 * `SYSTEM · since 12 Oct`, `not recorded` when nothing is known.
 */
export function cardMetaLabel(meta: CanvasCardMeta | undefined, options: CardMetaOptions): string {
  if (!meta) return UNRECORDED;
  const token = originToken(meta, options.actorName);
  const created = `${mark(meta)}${formatShortDate(meta.createdAt)}`;
  if (!wasUpdated(meta)) {
    return meta.origin === 'system' ? `${token} · since ${created}` : `${token} · created ${created}`;
  }
  // A human card's token already is the person's name, so the name is not repeated after it.
  const editedBy = meta.origin !== 'human' && options.actorName ? `${options.actorName} · ` : '';
  return `${token} · ${editedBy}${created} → ${mark(meta)}${formatRelative(meta.updatedAt, options.now)}`;
}

/** The full, absolute story for the tooltip and accessible description. */
export function cardMetaDescription(meta: CanvasCardMeta | undefined, options: CardMetaOptions): string {
  if (!meta) return 'Card time not recorded';
  const name = options.actorName ? ` by ${options.actorName}${options.self ? ' (you)' : ''}` : '';
  const created = `Created ${absoluteDate.format(meta.createdAt)}${name}`;
  if (!wasUpdated(meta)) {
    return `${meta.source === 'inferred' ? 'Estimated time · ' : ''}${created} · not changed since`;
  }
  const updated = `Updated ${absoluteDate.format(meta.updatedAt)}${name}`;
  const revision = meta.revision === undefined ? '' : ` · revision ${meta.revision}`;
  return `${meta.source === 'inferred' ? 'Estimated time · ' : ''}${created} · ${updated}${revision}`;
}

// One clock for every visible meta line. `now` is cached, so `getSnapshot` stays stable between ticks.
let currentNow = Date.now();
const clockListeners = new Set<() => void>();
let clockTimer: number | undefined;

function tickClock(): void {
  const next = Date.now();
  if (next === currentNow) return;
  currentNow = next;
  for (const listener of clockListeners) listener();
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    tickClock();
    clockTimer = window.setInterval(tickClock, CARD_CLOCK_INTERVAL_MS);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size > 0) return;
    if (clockTimer !== undefined) window.clearInterval(clockTimer);
    clockTimer = undefined;
  };
}

/** The shared minute clock. Only components that render a relative time call this. */
export function useCardNow(): number {
  return useSyncExternalStore(subscribeClock, () => currentNow, () => currentNow);
}

export type CardSortMode = 'created-desc' | 'created-asc' | 'updated-desc' | 'canvas';
export const DEFAULT_CARD_SORT: CardSortMode = 'created-desc';

export interface CardSortOption {
  mode: CardSortMode;
  label: string;
  /** Live-region text after the choice, so a sort is announced and not just a silent reorder. */
  announcement: string;
}

/** Panel order and copy; `Created · newest` is the default because it answers "what is new here". */
export const CARD_SORT_OPTIONS: readonly CardSortOption[] = [
  { mode: 'created-desc', label: 'Created · newest', announcement: 'Sorted by created, newest first' },
  { mode: 'updated-desc', label: 'Updated · newest', announcement: 'Sorted by updated, newest first' },
  { mode: 'canvas', label: 'Canvas order', announcement: 'Sorted in canvas order' },
  { mode: 'created-asc', label: 'Created · oldest', announcement: 'Sorted by created, oldest first' },
];

export function isCardSortMode(value: unknown): value is CardSortMode {
  return CARD_SORT_OPTIONS.some((option) => option.mode === value);
}

/** A stored value from another build, or a hand-edited one, falls back to the default. */
export function parseCardSortMode(value: string | null | undefined): CardSortMode {
  return isCardSortMode(value) ? value : DEFAULT_CARD_SORT;
}

interface SortableCardRow {
  id: string;
  meta?: { createdAt: number; updatedAt: number };
}

/**
 * Stable order: timestamp first, then the row's original position, then id (deterministic for any
 * input order). Rows with no recorded time sort after recorded ones, so "not recorded" never
 * claims to be the oldest or newest card. `canvas` keeps the order the cards were built in.
 */
export function sortCardRows<T extends SortableCardRow>(rows: readonly T[], mode: CardSortMode): T[] {
  if (mode === 'canvas') return [...rows];
  const timestamp = (row: T): number | undefined => {
    if (!row.meta) return undefined;
    return mode === 'updated-desc' ? row.meta.updatedAt : row.meta.createdAt;
  };
  const direction = mode === 'created-asc' ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftAt = timestamp(left.row);
      const rightAt = timestamp(right.row);
      if (leftAt !== rightAt) {
        if (leftAt === undefined) return 1;
        if (rightAt === undefined) return -1;
        return (leftAt - rightAt) * direction;
      }
      if (left.index !== right.index) return left.index - right.index;
      return left.row.id < right.row.id ? -1 : left.row.id > right.row.id ? 1 : 0;
    })
    .map((entry) => entry.row);
}
