import { describe, expect, it, vi } from 'vitest';
import { createJoinedProjectionFetcher } from './joined-projection-fetcher';
import { spaceProjectionQuery, spaceProjectionUrl } from '../shared/space-projection-url';

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

describe('the projection URL is one shared contract', () => {
  it('builds the path the Worker route matches, with the three query keys', () => {
    const url = spaceProjectionUrl(SPACE, { source: SOURCE, grant: 'grant-budget', port: 'budget' });
    expect(url).toBe(`/api/workspaces/${SPACE}/space/projection?source=${SOURCE}&grant=grant-budget&port=budget`);
    expect(url.startsWith(`/api/workspaces/${SPACE}/space/projection?`)).toBe(true);
  });

  it('escapes values instead of letting them break the query', () => {
    expect(spaceProjectionQuery({ source: 'a b', grant: 'g&1', port: 'p=1' })).toBe('source=a%20b&grant=g%261&port=p%3D1');
  });

  it('keeps the same key order everywhere, so both sides can assert one string', () => {
    const query = spaceProjectionQuery({ source: SOURCE, grant: 'g1', port: 'p1' });
    expect(query.indexOf('source=')).toBeLessThan(query.indexOf('grant='));
    expect(query.indexOf('grant=')).toBeLessThan(query.indexOf('port='));
  });
});

describe('the browser fetcher asks that exact URL', () => {
  it('calls the shared URL with cookies and an abort-aware request', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const fetcher = createJoinedProjectionFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const controller = new AbortController();
    const result = await fetcher({ spaceWorkspaceId: SPACE, source: SOURCE, grant: 'grant-budget', port: 'budget', signal: controller.signal });

    expect(result.status).toBe(200);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(spaceProjectionUrl(SPACE, { source: SOURCE, grant: 'grant-budget', port: 'budget' }));
    expect(init.method).toBe('GET');
    expect(init.credentials).toBe('include');
    expect(init.signal).toBe(controller.signal);
  });

  it('honours an explicit origin without doubling slashes', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const fetcher = createJoinedProjectionFetcher({ origin: 'https://tabletop.test', fetchImpl: fetchImpl as unknown as typeof fetch });
    await fetcher({ spaceWorkspaceId: SPACE, source: SOURCE, grant: 'g', port: 'p' });
    const [url] = fetchImpl.mock.calls[0] as unknown as [string];
    expect(url).toBe(`https://tabletop.test/api/workspaces/${SPACE}/space/projection?source=${SOURCE}&grant=g&port=p`);
  });

  it('reports a non-JSON body by status instead of throwing', async () => {
    const fetchImpl = vi.fn(async () => new Response('<html>nope</html>', { status: 502 }));
    const fetcher = createJoinedProjectionFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetcher({ spaceWorkspaceId: SPACE, source: SOURCE, grant: 'g', port: 'p' })).resolves.toEqual({ status: 502, body: null });
  });

  it('lets a network error reject, so the mapping layer can mark that one source missing', async () => {
    const fetchImpl = vi.fn(async () => { throw new Error('offline'); });
    const fetcher = createJoinedProjectionFetcher({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(fetcher({ spaceWorkspaceId: SPACE, source: SOURCE, grant: 'g', port: 'p' })).rejects.toThrow('offline');
  });
});
