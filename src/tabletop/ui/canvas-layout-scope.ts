import type { WorkspaceView } from '../shared/contracts';
import { isSharedCanvasId } from '../shared/canvas-layout-ids';

export interface CanvasLayoutNodeIdentity {
  id: string;
}

/** Local layout state belongs to one room, epoch, and actor projection. */
export function canvasLayoutScopeKey(view: Pick<WorkspaceView, 'id' | 'kind' | 'epoch' | 'actor'>): string {
  return JSON.stringify([view.id, view.kind, view.epoch, view.actor.actorId, view.actor.role, view.actor.seat ?? null]);
}

/** Rules stay owner-private while they contain only an unactivated candidate. */
export function isSharedCanvasNodeForView(id: string, view: WorkspaceView): boolean {
  if (view.kind !== 'table' || view.domain.kind !== 'table' || !isSharedCanvasId(id)) return false;
  if (id === 'table.sources') return view.domain.sources.length > 0;
  return id !== 'table.rules' || view.domain.program !== null;
}

/** Return only currently unplaced, eligible nodes; a later node can be seeded independently. */
export function missingSharedCanvasNodeIds(
  nodes: readonly CanvasLayoutNodeIdentity[],
  view: WorkspaceView,
  knownPositions: Readonly<Record<string, unknown>>,
  pendingIds: ReadonlySet<string>,
  draggingIds: ReadonlySet<string>,
  openedId: string | null,
  limit = 24,
): string[] {
  return nodes
    .filter((node) => !node.id.startsWith('table.note.') // F037: notes keep their own coordinates
      && isSharedCanvasNodeForView(node.id, view)
      && knownPositions[node.id] === undefined
      && !pendingIds.has(node.id)
      && !draggingIds.has(node.id)
      && node.id !== openedId)
    .slice(0, limit)
    .map((node) => node.id);
}
