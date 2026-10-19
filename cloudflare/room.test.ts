import { randomBytes, randomUUID } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Room } from './room.js';
import type { Env } from './contracts.js';
import { csrfForToken } from './auth.js';
import { canonicalJson, sha256 } from '../server/codec.js';
import { DomainError, type CommandAck, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import type { PendingDirectoryChange } from './room-repository.js';
import { proposeChange } from './ai.js';
import type { AIProposalRequest, AIProposalResult } from './ai.js';

vi.mock('./ai.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./ai.js')>();
  return { ...actual, proposeChange: vi.fn(actual.proposeChange) };
});

const runtime = env as Env;
const migrationEnv = env as Env & { TEST_MIGRATION: string };
const ORIGIN = 'https://tabletop.test';
const MODEL_RECOVERY_DELAY_MS = 120_000;
const MODEL_TEST_DELAY_MS = 100;
const MODEL_RACE_DELAY_MS = MODEL_TEST_DELAY_MS * 4;
const MODEL_WAIT_ATTEMPTS = 50;
const MODEL_WAIT_INTERVAL_MS = 10;

interface TestActor {
  id: string;
  name: string;
  token: string;
  csrf: string;
}

interface PublicError {
  ok: false;
  errorCode: string;
}

interface TestModelJob {
  id: string;
  status: 'running' | 'completed' | 'failed';
  message?: string;
  candidateId?: string;
}

interface RoomDirectoryTestAccess {
  syncDirectory(): Promise<void>;
  syncDirectoryChange(change: PendingDirectoryChange): Promise<void>;
}

function newActor(name: string): TestActor {
  const id = randomUUID();
  const token = randomBytes(32).toString('base64url');
  return { id, name, token, csrf: csrfForToken(token) };
}

async function saveActor(actor: TestActor): Promise<void> {
  const now = Date.now();
  await runtime.DB.prepare(`INSERT INTO users(id, provider_sub, email, name, is_admin, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`).bind(actor.id, `test:${actor.id}`, `${actor.id}@example.test`, actor.name, now).run();
  await runtime.DB.prepare(`INSERT INTO web_sessions(token_hash, csrf_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(
    sha256(actor.token), sha256(actor.csrf), actor.id, now, now, now + 7 * 24 * 60 * 60 * 1000,
  ).run();
}

function roomStub(roomId: string): DurableObjectStub<Room> {
  return runtime.ROOMS.get(runtime.ROOMS.idFromName(roomId)) as DurableObjectStub<Room>;
}

async function enableTableReadOnly(stub: DurableObjectStub<Room>): Promise<void> {
  const updated = await runInDurableObject(stub, (instance) => {
    const current = Reflect.get(instance, 'env');
    if (typeof current !== 'object' || current === null) return false;
    const readOnlyEnv = new Proxy(current, {
      get(target, property, receiver) {
        return property === 'TABLE_READ_ONLY' ? 'true' : Reflect.get(target, property, receiver);
      },
    });
    return Reflect.set(instance, 'env', readOnlyEnv);
  });
  if (!updated) throw new Error('TABLE_READ_ONLY_TEST_ENV_UNAVAILABLE');
}

function modelJobId(workspaceId: string, epoch: number, actorId: string, commandId: string): string {
  return sha256(`tabletop-ai-job-v1:${canonicalJson({ actorId, workspaceId, epoch, commandId })}`);
}

function modelResult(request: AIProposalRequest): AIProposalResult {
  let change: AIProposalResult['change'];
  if (request.workspace.kind === 'table') {
    if (request.workspace.domain.kind !== 'table' || !request.workspace.domain.sources[0]) {
      throw new Error('Table proposal fixture requires an imported source.');
    }
    change = equipmentChange(request.workspace.domain.sources[0].id);
  } else {
    change = { kind: 'teaching', parameters: { force: 12, mass: 2, time: 2 } };
  }
  return {
    jobId: modelJobId(request.workspace.id, request.workspace.epoch, request.actorId, request.commandId),
    change,
    usage: { promptTokens: 100, completionTokens: 20, cacheHitTokens: 0, cacheMissTokens: 100 },
  };
}

async function waitForModelJob(
  stub: DurableObjectStub<Room>,
  jobId: string,
  actorId: string,
  workspaceId: string,
  epoch: number,
): Promise<{ status: string; data: Record<string, unknown>; id: string }> {
  for (let attempt = 0; attempt < MODEL_WAIT_ATTEMPTS; attempt += 1) {
    const job = await runInDurableObject(stub, (instance) =>
      instance.repository.getModelJob(jobId, actorId, workspaceId, epoch));
    if (job && job.status !== 'running' && job.status !== 'committing') return job;
    await new Promise<void>((resolve) => setTimeout(resolve, MODEL_WAIT_INTERVAL_MS));
  }
  throw new Error('MODEL_JOB_DID_NOT_FINISH');
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < MODEL_WAIT_ATTEMPTS; attempt += 1) {
    if (condition()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, MODEL_WAIT_INTERVAL_MS));
  }
  throw new Error('MODEL_RACE_POINT_NOT_REACHED');
}

function headers(actor: TestActor, mutation = false): Headers {
  const value = new Headers({
    Cookie: `__Host-tabletop_session=${actor.token}`,
    Origin: ORIGIN,
    'Sec-Fetch-Site': 'same-origin',
  });
  if (mutation) value.set('X-CSRF-Token', actor.csrf);
  return value;
}

async function call<T>(
  stub: DurableObjectStub<Room>,
  path: string,
  actor: TestActor,
  options: { method?: string; body?: unknown; mutation?: boolean } = {},
): Promise<{ response: Response; body: T }> {
  const response = await stub.fetch(new Request(`${ORIGIN}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...Object.fromEntries(headers(actor, options.mutation ?? options.method === 'POST')),
      ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  }));
  return { response, body: await response.json() as T };
}

async function createRoom(actor: TestActor, kind: 'invoice' | 'teaching' | 'encounter' | 'table' = 'teaching') {
  const roomId = randomUUID();
  const stub = roomStub(roomId);
  const result = await call<WorkspaceView>(stub, '/internal/create', actor, {
    method: 'POST',
    body: { id: roomId, kind, title: `Test ${kind}` },
    mutation: true,
  });
  expect(result.response.status).toBe(201);
  expect(result.body.id).toBe(roomId);
  return { roomId, stub, workspace: result.body };
}

async function issueCommand(
  stub: DurableObjectStub<Room>,
  workspace: WorkspaceView,
  actor: TestActor,
  type: string,
  payload: unknown,
  commandId = randomUUID(),
): Promise<{ response: Response; body: CommandAck | PublicError; envelope: Record<string, unknown> }> {
  const envelope = {
    commandId,
    expectedRevision: workspace.revision,
    expectedEpoch: workspace.epoch,
    type,
    payload,
  };
  const result = await call<CommandAck | PublicError>(stub, `/api/workspaces/${workspace.id}/commands`, actor, {
    method: 'POST', body: envelope, mutation: true,
  });
  return { ...result, envelope };
}

async function inspectRoom<T>(stub: DurableObjectStub<Room>, query: string): Promise<T[]> {
  return runInDurableObject(stub, (instance) => instance.repository.storage.sql.exec<T & Record<string, SqlStorageValue>>(query).toArray());
}

function migrationStatements(raw: string, appendFailure = false): string[] {
  const isolated = raw
    .replaceAll('room_members_legacy', '__LEGACY_MEMBERS__')
    .replaceAll('rooms_legacy', '__LEGACY_ROOMS__')
    .replaceAll('room_members', 'table_migration_room_members')
    .replaceAll('rooms', 'table_migration_rooms')
    .replaceAll('users', 'table_migration_users')
    .replaceAll('__LEGACY_MEMBERS__', 'table_migration_room_members_legacy')
    .replaceAll('__LEGACY_ROOMS__', 'table_migration_rooms_legacy');
  const statements = isolated.replace(/^--.*$/gmu, '').split(';').map((statement) => statement.trim()).filter(Boolean);
  return appendFailure ? [...statements, 'SELECT missing_column FROM table_migration_rooms'] : statements;
}

describe('Cloudflare room Durable Object', () => {
  beforeEach(async () => {
    vi.mocked(proposeChange).mockReset();
  });

  it('rebuilds the D1 room-kind constraint without losing room or membership rows and rolls back a failed batch', async () => {
    await runtime.DB.batch([
      runtime.DB.prepare('CREATE TABLE table_migration_users (id TEXT PRIMARY KEY)'),
      runtime.DB.prepare(`CREATE TABLE table_migration_rooms (
        id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES table_migration_users(id),
        kind TEXT NOT NULL CHECK (kind IN ('invoice', 'teaching', 'encounter')), created_at INTEGER NOT NULL
      )`),
      runtime.DB.prepare(`CREATE TABLE table_migration_room_members (
        user_id TEXT NOT NULL REFERENCES table_migration_users(id),
        room_id TEXT NOT NULL REFERENCES table_migration_rooms(id), epoch INTEGER NOT NULL,
        active INTEGER NOT NULL CHECK (active IN (0, 1)), directory_sequence INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY(user_id, room_id)
      )`),
      runtime.DB.prepare('CREATE INDEX table_migration_room_members_room_idx ON table_migration_room_members(room_id, active)'),
      runtime.DB.prepare('INSERT INTO table_migration_users(id) VALUES (?)').bind('legacy-owner'),
      runtime.DB.prepare('INSERT INTO table_migration_rooms(id, owner_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .bind('legacy-room', 'legacy-owner', 'invoice', 10),
      runtime.DB.prepare('INSERT INTO table_migration_room_members(user_id, room_id, epoch, active, directory_sequence) VALUES (?, ?, ?, ?, ?)')
        .bind('legacy-owner', 'legacy-room', 4, 1, 12),
    ]);

    try {
      const failed = migrationStatements(migrationEnv.TEST_MIGRATION, true);
      await expect(runtime.DB.batch(failed.map((statement) => runtime.DB.prepare(statement)))).rejects.toThrow();
      const beforeRetry = await runtime.DB.prepare(
        'SELECT kind FROM table_migration_rooms WHERE id = ?',
      ).bind('legacy-room').first<{ kind: string }>();
      expect(beforeRetry?.kind).toBe('invoice');
      const priorMembers = await runtime.DB.prepare(
        'SELECT user_id, room_id, epoch, active, directory_sequence FROM table_migration_room_members',
      ).all<{ user_id: string; room_id: string; epoch: number; active: number; directory_sequence: number }>();
      expect(priorMembers.results).toEqual([{
        user_id: 'legacy-owner', room_id: 'legacy-room', epoch: 4, active: 1, directory_sequence: 12,
      }]);

      const statements = migrationStatements(migrationEnv.TEST_MIGRATION);
      await runtime.DB.batch(statements.map((statement) => runtime.DB.prepare(statement)));
      const migratedRoom = await runtime.DB.prepare(
        'SELECT kind FROM table_migration_rooms WHERE id = ?',
      ).bind('legacy-room').first<{ kind: string }>();
      expect(migratedRoom?.kind).toBe('invoice');
      const migratedMember = await runtime.DB.prepare(
        'SELECT user_id, room_id, epoch, active, directory_sequence FROM table_migration_room_members',
      ).all<{ user_id: string; room_id: string; epoch: number; active: number; directory_sequence: number }>();
      expect(migratedMember.results).toEqual([{
        user_id: 'legacy-owner', room_id: 'legacy-room', epoch: 4, active: 1, directory_sequence: 12,
      }]);
      await runtime.DB.prepare('INSERT INTO table_migration_rooms(id, owner_id, kind, created_at) VALUES (?, ?, ?, ?)')
        .bind('new-table-room', 'legacy-owner', 'table', 20).run();
      const foreignKeyErrors = await runtime.DB.prepare('PRAGMA foreign_key_check(table_migration_room_members)').all();
      expect(foreignKeyErrors.results).toHaveLength(0);
    } finally {
      await runtime.DB.batch([
        runtime.DB.prepare('DROP TABLE IF EXISTS table_migration_room_members_legacy'),
        runtime.DB.prepare('DROP TABLE IF EXISTS table_migration_rooms_legacy'),
        runtime.DB.prepare('DROP TABLE IF EXISTS table_migration_room_members'),
        runtime.DB.prepare('DROP TABLE IF EXISTS table_migration_rooms'),
        runtime.DB.prepare('DROP TABLE IF EXISTS table_migration_users'),
      ]);
    }
  });

  it('creates table rooms, invites seated participants, runs guarded AI and CAS actions, then resumes with private sources intact', async () => {
    const owner = newActor('Table owner');
    const firstMember = newActor('First participant');
    const secondMember = newActor('Second participant');
    await Promise.all([saveActor(owner), saveActor(firstMember), saveActor(secondMember)]);
    const { roomId, stub } = await createRoom(owner, 'table');

    for (const [actor, seat] of [[firstMember, 'member-1'], [secondMember, 'member-2']] as const) {
      const invitation = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
        method: 'POST', body: { seat }, mutation: true,
      });
      expect(invitation.response.status).toBe(201);
      const ticket = invitation.body.ticket.slice(`${roomId}_`.length);
      const redeemed = await call<WorkspaceView>(stub, '/internal/redeem', actor, {
        method: 'POST', body: { ticket }, mutation: true,
      });
      expect(redeemed.response.status).toBe(200);
      expect(redeemed.body.actor).toMatchObject({ role: 'participant', seat });
    }

    const ownerStart = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const privateText = `${tableScenarioSources.equipment.text}\nPRIVATE_TABLE_SOURCE_SENTINEL`;
    const imported = await issueCommand(stub, ownerStart.body, owner, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: privateText,
    });
    expect(imported.response.status).toBe(200);
    if (!('ok' in imported.body) || !imported.body.ok || imported.body.workspace.domain.kind !== 'table') {
      throw new Error('Expected owner table import acknowledgement.');
    }
    const sourceId = imported.body.workspace.domain.sources[0]?.id;
    expect(sourceId).toBeTruthy();

    const participantStart = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, firstMember);
    expect(JSON.stringify(participantStart.body)).not.toContain('PRIVATE_TABLE_SOURCE_SENTINEL');
    if (participantStart.body.domain.kind !== 'table') throw new Error('Expected participant table projection.');
    expect(participantStart.body.domain.sources).toEqual([]);
    const ownerOnlyImport = await issueCommand(stub, participantStart.body, firstMember, 'table.import', {
      filename: 'another.txt', text: 'This must be rejected for participants.',
    });
    expect(ownerOnlyImport.response.status).toBe(403);

    const eventRows = await inspectRoom<{ event_data: SqlStorageValue }>(stub,
      "SELECT event_data FROM room_events WHERE event_type = 'table.import'");
    expect(eventRows).toHaveLength(1);
    expect(String(eventRows[0]?.event_data)).not.toContain('PRIVATE_TABLE_SOURCE_SENTINEL');
    expect(String(eventRows[0]?.event_data)).toContain('sourceId');

    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => modelResult(request));
    const ownerInput = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const proposalInput = {
      commandId: randomUUID(),
      expectedRevision: ownerInput.body.revision,
      expectedEpoch: ownerInput.body.epoch,
      prompt: 'Set up a safe community equipment lending table.',
      consent: true,
    };
    const expectedJobId = modelJobId(roomId, ownerInput.body.epoch, owner.id, proposalInput.commandId);
    const queued = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: proposalInput, mutation: true,
    });
    expect(queued.response.status).toBe(202);
    const proposalJob = await waitForModelJob(stub, expectedJobId, owner.id, roomId, ownerInput.body.epoch);
    expect(proposalJob.status).toBe('completed');
    expect(JSON.stringify(proposalJob.data)).not.toContain(privateText);

    let ownerView = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(ownerView.body.domain.candidate).toMatchObject({ status: 'draft' });
    const participantDraft = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, firstMember);
    expect(participantDraft.body.domain.candidate).toBeNull();
    expect(JSON.stringify(participantDraft.body)).not.toContain('PRIVATE_TABLE_SOURCE_SENTINEL');
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) {
      const step = await issueCommand(stub, ownerView.body, owner, type, {});
      expect(step.response.status).toBe(200);
      if (!('ok' in step.body) || !step.body.ok) throw new Error(`Expected ${type} acknowledgement.`);
      ownerView = { response: ownerView.response, body: step.body.workspace };
    }

    const firstView = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, firstMember);
    const secondView = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, secondMember);
    const racedActions = await Promise.all([
      issueCommand(stub, firstView.body, firstMember, 'table.act', { actionId: 'borrow', inputs: { item: 'camera' } }),
      issueCommand(stub, secondView.body, secondMember, 'table.act', { actionId: 'borrow', inputs: { item: 'camera' } }),
    ]);
    expect(racedActions.filter((result) => result.response.status === 200)).toHaveLength(1);
    expect(racedActions.filter((result) => result.response.status === 409)).toHaveLength(1);

    const loser = racedActions[0]!.response.status === 409 ? firstMember : secondMember;
    const loserView = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, loser);
    const duplicateReservation = await issueCommand(stub, loserView.body, loser, 'table.act', { actionId: 'borrow', inputs: { item: 'camera' } });
    expect(duplicateReservation.response.status).toBe(422);
    expect((duplicateReservation.body as PublicError).errorCode).toBe('TABLE_CONDITION');

    expect(await evictDurableObject(stub)).toBeUndefined();
    const resumedOwner = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const resumedParticipant = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, firstMember);
    expect(resumedOwner.response.status).toBe(200);
    expect(resumedOwner.body.domain.kind).toBe('table');
    if (resumedOwner.body.domain.kind !== 'table') throw new Error('Expected resumed owner table.');
    expect(resumedOwner.body.domain.sources[0]?.text).toContain('PRIVATE_TABLE_SOURCE_SENTINEL');
    expect(resumedOwner.body.domain.records.equipment?.find((row) => row.id === 'camera')?.values.available).toBe(false);
    expect(JSON.stringify(resumedParticipant.body)).not.toContain('PRIVATE_TABLE_SOURCE_SENTINEL');

    const lateParticipant = newActor('Late participant');
    await saveActor(lateParticipant);
    const pendingInvite = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'member-3' }, mutation: true,
    });
    expect(pendingInvite.response.status).toBe(201);
    await enableTableReadOnly(stub);

    const ownerWhileReadOnly = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const participantWhileReadOnly = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, firstMember);
    expect(ownerWhileReadOnly.response.status).toBe(200);
    expect(ownerWhileReadOnly.body.domain).toEqual(resumedOwner.body.domain);
    expect(participantWhileReadOnly.response.status).toBe(200);
    expect(participantWhileReadOnly.body.domain.kind).toBe('table');
    if (participantWhileReadOnly.body.domain.kind !== 'table') throw new Error('Expected read-only participant table.');
    expect(participantWhileReadOnly.body.domain.sources).toEqual([]);
    expect(participantWhileReadOnly.body.domain.records).toEqual(resumedParticipant.body.domain.kind === 'table'
      ? resumedParticipant.body.domain.records : {});

    const rejectedCommands = await Promise.all([
      issueCommand(stub, ownerWhileReadOnly.body, owner, 'table.import', {
        filename: 'late-source.txt', text: 'This change must be blocked.',
      }),
      issueCommand(stub, ownerWhileReadOnly.body, owner, 'evolve.propose', {
        change: equipmentChange(sourceId!),
      }),
      issueCommand(stub, ownerWhileReadOnly.body, owner, 'workspace.reset', {}),
    ]);
    for (const rejected of rejectedCommands) {
      expect(rejected.response.status).toBe(403);
      expect(rejected.body).toMatchObject({ ok: false, errorCode: 'TABLE_READ_ONLY' });
    }

    const rejectedInvite = await call<PublicError>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'member-4' }, mutation: true,
    });
    expect(rejectedInvite.response.status).toBe(403);
    expect(rejectedInvite.body.errorCode).toBe('TABLE_READ_ONLY');
    const rejectedRedemption = await call<PublicError>(stub, '/internal/redeem', lateParticipant, {
      method: 'POST', body: { ticket: pendingInvite.body.ticket.slice(`${roomId}_`.length) }, mutation: true,
    });
    expect(rejectedRedemption.response.status).toBe(403);
    expect(rejectedRedemption.body.errorCode).toBe('TABLE_READ_ONLY');
    const rejectedProposal = await call<PublicError>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', mutation: true,
      body: { commandId: randomUUID(), expectedRevision: ownerWhileReadOnly.body.revision,
        expectedEpoch: ownerWhileReadOnly.body.epoch, prompt: 'Suggest a safe table rule.', consent: true },
    });
    expect(rejectedProposal.response.status).toBe(403);
    expect(rejectedProposal.body.errorCode).toBe('TABLE_READ_ONLY');
    const afterReadOnlyAttempts = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(afterReadOnlyAttempts.body.domain).toEqual(ownerWhileReadOnly.body.domain);
    expect(afterReadOnlyAttempts.body.members).toHaveLength(3);

    const newOwner = newActor('Read-only table creation owner');
    await saveActor(newOwner);
    const newRoomId = randomUUID();
    const newStub = roomStub(newRoomId);
    await enableTableReadOnly(newStub);
    const rejectedCreation = await call<PublicError>(newStub, '/internal/create', newOwner, {
      method: 'POST', body: { id: newRoomId, kind: 'table' }, mutation: true,
    });
    expect(rejectedCreation.response.status).toBe(403);
    expect(rejectedCreation.body.errorCode).toBe('TABLE_READ_ONLY');

    const teachingOwner = newActor('Teaching remains writable');
    await saveActor(teachingOwner);
    const teaching = await createRoom(teachingOwner, 'teaching');
    await enableTableReadOnly(teaching.stub);
    const teachingUpdate = await issueCommand(teaching.stub, teaching.workspace, teachingOwner, 'teaching.setParameters', {
      force: 12, mass: 2, time: 2,
    });
    expect(teachingUpdate.response.status).toBe(200);
  });

  it('creates in its canonical named DO, isolates actors, and rejects forged target room IDs', async () => {
    const owner = newActor('Teacher');
    const outsider = newActor('Outsider');
    await Promise.all([saveActor(owner), saveActor(outsider)]);
    const { roomId, stub, workspace } = await createRoom(owner);

    const ownerRead = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(ownerRead.response.status).toBe(200);
    expect(ownerRead.body.id).toBe(roomId);
    const noCsrf = await call<PublicError>(stub, `/api/workspaces/${roomId}/commands`, owner, {
      method: 'POST', body: { commandId: randomUUID(), expectedRevision: workspace.revision,
        expectedEpoch: workspace.epoch, type: 'workspace.reset', payload: {} }, mutation: false,
    });
    expect(noCsrf.response.status).toBe(403);

    const denied = await call<PublicError>(stub, `/api/workspaces/${roomId}`, outsider);
    expect(denied.response.status).toBe(403);
    const forgedTarget = await call<PublicError>(stub, `/api/workspaces/${randomUUID()}`, owner);
    expect(forgedTarget.response.status).toBe(404);

    const alternateId = randomUUID();
    const alternateStub = roomStub(alternateId);
    const wrongBinding = await call<PublicError>(alternateStub, '/internal/create', owner, {
      method: 'POST', body: { id: roomId, kind: 'teaching' }, mutation: true,
    });
    expect(wrongBinding.response.status).toBe(404);

    const eventView = await call<{ cursor: string; resync: boolean; workspace: WorkspaceView }>(
      stub, `/api/workspaces/${roomId}/events?after=${workspace.revision}`, owner,
    );
    expect(eventView.response.status).toBe(200);
    expect(eventView.body.cursor).toBe(workspace.revision);
    expect(eventView.body.resync).toBe(false);
  });

  it('reissues a lost unused invite only when the owner opts in and the seat is still free', async () => {
    const owner = newActor('Invite owner');
    const outsider = newActor('Not a member');
    const learner = newActor('Invite recipient');
    await Promise.all([saveActor(owner), saveActor(outsider), saveActor(learner)]);
    const { roomId, stub } = await createRoom(owner);
    const lostAcknowledgement = await call<{ ticket: string; expiresAt: number }>(stub,
      `/api/workspaces/${roomId}/invites`, owner, {
        method: 'POST', body: { seat: 'learner-1' }, mutation: true,
      });
    expect(lostAcknowledgement.response.status).toBe(201);

    const unauthorized = await call<PublicError>(stub, `/api/workspaces/${roomId}/invites`, outsider, {
      method: 'POST', body: { seat: 'learner-1', replaceOutstanding: true }, mutation: true,
    });
    expect(unauthorized.response.status).toBe(403);

    const unchangedDefault = await call<PublicError>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'learner-1' }, mutation: true,
    });
    expect(unchangedDefault.response.status).toBe(409);
    expect(unchangedDefault.body.errorCode).toBe('SEAT_UNAVAILABLE');

    const replacement = await call<{ ticket: string; expiresAt: number }>(stub,
      `/api/workspaces/${roomId}/invites`, owner, {
        method: 'POST', body: { seat: 'learner-1', replaceOutstanding: true }, mutation: true,
      });
    expect(replacement.response.status).toBe(201);
    const oldRawTicket = lostAcknowledgement.body.ticket.slice(`${roomId}_`.length);
    const deniedOldTicket = await call<PublicError>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: oldRawTicket }, mutation: true,
    });
    expect(deniedOldTicket.response.status).toBe(403);
    expect(deniedOldTicket.body.errorCode).toBe('INVITE_EXPIRED');

    const newRawTicket = replacement.body.ticket.slice(`${roomId}_`.length);
    const redeemed = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: newRawTicket }, mutation: true,
    });
    expect(redeemed.response.status).toBe(200);
    expect(redeemed.body.actor).toMatchObject({ role: 'learner', seat: 'learner-1' });

    const occupied = await call<PublicError>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'learner-1', replaceOutstanding: true }, mutation: true,
    });
    expect(occupied.response.status).toBe(403);
    expect(occupied.body.errorCode).toBe('INVITE_SEAT_OCCUPIED');
    const hashes = await inspectRoom<Record<string, SqlStorageValue>>(
      stub, 'SELECT ticket_hash FROM room_invitations',
    );
    expect(hashes).toHaveLength(2);
    expect(hashes.some((row) => row.ticket_hash === oldRawTicket || row.ticket_hash === newRawTicket)).toBe(false);
  });

  it('serializes command receipts, rejects stale and mismatched retries, and persists reset scrubbing across eviction', async () => {
    const owner = newActor('Teacher');
    const learner = newActor('Learner');
    await Promise.all([saveActor(owner), saveActor(learner)]);
    const { roomId, stub, workspace } = await createRoom(owner);
    const invoiceOwner = newActor('Invoice owner');
    await saveActor(invoiceOwner);
    const invoiceRoom = await createRoom(invoiceOwner, 'invoice');
    const directImport = await issueCommand(
      invoiceRoom.stub, invoiceRoom.workspace, invoiceOwner, 'invoice.import', {},
    );
    expect(directImport.response.status).toBe(400);
    expect((directImport.body as PublicError).errorCode).toBe('TRUSTED_OPERATION_REQUIRED');

    const invitation = await call<{ ticket: string; expiresAt: number }>(
      stub, `/api/workspaces/${roomId}/invites`, owner,
      { method: 'POST', body: { seat: 'learner-1' }, mutation: true },
    );
    expect(invitation.response.status).toBe(201);
    const rawTicket = invitation.body.ticket.slice(`${roomId}_`.length);
    expect(rawTicket).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    const redeemed = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: rawTicket }, mutation: true,
    });
    expect(redeemed.response.status).toBe(200);
    expect(redeemed.body.actor).toMatchObject({ role: 'learner', seat: 'learner-1' });
    const replay = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: rawTicket }, mutation: true,
    });
    expect(replay.response.status).toBe(200);
    const stolenReplay = await call<PublicError>(stub, '/internal/redeem', owner, {
      method: 'POST', body: { ticket: rawTicket }, mutation: true,
    });
    expect(stolenReplay.response.status).toBe(409);

    const learnerDenied = await issueCommand(stub, redeemed.body, learner, 'teaching.setParameters', { force: 20, mass: 2, time: 2 });
    expect(learnerDenied.response.status).toBe(403);
    const ownerBeforeNote = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const privateNote = await issueCommand(stub, ownerBeforeNote.body, owner,
      'teaching.saveNote', { text: 'private teacher key' });
    expect(privateNote.response.status).toBe(200);
    const ownerAfterNote = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const learnerAfterNote = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, learner);
    expect(ownerAfterNote.body.domain).toHaveProperty('teacherNote', 'private teacher key');
    expect(learnerAfterNote.body.domain).not.toHaveProperty('teacherNote');
    expect(learnerAfterNote.body.revision).toBe(redeemed.body.revision);
    const ownerCurrent = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(ownerCurrent.response.status).toBe(200);

    const envelope = {
      commandId: randomUUID(), expectedRevision: ownerCurrent.body.revision, expectedEpoch: ownerCurrent.body.epoch,
      type: 'teaching.setParameters', payload: { force: 20, mass: 2, time: 2 },
    };
    const race = await Promise.all([
      call<CommandAck | PublicError>(stub, `/api/workspaces/${roomId}/commands`, owner, { method: 'POST', body: envelope, mutation: true }),
      call<CommandAck | PublicError>(stub, `/api/workspaces/${roomId}/commands`, owner, { method: 'POST', body: envelope, mutation: true }),
    ]);
    expect(race.every((item) => item.response.status === 200)).toBe(true);
    const ack = race.map((item) => item.body).find((item): item is CommandAck => 'ok' in item && item.ok) as CommandAck;
    expect(race.filter((item) => (item.body as CommandAck).duplicate).length).toBe(1);

    const mismatch = await call<PublicError>(stub, `/api/workspaces/${roomId}/commands`, owner, {
      method: 'POST', mutation: true,
      body: { ...envelope, payload: { force: 25, mass: 2, time: 2 } },
    });
    expect(mismatch.response.status).toBe(409);
    expect(mismatch.body.errorCode).toBe('IDEMPOTENCY_MISMATCH');

    const stale = await issueCommand(stub, workspace, owner, 'teaching.setParameters', { force: 22, mass: 2, time: 2 });
    expect(stale.response.status).toBe(409);
    expect((stale.body as PublicError).errorCode).toBe('STALE_REVISION');

    await runInDurableObject(stub, (instance) => {
      instance.repository.storage.sql.exec(
        `INSERT INTO model_jobs(id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
         VALUES (?, ?, ?, ?, 'queued', ?, ?, NULL)`,
        randomUUID(), roomId, ack.workspace.epoch, owner.id, JSON.stringify({ prompt: 'old private input' }), Date.now(),
      );
    });
    const reset = await issueCommand(stub, ack.workspace, owner, 'workspace.reset', {});
    expect(reset.response.status).toBe(200);
    const resetAck = reset.body as CommandAck;
    expect(resetAck.workspace.epoch).toBe(workspace.epoch + 1);

    expect(await evictDurableObject(stub)).toBeUndefined();
    const reopened = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(reopened.response.status).toBe(200);
    expect(reopened.body.epoch).toBe(resetAck.workspace.epoch);
    expect(reopened.body.domain).not.toHaveProperty('teacherNote');
    expect(await inspectRoom(stub, 'SELECT * FROM room_snapshots')).toHaveLength(1);
    expect(await inspectRoom(stub, 'SELECT * FROM room_events')).toHaveLength(1);
    const persistedCommands = await inspectRoom<Record<string, SqlStorageValue>>(stub, 'SELECT * FROM room_commands');
    expect(persistedCommands).toHaveLength(1);
    expect(persistedCommands[0]?.command_id).toBe(resetAck.commandId);
    expect(persistedCommands[0]?.epoch).toBe(workspace.epoch);
    const jobs = await inspectRoom<Record<string, SqlStorageValue>>(stub, 'SELECT status, data FROM model_jobs');
    expect(jobs[0]).toMatchObject({ status: 'revoked', data: '{}' });
    const activeMembers = await inspectRoom<Record<string, SqlStorageValue>>(
      stub, 'SELECT actor_id FROM room_memberships WHERE revoked_at IS NULL',
    );
    expect(activeMembers).toHaveLength(1);
    expect(activeMembers[0]?.actor_id).toBe(owner.id);
    await runInDurableObject(stub, (instance) => instance.alarm());
    const directoryMembers = await runtime.DB.prepare(
      'SELECT user_id, epoch, active FROM room_members WHERE room_id = ? ORDER BY user_id',
    ).bind(roomId).all<{ user_id: string; epoch: number; active: number }>();
    expect(directoryMembers.results).toHaveLength(2);
    expect(directoryMembers.results.find((member) => member.user_id === owner.id)).toMatchObject({ epoch: 2, active: 1 });
    expect(directoryMembers.results.find((member) => member.user_id === learner.id)).toMatchObject({ epoch: 2, active: 0 });

    const resetRetry = await call<CommandAck>(stub, `/api/workspaces/${roomId}/commands`, owner, {
      method: 'POST', mutation: true, body: reset.envelope,
    });
    expect(resetRetry.response.status).toBe(200);
    expect(resetRetry.body.duplicate).toBe(true);
    expect(resetRetry.body.workspace.epoch).toBe(resetAck.workspace.epoch);
  });

  it('uses fresh primary session authorization on requests and synchronizes persistent room membership', async () => {
    const owner = newActor('Persistent owner');
    await saveActor(owner);
    const { roomId, stub } = await createRoom(owner);
    await runDurableObjectAlarm(stub);
    const ownerDirectory = await runtime.DB.prepare(
      'SELECT epoch, active FROM room_members WHERE room_id = ? AND user_id = ?',
    ).bind(roomId, owner.id).first<{ epoch: number; active: number }>();
    expect(ownerDirectory).toMatchObject({ epoch: 1, active: 1 });

    await runtime.DB.prepare('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), sha256(owner.token)).run();
    const revoked = await call<PublicError>(stub, `/api/workspaces/${roomId}`, owner);
    expect(revoked.response.status).toBe(401);
    expect(revoked.body.errorCode).toBe('SESSION_EXPIRED');
  });

  it('serializes delayed directory sync across consecutive resets and ignores an older reverse write', async () => {
    const owner = newActor('Directory owner');
    const learner = newActor('Directory learner');
    await Promise.all([saveActor(owner), saveActor(learner)]);
    const { roomId, stub } = await createRoom(owner);
    const invite = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'learner-1' }, mutation: true,
    });
    const redeemed = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: invite.body.ticket.slice(`${roomId}_`.length) }, mutation: true,
    });
    expect(redeemed.response.status).toBe(200);
    await runDurableObjectAlarm(stub);

    let delayedEpochTwoWrite = false;
    let activeWrites = 0;
    let maxConcurrentWrites = 0;
    await runInDurableObject(stub, (instance) => {
      const access = instance as unknown as RoomDirectoryTestAccess;
      const originalSyncChange = access.syncDirectoryChange.bind(instance);
      access.syncDirectoryChange = async (change) => {
        activeWrites += 1;
        maxConcurrentWrites = Math.max(maxConcurrentWrites, activeWrites);
        try {
          if (change.epoch === 2 && !delayedEpochTwoWrite) {
            delayedEpochTwoWrite = true;
            await new Promise<void>((resolve) => setTimeout(resolve, MODEL_TEST_DELAY_MS * 5));
          }
          await originalSyncChange(change);
        } finally {
          activeWrites -= 1;
        }
      };
    });

    const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const resetOne = await issueCommand(stub, current.body, owner, 'workspace.reset', {});
    expect(resetOne.response.status).toBe(200);
    await new Promise<void>((resolve) => setTimeout(resolve, MODEL_TEST_DELAY_MS));
    const resetOneAck = resetOne.body as CommandAck;
    const resetTwo = await issueCommand(stub, resetOneAck.workspace, owner, 'workspace.reset', {});
    expect(resetTwo.response.status).toBe(200);
    expect(delayedEpochTwoWrite).toBe(true);

    await runInDurableObject(stub, (instance) => instance.alarm());
    const latestRows = await runtime.DB.prepare(
      'SELECT user_id, epoch, active FROM room_members WHERE room_id = ? ORDER BY user_id',
    ).bind(roomId).all<{ user_id: string; epoch: number; active: number }>();
    expect(latestRows.results.find((member) => member.user_id === owner.id)).toMatchObject({ epoch: 3, active: 1 });
    expect(latestRows.results.find((member) => member.user_id === learner.id)).toMatchObject({ epoch: 2, active: 0 });
    expect(maxConcurrentWrites).toBe(1);

    await runInDurableObject(stub, async (instance) => {
      const access = instance as unknown as RoomDirectoryTestAccess;
      await access.syncDirectoryChange({ id: 1_000_000, actorId: learner.id, epoch: 4, active: true });
      await access.syncDirectoryChange({ id: 999_999, actorId: learner.id, epoch: 3, active: false });
    });
    const learnerRow = await runtime.DB.prepare(
      'SELECT epoch, active, directory_sequence FROM room_members WHERE room_id = ? AND user_id = ?',
    ).bind(roomId, learner.id).first<{ epoch: number; active: number; directory_sequence: number }>();
    expect(learnerRow).toMatchObject({ epoch: 4, active: 1, directory_sequence: 1_000_000 });
  });

  it('exports invoice results only for the owner and preserves the download contract', async () => {
    const owner = newActor('Invoice owner');
    const outsider = newActor('Invoice outsider');
    await Promise.all([saveActor(owner), saveActor(outsider)]);
    const { roomId, stub } = await createRoom(owner, 'invoice');
    const response = await stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/export?format=csv`, {
      headers: headers(owner),
    }));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tabletop-invoice.csv"');
    expect(await response.text()).toContain('shipment_id');
    const denied = await stub.fetch(new Request(`${ORIGIN}/api/workspaces/${roomId}/export?format=html`, {
      headers: headers(outsider),
    }));
    expect(denied.status).toBe(403);
  });

  it('freezes encounter reaction time with owner-only pause and resume commands', async () => {
    const owner = newActor('Dungeon master');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'encounter');
    expect(workspace.actor.role).toBe('dm');
    const paused = await issueCommand(stub, workspace, owner, 'encounter.pause', {});
    expect(paused.response.status).toBe(200);
    const pausedWorkspace = (paused.body as CommandAck).workspace;
    expect(pausedWorkspace.domain.kind).toBe('encounter');
    if (pausedWorkspace.domain.kind !== 'encounter') throw new Error('EXPECTED_ENCOUNTER');
    expect(pausedWorkspace.domain.paused).toEqual({ at: expect.any(Number), remainingReactionMs: null });

    const blocked = await issueCommand(stub, pausedWorkspace, owner, 'encounter.declareHit', { target: 'mira' });
    expect(blocked.response.status).toBe(422);
    expect((blocked.body as PublicError).errorCode).toBe('ENCOUNTER_PAUSED');
    const resumed = await issueCommand(stub, pausedWorkspace, owner, 'encounter.resume', {});
    expect(resumed.response.status).toBe(200);
    const resumedWorkspace = (resumed.body as CommandAck).workspace;
    if (resumedWorkspace.domain.kind !== 'encounter') throw new Error('EXPECTED_ENCOUNTER');
    expect(resumedWorkspace.domain.paused).toBeUndefined();
    const declared = await issueCommand(stub, resumedWorkspace, owner, 'encounter.declareHit', { target: 'mira' });
    expect(declared.response.status).toBe(200);
    expect(roomId).toBe(resumedWorkspace.id);
  });

  it('scopes model job polling to the active member and epoch, then scrubs it on reset', async () => {
    const owner = newActor('Model owner');
    const outsider = newActor('Model outsider');
    await Promise.all([saveActor(owner), saveActor(outsider)]);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    const jobId = 'a'.repeat(64);
    await runInDurableObject(stub, (instance) => instance.repository.reserveModelJob({
      id: jobId,
      workspaceId: roomId,
      epoch: workspace.epoch,
      actorId: owner.id,
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      requestHash: 'b'.repeat(64),
      now: Date.now(),
    }));
    const ownerPoll = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model/${jobId}`, owner);
    expect(ownerPoll.response.status).toBe(202);
    expect(ownerPoll.body).toMatchObject({ id: jobId, status: 'running' });
    const outsiderPoll = await call<PublicError>(stub, `/api/workspaces/${roomId}/model/${jobId}`, outsider);
    expect(outsiderPoll.response.status).toBe(403);

    const reset = await issueCommand(stub, workspace, owner, 'workspace.reset', {});
    expect(reset.response.status).toBe(200);
    const afterReset = await call<PublicError>(stub, `/api/workspaces/${roomId}/model/${jobId}`, owner);
    expect(afterReset.response.status).toBe(404);
    const stored = await inspectRoom<Record<string, SqlStorageValue>>(stub, 'SELECT status, data FROM model_jobs');
    expect(stored[0]).toMatchObject({ status: 'revoked', data: '{}' });
  });

  it('creates one authorized proposal draft and returns the same candidate receipt on retry', async () => {
    const owner = newActor('AI teacher');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => modelResult(request));
    const input = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.',
      consent: true,
    };
    const expectedId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    expect(accepted.body).toMatchObject({ id: expectedId, status: 'running' });

    const job = await waitForModelJob(stub, expectedId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('completed');
    expect(JSON.stringify(job.data)).not.toContain(input.prompt);
    expect(JSON.stringify(job.data)).not.toContain('change');
    const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(current.body.domain.candidate).toMatchObject({ status: 'draft', createdBy: owner.id });
    const candidateId = current.body.domain.candidate?.id;

    const retry = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(retry.response.status).toBe(200);
    expect(retry.body).toMatchObject({ id: expectedId, status: 'completed', candidateId });
    const mismatch = await call<PublicError>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: { ...input, prompt: 'A changed request must not reuse this receipt.' }, mutation: true,
    });
    expect(mismatch.response.status).toBe(409);
    expect(mismatch.body.errorCode).toBe('IDEMPOTENCY_MISMATCH');
    const poll = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model/${expectedId}`, owner);
    expect(poll.response.status).toBe(200);
    expect(poll.body).toMatchObject({ status: 'completed', candidateId });
  });

  it('maps failed model jobs to actionable safe messages without exposing provider details', async () => {
    const owner = newActor('Table proposal owner');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'table');
    vi.mocked(proposeChange).mockRejectedValue(new DomainError(
      'MODEL_PROVIDER_INPUT_TOO_LARGE', 'PRIVATE_PROVIDER_TEXT_SENTINEL',
    ));
    const input = {
      commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch,
      prompt: 'Suggest a safe lending rule.', consent: true,
    };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const queued = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(queued.response.status).toBe(202);
    const job = await waitForModelJob(stub, jobId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('failed');
    const visible = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model/${jobId}`, owner);
    expect(visible.response.status).toBe(200);
    expect(visible.body.message).toMatch(/shorten them or remove a file/iu);
    expect(JSON.stringify(visible.body)).not.toContain('PRIVATE_PROVIDER_TEXT_SENTINEL');
  });

  it('settles an in-flight table proposal but blocks its commit after read-only mode is enabled', async () => {
    const owner = newActor('Read-only mid-proposal owner');
    await saveActor(owner);
    const { roomId, stub, workspace: emptyWorkspace } = await createRoom(owner, 'table');
    const imported = await issueCommand(stub, emptyWorkspace, owner, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    expect(imported.response.status).toBe(200);
    const readyWorkspace = (imported.body as CommandAck).workspace;
    if (readyWorkspace.domain.kind !== 'table' || readyWorkspace.domain.sources.length !== 1) {
      throw new Error('Expected one imported table source.');
    }
    const sourceId = readyWorkspace.domain.sources[0]!.id;

    let providerIsWaiting = false;
    let releaseProvider = () => {};
    const waitForProvider = new Promise<void>((resolve) => { releaseProvider = resolve; });
    const fixtureUsage = { promptTokens: 100, completionTokens: 20, cacheHitTokens: 25, cacheMissTokens: 75 };
    try {
      vi.mocked(proposeChange).mockImplementation(async (_environment, request) => {
        providerIsWaiting = true;
        await waitForProvider;
        return { ...modelResult(request), usage: fixtureUsage };
      });

      const input = {
        commandId: randomUUID(),
        expectedRevision: readyWorkspace.revision,
        expectedEpoch: readyWorkspace.epoch,
        prompt: 'Create a borrowing and return program from the imported equipment source.',
        consent: true,
      };
      const jobId = modelJobId(roomId, readyWorkspace.epoch, owner.id, input.commandId);
      const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
        method: 'POST', body: input, mutation: true,
      });
      expect(accepted.response.status).toBe(202);
      await waitForCondition(() => providerIsWaiting);

      await enableTableReadOnly(stub);

      const billingStub = runtime.BILLING.get(runtime.BILLING.idFromName('global'));
      const binding = {
        id: jobId,
        actorId: owner.id,
        workspaceId: roomId,
        epoch: readyWorkspace.epoch,
        inputHash: sha256(canonicalJson({ commandId: input.commandId, prompt: input.prompt })),
      };
      const billingRequest = async (path: '/reserve' | '/dispatch' | '/settle', body: unknown): Promise<void> => {
        const response = await billingStub.fetch(`https://billing.internal${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        expect(response.status).toBe(200);
      };
      await billingRequest('/reserve', { ...binding, maxInputTokens: 65_000, maxOutputTokens: 8_192 });
      await billingRequest('/dispatch', binding);
      await billingRequest('/settle', { ...binding, outcome: 'settled', usage: fixtureUsage });

      releaseProvider();

      const job = await waitForModelJob(stub, jobId, owner.id, roomId, readyWorkspace.epoch);
      expect(job.status).toBe('failed');
      expect(job.data.failure).toBe('TABLE_READ_ONLY');
      const visible = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model/${jobId}`, owner);
      expect(visible.body.message).toMatch(/read-only/iu);

      const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
      expect(current.body.domain).toEqual(readyWorkspace.domain);
      const receipt = await runInDurableObject(stub, (instance) => instance.repository.findCommandReceipt(
        roomId, readyWorkspace.epoch, owner.id, input.commandId,
      ));
      expect(receipt).toBeNull();

      const billingJob = await runInDurableObject(billingStub, (_instance, state) => state.storage.sql
        .exec<{
          status: string;
          max_input_tokens: number;
          max_output_tokens: number;
          reserved_micro_usd: number;
          actual_micro_usd: number | null;
          prompt_tokens: number | null;
          completion_tokens: number | null;
          cache_hit_tokens: number | null;
          cache_miss_tokens: number | null;
        }>(`SELECT status, max_input_tokens, max_output_tokens, reserved_micro_usd, actual_micro_usd,
                   prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens
            FROM billing_jobs WHERE id = ?`, jobId).toArray()[0] ?? null);
      expect(billingJob).toMatchObject({
        status: 'settled',
        max_output_tokens: 8_192,
        prompt_tokens: fixtureUsage.promptTokens,
        completion_tokens: fixtureUsage.completionTokens,
        cache_hit_tokens: fixtureUsage.cacheHitTokens,
        cache_miss_tokens: fixtureUsage.cacheMissTokens,
      });
      if (!billingJob || billingJob.actual_micro_usd === null) throw new Error('Expected settled provider usage.');
      expect(billingJob.max_input_tokens).toBeGreaterThan(0);
      expect(billingJob.actual_micro_usd).toBeGreaterThan(0);
      expect(billingJob.actual_micro_usd).toBeLessThanOrEqual(billingJob.reserved_micro_usd);
    } finally {
      releaseProvider();
    }
  });

  it('reconciles a committed proposal when the first completed-job write fails', async () => {
    const owner = newActor('AI completion retry');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => modelResult(request));
    let completionAttempts = 0;
    await runInDurableObject(stub, (instance) => {
      const repository = instance.repository;
      const originalFinish = repository.finishModelJob.bind(repository);
      repository.finishModelJob = async (...args: Parameters<typeof repository.finishModelJob>) => {
        if (args[4] === 'completed') {
          completionAttempts += 1;
          if (completionAttempts === 1) throw new Error('injected completion persistence failure');
        }
        return originalFinish(...args);
      };
    });

    const input = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.',
      consent: true,
    };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    const job = await waitForModelJob(stub, jobId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('completed');
    expect(completionAttempts).toBe(2);
    const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(current.body.domain.candidate).toMatchObject({ status: 'draft', createdBy: owner.id });
  });

  it('serializes timeout failure against proposal commit so a failed job cannot later create a draft', async () => {
    const owner = newActor('AI timeout before command');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => modelResult(request));

    let executeStarted = false;
    await runInDurableObject(stub, (instance) => {
      const originalExecute = instance.authority.executeModelProposal.bind(instance.authority);
      instance.authority.executeModelProposal = async (...args: Parameters<typeof instance.authority.executeModelProposal>) => {
        executeStarted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, MODEL_RACE_DELAY_MS));
        return originalExecute(...args);
      };
    });

    const input = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.',
      consent: true,
    };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    await waitForCondition(() => executeStarted);

    const timedOut = await runInDurableObject(stub, (instance) => instance.repository.failModelJobAfterReceiptCheck(
      jobId, roomId, workspace.epoch, owner.id, 'MODEL_JOB_INTERRUPTED',
    ));
    expect(timedOut).toBe('failed');
    const job = await waitForModelJob(stub, jobId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('failed');
    const receipt = await runInDurableObject(stub, (instance) => instance.repository.findCommandReceipt(
      roomId, workspace.epoch, owner.id, input.commandId,
    ));
    expect(receipt).toBeNull();
    const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(current.body.domain.candidate).toBeNull();
  });

  it('completes a job when timeout recovery runs after the guarded proposal receipt commits', async () => {
    const owner = newActor('AI timeout after command');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => modelResult(request));

    let commandCommitted = false;
    await runInDurableObject(stub, (instance) => {
      const originalExecute = instance.authority.executeModelProposal.bind(instance.authority);
      instance.authority.executeModelProposal = async (...args: Parameters<typeof instance.authority.executeModelProposal>) => {
        const acknowledgement = await originalExecute(...args);
        commandCommitted = true;
        await new Promise<void>((resolve) => setTimeout(resolve, MODEL_RACE_DELAY_MS));
        return acknowledgement;
      };
    });

    const input = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.',
      consent: true,
    };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    await waitForCondition(() => commandCommitted);

    const timedOut = await runInDurableObject(stub, (instance) => instance.repository.failModelJobAfterReceiptCheck(
      jobId, roomId, workspace.epoch, owner.id, 'MODEL_JOB_INTERRUPTED',
    ));
    expect(timedOut).toBe('completed');
    const job = await waitForModelJob(stub, jobId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('completed');
    const current = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    expect(current.body.domain.candidate).toMatchObject({ status: 'draft', createdBy: owner.id });
  });

  it('marks an in-flight model request stale before it can create a draft', async () => {
    const owner = newActor('AI teacher');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => {
      await new Promise<void>((resolve) => setTimeout(resolve, MODEL_TEST_DELAY_MS));
      return modelResult(request);
    });
    const input = { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.', consent: true };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    const changed = await issueCommand(stub, workspace, owner, 'teaching.setParameters', { force: 15, mass: 2, time: 2 });
    expect(changed.response.status).toBe(200);
    const job = await waitForModelJob(stub, jobId, owner.id, roomId, workspace.epoch);
    expect(job.status).toBe('failed');
    expect((await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner)).body.domain.candidate).toBeNull();
  });

  it('revokes an in-flight model request on reset and fails interrupted orphan jobs without retrying a provider call', async () => {
    const owner = newActor('AI teacher');
    await saveActor(owner);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    vi.mocked(proposeChange).mockImplementation(async (_environment, request) => {
      await new Promise<void>((resolve) => setTimeout(resolve, MODEL_TEST_DELAY_MS));
      return modelResult(request);
    });
    const input = { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch,
      prompt: 'Suggest a small lesson adjustment.', consent: true };
    const jobId = modelJobId(roomId, workspace.epoch, owner.id, input.commandId);
    const accepted = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', body: input, mutation: true,
    });
    expect(accepted.response.status).toBe(202);
    const reset = await issueCommand(stub, workspace, owner, 'workspace.reset', {});
    expect(reset.response.status).toBe(200);
    const resetAck = reset.body as CommandAck;
    await new Promise<void>((resolve) => setTimeout(resolve, MODEL_TEST_DELAY_MS + 20));
    const afterReset = await inspectRoom<Record<string, SqlStorageValue>>(stub, 'SELECT status, data FROM model_jobs');
    expect(afterReset[0]).toMatchObject({ status: 'revoked', data: '{}' });

    const orphanId = 'c'.repeat(64);
    await runInDurableObject(stub, (instance) => instance.repository.reserveModelJob({
      id: orphanId,
      workspaceId: roomId,
      epoch: resetAck.workspace.epoch,
      actorId: owner.id,
      commandId: randomUUID(),
      expectedRevision: resetAck.workspace.revision,
      requestHash: 'd'.repeat(64),
      now: Date.now() - MODEL_RECOVERY_DELAY_MS - 1,
    }));
    await runInDurableObject(stub, (instance) => instance.alarm());
    const orphan = await call<TestModelJob>(stub, `/api/workspaces/${roomId}/model/${orphanId}`, owner);
    expect(orphan.response.status).toBe(200);
    expect(orphan.body).toMatchObject({ id: orphanId, status: 'failed' });
  });

  it('requires an eligible model role, explicit consent, and the current opaque revision before reserving work', async () => {
    const owner = newActor('Model teacher');
    const learner = newActor('Model learner');
    await Promise.all([saveActor(owner), saveActor(learner)]);
    const { roomId, stub, workspace } = await createRoom(owner, 'teaching');
    const invite = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'learner-1' }, mutation: true,
    });
    const joined = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: invite.body.ticket.slice(`${roomId}_`.length) }, mutation: true,
    });
    expect(joined.response.status).toBe(200);

    const learnerRequest = await call<PublicError>(stub, `/api/workspaces/${roomId}/model`, learner, {
      method: 'POST', mutation: true,
      body: { commandId: randomUUID(), expectedRevision: joined.body.revision, expectedEpoch: joined.body.epoch,
        prompt: 'Suggest a small change', consent: true },
    });
    expect(learnerRequest.response.status).toBe(403);
    const noConsent = await call<PublicError>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', mutation: true,
      body: { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch,
        prompt: 'Suggest a small change', consent: false },
    });
    expect(noConsent.response.status).toBe(400);
    const stale = await call<PublicError>(stub, `/api/workspaces/${roomId}/model`, owner, {
      method: 'POST', mutation: true,
      body: { commandId: randomUUID(), expectedRevision: '0'.repeat(64), expectedEpoch: workspace.epoch,
        prompt: 'Suggest a small change', consent: true },
    });
    expect(stale.response.status).toBe(409);
    expect((stale.body as PublicError).errorCode).toBe('STALE_REVISION');
    expect(await inspectRoom(stub, 'SELECT * FROM model_jobs')).toHaveLength(0);
  });

  it('revalidates hibernated socket identity before sending a private projection', async () => {
    const owner = newActor('Socket teacher');
    const learner = newActor('Socket learner');
    await Promise.all([saveActor(owner), saveActor(learner)]);
    const { roomId, stub, workspace } = await createRoom(owner);
    const invite = await call<{ ticket: string }>(stub, `/api/workspaces/${roomId}/invites`, owner, {
      method: 'POST', body: { seat: 'learner-1' }, mutation: true,
    });
    const rawTicket = invite.body.ticket.slice(`${roomId}_`.length);
    const joined = await call<WorkspaceView>(stub, '/internal/redeem', learner, {
      method: 'POST', body: { ticket: rawTicket }, mutation: true,
    });
    expect(joined.response.status).toBe(200);

    const configuredOrigin = runtime.PUBLIC_ORIGIN;
    runtime.PUBLIC_ORIGIN = `${ORIGIN}/`;
    let response: Response;
    try {
      response = await stub.fetch(new Request(`https://tabletop.test/api/workspaces/${roomId}/socket`, {
        headers: {
          ...Object.fromEntries(headers(learner)),
          Upgrade: 'websocket',
          Connection: 'Upgrade',
        },
      }));
    } finally {
      runtime.PUBLIC_ORIGIN = configuredOrigin;
    }
    expect(response.status).toBe(101);
    const socket = response.webSocket;
    expect(socket).not.toBeNull();
    socket?.accept();
    let closedCode: number | null = null;
    socket?.addEventListener('close', (event) => { closedCode = (event as CloseEvent).code; }, { once: true });
    await evictDurableObject(stub);
    await runtime.DB.prepare('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), sha256(learner.token)).run();
    const ownerView = await call<WorkspaceView>(stub, `/api/workspaces/${roomId}`, owner);
    const changed = await issueCommand(stub, ownerView.body, owner, 'teaching.setParameters', { force: 19, mass: 2, time: 2 });
    expect(changed.response.status).toBe(200);
    await runInDurableObject(stub, (instance) => instance.repository.pendingOutboxCount());
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    expect(closedCode).toBe(4403);
    const learnerStillAuthorized = await call<PublicError>(stub, `/api/workspaces/${roomId}`, learner);
    expect(learnerStillAuthorized.response.status).toBe(401);
    expect(workspace.epoch).toBe(joined.body.epoch);
  });
});
