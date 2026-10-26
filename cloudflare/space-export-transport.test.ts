import { describe, expect, it, vi } from 'vitest';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import { handleSpaceExport, type SpaceExportDeps } from './space-export-transport.js';

/** F080 / JT-X — the download path: who may ask, and what the response looks like. */

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

function space(overrides: Partial<CollaborationSpace> = {}): CollaborationSpace {
  return {
    schemaVersion: 1,
    spaceId: 'activity-room',
    title: 'ห้อง',
    sharedToolWorkspaceId: SPACE,
    managerActorId: 'actor-a',
    members: [{ actorId: 'actor-a', name: 'A', role: 'manager', joinedAt: 1 }],
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

const query = `source=${SOURCE}&grant=grant-budget&port=budget`;

function request(search = query, method = 'GET'): Request {
  return new Request(`https://tabletop.test/api/workspaces/${SPACE}/space/export?${search}`, { method });
}

function deps(overrides: Partial<SpaceExportDeps> = {}): SpaceExportDeps {
  return {
    authenticate: async () => ({ actorId: 'actor-a' }),
    workspaceView: async () => view(space()),
    exportSourceProjection: async () => ({
      ok: true,
      filename: 'budget.csv',
      format: 'csv',
      content: '\uFEFFห้อง,ราคา\r\nห้องประชุม,1250\r\n',
      sourceDataRevision: 9,
      grantVersion: 2,
    }),
    ...overrides,
  };
}

describe('a member of the space can download a granted projection', () => {
  it('returns the file with its provenance headers', async () => {
    const response = await handleSpaceExport(request(), deps(), { spaceId: SPACE });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toContain('budget.csv');
    expect(response.headers.get('x-source-data-revision')).toBe('9');
    expect(response.headers.get('x-grant-version')).toBe('2');
    expect(await response.text()).toContain('ห้องประชุม');
  });

  it('asks for html when the caller names that format', async () => {
    const spy = vi.fn(async () => ({
      ok: true as const, filename: 'budget.html', format: 'html' as const, content: '<html></html>', sourceDataRevision: 9, grantVersion: 2,
    }));
    const response = await handleSpaceExport(request(`${query}&format=html`), deps({ exportSourceProjection: spy }), { spaceId: SPACE });
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(spy.mock.calls[0]?.[2]).toMatchObject({ format: 'html' });
  });

  it('refuses an unknown format before asking the source', async () => {
    const spy = vi.fn();
    const response = await handleSpaceExport(request(`${query}&format=pdf`), deps({ exportSourceProjection: spy }), { spaceId: SPACE });
    expect(response.status).toBe(400);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('who may download', () => {
  it('refuses an unauthenticated caller and a non-member', async () => {
    expect((await handleSpaceExport(request(), deps({ authenticate: async () => undefined }), { spaceId: SPACE })).status).toBe(401);
    expect((await handleSpaceExport(request(), deps({ authenticate: async () => ({ actorId: 'outsider' }) }), { spaceId: SPACE })).status).toBe(403);
  });

  it('refuses a table the space never linked', async () => {
    const other = await handleSpaceExport(request('source=33333333-3333-4333-8333-333333333333&grant=grant-budget&port=budget'), deps(), { spaceId: SPACE });
    expect(other.status).toBe(404);
    expect(await other.json()).toMatchObject({ errorCode: 'SPACE_SOURCE_NOT_LINKED' });
  });

  it('refuses a method other than GET', async () => {
    expect((await handleSpaceExport(request(query, 'POST'), deps(), { spaceId: SPACE })).status).toBe(405);
  });
});

describe('a source refusal keeps its meaning', () => {
  it('maps a missing export permission to 403 and a revocation to 409', async () => {
    const notPermitted = await handleSpaceExport(request(), deps({
      exportSourceProjection: async () => ({ ok: false, code: 'EXPORT_NOT_PERMITTED', message: 'read only' }),
    }), { spaceId: SPACE });
    expect(notPermitted.status).toBe(403);
    expect(await notPermitted.json()).toMatchObject({ errorCode: 'EXPORT_NOT_PERMITTED' });

    const revoked = await handleSpaceExport(request(), deps({
      exportSourceProjection: async () => ({ ok: false, code: 'SPACE_GRANT_REVOKED', message: 'revoked' }),
    }), { spaceId: SPACE });
    expect(revoked.status).toBe(409);
  });
});
