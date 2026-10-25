import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import { handleSpaceAction, type SpaceActionTransportDeps } from './space-action-transport.js';

/**
 * F080 / C7 — the Worker side of calling an action through a connection.
 *
 * The tests cover what this layer owns: who may ask, which table a space may ask about, that the
 * actor and workspace identity are taken from the session and stored state, and how a source
 * refusal is reported. Whether the action itself is allowed is decided by the source (see the
 * authority tests).
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

function space(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: 1,
    spaceId: 'activity-room',
    title: 'ห้องวางผังกิจกรรม',
    sharedToolWorkspaceId: SPACE,
    managerActorId: 'actor-a',
    members: [
      { actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 },
      { actorId: 'actor-b', name: 'B', role: 'maker', joinedAt: 2 },
    ],
    sources: [{ workspaceId: SOURCE, epoch: 3, addedBy: 'actor-a', addedAt: 1, status: 'linked' }],
    revision: 5,
    epoch: 1,
    createdAt: 1,
    updatedAt: 5,
    ...overrides,
  };
}

function view(collaborationSpace: CollaborationSpace | undefined): WorkspaceView {
  return {
    id: SPACE,
    title: 'Space',
    kind: 'table',
    epoch: 1,
    revision: 'rev-1',
    actor: { actorId: 'actor-a', name: 'A', role: 'owner' },
    members: [],
    domain: (collaborationSpace ? { kind: 'table', collaborationSpace } : { kind: 'table' }) as WorkspaceView['domain'],
    createdAt: 1,
    expiresAt: 9_999_999_999_999,
  };
}

const payload = {
  source: SOURCE,
  grant: 'grant-budget',
  actionId: 'reserve',
  inputs: { room: 'ห้องประชุม' },
  idempotencyKey: 'retry-key-1',
};

function request(init: { method?: string; body?: unknown } = {}): Request {
  return new Request(`https://tabletop.test/api/workspaces/${SPACE}/space/action`, {
    method: init.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
  });
}

function deps(overrides: Partial<SpaceActionTransportDeps> = {}): SpaceActionTransportDeps {
  return {
    authenticate: async () => ({ actorId: 'actor-a' }),
    workspaceView: async () => view(space()),
    executeSourceAction: async () => ({ ok: true, revision: 'rev-2', duplicate: false }),
    ...overrides,
  };
}

async function body(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe('who may call an action', () => {
  it('forwards a member request and reports the commit', async () => {
    const response = await handleSpaceAction(request({ body: payload }), deps(), { spaceId: SPACE });
    expect(response.status).toBe(200);
    expect(await body(response)).toMatchObject({ ok: true, committed: true, revision: 'rev-2', duplicate: false });
  });

  it('refuses an unauthenticated caller and a non-member', async () => {
    expect((await handleSpaceAction(request({ body: payload }), deps({ authenticate: async () => undefined }), { spaceId: SPACE })).status).toBe(401);
    expect((await handleSpaceAction(request({ body: payload }), deps({ authenticate: async () => ({ actorId: 'outsider' }) }), { spaceId: SPACE })).status).toBe(403);
  });

  it('refuses a table the space never linked, and a workspace without a space', async () => {
    const wrongSource = await handleSpaceAction(request({ body: { ...payload, source: '33333333-3333-4333-8333-333333333333' } }), deps(), { spaceId: SPACE });
    expect(wrongSource.status).toBe(404);
    expect(await body(wrongSource)).toMatchObject({ errorCode: 'SPACE_SOURCE_NOT_LINKED' });

    const noSpace = await handleSpaceAction(request({ body: payload }), deps({ workspaceView: async () => view(undefined) }), { spaceId: SPACE });
    expect(noSpace.status).toBe(404);
  });

  it('refuses a method other than POST', async () => {
    expect((await handleSpaceAction(request({ method: 'GET' }), deps(), { spaceId: SPACE })).status).toBe(405);
  });
});

describe('the request is validated before anyone is asked', () => {
  it('rejects a bad action id, a short key and non-object inputs', async () => {
    const spy = vi.fn(async () => ({ ok: true as const, revision: 'r', duplicate: false }));
    const run = (patch: Record<string, unknown>) => handleSpaceAction(request({ body: { ...payload, ...patch } }), deps({ executeSourceAction: spy }), { spaceId: SPACE });
    expect((await run({ actionId: 'bad id' })).status).toBe(400);
    expect((await run({ idempotencyKey: 'short' })).status).toBe(400);
    expect((await run({ inputs: [1, 2] })).status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });

  it('takes the actor and the space identity from the session and the stored state', async () => {
    const seen: unknown[] = [];
    await handleSpaceAction(request({ body: payload }), deps({
      authenticate: async () => ({ actorId: 'actor-b' }),
      executeSourceAction: async (_request, _source, body_) => {
        seen.push(body_);
        return { ok: false, code: 'SPACE_ACTION_NOT_GRANTED', message: 'stop' };
      },
    }), { spaceId: SPACE });
    expect(seen[0]).toEqual({
      grantId: 'grant-budget',
      spaceWorkspaceId: SPACE,
      spaceId: 'activity-room',
      actorId: 'actor-b',
      actionId: 'reserve',
      inputs: { room: 'ห้องประชุม' },
      idempotencyKey: 'retry-key-1',
    });
  });
});

describe('a source refusal keeps its meaning', () => {
  it('maps revoked and stale to a conflict', async () => {
    for (const code of ['SPACE_ACTION_REVOKED', 'SPACE_ACTION_STALE']) {
      const response = await handleSpaceAction(request({ body: payload }), deps({
        executeSourceAction: async () => ({ ok: false, code, message: 'no' }),
      }), { spaceId: SPACE });
      expect(response.status, code).toBe(409);
      expect(await body(response)).toMatchObject({ ok: false, errorCode: code });
    }
  });

  it('maps a forbidden and an ungranted action differently', async () => {
    const forbidden = await handleSpaceAction(request({ body: payload }), deps({
      executeSourceAction: async () => ({ ok: false, code: 'SPACE_ACTION_FORBIDDEN', message: 'no' }),
    }), { spaceId: SPACE });
    expect(forbidden.status).toBe(403);

    const ungranted = await handleSpaceAction(request({ body: payload }), deps({
      executeSourceAction: async () => ({ ok: false, code: 'SPACE_ACTION_NOT_GRANTED', message: 'no' }),
    }), { spaceId: SPACE });
    expect(ungranted.status).toBe(404);
  });
});
