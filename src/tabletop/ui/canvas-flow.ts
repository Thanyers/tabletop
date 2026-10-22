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
