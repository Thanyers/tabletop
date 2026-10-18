import { DurableObject } from 'cloudflare:workers';
import type { AuthenticatedSession, AuthorizedWorkspace } from '../server/authority.js';
import type { CommandAck, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { CommandAuthority } from '../server/authority.js';
import { AuthorityError, safeError } from '../server/errors.js';
import { canonicalJson, hashValue, isRecord, randomId, sha256 } from '../server/codec.js';
import { exportInvoice } from '../server/exports.js';
import { MAX_MEMBERS_PER_WORKSPACE } from '../server/limits.js';
import { authenticateHash, authenticateRequest, isAdminSession, requireMutation, requireOrigin } from './auth.js';
import { proposeChange } from './ai.js';
import type { Env } from './contracts.js';
import { RoomRepository, type PendingDirectoryChange, type RoomModelJob } from './room-repository.js';

const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_COMMAND_BODY_BYTES = 256 * 1024;
const MAX_JSON_DEPTH_LIMIT = 40;
const MAX_MODEL_PROMPT_CHARS = 4_000;
const DIRECTORY_BATCH_SIZE = 100;
const RETRY_DELAY_MS = 5_000;
const MODEL_JOB_RECOVERY_MS = 120_000;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
const ROOM_EXPIRES_AT = 253_402_300_799_000;
const ROOM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const COMMAND_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const INVITE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{40,64}$/u;
const PROJECTION_CURSOR_PATTERN = /^[a-f0-9]{64}$/u;
const MODEL_JOB_ID_PATTERN = /^[a-f0-9]{64}$/u;

interface CreateInput {
  id: string;
  kind: 'invoice' | 'teaching' | 'encounter';
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
}

interface RunModelJobInput extends ModelInput {
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
      || (value.kind !== 'invoice' && value.kind !== 'teaching' && value.kind !== 'encounter')
      || (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 120))
      || Object.keys(value).some((key) => key !== 'id' && key !== 'kind' && key !== 'title')) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return { id: value.id, kind: value.kind, ...(typeof value.title === 'string' ? { title: value.title } : {}) };
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

function modelJobView(job: RoomModelJob): PublicModelJob {
  if (job.status === 'revoked') return { id: job.id, status: 'failed', message: 'This proposal was cancelled.' };
  if (job.status === 'failed') return { id: job.id, status: 'failed', message: 'The proposal could not be completed.' };
  if (job.status === 'running' || job.status === 'committing') return { id: job.id, status: 'running' };
  return {
    id: job.id,
    status: 'completed',
    ...(typeof job.data.candidateId === 'string' ? { candidateId: job.data.candidateId } : {}),
  };
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
    await this.repository.redeemRoomInvitation(sha256(rawTicket), session.record.actorId, session.record.name, Date.now());
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
      const route = /^\/api\/workspaces\/([0-9a-f-]{36})(?:\/(commands|invites|events|socket|model(?:\/[a-f0-9]{64})?|export))?$/iu.exec(url.pathname);
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
        const cursor = authorized.workspace.revision;
        return json(200, {
          resync: afterValues[0] !== cursor,
          cursor,
          workspace: authorized.workspace,
        }, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'commands') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        const envelope = await readJson(request, MAX_COMMAND_BODY_BYTES);
        const result = await this.authority.execute(authorized.session, envelope, workspaceId);
        this.scheduleDirectorySync();
        return json(200, result, { 'x-request-id': requestId });
      }
      if (request.method === 'POST' && suffix === 'invites') {
        const authorized = await this.authorize(request, workspaceId);
        requireMutation(request, this.env, authorized.session);
        const body = await readJson(request);
        if (!isRecord(body) || (body.seat !== 'learner-1' && body.seat !== 'learner-2'
            && body.seat !== 'mira' && body.seat !== 'pip')
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
        const requiredModelRole = authorized.workspace.kind === 'invoice' ? 'owner'
          : authorized.workspace.kind === 'teaching' ? 'teacher' : 'dm';
        if (authorized.member.role !== requiredModelRole) throw new AuthorityError('ROLE_FORBIDDEN');
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
        const existing = await this.repository.getModelJob(
          jobId, authorized.session.record.actorId, workspaceId, input.expectedEpoch,
        );
        if (existing) {
          if (existing.data.requestHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const reconciled = await this.reconcileModelJob(existing);
          return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
            modelJobView(reconciled), { 'x-request-id': requestId });
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
        });
        if (!reservation.created) {
          if (reservation.job.data.requestHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          const reconciled = await this.reconcileModelJob(reservation.job);
          return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
            modelJobView(reconciled), { 'x-request-id': requestId });
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
        }));
        await this.scheduleAlarmAt(Date.now() + MODEL_JOB_RECOVERY_MS);
        return json(202, modelJobView(reservation.job), { 'x-request-id': requestId });
      }
      if (request.method === 'GET' && suffix.startsWith('model/')) {
        const authorized = await this.authorize(request, workspaceId);
        const jobId = suffix.slice('model/'.length);
        if (!MODEL_JOB_ID_PATTERN.test(jobId)) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        const job = await this.repository.getModelJob(
          jobId, authorized.session.record.actorId, workspaceId, authorized.workspace.epoch,
        );
        if (!job) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
        const reconciled = await this.reconcileModelJob(job);
        return json(reconciled.status === 'running' || reconciled.status === 'committing' ? 202 : 200,
          modelJobView(reconciled), { 'x-request-id': requestId });
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
    const modelRecoveryAt = this.repository.nextModelJobRecoveryAt(MODEL_JOB_RECOVERY_MS);
    if (modelRecoveryAt !== null) await this.scheduleAlarmAt(modelRecoveryAt);
    if (this.repository.hasPendingDirectoryChanges() || this.repository.pendingOutboxCount() > 0) {
      await this.scheduleAlarm();
    }
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') return;
    try { socket.close(4400, 'Client messages are not supported'); } catch { /* already closed */ }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    try { socket.close(1000, 'Closed'); } catch { /* already closed */ }
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
      revision: authorized.workspace.revision,
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
    };
    let commandMayHaveCommitted = false;
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

      const proposal = await proposeChange(this.env, {
        workspace: authorized.workspace,
        actorId: input.actorId,
        commandId: input.commandId,
        prompt: input.prompt,
        consent: true,
        ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
      });
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
      commandMayHaveCommitted = true;
      const acknowledgement = await this.authority.executeModelProposal(
        session, envelope, input.workspaceId, input.jobId,
      );
      const candidateId = acknowledgement.workspace.domain.candidate?.id;
      await this.repository.finishModelJob(input.jobId, input.workspaceId, input.expectedEpoch,
        input.actorId, 'completed', { ...committingData, ...(candidateId ? { candidateId } : {}) });
    } catch {
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
        await this.repository.failModelJobAfterReceiptCheck(
          input.jobId, input.workspaceId, input.expectedEpoch, input.actorId, 'MODEL_PROPOSAL_FAILED',
        );
      } catch {
        try { await this.scheduleAlarmAt(Date.now() + RETRY_DELAY_MS); } catch { /* retry on the next room alarm */ }
      }
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
    if (Date.now() - job.createdAt >= MODEL_JOB_RECOVERY_MS) {
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
    const stale = await this.repository.listStaleRunningModelJobs(Date.now() - MODEL_JOB_RECOVERY_MS);
    for (const job of stale) await this.reconcileModelJob(job);
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
    if (pending.length === 0) return;
    await this.broadcastAuthorizedProjections();
    await this.repository.markOutboxDelivered(pending.map((item) => item.outboxId), Date.now());
    if (this.repository.pendingOutboxCount() > 0) await this.scheduleAlarm();
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
        if (authorized.workspace.revision === attachment.revision) continue;
        socket.send(JSON.stringify({ type: 'projection', workspace: authorized.workspace }));
        socket.serializeAttachment({ ...attachment, revision: authorized.workspace.revision });
      } catch {
        try { socket.close(4403, 'Authorization expired'); } catch { /* already closed */ }
      }
    }
  }
}
