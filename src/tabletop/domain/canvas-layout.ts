import { z } from 'zod';
import type { ActorContext } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import { assert, hasRole, parsePayload } from './helpers';
import { ALWAYS_SHARED_CANVAS_IDS, MAX_SHARED_CHAT_POSITIONS, SHARED_CANVAS_ID_PATTERN, isSharedChatCanvasId } from '../shared/canvas-layout-ids';
import { VISIBILITY_POLICY, type VisibilityPolicy } from '../shared/visibility';

const point = z.strictObject({
  x: z.number().finite().min(-90_000).max(90_000),
  y: z.number().finite().min(-90_000).max(90_000),
  pinned: z.boolean().optional(),
});
const layoutInput = z.strictObject({
  expectedLayoutRevision: z.number().int().safe().nonnegative(),
  positions: z.record(z.string().regex(SHARED_CANVAS_ID_PATTERN), point)
    .refine(positions => Object.keys(positions).length <= 24)
    .default({}),
  /** true moves a card to the table's trash (soft delete), false restores it. */
  trash: z.record(z.string().regex(SHARED_CANVAS_ID_PATTERN), z.boolean())
    .refine(trash => Object.keys(trash).length <= 24)
    .optional(),
}).refine(input => Object.keys(input.positions).length > 0 || Object.keys(input.trash ?? {}).length > 0);

/** The table keeps at most this many deleted cards; the oldest are forgotten (they come back on the canvas). */
export const MAX_TRASHED_CANVAS_OBJECTS = 300;

/**
 * Cards that can be deleted. The table's own frame (rules, actions, people, history, notes) can only be hidden.
 * Chat cards are anyone's to tidy; views, data tables and files belong to the owner.
 */
function trashRoles(id: string): ActorContext['role'][] | null {
  if (isSharedChatCanvasId(id)) return ['owner', 'participant'];
  if (/^table\.(view|collection)\./u.test(id) || id === 'table.sources') return ['owner'];
  return null;
}

/** Shared geometry has its own CAS; it never changes data, rule or action revisions. */
export function handleCanvasLayout(state: TableState, payload: unknown, ctx: ActorContext, policy: VisibilityPolicy = VISIBILITY_POLICY) {
  hasRole(ctx, ['owner', 'participant']);
  const input = parsePayload(layoutInput, payload);
  const revision = state.canvasLayout?.revision ?? 0;
  assert(input.expectedLayoutRevision === revision, 'STALE_LAYOUT', 'The table arrangement changed. Refresh before moving it again.');
  const allowed = sharedCanvasIds(state, policy);
  const isAllowed = (id: string) => allowed.has(id) || (policy === 'open' && isSharedChatCanvasId(id));
  assert(Object.keys(input.positions).every(isAllowed), 'CANVAS_NODE_UNAVAILABLE', 'Only active shared objects can be arranged.');
  // Moved cards go to the end so the oldest chat positions are the ones dropped at the cap.
  const kept = Object.entries(state.canvasLayout?.positions ?? {}).filter(([id]) => isAllowed(id) && !(id in input.positions));
  const merged = [...kept, ...Object.entries(input.positions)];
  const chatIds = merged.map(([id]) => id).filter(isSharedChatCanvasId);
  const dropped = new Set(chatIds.slice(0, Math.max(0, chatIds.length - MAX_SHARED_CHAT_POSITIONS)));
  const positions = Object.fromEntries(merged.filter(([id]) => !dropped.has(id)));
  const trashed = { ...(state.canvasLayout?.trashed ?? {}) };
  let deleted = 0;
  let restored = 0;
  for (const [id, toTrash] of Object.entries(input.trash ?? {})) {
    const roles = trashRoles(id);
    assert(roles !== null, 'CANVAS_NODE_UNAVAILABLE', 'This card can only be hidden, not deleted.');
    hasRole(ctx, roles);
    if (toTrash) {
      if (!(id in trashed)) deleted += 1;
      delete trashed[id];
      trashed[id] = { by: ctx.actorId, at: ctx.now };
    } else if (id in trashed) {
      delete trashed[id];
      restored += 1;
    }
  }
  const keptTrash = Object.entries(trashed).filter(([id]) => isAllowed(id)).slice(-MAX_TRASHED_CANVAS_OBJECTS);
  const layout: NonNullable<TableState['canvasLayout']> = { revision: revision + 1, positions };
  if (keptTrash.length > 0) layout.trashed = Object.fromEntries(keptTrash);
  const label = deleted > 0 ? `Deleted ${deleted === 1 ? 'a card' : `${deleted} cards`} (restore from Objects)`
    : restored > 0 ? `Restored ${restored === 1 ? 'a card' : `${restored} cards`}`
      : 'Arranged table objects';
  return { state: { ...state, canvasLayout: layout }, label };
}

export function sharedCanvasIds(state: TableState, policy: VisibilityPolicy = VISIBILITY_POLICY): Set<string> {
  const files = state.sources.length > 0 ? ['table.sources'] : [];
  // Under open visibility everyone sees a draft, so its Rules card shares one position too.
  const draftRules = policy === 'open' && state.candidate !== null ? ['table.rules'] : [];
  if (!state.program) return new Set([...ALWAYS_SHARED_CANVAS_IDS, ...files, ...draftRules]);
  return new Set([
    ...ALWAYS_SHARED_CANVAS_IDS,
    ...files,
    'table.rules',
    'table.actions',
    ...state.program.collections.map(collection => `table.collection.${collection.id}`),
    ...(state.program.canvas?.views ?? []).map(view => `table.view.${view.id}`),
  ]);
}

/** Drops retired view positions and never exposes private auxiliary geometry. */
export function projectCanvasLayout(state: TableState, policy: VisibilityPolicy = VISIBILITY_POLICY) {
  if (!state.canvasLayout) return undefined;
  const allowed = sharedCanvasIds(state, policy);
  return {
    revision: state.canvasLayout.revision,
    positions: Object.fromEntries(Object.entries(state.canvasLayout.positions).filter(([id]) => allowed.has(id) || (policy === 'open' && isSharedChatCanvasId(id)))),
    ...trashedProjection(state.canvasLayout.trashed, (id) => allowed.has(id) || (policy === 'open' && isSharedChatCanvasId(id))),
  };
}

function trashedProjection(trashed: Record<string, { by: string; at: number }> | undefined, allowed: (id: string) => boolean) {
  const kept = Object.entries(trashed ?? {}).filter(([id]) => allowed(id));
  return kept.length > 0 ? { trashed: Object.fromEntries(kept) } : {};
}
