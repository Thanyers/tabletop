import type { WorkspaceView } from '../shared/contracts';
import { sharedChatCanvasId } from '../shared/canvas-layout-ids';
import { VISIBILITY_POLICY } from '../shared/visibility';
import { parseChatFollowUps, type ChatCard, type ChatFollowUp } from './table-chat-state';

/**
 * F078-T15: the private chat state and the chat canvas ids used to live as
 * localStorage helpers inside `useTableChat`. They are one module now, so the
 * hook keeps React state and the storage format has a single owner.
 *
 * "Private" is literal: closed cards, job→card ids and follow-up links belong to
 * this browser, while the server's chat history stays authoritative. Behavior is
 * preserved deliberately — the same key, the same 80-entry caps, the same
 * fallbacks when a value is unreadable, and writes stay best-effort.
 */

/** Newest entries kept per list; older ones are dropped, matching the previous hook. */
export const LOCAL_CARD_IDS = 80;

export type PrivateChatStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface PrivateChatLocalState {
  dismissed: string[];
  cardIdsByJob: Record<string, string>;
  /** F070: which card each follow-up came from, keyed by the follow-up card id. */
  followUps: Record<string, ChatFollowUp>;
}

export interface PrivateChatStore {
  scopeFor(view: WorkspaceView | null): string;
  chatNodeId(scope: string, id: string): string;
  chatCardNodeId(scope: string, card: ChatCard): string;
  load(scope: string): PrivateChatLocalState;
  save(scope: string, state: PrivateChatLocalState): void;
  rememberJobCard(scope: string, jobId: string, cardId: string): void;
  rememberFollowUp(scope: string, cardId: string, link: ChatFollowUp): void;
  isDismissed(card: ChatCard, state: PrivateChatLocalState): boolean;
  dismiss(card: ChatCard, state: PrivateChatLocalState): PrivateChatLocalState;
}

const emptyState = (): PrivateChatLocalState => ({ dismissed: [], cardIdsByJob: {}, followUps: {} });

function storageKey(scope: string): string {
  return `tabletop:r1:private-chat:${encodeURIComponent(scope)}`;
}

/** The server job's shared card id under open visibility; otherwise a private per-viewer id. */
export function persistentCardId(card: ChatCard): string {
  return card.job?.id ?? card.modelJob?.id ?? card.id;
}

export function createPrivateChatStore(storage: PrivateChatStorage | null): PrivateChatStore {
  function read(scope: string): PrivateChatLocalState {
    if (!scope || !storage) return emptyState();
    try {
      const raw = storage.getItem(storageKey(scope));
      if (!raw) return emptyState();
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return emptyState();
      const candidate = parsed as { dismissed?: unknown; cardIdsByJob?: unknown; followUps?: unknown };
      const dismissed = Array.isArray(candidate.dismissed)
        ? candidate.dismissed.filter((id): id is string => typeof id === 'string').slice(-LOCAL_CARD_IDS)
        : [];
      const cardIdsByJob: Record<string, string> = {};
      if (typeof candidate.cardIdsByJob === 'object' && candidate.cardIdsByJob !== null && !Array.isArray(candidate.cardIdsByJob)) {
        for (const [jobId, cardId] of Object.entries(candidate.cardIdsByJob)) {
          if (typeof cardId === 'string' && jobId.length <= 160 && cardId.length <= 240) cardIdsByJob[jobId] = cardId;
        }
      }
      return {
        dismissed,
        cardIdsByJob: Object.fromEntries(Object.entries(cardIdsByJob).slice(-LOCAL_CARD_IDS)),
        followUps: parseChatFollowUps(candidate.followUps, LOCAL_CARD_IDS),
      };
    } catch {
      return emptyState();
    }
  }

  function write(scope: string, state: PrivateChatLocalState): void {
    if (!scope || !storage) return;
    try {
      storage.setItem(storageKey(scope), JSON.stringify({
        dismissed: state.dismissed.slice(-LOCAL_CARD_IDS),
        cardIdsByJob: Object.fromEntries(Object.entries(state.cardIdsByJob).slice(-LOCAL_CARD_IDS)),
        followUps: Object.fromEntries(Object.entries(state.followUps).slice(-LOCAL_CARD_IDS)),
      }));
    } catch {
      // Local closed state is a convenience; server history remains authoritative.
    }
  }

  return {
    scopeFor(view) {
      return view ? JSON.stringify([view.id, view.epoch, view.actor.actorId]) : '';
    },
    chatNodeId(scope, id) {
      return `chat.${encodeURIComponent(scope)}.${id}`;
    },
    chatCardNodeId(scope, card) {
      const jobId = card.job?.id ?? card.modelJob?.id;
      const shared = VISIBILITY_POLICY === 'open' && jobId ? sharedChatCanvasId(jobId) : null;
      return shared ?? `chat.${encodeURIComponent(scope)}.${card.id}`;
    },
    load: read,
    save: write,
    rememberJobCard(scope, jobId, cardId) {
      const local = read(scope);
      write(scope, { ...local, cardIdsByJob: { ...local.cardIdsByJob, [jobId]: cardId } });
    },
    rememberFollowUp(scope, cardId, link) {
      const local = read(scope);
      write(scope, { ...local, followUps: { ...local.followUps, [cardId]: link } });
    },
    isDismissed(card, state) {
      return state.dismissed.includes(persistentCardId(card));
    },
    dismiss(card, state) {
      const persistentId = persistentCardId(card);
      return { ...state, dismissed: [...new Set([...state.dismissed, persistentId])].slice(-LOCAL_CARD_IDS) };
    },
  };
}
