import { parseCardSortMode, type CardSortMode } from './canvas-card-meta';
import type { CanvasPoint } from './canvas-layout';

/**
 * F078-T14: the Canvas kept six browser-backed view preferences inline in a
 * 2,259-line component: starred cards, hidden cards, cards this browser already
 * saw, card sizes, the Objects sort order and the per-viewer layout. This module
 * owns the read/parse/write rules for all of them, so the component keeps only
 * React state and the storage format has one place to change.
 *
 * Behavior is preserved deliberately: the same `tabletop:r1:*` keys, the same
 * caps (200 starred/hidden/sized, 400 seen), the same clamped viewport, the same
 * "unreadable value falls back to the default", and writes stay best-effort —
 * a blocked or full storage must never break the canvas.
 */

export type CanvasStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface SavedCanvasLayout {
  positions: Record<string, CanvasPoint & { pinned?: boolean }>;
  viewport?: { centerX: number; centerY: number; zoom: number };
}

export type CardSizes = Readonly<Record<string, { width: number; height: number }>>;

const starredKey = (workspaceKey: string) => `tabletop:r1:canvas-starred:${workspaceKey}`;
const hiddenKey = (workspaceKey: string) => `tabletop:r1:canvas-hidden:${workspaceKey}`;
const seenKey = (workspaceKey: string) => `tabletop:r1:canvas-seen:${workspaceKey}`;
const sizeKey = (workspaceKey: string) => `tabletop:r1:canvas-size:${workspaceKey}`;
const sortKey = (workspaceKey: string) => `tabletop:r1:canvas-sort:${workspaceKey}`;
const layoutKey = (workspaceKey: string) => `tabletop:r1:canvas-layout:${workspaceKey}`;

const MAX_MARKED_CARDS = 200;
const MAX_SEEN_CARDS = 400;
const MAX_ID_LENGTH = 240;
const MIN_CARD_WIDTH = 200;
const MAX_CARD_DIMENSION = 4000;
const MIN_CARD_HEIGHT = 100;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 1.7;

/** One predicate for stored layouts and server-shared layouts; bounds keep a hand-edited file harmless. */
export function isCanvasPosition(value: unknown): value is CanvasPoint & { pinned?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown; pinned?: unknown };
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(Number(point.x)) < 100_000 && Math.abs(Number(point.y)) < 100_000
    && (point.pinned === undefined || typeof point.pinned === 'boolean');
}

/**
 * Which newly listed cards start closed. A table with its own summary views opens on those, so on this browser's first
 * look the raw tables, Rules, Actions, people and history start closed. F083: a card that appears after that first look
 * was just made (a table or summary the AI added on request), so it stays open instead of vanishing as it is created.
 */
export function cardsClosedOnFirstLook(ids: readonly string[], fresh: readonly string[], seen: ReadonlySet<string>): string[] {
  if (seen.size > 0 || !ids.some((id) => id.startsWith('table.view.'))) return [];
  return fresh.filter((id) => id === 'table.rules' || id === 'table.actions' || id.startsWith('table.collection.')
    || id === 'workspace.people' || id === 'workspace.history');
}

export interface CanvasViewState {
  starred(workspaceKey: string): ReadonlySet<string>;
  saveStarred(workspaceKey: string, ids: ReadonlySet<string>): void;
  hidden(workspaceKey: string): ReadonlySet<string>;
  saveHidden(workspaceKey: string, ids: ReadonlySet<string>): void;
  /**
   * F083: hide or show some cards against what is stored now, not against this tab's copy, so a second tab with an
   * older copy cannot put back cards the viewer already opened elsewhere. Returns the stored set after the change.
   */
  changeHidden(workspaceKey: string, change: { hide?: readonly string[]; show?: readonly string[] }): ReadonlySet<string>;
  /** F083: whether a `storage` event key belongs to this table's closed cards, so other tabs can follow along. */
  isHiddenKey(workspaceKey: string, storageKey: string | null): boolean;
  seen(workspaceKey: string): Set<string>;
  saveSeen(workspaceKey: string, ids: ReadonlySet<string>): void;
  cardSizes(workspaceKey: string): CardSizes;
  saveCardSizes(workspaceKey: string, sizes: CardSizes): void;
  sortMode(workspaceKey: string): CardSortMode;
  saveSortMode(workspaceKey: string, mode: CardSortMode): void;
  layout(workspaceKey: string): SavedCanvasLayout;
  saveLayout(workspaceKey: string, layout: SavedCanvasLayout): void;
}

export function createCanvasViewState(storage: CanvasStorage | null): CanvasViewState {
  function read(workspaceKey: string, key: (workspaceKey: string) => string): string | null {
    if (!storage) return null;
    try {
      return storage.getItem(key(workspaceKey));
    } catch {
      return null;
    }
  }

  function write(key: string, value: string): void {
    if (!storage) return;
    try {
      storage.setItem(key, value);
    } catch {
      // The canvas remains usable when storage is blocked or full.
    }
  }

  function remove(key: string): void {
    if (!storage) return;
    try {
      storage.removeItem(key);
    } catch {
      // Private mode: closing still works until reload.
    }
  }

  function readIdSet(workspaceKey: string, key: (workspaceKey: string) => string, max: number, capLength: boolean): Set<string> {
    const stored = read(workspaceKey, key);
    if (stored === null) return new Set();
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!Array.isArray(parsed)) return new Set();
      return new Set(parsed
        .filter((id): id is string => typeof id === 'string' && (!capLength || id.length <= MAX_ID_LENGTH))
        .slice(0, max));
    } catch {
      return new Set();
    }
  }

  function writeHidden(workspaceKey: string, ids: ReadonlySet<string>): void {
    if (ids.size === 0) remove(hiddenKey(workspaceKey));
    else write(hiddenKey(workspaceKey), JSON.stringify([...ids].slice(0, MAX_MARKED_CARDS)));
  }

  function readCardSizes(workspaceKey: string): CardSizes {
    const stored = read(workspaceKey, sizeKey);
    if (stored === null) return {};
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const sizes: Record<string, { width: number; height: number }> = {};
      for (const [id, value] of Object.entries(parsed as Record<string, unknown>).slice(0, MAX_MARKED_CARDS)) {
        const size = value as { width?: unknown; height?: unknown } | null;
        const width = Number(size?.width);
        const height = Number(size?.height);
        if (id.length <= MAX_ID_LENGTH && width >= MIN_CARD_WIDTH && width <= MAX_CARD_DIMENSION
            && height >= MIN_CARD_HEIGHT && height <= MAX_CARD_DIMENSION) {
          sizes[id] = { width, height };
        }
      }
      return sizes;
    } catch {
      return {};
    }
  }

  function readLayout(workspaceKey: string): SavedCanvasLayout {
    const stored = read(workspaceKey, layoutKey);
    if (stored === null) return { positions: {} };
    try {
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return { positions: {} };
      const candidate = parsed as Partial<SavedCanvasLayout>;
      const positions: SavedCanvasLayout['positions'] = {};
      if (candidate.positions && typeof candidate.positions === 'object') {
        for (const [id, point] of Object.entries(candidate.positions)) {
          if (isCanvasPosition(point)) positions[id] = { x: point.x, y: point.y, pinned: point.pinned ?? true };
        }
      }
      const viewport = candidate.viewport;
      if (viewport && Number.isFinite(viewport.centerX) && Number.isFinite(viewport.centerY) && Number.isFinite(viewport.zoom)) {
        return {
          positions,
          viewport: {
            centerX: viewport.centerX,
            centerY: viewport.centerY,
            zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, viewport.zoom)),
          },
        };
      }
      return { positions };
    } catch {
      return { positions: {} };
    }
  }

  return {
    starred: (workspaceKey) => readIdSet(workspaceKey, starredKey, MAX_MARKED_CARDS, true),
    saveStarred(workspaceKey, ids) {
      write(starredKey(workspaceKey), JSON.stringify([...ids].slice(-MAX_MARKED_CARDS)));
    },
    hidden: (workspaceKey) => readIdSet(workspaceKey, hiddenKey, MAX_MARKED_CARDS, true),
    saveHidden: writeHidden,
    changeHidden(workspaceKey, change) {
      const next = readIdSet(workspaceKey, hiddenKey, MAX_MARKED_CARDS, true);
      for (const id of change.show ?? []) next.delete(id);
      for (const id of change.hide ?? []) next.add(id);
      writeHidden(workspaceKey, next);
      return next;
    },
    isHiddenKey: (workspaceKey, storageKey) => storageKey === null || storageKey === hiddenKey(workspaceKey),
    seen: (workspaceKey) => readIdSet(workspaceKey, seenKey, MAX_SEEN_CARDS, false),
    saveSeen(workspaceKey, ids) {
      write(seenKey(workspaceKey), JSON.stringify([...ids].slice(-MAX_SEEN_CARDS)));
    },
    cardSizes: readCardSizes,
    saveCardSizes(workspaceKey, sizes) {
      write(sizeKey(workspaceKey), JSON.stringify(sizes));
    },
    sortMode(workspaceKey) {
      return parseCardSortMode(read(workspaceKey, sortKey));
    },
    saveSortMode(workspaceKey, mode) {
      write(sortKey(workspaceKey), mode);
    },
    layout: readLayout,
    saveLayout(workspaceKey, layout) {
      write(layoutKey(workspaceKey), JSON.stringify(layout));
    },
  };
}
