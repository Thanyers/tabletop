import { MAX_IMAGE_BYTES, MAX_TABLE_IMAGES, sniffImageType } from '../src/tabletop/shared/canvas-images.js';
import { VISIBILITY_POLICY } from '../src/tabletop/shared/visibility.js';
import { DurableObject } from 'cloudflare:workers';
import type { AuthenticatedSession, AuthorizedWorkspace } from '../server/authority.js';
import { type CommandAck, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { CommandAuthority } from '../server/authority.js';
import { createCloudflareComputeRunner } from './compute-runner.js';
import { AuthorityError, safeError } from '../server/errors.js';
import { canonicalJson, hashValue, isRecord, randomId, sha256 } from '../server/codec.js';
import { projectionCursor } from '../server/projection-cursor.js';
import { resolveSpaceProjectionRead } from '../src/tabletop/shared/space-projection-read.js';
import { authenticateHash, authenticateRequest, requireMutation, requireOrigin } from './auth.js';
import { proposeChange } from './ai.js';
import { redactString, respondToTablePrompt, type IdentityReplacement } from './table-assistant.js';
import { selectTableConversation, TABLE_MEMORY_SCAN_LIMIT } from './table-memory.js';
import { type Env } from './contracts.js';
import { aiTableDeadlineMs, modelJobRecoveryMs } from './ai-deadline.js';
import { tailWithin, MAX_JOB_THINKING_TAIL_CHARS, type ModelJobSearchProgress } from '../src/tabletop/shared/model-job-progress.js';
import { ModelProviderClosed, ModelRequestTimeout, ModelStreamFailure, type DeepSeekChangeProgress } from '../server/providers/deepseek-changes.js';
import { requireWorkspaceWritable } from './table-mode.js';
import { createRoomHttp, json, matchRoomRoute, readBodyBytes, readJson, type RoomHttp, type RoomRouteMatch } from './room-http.js';
import { MAX_TABLE_ASSISTANT_JOBS_PER_ROOM, RoomRepository, type PendingDirectoryChange } from './room-repository.js';
import {
  boundedFailureDetails,
  boundedResearch,
  boundedSearchProgress,
  draftIdentityReplacements,
  MAX_TABLE_ASSISTANT_PROMPT_CHARS,
  MODEL_JOB_ID_PATTERN,
  modelJobView,
  PROJECTION_CURSOR_PATTERN,
  tableAssistantJobView,
} from './room-job-view.js';
import { createRoomJobRecovery, type RoomJobRecovery } from './room-job-recovery.js';
import {
  tableAssistantConfirmationSchema,
  tableAssistantRequestSchema,
  tableAssistantResultSchema,
  type TableAssistantConversationEntry,
  type TableAssistantHistoryPage,
  type TableAssistantInput,
  type TableAssistantRequest,
} from '../src/tabletop/shared/table-assistant-contracts.js';
import { decideDomain } from '../src/tabletop/domain/index.js';
import { CURSOR_MIN_INTERVAL_MS, cursorRelay, parseCursorInput, type CursorInput } from '../src/tabletop/shared/cursor-protocol.js';
import { cleanReasons, safeModelFailureCode, safeModelFailureReasons } from './model-failure.js';
import { resolveTableRuleReferences } from '../src/tabletop/shared/table-rule-reference.js';
import { COMPUTE_EXECUTION_TIMEOUT_MS } from '../src/tabletop/shared/compute-runtime-profiles.js';

const MAX_COMMAND_BODY_BYTES = 256 * 1024;
import { MAX_DRAFT_PROMPT_CHARS as MAX_MODEL_PROMPT_CHARS } from '../src/tabletop/shared/ai-prompt-limits.js';
const TABLE_ASSISTANT_CONTEXT_TURNS = 6;
const TABLE_ASSISTANT_CONTEXT_MAX_BYTES = 16_384;
const TABLE_ASSISTANT_HISTORY_DEFAULT_PAGE_SIZE = 20;
const TABLE_ASSISTANT_HISTORY_MAX_PAGE_SIZE = 50;
const DIRECTORY_BATCH_SIZE = 100;
const RETRY_DELAY_MS = 5_000;
const ROOM_EXPIRES_AT = 253_402_300_799_000;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/u;

interface CreateInput {
  id: string;
  kind: 'invoice' | 'teaching' | 'encounter' | 'table';
  title?: string;
}

interface ModelInput {
  commandId: string;
  expectedRevision: string;
  expectedEpoch: number;
  prompt: string;
  consent: true;
  sourceId?: string;
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

/** F073: ids of the pictures cards on this table currently show. */
function pinnedImageIds(workspace: WorkspaceView): Set<string> {
  const domain = workspace.domain;
  return new Set(domain.kind === 'table' ? (domain.notes ?? []).flatMap((note) => note.imageId ? [note.imageId] : []) : []);
}

async function canvasImageId(workspaceId: string, bytes: Uint8Array): Promise<string> {
  const prefix = new TextEncoder().encode(`tabletop-image-v1:${workspaceId}:`);
  const joined = new Uint8Array(prefix.byteLength + bytes.byteLength);
  joined.set(prefix, 0);
  joined.set(bytes, prefix.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', joined));
  return `img_${[...digest.subarray(0, 16)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
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

function parsePeerAttachment(value: unknown): PeerAttachment | null {
  if (!isRecord(value) || value.version !== 1 || typeof value.sessionHash !== 'string'
      || !/^[a-f0-9]{64}$/u.test(value.sessionHash) || typeof value.actorId !== 'string'
      || typeof value.workspaceId !== 'string' || typeof value.revision !== 'string') return null;
  return value as unknown as PeerAttachment;
}

export class Room extends DurableObject<Env> {
  readonly repository: RoomRepository;
  readonly authority: CommandAuthority;
  private readonly jobRecovery: RoomJobRecovery;
  private readonly http: RoomHttp;
  private directorySyncTail: Promise<void> = Promise.resolve();
  /** Last cursor relay per session (sockets are re-wrapped per event, so they cannot be keys). */
  private readonly cursorSentAt = new Map<string, number>();

  get roomId(): string | null {
    return this.repository.roomId;
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.repository = new RoomRepository(ctx.storage);
    this.jobRecovery = createRoomJobRecovery({
      repository: this.repository,
      modelRecoveryMs: () => this.modelRecoveryMs(),
    });
    this.authority = new CommandAuthority({
      repository: this.repository,
      workspaceIdFactory: () => this.requireBoundRoomId(),
      workspaceExpiresAt: ROOM_EXPIRES_AT,
      onWorkspaceChanged: () => this.scheduleOutboxDrain(),
      computeRunner: createCloudflareComputeRunner({
        loader: env.COMPUTE_LOADER,
        ...(env.TABLE_COMPUTE_PYTHON === 'enabled' ? { getContainer: () => this.ctx.container } : {}),
      }),
      scheduleBackground: task => this.ctx.waitUntil(task),
      onComputeWorkScheduled: () => this.ctx.waitUntil(
        this.scheduleAlarmAt(Date.now() + COMPUTE_EXECUTION_TIMEOUT_MS + RETRY_DELAY_MS).catch(() => undefined),
      ),
    });
    this.http = createRoomHttp({
      env: () => this.env,
      repository: this.repository,
      authority: this.authority,
      requireBoundRoomId: () => this.requireBoundRoomId(),
      authorize: (request, workspaceId) => this.authorize(request, workspaceId),
      create: (request, input) => this.create(request, input),
      redeemInvite: (request, ticket) => this.redeemInvite(request, ticket),
      joinByInviteLink: (request, token) => this.joinByInviteLink(request, token),
      scheduleDirectorySync: () => this.scheduleDirectorySync(),
      // F080: the Worker vouches that the caller is in the destination space; this table decides
      // the rest against its own grant list, read fresh for this request.
      readSpaceProjection: async input => {
        const workspaceId = this.requireBoundRoomId();
        const workspace = await this.repository.withWorkspaceTransaction(workspaceId, async transaction => transaction.workspace);
        const domain = workspace.domainState as { kind: string; spaceGrants?: Parameters<typeof resolveSpaceProjectionRead>[0]['grants'] };
        return resolveSpaceProjectionRead({
          grants: Array.isArray(domain.spaceGrants) && domain.kind === 'table' ? domain.spaceGrants : [],
          grantId: input.grantId,
          spaceId: input.spaceId,
          spaceWorkspaceId: input.spaceWorkspaceId,
          sourceWorkspaceId: workspace.id,
          sourceEpoch: workspace.epoch,
          actorId: input.actorId,
          portId: input.portId,
          membership: { verifiedBy: 'destination', actorId: input.actorId },
          now: Date.now(),
        });
      },
    });
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  /**
   * F073: POST stores one picture for a card (members who may pin notes); GET returns it to members.
   * The bytes are checked by content, never by the declared type, and are served so a browser cannot reinterpret them.
   */
  private async canvasImage(request: Request, workspaceId: string, imageId: string | undefined, requestId: string): Promise<Response> {
    if (this.roomId === null || workspaceId !== this.roomId) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
    const authorized = await this.authorize(request, workspaceId);
    if (authorized.workspace.kind !== 'table') throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
    if (request.method === 'POST' && imageId === undefined) {
      requireMutation(request, this.env, authorized.session);
      requireWorkspaceWritable(this.env, authorized.workspace.kind);
      if (authorized.context.role !== 'owner' && authorized.context.role !== 'participant') throw new AuthorityError('ROLE_FORBIDDEN');
      const bytes = await readBodyBytes(request, MAX_IMAGE_BYTES, 'INVALID_REQUEST');
      const mime = sniffImageType(bytes);
      if (!mime) throw new AuthorityError('UNSUPPORTED_IMAGE', 'Use a JPEG, PNG or WebP image.', 415);
      const id = await canvasImageId(workspaceId, bytes);
      await this.repository.storeCanvasImage({
        workspaceId, epoch: authorized.context.epoch, id, mime, bytes, actorId: authorized.context.actorId,
        now: Date.now(), pinnedIds: pinnedImageIds(authorized.workspace), limit: MAX_TABLE_IMAGES,
      });
      return json(201, { imageId: id }, { 'x-request-id': requestId });
    }
    if (request.method === 'GET' && imageId !== undefined) {
      const image = this.repository.readCanvasImage(workspaceId, authorized.context.epoch, imageId);
      // A picture no card shows any more stays visible only to the person who uploaded it.
      if (!image || (!pinnedImageIds(authorized.workspace).has(imageId) && image.createdBy !== authorized.context.actorId)) {
        throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
      }
      return new Response(image.bytes, { status: 200, headers: {
        'content-type': image.mime,
        'content-length': String(image.bytes.byteLength),
        'content-disposition': 'inline',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
        'x-request-id': requestId,
      } });
    }
    throw new AuthorityError('METHOD_NOT_ALLOWED', 'Method not allowed.', 405);
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
      const match = matchRoomRoute(request, this.roomId);
      if (!match) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
      if (match.handler === 'room-http') return await this.http.handle(request, match, requestId);
      return await this.handleRoomRoute(request, match, requestId);
    } catch (error) {
      const mapped = safeError(error, requestId);
      return json(mapped.status, mapped.body, { 'x-request-id': requestId });
    }
  }

  /**
   * Routes that need this instance: the projection socket, the provider job
   * runners and their alarm scheduling. The bodies below are unchanged from the
   * previous single fetch(); F078-T6c moved only the routes that do not need it.
   */
  private async handleRoomRoute(request: Request, match: RoomRouteMatch, requestId: string): Promise<Response> {
    if (match.name === 'image') return this.canvasImage(request, match.workspaceId!, match.imageId, requestId);
    const workspaceId = match.workspaceId!;
    const suffix = match.suffix ?? '';
    const url = new URL(request.url);
    if (suffix === 'socket') return await this.socket(request, workspaceId);

      if (request.method === 'POST' && suffix === 'model') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        requireWorkspaceWritable(this.env, authorized.workspace.kind);
        // F035: drafting rules (incl. AI drafts) needs the rules.draft permission.
        if (!authorized.context.permissions?.has('rules.draft')) throw new AuthorityError('ROLE_FORBIDDEN');
        const parsedInput = parseModelInput(await readJson(request, MAX_COMMAND_BODY_BYTES));
        const input = authorized.workspace.domain.kind === 'table'
          ? { ...parsedInput, prompt: resolveTableRuleReferences(parsedInput.prompt, authorized.workspace.domain) }
          : parsedInput;
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
          const reconciled = await this.jobRecovery.reconcileModelJob(existing);
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
          const reconciled = await this.jobRecovery.reconcileModelJob(reservation.job);
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
        const items = await Promise.all(jobs.map(async (job) => modelJobView(await this.jobRecovery.reconcileModelJob(job), limitMs)));
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
        const reconciled = await this.jobRecovery.reconcileModelJob(job);
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
          tableAssistantJobView(await this.jobRecovery.reconcileTableAssistantJob(job))));
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
        const parsedInput = parseTableAssistantRequest(await readJson(request, MAX_COMMAND_BODY_BYTES));
        const input = { ...parsedInput, prompt: resolveTableRuleReferences(parsedInput.prompt, authorized.workspace.domain) };
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
          const reconciled = await this.jobRecovery.reconcileTableAssistantJob(existing);
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
          const reconciled = await this.jobRecovery.reconcileTableAssistantJob(reservation.job);
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
        const reconciled = await this.jobRecovery.reconcileTableAssistantJob(job);
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
        job = await this.jobRecovery.reconcileTableAssistantJob(job);
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

    throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
  }
  async alarm(): Promise<void> {
    try {
      if (this.repository.roomId) await this.authority.resumeTableCompute(this.repository.roomId);
      await this.jobRecovery.recoverStaleModelJobs();
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
      ...(typeof input.prompt === 'string' && input.prompt.length > 0 && input.prompt.length <= MAX_TABLE_ASSISTANT_PROMPT_CHARS ? { prompt: input.prompt } : {}),
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
      // F064: the last research event is re-sent with every tick, so "✓ used N sources" stays on the
      // card for the whole draft instead of vanishing on the next progress write.
      let lastProgressWrite = 0;
      let lastSearch: ModelJobSearchProgress | undefined;
      const onProgress = (progress: DeepSeekChangeProgress) => {
        const now = Date.now();
        // A finished research step is never throttled: dropping it would leave the card saying
        // "searching…" until the draft ends, which is the one line this feature exists to replace.
        const searchDone = progress.search?.phase === 'done';
        if (!searchDone && now - lastProgressWrite < 900) return;
        lastProgressWrite = now;
        // Redact before clamping, and drop the text entirely when the identity set cannot be built.
        const thinkingTail = progress.thinkingTail && progressReplacements
          ? tailWithin(redactString(progress.thinkingTail, progressReplacements), MAX_JOB_THINKING_TAIL_CHARS)
          : '';
        const search = boundedSearchProgress(progress.search, progressReplacements);
        if (search) lastSearch = search;
        void this.repository.updateModelJobProgress(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId,
          {
            receivedChars: progress.receivedChars,
            reasoningChars: progress.reasoningChars,
            ...(thinkingTail ? { thinkingTail } : {}),
            ...(lastSearch ? { search: lastSearch } : {}),
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

      // F064 slice B: the sources this draft used, redacted and bounded once, then stored with the
      // job so every member opening the card sees the same list.
      const researchMeta = boundedResearch(
        'research' in proposal ? proposal.research : undefined, progressReplacements,
      );

      if ('clarification' in proposal) {
        // Nothing to commit: the owner answers in the chat and asks again.
        await this.repository.finishModelJob(input.jobId, input.workspaceId, input.expectedEpoch,
          input.actorId, 'completed', {
            ...initialData,
            clarification: proposal.clarification,
            ...(researchMeta ? { research: researchMeta } : {}),
          });
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
      const committingData = { ...initialData, proposalHash, ...(researchMeta ? { research: researchMeta } : {}) };
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
          const reconciled = await this.jobRecovery.reconcileModelJob(job);
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
