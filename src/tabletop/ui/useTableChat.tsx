import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, CircleAlert, LoaderCircle, Sparkles, X } from 'lucide-react';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantHistoryPage, TableAssistantJob, TableAssistantReference } from '../shared/table-assistant-contracts';
import type { TableState } from '../shared/table-contracts';
import type { ModelJob } from '../client';
import type { CanvasAuxiliaryObject } from './CanvasWorkspace';
import { TableChat } from './TableChat';

type TableView = WorkspaceView & { kind: 'table'; domain: TableState };
type CommandId = ReturnType<typeof crypto.randomUUID>;

const DRAFT_POLL_MS = 1_200;
const DRAFT_POLL_TRIES = 50;
const ANSWER_POLL_MS = 1_000;
const ANSWER_POLL_TRIES = 60;
const HISTORY_CARDS = 6;
const ACCEPT_FILES = '.csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown';

export interface ChatCard {
  id: string;
  kind: 'draft' | 'answer';
  prompt: string;
  phase: 'waiting' | 'complete' | 'failed';
  job?: TableAssistantJob;
  error?: string;
  confirmId?: CommandId;
  confirming?: boolean;
}

export interface UseTableChatOptions {
  view: WorkspaceView | null;
  aiEnabled: boolean;
  readOnly: boolean;
  requestDraft: (view: WorkspaceView, prompt: string, commandId: CommandId) => Promise<ModelJob>;
  pollDraft: (workspaceId: string, jobId: string) => Promise<ModelJob>;
  refresh: (workspaceId: string) => Promise<void>;
  ask: (view: TableView, prompt: string, commandId: CommandId) => Promise<TableAssistantJob>;
  pollAsk: (view: TableView, jobId: string) => Promise<TableAssistantJob>;
  loadHistory: (view: TableView) => Promise<TableAssistantHistoryPage>;
  confirm: (view: TableView, job: TableAssistantJob, commandId: CommandId) => Promise<void>;
  attach: (view: WorkspaceView, file: File) => Promise<WorkspaceView>;
  focusObject: (id: string) => void;
  notify: (text: string, tone: 'info' | 'error' | 'success') => void;
  prefill?: { text: string; key: number };
}

function isTableView(view: WorkspaceView | null): view is TableView {
  return Boolean(view && view.kind === 'table' && view.domain.kind === 'table');
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const errorText = (error: unknown) => error instanceof Error && error.message ? error.message : 'The request could not be completed. Try again.';

function objectForReference(reference: TableAssistantReference): string {
  if (reference.kind === 'rule') return 'table.rules';
  if (reference.kind === 'action' || reference.kind === 'turn') return 'table.actions';
  return `table.collection.${reference.collectionId}`;
}

function proposalIsStale(job: TableAssistantJob, view: TableView): boolean {
  if (job.result?.kind !== 'action-proposal') return true;
  return job.expectedEpoch !== view.epoch
    || job.result.expectedRevision !== view.revision
    || job.result.expectedRuleRevision !== view.domain.ruleRevision
    || job.result.expectedActionRevision !== view.domain.actionRevision;
}

/** Owners shape an empty table by drafting rules; once rules exist everyone asks the table. */
function chatMode(view: TableView): 'draft' | 'ask' {
  const hasRules = Boolean(view.domain.program || view.domain.candidate);
  return view.actor.role === 'owner' && !hasRules ? 'draft' : 'ask';
}

export function useTableChat(options: UseTableChatOptions): { bar: ReactNode; cards: CanvasAuxiliaryObject[] } {
  const { view, aiEnabled, readOnly } = options;
  const table = isTableView(view) ? view : null;
  const scope = table ? `${table.id}:${table.epoch}:${table.actor.actorId}` : '';
  const [cards, setCards] = useState<ChatCard[]>([]);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const viewRef = useRef(table);
  viewRef.current = table;

  const patch = useCallback((id: string, change: Partial<ChatCard>) => {
    setCards((current) => current.map((card) => card.id === id ? { ...card, ...change } : card));
  }, []);

  // Each table, epoch and seat has its own private conversation.
  useEffect(() => {
    setCards([]);
    const current = viewRef.current;
    if (!current) return;
    let alive = true;
    optionsRef.current.loadHistory(current).then((page) => {
      if (!alive) return;
      const recent = page.items.filter((job) => job.status === 'completed' && job.result).slice(0, HISTORY_CARDS);
      setCards(recent.map((job) => ({ id: `answer-${job.id}`, kind: 'answer', prompt: job.prompt, phase: 'complete', job })));
    }, () => { /* History is optional; new questions still work. */ });
    return () => { alive = false; };
  }, [scope]);

  const draft = useCallback(async (current: TableView, prompt: string) => {
    const commandId = crypto.randomUUID();
    const id = `draft-${commandId}`;
    const startScope = scopeRef.current;
    setCards((list) => [{ id, kind: 'draft', prompt, phase: 'waiting' }, ...list]);
    optionsRef.current.focusObject(`chat.${id}`);
    try {
      const job = await optionsRef.current.requestDraft(current, prompt, commandId);
      for (let attempt = 0; attempt < DRAFT_POLL_TRIES; attempt += 1) {
        if (scopeRef.current !== startScope) return;
        const status = await optionsRef.current.pollDraft(current.id, job.id);
        if (status.status === 'completed' || status.status === 'complete') {
          await optionsRef.current.refresh(current.id);
          patch(id, { phase: 'complete' });
          return;
        }
        if (status.status === 'failed') {
          patch(id, { phase: 'failed', error: status.message ?? 'The draft could not be prepared. Try describing the table again.' });
          return;
        }
        await wait(DRAFT_POLL_MS);
      }
      patch(id, { phase: 'failed', error: 'The draft is taking longer than usual. Refresh the table in a moment to see it.' });
    } catch (error) {
      patch(id, { phase: 'failed', error: errorText(error) });
    }
  }, [patch]);

  const askTable = useCallback(async (current: TableView, prompt: string) => {
    const commandId = crypto.randomUUID();
    const id = `answer-${commandId}`;
    const startScope = scopeRef.current;
    setCards((list) => [{ id, kind: 'answer', prompt, phase: 'waiting' }, ...list]);
    optionsRef.current.focusObject(`chat.${id}`);
    try {
      let job = await optionsRef.current.ask(current, prompt, commandId);
      for (let attempt = 0; job.status === 'running' && attempt < ANSWER_POLL_TRIES; attempt += 1) {
        await wait(ANSWER_POLL_MS);
        if (scopeRef.current !== startScope) return;
        job = await optionsRef.current.pollAsk(current, job.id);
      }
      if (job.status === 'completed' && job.result) patch(id, { phase: 'complete', job });
      else patch(id, { phase: 'failed', job, error: job.message ?? (job.status === 'running' ? 'The answer is taking longer than usual. Ask again in a moment.' : 'No answer was received.') });
    } catch (error) {
      patch(id, { phase: 'failed', error: errorText(error) });
    }
  }, [patch]);

  const send = useCallback(async (message: string): Promise<boolean> => {
    const current = viewRef.current;
    if (!current) return false;
    if (chatMode(current) === 'draft') {
      if (current.domain.sources.length === 0) {
        optionsRef.current.notify('Attach a file first so AI can draft the rules.', 'info');
        return false;
      }
      void draft(current, message);
      return true;
    }
    if (Array.from(message).length < 3) {
      optionsRef.current.notify('Write a few more words so the table can answer.', 'info');
      return false;
    }
    void askTable(current, message);
    return true;
  }, [askTable, draft]);

  const confirmCard = useCallback(async (card: ChatCard) => {
    const current = viewRef.current;
    if (!current || !card.job) return;
    const confirmId = card.confirmId ?? crypto.randomUUID();
    patch(card.id, { confirming: true, confirmId });
    try {
      await optionsRef.current.confirm(current, card.job, confirmId);
      patch(card.id, { confirming: false, job: { ...card.job, confirmationStatus: 'confirmed' } });
    } catch (error) {
      patch(card.id, { confirming: false, error: errorText(error) });
    }
  }, [patch]);

  const dismiss = useCallback((id: string) => setCards((list) => list.filter((card) => card.id !== id)), []);

  const auxiliary = useMemo<CanvasAuxiliaryObject[]>(() => {
    if (!table) return [];
    return cards.map((card, index) => ({
      id: `chat.${card.id}`,
      title: card.prompt.length > 48 ? `${card.prompt.slice(0, 47)}…` : card.prompt,
      eyebrow: card.kind === 'draft' ? 'Rule draft' : 'AI answer',
      position: { x: 760, y: 40 + index * 300 },
      content: <ChatCardContent card={card} view={table} readOnly={readOnly}
        onOpenObject={options.focusObject} onConfirm={() => void confirmCard(card)} onDismiss={() => dismiss(card.id)} />,
    }));
  }, [cards, confirmCard, dismiss, options.focusObject, readOnly, table]);

  if (!table) return { bar: null, cards: [] };
  const mode = chatMode(table);
  const isOwner = table.actor.role === 'owner';
  const placeholder = !aiEnabled ? 'AI is off for this table'
    : mode === 'draft' ? (table.domain.sources.length === 0 ? 'Attach a file, then describe your table' : 'Describe how this table should work')
      : 'Ask about this table';

  const bar = <TableChat
    key={scope}
    sourceIds={mode === 'draft' ? table.domain.sources.map((source) => source.id) : []}
    sharesTable={mode === 'ask'}
    placeholder={placeholder}
    aiEnabled={aiEnabled && !readOnly}
    canAttach={isOwner && !readOnly}
    busy={false}
    acceptFiles={ACCEPT_FILES}
    prefill={options.prefill}
    onAttach={async (file) => { await options.attach(table, file).catch(() => undefined); }}
    onSend={send}
  />;
  return { bar, cards: auxiliary };
}

function ChatCardContent({ card, view, readOnly, onOpenObject, onConfirm, onDismiss }: { card: ChatCard; view: TableView; readOnly: boolean; onOpenObject: (id: string) => void; onConfirm: () => void; onDismiss: () => void }) {
  const dismissButton = <button type="button" className="tt-chat-card__dismiss" aria-label="Close this card" onClick={onDismiss}><X size={13} /></button>;
  if (card.phase === 'waiting') {
    return <div className="tt-chat-card" role="status"><p className="tt-chat-card__pending"><LoaderCircle size={14} className="tt-spin" />{card.kind === 'draft' ? 'Preparing a rule draft…' : 'Preparing an answer…'}</p></div>;
  }
  if (card.phase === 'failed') {
    return <div className="tt-chat-card"><p className="tt-chat-card__error" role="alert"><CircleAlert size={14} />{card.error}</p>{dismissButton}</div>;
  }
  if (card.kind === 'draft') {
    return <div className="tt-chat-card"><p><Sparkles size={14} /> A rule draft is ready. Review it before anyone uses it.</p>
      <button type="button" className="tt-button tt-button--primary" onClick={() => onOpenObject('table.rules')}><ArrowRight size={14} />Review rules</button>{dismissButton}</div>;
  }
  const result = card.job?.result;
  if (!result || !card.job) return <div className="tt-chat-card"><p>No answer was received.</p>{dismissButton}</div>;
  const references = result.kind === 'explanation' ? result.references : [];
  if (result.kind !== 'action-proposal') {
    return <div className="tt-chat-card" data-testid="chat-answer-card">
      <p className="tt-chat-card__text">{result.text}</p>
      {references.length > 0 && <div className="tt-chat-card__references">{references.map((reference, index) => <button type="button" key={`${reference.kind}-${index}`} onClick={() => onOpenObject(objectForReference(reference))}>{reference.label}</button>)}</div>}
      {dismissButton}
    </div>;
  }
  const status = card.job.confirmationStatus;
  const stale = proposalIsStale(card.job, view);
  const action = view.domain.program?.actions.find((item) => item.id === result.actionId);
  const confirmed = status === 'confirmed';
  return <div className="tt-chat-card is-proposal" data-testid="chat-answer-card">
    <p className="tt-chat-card__text">{result.text}</p>
    <dl className="tt-chat-card__inputs">
      <dt>Action</dt><dd>{action?.title ?? result.actionId}</dd>
      {Object.entries(result.inputs).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join(', ') : String(value ?? '—')}</dd></div>)}
    </dl>
    {confirmed ? <p className="tt-chat-card__done"><Check size={14} />Confirmed. See Table history for the result.</p>
      : stale || status === 'stale' ? <p className="tt-chat-card__error">The table changed after this proposal. It cannot be confirmed. Ask again for a fresh proposal.</p>
        : <button type="button" className="tt-button tt-button--primary" disabled={readOnly || card.confirming || status !== 'available'} onClick={onConfirm}>{card.confirming ? <LoaderCircle size={14} className="tt-spin" /> : <Check size={14} />}Confirm action</button>}
    {card.error && <p className="tt-chat-card__error" role="alert">{card.error}</p>}
    {dismissButton}
  </div>;
}
