import type { IncomingMessage } from 'node:http';
import { DomainError, type ActorContext, type Artifact, type CaseKind, type CommandAck, type CommandEnvelope, type DomainState, type InvoiceLine, type Member, type Role, type Seat, type SessionView, type Shipment, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { defaultWorkspaceTitle, normalizeWorkspaceTitle } from '../src/tabletop/shared/workspace-title.js';
import { createDomain, decideDomain, projectDomain, invoiceImportSchema } from '../src/tabletop/domain/index.js';
import { z } from 'zod';
import { canonicalJson, hashValue, keyedSha256, randomId, randomToken, sha256, constantTimeHashEqual, isRecord } from './codec.js';
import { jsonWithinBudget } from '../src/tabletop/shared/json-budget.js';
import { AuthorityError } from './errors.js';
import {
  INVITE_TTL_MS,
  MAX_COMMAND_TYPE_CHARS,
  MAX_DISPLAY_NAME_CHARS,
  MAX_MEMBERS_PER_WORKSPACE,
  MAX_NAME_INPUT_CHARS,
  MAX_REVISION_TOKEN_CHARS,
  SESSION_TOKEN_MAX_LENGTH,
  SESSION_TOKEN_MIN_LENGTH,
  SCHEMA_VERSION,
  SESSION_COOKIE_NAME,
  SESSION_HARD_TTL_MS,
  SESSION_IDLE_TTL_MS,
  MAX_WORKSPACE_TITLE_CHARS,
  WORKSPACE_TTL_MS,
} from './limits.js';
import type {
  InvitationRecord,
  ModelJobCommitGuard,
  SessionRecord,
  StoredMember,
  StoredWorkspace,
  WorkspaceRepository,
} from './repository.js';

const commandEnvelopeSchema = z.object({
  commandId: z.string().uuid(),
  expectedRevision: z.string().min(1).max(MAX_REVISION_TOKEN_CHARS),
  expectedEpoch: z.number().int().positive(),
  type: z.string().min(1).max(MAX_COMMAND_TYPE_CHARS),
  payload: z.unknown(),
}).strict();

const workspaceInputSchema = z.object({
  kind: z.enum(['invoice', 'teaching', 'encounter', 'table']),
  title: z.string().max(MAX_WORKSPACE_TITLE_CHARS).optional(),
}).strict();

const nameInputSchema = z.object({ name: z.string().max(MAX_NAME_INPUT_CHARS).optional() }).strict();

const renamePayloadSchema = z.object({ title: z.string().max(1_000) }).strict();
const emptyPayloadSchema = z.object({}).strict();
const requestFingerprintSchema = z.string().regex(/^[a-f0-9]{64}$/u);

const publicCommands: Record<CaseKind, ReadonlySet<string>> = {
  invoice: new Set([
    'invoice.reviewSource', 'invoice.sample', 'invoice.saveRun',
    'evolve.propose', 'evolve.rollback', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate',
  ]),
  teaching: new Set([
    'teaching.setParameters', 'teaching.setRepresentation', 'teaching.answer', 'teaching.saveNote',
    'evolve.propose', 'evolve.rollback', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate',
  ]),
  encounter: new Set([
    'encounter.declareHit', 'encounter.shield', 'encounter.resolve', 'encounter.endTurn', 'encounter.saveNote',
    'encounter.pause', 'encounter.resume',
    'evolve.propose', 'evolve.rollback', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate',
  ]),
  table: new Set([
    'table.import', 'table.importRows', 'table.removeSource', 'table.act', 'table.setComputedColumns', 'canvas.layout',
    'evolve.propose', 'evolve.rollback', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate',
  ]),
};

export interface AuthenticatedSession {
  readonly record: SessionRecord;
  readonly csrfToken: string;
  readonly expiresAt: number;
}

export interface AuthorizedWorkspace {
  readonly session: AuthenticatedSession;
  readonly member: StoredMember;
  readonly workspace: WorkspaceView;
  readonly context: ActorContext;
}

export interface SessionResult {
  session: AuthenticatedSession;
  view: SessionView;
  setCookie?: string;
}

export interface InviteResult {
  ticket: string;
  expiresAt: number;
}

export interface TrustedInvoiceImport {
  artifact: Artifact;
  shipments?: Shipment[];
  invoiceLines?: InvoiceLine[];
}

export interface AuthorityOptions {
  readonly repository: WorkspaceRepository;
  readonly secureCookies?: boolean;
  readonly now?: () => number;
  readonly onWorkspaceChanged?: (workspaceId: string, epoch: number) => void;
  readonly workspaceIdFactory?: () => string;
  readonly workspaceLifetimeMs?: number;
  readonly workspaceExpiresAt?: number;
}

function cookieToken(request: IncomingMessage): string | null {
  const rawCookie = request.headers.cookie;
  if (!rawCookie) return null;
  let token: string | null = null;
  for (const item of rawCookie.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0) continue;
    const name = item.slice(0, separator).trim();
    if (name !== SESSION_COOKIE_NAME) continue;
    if (token !== null) throw new AuthorityError('INVALID_REQUEST');
    token = item.slice(separator + 1).trim();
  }
  if (token !== null && !tokenPattern.test(token)) throw new AuthorityError('SESSION_REQUIRED');
  return token;
}

const tokenPattern = new RegExp(`^[A-Za-z0-9_-]{${SESSION_TOKEN_MIN_LENGTH},${SESSION_TOKEN_MAX_LENGTH}}$`, 'u');

function csrfForToken(token: string): string {
  return sha256(`tabletop-r1-csrf-v1:${token}`);
}

function expiresAt(session: SessionRecord): number {
  return Math.min(session.lastSeenAt + SESSION_IDLE_TTL_MS, session.hardExpiresAt);
}

function parseName(value: unknown): string {
  const parsed = nameInputSchema.safeParse(value);
  if (!parsed.success) throw new AuthorityError('INVALID_REQUEST');
  const name = (parsed.data.name ?? 'Guest').replace(/\p{Cc}/gu, '').trim();
  const bounded = Array.from(name).slice(0, MAX_DISPLAY_NAME_CHARS).join('');
  return bounded || 'Guest';
}

function primaryRole(kind: CaseKind): Role {
  if (kind === 'invoice' || kind === 'table') return 'owner';
  if (kind === 'teaching') return 'teacher';
  return 'dm';
}

function inviteForSeat(kind: CaseKind, seat: Seat): { role: 'learner' | 'player' | 'participant'; seat: Seat } | null {
  if (kind === 'teaching' && (seat === 'learner-1' || seat === 'learner-2')) return { role: 'learner', seat };
  if (kind === 'encounter' && (seat === 'mira' || seat === 'pip')) return { role: 'player', seat };
  if (kind === 'table' && seat.startsWith('member-')) return { role: 'participant', seat };
  return null;
}

function actorContext(workspace: StoredWorkspace, member: StoredMember, now: number): ActorContext {
  return {
    actorId: member.actorId,
    name: member.name,
    role: member.role,
    ...(member.seat ? { seat: member.seat } : {}),
    workspaceId: workspace.id,
    epoch: workspace.epoch,
    now,
    hash: hashValue,
  };
}

function publicMember(member: StoredMember): Member {
  return {
    actorId: member.actorId,
    name: member.name,
    role: member.role,
    ...(member.seat ? { seat: member.seat } : {}),
  };
}

function commandFrom(value: unknown): CommandEnvelope {
  if (!jsonWithinBudget(value)) throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
  const result = commandEnvelopeSchema.safeParse(value);
  if (!result.success) throw new AuthorityError('INVALID_REQUEST');
  try {
    canonicalJson({ type: result.data.type, payload: result.data.payload });
  } catch {
    throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
  }
  return result.data;
}

function assertIdentityFieldsAbsent(payload: unknown): void {
  if (!isRecord(payload)) return;
  const forbidden = ['actorId', 'role', 'seat', 'workspaceId', 'epoch'];
  if (forbidden.some((key) => Object.hasOwn(payload, key))) throw new AuthorityError('COMMAND_IDENTITY_SPOOF');
}

function mapDomainError(error: DomainError): AuthorityError {
  const conflictCodes = new Set([
    'STALE_CANDIDATE', 'STALE_LESSON', 'APPROVAL_EXPIRED', 'APPROVAL_REVOKED', 'APPROVAL_MISMATCH',
    'CANDIDATE_PENDING', 'REACTION_CLOSED', 'IDEMPOTENCY_MISMATCH', 'STALE_LAYOUT',
  ]);
  const status = error.code === 'FORBIDDEN' ? 403 : conflictCodes.has(error.code) ? 409 : 422;
  return new AuthorityError(error.code, error.message, status);
}

export class CommandAuthority {
  readonly repository: WorkspaceRepository;
  private readonly secureCookies: boolean;
  private readonly now: () => number;
  private readonly workspaceIdFactory: () => string;
  private readonly workspaceLifetimeMs: number;
  private readonly workspaceExpiresAt: number | null;
  private onWorkspaceChanged: (workspaceId: string, epoch: number) => void;

  constructor(options: AuthorityOptions) {
    this.repository = options.repository;
    this.secureCookies = options.secureCookies ?? false;
    this.now = options.now ?? Date.now;
    this.workspaceIdFactory = options.workspaceIdFactory ?? randomId;
    this.workspaceLifetimeMs = options.workspaceLifetimeMs ?? WORKSPACE_TTL_MS;
    this.workspaceExpiresAt = options.workspaceExpiresAt ?? null;
    if (!Number.isSafeInteger(this.workspaceLifetimeMs) || this.workspaceLifetimeMs <= 0) {
      throw new Error('WORKSPACE_LIFETIME_INVALID');
    }
    if (this.workspaceExpiresAt !== null && (!Number.isSafeInteger(this.workspaceExpiresAt) || this.workspaceExpiresAt <= 0)) {
      throw new Error('WORKSPACE_EXPIRY_INVALID');
    }
    this.onWorkspaceChanged = options.onWorkspaceChanged ?? (() => undefined);
  }

  setWorkspaceChangedHandler(handler: (workspaceId: string, epoch: number) => void): void {
    this.onWorkspaceChanged = handler;
  }

  async createOrRefreshSession(request: IncomingMessage, input: unknown): Promise<SessionResult> {
    const name = parseName(input);
    const rawToken = cookieToken(request);
    if (rawToken) {
      const existing = await this.repository.getSession(sha256(rawToken));
      if (existing && existing.revokedAt === null && expiresAt(existing) > this.now()) {
        const session = await this.authenticate(request);
        this.requireCsrf(request, session);
        const refreshed = name === existing.name
          ? session
          : await this.refreshName(session, name);
        return { session: refreshed, view: await this.sessionView(refreshed) };
      }
    }

    const now = this.now();
    const rawSessionToken = randomToken();
    const csrfToken = csrfForToken(rawSessionToken);
    const record: SessionRecord = {
      tokenHash: sha256(rawSessionToken),
      csrfHash: sha256(csrfToken),
      actorId: randomId(),
      name,
      createdAt: now,
      lastSeenAt: now,
      hardExpiresAt: now + SESSION_HARD_TTL_MS,
      revokedAt: null,
      workspaceId: null,
      rotatedToTokenHash: null,
      rotationTicketHash: null,
    };
    await this.repository.createSession(record);
    const session = { record, csrfToken, expiresAt: expiresAt(record) };
    return {
      session,
      view: await this.sessionView(session),
      setCookie: this.sessionCookie(rawSessionToken, record),
    };
  }

  async authenticate(request: IncomingMessage): Promise<AuthenticatedSession> {
    const rawToken = cookieToken(request);
    if (!rawToken) throw new AuthorityError('SESSION_REQUIRED');
    const tokenHash = sha256(rawToken);
    const stored = await this.repository.getSession(tokenHash);
    const now = this.now();
    if (!stored || stored.revokedAt !== null || expiresAt(stored) <= now) throw new AuthorityError('SESSION_EXPIRED');
    const refreshed = await this.repository.touchSession(tokenHash, now);
    if (!refreshed) throw new AuthorityError('SESSION_EXPIRED');
    const csrfToken = csrfForToken(rawToken);
    if (!constantTimeHashEqual(refreshed.csrfHash, csrfToken)) throw new AuthorityError('SESSION_EXPIRED');
    return { record: refreshed, csrfToken, expiresAt: expiresAt(refreshed) };
  }

  requireCsrf(request: IncomingMessage, session: AuthenticatedSession): void {
    const supplied = request.headers['x-csrf-token'];
    if (typeof supplied !== 'string' || !constantTimeHashEqual(session.record.csrfHash, supplied)) {
      throw new AuthorityError('CSRF_REJECTED');
    }
  }

  async sessionView(session: AuthenticatedSession): Promise<SessionView> {
    const workspaces = await this.repository.listWorkspaceReferences(session.record.actorId, this.now());
    return {
      csrfToken: session.csrfToken,
      actorId: session.record.actorId,
      name: session.record.name,
      expiresAt: session.expiresAt,
      workspaces,
    };
  }

  async authorize(request: IncomingMessage, workspaceId: string): Promise<AuthorizedWorkspace> {
    const session = await this.authenticate(request);
    return this.authorizeSession(session, workspaceId);
  }

  async authorizeSession(session: AuthenticatedSession, workspaceId: string): Promise<AuthorizedWorkspace> {
    return this.repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
      const workspace = transaction.workspace;
      const now = this.now();
      if (workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      if (workspace.schemaVersion !== SCHEMA_VERSION) {
        throw new AuthorityError('SCHEMA_VERSION_UNSUPPORTED', 'Workspace data uses an unsupported schema version.', 503);
      }
      const member = await transaction.getMember(session.record.actorId);
      if (!member || member.revokedAt !== null) throw new AuthorityError('MEMBERSHIP_REVOKED');
      const context = actorContext(workspace, member, now);
      let domain: DomainState;
      try {
        domain = projectDomain(workspace.domainState, context);
      } catch (error) {
        if (error instanceof DomainError) throw mapDomainError(error);
        throw error;
      }
      const members = await transaction.listMembers();
      const view = this.toWorkspaceView(workspace, member, domain, members);
      return { session, member, workspace: view, context };
    });
  }

  async createWorkspace(session: AuthenticatedSession, input: unknown): Promise<WorkspaceView> {
    const parsed = workspaceInputSchema.safeParse(input);
    if (!parsed.success) throw new AuthorityError('INVALID_REQUEST');
    if (session.record.workspaceId !== null) {
      const current = await this.repository.withWorkspaceTransaction(session.record.workspaceId, async (transaction) => {
        const member = await transaction.getMember(session.record.actorId);
        return { workspace: transaction.workspace, member };
      });
      if (!current.member || current.member.revokedAt !== null
          || current.workspace.ownerActorId !== session.record.actorId
          || current.member.role !== primaryRole(current.workspace.kind)) {
        throw new AuthorityError('SESSION_ALREADY_BOUND', 'Only a workspace owner can create another workspace in this session.', 409);
      }
    }
    const now = this.now();
    const id = this.workspaceIdFactory();
    const role = primaryRole(parsed.data.kind);
    const title = parsed.data.title?.trim() || defaultWorkspaceTitle(parsed.data.kind);
    const workspace: StoredWorkspace = {
      id,
      title: Array.from(title).slice(0, MAX_WORKSPACE_TITLE_CHARS).join(''),
      kind: parsed.data.kind,
      ownerActorId: session.record.actorId,
      epoch: 1,
      revision: 1,
      projectionSalt: randomToken(),
      domainState: createDomain(parsed.data.kind, {
        actorId: session.record.actorId,
        name: session.record.name,
        role,
        workspaceId: id,
        epoch: 1,
        now,
        hash: hashValue,
      }),
      stateHash: '',
      schemaVersion: SCHEMA_VERSION,
      createdAt: now,
      expiresAt: this.workspaceExpiresAt ?? now + this.workspaceLifetimeMs,
    };
    workspace.stateHash = hashValue(workspace.domainState);
    const owner: StoredMember = {
      actorId: session.record.actorId,
      name: session.record.name,
      role,
      createdAt: now,
      revokedAt: null,
    };
    try {
      await this.repository.createWorkspace({ workspace, owner, sessionTokenHash: session.record.tokenHash }, now);
    } catch (error) {
      throw this.storageError(error);
    }
    const updatedSession: AuthenticatedSession = {
      ...session,
      record: { ...session.record, workspaceId: id },
    };
    const authorized = await this.authorizeSession(updatedSession, id);
    this.onWorkspaceChanged(id, workspace.epoch);
    return authorized.workspace;
  }

  async createInvite(
    session: AuthenticatedSession,
    workspaceId: string,
    seat: Seat,
    replaceOutstanding = false,
  ): Promise<InviteResult> {
    const placement = inviteForSeat('teaching', seat) ?? inviteForSeat('encounter', seat) ?? inviteForSeat('table', seat);
    if (!placement) throw new AuthorityError('INVITE_NOT_ALLOWED');
    const ticket = randomToken();
    const now = this.now();
    await this.repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
      const workspace = transaction.workspace;
      const member = await transaction.getMember(session.record.actorId);
      if (!member || member.revokedAt !== null) throw new AuthorityError('MEMBERSHIP_REVOKED');
      if (workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      if (workspace.ownerActorId !== session.record.actorId || member.role !== primaryRole(workspace.kind)) {
        throw new AuthorityError('ROLE_FORBIDDEN');
      }
      const roleSeat = inviteForSeat(workspace.kind, seat);
      if (!roleSeat || roleSeat.role !== placement.role) throw new AuthorityError('INVITE_NOT_ALLOWED');
      const members = await transaction.listMembers();
      if (members.some((active) => active.seat === seat)) throw new AuthorityError('INVITE_SEAT_OCCUPIED');
      if (replaceOutstanding) {
        await transaction.revokeOutstandingInvitations(seat, now);
        await transaction.hasActiveInvitation(seat, now);
      } else if (await transaction.hasActiveInvitation(seat, now)) {
        throw new AuthorityError('SEAT_UNAVAILABLE');
      }
      if (await transaction.countMembers() >= MAX_MEMBERS_PER_WORKSPACE) throw new AuthorityError('MEMBER_LIMIT_REACHED');
      const invitation: InvitationRecord = {
        ticketHash: sha256(ticket),
        workspaceId,
        epoch: workspace.epoch,
        role: roleSeat.role,
        seat,
        createdBy: session.record.actorId,
        createdAt: now,
        expiresAt: now + INVITE_TTL_MS,
        redeemedAt: null,
        redeemedBy: null,
        revokedAt: null,
      };
      try {
        await transaction.insertInvitation(invitation);
      } catch (error) {
        throw this.storageError(error);
      }
    });
    return { ticket, expiresAt: now + INVITE_TTL_MS };
  }

  async redeemInvite(request: IncomingMessage, ticket: string): Promise<{ workspace: WorkspaceView; setCookie: string; csrfToken: string }> {
    if (!tokenPattern.test(ticket)) throw new AuthorityError('INVITE_INVALID');
    const rawSessionToken = cookieToken(request);
    if (!rawSessionToken) throw new AuthorityError('SESSION_REQUIRED');
    const ticketHash = sha256(ticket);
    const sessionTokenHash = sha256(rawSessionToken);
    const storedSession = await this.repository.getSession(sessionTokenHash);
    if (!storedSession) throw new AuthorityError('SESSION_REQUIRED');
    const csrf = request.headers['x-csrf-token'];
    if (typeof csrf !== 'string' || !constantTimeHashEqual(storedSession.csrfHash, csrf)) {
      throw new AuthorityError('CSRF_REJECTED');
    }
    if (storedSession.hardExpiresAt <= this.now()
        || (storedSession.revokedAt === null && expiresAt(storedSession) <= this.now())) {
      throw new AuthorityError('SESSION_EXPIRED');
    }
    const now = this.now();
    const invitation = await this.repository.getInvitation(ticketHash);
    if (!invitation) throw new AuthorityError('INVITE_INVALID');
    if (invitation.revokedAt !== null || invitation.expiresAt <= now) throw new AuthorityError('INVITE_EXPIRED');
    const nextRawToken = sha256(`tabletop-r1-session-rotation-v1:${rawSessionToken}:${ticket}`);
    const nextCsrfToken = csrfForToken(nextRawToken);
    const nextSession: SessionRecord = {
      tokenHash: sha256(nextRawToken),
      csrfHash: sha256(nextCsrfToken),
      actorId: storedSession.actorId,
      name: storedSession.name,
      createdAt: storedSession.createdAt,
      lastSeenAt: now,
      hardExpiresAt: storedSession.hardExpiresAt,
      revokedAt: null,
      workspaceId: invitation.workspaceId,
      rotatedToTokenHash: null,
      rotationTicketHash: null,
    };
    let redeemed;
    try {
      redeemed = await this.repository.redeemInvitation({
        ticketHash,
        sessionTokenHash,
        nextSession,
        now,
      });
    } catch (error) {
      throw this.storageError(error);
    }
    const session: AuthenticatedSession = {
      record: redeemed.session,
      csrfToken: nextCsrfToken,
      expiresAt: expiresAt(redeemed.session),
    };
    const authorized = await this.authorizeSession(session, invitation.workspaceId);
    this.onWorkspaceChanged(invitation.workspaceId, invitation.epoch);
    return {
      workspace: authorized.workspace,
      setCookie: this.sessionCookie(nextRawToken, redeemed.session),
      csrfToken: session.csrfToken,
    };
  }

  async execute(session: AuthenticatedSession, rawEnvelope: unknown, workspaceId = session.record.workspaceId): Promise<CommandAck> {
    if (!workspaceId) throw new AuthorityError('WORKSPACE_NOT_FOUND');
    return this.executeInternal(session, workspaceId, commandFrom(rawEnvelope), null);
  }

  async executeModelProposal(
    session: AuthenticatedSession,
    rawEnvelope: unknown,
    workspaceId: string,
    jobId: string,
  ): Promise<CommandAck> {
    const envelope = commandFrom(rawEnvelope);
    if (envelope.type !== 'evolve.propose' || !/^[a-f0-9]{64}$/u.test(jobId)) {
      throw new AuthorityError('TRUSTED_OPERATION_REQUIRED');
    }
    const guard: ModelJobCommitGuard = {
      jobId,
      workspaceId,
      epoch: envelope.expectedEpoch,
      actorId: session.record.actorId,
      commandId: envelope.commandId,
      expectedRevision: envelope.expectedRevision,
      proposalHash: this.commandRequestHash(envelope),
    };
    return this.executeInternal(session, workspaceId, envelope, null, undefined, guard);
  }

  async executeTableAssistantAction(
    session: AuthenticatedSession,
    rawEnvelope: unknown,
    workspaceId: string,
    jobId: string,
  ): Promise<CommandAck> {
    const envelope = commandFrom(rawEnvelope);
    if (envelope.type !== 'table.act' || !/^[a-f0-9]{64}$/u.test(jobId)) {
      throw new AuthorityError('TRUSTED_OPERATION_REQUIRED');
    }
    const guard: ModelJobCommitGuard = {
      jobId,
      workspaceId,
      epoch: envelope.expectedEpoch,
      actorId: session.record.actorId,
      commandId: envelope.commandId,
      expectedRevision: envelope.expectedRevision,
      proposalHash: this.commandRequestHash(envelope),
    };
    return this.executeInternal(session, workspaceId, envelope, null, undefined, guard);
  }

  async findTrustedReceipt(
    session: AuthenticatedSession,
    workspaceId: string,
    rawEnvelope: unknown,
    requestFingerprint: string,
  ): Promise<CommandAck | null> {
    const envelope = commandFrom(rawEnvelope);
    if (envelope.type !== 'invoice.import') throw new AuthorityError('TRUSTED_OPERATION_REQUIRED');
    const fingerprint = requestFingerprintSchema.safeParse(requestFingerprint);
    if (!fingerprint.success) throw new AuthorityError('INVALID_REQUEST');
    const requestHash = this.trustedRequestHash(envelope, fingerprint.data);
    const now = this.now();
    try {
      return await this.repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
        const workspace = transaction.workspace;
        if (workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
        const member = await transaction.getMember(session.record.actorId);
        if (!member || member.revokedAt !== null) throw new AuthorityError('MEMBERSHIP_REVOKED');
        if (workspace.kind !== 'invoice' || member.role !== 'owner' || workspace.ownerActorId !== member.actorId) {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }
        const existing = await transaction.findCommand(member.actorId, envelope.commandId, envelope.expectedEpoch);
        if (existing) {
          if (existing.payloadHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          return { ...existing.response, duplicate: true };
        }
        if (workspace.schemaVersion !== SCHEMA_VERSION) {
          throw new AuthorityError('SCHEMA_VERSION_UNSUPPORTED', 'Workspace data uses an unsupported schema version.', 503);
        }
        if (envelope.expectedEpoch !== workspace.epoch) throw new AuthorityError('STALE_EPOCH');
        const context = actorContext(workspace, member, now);
        const domain = projectDomain(workspace.domainState, context);
        const current = this.toWorkspaceView(workspace, member, domain, await transaction.listMembers());
        if (current.revision !== envelope.expectedRevision) throw new AuthorityError('STALE_REVISION');
        return null;
      });
    } catch (error) {
      throw this.storageError(error);
    }
  }

  async executeTrusted(
    session: AuthenticatedSession,
    rawEnvelope: unknown,
    imported: TrustedInvoiceImport,
    workspaceId = session.record.workspaceId,
    requestFingerprint?: string,
  ): Promise<CommandAck> {
    if (!workspaceId) throw new AuthorityError('WORKSPACE_NOT_FOUND');
    const envelope = commandFrom(rawEnvelope);
    if (envelope.type !== 'invoice.import') throw new AuthorityError('TRUSTED_OPERATION_REQUIRED');
    let payload: unknown;
    try {
      payload = invoiceImportSchema.parse({
        artifact: imported.artifact,
        ...(imported.shipments ? { shipments: imported.shipments } : {}),
        ...(imported.invoiceLines ? { invoiceLines: imported.invoiceLines } : {}),
      });
    } catch {
      throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
    }
    const fingerprint = requestFingerprint === undefined ? undefined : requestFingerprintSchema.safeParse(requestFingerprint);
    if (fingerprint && !fingerprint.success) throw new AuthorityError('INVALID_REQUEST');
    return this.executeInternal(
      session,
      workspaceId,
      { ...envelope, payload },
      'artifact-import',
      fingerprint?.data,
    );
  }

  private async executeInternal(
    session: AuthenticatedSession,
    workspaceId: string,
    envelope: CommandEnvelope,
    trustedOperation: 'artifact-import' | null,
    requestFingerprint?: string,
    modelJobGuard?: ModelJobCommitGuard,
  ): Promise<CommandAck> {
    const now = this.now();
    const requestHash = requestFingerprint === undefined
      ? this.commandRequestHash(envelope)
      : this.trustedRequestHash(envelope, requestFingerprint);
    let ack: CommandAck;
    try {
      ack = await this.repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
        const workspace = transaction.workspace;
        if (workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
        const member = await transaction.getMember(session.record.actorId);
        if (!member || member.revokedAt !== null) throw new AuthorityError('MEMBERSHIP_REVOKED');
        if (workspace.schemaVersion !== SCHEMA_VERSION) throw new AuthorityError('SCHEMA_VERSION_UNSUPPORTED', 'Workspace data uses an unsupported schema version.', 503);
        if (!commandAllowed(workspace.kind, envelope.type, trustedOperation)) {
          if (envelope.type === 'invoice.import') throw new AuthorityError('TRUSTED_OPERATION_REQUIRED');
          throw new AuthorityError('COMMAND_NOT_ALLOWED');
        }
        if (modelJobGuard) await transaction.assertModelJobCommitting(modelJobGuard);
        if (workspace.kind === 'teaching' && envelope.type === 'teaching.setRepresentation') {
          await this.validateTeachingTarget(transaction, envelope.payload);
        }
        const existing = await transaction.findCommand(session.record.actorId, envelope.commandId, envelope.expectedEpoch);
        if (existing) {
          if (existing.payloadHash !== requestHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
          return { ...existing.response, duplicate: true };
        }
        if (workspace.ownerActorId !== session.record.actorId && (envelope.type === 'workspace.reset' || envelope.type === 'workspace.rename')) {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }
        if (envelope.expectedEpoch !== workspace.epoch) throw new AuthorityError('STALE_EPOCH');
        const currentContext = actorContext(workspace, member, now);
        let currentProjection: DomainState;
        try {
          currentProjection = projectDomain(workspace.domainState, currentContext);
        } catch (error) {
          if (error instanceof DomainError) throw mapDomainError(error);
          throw error;
        }
        const currentView = this.toWorkspaceView(workspace, member, currentProjection, await transaction.listMembers());
        // Layout uses its own CAS and current node whitelist in the domain. A game
        // action must not make an unrelated drag stale; epoch and membership still apply.
        if (envelope.type !== 'canvas.layout' && currentView.revision !== envelope.expectedRevision) throw new AuthorityError('STALE_REVISION');
        if (envelope.type === 'workspace.reset') {
          if (!isEmptyPayload(envelope.payload)) throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
          return this.resetWorkspace(transaction, workspace, member, session, envelope, requestHash, now);
        }
        if (envelope.type === 'workspace.rename') {
          const parsed = renamePayloadSchema.safeParse(envelope.payload);
          const title = parsed.success ? normalizeWorkspaceTitle(parsed.data.title) : null;
          if (title === null) throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
          return this.renameWorkspace(transaction, workspace, member, session, envelope, requestHash, title, now);
        }
        if (envelope.type !== 'teaching.setRepresentation') assertIdentityFieldsAbsent(envelope.payload);
        if (envelope.type === 'teaching.answer' && member.role !== 'learner') throw new AuthorityError('ROLE_FORBIDDEN');
        if (envelope.type.startsWith('teaching.') && envelope.type !== 'teaching.answer' && member.role !== 'teacher') {
          throw new AuthorityError('ROLE_FORBIDDEN');
        }

        const context = currentContext;
        if (envelope.type === 'evolve.activate') await this.verifyActivationApproval(transaction, workspace, context);
        let decision;
        try {
          decision = decideDomain(workspace.domainState, { type: envelope.type, payload: envelope.payload }, context);
        } catch (error) {
          if (error instanceof DomainError) throw mapDomainError(error);
          throw error;
        }
        return this.commitDecision(transaction, workspace, member, session, envelope, requestHash, decision, context, now);
      });
    } catch (error) {
      throw this.storageError(error);
    }
    this.onWorkspaceChanged(ack.workspace.id, ack.workspace.epoch);
    return ack;
  }

  private async validateTeachingTarget(
    transaction: import('./repository.js').WorkspaceTransaction,
    payload: unknown,
  ): Promise<void> {
    if (!isRecord(payload) || typeof payload.actorId !== 'string') throw new AuthorityError('INVALID_COMMAND_PAYLOAD');
    const target = await transaction.getMember(payload.actorId);
    if (!target || target.revokedAt !== null || target.role !== 'learner'
        || (target.seat !== 'learner-1' && target.seat !== 'learner-2')) {
      throw new AuthorityError('TEACHING_TARGET_NOT_ACTIVE_LEARNER');
    }
  }

  private commandRequestHash(envelope: CommandEnvelope): string {
    return hashValue({
      type: envelope.type,
      payload: envelope.payload,
      expectedRevision: envelope.expectedRevision,
      expectedEpoch: envelope.expectedEpoch,
    });
  }

  private trustedRequestHash(envelope: CommandEnvelope, requestFingerprint: string): string {
    return hashValue({
      type: envelope.type,
      expectedRevision: envelope.expectedRevision,
      expectedEpoch: envelope.expectedEpoch,
      requestFingerprint,
    });
  }

  private async verifyActivationApproval(
    transaction: import('./repository.js').WorkspaceTransaction,
    workspace: StoredWorkspace,
    context: ActorContext,
  ): Promise<void> {
    const candidate = workspace.domainState.candidate;
    const approval = candidate?.approval;
    if (!candidate || !approval) throw new AuthorityError('APPROVAL_REQUIRED');
    const persisted = await transaction.getApproval(approval.id, workspace.epoch);
    if (!persisted) throw new AuthorityError('APPROVAL_REQUIRED');
    if (persisted.revoked || approval.revoked) throw new AuthorityError('APPROVAL_REVOKED');
    if (persisted.expiresAt <= context.now || approval.expiresAt <= context.now) throw new AuthorityError('APPROVAL_EXPIRED');
    if (persisted.actorId !== approval.actorId || persisted.candidateHash !== candidate.hash
        || persisted.candidateHash !== approval.candidateHash || persisted.proofHash !== approval.proofHash
        || persisted.proofHash !== candidate.proof?.hash || approval.epoch !== workspace.epoch) {
      throw new AuthorityError('APPROVAL_MISMATCH');
    }
    const approvingMember = await transaction.getMember(approval.actorId);
    if (!approvingMember || approvingMember.revokedAt !== null
        || approvingMember.role !== primaryRole(workspace.kind)
        || workspace.ownerActorId !== approvingMember.actorId) {
      throw new AuthorityError('APPROVER_NOT_AUTHORIZED');
    }
  }

  private async commitDecision(
    transaction: import('./repository.js').WorkspaceTransaction,
    workspace: StoredWorkspace,
    member: StoredMember,
    session: AuthenticatedSession,
    envelope: CommandEnvelope,
    requestHash: string,
    decision: { state: DomainState; label: string },
    context: ActorContext,
    now: number,
  ): Promise<CommandAck> {
    const nextWorkspace: StoredWorkspace = {
      ...workspace,
      revision: workspace.revision + 1,
      domainState: decision.state,
      stateHash: hashValue(decision.state),
    };
    const nextContext = actorContext(nextWorkspace, member, now);
    const projected = projectDomain(decision.state, nextContext);
    const members = await transaction.listMembers();
    const view = this.toWorkspaceView(nextWorkspace, member, projected, members);
    const ack: CommandAck = { ok: true, commandId: envelope.commandId, duplicate: false, workspace: view };
    const eventId = randomId();
    let eventPayload: unknown = envelope.payload;
    if (envelope.type === 'table.import'
        && workspace.domainState.kind === 'table' && decision.state.kind === 'table') {
      const previousSources = workspace.domainState.sources;
      const source = decision.state.sources.find((item) => !previousSources.some((prior) => prior.id === item.id));
      eventPayload = source
        ? { sourceId: source.id, filename: source.filename, sha256: source.sha256 }
        : { redacted: true };
    }
    const eventData = {
      type: envelope.type,
      payload: eventPayload,
      label: decision.label,
      beforeRevision: String(workspace.revision),
      afterRevision: String(nextWorkspace.revision),
    };
    await transaction.commitCommand({
      workspace: nextWorkspace,
      command: {
        workspaceId: workspace.id,
        epoch: workspace.epoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        payloadHash: requestHash,
        response: ack,
        eventId,
        createdAt: now,
      },
      event: {
        eventId,
        workspaceId: workspace.id,
        epoch: workspace.epoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        eventType: envelope.type,
        eventData,
        createdAt: now,
      },
      outboxId: randomId(),
    });
    return ack;
  }

  private async renameWorkspace(
    transaction: import('./repository.js').WorkspaceTransaction,
    workspace: StoredWorkspace,
    member: StoredMember,
    session: AuthenticatedSession,
    envelope: CommandEnvelope,
    requestHash: string,
    title: string,
    now: number,
  ): Promise<CommandAck> {
    if (workspace.ownerActorId !== session.record.actorId || member.role !== primaryRole(workspace.kind)) {
      throw new AuthorityError('ROLE_FORBIDDEN');
    }
    // Only the name changes; table data, rules and the epoch stay as they are.
    const nextWorkspace: StoredWorkspace = { ...workspace, title, revision: workspace.revision + 1 };
    const context = actorContext(nextWorkspace, member, now);
    const projected = projectDomain(nextWorkspace.domainState, context);
    const view = this.toWorkspaceView(nextWorkspace, member, projected, await transaction.listMembers());
    const ack: CommandAck = { ok: true, commandId: envelope.commandId, duplicate: false, workspace: view };
    const eventId = randomId();
    await transaction.commitCommand({
      workspace: nextWorkspace,
      command: {
        workspaceId: workspace.id,
        epoch: workspace.epoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        payloadHash: requestHash,
        response: ack,
        eventId,
        createdAt: now,
      },
      event: {
        eventId,
        workspaceId: workspace.id,
        epoch: workspace.epoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        eventType: 'workspace.rename',
        eventData: {
          type: 'workspace.rename',
          payload: { title },
          label: 'Table renamed.',
          beforeRevision: String(workspace.revision),
          afterRevision: String(nextWorkspace.revision),
        },
        createdAt: now,
      },
      outboxId: randomId(),
    });
    return ack;
  }

  private async resetWorkspace(
    transaction: import('./repository.js').WorkspaceTransaction,
    workspace: StoredWorkspace,
    member: StoredMember,
    session: AuthenticatedSession,
    envelope: CommandEnvelope,
    requestHash: string,
    now: number,
  ): Promise<CommandAck> {
    if (workspace.ownerActorId !== session.record.actorId || member.role !== primaryRole(workspace.kind)) {
      throw new AuthorityError('ROLE_FORBIDDEN');
    }
    const nextEpoch = workspace.epoch + 1;
    const context: ActorContext = {
      ...actorContext(workspace, member, now),
      epoch: nextEpoch,
    };
    const state = createDomain(workspace.kind, context);
    const resetWorkspace: StoredWorkspace = {
      ...workspace,
      epoch: nextEpoch,
      revision: 1,
      projectionSalt: randomToken(),
      domainState: state,
      stateHash: hashValue(state),
    };
    const resetContext = actorContext(resetWorkspace, member, now);
    const projected = projectDomain(state, resetContext);
    const members = [member];
    const view = this.toWorkspaceView(resetWorkspace, member, projected, members);
    const ack: CommandAck = { ok: true, commandId: envelope.commandId, duplicate: false, workspace: view };
    const eventId = randomId();
    const eventData = {
      type: 'workspace.reset',
      payload: {},
      label: 'Workspace reset to the current sample seed.',
      beforeEpoch: workspace.epoch,
      afterEpoch: nextEpoch,
    };
    await transaction.commitCommand({
      workspace: resetWorkspace,
      resetOwner: { ...member, createdAt: now, revokedAt: null },
      command: {
        workspaceId: workspace.id,
        epoch: workspace.epoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        payloadHash: requestHash,
        response: ack,
        eventId,
        createdAt: now,
      },
      event: {
        eventId,
        workspaceId: workspace.id,
        epoch: nextEpoch,
        actorId: session.record.actorId,
        commandId: envelope.commandId,
        eventType: 'workspace.reset',
        eventData,
        createdAt: now,
      },
      outboxId: randomId(),
      resetSessionTokenHash: session.record.tokenHash,
    });
    return ack;
  }

  private toWorkspaceView(workspace: StoredWorkspace, member: StoredMember, domain: DomainState, members: StoredMember[]): WorkspaceView {
    const projection = {
      id: workspace.id,
      title: workspace.title,
      kind: workspace.kind,
      epoch: workspace.epoch,
      actor: publicMember(member),
      members: members.map(publicMember),
      domain,
      createdAt: workspace.createdAt,
      expiresAt: workspace.expiresAt,
    };
    // Geometry is independently revisioned. Moving a card cannot invalidate an
    // action, rule review, or AI proposal for otherwise unchanged table data.
    const revisionDomain = { ...domain };
    if (revisionDomain.kind === 'table') delete revisionDomain.canvasLayout;
    const revision = keyedSha256(workspace.projectionSalt, canonicalJson({
      purpose: 'tabletop-r1-projection-revision-v1',
      actorId: member.actorId,
      workspaceId: workspace.id,
      epoch: workspace.epoch,
      projection: { ...projection, domain: revisionDomain },
    }));
    return { ...projection, revision };
  }

  private async refreshName(session: AuthenticatedSession, name: string): Promise<AuthenticatedSession> {
    const record = await this.repository.touchSession(session.record.tokenHash, this.now(), name);
    if (!record) throw new AuthorityError('SESSION_EXPIRED');
    return { record, csrfToken: session.csrfToken, expiresAt: expiresAt(record) };
  }

  private sessionCookie(token: string, session: SessionRecord): string {
    const maxAge = Math.max(0, Math.floor((session.hardExpiresAt - this.now()) / 1000));
    const secure = this.secureCookies ? '; Secure' : '';
    return `${SESSION_COOKIE_NAME}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure}`;
  }

  private storageError(error: unknown): AuthorityError {
    if (error instanceof AuthorityError) return error;
    if (error instanceof DomainError) return mapDomainError(error);
    const message = error instanceof Error ? error.message : '';
    const known = new Set([
      'WORKSPACE_NOT_FOUND', 'SESSION_ALREADY_BOUND', 'ROOM_LIMIT_REACHED', 'MEMBER_LIMIT_REACHED',
      'INVITE_INVALID', 'INVITE_ALREADY_USED', 'INVITE_EXPIRED', 'INVITE_SEAT_OCCUPIED', 'STALE_EPOCH',
      'MEMBERSHIP_REVOKED', 'SESSION_EXPIRED', 'SESSION_REQUIRED', 'SESSION_ROTATION_INVALID',
    ]);
    if (known.has(message)) return new AuthorityError(message);
    if (isRecord(error) && error.code === '23505') return new AuthorityError('SEAT_UNAVAILABLE');
    if (message === 'DATABASE_SCHEMA_UNAVAILABLE') return new AuthorityError(message);
    return new AuthorityError('DATABASE_UNAVAILABLE', 'The workspace could not be committed.', 503);
  }
}

function commandAllowed(kind: CaseKind, type: string, trustedOperation: 'artifact-import' | null): boolean {
  if (type === 'workspace.reset' || type === 'workspace.rename') return true;
  if (type === 'invoice.import') return trustedOperation === 'artifact-import' && kind === 'invoice';
  return publicCommands[kind].has(type);
}

function isEmptyPayload(payload: unknown): boolean {
  const result = emptyPayloadSchema.safeParse(payload);
  return result.success;
}


