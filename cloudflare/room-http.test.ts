import { describe, expect, it, vi } from 'vitest';
import type { AuthorizedWorkspace, CommandAuthority } from '../server/authority.js';
import { sha256 } from '../server/codec.js';
import { createDomain } from '../src/tabletop/domain/index.js';
import type { Env } from './contracts.js';
import { createRoomHttp, matchRoomRoute, type RoomHttpDeps, type ToolIntentRun } from './room-http.js';
import type { RoomRepository } from './room-repository.js';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';

/**
 * F078-T6c: the route table and the routes that left the Room are tested here,
 * through the same interface the Room calls. Error mapping stays in `Room.fetch`,
 * so handler tests assert the thrown AuthorityError, and `room.test.ts` keeps
 * covering the mapped HTTP status.
 */

const ORIGIN = 'https://tabletop.test';
const CSRF = 'A'.repeat(43);
const ENV = { PUBLIC_ORIGIN: ORIGIN, TABLE_READ_ONLY: 'false' } as unknown as Env;

function mutationHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', Origin: ORIGIN, 'X-CSRF-Token': CSRF };
}
const ROOM = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`${ORIGIN}${path}`, init);
}

function authorizedView(overrides: Partial<AuthorizedWorkspace> = {}): AuthorizedWorkspace {
  const workspace = {
    id: ROOM,
    kind: 'table' as const,
    title: 'Room',
    epoch: 3,
    revision: 'rev-1',
    createdAt: 1_700_000_000_000,
    expiresAt: 253_402_300_799_000,
    actor: { actorId: 'actor-1', name: 'Owner', seat: 'host', role: 'owner' },
    members: [],
    domain: { kind: 'table' as const },
    display: {},
    sources: [],
    recordActions: [],
  } as unknown as WorkspaceView;
  return {
    session: { record: { actorId: 'actor-1', tokenHash: 'token-hash', csrfHash: sha256(CSRF), name: 'Owner', workspaceId: ROOM } },
    member: { actorId: 'actor-1', role: 'owner', seat: 'host' },
    context: { actorId: 'actor-1', role: 'owner', seat: 'host', epoch: 3, permissions: new Set(['members.invite', 'rules.draft']) },
    workspace,
    ...overrides,
  } as unknown as AuthorizedWorkspace;
}

function harness(options: { authorized?: AuthorizedWorkspace; env?: Env } = {}) {
  const view = options.authorized ?? authorizedView();
  const repository = {
    lastChange: vi.fn(() => ({ at: 1_700_000_100_000, actorId: 'actor-1', actorName: ' właściciel' })),
    inviteLinkStatus: vi.fn(() => ({ enabled: true, expiresAt: 1_700_100_000_000 })),
    disableInviteLink: vi.fn(async () => undefined),
    createInviteLink: vi.fn(async () => ({ expiresAt: 1_700_200_000_000 })),
    getWorkspace: vi.fn(async () => view.workspace),
    withWorkspaceTransaction: vi.fn(async (_id: string, operation: (transaction: unknown) => Promise<unknown>) =>
      operation({ listMembers: async () => [{ actorId: 'actor-1' }] })),
  } as unknown as RoomRepository;
  const authority = {
    execute: vi.fn(async () => ({ ok: true, eventId: 'event-1', workspace: view.workspace })),
    removeMember: vi.fn(async () => view.workspace),
    createInvite: vi.fn(async () => ({ ticket: 'ticket-1', expiresAt: 1_700_300_000_000 })),
  } as unknown as CommandAuthority;
  const scheduleDirectorySync = vi.fn();
  const runToolIntent = vi.fn(async (): Promise<ToolIntentRun> => ({
    ok: true as const,
    actionId: 'borrow',
    ack: { ok: true as const, commandId: 'command-1', duplicate: false, workspace: view.workspace },
  }));
  const readSpaceProjection = vi.fn(async (input: { grantId: string; spaceId: string; spaceWorkspaceId: string; actorId: string; portId: string }) => ({
    ok: true as const,
    grantId: input.grantId,
    projection: { portId: input.portId, resource: 'costs', fields: ['price'], maxRows: 25 },
    sourceDataRevision: 7,
    grantVersion: 1,
    readAt: 5_000,
  }));
  const deps: RoomHttpDeps = {
    env: () => options.env ?? ENV,
    repository,
    authority,
    requireBoundRoomId: () => ROOM,
    authorize: vi.fn(async () => view),
    create: vi.fn(async () => view.workspace),
    redeemInvite: vi.fn(async () => view.workspace),
    joinByInviteLink: vi.fn(async () => view.workspace),
    scheduleDirectorySync,
    readSpaceProjection,
    runToolIntent,
  };
  return { deps, repository, authority, scheduleDirectorySync, readSpaceProjection, runToolIntent, view };
}

const handle = (deps: RoomHttpDeps, req: Request, requestId = 'req-1') => {
  const match = matchRoomRoute(req, ROOM);
  if (!match || match.handler !== 'room-http') throw new Error(`not a room-http route: ${req.url}`);
  return createRoomHttp(deps).handle(req, match, requestId);
};

describe('room-http route table', () => {
  it.each([
    ['POST', '/internal/create', 'internal.create', 'room-http'],
    ['POST', '/internal/redeem', 'internal.redeem', 'room-http'],
    ['POST', '/internal/join-link', 'internal.join-link', 'room-http'],
    ['GET', '/internal/view', 'internal.view', 'room-http'],
    ['GET', '/internal/metadata', 'internal.metadata', 'room-http'],
    ['POST', '/internal/space-projection', 'internal.space-projection', 'room-http'],
    ['GET', `/api/workspaces/${ROOM}`, 'workspace.view', 'room-http'],
    ['GET', `/api/workspaces/${ROOM}/events`, 'events', 'room-http'],
    ['POST', `/api/workspaces/${ROOM}/commands`, 'commands', 'room-http'],
    ['GET', `/api/workspaces/${ROOM}/invite-link`, 'invite-link', 'room-http'],
    ['POST', `/api/workspaces/${ROOM}/members/remove`, 'members.remove', 'room-http'],
    ['POST', `/api/workspaces/${ROOM}/invites`, 'invites', 'room-http'],
    ['GET', `/api/workspaces/${ROOM}/export`, 'export', 'room-http'],
    ['GET', `/api/workspaces/${ROOM}/socket`, 'socket', 'room'],
    ['POST', `/api/workspaces/${ROOM}/model`, 'model.post', 'room'],
    ['GET', `/api/workspaces/${ROOM}/model`, 'model.list', 'room'],
    ['GET', `/api/workspaces/${ROOM}/model/${'a'.repeat(64)}`, 'model.get', 'room'],
    ['POST', `/api/workspaces/${ROOM}/assistant`, 'assistant.post', 'room'],
    ['GET', `/api/workspaces/${ROOM}/assistant/${'a'.repeat(64)}/confirm`.replace('/confirm', ''), 'assistant.get', 'room'],
    ['POST', `/api/workspaces/${ROOM}/assistant/${'a'.repeat(64)}/confirm`, 'assistant.confirm', 'room'],
    ['POST', `/api/workspaces/${ROOM}/images`, 'image', 'room'],
  ])('%s %s is %s on the %s side', (method, path, name, handler) => {
    const match = matchRoomRoute(request(path, { method }), ROOM);
    expect(match?.name).toBe(name);
    expect(match?.handler).toBe(handler);
  });

  it('refuses a workspace that is not the bound room, or an unknown path', () => {
    expect(matchRoomRoute(request(`/api/workspaces/${OTHER}`), ROOM)).toBeNull();
    expect(matchRoomRoute(request(`/api/workspaces/${ROOM}/nope`), ROOM)).toBeNull();
    expect(matchRoomRoute(request(`/api/workspaces/${ROOM}`), null)).toBeNull();
    expect(matchRoomRoute(request(`/api/workspaces/${ROOM}/commands`, { method: 'PUT' }), ROOM)).toBeNull();
    expect(matchRoomRoute(request('/healthz'), ROOM)).toBeNull();
  });
});

describe('room-http moved routes', () => {
  it('serves the internal view with request id, updated-at and an encoded updated-by', async () => {
    const { deps } = harness();
    const response = await handle(deps, request('/internal/view'));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-request-id')).toBe('req-1');
    expect(response.headers.get('x-tabletop-updated-at')).toBe('1700000100000');
    expect(response.headers.get('x-tabletop-updated-by')).toBe(encodeURIComponent(' właściciel'));
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('keeps the created-at fallback when nobody changed the table yet', async () => {
    const { deps, repository } = harness();
    (repository.lastChange as unknown as { mockReturnValue: (value: unknown) => void }).mockReturnValue(null);
    const response = await handle(deps, request('/internal/view'));
    expect(response.headers.get('x-tabletop-updated-at')).toBe('1700000000000');
    expect(response.headers.get('x-tabletop-updated-by')).toBeNull();
  });

  it('reports resync only when the supplied cursor differs', async () => {
    const { deps } = harness();
    const first = await handle(deps, request(`/api/workspaces/${ROOM}/events`));
    const firstBody = await first.json() as { cursor: string; resync: boolean };
    expect(firstBody.resync).toBe(true);
    expect(typeof firstBody.cursor).toBe('string');
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/events?after=a&after=b`))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/events?cursor=1`))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('runs a command through the authority and schedules the directory sync', async () => {
    const { deps, authority, scheduleDirectorySync } = harness();
    const response = await handle(deps, request(`/api/workspaces/${ROOM}/commands`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ commandId: '00000000-0000-4000-8000-000000000000', type: 'noop', payload: {} }),
    }));
    expect(response.status).toBe(200);
    expect(authority.execute).toHaveBeenCalledTimes(1);
    expect(scheduleDirectorySync).toHaveBeenCalledTimes(1);
  });

  it('refuses commands while the table is read-only even though the route is in this module', async () => {
    const { deps } = harness({ env: { ...(ENV as unknown as Record<string, unknown>), TABLE_READ_ONLY: 'true' } as unknown as Env });
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/commands`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ commandId: '00000000-0000-4000-8000-000000000000', type: 'noop', payload: {} }),
    }))).rejects.toMatchObject({ code: 'TABLE_READ_ONLY', status: 403 });
  });

  it('serves and rotates the reusable invite link', async () => {
    const { deps, repository } = harness();
    const read = await handle(deps, request(`/api/workspaces/${ROOM}/invite-link`));
    expect(read.status).toBe(200);
    expect(repository.inviteLinkStatus).toHaveBeenCalled();

    const created = await handle(deps, request(`/api/workspaces/${ROOM}/invite-link`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ action: 'create', days: 7 }),
    }));
    expect(created.status).toBe(201);
    const body = await created.json() as { enabled: boolean; link: string };
    expect(body.enabled).toBe(true);
    expect(body.link.startsWith(`${ROOM}_`)).toBe(true);

    const disabled = await handle(deps, request(`/api/workspaces/${ROOM}/invite-link`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ action: 'disable' }),
    }));
    expect(disabled.status).toBe(200);
    expect(await disabled.json()).toEqual({ enabled: false, expiresAt: null });
  });

  it('rejects a link lifetime that is not one of the offered days', async () => {
    const { deps } = harness();
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/invite-link`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ action: 'create', days: 3 }),
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('removes a member and schedules the directory sync', async () => {
    const { deps, authority, scheduleDirectorySync } = harness();
    const response = await handle(deps, request(`/api/workspaces/${ROOM}/members/remove`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ actorId: 'actor-2' }),
    }));
    expect(response.status).toBe(200);
    expect(authority.removeMember).toHaveBeenCalledWith(expect.anything(), ROOM, 'actor-2');
    expect(scheduleDirectorySync).toHaveBeenCalledTimes(1);
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/members/remove`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ actorId: 'bad id with spaces' }),
    }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('issues an invitation for the twelfth table seat', async () => {
    const { deps, authority } = harness();
    const response = await handle(deps, request(`/api/workspaces/${ROOM}/invites`, {
      method: 'POST',
      headers: mutationHeaders(),
      body: JSON.stringify({ seat: 'member-12' }),
    }));
    expect(response.status).toBe(201);
    expect(authority.createInvite).toHaveBeenCalledWith(expect.anything(), ROOM, 'member-12', false);
    expect(await response.json()).toEqual({ ticket: `${ROOM}_ticket-1`, expiresAt: 1_700_300_000_000 });
  });

  it('exports an owner invoice as a CSV attachment and refuses anything else', async () => {
    const invoice = authorizedView();
    const workspace = invoice.workspace as unknown as { kind: string; domain: unknown };
    workspace.kind = 'invoice';
    workspace.domain = createDomain('invoice', {
      actorId: 'actor-1', role: 'owner', seat: 'host', name: 'Owner', epoch: 3,
      hash: (value: string) => sha256(value),
    } as never);
    const { deps } = harness({ authorized: invoice });
    const response = await handle(deps, request(`/api/workspaces/${ROOM}/export?format=csv`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(response.headers.get('content-disposition')).toBe('attachment; filename="tabletop-invoice.csv"');
    await expect(handle(deps, request(`/api/workspaces/${ROOM}/export?format=xml`))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });

    const table = harness();
    await expect(handle(table.deps, request(`/api/workspaces/${ROOM}/export`))).rejects.toMatchObject({ code: 'ROLE_FORBIDDEN' });
  });

  it('fails closed when the table names a route this module does not own', async () => {
    const { deps } = harness();
    const req = request(`/api/workspaces/${ROOM}/commands`, { method: 'POST' });
    const match = { handler: 'room-http' as const, name: 'unknown.route', workspaceId: ROOM };
    await expect(createRoomHttp(deps).handle(req, match, 'req-1')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});


describe('internal space projection', () => {
  const payload = { grantId: 'grant-budget', spaceId: 'activity-room', spaceWorkspaceId: ROOM, actorId: 'actor-1', portId: 'budget' };
  const body = JSON.stringify(payload);
  const post = (value: string) => request('/internal/space-projection', { method: 'POST', body: value, headers: { 'content-type': 'application/json' } });

  it('answers 200 with the source decision', async () => {
    const { deps, readSpaceProjection } = harness();
    const response = await handle(deps, post(body));
    expect(response.status).toBe(200);
    const echo = await response.json() as { ok: boolean; grantId: string };
    expect(echo).toMatchObject({ ok: true, grantId: 'grant-budget' });
    expect(readSpaceProjection).toHaveBeenCalledWith(payload);
  });

  it('rejects a malformed body before the resolver runs', async () => {
    const { deps, readSpaceProjection } = harness();
    const response = await handle(deps, post(JSON.stringify({ grantId: 'grant-budget' })));
    expect(response.status).toBe(400);
    expect(readSpaceProjection).not.toHaveBeenCalled();
  });

  it('maps a revocation to 409, not to a missing grant', async () => {
    const { deps, readSpaceProjection } = harness();
    readSpaceProjection.mockResolvedValueOnce({ ok: false, code: 'SPACE_GRANT_REVOKED', message: 'revoked at 4000' });
    const response = await handle(deps, post(body));
    expect(response.status).toBe(409);
  });

  it('maps an unknown grant to 404', async () => {
    const { deps, readSpaceProjection } = harness();
    readSpaceProjection.mockResolvedValueOnce({ ok: false, code: 'SPACE_GRANT_NOT_FOUND', message: 'nope' });
    const response = await handle(deps, post(body));
    expect(response.status).toBe(404);
  });
});

describe('internal space tool intent', () => {
  const post = (value: string) => request('/internal/space-tool-intent', {
    method: 'POST', body: value, headers: { 'content-type': 'application/json' },
  });

  it('runs the behaviour through the room and answers with the committed action', async () => {
    const { deps, runToolIntent } = harness();
    const response = await handle(deps, post(JSON.stringify({ behaviorId: 'reserve', inputs: { item: 'camera' } })));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, actionId: 'borrow' });
    expect(runToolIntent).toHaveBeenCalledWith(expect.anything(), ROOM, { behaviorId: 'reserve', inputs: { item: 'camera' } });
  });

  it('rejects a malformed intent before the room runs anything', async () => {
    const { deps, runToolIntent } = harness();
    const response = await handle(deps, post(JSON.stringify({ behaviorId: 'Reserve', inputs: {} })));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, code: 'TOOL_INTENT_PAYLOAD' });
    expect(runToolIntent).not.toHaveBeenCalled();
  });

  it('reports a refusal with the code, not as a thrown failure', async () => {
    const { deps, runToolIntent } = harness();
    runToolIntent.mockResolvedValueOnce({ ok: false, code: 'ACTION_NOT_DECLARED', message: 'not declared' });
    const response = await handle(deps, post(JSON.stringify({ behaviorId: 'reserve', inputs: {} })));
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, code: 'ACTION_NOT_DECLARED' });
  });
});
