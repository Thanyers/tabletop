import { managesTable } from '../shared/visibility';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, ArrowRight, BookOpen, Check, LoaderCircle, MessageCircle, Send, Sparkles } from 'lucide-react';
import { ApiFailure, type ModelJob, type TabletopCapabilities } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantHistoryPage, TableAssistantJob, TableAssistantReference } from '../shared/table-assistant-contracts';
import type { TableState } from '../shared/table-contracts';
import { AIProposal } from './AIProposal';
import './assistant-calm.css';

type TableWorkspaceView = WorkspaceView & { kind: 'table'; domain: TableState };
type CommandId = ReturnType<typeof crypto.randomUUID>;

interface TableAssistantProps {
  compact?: boolean;
  view: TableWorkspaceView;
  capabilities: TabletopCapabilities;
  readOnly: boolean;
  onRequest: (view: WorkspaceView, prompt: string, sourceId: string | undefined, commandId: string) => Promise<ModelJob>;
  onPoll: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  onRefresh: (workspaceId: string) => Promise<void>;
  onAttachFile?: (view: WorkspaceView, file: File) => Promise<WorkspaceView>;
  onOpenSources: () => void;
  onOpenRules: () => void;
  onOpenActions: () => void;
  onReviewDraft: () => void;
  onChatRequest: (view: TableWorkspaceView, prompt: string, commandId: CommandId) => Promise<TableAssistantJob>;
  onChatPoll: (view: TableWorkspaceView, jobId: string) => Promise<TableAssistantJob>;
  onChatHistory: (view: TableWorkspaceView, before?: string) => Promise<TableAssistantHistoryPage>;
  onChatConfirm: (view: TableWorkspaceView, job: TableAssistantJob, commandId: CommandId) => Promise<void>;
  onChatRefresh: (view: TableWorkspaceView) => Promise<void>;
  onOpenObject: (id: string) => void;
  /** Text placed in the rule draft prompt, e.g. a description typed on the start page. */
  rulePrefill?: { text: string; key: number };
}

type ChatEntry = {
  id: string;
  prompt: string;
  requestCommandId?: CommandId;
  createdAt: number;
  phase: 'sending' | 'waiting' | 'complete' | 'failed';
  job: TableAssistantJob | null;
  requestError?: string;
  requestUncertain?: boolean;
  confirmCommandId?: CommandId;
  confirming?: boolean;
  confirmationPending?: boolean;
  confirmationError?: string;
  pollError?: string;
  pollTimedOut?: boolean;
  checking?: boolean;
  dismissed?: boolean;
  fromHistory?: boolean;
};

type AssistantMode = 'chat' | 'rules';

const sleep = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

function scrollConversation(thread: HTMLDivElement | null, edge: 'top' | 'bottom'): void {
  window.requestAnimationFrame(() => {
    if (!thread) return;
    thread.scrollTop = edge === 'top' ? 0 : thread.scrollHeight;
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.code === 'STALE_REVISION' || error.code === 'STALE_EPOCH' || error.conflict) return 'The table changed. Its latest state is loaded; review it and ask again before confirming an action.';
    if (error.code === 'TABLE_READ_ONLY') return 'This table is temporarily read-only. You can still review its rules and records.';
    if (error.status === 0) return 'The connection was lost before the request could be confirmed. No automatic retry was made.';
  }
  return error instanceof Error ? error.message : 'The assistant could not complete that request.';
}

function currentTurnLabel(view: WorkspaceView, turn: string | null): string {
  if (!turn) return 'No turn is set.';
  if (turn === view.actor.seat) return 'Your turn.';
  if (turn === 'host') return view.actor.role === 'owner' ? 'Your turn.' : "The owner's turn.";
  const member = view.members.find((item) => item.seat === turn);
  if (member?.actorId === view.actor.actorId) return 'Your turn.';
  return member ? `${member.name}'s turn.` : `Current seat: ${turn}.`;
}

function hasTurnOrder(view: TableWorkspaceView): boolean {
  return (view.domain.program?.turnOrder.length ?? 0) > 0;
}

function formatInput(view: TableWorkspaceView, actionId: string, key: string, value: unknown): { label: string; value: string } {
  if (!view.domain.program) return { label: key, value: displayValue(value) };
  const action = view.domain.program.actions.find((item) => item.id === actionId);
  const parameter = action?.parameters.find((item) => item.id === key);
  if (parameter?.type === 'record' && parameter.collection && typeof value === 'string') {
    const collection = view.domain.program.collections.find((item) => item.id === parameter.collection);
    const record = view.domain.records[parameter.collection]?.find((item) => item.id === value);
    const firstText = collection?.fields.find((field) => field.type === 'text');
    const label = record && firstText ? record.values[firstText.id] : undefined;
    return { label: parameter.label, value: typeof label === 'string' ? label : value };
  }
  return { label: parameter?.label ?? key, value: displayValue(value) };
}

function displayValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value === null || value === undefined) return '—';
  if (Array.isArray(value)) return value.map(displayValue).join(', ');
  return 'Provided value';
}

function objectForReference(reference: TableAssistantReference): string {
  if (reference.kind === 'rule') return 'table.rules';
  if (reference.kind === 'action' || reference.kind === 'turn') return 'table.actions';
  return `table.collection.${reference.collectionId}`;
}

function isPendingAction(entry: ChatEntry | undefined, view: TableWorkspaceView): boolean {
  if (!entry?.job || entry.dismissed || entry.job.status !== 'completed' || entry.job.confirmationStatus !== 'available' || entry.job.result?.kind !== 'action-proposal') return false;
  const actionId = entry.job.result.actionId;
  const action = view.domain.program?.actions.find((item) => item.id === actionId);
  return Boolean(action && action.roles.includes(view.actor.role as 'owner' | 'participant') && !isStale(entry.job, view));
}

function isStale(job: TableAssistantJob, view: TableWorkspaceView): boolean {
  if (job.result?.kind !== 'action-proposal') return true;
  return job.expectedRevision !== view.revision
    || job.expectedEpoch !== view.epoch
    || job.result.expectedRevision !== view.revision
    || job.result.expectedRuleRevision !== view.domain.ruleRevision
    || job.result.expectedActionRevision !== view.domain.actionRevision;
}

function updateEntry(setEntries: React.Dispatch<React.SetStateAction<ChatEntry[]>>, id: string, update: (entry: ChatEntry) => ChatEntry): void {
  setEntries((entries) => entries.map((entry) => entry.id === id ? update(entry) : entry));
}

function historyEntry(job: TableAssistantJob): ChatEntry {
  return {
    id: job.id,
    prompt: job.prompt,
    createdAt: job.createdAt,
    phase: job.status === 'running' ? 'waiting' : job.status === 'failed' ? 'failed' : 'complete',
    job,
    confirmationPending: job.confirmationStatus === 'processing',
    fromHistory: true,
  };
}

function mergeHistory(current: ChatEntry[], incoming: ChatEntry[]): ChatEntry[] {
  const merged = new Map<string, ChatEntry>();
  for (const entry of current) merged.set(entry.job?.id ?? entry.id, entry);
  for (const entry of incoming) {
    const key = entry.job?.id ?? entry.id;
    let existing = merged.get(key);
    if (!existing && entry.job) {
      const possibleAck = [...merged.entries()].find(([, candidate]) =>
        !candidate.job
        && (candidate.phase === 'sending' || candidate.requestUncertain)
        && candidate.prompt === entry.prompt
        && Math.abs(candidate.createdAt - entry.createdAt) < 5 * 60_000,
      );
      if (possibleAck) {
        merged.delete(possibleAck[0]);
        existing = possibleAck[1];
      }
    }
    if (!existing) merged.set(key, entry);
    else merged.set(key, {
      ...entry,
      ...existing,
      prompt: existing.prompt || entry.prompt,
      createdAt: entry.createdAt || existing.createdAt,
      job: entry.job ?? existing.job,
      phase: entry.job?.status === 'running' ? 'waiting' : entry.job?.status === 'failed' ? 'failed' : entry.job ? 'complete' : existing.phase,
      confirmationPending: entry.job?.confirmationStatus === 'processing',
      confirmationError: entry.job?.confirmationStatus === 'processing'
        ? existing.confirmationError
        : entry.job?.confirmationStatus === 'available' && existing.confirmationPending
          ? 'No action was confirmed. Review the current table before trying again.'
          : undefined,
      requestError: entry.job ? undefined : existing.requestError,
      requestUncertain: entry.job ? false : existing.requestUncertain,
      pollError: entry.job ? undefined : existing.pollError,
      pollTimedOut: entry.job ? false : existing.pollTimedOut,
      checking: entry.job ? false : existing.checking,
      fromHistory: Boolean(existing.fromHistory || entry.fromHistory),
    });
  }
  return [...merged.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function timeLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' }).format(timestamp);
}

function TableConversation({
  compact,
  view,
  capabilities,
  readOnly,
  onRequest,
  onPoll,
  onHistory,
  onConfirm,
  onRefresh,
  onOpenObject,
}: {
  compact: boolean;
  view: TableWorkspaceView;
  capabilities: TabletopCapabilities;
  readOnly: boolean;
  onRequest: TableAssistantProps['onChatRequest'];
  onPoll: TableAssistantProps['onChatPoll'];
  onHistory: TableAssistantProps['onChatHistory'];
  onConfirm: TableAssistantProps['onChatConfirm'];
  onRefresh: TableAssistantProps['onChatRefresh'];
  onOpenObject: TableAssistantProps['onOpenObject'];
}) {
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [conversationExpanded, setConversationExpanded] = useState(!compact);
  const threadRef = useRef<HTMLDivElement>(null);
  const generation = useRef(0);
  const historyGeneration = useRef(0);
  const alive = useRef(true);
  const currentView = useRef(view);
  const currentPoll = useRef(onPoll);
  const currentRefresh = useRef(onRefresh);
  currentView.current = view;
  currentPoll.current = onPoll;
  currentRefresh.current = onRefresh;
  const tableAssistantAvailable = capabilities.tableAssistant?.available === true;
  const tableAssistantUnavailableReason = capabilities.tableAssistant?.reason
    || 'Table conversation is not available on this service. You can continue using the Canvas and reviewing rules.';
  const latest = entries[entries.length - 1];
  const pendingAction = entries.some((entry) => isPendingAction(entry, view));
  const busy = entries.some((entry) => entry.phase === 'sending' || entry.phase === 'waiting' || Boolean(entry.confirming || entry.confirmationPending));

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current += 1;
    };
  }, []);

  useEffect(() => {
    if (conversationExpanded) scrollConversation(threadRef.current, 'bottom');
  }, [conversationExpanded]);

  useEffect(() => {
    const token = ++historyGeneration.current;
    let cancelled = false;
    if (!tableAssistantAvailable) {
      setEntries([]);
      setHistoryCursor(null);
      setHistoryLoaded(false);
      setHistoryLoading(false);
      setHistoryError('');
      return () => { cancelled = true; };
    }
    setHistoryLoading(true);
    setHistoryError('');
    void onHistory(view).then((page) => {
      if (cancelled || !alive.current || historyGeneration.current !== token) return;
      setEntries((current) => mergeHistory(current, page.items.map(historyEntry)));
      setHistoryCursor(page.nextBefore);
      setHistoryLoaded(true);
      scrollConversation(threadRef.current, 'bottom');
    }).catch((error: unknown) => {
      if (!cancelled && alive.current && historyGeneration.current === token) setHistoryError(errorMessage(error));
    }).finally(() => {
      if (!cancelled && alive.current && historyGeneration.current === token) setHistoryLoading(false);
    });
    return () => { cancelled = true; };
  }, [view.id, view.epoch, view.actor.actorId, onHistory, tableAssistantAvailable]);

  const refreshHistory = async () => {
    if (!tableAssistantAvailable || historyLoading) return;
    const token = ++historyGeneration.current;
    setHistoryLoaded(false);
    setHistoryLoading(true);
    setHistoryError('');
    setHistoryCursor(null);
    try {
      const page = await onHistory(view);
      if (!alive.current || historyGeneration.current !== token) return;
      setEntries((current) => mergeHistory(current, page.items.map(historyEntry)));
      setHistoryCursor(page.nextBefore);
      setHistoryLoaded(true);
      scrollConversation(threadRef.current, 'bottom');
    } catch (error) {
      if (alive.current && historyGeneration.current === token) setHistoryError(errorMessage(error));
    } finally {
      if (alive.current && historyGeneration.current === token) setHistoryLoading(false);
    }
  };

  const uncertainRequest = entries.some((entry) => entry.requestUncertain && !entry.job);
  const canSend = tableAssistantAvailable && capabilities.model.enabled && !readOnly && historyLoaded && consent && prompt.trim().length >= 3 && !busy && !pendingAction && !uncertainRequest;
  const composerDisabledReason = readOnly
    ? 'This table is read-only.'
    : !capabilities.model.enabled
      ? capabilities.model.reason || 'The assistant is unavailable right now.'
      : historyError
        ? 'Refresh conversation history before sending.'
        : historyLoading || !historyLoaded
          ? 'Loading conversation history…'
          : busy
            ? 'Wait for the current response to finish.'
            : uncertainRequest
              ? 'Retry the same request or wait before sending another.'
              : pendingAction
                ? 'Review or skip the action proposal above before sending again.'
                : !consent
                  ? 'Agree above before sending.'
                  : prompt.trim().length < 3
                    ? 'Enter at least 3 characters.'
                    : '';

  const request = async (entry: ChatEntry) => {
    if (!entry.requestCommandId) return;
    const token = ++generation.current;
    updateEntry(setEntries, entry.id, (current) => ({ ...current, phase: 'sending', requestError: undefined, requestUncertain: false, pollError: undefined, pollTimedOut: false }));
    try {
      const accepted = await onRequest(view, entry.prompt, entry.requestCommandId);
      if (!alive.current || generation.current !== token) return;
      updateEntry(setEntries, entry.id, (current) => ({ ...current, job: accepted, phase: accepted.status === 'running' ? 'waiting' : accepted.status === 'failed' ? 'failed' : 'complete', requestError: accepted.status === 'failed' ? accepted.message || 'The assistant request failed.' : undefined, requestUncertain: false }));
    } catch (error) {
      if (!alive.current || generation.current !== token) return;
      updateEntry(setEntries, entry.id, (current) => ({ ...current, phase: 'failed', requestError: errorMessage(error), requestUncertain: error instanceof ApiFailure && error.status === 0 }));
    }
  };

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSend) return;
    const text = prompt.trim();
    const entry: ChatEntry = { id: crypto.randomUUID(), prompt: text, requestCommandId: crypto.randomUUID(), createdAt: Date.now(), phase: 'sending', job: null };
    setEntries((current) => [...current, entry]);
    scrollConversation(threadRef.current, 'bottom');
    setPrompt('');
    setConsent(false);
    void request(entry);
  };

  const retrySameRequest = (entry: ChatEntry) => {
    if (!tableAssistantAvailable || !entry.requestUncertain || busy) return;
    void request(entry);
  };

  const activePollKey = tableAssistantAvailable ? entries
    .filter((entry) => entry.job && !entry.pollTimedOut && (entry.job.status === 'running' || entry.job.confirmationStatus === 'processing'))
    .map((entry) => `${entry.id}:${entry.job?.id}`)
    .join('|') : '';
  const activePollScope = `${view.id}:${view.epoch}:${view.actor.actorId}|${activePollKey}`;

  useEffect(() => {
    if (!activePollKey) return;
    let cancelled = false;
    const activeEntries = entries.filter((entry) => entry.job && !entry.pollTimedOut && (entry.job.status === 'running' || entry.job.confirmationStatus === 'processing'));

    for (const entry of activeEntries) {
      const entryId = entry.id;
      const jobId = entry.job!.id;
      const startedAt = Date.now();
      void (async () => {
        for (let attempt = 0; attempt < 60 && Date.now() - startedAt < 60_000; attempt += 1) {
          await sleep(1_000);
          if (cancelled || !alive.current) return;
          try {
            const next = await currentPoll.current(currentView.current, jobId);
            if (cancelled || !alive.current) return;
            updateEntry(setEntries, entryId, (current) => ({
              ...current,
              job: next,
              phase: next.status === 'running' ? 'waiting' : next.status === 'failed' ? 'failed' : 'complete',
              confirmationPending: next.confirmationStatus === 'processing',
              confirmationError: next.confirmationStatus === 'available' && current.confirmationPending
                ? 'No action was confirmed. Review the current table before trying again.'
                : next.confirmationStatus === 'confirmed' || next.confirmationStatus === 'stale' || next.confirmationStatus === 'rejected'
                  ? undefined
                  : current.confirmationError,
              pollError: undefined,
              pollTimedOut: false,
            }));
            if (next.confirmationStatus === 'confirmed') {
              await currentRefresh.current(currentView.current);
              updateEntry(setEntries, entryId, (current) => ({ ...current, confirmationPending: false, confirming: false, confirmationError: undefined }));
              return;
            }
            if (next.status === 'failed' || (next.status === 'completed' && next.confirmationStatus !== 'processing')) return;
          } catch (error) {
            if (cancelled || !alive.current) return;
            updateEntry(setEntries, entryId, (current) => ({ ...current, pollError: errorMessage(error) }));
          }
        }
        if (!cancelled && alive.current) updateEntry(setEntries, entryId, (current) => ({ ...current, pollTimedOut: true }));
      })();
    }
    return () => { cancelled = true; };
  }, [activePollScope]);

  const checkStatus = async (entry: ChatEntry) => {
    if (!tableAssistantAvailable || !entry.job || entry.checking) return;
    updateEntry(setEntries, entry.id, (current) => ({ ...current, checking: true, pollError: undefined, pollTimedOut: true }));
    try {
      const next = await onPoll(view, entry.job.id);
      if (!alive.current) return;
      updateEntry(setEntries, entry.id, (current) => ({
        ...current,
        job: next,
        phase: next.status === 'running' ? 'waiting' : next.status === 'failed' ? 'failed' : 'complete',
        confirmationPending: next.confirmationStatus === 'processing',
        confirmationError: next.confirmationStatus === 'stale' || next.confirmationStatus === 'rejected' || next.confirmationStatus === 'confirmed' || next.confirmationStatus === 'available'
          ? undefined
          : current.confirmationError,
        pollError: undefined,
        pollTimedOut: next.status === 'running' || next.confirmationStatus === 'processing',
      }));
      if (next.confirmationStatus === 'confirmed') {
        await onRefresh(view);
        updateEntry(setEntries, entry.id, (current) => ({ ...current, confirmationPending: false, confirming: false }));
      }
    } catch (error) {
      if (alive.current) updateEntry(setEntries, entry.id, (current) => ({ ...current, pollError: errorMessage(error), pollTimedOut: true }));
    } finally {
      if (alive.current) updateEntry(setEntries, entry.id, (current) => ({ ...current, checking: false }));
    }
  };

  const loadOlder = async () => {
    if (!tableAssistantAvailable || !historyCursor || loadingOlder) return;
    const token = ++historyGeneration.current;
    setLoadingOlder(true);
    setHistoryError('');
    try {
      const page = await onHistory(view, historyCursor);
      if (!alive.current || historyGeneration.current !== token) return;
      setEntries((current) => mergeHistory(current, page.items.map(historyEntry)));
      setHistoryCursor(page.nextBefore);
      scrollConversation(threadRef.current, 'top');
    } catch (error) {
      if (alive.current && historyGeneration.current === token) setHistoryError(errorMessage(error));
    } finally {
      if (alive.current && historyGeneration.current === token) setLoadingOlder(false);
    }
  };

  const confirm = async (entry: ChatEntry) => {
    const job = entry.job;
    if (!tableAssistantAvailable || !job || job.result?.kind !== 'action-proposal' || !isPendingAction(entry, view) || entry.confirming) return;
    const commandId: CommandId = entry.confirmCommandId ?? crypto.randomUUID();
    updateEntry(setEntries, entry.id, (current) => ({
      ...current,
      confirming: true,
      confirmationPending: true,
      confirmCommandId: commandId,
      confirmationError: undefined,
      job: current.job ? { ...current.job, confirmationStatus: 'processing' } : null,
    }));
    try {
      await onConfirm(view, job, commandId);
      if (!alive.current) return;
      updateEntry(setEntries, entry.id, (current) => ({
        ...current,
        confirming: false,
        confirmationPending: false,
        confirmationError: undefined,
        job: current.job ? { ...current.job, confirmationStatus: 'confirmed' } : null,
      }));
    } catch (error) {
      if (!alive.current) return;
      updateEntry(setEntries, entry.id, (current) => ({ ...current, confirming: false, confirmationPending: true, confirmationError: `${errorMessage(error)} Checking the saved confirmation status…`, pollTimedOut: false }));
    }
  };

  return <section className="tt-table-chat" aria-labelledby="tt-table-chat-title" data-testid="table-chat">
    <div className="tt-table-chat__intro">
      <h3 id="tt-table-chat-title">Ask about the table</h3>
      <p>Ask about rules, shared records, or one action to prepare.</p>
    </div>

    {!tableAssistantAvailable ? <p className="tt-table-chat__notice" role="status"><AlertCircle size={14} />{tableAssistantUnavailableReason}</p> : <>
    <details
      className="tt-table-chat__history"
      open={conversationExpanded}
      onToggle={(event) => setConversationExpanded(event.currentTarget.open)}
    >
      <summary>
        <span>Conversation</span>
        <span className="tt-table-chat__history-count" aria-label={historyLoading && !historyLoaded ? 'Loading' : historyError ? 'Unavailable' : `${entries.length} ${entries.length === 1 ? 'exchange' : 'exchanges'}`}>
          {historyLoading && !historyLoaded ? 'Loading' : historyError ? 'Unavailable' : entries.length}
        </span>
      </summary>
      <div className="tt-table-chat__history-content">
        <div className="tt-table-chat__history-tools">
          <span>{historyLoading ? 'Loading history…' : historyLoaded ? 'Private history' : 'History unavailable'}</span>
          <button type="button" className="tt-button tt-button--quiet" disabled={historyLoading} onClick={() => void refreshHistory()}>Refresh</button>
        </div>
        {historyError && <p className="tt-table-chat__notice" role="alert"><AlertCircle size={14} />{historyError} Refresh history before sending another message.</p>}
        <div ref={threadRef} className="tt-table-chat__thread" aria-live="polite" aria-label="Assistant conversation">
          {historyCursor && <button type="button" className="tt-button tt-button--quiet tt-table-chat__older" disabled={loadingOlder} onClick={() => void loadOlder()}>{loadingOlder ? <LoaderCircle size={13} className="tt-spin" /> : null}Older messages</button>}
          {historyLoading && entries.length === 0 ? <div className="tt-table-chat__empty"><LoaderCircle size={16} className="tt-spin" /><p>Loading conversation…</p></div> : entries.length === 0 ? <div className="tt-table-chat__empty"><MessageCircle size={17} /><p>Your conversation will appear here.</p></div> : entries.map((entry) => <article className="tt-table-chat__exchange" key={entry.job?.id ?? entry.id}>
            <time className="tt-table-chat__time" dateTime={new Date(entry.createdAt).toISOString()}>{timeLabel(entry.createdAt)}</time>
            <div className="tt-table-chat__user"><span>You</span><p>{entry.prompt}</p></div>
            {entry.job?.result ? <AssistantResultCard entry={entry} view={view} readOnly={readOnly} onOpenObject={onOpenObject} onConfirm={() => void confirm(entry)} onDismiss={() => updateEntry(setEntries, entry.id, (current) => ({ ...current, dismissed: true }))} /> : entry.phase === 'sending' || entry.phase === 'waiting' ? <div className="tt-table-chat__pending" role="status"><LoaderCircle size={14} className="tt-spin" /><span>{entry.phase === 'sending' ? 'Sending your request…' : 'Preparing a response…'} You can keep using the Canvas.</span></div> : <div className="tt-table-chat__error" role="alert"><AlertCircle size={14} /><span>{entry.requestError ?? entry.job?.message ?? 'No response was received.'}</span>{entry.requestUncertain && <button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={() => retrySameRequest(entry)}>Retry same request</button>}</div>}
            {entry.pollError && <p className="tt-table-chat__substatus" role="status">Status check: {entry.pollError}</p>}
            {entry.pollTimedOut && (entry.phase === 'waiting' || entry.confirmationPending) && <button type="button" className="tt-button tt-button--quiet tt-table-chat__check" disabled={entry.checking} onClick={() => void checkStatus(entry)}>{entry.checking ? <LoaderCircle size={13} className="tt-spin" /> : null}Check status</button>}
          </article>)}
        </div>
      </div>
    </details>

    <form className="tt-table-chat__form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="tt-table-chat-prompt">Message</label>
      <div className="tt-table-chat__compose-row">
        <textarea id="tt-table-chat-prompt" value={prompt} maxLength={2000} rows={2} disabled={readOnly || !capabilities.model.enabled || !historyLoaded || Boolean(historyError) || busy || pendingAction || uncertainRequest} onChange={(event) => setPrompt(event.target.value)} placeholder="Ask a question or name one action to prepare…" aria-describedby={composerDisabledReason ? 'tt-table-chat-send-help' : undefined} />
        <button type="submit" className="tt-button tt-button--primary" disabled={!canSend} aria-describedby={composerDisabledReason ? 'tt-table-chat-send-help' : undefined}>{busy ? <LoaderCircle size={14} className="tt-spin" /> : <Send size={14} />}Send</button>
      </div>
      <details className="tt-table-chat__privacy">
        <summary>What the AI provider receives</summary>
        <p>Your message, active rules without source quotations, shared records, your role and seat, whose turn it is, and at most six conversation exchanges (up to 16 KiB) are sent to the configured AI provider. This includes recent exchanges and up to two related older exchanges selected by keywords from your last 100 completed exchanges in this table. Earlier discussion can be outdated; the current table state remains authoritative. Known membership names and account IDs are redacted or mapped to a seat alias in messages, rules, records and selected conversation. Arbitrary user-authored text is not promised to be anonymous; avoid sensitive personal details in messages or shared records. Account profiles, table files, draft rules, source quotations, assumptions, full rule and event history, and activity are excluded. Members can add table files and the owner manages rule drafts; rule drafting uses separate consent and sends all selected source files.</p>
      </details>
      <label className="tt-table-chat__consent"><input type="checkbox" checked={consent} disabled={readOnly || !capabilities.model.enabled || !historyLoaded || Boolean(historyError) || busy || pendingAction || uncertainRequest} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to share this message and table context with the AI provider.</span></label>
      {composerDisabledReason && <p id="tt-table-chat-send-help" className="tt-table-chat__send-help" role="status">{composerDisabledReason}</p>}
      {latest?.job?.status === 'completed' && latest.job.confirmationStatus === 'available' && latest.job.result?.kind === 'action-proposal' && isStale(latest.job, view) && <p className="tt-table-chat__notice" role="status">The table changed after this proposal. It cannot be confirmed; review the latest rules and ask again.</p>}
    </form>
    </>}
  </section>;
}

function AssistantResultCard({ entry, view, readOnly, onOpenObject, onConfirm, onDismiss }: {
  entry: ChatEntry;
  view: TableWorkspaceView;
  readOnly: boolean;
  onOpenObject: (id: string) => void;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const job = entry.job;
  const result = job?.result;
  if (!job || !result) return null;
  const action = result.kind === 'action-proposal' ? view.domain.program?.actions.find((item) => item.id === result.actionId) : undefined;
  const actorSeat = view.actor.role === 'owner' ? 'host' : view.actor.seat;
  const turnAllowed = action ? action.roles.includes(view.actor.role as 'owner' | 'participant') && (!action.requireTurn || view.domain.turn === actorSeat) : false;
  const confirmationStatus = job.confirmationStatus;
  const terminalConfirmationMessage = confirmationStatus === 'stale'
    ? job.message || 'The table changed before confirmation. This proposal was not applied.'
    : confirmationStatus === 'rejected'
      ? job.message || 'The current rules or turn did not allow this proposal. It was not applied.'
      : confirmationStatus === 'confirmed'
        ? 'Confirmed and applied to the shared table.'
        : null;

  return <section className={`tt-table-chat__answer${result.kind === 'action-proposal' ? ' is-proposal' : ''}`} aria-label={result.kind === 'action-proposal' ? 'AI-provided action proposal' : 'AI response'}>
    <div className="tt-table-chat__answer-label"><Sparkles size={13} /><strong>{result.kind === 'action-proposal' ? 'AI-provided proposal' : 'AI response'}</strong></div>
    <p>{result.text}</p>
    {((job.serverOmittedConversationEntries ?? 0) + (job.providerOmittedConversationEntries ?? 0)) > 0 && <p className="tt-table-chat__substatus" role="status">Some older messages were left out of this request to stay within the assistant’s context limit. You can still review them above.</p>}
    {result.kind === 'explanation' && result.references.length > 0 && <div className="tt-table-chat__references" aria-label="Table references">{result.references.map((reference, index) => <button type="button" key={`${reference.kind}:${'id' in reference ? reference.id : reference.seat}:${index}`} onClick={() => onOpenObject(objectForReference(reference))}><BookOpen size={12} />{reference.label}</button>)}</div>}
    {result.kind === 'action-proposal' && <div className="tt-table-chat__action-preview" aria-label="Proposed action details">
      <strong>{action?.title ?? 'Action no longer available'}</strong>
      {action && Object.entries(result.inputs).map(([key, value]) => {
        const input = formatInput(view, result.actionId, key, value);
        return <div key={key}><span>{input.label}</span><b>{input.value}</b></div>;
      })}
      {!action && <p>This action is not in the current active rules.</p>}
      {result.confirmationRequired && <p className="tt-table-chat__confirm-note">This proposal will run only if you confirm it. Current membership, turn and rules are checked again by the table.</p>}
    </div>}
    {terminalConfirmationMessage && <p className={`tt-table-chat__substatus tt-table-chat__confirmation-${confirmationStatus}`} role="status">{terminalConfirmationMessage}</p>}
    {entry.confirmationError && <p className="tt-table-chat__substatus" role="status">{entry.confirmationError}</p>}
    {result.kind === 'action-proposal' && <div className="tt-table-chat__answer-actions">
      <button type="button" className="tt-button tt-button--primary" onClick={onConfirm} disabled={readOnly || !isPendingAction(entry, view) || !turnAllowed || entry.confirming || entry.confirmationPending} aria-label="Confirm action">{entry.confirming || entry.confirmationPending ? <LoaderCircle size={14} className="tt-spin" /> : <Check size={14} />}Confirm action</button>
      <button type="button" className="tt-button tt-button--quiet" onClick={onDismiss} disabled={entry.confirming || entry.confirmationPending}>Skip this proposal</button>
    </div>}
  </section>;
}

export function TableAssistant({
  compact = false, view, capabilities, readOnly, onRequest, onPoll, onRefresh, onAttachFile,
  onOpenSources, onOpenRules, onOpenActions, onReviewDraft,
  onChatRequest, onChatPoll, onChatHistory, onChatConfirm, onChatRefresh, onOpenObject, rulePrefill,
}: TableAssistantProps) {
  const initiallyReviewingRules = managesTable(view) && !readOnly && view.domain.kind === 'table'
    && (!view.domain.program || Boolean(view.domain.candidate && view.domain.candidate.status !== 'active'));
  const [mode, setMode] = useState<AssistantMode>(initiallyReviewingRules ? 'rules' : 'chat');
  const hadActiveProgram = useRef(Boolean(view.domain.kind === 'table' && view.domain.program));

  useEffect(() => {
    if (view.domain.kind !== 'table') return;
    const active = Boolean(view.domain.program);
    if (!hadActiveProgram.current && active && managesTable(view) && mode === 'rules') setMode('chat');
    hadActiveProgram.current = active;
  }, [view.domain, view.actor.role, mode]);

  if (view.kind !== 'table' || view.domain.kind !== 'table') return null;

  const pendingDraft = Boolean(view.domain.candidate && view.domain.candidate.status !== 'active');
  const isOwner = managesTable(view);
  const turnLabel = hasTurnOrder(view) ? currentTurnLabel(view, view.domain.turn) : null;
  const rulesModeLabel = view.domain.program ? 'Rules' : 'Set up';

  return <section className={`tt-table-assistant${compact ? ' is-compact' : ''}`} data-testid="table-assistant" aria-labelledby="tt-table-assistant-title">
    <header className="tt-table-assistant__head">
      <span className="tt-table-assistant__mark" aria-hidden="true"><Sparkles size={16} /></span>
      <div><h2 id="tt-table-assistant-title">Table assistant</h2></div>
      {turnLabel && <span className="tt-table-assistant__turn" aria-label={`Current turn: ${turnLabel}`}>{turnLabel}</span>}
    </header>
    {isOwner && <nav className="tt-table-assistant__modes" aria-label="Assistant mode">
      <button type="button" aria-pressed={mode === 'chat'} className={mode === 'chat' ? 'is-active' : ''} onClick={() => setMode('chat')}><MessageCircle size={13} />Chat</button>
      <button type="button" aria-label={view.domain.program ? 'Open rules and sources' : 'Set up this table from sources'} aria-pressed={mode === 'rules'} className={mode === 'rules' ? 'is-active' : ''} onClick={() => setMode('rules')}><BookOpen size={13} />{rulesModeLabel}</button>
    </nav>}

    {isOwner && mode === 'rules' ? <div className="tt-table-assistant__rules-mode">
      <AIProposal
        view={view}
        capabilities={capabilities}
        onRequest={onRequest}
        onPoll={onPoll}
        onRefresh={onRefresh}
        onAttachFile={onAttachFile}
        onOpenSources={onOpenSources}
        onReviewDraft={onReviewDraft}
        readOnly={readOnly}
        embedded
        prefill={rulePrefill}
      />
    </div> : <>
      {!compact && <details className="tt-table-assistant__canvas-tools">
        <summary>Table tools</summary>
        <div className="tt-table-assistant__direct-links" aria-label="Open table tools">
          <button type="button" onClick={onOpenActions} disabled={!view.domain.program}><ArrowRight size={14} />Open actions</button>
          <button type="button" onClick={onOpenRules}><BookOpen size={14} />View active rules</button>
          {isOwner && pendingDraft && <button type="button" onClick={onReviewDraft}><Check size={14} />Review rule draft</button>}
        </div>
      </details>}
      {!view.domain.program && <p className="tt-table-assistant__waiting">No shared rules yet. Choose Set up to add a source.</p>}
      <TableConversation
        compact={compact}
        view={view}
        capabilities={capabilities}
        readOnly={readOnly}
        onRequest={onChatRequest}
        onPoll={onChatPoll}
        onHistory={onChatHistory}
        onConfirm={onChatConfirm}
        onRefresh={onChatRefresh}
        onOpenObject={onOpenObject}
      />
    </>}
  </section>;
}
