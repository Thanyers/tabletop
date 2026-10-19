import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MAX_JSON_BODY_BYTES,
  MAX_HTTP_REQUESTS_PER_MINUTE,
  MAX_RATE_LIMIT_KEYS,
  HTTP_RATE_WINDOW_MS,
  SECONDS_PER_MINUTE,
} from './limits.js';
import { AuthorityError } from './errors.js';
import { sha256 } from './codec.js';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export class RateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit = MAX_HTTP_REQUESTS_PER_MINUTE,
    private readonly windowMs = HTTP_RATE_WINDOW_MS,
    private readonly maxKeys = MAX_RATE_LIMIT_KEYS,
  ) {}

  take(key: string, now = Date.now()): RateLimitResult {
    const window = this.windows.get(key);
    if (!window || now - window.startedAt >= this.windowMs) {
      if (this.windows.size >= this.maxKeys) this.removeExpired(now);
      if (this.windows.size >= this.maxKeys) return { allowed: false, retryAfterSeconds: SECONDS_PER_MINUTE };
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (window.count >= this.limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((window.startedAt + this.windowMs - now) / 1000)) };
    }
    window.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private removeExpired(now: number): void {
    for (const [key, value] of this.windows) {
      if (now - value.startedAt >= this.windowMs) this.windows.delete(key);
    }
  }
}

export async function readJsonBody(request: IncomingMessage, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AuthorityError('CONTENT_TYPE_REQUIRED');
  const statedLength = request.headers['content-length'];
  if (statedLength && Number(statedLength) > maxBytes) throw new AuthorityError('BODY_TOO_LARGE');

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
    size += buffer.byteLength;
    if (size > maxBytes) throw new AuthorityError('BODY_TOO_LARGE');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new AuthorityError('INVALID_JSON');
  }
}

export function json(response: ServerResponse, status: number, data: unknown, extraHeaders: Record<string, string> = {}): void {
  const content = JSON.stringify(data);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(content),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...extraHeaders,
  });
  response.end(content);
}

export function requestId(): string {
  return randomUUID();
}

export function clientRateKey(request: IncomingMessage): string {
  const address = request.socket.remoteAddress ?? 'unknown';
  return sha256(address);
}

export function requestMethod(request: IncomingMessage): string {
  return (request.method ?? 'GET').toUpperCase();
}

export function logRequest(input: {
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  errorCode?: string;
}): void {
  process.stdout.write(`${JSON.stringify({ level: input.status >= 500 ? 'error' : 'info', ...input })}\n`);
}
