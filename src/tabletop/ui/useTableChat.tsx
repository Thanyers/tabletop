import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, LoaderCircle, RotateCcw, Sparkles, X } from 'lucide-react';
import { ApiFailure, type ModelJob } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantHistoryPage, TableAssistantJob, TableAssistantReference } from '../shared/table-assistant-contracts';
import type { TableState } from '../shared/table-contracts';
import type { CanvasAuxiliaryObject } from './CanvasWorkspace';
import { TableChat } from './TableChat';
import { draftRefreshPatch, historyCard, isUncertainRequest, mergeChatHistory, sameChatRequestScope, tableChatMode, type ChatCard } from './table-chat-state';

type TableView = WorkspaceView & { kind: 'table'; domain: TableState };
type CommandId = ReturnType<typeof crypto.randomUUID>;

const DRAFT_POLL_MS = 1_200;
const DRAFT_POLL_LIMIT_MS = 60_000;
const ANSWER_POLL_MS = 1_000;
const ANSWER_POLL_LIMIT_MS = 60_000;
const HISTORY_CARDS = 6;
const LOCAL_CARD_IDS = 80;
const ACCEPT_FILES = '.csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown';

export interface UseTableChatOptions {
  view: WorkspaceView | null;
  aiEnabled: boolean;
  assistantAvailable?: boolean;
  readOnly: boolean;
  busy?: boolean;
  requestDraft: (view: WorkspaceView, prompt: string, commandId: CommandId) => Promise<ModelJob>;
  pollDraft: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  refresh: (workspaceId: string) => Promise<void>;
  ask: (view: TableView, prompt: string, commandId: CommandId, sameCommandRetry?: boolean) => Promise<TableAssistantJob>;
  pollAsk: (view: TableView, jobId: string) => Promise<TableAssistantJob>;
  loadHistory: (view: TableView) => Promise<TableAssistantHistoryPage>;
  confirm: (view: TableView, job: TableAssistantJob, commandId: CommandId) => Promise<void>;
  attach: (view: WorkspaceView, file: File) => Promise<WorkspaceView>;
  focusObject: (id: string) => void;
  notify: (text: string, tone: 'info' | 'error' | 'success') => void;
  prefill?: { text: string; key: number };
}

interface PrivateChatLocalState {
  dismissed: string[];
  cardIdsByJob: Record<string, string>;
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
  return error instanceof Error && error.message ? error.message : 'The request could not be completed. Try again.';
}

function isUncertain(error: unknown): boolean {
  return error instanceof ApiFailure && error.status === 0;
}

function scopeFor(view: TableView | null): string {
  return view ? JSON.stringify([view.id, view.epoch, view.actor.actorId]) : '';
}

function chatNodeId(scope: string, id: string): string {
  return `chat.${encodeURIComponent(scope)}.${id}`;
}

function storageKey(scope: string): string {
  return `tabletop:r1:private-chat:${encodeURIComponent(scope)}`;
}

function readPrivateChatState(scope: string): PrivateChatLocalState {
  if (!scope || typeof window === 'undefined') return { dismissed: [], cardIdsByJob: {} };
  try {
    const raw = window.localStorage.getItem(storageKey(scope));
    if (!raw) return { dismissed: [], cardIdsByJob: {} };
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { dismissed: [], cardIdsByJob: {} };
    const candidate = parsed as { dismissed?: unknown; cardIdsByJob?: unknown };
    const dismissed = Array.isArray(candidate.dismissed) ? candidate.dismissed.filter((id): id is string => typeof id === 'string').slice(-LOCAL_CARD_IDS) : [];
    const cardIdsByJob: Record<string, string> = {};
    if (typeof candidate.cardIdsByJob === 'object' && candidate.cardIdsByJob !== null && !Array.isArray(candidate.cardIdsByJob)) {
      for (const [jobId, cardId] of Object.entries(candidate.cardIdsByJob)) {
        if (typeof cardId === 'string' && jobId.length <= 160 && cardId.length <= 240) cardIdsByJob[jobId] = cardId;
      }
    }
    return { dismissed, cardIdsByJob: Object.fromEntries(Object.entries(cardIdsByJob).slice(-LOCAL_CARD_IDS)) };
  } catch {
    return { dismissed: [], cardIdsByJob: {} };
  }
}

function writePrivateChatState(scope: string, state: PrivateChatLocalState): void {
  if (!scope || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(storageKey(scope), JSON.stringify({
      dismissed: state.dismissed.slice(-LOCAL_CARD_IDS),
      cardIdsByJob: Object.fromEntries(Object.entries(state.cardIdsByJob).slice(-LOCAL_CARD_IDS)),
    }));
  } catch { /* Local closed state is a convenience; server history remains authoritative. */ }
}

function rememberJobCard(scope: string, jobId: string, cardId: string): void {
  const local = readPrivateChatState(scope);
  writePrivateChatState(scope, { ...local, cardIdsByJob: { ...local.cardIdsByJob, [jobId]: cardId } });
}

function isDismissed(card: ChatCard, state: PrivateChatLocalState): boolean {
  const persistentId = card.job?.id ?? card.modelJob?.id ?? card.id;
  return state.dismissed.includes(persistentId);
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
export function useTableChat(options: UseTableChatOptions): { bar: ReactNode; cards: CanvasAuxiliaryObject[]; editRules: () => void; cancelEditRules: () => void } {
  const { view, aiEnabled, readOnly } = options;
  const table = isTableView(view) ? view : null;
  const scope = scopeFor(table);
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
  const confirmLocks = useRef(new Set<string>());
  const draftRefreshLocks = useRef(new Set<string>());
  const isBlockedRef = useRef(false);
  const [explicitDraftScope, setExplicitDraftScope] = useState<string | null>(null);
  const explicitDraftScopeRef = useRef<string | null>(null);
  const explicitDraftEntryRef = useRef<{ scope: string; ruleRevision: number; candidateId: string | null } | null>(null);
  explicitDraftScopeRef.current = explicitDraftScope;
  const [focusKey, setFocusKey] = useState(0);
  const [acknowledgedRetry, setAcknowledgedRetry] = useState<{ prompt: string; key: string }>();
  const [retryPrefill, setRetryPrefill] = useState<{ text: string; key: number }>();
  const [composerMessage, setComposerMessage] = useState('');

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

  const loadHistory = useCallback(async (targetScope: string) => {
    const current = viewRef.current;
    if (!current || targetScope !== scopeRef.current) return;
    const generation = ++historyGeneration.current;
    setHistoryState({ scope: targetScope, status: 'loading' });
    try {
      const page = await optionsRef.current.loadHistory(current);
      if (targetScope !== scopeRef.current || generation !== historyGeneration.current) return;
      const local = readPrivateChatState(targetScope);
      const dismissed = new Set(local.dismissed);
      const jobs = [...page.items].sort((left, right) => right.createdAt - left.createdAt).slice(0, HISTORY_CARDS);
      const incoming = jobs
        .filter((job) => !dismissed.has(job.id))
        .map((job) => historyCard(job, local.cardIdsByJob[job.id] ?? `answer-${job.id}`));
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
      writePrivateChatState(targetScope, { ...local, cardIdsByJob });
      setHistoryState({ scope: targetScope, status: 'ready' });
    } catch {
      if (targetScope === scopeRef.current && generation === historyGeneration.current) setHistoryState({ scope: targetScope, status: 'error' });
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
  }, [scope, updateCards]);

  useEffect(() => {
    if (!viewRef.current || !assistantAvailable) {
      setHistoryState({ scope, status: 'ready' });
      return;
    }
    void loadHistory(scope);
    return () => { historyGeneration.current += 1; };
  }, [scope, assistantAvailable, loadHistory]);

  const cards = useMemo(() => cardState.scope === scope ? cardState.cards : [], [cardState, scope]);
  const mode = table ? tableChatMode(table.actor.role === 'owner' ? 'owner' : 'participant', Boolean(table.domain.program), explicitDraftScope === scope, {
    prompt: composerMessage,
    hasCreateAction: table.domain.program?.actions.some(action => Boolean(action.creates?.length)) ?? false,
  }) : 'ask';
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const historyStatus = historyState.scope === scope ? historyState.status : 'loading';
  const externalBusy = options.busy === true;
  const requestsBusy = cards.some((card) => card.phase === 'sending' || card.phase === 'waiting' || card.confirming || card.confirmationPending);
  const uncertainRequest = cards.some(isUncertainRequest);
  const pendingAction = table ? cards.some((card) => isPendingAction(card, table)) : false;
  const sendBlocked = externalBusy || requestsBusy || uncertainRequest || pendingAction;
  isBlockedRef.current = sendBlocked;

  useEffect(() => {
    if (!table || explicitDraftScope !== scope || table.actor.role !== 'owner') return;
    const entry = explicitDraftEntryRef.current;
    const candidate = table.domain.candidate;
    if (entry?.scope === scope && candidate?.status === 'active' && (table.domain.ruleRevision > entry.ruleRevision || candidate.id !== entry.candidateId)) {
      explicitDraftScopeRef.current = null;
      explicitDraftEntryRef.current = null;
      setExplicitDraftScope(null);
    }
  }, [scope, explicitDraftScope, table]);

  const modeChatCards = useMemo(() => cards.filter((card) => !isDismissed(card, readPrivateChatState(scope))), [cards, scope]);

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

  const refreshAfterDraft = useCallback((targetScope: string, cardId: string, workspaceId: string) => {
    void retryDraftRefresh(targetScope, cardId, workspaceId);
  }, [retryDraftRefresh]);

  const pollModelOnce = useCallback(async (targetScope: string, cardId: string, workspaceId: string, jobId: string) => {
    const next = await optionsRef.current.pollDraft(workspaceId, jobId);
    if (targetScope !== scopeRef.current) return next;
    patchCard(targetScope, cardId, {
      modelJob: next,
      phase: modelPhase(next),
      error: next.status === 'failed' ? next.message ?? 'The draft could not be prepared.' : undefined,
      pollError: undefined,
      pollTimedOut: false,
    });
    if (next.status === 'completed' || next.status === 'complete') refreshAfterDraft(targetScope, cardId, workspaceId);
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
        const limit = card.kind === 'draft' ? DRAFT_POLL_LIMIT_MS : ANSWER_POLL_LIMIT_MS;
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
    if (job.status === 'completed' || job.status === 'complete') refreshAfterDraft(targetScope, card.id, current.id);
    if (current.domain.program && explicitDraftScopeRef.current === targetScope) {
      explicitDraftScopeRef.current = null;
      explicitDraftEntryRef.current = null;
      setExplicitDraftScope(null);
    }
  }, [patchCard, refreshAfterDraft]);

  const acceptAnswer = useCallback((targetScope: string, card: ChatCard, job: TableAssistantJob) => {
    rememberJobCard(targetScope, job.id, card.id);
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
  }, [patchCard]);

  const send = useCallback(async (prompt: string): Promise<boolean> => {
    const current = viewRef.current;
    const targetScope = scopeRef.current;
    const selectedMode = modeRef.current;
    if (!current || !targetScope || requestLock.current || isBlockedRef.current || !optionsRef.current.aiEnabled || (selectedMode === 'ask' && optionsRef.current.assistantAvailable === false) || prompt.trim().length < 3) return false;
    if (selectedMode === 'draft' && (current.actor.role !== 'owner' || optionsRef.current.readOnly)) return false;
    requestLock.current = true;
    const commandId = crypto.randomUUID();
    const requestView = structuredClone(current);
    const card: ChatCard = {
      id: `${selectedMode === 'draft' ? 'draft' : 'answer'}-${commandId}`,
      kind: selectedMode === 'draft' ? 'draft' : 'answer',
      prompt,
      createdAt: Date.now(),
      phase: 'sending',
      requestCommandId: commandId,
      requestView,
    };
    updateCards(targetScope, (items) => [card, ...items]);
    optionsRef.current.focusObject(chatNodeId(targetScope, card.id));
    try {
      if (selectedMode === 'draft') {
        const accepted = await optionsRef.current.requestDraft(requestView, prompt, commandId);
        acceptDraft(targetScope, card, accepted, requestView);
      } else {
        const accepted = await optionsRef.current.ask(requestView, prompt, commandId);
        acceptAnswer(targetScope, card, accepted);
      }
      return true;
    } catch (error) {
      patchCard(targetScope, card.id, {
        phase: 'failed',
        requestError: errorText(error),
        requestUncertain: isUncertain(error),
        requestView: isUncertain(error) ? card.requestView : undefined,
      });
      return false;
    } finally {
      requestLock.current = false;
    }
  }, [acceptAnswer, acceptDraft, patchCard, updateCards]);

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
    const local = readPrivateChatState(scope);
    const persistentId = card.job?.id ?? card.modelJob?.id ?? card.id;
    writePrivateChatState(scope, { ...local, dismissed: [...new Set([...local.dismissed, persistentId])].slice(-LOCAL_CARD_IDS) });
    updateCards(scope, (items) => items.filter((item) => item.id !== card.id));
  }, [scope, updateCards]);

  const prefillCard = useCallback((card: ChatCard) => setRetryPrefill({ text: card.prompt, key: Date.now() }), []);

  const retryHistory = useCallback(() => { void loadHistory(scope); }, [loadHistory, scope]);

  const editRules = useCallback(() => {
    const current = viewRef.current;
    if (!current || current.actor.role !== 'owner' || optionsRef.current.readOnly || !current.domain.program) return;
    explicitDraftScopeRef.current = scopeRef.current;
    setExplicitDraftScope(scopeRef.current);
    explicitDraftEntryRef.current = {
      scope: scopeRef.current,
      ruleRevision: current.domain.ruleRevision,
      candidateId: current.domain.candidate?.id ?? null,
    };
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
    if (!current || current.actor.role !== 'owner' || optionsRef.current.readOnly || requestLock.current) return;
    editRules();
    setRetryPrefill({ text: card.prompt, key: Date.now() });
  }, [editRules]);

  const currentLocalState = readPrivateChatState(scope);
  const displayCards = modeChatCards.filter((card) => !isDismissed(card, currentLocalState));
  const operationBusy = externalBusy || requestsBusy;
  const auxiliary = useMemo<CanvasAuxiliaryObject[]>(() => {
    if (!table) return [];
    return displayCards.map((card, index) => ({
      id: chatNodeId(scope, card.id),
      title: card.prompt.length > 48 ? `${card.prompt.slice(0, 47)}…` : card.prompt,
      eyebrow: card.kind === 'draft' ? 'Rule draft' : 'AI answer',
      position: { x: 760, y: 40 + index * 300 },
      content: <ChatCardContent
        card={card}
        view={table}
        readOnly={readOnly}
        retryDisabled={!aiEnabled || readOnly || (card.kind === 'answer' && !assistantAvailable)}
        busy={operationBusy}
        onOpenObject={options.focusObject}
        onConfirm={() => void confirmCard(card)}
        onRetry={() => void retrySameRequest(card)}
        onCheck={() => void checkStatus(card)}
        onRetryRefresh={() => void retryDraftRefresh(scope, card.id, table.id)}
        onPrefill={() => prefillCard(card)}
        onDismiss={() => dismiss(card)}
        onBuild={() => prepareFromCard(card)}
      />,
    }));
  }, [table, displayCards, scope, readOnly, aiEnabled, assistantAvailable, operationBusy, options.focusObject, confirmCard, retrySameRequest, checkStatus, retryDraftRefresh, prefillCard, dismiss, prepareFromCard]);

  if (!table) return { bar: null, cards: [], editRules, cancelEditRules };
  const owner = table.actor.role === 'owner';
  const modeCanAsk = mode === 'draft' || assistantAvailable;
  const placeholder = !aiEnabled || (mode === 'ask' && !assistantAvailable) ? 'AI is off for this table'
    : mode === 'draft' ? table.domain.program ? 'Describe what you want to add or change' : 'Describe the table you want'
      : owner ? 'Ask, add something, or change this table' : 'Ask about this table';
  const sourceFiles = table.domain.sources.map((source) => ({ id: source.id, filename: source.filename }));
  const prefill = retryPrefill ?? options.prefill;
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
    focusKey={focusKey}
    explicitRuleEdit={owner && Boolean(table.domain.program) && explicitDraftScope === scope}
    onCancelRuleEdit={cancelEditRules}
    onAttach={async (file) => { await optionsRef.current.attach(table, file); }}
    onSend={send}
    onMessageChange={setComposerMessage}
  />;
  return { bar, cards: auxiliary, editRules, cancelEditRules };
}

function ChatCardContent({ card, view, readOnly, retryDisabled, busy, onOpenObject, onConfirm, onRetry, onCheck, onRetryRefresh, onPrefill, onDismiss, onBuild }: {
  card: ChatCard;
  view: TableView;
  readOnly: boolean;
  retryDisabled: boolean;
  busy: boolean;
  onOpenObject: (id: string) => void;
  onConfirm: () => void;
  onRetry: () => void;
  onCheck: () => void;
  onRetryRefresh: () => void;
  onPrefill: () => void;
  onDismiss: () => void;
  onBuild: () => void;
}) {
  const dismissalBlocked = isUncertainRequest(card) || card.confirming === true || card.confirmationPending === true;
  const dismissButton = <button type="button" className="tt-chat-card__dismiss" aria-label="Close this card" disabled={dismissalBlocked} onClick={onDismiss}><X size={13} /></button>;
  const checkButton = card.pollTimedOut && (card.phase === 'waiting' || card.confirmationPending)
    ? <button type="button" className="tt-button tt-button--quiet" disabled={card.checking} onClick={onCheck}>{card.checking ? <LoaderCircle size={13} className="tt-spin" /> : <RotateCcw size={13} />}Check status</button>
    : null;
  if (card.phase === 'sending' || card.phase === 'waiting') {
    return <div className="tt-chat-card" role="status" data-testid="table-chat-answer">
      <p className="tt-chat-card__pending"><LoaderCircle size={14} className="tt-spin" />{card.kind === 'draft' ? card.phase === 'sending' ? 'Sending your rule request…' : 'Preparing a rule draft…' : card.phase === 'sending' ? 'Sending your question…' : 'Preparing an answer…'}</p>
      {card.pollError && <p className="tt-chat-card__error" role="status">Status check: {card.pollError}</p>}
      {checkButton}{dismissButton}
    </div>;
  }
  if (card.phase === 'failed') {
    const message = card.requestError ?? card.error ?? card.modelJob?.message ?? card.job?.message ?? 'The request could not be completed.';
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      <p className="tt-chat-card__error" role="alert"><CircleAlert size={14} />{message}</p>
      {card.requestUncertain && <button type="button" className="tt-button tt-button--quiet" disabled={busy || retryDisabled} onClick={onRetry}><RotateCcw size={13} />Retry same request</button>}
      {!card.requestUncertain && <button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly} onClick={onPrefill}>Use this message again</button>}
      {dismissButton}
    </div>;
  }
  if (card.kind === 'draft') {
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      <p><Sparkles size={14} /> {card.pollError ? 'The rule draft is ready, but the table could not refresh.' : 'A rule draft is ready. Review it before anyone uses it.'}</p>
      {card.checking && <p className="tt-chat-card__pending" role="status"><LoaderCircle size={14} className="tt-spin" />Refreshing the table…</p>}
      {card.pollError && <><p className="tt-chat-card__error" role="alert">{card.pollError}</p><button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly || card.checking} onClick={onRetryRefresh}>{card.checking ? <LoaderCircle size={13} className="tt-spin" /> : <RotateCcw size={13} />}Retry table refresh</button></>}
      <button type="button" className="tt-button tt-button--primary" disabled={Boolean(card.pollError) || card.checking} onClick={() => onOpenObject('table.rules')}><ArrowRight size={14} />Review rules</button>{dismissButton}
    </div>;
  }
  const job = card.job;
  const result = job?.result;
  if (!result || !job) return <div className="tt-chat-card" data-testid="table-chat-answer"><p className="tt-chat-card__text">No answer was received.</p><button type="button" className="tt-button tt-button--quiet" disabled={busy || readOnly} onClick={onPrefill}>Use this message again</button>{dismissButton}</div>;
  const references = result.kind === 'explanation' ? result.references : [];
  if (result.kind !== 'action-proposal') {
    return <div className="tt-chat-card" data-testid="table-chat-answer">
      <div data-testid="chat-answer-card"><p className="tt-chat-card__text">{result.text}</p></div>
      {result.kind === 'build-request' && view.actor.role === 'owner' && <button type="button" className="tt-button tt-button--primary" disabled={readOnly || busy} onClick={onBuild}><Sparkles size={14} />Prepare changes</button>}
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
    <div data-testid="chat-answer-card"><p className="tt-chat-card__text">{result.text}</p></div>
    <dl className="tt-chat-card__inputs">
      <dt>Action</dt><dd>{action?.title ?? result.actionId}</dd>
      {Object.entries(result.inputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}
    </dl>
    {confirmed ? <p className="tt-chat-card__done"><Check size={14} />Confirmed. See Table history for the result.</p>
      : terminal ? <p className="tt-chat-card__error" role="status">{job.message ?? (status === 'stale' ? 'The table changed after this proposal. It cannot be confirmed.' : 'The current rules or turn did not allow this proposal.')}</p>
        : status === 'processing' || card.confirmationPending ? <p className="tt-chat-card__pending" role="status"><LoaderCircle size={14} className="tt-spin" />Checking the saved action status…</p>
          : stale ? <p className="tt-chat-card__error" role="status">The table changed after this proposal. Ask again for a fresh proposal.</p>
            : !roleAllowed ? <p className="tt-chat-card__error" role="status">This seat cannot confirm the proposed action.</p>
              : !turnAllowed ? <p className="tt-chat-card__error" role="status">This action is only available on the required turn.</p>
                : <div className="tt-chat-card__action-buttons"><button type="button" className="tt-button tt-button--primary" disabled={readOnly || busy || card.confirming || status !== 'available'} onClick={onConfirm}>{card.confirming ? <LoaderCircle size={14} className="tt-spin" /> : <Check size={14} />}Confirm action</button><button type="button" className="tt-button tt-button--quiet" disabled={busy || card.confirmationPending} onClick={onDismiss}>Skip this proposal</button></div>}
    {card.confirmationError && <p className="tt-chat-card__error" role="alert">{card.confirmationError}</p>}
    {card.pollError && <p className="tt-chat-card__error" role="status">Status check: {card.pollError}</p>}
    {checkButton}
    {dismissButton}
  </div>;
}
