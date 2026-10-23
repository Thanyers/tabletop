import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { WebSocket as WebSocketExport } from 'ws';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CommandAck, SessionView, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { ApiError } from '../src/tabletop/shared/contracts.js';
import { hashValue } from './codec.js';
import { startServer, type StartedServer } from './start.js';
import { MAX_HTTP_REQUESTS_PER_MINUTE } from './limits.js';
import { gameChange, rollCombatChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import { ROLL_LIMITS } from '../src/tabletop/shared/roll.js';
import { rollTotal } from '../src/tabletop/domain/roll.js';
import type { ComputeRunner } from '../src/tabletop/shared/table-compute.js';

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

async function currentView(base: string, session: TestSession, workspaceId: string): Promise<WorkspaceView> {
  const { response, body } = await call<WorkspaceView>(base, `/api/workspaces/${workspaceId}`, { session });
  expect(response.status).toBe(200);
  return body as WorkspaceView;
}

/** F035: give a member a role through the public command, as the owner (or another manager) would. */
async function assignRole(base: string, session: TestSession, workspaceId: string, actorId: string, roleId: string): Promise<WorkspaceView> {
  const result = await command(base, session, await currentView(base, session, workspaceId), 'access.assign', { actorId, roleId });
  expect(result.response.status, JSON.stringify(result.body)).toBe(200);
  return (result.body as CommandAck).workspace;
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
  it('relays live cursors to the other member over sockets and rejects spoofed frames (F009)', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Owner');
    const member = await createSession(base, 'Member');
    const view = await createWorkspace(base, owner, 'table');
    const joined = await redeem(base, member, (await invite(base, owner, view.id, 'member-1')).ticket);
    const open = (cookie: string) => new WebSocketClient(`ws://127.0.0.1:${server.port}/api/workspaces/${view.id}/socket`, { headers: { cookie, origin: base } }) as TestWebSocket & { send(data: string): void };
    const ownerSocket = open(owner.cookie);
    const memberSocket = open(joined.session.cookie);
    const cursorFrames = (socket: TestWebSocket) => {
      const seen: unknown[] = [];
      socket.on('message', (data: Buffer) => { const parsed = JSON.parse(data.toString('utf8')) as { type?: string }; if (parsed.type === 'cursor') seen.push(parsed); });
      return seen;
    };
    try {
      await Promise.all([receiveSocketProjection(ownerSocket), receiveSocketProjection(memberSocket)]);
      const ownerFrames = cursorFrames(ownerSocket);
      const memberFrames = cursorFrames(memberSocket);
      ownerSocket.send(JSON.stringify({ type: 'cursor', x: 10.7, y: 20 }));
      ownerSocket.send(JSON.stringify({ type: 'cursor', x: 11, y: 21 }));
      await vi.waitFor(() => expect(memberFrames).toEqual([{ type: 'cursor', actorId: view.actor.actorId, x: 11, y: 20 }]));
      expect(ownerFrames).toEqual([]);
      const closed = waitForSocketClose(memberSocket);
      memberSocket.send(JSON.stringify({ type: 'cursor', x: 1, y: 1, actorId: view.actor.actorId }));
      await closed;
      await vi.waitFor(() => expect(ownerFrames).toEqual([{ type: 'cursor', actorId: joined.workspace.actor.actorId, leave: true }]));
    } finally {
      ownerSocket.close();
      memberSocket.close();
    }
  });
  it('shares independent layout revisions over sockets, preserves valid actions, and rejects stale drags', async () => {
    const { base, server } = await openServer();
    const owner = await createSession(base, 'Owner');
    const member = await createSession(base, 'Member');
    let view = await createWorkspace(base, owner, 'table');
    const invitation = await invite(base, owner, view.id, 'member-1');
    const joined = await redeem(base, member, invitation.ticket);
    view = (await call<WorkspaceView>(base, `/api/workspaces/${view.id}`, { session: owner })).body as WorkspaceView;
    const run = async (type: string, payload: unknown) => {
      const result = await command(base, owner, view, type, payload);
      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
      view = (result.body as CommandAck).workspace;
    };
    await run('table.import', tableScenarioSources.game);
    if (view.domain.kind !== 'table') throw Error('Expected table');
    await run('evolve.propose', { change: gameChange(view.domain.sources[0].id) });
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) await run(type, {});
    const memberBefore = (await call<WorkspaceView>(base, `/api/workspaces/${view.id}`, { session: joined.session })).body as WorkspaceView;
    const socket = new WebSocketClient(`ws://127.0.0.1:${server.port}/api/workspaces/${view.id}/socket`, {
      headers: { cookie: joined.session.cookie, origin: base },
    });
    try {
      await receiveSocketProjection(socket);
      const nextProjection = receiveSocketProjection(socket);
      const before = view;
      await run('canvas.layout', { expectedLayoutRevision: 0, positions: { 'table.collection.boats': { x: 900, y: 250, pinned: true } } });
      expect(view.revision).toBe(before.revision);
      const received = (await nextProjection).workspace;
      expect(received.revision).toBe(memberBefore.revision);
      expect(received.domain).toMatchObject({ canvasLayout: { revision: 1, positions: { 'table.collection.boats': { x: 900, y: 250 } } } });
      const stale = await command(base, joined.session, memberBefore, 'canvas.layout', {
        expectedLayoutRevision: 0, positions: { 'table.collection.boats': { x: 100, y: 100 } },
      });
      expect(stale.response.status).toBe(409);
      expect(stale.body).toMatchObject({ errorCode: 'STALE_LAYOUT' });
      // The action prepared before the move is still valid.
      const action = await command(base, owner, before, 'table.act', { actionId: 'advance', inputs: { boat: 'red' } });
      expect(action.response.status).toBe(200);
      view = (action.body as CommandAck).workspace;
      // A stale game revision does not invalidate a correctly versioned layout command.
      const moved = await command(base, joined.session, memberBefore, 'canvas.layout', {
        expectedLayoutRevision: 1, positions: { 'table.actions': { x: 1400, y: 250, pinned: true } },
      });
      expect(moved.response.status).toBe(200);
      const resumed = (await call<WorkspaceView>(base, `/api/workspaces/${view.id}`, { session: owner })).body as WorkspaceView;
      expect(resumed.domain).toMatchObject({ canvasLayout: { revision: 2 }, records: { boats: [{ id: 'red', values: { score: 2 } }, { id: 'blue' }] } });
      const events = await call<{ cursor: string; resync: boolean }>(base, `/api/workspaces/${view.id}/events?after=${memberBefore.revision}`, { session: joined.session });
      expect(events.body).toMatchObject({ resync: true });
      expect((events.body as { cursor: string }).cursor).not.toBe(memberBefore.revision);
    } finally { socket.close(); }
  });

  it('issues a server roll, consumes it once, records the dice, and rejects a missing, tampered, or expired roll (F048)', async () => {
    let clock = Date.parse('2026-10-22T12:00:00.000Z');
    const { base, server } = await openServer(':memory:', () => clock);
    const owner = await createSession(base, 'Roll owner');
    const member = await createSession(base, 'Roll member');
    let view = await createWorkspace(base, owner, 'table');
    const joined = await redeem(base, member, (await invite(base, owner, view.id, 'member-1')).ticket);
    // Joining changes the member list, so the owner's creation view is no longer the current one.
    view = await currentView(base, owner, view.id);

    const change = rollCombatChange();
    for (const type of ['evolve.propose', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) {
      const result = await command(base, owner, view, type, type === 'evolve.propose' ? { change } : {});
      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
      view = (result.body as CommandAck).workspace;
    }

    // A participant whose seat does not hold the turn cannot roll for the action.
    const memberView = await currentView(base, joined.session, view.id);
    const memberRoll = await command(base, joined.session, memberView, 'table.roll', { actionId: 'attack', parameterId: 'damage' });
    expect(memberRoll.response.status).toBe(422);
    expect((memberRoll.body as ApiError).errorCode).toBe('TABLE_TURN');

    const rollResult = await command(base, owner, view, 'table.roll', { actionId: 'attack', parameterId: 'damage' });
    expect(rollResult.response.status, JSON.stringify(rollResult.body)).toBe(200);
    const rollAck = rollResult.body as CommandAck;
    expect(rollAck.roll?.groups).toEqual([{ count: 2, faces: 6 }]);
    expect(rollAck.roll?.values).toHaveLength(2);
    for (const value of rollAck.roll?.values ?? []) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(rollAck.roll?.total).toBe((rollAck.roll?.values ?? []).reduce((sum, value) => sum + value, 0) + 3);
    if (rollAck.workspace.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    // The pending roll is authoritative state but never appears in a member projection.
    expect(rollAck.workspace.domain.pendingRolls).toBeUndefined();
    const memberAfterRoll = await currentView(base, joined.session, view.id);
    expect(memberAfterRoll.domain.kind === 'table' && memberAfterRoll.domain.pendingRolls).toBeFalsy();

    // A client-sent value for a roll parameter is rejected and does not consume the pending roll.
    const spoof = await command(base, owner, rollAck.workspace, 'table.act', { actionId: 'attack', inputs: { target: 'hero', damage: 1 } });
    expect(spoof.response.status).toBe(422);
    expect((spoof.body as ApiError).errorCode).toBe('TABLE_ROLL_CLIENT_VALUE');

    const acted = await command(base, owner, rollAck.workspace, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } });
    expect(acted.response.status, JSON.stringify(acted.body)).toBe(200);
    const actAck = acted.body as CommandAck;
    expect(actAck.roll).toEqual(rollAck.roll);
    if (actAck.workspace.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    const hit = actAck.workspace.domain.records.hits?.at(-1);
    expect(hit?.values).toEqual({ target: 'hero', damage: rollAck.roll?.total });
    expect(actAck.workspace.domain.records.fighters?.[0]?.values.damage_taken).toBe(rollAck.roll?.total);

    // The recorded history carries the exact faces and total, and the submitted inputs omit the roll.
    const events = await server.database.query<{ event_data: unknown }>(
      `SELECT event_data FROM events WHERE workspace_id = $1 AND event_type IN ('table.roll', 'table.act') ORDER BY workspace_sequence`,
      [view.id],
    );
    const payloads = events.rows.map((row) => (typeof row.event_data === 'string' ? JSON.parse(row.event_data) : row.event_data) as { payload?: Record<string, unknown> });
    const rollEvent = payloads.find((item) => typeof item.payload?.parameterId === 'string');
    const actEvent = payloads.find((item) => item.payload !== undefined && 'inputs' in item.payload);
    const recordedRoll = rollEvent?.payload?.roll as { parameterId?: string; groups?: unknown; values?: number[]; total?: number } | undefined;
    const recordedActRoll = actEvent?.payload?.roll as { parameterId?: string; values?: number[]; total?: number } | undefined;
    expect(recordedRoll).toMatchObject({ parameterId: 'damage', groups: [{ count: 2, faces: 6 }], values: rollAck.roll?.values, total: rollAck.roll?.total });
    expect(recordedActRoll).toMatchObject({ parameterId: 'damage', values: rollAck.roll?.values, total: rollAck.roll?.total });
    expect(rollTotal(recordedActRoll?.values ?? [], 3)).toBe(recordedActRoll?.total);
    expect(actEvent?.payload?.inputs).toEqual({ target: 'hero' });
    expect(actEvent?.payload?.inputs).not.toHaveProperty('damage');

    // Reuse is refused after the single use.
    const reuse = await command(base, owner, actAck.workspace, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } });
    expect(reuse.response.status).toBe(409);
    expect((reuse.body as ApiError).errorCode).toBe('TABLE_ROLL_REQUIRED');

    // Expiry is checked against server time, not the client.
    const beforeExpiry = await currentView(base, owner, view.id);
    const expiryRoll = await command(base, owner, beforeExpiry, 'table.roll', { actionId: 'attack', parameterId: 'damage' });
    expect(expiryRoll.response.status).toBe(200);
    clock += ROLL_LIMITS.pendingTtlMs + 1;
    const afterExpiry = await currentView(base, owner, view.id);
    const expired = await command(base, owner, afterExpiry, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } });
    expect(expired.response.status).toBe(409);
    expect((expired.body as ApiError).errorCode).toBe('TABLE_ROLL_EXPIRED');
  });

  it('creates table owners, redeems participant seats, and shows imported source text to participants read-only (F008)', async () => {
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
    expect(JSON.stringify(participantView.body)).toContain('LOCAL_TABLE_SOURCE_SENTINEL');
    if ((participantView.body as WorkspaceView).domain.kind !== 'table') throw new Error('Expected participant table projection.');
    expect(((participantView.body as WorkspaceView).domain as Extract<WorkspaceView['domain'], { kind: 'table' }>).sources.map(source => source.filename)).toEqual([tableScenarioSources.equipment.filename]);

    // F035: an unassigned member may remove files; a Contributor (files.add without files.remove) may not.
    await assignRole(base, owner, workspace.id, participant.actorId, 'contributor');
    const memberImport = await command(base, redeemed.session, await currentView(base, redeemed.session, workspace.id), 'table.import', {
      filename: 'second.txt', text: 'participants can add sources',
    });
    expect(memberImport.response.status).toBe(200);
    const memberSource = ((memberImport.body as CommandAck).workspace.domain as Extract<WorkspaceView['domain'], { kind: 'table' }>).sources.find(source => source.filename === 'second.txt');
    expect(memberSource).toBeTruthy();
    const removeDenied = await command(base, redeemed.session, (memberImport.body as CommandAck).workspace, 'table.removeSource', { sourceId: memberSource!.id });
    expect(removeDenied.response.status).toBe(403);
    expect((removeDenied.body as ApiError).errorCode).toBe('FORBIDDEN');
  });

  it('lets only members with members.remove remove a participant, who then loses access (F003-T1, F035)', async () => {
    const { base } = await openServer();
    const owner = await createSession(base, 'Remove owner');
    const first = await createSession(base, 'First participant');
    const second = await createSession(base, 'Second participant');
    const workspace = await createWorkspace(base, owner, 'table');
    const firstJoin = await redeem(base, first, (await invite(base, owner, workspace.id, 'member-1')).ticket);
    const secondJoin = await redeem(base, second, (await invite(base, owner, workspace.id, 'member-2')).ticket);
    const path = `/api/workspaces/${workspace.id}/members/remove`;
    await assignRole(base, owner, workspace.id, first.actorId, 'editor');

    const byParticipant = await call<WorkspaceView>(base, path, { session: firstJoin.session, body: { actorId: second.actorId } });
    expect(byParticipant.response.status).toBe(403);
    expect((byParticipant.body as ApiError).errorCode).toBe('ROLE_FORBIDDEN');
    const removeOwner = await call<WorkspaceView>(base, path, { session: owner, body: { actorId: owner.actorId } });
    expect(removeOwner.response.status).toBe(409);
    expect((removeOwner.body as ApiError).errorCode).toBe('MEMBER_NOT_REMOVABLE');
    const malformed = await call<WorkspaceView>(base, path, { session: owner, body: { actorId: second.actorId, extra: 1 } });
    expect(malformed.response.status).toBe(400);
    expect((malformed.body as ApiError).errorCode).toBe('INVALID_REQUEST');

    const memberBefore = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: secondJoin.session });
    expect(memberBefore.response.status).toBe(200);
    const removed = await call<WorkspaceView>(base, path, { session: owner, body: { actorId: second.actorId } });
    expect(removed.response.status).toBe(200);
    expect((removed.body as WorkspaceView).members.map((member) => member.actorId).sort())
      .toEqual([owner.actorId, first.actorId].sort());

    const revokedRead = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: secondJoin.session });
    expect(revokedRead.response.status).toBe(403);
    expect((revokedRead.body as ApiError).errorCode).toBe('MEMBERSHIP_REVOKED');
    const revokedCommand = await command(base, secondJoin.session, memberBefore.body as WorkspaceView, 'table.import', {
      filename: 'after-removal.txt', text: 'a removed participant cannot write',
    });
    expect(revokedCommand.response.status).toBe(403);
    const removeAgain = await call<WorkspaceView>(base, path, { session: owner, body: { actorId: second.actorId } });
    expect(removeAgain.response.status).toBe(404);
    expect((removeAgain.body as ApiError).errorCode).toBe('MEMBER_NOT_FOUND');
    const stillThere = await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: firstJoin.session });
    expect(stillThere.response.status).toBe(200);
  });

  it('isolates sessions, shares teacher notes with members (F015 open visibility), rejects learner teacher actions, and enforces command idempotency/CAS', async () => {
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
    // Was: the learner projection hid the note and kept its revision. Under open visibility (F015) the
    // learner reads the note and their revision moves; non-members above are still rejected with 403.
    expect((learnerView.body as WorkspaceView).domain).toMatchObject({ teacherNote: 'Answer key: private.' });
    expect((learnerView.body as WorkspaceView).revision).not.toBe(learnerWorkspaceBeforePrivateChange.revision);

    // F035: an unassigned learner holds lesson.parameters; the Learner preset does not, and the domain refuses it.
    workspace = await assignRole(base, teacher, workspace.id, learner.actorId, 'learner');
    const learnerPresetView = await currentView(base, learnerSession, workspace.id);
    const deniedTeacherAction = await command(base, learnerSession, learnerPresetView, 'teaching.setParameters', { force: 20, mass: 2, time: 2 });
    expect(deniedTeacherAction.response.status).toBe(403);
    expect((deniedTeacherAction.body as ApiError).errorCode).toBe('FORBIDDEN');

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

  it('serializes socket projections and pushes teacher-note changes to learners under open visibility (F015)', async () => {
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
      // Was: a private teacher note sent the learner nothing. Under open visibility (F015) the learner's
      // projection changes, so exactly one projection carrying the note arrives.
      const noteProjection = receiveSocketProjection(socket);
      const privateNote = await command(base, owner, ownerView, 'teaching.saveNote', { text: 'Private teacher key.' });
      expect(privateNote.response.status).toBe(200);
      ownerView = (privateNote.body as CommandAck).workspace;
      expect((await noteProjection).workspace.domain).toMatchObject({ teacherNote: 'Private teacher key.' });
      await new Promise<void>((resolveWait) => setTimeout(resolveWait, 100));
      expect(receivedCount).toBe(1);
      expect(unexpectedMessage).toBe(false);
      receivedCount = 0;

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
    // F053: a fresh table carries its created time, no separate change time and no editor yet.
    const firstRow = (list.body as SessionView).workspaces.find((workspace) => workspace.id === first.id);
    expect(firstRow?.createdAt).toEqual(expect.any(Number));
    expect(firstRow?.updatedAt).toBe(firstRow?.createdAt);
    expect(firstRow?.updatedBy).toBeUndefined();

    const firstCurrentView = await call<WorkspaceView>(base, `/api/workspaces/${first.id}`, { session: owner });
    const note = await command(base, owner, firstCurrentView.body as WorkspaceView, 'teaching.saveNote', { text: 'Still the first room.' });
    expect(note.response.status).toBe(200);
    expect((note.body as CommandAck).workspace.id).toBe(first.id);
    // F053: the first committed change moves the time and names the member who made it.
    const afterNote = await call<SessionView>(base, '/api/session', { session: owner });
    const changedRow = (afterNote.body as SessionView).workspaces.find((workspace) => workspace.id === first.id);
    expect(changedRow?.updatedAt).toBeGreaterThanOrEqual(firstRow?.updatedAt ?? 0);
    expect(changedRow?.updatedBy).toBe('Owner');

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
    // F035: a Contributor has no table.rename (an unassigned member would).
    const ownerAfterAssign = await assignRole(base, owner, workspace.id, member.actorId, 'contributor');
    const memberView = (await call<WorkspaceView>(base, `/api/workspaces/${workspace.id}`, { session: joined.session })).body as WorkspaceView;
    expect(memberView.title).toBe('Friday boat club');
    const memberRename = await command(base, joined.session, memberView, 'workspace.rename', { title: 'Taken over' });
    expect(memberRename.response.status).toBe(403);
    expect((memberRename.body as ApiError).errorCode).toBe('ROLE_FORBIDDEN');
    for (const payload of [{ title: '   ' }, { title: 'line\nbreak' }, { title: 'x'.repeat(101) }, { title: 5 }, { name: 'wrong field' }, { title: 'ok', extra: true }]) {
      const rejected = await command(base, owner, ownerAfterAssign, 'workspace.rename', payload);
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

describe('F035 role permissions at the authority', () => {
  async function tableWithMembers(count: number) {
    const { base } = await openServer();
    const owner = await createSession(base, 'Role owner');
    const workspace = await createWorkspace(base, owner, 'table');
    const members: Array<{ actorId: string; session: TestSession }> = [];
    for (let index = 1; index <= count; index += 1) {
      const guest = await createSession(base, `Member ${index}`);
      const joined = await redeem(base, guest, (await invite(base, owner, workspace.id, `member-${index}`)).ticket);
      members.push({ actorId: guest.actorId, session: joined.session });
    }
    return { base, owner, workspaceId: workspace.id, members };
  }

  it('lets an unassigned member invite, rename, remove another member and run the whole rule review, but not reset or remove the owner', async () => {
    const { base, owner, workspaceId, members: [first, second] } = await tableWithMembers(2);
    const session = first.session;

    const invited = await call<InviteResponse>(base, `/api/workspaces/${workspaceId}/invites`, { session, body: { seat: 'member-3' } });
    expect(invited.response.status, JSON.stringify(invited.body)).toBe(201);
    const renamed = await command(base, session, await currentView(base, session, workspaceId), 'workspace.rename', { title: 'Member named' });
    expect(renamed.response.status).toBe(200);
    expect((renamed.body as CommandAck).workspace.title).toBe('Member named');

    let view = await currentView(base, session, workspaceId);
    const run = async (type: string, payload: unknown) => {
      const result = await command(base, session, view, type, payload);
      expect(result.response.status, `${type}: ${JSON.stringify(result.body)}`).toBe(200);
      view = (result.body as CommandAck).workspace;
    };
    await run('table.import', tableScenarioSources.game);
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    await run('evolve.propose', { change: gameChange(view.domain.sources[0].id) });
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) await run(type, {});
    expect(view.domain.kind === 'table' && view.domain.ruleRevision).toBe(1);

    const removeOwner = await call<WorkspaceView>(base, `/api/workspaces/${workspaceId}/members/remove`, { session, body: { actorId: owner.actorId } });
    expect(removeOwner.response.status).toBe(409);
    expect((removeOwner.body as ApiError).errorCode).toBe('MEMBER_NOT_REMOVABLE');
    const removed = await call<WorkspaceView>(base, `/api/workspaces/${workspaceId}/members/remove`, { session, body: { actorId: second.actorId } });
    expect(removed.response.status).toBe(200);
    expect((removed.body as WorkspaceView).members.map((member) => member.actorId)).not.toContain(second.actorId);

    const reset = await command(base, session, await currentView(base, session, workspaceId), 'workspace.reset', {});
    expect(reset.response.status).toBe(403);
    expect((reset.body as ApiError).errorCode).toBe('ROLE_FORBIDDEN');
  });

  it('refuses every management action for a Viewer', async () => {
    const { base, owner, workspaceId, members: [viewer, other] } = await tableWithMembers(2);
    await assignRole(base, owner, workspaceId, viewer.actorId, 'viewer');
    const session = viewer.session;
    const view = await currentView(base, session, workspaceId);
    expect(view.domain.access?.assignments).toEqual({ [viewer.actorId]: 'viewer' });

    const invited = await call<ApiError>(base, `/api/workspaces/${workspaceId}/invites`, { session, body: { seat: 'member-3' } });
    expect([invited.response.status, (invited.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    const removed = await call<ApiError>(base, `/api/workspaces/${workspaceId}/members/remove`, { session, body: { actorId: other.actorId } });
    expect([removed.response.status, (removed.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    const renamed = await command(base, session, view, 'workspace.rename', { title: 'Viewer named' });
    expect([renamed.response.status, (renamed.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    for (const [type, payload] of [
      ['table.import', { filename: 'viewer.txt', text: 'viewer text' }],
      ['evolve.propose', { change: gameChange('missing-source') }],
      ['evolve.simulate', {}],
      ['access.assign', { actorId: other.actorId, roleId: 'viewer' }],
      ['access.saveRole', { name: 'Viewer made', permissions: [] }],
    ] as const) {
      const denied = await command(base, session, view, type, payload);
      expect([denied.response.status, (denied.body as ApiError).errorCode], type).toEqual([403, 'FORBIDDEN']);
    }
    const reset = await command(base, session, view, 'workspace.reset', {});
    expect([reset.response.status, (reset.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
  });

  it('lets an unassigned learner change lesson settings and write notes, but answers stay with the learner seat', async () => {
    const { base } = await openServer();
    const teacher = await createSession(base, 'Lesson teacher');
    const guest = await createSession(base, 'Lesson learner');
    const workspace = await createWorkspace(base, teacher, 'teaching');
    const joined = await redeem(base, guest, (await invite(base, teacher, workspace.id, 'learner-1')).ticket);
    const changed = await command(base, joined.session, await currentView(base, joined.session, workspace.id), 'teaching.setParameters', { force: 20, mass: 2, time: 2 });
    expect(changed.response.status, JSON.stringify(changed.body)).toBe(200);
    expect((changed.body as CommandAck).workspace.domain).toMatchObject({ parameters: { force: 20, mass: 2, time: 2 } });
    const note = await command(base, joined.session, (changed.body as CommandAck).workspace, 'teaching.saveNote', { text: 'Learner note' });
    expect(note.response.status, JSON.stringify(note.body)).toBe(200);
    const view = (note.body as CommandAck).workspace;
    if (view.domain.kind !== 'teaching') throw new Error('Expected a lesson.');
    const teacherAnswer = await command(base, teacher, await currentView(base, teacher, workspace.id), 'teaching.answer', { questionId: 'any', value: 1 });
    expect([teacherAnswer.response.status, (teacherAnswer.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
  });

  it('assigns roles only to current non-owner members', async () => {
    const { base, owner, workspaceId, members: [member] } = await tableWithMembers(1);
    const outsider = await createSession(base, 'Outsider');
    const view = await currentView(base, owner, workspaceId);
    const toOwner = await command(base, owner, view, 'access.assign', { actorId: owner.actorId, roleId: 'viewer' });
    expect([toOwner.response.status, (toOwner.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    const byMember = await command(base, member.session, await currentView(base, member.session, workspaceId), 'access.assign', { actorId: owner.actorId, roleId: 'viewer' });
    expect([byMember.response.status, (byMember.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    const toOutsider = await command(base, owner, view, 'access.assign', { actorId: outsider.actorId, roleId: 'viewer' });
    expect([toOutsider.response.status, (toOutsider.body as ApiError).errorCode]).toEqual([404, 'MEMBER_NOT_FOUND']);
    const malformed = await command(base, owner, view, 'access.assign', { roleId: 'viewer' });
    expect([malformed.response.status, (malformed.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
    const back = await assignRole(base, owner, workspaceId, member.actorId, 'default');
    expect(back.domain.access?.assignments).toEqual({});
  });

  it('stops a role manager from granting permissions they do not hold', async () => {
    const { base, owner, workspaceId, members: [manager, target] } = await tableWithMembers(2);
    const saved = await command(base, owner, await currentView(base, owner, workspaceId), 'access.saveRole', {
      name: 'Role keeper', permissions: ['roles.manage', 'rules.draft', 'files.add', 'data.compute', 'table.act', 'ai.ask'],
    });
    expect(saved.response.status, JSON.stringify(saved.body)).toBe(200);
    const roleId = (saved.body as CommandAck).workspace.domain.access?.roles[0]?.id;
    if (!roleId) throw new Error('Expected a custom role.');
    await assignRole(base, owner, workspaceId, manager.actorId, roleId);
    const session = manager.session;
    // The target is unassigned (every permission), so a weaker manager cannot change their role at all.
    const strongerTarget = await command(base, session, await currentView(base, session, workspaceId), 'access.assign', { actorId: target.actorId, roleId: 'viewer' });
    expect([strongerTarget.response.status, (strongerTarget.body as ApiError).errorCode]).toEqual([403, 'FORBIDDEN']);
    await assignRole(base, owner, workspaceId, target.actorId, 'viewer');

    for (const [type, payload] of [
      ['access.assign', { actorId: target.actorId, roleId: 'manager' }],
      ['access.assign', { actorId: manager.actorId, roleId: 'manager' }],
      ['access.assign', { actorId: target.actorId, roleId: 'default' }],
      ['access.saveRole', { name: 'Remover', permissions: ['members.remove'] }],
      ['access.saveRole', { id: roleId, name: 'Role keeper', permissions: ['roles.manage', 'members.remove'] }],
    ] as const) {
      const denied = await command(base, session, await currentView(base, session, workspaceId), type, payload);
      expect([denied.response.status, (denied.body as ApiError).errorCode], JSON.stringify(payload)).toEqual([403, 'FORBIDDEN']);
    }
    const contributor = await assignRole(base, session, workspaceId, target.actorId, 'contributor');
    expect(contributor.domain.access?.assignments[target.actorId]).toBe('contributor');
    const removed = await call<ApiError>(base, `/api/workspaces/${workspaceId}/members/remove`, { session, body: { actorId: target.actorId } });
    expect([removed.response.status, (removed.body as ApiError).errorCode]).toEqual([403, 'ROLE_FORBIDDEN']);
  });

  it('lets an unassigned member apply their own draft and remove a rule, but not a Viewer (F039)', async () => {
    const { base, owner, workspaceId, members: [first, viewer] } = await tableWithMembers(2);
    const session = first.session;
    let view = await currentView(base, session, workspaceId);
    const run = async (type: string, payload: unknown) => {
      const result = await command(base, session, view, type, payload);
      expect(result.response.status, `${type}: ${JSON.stringify(result.body)}`).toBe(200);
      view = (result.body as CommandAck).workspace;
    };
    await run('table.import', tableScenarioSources.game);
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    await run('evolve.propose', { change: gameChange(view.domain.sources[0].id) });

    // The owner may not apply a draft somebody else asked for.
    const byOwner = await command(base, owner, await currentView(base, owner, workspaceId), 'evolve.autoApply', {});
    expect([byOwner.response.status, (byOwner.body as ApiError).errorCode]).toEqual([403, 'FORBIDDEN']);

    view = await currentView(base, session, workspaceId);
    await run('evolve.autoApply', {});
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    expect(view.domain.ruleRevision).toBe(1);
    expect(view.domain.candidate?.status).toBe('active');
    expect(view.domain.program?.actions.map((action) => action.id)).toEqual(['advance']);

    await assignRole(base, owner, workspaceId, viewer.actorId, 'viewer');
    const viewerView = await currentView(base, viewer.session, workspaceId);
    for (const [type, payload] of [
      ['evolve.autoApply', {}],
      ['evolve.removeItem', { kind: 'action', id: 'advance' }],
    ] as const) {
      const denied = await command(base, viewer.session, viewerView, type, payload);
      expect([denied.response.status, (denied.body as ApiError).errorCode], type).toEqual([403, 'FORBIDDEN']);
    }

    view = await currentView(base, session, workspaceId);
    await run('evolve.removeItem', { kind: 'action', id: 'advance' });
    if (view.domain.kind !== 'table') throw new Error('Expected a table workspace.');
    expect(view.domain.ruleRevision).toBe(2);
    expect(view.domain.program?.actions).toEqual([]);
    const missing = await command(base, session, view, 'evolve.removeItem', { kind: 'action', id: 'advance' });
    expect([missing.response.status, (missing.body as ApiError).errorCode]).toEqual([422, 'RULE_ITEM_NOT_FOUND']);
  });

  it('lets the owner set the table display for everyone and refuses a Viewer (display.set)', async () => {
    const { base, owner, workspaceId, members: [viewer] } = await tableWithMembers(1);
    await assignRole(base, owner, workspaceId, viewer.actorId, 'viewer');
    const denied = await command(base, viewer.session, await currentView(base, viewer.session, workspaceId), 'display.set', { connections: false });
    expect([denied.response.status, (denied.body as ApiError).errorCode]).toEqual([403, 'FORBIDDEN']);

    const hidden = await command(base, owner, await currentView(base, owner, workspaceId), 'display.set', { connections: false });
    expect(hidden.response.status, JSON.stringify(hidden.body)).toBe(200);
    expect((hidden.body as CommandAck).workspace.domain.display).toEqual({ connections: false });
    // The setting is shared: the Viewer reads it too.
    expect((await currentView(base, viewer.session, workspaceId)).domain.display).toEqual({ connections: false });
    const auto = await command(base, owner, (hidden.body as CommandAck).workspace, 'display.set', { connections: null });
    expect(auto.response.status, JSON.stringify(auto.body)).toBe(200);
    expect((auto.body as CommandAck).workspace.domain.display).toBeUndefined();

    // Display settings exist on every table kind.
    const lesson = await createWorkspace(base, owner, 'teaching');
    const lessonDisplay = await command(base, owner, lesson, 'display.set', { connections: true });
    expect(lessonDisplay.response.status, JSON.stringify(lessonDisplay.body)).toBe(200);
    expect((lessonDisplay.body as CommandAck).workspace.domain.display).toEqual({ connections: true });
  });
});

describe('F066 compute command boundary', () => {
  it('reauthenticates a real HTTP session before running generated table compute', async () => {
    const computeRunner: ComputeRunner = {
      async run() {
        return { outputs: { total: 7 } };
      },
    };
    const server = await startServer({
      environment: 'local',
      host: '127.0.0.1',
      port: 0,
      dataDir: ':memory:',
      computeRunner,
    });
    running.push(server);
    const base = `http://127.0.0.1:${server.port}`;
    try {
      const owner = await createSession(base, 'Compute owner');
      const workspace = await createWorkspace(base, owner, 'table');
      const stored = await server.repository.getWorkspace(workspace.id);
      if (!stored || stored.domainState.kind !== 'table') throw new Error('Expected a stored table workspace.');
      const state = structuredClone(stored.domainState);
      const program = gameChange('').program;
      program.compute = {
        version: 1,
        modules: [{
          id: 'session_total',
          name: 'Session total',
          description: 'Return a fixed test value.',
          runtime: 'javascript',
          version: 1,
          source: 'export default function compute(inputs) { return { total: inputs.value.value }; }',
          inputs: [{ id: 'value', label: 'Value', type: 'number', binding: { kind: 'literal', value: 7 } }],
          outputs: [{ id: 'total', label: 'Total', type: 'number' }],
        }],
      };
      state.program = program;
      state.ruleRevision = 1;
      await server.database.query(
        'UPDATE workspaces SET domain_state = $2::jsonb, state_hash = $3 WHERE id = $1',
        [workspace.id, JSON.stringify(state), hashValue(state)],
      );

      const requestSocket = new Socket();
      const request = new IncomingMessage(requestSocket);
      request.headers.cookie = owner.cookie;
      const authenticated = await server.authority.authenticate(request);
      requestSocket.destroy();
      await server.authority.authorizeSession(authenticated, workspace.id);

      let refreshed = await server.repository.getWorkspace(workspace.id);
      const deadline = Date.now() + 2_000;
      while (!refreshed?.domainState.kind || refreshed.domainState.kind !== 'table'
          || !refreshed.domainState.computeRuns?.some(run => run.status === 'succeeded')) {
        if (Date.now() >= deadline) break;
        await new Promise(resolveWait => setTimeout(resolveWait, 10));
        refreshed = await server.repository.getWorkspace(workspace.id);
      }
      expect(refreshed?.domainState.kind === 'table' ? refreshed.domainState.computeRuns : []).toMatchObject([
        expect.objectContaining({ status: 'succeeded', outputs: [{ outputId: 'total', value: 7 }] }),
      ]);
    } finally {
      await closeServer(server);
    }
  });

  it('rejects client queue/update commands and browser-selected run identifiers', async () => {
    const { base } = await openServer();
    const owner = await createSession(base, 'Compute owner');
    const workspace = await createWorkspace(base, owner, 'table');
    const participantSession = await createSession(base, 'Compute participant');
    const participant = await redeem(base, participantSession, (await invite(base, owner, workspace.id, 'member-1')).ticket);

    for (const [type, payload] of [
      ['table.compute.queue', { moduleId: 'totals', runId: randomUUID() }],
      ['table.compute.update', { runId: randomUUID(), status: 'succeeded', outputs: [{ outputId: 'total', value: 999 }] }],
    ] as const) {
      const forged = await command(base, participant.session, await currentView(base, participant.session, workspace.id), type, payload);
      expect([forged.response.status, (forged.body as ApiError).errorCode]).toEqual([400, 'COMMAND_NOT_ALLOWED']);
    }

    const injectedRunId = await command(base, owner, await currentView(base, owner, workspace.id), 'table.compute.run', {
      moduleId: 'totals', runId: randomUUID(),
    });
    expect([injectedRunId.response.status, (injectedRunId.body as ApiError).errorCode]).toEqual([403, 'INVALID_COMMAND_PAYLOAD']);
  });
});
