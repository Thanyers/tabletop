import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, CornerDownRight, LoaderCircle, MessageCircleQuestion, RotateCcw, Sparkles, X } from 'lucide-react';
import { ApiFailure, type ModelJob } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantHistoryPage, TableAssistantJob, TableAssistantReference } from '../shared/table-assistant-contracts';
import type { TableState } from '../shared/table-contracts';
import type { ComputeRuntimeCapabilities } from '../shared/compute-runtime-profiles';
import { sharedChatCanvasId } from '../shared/canvas-layout-ids';
import { VISIBILITY_POLICY } from '../shared/visibility';
import type { CanvasAuxiliaryObject } from './CanvasWorkspace';
import { TableChat, type ComposerTools } from './TableChat';
import { MAX_CHAT_CARD_REFERENCES, chatReferencePrompt, followUpPrompt, parseReferencedPrompt, onChatCardReference, splitReferencedPrompt, type ChatCardReference } from './canvas-object-finder';
import { tableDraftBytes } from '../shared/table-draft-input';
import { TABLE_AI_INPUT_BYTES } from '../domain/table';
import { ClarificationAnswers } from './ClarificationAnswers';
import { rememberConsent } from './table-chat-consent';
import { createPrivateChatStore, type PrivateChatStorage } from '../workspace/private-chat-store';
import { viewerCan } from '../shared/permissions';
import { addableWebSources, chosenFollowUps, draftFailureSummary, draftHistoryCard, draftInFlight, draftLimitSeconds, draftPartialLabel, draftPollLimitMs, draftRefreshPatch, draftSources, draftSourcesLabel, draftStopReason, draftThinkingLabel, historyCard, isUncertainRequest, liveSearchParts, liveThinkingLine, mergeChatHistory, nextQueuedDraft, sameChatRequestScope, tableChatMode, type ChatCard, type ChatFollowUp } from '../workspace/table-chat-state';

type TableView = WorkspaceView & { kind: 'table'; domain: TableState };
type CommandId = ReturnType<typeof crypto.randomUUID>;

const DRAFT_POLL_MS = 1_200;
// F045: a draft is polled past its configured server limit (240s by default, at most 300s) so the
// asker always sees the final status; draftPollLimitMs() adds the 70s grace to the reported limit.
// (Was a fixed 250s, which stopped polling early once a longer limit was configured.)
const ANSWER_POLL_MS = 1_000;
const ANSWER_POLL_LIMIT_MS = 250_000;
const HISTORY_CARDS = 6;
const DRAFT_HISTORY_CARDS = 5;

/** Browser storage can be blocked (private mode, policy); chat state then lives in memory only. */
function chatStorage(): PrivateChatStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const chatStore = createPrivateChatStore(chatStorage());
const ACCEPT_FILES = '.csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown';

export interface UseTableChatOptions {
  view: WorkspaceView | null;
  aiEnabled: boolean;
  assistantAvailable?: boolean;
  computeCapabilities?: ComputeRuntimeCapabilities;
  readOnly: boolean;
  busy?: boolean;
  requestDraft: (view: WorkspaceView, prompt: string, commandId: CommandId) => Promise<ModelJob>;
  pollDraft: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  refresh: (workspaceId: string) => Promise<void>;
  ask: (view: TableView, prompt: string, commandId: CommandId, sameCommandRetry?: boolean) => Promise<TableAssistantJob>;
  pollAsk: (view: TableView, jobId: string) => Promise<TableAssistantJob>;
  loadHistory: (view: TableView) => Promise<TableAssistantHistoryPage>;
  /** Every member's rule requests (open visibility, F034); omitted where not supported. */
  loadDraftHistory?: (view: TableView) => Promise<ModelJob[]>;
  /** Changes when the table's AI chat changed elsewhere; reloads history quietly. */
  historyRefreshKey?: number;
  confirm: (view: TableView, job: TableAssistantJob, commandId: CommandId) => Promise<void>;
  attach: (view: WorkspaceView, file: File) => Promise<WorkspaceView>;
  focusObject: (id: string) => void;
  /** F064 slice C: the server can store researched web sources and review them. */
  webEvidence?: boolean;
  /** F064 slice C: offer the finished draft's researched sources as provided table sources. */
  addWebSources?: (view: WorkspaceView, sources: ReturnType<typeof addableWebSources>) => Promise<void>;
  /** F076: note and picture tools for the composer's + menu. */
  composerTools?: ComposerTools;
  /** A short notification; the optional action (e.g. View rules) shows as a button on it. */
  notify: (text: string, tone: 'info' | 'error' | 'success', action?: { label: string; run: () => void }) => void;
  prefill?: { text: string; key: number };
}

function isTableView(view: WorkspaceView | null): view is TableView {
  return Boolean(view && view.kind === 'table' && view.domain.kind === 'table');
}

const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function errorText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'STALE_REVISION' || error.code === 'STALE_EPOCH' || error.conflict) return 'The table changed. Review its latest state and try again.';
    if (error.code === 'TABLE_READ_ONLY') return 'This table is temporarily read-only.';
    if (error.status === 0) return 'The connection was lost before the request could be confirmed. Retry the same request to check its status.';
  }
  if (error instanceof Error && error.message) {
    return error instanceof ApiFailure && error.code ? `${error.message} (server code ${error.code})` : error.message;
  }
  return 'The request could not be completed. Try again.';
}

function isUncertain(error: unknown): boolean {
  return error instanceof ApiFailure && error.status === 0;
}

/** The card keeps counting while the answer is in flight, so a slow request never looks frozen. */
const ASSISTANT_DEADLINE_SECONDS = 180;
function ElapsedLabel({ startedAt, kind, limitMs, chars, reasoningChars }: { startedAt: number; kind: ChatCard['kind']; limitMs?: number; chars?: number; reasoningChars?: number }) {
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.round((Date.now() - startedAt) / 1000)));
  useEffect(() => {
    const timer = window.setInterval(() => setSeconds(Math.max(0, Math.round((Date.now() - startedAt) / 1000))), 1000);
    return () => window.clearInterval(timer);
  }, [startedAt]);
  // F045: a rule draft names its configured stop (default 240s); an answer keeps the 180s path.
  // The client polls past it (draftPollLimitMs), so the label waits for the server's final status.
  const limit = kind === 'draft' ? draftLimitSeconds({ limitMs }) : ASSISTANT_DEADLINE_SECONDS;
  return <span className="tt-chat-card__elapsed" aria-live="off">
    <span className="tt-chat-card__elapsed-time">{seconds}s</span>
    <span> / {limit}s server limit</span>
    {reasoningChars !== undefined && reasoningChars > 0 && <span> · thinking {reasoningChars.toLocaleString()} chars</span>}
    {chars !== undefined && chars > 0 && <span> · answer {chars.toLocaleString()} chars</span>}
    {seconds >= limit && <strong> · waiting for the final status from the server…</strong>}
  </span>;
}

/** Under open visibility a card with a server job uses the job's shared id, so everyone moves the same card (F034). */

function shortTitle(title: string): string {
  return title.length > 48 ? `${title.slice(0, 47)}…` : title;
}

function modelPhase(job: ModelJob): ChatCard['phase'] {
  if (job.status === 'failed') return 'failed';
  if (job.status === 'completed' || job.status === 'complete') return 'complete';
  return 'waiting';
}

function jobPhase(job: TableAssistantJob): ChatCard['phase'] {
  if (job.status === 'failed') return 'failed';
  if (job.status === 'completed') return 'complete';
  return 'waiting';
}

function objectForReference(reference: TableAssistantReference): string {
  if (reference.kind === 'rule') return 'table.rules';
  if (reference.kind === 'action' || reference.kind === 'turn') return 'table.actions';
  return `table.collection.${reference.collectionId}`;
}

function proposalIsStale(job: TableAssistantJob, view: TableView): boolean {
  if (job.result?.kind !== 'action-proposal') return true;
  return job.expectedEpoch !== view.epoch
    || job.expectedRevision !== view.revision
    || job.result.expectedRevision !== view.revision
    || job.result.expectedRuleRevision !== view.domain.ruleRevision
    || job.result.expectedActionRevision !== view.domain.actionRevision;
}

function isPendingAction(card: ChatCard, view: TableView): boolean {
  const job = card.job;
  const proposal = job?.result;
  if (!job || job.status !== 'completed' || job.confirmationStatus !== 'available' || proposal?.kind !== 'action-proposal' || proposalIsStale(job, view)) return false;
  const action = view.domain.program?.actions.find((item) => item.id === proposal.actionId);
  return Boolean(action && action.roles.includes(view.actor.role as 'owner' | 'participant'));
}

function actorHasTurn(view: TableView, requireTurn: boolean): boolean {
  if (!requireTurn) return true;
  const seat = view.actor.role === 'owner' ? 'host' : view.actor.seat;
  return Boolean(seat && view.domain.turn === seat);
}

/** Owners can draft a table from text alone; every active answer remains private to the current actor. */
export function useTableChat(options: UseTableChatOptions): { bar: ReactNode; cards: CanvasAuxiliaryObject[]; editRules: (prompt?: string) => void; cancelEditRules: () => void } {
  const { view, aiEnabled, readOnly } = options;
  const table = isTableView(view) ? view : null;
  const scope = chatStore.scopeFor(table);
  const assistantAvailable = options.assistantAvailable !== false;
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const viewRef = useRef(table);
  viewRef.current = table;
  const [cardState, setCardState] = useState<{ scope: string; cards: ChatCard[] }>({ scope: '', cards: [] });
  const cardStateRef = useRef(cardState);
  cardStateRef.current = cardState;
  const [historyState, setHistoryState] = useState<{ scope: string; status: 'loading' | 'ready' | 'error' }>({ scope: '', status: 'loading' });
  const historyGeneration = useRef(0);
  const requestLock = useRef(false);
  // F038: the queued rule request being started, so one queue step never starts twice.
  const queueStartLock = useRef<string | null>(null);
  const confirmLocks = useRef(new Set<string>());
  const draftRefreshLocks = useRef(new Set<string>());
  // A settled draft is refreshed once; the POST response and the poll can both report completion.
  const refreshedDraftJobs = useRef(new Set<string>());
  const isBlockedRef = useRef(false);
  const [explicitDraftScope, setExplicitDraftScope] = useState<string | null>(null);
  const explicitDraftScopeRef = useRef<string | null>(null);
  const explicitDraftEntryRef = useRef<{ scope: string; ruleRevision: number; candidateId: string | null } | null>(null);
  explicitDraftScopeRef.current = explicitDraftScope;
  const [focusKey, setFocusKey] = useState(0);
  const [acknowledgedRetry, setAcknowledgedRetry] = useState<{ prompt: string; key: string }>();
  const [retryPrefill, setRetryPrefill] = useState<{ text: string; key: number }>();
  const [composerMessage, setComposerMessage] = useState('');
  // Cards and exact rules the person pointed the chat at; the next message is about all of them.
  const [cardReferences, setCardReferences] = useState<ChatCardReference[]>([]);
  const cardReferencesRef = useRef(cardReferences);
  cardReferencesRef.current = cardReferences;
  const [referenceFocusKey, setReferenceFocusKey] = useState(0);
  useEffect(() => onChatCardReference((reference) => {
    // Ask on a rule is an explicit return to question mode; Change then calls editRules()
    // synchronously after this callback and enters draft mode for that exact rule.
    if (reference.rule) {
      explicitDraftScopeRef.current = null;
      explicitDraftEntryRef.current = null;
      setExplicitDraftScope(null);
    }
    // Pointing at another card adds it; pointing at one already listed keeps the list as it is.
    setCardReferences((current) => current.some((item) => item.id === reference.id)
      ? current
      : [...current, reference].slice(-MAX_CHAT_CARD_REFERENCES));
    setReferenceFocusKey((key) => key + 1);
  }), []);

  const updateCards = useCallback((targetScope: string, update: (current: ChatCard[]) => ChatCard[]) => {
    if (!targetScope || targetScope !== scopeRef.current) return;
    const current = cardStateRef.current.scope === targetScope ? cardStateRef.current.cards : [];
    const next = update(current);
    const nextState = { scope: targetScope, cards: next };
    cardStateRef.current = nextState;
    setCardState(nextState);
  }, []);

  const patchCard = useCallback((targetScope: string, id: string, change: Partial<ChatCard>) => {
    updateCards(targetScope, (current) => current.map((card) => card.id === id ? { ...card, ...change } : card));
  }, [updateCards]);

  const loadHistory = useCallback(async (targetScope: string, { quiet = false }: { quiet?: boolean } = {}) => {
    const current = viewRef.current;
    if (!current || targetScope !== scopeRef.current) return;
    const generation = ++historyGeneration.current;
    // A quiet refresh keeps the composer usable and does not flash a loading state.
    if (!quiet) setHistoryState({ scope: targetScope, status: 'loading' });
    try {
      const [page, drafts] = await Promise.all([
        optionsRef.current.loadHistory(current),
        optionsRef.current.loadDraftHistory ? optionsRef.current.loadDraftHistory(current).catch(() => [] as ModelJob[]) : Promise.resolve([] as ModelJob[]),
      ]);
      if (targetScope !== scopeRef.current || generation !== historyGeneration.current) return;
      const local = chatStore.load(targetScope);
      const dismissed = new Set(local.dismissed);
      const jobs = [...page.items].sort((left, right) => right.createdAt - left.createdAt).slice(0, HISTORY_CARDS);
      // Requests stored before prompts were kept (pre-F034) have nothing to show; keep the newest few.
      const draftJobs = drafts.filter((job) => typeof job.prompt === 'string' && job.prompt.length > 0)
        .sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0)).slice(0, DRAFT_HISTORY_CARDS);
      const incoming = [
        ...jobs.filter((job) => !dismissed.has(job.id)).map((job) => historyCard(job, local.cardIdsByJob[job.id] ?? `answer-${job.id}`)),
        ...draftJobs.filter((job) => !dismissed.has(job.id)).map((job) => draftHistoryCard(job, local.cardIdsByJob[job.id] ?? `draft-${job.id}`)),
      ];
      let merged: ChatCard[] = [];
      updateCards(targetScope, (cards) => {
        merged = mergeChatHistory(cards, incoming);
        return merged;
      });
      const cardIdsByJob = { ...local.cardIdsByJob };
      for (const job of jobs) {
        const card = merged.find((item) => item.job?.id === job.id);
        if (card) cardIdsByJob[job.id] = card.id;
      }
      for (const job of draftJobs) {
        const card = merged.find((item) => item.modelJob?.id === job.id);
        if (card) cardIdsByJob[job.id] = card.id;
      }
      chatStore.save(targetScope, { ...local, cardIdsByJob });
      setHistoryState({ scope: targetScope, status: 'ready' });
    } catch {
      if (!quiet && targetScope === scopeRef.current && generation === historyGeneration.current) setHistoryState({ scope: targetScope, status: 'error' });
    }
  }, [updateCards]);

  useEffect(() => {
    if (cardStateRef.current.scope !== scope) updateCards(scope, () => []);
    explicitDraftScopeRef.current = null;
    explicitDraftEntryRef.current = null;
    setExplicitDraftScope(null);
    setAcknowledgedRetry(undefined);
    setRetryPrefill(undefined);
    setComposerMessage('');
    setCardReferences([]);
  }, [scope, updateCards]);

  useEffect(() => {
    if (!viewRef.current || !assistantAvailable) {
      setHistoryState({ scope, status: 'ready' });
      return;
    }
    void loadHistory(scope);
    return () => { historyGeneration.current += 1; };
  }, [scope, assistantAvailable, loadHistory]);

  const historyRefreshKey = options.historyRefreshKey ?? 0;
  const seenRefreshKey = useRef(historyRefreshKey);
  useEffect(() => {
    if (historyRefreshKey === seenRefreshKey.current) return;
    seenRefreshKey.current = historyRefreshKey;
    if (viewRef.current && assistantAvailable) void loadHistory(scope, { quiet: true });
  }, [historyRefreshKey, scope, assistantAvailable, loadHistory]);

  const cards = useMemo(() => cardState.scope === scope ? cardState.cards : [], [cardState, scope]);
  const mode = table ? tableChatMode(viewerCan(table, 'rules.draft') ? 'owner' : 'participant', Boolean(table.domain.program), explicitDraftScope === scope, {
    prompt: composerMessage,
    referencedCard: cardReferences.some((reference) => !reference.rule),
    referencedRule: cardReferences.some((reference) => Boolean(reference.rule)),
    hasCreateAction: table.domain.program?.actions.some(action => Boolean(action.creates?.length)) ?? false,
  }) : 'ask';
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const historyStatus = historyState.scope === scope ? historyState.status : 'loading';
  const externalBusy = options.busy === true;
  // F038: questions run in parallel and rule requests queue, so a running request no longer blocks
  // Send. Confirming an action, an unconfirmed request and a proposal awaiting a decision still do.
  const confirmBusy = cards.some((card) => card.confirming || card.confirmationPending);
  const uncertainRequest = cards.some(isUncertainRequest);
  const pendingAction = table ? cards.some((card) => isPendingAction(card, table)) : false;
  const sendBlocked = externalBusy || confirmBusy || uncertainRequest || pendingAction;
  isBlockedRef.current = sendBlocked;

  useEffect(() => {
    if (!table || explicitDraftScope !== scope || !viewerCan(table, 'rules.draft')) return;
    const entry = explicitDraftEntryRef.current;
    const candidate = table.domain.candidate;
    if (entry?.scope === scope && candidate?.status === 'active' && (table.domain.ruleRevision > entry.ruleRevision || candidate.id !== entry.candidateId)) {
      explicitDraftScopeRef.current = null;
      explicitDraftEntryRef.current = null;
      setExplicitDraftScope(null);
    }
  }, [scope, explicitDraftScope, table]);

  const modeChatCards = useMemo(() => cards.filter((card) => !chatStore.isDismissed(card, chatStore.load(scope))), [cards, scope]);

  const activePollCards = modeChatCards.filter((card) => {
    if (card.pollTimedOut) return false;
    if (card.kind === 'draft') return Boolean(card.modelJob && (card.modelJob.status === 'queued' || card.modelJob.status === 'running'));
    return Boolean(card.job && (card.job.status === 'running' || card.job.confirmationStatus === 'processing'));
  });
  const activePollKey = activePollCards.map((card) => `${card.id}:${card.modelJob?.id ?? card.job?.id ?? ''}:${card.job?.confirmationStatus ?? ''}`).join('|');

  const retryDraftRefresh = useCallback(async (targetScope: string, cardId: string, workspaceId: string) => {
    const current = viewRef.current;
    const lockKey = `${targetScope}:${cardId}`;
    if (!current || !targetScope || targetScope !== scopeRef.current || current.id !== workspaceId || draftRefreshLocks.current.has(lockKey)) return;
    draftRefreshLocks.current.add(lockKey);
    patchCard(targetScope, cardId, { checking: true });
    try {
      await optionsRef.current.refresh(workspaceId);
      const latest = viewRef.current;
      const result = draftRefreshPatch(targetScope, scopeRef.current);
      if (latest?.id === workspaceId && result) patchCard(targetScope, cardId, result);
    } catch (error) {
      const latest = viewRef.current;
      const result = draftRefreshPatch(targetScope, scopeRef.current, errorText(error));
      if (latest?.id === workspaceId && result) patchCard(targetScope, cardId, result);
    } finally {
      draftRefreshLocks.current.delete(lockKey);
    }
  }, [patchCard]);

  const refreshAfterDraft = useCallback((targetScope: string, cardId: string, workspaceId: string, jobId: string) => {
    const key = `${targetScope}:${cardId}:${jobId}`;
    if (refreshedDraftJobs.current.has(key)) return;
    refreshedDraftJobs.current.add(key);
    void retryDraftRefresh(targetScope, cardId, workspaceId);
  }, [retryDraftRefresh]);

  const pollModelOnce = useCallback(async (targetScope: string, cardId: string, workspaceId: string, jobId: string) => {
    const next = await optionsRef.current.pollDraft(workspaceId, jobId);
    if (targetScope !== scopeRef.current) return next;
    const settled = next.status === 'completed' || next.status === 'complete';
    patchCard(targetScope, cardId, {
      modelJob: next,
      phase: modelPhase(next),
      error: next.status === 'failed' ? next.message ?? 'The draft could not be prepared.' : undefined,
      // A settled poll must not wipe the follow-up refresh failure; only an in-flight poll resets it.
      ...(settled ? {} : { pollError: undefined }),
      pollTimedOut: false,
    });
    // Questions leave the table unchanged, so there is nothing to refresh.
    if ((next.status === 'completed' || next.status === 'complete') && !next.clarification) refreshAfterDraft(targetScope, cardId, workspaceId, next.id);
    return next;
  }, [patchCard, refreshAfterDraft]);

  const pollAnswerOnce = useCallback(async (targetScope: string, cardId: string, current: TableView, jobId: string) => {
    const next = await optionsRef.current.pollAsk(current, jobId);
    if (targetScope !== scopeRef.current) return next;
    const existing = cardStateRef.current.scope === targetScope
      ? cardStateRef.current.cards.find((card) => card.id === cardId)
      : undefined;
    const confirmationError = next.confirmationStatus === 'available' && existing?.confirmationPending
      ? 'No action was confirmed. Review the current table before trying again.'
      : next.confirmationStatus === 'confirmed' || next.confirmationStatus === 'stale' || next.confirmationStatus === 'rejected'
        ? undefined
        : existing?.confirmationError;
    patchCard(targetScope, cardId, {
      job: next,
      phase: jobPhase(next),
      error: next.status === 'failed' ? next.message ?? 'The assistant could not complete that request.' : undefined,
      confirmationPending: next.confirmationStatus === 'processing',
      confirming: false,
      confirmationError,
      pollError: undefined,
      pollTimedOut: false,
    });
    if (next.confirmationStatus === 'confirmed') {
      await optionsRef.current.refresh(current.id).catch(() => undefined);
      patchCard(targetScope, cardId, { confirmationPending: false, confirming: false, confirmationError: undefined });
    }
    return next;
  }, [patchCard]);

  useEffect(() => {
    if (!activePollKey) return;
    let cancelled = false;
    const startScope = scope;
    const startView = viewRef.current;
    const toPoll = cardStateRef.current.scope === startScope
      ? cardStateRef.current.cards.filter((card) => {
        if (card.pollTimedOut) return false;
        if (card.kind === 'draft') return Boolean(card.modelJob && (card.modelJob.status === 'queued' || card.modelJob.status === 'running'));
        return Boolean(card.job && (card.job.status === 'running' || card.job.confirmationStatus === 'processing'));
      }) : [];
    for (const card of toPoll) {
      const startedAt = Date.now();
      void (async () => {
        const interval = card.kind === 'draft' ? DRAFT_POLL_MS : ANSWER_POLL_MS;
        // F045: a draft outlives its poll grace only if the server raised the configured limit.
        const limit = card.kind === 'draft' ? draftPollLimitMs(card.modelJob) : ANSWER_POLL_LIMIT_MS;
        while (!cancelled && Date.now() - startedAt < limit) {
          await wait(interval);
          if (cancelled || scopeRef.current !== startScope) return;
          try {
            if (card.kind === 'draft' && card.modelJob) {
              const next = await pollModelOnce(startScope, card.id, viewRef.current?.id ?? '', card.modelJob.id);
              if (next.status === 'failed' || next.status === 'completed' || next.status === 'complete') return;
            } else if (card.job && startView) {
              const latestView = viewRef.current?.id === startView.id ? viewRef.current : startView;
              const next = await pollAnswerOnce(startScope, card.id, latestView, card.job.id);
              if (next.status === 'failed' || (next.status === 'completed' && next.confirmationStatus !== 'processing')) return;
            }
          } catch (error) {
            if (cancelled || scopeRef.current !== startScope) return;
            patchCard(startScope, card.id, { pollError: errorText(error) });
          }
        }
        if (!cancelled && scopeRef.current === startScope) patchCard(startScope, card.id, { pollTimedOut: true });
      })();
    }
    return () => { cancelled = true; };
  }, [scope, activePollKey, pollModelOnce, pollAnswerOnce, patchCard]);

  const checkStatus = useCallback(async (card: ChatCard) => {
    const current = viewRef.current;
    if (!current || card.checking || (!card.modelJob && !card.job)) return;
    patchCard(scope, card.id, { checking: true, pollError: undefined, pollTimedOut: true });
    try {
      if (card.kind === 'draft' && card.modelJob) {
        const next = await pollModelOnce(scope, card.id, current.id, card.modelJob.id);
        if (next.status === 'queued' || next.status === 'running') patchCard(scope, card.id, { pollTimedOut: true });
      } else if (card.job) {
        const next = await pollAnswerOnce(scope, card.id, current, card.job.id);
        if (next.status === 'running' || next.confirmationStatus === 'processing') patchCard(scope, card.id, { pollTimedOut: true });
      }
    } catch (error) {
      patchCard(scope, card.id, { pollError: errorText(error), pollTimedOut: true });
    } finally {
      patchCard(scope, card.id, { checking: false });
    }
  }, [scope, patchCard, pollModelOnce, pollAnswerOnce]);

  // Under open visibility the card's canvas id changes to the shared job id once the server accepts it,
  // so move the focus to the new node instead of leaving the viewport on the one that just went away.
  const focusAcceptedCard = useCallback((targetScope: string, card: ChatCard, jobId: string) => {
    if (targetScope !== scopeRef.current || card.job || card.modelJob) return;
    const shared = VISIBILITY_POLICY === 'open' ? sharedChatCanvasId(jobId) : null;
    if (shared) optionsRef.current.focusObject(shared);
  }, []);

  const acceptDraft = useCallback((targetScope: string, card: ChatCard, job: ModelJob, current: TableView) => {
    patchCard(targetScope, card.id, {
      modelJob: job,
      requestView: undefined,
      phase: modelPhase(job),
      requestError: undefined,
      requestUncertain: false,
      error: job.status === 'failed' ? job.message ?? 'The draft could not be prepared.' : undefined,
      pollTimedOut: false,
    });
    focusAcceptedCard(targetScope, card, job.id);
    if (job.status === 'completed' || job.status === 'complete') refreshAfterDraft(targetScope, card.id, current.id, job.id);
    if (current.domain.program && explicitDraftScopeRef.current === targetScope) {
      explicitDraftScopeRef.current = null;
      explicitDraftEntryRef.current = null;
      setExplicitDraftScope(null);
    }
  }, [patchCard, refreshAfterDraft, focusAcceptedCard]);

  const acceptAnswer = useCallback((targetScope: string, card: ChatCard, job: TableAssistantJob) => {
    chatStore.rememberJobCard(targetScope, job.id, card.id);
    patchCard(targetScope, card.id, {
      job,
      requestView: undefined,
      phase: jobPhase(job),
      requestError: undefined,
      requestUncertain: false,
      error: job.status === 'failed' ? job.message ?? 'The assistant could not complete that request.' : undefined,
      confirmationPending: job.confirmationStatus === 'processing',
      pollTimedOut: false,
    });
    focusAcceptedCard(targetScope, card, job.id);
  }, [patchCard, focusAcceptedCard]);

  /** Sends one card's request from the current table state; the card is already on the canvas. */
  const startRequest = useCallback(async (targetScope: string, card: ChatCard, requestView: TableView, freshView?: () => Promise<TableView | null>): Promise<boolean> => {
    const commandId = card.requestCommandId ?? crypto.randomUUID();
    patchCard(targetScope, card.id, { phase: 'sending', requestCommandId: commandId, requestView });
    try {
      if (card.kind === 'draft') {
        const accepted = await optionsRef.current.requestDraft(requestView, card.prompt, commandId);
        acceptDraft(targetScope, card, accepted, requestView);
      } else {
        const accepted = await optionsRef.current.ask(requestView, card.prompt, commandId);
        acceptAnswer(targetScope, card, accepted);
      }
      return true;
    } catch (error) {
      // A queued request may race the previous draft's refresh; read the table once more and resend as a new command.
      if (freshView && error instanceof ApiFailure && error.code === 'STALE_REVISION') {
        const latest = await freshView();
        if (latest && targetScope === scopeRef.current) return startRequest(targetScope, { ...card, requestCommandId: undefined }, latest);
      }
      patchCard(targetScope, card.id, {
        phase: 'failed',
        requestError: errorText(error),
        requestUncertain: isUncertain(error),
        requestView: isUncertain(error) ? requestView : undefined,
      });
      return false;
    }
  }, [acceptAnswer, acceptDraft, patchCard]);

  const send = useCallback(async (prompt: string, forcedMode?: 'draft', origin?: ChatFollowUp): Promise<boolean> => {
    const current = viewRef.current;
    const targetScope = scopeRef.current;
    const selectedMode = forcedMode ?? modeRef.current;
    if (!current || !targetScope || isBlockedRef.current || !optionsRef.current.aiEnabled || (selectedMode === 'ask' && optionsRef.current.assistantAvailable === false) || prompt.trim().length < 3) return false;
    if (selectedMode === 'draft' && (!viewerCan(current, 'rules.draft') || optionsRef.current.readOnly)) return false;
    const commandId = crypto.randomUUID();
    const existing = cardStateRef.current.scope === targetScope ? cardStateRef.current.cards : [];
    // F038: another rule draft is running, so this one waits its turn and starts from the table it leaves.
    const queue = selectedMode === 'draft' && (draftInFlight(existing) || existing.some((item) => item.kind === 'draft' && item.phase === 'queued'));
    const card: ChatCard = {
      id: `${selectedMode === 'draft' ? 'draft' : 'answer'}-${commandId}`,
      kind: selectedMode === 'draft' ? 'draft' : 'answer',
      prompt,
      createdAt: Date.now(),
      phase: queue ? 'queued' : 'sending',
      requestCommandId: queue ? undefined : commandId,
    };
    // F070: remember where a picked option leads before the card renders, so its line and chosen chip appear together.
    if (origin) chatStore.rememberFollowUp(targetScope, card.id, origin);
    updateCards(targetScope, (items) => [card, ...items]);
    optionsRef.current.focusObject(chatStore.chatNodeId(targetScope, card.id));
    if (queue) return true;
    return startRequest(targetScope, { ...card, requestCommandId: commandId }, structuredClone(current));
  }, [startRequest, updateCards]);

  // F038: start the oldest queued rule request once the previous draft has finished and refreshed the table.
  const queuedDraft = nextQueuedDraft(cards);
  useEffect(() => {
    if (!queuedDraft || queueStartLock.current === queuedDraft.id) return;
    const targetScope = scope;
    const current = viewRef.current;
    if (!current || targetScope !== scopeRef.current) return;
    if (!viewerCan(current, 'rules.draft') || optionsRef.current.readOnly || !optionsRef.current.aiEnabled) {
      patchCard(targetScope, queuedDraft.id, { phase: 'failed', requestError: 'This rule request could not start: the table no longer accepts rule requests from you.' });
      return;
    }
    queueStartLock.current = queuedDraft.id;
    void (async () => {
      // Read the table the previous draft left, so the request is not rejected as stale.
      await optionsRef.current.refresh(current.id).catch(() => undefined);
      const latest = viewRef.current;
      const stillQueued = cardStateRef.current.scope === targetScope
        && cardStateRef.current.cards.some((item) => item.id === queuedDraft.id && item.phase === 'queued');
      if (!latest || latest.id !== current.id || targetScope !== scopeRef.current || !stillQueued) return;
      await startRequest(targetScope, queuedDraft, structuredClone(latest), async () => {
        await optionsRef.current.refresh(current.id).catch(() => undefined);
        await wait(250);
        const fresh = viewRef.current;
        return fresh && fresh.id === current.id ? structuredClone(fresh) : null;
      });
    })().finally(() => {
      if (queueStartLock.current === queuedDraft.id) queueStartLock.current = null;
    });
  }, [queuedDraft, scope, patchCard, startRequest]);

  const retrySameRequest = useCallback(async (card: ChatCard) => {
    const current = viewRef.current;
    const targetScope = scopeRef.current;
    const commandId = card.requestCommandId;
    const requestView = card.requestView;
    if (!current || !requestView || !isTableView(requestView) || !commandId || !card.requestUncertain || requestLock.current || optionsRef.current.busy || !optionsRef.current.aiEnabled || optionsRef.current.readOnly || (card.kind === 'answer' && optionsRef.current.assistantAvailable === false)) return;
    if (!sameChatRequestScope(requestView, current)) return;
    requestLock.current = true;
    patchCard(targetScope, card.id, { phase: 'sending', requestError: undefined, requestUncertain: false });
    try {
      if (card.kind === 'draft') {
        const accepted = await optionsRef.current.requestDraft(requestView, card.prompt, commandId);
        acceptDraft(targetScope, card, accepted, requestView);
      } else {
        const accepted = await optionsRef.current.ask(requestView, card.prompt, commandId, true);
        acceptAnswer(targetScope, card, accepted);
      }
      if (targetScope === scopeRef.current) setAcknowledgedRetry({ prompt: card.prompt, key: `${card.id}:${Date.now()}` });
    } catch (error) {
      patchCard(targetScope, card.id, { phase: 'failed', requestError: errorText(error), requestUncertain: isUncertain(error), requestView: isUncertain(error) ? requestView : undefined });
    } finally {
      requestLock.current = false;
    }
  }, [acceptAnswer, acceptDraft, patchCard]);

  const confirmCard = useCallback(async (card: ChatCard) => {
    const current = viewRef.current;
    if (!current || !card.job || confirmLocks.current.has(card.id) || !isPendingAction(card, current)) return;
    const proposal = card.job.result;
    const action = proposal?.kind === 'action-proposal' ? current.domain.program?.actions.find((item) => item.id === proposal.actionId) : undefined;
    if (!action || !actorHasTurn(current, action.requireTurn) || optionsRef.current.readOnly || optionsRef.current.busy) return;
    const commandId = card.confirmId ?? crypto.randomUUID();
    confirmLocks.current.add(card.id);
    patchCard(scope, card.id, {
      confirming: true,
      confirmationPending: true,
      confirmId: commandId,
      confirmationError: undefined,
      job: { ...card.job, confirmationStatus: 'processing' },
    });
    try {
      await optionsRef.current.confirm(current, card.job, commandId);
      patchCard(scope, card.id, {
        confirming: false,
        confirmationPending: false,
        confirmationError: undefined,
        job: { ...card.job, confirmationStatus: 'confirmed' },
      });
    } catch (error) {
      patchCard(scope, card.id, { confirming: false, confirmationPending: true, confirmationError: `${errorText(error)} Checking the saved action status…` });
    } finally {
      confirmLocks.current.delete(card.id);
    }
  }, [scope, patchCard]);

  const dismiss = useCallback((card: ChatCard) => {
    chatStore.save(scope, chatStore.dismiss(card, chatStore.load(scope)));
    updateCards(scope, (items) => items.filter((item) => item.id !== card.id));
  }, [scope, updateCards]);

  // A message about cards comes back as its chips plus the person's own words, so it is sent the same way again.
  const prefillCard = useCallback((card: ChatCard) => {
    const { references, message } = parseReferencedPrompt(card.prompt);
    setCardReferences(references.slice(0, MAX_CHAT_CARD_REFERENCES));
    setRetryPrefill({ text: message, key: Date.now() });
  }, []);
  // Rule requests carry no chat history, so the answer travels with the original request.
  // Picking an answer sends a new rule request at once. Rule requests carry no chat history,
  // so the original request, the question and the answer travel together.
  const answerQuestion = useCallback(async (card: ChatCard, answer: string) => {
    const question = card.modelJob?.clarification?.question;
    const text = question ? `${card.prompt}\n\n${question} ${answer}` : `${card.prompt}\n\n${answer}`;
    const current = viewRef.current;
    if (!current) return;
    // The question answers a request the owner already consented to send, so this counts as
    // consent for the table and neither the card nor the composer asks again (user decision, F012).
    rememberConsent({ workspaceId: current.id, epoch: current.epoch, actorId: current.actor.actorId });
    if (await send(text, 'draft')) dismiss(card);
  }, [send, dismiss]);

  const retryHistory = useCallback(() => { void loadHistory(scope); }, [loadHistory, scope]);

  const editRules = useCallback((prompt?: string) => {
    const current = viewRef.current;
    if (!current || !viewerCan(current, 'rules.draft') || optionsRef.current.readOnly || !current.domain.program) return;
    explicitDraftScopeRef.current = scopeRef.current;
    setExplicitDraftScope(scopeRef.current);
    explicitDraftEntryRef.current = {
      scope: scopeRef.current,
      ruleRevision: current.domain.ruleRevision,
      candidateId: current.domain.candidate?.id ?? null,
    };
    if (prompt) setRetryPrefill({ text: prompt.slice(0, 1200), key: Date.now() });
    setFocusKey((key) => key + 1);
  }, []);

  const cancelEditRules = useCallback(() => {
    const currentScope = scopeRef.current;
    if (!currentScope || explicitDraftScopeRef.current !== currentScope) return;
    explicitDraftScopeRef.current = null;
    explicitDraftEntryRef.current = null;
    setExplicitDraftScope(null);
    setFocusKey((key) => key + 1);
  }, []);

  const prepareFromCard = useCallback((card: ChatCard) => {
    const current = viewRef.current;
    if (!current || !viewerCan(current, 'rules.draft') || optionsRef.current.readOnly || requestLock.current) return;
    editRules();
    setRetryPrefill({ text: card.prompt, key: Date.now() });
  }, [editRules]);

  // Notify once when a result finishes with nothing left to do.
  // A card can finish before this page ever renders its waiting phase (a fast draft, a reload during the
  // last poll), so a card created after the page opened counts as seen too. Otherwise the card is removed
  // by `isFinishedResult` below and no notice replaces it: it would vanish silently.
  const mountedAtRef = useRef(Date.now());
  const watchedCardsRef = useRef(new Set<string>());
  const notifiedCardsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const card of cards) {
      if (!isFinishedResult(card)) {
        if (card.phase === 'sending' || card.phase === 'waiting' || card.confirming || card.confirmationPending) watchedCardsRef.current.add(card.id);
        continue;
      }
      const createdWhileOpen = (card.job?.createdAt ?? card.createdAt) >= mountedAtRef.current;
      if ((!watchedCardsRef.current.has(card.id) && !createdWhileOpen) || notifiedCardsRef.current.has(card.id)) continue;
      notifiedCardsRef.current.add(card.id);
      const request = splitReferencedPrompt(card.prompt).message.slice(0, 80);
      if (card.kind === 'draft') {
        optionsRef.current.notify(`New rules added: “${request}”`, 'success', { label: 'View rules', run: () => optionsRef.current.focusObject('table.rules') });
      } else {
        optionsRef.current.notify(`Done: “${request}”`, 'success', { label: 'Table history', run: () => optionsRef.current.focusObject('workspace.history') });
      }
    }
  }, [cards]);
  const currentLocalState = chatStore.load(scope);
  // A result stays on the canvas only while it asks for something (answer, review, confirm, retry, an error);
  // a finished one becomes a notification (below) instead.
  const displayCards = modeChatCards.filter((card) => !chatStore.isDismissed(card, currentLocalState) && !isFinishedResult(card));
  const operationBusy = externalBusy || confirmBusy;
  const followUps = currentLocalState.followUps;
  const auxiliary = useMemo<CanvasAuxiliaryObject[]>(() => {
    if (!table) return [];
    const byId = new Map(displayCards.map((card) => [card.id, card]));
    return displayCards.map((card, index) => {
      const chosen = new Map([...chosenFollowUps(card.id, displayCards, followUps)].map(([option, childId]) => [option, chatStore.chatCardNodeId(scope, byId.get(childId)!)]));
      const link = followUps[card.id];
      const parent = link ? byId.get(link.parentCardId) : undefined;
      // Siblings from the same card stack in the order they were picked (oldest first).
      const siblings = link ? displayCards.filter((item) => followUps[item.id]?.parentCardId === link.parentCardId).reverse() : [];
      return {
      id: chatStore.chatCardNodeId(scope, card),
      title: chatCardTitle(card),
      // Another member's card names the asker in a muted line under the title (open visibility, F034).
      // F070: a follow-up names the card it came from, so a trail reads as steps.
      subtitle: [askerOf(card, table), parent ? `Next step after “${shortTitle(chatCardTitle(parent))}”` : null].filter(Boolean).join(' · ') || undefined,
      // F070: a card opened from a picked option reads as the next step of the card it came from.
      eyebrow: card.kind === 'draft' ? card.phase === 'queued' ? 'Rule draft · queued' : 'Rule draft' : parent ? 'Next step · AI answer' : 'AI answer',
      glyph: <Sparkles size={16} />,
      busy: card.phase === 'sending' || card.phase === 'waiting',
      // F054: a chat answer is dated by this browser's clock (no command stamps it) and names the asker.
      at: card.createdAt,
      actorId: card.job?.askedBy ?? card.modelJob?.askedBy,
      position: { x: 760, y: 40 + index * 300 },
      linkedFrom: parent && link ? { id: chatStore.chatCardNodeId(scope, parent), label: link.option, order: Math.max(0, siblings.findIndex((item) => item.id === card.id)) } : undefined,
      content: <ChatCardContent
        card={card}
        chosen={chosen}
        view={table}
        readOnly={readOnly}
        webEvidence={options.webEvidence === true}
        retryDisabled={!aiEnabled || readOnly || (card.kind === 'answer' && !assistantAvailable)}
        busy={operationBusy}
        onOpenObject={options.focusObject}
        onAddWebSources={options.addWebSources}
        onConfirm={() => void confirmCard(card)}
        onRetry={() => void retrySameRequest(card)}
        onCheck={() => void checkStatus(card)}
        onRetryRefresh={() => void retryDraftRefresh(scope, card.id, table.id)}
        onPrefill={() => prefillCard(card)}
        onAnswerQuestion={(answer) => void answerQuestion(card, answer)}
        onDismiss={() => dismiss(card)}
        onBuild={() => prepareFromCard(card)}
        onSuggest={(message) => void send(followUpPrompt(card.prompt, message), undefined, { parentCardId: card.id, option: message })}
      />,
      };
    });
  }, [table, displayCards, followUps, scope, readOnly, aiEnabled, assistantAvailable, operationBusy, options.focusObject, options.addWebSources, options.webEvidence, confirmCard, retrySameRequest, checkStatus, retryDraftRefresh, prefillCard, answerQuestion, dismiss, prepareFromCard, send]);

  // F067: the table's share of a rule request, measured with the server's own request builder.
  const draftBaseBytes = useMemo(() => table && viewerCan(table, 'rules.draft')
    ? tableDraftBytes(table.domain, '', options.computeCapabilities) : null, [table, options.computeCapabilities]);
  const aiContext = draftBaseBytes === null ? undefined : {
    // The message adds its JSON-escaped length; quotes are already counted in the empty prompt.
    used: draftBaseBytes + new TextEncoder().encode(JSON.stringify(composerMessage)).byteLength - 2,
    limit: TABLE_AI_INPUT_BYTES,
  };
  if (!table) return { bar: null, cards: [], editRules, cancelEditRules };
  const owner = viewerCan(table, 'rules.draft');
  const modeCanAsk = mode === 'draft' || assistantAvailable;
  const placeholder = !aiEnabled || (mode === 'ask' && !assistantAvailable) ? 'AI is off for this table'
    : mode === 'draft' ? table.domain.program ? 'Describe what you want to add or change' : 'Describe the table you want'
      : owner ? 'Ask, add something, or change this table' : 'Ask about this table';
  const sourceFiles = table.domain.sources.map((source) => ({ id: source.id, filename: source.filename }));
  const prefill = retryPrefill ?? options.prefill;
  const sendFromBar = async (message: string): Promise<boolean> => {
    const references = cardReferencesRef.current;
    const accepted = await send(references.length > 0 ? chatReferencePrompt(references, message) : message);
    if (accepted && references.length > 0) setCardReferences([]);
    return accepted;
  };
  const bar = <TableChat
    key={scope}
    workspaceId={table.id}
    epoch={table.epoch}
    actorId={table.actor.actorId}
    mode={mode}
    sourceFiles={sourceFiles}
    placeholder={placeholder}
    aiEnabled={aiEnabled && !readOnly && modeCanAsk}
    canAttach={!readOnly}
    busy={sendBlocked}
    acceptFiles={ACCEPT_FILES}
    historyStatus={assistantAvailable ? historyStatus : 'ready'}
    onRetryHistory={retryHistory}
    prefill={prefill}
    acknowledged={acknowledgedRetry}
    focusKey={focusKey + referenceFocusKey}
    explicitRuleEdit={owner && Boolean(table.domain.program) && explicitDraftScope === scope}
    onCancelRuleEdit={cancelEditRules}
    onAttach={async (file) => { await optionsRef.current.attach(table, file); }}
    onSend={sendFromBar}
    onMessageChange={setComposerMessage}
    cardReferences={cardReferences}
    onRemoveCardReference={(id) => setCardReferences((current) => current.filter((item) => item.id !== id))}
    onClearCardReferences={() => setCardReferences([])}
    composerTools={options.composerTools}
    aiContext={aiContext}
  />;
  return { bar, cards: auxiliary, editRules, cancelEditRules };
}

function chatCardTitle(card: ChatCard): string {
  // A referenced card shows as "@card · message", never the wrapping sent to the AI.
  const { reference, message } = splitReferencedPrompt(card.prompt);
  const title = reference ? `@${reference} · ${message}` : message;
  // The full text; a collapsed card clamps it to two lines and Expand shows all of it.
  return title.length > 240 ? `${title.slice(0, 239)}…` : title;
}

/** The asker's name when the card belongs to another member, otherwise null. */
function askerOf(card: ChatCard, view: TableView): string | null {
  const askedBy = card.job?.askedBy ?? card.modelJob?.askedBy;
  if (!askedBy || askedBy === view.actor.actorId) return null;
  return view.members.find((member) => member.actorId === askedBy)?.name ?? 'Another member';
}

function ChatCardContent({ card, chosen, view, readOnly, webEvidence, retryDisabled, busy, onOpenObject, onAddWebSources, onConfirm, onRetry, onCheck, onRetryRefresh, onPrefill, onAnswerQuestion, onDismiss, onBuild, onSuggest }: {
  card: ChatCard;
  /** F070: options already picked under this card, mapped to the canvas card each one opened. */
  chosen: ReadonlyMap<string, string>;
  view: TableView;
  readOnly: boolean;
  /** F064 slice C: the server stores web sources; the button is hidden when it cannot. */
  webEvidence: boolean;
  retryDisabled: boolean;
  busy: boolean;
  onOpenObject: (id: string) => void;
  /** F064 slice C: add the draft's researched sources; the app shows the result notice. */
  onAddWebSources?: (view: WorkspaceView, sources: ReturnType<typeof addableWebSources>) => Promise<void>;
  onConfirm: () => void;
  onRetry: () => void;
  onCheck: () => void;
  onRetryRefresh: () => void;
  onPrefill: () => void;
  onAnswerQuestion: (answer: string) => void;
  onDismiss: () => void;
  onBuild: () => void;
  onSuggest: (message: string) => void;
}) {
  const dismissalBlocked = isUncertainRequest(card) || card.confirming === true || card.confirmationPending === true;
  // F045: a rule draft reports its live counters on the model job; an answer reports them on its own job.
  const progress = card.modelJob?.progress ?? card.job?.progress;
  // Another member's rule request (F034): readable here, answered and retried only by them.
  const draftAsker = card.kind === 'draft' ? askerOf(card, view) : null;
  const dismissButton = <button type="button" className="tt-chat-card__dismiss" aria-label="Close this card" disabled={dismissalBlocked} onClick={onDismiss}><X size={13} /></button>;
  const checkButton = card.pollTimedOut && (card.phase === 'waiting' || card.confirmationPending)
    ? <button type="button" className="tt-button tt-button--quiet" disabled={card.checking} onClick={onCheck}>{card.checking ? <LoaderCircle size={13} className="tt-spin" /> : <RotateCcw size={13} />}Check status</button>
    : null;
  if (card.phase === 'queued') {
    return <div className="tt-chat-card" role="status" data-testid="table-chat-answer" data-phase="queued">
      <p className="tt-chat-card__pending"><LoaderCircle size={14} />Queued. This rule request starts when the current rule draft finishes, from the table as that draft leaves it.</p>
      <button type="button" className="tt-button tt-button--quiet" onClick={onDismiss}><X size={13} />Cancel this request</button>
    </div>;
  }
  if (card.phase === 'sending' || card.phase === 'waiting') {
    // Open visibility: name the member whose request is running, so others do not start the same work.
    const pendingAsker = askerOf(card, view);
    const pendingText = pendingAsker
      ? card.kind === 'draft' ? `${pendingAsker} is preparing a rule draft…` : `${pendingAsker} is waiting for an answer…`
      : card.kind === 'draft'
        ? card.phase === 'sending' ? 'Sending your rule request…' : 'Preparing a rule draft…'
        : card.phase === 'sending' ? 'Sending your question…' : 'Preparing an answer…';
    // F050: a running draft shows what the model is doing, not only how many characters arrived.
    // The thinking tail exists only on the rule-draft job, never on an answer job.
    const liveThinkingTail = card.kind === 'draft' ? card.modelJob?.progress?.thinkingTail : undefined;
    const liveThinking = liveThinkingTail ? liveThinkingLine(liveThinkingTail) : null;
    // F064: the research step runs before the draft, and its closing line stays while it drafts.
    const liveSearch = card.kind === 'draft' ? liveSearchParts(card.modelJob?.progress?.search) : null;
    return <div className="tt-chat-card tt-chat-card--working" role="status" data-testid="table-chat-answer" data-phase={card.phase}>
      <p className="tt-chat-card__pending tt-chat-card__pending--working"><span className="tt-chat-dots" aria-hidden="true"><i /><i /><i /></span><span className="tt-chat-card__shimmer">{pendingText}</span><ElapsedLabel startedAt={card.job?.createdAt ?? card.createdAt} kind={card.kind} limitMs={card.kind === 'draft' ? card.modelJob?.limitMs : undefined} chars={progress?.receivedChars} reasoningChars={progress?.reasoningChars} /></p>
      {liveSearch && <div className="tt-chat-card__search" data-testid="draft-live-search" data-search-phase={card.modelJob?.progress?.search?.phase}>
        <p className="tt-chat-card__search-line" aria-live="off">
          <span className="tt-chat-card__search-text">{liveSearch.icon} {liveSearch.text}</span>
          {liveSearch.query !== undefined && <span className="tt-chat-card__search-query">{liveSearch.query}</span>}
          {liveSearch.found !== undefined && <span className="tt-chat-card__search-count">· เจอ {liveSearch.found}</span>}
        </p>
      </div>}
      {liveThinking && <div className="tt-chat-card__thinking" data-testid="draft-live-thinking" data-thinking-chars={progress?.reasoningChars}>
        <p className="tt-chat-card__thinking-line" aria-live="off">{liveThinking}</p>
        {liveThinkingTail && liveThinkingTail.length > liveThinking.length && <details className="tt-chat-card__thinking-full">
          <summary>More of the latest thinking</summary>
          <pre>{liveThinkingTail}</pre>
        </details>}
      </div>}
      {card.pollError && <p className="tt-chat-card__error" role="status">Status check: {card.pollError}</p>}
      {checkButton}{dismissButton}
    </div>;
  }
  if (card.phase === 'failed') {
    const message = card.requestError ?? card.error ?? card.modelJob?.message ?? card.job?.message ?? 'The request could not be completed.';
    const requestId = card.job?.id ?? card.modelJob?.id;
    const failureCode = card.job?.failureCode ?? card.modelJob?.failureCode;
    const failureReasons = card.job?.failureReasons;
    const durationMs = card.job?.durationMs;
    // F045: a rule draft that stopped early keeps what the provider had already sent, and says
    // whether our own limit or the provider closed it. A missing failureDetails renders nothing extra.
    const draftFailure = card.kind === 'draft' ? draftFailureSummary(card.modelJob?.failureDetails) : null;
    return <div
      className="tt-chat-card"
      data-testid="table-chat-answer"
      data-request-id={requestId}
      data-failure-code={failureCode}
      data-failure-reasons={failureReasons?.length ? failureReasons.join(' | ') : undefined}
      data-duration-ms={durationMs}
      data-timed-out-by={draftFailure?.timedOutBy}
      data-limit-ms={draftFailure?.limitMs}
      data-partial-chars={draftFailure?.partialChars}
    >
      <p className="tt-chat-card__error" role="alert"><CircleAlert size={14} />{message}</p>
      {draftFailure && <div className="tt-chat-card__stop">
        <p className="tt-chat-card__stop-reason" data-testid="draft-stop-reason">{draftStopReason(draftFailure)}</p>
        {draftFailure.partialText
          ? <details className="tt-chat-card__partial" data-testid="draft-partial">
            <summary>{draftPartialLabel(draftFailure)}</summary>
            <pre>{draftFailure.partialText}</pre>
          </details>
          : <p className="tt-chat-card__hint">{draftPartialLabel(draftFailure)}.</p>}
        {draftFailure.thinkingText && <details className="tt-chat-card__partial tt-chat-card__partial--thinking" data-testid="draft-thinking-tail">
          <summary>{draftThinkingLabel(draftFailure)}</summary>
          <pre>{draftFailure.thinkingText}</pre>
        </details>}
      </div>}
      {(requestId || failureCode) && <p className="tt-chat-card__trace">
        {failureCode ? `Code ${failureCode}` : 'Code UNKNOWN'}{durationMs !== undefined ? ` · ${(durationMs / 1000).toFixed(1)}s` : ''} · Request {requestId ? `${requestId.slice(0, 16)}…` : 'not assigned'} — quote this when reporting the failure.
      </p>}
      {card.requestUncertain && <button type="button" className="tt-button tt-button--quiet" disabled={busy || retryDisabled} onClick={onRetry}><RotateCcw size={13} />Retry same request</button>}
      {!card.requestUncertain && !draftAsker && <button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly} onClick={onPrefill}>Use this message again</button>}
      {dismissButton}
    </div>;
  }
  const clarification = card.kind === 'draft' ? card.modelJob?.clarification : undefined;
  if (clarification) {
    return <div className="tt-chat-card tt-chat-card--questions" data-testid="table-chat-answer">
      <p className="tt-chat-card__intro"><MessageCircleQuestion size={14} /> A few details would help build this table. Nothing on the table changed.</p>
      <p className="tt-chat-card__question">{clarification.question}</p>
      <ClarificationAnswers options={clarification.options} disabled={readOnly || busy || draftAsker !== null} onAnswer={onAnswerQuestion} />
      <p className="tt-chat-card__hint">{draftAsker ? `Only ${draftAsker} can answer this question.` : 'Pick one or more answers, or write your own, then send. Your request stays the same.'}</p>
      {dismissButton}
    </div>;
  }
  // A finished request that left no draft (e.g. an older client view of a newer reply) must not offer Review rules.
  if (card.kind === 'draft' && !card.pollError && !card.checking && !card.modelJob?.candidateId && view.domain.candidate === null) {
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      <p className="tt-chat-card__text">No rule draft was created. Try rephrasing your request.</p>
      {!draftAsker && <button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly} onClick={onPrefill}>Use this message again</button>}
      {dismissButton}
    </div>;
  }
  // F039: a draft the server put into use on its own.
  if (card.kind === 'draft' && card.modelJob?.autoApply === 'applied' && !card.pollError) {
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      <p><Sparkles size={14} /> The new rules were added to the table. Remove any rule you do not want from the Rules card.</p>
      {card.checking && <p className="tt-chat-card__pending" role="status"><LoaderCircle size={14} className="tt-spin" />Refreshing the table…</p>}
      <div className="tt-card-cta"><button type="button" className="tt-button tt-button--quiet" disabled={card.checking} onClick={() => onOpenObject('table.rules')}><ArrowRight size={14} />View rules</button>{dismissButton}</div>
    </div>;
  }
  if (card.kind === 'draft') {
    const reviewReasons = card.modelJob?.autoApply === 'needs-review' ? card.modelJob.autoApplyReasons ?? [] : [];
    // F064 slice B: the web sources this draft used, collapsed so the card stays small.
    const sources = draftSources(card.modelJob?.research);
    // F064 slice C: only a source with a summary can become table evidence; owners and members
    // who may add files can then verify it on the Files card.
    const addableSources = webEvidence ? addableWebSources(card.modelJob?.research) : [];
    const canAddSources = addableSources.length > 0 && viewerCan(view, 'files.add') && !readOnly;
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      {card.modelJob?.autoApply === 'needs-review' && !card.pollError && <p className="tt-chat-card__hint">These rules were not added automatically because a check did not pass{reviewReasons.length ? `: ${reviewReasons.join(' ')}` : '.'}</p>}
      <p><Sparkles size={14} /> {card.pollError ? 'The rule draft is ready, but the table could not refresh.' : 'A rule draft is ready. Review it before anyone uses it.'}</p>
      {sources.length > 0 && <details className="tt-chat-card__sources" data-testid="draft-sources">
        <summary>{draftSourcesLabel(sources.length)}</summary>
        <ul>
          {sources.map((source) => <li key={source.url}>
            <a href={source.url} target="_blank" rel="noopener">{source.title}</a>
            <span>{[source.dateLabel, `authority ${source.authority}`].filter(Boolean).join(' · ')}</span>
          </li>)}
        </ul>
      </details>}
      {card.checking && <p className="tt-chat-card__pending" role="status"><LoaderCircle size={14} className="tt-spin" />Refreshing the table…</p>}
      {card.pollError && <><p className="tt-chat-card__error" role="alert">{card.pollError}</p><button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly || card.checking} onClick={onRetryRefresh}>{card.checking ? <LoaderCircle size={13} className="tt-spin" /> : <RotateCcw size={13} />}Retry table refresh</button></>}
      <div className="tt-card-cta">{canAddSources && <button type="button" className="tt-button tt-button--quiet" data-testid="draft-add-sources" disabled={busy || card.checking} onClick={() => void onAddWebSources?.(view, addableSources)}>Add to table sources</button>}<button type="button" className="tt-button tt-button--primary" disabled={Boolean(card.pollError) || card.checking} onClick={() => onOpenObject('table.rules')}><ArrowRight size={14} />Review rules</button>{dismissButton}</div>
    </div>;
  }
  const job = card.job;
  const result = job?.result;
  if (!result || !job) return <div className="tt-chat-card" data-testid="table-chat-answer"><p className="tt-chat-card__text">No answer was received.</p><button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly} onClick={onPrefill}>Use this message again</button>{dismissButton}</div>;
  const references = result.kind === 'explanation' ? result.references : [];
  const suggestions = (result.kind === 'explanation' || result.kind === 'clarification') ? result.suggestions ?? [] : [];
  // Open visibility (F034): members also see other members' chats; only the asker can act on them.
  // Revisions are per reader, so another member's proposal always looks stale here; check foreign first.
  const foreign = Boolean(job.askedBy && job.askedBy !== view.actor.actorId);
  const askerName = foreign ? view.members.find((member) => member.actorId === job.askedBy)?.name ?? 'Another member' : null;
  const askerLine = askerName ? <p className="tt-chat-card__asker">Asked by {askerName}</p> : null;
  if (result.kind !== 'action-proposal') {
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      {askerLine}
      <div data-testid="chat-answer-card"><p className="tt-chat-card__text">{result.text}</p></div>
      {result.kind === 'build-request' && viewerCan(view, 'rules.draft') && !foreign && <button type="button" className="tt-button tt-button--primary" disabled={readOnly || busy} onClick={onBuild}><Sparkles size={14} />Prepare changes</button>}
      {suggestions.length > 0 && !foreign && <div className="tt-chat-card__suggestions" role="group" aria-label="Suggested replies">{suggestions.map((suggestion) => {
        const opened = chosen.get(suggestion);
        // F070: a picked option shows as chosen and leads to its answer instead of asking again.
        return opened
          ? <button type="button" key={suggestion} className="is-chosen" aria-pressed="true" title="Chosen: go to its answer" onClick={() => onOpenObject(opened)}><Check size={13} aria-hidden="true" />{suggestion}<span className="tt-chat-card__chosen-tag">Chosen</span></button>
          : <button type="button" key={suggestion} aria-pressed="false" disabled={readOnly || busy} onClick={() => onSuggest(suggestion)}><CornerDownRight size={13} aria-hidden="true" />{suggestion}</button>;
      })}</div>}
      {references.length > 0 && <div className="tt-chat-card__references">{references.map((reference, index) => <button type="button" key={`${reference.kind}-${index}`} onClick={() => onOpenObject(objectForReference(reference))}>{reference.label}</button>)}</div>}
      {dismissButton}
    </div>;
  }
  const status = job.confirmationStatus;
  const stale = proposalIsStale(job, view);
  const action = view.domain.program?.actions.find((item) => item.id === result.actionId);
  const roleAllowed = Boolean(action?.roles.includes(view.actor.role as 'owner' | 'participant'));
  const turnAllowed = action ? actorHasTurn(view, action.requireTurn) : false;
  const confirmed = status === 'confirmed';
  const terminal = status === 'stale' || status === 'rejected';
  return <div className="tt-chat-card is-proposal" data-testid="table-chat-answer">
    {askerLine}
    <div data-testid="chat-answer-card"><p className="tt-chat-card__text">{result.text}</p></div>
    <dl className="tt-chat-card__inputs">
      <dt>Action</dt><dd>{action?.title ?? result.actionId}</dd>
      {Object.entries(result.inputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}
    </dl>
    {confirmed ? <p className="tt-chat-card__done"><Check size={14} />Confirmed. See Table history for the result.</p>
      : terminal ? <p className="tt-chat-card__error" role="status">{job.message ?? (status === 'stale' ? 'The table changed after this proposal. It cannot be confirmed.' : 'The current rules or turn did not allow this proposal.')}</p>
        : status === 'processing' || card.confirmationPending ? <p className="tt-chat-card__pending" role="status"><LoaderCircle size={14} className="tt-spin" />Checking the saved action status…</p>
          : foreign ? <p className="tt-chat-card__pending" role="status">Only {askerName} can confirm this proposal.</p>
            : stale ? <p className="tt-chat-card__error" role="status">The table changed after this proposal. Ask again for a fresh proposal.</p>
            : !roleAllowed ? <p className="tt-chat-card__error" role="status">This seat cannot confirm the proposed action.</p>
              : !turnAllowed ? <p className="tt-chat-card__error" role="status">This action is only available on the required turn.</p>
                : <div className="tt-chat-card__action-buttons tt-card-cta"><button type="button" className="tt-button tt-button--primary" disabled={readOnly || busy || card.confirming || status !== 'available'} onClick={onConfirm}>{card.confirming ? <LoaderCircle size={14} className="tt-spin" /> : <Check size={14} />}Confirm action</button><button type="button" className="tt-button tt-button--quiet" disabled={busy || card.confirmationPending} onClick={onDismiss}>Skip this proposal</button></div>}
    {card.confirmationError && <p className="tt-chat-card__error" role="alert">{card.confirmationError}</p>}
    {card.pollError && <p className="tt-chat-card__error" role="status">Status check: {card.pollError}</p>}
    {checkButton}
    {dismissButton}
  </div>;
}

/** A result with nothing left to do: rules that went into use, or an AI proposal that was confirmed. */
function isFinishedResult(card: ChatCard): boolean {
  if (card.pollError || card.requestError || card.error) return false;
  if (card.kind === 'draft') return card.modelJob?.autoApply === 'applied';
  return card.job?.result?.kind === 'action-proposal' && card.job.confirmationStatus === 'confirmed' && !card.confirming && !card.confirmationPending;
}
