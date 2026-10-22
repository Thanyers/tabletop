import type {
  ActorContext,
  CaseKind,
  CommandAck,
  DomainState,
  Role,
  Seat,
  WorkspaceView,
} from '../src/tabletop/shared/contracts.js';
import type {
  CommandCommit,
  InvitationRecord,
  ModelJobCommitGuard,
  PendingArtifactCleanup,
  RedeemInvitationInput,
  RedeemedInvitation,
  SessionRecord,
  StoredCommand,
  StoredEvent,
  StoredMember,
  StoredWorkspace,
  WorkspaceCreation,
  WorkspaceReference,
  WorkspaceRepository,
  WorkspaceTransaction,
} from '../server/repository.js';
import { hashValue, isRecord, parseJsonValue, readNumber, readString } from '../server/codec.js';
import { AuthorityError } from '../server/errors.js';
import { MAX_MEMBERS_PER_WORKSPACE } from '../server/limits.js';
import type { ModelFailureDetails, ModelJobProgress } from '../src/tabletop/shared/model-job-progress.js';

type SqlRow = Record<string, SqlStorageValue>;
type SqlBinding = SqlStorageValue;

export interface PendingRoomOutbox {
  outboxId: string;
  workspaceId: string;
  epoch: number;
}

export interface PendingDirectoryChange {
  id: number;
  actorId: string;
  epoch: number;
  active: boolean;
}

export interface RedeemedRoomInvitation {
  workspace: StoredWorkspace;
  member: StoredMember;
  replay: boolean;
}

export type RoomModelJobStatus = 'running' | 'committing' | 'completed' | 'failed' | 'revoked';

export interface RoomModelJob {
  id: string;
  workspaceId: string;
  epoch: number;
  actorId: string;
  status: RoomModelJobStatus;
  data: Record<string, unknown>;
  createdAt: number;
  revokedAt: number | null;
}

export interface ReserveRoomModelJobInput {
  id: string;
  workspaceId: string;
  epoch: number;
  actorId: string;
  commandId: string;
  expectedRevision: string;
  requestHash: string;
  now: number;
  kind?: 'table-assistant';
  prompt?: string;
}

export const MAX_TABLE_ASSISTANT_JOBS_PER_ROOM = 500;
const MAX_ACTIVE_TABLE_ASSISTANT_JOBS_PER_ROOM = 8;

const TABLES = [
  `CREATE TABLE IF NOT EXISTS room_identity (
    singleton INTEGER PRIMARY KEY CHECK(singleton = 1), room_id TEXT NOT NULL UNIQUE
  )`,
  `CREATE TABLE IF NOT EXISTS room_workspaces (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, kind TEXT NOT NULL, owner_actor_id TEXT NOT NULL,
    epoch INTEGER NOT NULL, revision INTEGER NOT NULL, projection_salt TEXT NOT NULL,
    domain_state TEXT NOT NULL, state_hash TEXT NOT NULL, schema_version INTEGER NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS room_memberships (
    workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_name TEXT NOT NULL,
    role TEXT NOT NULL, seat TEXT, created_at INTEGER NOT NULL, revoked_at INTEGER,
    PRIMARY KEY (workspace_id, epoch, actor_id)
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS room_active_seat_idx ON room_memberships(workspace_id, epoch, seat)
    WHERE seat IS NOT NULL AND revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS room_invitations (
    ticket_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, role TEXT NOT NULL,
    seat TEXT NOT NULL, created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL,
    redeemed_at INTEGER, redeemed_by TEXT, revoked_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS room_active_invite_seat_idx ON room_invitations(workspace_id, epoch, seat)
    WHERE redeemed_at IS NULL AND revoked_at IS NULL`,
  // F003-T3: one reusable link per table epoch; only its hash is stored.
  `CREATE TABLE IF NOT EXISTS room_invite_links (
    token_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, created_by TEXT NOT NULL,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS room_active_invite_link_idx ON room_invite_links(workspace_id, epoch)
    WHERE revoked_at IS NULL`,
  `CREATE TABLE IF NOT EXISTS room_snapshots (
    workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, revision INTEGER NOT NULL,
    schema_version INTEGER NOT NULL, state TEXT NOT NULL, state_hash TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY (workspace_id, epoch, revision)
  )`,
  `CREATE TABLE IF NOT EXISTS room_events (
    event_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, workspace_sequence INTEGER NOT NULL,
    actor_id TEXT NOT NULL, command_id TEXT NOT NULL, event_type TEXT NOT NULL, event_data TEXT NOT NULL,
    created_at INTEGER NOT NULL, UNIQUE(workspace_id, epoch, workspace_sequence)
  )`,
  `CREATE TABLE IF NOT EXISTS room_commands (
    workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, actor_id TEXT NOT NULL, command_id TEXT NOT NULL,
    payload_hash TEXT NOT NULL, response TEXT NOT NULL, event_id TEXT NOT NULL, created_at INTEGER NOT NULL,
    PRIMARY KEY(workspace_id, epoch, actor_id, command_id)
  )`,
  `CREATE TABLE IF NOT EXISTS room_outbox (
    outbox_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL,
    event_id TEXT NOT NULL, created_at INTEGER NOT NULL, delivered_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS room_outbox_pending_idx ON room_outbox(delivered_at, created_at)`,
  `CREATE TABLE IF NOT EXISTS room_artifact_cleanup (
    workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, object_key TEXT NOT NULL, requested_at INTEGER NOT NULL,
    PRIMARY KEY(workspace_id, epoch, object_key)
  )`,
  `CREATE TABLE IF NOT EXISTS room_approvals (
    approval_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL,
    approving_actor_id TEXT NOT NULL, candidate_hash TEXT NOT NULL, proof_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL, approval_data TEXT NOT NULL, updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS model_jobs (
    id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, actor_id TEXT NOT NULL,
    status TEXT NOT NULL, data TEXT NOT NULL, created_at INTEGER NOT NULL, revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS room_model_jobs_idx ON model_jobs(workspace_id, epoch, status)`,
  `CREATE TABLE IF NOT EXISTS room_directory_outbox (
    id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL, epoch INTEGER NOT NULL, active INTEGER NOT NULL
  )`,
] as const;

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function primaryRole(kind: CaseKind): Role {
  if (kind === 'invoice' || kind === 'table') return 'owner';
  return kind === 'teaching' ? 'teacher' : 'dm';
}

function isKind(value: unknown): value is CaseKind {
  return value === 'invoice' || value === 'teaching' || value === 'encounter' || value === 'table';
}

function isRole(value: unknown): value is Role {
  return value === 'owner' || value === 'teacher' || value === 'learner'
    || value === 'dm' || value === 'player' || value === 'participant';
}

function isSeat(value: unknown): value is Seat {
  return value === 'learner-1' || value === 'learner-2' || value === 'mira' || value === 'pip'
    || value === 'member-1' || value === 'member-2' || value === 'member-3' || value === 'member-4'
    || value === 'member-5' || value === 'member-6' || value === 'member-7';
}

function nullableNumber(value: unknown, field: string): number | null {
  return value === null || value === undefined ? null : readNumber(value, field);
}

function nullableString(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : readString(value, field);
}

function mapWorkspace(row: SqlRow): StoredWorkspace {
  const state = parseJsonValue(row.domain_state);
  if (!isRecord(state) || !isKind(row.kind) || state.kind !== row.kind) {
    throw new Error('DATABASE_DOMAIN_STATE_INVALID');
  }
  return {
    id: readString(row.id, 'id'),
    title: readString(row.title, 'title'),
    kind: row.kind,
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

function mapMember(row: SqlRow): StoredMember {
  const role = row.role;
  const seat = row.seat;
  if (!isRole(role) || (seat !== null && seat !== undefined && !isSeat(seat))) {
    throw new Error('DATABASE_FIELD_INVALID:member');
  }
  return {
    actorId: readString(row.actor_id, 'actor_id'),
    name: readString(row.actor_name, 'actor_name'),
    role,
    ...(seat === null || seat === undefined ? {} : { seat }),
    createdAt: readNumber(row.created_at, 'created_at'),
    revokedAt: nullableNumber(row.revoked_at, 'revoked_at'),
  };
}

function mapInvitation(row: SqlRow): InvitationRecord {
  if ((row.role !== 'learner' && row.role !== 'player' && row.role !== 'participant') || !isSeat(row.seat)) {
    throw new Error('DATABASE_FIELD_INVALID:invitation');
  }
  return {
    ticketHash: readString(row.ticket_hash, 'ticket_hash'),
    workspaceId: readString(row.workspace_id, 'workspace_id'),
    epoch: readNumber(row.epoch, 'epoch'),
    role: row.role,
    seat: row.seat,
    createdBy: readString(row.created_by, 'created_by'),
    createdAt: readNumber(row.created_at, 'created_at'),
    expiresAt: readNumber(row.expires_at, 'expires_at'),
    redeemedAt: nullableNumber(row.redeemed_at, 'redeemed_at'),
    redeemedBy: nullableString(row.redeemed_by, 'redeemed_by'),
    revokedAt: nullableNumber(row.revoked_at, 'revoked_at'),
  };
}

function mapModelJob(row: SqlRow): RoomModelJob {
  const data = parseJsonValue(row.data);
  const status = row.status;
  if (!isRecord(data) || (status !== 'running' && status !== 'committing'
      && status !== 'completed' && status !== 'failed' && status !== 'revoked')) {
    throw new Error('DATABASE_MODEL_JOB_INVALID');
  }
  return {
    id: readString(row.id, 'id'),
    workspaceId: readString(row.workspace_id, 'workspace_id'),
    epoch: readNumber(row.epoch, 'epoch'),
    actorId: readString(row.actor_id, 'actor_id'),
    status,
    data,
    createdAt: readNumber(row.created_at, 'created_at'),
    revokedAt: nullableNumber(row.revoked_at, 'revoked_at'),
  };
}

function mapCommand(row: SqlRow): StoredCommand {
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

function insertMember(storage: DurableObjectStorage, workspaceId: string, epoch: number, member: StoredMember): void {
  storage.sql.exec(
    `INSERT INTO room_memberships(workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    workspaceId, epoch, member.actorId, member.name, member.role, member.seat ?? null,
    member.createdAt, member.revokedAt,
  );
}

export class RoomRepository implements WorkspaceRepository {
  readonly storage: DurableObjectStorage;
  private boundRoomId: string | null;
  private tail: Promise<void> = Promise.resolve();

  constructor(storage: DurableObjectStorage, roomId: string | null = null) {
    this.storage = storage;
    this.storage.transactionSync(() => {
      for (const statement of TABLES) this.storage.sql.exec(statement);
    });
    const persisted = this.rows('SELECT room_id FROM room_identity WHERE singleton = 1')[0];
    this.boundRoomId = persisted ? readString(persisted.room_id, 'room_id') : null;
    if (roomId !== null) this.bindRoomId(roomId);
  }

  get roomId(): string | null {
    return this.boundRoomId;
  }

  bindRoomId(roomId: string): void {
    if (!uuidPattern.test(roomId)) throw new Error('ROOM_ID_INVALID');
    if (this.boundRoomId !== null && this.boundRoomId !== roomId) throw new Error('ROOM_ID_MISMATCH');
    if (this.boundRoomId === null) {
      this.storage.transactionSync(() => {
        this.storage.sql.exec('INSERT INTO room_identity(singleton, room_id) VALUES (1, ?)', roomId);
      });
      this.boundRoomId = roomId;
    }
  }

  private rows<Row extends SqlRow>(query: string, ...bindings: SqlBinding[]): Row[] {
    return this.storage.sql.exec<Row>(query, ...bindings).toArray();
  }

  private workspaceSync(workspaceId: string): StoredWorkspace | null {
    if (this.boundRoomId === null || workspaceId !== this.boundRoomId) return null;
    const row = this.rows('SELECT * FROM room_workspaces WHERE id = ?', workspaceId)[0];
    return row ? mapWorkspace(row) : null;
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release: () => void = () => undefined;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private insertDirectory(actorId: string, epoch: number, active: boolean): void {
    this.storage.sql.exec(
      'INSERT INTO room_directory_outbox(actor_id, epoch, active) VALUES (?, ?, ?)',
      actorId, epoch, active ? 1 : 0,
    );
  }

  private insertSnapshot(workspace: StoredWorkspace, createdAt: number): void {
    this.storage.sql.exec(
      `INSERT INTO room_snapshots(workspace_id, epoch, revision, schema_version, state, state_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      workspace.id, workspace.epoch, workspace.revision, workspace.schemaVersion,
      JSON.stringify(workspace.domainState), workspace.stateHash, createdAt,
    );
  }

  private updateWorkspace(workspace: StoredWorkspace): void {
    this.storage.sql.exec(
      `UPDATE room_workspaces SET title = ?, kind = ?, owner_actor_id = ?, epoch = ?, revision = ?,
        projection_salt = ?, domain_state = ?, state_hash = ?, schema_version = ?, created_at = ?, expires_at = ?
       WHERE id = ?`,
      workspace.title, workspace.kind, workspace.ownerActorId, workspace.epoch, workspace.revision,
      workspace.projectionSalt, JSON.stringify(workspace.domainState), workspace.stateHash,
      workspace.schemaVersion, workspace.createdAt, workspace.expiresAt, workspace.id,
    );
  }

  private persistCommit(commit: CommandCommit, previousWorkspace: StoredWorkspace): void {
    const { workspace, event, command } = commit;
    if (commit.resetOwner) {
      const oldMembers = this.rows(
        `SELECT actor_id FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL`,
        workspace.id, previousWorkspace.epoch,
      );
      for (const row of oldMembers) this.insertDirectory(readString(row.actor_id, 'actor_id'), workspace.epoch, false);
      if (previousWorkspace.domainState.kind === 'invoice') {
        for (const artifact of previousWorkspace.domainState.sources) {
          if (!uuidPattern.test(artifact.id)) continue;
          this.storage.sql.exec(
            `INSERT INTO room_artifact_cleanup(workspace_id, epoch, object_key, requested_at)
             VALUES (?, ?, ?, ?) ON CONFLICT(workspace_id, epoch, object_key) DO NOTHING`,
            workspace.id, previousWorkspace.epoch, artifact.id, event.createdAt,
          );
        }
      }
      this.storage.sql.exec('DELETE FROM room_outbox WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_commands WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_events WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_snapshots WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_invitations WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_invite_links WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec('DELETE FROM room_approvals WHERE workspace_id = ?', workspace.id);
      this.storage.sql.exec(
        `UPDATE model_jobs SET status = 'revoked',
           data = CASE WHEN json_extract(data, '$.kind') = 'table-assistant'
             THEN '{"kind":"table-assistant","failure":"ROOM_RESET"}' ELSE '{}' END,
           revoked_at = COALESCE(revoked_at, ?)
         WHERE workspace_id = ? AND epoch < ?`,
        event.createdAt, workspace.id, workspace.epoch,
      );
      this.storage.sql.exec('DELETE FROM room_memberships WHERE workspace_id = ?', workspace.id);
      insertMember(this.storage, workspace.id, workspace.epoch, commit.resetOwner);
      this.insertDirectory(commit.resetOwner.actorId, workspace.epoch, true);
    }

    this.updateWorkspace(workspace);
    this.insertSnapshot(workspace, event.createdAt);
    const sequenceRows = this.rows<{ next_sequence: SqlStorageValue }>(
      `SELECT COALESCE(MAX(workspace_sequence), 0) + 1 AS next_sequence
       FROM room_events WHERE workspace_id = ? AND epoch = ?`,
      event.workspaceId, event.epoch,
    );
    const sequence = readNumber(sequenceRows[0]?.next_sequence ?? 1, 'next_sequence');
    this.storage.sql.exec(
      `INSERT INTO room_events(event_id, workspace_id, epoch, workspace_sequence, actor_id, command_id,
        event_type, event_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      event.eventId, event.workspaceId, event.epoch, sequence, event.actorId, event.commandId,
      event.eventType, JSON.stringify(event.eventData), event.createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO room_commands(workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      command.workspaceId, command.epoch, command.actorId, command.commandId, command.payloadHash,
      JSON.stringify(command.response), command.eventId, command.createdAt,
    );
    this.storage.sql.exec(
      `INSERT INTO room_outbox(outbox_id, workspace_id, epoch, event_id, created_at, delivered_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      commit.outboxId, event.workspaceId, event.epoch, event.eventId, event.createdAt,
    );
    const approval = workspace.domainState.candidate?.approval;
    if (approval) {
      this.storage.sql.exec(
        `INSERT INTO room_approvals(approval_id, workspace_id, epoch, approving_actor_id, candidate_hash,
          proof_hash, expires_at, revoked, approval_data, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(approval_id) DO UPDATE SET epoch=excluded.epoch,
          approving_actor_id=excluded.approving_actor_id, candidate_hash=excluded.candidate_hash,
          proof_hash=excluded.proof_hash, expires_at=excluded.expires_at, revoked=excluded.revoked,
          approval_data=excluded.approval_data, updated_at=excluded.updated_at`,
        approval.id, workspace.id, workspace.epoch, approval.actorId, approval.candidateHash,
        approval.proofHash, approval.expiresAt, approval.revoked ? 1 : 0,
        JSON.stringify(approval), event.createdAt,
      );
    }
  }

  async close(): Promise<void> {}

  async isReady(): Promise<void> {
    const row = this.rows<{ ready: SqlStorageValue }>('SELECT 1 AS ready')[0];
    if (readNumber(row?.ready, 'ready') !== 1) throw new Error('DATABASE_SCHEMA_UNAVAILABLE');
  }

  async expireWorkspaces(_now: number, _limit?: number): Promise<number> {
    // Room lifetimes are persistent in the hosted deployment; expiry is disabled here.
    return 0;
  }

  async listPendingArtifactCleanup(limit = 100): Promise<PendingArtifactCleanup[]> {
    const rows = this.rows(`SELECT workspace_id, epoch, object_key, requested_at FROM room_artifact_cleanup
      ORDER BY requested_at, object_key LIMIT ?`, Math.max(1, Math.min(500, Math.trunc(limit))));
    return rows.map((row) => ({
      workspaceId: readString(row.workspace_id, 'workspace_id'),
      epoch: readNumber(row.epoch, 'epoch'),
      objectKey: readString(row.object_key, 'object_key'),
      requestedAt: readNumber(row.requested_at, 'requested_at'),
    }));
  }

  async completeArtifactCleanup(request: PendingArtifactCleanup): Promise<void> {
    await this.serialized(async () => {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `DELETE FROM room_artifact_cleanup WHERE workspace_id = ? AND epoch = ? AND object_key = ?`,
          request.workspaceId, request.epoch, request.objectKey,
        );
      });
    });
  }

  async createSession(_session: SessionRecord): Promise<void> {
    throw new Error('ROOM_SESSION_STORAGE_UNSUPPORTED');
  }

  async getSession(_tokenHash: string): Promise<SessionRecord | null> {
    return null;
  }

  async getRotatedSession(_tokenHash: string, _ticketHash: string): Promise<SessionRecord | null> {
    return null;
  }

  async touchSession(_tokenHash: string, _now: number, _name?: string): Promise<SessionRecord | null> {
    return null;
  }

  async listWorkspaceReferences(actorId: string, now: number): Promise<WorkspaceReference[]> {
    if (this.boundRoomId === null) return [];
    const workspace = this.workspaceSync(this.boundRoomId);
    if (!workspace || workspace.expiresAt <= now) return [];
    const member = this.rows(
      `SELECT role FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND revoked_at IS NULL`,
      workspace.id, workspace.epoch, actorId,
    )[0];
    if (!member || !isRole(member.role)) return [];
    return [{ id: workspace.id, title: workspace.title, kind: workspace.kind, role: member.role }];
  }

  async createWorkspace(creation: WorkspaceCreation, _now: number): Promise<void> {
    if (creation.workspace.id !== this.roomId) throw new Error('ROOM_ID_MISMATCH');
    await this.serialized(async () => {
      const existing = this.workspaceSync(creation.workspace.id);
      if (existing) {
        if (existing.ownerActorId !== creation.owner.actorId || existing.kind !== creation.workspace.kind) {
          throw new Error('ROOM_ALREADY_INITIALIZED');
        }
        return;
      }
      this.storage.transactionSync(() => {
        const workspace = creation.workspace;
        this.storage.sql.exec(
          `INSERT INTO room_workspaces(id, title, kind, owner_actor_id, epoch, revision, projection_salt,
            domain_state, state_hash, schema_version, created_at, expires_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          workspace.id, workspace.title, workspace.kind, workspace.ownerActorId, workspace.epoch,
          workspace.revision, workspace.projectionSalt, JSON.stringify(workspace.domainState),
          workspace.stateHash, workspace.schemaVersion, workspace.createdAt, workspace.expiresAt,
        );
        insertMember(this.storage, workspace.id, workspace.epoch, creation.owner);
        this.insertSnapshot(workspace, workspace.createdAt);
        this.insertDirectory(creation.owner.actorId, workspace.epoch, true);
      });
    });
  }

  async getWorkspace(workspaceId: string): Promise<StoredWorkspace | null> {
    return this.workspaceSync(workspaceId);
  }

  /** Time of the latest committed command in the current epoch, or null before the first one (F053). */
  lastActivityAt(workspaceId: string, epoch: number): number | null {
    const row = this.rows<{ last_at: SqlStorageValue }>(
      'SELECT MAX(created_at) AS last_at FROM room_events WHERE workspace_id = ? AND epoch = ?',
      workspaceId, epoch,
    )[0];
    return row?.last_at === null || row?.last_at === undefined ? null : readNumber(row.last_at, 'last_at');
  }

  async getMember(workspaceId: string, actorId: string): Promise<StoredMember | null> {
    const workspace = this.workspaceSync(workspaceId);
    if (!workspace) return null;
    const row = this.rows(
      `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
       WHERE workspace_id = ? AND epoch = ? AND actor_id = ?`,
      workspaceId, workspace.epoch, actorId,
    )[0];
    return row ? mapMember(row) : null;
  }

  async getInvitation(ticketHash: string): Promise<InvitationRecord | null> {
    const row = this.rows('SELECT * FROM room_invitations WHERE ticket_hash = ?', ticketHash)[0];
    return row ? mapInvitation(row) : null;
  }

  async createInvitation(invitation: InvitationRecord, now: number): Promise<void> {
    await this.withWorkspaceTransaction(invitation.workspaceId, async (transaction) => {
      if (transaction.workspace.epoch !== invitation.epoch || transaction.workspace.expiresAt <= now) {
        throw new AuthorityError('STALE_EPOCH');
      }
      await transaction.insertInvitation(invitation);
    });
  }

  async redeemInvitation(_input: RedeemInvitationInput): Promise<RedeemedInvitation> {
    throw new Error('ROOM_INVITE_REDEMPTION_USES_GLOBAL_IDENTITY');
  }

  /** F003-T3: replace the table's reusable link (any earlier link stops working at once). */
  async createInviteLink(workspaceId: string, createdBy: string, tokenHash: string, now: number, expiresAt: number): Promise<{ expiresAt: number }> {
    return this.serialized(async () => {
      const workspace = this.workspaceSync(workspaceId);
      if (!workspace || workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          'UPDATE room_invite_links SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL',
          now, workspaceId,
        );
        this.storage.sql.exec(
          `INSERT INTO room_invite_links(token_hash, workspace_id, epoch, created_by, created_at, expires_at, revoked_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL)`,
          tokenHash, workspaceId, workspace.epoch, createdBy, now, expiresAt,
        );
      });
      return { expiresAt };
    });
  }

  async disableInviteLink(workspaceId: string, now: number): Promise<void> {
    await this.serialized(async () => {
      this.storage.sql.exec(
        'UPDATE room_invite_links SET revoked_at = ? WHERE workspace_id = ? AND revoked_at IS NULL',
        now, workspaceId,
      );
    });
  }

  inviteLinkStatus(workspaceId: string, now: number): { enabled: boolean; expiresAt: number | null } {
    const workspace = this.workspaceSync(workspaceId);
    const row = workspace ? this.rows(
      `SELECT expires_at FROM room_invite_links WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL AND expires_at > ?`,
      workspaceId, workspace.epoch, now,
    )[0] : undefined;
    return row ? { enabled: true, expiresAt: readNumber(row.expires_at, 'expires_at') } : { enabled: false, expiresAt: null };
  }

  /**
   * F003-T3: join through the table's reusable link and take the first free member seat.
   * An active member gets a replay; a member the owner removed must get a new invitation.
   */
  async joinByInviteLink(tokenHash: string, actorId: string, name: string, now: number): Promise<RedeemedRoomInvitation> {
    return this.serialized(async () => {
      const link = this.rows('SELECT * FROM room_invite_links WHERE token_hash = ?', tokenHash)[0];
      if (!link) throw new AuthorityError('INVITE_INVALID');
      const workspace = this.workspaceSync(readString(link.workspace_id, 'workspace_id'));
      if (!workspace || workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      if (link.revoked_at !== null || readNumber(link.expires_at, 'expires_at') <= now
          || readNumber(link.epoch, 'epoch') !== workspace.epoch) throw new AuthorityError('INVITE_EXPIRED');
      if (workspace.kind !== 'table') throw new AuthorityError('INVITE_NOT_ALLOWED');
      const memberRow = this.rows(
        `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
         WHERE workspace_id = ? AND epoch = ? AND actor_id = ?`,
        workspace.id, workspace.epoch, actorId,
      )[0];
      if (memberRow && memberRow.revoked_at === null) return { workspace, member: mapMember(memberRow), replay: true };
      if (memberRow) throw new AuthorityError('INVITE_MEMBER_REMOVED', 'The owner removed you from this table. Ask them for a new invitation.');
      const active = this.rows(
        `SELECT seat FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL`,
        workspace.id, workspace.epoch,
      );
      if (active.length >= MAX_MEMBERS_PER_WORKSPACE) throw new AuthorityError('MEMBER_LIMIT_REACHED');
      const taken = new Set(active.map((row) => row.seat));
      const reserved = new Set(this.rows(
        `SELECT seat FROM room_invitations WHERE workspace_id = ? AND epoch = ? AND redeemed_at IS NULL
         AND revoked_at IS NULL AND expires_at > ?`,
        workspace.id, workspace.epoch, now,
      ).map((row) => row.seat));
      // Prefer a seat no single-use invitation is waiting for; fall back to any free seat.
      const seats = (['member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6', 'member-7'] as const).filter((seat) => !taken.has(seat));
      const seat = seats.find((candidate) => !reserved.has(candidate)) ?? seats[0];
      if (!seat) throw new AuthorityError('MEMBER_LIMIT_REACHED');
      const member: StoredMember = {
        actorId,
        name: Array.from(name.replace(/\p{Cc}/gu, '').trim()).slice(0, 64).join('') || 'Guest',
        role: 'participant',
        seat,
        createdAt: now,
        revokedAt: null,
      };
      this.storage.transactionSync(() => {
        if (reserved.has(seat)) {
          // Every free seat had a waiting single-use link; that link gives way to this join.
          this.storage.sql.exec(
            `UPDATE room_invitations SET revoked_at = ? WHERE workspace_id = ? AND epoch = ? AND seat = ?
             AND redeemed_at IS NULL AND revoked_at IS NULL`,
            now, workspace.id, workspace.epoch, seat,
          );
        }
        insertMember(this.storage, workspace.id, workspace.epoch, member);
        this.insertDirectory(actorId, workspace.epoch, true);
      });
      return { workspace, member, replay: false };
    });
  }

  async redeemRoomInvitation(ticketHash: string, actorId: string, name: string, now: number): Promise<RedeemedRoomInvitation> {
    return this.serialized(async () => {
      const invitationRow = this.rows('SELECT * FROM room_invitations WHERE ticket_hash = ?', ticketHash)[0];
      if (!invitationRow) throw new AuthorityError('INVITE_INVALID');
      const invitation = mapInvitation(invitationRow);
      const workspace = this.workspaceSync(invitation.workspaceId);
      if (!workspace) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      if (invitation.revokedAt !== null || invitation.expiresAt <= now) throw new AuthorityError('INVITE_EXPIRED');
      if (workspace.expiresAt <= now) throw new AuthorityError('WORKSPACE_NOT_FOUND');

      const memberRow = this.rows(
        `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
         WHERE workspace_id = ? AND epoch = ? AND actor_id = ?`,
        workspace.id, invitation.epoch, actorId,
      )[0];
      if (invitation.redeemedAt !== null) {
        if (invitation.redeemedBy !== actorId || !memberRow) throw new AuthorityError('INVITE_ALREADY_USED');
        const member = mapMember(memberRow);
        if (member.revokedAt !== null || member.seat !== invitation.seat || invitation.epoch !== workspace.epoch) {
          throw new AuthorityError('INVITE_ALREADY_USED');
        }
        return { workspace, member, replay: true };
      }
      if (invitation.epoch !== workspace.epoch) throw new AuthorityError('STALE_EPOCH');
      // An active member cannot redeem again; a member the owner removed may return with a new invitation (F003).
      if (memberRow && memberRow.revoked_at === null) throw new AuthorityError('INVITE_ALREADY_USED');
      const expectedRole = workspace.kind === 'table' && invitation.seat.startsWith('member-')
        ? 'participant'
        : workspace.kind === 'teaching' && (invitation.seat === 'learner-1' || invitation.seat === 'learner-2')
        ? 'learner'
        : workspace.kind === 'encounter' && (invitation.seat === 'mira' || invitation.seat === 'pip')
          ? 'player'
          : null;
      if (expectedRole !== invitation.role) throw new AuthorityError('INVITE_NOT_ALLOWED');
      const countRow = this.rows<{ member_count: SqlStorageValue }>(
        `SELECT COUNT(*) AS member_count FROM room_memberships
         WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL`,
        workspace.id, workspace.epoch,
      )[0];
      if (readNumber(countRow?.member_count ?? 0, 'member_count') >= MAX_MEMBERS_PER_WORKSPACE) {
        throw new AuthorityError('MEMBER_LIMIT_REACHED');
      }
      const seatRow = this.rows(
        `SELECT actor_id FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND seat = ? AND revoked_at IS NULL`,
        workspace.id, workspace.epoch, invitation.seat,
      )[0];
      if (seatRow) throw new AuthorityError('INVITE_SEAT_OCCUPIED');
      const member: StoredMember = {
        actorId,
        name: Array.from(name.replace(/\p{Cc}/gu, '').trim()).slice(0, 64).join('') || 'Guest',
        role: invitation.role,
        seat: invitation.seat,
        createdAt: now,
        revokedAt: null,
      };
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `UPDATE room_invitations SET redeemed_at = ?, redeemed_by = ?
           WHERE ticket_hash = ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
          now, actorId, ticketHash,
        );
        if (memberRow) {
          this.storage.sql.exec(
            'DELETE FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND revoked_at IS NOT NULL',
            workspace.id, workspace.epoch, actorId,
          );
        }
        insertMember(this.storage, workspace.id, workspace.epoch, member);
        this.insertDirectory(actorId, workspace.epoch, true);
      });
      return { workspace, member, replay: false };
    });
  }

  async reserveModelJob(input: ReserveRoomModelJobInput): Promise<{ created: boolean; job: RoomModelJob }> {
    return this.serialized(async () => {
      const existingRow = this.rows('SELECT * FROM model_jobs WHERE id = ?', input.id)[0];
      if (existingRow) {
        const existing = mapModelJob(existingRow);
        if (existing.workspaceId !== input.workspaceId || existing.epoch !== input.epoch || existing.actorId !== input.actorId) {
          throw new AuthorityError('IDEMPOTENCY_MISMATCH');
        }
        if (existing.data.requestHash !== input.requestHash || existing.data.kind !== input.kind) {
          throw new AuthorityError('IDEMPOTENCY_MISMATCH');
        }
        return { created: false, job: existing };
      }

      const workspace = this.workspaceSync(input.workspaceId);
      if (!workspace || workspace.expiresAt <= input.now) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      if (workspace.epoch !== input.epoch) throw new AuthorityError('STALE_EPOCH');
      const member = this.rows(
        `SELECT actor_id FROM room_memberships WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND revoked_at IS NULL`,
        input.workspaceId, input.epoch, input.actorId,
      )[0];
      if (!member) throw new AuthorityError('MEMBERSHIP_REVOKED');
      const receipt = this.rows(
        `SELECT command_id FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
        input.workspaceId, input.epoch, input.actorId, input.commandId,
      )[0];
      if (receipt) throw new AuthorityError('IDEMPOTENCY_MISMATCH');

      if (input.kind === 'table-assistant') {
        if (typeof input.prompt !== 'string' || input.prompt.length === 0 || input.prompt.length > 4_000) {
          throw new AuthorityError('INVALID_REQUEST');
        }
        const totalRow = this.rows<{ job_count: SqlStorageValue }>(
          `SELECT COUNT(*) AS job_count FROM model_jobs
           WHERE workspace_id = ? AND json_extract(data, '$.kind') = 'table-assistant'`,
          input.workspaceId,
        )[0];
        if (readNumber(totalRow?.job_count ?? 0, 'job_count') >= MAX_TABLE_ASSISTANT_JOBS_PER_ROOM) {
          throw new AuthorityError('TABLE_ASSISTANT_HISTORY_LIMIT', 'The table assistant has reached this room’s saved history limit. You can keep playing directly; no new assistant job was started.', 409);
        }
        const activeRow = this.rows<{ job_count: SqlStorageValue }>(
          `SELECT COUNT(*) AS job_count FROM model_jobs
           WHERE workspace_id = ? AND json_extract(data, '$.kind') = 'table-assistant'
             AND status IN ('running', 'committing') AND revoked_at IS NULL`,
          input.workspaceId,
        )[0];
        if (readNumber(activeRow?.job_count ?? 0, 'job_count') >= MAX_ACTIVE_TABLE_ASSISTANT_JOBS_PER_ROOM) {
          throw new AuthorityError('TOO_MANY_REQUESTS');
        }
      }

      const data = {
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        requestHash: input.requestHash,
        commandId: input.commandId,
        expectedRevision: input.expectedRevision,
        expectedEpoch: input.epoch,
        // Rule-draft prompts are kept too so open visibility (F034) can show them to the table.
        ...(typeof input.prompt === 'string' && input.prompt.length > 0 && input.prompt.length <= 4_000 ? { prompt: input.prompt } : {}),
      };
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `INSERT INTO model_jobs(id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
           VALUES (?, ?, ?, ?, 'running', ?, ?, NULL)`,
          input.id, input.workspaceId, input.epoch, input.actorId, JSON.stringify(data), input.now,
        );
      });
      return {
        created: true,
        job: {
          id: input.id,
          workspaceId: input.workspaceId,
          epoch: input.epoch,
          actorId: input.actorId,
          status: 'running',
          data,
          createdAt: input.now,
          revokedAt: null,
        },
      };
    });
  }

  async getModelJob(id: string, actorId: string, workspaceId: string, epoch: number): Promise<RoomModelJob | null> {
    return this.serialized(async () => {
      const row = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND actor_id = ? AND workspace_id = ? AND epoch = ?`,
        id, actorId, workspaceId, epoch,
      )[0];
      return row ? mapModelJob(row) : null;
    });
  }

  /** Rule-draft (/model) jobs of this table epoch, newest first; every member's under open visibility (F034). */
  async listTableDraftJobs(input: { workspaceId: string; epoch: number; actorId: string; scope: 'actor' | 'table'; limit: number }): Promise<RoomModelJob[]> {
    const byActor = input.scope === 'actor';
    return this.serialized(async () => this.rows(
      `SELECT * FROM model_jobs WHERE workspace_id = ? AND epoch = ? ${byActor ? 'AND actor_id = ?' : ''}
       AND json_extract(data, '$.kind') IS NULL
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      input.workspaceId, input.epoch, ...(byActor ? [input.actorId] : []), Math.max(1, Math.min(50, Math.trunc(input.limit))),
    ).map(mapModelJob));
  }

  /** Any member's job in this table epoch, for read-only polling under open visibility (F034). */
  async getTableModelJob(id: string, workspaceId: string, epoch: number): Promise<RoomModelJob | null> {
    return this.serialized(async () => {
      const row = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ?`,
        id, workspaceId, epoch,
      )[0];
      return row ? mapModelJob(row) : null;
    });
  }

  async listTableAssistantJobs(input: {
    workspaceId: string;
    epoch: number;
    actorId: string;
    before?: string;
    limit: number;
    /** 'table' lists every member's chat (open visibility, F034); 'actor' only the caller's. */
    scope?: 'actor' | 'table';
  }): Promise<{ jobs: RoomModelJob[]; hasMore: boolean }> {
    const byActor = (input.scope ?? 'actor') === 'actor';
    const actorClause = byActor ? 'AND actor_id = ?' : '';
    const actorArgs = byActor ? [input.actorId] : [];
    return this.serialized(async () => {
      let anchor: { created_at: SqlStorageValue; id: SqlStorageValue } | undefined;
      if (input.before !== undefined) {
        anchor = this.rows<{ created_at: SqlStorageValue; id: SqlStorageValue }>(
          `SELECT created_at, id FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? ${actorClause}
           AND json_extract(data, '$.kind') = 'table-assistant'`,
          input.before, input.workspaceId, input.epoch, ...actorArgs,
        )[0];
        if (!anchor) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      }
      const rows = anchor
        ? this.rows(
          `SELECT * FROM model_jobs WHERE workspace_id = ? AND epoch = ? ${actorClause}
           AND json_extract(data, '$.kind') = 'table-assistant'
           AND (created_at < ? OR (created_at = ? AND id < ?))
           ORDER BY created_at DESC, id DESC LIMIT ?`,
          input.workspaceId, input.epoch, ...actorArgs,
          readNumber(anchor.created_at, 'created_at'), readNumber(anchor.created_at, 'created_at'),
          readString(anchor.id, 'id'), input.limit + 1,
        )
        : this.rows(
          `SELECT * FROM model_jobs WHERE workspace_id = ? AND epoch = ? ${actorClause}
           AND json_extract(data, '$.kind') = 'table-assistant'
           ORDER BY created_at DESC, id DESC LIMIT ?`,
          input.workspaceId, input.epoch, ...actorArgs, input.limit + 1,
        );
      return { jobs: rows.slice(0, input.limit).map(mapModelJob), hasMore: rows.length > input.limit };
    });
  }

  async listRecentCompletedTableAssistantJobs(
    workspaceId: string,
    epoch: number,
    actorId: string,
    limit: number,
  ): Promise<RoomModelJob[]> {
    return this.serialized(async () => this.rows(
      `SELECT * FROM model_jobs WHERE workspace_id = ? AND epoch = ? AND actor_id = ?
       AND json_extract(data, '$.kind') = 'table-assistant' AND status = 'completed'
       ORDER BY created_at DESC, id DESC LIMIT ?`,
      workspaceId, epoch, actorId, Math.max(1, Math.min(100, Math.trunc(limit))),
    ).map(mapModelJob));
  }

  async findCommandReceipt(
    workspaceId: string,
    epoch: number,
    actorId: string,
    commandId: string,
  ): Promise<StoredCommand | null> {
    return this.serialized(async () => {
      const row = this.rows(
        `SELECT workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at
         FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
        workspaceId, epoch, actorId, commandId,
      )[0];
      return row ? mapCommand(row) : null;
    });
  }

  async finishModelJob(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    status: 'completed' | 'failed',
    data: Record<string, unknown>,
  ): Promise<boolean> {
    return this.serialized(async () => {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = ?, data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status IN ('running', 'committing') AND revoked_at IS NULL`,
          status, JSON.stringify(data), id, workspaceId, epoch, actorId,
        );
      });
      const row = this.rows(
        `SELECT status FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        id, workspaceId, epoch, actorId,
      )[0];
      return row?.status === status;
    });
  }

  /**
   * Best-effort live progress for a running model job (rule draft or assistant); never changes the
   * job status, so a stale write can only lose counters, not a finish (F045).
   */
  async updateModelJobProgress(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    progress: ModelJobProgress,
  ): Promise<void> {
    this.storage.sql.exec(
      `UPDATE model_jobs SET data = json_set(data, '$.progress', json(?))
       WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ? AND status = 'running'`,
      JSON.stringify(progress), id, workspaceId, epoch, actorId,
    );
  }

  async finishTableAssistantJob(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    status: 'completed' | 'failed',
    data: Record<string, unknown>,
  ): Promise<boolean> {
    return this.serialized(async () => {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = ?, data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status = 'running' AND revoked_at IS NULL
           AND json_extract(data, '$.kind') = 'table-assistant'`,
          status, JSON.stringify(status === 'failed' ? { ...data, failedAt: Date.now() } : data), id, workspaceId, epoch, actorId,
        );
      });
      const row = this.rows(
        `SELECT status FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?
         AND json_extract(data, '$.kind') = 'table-assistant'`,
        id, workspaceId, epoch, actorId,
      )[0];
      return row?.status === status;
    });
  }

  async claimTableAssistantConfirmation(input: {
    id: string;
    workspaceId: string;
    epoch: number;
    actorId: string;
    commandId: string;
    expectedRevision: string;
    proposalHash: string;
    startedAt: number;
  }): Promise<{ job: RoomModelJob; claimed: boolean }> {
    return this.serialized(async () => this.storage.transactionSync(() => {
      const row = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        input.id, input.workspaceId, input.epoch, input.actorId,
      )[0];
      if (!row) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      const current = mapModelJob(row);
      if (current.data.kind !== 'table-assistant') throw new AuthorityError('IDEMPOTENCY_MISMATCH');
      if (current.status === 'committing'
          || (current.status === 'completed' && current.data.confirmationStatus === 'confirmed')) {
        if (current.data.confirmCommandId !== input.commandId
            || current.data.proposalHash !== input.proposalHash) throw new AuthorityError('IDEMPOTENCY_MISMATCH');
        return { job: current, claimed: false };
      }
      if (current.status !== 'completed' || current.data.confirmationStatus !== 'available') {
        throw new AuthorityError('STALE_REVISION');
      }
      if (current.data.expectedRevision !== input.expectedRevision) throw new AuthorityError('STALE_REVISION');
      if (current.data.expectedEpoch !== input.epoch) throw new AuthorityError('STALE_EPOCH');
      const existingReceipt = this.rows(
        `SELECT command_id FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
        input.workspaceId, input.epoch, input.actorId, input.commandId,
      )[0];
      if (existingReceipt) throw new AuthorityError('IDEMPOTENCY_MISMATCH');

      const data = {
        ...current.data,
        assistantRequestCommandId: current.data.commandId,
        commandId: input.commandId,
        confirmCommandId: input.commandId,
        proposalHash: input.proposalHash,
        confirmationStatus: 'processing',
        confirmationStartedAt: input.startedAt,
      };
      this.storage.sql.exec(
        `UPDATE model_jobs SET status = 'committing', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
         AND actor_id = ? AND status = 'completed' AND revoked_at IS NULL`,
        JSON.stringify(data), input.id, input.workspaceId, input.epoch, input.actorId,
      );
      const claimed = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        input.id, input.workspaceId, input.epoch, input.actorId,
      )[0];
      if (!claimed) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      const job = mapModelJob(claimed);
      if (job.status !== 'committing' || job.data.confirmCommandId !== input.commandId) {
        throw new AuthorityError('STALE_REVISION');
      }
      return { job, claimed: true };
    }));
  }

  async completeTableAssistantConfirmation(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    commandId: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    return this.serialized(async () => {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = 'completed', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status = 'committing' AND revoked_at IS NULL
           AND json_extract(data, '$.kind') = 'table-assistant'
           AND json_extract(data, '$.confirmCommandId') = ?`,
          JSON.stringify(data), id, workspaceId, epoch, actorId, commandId,
        );
      });
      const row = this.rows(
        `SELECT status FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?
         AND json_extract(data, '$.kind') = 'table-assistant'`,
        id, workspaceId, epoch, actorId,
      )[0];
      return row?.status === 'completed';
    });
  }

  async settleTableAssistantConfirmationFailure(input: {
    id: string;
    workspaceId: string;
    epoch: number;
    actorId: string;
    commandId: string;
    proposalHash: string;
    confirmationStatus: 'stale' | 'rejected';
    failure: string;
  }): Promise<'confirmed' | 'stale' | 'rejected' | 'inactive'> {
    return this.serialized(async () => this.storage.transactionSync(() => {
      const row = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        input.id, input.workspaceId, input.epoch, input.actorId,
      )[0];
      if (!row) return 'inactive';
      const job = mapModelJob(row);
      if (job.data.kind !== 'table-assistant' || job.status !== 'committing'
          || job.revokedAt !== null) return 'inactive';
      if (job.data.confirmCommandId !== input.commandId || job.data.proposalHash !== input.proposalHash) {
        throw new AuthorityError('IDEMPOTENCY_MISMATCH');
      }
      const receiptRow = this.rows(
        `SELECT workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at
         FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
        input.workspaceId, input.epoch, input.actorId, input.commandId,
      )[0];
      if (receiptRow && mapCommand(receiptRow).payloadHash === input.proposalHash) {
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = 'completed', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status = 'committing' AND revoked_at IS NULL`,
          JSON.stringify({ ...job.data, confirmationStatus: 'confirmed' }),
          input.id, input.workspaceId, input.epoch, input.actorId,
        );
        return 'confirmed';
      }
      // A receipt for another command is immutable. End only this assistant
      // confirmation so recovery cannot retry the same collision forever.
      const confirmationStatus = receiptRow ? 'rejected' : input.confirmationStatus;
      const failure = receiptRow ? 'IDEMPOTENCY_MISMATCH' : input.failure;
      this.storage.sql.exec(
        `UPDATE model_jobs SET status = 'completed', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
         AND actor_id = ? AND status = 'committing' AND revoked_at IS NULL`,
        JSON.stringify({ ...job.data, confirmationStatus, confirmationFailure: failure }),
        input.id, input.workspaceId, input.epoch, input.actorId,
      );
      return confirmationStatus;
    }));
  }

   async failModelJobAfterReceiptCheck(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    failure: string,
    reasons: readonly string[] = [],
    details?: ModelFailureDetails,
  ): Promise<'completed' | 'failed' | 'inactive'> {
    return this.serialized(async () => this.storage.transactionSync(() => {
      const jobRow = this.rows(
        `SELECT * FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        id, workspaceId, epoch, actorId,
      )[0];
      if (!jobRow || (jobRow.status !== 'running' && jobRow.status !== 'committing') || jobRow.revoked_at !== null) {
        return 'inactive';
      }

      const job = mapModelJob(jobRow);
      const commandId = typeof job.data.commandId === 'string' ? job.data.commandId : '';
      const proposalHash = typeof job.data.proposalHash === 'string' ? job.data.proposalHash : '';
      const receiptRow = commandId
        ? this.rows(
          `SELECT workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at
           FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
          workspaceId, epoch, actorId, commandId,
        )[0]
        : undefined;
      if (receiptRow && proposalHash && readString(receiptRow.payload_hash, 'payload_hash') === proposalHash) {
        const receipt = mapCommand(receiptRow);
        const candidateId = receipt.response.workspace.domain.candidate?.id;
        const completedData = job.data.kind === 'table-assistant'
          ? { ...job.data, confirmationStatus: 'confirmed' }
          : { ...job.data, ...(candidateId ? { candidateId } : {}) };
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = 'completed', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status IN ('running', 'committing') AND revoked_at IS NULL`,
          JSON.stringify(completedData), id, workspaceId, epoch, actorId,
        );
        return 'completed';
      }

      this.storage.sql.exec(
        `UPDATE model_jobs SET status = 'failed', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
         AND actor_id = ? AND status IN ('running', 'committing') AND revoked_at IS NULL`,
        JSON.stringify({
          ...job.data,
          failure,
          failedAt: Date.now(),
          ...(reasons.length ? { reasons } : {}),
          // F045: only a job that really failed keeps the bounded stop evidence; a receipt-proven
          // completion above must never be rewritten as a failure.
          ...(details ? { failureDetails: details } : {}),
        }), id, workspaceId, epoch, actorId,
      );
      return 'failed';
    }));
  }

  async beginModelJobCommit(
    id: string,
    workspaceId: string,
    epoch: number,
    actorId: string,
    data: Record<string, unknown>,
  ): Promise<boolean> {
    return this.serialized(async () => {
      this.storage.transactionSync(() => {
        this.storage.sql.exec(
          `UPDATE model_jobs SET status = 'committing', data = ? WHERE id = ? AND workspace_id = ? AND epoch = ?
           AND actor_id = ? AND status = 'running' AND revoked_at IS NULL`,
          JSON.stringify(data), id, workspaceId, epoch, actorId,
        );
      });
      const row = this.rows(
        `SELECT status FROM model_jobs WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
        id, workspaceId, epoch, actorId,
      )[0];
      return row?.status === 'committing';
    });
  }

  async listStaleRunningModelJobs(before: number, limit = 100): Promise<RoomModelJob[]> {
    return this.serialized(async () => this.rows(
      `SELECT * FROM model_jobs WHERE revoked_at IS NULL AND (
         (status IN ('running', 'committing') AND created_at <= ?)
         OR (status = 'committing' AND json_extract(data, '$.kind') = 'table-assistant')
       )
       ORDER BY created_at, id LIMIT ?`,
      before, Math.max(1, Math.min(500, Math.trunc(limit))),
    ).map(mapModelJob));
  }

  nextModelJobRecoveryAt(recoveryMs: number): number | null {
    const row = this.rows(
      `SELECT MIN(CASE
        WHEN status = 'committing' AND json_extract(data, '$.kind') = 'table-assistant'
          THEN COALESCE(json_extract(data, '$.confirmationStartedAt'), created_at)
        ELSE created_at
       END) AS oldest_created_at FROM model_jobs
       WHERE status IN ('running', 'committing') AND revoked_at IS NULL`,
    )[0];
    return row?.oldest_created_at === null || row?.oldest_created_at === undefined
      ? null : readNumber(row.oldest_created_at, 'oldest_created_at') + recoveryMs;
  }

  async withWorkspaceTransaction<T>(
    workspaceId: string,
    operation: (transaction: WorkspaceTransaction) => Promise<T>,
  ): Promise<T> {
    return this.serialized(async () => {
      const workspace = this.workspaceSync(workspaceId);
      if (!workspace) throw new AuthorityError('WORKSPACE_NOT_FOUND');
      const stagedInvitations: InvitationRecord[] = [];
      const expiredInvitations = new Map<string, number>();
      const replacedInvitations = new Map<Seat, number>();
      const revokedMembers = new Map<string, number>();
      let commandCommit: CommandCommit | null = null;
      const repository = this;
      const transaction: WorkspaceTransaction = {
        workspace,
        async getMember(actorId, epoch = workspace.epoch): Promise<StoredMember | null> {
          const row = repository.rows(
            `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
             WHERE workspace_id = ? AND epoch = ? AND actor_id = ?`,
            workspaceId, epoch, actorId,
          )[0];
          return row ? mapMember(row) : null;
        },
        async listMembers(epoch = workspace.epoch): Promise<StoredMember[]> {
          return repository.rows(
            `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
             WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL ORDER BY created_at, actor_id`,
            workspaceId, epoch,
          ).map(mapMember);
        },
        async findCommand(actorId, commandId, epoch): Promise<StoredCommand | null> {
          const row = repository.rows(
            `SELECT workspace_id, epoch, actor_id, command_id, payload_hash, response, event_id, created_at
             FROM room_commands WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND command_id = ?`,
            workspaceId, epoch, actorId, commandId,
          )[0];
          return row ? mapCommand(row) : null;
        },
        async assertModelJobCommitting(guard): Promise<void> {
          if (guard.workspaceId !== workspaceId || guard.epoch !== workspace.epoch) {
            throw new AuthorityError('MODEL_JOB_NOT_COMMITTING', 'The proposal job is no longer active.', 409);
          }
          const row = repository.rows(
            `SELECT status, revoked_at, data FROM model_jobs
             WHERE id = ? AND workspace_id = ? AND epoch = ? AND actor_id = ?`,
            guard.jobId, guard.workspaceId, guard.epoch, guard.actorId,
          )[0];
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
          const row = repository.rows<{ member_count: SqlStorageValue }>(
            `SELECT COUNT(*) AS member_count FROM room_memberships
             WHERE workspace_id = ? AND epoch = ? AND revoked_at IS NULL`,
            workspaceId, epoch,
          )[0];
          return readNumber(row?.member_count ?? 0, 'member_count');
        },
        async hasActiveInvitation(seat: Seat, now: number, epoch = workspace.epoch): Promise<boolean> {
          const expired = repository.rows(
            `SELECT ticket_hash FROM room_invitations WHERE workspace_id = ? AND epoch = ? AND seat = ?
             AND expires_at <= ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
            workspaceId, epoch, seat, now,
          );
          for (const row of expired) expiredInvitations.set(readString(row.ticket_hash, 'ticket_hash'), now);
          const active = repository.rows(
            `SELECT ticket_hash FROM room_invitations WHERE workspace_id = ? AND epoch = ? AND seat = ?
             AND expires_at > ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
            workspaceId, epoch, seat, now,
          );
          return active.some((row) => !expiredInvitations.has(readString(row.ticket_hash, 'ticket_hash')))
            && !replacedInvitations.has(seat);
        },
        async revokeOutstandingInvitations(seat, now): Promise<void> {
          replacedInvitations.set(seat, now);
        },
        async revokeMember(actorId, now): Promise<void> {
          revokedMembers.set(actorId, now);
        },
        async getApproval(approvalId, epoch): Promise<{ actorId: string; candidateHash: string; proofHash: string; expiresAt: number; revoked: boolean } | null> {
          const row = repository.rows(
            `SELECT approving_actor_id, candidate_hash, proof_hash, expires_at, revoked FROM room_approvals
             WHERE approval_id = ? AND workspace_id = ? AND epoch = ?`,
            approvalId, workspaceId, epoch,
          )[0];
          if (!row) return null;
          return {
            actorId: readString(row.approving_actor_id, 'approving_actor_id'),
            candidateHash: readString(row.candidate_hash, 'candidate_hash'),
            proofHash: readString(row.proof_hash, 'proof_hash'),
            expiresAt: readNumber(row.expires_at, 'expires_at'),
            revoked: row.revoked === 1,
          };
        },
        async insertInvitation(invitation): Promise<void> {
          if (invitation.workspaceId !== workspaceId || invitation.epoch !== workspace.epoch) {
            throw new AuthorityError('STALE_EPOCH');
          }
          stagedInvitations.push(invitation);
        },
        async commitCommand(commit): Promise<void> {
          if (commit.workspace.id !== workspaceId) throw new Error('WORKSPACE_TRANSACTION_MISMATCH');
          if (commandCommit) throw new Error('WORKSPACE_TRANSACTION_ALREADY_COMMITTED');
          commandCommit = commit;
        },
      };
      const result = await operation(transaction);
      if (stagedInvitations.length || expiredInvitations.size || replacedInvitations.size || revokedMembers.size || commandCommit) {
        const completedCommit = commandCommit;
        this.storage.transactionSync(() => {
          for (const [ticketHash, revokedAt] of expiredInvitations) {
            this.storage.sql.exec(
              `UPDATE room_invitations SET revoked_at = ? WHERE ticket_hash = ? AND revoked_at IS NULL`,
              revokedAt, ticketHash,
            );
          }
          for (const [seat, revokedAt] of replacedInvitations) {
            this.storage.sql.exec(
              `UPDATE room_invitations SET revoked_at = ? WHERE workspace_id = ? AND epoch = ? AND seat = ?
               AND expires_at > ? AND redeemed_at IS NULL AND revoked_at IS NULL`,
              revokedAt, workspaceId, workspace.epoch, seat, revokedAt,
            );
          }
          for (const [actorId, revokedAt] of revokedMembers) {
            // F003: the removed member loses access now; the D1 directory hides the room on next sync.
            this.storage.sql.exec(
              `UPDATE room_memberships SET revoked_at = ? WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND revoked_at IS NULL`,
              revokedAt, workspaceId, workspace.epoch, actorId,
            );
            this.insertDirectory(actorId, workspace.epoch, false);
          }
          for (const invitation of stagedInvitations) {
            this.storage.sql.exec(
              `INSERT INTO room_invitations(ticket_hash, workspace_id, epoch, role, seat, created_by,
                created_at, expires_at, redeemed_at, redeemed_by, revoked_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              invitation.ticketHash, invitation.workspaceId, invitation.epoch, invitation.role,
              invitation.seat, invitation.createdBy, invitation.createdAt, invitation.expiresAt,
              invitation.redeemedAt, invitation.redeemedBy, invitation.revokedAt,
            );
          }
          if (completedCommit) this.persistCommit(completedCommit, workspace);
        });
      }
      return result;
    });
  }

  listPendingOutbox(limit = 100): PendingRoomOutbox[] {
    return this.rows(`SELECT outbox_id, workspace_id, epoch FROM room_outbox
      WHERE delivered_at IS NULL ORDER BY created_at, outbox_id LIMIT ?`, Math.max(1, Math.min(500, Math.trunc(limit))))
      .map((row) => ({
        outboxId: readString(row.outbox_id, 'outbox_id'),
        workspaceId: readString(row.workspace_id, 'workspace_id'),
        epoch: readNumber(row.epoch, 'epoch'),
      }));
  }

  async markOutboxDelivered(outboxIds: readonly string[], now: number): Promise<void> {
    if (outboxIds.length === 0) return;
    await this.serialized(async () => {
      this.storage.transactionSync(() => {
        for (const id of outboxIds) {
          this.storage.sql.exec(
            `UPDATE room_outbox SET delivered_at = ? WHERE outbox_id = ? AND delivered_at IS NULL`, now, id,
          );
        }
      });
    });
  }

  listPendingDirectoryChanges(limit = 100): PendingDirectoryChange[] {
    return this.rows(`SELECT id, actor_id, epoch, active FROM room_directory_outbox ORDER BY id LIMIT ?`,
      Math.max(1, Math.min(500, Math.trunc(limit))))
      .map((row) => ({
        id: readNumber(row.id, 'id'),
        actorId: readString(row.actor_id, 'actor_id'),
        epoch: readNumber(row.epoch, 'epoch'),
        active: row.active === 1,
      }));
  }

  async markDirectorySynced(ids: readonly number[]): Promise<void> {
    if (ids.length === 0) return;
    await this.serialized(async () => {
      this.storage.transactionSync(() => {
        for (const id of ids) this.storage.sql.exec('DELETE FROM room_directory_outbox WHERE id = ?', id);
      });
    });
  }

  hasPendingDirectoryChanges(): boolean {
    return this.rows('SELECT id FROM room_directory_outbox LIMIT 1').length > 0;
  }

  pendingOutboxCount(): number {
    return readNumber(this.rows<{ count: SqlStorageValue }>(
      'SELECT COUNT(*) AS count FROM room_outbox WHERE delivered_at IS NULL',
    )[0]?.count ?? 0, 'count');
  }

  projectionSeed(workspace: StoredWorkspace, actorId: string): ActorContext | null {
    const row = this.rows(
      `SELECT actor_id, actor_name, role, seat, created_at, revoked_at FROM room_memberships
       WHERE workspace_id = ? AND epoch = ? AND actor_id = ? AND revoked_at IS NULL`,
      workspace.id, workspace.epoch, actorId,
    )[0];
    if (!row) return null;
    const member = mapMember(row);
    return {
      actorId: member.actorId,
      name: member.name,
      role: member.role,
      ...(member.seat ? { seat: member.seat } : {}),
      workspaceId: workspace.id,
      epoch: workspace.epoch,
      now: Date.now(),
      hash: hashValue,
    };
  }
}
