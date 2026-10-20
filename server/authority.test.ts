import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { WebSocket as WebSocketExport } from 'ws';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommandAck, SessionView, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { ApiError } from '../src/tabletop/shared/contracts.js';
import { hashValue } from './codec.js';
import { startServer, type StartedServer } from './start.js';
import { MAX_HTTP_REQUESTS_PER_MINUTE } from './limits.js';
import { gameChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';

interface TestSession {
  cookie: string;
  csrfToken: string;
  actorId: string;
}

interface InviteResponse {
  ticket: string;
  expiresAt: number;
}

const running: StartedServer[] = [];

async function openServer(
  dataDir = ':memory:',
  now?: () => number,
  staticDir?: string,
): Promise<{ server: StartedServer; base: string }> {
  const server = await startServer({ environment: 'local', host: '127.0.0.1', port: 0, dataDir,
    ...(now ? { now } : {}), ...(staticDir ? { staticDir } : {}) });
  running.push(server);
  return { server, base: `http://127.0.0.1:${server.port}` };
}

async function closeServer(server: StartedServer): Promise<void> {
  const index = running.indexOf(server);
  if (index >= 0) running.splice(index, 1);
  await server.close();
}

async function call<T>(
  base: string,
  path: string,
  options: { method?: string; session?: TestSession; body?: unknown; origin?: string } = {},
): Promise<{ response: Response; body: T | ApiError }> {
  const headers = new Headers();
  if (options.origin !== '') headers.set('origin', options.origin ?? base);
  if (options.session) {
    headers.set('cookie', options.session.cookie);
    if (options.session.csrfToken) headers.set('x-csrf-token', options.session.csrfToken);
  }
  if (options.body !== undefined) {
    headers.set('content-type', 'application/json');
  }
  const response = await fetch(`${base}${path}`, {
    method: options.method ?? (options.body === undefined ? 'GET' : 'POST'),
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
  const body = await response.json() as T | ApiError;
  return { response, body };
}

async function createSession(base: string, name: string): Promise<TestSession> {
  const { response, body } = await call<SessionView>(base, '/api/session', { method: 'POST', body: { name } });
  expect(response.status).toBe(200);
  const session = body as SessionView;
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  expect(cookie).toMatch(/^tabletop_session=[A-Za-z0-9_-]{40,64}$/u);
  return { cookie: cookie ?? '', csrfToken: session.csrfToken, actorId: session.actorId };
}

async function createWorkspace(base: string, session: TestSession, kind: 'invoice' | 'teaching' | 'encounter' | 'table' = 'teaching'): Promise<WorkspaceView> {
  const { response, body } = await call<WorkspaceView>(base, '/api/workspaces', { session, body: { kind } });
  expect(response.status).toBe(201);
  return body as WorkspaceView;
}

async function invite(base: string, session: TestSession, workspaceId: string, seat: string): Promise<InviteResponse> {
  const { response, body } = await call<InviteResponse>(base, `/api/workspaces/${workspaceId}/invites`, { session, body: { seat } });
  expect(response.status).toBe(201);
  return body as InviteResponse;
}

async function redeem(base: string, session: TestSession, ticket: string): Promise<{ session: TestSession; workspace: WorkspaceView }> {
  const { response, body } = await call<WorkspaceView>(base, '/api/invites/redeem', { session, body: { ticket } });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')?.split(';', 1)[0];
  const csrfToken = response.headers.get('x-csrf-token');
  expect(cookie).toMatch(/^tabletop_session=[A-Za-z0-9_-]{40,64}$/u);
  expect(csrfToken).toMatch(/^[a-f0-9]{64}$/u);
  return {
    session: { cookie: cookie ?? '', csrfToken: csrfToken ?? '', actorId: session.actorId },
    workspace: body as WorkspaceView,
  };
}

async function command(
  base: string,
  session: TestSession,
  workspace: WorkspaceView,
  type: string,
  payload: unknown,
  commandId = randomUUID(),
): Promise<{ response: Response; body: CommandAck | ApiError; envelope: Record<string, unknown> }> {
  const envelope = {
    commandId,
    expectedRevision: workspace.revision,
    expectedEpoch: workspace.epoch,
    type,
    payload,
  };
  const { response, body } = await call<CommandAck>(base, `/api/workspaces/${workspace.id}/commands`, { session, body: envelope });
  return { response, body, envelope };
}

interface SocketProjection {
  type: 'projection';
  workspace: WorkspaceView;
}

interface TestWebSocket extends EventEmitter {
  close(): void;
}

interface TestWebSocketConstructor {
  new (address: string, options: { headers: Record<string, string> }): TestWebSocket;
}

const WebSocketClient = WebSocketExport as unknown as TestWebSocketConstructor;

function receiveSocketProjection(socket: TestWebSocket): Promise<SocketProjection> {
  return new Promise((resolveProjection, rejectProjection) => {
    const timeout = setTimeout(() => {
      socket.off('message', onMessage);
      rejectProjection(new Error('WEBSOCKET_PROJECTION_TIMEOUT'));
    }, 3_000);
    const onMessage = (data: Buffer | ArrayBuffer | Buffer[]): void => {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      try {
        const source = typeof data === 'string' ? data : Array.isArray(data)
          ? Buffer.concat(data).toString('utf8')
          : data instanceof ArrayBuffer ? Buffer.from(data).toString('utf8') : data.toString('utf8');
        const parsed: unknown = JSON.parse(source);
        if (typeof parsed !== 'object' || parsed === null || !('type' in parsed) || parsed.type !== 'projection'
            || !('workspace' in parsed)) throw new Error('WEBSOCKET_PROJECTION_INVALID');
        resolveProjection(parsed as SocketProjection);
      } catch (error) {
        rejectProjection(error);
      }
    };
    socket.once('message', onMessage);
  });
}

function waitForSocketClose(socket: TestWebSocket): Promise<void> {
  return new Promise((resolveClose) => socket.once('close', () => resolveClose()));
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((server) => server.close()));
});

describe('tabletop server authority', () => {
  it('creates table owners, redeems participant seats, and keeps imported source text out of participant projections', async () => {
    const { base } = await openServer();
    const owner = await createSession(base, 'Table owner');
    const participant = await createSession(base, 'Table participant');
    const workspace = await createWorkspace(base, owner, 'table');
    expect(workspace.actor).toMatchObject({ role: 'owner' });

    const invitation = await invite(base, owner, workspace.id, 'member-1');
    const redeemed = await redeem(base, participant, invitation.ticket);
    expect(redeemed.workspace.actor).toMatchObject({ role: 'participant', seat: 'member-1' });

    const text = `${tableScenarioSources.equipment.text}\nLOCAL_TABLE_SOURCE_SENTINEL`;
    const currentOwnerView = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner });
    const imported = await command(base, owner, currentOwnerView.body as WorkspaceView, 'table.import', {
      filename: tableScenarioSources.equipment.filename,
      text,
    });
    expect(imported.response.status).toBe(200);
    const ownerView = (imported.body as CommandAck).workspace;
    expect(ownerView.domain.kind).toBe('table');
    const participantView = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: redeemed.session });
    expect(JSON.stringify(participantView.body)).not.toContain('LOCAL_TABLE_SOURCE_SENTINEL');
    if ((participantView.body as WorkspaceView).domain.kind !== 'table') throw new Error('Expected participant table projection.');
    expect(((participantView.body as WorkspaceView).domain as Extract<WorkspaceView['domain'], { kind: 'table' }>).sources).toEqual([]);

    const denied = await command(base, redeemed.session, participantView.body as WorkspaceView, 'table.import', {
      filename: 'second.txt', text: 'participants cannot add sources',
    });
    expect(denied.response.status).toBe(403);
    expect((denied.body as ApiError).errorCode).toBe('FORBIDDEN');
  });

  it('isolates sessions, projects private notes, rejects learner teacher actions, and enforces command idempotency/CAS', async () => {
    const { base } = await openServer();
    const teacher = await createSession(base, 'Teacher');
    const learner = await createSession(base, 'Learner');
    const unrelated = await createSession(base, 'Unrelated');
    expect(new Set([teacher.actorId, learner.actorId, unrelated.actorId]).size).toBe(3);

    let workspace = await createWorkspace(base, teacher);
    const deniedBeforeInvite = await call<ApiError>(base, `/api/workspaces/${workspace.id}`, { session: learner });
    expect(deniedBeforeInvite.response.status).toBe(403);

    const ticket = await invite(base, teacher, workspace.id, 'learner-1');
    const redeemed = await redeem(base, learner, ticket.ticket);
    const learnerSession = redeemed.session;
    const learnerWorkspaceBeforePrivateChange = redeemed.workspace;
    const ownerProjection = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: teacher });
    workspace = ownerProjection.body as WorkspaceView;
    const outside = await call<ApiError>(base, `/api/workspaces/${workspace.id}`, { session: unrelated });
    expect(outside.response.status).toBe(403);
    const crossWorkspaceCommand = await call<ApiError>(base, `/api/workspaces/${workspace.id}/commands`, {
      session: unrelated,
      body: { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, type: 'workspace.reset', payload: {} },
    });
    expect(crossWorkspaceCommand.response.status).toBe(403);

    const note = await command(base, teacher, workspace, 'teaching.saveNote', { text: 'Answer key: private.' });
    expect(note.response.status).toBe(200);
    workspace = (note.body as CommandAck).workspace;
    const teacherView = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: teacher });
    const learnerView = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: learnerSession });
    expect((teacherView.body as WorkspaceView).domain).toMatchObject({ teacherNote: 'Answer key: private.' });
    expect((learnerView.body as WorkspaceView).domain).not.toHaveProperty('teacherNote');
    expect((learnerView.body as WorkspaceView).revision).toBe(learnerWorkspaceBeforePrivateChange.revision);

    const deniedTeacherAction = await command(base, learnerSession, learnerView.body as WorkspaceView, 'teaching.setParameters', { force: 20, mass: 2, time: 2 });
    expect(deniedTeacherAction.response.status).toBe(403);
    expect((deniedTeacherAction.body as ApiError).errorCode).toBe('ROLE_FORBIDDEN');

    const commandId = randomUUID();
    const first = await command(base, teacher, workspace, 'teaching.setParameters', { force: 20, mass: 2, time: 2 }, commandId);
    expect(first.response.status).toBe(200);
    const firstAck = first.body as CommandAck;
    const duplicate = await call<CommandAck>(base, `/api/workspaces/${workspace.id}/commands`, { session: teacher, body: first.envelope });
    expect(duplicate.response.status).toBe(200);
    expect((duplicate.body as CommandAck).duplicate).toBe(true);

    const mismatchEnvelope = { ...first.envelope, payload: { force: 21, mass: 2, time: 2 } };
    const mismatch = await call<ApiError>(base, `/api/workspaces/${workspace.id}/commands`, { session: teacher, body: mismatchEnvelope });
    expect(mismatch.response.status).toBe(409);
    expect((mismatch.body as ApiError).errorCode).toBe('IDEMPOTENCY_MISMATCH');

    const stale = await command(base, teacher, workspace, 'teaching.setParameters', { force: 22, mass: 2, time: 2 });
    expect(stale.response.status).toBe(409);
    expect((stale.body as ApiError).errorCode).toBe('STALE_REVISION');
    expect(firstAck.workspace.revision).not.toBe(workspace.revision);

    const missingCsrf = await call<ApiError>(base, `/api/workspaces/${workspace.id}/commands`, {
      session: { ...teacher, csrfToken: '' },
      body: { ...first.envelope, commandId: randomUUID() },
    });
    expect(missingCsrf.response.status).toBe(403);
    const wrongOrigin = await call<ApiError>(base, `/api/workspaces/${workspace.id}/commands`, {
      session: teacher,
      body: { ...first.envelope, commandId: randomUUID() },
      origin: 'http://attacker.invalid',
    });
    expect(wrongOrigin.response.status).toBe(403);

    const currentLearnerView = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: learnerSession });
    const resync = await call<{ resync: boolean; cursor: string; workspace: WorkspaceView }>(base, `/api/workspaces/${workspace.id}/events`, { session: learnerSession });
    expect(resync.response.status).toBe(200);
    const resyncBody = resync.body as { resync: boolean; cursor: string; workspace: WorkspaceView };
    expect(resyncBody).toMatchObject({ resync: true });
    expect(resyncBody).not.toHaveProperty('events');
    expect(resyncBody.cursor).toBe((currentLearnerView.body as WorkspaceView).revision);
    const currentCursor = await call<{ resync: boolean; cursor: string; workspace: WorkspaceView }>(
      base, `/api/workspaces/${workspace.id}/events?after=${resyncBody.cursor}`, { session: learnerSession },
    );
    expect(currentCursor.response.status).toBe(200);
    const currentCursorBody = currentCursor.body as { resync: boolean; cursor: string; workspace: WorkspaceView };
    expect(currentCursorBody.resync).toBe(false);
    expect(currentCursorBody.workspace.revision).toBe(resyncBody.cursor);
    const otherActorCursor = await call<{ resync: boolean }>(
      base, `/api/workspaces/${workspace.id}/events?after=${(teacherView.body as WorkspaceView).revision}`, { session: learnerSession },
    );
    expect(otherActorCursor.response.status).toBe(200);
    expect((otherActorCursor.body as { resync: boolean }).resync).toBe(true);
    const malformedCursor = await call<ApiError>(base, `/api/workspaces/${workspace.id}/events?after=1`, { session: learnerSession });
    expect(malformedCursor.response.status).toBe(400);
  });

  it('makes invites one-use with a lost-ack replay, and reset revokes peers while accepting only its exact retry', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Owner');
    const guestA = await createSession(base, 'Mira');
    const guestB = await createSession(base, 'Pip');
    let workspace = await createWorkspace(base, owner, 'encounter');
    const note = await command(base, owner, workspace, 'encounter.saveNote', { text: 'private DM note before reset' });
    expect(note.response.status).toBe(200);
    workspace = (note.body as CommandAck).workspace;
    const firstInvite = await invite(base, owner, workspace.id, 'mira');

    const firstRedeem = await redeem(base, guestA, firstInvite.ticket);
    const ownerProjection = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner });
    workspace = ownerProjection.body as WorkspaceView;
    const retryRedeem = await call<WorkspaceView>(base, '/api/invites/redeem', { session: guestA, body: { ticket: firstInvite.ticket } });
    expect(retryRedeem.response.status).toBe(200);
    expect(retryRedeem.response.headers.get('set-cookie')).toContain(firstRedeem.session.cookie.split('=', 2)[1]?.split(';', 1)[0]);
    expect(retryRedeem.response.headers.get('x-csrf-token')).toBe(firstRedeem.session.csrfToken);
    const secondRedeem = await call<ApiError>(base, '/api/invites/redeem', { session: guestB, body: { ticket: firstInvite.ticket } });
    expect(secondRedeem.response.status).toBe(409);
    expect((secondRedeem.body as ApiError).errorCode).toBe('INVITE_ALREADY_USED');

    const secondInvite = await invite(base, owner, workspace.id, 'pip');
    const modelJobId = randomUUID();
    await server.database.query(
      `INSERT INTO model_jobs (id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, 1, NULL)`,
      [modelJobId, workspace.id, workspace.epoch, owner.actorId, JSON.stringify({ prompt: 'private model prompt before reset' })],
    );
    const resetEnvelope = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      type: 'workspace.reset',
      payload: {},
    };
    const reset = await call<CommandAck>(base, `/api/workspaces/${workspace.id}/commands`, { session: owner, body: resetEnvelope });
    expect(reset.response.status).toBe(200);
    workspace = (reset.body as CommandAck).workspace;
    expect(workspace.epoch).toBe(2);

    const db = server.database;
    const retained = await db.query<{ kind: string; content: string }>(
      `SELECT 'workspace' AS kind, domain_state::text AS content FROM workspaces WHERE id = $1
       UNION ALL SELECT 'snapshot', state::text FROM snapshots WHERE workspace_id = $1
       UNION ALL SELECT 'event', event_data::text FROM events WHERE workspace_id = $1
       UNION ALL SELECT 'command', response::text FROM commands WHERE workspace_id = $1
       UNION ALL SELECT 'model-job', data::text FROM model_jobs WHERE workspace_id = $1`,
      [workspace.id],
    );
    expect(JSON.stringify(retained.rows)).not.toContain('private DM note before reset');
    expect(JSON.stringify(retained.rows)).not.toContain('private model prompt before reset');
    const oldSnapshots = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM snapshots WHERE workspace_id = $1 AND epoch < $2',
      [workspace.id, workspace.epoch],
    );
    expect(oldSnapshots.rows[0]?.count).toBe(0);
    const oldEvents = await db.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM events WHERE workspace_id = $1 AND epoch < $2',
      [workspace.id, workspace.epoch],
    );
    expect(oldEvents.rows[0]?.count).toBe(0);
    const oldCommands = await db.query<{ command_id: string }>(
      'SELECT command_id FROM commands WHERE workspace_id = $1 AND epoch < $2',
      [workspace.id, workspace.epoch],
    );
    expect(oldCommands.rows.map((row) => row.command_id)).toEqual([resetEnvelope.commandId]);
    const scrubbedJob = await db.query<{ status: string; data: unknown; revoked_at: number | null }>(
      'SELECT status, data, revoked_at FROM model_jobs WHERE id = $1',
      [modelJobId],
    );
    expect(scrubbedJob.rows[0]).toMatchObject({ status: 'revoked', data: {}, revoked_at: expect.any(Number) });
    const survivingSessions = await db.query<{ actor_id: string }>(
      'SELECT actor_id FROM sessions WHERE workspace_id = $1',
      [workspace.id],
    );
    expect(survivingSessions.rows.map((row) => row.actor_id)).toEqual([owner.actorId]);

    const lostAckRetry = await call<CommandAck>(base, `/api/workspaces/${workspace.id}/commands`, { session: owner, body: resetEnvelope });
    expect(lostAckRetry.response.status).toBe(200);
    expect((lostAckRetry.body as CommandAck).duplicate).toBe(true);
    expect(((lostAckRetry.body as CommandAck).workspace).epoch).toBe(2);

    const staleReset = await call<ApiError>(base, `/api/workspaces/${workspace.id}/commands`, {
      session: owner,
      body: { ...resetEnvelope, commandId: randomUUID() },
    });
    expect(staleReset.response.status).toBe(409);
    expect((staleReset.body as ApiError).errorCode).toBe('STALE_EPOCH');

    const revokedPeer = await call<ApiError>(base, `/api/workspaces/${workspace.id}`, { session: firstRedeem.session });
    expect(revokedPeer.response.status).toBe(401);
    const staleInvite = await call<ApiError>(base, '/api/invites/redeem', { session: guestB, body: { ticket: secondInvite.ticket } });
    expect(staleInvite.response.status).toBe(403);
    expect((staleInvite.body as ApiError).errorCode).toBe('INVITE_INVALID');
    const ownerStillAuthorized = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner });
    expect(ownerStillAuthorized.response.status).toBe(200);
    expect((ownerStillAuthorized.body as WorkspaceView).members).toHaveLength(1);
  });

  it('lets an owner explicitly revoke a lost unused invite and issue a replacement atomically', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Invite owner');
    const outsider = await createSession(base, 'Not a member');
    const learner = await createSession(base, 'Invite recipient');
    const workspace = await createWorkspace(base, owner, 'teaching');
    const lostAcknowledgement = await invite(base, owner, workspace.id, 'learner-1');

    const unauthorized = await call<InviteResponse>(base, `/api/workspaces/${workspace.id}/invites`, {
      session: outsider,
      body: { seat: 'learner-1', replaceOutstanding: true },
    });
    expect(unauthorized.response.status).toBe(403);
    expect((unauthorized.body as ApiError).errorCode).toBe('MEMBERSHIP_REVOKED');

    const unchangedDefault = await call<InviteResponse>(base, `/api/workspaces/${workspace.id}/invites`, {
      session: owner,
      body: { seat: 'learner-1' },
    });
    expect(unchangedDefault.response.status).toBe(409);
    expect((unchangedDefault.body as ApiError).errorCode).toBe('SEAT_UNAVAILABLE');

    const replacement = await call<InviteResponse>(base, `/api/workspaces/${workspace.id}/invites`, {
      session: owner,
      body: { seat: 'learner-1', replaceOutstanding: true },
    });
    expect(replacement.response.status).toBe(201);
    expect(replacement.body).toMatchObject({ expiresAt: expect.any(Number) });
    const deniedOldTicket = await call<WorkspaceView>(base, '/api/invites/redeem', {
      session: learner,
      body: { ticket: lostAcknowledgement.ticket },
    });
    expect(deniedOldTicket.response.status).toBe(403);
    expect((deniedOldTicket.body as ApiError).errorCode).toBe('INVITE_EXPIRED');

    const redeemed = await redeem(base, learner, (replacement.body as InviteResponse).ticket);
    expect(redeemed.workspace.actor).toMatchObject({ role: 'learner', seat: 'learner-1' });
    const occupied = await call<InviteResponse>(base, `/api/workspaces/${workspace.id}/invites`, {
      session: owner,
      body: { seat: 'learner-1', replaceOutstanding: true },
    });
    expect(occupied.response.status).toBe(403);
    expect((occupied.body as ApiError).errorCode).toBe('INVITE_SEAT_OCCUPIED');

    const hashes = await server.database.query<{ ticket_hash: string }>(
      'SELECT ticket_hash FROM invitations WHERE workspace_id = $1', [workspace.id],
    );
    expect(hashes.rows).toHaveLength(2);
    expect(hashes.rows.some((row) => row.ticket_hash === lostAcknowledgement.ticket)).toBe(false);
    expect(hashes.rows.some((row) => row.ticket_hash === (replacement.body as InviteResponse).ticket)).toBe(false);
  });

  it('serializes socket projections and skips private changes for learners', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Teacher');
    const guest = await createSession(base, 'Learner');
    const workspace = await createWorkspace(base, owner, 'teaching');
    const invitation = await invite(base, owner, workspace.id, 'learner-1');
    const joined = await redeem(base, guest, invitation.ticket);
    const socket: TestWebSocket = new WebSocketClient(`ws://127.0.0.1:${server.port}/api/workspaces/${workspace.id}/socket`, {
      headers: { cookie: joined.session.cookie, origin: base },
    });
    let receivedCount = 0;
    let unexpectedMessage = false;
    const countMessage = (): void => {
      receivedCount += 1;
      if (receivedCount > 1) unexpectedMessage = true;
    };
    socket.on('message', countMessage);
    let originalAuthorize: typeof server.authority.authorize | undefined;
    let releaseAuth: (() => void) | undefined;
    try {
      const initial = await receiveSocketProjection(socket);
      expect(initial.workspace.actor.role).toBe('learner');
      receivedCount = 0;
      unexpectedMessage = false;
      const ownerViewResponse = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner });
      let ownerView = ownerViewResponse.body as WorkspaceView;
      const privateNote = await command(base, owner, ownerView, 'teaching.saveNote', { text: 'Private teacher key.' });
      expect(privateNote.response.status).toBe(200);
      ownerView = (privateNote.body as CommandAck).workspace;
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
      expect(receivedCount).toBe(0);

      let markAuthStarted: () => void = () => undefined;
      const authStarted = new Promise<void>((resolveStarted) => { markAuthStarted = resolveStarted; });
      let releaseGate: () => void = () => undefined;
      const authGate = new Promise<void>((resolveGate) => { releaseGate = resolveGate; });
      releaseAuth = releaseGate;
      const authorizeNormally = server.authority.authorize.bind(server.authority);
      originalAuthorize = authorizeNormally;
      let delayNextProjection = true;
      server.authority.authorize = async (request, workspaceId) => {
        if (delayNextProjection && request.url?.includes('/socket') === true) {
          delayNextProjection = false;
          markAuthStarted();
          await authGate;
        }
        return authorizeNormally(request, workspaceId);
      };

      const firstCommand = await command(base, owner, ownerView, 'teaching.setParameters', { force: 20, mass: 2, time: 2 });
      expect(firstCommand.response.status).toBe(200);
      await authStarted;
      const firstAck = firstCommand.body as CommandAck;
      const latestCommand = await command(base, owner, firstAck.workspace, 'teaching.setParameters', { force: 18, mass: 2, time: 2 });
      expect(latestCommand.response.status).toBe(200);
      releaseAuth();

      const projection = await receiveSocketProjection(socket);
      expect(projection.workspace.domain.kind).toBe('teaching');
      if (projection.workspace.domain.kind !== 'teaching') throw new Error('Expected teaching projection.');
      expect(projection.workspace.domain.parameters.force).toBe(18);
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
      expect(receivedCount).toBe(1);
      expect(unexpectedMessage).toBe(false);
    } finally {
      if (originalAuthorize) server.authority.authorize = originalAuthorize;
      if (releaseAuth) releaseAuth();
      const closed = waitForSocketClose(socket);
      socket.close();
      await closed;
    }
  });

  it('lets an owner retain multiple workspaces without allowing a guest to create one', async () => {
    const { base } = await openServer();
    const owner = await createSession(base, 'Owner');
    const first = await createWorkspace(base, owner, 'teaching');
    const second = await createWorkspace(base, owner, 'invoice');
    expect(second.id).not.toBe(first.id);

    const list = await call<SessionView>(base, '/api/session', { session: owner });
    expect(list.response.status).toBe(200);
    expect((list.body as SessionView).workspaces.map((workspace) => workspace.id)).toEqual(expect.arrayContaining([first.id, second.id]));

    const firstCurrentView = await call<WorkspaceView>(base, `/api/workspaces/${first.id}`, { session: owner });
    const note = await command(base, owner, firstCurrentView.body as WorkspaceView, 'teaching.saveNote', { text: 'Still the first room.' });
    expect(note.response.status).toBe(200);
    expect((note.body as CommandAck).workspace.id).toBe(first.id);

    const guest = await createSession(base, 'Guest');
    const invitation = await invite(base, owner, first.id, 'learner-1');
    const joined = await redeem(base, guest, invitation.ticket);
    const denied = await call<ApiError>(base, '/api/workspaces', { session: joined.session, body: { kind: 'encounter' } });
    expect(denied.response.status).toBe(409);
    expect((denied.body as ApiError).errorCode).toBe('SESSION_ALREADY_BOUND');
  });

  it('uses the active public table title in owner and member directories while keeping source names private', async () => {
    const { base } = await openServer();
    const owner = await createSession(base, 'Table owner');
    const member = await createSession(base, 'Table member');
    let workspace = await createWorkspace(base, owner, 'table');

    const beforeActivation = await call<SessionView>(base, '/api/session', { session: owner });
    expect((beforeActivation.body as SessionView).workspaces.find((item) => item.id === workspace.id)?.title).toBe('Shared Table');

    const imported = await command(base, owner, workspace, 'table.import', {
      filename: 'owner-private-source-name.txt', text: tableScenarioSources.game.text,
    });
    expect(imported.response.status).toBe(200);
    workspace = (imported.body as CommandAck).workspace;
    if (workspace.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    const sourceId = workspace.domain.sources[0]?.id;
    if (!sourceId) throw new Error('Expected an imported source.');

    const change = gameChange(sourceId);
    for (const type of ['evolve.propose', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) {
      const result = await command(base, owner, workspace, type,
        type === 'evolve.propose' ? { change } : {});
      expect(result.response.status).toBe(200);
      workspace = (result.body as CommandAck).workspace;
    }

    const ownerDirectory = await call<SessionView>(base, '/api/session', { session: owner });
    const ownerReference = (ownerDirectory.body as SessionView).workspaces.find((item) => item.id === workspace.id);
    expect(ownerReference).toMatchObject({ title: 'River Race', kind: 'table' });
    expect(JSON.stringify(ownerDirectory.body)).not.toContain('owner-private-source-name.txt');

    const ticket = await invite(base, owner, workspace.id, 'member-1');
    const joined = await redeem(base, member, ticket.ticket);
    const memberDirectory = await call<SessionView>(base, '/api/session', { session: joined.session });
    const memberReference = (memberDirectory.body as SessionView).workspaces.find((item) => item.id === workspace.id);
    expect(memberReference).toMatchObject({ title: 'River Race', kind: 'table' });
    expect(JSON.stringify(memberDirectory.body)).not.toContain('owner-private-source-name.txt');

    // F002: the owner's chosen name wins over the rules title for everyone; members cannot rename.
    workspace = (await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner })).body as WorkspaceView;
    const renameId = randomUUID();
    const renamed = await command(base, owner, workspace, 'workspace.rename', { title: '  Friday boat club  ' }, renameId);
    expect(renamed.response.status).toBe(200);
    const renamedView = (renamed.body as CommandAck).workspace;
    expect(renamedView.title).toBe('Friday boat club');
    expect(renamedView.revision).not.toBe(workspace.revision);
    if (renamedView.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    expect(renamedView.domain.program?.title).toBe('River Race');
    const retried = await command(base, owner, workspace, 'workspace.rename', { title: '  Friday boat club  ' }, renameId);
    expect(retried.response.status).toBe(200);
    expect((retried.body as CommandAck).duplicate).toBe(true);
    for (const session of [owner, joined.session]) {
      const directory = await call<SessionView>(base, '/api/session', { session });
      expect((directory.body as SessionView).workspaces.find((item) => item.id === workspace.id)?.title).toBe('Friday boat club');
    }
    const memberView = (await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: joined.session })).body as WorkspaceView;
    expect(memberView.title).toBe('Friday boat club');
    const memberRename = await command(base, joined.session, memberView, 'workspace.rename', { title: 'Taken over' });
    expect(memberRename.response.status).toBe(403);
    expect((memberRename.body as ApiError).errorCode).toBe('ROLE_FORBIDDEN');
    for (const payload of [{ title: '   ' }, { title: 'line\nbreak' }, { title: 'x'.repeat(101) }, { title: 5 }, { name: 'wrong field' }, { title: 'ok', extra: true }]) {
      const rejected = await command(base, owner, renamedView, 'workspace.rename', payload);
      expect(rejected.response.status, JSON.stringify(payload)).toBeGreaterThanOrEqual(400);
      expect((rejected.body as ApiError).errorCode, JSON.stringify(payload)).toBe('INVALID_COMMAND_PAYLOAD');
    }
  });

  it('rejects lost-ack invite replay after the single-use ticket expires', async () => {
    let now = Date.now();
    const { base } = await openServer(':memory:', () => now);
    const owner = await createSession(base, 'Owner');
    const guest = await createSession(base, 'Guest');
    const workspace = await createWorkspace(base, owner, 'teaching');
    const ticket = await invite(base, owner, workspace.id, 'learner-1');
    const firstRedeem = await redeem(base, guest, ticket.ticket);
    expect(firstRedeem.workspace.id).toBe(workspace.id);

    now = ticket.expiresAt + 1;
    const expiredReplay = await call<ApiError>(base, '/api/invites/redeem', { session: guest, body: { ticket: ticket.ticket } });
    expect(expiredReplay.response.status).toBe(403);
    expect((expiredReplay.body as ApiError).errorCode).toBe('INVITE_EXPIRED');
  });

  it('deduplicates a trusted import before parsing and queues private blob cleanup on reset', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Invoice owner');
    const workspace = await createWorkspace(base, owner, 'invoice');
    const requestSocket = new Socket();
    const request = new IncomingMessage(requestSocket);
    request.headers.cookie = owner.cookie;
    const authenticated = await server.authority.authenticate(request);
    requestSocket.destroy();

    const artifactId = randomUUID();
    const fingerprint = 'f'.repeat(64);
    const envelope = {
      commandId: randomUUID(),
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      type: 'invoice.import',
      payload: {},
    };
    expect(await server.authority.findTrustedReceipt(authenticated, workspace.id, envelope, fingerprint)).toBeNull();
    const ack = await server.authority.executeTrusted(authenticated, envelope, {
      artifact: {
        id: artifactId,
        filename: 'source.txt',
        kind: 'excerpt',
        status: 'provided',
        sha256: 'a'.repeat(64),
        pages: [{ number: 1, text: 'Reviewed evidence text.' }],
        excerpt: 'Reviewed evidence text.',
        createdAt: Date.now(),
      },
    }, workspace.id, fingerprint);
    const duplicate = await server.authority.findTrustedReceipt(authenticated, workspace.id, envelope, fingerprint);
    expect(duplicate?.duplicate).toBe(true);
    expect(duplicate?.workspace.domain.kind).toBe('invoice');
    if (duplicate?.workspace.domain.kind !== 'invoice') throw new Error('Expected invoice workspace.');
    expect(duplicate.workspace.domain.sources.map((artifact) => artifact.id)).toContain(artifactId);

    const reset = await command(base, owner, ack.workspace, 'workspace.reset', {});
    expect(reset.response.status).toBe(200);
    const cleanup = await server.repository.listPendingArtifactCleanup();
    expect(cleanup).toEqual([{ workspaceId: workspace.id, objectKey: artifactId, epoch: 1, requestedAt: expect.any(Number) }]);
    const cleanupRequest = cleanup[0];
    if (!cleanupRequest) throw new Error('Expected pending artifact cleanup.');
    await server.repository.completeArtifactCleanup(cleanupRequest);
    expect(await server.repository.listPendingArtifactCleanup()).toEqual([]);
    const sourceRows = await server.database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM snapshots WHERE workspace_id = $1 AND state::text LIKE $2',
      [workspace.id, `%${artifactId}%`],
    );
    expect(sourceRows.rows[0]?.count).toBe(0);
  });

  it('commits model proposals only while the matching durable job is still committing', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Model teacher');
    const workspace = await createWorkspace(base, owner, 'teaching');
    const requestSocket = new Socket();
    const request = new IncomingMessage(requestSocket);
    request.headers.cookie = owner.cookie;
    const authenticated = await server.authority.authenticate(request);
    requestSocket.destroy();

    const change = { kind: 'teaching', parameters: { force: 12, mass: 2, time: 2 } };
    const commandId = randomUUID();
    const envelope = {
      commandId,
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
      type: 'evolve.propose',
      payload: { change },
    };
    const proposalHash = hashValue({
      type: envelope.type,
      payload: envelope.payload,
      expectedRevision: envelope.expectedRevision,
      expectedEpoch: envelope.expectedEpoch,
    });
    const jobId = 'a'.repeat(64);
    await server.database.query(
      `INSERT INTO model_jobs (id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, 'committing', $5::jsonb, $6, NULL)`,
      [jobId, workspace.id, workspace.epoch, owner.actorId,
        JSON.stringify({ commandId, expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, proposalHash }),
        Date.now()],
    );

    const committed = await server.authority.executeModelProposal(authenticated, envelope, workspace.id, jobId);
    expect(committed.workspace.domain.candidate).toMatchObject({ status: 'draft', createdBy: owner.actorId });

    const failedCommandId = randomUUID();
    const current = committed.workspace;
    const failedEnvelope = {
      commandId: failedCommandId,
      expectedRevision: current.revision,
      expectedEpoch: current.epoch,
      type: 'evolve.propose',
      payload: { change: { ...change, parameters: { force: 18, mass: 2, time: 2 } } },
    };
    const failedProposalHash = hashValue({
      type: failedEnvelope.type,
      payload: failedEnvelope.payload,
      expectedRevision: failedEnvelope.expectedRevision,
      expectedEpoch: failedEnvelope.expectedEpoch,
    });
    const failedJobId = 'b'.repeat(64);
    await server.database.query(
      `INSERT INTO model_jobs (id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, 'failed', $5::jsonb, $6, NULL)`,
      [failedJobId, workspace.id, current.epoch, owner.actorId,
        JSON.stringify({ commandId: failedCommandId, expectedRevision: current.revision,
          expectedEpoch: current.epoch, proposalHash: failedProposalHash, failure: 'MODEL_JOB_INTERRUPTED' }),
        Date.now()],
    );

    await expect(server.authority.executeModelProposal(authenticated, failedEnvelope, workspace.id, failedJobId))
      .rejects.toMatchObject({ code: 'MODEL_JOB_NOT_COMMITTING' });
    const afterFailedAttempt = await server.authority.authorizeSession(authenticated, workspace.id);
    expect(afterFailedAttempt.workspace.revision).toBe(current.revision);
    const failedReceipt = await server.database.query<{ count: number }>(
      'SELECT COUNT(*)::int AS count FROM commands WHERE workspace_id = $1 AND command_id = $2',
      [workspace.id, failedCommandId],
    );
    expect(failedReceipt.rows[0]?.count).toBe(0);
  });

  it('scrubs expired workspaces in bounded batches and queues their artifact cleanup', async () => {
    const now = Date.now();
    const { base, server } = await openServer(':memory:', () => now);
    const owner = await createSession(base, 'Invoice owner');
    const guest = await createSession(base, 'Learner');
    const workspace = await createWorkspace(base, owner, 'invoice');
    const peerWorkspace = await createWorkspace(base, owner, 'teaching');
    const invitation = await invite(base, owner, peerWorkspace.id, 'learner-1');
    const joined = await redeem(base, guest, invitation.ticket);
    const currentWorkspaceResponse = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: owner });
    expect(currentWorkspaceResponse.response.status).toBe(200);
    const currentWorkspace = currentWorkspaceResponse.body as WorkspaceView;
    const requestSocket = new Socket();
    const request = new IncomingMessage(requestSocket);
    request.headers.cookie = owner.cookie;
    const authenticated = await server.authority.authenticate(request);
    requestSocket.destroy();

    const artifactId = randomUUID();
    await server.authority.executeTrusted(authenticated, {
      commandId: randomUUID(),
      expectedRevision: currentWorkspace.revision,
      expectedEpoch: currentWorkspace.epoch,
      type: 'invoice.import',
      payload: {},
    }, {
      artifact: {
        id: artifactId,
        filename: 'private-source.txt',
        kind: 'excerpt',
        status: 'provided',
        sha256: 'b'.repeat(64),
        pages: [{ number: 1, text: 'private payload from expired source' }],
        excerpt: 'private payload from expired source',
        createdAt: now,
      },
    }, workspace.id, 'c'.repeat(64));
    await server.database.query(
      `INSERT INTO model_jobs (id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6, NULL)`,
      [randomUUID(), workspace.id, workspace.epoch, owner.actorId,
        JSON.stringify({ prompt: 'private payload from expired model job' }), now],
    );
    await server.database.query('UPDATE workspaces SET expires_at = $2 WHERE id = $1 OR id = $3', [workspace.id, now - 1, peerWorkspace.id]);
    const expiredRead = await call<ApiError>(base, `/api/workspaces/${workspace.id}`, { session: owner });
    expect(expiredRead.response.status).toBe(404);

    await server.app.sweepExpiredWorkspaces();
    expect(await server.repository.expireWorkspaces(now)).toBe(0);
    const scrubbed = await server.database.query<{ title: string; owner_actor_id: string; purged_at: number; epoch: number }>(
      'SELECT title, owner_actor_id, purged_at, epoch FROM workspaces WHERE id = $1', [workspace.id],
    );
    expect(scrubbed.rows[0]).toMatchObject({ title: 'Expired workspace', owner_actor_id: 'expired', purged_at: now, epoch: 2 });
    const privateContent = await server.database.query<{ content: string }>(
      `SELECT domain_state::text AS content FROM workspaces WHERE id = $1
       UNION ALL SELECT state::text FROM snapshots WHERE workspace_id = $1
       UNION ALL SELECT event_data::text FROM events WHERE workspace_id = $1
       UNION ALL SELECT response::text FROM commands WHERE workspace_id = $1
       UNION ALL SELECT data::text FROM model_jobs WHERE workspace_id = $1`,
      [workspace.id],
    );
    expect(JSON.stringify(privateContent.rows)).not.toContain('private payload from expired');
    const privateRowCounts = await server.database.query<{ events: number; commands: number; snapshots: number; memberships: number; invitations: number }>(
      `SELECT
         (SELECT COUNT(*)::int FROM events WHERE workspace_id = $1) AS events,
         (SELECT COUNT(*)::int FROM commands WHERE workspace_id = $1) AS commands,
         (SELECT COUNT(*)::int FROM snapshots WHERE workspace_id = $1) AS snapshots,
         (SELECT COUNT(*)::int FROM memberships WHERE workspace_id = $1) AS memberships,
         (SELECT COUNT(*)::int FROM invitations WHERE workspace_id = $1) AS invitations`,
      [workspace.id],
    );
    expect(privateRowCounts.rows[0]).toEqual({ events: 0, commands: 0, snapshots: 1, memberships: 0, invitations: 0 });
    const revokedJob = await server.database.query<{ status: string; data: unknown; revoked_at: number | null }>(
      'SELECT status, data, revoked_at FROM model_jobs WHERE workspace_id = $1', [workspace.id],
    );
    expect(revokedJob.rows[0]).toMatchObject({ status: 'revoked', data: {}, revoked_at: now });
    expect(await server.repository.listPendingArtifactCleanup()).toContainEqual({
      workspaceId: workspace.id, epoch: workspace.epoch, objectKey: artifactId, requestedAt: now,
    });

    const revokedGuest = await call<ApiError>(base, `/api/workspaces/${peerWorkspace.id}`, { session: joined.session });
    expect(revokedGuest.response.status).toBe(401);
    const ownerSession = await call<SessionView>(base, '/api/session', { session: owner });
    expect(ownerSession.response.status).toBe(200);
    expect((ownerSession.body as SessionView).workspaces).toEqual([]);
    const replacement = await createWorkspace(base, owner, 'teaching');
    expect(replacement.id).not.toBe(workspace.id);
  });

  it('persists sessions and projected domain state across a local PGlite restart', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'tabletop-r1-authority-'));
    const safeDirectory = resolve(testDirectory);
    const safeTempRoot = resolve(tmpdir());
    expect(safeDirectory.startsWith(`${safeTempRoot}${process.platform === 'win32' ? '\\' : '/'}`)).toBe(true);
    let handle: StartedServer | undefined;
    try {
      const opened = await openServer(testDirectory);
      handle = opened.server;
      const session = await createSession(opened.base, 'Durable owner');
      const workspace = await createWorkspace(opened.base, session, 'invoice');
      const requestSocket = new Socket();
      const request = new IncomingMessage(requestSocket);
      request.headers.cookie = session.cookie;
      const authenticated = await handle.authority.authenticate(request);
      requestSocket.destroy();
      await handle.authority.executeTrusted(authenticated, {
        commandId: randomUUID(),
        expectedRevision: workspace.revision,
        expectedEpoch: workspace.epoch,
        type: 'invoice.import',
        payload: {},
      }, {
        artifact: {
          id: randomUUID(),
          filename: 'durable-source.txt',
          kind: 'excerpt',
          status: 'provided',
          sha256: 'd'.repeat(64),
          pages: [{ number: 1, text: 'Durable source.' }],
          excerpt: 'Durable source.',
          createdAt: Date.now(),
        },
      }, workspace.id, 'e'.repeat(64));
      await handle.database.query('UPDATE outbox SET delivered_at = NULL WHERE workspace_id = $1', [workspace.id]);
      const closed = handle;
      handle = undefined;
      await closeServer(closed);

      const restarted = await openServer(testDirectory);
      handle = restarted.server;
      await restarted.server.app.dispatchPendingOutbox();
      const dispatched = await restarted.server.database.query<{ count: number }>(
        'SELECT COUNT(*)::int AS count FROM outbox WHERE workspace_id = $1 AND delivered_at IS NOT NULL', [workspace.id],
      );
      expect(dispatched.rows[0]?.count).toBeGreaterThan(0);
      const sessionView = await call<SessionView>(restarted.base, '/api/session', { session });
      expect(sessionView.response.status).toBe(200);
      expect((sessionView.body as SessionView).workspaces).toMatchObject([{ id: workspace.id, role: 'owner' }]);
      const projection = await call<WorkspaceView>(restarted.base, `/api/workspaces/${workspace.id}`, { session });
      expect(projection.response.status).toBe(200);
      expect((projection.body as WorkspaceView).domain.kind).toBe('invoice');
    } finally {
      if (handle) await closeServer(handle);
      await rm(safeDirectory, { recursive: true, force: true });
      expect(dirname(safeDirectory)).toBe(safeTempRoot);
    }
  });

  it('serves /version from the build identity file and reports 404 when it is missing or malformed', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'tabletop-version-'));
    const safeDirectory = resolve(testDirectory);
    let server: StartedServer | undefined;
    try {
      const opened = await openServer(':memory:', undefined, safeDirectory);
      server = opened.server;
      expect((await fetch(`${opened.base}/version`)).status).toBe(404);
      await writeFile(join(safeDirectory, 'version.json'), '{"version":"1.2.0","sha":"a1b2c3d","built_at":"2026-10-20T04:12:00Z","extra":true}');
      expect((await fetch(`${opened.base}/version`)).status).toBe(404);
      await writeFile(join(safeDirectory, 'version.json'), '{"version":"1.2.0","sha":"a1b2c3d","built_at":"2026-10-20T04:12:00Z"}\n');
      const response = await fetch(`${opened.base}/version`);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(await response.json()).toEqual({ version: '1.2.0', sha: 'a1b2c3d', built_at: '2026-10-20T04:12:00Z' });
    } finally {
      if (server) await closeServer(server);
      await rm(safeDirectory, { recursive: true, force: true });
    }
  });

  it('serves the app shell for page paths so deep links and reloads work', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'tabletop-routes-'));
    const safeDirectory = resolve(testDirectory);
    let server: StartedServer | undefined;
    try {
      await writeFile(join(safeDirectory, 'index.html'), '<!doctype html><title>Tabletop shell</title>');
      const opened = await openServer(':memory:', undefined, safeDirectory);
      server = opened.server;
      for (const path of ['/', '/new', '/join', '/t/0f8fad5b-d9cb-469f-a165-70867728950e']) {
        const response = await fetch(`${opened.base}${path}`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/html');
        expect(await response.text()).toContain('Tabletop shell');
      }
    } finally {
      if (server) await closeServer(server);
      await rm(safeDirectory, { recursive: true, force: true });
    }
  });

  it('keeps static assets and health checks outside the API request budget', async () => {
    const testDirectory = await mkdtemp(join(tmpdir(), 'tabletop-r1-static-'));
    const safeDirectory = resolve(testDirectory);
    const safeTempRoot = resolve(tmpdir());
    let server: StartedServer | undefined;
    try {
      await mkdir(safeDirectory, { recursive: true });
      await writeFile(join(safeDirectory, 'app.0123456789.js'), 'export {};');
      const opened = await openServer(':memory:', undefined, safeDirectory);
      server = opened.server;
      for (let index = 0; index < MAX_HTTP_REQUESTS_PER_MINUTE + 5; index += 1) {
        const response = await fetch(`${opened.base}/app.0123456789.js`);
        expect(response.status).toBe(200);
      }
      expect((await fetch(`${opened.base}/healthz`)).status).toBe(200);
      expect((await fetch(`${opened.base}/readyz`)).status).toBe(200);
      expect((await fetch(`${opened.base}/api/session`)).status).toBe(401);
    } finally {
      if (server) await closeServer(server);
      await rm(safeDirectory, { recursive: true, force: true });
      expect(dirname(safeDirectory)).toBe(safeTempRoot);
    }
  });
});
