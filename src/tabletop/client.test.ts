import { afterEach, describe, expect, it, vi } from 'vitest';
import { TabletopClient } from './client';
import type { WorkspaceView } from './shared/contracts';

function response(body: unknown, status = 200): Response {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => vi.unstubAllGlobals());

describe('TabletopClient access boundaries', () => {
  it('does not create a guest session after a Google session expires', async () => {
    vi.stubGlobal('window', { location: { origin: 'http://localhost' } });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({ mode: 'google', authenticated: true, loginUrl: '/api/auth/google/start', user: { id: 'account-1', name: 'Owner', email: 'owner@example.test', isAdmin: false } }))
      .mockResolvedValueOnce(response({ errorCode: 'UNAUTHENTICATED', message: 'Sign in again.' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    const client = new TabletopClient();
    await client.authStatus();
    await expect(client.openSession()).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe('/api/session');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'same-origin' });
    expect(fetchMock.mock.calls[1][1]).not.toHaveProperty('method', 'POST');
  });

  it('keeps the local 404 auth fallback and guest-session creation behavior', async () => {
    const session = { csrfToken: 'csrf', actorId: 'guest', name: 'Guest', expiresAt: 1, workspaces: [] };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(null, 404))
      .mockResolvedValueOnce(response({ errorCode: 'NO_SESSION', message: 'Create one.' }, 401))
      .mockResolvedValueOnce(response(session));
    vi.stubGlobal('fetch', fetchMock);

    const client = new TabletopClient();
    expect(await client.authStatus()).toEqual({ mode: 'guest' });
    expect(await client.openSession()).toEqual(session);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][1]).toMatchObject({ method: 'POST' });
  });

  it('honors disabled production upload capability and requires valid capability fields', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ uploads: false, model: { enabled: false, reason: 'Turn off uploads.' } }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TabletopClient();

    await expect(client.capabilities()).resolves.toEqual({ uploads: false, model: { enabled: false, reason: 'Turn off uploads.' } });
    expect(fetchMock.mock.calls[0][0]).toBe('/api/capabilities');
  });

  it('preserves enabled local uploads when the legacy capabilities route is absent', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response(null, 404));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TabletopClient();

    await expect(client.capabilities()).resolves.toMatchObject({ uploads: true, model: { enabled: false } });
  });

  it('keeps model command identity stable and omits an unselected source', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ id: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', status: 'queued' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TabletopClient();
    const view = { id: 'workspace-1', revision: 'revision-2', epoch: 3 } as WorkspaceView;

    await client.requestModel(view, 'Suggest a clearer explanation.', undefined, 'command-fixed');
    const request = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body));
    expect(body).toEqual({ prompt: 'Suggest a clearer explanation.', consent: true, expectedRevision: 'revision-2', expectedEpoch: 3, commandId: 'command-fixed' });
    expect(request.method).toBe('POST');
  });

  it('retries a lost model acknowledgement with the same ID, prompt, and selected evidence', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('network dropped'))
      .mockResolvedValueOnce(response({ id: 'job-1', status: 'running' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TabletopClient();
    const view = { id: 'workspace-2', revision: 'revision-8', epoch: 2 } as WorkspaceView;

    await client.requestModel(view, 'Propose a current rate adjustment.', 'verified-rate-card', 'same-command');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    const retryBody = JSON.parse(String((fetchMock.mock.calls[1][1] as RequestInit).body));
    expect(firstBody).toEqual({ prompt: 'Propose a current rate adjustment.', sourceId: 'verified-rate-card', consent: true, expectedRevision: 'revision-8', expectedEpoch: 2, commandId: 'same-command' });
    expect(retryBody).toEqual(firstBody);
  });

  it('polls an opaque model job ID on the workspace job route', async () => {
    const jobId = 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789';
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ id: jobId, status: 'completed', candidateId: 'candidate-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TabletopClient();

    await expect(client.modelJob('workspace/1', jobId)).resolves.toMatchObject({ id: jobId, status: 'completed' });
    expect(fetchMock.mock.calls[0][0]).toBe(`/api/workspaces/workspace%2F1/model/${jobId}`);
  });
});
