import type { CanvasCardMeta, CanvasCardOrigin, TableProgram, TableState } from '../shared/table-contracts';
import type { WorkspaceView } from '../shared/contracts';
import { canonicalJson } from './helpers';

// F054: per-card timestamps for the canvas. The AI replaces the whole program on every change
// (`domain/table.ts` -> `applyTableChange`), so without a per-card diff every card would look
// "updated" at once. This module is pure: it never reads the clock and never writes state.
// Only server-ordered commands stamp time; `applyTableChange` stays the deterministic simulator.

/** Entries above this are dropped oldest-first, so one long room cannot grow the state without bound. */
export const MAX_CARD_META_ENTRIES = 48;
/** Serialized size cap for `state.cardMeta`, in bytes of JSON. */
export const MAX_CARD_META_BYTES = 12 * 1024;

const bytes = (value: string) => new TextEncoder().encode(value).byteLength;
const PREFIXED_PROGRAM_CARDS = ['table.collection.', 'table.view.'] as const;
const EXACT_PROGRAM_CARDS = new Set(['table.rules', 'table.actions', 'table.canvas']);
/** Cards the table itself owns: their time is the table's, not a person's. */
const SYSTEM_CARD_IDS = new Set(['workspace.people', 'workspace.history', 'workspace.ai']);
const COLLECTION_PREFIX = 'table.collection.';
const VIEW_PREFIX = 'table.view.';
const NOTE_PREFIX = 'table.note.';
const SOURCES_CARD_ID = 'table.sources';

/** True for cards that exist only while the active program contains them. */
export function isProgramCardId(cardId: string): boolean {
  return EXACT_PROGRAM_CARDS.has(cardId) || PREFIXED_PROGRAM_CARDS.some((prefix) => cardId.startsWith(prefix));
}

/** The canvas card a removed rule item owned, if that item had one of its own. */
export function ruleItemCardId(kind: 'action' | 'invariant' | 'view' | 'collection', id: string): string | null {
  if (kind === 'collection') return `${COLLECTION_PREFIX}${id}`;
  if (kind === 'view') return `${VIEW_PREFIX}${id}`;
  // Actions share one card and invariants have none; removing them only touches `table.rules`.
  return null;
}

/** Every program-owned canvas card id, in a stable order. */
export function programCardIds(program: TableProgram | null): string[] {
  if (!program) return [];
  const ids = ['table.rules', 'table.actions'];
  for (const collection of program.collections) ids.push(`${COLLECTION_PREFIX}${collection.id}`);
  if (program.canvas) {
    ids.push('table.canvas');
    for (const view of program.canvas.views) ids.push(`${VIEW_PREFIX}${view.id}`);
  }
  return ids;
}

/** The cards the current table actually shows; anything else is stale meta and is pruned. */
export function liveCanvasCardIds(state: TableState): string[] {
  const ids: string[] = [...SYSTEM_CARD_IDS];
  if (state.sources.length > 0) ids.push(SOURCES_CARD_ID);
  ids.push(...programCardIds(state.program));
  for (const note of state.notes ?? []) ids.push(`${NOTE_PREFIX}${note.id}`);
  return ids;
}

/**
 * F054: what the card shows, as canonical JSON, so property order can never fake a change.
 * Returns null when the program no longer holds that card.
 *
 * - `table.rules` describes the rules, not the views, so editing one view never bumps it.
 * - `table.actions` is the action list.
 * - a collection card is its definition; rows are data and have their own `dataRevision`.
 * - a view card is its descriptor; `table.canvas` is the set of view ids it contains.
 */
export function canvasCardSignature(cardId: string, program: TableProgram | null): string | null {
  if (!program) return null;
  if (cardId === 'table.rules') {
    return canonicalJson(Object.fromEntries(Object.entries(program).filter(([key]) => key !== 'canvas')));
  }
  if (cardId === 'table.actions') return canonicalJson(program.actions);
  if (cardId === 'table.canvas') {
    if (!program.canvas) return null;
    return canonicalJson({ version: program.canvas.version, views: program.canvas.views.map((view) => view.id) });
  }
  if (cardId.startsWith(COLLECTION_PREFIX)) {
    const collection = program.collections.find((item) => item.id === cardId.slice(COLLECTION_PREFIX.length));
    return collection ? canonicalJson(collection) : null;
  }
  if (cardId.startsWith(VIEW_PREFIX)) {
    const view = program.canvas?.views.find((item) => item.id === cardId.slice(VIEW_PREFIX.length));
    return view ? canonicalJson(view) : null;
  }
  return null;
}

/**
 * F054: the next `cardMeta` after an activation. Non-program cards (notes, files, auxiliary cards)
 * are carried through untouched; new program cards get a recorded creation, changed ones move
 * `updatedAt`, unchanged ones keep their entry exactly, and removed cards are dropped.
 */
export function diffCardMeta(previous: TableState, nextProgram: TableProgram | null, at: number, actorId: string, revision: number): Record<string, CanvasCardMeta> {
  const next: Record<string, CanvasCardMeta> = {};
  for (const [cardId, meta] of Object.entries(previous.cardMeta ?? {})) {
    if (!isProgramCardId(cardId)) next[cardId] = { ...meta };
  }
  for (const cardId of programCardIds(nextProgram)) {
    const signature = canvasCardSignature(cardId, nextProgram);
    if (signature === null) continue;
    const existing = previous.cardMeta?.[cardId];
    if (!existing) {
      // Legacy rooms have no meta. Backfill the card's real creation from retained revisions
      // instead of claiming it was created at this activation.
      const previousSignature = canvasCardSignature(cardId, previous.program);
      const backfilled = previousSignature === null ? undefined : resolveProgramCardMeta(previous, cardId);
      if (backfilled) {
        next[cardId] = previousSignature === signature
          ? { ...backfilled }
          : { ...backfilled, updatedAt: Math.max(backfilled.updatedAt, at), updatedBy: actorId, revision };
        continue;
      }
      next[cardId] = { createdAt: at, updatedAt: at, createdBy: actorId, updatedBy: actorId, origin: 'ai', revision, source: 'recorded' };
      continue;
    }
    // A signature that differs from the previous program means this card's content changed.
    next[cardId] = canvasCardSignature(cardId, previous.program) === signature
      ? { ...existing }
      : { ...existing, updatedAt: Math.max(existing.updatedAt, existing.createdAt, at), updatedBy: actorId, revision };
  }
  return next;
}

/**
 * F054: stamp one human-owned card (files today). Creation is only set when nothing is known yet;
 * the update always moves, so "added" and "removed a file" both read as a change to the Files card.
 * `revision` is passed only when the touch happens as part of a rule revision (removeItem).
 */
export function touchCardMeta(meta: Record<string, CanvasCardMeta> | undefined, cardId: string, at: number, actorId: string, origin: CanvasCardOrigin, revision?: number): Record<string, CanvasCardMeta> {
  const next = { ...(meta ?? {}) };
  const existing = next[cardId];
  next[cardId] = existing
    ? { ...existing, updatedAt: Math.max(existing.updatedAt, existing.createdAt, at), updatedBy: actorId, ...(revision === undefined ? {} : { revision }), source: 'recorded' }
    : { createdAt: at, updatedAt: at, createdBy: actorId, updatedBy: actorId, origin, ...(revision === undefined ? {} : { revision }), source: 'recorded' };
  return next;
}

/**
 * F054: keep only meta for cards the table still shows, then enforce the 48-entry / 12 KiB caps by
 * dropping the oldest `updatedAt` first (ties broken by id, so the result is deterministic).
 */
export function pruneCardMeta(meta: Record<string, CanvasCardMeta> | undefined, liveIds: readonly string[]): Record<string, CanvasCardMeta> {
  const live = new Set(liveIds);
  const kept = Object.entries(meta ?? {})
    .filter(([cardId]) => live.has(cardId))
    .sort(([leftId, left], [rightId, right]) => left.updatedAt - right.updatedAt || (leftId < rightId ? -1 : leftId > rightId ? 1 : 0));
  while (kept.length > MAX_CARD_META_ENTRIES) kept.shift();
  while (kept.length > 1 && bytes(JSON.stringify(Object.fromEntries(kept))) > MAX_CARD_META_BYTES) kept.shift();
  return Object.fromEntries(kept);
}

interface ProgramTimelineEntry { at: number; actorId: string; revision: number; program: TableProgram }

/**
 * F054: the program's history, oldest first, for rooms that never stored `cardMeta`.
 * Each activation stores the program it activated, so the current program is normally the last snapshot.
 */
function programTimeline(state: TableState): ProgramTimelineEntry[] {
  const entries: ProgramTimelineEntry[] = [];
  for (const record of state.revisions) {
    if (record.snapshot.kind !== 'table') continue;
    entries.push({ at: record.activatedAt, actorId: record.actorId, revision: record.revision, program: record.snapshot.program });
  }
  const current = state.program;
  const last = entries[entries.length - 1];
  if (!current || !last) return entries;
  // A program that was never recorded as a revision can only be dated by the last known activation.
  if (canonicalJson(last.program) !== canonicalJson(current)) {
    entries.push({ at: last.at, actorId: last.actorId, revision: state.ruleRevision, program: current });
  }
  return entries;
}

/** F054: program cards inferred from retained revisions. No retained revision that holds the card means no honest time. */
function resolveProgramCardMeta(state: TableState, cardId: string): CanvasCardMeta | undefined {
  const entries = programTimeline(state);
  if (entries.length === 0) return undefined;
  let first: ProgramTimelineEntry | undefined;
  let lastChanged: ProgramTimelineEntry | undefined;
  let previousSignature: string | null = null;
  for (const entry of entries) {
    const signature = canvasCardSignature(cardId, entry.program);
    if (signature === null) {
      previousSignature = null;
      continue;
    }
    first ??= entry;
    if (previousSignature !== signature) lastChanged = entry;
    previousSignature = signature;
  }
  if (!first || !lastChanged) return undefined;
  // The card is in the oldest retained revision and that revision is not r1: its creation is older than the record.
  const inferred = entries[0] === first && first.revision !== 1;
  return {
    createdAt: first.at,
    updatedAt: Math.max(first.at, lastChanged.at),
    createdBy: first.actorId,
    updatedBy: lastChanged.actorId,
    origin: 'ai',
    revision: lastChanged.revision,
    source: inferred ? 'inferred' : 'recorded',
  };
}

/**
 * F054: read-only fallback for rooms without stored `cardMeta`. Order: stored meta, note, files card,
 * program card from revisions, then the table's own system cards. Returns undefined when nothing is
 * knowable, so the UI can say "not recorded" instead of guessing. Never writes to `state`.
 */
export function resolveCardMeta(state: TableState, view: WorkspaceView, cardId: string): CanvasCardMeta | undefined {
  const stored = state.cardMeta?.[cardId];
  if (stored) return { ...stored };

  if (cardId.startsWith(NOTE_PREFIX)) {
    const note = (state.notes ?? []).find((item) => `${NOTE_PREFIX}${item.id}` === cardId);
    if (!note) return undefined;
    const updatedAt = Math.max(note.createdAt, note.updatedAt);
    return {
      createdAt: note.createdAt,
      updatedAt,
      createdBy: note.createdBy,
      // A note records no separate editor id; the author is the only person the state can name.
      ...(updatedAt > note.createdAt ? { updatedBy: note.createdBy } : {}),
      origin: 'human',
      source: 'recorded',
    };
  }

  if (cardId === SOURCES_CARD_ID) {
    if (state.sources.length === 0) return undefined;
    const times = state.sources.map((source) => source.createdAt);
    return { createdAt: Math.min(...times), updatedAt: Math.max(...times), origin: 'human', source: 'recorded' };
  }

  if (isProgramCardId(cardId)) return resolveProgramCardMeta(state, cardId);

  if (SYSTEM_CARD_IDS.has(cardId)) {
    const lastRevisionAt = state.revisions.length > 0 ? state.revisions[state.revisions.length - 1]!.activatedAt : view.createdAt;
    const lastActivityAt = state.activity.length > 0 ? state.activity[state.activity.length - 1]!.at : view.createdAt;
    return {
      createdAt: view.createdAt,
      updatedAt: Math.max(view.createdAt, lastRevisionAt, lastActivityAt),
      origin: 'system',
      source: 'inferred',
    };
  }

  return undefined;
}
