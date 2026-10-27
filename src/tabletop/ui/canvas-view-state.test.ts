import { describe, expect, it, vi } from 'vitest';
import { cardsClosedOnFirstLook, createCanvasViewState, isCanvasPosition, type CanvasStorage } from './canvas-view-state';

/**
 * F078-T14: the Canvas kept six browser-backed view preferences inline in a
 * 2,259-line component. They are a module now, with the same keys, caps and
 * fallbacks, so a corrupted value or a blocked storage cannot break the canvas.
 */

function memoryStorage(initial: Record<string, string> = {}): CanvasStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  };
}

const key = 'workspace-1';

describe('canvas view state', () => {
  it('round-trips each preference under its existing key', () => {
    const storage = memoryStorage();
    const state = createCanvasViewState(storage);

    state.saveStarred(key, new Set(['table.view.a']));
    state.saveHidden(key, new Set(['table.rules']));
    state.saveSeen(key, new Set(['table.view.a']));
    state.saveCardSizes(key, { 'table.view.a': { width: 640, height: 320 } });
    state.saveSortMode(key, 'canvas');
    state.saveLayout(key, { positions: { 'table.view.a': { x: 12, y: 34, pinned: true } }, viewport: { centerX: 5, centerY: 6, zoom: 1.2 } });

    expect(storage.data.get(`tabletop:r1:canvas-starred:${key}`)).toBe('["table.view.a"]');
    expect(storage.data.get(`tabletop:r1:canvas-hidden:${key}`)).toBe('["table.rules"]');
    expect(storage.data.get(`tabletop:r1:canvas-seen:${key}`)).toBe('["table.view.a"]');
    expect(storage.data.get(`tabletop:r1:canvas-size:${key}`)).toBe('{"table.view.a":{"width":640,"height":320}}');
    expect(storage.data.get(`tabletop:r1:canvas-sort:${key}`)).toBe('canvas');
    expect(JSON.parse(storage.data.get(`tabletop:r1:canvas-layout:${key}`)!)).toEqual({
      positions: { 'table.view.a': { x: 12, y: 34, pinned: true } },
      viewport: { centerX: 5, centerY: 6, zoom: 1.2 },
    });

    expect([...state.starred(key)]).toEqual(['table.view.a']);
    expect([...state.hidden(key)]).toEqual(['table.rules']);
    expect([...state.seen(key)]).toEqual(['table.view.a']);
    expect(state.cardSizes(key)).toEqual({ 'table.view.a': { width: 640, height: 320 } });
    expect(state.sortMode(key)).toBe('canvas');
    expect(state.layout(key)).toEqual({
      positions: { 'table.view.a': { x: 12, y: 34, pinned: true } },
      viewport: { centerX: 5, centerY: 6, zoom: 1.2 },
    });
    expect(storage.data.size).toBe(6);
  });

  it('falls back to defaults for corrupt, wrong-shaped or foreign values', () => {
    const storage = memoryStorage({
      [`tabletop:r1:canvas-starred:${key}`]: '{"not":"an array"}',
      [`tabletop:r1:canvas-hidden:${key}`]: 'not json at all',
      [`tabletop:r1:canvas-seen:${key}`]: '[1,2,3]',
      [`tabletop:r1:canvas-size:${key}`]: '[]',
      [`tabletop:r1:canvas-sort:${key}`]: 'updated-desc-from-a-future-build',
      [`tabletop:r1:canvas-layout:${key}`]: '{"positions":{"bad":{"x":"nope"}},"viewport":{"centerX":"x"}}',
    });
    const state = createCanvasViewState(storage);

    expect([...state.starred(key)]).toEqual([]);
    expect([...state.hidden(key)]).toEqual([]);
    expect([...state.seen(key)]).toEqual([]);
    expect(state.cardSizes(key)).toEqual({});
    expect(state.sortMode(key)).toBe('created-desc');
    expect(state.layout(key)).toEqual({ positions: {} });
  });

  it('keeps the storage caps and drops values outside the declared bounds', () => {
    const storage = memoryStorage();
    const state = createCanvasViewState(storage);

    const many = new Set(Array.from({ length: 250 }, (_, index) => `table.view.${index}`));
    state.saveStarred(key, many);
    expect(JSON.parse(storage.data.get(`tabletop:r1:canvas-starred:${key}`)!)).toHaveLength(200);
    expect([...state.starred(key)]).toHaveLength(200);

    state.saveCardSizes(key, {
      'table.view.small': { width: 10, height: 320 },
      'table.view.huge': { width: 5000, height: 320 },
      'table.view.ok': { width: 640, height: 320 },
      [`x${'a'.repeat(300)}`]: { width: 640, height: 320 },
    } as never);
    expect(Object.keys(state.cardSizes(key))).toEqual(['table.view.ok']);

    state.saveLayout(key, {
      positions: { ok: { x: 1, y: 2 }, far: { x: 200_000, y: 0 }, unpinned: { x: 3, y: 4, pinned: false } },
      viewport: { centerX: 0, centerY: 0, zoom: 9 },
    });
    expect(state.layout(key)).toEqual({
      positions: { ok: { x: 1, y: 2, pinned: true }, unpinned: { x: 3, y: 4, pinned: false } },
      viewport: { centerX: 0, centerY: 0, zoom: 1.7 },
    });
  });

  it('removes the hidden key when nothing is hidden and tolerates a broken storage', () => {
    const storage = memoryStorage({ [`tabletop:r1:canvas-hidden:${key}`]: '["table.rules"]' });
    const state = createCanvasViewState(storage);
    state.saveHidden(key, new Set());
    expect(storage.data.has(`tabletop:r1:canvas-hidden:${key}`)).toBe(false);

    const broken: CanvasStorage = {
      getItem: vi.fn(() => { throw new Error('blocked'); }),
      setItem: vi.fn(() => { throw new Error('quota'); }),
      removeItem: vi.fn(() => { throw new Error('blocked'); }),
    };
    const blocked = createCanvasViewState(broken);
    expect([...blocked.starred(key)]).toEqual([]);
    expect(blocked.cardSizes(key)).toEqual({});
    expect(blocked.layout(key)).toEqual({ positions: {} });
    expect(() => blocked.saveHidden(key, new Set(['x']))).not.toThrow();
    expect(() => blocked.saveLayout(key, { positions: {} })).not.toThrow();
  });

  it('works without storage (server render or private mode) and never throws', () => {
    const state = createCanvasViewState(null);
    expect([...state.starred('other')]).toEqual([]);
    expect(state.cardSizes('other')).toEqual({});
    expect(state.sortMode('other')).toBe('created-desc');
    expect(state.layout('other')).toEqual({ positions: {} });
    expect(() => state.saveSeen('other', new Set(['a']))).not.toThrow();
  });

  it('exposes one position predicate for stored and shared layouts', () => {
    expect(isCanvasPosition({ x: 1, y: 2 })).toBe(true);
    expect(isCanvasPosition({ x: 1, y: 2, pinned: false })).toBe(true);
    expect(isCanvasPosition({ x: 1, y: 2, pinned: 'yes' })).toBe(false);
    expect(isCanvasPosition({ x: Number.NaN, y: 2 })).toBe(false);
    expect(isCanvasPosition({ x: 1e9, y: 0 })).toBe(false);
    expect(isCanvasPosition(null)).toBe(false);
  });

  // F083: two tabs of one table each held their own copy and wrote it back whole, so an old tab re-closed cards.
  it('opens and closes cards against what is stored, so an older tab cannot undo another tab', () => {
    const storage = memoryStorage();
    const tabA = createCanvasViewState(storage);
    const tabB = createCanvasViewState(storage);
    tabA.saveHidden(key, new Set(['table.collection.tasks', 'table.rules']));

    expect([...tabB.changeHidden(key, { show: ['table.collection.tasks'] })]).toEqual(['table.rules']);
    expect([...tabA.changeHidden(key, { hide: ['table.actions'] })]).toEqual(['table.rules', 'table.actions']);
    expect([...tabA.changeHidden(key, { show: ['table.rules', 'table.actions'] })]).toEqual([]);
    expect(storage.data.has(`tabletop:r1:canvas-hidden:${key}`)).toBe(false);
    expect(tabA.isHiddenKey(key, `tabletop:r1:canvas-hidden:${key}`)).toBe(true);
    expect(tabA.isHiddenKey(key, `tabletop:r1:canvas-seen:${key}`)).toBe(false);
    expect(tabA.isHiddenKey(key, null)).toBe(true);
  });

  it('closes raw tables only on the first look, and keeps a card made later open', () => {
    const ids = ['table.view.total', 'table.collection.receipts', 'table.rules', 'table.actions', 'workspace.people'];
    expect(cardsClosedOnFirstLook(ids, ids, new Set())).toEqual(['table.collection.receipts', 'table.rules', 'table.actions', 'workspace.people']);
    // No summary view yet: nothing to open on, so nothing closes.
    expect(cardsClosedOnFirstLook(['table.collection.receipts'], ['table.collection.receipts'], new Set())).toEqual([]);
    // The AI adds a tasks table to a table this browser has already seen.
    const later = [...ids, 'table.collection.tasks'];
    expect(cardsClosedOnFirstLook(later, ['table.collection.tasks'], new Set(ids))).toEqual([]);
  });
});
