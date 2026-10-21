import type { ModelJob } from '../client';
import type { WorkspaceView } from '../shared/contracts';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';

export interface TableChatRequestContext { prompt: string; hasCreateAction: boolean }

export function tableChatMode(role: 'owner' | 'participant', hasActiveProgram: boolean, explicitDraft: boolean, request?: TableChatRequestContext): 'draft' | 'ask' {
  if (role !== 'owner') return 'ask';
  if (!hasActiveProgram || explicitDraft) return 'draft';
  const prompt = request?.prompt.trim() ?? '';
  // Only an obvious construction request takes this fast path. Ambiguous intent
  // stays conversational; the assistant can offer the same builder explicitly.
  if (!prompt || /^(?:(?:how many|what|which|why|explain|summari[sz]e)\b|อธิบาย|สรุป|ทำไม|มี.{0,32}กี่)/iu.test(prompt)) return 'ask';
  const asksForChange = /\b(?:add|creat\w*|build|make|design|extend|chang\w*|edit|new|simplify)\b|เพิ่ม|สร้าง|ปรับ|แก้|ทำ|ขอ|อยาก/iu.test(prompt);
  const asksForUi = asksForChange && /\b(?:forms?|buttons?|cards?|charts?|graphs?|diagrams?|views?|ui)\b|ฟอร์ม|ปุ่ม|การ์ด|กราฟ|แผนภูมิ|หน้าจอ/iu.test(prompt);
  // "Change status in this table" is a data action. Require a direct
  // structural request before treating table/field words as builder intent.
  const asksForStructure = /\b(?:add|creat\w*|build|make|design|extend)\s+(?:(?:a|an|the|this|new|another|extra)\s+)*(?:tables?|collections?|columns?|fields?)\b|\b(?:new|another|extra)\s+(?:tables?|collections?|columns?|fields?)\b|(?:เพิ่ม|สร้าง)\s*(?:ตาราง|คอลัมน์|ฟิลด์)/iu.test(prompt);
  const newRows = /\b(?:add|creat\w*|generat\w*|seed|mock\w*|sample)\b|เพิ่ม|สร้าง|จำลอง|ตัวอย่าง/iu.test(prompt)
    && /\b(?:records?|rows?|data|mock\w*|samples?)\b|รายการ|แถว|ข้อมูล|จำลอง|ตัวอย่าง/iu.test(prompt);
  return asksForUi || asksForStructure || (newRows && !request?.hasCreateAction) ? 'draft' : 'ask';
}

export interface ChatRequestScope {
  id: string;
  epoch: number;
  kind: string;
  actor: { actorId: string; role: string; seat?: string };
}

/** Same-command retries may use an older revision only for the same seat and table epoch. */
export function sameChatRequestScope(snapshot: ChatRequestScope, current: ChatRequestScope): boolean {
  return snapshot.id === current.id
    && snapshot.epoch === current.epoch
    && snapshot.kind === current.kind
    && snapshot.actor.actorId === current.actor.actorId
    && snapshot.actor.role === current.actor.role
    && snapshot.actor.seat === current.actor.seat;
}

/** A delayed read may not replace a newer projection or a different private scope. */
export function canApplyWorkspaceRefresh(
  expected: ChatRequestScope,
  current: ChatRequestScope | null,
  received: ChatRequestScope,
  requestSequence: number,
  currentSequence: number,
): boolean {
  return current !== null
    && requestSequence === currentSequence
    && sameChatRequestScope(expected, current)
    && sameChatRequestScope(expected, received);
}

export interface ChatCard {
  id: string;
  kind: 'draft' | 'answer';
  prompt: string;
  createdAt: number;
  phase: 'sending' | 'waiting' | 'complete' | 'failed';
  requestCommandId?: ReturnType<typeof crypto.randomUUID>;
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
  confirmId?: ReturnType<typeof crypto.randomUUID>;
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

/** Apply draft-refresh results only while they still belong to the current private table scope. */
export function draftRefreshPatch(targetScope: string, currentScope: string, error?: string): Pick<ChatCard, 'checking' | 'pollError' | 'pollTimedOut'> | null {
  if (!targetScope || targetScope !== currentScope) return null;
  return error
    ? { checking: false, pollError: `The draft is ready, but the table could not refresh: ${error}` }
    : { checking: false, pollError: undefined, pollTimedOut: false };
}

/** F025: when a concurrent projection wins the race, wait briefly and reapply instead of failing the draft. */
export function draftRefreshBackoffMs(attempt: number): number {
  return 150 * (attempt + 1);
}
