import { randomUUID } from 'node:crypto';
import { describe, it } from 'vitest';
import type { ApiError, CommandEnvelope, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { AuthorityError } from './errors.js';
import { createPGliteDatabase } from './database.js';
import { sha256 } from './codec.js';
import { migrateDatabase } from './migrations.js';
import { CommandAuthority, type AuthenticatedSession } from './authority.js';
import { SqlWorkspaceRepository, type SessionRecord, type WorkspaceTransaction } from './repository.js';
import {
  repositoryConformanceScenarios,
  type RepositoryConformanceAdapter,
  type RepositoryConformanceFault,
  type RepositoryConformanceResult,
  type RepositoryConformanceState,
} from '../tests/support/repository-conformance.js';

const REVOKED_ACTOR_ID = '00000000-0000-4000-8000-000000000099';

async function createSqlAdapter(): Promise<RepositoryConformanceAdapter> {
  const database = createPGliteDatabase();
  await migrateDatabase(database, 'local');
  const repository = new SqlWorkspaceRepository(database);
  const authority = new CommandAuthority({ repository });
  const now = Date.now();
  const actorId = randomUUID();
  const record: SessionRecord = {
    tokenHash: sha256(`test-token:${randomUUID()}`),
    csrfHash: sha256(`test-csrf:${randomUUID()}`),
    actorId,
    name: 'Repository conformance owner',
    createdAt: now,
    lastSeenAt: now,
    hardExpiresAt: now + 60 * 60 * 1_000,
    revokedAt: null,
    workspaceId: null,
    rotatedToTokenHash: null,
    rotationTicketHash: null,
  };
  await repository.createSession(record);
  const ownerSession: AuthenticatedSession = {
    record,
    csrfToken: 'test-csrf-token',
    expiresAt: record.hardExpiresAt,
  };
  const created = await authority.createWorkspace(ownerSession, { kind: 'teaching', title: 'Repository conformance' });
  const workspaceId = created.id;
  await database.query(
    `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)`,
    [workspaceId, created.epoch, REVOKED_ACTOR_ID, 'Conformance learner', 'learner', 'learner-1', now],
  );

  async function inspect(): Promise<RepositoryConformanceState> {
    const workspaceResult = await database.query<{ epoch: number; revision: number; state_hash: string }>(
      'SELECT epoch, revision, state_hash FROM workspaces WHERE id = $1', [workspaceId],
    );
    const workspace = workspaceResult.rows[0];
    if (!workspace) throw new Error('REPOSITORY_CONFORMANCE_WORKSPACE_MISSING');
    const snapshotResult = await database.query<{ epoch: number; revision: number; state_hash: string }>(
      'SELECT epoch, revision, state_hash FROM snapshots WHERE workspace_id = $1 ORDER BY epoch, revision', [workspaceId],
    );
    const eventResult = await database.query<{ event_id: string; epoch: number; actor_id: string; command_id: string }>(
      'SELECT event_id, epoch, actor_id, command_id FROM events WHERE workspace_id = $1 ORDER BY epoch, workspace_sequence', [workspaceId],
    );
    const receiptResult = await database.query<{ epoch: number; actor_id: string; command_id: string; payload_hash: string; event_id: string }>(
      'SELECT epoch, actor_id, command_id, payload_hash, event_id FROM commands WHERE workspace_id = $1 ORDER BY epoch, command_id', [workspaceId],
    );
    const outboxResult = await database.query<{ outbox_id: string; epoch: number; event_id: string }>(
      'SELECT outbox_id, epoch, event_id FROM outbox WHERE workspace_id = $1 ORDER BY epoch, outbox_id', [workspaceId],
    );
    return {
      workspace: { epoch: workspace.epoch, revision: workspace.revision, stateHash: workspace.state_hash },
      snapshots: snapshotResult.rows.map((row) => ({ epoch: row.epoch, revision: row.revision, stateHash: row.state_hash })),
      events: eventResult.rows.map((row) => ({ eventId: row.event_id, epoch: row.epoch, actorId: row.actor_id, commandId: row.command_id })),
      receipts: receiptResult.rows.map((row) => ({
        epoch: row.epoch, actorId: row.actor_id, commandId: row.command_id, payloadHash: row.payload_hash, eventId: row.event_id,
      })),
      outbox: outboxResult.rows.map((row) => ({ outboxId: row.outbox_id, epoch: row.epoch, eventId: row.event_id })),
    };
  }

  async function execute(
    envelope: CommandEnvelope,
    options: { actorId?: string; fault?: RepositoryConformanceFault } = {},
  ): Promise<RepositoryConformanceResult> {
    const originalMethod = repository.withWorkspaceTransaction;
    const originalTransaction = repository.withWorkspaceTransaction.bind(repository);
    if (options.fault?.kind === 'callback-after-command') {
      repository.withWorkspaceTransaction = <T>(
        id: string,
        operation: (transaction: WorkspaceTransaction) => Promise<T>,
      ): Promise<T> => originalTransaction(id, async (transaction) => {
        await operation(transaction);
        throw new Error('REPOSITORY_CONFORMANCE_CALLBACK_FAILURE');
      });
    } else if (options.fault?.kind === 'outbox-id-collision') {
      const { outboxId } = options.fault;
      repository.withWorkspaceTransaction = <T>(
        id: string,
        operation: (transaction: WorkspaceTransaction) => Promise<T>,
      ): Promise<T> => originalTransaction(id, (transaction) => {
        const commitCommand = transaction.commitCommand.bind(transaction);
        transaction.commitCommand = (commit) => commitCommand({ ...commit, outboxId });
        return operation(transaction);
      });
    }

    try {
      const session: AuthenticatedSession = {
        ...ownerSession,
        record: { ...ownerSession.record, actorId: options.actorId ?? ownerSession.record.actorId },
      };
      const ack = await authority.execute(session, envelope, workspaceId);
      return { kind: 'success', ack };
    } catch (error) {
      const apiError: ApiError = error instanceof AuthorityError
        ? { ok: false, errorCode: error.code, message: error.message }
        : { ok: false, errorCode: 'STORAGE_FAILURE', message: 'The repository operation failed.' };
      return { kind: 'error', error: apiError };
    } finally {
      repository.withWorkspaceTransaction = originalMethod;
    }
  }

  return {
    workspaceId,
    revokedActorId: REVOKED_ACTOR_ID,
    async currentView(): Promise<WorkspaceView> {
      const authorized = await authority.authorizeSession(ownerSession, workspaceId);
      return authorized.workspace;
    },
    execute,
    inspect,
    async revokeMember(memberActorId: string): Promise<void> {
      await repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
        const member = await transaction.getMember(memberActorId);
        if (!member) throw new Error('REPOSITORY_CONFORMANCE_MEMBER_MISSING');
        await transaction.revokeMember(memberActorId, Date.now());
      });
    },
    async close(): Promise<void> {
      await authority.closeComputeJobs();
      await repository.close();
    },
  };
}

describe('SqlWorkspaceRepository conformance', () => {
  for (const scenario of repositoryConformanceScenarios()) {
    it(scenario.name, async () => {
      const adapter = await createSqlAdapter();
      try {
        await scenario.run(adapter);
      } finally {
        await adapter.close();
      }
    });
  }
});
