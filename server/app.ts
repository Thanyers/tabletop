import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { type IncomingMessage, type ServerResponse } from 'node:http';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';
import type { SqlDatabase } from './database.js';
import { CommandAuthority, type AuthenticatedSession, type AuthorizedWorkspace } from './authority.js';
import { BUILD_INFO_FILE, parseBuildInfo } from './build-info.js';
import { AuthorityError, safeError } from './errors.js';
import {
  MAX_EXPIRY_SWEEP_BATCH,
  MAX_HTTP_REQUESTS_PER_MINUTE,
  MAX_INVITES_PER_MINUTE,
  MAX_JSON_BODY_BYTES,
  MAX_MUTATIONS_PER_MINUTE,
  MAX_OUTBOX_DISPATCH_BATCH,
  MAX_WEBSOCKET_MESSAGE_BYTES,
  MAINTENANCE_WARNING_INTERVAL_MS,
  OUTBOX_DISPATCH_INTERVAL_MS,
  STATIC_ASSET_CACHE_SECONDS,
  WS_HEARTBEAT_INTERVAL_MS,
  WORKSPACE_EXPIRY_SWEEP_INTERVAL_MS,
} from './limits.js';
import { clientRateKey, json, logRequest, RateLimiter, readJsonBody, requestId as makeRequestId, requestMethod } from './http.js';
import { randomToken } from './codec.js';
import { projectionCursor } from './projection-cursor.js';

export interface ExtensionContext {
  readonly request: IncomingMessage;
  readonly response: ServerResponse;
  readonly url: URL;
  readonly requestId: string;
  readonly authority: CommandAuthority;
  readonly database: SqlDatabase;
  authenticate(): Promise<AuthenticatedSession>;
  authorize(workspaceId: string): Promise<AuthorizedWorkspace>;
  requireMutation(session: AuthenticatedSession): void;
  readJsonBody(maxBytes?: number): Promise<unknown>;
  json(status: number, data: unknown, headers?: Record<string, string>): void;
  error(error: unknown): void;
}

export type RouteExtension = (context: ExtensionContext) => boolean | Promise<boolean>;

export interface CreateAppOptions {
  readonly authority: CommandAuthority;
  readonly database: SqlDatabase;
  readonly staticDir?: string;
  readonly publicOrigin?: string;
  readonly extensions?: readonly RouteExtension[];
  readonly now?: () => number;
  readonly expireWorkspaces?: (now: number, limit?: number) => Promise<number>;
}

export interface TabletopApp {
  readonly authority: CommandAuthority;
  readonly database: SqlDatabase;
  readonly handler: (request: IncomingMessage, response: ServerResponse) => void;
  upgrade(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void>;
  addExtension(extension: RouteExtension): void;
  dispatchPendingOutbox(): Promise<void>;
  sweepExpiredWorkspaces(): Promise<void>;
  close(): Promise<void>;
}

interface SocketPeer {
  readonly socket: WebSocket;
  readonly request: IncomingMessage;
  readonly workspaceId: string;
  alive: boolean;
  projectionPending: boolean;
  projectionRunning: boolean;
  projectionTask: Promise<void> | null;
  lastRevision: string | null;
}

interface PendingOutboxRow extends Record<string, unknown> {
  outbox_id: unknown;
  workspace_id: unknown;
  epoch: unknown;
}

interface PendingOutboxItem {
  outboxId: string;
  workspaceId: string;
  epoch: number;
}

const mimeTypes: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const inviteRedemptionSchema = z.object({ ticket: z.string() }).strict();
const inviteCreationSchema = z.object({
  seat: z.enum([
    'learner-1', 'learner-2', 'mira', 'pip',
    'member-1', 'member-2', 'member-3', 'member-4', 'member-5', 'member-6', 'member-7',
  ]),
  replaceOutstanding: z.boolean().optional(),
}).strict();

function normalizedOrigin(value: string): string | null {
  try {
    const parsed = new URL(value);
    if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password
        || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function requireSameOrigin(request: IncomingMessage, configuredOrigin?: string): void {
  const supplied = request.headers.origin;
  if (typeof supplied !== 'string') throw new AuthorityError('ORIGIN_REQUIRED');
  const origin = normalizedOrigin(supplied);
  const expected = configuredOrigin ?? (() => {
    const host = request.headers.host;
    if (!host) return null;
    const protocol = 'encrypted' in request.socket && request.socket.encrypted === true ? 'https' : 'http';
    return normalizedOrigin(`${protocol}://${host}`);
  })();
  if (!origin || !expected || origin !== expected) throw new AuthorityError('ORIGIN_REJECTED');
  if (request.headers['sec-fetch-site'] === 'cross-site') throw new AuthorityError('ORIGIN_REJECTED');
}

function securityHeaders(isHttps: boolean): Record<string, string> {
  return {
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    'permissions-policy': 'camera=(), microphone=(), geolocation=()',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    ...(isHttps ? { 'strict-transport-security': 'max-age=31536000; includeSubDomains' } : {}),
  };
}

function setCommonHeaders(response: ServerResponse, isHttps: boolean): void {
  for (const [key, value] of Object.entries(securityHeaders(isHttps))) response.setHeader(key, value);
}

function apiPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    throw new AuthorityError('INVALID_REQUEST');
  }
}

function workspaceIdFrom(path: string, suffix: string): string | null {
  const match = /^\/api\/workspaces\/([0-9a-f-]{36})(?:\/(.*))?$/iu.exec(path);
  if (!match || (match[2] ?? '') !== suffix) return null;
  return match[1] ?? null;
}

function isMutation(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
}

function makeContentType(path: string): string {
  return mimeTypes[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function isInside(root: string, path: string): boolean {
  const relative = path.slice(root.length);
  return relative === '' || relative.startsWith(sep);
}

function apiJson(response: ServerResponse, status: number, body: unknown, isHttps: boolean, headers: Record<string, string> = {}): void {
  json(response, status, body, { ...securityHeaders(isHttps), ...headers });
}

export function createApp(options: CreateAppOptions): TabletopApp {
  const { authority, database } = options;
  const configuredOrigin = options.publicOrigin ? normalizedOrigin(options.publicOrigin) ?? undefined : undefined;
  if (options.publicOrigin && !configuredOrigin) throw new Error('PUBLIC_ORIGIN_INVALID');
  const staticRoot = options.staticDir ? resolve(options.staticDir) : undefined;
  const extensions = [...(options.extensions ?? [])];
  const webSockets = new WebSocketServer({
    noServer: true,
    maxPayload: MAX_WEBSOCKET_MESSAGE_BYTES,
    perMessageDeflate: false,
    clientTracking: false,
  });
  const peers = new Set<SocketPeer>();
  const requestLimiter = new RateLimiter(MAX_HTTP_REQUESTS_PER_MINUTE);
  const mutationLimiter = new RateLimiter(MAX_MUTATIONS_PER_MINUTE);
  const inviteLimiter = new RateLimiter(MAX_INVITES_PER_MINUTE);
  const now = options.now ?? Date.now;

  const enforceMutation = (request: IncomingMessage, session: AuthenticatedSession): void => {
    requireSameOrigin(request, configuredOrigin);
    authority.requireCsrf(request, session);
  };

  const scheduleProjection = (peer: SocketPeer): Promise<void> => {
    if (peer.socket.readyState !== WebSocket.OPEN) return Promise.resolve();
    peer.projectionPending = true;
    if (peer.projectionRunning) return peer.projectionTask ?? Promise.resolve();
    peer.projectionRunning = true;
    const drain = async (): Promise<void> => {
      try {
        while (peer.projectionPending && peer.socket.readyState === WebSocket.OPEN) {
          peer.projectionPending = false;
          const result = await authority.authorize(peer.request, peer.workspaceId);
          if (peer.projectionPending) continue;
          if (peer.socket.readyState !== WebSocket.OPEN) return;
          if (projectionCursor(result.workspace) === peer.lastRevision) continue;
          peer.socket.send(JSON.stringify({ type: 'projection', workspace: result.workspace }));
          peer.lastRevision = projectionCursor(result.workspace);
        }
      } catch {
        peer.socket.close(4403, 'Authorization expired');
      } finally {
        peer.projectionRunning = false;
        peer.projectionTask = null;
      }
    };
    const task = drain();
    peer.projectionTask = task;
    return task;
  };

  const heartbeat = setInterval(() => {
    for (const peer of peers) {
      if (!peer.alive) {
        peer.socket.terminate();
        peers.delete(peer);
        continue;
      }
      peer.alive = false;
      peer.socket.ping();
    }
  }, WS_HEARTBEAT_INTERVAL_MS);
  heartbeat.unref();

  webSockets.on('connection', (socket, request) => {
    const path = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`).pathname;
    const workspaceId = workspaceIdFrom(path, 'socket');
    if (!workspaceId) {
      socket.close(4400, 'Invalid socket route');
      return;
    }
    const peer: SocketPeer = {
      socket,
      request,
      workspaceId,
      alive: true,
      projectionPending: false,
      projectionRunning: false,
      projectionTask: null,
      lastRevision: null,
    };
    peers.add(peer);
    socket.on('pong', () => { peer.alive = true; });
    socket.on('message', () => { socket.close(4400, 'Client messages are not supported'); });
    socket.on('close', () => { peers.delete(peer); });
    socket.on('error', () => { peers.delete(peer); });
    scheduleProjection(peer);
  });

  const broadcastWorkspace = (workspaceId: string): void => {
    for (const peer of peers) {
      if (peer.workspaceId === workspaceId) scheduleProjection(peer);
    }
  };
  authority.setWorkspaceChangedHandler(broadcastWorkspace);

  let outboxTask: Promise<void> | null = null;
  let outboxWarningAt = 0;
  const dispatchPendingOutbox = (): Promise<void> => {
    if (outboxTask) return outboxTask;
    const task = (async () => {
      try {
        const result = await database.query<PendingOutboxRow>(
          `SELECT outbox_id, workspace_id, epoch FROM outbox
           WHERE delivered_at IS NULL ORDER BY created_at, outbox_id LIMIT $1`,
          [MAX_OUTBOX_DISPATCH_BATCH],
        );
        const grouped = new Map<string, PendingOutboxItem[]>();
        for (const row of result.rows) {
          if (typeof row.outbox_id !== 'string' || typeof row.workspace_id !== 'string'
              || (typeof row.epoch !== 'number' && typeof row.epoch !== 'string')) {
            throw new Error('OUTBOX_ROW_INVALID');
          }
          const epoch = Number(row.epoch);
          if (!Number.isSafeInteger(epoch)) throw new Error('OUTBOX_ROW_INVALID');
          const item = { outboxId: row.outbox_id, workspaceId: row.workspace_id, epoch };
          const items = grouped.get(item.workspaceId) ?? [];
          items.push(item);
          grouped.set(item.workspaceId, items);
        }
        for (const [workspaceId, items] of grouped) {
          const subscribers = [...peers].filter((peer) => peer.workspaceId === workspaceId && peer.socket.readyState === WebSocket.OPEN);
          await Promise.all(subscribers.map((peer) => scheduleProjection(peer)));
          await database.transaction(async (transaction) => {
            for (const item of items) {
              await transaction.query(
                `UPDATE outbox SET delivered_at = $2
                 WHERE outbox_id = $1 AND delivered_at IS NULL AND workspace_id = $3 AND epoch = $4`,
                [item.outboxId, now(), item.workspaceId, item.epoch],
              );
            }
          });
        }
        outboxWarningAt = 0;
      } catch {
        if (now() - outboxWarningAt >= MAINTENANCE_WARNING_INTERVAL_MS) {
          process.stderr.write(`${JSON.stringify({ event: 'outbox_dispatch_retry_pending' })}\n`);
          outboxWarningAt = now();
        }
      }
    })().finally(() => {
      if (outboxTask === task) outboxTask = null;
    });
    outboxTask = task;
    return task;
  };

  let expiryTask: Promise<void> | null = null;
  let expiryWarningAt = 0;
  const sweepExpiredWorkspaces = (): Promise<void> => {
    if (!options.expireWorkspaces) return Promise.resolve();
    if (expiryTask) return expiryTask;
    const task = options.expireWorkspaces(now(), MAX_EXPIRY_SWEEP_BATCH).then(() => {
      expiryWarningAt = 0;
    }).catch(() => {
      if (now() - expiryWarningAt >= MAINTENANCE_WARNING_INTERVAL_MS) {
        process.stderr.write(`${JSON.stringify({ event: 'workspace_expiry_retry_pending' })}\n`);
        expiryWarningAt = now();
      }
    }).finally(() => {
      if (expiryTask === task) expiryTask = null;
    });
    expiryTask = task;
    return task;
  };

  const outboxTimer = setInterval(() => { void dispatchPendingOutbox(); }, OUTBOX_DISPATCH_INTERVAL_MS);
  outboxTimer.unref();
  const expiryTimer = options.expireWorkspaces
    ? setInterval(() => { void sweepExpiredWorkspaces(); }, WORKSPACE_EXPIRY_SWEEP_INTERVAL_MS)
    : undefined;
  expiryTimer?.unref();
  void dispatchPendingOutbox();

  const serveStatic = async (request: IncomingMessage, response: ServerResponse, pathname: string, isHttps: boolean): Promise<boolean> => {
    if (!staticRoot || request.method !== 'GET' && request.method !== 'HEAD') return false;
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const candidate = resolve(staticRoot, `.${decoded}`);
    let target = candidate;
    if (!isInside(staticRoot, candidate)) throw new AuthorityError('NOT_FOUND');
    try {
      const metadata = await stat(target);
      if (!metadata.isFile()) target = resolve(staticRoot, 'index.html');
    } catch {
      target = resolve(staticRoot, 'index.html');
    }
    if (!isInside(staticRoot, target)) throw new AuthorityError('NOT_FOUND');
    let content: Buffer;
    try {
      content = await readFile(target);
    } catch {
      return false;
    }
    const isIndex = target === resolve(staticRoot, 'index.html');
    const isHashedAsset = /\.[a-f0-9]{8,}\./iu.test(target);
    setCommonHeaders(response, isHttps);
    response.writeHead(200, {
      'content-type': makeContentType(target),
      'content-length': content.byteLength,
      'cache-control': isIndex ? 'no-cache' : isHashedAsset ? `public, max-age=${STATIC_ASSET_CACHE_SECONDS}, immutable` : 'no-cache',
    });
    if (request.method === 'HEAD') response.end();
    else response.end(content);
    return true;
  };

  const route = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const startedAt = Date.now();
    const id = makeRequestId();
    const isHttps = ('encrypted' in request.socket && request.socket.encrypted === true)
      || configuredOrigin?.startsWith('https://') === true;
    setCommonHeaders(response, isHttps);
    let status = 500;
    let errorCode: string | undefined;
    let safePath = '/';
    const writeError = (error: unknown): number => {
      const mapped = safeError(error, id);
      errorCode = mapped.body.errorCode;
      apiJson(response, mapped.status, mapped.body, isHttps);
      return mapped.status;
    };
    try {
      const method = requestMethod(request);
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      safePath = url.pathname;

      if (method === 'GET' && url.pathname === '/healthz') {
        apiJson(response, 200, { ok: true }, isHttps);
        status = 200;
      } else if (method === 'GET' && url.pathname === '/readyz') {
        await authority.repository.isReady();
        apiJson(response, 200, { ok: true }, isHttps);
        status = 200;
      } else if (method === 'GET' && url.pathname === '/version') {
        const raw = staticRoot ? await readFile(resolve(staticRoot, BUILD_INFO_FILE), 'utf8').catch(() => null) : null;
        let info = null;
        try { info = raw === null ? null : parseBuildInfo(JSON.parse(raw)); } catch { info = null; }
        if (!info) throw new AuthorityError('NOT_FOUND', 'Build information is unavailable.', 404);
        apiJson(response, 200, info, isHttps);
        status = 200;
      } else if (url.pathname.startsWith('/api/')) {
        const rate = requestLimiter.take(clientRateKey(request));
        if (!rate.allowed) throw new AuthorityError('RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
        const path = apiPath(url);
        if (isMutation(method)) {
          requireSameOrigin(request, configuredOrigin);
          const mutationRate = mutationLimiter.take(clientRateKey(request));
          if (!mutationRate.allowed) throw new AuthorityError('RATE_LIMITED', 'Too many requests. Try again shortly.', 429);
        }
        if (method === 'GET' && path === '/api/session') {
          const session = await authority.authenticate(request);
          apiJson(response, 200, await authority.sessionView(session), isHttps);
          status = 200;
        } else if (method === 'POST' && path === '/api/session') {
          requireSameOrigin(request, configuredOrigin);
          const input = await readJsonBody(request, MAX_JSON_BODY_BYTES);
          const result = await authority.createOrRefreshSession(request, input);
          apiJson(response, 200, result.view, isHttps, result.setCookie ? { 'set-cookie': result.setCookie } : {});
          status = 200;
        } else if (method === 'POST' && path === '/api/workspaces') {
          requireSameOrigin(request, configuredOrigin);
          const session = await authority.authenticate(request);
          enforceMutation(request, session);
          const workspace = await authority.createWorkspace(session, await readJsonBody(request, MAX_JSON_BODY_BYTES));
          apiJson(response, 201, workspace, isHttps);
          status = 201;
        } else if (method === 'POST' && path === '/api/invites/redeem') {
          requireSameOrigin(request, configuredOrigin);
          const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
          const parsed = inviteRedemptionSchema.safeParse(body);
          if (!parsed.success) throw new AuthorityError('INVALID_REQUEST');
          const result = await authority.redeemInvite(request, parsed.data.ticket);
          apiJson(response, 200, result.workspace, isHttps, {
            'set-cookie': result.setCookie,
            'x-csrf-token': result.csrfToken,
          });
          status = 200;
        } else {
          const workspaceId = workspaceIdFrom(path, '');
          const commandsWorkspaceId = workspaceIdFrom(path, 'commands');
          const invitesWorkspaceId = workspaceIdFrom(path, 'invites');
          const eventsWorkspaceId = workspaceIdFrom(path, 'events');
          if (workspaceId && method === 'GET') {
            const authorized = await authority.authorize(request, workspaceId);
            apiJson(response, 200, authorized.workspace, isHttps);
            status = 200;
          } else if (eventsWorkspaceId && method === 'GET') {
            const authorized = await authority.authorize(request, eventsWorkspaceId);
            const afterValues = url.searchParams.getAll('after');
            const hasUnexpectedParameter = [...url.searchParams.keys()].some((key) => key !== 'after');
            if (hasUnexpectedParameter || afterValues.length > 1
                || (afterValues[0] !== undefined && !/^[a-f0-9]{64}$/u.test(afterValues[0]))) {
              throw new AuthorityError('INVALID_REQUEST');
            }
            const cursor = projectionCursor(authorized.workspace);
            apiJson(response, 200, {
              resync: afterValues[0] !== cursor,
              cursor,
              workspace: authorized.workspace,
            }, isHttps);
            status = 200;
          } else if (commandsWorkspaceId && method === 'POST') {
            const authorized = await authority.authorize(request, commandsWorkspaceId);
            enforceMutation(request, authorized.session);
            const result = await authority.execute(authorized.session, await readJsonBody(request, MAX_JSON_BODY_BYTES), commandsWorkspaceId);
            apiJson(response, 200, result, isHttps);
            status = 200;
          } else if (invitesWorkspaceId && method === 'POST') {
            const session = await authority.authenticate(request);
            enforceMutation(request, session);
            const inviteRate = inviteLimiter.take(clientRateKey(request));
            if (!inviteRate.allowed) throw new AuthorityError('RATE_LIMITED', 'Too many invitation requests.', 429);
            const body = await readJsonBody(request, MAX_JSON_BODY_BYTES);
            const parsed = inviteCreationSchema.safeParse(body);
            if (!parsed.success) throw new AuthorityError('INVALID_REQUEST');
            const result = await authority.createInvite(
              session, invitesWorkspaceId, parsed.data.seat, parsed.data.replaceOutstanding === true,
            );
            apiJson(response, 201, result, isHttps);
            status = 201;
          } else {
            const context: ExtensionContext = {
              request,
              response,
              url,
              requestId: id,
              authority,
              database,
              authenticate: () => authority.authenticate(request),
              authorize: (workspaceId) => authority.authorize(request, workspaceId),
              requireMutation: (session) => enforceMutation(request, session),
              readJsonBody: (maxBytes) => readJsonBody(request, maxBytes),
              json: (responseStatus, data, headers) => apiJson(response, responseStatus, data, isHttps, headers),
              error: (error) => { status = writeError(error); },
            };
            let handled = false;
            for (const extension of extensions) {
              if (await extension(context)) {
                handled = true;
                break;
              }
            }
            if (handled || response.headersSent) {
              status = response.statusCode;
            } else {
              throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
            }
          }
        }
      } else if (await serveStatic(request, response, url.pathname, isHttps)) {
        status = 200;
      } else {
        throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
      }
    } catch (error) {
      if (!response.headersSent) status = writeError(error);
      else response.destroy();
    } finally {
      logRequest({ requestId: id, method: requestMethod(request), path: safePath, status, durationMs: Date.now() - startedAt,
        ...(errorCode ? { errorCode } : {}) });
    }
  };

  const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> => {
    try {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
      const path = apiPath(url);
      const workspaceId = workspaceIdFrom(path, 'socket');
      if (!workspaceId) throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
      requireSameOrigin(request, configuredOrigin);
      await authority.authorize(request, workspaceId);
      webSockets.handleUpgrade(request, socket, head, (webSocket) => {
        webSockets.emit('connection', webSocket, request);
      });
    } catch (error) {
      const mapped = safeError(error, makeRequestId());
      const reason = mapped.status === 403 ? 'Forbidden' : mapped.status === 404 ? 'Not Found' : 'Unauthorized';
      socket.write(`HTTP/1.1 ${mapped.status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
      socket.destroy();
    }
  };

  return {
    authority,
    database,
    handler: (request, response) => { void route(request, response); },
    upgrade,
    addExtension(extension): void { extensions.push(extension); },
    dispatchPendingOutbox,
    sweepExpiredWorkspaces,
    async close(): Promise<void> {
      clearInterval(outboxTimer);
      if (expiryTimer) clearInterval(expiryTimer);
      clearInterval(heartbeat);
      await Promise.all([outboxTask, expiryTask].filter((task): task is Promise<void> => task !== null));
      for (const peer of peers) peer.socket.close(1001, 'Server shutting down');
      peers.clear();
      await new Promise<void>((resolveClose) => webSockets.close(() => resolveClose()));
    },
  };
}
