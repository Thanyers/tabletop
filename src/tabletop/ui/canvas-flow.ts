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
