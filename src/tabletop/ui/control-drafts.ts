import type { TableValue } from '../shared/table-contracts';

/**
 * F049: a tiny client-only draft store shared by the canvas cards of one browser tab.
 *
 * Each generative view is rendered on its own canvas card, so a value produced on
 * one card (the dice card) has to be readable by another card (a form or button)
 * that binds the same action parameter. The store is keyed by
 * (workspaceId, actionId, parameterId) and is intentionally in-memory only:
 * nothing is sent to the server, and reloading the page forgets every draft.
 */
export interface ControlDraftTarget {
  workspaceId: string;
  actionId: string;
  parameterId: string;
}

export interface ControlDraftEntry extends ControlDraftTarget {
  value: TableValue;
  /** Which control wrote the value, for debuggable last-write-wins behaviour. */
  source: string;
  updatedAt: number;
}

const entries = new Map<string, ControlDraftEntry>();
const listeners = new Set<() => void>();
let revision = 0;

/** Stable, collision-free key for one action parameter inside one workspace. */
export function controlDraftKey(target: ControlDraftTarget): string {
  return [target.workspaceId, target.actionId, target.parameterId].map(part => encodeURIComponent(part)).join('|');
}

export function readControlDraft(target: ControlDraftTarget): ControlDraftEntry | undefined {
  return entries.get(controlDraftKey(target));
}

export function readControlDraftValue(target: ControlDraftTarget): TableValue | undefined {
  return readControlDraft(target)?.value;
}

/** Writes a draft and notifies subscribers; writing the same value from the same source is a no-op. */
export function writeControlDraft(target: ControlDraftTarget, value: TableValue, source: string, now = Date.now()): void {
  const key = controlDraftKey(target);
  const previous = entries.get(key);
  if (previous && previous.source === source && Object.is(previous.value, value)) return;
  entries.set(key, { ...target, value, source, updatedAt: now });
  revision += 1;
  for (const listener of listeners) listener();
}

export function clearControlDraft(target: ControlDraftTarget): void {
  if (!entries.delete(controlDraftKey(target))) return;
  revision += 1;
  for (const listener of listeners) listener();
}

/** Drops every draft for one workspace, e.g. when it is closed or its table program changes. */
export function clearWorkspaceControlDrafts(workspaceId: string): void {
  let removed = false;
  for (const [key, entry] of entries) {
    if (entry.workspaceId !== workspaceId) continue;
    entries.delete(key);
    removed = true;
  }
  if (!removed) return;
  revision += 1;
  for (const listener of listeners) listener();
}

export function subscribeControlDrafts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Monotonic snapshot for `useSyncExternalStore`; React re-renders when the number changes. */
export function controlDraftsRevision(): number {
  return revision;
}

/** Test helper: forgets every draft and subscriber. */
export function resetControlDrafts(): void {
  entries.clear();
  listeners.clear();
  revision = 0;
}
