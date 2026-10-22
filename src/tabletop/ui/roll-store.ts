import { useCallback, useSyncExternalStore } from 'react';
import type { WorkspaceView } from '../shared/contracts';
import type { RollResult } from '../shared/roll';

/**
 * F048: the last server roll each member received. The authority keeps the authoritative pending
 * roll; this store only feeds the "ทอย" control after the `table.roll` acknowledgement.
 *
 * Entries are keyed by workspace, epoch, actor, action, and parameter. A later table data revision
 * invalidates the shown roll, exactly like the server refuses a stale pending roll.
 */
export interface ServerRoll extends RollResult {
  actionId: string;
  parameterId: string;
  dataRevision: number;
}

/** A browser tab cannot hold unlimited history; old workspaces are only reachable by reopening. */
const MAX_ENTRIES = 256;

const rolls = new Map<string, ServerRoll>();
const listeners = new Set<() => void>();
let version = 0;

function keyOf(view: WorkspaceView, actionId: string, parameterId: string): string {
  return [view.id, view.epoch, view.actor.actorId, actionId, parameterId].join('\u0000');
}

function notify(): void {
  version += 1;
  for (const listener of [...listeners]) listener();
}

export function subscribeServerRolls(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Called from the command dispatcher after `table.roll` returns. */
export function recordServerRoll(view: WorkspaceView, actionId: string, parameterId: string, roll: RollResult): void {
  if (view.domain.kind !== 'table') return;
  const entry: ServerRoll = { ...roll, actionId, parameterId, dataRevision: view.domain.dataRevision };
  const key = keyOf(view, actionId, parameterId);
  rolls.delete(key);
  rolls.set(key, entry);
  while (rolls.size > MAX_ENTRIES) {
    const oldest = rolls.keys().next();
    if (oldest.done) break;
    rolls.delete(oldest.value);
  }
  notify();
}

/** The roll shown for this parameter, or null when it is missing or the table data moved on. */
export function serverRollFor(view: WorkspaceView, actionId: string, parameterId: string): ServerRoll | null {
  const entry = rolls.get(keyOf(view, actionId, parameterId));
  if (!entry) return null;
  if (view.domain.kind !== 'table' || entry.dataRevision !== view.domain.dataRevision) return null;
  return entry;
}

/** Test/diagnostic helper: drop everything for one workspace. */
export function clearServerRollsFor(view: WorkspaceView): void {
  const prefix = [view.id, view.epoch, view.actor.actorId].join('\u0000');
  for (const key of [...rolls.keys()]) {
    if (key.startsWith(prefix)) rolls.delete(key);
  }
  notify();
}

export function useServerRoll(view: WorkspaceView, actionId: string, parameterId: string): ServerRoll | null {
  const subscribe = useCallback((listener: () => void) => subscribeServerRolls(listener), []);
  const getSnapshot = useCallback(() => serverRollFor(view, actionId, parameterId), [view, actionId, parameterId]);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Re-renders the caller whenever any roll is recorded or cleared; read values with `serverRollFor`. */
export function useServerRollsTick(): number {
  return useSyncExternalStore(subscribeServerRolls, () => version, () => version);
}
