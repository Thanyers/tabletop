export const CANVAS_CONNECTIONS_PREFERENCE_KEY = 'tabletop.canvas.connections.v1';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** A stored choice wins; without one, connected tables show their lines instead of only their ports. */
export function resolveConnectionsVisible(stored: boolean | null, connectionCount: number): boolean {
  return stored ?? connectionCount > 0;
}

export function readConnectionsPreference(storage: PreferenceStorage | null): boolean | null {
  if (!storage) return null;
  try {
    const stored = storage.getItem(CANVAS_CONNECTIONS_PREFERENCE_KEY);
    if (stored === 'shown') return true;
    if (stored === 'hidden') return false;
  } catch {
    // Storage can be blocked by the browser; the default view still works.
  }
  return null;
}

export function writeConnectionsPreference(storage: PreferenceStorage | null, visible: boolean): void {
  if (!storage) return;
  try {
    storage.setItem(CANVAS_CONNECTIONS_PREFERENCE_KEY, visible ? 'shown' : 'hidden');
  } catch {
    // Storage can be full or blocked; the choice still applies to this page.
  }
}

/** F037: notes are canvas paper with their own coordinates, not card-shaped plan objects. */
export function isCanvasNoteId(id: string): boolean {
  return id.startsWith('table.note.');
}

export interface VisibleCanvasConnection {
  source: string;
  sourcePort: string;
  target: string;
  targetHandle: string;
  valueType: string;
}

/** Collapse duplicate visible paths while retaining connections with distinct typed ports. */
export function dedupeVisibleCanvasConnections<T extends VisibleCanvasConnection>(connections: readonly T[]): T[] {
  const seen = new Set<string>();
  return connections.filter((connection) => {
    const key = JSON.stringify([
      connection.source,
      connection.sourcePort,
      connection.target,
      connection.targetHandle,
      connection.valueType,
    ]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** F070: a chat card that opened from picking an option on another chat card. */
export interface CanvasFollowUpLink { id: string; label: string; order: number }

export interface CanvasFollowUpConnection { id: string; source: string; target: string; label: string }

/** F070: one line from each asking card to every visible card its picked options opened. */
export function followUpConnections(objects: readonly { id: string; linkedFrom?: CanvasFollowUpLink }[], visibleIds: ReadonlySet<string>): CanvasFollowUpConnection[] {
  const connections: CanvasFollowUpConnection[] = [];
  for (const object of objects) {
    const link = object.linkedFrom;
    if (!link || link.id === object.id || !visibleIds.has(link.id) || !visibleIds.has(object.id)) continue;
    connections.push({ id: `follow-up.${link.id}->${object.id}`, source: link.id, target: object.id, label: link.label });
  }
  return connections;
}

const FOLLOW_UP_GAP_X = 144;
const FOLLOW_UP_GAP_Y = 40;

export interface CanvasRect { x: number; y: number; width: number; height: number }

/**
 * F070: a new follow-up card starts to the right of the card it came from, below any follow-up of that card
 * already on the canvas, so branches stack instead of overlapping.
 */
export function followUpPosition(parent: CanvasRect | undefined, siblings: readonly CanvasRect[]): { x: number; y: number } | undefined {
  if (!parent) return undefined;
  const x = parent.x + parent.width + FOLLOW_UP_GAP_X;
  const lowest = siblings.reduce((bottom, sibling) => Math.max(bottom, sibling.y + sibling.height + FOLLOW_UP_GAP_Y), Number.NEGATIVE_INFINITY);
  return { x, y: Number.isFinite(lowest) ? Math.max(parent.y, lowest) : parent.y };
}
