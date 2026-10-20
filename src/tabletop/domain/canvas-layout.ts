import { z } from 'zod';
import type { ActorContext } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import { assert, hasRole, parsePayload } from './helpers';

const point = z.strictObject({
  x: z.number().finite().min(-90_000).max(90_000),
  y: z.number().finite().min(-90_000).max(90_000),
  pinned: z.boolean().optional(),
});
const layoutInput = z.strictObject({
  expectedLayoutRevision: z.number().int().safe().nonnegative(),
  positions: z.record(z.string().regex(/^table\.(collection|view)\.[a-z][a-z0-9_-]{0,39}$|^table\.actions$/), point)
    .refine(positions => Object.keys(positions).length > 0 && Object.keys(positions).length <= 24),
});

/** Shared geometry has its own CAS; it never changes data, rule or action revisions. */
export function handleCanvasLayout(state: TableState, payload: unknown, ctx: ActorContext) {
  hasRole(ctx, ['owner', 'participant']);
  const input = parsePayload(layoutInput, payload);
  const revision = state.canvasLayout?.revision ?? 0;
  assert(input.expectedLayoutRevision === revision, 'STALE_LAYOUT', 'The table arrangement changed. Refresh before moving it again.');
  const allowed = sharedCanvasIds(state);
  assert(Object.keys(input.positions).every(id => allowed.has(id)), 'CANVAS_NODE_UNAVAILABLE', 'Only active shared objects can be arranged.');
  const positions = Object.fromEntries(Object.entries(state.canvasLayout?.positions ?? {}).filter(([id]) => allowed.has(id)));
  return {
    state: { ...state, canvasLayout: { revision: revision + 1, positions: { ...positions, ...input.positions } } },
    label: 'Arranged table objects',
  };
}

export function sharedCanvasIds(state: TableState): Set<string> {
  if (!state.program) return new Set();
  return new Set([
    'table.actions',
    ...state.program.collections.map(collection => `table.collection.${collection.id}`),
    ...(state.program.canvas?.views ?? []).map(view => `table.view.${view.id}`),
  ]);
}

/** Drops retired view positions and never exposes private source/auxiliary geometry. */
export function projectCanvasLayout(state: TableState) {
  if (!state.canvasLayout) return undefined;
  const allowed = sharedCanvasIds(state);
  return {
    revision: state.canvasLayout.revision,
    positions: Object.fromEntries(Object.entries(state.canvasLayout.positions).filter(([id]) => allowed.has(id))),
  };
}
