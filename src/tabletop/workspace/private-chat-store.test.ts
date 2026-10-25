import { describe, expect, it } from 'vitest';
import type { ChatCard } from './table-chat-state';
import { createPrivateChatStore, LOCAL_CARD_IDS, type PrivateChatStorage } from './private-chat-store';
import { VISIBILITY_POLICY } from '../shared/visibility';
import { sharedChatCanvasId } from '../shared/canvas-layout-ids';
import type { WorkspaceView } from '../shared/contracts';

/**
 * F078-T15: the private chat state (closed cards, job→card ids, follow-up links)
 * and the chat canvas ids lived inside `useTableChat`'s localStorage helpers.
 * They are a module now, with the same key, caps and fallbacks.
 */

function memoryStorage(initial: Record<string, string> = {}): PrivateChatStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
  };
}

function card(overrides: Partial<ChatCard> = {}): ChatCard {
  return { id: 'card-1', kind: 'draft', prompt: 'make a table', createdAt: 1, phase: 'complete', ...overrides } as ChatCard;
}

function tableView(): WorkspaceView {
  return { id: 'table-1', epoch: 4, kind: 'table', actor: { actorId: 'actor-1', role: 'owner', name: 'Owner' } } as unknown as WorkspaceView;
}

const scope = JSON.stringify(['table-1', 4, 'actor-1']);

describe('private chat store', () => {
  it('derives the per-viewer scope and canvas ids', () => {
    const store = createPrivateChatStore(memoryStorage());
    expect(store.scopeFor(tableView())).toBe(scope);
    expect(store.scopeFor(null)).toBe('');
    expect(store.chatNodeId(scope, 'card-1')).toBe(`chat.${encodeURIComponent(scope)}.card-1`);
  });

  it('shares a canvas id only when a job exists and visibility is open', () => {
    const store = createPrivateChatStore(memoryStorage());
    const jobId = 'a'.repeat(64);
    const withJob = store.chatCardNodeId(scope, card({ job: { id: jobId } as ChatCard['job'] }));
    if (VISIBILITY_POLICY === 'open') {
      expect(withJob).toBe(sharedChatCanvasId(jobId));
      expect(withJob).toBe(`table.chat.${jobId}`);
    } else {
      expect(withJob).toBe(`chat.${encodeURIComponent(scope)}.card-1`);
    }
    expect(store.chatCardNodeId(scope, card())).toBe(`chat.${encodeURIComponent(scope)}.card-1`);
    // a job id that is not a 64-char hex token falls back to the private id
    expect(store.chatCardNodeId(scope, card({ job: { id: 'short' } as ChatCard['job'] }))).toBe(`chat.${encodeURIComponent(scope)}.card-1`);
  });

  it('round-trips the local state under the private-chat key and caps it', () => {
    const storage = memoryStorage();
    const store = createPrivateChatStore(storage);
    const followUps = Object.fromEntries(Array.from({ length: 3 }, (_, index) => [`card-${index}`, { parentCardId: 'parent', option: `option-${index}` }]));
    store.save(scope, { dismissed: ['card-1', 'card-1'], cardIdsByJob: { 'job-1': 'card-1' }, followUps });

    expect(storage.data.has(`tabletop:r1:private-chat:${encodeURIComponent(scope)}`)).toBe(true);
    const loaded = store.load(scope);
    // save/load preserves the list as given; de-duplication belongs to dismiss()\n    expect(loaded.dismissed).toEqual(['card-1', 'card-1']);
    expect(loaded.cardIdsByJob).toEqual({ 'job-1': 'card-1' });
    expect(loaded.followUps).toEqual(followUps);

    const many = Object.fromEntries(Array.from({ length: LOCAL_CARD_IDS + 20 }, (_, index) => [`job-${index}`, `card-${index}`]));
    store.save(scope, { dismissed: [], cardIdsByJob: many, followUps: {} });
    expect(Object.keys(store.load(scope).cardIdsByJob)).toHaveLength(LOCAL_CARD_IDS);
  });

  it('falls back to an empty state for corrupt or foreign values', () => {
    const store = createPrivateChatStore(memoryStorage({
      [`tabletop:r1:private-chat:${encodeURIComponent(scope)}`]: '{"dismissed":"nope","cardIdsByJob":[1,2],"followUps":7}',
    }));
    expect(store.load(scope)).toEqual({ dismissed: [], cardIdsByJob: {}, followUps: {} });
    expect(createPrivateChatStore(memoryStorage({ [`tabletop:r1:private-chat:${encodeURIComponent(scope)}`]: 'not json' })).load(scope))
      .toEqual({ dismissed: [], cardIdsByJob: {}, followUps: {} });
  });

  it('remembers a job card and a follow-up without dropping what is already stored', () => {
    const storage = memoryStorage();
    const store = createPrivateChatStore(storage);
    store.rememberJobCard(scope, 'job-1', 'card-1');
    store.rememberFollowUp(scope, 'card-1', { parentCardId: 'parent', option: 'yes' });
    store.rememberJobCard(scope, 'job-2', 'card-2');

    const loaded = store.load(scope);
    expect(loaded.cardIdsByJob).toEqual({ 'job-1': 'card-1', 'job-2': 'card-2' });
    expect(loaded.followUps).toEqual({ 'card-1': { parentCardId: 'parent', option: 'yes' } });
  });

  it('matches a dismissal by job id first, then model job id, then card id', () => {
    const store = createPrivateChatStore(memoryStorage());
    const state = { dismissed: ['job-1', 'model-2', 'card-3'], cardIdsByJob: {}, followUps: {} };
    expect(store.isDismissed(card({ job: { id: 'job-1' } as ChatCard['job'], id: 'other' }), state)).toBe(true);
    expect(store.isDismissed(card({ modelJob: { id: 'model-2' } as ChatCard['modelJob'], id: 'other' }), state)).toBe(true);
    expect(store.isDismissed(card({ id: 'card-3' }), state)).toBe(true);
    expect(store.isDismissed(card({ id: 'card-4' }), state)).toBe(false);
  });

  it('appends a dismissal once and keeps the newest ids', () => {
    const store = createPrivateChatStore(memoryStorage());
    const first = store.dismiss(card(), { dismissed: [], cardIdsByJob: {}, followUps: {} });
    expect(first.dismissed).toEqual(['card-1']);
    const again = store.dismiss(card(), first);
    expect(again.dismissed).toEqual(['card-1']);
    const full = { ...again, dismissed: Array.from({ length: LOCAL_CARD_IDS }, (_, index) => `old-${index}`) };
    const capped = store.dismiss(card(), full);
    expect(capped.dismissed).toHaveLength(LOCAL_CARD_IDS);
    expect(capped.dismissed.at(-1)).toBe('card-1');
  });

  it('works without storage and survives a storage that throws', () => {
    const none = createPrivateChatStore(null);
    expect(none.load(scope)).toEqual({ dismissed: [], cardIdsByJob: {}, followUps: {} });
    expect(() => none.save(scope, { dismissed: [], cardIdsByJob: {}, followUps: {} })).not.toThrow();

    const broken: PrivateChatStorage = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('quota'); },
    };
    const store = createPrivateChatStore(broken);
    expect(store.load(scope)).toEqual({ dismissed: [], cardIdsByJob: {}, followUps: {} });
    expect(() => store.rememberJobCard(scope, 'job', 'card')).not.toThrow();
  });
});
