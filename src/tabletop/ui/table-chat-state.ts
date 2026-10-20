import type { ModelJob } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';

export function tableChatMode(role: 'owner' | 'participant', hasActiveProgram: boolean, explicitDraft: boolean): 'draft' | 'ask' {
  return role === 'owner' && (!hasActiveProgram || explicitDraft) ? 'draft' : 'ask';
}

export interface ChatRequestScope {
  id: string;
  epoch: number;
  kind: string;
  actor: { actorId: string; role: string };
}

/** Same-command retries may use an older revision only for the same seat and table epoch. */
export function sameChatRequestScope(snapshot: ChatRequestScope, current: ChatRequestScope): boolean {
  return snapshot.id === current.id
    && snapshot.epoch === current.epoch
    && snapshot.kind === current.kind
    && snapshot.actor.actorId === current.actor.actorId
    && snapshot.actor.role === current.actor.role;
}

export interface ChatCard {
  id: string;
  kind: 'draft' | 'answer';
  prompt: string;
  createdAt: number;
  phase: 'sending' | 'waiting' | 'complete' | 'failed';
  requestCommandId?: string;
  /** In-memory snapshot used only to retry an uncertain request with its original body. */
  requestView?: WorkspaceView;
  requestUncertain?: boolean;
  requestError?: string;
  modelJob?: ModelJob;
  job?: TableAssistantJob;
  error?: string;
  pollError?: string;
  pollTimedOut?: boolean;
  checking?: boolean;
  confirmId?: string;
  confirming?: boolean;
  confirmationPending?: boolean;
  confirmationError?: string;
}

export function historyCard(job: TableAssistantJob, id: string): ChatCard {
  return {
    id,
    kind: 'answer',
    prompt: job.prompt,
    createdAt: job.createdAt,
    phase: job.status === 'running' ? 'waiting' : job.status === 'failed' ? 'failed' : 'complete',
    job,
    error: job.status === 'failed' ? job.message ?? 'The assistant request failed.' : undefined,
    confirmationPending: job.confirmationStatus === 'processing',
  };
}

/** Merge only by an exact server job ID; the history contract does not expose command IDs. */
export function mergeChatHistory(current: readonly ChatCard[], incoming: readonly ChatCard[]): ChatCard[] {
  const merged = new Map<string, ChatCard>();
  for (const card of current) merged.set(card.job?.id ?? card.id, card);
  for (const card of incoming) {
    const key = card.job?.id ?? card.id;
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, card);
      continue;
    }
    const job = card.job ?? existing.job;
    merged.set(key, {
      ...card,
      ...existing,
      id: existing.id,
      prompt: existing.prompt || card.prompt,
      createdAt: card.createdAt || existing.createdAt,
      job,
      phase: job?.status === 'running' ? 'waiting' : job?.status === 'failed' ? 'failed' : job ? 'complete' : existing.phase,
      error: job?.status === 'failed' ? job.message ?? existing.error ?? 'The assistant request failed.' : undefined,
      requestError: job ? undefined : existing.requestError,
      requestUncertain: job ? false : existing.requestUncertain,
      pollError: job ? undefined : existing.pollError,
      pollTimedOut: job ? false : existing.pollTimedOut,
      checking: job ? false : existing.checking,
      confirmationPending: job?.confirmationStatus === 'processing',
      confirmationError: job?.confirmationStatus === 'available' && existing.confirmationPending
        ? 'No action was confirmed. Review the current table before trying again.'
        : job?.confirmationStatus === 'confirmed' || job?.confirmationStatus === 'stale' || job?.confirmationStatus === 'rejected'
          ? undefined
          : existing.confirmationError,
    });
  }
  return [...merged.values()].sort((left, right) => right.createdAt - left.createdAt);
}

export function isUncertainRequest(card: ChatCard): boolean {
  return card.requestUncertain === true && !card.job && !card.modelJob;
}
