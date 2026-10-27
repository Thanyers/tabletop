import { describe, expect, it } from 'vitest';
import type { WorkspaceView } from '../shared/contracts';
import { createTableState } from '../domain/table';
import {
  EVIDENCE_SOURCE_OBJECT,
  EVIDENCE_TABLE_OBJECT,
  focusRequest,
  isSameOpenTable,
  nextHistoryWrite,
  pageForPath,
  pathForProjection,
  pendingRulesObject,
  shouldApplyLateOpen,
  signInReturnPath,
  tableChangeReset,
} from './workspace-navigation';

/**
 * F078-T5b: navigation and focus decisions are pure, so the address-bar, back/forward and
 * table-switch rules are tested directly instead of only through a rendered app.
 */

function tableView(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'room-a',
    title: 'Table A',
    kind: 'table',
    epoch: 1,
    revision: 'rev-1',
    actor: { actorId: 'owner-a', name: 'Owner', role: 'owner' },
    members: [],
    domain: createTableState(),
    createdAt: 0,
    expiresAt: 9_999_999_999_999,
    ...overrides,
  } as WorkspaceView;
}

describe('navigation decisions', () => {
  it('maps a path to the page that shows while no table is open', () => {
    expect(pageForPath('/')).toBe('landing');
    expect(pageForPath('/new')).toBe('new');
    expect(pageForPath('/tables')).toBe('tables');
    // A table path is handled by the table branch; the page fallback stays the landing page.
    expect(pageForPath('/t/room-a')).toBe('landing');
    expect(pageForPath('/not-a-route')).toBe('landing');
  });

  it('addresses the open table, or the current page when none is open', () => {
    expect(pathForProjection({ id: 'room-a' }, 'tables')).toBe('/t/room-a');
    expect(pathForProjection(null, 'tables')).toBe('/tables');
    expect(pathForProjection(null, 'new')).toBe('/new');
    expect(pathForProjection(null, 'landing')).toBe('/');
  });

  it('keeps a room on its own address (D-046)', () => {
    // A room deep link used to be rewritten to /t/:id, which moved the member to the table screen.
    expect(pathForProjection({ id: 'room-a' }, 'landing', true)).toBe('/s/room-a');
    expect(pathForProjection({ id: 'room-a' }, 'landing', false)).toBe('/t/room-a');
    expect(pathForProjection(null, 'tables', true)).toBe('/tables');
  });

  it('replaces the first entry, pushes user navigation, and leaves back/forward alone', () => {
    expect(nextHistoryWrite('replace', '/t/room-a', '/')).toEqual({ write: 'replace', nextMode: 'push' });
    expect(nextHistoryWrite('push', '/t/room-a', '/tables')).toEqual({ write: 'push', nextMode: 'push' });
    // Back/forward already owns the URL.
    expect(nextHistoryWrite('none', '/t/room-a', '/tables')).toEqual({ write: 'skip', nextMode: 'push' });
    // Already correct: never stack a duplicate entry.
    expect(nextHistoryWrite('push', '/tables', '/tables')).toEqual({ write: 'skip', nextMode: 'push' });
  });

  it('sends a signed-in visitor from the landing page to their tables', () => {
    expect(signInReturnPath('/')).toBe('/tables');
    expect(signInReturnPath('/new')).toBe('/new');
    expect(signInReturnPath('/t/room-a')).toBe('/t/room-a');
  });

  it('ignores an async open that no longer matches the visible table', () => {
    expect(isSameOpenTable('room-a', 'room-a')).toBe(true);
    expect(isSameOpenTable('room-a', 'room-b')).toBe(false);
    expect(isSameOpenTable('room-a', null)).toBe(false);
  });

  it('still opens a forward-navigated table when nothing is open', () => {
    // Forward from the table list: the address names a table and the app shows none, so the
    // fetched table must be drawn. Treating "nothing open" as a mismatch broke this.
    expect(shouldApplyLateOpen('room-a', null)).toBe(true);
    expect(shouldApplyLateOpen('room-a', undefined)).toBe(true);
    // The member stayed on the same table, or the result is for the table they are looking at.
    expect(shouldApplyLateOpen('room-a', 'room-a')).toBe(true);
    // The member switched tables while the fetch was in flight: drop it.
    expect(shouldApplyLateOpen('room-a', 'room-b')).toBe(false);
  });
});

describe('table change reset', () => {
  it('resets per-table state when the seat or table identity changes', () => {
    const first = tableView();
    const other = tableView({ id: 'room-b' });
    expect(tableChangeReset(first, other)).toMatchObject({ changedTable: true, changedWorkspace: true });
    expect(tableChangeReset(null, other)).toMatchObject({ changedTable: true, changedWorkspace: true });
    // A new epoch on the same table still invalidates per-table UI state.
    expect(tableChangeReset(first, tableView({ epoch: 2 }))).toMatchObject({ changedTable: true, changedWorkspace: false });
  });

  it('leaves the Canvas alone when only the projection moved', () => {
    const first = tableView();
    expect(tableChangeReset(first, tableView({ revision: 'rev-2' }))).toEqual({ changedTable: false, changedWorkspace: false, startObject: null });
  });

  it('opens nothing for a chat-first table until there is a rule draft to review', () => {
    expect(pendingRulesObject(null)).toBeNull();
    expect(pendingRulesObject({ kind: 'table', actor: { actorId: 'owner-a', role: 'owner' }, domain: { candidate: null } })).toBeNull();
    expect(pendingRulesObject({ kind: 'table', actor: { actorId: 'owner-a', role: 'owner' }, domain: { candidate: { status: 'draft' } } })).toBe('table.rules');
    expect(pendingRulesObject({ kind: 'table', actor: { actorId: 'owner-a', role: 'owner' }, domain: { candidate: { status: 'validated' } } })).toBe('table.rules');
    // F035 default: a participant holds the same permissions as the owner except delete/reset, so a
    // member can also be taken to the review card.
    expect(pendingRulesObject({ kind: 'table', actor: { actorId: 'member-a', role: 'participant' }, domain: { candidate: { status: 'draft' } } })).toBe('table.rules');
    // A role without rules.approve is not taken to the review card.
    expect(pendingRulesObject({
      kind: 'table',
      actor: { actorId: 'member-a', role: 'participant' },
      domain: {
        access: { roles: [{ id: 'no-approve', name: 'No approve', permissions: [] }], assignments: { 'member-a': 'no-approve' } },
        candidate: { status: 'draft' },
      },
    })).toBeNull();
    // An active rule set is not a draft awaiting review.
    expect(pendingRulesObject({ kind: 'table', actor: { actorId: 'owner-a', role: 'owner' }, domain: { candidate: { status: 'active' } } })).toBeNull();
    expect(pendingRulesObject({ kind: 'teaching', actor: { actorId: 'owner-a', role: 'teacher' }, domain: {} })).toBeNull();
  });
});

describe('focus requests', () => {
  it('selects and focuses a card, opening it unless told otherwise', () => {
    expect(focusRequest('table.rules')).toEqual({ nodeId: 'table.rules', open: true });
    expect(focusRequest('invoice.source', true)).toEqual({ nodeId: 'invoice.source', open: true });
    expect(focusRequest('table.rules', false)).toEqual({ nodeId: 'table.rules', open: false });
  });

  it('keeps the invoice evidence path pointing at the sources and table cards', () => {
    expect(EVIDENCE_SOURCE_OBJECT).toBe('invoice.source');
    expect(EVIDENCE_TABLE_OBJECT).toBe('invoice.table');
  });
});
