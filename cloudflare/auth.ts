import { createHash } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import type { AuthenticatedSession } from '../server/authority.js';
import { constantTimeHashEqual, randomId, randomToken, sha256 } from '../server/codec.js';
import { AuthorityError } from '../server/errors.js';
import { GOOGLE_CALLBACK_PATH, OAUTH_TTL_MS, SESSION_HARD_MS, SESSION_IDLE_MS, type Account, type Env } from './contracts.js';

const tokenPattern = /^[A-Za-z0-9_-]{43}$/u;
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'), {
  timeoutDuration: 8_000, cooldownDuration: 30_000, cacheMaxAge: 3_600_000,
});
const digestUrl = (value: string): string => createHash('sha256').update(value).digest('base64url');
export const csrfForToken = (token: string): string => digestUrl(`tabletop-csrf-v1:${token}`);

export function publicOrigin(env: Env): string {
  const url = new URL(env.PUBLIC_ORIGIN);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new AuthorityError('CONFIGURATION_UNAVAILABLE', undefined, 503);
  }
  return url.origin;
}

export function cookieName(env: Env, kind: 'session' | 'oauth'): string {
  return publicOrigin(env).startsWith('https:') ? `__Host-tabletop_${kind}` : `tabletop_local_${kind}`;
}

function cookie(env: Env, kind: 'session' | 'oauth', value: string, seconds: number): string {
  const secure = publicOrigin(env).startsWith('https:') ? '; Secure' : '';
  return `${cookieName(env, kind)}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure}`;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie') ?? '';
  if (header.length > 8_192) return undefined;
  const values = header.split(';').map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length !== 1) return undefined;
  const value = values[0].slice(name.length + 1);
  return tokenPattern.test(value) ? value : undefined;
}

export function requireOrigin(request: Request, env: Env): void {
  if (request.headers.get('Origin') !== publicOrigin(env)
      || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    throw new AuthorityError('ORIGIN_REJECTED');
  }
}

export function requireMutation(request: Request, env: Env, session: AuthenticatedSession): void {
  requireOrigin(request, env);
  const csrf = request.headers.get('X-CSRF-Token');
  if (!csrf || !tokenPattern.test(csrf) || !constantTimeHashEqual(session.record.csrfHash, csrf)) {
    throw new AuthorityError('CSRF_REJECTED');
  }
}

/** Always begin at the primary. A fresh authorization never trusts a cached read replica. */
export function primary(env: Env): D1DatabaseSession { return env.DB.withSession('first-primary'); }

interface SessionRow {
  token_hash: string; csrf_hash: string; user_id: string; name: string;
  created_at: number; last_seen_at: number; expires_at: number; revoked_at: number | null;
}

export async function authenticateHash(tokenHash: string, env: Env, now = Date.now()): Promise<AuthenticatedSession> {
  if (!/^[a-f0-9]{64}$/u.test(tokenHash)) throw new AuthorityError('SESSION_REQUIRED');
  const db = primary(env);
  const row = await db.prepare(`SELECT s.*, u.name FROM web_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?`).bind(tokenHash).first<SessionRow>();
  if (!row || row.revoked_at !== null || row.expires_at <= now || row.last_seen_at + SESSION_IDLE_MS <= now) {
    throw new AuthorityError('SESSION_EXPIRED');
  }
  // Authorization reads are fresh even when the idle timestamp does not need a write.
  if (row.last_seen_at + 300_000 < now) {
    const touched = await db.prepare(`UPDATE web_sessions SET last_seen_at = ? WHERE token_hash = ?
      AND revoked_at IS NULL AND expires_at > ? AND last_seen_at > ? RETURNING token_hash`)
      .bind(now, tokenHash, now, now - SESSION_IDLE_MS).first();
    if (!touched) throw new AuthorityError('SESSION_EXPIRED');
    row.last_seen_at = now;
  }
  return {
    record: {
      tokenHash, csrfHash: row.csrf_hash, actorId: row.user_id, name: row.name,
      createdAt: row.created_at, lastSeenAt: row.last_seen_at, hardExpiresAt: row.expires_at,
      revokedAt: null, workspaceId: null, rotatedToTokenHash: null, rotationTicketHash: null,
    },
    csrfToken: '', expiresAt: Math.min(row.expires_at, row.last_seen_at + SESSION_IDLE_MS),
  };
}

export async function authenticateRequest(request: Request, env: Env, now = Date.now()): Promise<AuthenticatedSession> {
  const token = readCookie(request, cookieName(env, 'session'));
  if (!token) throw new AuthorityError('SESSION_REQUIRED');
  const session = await authenticateHash(sha256(token), env, now);
  const csrfToken = csrfForToken(token);
  if (!constantTimeHashEqual(session.record.csrfHash, csrfToken)) throw new AuthorityError('SESSION_EXPIRED');
  return { ...session, csrfToken };
}

export async function accountForSession(session: AuthenticatedSession, env: Env): Promise<Account> {
  // Include the session predicate again: an admin check cannot outlive a revocation between reads.
  const now = Date.now();
  const row = await primary(env).prepare(`SELECT u.id, u.name, u.email, u.is_admin FROM users u
    JOIN web_sessions s ON s.user_id = u.id WHERE s.token_hash = ? AND s.revoked_at IS NULL
    AND s.expires_at > ? AND s.last_seen_at > ?`).bind(session.record.tokenHash, now, now - SESSION_IDLE_MS)
    .first<{id: string; name: string; email: string; is_admin: number}>();
  if (!row) throw new AuthorityError('SESSION_EXPIRED');
  return { id: row.id, name: row.name, email: row.email, isAdmin: row.is_admin === 1 };
}

export async function isAdminSession(session: AuthenticatedSession, env: Env): Promise<boolean> {
  return (await accountForSession(session, env)).isAdmin;
}

export async function authStatus(request: Request, env: Env): Promise<Response> {
  try {
    const session = await authenticateRequest(request, env);
    return Response.json({ mode: 'google', authenticated: true, loginUrl: '/api/auth/google/start', user: await accountForSession(session, env) });
  } catch (error) {
    if (!(error instanceof AuthorityError) || !['SESSION_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) throw error;
    return Response.json({ mode: 'google', authenticated: false, loginUrl: '/api/auth/google/start' });
  }
}

export async function limit(env: Env, key: string, max: number, windowMs: number, now = Date.now()): Promise<void> {
  const start = Math.floor(now / windowMs) * windowMs;
  const result = await primary(env).prepare(`INSERT INTO edge_limits(key, window_start, hits) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET window_start = excluded.window_start,
      hits = CASE WHEN edge_limits.window_start = excluded.window_start THEN edge_limits.hits + 1 ELSE 1 END
    RETURNING hits`).bind(key, start).first<{hits: number}>();
  if (!result || result.hits > max) throw new AuthorityError('TOO_MANY_REQUESTS');
}

function ensureGoogle(env: Env): {clientId: string; clientSecret: string} {
  if (!env.GOOGLE_OAUTH_CLIENT_ID || !env.GOOGLE_OAUTH_CLIENT_SECRET) {
    throw new AuthorityError('LOGIN_UNAVAILABLE', undefined, 503);
  }
  return { clientId: env.GOOGLE_OAUTH_CLIENT_ID, clientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET };
}

export async function startGoogle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const { clientId } = ensureGoogle(env);
  const site = request.headers.get('Sec-Fetch-Site');
  if (site === 'cross-site') throw new AuthorityError('ORIGIN_REJECTED');
  // CF-Connecting-IP is set by the edge. It is hashed; raw addresses are never stored.
  const ipKey = sha256(request.headers.get('CF-Connecting-IP') ?? 'local');
  await limit(env, `oauth:${ipKey}`, 20, 600_000, now);
  await limit(env, 'oauth:global', 2_000, 3_600_000, now);
  const state = randomToken();
  const binding = randomToken();
  const verifier = digestUrl(`${binding}:${state}`);
  const nonce = digestUrl(`${binding}:nonce:${state}`);
  await primary(env).prepare('INSERT INTO oauth_states(state_hash,binding_hash,nonce_hash,created_at,expires_at) VALUES(?,?,?,?,?)')
    .bind(sha256(state), sha256(binding), sha256(nonce), now, now + OAUTH_TTL_MS).run();
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.search = new URLSearchParams({
    client_id: clientId, redirect_uri: publicOrigin(env) + GOOGLE_CALLBACK_PATH,
    response_type: 'code', scope: 'openid email profile', state, nonce,
    code_challenge: digestUrl(verifier), code_challenge_method: 'S256', prompt: 'select_account',
  }).toString();
  return new Response(null, { status: 302, headers: {
    Location: url.href, 'Set-Cookie': cookie(env, 'oauth', binding, OAUTH_TTL_MS / 1_000),
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  } });
}

export interface GoogleIdentity { sub: string; email: string; name: string }

export async function verifyGoogleIdentity(idToken: string, clientId: string, nonceHash: string,
  key: JWTVerifyGetKey = googleKeys, now = Date.now()): Promise<GoogleIdentity> {
  try {
    if (idToken.length > 16_384) throw new Error('size');
    const { payload } = await jwtVerify(idToken, key, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: clientId,
      algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
      maxTokenAge: '10 minutes', clockTolerance: 30, currentDate: new Date(now),
    });
    if (typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 255
        || typeof payload.nonce !== 'string' || !constantTimeHashEqual(nonceHash, payload.nonce)
        || (payload.azp !== undefined && payload.azp !== clientId)
        || payload.email_verified !== true || typeof payload.email !== 'string'
        || payload.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(payload.email)) throw new Error('claims');
    const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 64) : '';
    return { sub: payload.sub, email: payload.email.toLowerCase(), name: name || 'Tabletop player' };
  } catch {
    throw new AuthorityError('GOOGLE_IDENTITY_REJECTED', undefined, 401);
  }
}

async function exchangeCode(code: string, verifier: string, env: Env, fetchImpl: typeof fetch): Promise<string> {
  const { clientId, clientSecret } = ensureGoogle(env);
  try {
    const response = await fetchImpl('https://oauth2.googleapis.com/token', {
      method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, code_verifier: verifier,
        redirect_uri: publicOrigin(env) + GOOGLE_CALLBACK_PATH, grant_type: 'authorization_code' }),
    });
    if (!response.ok || !response.body) throw new Error('exchange');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 32_768) { await reader.cancel(); throw new Error('size'); }
      chunks.push(chunk.value);
    }
    const buffer = new Uint8Array(bytes);
    let offset = 0;
    for (const chunk of chunks) { buffer.set(chunk, offset); offset += chunk.byteLength; }
    const data: unknown = JSON.parse(new TextDecoder().decode(buffer));
    if (typeof data !== 'object' || !data || !('id_token' in data) || typeof data.id_token !== 'string') throw new Error('body');
    return data.id_token;
  } catch {
    throw new AuthorityError('GOOGLE_EXCHANGE_FAILED', undefined, 502);
  }
}

export async function finishGoogle(request: Request, env: Env, options: {
  now?: number; fetchImpl?: typeof fetch; key?: JWTVerifyGetKey;
} = {}): Promise<Response> {
  ensureGoogle(env);
  const now = options.now ?? Date.now();
  const url = new URL(request.url);
  const state = url.searchParams.get('state');
  const binding = readCookie(request, cookieName(env, 'oauth'));
  if (!state || !tokenPattern.test(state) || !binding || url.searchParams.getAll('state').length !== 1) {
    throw new AuthorityError('OAUTH_STATE_REJECTED', undefined, 400);
  }
  // Consume before exchange. Replayed callbacks cannot reuse either state or an authorization code.
  const pending = await primary(env).prepare(`DELETE FROM oauth_states WHERE state_hash = ?
    AND binding_hash = ? AND expires_at > ? RETURNING nonce_hash`)
    .bind(sha256(state), sha256(binding), now).first<{nonce_hash: string}>();
  if (!pending) throw new AuthorityError('OAUTH_STATE_REJECTED', undefined, 400);
  const headers = new Headers({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  headers.append('Set-Cookie', cookie(env, 'oauth', '', 0));
  try {
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 4_096 || url.searchParams.getAll('code').length !== 1) {
      throw new AuthorityError('GOOGLE_LOGIN_CANCELLED', undefined, 400);
    }
    const idToken = await exchangeCode(code, digestUrl(`${binding}:${state}`), env, options.fetchImpl ?? fetch);
    const identity = await verifyGoogleIdentity(idToken, env.GOOGLE_OAUTH_CLIENT_ID!, pending.nonce_hash, options.key, now);
    const db = primary(env);
    // Only the first verified subject matching the configured address can bootstrap admin.
    // The immutable subject remains pinned even if its email address later changes.
    await db.batch([
      db.prepare(`INSERT INTO users(id,provider_sub,email,name,created_at) VALUES(?,?,?,?,?)
        ON CONFLICT(provider_sub) DO UPDATE SET email = excluded.email, name = excluded.name`)
        .bind(randomId(), identity.sub, identity.email, identity.name, now),
      db.prepare(`INSERT INTO app_meta(key,value) SELECT 'admin_subject', ? WHERE ? = ? AND ? <> '' ON CONFLICT(key) DO NOTHING`)
        .bind(identity.sub, identity.email, (env.TABLETOP_ADMIN_EMAIL ?? '').trim().toLowerCase(), (env.TABLETOP_ADMIN_EMAIL ?? '').trim()),
      db.prepare(`UPDATE users SET is_admin = 1 WHERE provider_sub = ?
        AND provider_sub = (SELECT value FROM app_meta WHERE key = 'admin_subject')`).bind(identity.sub),
    ]);
    const user = await db.prepare('SELECT id FROM users WHERE provider_sub = ?').bind(identity.sub).first<{id: string}>();
    if (!user) throw new AuthorityError('DATABASE_UNAVAILABLE');
    const raw = randomToken();
    const oldToken = readCookie(request, cookieName(env, 'session'));
    await db.batch([
      db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(sha256(raw), sha256(csrfForToken(raw)), user.id, now, now, now + SESSION_HARD_MS),
      db.prepare('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
        .bind(now, oldToken ? sha256(oldToken) : ''),
      db.prepare(`UPDATE web_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND token_hash NOT IN
        (SELECT token_hash FROM web_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC,token_hash DESC LIMIT 5)`)
        .bind(now, user.id, user.id),
    ]);
    headers.append('Set-Cookie', cookie(env, 'session', raw, SESSION_HARD_MS / 1_000));
    headers.set('Location', publicOrigin(env) + '/');
  } catch (error) {
    // Never echo Google's error response, a code, a token or the client secret.
    if (!(error instanceof AuthorityError)) throw error;
    headers.set('Location', publicOrigin(env) + '/?auth_error=google_login_failed');
  }
  return new Response(null, { status: 303, headers });
}

export async function logout(request: Request, env: Env): Promise<Response> {
  const session = await authenticateRequest(request, env);
  requireMutation(request, env, session);
  await primary(env).prepare('UPDATE web_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL')
    .bind(Date.now(), session.record.tokenHash).run();
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': cookie(env, 'session', '', 0) } });
}
