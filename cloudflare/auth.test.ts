import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { generateKeyPair, SignJWT } from 'jose';
import { randomId, randomToken, sha256 } from '../server/codec.js';
import { accountForSession, authenticateHash, authenticateRequest, authStatus, cookieName, csrfForToken, finishGoogle, logout, requireMutation, startGoogle, verifyGoogleIdentity } from './auth.js';
import { SESSION_HARD_MS, SESSION_IDLE_MS, type Env } from './contracts.js';
import worker from './index.js';

const bindings = env as Env;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => { pair = await generateKeyPair('RS256'); });

const hashUrl = (text: string) => createHash('sha256').update(text).digest('base64url');
const request = (path: string, init?: RequestInit) => new Request(`https://tabletop.test${path}`, init);

async function signedToken(nonce: string, claims: Record<string, unknown> = {}) {
  return new SignJWT({ nonce, email: 'player@example.test', email_verified: true, name: 'Player', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).setSubject(String(claims.sub ?? 'google-subject'))
    .setIssuer(String(claims.iss ?? 'https://accounts.google.com'))
    .setAudience(String(claims.aud ?? bindings.GOOGLE_OAUTH_CLIENT_ID)).setIssuedAt().setExpirationTime('5m').sign(pair.privateKey);
}

async function loginFlow(claims: Record<string, unknown> = {}) {
  const start = await startGoogle(request('/api/auth/google/start', { headers: { 'CF-Connecting-IP': randomId() } }), bindings);
  const location = new URL(start.headers.get('Location')!);
  const boundCookie = start.headers.get('Set-Cookie')!.split(';')[0];
  const idToken = await signedToken(location.searchParams.get('nonce')!, claims);
  const callback = request(`/api/auth/google/callback?state=${location.searchParams.get('state')}&code=fixture-code`, { headers: { Cookie: boundCookie } });
  let exchanged = 0;
  const result = await finishGoogle(callback, bindings, { key: async () => pair.publicKey,
    fetchImpl: async (input, init) => {
      exchanged++;
      expect(input).toBe('https://oauth2.googleapis.com/token');
      expect(init?.redirect).toBe('manual');
      const body = init?.body as URLSearchParams;
      expect(body.get('redirect_uri')).toBe('https://tabletop.test/api/auth/google/callback');
      expect(hashUrl(body.get('code_verifier')!)).toBe(location.searchParams.get('code_challenge'));
      return Response.json({ id_token: idToken });
    },
  });
  return { result, callback, exchanged, location, boundCookie };
}

async function seedSession(overrides: { created?: number; seen?: number; expires?: number; revoked?: number | null } = {}) {
  const id = randomId(); const token = randomToken(); const now = Date.now();
  await bindings.DB.batch([
    bindings.DB.prepare('INSERT INTO users(id,provider_sub,email,name,created_at) VALUES(?,?,?,?,?)').bind(id, `fixture:${id}`, `${id}@example.test`, 'Fixture player', now),
    bindings.DB.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at,revoked_at) VALUES(?,?,?,?,?,?,?)')
      .bind(sha256(token), sha256(csrfForToken(token)), id, overrides.created ?? now, overrides.seen ?? now,
        overrides.expires ?? now + SESSION_HARD_MS, overrides.revoked ?? null),
  ]);
  const headers = { Cookie: `${cookieName(bindings, 'session')}=${token}`, Origin: bindings.PUBLIC_ORIGIN, 'X-CSRF-Token': csrfForToken(token), 'Content-Type': 'application/json' };
  return { id, token, headers };
}

describe('Google account authentication in Workers and real local D1', () => {
  it('uses exact callback, state, nonce and PKCE; consumes the callback once and stores only hashes', async () => {
    const { result, callback, exchanged, location } = await loginFlow({ sub: randomId() });
    expect(result.status).toBe(303);
    expect(result.headers.get('Location')).toBe('https://tabletop.test/');
    expect(exchanged).toBe(1);
    expect(result.headers.get('Set-Cookie')).toContain('HttpOnly; SameSite=Lax');
    expect(result.headers.get('Set-Cookie')).toContain('; Secure');
    expect(location.searchParams.get('scope')).toBe('openid email profile');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    await expect(finishGoogle(callback, bindings, { fetchImpl: async () => { throw new Error('must not call'); } })).rejects.toMatchObject({ code: 'OAUTH_STATE_REJECTED' });
    const rawSession = result.headers.getSetCookie().find((value) => value.startsWith('__Host-tabletop_session='))!.split(';')[0];
    const current = await authenticateRequest(request('/api/session', { headers: { Cookie: rawSession } }), bindings);
    expect(current.record.workspaceId).toBeNull();
    expect(current.csrfToken).toHaveLength(43);
    const stored = await bindings.DB.prepare('SELECT token_hash,csrf_hash FROM web_sessions WHERE user_id = ?').bind(current.record.actorId).first();
    expect(JSON.stringify(stored)).not.toContain(rawSession.split('=')[1]);
  });

  it('rejects callback without the matching browser binding, including duplicate state', async () => {
    const response = await startGoogle(request('/api/auth/google/start', { headers: { 'CF-Connecting-IP': randomId() } }), bindings);
    const state = new URL(response.headers.get('Location')!).searchParams.get('state');
    await expect(finishGoogle(request(`/api/auth/google/callback?state=${state}&code=test`), bindings)).rejects.toMatchObject({ code: 'OAUTH_STATE_REJECTED' });
    await expect(finishGoogle(request(`/api/auth/google/callback?state=${state}&state=${state}&code=test`, {
      headers: { Cookie: response.headers.get('Set-Cookie')!.split(';')[0] },
    }), bindings)).rejects.toMatchObject({ code: 'OAUTH_STATE_REJECTED' });
  });

  it('does not accept expired login state or redirect to a caller supplied return URL', async () => {
    const response = await startGoogle(request('/api/auth/google/start?returnTo=https://attacker.example', { headers: { 'CF-Connecting-IP': randomId() } }), bindings, Date.now() - 11 * 60_000);
    const state = new URL(response.headers.get('Location')!).searchParams.get('state');
    await expect(finishGoogle(request(`/api/auth/google/callback?state=${state}&code=test`, {
      headers: { Cookie: response.headers.get('Set-Cookie')!.split(';')[0] },
    }), bindings)).rejects.toMatchObject({ code: 'OAUTH_STATE_REJECTED' });
  });

  it.each([
    { iss: 'https://attacker.example' }, { aud: 'another-client' }, { nonce: 'wrong-nonce' },
    { email_verified: false }, { azp: 'another-client' },
  ])('rejects an invalid signed Google claim %j', async (claims) => {
    const token = await signedToken('expected', claims);
    await expect(verifyGoogleIdentity(token, bindings.GOOGLE_OAUTH_CLIENT_ID!, sha256('expected'), async () => pair.publicKey))
      .rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
  });

  it('rejects wrong signing key and expired identity tokens', async () => {
    const token = await signedToken('nonce');
    const other = await generateKeyPair('RS256');
    await expect(verifyGoogleIdentity(token, bindings.GOOGLE_OAUTH_CLIENT_ID!, sha256('nonce'), async () => other.publicKey))
      .rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
    await expect(verifyGoogleIdentity(token, bindings.GOOGLE_OAUTH_CLIENT_ID!, sha256('nonce'), async () => pair.publicKey, Date.now() + 3_600_000))
      .rejects.toMatchObject({ code: 'GOOGLE_IDENTITY_REJECTED' });
  });

  it('pins the first verified admin subject; the same email on a different subject grants no admin access', async () => {
    const first = randomId(); const second = randomId();
    await loginFlow({ sub: first, email: 'admin@example.test' });
    await loginFlow({ sub: second, email: 'admin@example.test' });
    const records = await bindings.DB.prepare('SELECT provider_sub,is_admin FROM users WHERE provider_sub IN (?,?)').bind(first, second).all<{provider_sub: string; is_admin: number}>();
    expect(records.results.find((item) => item.provider_sub === first)?.is_admin).toBe(1);
    expect(records.results.find((item) => item.provider_sub === second)?.is_admin).toBe(0);
    await loginFlow({ sub: first, email: 'changed@example.test' });
    expect((await bindings.DB.prepare('SELECT is_admin FROM users WHERE provider_sub=?').bind(first).first<{is_admin: number}>())?.is_admin).toBe(1);
  });

  it('revokes on logout and immediately rejects both cookie and websocket token-hash authentication', async () => {
    const fixture = await seedSession();
    const session = await authenticateRequest(request('/api/session', { headers: fixture.headers }), bindings);
    expect((await accountForSession(session, bindings)).id).toBe(fixture.id);
    const response = await logout(request('/api/auth/logout', { method: 'POST', headers: fixture.headers }), bindings);
    expect(response.status).toBe(200);
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    await expect(authenticateHash(sha256(fixture.token), bindings)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    await expect(accountForSession(session, bindings)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    const status = await authStatus(request('/api/auth/status', { headers: fixture.headers }), bindings);
    expect(await status.json()).toMatchObject({ mode: 'google', authenticated: false });
  });

  it('enforces hard expiry, idle expiry, CSRF and exact request origin', async () => {
    for (const expiry of [{ expires: Date.now() - 1 }, { seen: Date.now() - SESSION_IDLE_MS - 1 }]) {
      const fixture = await seedSession(expiry);
      await expect(authenticateHash(sha256(fixture.token), bindings)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    }
    const fixture = await seedSession();
    const session = await authenticateRequest(request('/api/session', { headers: fixture.headers }), bindings);
    expect(() => requireMutation(request('/api/test', { headers: { ...fixture.headers, 'X-CSRF-Token': randomToken() } }), bindings, session))
      .toThrow('CSRF_REJECTED');
    expect(() => requireMutation(request('/api/test', { headers: { ...fixture.headers, Origin: 'https://attacker.example' } }), bindings, session))
      .toThrow('ORIGIN_REJECTED');
  });

  it('never exposes billing/internal routes or anonymous session creation; non-admin cannot list rooms', async () => {
    expect((await worker.fetch(request('/internal/metadata'), bindings)).status).toBe(404);
    expect((await worker.fetch(request('/api/session', { method: 'POST' }), bindings)).status).toBe(401);
    const fixture = await seedSession();
    expect((await worker.fetch(request('/api/admin/workspaces', { headers: fixture.headers }), bindings)).status).toBe(403);
    expect((await worker.fetch(request('/api/billing/reserve', { method: 'POST', headers: fixture.headers, body: '{}' }), bindings)).status).toBe(404);
    const response = await worker.fetch(request('/api/auth/status'), bindings);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });
});
