import type {
  ActorContext,
  CaseKind,
  CommandAck,
  DomainState,
  Member,
  Role,
  Seat,
  WorkspaceView,
} from '../src/tabletop/shared/contracts.js';
import { createDomain } from '../src/tabletop/domain/index.js';
import type { SqlDatabase, SqlExecutor } from './database.js';
import { hashValue, isRecord, parseJsonValue, readNumber, readString, randomId, randomToken } from './codec.js';
import { AuthorityError } from './errors.js';
import {
  MAX_ACTIVE_WORKSPACES,
  MAX_EXPIRY_SWEEP_BATCH,
  MAX_MEMBERS_PER_WORKSPACE,
  DATABASE_SCHEMA_VERSION,
  SCHEMA_VERSION,
  SESSION_IDLE_TTL_MS,
} from './limits.js';

export interface SessionRecord {
  tokenHash: string;
  csrfHash: string;
  actorId: string;
  name: string;
  createdAt: number;
  lastSeenAt: number;
  hardExpiresAt: number;
  revokedAt: number | null;
  workspaceId: string | null;
  rotatedToTokenHash: string | null;
  rotationTicketHash: string | null;
}

export interface StoredMember extends Member {
  createdAt: number;
  revokedAt: number | null;
}

export interface StoredWorkspace {
  id: string;
  title: string;
  kind: CaseKind;
  ownerActorId: string;
  epoch: number;
  revision: number;
  projectionSalt: string;
  domainState: DomainState;
  stateHash: string;
  schemaVersion: number;
  createdAt: number;
  expiresAt: number;
}

export interface InvitationRecord {
  ticketHash: string;
  workspaceId: string;
  epoch: number;
  role: 'learner' | 'player' | 'participant';
  seat: Seat;
  createdBy: string;
  createdAt: number;
  expiresAt: number;
  redeemedAt: number | null;
  redeemedBy: string | null;
  revokedAt: number | null;
}

export interface StoredCommand {
  workspaceId: string;
  epoch: number;
  actorId: string;
  commandId: string;
  payloadHash: string;
  response: CommandAck;
  eventId: string;
  createdAt: number;
}

export interface StoredEvent {
  eventId: string;
  workspaceId: string;
  epoch: number;
  actorId: string;
  commandId: string;
  eventType: string;
  eventData: Record<string, unknown>;
  createdAt: number;
}

export interface WorkspaceReference {
  id: string;
  title: string;
  kind: CaseKind;
  role: Role;
}

export interface WorkspaceCreation {
  workspace: StoredWorkspace;
  owner: StoredMember;
  sessionTokenHash: string;
}

export interface PendingArtifactCleanup {
  workspaceId: string;
  epoch: number;
  objectKey: string;
  requestedAt: number;
}

export interface CommandCommit {
  workspace: StoredWorkspace;
  command: StoredCommand;
  event: StoredEvent;
  outboxId: string;
  resetOwner?: StoredMember;
  resetSessionTokenHash?: string;
}

export interface ModelJobCommitGuard {
  jobId: string;
  workspaceId: string;
  epoch: number;
  actorId: string;
  commandId: string;
  expectedRevision: string;
  proposalHash: string;
}

export interface WorkspaceTransaction {
  readonly workspace: StoredWorkspace;
  getMember(actorId: string, epoch?: number): Promise<StoredMember | null>;
  listMembers(epoch?: number): Promise<StoredMember[]>;
  findCommand(actorId: string, commandId: string, epoch: number): Promise<StoredCommand | null>;
  assertModelJobCommitting(guard: ModelJobCommitGuard): Promise<void>;
  countMembers(epoch?: number): Promise<number>;
  hasActiveInvitation(seat: Seat, now: number, epoch?: number): Promise<boolean>;
  revokeOutstandingInvitations(seat: Seat, now: number): Promise<void>;
  getApproval(
    approvalId: string,
    epoch: number,
  ): Promise<{ actorId: string; candidateHash: string; proofHash: string; expiresAt: number; revoked: boolean } | null>;
  insertInvitation(invitation: InvitationRecord): Promise<void>;
  commitCommand(commit: CommandCommit): Promise<void>;
}

export interface RedeemInvitationInput {
  ticketHash: string;
  sessionTokenHash: string;
  nextSession: SessionRecord;
  now: number;
}

export interface RedeemedInvitation {
  workspace: StoredWorkspace;
  member: StoredMember;
  session: SessionRecord;
  replay: boolean;
}

export interface WorkspaceRepository {
  close(): Promise<void>;
  isReady(): Promise<void>;
  expireWorkspaces(now: number, limit?: number): Promise<number>;
  listPendingArtifactCleanup(limit?: number): Promise<PendingArtifactCleanup[]>;
  completeArtifactCleanup(request: PendingArtifactCleanup): Promise<void>;
  createSession(session: SessionRecord): Promise<void>;
  getSession(tokenHash: string): Promise<SessionRecord | null>;
  getRotatedSession(tokenHash: string, ticketHash: string): Promise<SessionRecord | null>;
  touchSession(tokenHash: string, now: number, name?: string): Promise<SessionRecord | null>;
  listWorkspaceReferences(actorId: string, now: number): Promise<WorkspaceReference[]>;
  createWorkspace(creation: WorkspaceCreation, now: number): Promise<void>;
  getWorkspace(workspaceId: string): Promise<StoredWorkspace | null>;
  getMember(workspaceId: string, actorId: string): Promise<StoredMember | null>;
  getInvitation(ticketHash: string): Promise<InvitationRecord | null>;
  createInvitation(invitation: InvitationRecord, now: number): Promise<void>;
  redeemInvitation(input: RedeemInvitationInput): Promise<RedeemedInvitation>;
  withWorkspaceTransaction<T>(
    workspaceId: string,
    operation: (transaction: WorkspaceTransaction) => Promise<T>,
  ): Promise<T>;
}

interface WorkspaceRow extends Record<string, unknown> {
  id: unknown;
  title: unknown;
  kind: unknown;
  owner_actor_id: unknown;
  epoch: unknown;
  revision: unknown;
  projection_salt: unknown;
  domain_state: unknown;
  state_hash: unknown;
  schema_version: unknown;
  created_at: unknown;
  expires_at: unknown;
}

interface SessionRow extends Record<string, unknown> {
  token_hash: unknown;
  csrf_hash: unknown;
  actor_id: unknown;
  actor_name: unknown;
  created_at: unknown;
  last_seen_at: unknown;
  hard_expires_at: unknown;
  revoked_at: unknown;
  workspace_id: unknown;
  rotated_to_token_hash: unknown;
  rotation_ticket_hash: unknown;
}

interface MemberRow extends Record<string, unknown> {
  workspace_id: unknown;
  epoch: unknown;
  actor_id: unknown;
  actor_name: unknown;
  role: unknown;
  seat: unknown;
  created_at: unknown;
  revoked_at: unknown;
}

interface InvitationRow extends Record<string, unknown> {
  ticket_hash: unknown;
  workspace_id: unknown;
  epoch: unknown;
  role: unknown;
  seat: unknown;
  created_by: unknown;
  created_at: unknown;
  expires_at: unknown;
  redeemed_at: unknown;
  redeemed_by: unknown;
  revoked_at: unknown;
}

interface CommandRow extends Record<string, unknown> {
  workspace_id: unknown;
  epoch: unknown;
  actor_id: unknown;
  command_id: unknown;
  payload_hash: unknown;
  response: unknown;
  event_id: unknown;
  created_at: unknown;
}

interface ExpiringWorkspaceRow extends WorkspaceRow {
  purged_at: unknown;
}

const workspaceColumns = `id, title, kind, owner_actor_id, epoch, revision, projection_salt, domain_state,
  state_hash, schema_version, created_at, expires_at`;
const objectKeyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function mapKind(value: unknown): CaseKind {
  if (value === 'invoice' || value === 'teaching' || value === 'encounter' || value === 'table') return value;
  throw new Error('DATABASE_FIELD_INVALID:kind');
}

function mapRole(value: unknown): Role {
  if (value === 'owner' || value === 'teacher' || value === 'learner' || value === 'dm' || value === 'player' || value === 'participant') return value;
  throw new Error('DATABASE_FIELD_INVALID:role');
}

function mapSeat(value: unknown): Seat | undefined {
  if (value === null || value === undefined) return undefined;
  if (value === 'learner-1' || value === 'learner-2' || value === 'mira' || value === 'pip'
      || value === 'member-1' || value === 'member-2' || value === 'member-3' || value === 'member-4'
      || value === 'member-5' || value === 'member-6' || value === 'member-7') return value;
  throw new Error('DATABASE_FIELD_INVALID:seat');
}

function mapNullableNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : readNumber(value, field);
}

function mapWorkspace(row: WorkspaceRow): StoredWorkspace {
  const state = parseJsonValue(row.domain_state);
  if (!isRecord(state) || state.kind !== row.kind) throw new Error('DATABASE_DOMAIN_STATE_INVALID');
  return {
    id: readString(row.id, 'id'),
    title: readString(row.title, 'title'),
    kind: mapKind(row.kind),
    ownerActorId: readString(row.owner_actor_id, 'owner_actor_id'),
    epoch: readNumber(row.epoch, 'epoch'),
    revision: readNumber(row.revision, 'revision'),
    projectionSalt: readString(row.projection_salt, 'projection_salt'),
    domainState: state as unknown as DomainState,
    stateHash: readString(row.state_hash, 'state_hash'),
    schemaVersion: readNumber(row.schema_version, 'schema_version'),
    createdAt: readNumber(row.created_at, 'created_at'),
    expiresAt: readNumber(row.expires_at, 'expires_at'),
  };
}

function mapSession(row: SessionRow): SessionRecord {
  return {
    tokenHash: readString(row.token_hash, 'token_hash'),
    csrfHash: readString(row.csrf_hash, 'csrf_hash'),
    actorId: readString(row.actor_id, 'actor_id'),
    name: readString(row.actor_name, 'actor_name'),
    createdAt: readNumber(row.created_at, 'created_at'),
    lastSeenAt: readNumber(row.last_seen_at, 'last_seen_at'),
    hardExpiresAt: readNumber(row.hard_expires_at, 'hard_expires_at'),
    revokedAt: mapNullableNumber(row.revoked_at, 'revoked_at'),
    workspaceId: row.workspace_id === null || row.workspace_id === undefined ? null : readString(row.workspace_id, 'workspace_id'),
    rotatedToTokenHash: row.rotated_to_token_hash === null || row.rotated_to_token_hash === undefined
      ? null
      : readString(row.rotated_to_token_hash, 'rotated_to_token_hash'),
    rotationTicketHash: row.rotation_ticket_hash === null || row.rotation_ticket_hash === undefined
      ? null
      : readString(row.rotation_ticket_hash, 'rotation_ticket_hash'),
  };
}

function mapMember(row: MemberRow): StoredMember {
  return {
    actorId: readString(row.actor_id, 'actor_id'),
    name: readString(row.actor_name, 'actor_name'),
    role: mapRole(row.role),
    seat: mapSeat(row.seat),
    createdAt: readNumber(row.created_at, 'created_at'),
    revokedAt: mapNullableNumber(row.revoked_at, 'revoked_at'),
  };
}

function mapInvitation(row: InvitationRow): InvitationRecord {
  const role = mapRole(row.role);
  const seat = mapSeat(row.seat);
  if ((role !== 'learner' && role !== 'player' && role !== 'participant') || seat === undefined) {
    throw new Error('DATABASE_INVITATION_INVALID');
  }
  return {
    ticketHash: readString(row.ticket_hash, 'ticket_hash'),
    workspaceId: readString(row.workspace_id, 'workspace_id'),
    epoch: readNumber(row.epoch, 'epoch'),
    role,
    seat,
    createdBy: readString(row.created_by, 'created_by'),
    createdAt: readNumber(row.created_at, 'created_at'),
    expiresAt: readNumber(row.expires_at, 'expires_at'),
    redeemedAt: mapNullableNumber(row.redeemed_at, 'redeemed_at'),
    redeemedBy: row.redeemed_by === null || row.redeemed_by === undefined ? null : readString(row.redeemed_by, 'redeemed_by'),
    revokedAt: mapNullableNumber(row.revoked_at, 'revoked_at'),
  };
}

function mapCommand(row: CommandRow): StoredCommand {
  const response = parseJsonValue(row.response);
  if (!isRecord(response) || response.ok !== true) throw new Error('DATABASE_COMMAND_RESPONSE_INVALID');
  return {
    workspaceId: readString(row.workspace_id, 'workspace_id'),
    epoch: readNumber(row.epoch, 'epoch'),
    actorId: readString(row.actor_id, 'actor_id'),
    commandId: readString(row.command_id, 'command_id'),
    payloadHash: readString(row.payload_hash, 'payload_hash'),
    response: response as unknown as CommandAck,
    eventId: readString(row.event_id, 'event_id'),
    createdAt: readNumber(row.created_at, 'created_at'),
  };
}

async function selectWorkspace(executor: SqlExecutor, workspaceId: string, lock = false): Promise<StoredWorkspace | null> {
  const result = await executor.query<WorkspaceRow>(
    `SELECT ${workspaceColumns} FROM workspaces WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
    [workspaceId],
  );
  return result.rows[0] ? mapWorkspace(result.rows[0]) : null;
}

async function insertSession(executor: SqlExecutor, session: SessionRecord): Promise<void> {
  await executor.query(
    `INSERT INTO sessions
      (token_hash, csrf_hash, actor_id, actor_name, created_at, last_seen_at, hard_expires_at,
       revoked_at, workspace_id, rotated_to_token_hash, rotation_ticket_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [session.tokenHash, session.csrfHash, session.actorId, session.name, session.createdAt, session.lastSeenAt,
      session.hardExpiresAt, session.revokedAt, session.workspaceId, session.rotatedToTokenHash, session.rotationTicketHash],
  );
}

export class SqlWorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly database: SqlDatabase) {}

  get sqlDatabase(): SqlDatabase {
    return this.database;
  }

  async close(): Promise<void> {
    await this.database.close();
  }

  async isReady(): Promise<void> {
    await this.database.ping();
    const result = await this.database.query<{ version: number }>(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    if (result.rows[0]?.version !== DATABASE_SCHEMA_VERSION) throw new Error('DATABASE_SCHEMA_UNAVAILABLE');
  }

  async expireWorkspaces(now: number, limit = MAX_EXPIRY_SWEEP_BATCH): Promise<number> {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('EXPIRY_SWEEP_TIME_INVALID');
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_EXPIRY_SWEEP_BATCH) {
      throw new Error('EXPIRY_SWEEP_LIMIT_INVALID');
    }
    return this.database.transaction(async (transaction) => {
      const selected = await transaction.query<ExpiringWorkspaceRow>(
        `SELECT ${workspaceColumns}, purged_at FROM workspaces
         WHERE expires_at <= $1 AND purged_at IS NULL
         ORDER BY expires_at, id LIMIT $2 FOR UPDATE SKIP LOCKED`,
        [now, limit],
      );
      for (const row of selected.rows) {
        const workspace = mapWorkspace(row);
        const artifacts = workspace.domainState.kind === 'invoice' ? workspace.domainState.sources : [];
        for (const artifact of artifacts) {
          if (!objectKeyPattern.test(artifact.id)) continue;
          await transaction.query(
            `INSERT INTO artifact_cleanup (workspace_id, epoch, object_key, requested_at)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (workspace_id, epoch, object_key) DO NOTHING`,
            [workspace.id, workspace.epoch, artifact.id, now],
          );
        }

        await transaction.query('DELETE FROM outbox WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM commands WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM events WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM snapshots WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM memberships WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM invitations WHERE workspace_id = $1', [workspace.id]);
        await transaction.query('DELETE FROM approvals WHERE workspace_id = $1', [workspace.id]);
        await transaction.query(
          `UPDATE model_jobs SET revoked_at = COALESCE(revoked_at, $2), status = 'revoked', data = '{}'::jsonb
           WHERE workspace_id = $1`,
          [workspace.id, now],
        );
        await transaction.query(
          `DELETE FROM sessions WHERE workspace_id = $1 AND actor_id <> $2`,
          [workspace.id, workspace.ownerActorId],
        );
        await transaction.query(
          `UPDATE sessions SET workspace_id = NULL
           WHERE workspace_id = $1 AND actor_id = $2 AND revoked_at IS NULL`,
          [workspace.id, workspace.ownerActorId],
        );

        const role = workspace.kind === 'invoice' || workspace.kind === 'table' ? 'owner'
          : workspace.kind === 'teaching' ? 'teacher' : 'dm';
        const scrubbedContext: ActorContext = {
          actorId: 'expired',
          name: 'Expired',
          role,
          workspaceId: workspace.id,
          epoch: workspace.epoch + 1,
          now,
          hash: hashValue,
        };
        const scrubbedState = createDomain(workspace.kind, scrubbedContext);
        const stateHash = hashValue(scrubbedState);
        const scrubbedWorkspace: StoredWorkspace = {
          ...workspace,
          title: 'Expired workspace',
          ownerActorId: 'expired',
          epoch: workspace.epoch + 1,
          revision: 1,
          projectionSalt: randomToken(),
          domainState: scrubbedState,
          stateHash,
          createdAt: now,
        };
        await transaction.query(
          `UPDATE workspaces SET title = $2, owner_actor_id = $3, epoch = $4, revision = $5,
            projection_salt = $6, domain_state = $7::jsonb, state_hash = $8, schema_version = $9,
            created_at = $10, purged_at = $11
           WHERE id = $1 AND purged_at IS NULL`,
          [scrubbedWorkspace.id, scrubbedWorkspace.title, scrubbedWorkspace.ownerActorId,
            scrubbedWorkspace.epoch, scrubbedWorkspace.revision, scrubbedWorkspace.projectionSalt,
            JSON.stringify(scrubbedWorkspace.domainState), scrubbedWorkspace.stateHash,
            scrubbedWorkspace.schemaVersion, scrubbedWorkspace.createdAt, now],
        );
        await transaction.query(
          `INSERT INTO snapshots (workspace_id, epoch, revision, schema_version, state, state_hash, created_at)
           VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
          [scrubbedWorkspace.id, scrubbedWorkspace.epoch, scrubbedWorkspace.revision,
            scrubbedWorkspace.schemaVersion, JSON.stringify(scrubbedWorkspace.domainState),
            scrubbedWorkspace.stateHash, now],
        );
      }
      return selected.rows.length;
    });
  }

  async listPendingArtifactCleanup(limit = 100): Promise<PendingArtifactCleanup[]> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('CLEANUP_LIMIT_INVALID');
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT workspace_id, epoch, object_key, requested_at FROM artifact_cleanup
       ORDER BY requested_at, workspace_id, epoch, object_key LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      workspaceId: readString(row.workspace_id, 'workspace_id'),
      epoch: readNumber(row.epoch, 'epoch'),
      objectKey: readString(row.object_key, 'object_key'),
      requestedAt: readNumber(row.requested_at, 'requested_at'),
    }));
  }

  async completeArtifactCleanup(request: PendingArtifactCleanup): Promise<void> {
    await this.database.query(
      `DELETE FROM artifact_cleanup
       WHERE workspace_id = $1 AND epoch = $2 AND object_key = $3 AND requested_at = $4`,
      [request.workspaceId, request.epoch, request.objectKey, request.requestedAt],
    );
  }

  async createSession(session: SessionRecord): Promise<void> {
    await insertSession(this.database, session);
  }

  async getSession(tokenHash: string): Promise<SessionRecord | null> {
    const result = await this.database.query<SessionRow>('SELECT * FROM sessions WHERE token_hash = $1', [tokenHash]);
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async getRotatedSession(tokenHash: string, ticketHash: string): Promise<SessionRecord | null> {
    const result = await this.database.query<SessionRow>(
      `SELECT * FROM sessions WHERE token_hash = $1 AND rotation_ticket_hash = $2 AND revoked_at IS NOT NULL`,
      [tokenHash, ticketHash],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async touchSession(tokenHash: string, now: number, name?: string): Promise<SessionRecord | null> {
    return this.database.transaction(async (transaction) => {
      const result = await transaction.query<SessionRow>(
        `UPDATE sessions SET last_seen_at = $2, actor_name = COALESCE($3, actor_name)
         WHERE token_hash = $1 AND revoked_at IS NULL AND hard_expires_at > $2
           AND last_seen_at + $4::bigint > $2 RETURNING *`,
        [tokenHash, now, name ?? null, SESSION_IDLE_TTL_MS],
      );
      const session = result.rows[0] ? mapSession(result.rows[0]) : null;
      if (session && name !== undefined && session.workspaceId) {
        await transaction.query(
          `UPDATE memberships SET actor_name = $3
           WHERE workspace_id = $1 AND epoch = (SELECT epoch FROM workspaces WHERE id = $1)
             AND actor_id = $2 AND revoked_at IS NULL`,
          [session.workspaceId, session.actorId, session.name],
        );
      }
      return session;
    });
  }

  async listWorkspaceReferences(actorId: string, now: number): Promise<WorkspaceReference[]> {
    const result = await this.database.query<Record<string, unknown>>(
      `SELECT w.id, w.title, w.kind, m.role
       FROM workspaces w
       JOIN memberships m ON m.workspace_id = w.id AND m.epoch = w.epoch
       WHERE m.actor_id = $1 AND m.revoked_at IS NULL AND w.expires_at > $2
       ORDER BY w.created_at DESC`,
      [actorId, now],
    );
    return result.rows.map((row) => ({
      id: readString(row.id, 'id'),
      title: readString(row.title, 'title'),
      kind: mapKind(row.kind),
      role: mapRole(row.role),
    }));
  }

  async createWorkspace(creation: WorkspaceCreation, now: number): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.query('SELECT singleton FROM authority_meta WHERE singleton = TRUE FOR UPDATE');
      const count = await transaction.query<{ room_count: number }>(
        'SELECT COUNT(*)::int AS room_count FROM workspaces WHERE expires_at > $1',
        [now],
      );
      if ((count.rows[0]?.room_count ?? 0) >= MAX_ACTIVE_WORKSPACES) throw new Error('ROOM_LIMIT_REACHED');
      await transaction.query(
        `INSERT INTO workspaces
          (id, title, kind, owner_actor_id, epoch, revision, projection_salt, domain_state, state_hash, schema_version, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12)`,
        [creation.workspace.id, creation.workspace.title, creation.workspace.kind, creation.workspace.ownerActorId,
          creation.workspace.epoch, creation.workspace.revision, creation.workspace.projectionSalt, JSON.stringify(creation.workspace.domainState),
          creation.workspace.stateHash, creation.workspace.schemaVersion, creation.workspace.createdAt, creation.workspace.expiresAt],
      );
      await transaction.query(
        `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [creation.workspace.id, creation.workspace.epoch, creation.owner.actorId, creation.owner.name,
          creation.owner.role, creation.owner.seat ?? null, now],
      );
      await transaction.query(
        `INSERT INTO snapshots (workspace_id, epoch, revision, schema_version, state, state_hash, created_at)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [creation.workspace.id, creation.workspace.epoch, creation.workspace.revision, creation.workspace.schemaVersion,
          JSON.stringify(creation.workspace.domainState), creation.workspace.stateHash, now],
      );
      const update = await transaction.query(
        `UPDATE sessions SET workspace_id = $2
         WHERE token_hash = $1 AND actor_id = $3 AND revoked_at IS NULL`,
        [creation.sessionTokenHash, creation.workspace.id, creation.owner.actorId],
      );
      if (update.rowCount !== 1) throw new Error('SESSION_ALREADY_BOUND');
    });
  }

  async getWorkspace(workspaceId: string): Promise<StoredWorkspace | null> {
    return selectWorkspace(this.database, workspaceId);
  }

  async getMember(workspaceId: string, actorId: string): Promise<StoredMember | null> {
    const workspace = await selectWorkspace(this.database, workspaceId);
    if (!workspace) return null;
    const result = await this.database.query<MemberRow>(
      `SELECT workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at
       FROM memberships WHERE workspace_id = $1 AND epoch = $2 AND actor_id = $3 AND revoked_at IS NULL`,
      [workspaceId, workspace.epoch, actorId],
    );
    return result.rows[0] ? mapMember(result.rows[0]) : null;
  }

  async getInvitation(ticketHash: string): Promise<InvitationRecord | null> {
    const result = await this.database.query<InvitationRow>(
      'SELECT * FROM invitations WHERE ticket_hash = $1',
      [ticketHash],
    );
    return result.rows[0] ? mapInvitation(result.rows[0]) : null;
  }

  async createInvitation(invitation: InvitationRecord, now: number): Promise<void> {
    await this.withWorkspaceTransaction(invitation.workspaceId, async (transaction) => {
      if (transaction.workspace.epoch !== invitation.epoch || transaction.workspace.expiresAt <= now) {
        throw new Error('STALE_EPOCH');
      }
      await transaction.insertInvitation(invitation);
    });
  }

  async redeemInvitation(input: RedeemInvitationInput): Promise<RedeemedInvitation> {
    return this.database.transaction(async (transaction) => {
      const inviteLocation = await transaction.query<{ workspace_id: unknown }>(
        'SELECT workspace_id FROM invitations WHERE ticket_hash = $1',
        [input.ticketHash],
      );
      const workspaceId = inviteLocation.rows[0]
        ? readString(inviteLocation.rows[0].workspace_id, 'workspace_id')
        : null;
      if (!workspaceId) throw new Error('INVITE_INVALID');
      const workspace = await selectWorkspace(transaction, workspaceId, true);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const inviteResult = await transaction.query<InvitationRow>(
        'SELECT * FROM invitations WHERE ticket_hash = $1 FOR UPDATE',
        [input.ticketHash],
      );
      const inviteRow = inviteResult.rows[0];
      if (!inviteRow) throw new Error('INVITE_INVALID');
      const invitation = mapInvitation(inviteRow);

      const sessionResult = await transaction.query<SessionRow>(
        'SELECT * FROM sessions WHERE token_hash = $1 FOR UPDATE',
        [input.sessionTokenHash],
      );
      const sessionRow = sessionResult.rows[0];
      if (!sessionRow) throw new Error('SESSION_REQUIRED');
      const existingSession = mapSession(sessionRow);

      if (invitation.revokedAt !== null || invitation.expiresAt <= input.now) throw new Error('INVITE_EXPIRED');

      if (invitation.redeemedAt !== null) {
        if (invitation.redeemedBy !== existingSession.actorId || existingSession.rotationTicketHash !== input.ticketHash) {
          throw new Error('INVITE_ALREADY_USED');
        }
        if (!existingSession.rotatedToTokenHash || existingSession.hardExpiresAt <= input.now) {
          throw new Error('SESSION_EXPIRED');
        }
        const next = await transaction.query<SessionRow>(
          'SELECT * FROM sessions WHERE token_hash = $1 AND revoked_at IS NULL',
          [existingSession.rotatedToTokenHash],
        );
        if (!next.rows[0]) throw new Error('SESSION_EXPIRED');
        const memberResult = await transaction.query<MemberRow>(
          `SELECT workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at
           FROM memberships WHERE workspace_id = $1 AND epoch = $2 AND actor_id = $3 AND revoked_at IS NULL`,
          [workspace.id, invitation.epoch, existingSession.actorId],
        );
        if (!memberResult.rows[0]) throw new Error('MEMBERSHIP_REVOKED');
        return {
          workspace,
          member: mapMember(memberResult.rows[0]),
          session: mapSession(next.rows[0]),
          replay: true,
        };
      }

      if (existingSession.revokedAt !== null) throw new Error('SESSION_EXPIRED');
      if (existingSession.workspaceId !== null) throw new Error('SESSION_ALREADY_BOUND');
      if (invitation.epoch !== workspace.epoch || workspace.expiresAt <= input.now) throw new Error('STALE_EPOCH');
      if (input.nextSession.actorId !== existingSession.actorId || input.nextSession.workspaceId !== workspace.id) {
        throw new Error('SESSION_ROTATION_INVALID');
      }

      const count = await transaction.query<{ member_count: number }>(
        `SELECT COUNT(*)::int AS member_count FROM memberships
         WHERE workspace_id = $1 AND epoch = $2 AND revoked_at IS NULL`,
        [workspace.id, workspace.epoch],
      );
      if ((count.rows[0]?.member_count ?? 0) >= MAX_MEMBERS_PER_WORKSPACE) throw new Error('MEMBER_LIMIT_REACHED');

      await transaction.query(
        `UPDATE sessions SET revoked_at = $2, rotated_to_token_hash = $3, rotation_ticket_hash = $4
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [input.sessionTokenHash, input.now, input.nextSession.tokenHash, input.ticketHash],
      );
      await insertSession(transaction, input.nextSession);
      await transaction.query(
        `UPDATE invitations SET redeemed_at = $2, redeemed_by = $3
         WHERE ticket_hash = $1 AND redeemed_at IS NULL AND revoked_at IS NULL`,
        [input.ticketHash, input.now, existingSession.actorId],
      );
      await transaction.query(
        `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
        [workspace.id, workspace.epoch, existingSession.actorId, existingSession.name,
          invitation.role, invitation.seat, input.now],
      );
      return {
        workspace,
        member: {
          actorId: existingSession.actorId,
          name: existingSession.name,
          role: invitation.role,
          seat: invitation.seat,
          createdAt: input.now,
          revokedAt: null,
        },
        session: input.nextSession,
        replay: false,
      };
    });
  }

  async withWorkspaceTransaction<T>(
    workspaceId: string,
    operation: (workspace: WorkspaceTransaction) => Promise<T>,
  ): Promise<T> {
    return this.database.transaction(async (transaction) => {
      const workspace = await selectWorkspace(transaction, workspaceId, true);
      if (!workspace) throw new Error('WORKSPACE_NOT_FOUND');

      const workspaceTransaction: WorkspaceTransaction = {
        workspace,
        async getMember(actorId, epoch = workspace.epoch): Promise<StoredMember | null> {
          const result = await transaction.query<MemberRow>(
            `SELECT workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at
             FROM memberships WHERE workspace_id = $1 AND epoch = $2 AND actor_id = $3`,
            [workspaceId, epoch, actorId],
          );
          return result.rows[0] ? mapMember(result.rows[0]) : null;
        },
        async listMembers(epoch = workspace.epoch): Promise<StoredMember[]> {
          const result = await transaction.query<MemberRow>(
            `SELECT workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at
             FROM memberships WHERE workspace_id = $1 AND epoch = $2 AND revoked_at IS NULL ORDER BY created_at`,
            [workspaceId, epoch],
          );
          return result.rows.map(mapMember);
        },
        async findCommand(actorId, commandId, epoch): Promise<StoredCommand | null> {
          const result = await transaction.query<CommandRow>(
            `SELECT workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at
             FROM commands WHERE workspace_id = $1 AND epoch = $2 AND actor_id = $3 AND command_id = $4`,
            [workspaceId, epoch, actorId, commandId],
          );
          return result.rows[0] ? mapCommand(result.rows[0]) : null;
        },
        async assertModelJobCommitting(guard): Promise<void> {
          if (guard.workspaceId !== workspaceId || guard.epoch !== workspace.epoch) {
            throw new AuthorityError('MODEL_JOB_NOT_COMMITTING', 'The proposal job is no longer active.', 409);
          }
          const result = await transaction.query<Record<string, unknown>>(
            `SELECT status, revoked_at, data FROM model_jobs
             WHERE id = $1 AND workspace_id = $2 AND epoch = $3 AND actor_id = $4 FOR UPDATE`,
            [guard.jobId, guard.workspaceId, guard.epoch, guard.actorId],
          );
          const row = result.rows[0];
          const data = row ? parseJsonValue(row.data) : null;
          if (!row || row.status !== 'committing' || row.revoked_at !== null || !isRecord(data)
              || data.commandId !== guard.commandId
              || data.expectedRevision !== guard.expectedRevision
              || data.expectedEpoch !== guard.epoch
              || data.proposalHash !== guard.proposalHash) {
            throw new AuthorityError('MODEL_JOB_NOT_COMMITTING', 'The proposal job is no longer active.', 409);
          }
        },
        async countMembers(epoch = workspace.epoch): Promise<number> {
          const result = await transaction.query<{ member_count: number }>(
            `SELECT COUNT(*)::int AS member_count FROM memberships
             WHERE workspace_id = $1 AND epoch = $2 AND revoked_at IS NULL`,
            [workspaceId, epoch],
          );
          return result.rows[0]?.member_count ?? 0;
        },
        async hasActiveInvitation(seat, now, epoch = workspace.epoch): Promise<boolean> {
          await transaction.query(
            `UPDATE invitations SET revoked_at = $3
             WHERE workspace_id = $1 AND epoch = $2 AND expires_at <= $3
               AND redeemed_at IS NULL AND revoked_at IS NULL`,
            [workspaceId, epoch, now],
          );
          const result = await transaction.query(
            `SELECT ticket_hash FROM invitations
             WHERE workspace_id = $1 AND epoch = $2 AND seat = $3
               AND expires_at > $4 AND redeemed_at IS NULL AND revoked_at IS NULL`,
            [workspaceId, epoch, seat, now],
          );
          return result.rows.length > 0;
        },
        async revokeOutstandingInvitations(seat, now): Promise<void> {
          await transaction.query(
            `UPDATE invitations SET revoked_at = $4
             WHERE workspace_id = $1 AND epoch = $2 AND seat = $3 AND expires_at > $4
               AND redeemed_at IS NULL AND revoked_at IS NULL`,
            [workspaceId, workspace.epoch, seat, now],
          );
        },
        async getApproval(approvalId, epoch): Promise<{ actorId: string; candidateHash: string; proofHash: string; expiresAt: number; revoked: boolean } | null> {
          const result = await transaction.query<Record<string, unknown>>(
            `SELECT approving_actor_id, candidate_hash, proof_hash, expires_at, revoked
             FROM approvals WHERE approval_id = $1 AND workspace_id = $2 AND epoch = $3`,
            [approvalId, workspaceId, epoch],
          );
          const row = result.rows[0];
          if (!row) return null;
          return {
            actorId: readString(row.approving_actor_id, 'approving_actor_id'),
            candidateHash: readString(row.candidate_hash, 'candidate_hash'),
            proofHash: readString(row.proof_hash, 'proof_hash'),
            expiresAt: readNumber(row.expires_at, 'expires_at'),
            revoked: row.revoked === true,
          };
        },
        async insertInvitation(invitation): Promise<void> {
          await transaction.query(
            `INSERT INTO invitations
              (ticket_hash, workspace_id, epoch, role, seat, created_by, created_at, expires_at, redeemed_at, redeemed_by, revoked_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL, NULL, NULL)`,
            [invitation.ticketHash, invitation.workspaceId, invitation.epoch, invitation.role, invitation.seat,
              invitation.createdBy, invitation.createdAt, invitation.expiresAt],
          );
        },
        async commitCommand(commit): Promise<void> {
          if (commit.workspace.id !== workspaceId) throw new Error('WORKSPACE_TRANSACTION_MISMATCH');
          if (commit.resetOwner) {
            const priorArtifacts = workspace.domainState.kind === 'invoice'
              ? workspace.domainState.sources
              : [];
            for (const artifact of priorArtifacts) {
              if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(artifact.id)) continue;
              await transaction.query(
                `INSERT INTO artifact_cleanup (workspace_id, epoch, object_key, requested_at)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (workspace_id, epoch, object_key) DO NOTHING`,
                [workspaceId, workspace.epoch, artifact.id, commit.event.createdAt],
              );
            }

            await transaction.query(
              `DELETE FROM outbox WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            await transaction.query(
              `DELETE FROM commands WHERE workspace_id = $1 AND epoch < $2
                 AND NOT (epoch = $3 AND actor_id = $4 AND command_id = $5)`,
              [workspaceId, commit.workspace.epoch, commit.command.epoch, commit.command.actorId, commit.command.commandId],
            );
            await transaction.query(
              `DELETE FROM events WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            await transaction.query(
              `DELETE FROM snapshots WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            await transaction.query(
              `DELETE FROM invitations WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            await transaction.query(
              `DELETE FROM approvals WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            await transaction.query(
              `UPDATE model_jobs SET revoked_at = COALESCE(revoked_at, $3), status = 'revoked', data = '{}'::jsonb
               WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch, commit.event.createdAt],
            );
            await transaction.query(
              `DELETE FROM memberships WHERE workspace_id = $1 AND epoch < $2`,
              [workspaceId, commit.workspace.epoch],
            );
            if (!commit.resetSessionTokenHash) throw new Error('RESET_SESSION_REQUIRED');
            await transaction.query(
              `DELETE FROM sessions
               WHERE workspace_id = $1 AND token_hash <> $2`,
              [workspaceId, commit.resetSessionTokenHash],
            );
            await transaction.query(
              `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
              [workspaceId, commit.workspace.epoch, commit.resetOwner.actorId, commit.resetOwner.name,
                commit.resetOwner.role, commit.resetOwner.seat ?? null, commit.resetOwner.createdAt],
            );
          }

          await transaction.query(
            `UPDATE workspaces SET title = $2, kind = $3, owner_actor_id = $4, epoch = $5,
              revision = $6, projection_salt = $7, domain_state = $8::jsonb, state_hash = $9, schema_version = $10,
              created_at = $11, expires_at = $12 WHERE id = $1`,
            [commit.workspace.id, commit.workspace.title, commit.workspace.kind, commit.workspace.ownerActorId,
              commit.workspace.epoch, commit.workspace.revision, commit.workspace.projectionSalt, JSON.stringify(commit.workspace.domainState),
              commit.workspace.stateHash, commit.workspace.schemaVersion, commit.workspace.createdAt, commit.workspace.expiresAt],
          );
          await transaction.query(
            `INSERT INTO snapshots (workspace_id, epoch, revision, schema_version, state, state_hash, created_at)
             VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
            [commit.workspace.id, commit.workspace.epoch, commit.workspace.revision, commit.workspace.schemaVersion,
              JSON.stringify(commit.workspace.domainState), commit.workspace.stateHash, commit.event.createdAt],
          );
          const seqResult = await transaction.query<{ next_sequence: number }>(
            `SELECT COALESCE(MAX(workspace_sequence), 0) + 1 AS next_sequence
             FROM events WHERE workspace_id = $1 AND epoch = $2`,
            [commit.event.workspaceId, commit.event.epoch],
          );
          const sequence = seqResult.rows[0]?.next_sequence ?? 1;
          await transaction.query(
            `INSERT INTO events
              (event_id, workspace_id, epoch, workspace_sequence, actor_id, command_id, event_type, event_data, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)`,
            [commit.event.eventId, commit.event.workspaceId, commit.event.epoch, sequence, commit.event.actorId,
              commit.event.commandId, commit.event.eventType, JSON.stringify(commit.event.eventData), commit.event.createdAt],
          );
          await transaction.query(
            `INSERT INTO commands (workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)`,
            [commit.command.workspaceId, commit.command.epoch, commit.command.actorId, commit.command.commandId,
              commit.command.payloadHash, JSON.stringify(commit.command.response), commit.command.eventId, commit.command.createdAt],
          );
          await transaction.query(
            `INSERT INTO outbox (outbox_id, workspace_id, epoch, event_id, created_at, delivered_at)
             VALUES ($1, $2, $3, $4, $5, NULL)`,
            [commit.outboxId, commit.event.workspaceId, commit.event.epoch, commit.event.eventId, commit.event.createdAt],
          );
          await syncApproval(transaction, commit.workspace, commit.event.createdAt);
        },
      };
      return operation(workspaceTransaction);
    });
  }
}

async function syncApproval(executor: SqlExecutor, workspace: StoredWorkspace, now: number): Promise<void> {
  const candidate = workspace.domainState.candidate;
  const approval = candidate?.approval;
  if (!approval) return;
  await executor.query(
    `INSERT INTO approvals
      (approval_id, workspace_id, epoch, approving_actor_id, candidate_hash, proof_hash, expires_at, revoked, approval_data, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
     ON CONFLICT (approval_id) DO UPDATE SET
       epoch = EXCLUDED.epoch, approving_actor_id = EXCLUDED.approving_actor_id,
       candidate_hash = EXCLUDED.candidate_hash, proof_hash = EXCLUDED.proof_hash,
       expires_at = EXCLUDED.expires_at, revoked = EXCLUDED.revoked,
       approval_data = EXCLUDED.approval_data, updated_at = EXCLUDED.updated_at`,
    [approval.id, workspace.id, workspace.epoch, approval.actorId, approval.candidateHash, approval.proofHash,
      approval.expiresAt, approval.revoked, JSON.stringify(approval), now],
  );
}
