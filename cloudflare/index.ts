import { z } from 'zod';
import { MAX_TABLE_MEMBER_SEATS, type SessionView, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { randomId } from '../server/codec.js';
import { BUILD_INFO_FILE, parseBuildInfo } from '../server/build-info.js';
import { isPagePath, servePage } from './pages.js';
import { AuthorityError, safeError } from '../server/errors.js';
import { accountForSession, authenticateRequest, authStatus, finishGoogle, limit, logout, primary, publicOrigin, requireMutation, requireOrigin, startGoogle } from './auth.js';
import { GOOGLE_CALLBACK_PATH, UPDATED_AT_HEADER, UPDATED_BY_HEADER, type DirectoryReference, type Env } from './contracts.js';
import { isTableReadOnly, requireWorkspaceWritable } from './table-mode.js';
import { displayWorkspaceTitle } from '../src/tabletop/shared/workspace-title.js';
import { tableCapabilitySummary } from '../src/tabletop/shared/table-capabilities.js';
import { computeRuntimeCapabilities } from '../src/tabletop/shared/compute-runtime-profiles.js';
export { Room } from './room.js';
export { Billing } from './billing.js';

const uuid = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const workspaceRoute = new RegExp(`^/api/workspaces/(${uuid})(?:/(commands|invites|invite-link|members/remove|socket|events|model(?:/[a-f0-9]{64})?|assistant(?:/[a-f0-9]{64}(?:/confirm)?)?|export|uploads|sources/[0-9a-f-]{36}))?$`, 'u');
const ticketPattern = new RegExp(`^(${uuid})_([A-Za-z0-9_-]{43})$`, 'u');
const createSchema = z.object({ kind: z.enum(['invoice', 'teaching', 'encounter', 'table']), title: z.string().max(120).optional() }).strict();
const joinLinkSchema = z.strictObject({ link: z.string().max(100) });
const redeemSchema = z.object({ ticket: z.string().max(100) }).strict();

async function smallJson(request: Request): Promise<unknown> {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    throw new AuthorityError('CONTENT_TYPE_REQUIRED');
  }
  if (!request.body) throw new AuthorityError('INVALID_JSON');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.byteLength;
    if (length > 4_096) { await reader.cancel(); throw new AuthorityError('BODY_TOO_LARGE'); }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown; }
  catch { throw new AuthorityError('INVALID_JSON'); }
}

function room(env: Env, id: string): DurableObjectStub { return env.ROOMS.get(env.ROOMS.idFromName(id)); }

function internalRequest(original: Request, path: string, data?: unknown): Request {
  const headers = new Headers(original.headers);
  headers.delete('Content-Length');
  if (data !== undefined) headers.set('Content-Type', 'application/json');
  return new Request(new URL(path, original.url), {
    method: data === undefined ? 'GET' : 'POST', headers,
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
}

/** Percent-decoded header text; a malformed value is treated as absent rather than failing the list. */
function decodeHeader(value: string | null): string | undefined {
  if (!value) return undefined;
  try { return decodeURIComponent(value); } catch { return undefined; }
}

async function sessionView(request: Request, env: Env): Promise<Response> {
  const session = await authenticateRequest(request, env);
  const refs = await primary(env).prepare(`SELECT room_id,epoch FROM room_members WHERE user_id = ? AND active = 1 ORDER BY room_id LIMIT 100`)
    .bind(session.record.actorId).all<DirectoryReference>();
  const workspaces: SessionView['workspaces'] = [];
  // Bound concurrent DO calls. D1 is a discovery index, never the authorization decision.
  for (let offset = 0; offset < refs.results.length; offset += 8) {
    const views = await Promise.all(refs.results.slice(offset, offset + 8).map(async ({ room_id }) => {
      const response = await room(env, room_id).fetch(internalRequest(request, '/internal/view'));
      if (response.status === 403 || response.status === 404) return null;
      if (!response.ok) throw new AuthorityError(response.status === 401 ? 'SESSION_EXPIRED' : 'DATABASE_UNAVAILABLE');
      return {
        view: await response.json<WorkspaceView>(),
        updatedAt: Number(response.headers.get(UPDATED_AT_HEADER)),
        updatedBy: decodeHeader(response.headers.get(UPDATED_BY_HEADER)),
      };
    }));
    for (const entry of views) if (entry) {
      const { view } = entry;
      const programTitle = view.kind === 'table' && view.domain.kind === 'table' ? view.domain.program?.title : undefined;
      const createdAt = Number.isSafeInteger(view.createdAt) && view.createdAt > 0 ? view.createdAt : undefined;
      const updatedAt = Number.isSafeInteger(entry.updatedAt) && entry.updatedAt > 0 ? entry.updatedAt : createdAt;
      workspaces.push({ id: view.id, title: displayWorkspaceTitle(view.kind, view.title, programTitle), kind: view.kind, role: view.actor.role, createdAt, updatedAt, updatedBy: entry.updatedBy });
    }
  }
  return Response.json({ csrfToken: session.csrfToken, actorId: session.record.actorId, name: session.record.name,
    expiresAt: session.expiresAt, workspaces } satisfies SessionView);
}

async function adminWorkspaces(request: Request, env: Env): Promise<Response> {
  const session = await authenticateRequest(request, env);
  if (!(await accountForSession(session, env)).isAdmin) throw new AuthorityError('ROLE_FORBIDDEN');
  const params = new URL(request.url).searchParams;
  const after = params.get('after') ?? '';
  if ((after && !new RegExp(`^${uuid}$`, 'u').test(after))
      || [...params.keys()].some((key) => key !== 'after') || params.getAll('after').length > 1) throw new AuthorityError('INVALID_REQUEST');
  const rows = await primary(env).prepare('SELECT id FROM rooms WHERE id > ? ORDER BY id LIMIT 51').bind(after).all<{id: string}>();
  const selected = rows.results.slice(0, 50);
  const workspaces: unknown[] = [];
  for (let offset = 0; offset < selected.length; offset += 8) {
    const metadata = await Promise.all(selected.slice(offset, offset + 8).map(async ({ id }) => {
      const response = await room(env, id).fetch(internalRequest(request, '/internal/metadata'));
      if (!response.ok) throw new AuthorityError('DATABASE_UNAVAILABLE');
      return response.json();
    }));
    workspaces.push(...metadata);
  }
  return Response.json({ workspaces, next: rows.results.length > 50 ? selected.at(-1)!.id : null });
}

async function buildVersion(request: Request, env: Env): Promise<Response> {
  // An absent file is a 404 from the asset binding (or HTML from older builds, which fails parsing).
  const asset = await env.ASSETS.fetch(new Request(new URL(`/${BUILD_INFO_FILE}`, request.url)));
  const info = asset.ok ? parseBuildInfo(await asset.json().catch(() => null)) : null;
  if (!info) throw new AuthorityError('NOT_FOUND', 'Build information is unavailable.', 404);
  return Response.json(info, { headers: { 'Cache-Control': 'no-store' } });
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  // F051: pages come before the origin check, as they did when the asset server answered them.
  if ((request.method === 'GET' || request.method === 'HEAD') && isPagePath(url.pathname)) return servePage(request, env);
  if (url.origin !== publicOrigin(env)) throw new AuthorityError('ORIGIN_REJECTED');
  const path = url.pathname;
  const method = request.method;
  if (method === 'GET' && path === '/healthz') return Response.json({ ok: true });
  if (method === 'GET' && path === '/readyz') {
    await primary(env).prepare('SELECT id FROM users LIMIT 1').all();
    return Response.json({ ok: true });
  }
  if (method === 'GET' && path === '/version') return buildVersion(request, env);
  if (path.startsWith('/internal/')) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
  if (!path.startsWith('/api/')) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
  if (method === 'GET' && path === '/api/auth/status') return authStatus(request, env);
  if (method === 'GET' && path === '/api/auth/google/start') return startGoogle(request, env);
  if (method === 'GET' && path === GOOGLE_CALLBACK_PATH) return finishGoogle(request, env);
  if (method === 'POST' && path === '/api/auth/logout') return logout(request, env);
  if (method === 'GET' && path === '/api/capabilities') {
    const enabled = Boolean(env.DEEPSEEK_KEY);
    const compute = computeRuntimeCapabilities({ javascript: Boolean(env.COMPUTE_LOADER), python: env.TABLE_COMPUTE_PYTHON === 'enabled' });
    return Response.json({ uploads: false, tableReadOnly: isTableReadOnly(env), inviteLinks: true, memberSeats: MAX_TABLE_MEMBER_SEATS, tableAssistant: { available: true }, table: tableCapabilitySummary(), compute, model: { enabled,
      reason: enabled ? 'DeepSeek Flash proposes changes for your review.' : 'AI is awaiting a provider key.' } });
  }
  if (method === 'GET' && path === '/api/session') return sessionView(request, env);
  if (method === 'GET' && path === '/api/admin/workspaces') return adminWorkspaces(request, env);
  const session = await authenticateRequest(request, env);
  if (!['GET', 'HEAD'].includes(method)) {
    requireMutation(request, env, session);
    await limit(env, `mutate:${session.record.actorId}`, 120, 60_000);
  }
  if (method === 'POST' && path === '/api/session') return sessionView(request, env);
  if (method === 'POST' && path === '/api/workspaces') {
    const input = createSchema.safeParse(await smallJson(request));
    if (!input.success) throw new AuthorityError('INVALID_REQUEST');
    requireWorkspaceWritable(env, input.data.kind);
    await limit(env, `create:${session.record.actorId}`, 20, 86_400_000);
    const id = randomId();
    return room(env, id).fetch(internalRequest(request, '/internal/create', { id, ...input.data }));
  }
  if (method === 'POST' && path === '/api/invites/redeem') {
    await limit(env, `redeem:${session.record.actorId}`, 20, 60_000);
    const input = redeemSchema.safeParse(await smallJson(request));
    const match = input.success ? ticketPattern.exec(input.data.ticket) : null;
    if (!match) throw new AuthorityError('INVITE_INVALID');
    return room(env, match[1]).fetch(internalRequest(request, '/internal/redeem', { ticket: match[2] }));
  }
  if (method === 'POST' && path === '/api/invites/join') {
    // F003-T3: reusable table link; same limiter as single-use invitations.
    await limit(env, `redeem:${session.record.actorId}`, 20, 60_000);
    const input = joinLinkSchema.safeParse(await smallJson(request));
    const match = input.success ? ticketPattern.exec(input.data.link) : null;
    if (!match) throw new AuthorityError('INVITE_INVALID');
    return room(env, match[1]).fetch(internalRequest(request, '/internal/join-link', { ticket: match[2] }));
  }
  const matched = workspaceRoute.exec(path);
  if (matched) {
    if (matched[2] === 'socket') {
      requireOrigin(request, env);
      await limit(env, `socket:${session.record.actorId}`, 30, 60_000);
    }
    return room(env, matched[1]).fetch(request);
  }
  throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
}

function secured(response: Response, request: Request): Response {
  if (response.status === 101) return response;
  const output = new Response(response.body, response);
  output.headers.set('X-Content-Type-Options', 'nosniff');
  output.headers.set('Referrer-Policy', 'no-referrer');
  output.headers.set('X-Frame-Options', 'DENY');
  output.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  output.headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  if (request.url.startsWith('https:')) output.headers.set('Strict-Transport-Security', 'max-age=31536000');
  if (new URL(request.url).pathname.startsWith('/api/')) output.headers.set('Cache-Control', 'no-store');
  return output;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try { return secured(await route(request, env), request); }
    catch (error) {
      const mapped = safeError(error, randomId());
      return secured(Response.json(mapped.body, { status: mapped.status }), request);
    }
  },
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    const now = Date.now();
    const db = primary(env);
    // Bounded garbage collection of transient auth data; game tables are retained.
    await db.batch([
      db.prepare('DELETE FROM oauth_states WHERE state_hash IN (SELECT state_hash FROM oauth_states WHERE expires_at < ? LIMIT 5000)').bind(now),
      db.prepare('DELETE FROM web_sessions WHERE token_hash IN (SELECT token_hash FROM web_sessions WHERE expires_at < ? LIMIT 1000)').bind(now - 86_400_000),
      db.prepare('DELETE FROM edge_limits WHERE key IN (SELECT key FROM edge_limits WHERE window_start < ? LIMIT 1000)').bind(now - 2 * 86_400_000),
    ]);
  },
} satisfies ExportedHandler<Env>;
