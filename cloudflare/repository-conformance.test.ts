import { randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, it } from 'vitest';
import type { ApiError, CommandEnvelope, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { readNumber, readString, sha256 } from '../server/codec.js';
import { AuthorityError } from '../server/errors.js';
import type { AuthenticatedSession } from '../server/authority.js';
import type { SessionRecord, WorkspaceTransaction } from '../server/repository.js';
import {
  repositoryConformanceScenarios,
  type RepositoryConformanceAdapter,
  type RepositoryConformanceFault,
  type RepositoryConformanceResult,
  type RepositoryConformanceState,
} from '../tests/support/repository-conformance.js';
import type { Env } from './contracts.js';
import type { Room } from './room.js';

const runtime = env as Env;
const REVOKED_ACTOR_ID = '00000000-0000-4000-8000-000000000099';

async function createRoomAdapter(): Promise<RepositoryConformanceAdapter> {
  const workspaceId = randomUUID();
  const stub = runtime.ROOMS.get(runtime.ROOMS.idFromName(workspaceId)) as DurableObjectStub<Room>;
  const now = Date.now();
  const record: SessionRecord = {
    tokenHash: sha256(`test-token:${randomUUID()}`),
    csrfHash: sha256(`test-csrf:${randomUUID()}`),
    actorId: randomUUID(),
    name: 'Repository conformance owner',
    createdAt: now,
    lastSeenAt: now,
    hardExpiresAt: now + 60 * 60 * 1_000,
    revokedAt: null,
    workspaceId: null,
    rotatedToTokenHash: null,
    rotationTicketHash: null,
  };
  const ownerSession: AuthenticatedSession = { record, csrfToken: 'test-csrf-token', expiresAt: record.hardExpiresAt };
  const created = await runInDurableObject(stub, (instance) => {
    instance.repository.bindRoomId(workspaceId);
    return instance.authority.createWorkspace(ownerSession, { kind: 'teaching', title: 'Repository conformance' });
  });
  await runInDurableObject(stub, (instance) => {
    instance.repository.storage.sql.exec(
      `INSERT INTO room_memberships(workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
      workspaceId, created.epoch, REVOKED_ACTOR_ID, 'Conformance learner', 'learner', 'learner-1', now,
    );
  });

  async function inspect(): Promise<RepositoryConformanceState> {
    return runInDurableObject(stub, async (instance) => {
      const workspace = await instance.repository.getWorkspace(workspaceId);
      if (!workspace) throw new Error('REPOSITORY_CONFORMANCE_WORKSPACE_MISSING');
      const snapshots = instance.repository.storage.sql.exec<Record<string, SqlStorageValue>>(
        'SELECT epoch, revision, state_hash FROM room_snapshots WHERE workspace_id = ? ORDER BY epoch, revision', workspaceId,
      ).toArray();
      const events = instance.repository.storage.sql.exec<Record<string, SqlStorageValue>>(
        'SELECT event_id, epoch, actor_id, command_id FROM room_events WHERE workspace_id = ? ORDER BY epoch, workspace_sequence', workspaceId,
      ).toArray();
      const receipts = instance.repository.storage.sql.exec<Record<string, SqlStorageValue>>(
        'SELECT epoch, actor_id, command_id, payload_hash, event_id FROM room_commands WHERE workspace_id = ? ORDER BY epoch, command_id', workspaceId,
      ).toArray();
      const outbox = instance.repository.storage.sql.exec<Record<string, SqlStorageValue>>(
        'SELECT outbox_id, epoch, event_id FROM room_outbox WHERE workspace_id = ? ORDER BY epoch, outbox_id', workspaceId,
      ).toArray();
      return {
        workspace: { epoch: workspace.epoch, revision: workspace.revision, stateHash: workspace.stateHash },
        snapshots: snapshots.map((row) => ({
          epoch: readNumber(row.epoch, 'epoch'),
          revision: readNumber(row.revision, 'revision'),
          stateHash: readString(row.state_hash, 'state_hash'),
        })),
        events: events.map((row) => ({
          eventId: readString(row.event_id, 'event_id'),
          epoch: readNumber(row.epoch, 'epoch'),
          actorId: readString(row.actor_id, 'actor_id'),
          commandId: readString(row.command_id, 'command_id'),
        })),
        receipts: receipts.map((row) => ({
          epoch: readNumber(row.epoch, 'epoch'),
          actorId: readString(row.actor_id, 'actor_id'),
          commandId: readString(row.command_id, 'command_id'),
          payloadHash: readString(row.payload_hash, 'payload_hash'),
          eventId: readString(row.event_id, 'event_id'),
        })),
        outbox: outbox.map((row) => ({
          outboxId: readString(row.outbox_id, 'outbox_id'),
          epoch: readNumber(row.epoch, 'epoch'),
          eventId: readString(row.event_id, 'event_id'),
        })),
      };
    });
  }

  async function execute(
    envelope: CommandEnvelope,
    options: { actorId?: string; fault?: RepositoryConformanceFault } = {},
  ): Promise<RepositoryConformanceResult> {
    return runInDurableObject(stub, async (instance) => {
      const repository = instance.repository;
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

      const session: AuthenticatedSession = {
        ...ownerSession,
        record: { ...ownerSession.record, actorId: options.actorId ?? ownerSession.record.actorId },
      };
      try {
        return { kind: 'success', ack: await instance.authority.execute(session, envelope, workspaceId) };
      } catch (error) {
        const apiError: ApiError = error instanceof AuthorityError
          ? { ok: false, errorCode: error.code, message: error.message }
          : { ok: false, errorCode: 'STORAGE_FAILURE', message: 'The repository operation failed.' };
        return { kind: 'error', error: apiError };
      } finally {
        repository.withWorkspaceTransaction = originalMethod;
      }
    });
  }

  return {
    workspaceId,
    revokedActorId: REVOKED_ACTOR_ID,
    async currentView(): Promise<WorkspaceView> {
      return runInDurableObject(stub, async (instance) =>
        (await instance.authority.authorizeSession(ownerSession, workspaceId)).workspace);
    },
    execute,
    inspect,
    async revokeMember(memberActorId: string): Promise<void> {
      await runInDurableObject(stub, async (instance) => {
        await instance.repository.withWorkspaceTransaction(workspaceId, async (transaction) => {
          const member = await transaction.getMember(memberActorId);
          if (!member) throw new Error('REPOSITORY_CONFORMANCE_MEMBER_MISSING');
          await transaction.revokeMember(memberActorId, Date.now());
        });
      });
    },
    close(): Promise<void> {
      return Promise.resolve();
    },
  };
}

describe('RoomRepository conformance', () => {
  for (const scenario of repositoryConformanceScenarios()) {
    it(scenario.name, async () => {
      const adapter = await createRoomAdapter();
      try {
        await scenario.run(adapter);
      } finally {
        await adapter.close();
      }
    });
  }
});
