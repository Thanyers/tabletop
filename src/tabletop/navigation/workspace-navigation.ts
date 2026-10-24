import type { CaseKind, WorkspaceView } from '../shared/contracts';
import { viewerCan, type AccessConfig } from '../shared/permissions';
import { parseRoute, routePath } from '../routes';

/**
 * F078-T5b — the client's navigation and canvas-focus *decisions*, kept out of the component.
 *
 * `TabletopApp` used to decide, inline, where the address bar should point, what a back/forward
 * event means, which card a table change should open, and whether an async result still belongs
 * to the table the member is looking at. Those decisions are pure functions of the projection and
 * the current path, so they live here and are tested directly.
 *
 * The component keeps every React state value and every setter. This module never renders, never
 * touches history itself and never mutates a projection: it returns a decision the caller applies.
 */

/** Which page shows while no table is open. */
export type AppPage = 'landing' | 'tables' | 'new';

/**
 * How the next change of open table is written to the address bar: the first sync after boot
 * replaces, user navigation pushes, back/forward writes nothing.
 */
export type HistoryMode = 'replace' | 'push' | 'none';

/** The page a path addresses. Unknown paths fall back to the landing page, as before. */
export function pageForPath(pathname: string): AppPage {
  const route = parseRoute(pathname);
  return route?.name === 'new' ? 'new' : route?.name === 'tables' ? 'tables' : 'landing';
}

/** The address the current projection belongs at. */
export function pathForProjection(view: { id: string } | null, page: AppPage): string {
  return routePath(view ? { name: 'table', id: view.id } : { name: page });
}

export interface HistoryWrite {
  /** `skip` leaves the address bar alone; the other two mirror `history.replaceState`/`pushState`. */
  write: 'skip' | 'replace' | 'push';
  /** The mode the next write starts from; any automatic sync leaves a push behind it. */
  nextMode: HistoryMode;
}

/**
 * Decide one address-bar write. A `none` mode means a back/forward event already owns the URL,
 * and an already-correct path is left untouched so React does not stack duplicate entries.
 */
export function nextHistoryWrite(mode: HistoryMode, target: string, currentPath: string): HistoryWrite {
  const write = mode === 'none' || currentPath === target ? 'skip' : mode === 'replace' ? 'replace' : 'push';
  return { write, nextMode: 'push' };
}

/**
 * Where to land after sign-in: the page that asked, or the table list when the landing page did.
 * Kept identical to the previous inline rule so a signed-in return does not open the marketing page.
 */
export function signInReturnPath(pathname: string): string {
  return parseRoute(pathname)?.name === 'landing' ? routePath({ name: 'tables' }) : pathname;
}

/**
 * Whether an async table open still belongs to the table the member is looking at.
 * A back/forward fetch can resolve after they switched, and drawing it then would show the
 * previous table under the new address.
 */
export function isSameOpenTable(requestedId: string, currentId: string | null | undefined): boolean {
  return currentId === requestedId;
}

/**
 * Whether a fetched table may be drawn now.
 *
 * Correct in three cases only: nothing is open (Forward from the table list must open the table
 * the address names), the requested table is already the visible one, or the member stayed put.
 * When a different table is open, the late result is dropped instead of replacing it.
 */
export function shouldApplyLateOpen(requestedId: string, currentId: string | null | undefined): boolean {
  return currentId === null || currentId === undefined || isSameOpenTable(requestedId, currentId);
}

export interface TableChangeReset {
  /** The seat or table identity changed, so per-table UI state must be reset. */
  changedTable: boolean;
  /** The table id changed, so invitation panels belong to the previous table. */
  changedWorkspace: boolean;
  /**
   * The card to select and open after the change. Chat-first tables open nothing until there is
   * something to review (F006); an approver with a pending rule draft lands on the Rules card.
   */
  startObject: string | null;
}

/** The narrow projection shape the pending-rules rule needs; a full view satisfies it. */
export interface PendingRulesView {
  kind: CaseKind;
  actor: { actorId: string; role: string };
  domain: { access?: AccessConfig; candidate?: { status: string } | null };
}

/**
 * The card a freshly opened table should show. Chat-first tables open nothing until there is
 * something to review (F006): only an approver with a pending, not-yet-active rule draft lands
 * on the Rules card.
 */
export function pendingRulesObject(view: PendingRulesView | null): string | null {
  if (!view || view.kind !== 'table') return null;
  if (!viewerCan(view, 'rules.approve')) return null;
  const candidate = view.domain.candidate;
  if (!candidate || candidate.status === 'active') return null;
  return 'table.rules';
}

export function tableChangeReset(previous: WorkspaceView | null, next: WorkspaceView | null): TableChangeReset {
  const changedTable = previous?.id !== next?.id || previous?.epoch !== next?.epoch || previous?.actor.actorId !== next?.actor.actorId;
  const changedWorkspace = previous?.id !== next?.id;
  if (!changedTable) return { changedTable, changedWorkspace, startObject: null };
  return { changedTable, changedWorkspace, startObject: pendingRulesObject(next) };
}

/** The card the invoice evidence path focuses, and the one it returns to. */
export const EVIDENCE_SOURCE_OBJECT = 'invoice.source';
export const EVIDENCE_TABLE_OBJECT = 'invoice.table';

export interface FocusRequest {
  nodeId: string;
  /** Whether the card is also opened, not only focused. */
  open: boolean;
}

export function focusRequest(nodeId: string, open = true): FocusRequest {
  return { nodeId, open };
}
