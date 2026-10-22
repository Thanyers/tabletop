import { VISIBILITY_POLICY } from '../src/tabletop/shared/visibility.js';
import { DurableObject } from 'cloudflare:workers';
import type { AuthenticatedSession, AuthorizedWorkspace } from '../server/authority.js';
import type { CommandAck, Seat, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { CommandAuthority } from '../server/authority.js';
import { AuthorityError, safeError } from '../server/errors.js';
import { canonicalJson, hashValue, isRecord, randomId, randomToken, sha256 } from '../server/codec.js';
import { exportInvoice } from '../server/exports.js';
import { projectionCursor } from '../server/projection-cursor.js';
import { MAX_MEMBERS_PER_WORKSPACE } from '../server/limits.js';
import { authenticateHash, authenticateRequest, isAdminSession, requireMutation, requireOrigin } from './auth.js';
import { proposeChange } from './ai.js';
import { createIdentityReplacements, redactString, respondToTablePrompt, type IdentityReplacement } from './table-assistant.js';
import { selectTableConversation, TABLE_MEMORY_SCAN_LIMIT } from './table-memory.js';
import type { Env } from './contracts.js';
import { aiTableDeadlineMs, modelJobRecoveryMs } from './ai-deadline.js';
import { headWithin, tailWithin, MAX_JOB_PARTIAL_CONTENT_CHARS, MAX_JOB_THINKING_TAIL_CHARS, parseModelFailureDetails, parseModelJobProgress, type ModelFailureDetails, type ModelJobProgress } from '../src/tabletop/shared/model-job-progress.js';
import { ModelProviderClosed, ModelRequestTimeout, ModelStreamFailure, type DeepSeekChangeProgress } from '../server/providers/deepseek-changes.js';
import { requireWorkspaceWritable } from './table-mode.js';
import { MAX_TABLE_ASSISTANT_JOBS_PER_ROOM, RoomRepository, type PendingDirectoryChange, type RoomModelJob } from './room-repository.js';
import {
  tableAssistantConfirmationSchema,
  tableAssistantRequestSchema,
  tableAssistantResultSchema,
  type TableAssistantJob,
  type TableAssistantConversationEntry,
  type TableAssistantHistoryPage,
  type TableAssistantInput,
  type TableAssistantRequest,
} from '../src/tabletop/shared/table-assistant-contracts.js';
import { decideDomain } from '../src/tabletop/domain/index.js';
import { CURSOR_MIN_INTERVAL_MS, cursorRelay, parseCursorInput, type CursorInput } from '../src/tabletop/shared/cursor-protocol.js';
import { cleanReasons, modelFailureMessage, safeAssistantFailureCode, safeModelFailureCode, safeModelFailureReasons, tableAssistantFailureMessage } from './model-failure.js';

const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_COMMAND_BODY_BYTES = 256 * 1024;
const MAX_JSON_DEPTH_LIMIT = 96;
const MAX_MODEL_PROMPT_CHARS = 4_000;
const MAX_TABLE_ASSISTANT_PROMPT_CHARS = 4_000;
const TABLE_ASSISTANT_CONTEXT_TURNS = 6;
const TABLE_ASSISTANT_CONTEXT_MAX_BYTES = 16_384;
const TABLE_ASSISTANT_HISTORY_DEFAULT_PAGE_SIZE = 20;
const TABLE_ASSISTANT_HISTORY_MAX_PAGE_SIZE = 50;
const DIRECTORY_BATCH_SIZE = 100;
const RETRY_DELAY_MS = 5_000;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const ROOM_EXPIRES_AT = 253_402_300_799_000;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/u;
/** Actor ids are opaque account ids (UUIDs today); bound the shape before touching storage. */
const MEMBER_ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const INVITE_LINK_DAYS: readonly number[] = [1, 7, 30];
const PROJECTION_CURSOR_PATTERN = /^[a-f0-9]{64}$/u;
const MODEL_JOB_ID_PATTERN = /^[a-f0-9]{64}$/u;

interface CreateInput {
  id: string;
  kind: 'invoice' | 'teaching' | 'encounter' | 'table';
  title?: string;
}

interface RedeemInput {
  ticket: string;
}

interface ModelInput {
  commandId: string;
  expectedRevision: string;
  expectedEpoch: number;
  prompt: string;
  consent: true;
  sourceId?: string;
}

interface PublicModelJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  message?: string;
  candidateId?: string;
  /** A question with answer choices when the model asked instead of drafting (F012). */
  clarification?: { question: string; options: string[] };
  /** Who asked, when and what, so open visibility (F034) can show rule requests to the table. */
  askedBy?: string;
  createdAt?: number;
  prompt?: string;
  /** F038: the machine-readable failure, so a rule-draft card can quote it like an answer card. */
  failureCode?: string;
  /** F039: whether the draft went into use on its own, or needs a manual review (and why). */
  autoApply?: 'applied' | 'needs-review';
  autoApplyReasons?: string[];
  /** F045: live counters while the draft is still running. */
  progress?: ModelJobProgress;
  /** F045: the configured whole-job deadline this draft runs under. */
  limitMs?: number;
  /** F045: bounded, redacted evidence of how far a failed draft got. */
  failureDetails?: ModelFailureDetails;
}

interface RunModelJobInput extends ModelInput {
  jobId: string;
  requestHash: string;
  workspaceId: string;
  actorId: string;
  sessionHash: string;
}

interface RunTableAssistantJobInput extends TableAssistantRequest, Pick<TableAssistantInput, 'conversation' | 'conversationOmittedCount'> {
  jobId: string;
  requestHash: string;
  workspaceId: string;
  actorId: string;
  sessionHash: string;
}

interface PeerAttachment {
  version: 1;
  sessionHash: string;
  actorId: string;
  workspaceId: string;
  revision: string;
}

function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('content-type', 'application/json; charset=utf-8');
  resultHeaders.set('cache-control', 'no-store');
  resultHeaders.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { 'cache-control': 'no-store' } });
}

function hasExcessiveDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH_LIMIT) return true;
  if (Array.isArray(value)) return value.some((item) => hasExcessiveDepth(item, depth + 1));
  if (isRecord(value)) return Object.values(value).some((item) => hasExcessiveDepth(item, depth + 1));
  return false;
}

async function readJson(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AuthorityError('CONTENT_TYPE_REQUIRED');
  const statedLength = request.headers.get('content-length');
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new AuthorityError('INVALID_REQUEST');
    if (length > maxBytes) throw new AuthorityError('BODY_TOO_LARGE');
  }
  if (!request.body) throw new AuthorityError('INVALID_JSON');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AuthorityError('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown;
  } catch {
    throw new AuthorityError('INVALID_JSON');
  }
  if (hasExcessiveDepth(value)) throw new AuthorityError('INVALID_REQUEST');
  return value;
}

function parseCreateInput(value: unknown): CreateInput {
  if (!isRecord(value) || typeof value.id !== 'string' || !ROOM_ID_PATTERN.test(value.id)
      || (value.kind !== 'invoice' && value.kind !== 'teaching' && value.kind !== 'encounter' && value.kind !== 'table')
      || (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 120))
      || Object.keys(value).some((key) => key !== 'id' && key !== 'kind' && key !== 'title')) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return { id: value.id, kind: value.kind, ...(typeof value.title === 'string' ? { title: value.title } : {}) };
}

function isInviteSeat(value: unknown): value is Seat {
  return value === 'learner-1' || value === 'learner-2' || value === 'mira' || value === 'pip'
    || value === 'member-1' || value === 'member-2' || value === 'member-3' || value === 'member-4'
    || value === 'member-5' || value === 'member-6' || value === 'member-7';
}

function parseRedeemInput(value: unknown): RedeemInput {
  if (!isRecord(value) || typeof value.ticket !== 'string' || !INVITE_TOKEN_PATTERN.test(value.ticket)
      || Object.keys(value).some((key) => key !== 'ticket')) {
    throw new AuthorityError('INVITE_INVALID');
  }
  return { ticket: value.ticket };
}

function parseModelInput(value: unknown): ModelInput {
  if (!isRecord(value) || typeof value.commandId !== 'string' || !COMMAND_ID_PATTERN.test(value.commandId)
      || typeof value.expectedRevision !== 'string' || !PROJECTION_CURSOR_PATTERN.test(value.expectedRevision)
      || !Number.isSafeInteger(value.expectedEpoch) || (value.expectedEpoch as number) < 1
      || typeof value.prompt !== 'string' || Array.from(value.prompt).length < 3
      || Array.from(value.prompt).length > MAX_MODEL_PROMPT_CHARS
      || value.consent !== true
      || (value.sourceId !== undefined && (typeof value.sourceId !== 'string' || value.sourceId.trim().length === 0 || value.sourceId.length > 160))
      || Object.keys(value).some((key) => !['commandId', 'expectedRevision', 'expectedEpoch', 'prompt', 'consent', 'sourceId'].includes(key))) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return {
    commandId: value.commandId,
    expectedRevision: value.expectedRevision,
    expectedEpoch: value.expectedEpoch as number,
    prompt: value.prompt,
    consent: true,
    ...(typeof value.sourceId === 'string' ? { sourceId: value.sourceId } : {}),
  };
}

function parseTableAssistantRequest(value: unknown): TableAssistantRequest {
  const parsed = tableAssistantRequestSchema.safeParse(value);
  if (!parsed.success || Array.from(parsed.data.prompt).length > MAX_TABLE_ASSISTANT_PROMPT_CHARS) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return parsed.data;
}

function parseTableAssistantHistoryQuery(url: URL): { before?: string; limit: number } {
  const beforeValues = url.searchParams.getAll('before');
  const limitValues = url.searchParams.getAll('limit');
  if ([...url.searchParams.keys()].some((key) => key !== 'before' && key !== 'limit')
      || beforeValues.length > 1 || limitValues.length > 1
      || (beforeValues[0] !== undefined && !MODEL_JOB_ID_PATTERN.test(beforeValues[0]))) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  const limit = limitValues[0] === undefined ? TABLE_ASSISTANT_HISTORY_DEFAULT_PAGE_SIZE : Number(limitValues[0]);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > TABLE_ASSISTANT_HISTORY_MAX_PAGE_SIZE) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return { ...(beforeValues[0] === undefined ? {} : { before: beforeValues[0] }), limit };
}

function tableAssistantConfirmationMessage(status: unknown, failure: unknown): string | undefined {
  if (failure === 'IDEMPOTENCY_MISMATCH') {
    return 'This confirmation conflicted with an earlier command. No suggested action was applied. Ask for a fresh suggestion.';
  }
  if (failure === 'CONFIRMATION_INTERRUPTED') {
    return 'The confirmation expired before the action could be applied. Ask for a fresh suggestion.';
  }
  if (status === 'stale') return 'The table changed before this suggestion was confirmed. Ask again for an updated suggestion.';
  if (status === 'rejected') return 'The table rules rejected this action. The suggestion was not applied.';
  return undefined;
}

/** Every assistant job view names who asked, so open history (F034) can label other members' chats. */
function tableAssistantJobView(job: RoomModelJob): TableAssistantJob {
  return { ...tableAssistantJobViewFor(job), askedBy: job.actorId };
}

function tableAssistantJobViewFor(job: RoomModelJob): TableAssistantJob {
  const expectedRevision = typeof job.data.expectedRevision === 'string' ? job.data.expectedRevision : '';
  const prompt = typeof job.data.prompt === 'string' ? job.data.prompt : '';
  if (!MODEL_JOB_ID_PATTERN.test(job.id) || !PROJECTION_CURSOR_PATTERN.test(expectedRevision)
      || job.data.expectedEpoch !== job.epoch || prompt.length === 0
      || prompt.length > MAX_TABLE_ASSISTANT_PROMPT_CHARS) throw new AuthorityError('INTERNAL_ERROR');
  if (job.status === 'failed' || job.status === 'revoked') {
    const failureReasons = cleanReasons(job.data.reasons);
    return {
      id: job.id,
      createdAt: job.createdAt,
      prompt,
      status: 'failed',
      expectedRevision,
      expectedEpoch: job.epoch,
      message: tableAssistantFailureMessage(job.data.failure, failureReasons),
      failureCode: safeAssistantFailureCode(job.data.failure),
      ...(failureReasons.length ? { failureReasons } : {}),
      ...(typeof job.data.failedAt === 'number' && job.data.failedAt >= job.createdAt
        ? { durationMs: Math.min(3_600_000, Math.round(job.data.failedAt - job.createdAt)) }
        : {}),
    };
  }
  if (job.status === 'running') {
    const progress = job.data.progress;
    const live = isRecord(progress)
      && Number.isSafeInteger(progress.receivedChars) && (progress.receivedChars as number) >= 0 && (progress.receivedChars as number) <= 1_000_000
      && Number.isSafeInteger(progress.reasoningChars) && (progress.reasoningChars as number) >= 0 && (progress.reasoningChars as number) <= 1_000_000
      && Number.isSafeInteger(progress.updatedAt) && (progress.updatedAt as number) >= 0
      ? {
        receivedChars: progress.receivedChars as number,
        reasoningChars: progress.reasoningChars as number,
        updatedAt: progress.updatedAt as number,
      }
      : null;
    return {
      id: job.id,
      createdAt: job.createdAt,
      prompt,
      status: 'running',
      expectedRevision,
      expectedEpoch: job.epoch,
      ...(live ? { progress: live } : {}),
    };
  }
  const parsed = tableAssistantResultSchema.safeParse(job.data.result);
  if (!parsed.success) throw new AuthorityError('INTERNAL_ERROR');
  return {
    id: job.id,
    createdAt: job.createdAt,
    prompt,
    status: 'completed',
    expectedRevision,
    expectedEpoch: job.epoch,
    result: parsed.data,
    ...(typeof job.data.serverOmittedConversationEntries === 'number'
      ? { serverOmittedConversationEntries: job.data.serverOmittedConversationEntries } : {}),
    ...(typeof job.data.providerOmittedConversationEntries === 'number'
      ? { providerOmittedConversationEntries: job.data.providerOmittedConversationEntries } : {}),
    ...(parsed.data.kind === 'action-proposal'
      ? {
        confirmationStatus: job.data.confirmationStatus === 'confirmed' ? 'confirmed' as const
          : job.data.confirmationStatus === 'stale' ? 'stale' as const
            : job.data.confirmationStatus === 'rejected' ? 'rejected' as const
              : job.status === 'committing' ? 'processing' as const : 'available' as const,
        ...(tableAssistantConfirmationMessage(job.data.confirmationStatus, job.data.confirmationFailure)
          ? { message: tableAssistantConfirmationMessage(job.data.confirmationStatus, job.data.confirmationFailure) } : {}),
      }
      : {}),
  };
}

/** Adds who asked, when, and what, so open visibility (F015) can show rule requests to the table. */
function modelJobView(job: RoomModelJob, limitMs: number): PublicModelJob {
  return {
    ...modelJobStatusView(job, limitMs),
    askedBy: job.actorId,
    createdAt: job.createdAt,
    ...(typeof job.data.prompt === 'string' ? { prompt: job.data.prompt } : {}),
  };
}

function modelJobStatusView(job: RoomModelJob, limitMs: number): PublicModelJob {
  if (job.status === 'revoked') return { id: job.id, status: 'failed', message: 'This proposal was cancelled.' };
  if (job.status === 'failed') {
    const reasons = Array.isArray(job.data.reasons) ? job.data.reasons : [];
    const details = parseModelFailureDetails(job.data.failureDetails);
    return {
      id: job.id,
      status: 'failed',
      message: modelFailureMessage(job.data.failure, reasons, details),
      failureCode: safeAssistantFailureCode(job.data.failure),
      ...(details ? { failureDetails: details } : {}),
    };
  }
  if (job.status === 'running' || job.status === 'committing') {
    const progress = parseModelJobProgress(job.data.progress);
    // F045: the card needs the same limit the job runs under, not a client-side guess.
    return { id: job.id, status: 'running', limitMs, ...(progress ? { progress } : {}) };
  }
  return {
    id: job.id,
    status: 'completed',
    ...(typeof job.data.candidateId === 'string' ? { candidateId: job.data.candidateId } : {}),
    ...(publicClarification(job.data.clarification) ?? {}),
    ...(job.data.autoApply === 'applied' || job.data.autoApply === 'needs-review' ? { autoApply: job.data.autoApply } : {}),
    ...(Array.isArray(job.data.autoApplyReasons) ? { autoApplyReasons: job.data.autoApplyReasons.filter((item): item is string => typeof item === 'string').slice(0, 6) } : {}),
  };
}

/**
 * F045: identity tokens are replaced before any member reads a partial draft.
 * `null` means the identity set could not be built, so the text is dropped instead of stored raw.
 */
function draftIdentityReplacements(workspace: WorkspaceView): IdentityReplacement[] | null {
  if (workspace.domain.kind !== 'table') return [];
  try {
    return createIdentityReplacements(workspace);
  } catch {
    return null;
  }
}

/** F045: redact first, then clamp, so a replacement can never push kept text past its bound. */
function boundedFailureDetails(details: ModelFailureDetails, replacements: IdentityReplacement[] | null): ModelFailureDetails {
  const base: ModelFailureDetails = {
    timedOutBy: details.timedOutBy,
    limitMs: details.limitMs,
    elapsedMs: details.elapsedMs,
    receivedChars: details.receivedChars,
    reasoningChars: details.reasoningChars,
  };
  if (replacements === null) return base;
  const partialContent = details.partialContent
    ? headWithin(redactString(details.partialContent, replacements), MAX_JOB_PARTIAL_CONTENT_CHARS) : '';
  const thinkingTail = details.thinkingTail
    ? tailWithin(redactString(details.thinkingTail, replacements), MAX_JOB_THINKING_TAIL_CHARS) : '';
  return {
    ...base,
    ...(partialContent ? { partialContent } : {}),
    ...(thinkingTail ? { thinkingTail } : {}),
  };
}

function publicClarification(value: unknown): { clarification: { question: string; options: string[] } } | null {
  if (typeof value !== 'object' || value === null) return null;
  const { question, options } = value as { question?: unknown; options?: unknown };
  if (typeof question !== 'string' || !Array.isArray(options) || !options.every((item) => typeof item === 'string')) return null;
  return { clarification: { question, options: options as string[] } };
}

function parsePeerAttachment(value: unknown): PeerAttachment | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.sessionHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.sessionHash) || typeof value.actorId !== 'string'
      || typeof value.workspaceId !== 'string' || typeof value.revision !== 'string') return null;
  return value as unknown as PeerAttachment;
}

export class Room extends DurableObject<Env> {
  readonly repository: RoomRepository;
  readonly authority: CommandAuthority;
  private directorySyncTail: Promise<void> = Promise.resolve();
  /** Last cursor relay per session (sockets are re-wrapped per event, so they cannot be keys). */
  private readonly cursorSentAt = new Map<string, number>();

  get roomId(): string | null {
    return this.repository.roomId;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repository = new RoomRepository(ctx.storage);
    this.authority = new CommandAuthority({
      repository: this.repository,
      workspaceIdFactory: () => this.requireBoundRoomId(),
      workspaceExpiresAt: ROOM_EXPIRES_AT,
      onWorkspaceChanged: () => this.scheduleOutboxDrain(),
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async authorize(request: Request, workspaceId?: string): Promise<AuthorizedWorkspace> {
    const target = workspaceId ?? this.requireBoundRoomId();
    this.requireRoomId(target);
    const session = await authenticateRequest(request, this.env);
    return this.authority.authorizeSession(session, target);
  }

  async execute(request: Request, workspaceId: string, envelope: unknown): Promise<CommandAck> {
    this.requireRoomId(workspaceId);
    const authorized = await this.authorize(request, workspaceId);
    requireMutation(request, this.env, authorized.session);
    return this.authority.execute(authorized.session, envelope, workspaceId);
  }

  async create(request: Request, input: unknown): Promise<WorkspaceView> {
    const session = await authenticateRequest(request, this.env);
    requireMutation(request, this.env, session);
    const parsed = parseCreateInput(input);
    requireWorkspaceWritable(this.env, parsed.kind);
    if (!this.ctx.id.equals(this.env.ROOMS.idFromName(parsed.id))) throw new AuthorityError('WORKSPACE_NOT_FOUND');
    this.repository.bindRoomId(parsed.id);
    this.requireRoomId(parsed.id);
    const workspace = await this.authority.createWorkspace(session, {
      kind: parsed.kind,
      ...(parsed.title === undefined ? {} : { title: parsed.title }),
    });
    this.scheduleDirectorySync();
    return workspace;
  }

  async redeemInvite(request: Request, rawTicket: string): Promise<WorkspaceView> {
    const session = await authenticateRequest(request, this.env);
    requireMutation(request, this.env, session);
    if (!INVITE_TOKEN_PATTERN.test(rawTicket)) throw new AuthorityError('INVITE_INVALID');
    const roomId = this.requireBoundRoomId();
    const workspace = await this.repository.getWorkspace(roomId);
    if (workspace) requireWorkspaceWritable(this.env, workspace.kind);
    await this.repository.redeemRoomInvitation(sha256(rawTicket), session.record.actorId, session.record.name, Date.now());
    const authorized = await this.authority.authorizeSession(session, roomId);
    this.scheduleDirectorySync();
    this.scheduleOutboxDrain();
    return authorized.workspace;
  }

  async joinByInviteLink(request: Request, rawToken: string): Promise<WorkspaceView> {
    const session = await authenticateRequest(request, this.env);
    requireMutation(request, this.env, session);
    if (!INVITE_TOKEN_PATTERN.test(rawToken)) throw new AuthorityError('INVITE_INVALID');
    const roomId = this.requireBoundRoomId();
    const workspace = await this.repository.getWorkspace(roomId);
    if (workspace) requireWorkspaceWritable(this.env, workspace.kind);
    await this.repository.joinByInviteLink(sha256(rawToken), session.record.actorId, session.record.name, Date.now());
    const authorized = await this.authority.authorizeSession(session, roomId);
    this.scheduleDirectorySync();
    this.scheduleOutboxDrain();
    return authorized.workspace;
  }

  async fetch(request: Request): Promise<Response> {
    const requestId = randomId();
    try {
      const url = new URL(request.url);
      if (url.pathname === '/internal/create' && request.method === 'POST') {
        const input = parseCreateInput(await readJson(request));
        const workspace = await this.create(request, input);
        return json(201, workspace, { 'x-request-id': requestId });
      }
      if (url.pathname === '/internal/redeem' && request.method === 'POST') {
        const input = parseRedeemInput(await readJson(request));
        const workspace = await this.redeemInvite(request, input.ticket);
        return json(200, workspace, { 'x-request-id': requestId });
      }
      if (url.pathname === '/internal/join-link' && request.method === 'POST') {
        const input = parseRedeemInput(await readJson(request));
        const workspace = await this.joinByInviteLink(request, input.ticket);
        return json(200, workspace, { 'x-request-id': requestId });
      }
      if (url.pathname === '/internal/view' && request.method === 'GET') {
        const authorized = await this.authorize(request);
        return json(200, authorized.workspace, { 'x-request-id': requestId });
      }
      if (url.pathname === '/internal/metadata' && request.method === 'GET') {
        const session = await authenticateRequest(request, this.env);
        if (!await isAdminSession(session, this.env)) throw new AuthorityError('ROLE_FORBIDDEN');
        const roomId = this.requireBoundRoomId();
        const workspace = await this.repository.getWorkspace(roomId);
        if (!workspace) throw new AuthorityError('WORKSPACE_NOT_FOUND');
        const members = await this.repository.withWorkspaceTransaction(roomId, async (transaction) => transaction.listMembers());
        return json(200, {
          id: workspace.id,
          kind: workspace.kind,
          createdAt: workspace.createdAt,
          ownerId: workspace.ownerActorId,
          memberCount: Math.min(MAX_MEMBERS_PER_WORKSPACE, members.length),
          status: workspace.expiresAt <= Date.now() ? 'expired'
            : workspace.domainState.kind === 'encounter' && workspace.domainState.paused ? 'paused' : 'active',
        }, { 'x-request-id': requestId });
      }
      const route = /^\/api\/workspaces\/([0-9a-f-]{36})(?:\/(commands|invites|invite-link|members\/remove|events|socket|model(?:\/[a-f0-9]{64})?|assistant(?:\/[a-f0-9]{64}(?:\/confirm)?)?|export))?$/iu.exec(url.pathname);
      if (!route || this.roomId === null || route[1] !== this.roomId) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
      const workspaceId = route[1];
      const suffix = route[2] ?? '';
      if (suffix === 'socket') return await this.socket(request, workspaceId);

      if (request.method === 'GET' && suffix === '') {
        const authorized = await this.authorize(request, workspaceId);
        return json(200, authorized.workspace, { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && suffix === 'events') {
        const authorized = await this.authorize(request, workspaceId);
        const afterValues = url.searchParams.getAll('after');
        const unexpected = [...url.searchParams.keys()].some((key) => key !== 'after');
        if (unexpected || afterValues.length > 1
            || (afterValues[0] !== undefined && !PROJECTION_CURSOR_PATTERN.test(afterValues[0]))) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const cursor = projectionCursor(authorized.workspace);
        return json(200, {
          resync: afterValues[0] !== cursor,
          cursor,
          workspace: authorized.workspace,
        }, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'commands') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        const envelope = await readJson(request, MAX_COMMAND_BODY_BYTES);
        const result = await this.authority.execute(authorized.session, envelope, workspaceId);
        this.scheduleDirectorySync();
        return json(200, result, { 'x-request-id': requestId });
      }
      if (suffix === 'invite-link' && (request.method === 'GET' || request.method === 'POST')) {
        const authorized = await this.authorize(request, workspaceId);
        // F003-T3: only the owner of a data table manages its reusable link.
        if (authorized.workspace.kind !== 'table'
            || !authorized.context.permissions?.has('members.invite')) throw new AuthorityError('ROLE_FORBIDDEN');
        if (request.method === 'GET') return json(200, this.repository.inviteLinkStatus(workspaceId, Date.now()), { 'x-request-id': requestId });
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        const body = await readJson(request);
        if (isRecord(body) && body.action === 'disable' && Object.keys(body).length === 1) {
          await this.repository.disableInviteLink(workspaceId, Date.now());
          return json(200, { enabled: false, expiresAt: null }, { 'x-request-id': requestId });
        }
        if (!isRecord(body) || body.action !== 'create' || !INVITE_LINK_DAYS.includes(body.days as number)
            || Object.keys(body).some((key) => key !== 'action' && key !== 'days')) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const token = randomToken();
        const now = Date.now();
        const created = await this.repository.createInviteLink(
          workspaceId, authorized.session.record.actorId, sha256(token), now, now + (body.days as number) * 86_400_000,
        );
        // The raw link is returned once; only its hash is stored.
        return json(201, { enabled: true, expiresAt: created.expiresAt, link: `${workspaceId}_${token}` }, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'members/remove') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        const body = await readJson(request);
        if (!isRecord(body) || typeof body.actorId !== 'string' || !MEMBER_ACTOR_ID_PATTERN.test(body.actorId)
            || Object.keys(body).some((key) => key !== 'actorId')) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const workspace = await this.authority.removeMember(authorized.session, workspaceId, body.actorId);
        this.scheduleDirectorySync();
        return json(200, workspace, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'invites') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        const body = await readJson(request);
        if (!isRecord(body) || !isInviteSeat(body.seat)
            || (body.replaceOutstanding !== undefined && typeof body.replaceOutstanding !== 'boolean')
            || Object.keys(body).some((key) => key !== 'seat' && key !== 'replaceOutstanding')) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const invite = await this.authority.createInvite(
          authorized.session, workspaceId, body.seat, body.replaceOutstanding === true,
        );
        return json(201, { ticket: `${workspaceId}_${invite.ticket}`, expiresAt: invite.expiresAt }, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'model') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        // F035: drafting rules (incl. AI drafts) needs the rules.draft permission.
        if (!authorized.context.permissions?.has('rules.draft')) throw new AuthorityError('ROLE_FORBIDDEN');
        const input = parseModelInput(await readJson(request, MAX_COMMAND_BODY_BYTES));
        if (input.expectedEpoch !== authorized.workspace.epoch) throw new AuthorityError('STALE_EPOCH');
        const requestHash = sha256(canonicalJson({
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          expectedEpoch: input.expectedEpoch,
          prompt: input.prompt,
          consent: input.consent,
          sourceId: input.sourceId ?? null,
        }));
        const jobId = sha256(`tabletop-ai-job-v1:${canonicalJson({
          actorId: authorized.session.record.actorId,
          workspaceId,
          epoch: input.expectedEpoch,
          commandId: input.commandId,
        })}`);
        // F045: every response for this request carries the same configured limit.
        const limitMs = aiTableDeadlineMs(this.env);
        const existing = await this.repository.getModelJob(
          jobId, authorized.session.record.actorId, workspaceId, input.expectedEpoch,
        );
        if (existing) {
          if (existing.data.kind !== undefined) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          if (existing.data.requestHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const reconciled = await this.reconcileModelJob(existing);
          return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
            modelJobView(reconciled, limitMs), { 'x-request-id': requestId });
        }
        if (input.expectedRevision !== authorized.workspace.revision) throw new AuthorityError('STALE_REVISION');
        const reservation = await this.repository.reserveModelJob({
          id: jobId,
          workspaceId,
          epoch: input.expectedEpoch,
          actorId: authorized.session.record.actorId,
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          requestHash,
          now: Date.now(),
          prompt: input.prompt,
        });
        if (!reservation.created) {
          if (reservation.job.data.kind !== undefined) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          if (reservation.job.data.requestHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const reconciled = await this.reconcileModelJob(reservation.job);
          return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
            modelJobView(reconciled, limitMs), { 'x-request-id': requestId });
        }
        this.ctx.waitUntil(this.runModelJob({
          jobId,
          requestHash,
          workspaceId,
          expectedEpoch: input.expectedEpoch,
          expectedRevision: input.expectedRevision,
          actorId: authorized.session.record.actorId,
          sessionHash: authorized.session.record.tokenHash,
          commandId: input.commandId,
          prompt: input.prompt,
          consent: true,
          ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
        }).finally(() => this.notifyAssistantActivity(authorized.session.record.actorId)));
        await this.scheduleAlarmAt(Date.now() + this.modelRecoveryMs());
        this.notifyAssistantActivity(authorized.session.record.actorId);
        return json(202, modelJobView(reservation.job, limitMs), { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && suffix === 'model') {
        // Open visibility (F034): every member's rule requests on this table epoch, newest first.
        const authorized = await this.authorize(request, workspaceId);
        if (authorized.workspace.kind !== 'table') throw new AuthorityError('COMMAND_NOT_ALLOWED');
        const limitMs = aiTableDeadlineMs(this.env);
        const jobs = await this.repository.listTableDraftJobs({
          workspaceId,
          epoch: authorized.workspace.epoch,
          actorId: authorized.session.record.actorId,
          scope: VISIBILITY_POLICY === 'open' ? 'table' : 'actor',
          limit: 20,
        });
        const items = await Promise.all(jobs.map(async (job) => modelJobView(await this.reconcileModelJob(job), limitMs)));
        return json(200, { items }, { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && suffix.startsWith('model/')) {
        const authorized = await this.authorize(request, workspaceId);
        const jobId = suffix.slice('model/'.length);
        if (!MODEL_JOB_ID_PATTERN.test(jobId)) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        const limitMs = aiTableDeadlineMs(this.env);
        // Open visibility (F034): any member may follow another member's rule request.
        const job = VISIBILITY_POLICY === 'open'
          ? await this.repository.getTableModelJob(jobId, workspaceId, authorized.workspace.epoch)
          : await this.repository.getModelJob(jobId, authorized.session.record.actorId, workspaceId, authorized.workspace.epoch);
        if (!job || job.data.kind !== undefined) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        const reconciled = await this.reconcileModelJob(job);
        return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
          modelJobView(reconciled, limitMs), { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && suffix === 'assistant') {
        const authorized = await this.authorize(request, workspaceId);
        if (authorized.workspace.kind !== 'table' || authorized.workspace.domain.kind !== 'table') {
          throw new AuthorityError('COMMAND_NOT_ALLOWED');
        }
        const query = parseTableAssistantHistoryQuery(url);
        const page = await this.repository.listTableAssistantJobs({
          workspaceId,
          epoch: authorized.workspace.epoch,
          actorId: authorized.session.record.actorId,
          ...(query.before === undefined ? {} : { before: query.before }),
          limit: query.limit,
          scope: VISIBILITY_POLICY === 'open' ? 'table' : 'actor',
        });
        const items = await Promise.all(page.jobs.map(async (job) =>
          tableAssistantJobView(await this.reconcileTableAssistantJob(job))));
        const payload: TableAssistantHistoryPage = {
          items,
          nextBefore: page.hasMore ? (page.jobs.at(-1)?.id ?? null) : null,
          limit: query.limit,
          contextTurns: TABLE_ASSISTANT_CONTEXT_TURNS,
          contextMaxBytes: TABLE_ASSISTANT_CONTEXT_MAX_BYTES,
          storageJobCap: MAX_TABLE_ASSISTANT_JOBS_PER_ROOM,
        };
        return json(200, payload, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'assistant') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        if (authorized.workspace.kind !== 'table' || authorized.workspace.domain.kind !== 'table') {
          throw new AuthorityError('COMMAND_NOT_ALLOWED');
        }
        if (authorized.member.role !== 'owner' && authorized.member.role !== 'participant') {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }
        // F035: asking the table AI needs the ai.ask permission.
        if (!authorized.context.permissions?.has('ai.ask')) throw new AuthorityError('ROLE_FORBIDDEN');
        const input = parseTableAssistantRequest(await readJson(request, MAX_COMMAND_BODY_BYTES));
        if (input.expectedEpoch !== authorized.workspace.epoch) throw new AuthorityError('STALE_EPOCH');
        const requestHash = sha256(canonicalJson({
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          expectedEpoch: input.expectedEpoch,
          prompt: input.prompt,
          consent: input.consent,
        }));
        const jobId = sha256(`tabletop-assistant-job-v1:${canonicalJson({
          actorId: authorized.session.record.actorId,
          workspaceId,
          epoch: input.expectedEpoch,
          commandId: input.commandId,
        })}`);
        const existing = await this.repository.getModelJob(
          jobId, authorized.session.record.actorId, workspaceId, input.expectedEpoch,
        );
        if (existing) {
          if (existing.data.kind !== 'table-assistant' || existing.data.requestHash !== requestHash) {
            throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          }
          const reconciled = await this.reconcileTableAssistantJob(existing);
          const view = tableAssistantJobView(reconciled);
          return json(view.status === 'running' ? 202 : 200, view, { 'x-request-id': requestId });
        }
        if (input.expectedRevision !== authorized.workspace.revision) throw new AuthorityError('STALE_REVISION');
        const context = await this.tableAssistantConversation(
          workspaceId, input.expectedEpoch, authorized.session.record.actorId, input.prompt,
        );
        const reservation = await this.repository.reserveModelJob({
          id: jobId,
          workspaceId,
          epoch: input.expectedEpoch,
          actorId: authorized.session.record.actorId,
          commandId: input.commandId,
          expectedRevision: input.expectedRevision,
          requestHash,
          now: Date.now(),
          kind: 'table-assistant',
          prompt: input.prompt,
        });
        if (!reservation.created) {
          if (reservation.job.data.kind !== 'table-assistant'
              || reservation.job.data.requestHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const reconciled = await this.reconcileTableAssistantJob(reservation.job);
          const view = tableAssistantJobView(reconciled);
          return json(view.status === 'running' ? 202 : 200, view, { 'x-request-id': requestId });
        }
        this.ctx.waitUntil(this.runTableAssistantJob({
          ...input,
          jobId,
          requestHash,
          workspaceId,
          actorId: authorized.session.record.actorId,
          sessionHash: authorized.session.record.tokenHash,
          conversation: context.conversation,
          conversationOmittedCount: context.omittedCount,
        }).finally(() => this.notifyAssistantActivity(authorized.session.record.actorId)));
        await this.scheduleAlarmAt(Date.now() + this.modelRecoveryMs());
        this.notifyAssistantActivity(authorized.session.record.actorId);
        return json(202, tableAssistantJobView(reservation.job), { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && /^assistant\/[a-f0-9]{64}$/u.test(suffix)) {
        const authorized = await this.authorize(request, workspaceId);
        const jobId = suffix.slice('assistant/'.length);
        // Open visibility (F034): any member may read any member's chat; confirming stays with the asker.
        const job = VISIBILITY_POLICY === 'open'
          ? await this.repository.getTableModelJob(jobId, workspaceId, authorized.workspace.epoch)
          : await this.repository.getModelJob(jobId, authorized.session.record.actorId, workspaceId, authorized.workspace.epoch);
        if (!job || job.data.kind !== 'table-assistant') throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        const reconciled = await this.reconcileTableAssistantJob(job);
        const view = tableAssistantJobView(reconciled);
        return json(view.status === 'running' ? 202 : 200, view, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && /^assistant\/[a-f0-9]{64}\/confirm$/u.test(suffix)) {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        if (authorized.workspace.kind !== 'table' || authorized.workspace.domain.kind !== 'table') {
          throw new AuthorityError('COMMAND_NOT_ALLOWED');
        }
        if (authorized.member.role !== 'owner' && authorized.member.role !== 'participant') {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }
        const parsed = tableAssistantConfirmationSchema.safeParse(await readJson(request, MAX_COMMAND_BODY_BYTES));
        if (!parsed.success) throw new AuthorityError('INVALID_REQUEST');
        const jobId = suffix.slice('assistant/'.length, -'/confirm'.length);
        let job = await this.repository.getModelJob(
          jobId, authorized.session.record.actorId, workspaceId, authorized.workspace.epoch,
        );
        if (!job || job.data.kind !== 'table-assistant') throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        job = await this.reconcileTableAssistantJob(job);
        const result = tableAssistantResultSchema.safeParse(job.data.result);
        if (!result.success || result.data.kind !== 'action-proposal') throw new AuthorityError('COMMAND_NOT_ALLOWED');
        if (parsed.data.expectedEpoch !== job.epoch) throw new AuthorityError('STALE_EPOCH');
        if (parsed.data.expectedRevision !== result.data.expectedRevision
            || parsed.data.expectedRevision !== job.data.expectedRevision) throw new AuthorityError('STALE_REVISION');

        const envelope = {
          commandId: parsed.data.commandId,
          expectedRevision: result.data.expectedRevision,
          expectedEpoch: job.epoch,
          type: 'table.act',
          payload: { actionId: result.data.actionId, inputs: result.data.inputs },
        };
        const proposalHash = hashValue({
          type: envelope.type,
          payload: envelope.payload,
          expectedRevision: envelope.expectedRevision,
          expectedEpoch: envelope.expectedEpoch,
        });
        if (job.status === 'committing'
            || (job.status === 'completed' && job.data.confirmationStatus === 'confirmed')) {
          if (job.data.confirmCommandId !== parsed.data.commandId
              || job.data.proposalHash !== proposalHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const receipt = await this.repository.findCommandReceipt(
            workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
          );
          if (receipt) {
            if (receipt.payloadHash !== proposalHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
            await this.repository.completeTableAssistantConfirmation(
              job.id, workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
              { ...job.data, confirmationStatus: 'confirmed' },
            );
            return json(200, { ...receipt.response, duplicate: true }, { 'x-request-id': requestId });
          }
          if (job.status === 'completed') throw new AuthorityError('INTERNAL_ERROR');
        } else if (job.status !== 'completed' || job.data.confirmationStatus !== 'available') {
          throw new AuthorityError('STALE_REVISION');
        }

        const claim = await this.repository.claimTableAssistantConfirmation({
          id: jobId,
          workspaceId,
          epoch: job.epoch,
          actorId: authorized.session.record.actorId,
          commandId: parsed.data.commandId,
          expectedRevision: parsed.data.expectedRevision,
          proposalHash,
          startedAt: Date.now(),
        });
        if (!claim.claimed) {
          const receipt = await this.repository.findCommandReceipt(
            workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
          );
          if (receipt && receipt.payloadHash === proposalHash) {
            await this.repository.completeTableAssistantConfirmation(
              jobId, workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
              { ...claim.job.data, confirmationStatus: 'confirmed' },
            );
            return json(200, { ...receipt.response, duplicate: true }, { 'x-request-id': requestId });
          }
        }

        try {
          await this.scheduleAlarmAt(Date.now() + this.modelRecoveryMs());
          const acknowledgement = await this.authority.executeTableAssistantAction(
            authorized.session, envelope, workspaceId, jobId,
          );
          const latest = await this.repository.getModelJob(jobId, authorized.session.record.actorId, workspaceId, job.epoch);
          if (latest && latest.data.kind === 'table-assistant') {
            await this.repository.completeTableAssistantConfirmation(
              jobId, workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
              { ...latest.data, confirmationStatus: 'confirmed' },
            );
          }
          this.notifyAssistantActivity(authorized.session.record.actorId);
          return json(200, acknowledgement, { 'x-request-id': requestId });
        } catch (error) {
          const receipt = await this.repository.findCommandReceipt(
            workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
          ).catch(async () => {
            await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
            throw new AuthorityError('DATABASE_UNAVAILABLE');
          });
          if (receipt && receipt.payloadHash === proposalHash) {
            const latest = await this.repository.getModelJob(jobId, authorized.session.record.actorId, workspaceId, job.epoch);
            if (latest && latest.data.kind === 'table-assistant') {
              await this.repository.completeTableAssistantConfirmation(
                jobId, workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
                { ...latest.data, confirmationStatus: 'confirmed' },
              );
            }
            return json(200, { ...receipt.response, duplicate: true }, { 'x-request-id': requestId });
          }
          if (receipt) {
            await this.repository.settleTableAssistantConfirmationFailure({
              id: jobId, workspaceId, epoch: job.epoch, actorId: authorized.session.record.actorId,
              commandId: parsed.data.commandId, proposalHash,
              confirmationStatus: 'rejected', failure: 'IDEMPOTENCY_MISMATCH',
            }).catch(async () => {
              await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
              throw new AuthorityError('DATABASE_UNAVAILABLE');
            });
            throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          }
          if (error instanceof AuthorityError && error.status < 500) {
            const stale = error.code === 'STALE_REVISION' || error.code === 'STALE_EPOCH';
            const status = await this.repository.settleTableAssistantConfirmationFailure({
              id: jobId,
              workspaceId,
              epoch: job.epoch,
              actorId: authorized.session.record.actorId,
              commandId: parsed.data.commandId,
              proposalHash,
              confirmationStatus: stale ? 'stale' : 'rejected',
              failure: stale ? 'STALE_WORKSPACE' : 'ACTION_REJECTED',
            }).catch(async () => {
              await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
              return 'inactive' as const;
            });
            if (status === 'confirmed') {
              const committed = await this.repository.findCommandReceipt(
                workspaceId, job.epoch, authorized.session.record.actorId, parsed.data.commandId,
              );
              if (committed && committed.payloadHash === proposalHash) {
                return json(200, { ...committed.response, duplicate: true }, { 'x-request-id': requestId });
              }
              await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
              throw new AuthorityError('DATABASE_UNAVAILABLE');
            }
            throw error;
          }
          await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
          throw new AuthorityError('DATABASE_UNAVAILABLE');
        }
      }
      if (request.method === 'GET' && suffix === 'export') {
        const authorized = await this.authorize(request, workspaceId);
        const formats = url.searchParams.getAll('format');
        if ([...url.searchParams.keys()].some((key) => key !== 'format') || formats.length > 1) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const format = formats[0] ?? 'csv';
        if (format !== 'csv' && format !== 'html') throw new AuthorityError('INVALID_REQUEST');
        if (authorized.workspace.kind !== 'invoice' || authorized.member.role !== 'owner') {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }
        const domain = authorized.workspace.domain;
        if (domain.kind !== 'invoice') throw new AuthorityError('WORKSPACE_NOT_FOUND');
        const content = exportInvoice(domain, format);
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > MAX_EXPORT_BYTES) throw new AuthorityError('BODY_TOO_LARGE');
        return new Response(bytes, {
          status: 200,
          headers: {
            'cache-control': 'no-store',
            'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
            'content-disposition': `attachment; filename="tabletop-invoice.${format}"`,
            'x-content-type-options': 'nosniff',
            'x-request-id': requestId,
          },
        });
      }
      throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
    } catch (error) {
      const mapped = safeError(error, requestId);
      return json(mapped.status, mapped.body, { 'x-request-id': requestId });
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.recoverStaleModelJobs();
      await this.syncDirectory();
      await this.drainOutbox();
    } catch {
      await this.scheduleAlarm();
      return;
    }
    const modelRecoveryAt = this.repository.nextModelJobRecoveryAt(this.modelRecoveryMs());
    if (modelRecoveryAt !== null) await this.scheduleAlarmAt(modelRecoveryAt);
    if (this.repository.hasPendingDirectoryChanges() || this.repository.pendingOutboxCount() > 0) {
      await this.scheduleAlarm();
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') return;
    const input = parseCursorInput(message);
    if (!input) {
      try { socket.close(4400, 'Only cursor messages are supported'); } catch { /* already closed */ }
      return;
    }
    const sender = parsePeerAttachment(socket.deserializeAttachment());
    if (!sender) return;
    const now = Date.now();
    if (!('leave' in input) && now - (this.cursorSentAt.get(sender.sessionHash) ?? 0) < CURSOR_MIN_INTERVAL_MS) return;
    this.cursorSentAt.set(sender.sessionHash, now);
    this.relayCursor(socket, input);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const closing = parsePeerAttachment(socket.deserializeAttachment());
    if (closing) {
      this.cursorSentAt.delete(closing.sessionHash);
      // Another tab of the same person keeps its cursor; only the last socket announces a leave.
      const stillHere = this.ctx.getWebSockets(`actor:${closing.actorId}`).some((peer) => peer !== socket && peer.readyState === WebSocket.OPEN);
      if (!stillHere) this.relayCursor(socket, { type: 'cursor', leave: true });
    }
    try { socket.close(1000, 'Closed'); } catch { /* already closed */ }
  }

  /** F009: ephemeral fan-out to the other people in this room; never stored. */
  private relayCursor(sender: WebSocket, input: CursorInput): void {
    const from = parsePeerAttachment(sender.deserializeAttachment());
    if (!from) return;
    const frame = cursorRelay(from.actorId, input);
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === sender) continue;
      const to = parsePeerAttachment(peer.deserializeAttachment());
      if (!to || to.workspaceId !== from.workspaceId || to.actorId === from.actorId) continue;
      try { peer.send(frame); } catch { /* closing */ }
    }
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    try { socket.close(1011, 'Socket error'); } catch { /* already closed */ }
  }

  private requireRoomId(workspaceId: string): void {
    if (this.roomId === null || workspaceId !== this.roomId) throw new AuthorityError('WORKSPACE_NOT_FOUND');
  }

  private requireBoundRoomId(): string {
    const roomId = this.roomId;
    if (roomId === null) throw new AuthorityError('WORKSPACE_NOT_FOUND');
    return roomId;
  }

  private async socket(request: Request, workspaceId: string): Promise<Response> {
    if (request.method !== 'GET') throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
    this.requireRoomId(workspaceId);
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      throw new AuthorityError('INVALID_REQUEST');
    }
    requireOrigin(request, this.env);
    const authorized = await this.authorize(request, workspaceId);
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const attachment: PeerAttachment = {
      version: 1,
      sessionHash: authorized.session.record.tokenHash,
      actorId: authorized.session.record.actorId,
      workspaceId,
      revision: projectionCursor(authorized.workspace),
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server, [`actor:${attachment.actorId}`]);
    server.send(JSON.stringify({ type: 'projection', workspace: authorized.workspace }));
    return new Response(null, { status: 101, webSocket: client });
  }

  private scheduleOutboxDrain(): void {
    this.ctx.waitUntil(this.drainOutbox().catch(async () => { await this.scheduleAlarm(); }));
  }

  private scheduleDirectorySync(): void {
    this.ctx.waitUntil(this.syncDirectory().catch(async () => { await this.scheduleAlarm(); }));
  }

  private async tableAssistantConversation(
    workspaceId: string,
    epoch: number,
    actorId: string,
    prompt: string,
  ): Promise<{ conversation: TableAssistantConversationEntry[]; omittedCount: number }> {
    const jobs = await this.repository.listRecentCompletedTableAssistantJobs(
      workspaceId, epoch, actorId, TABLE_MEMORY_SCAN_LIMIT,
    );
    const conversation: TableAssistantConversationEntry[] = [];
    for (const job of jobs) {
      const prompt = job.data.prompt;
      const expectedRevision = job.data.expectedRevision;
      const result = tableAssistantResultSchema.safeParse(job.data.result);
      if (typeof prompt !== 'string' || prompt.length === 0 || prompt.length > MAX_TABLE_ASSISTANT_PROMPT_CHARS
          || typeof expectedRevision !== 'string' || !PROJECTION_CURSOR_PATTERN.test(expectedRevision)
          || !result.success) continue;
      conversation.push({
        prompt,
        result: { kind: result.data.kind, text: result.data.text },
        expectedRevision,
        ...(result.data.kind === 'action-proposal'
          && (job.data.confirmationStatus === 'available'
            || job.data.confirmationStatus === 'processing'
            || job.data.confirmationStatus === 'confirmed'
            || job.data.confirmationStatus === 'stale'
            || job.data.confirmationStatus === 'rejected')
          ? { confirmationStatus: job.data.confirmationStatus } : {}),
      });
    }
    return selectTableConversation(conversation, prompt);
  }

  private async runTableAssistantJob(input: RunTableAssistantJobInput): Promise<void> {
    const initialData = {
      kind: 'table-assistant',
      requestHash: input.requestHash,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      expectedEpoch: input.expectedEpoch,
      prompt: input.prompt,
    };
    try {
      let session = await authenticateHash(input.sessionHash, this.env);
      if (session.record.actorId !== input.actorId) throw new AuthorityError('SESSION_EXPIRED');
      let authorized = await this.authority.authorizeSession(session, input.workspaceId);
      if (authorized.workspace.kind !== 'table' || authorized.workspace.domain.kind !== 'table') {
        throw new AuthorityError('COMMAND_NOT_ALLOWED');
      }
      if (authorized.member.role !== 'owner' && authorized.member.role !== 'participant') {
        throw new AuthorityError('ROLE_FORBIDDEN');
      }
      if (authorized.workspace.epoch !== input.expectedEpoch
          || authorized.workspace.revision !== input.expectedRevision) {
        await this.repository.finishTableAssistantJob(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'failed',
          { ...initialData, failure: 'STALE_WORKSPACE' },
        );
        return;
      }
      requireWorkspaceWritable(this.env, authorized.workspace.kind);
      const job = await this.repository.getModelJob(input.jobId, input.actorId, input.workspaceId, input.expectedEpoch);
      if (!job || job.status !== 'running' || job.data.kind !== 'table-assistant') return;

      let lastProgressWrite = 0;
      const onProgress = (progress: { receivedChars: number; reasoningChars: number }) => {
        const now = Date.now();
        if (now - lastProgressWrite < 900) return;
        lastProgressWrite = now;
        void this.repository.updateModelJobProgress(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId,
          { ...progress, updatedAt: now },
        ).catch(() => undefined);
      };

      const response = await respondToTablePrompt(this.env, {
        workspace: authorized.workspace,
        actorId: input.actorId,
        jobId: input.jobId,
        commandId: input.commandId,
        prompt: input.prompt,
        consent: true,
        conversation: input.conversation,
        conversationOmittedCount: input.conversationOmittedCount,
      }, undefined, onProgress);
      if (response.jobId !== input.jobId) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
      const result = tableAssistantResultSchema.safeParse(response.result);
      if (!result.success) throw new AuthorityError('TABLE_ASSISTANT_OUTPUT_REJECTED');

      session = await authenticateHash(input.sessionHash, this.env);
      if (session.record.actorId !== input.actorId) throw new AuthorityError('SESSION_EXPIRED');
      authorized = await this.authority.authorizeSession(session, input.workspaceId);
      if (authorized.workspace.kind !== 'table' || authorized.workspace.domain.kind !== 'table'
          || (authorized.member.role !== 'owner' && authorized.member.role !== 'participant')) {
        throw new AuthorityError('COMMAND_NOT_ALLOWED');
      }
      // F038: an answer describes the table as it was asked, so a rule draft or edit that lands
      // while it generates does not discard it. Only a proposal must match the current revision.
      if (authorized.workspace.epoch !== input.expectedEpoch) {
        await this.repository.finishTableAssistantJob(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'failed',
          { ...initialData, failure: 'STALE_WORKSPACE' },
        );
        return;
      }
      requireWorkspaceWritable(this.env, authorized.workspace.kind);

      if (result.data.kind === 'action-proposal') {
        if (input.expectedRevision !== authorized.workspace.revision
            || result.data.expectedRevision !== authorized.workspace.revision
            || result.data.expectedRuleRevision !== authorized.workspace.domain.ruleRevision
            || result.data.expectedActionRevision !== authorized.workspace.domain.actionRevision) {
          await this.repository.finishTableAssistantJob(
            input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'failed',
            { ...initialData, failure: 'STALE_WORKSPACE' },
          );
          return;
        }
        try {
          decideDomain(structuredClone(authorized.workspace.domain), {
            type: 'table.act',
            payload: { actionId: result.data.actionId, inputs: result.data.inputs },
          }, authorized.context);
        } catch {
          await this.repository.finishTableAssistantJob(
            input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'failed',
            { ...initialData, failure: 'ACTION_REJECTED' },
          );
          return;
        }
      }

      const data = {
        ...initialData,
        result: result.data,
        serverOmittedConversationEntries: response.serverOmittedConversationEntries,
        providerOmittedConversationEntries: response.providerOmittedConversationEntries,
        ...(result.data.kind === 'action-proposal' ? { confirmationStatus: 'available' } : {}),
      };
      await this.repository.finishTableAssistantJob(
        input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'completed', data,
      );
    } catch (error) {
      // Keep the specific cause instead of flattening every fault into one untraceable code.
      const failure = error instanceof AuthorityError && error.code === 'TABLE_READ_ONLY'
        ? 'TABLE_READ_ONLY'
        : safeModelFailureCode(error);
      const reasons = safeModelFailureReasons(error);
      await this.repository.finishTableAssistantJob(
        input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'failed',
        { ...initialData, failure, ...(reasons.length ? { reasons } : {}) },
      ).catch(() => false);
    }
  }

  private async reconcileTableAssistantJob(job: RoomModelJob): Promise<RoomModelJob> {
    if (job.data.kind !== 'table-assistant' || (job.status !== 'running' && job.status !== 'committing')) return job;
    const commandId = typeof job.data.confirmCommandId === 'string' ? job.data.confirmCommandId : '';
    const proposalHash = typeof job.data.proposalHash === 'string' ? job.data.proposalHash : '';
    const receipt = commandId && proposalHash
      ? await this.repository.findCommandReceipt(job.workspaceId, job.epoch, job.actorId, commandId)
      : null;
    if (job.status === 'committing') {
      if (receipt && receipt.payloadHash === proposalHash) {
        await this.repository.completeTableAssistantConfirmation(
          job.id, job.workspaceId, job.epoch, job.actorId, commandId,
          { ...job.data, confirmationStatus: 'confirmed' },
        );
      } else {
        const startedAt = typeof job.data.confirmationStartedAt === 'number'
          && Number.isSafeInteger(job.data.confirmationStartedAt)
          ? job.data.confirmationStartedAt : job.createdAt;
        if (receipt || Date.now() - startedAt >= this.modelRecoveryMs()) {
          await this.repository.settleTableAssistantConfirmationFailure({
            id: job.id,
            workspaceId: job.workspaceId,
            epoch: job.epoch,
            actorId: job.actorId,
            commandId,
            proposalHash,
            confirmationStatus: 'rejected',
            failure: 'CONFIRMATION_INTERRUPTED',
          });
        }
      }
      return (await this.repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
    }
    if (Date.now() - job.createdAt >= this.modelRecoveryMs()) {
      await this.repository.finishTableAssistantJob(
        job.id, job.workspaceId, job.epoch, job.actorId, 'failed',
        { ...job.data, failure: 'ASSISTANT_INTERRUPTED' },
      );
    }
    return (await this.repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
  }

  /** F045: a running job is interrupted only after the configured whole-job deadline plus its grace. */
  private modelRecoveryMs(): number {
    return modelJobRecoveryMs(aiTableDeadlineMs(this.env));
  }

  private async scheduleAlarm(): Promise<void> {
    await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
  }

  private async scheduleAlarmAt(at: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > at) await this.ctx.storage.setAlarm(at);
  }

  private async runModelJob(input: RunModelJobInput): Promise<void> {
    const initialData = {
      requestHash: input.requestHash,
      commandId: input.commandId,
      expectedRevision: input.expectedRevision,
      expectedEpoch: input.expectedEpoch,
      // Keep the prompt that reserveModelJob stored: the committing and finished rows replace
      // `data`, and without it other members' history (F034) drops the finished request.
      ...(typeof input.prompt === 'string' && input.prompt.length > 0 && input.prompt.length <= 4_000 ? { prompt: input.prompt } : {}),
    };
    let commandMayHaveCommitted = false;
    // F045: identity tokens are captured from the authorized view before the provider runs, so the
    // catch can redact the partial draft even if the session is gone by then.
    let progressReplacements: IdentityReplacement[] | null = null;
    try {
      let session = await authenticateHash(input.sessionHash, this.env);
      if (session.record.actorId !== input.actorId) throw new AuthorityError('SESSION_EXPIRED');
      let authorized = await this.authority.authorizeSession(session, input.workspaceId);
      if (authorized.workspace.epoch !== input.expectedEpoch
          || authorized.workspace.revision !== input.expectedRevision) {
        await this.repository.failModelJobAfterReceiptCheck(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'STALE_WORKSPACE',
        );
        return;
      }
      let job = await this.repository.getModelJob(input.jobId, input.actorId, input.workspaceId, input.expectedEpoch);
      if (!job || job.status !== 'running') return;
      requireWorkspaceWritable(this.env, authorized.workspace.kind);
      progressReplacements = draftIdentityReplacements(authorized.workspace);

      // Store live counters at most once per interval; the final status always wins afterwards.
      // F050: the bounded thinking tail rides along so the waiting card can show the live text.
      let lastProgressWrite = 0;
      const onProgress = (progress: DeepSeekChangeProgress) => {
        const now = Date.now();
        if (now - lastProgressWrite < 900) return;
        lastProgressWrite = now;
        // Redact before clamping, and drop the text entirely when the identity set cannot be built.
        const thinkingTail = progress.thinkingTail && progressReplacements
          ? tailWithin(redactString(progress.thinkingTail, progressReplacements), MAX_JOB_THINKING_TAIL_CHARS)
          : '';
        void this.repository.updateModelJobProgress(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId,
          {
            receivedChars: progress.receivedChars,
            reasoningChars: progress.reasoningChars,
            ...(thinkingTail ? { thinkingTail } : {}),
            updatedAt: now,
          },
        ).catch(() => undefined);
      };

      const proposal = await proposeChange(this.env, {
        workspace: authorized.workspace,
        actorId: input.actorId,
        commandId: input.commandId,
        prompt: input.prompt,
        consent: true,
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      }, undefined, onProgress);
      if (proposal.jobId !== input.jobId) throw new AuthorityError('IDEMPOTENCY_MISMATCH');

      session = await authenticateHash(input.sessionHash, this.env);
      if (session.record.actorId !== input.actorId) throw new AuthorityError('SESSION_EXPIRED');
      authorized = await this.authority.authorizeSession(session, input.workspaceId);
      if (authorized.workspace.epoch !== input.expectedEpoch
          || authorized.workspace.revision !== input.expectedRevision) {
        await this.repository.failModelJobAfterReceiptCheck(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'STALE_WORKSPACE',
        );
        return;
      }
      job = await this.repository.getModelJob(input.jobId, input.actorId, input.workspaceId, input.expectedEpoch);
      if (!job || job.status !== 'running') return;
      requireWorkspaceWritable(this.env, authorized.workspace.kind);

      if ('clarification' in proposal) {
        // Nothing to commit: the owner answers in the chat and asks again.
        await this.repository.finishModelJob(input.jobId, input.workspaceId, input.expectedEpoch,
          input.actorId, 'completed', { ...initialData, clarification: proposal.clarification });
        return;
      }

      const envelope = {
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        expectedEpoch: input.expectedEpoch,
        type: 'evolve.propose',
        payload: { change: proposal.change },
      };
      const proposalHash = hashValue({
        type: envelope.type,
        payload: envelope.payload,
        expectedRevision: envelope.expectedRevision,
        expectedEpoch: envelope.expectedEpoch,
      });
      const committingData = { ...initialData, proposalHash };
      if (!await this.repository.beginModelJobCommit(
        input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, committingData,
      )) return;

      session = await authenticateHash(input.sessionHash, this.env);
      if (session.record.actorId !== input.actorId) throw new AuthorityError('SESSION_EXPIRED');
      authorized = await this.authority.authorizeSession(session, input.workspaceId);
      if (authorized.workspace.epoch !== input.expectedEpoch
          || authorized.workspace.revision !== input.expectedRevision) {
        await this.repository.failModelJobAfterReceiptCheck(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'STALE_WORKSPACE',
        );
        return;
      }
      const stillCommitting = await this.repository.getModelJob(
        input.jobId, input.actorId, input.workspaceId, input.expectedEpoch,
      );
      if (!stillCommitting || stillCommitting.status !== 'committing') return;
      requireWorkspaceWritable(this.env, authorized.workspace.kind);
      commandMayHaveCommitted = true;
      const acknowledgement = await this.authority.executeModelProposal(
        session, envelope, input.workspaceId, input.jobId,
      );
      const candidateId = acknowledgement.workspace.domain.candidate?.id;
      const autoApply = candidateId ? await this.autoApplyDraft(session, acknowledgement, input.workspaceId) : null;
      await this.repository.finishModelJob(input.jobId, input.workspaceId, input.expectedEpoch,
        input.actorId, 'completed', { ...committingData, ...(candidateId ? { candidateId } : {}), ...(autoApply ?? {}) });
    } catch (error) {
      try {
        const job = await this.repository.getModelJob(
          input.jobId, input.actorId, input.workspaceId, input.expectedEpoch,
        );
        if (!job || job.status === 'completed' || job.status === 'failed' || job.status === 'revoked') return;
        if (commandMayHaveCommitted) {
          const reconciled = await this.reconcileModelJob(job);
          if (reconciled.status === 'running' || reconciled.status === 'committing') {
            await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS);
          }
          return;
        }
        const failureDetails = error instanceof ModelStreamFailure
          ? boundedFailureDetails(error.details, progressReplacements)
          : undefined;
        await this.repository.failModelJobAfterReceiptCheck(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId,
          safeModelFailureCode(error), safeModelFailureReasons(error), failureDetails,
        );
      } catch {
        try { await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS); } catch { /* retry on the next room alarm */ }
      }
    }
  }

  /**
   * F039: put a table draft into use right after it is proposed. The domain runs every review check; a draft
   * that fails one, or a table that moved on meanwhile, stays a candidate for manual review. This never
   * fails the rule request itself.
   */
  private async autoApplyDraft(
    session: AuthenticatedSession,
    proposed: CommandAck,
    workspaceId: string,
  ): Promise<{ autoApply: 'applied' | 'needs-review'; autoApplyReasons?: string[] }> {
    try {
      const applied = await this.authority.execute(session, {
        commandId: crypto.randomUUID(),
        expectedRevision: proposed.workspace.revision,
        expectedEpoch: proposed.workspace.epoch,
        type: 'evolve.autoApply',
        payload: {},
      }, workspaceId);
      const candidate = applied.workspace.domain.candidate;
      if (candidate?.status === 'active') return { autoApply: 'applied' };
      const reasons = (candidate?.simulation?.checks ?? []).filter((check) => !check.passed).map((check) => check.message).slice(0, 6);
      return { autoApply: 'needs-review', ...(reasons.length ? { autoApplyReasons: reasons } : {}) };
    } catch (error) {
      // A draft that existing records break (a new unique rule, a stricter field) fails while it is
      // previewed, before any check result is stored, so the reason comes from the domain error.
      const reasons = error instanceof AuthorityError && (error.status === 409 || error.status === 422) ? cleanReasons([error.message]) : [];
      return { autoApply: 'needs-review', ...(reasons.length ? { autoApplyReasons: reasons } : {}) };
    }
  }

  private async reconcileModelJob(job: RoomModelJob): Promise<RoomModelJob> {
    if (job.status !== 'running' && job.status !== 'committing') return job;
    const commandId = typeof job.data.commandId === 'string' ? job.data.commandId : '';
    const proposalHash = typeof job.data.proposalHash === 'string' ? job.data.proposalHash : '';
    const receipt = commandId
      ? await this.repository.findCommandReceipt(job.workspaceId, job.epoch, job.actorId, commandId)
      : null;
    if (receipt && proposalHash && MODEL_JOB_ID_PATTERN.test(proposalHash)
        && receipt.payloadHash === proposalHash) {
      const candidateId = receipt.response.workspace.domain.candidate?.id;
      await this.repository.finishModelJob(job.id, job.workspaceId, job.epoch, job.actorId, 'completed', {
        ...job.data,
        ...(candidateId ? { candidateId } : {}),
      });
    }
    if (Date.now() - job.createdAt >= this.modelRecoveryMs()) {
      const current = await this.repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch);
      if (current && (current.status === 'running' || current.status === 'committing')) {
        await this.repository.failModelJobAfterReceiptCheck(
          job.id, job.workspaceId, job.epoch, job.actorId, 'MODEL_JOB_INTERRUPTED',
        );
      }
    }
    return (await this.repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
  }

  private async recoverStaleModelJobs(): Promise<void> {
    const stale = await this.repository.listStaleRunningModelJobs(Date.now() - this.modelRecoveryMs());
    for (const job of stale) {
      if (job.data.kind === 'table-assistant') await this.reconcileTableAssistantJob(job);
      else await this.reconcileModelJob(job);
    }
  }

  private async syncDirectory(): Promise<void> {
    const previous = this.directorySyncTail;
    let release: () => void = () => undefined;
    this.directorySyncTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      await this.syncDirectorySerialized();
    } finally {
      release();
    }
  }

  private async syncDirectorySerialized(): Promise<void> {
    const roomId = this.roomId;
    if (roomId === null) return;
    const workspace = await this.repository.getWorkspace(roomId);
    if (!workspace) return;
    const changes = this.repository.listPendingDirectoryChanges(DIRECTORY_BATCH_SIZE);
    if (changes.length === 0) return;
    await this.env.DB.prepare(
      `INSERT INTO rooms(id, owner_id, kind, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, kind = excluded.kind`,
    ).bind(workspace.id, workspace.ownerActorId, workspace.kind, workspace.createdAt).run();
    for (const change of changes) await this.syncDirectoryChange(change);
    await this.repository.markDirectorySynced(changes.map((change) => change.id));
    if (this.repository.hasPendingDirectoryChanges()) await this.scheduleAlarm();
  }

  private async syncDirectoryChange(change: PendingDirectoryChange): Promise<void> {
    await this.env.DB.prepare(
      `INSERT INTO room_members(user_id, room_id, epoch, active, directory_sequence) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, room_id) DO UPDATE SET epoch = excluded.epoch, active = excluded.active,
         directory_sequence = excluded.directory_sequence
       WHERE excluded.directory_sequence > room_members.directory_sequence
         AND excluded.epoch >= room_members.epoch`,
    ).bind(change.actorId, this.requireBoundRoomId(), change.epoch, change.active ? 1 : 0, change.id).run();
  }

  private async drainOutbox(): Promise<void> {
    const pending = this.repository.listPendingOutbox();
    await this.broadcastAuthorizedProjections();
    if (pending.length === 0) return;
    await this.repository.markOutboxDelivered(pending.map((item) => item.outboxId), Date.now());
    if (this.repository.pendingOutboxCount() > 0) await this.scheduleAlarm();
  }

  /**
   * Open visibility (F015): tell the other connected members that the table's AI chat changed so
   * their history reloads through the authorized API. The frame carries no chat content.
   * The actor who made the change is skipped: its own card is updated from the response and
   * polling, and a quiet history reload there would duplicate a request whose acknowledgement was
   * lost (see the lost-ack browser case).
   */
  private notifyAssistantActivity(excludeActorId?: string): void {
    if (VISIBILITY_POLICY !== 'open' || this.roomId === null) return;
    const frame = JSON.stringify({ type: 'assistant' });
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parsePeerAttachment(socket.deserializeAttachment());
      if (!attachment || attachment.workspaceId !== this.roomId) continue;
      if (excludeActorId !== undefined && attachment.actorId === excludeActorId) continue;
      try { socket.send(frame); } catch { /* already closed */ }
    }
  }

  private async broadcastAuthorizedProjections(): Promise<void> {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = parsePeerAttachment(socket.deserializeAttachment());
      if (!attachment || this.roomId === null || attachment.workspaceId !== this.roomId) {
        try { socket.close(4403, 'Authorization expired'); } catch { /* already closed */ }
        continue;
      }
      try {
        const session = await authenticateHash(attachment.sessionHash, this.env);
        if (session.record.actorId !== attachment.actorId) throw new AuthorityError('SESSION_EXPIRED');
        const authorized = await this.authority.authorizeSession(session, attachment.workspaceId);
        if (projectionCursor(authorized.workspace) === attachment.revision) continue;
        socket.send(JSON.stringify({ type: 'projection', workspace: authorized.workspace }));
        socket.serializeAttachment({ ...attachment, revision: projectionCursor(authorized.workspace) });
      } catch {
        try { socket.close(4403, 'Authorization expired'); } catch { /* already closed */ }
      }
    }
  }
}
