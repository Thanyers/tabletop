import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { GenerationError, generateWithCodex, MAX_GENERATION_MS, validateGeneratedComponent } from './generator.ts';
import type {
  ComponentLabJob,
  ComponentLabSettings,
  GenerateComponentRequest,
  GeneratedComponent,
  ModelRunResult,
  RhythmStateSnapshot,
  TapHistoryEntry,
} from './types.ts';

export const COMPONENT_LAB_PREFIX = '/api/component-lab';
const MAX_BODY_BYTES = 96 * 1024;
const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_RETAINED_JOBS = 12;
const AUTH_PROBE_MS = 6_000;
const LOGIN_STATUS_CACHE_MS = 10_000;
const REQUIRED_REQUEST_HEADER = 'x-component-lab';
const UNREPORTED_MODEL_LABEL = 'Codex configured default (not reported)';

type Generator = (input: GenerateComponentRequest, signal: AbortSignal) => Promise<ModelRunResult>;
type AuthProbe = () => Promise<boolean>;
type RequestHandler = (request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction) => void;

class ApiError extends Error {
  readonly statusCode: number;
  readonly publicMessage: string;

  constructor(statusCode: number, publicMessage: string) {
    super(publicMessage);
    this.name = 'ApiError';
    this.statusCode = statusCode;
    this.publicMessage = publicMessage;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function parseSettings(value: unknown): ComponentLabSettings | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['bpm', 'toleranceMs', 'splitHands', 'appearance'])) return undefined;
  const { bpm, toleranceMs, splitHands, appearance } = value;
  if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 30 || bpm > 240) return undefined;
  if (typeof toleranceMs !== 'number' || !Number.isInteger(toleranceMs) || toleranceMs < 10 || toleranceMs > 1000) return undefined;
  if (typeof splitHands !== 'boolean' || typeof appearance !== 'string' || appearance.trim().length < 1 || appearance.length > 200) return undefined;
  return { bpm, toleranceMs, splitHands, appearance };
}

function parseHistory(value: unknown): TapHistoryEntry[] | undefined {
  if (!Array.isArray(value) || value.length > 500) return undefined;
  const parsed: TapHistoryEntry[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['id', 'hand', 'offsetMs', 'at'])) return undefined;
    const { id, hand, offsetMs, at } = entry;
    if (typeof id !== 'string' || id.trim().length < 1 || id.length > 100) return undefined;
    if (hand !== 'left' && hand !== 'right' && hand !== 'both') return undefined;
    if (typeof offsetMs !== 'number' || !Number.isFinite(offsetMs) || Math.abs(offsetMs) > 30_000) return undefined;
    if (typeof at !== 'number' || !Number.isFinite(at) || at < 0) return undefined;
    parsed.push({ id, hand, offsetMs, at });
  }
  return parsed;
}

function parseSnapshot(value: unknown): RhythmStateSnapshot | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, ['settings', 'history'])) return undefined;
  const settings = parseSettings(value.settings);
  const history = parseHistory(value.history);
  if (!settings || !history) return undefined;
  return { settings, history };
}

function parsePrior(value: unknown): GeneratedComponent | undefined {
  if (!isRecord(value)) return undefined;
  const settings = parseSettings(value.settings);
  if (!settings) return undefined;
  try {
    return validateGeneratedComponent({ ...value, settings });
  } catch {
    return undefined;
  }
}

function parseGenerateRequest(value: unknown): GenerateComponentRequest {
  if (!isRecord(value) || !hasOnlyKeys(value, ['request', 'snapshot', 'prior', 'editInstruction', 'editIndex'])) {
    throw new ApiError(400, 'Request body is invalid.');
  }
  const { request, snapshot, prior, editInstruction, editIndex } = value;
  const safeSnapshot = parseSnapshot(snapshot);
  if (typeof request !== 'string' || request.length > 4_000 || !safeSnapshot) throw new ApiError(400, 'Request body is invalid.');
  if (prior !== undefined && !parsePrior(prior)) throw new ApiError(400, 'Prior component is invalid.');
  if (editInstruction !== undefined && (typeof editInstruction !== 'string' || editInstruction.length > 4_000)) {
    throw new ApiError(400, 'Edit instruction is invalid.');
  }
  if (editIndex !== undefined && (!Number.isInteger(editIndex) || typeof editIndex !== 'number' || editIndex < 0 || editIndex > 2)) {
    throw new ApiError(400, 'Edit number is invalid.');
  }
  const safePrior = prior === undefined ? undefined : parsePrior(prior);
  if (prior !== undefined && !safePrior) throw new ApiError(400, 'Prior component is invalid.');
  const safeEdit = typeof editInstruction === 'string' && editInstruction.trim() ? editInstruction.trim() : undefined;
  if (!request.trim() && !safeEdit) throw new ApiError(400, 'Add a component request.');
  if (safeEdit && !safePrior) throw new ApiError(400, 'An edit needs a prior component.');

  const parsed: GenerateComponentRequest = { request: request.trim(), snapshot: safeSnapshot };
  if (safePrior) parsed.prior = safePrior;
  if (safeEdit) parsed.editInstruction = safeEdit;
  if (typeof editIndex === 'number') parsed.editIndex = editIndex;
  return parsed;
}

export function safeJobError(error: unknown): string {
  if (!(error instanceof GenerationError)) return 'Codex could not complete this generation. No process logs are exposed.';
  const diagnostic = error.diagnostic ? ` (diagnostic: ${error.diagnostic})` : '';
  switch (error.code) {
    case 'unavailable': return 'Codex is unavailable or not signed in for this local session.';
    case 'cancelled': return 'Generation was cancelled.';
    case 'timeout': return 'Generation exceeded the three-minute limit.';
    case 'invalid-output': return `The generated component did not meet the required safe output shape${diagnostic}. Try again.`;
    case 'failed': return `Codex could not complete this generation${diagnostic}. No process logs are exposed.`;
  }
}

function isLoopbackHost(hostHeader: string | undefined): boolean {
  if (!hostHeader || hostHeader.length > 255 || /[\s/@]/.test(hostHeader)) return false;
  try {
    const parsed = new URL(`http://${hostHeader}`);
    const hostname = parsed.hostname.toLowerCase();
    return hostname === 'localhost' || hostname === '::1' || /^127(?:\.\d{1,3}){3}$/.test(hostname);
  } catch {
    return false;
  }
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.toLowerCase().replace(/^::ffff:/, '');
  return normalized === '::1' || normalized === 'localhost' || /^127(?:\.\d{1,3}){3}$/.test(normalized);
}

function hasSameOrigin(request: IncomingMessage): boolean {
  const host = request.headers.host;
  const origin = request.headers.origin;
  if (!host || typeof origin !== 'string' || origin === 'null') return false;
  try {
    return new URL(origin).origin === `http://${host.toLowerCase()}`;
  } catch {
    return false;
  }
}

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  response.end(body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers['content-type'];
  if (typeof contentType !== 'string' || !contentType.toLowerCase().startsWith('application/json')) {
    throw new ApiError(400, 'Content-Type must be application/json.');
  }
  const contentLength = request.headers['content-length'];
  if (typeof contentLength === 'string') {
    const declaredLength = Number(contentLength);
    if (!Number.isFinite(declaredLength) || declaredLength < 0) throw new ApiError(400, 'Content length is invalid.');
    if (declaredLength > MAX_BODY_BYTES) throw new ApiError(413, 'Request body is too large.');
  }
  const chunks: Buffer[] = [];
  let byteLength = 0;
  let exceeded = false;
  await new Promise<void>((resolve, reject) => {
    request.on('data', (chunk: Buffer | string) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      byteLength += bytes.byteLength;
      if (byteLength > MAX_BODY_BYTES) {
        exceeded = true;
        chunks.length = 0;
        return;
      }
      if (!exceeded) chunks.push(bytes);
    });
    request.on('end', resolve);
    request.on('error', () => reject(new ApiError(400, 'Request body could not be read.')));
  });
  if (exceeded) throw new ApiError(413, 'Request body is too large.');
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ApiError(400, 'Request body is not valid JSON.');
  }
}

export class ComponentLabJobs {
  private readonly jobs = new Map<string, ComponentLabJob>();
  private activeJobId: string | undefined;
  private activeController: AbortController | undefined;
  private readonly generator: Generator;

  constructor(generator: Generator = generateWithCodex) {
    this.generator = generator;
  }

  start(input: GenerateComponentRequest): string {
    if (this.activeJobId) throw new ApiError(409, 'Another generation is already running.');
    const jobId = randomUUID();
    const job: ComponentLabJob = { jobId, status: 'running' };
    const controller = new AbortController();
    this.jobs.set(jobId, job);
    this.activeJobId = jobId;
    this.activeController = controller;
    this.trimJobs();

    void Promise.resolve()
      .then(() => {
        const promptBytes = Buffer.byteLength(JSON.stringify(input), 'utf8');
        if (promptBytes > MAX_PROMPT_BYTES) throw new ApiError(413, 'Generation input is too large.');
        return this.generator(input, controller.signal);
      })
      .then((result) => {
        const current = this.jobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        const component = validateGeneratedComponent(result.component);
        if (!Number.isFinite(result.modelMs) || result.modelMs < 0) throw new GenerationError('invalid-output');
        const modelId = /^[a-zA-Z0-9_.:/ ()-]{1,100}$/.test(result.modelId) ? result.modelId : UNREPORTED_MODEL_LABEL;
        current.status = 'complete';
        current.result = { ...component, modelMs: Math.round(result.modelMs), modelId };
      })
      .catch((error: unknown) => {
        const current = this.jobs.get(jobId);
        if (!current || current.status === 'cancelled') return;
        current.status = 'failed';
        current.error = safeJobError(error);
      })
      .finally(() => {
        if (this.activeJobId === jobId) {
          this.activeJobId = undefined;
          this.activeController = undefined;
        }
      });
    return jobId;
  }

  get(jobId: string): ComponentLabJob | undefined {
    const job = this.jobs.get(jobId);
    return job ? structuredClone(job) : undefined;
  }

  cancel(jobId: string): ComponentLabJob | undefined {
    const job = this.jobs.get(jobId);
    if (!job) return undefined;
    if (job.status === 'running' && this.activeJobId === jobId) {
      job.status = 'cancelled';
      this.activeController?.abort();
    }
    return structuredClone(job);
  }

  private trimJobs(): void {
    while (this.jobs.size > MAX_RETAINED_JOBS) {
      const oldestId = this.jobs.keys().next().value as string | undefined;
      if (!oldestId || oldestId === this.activeJobId) return;
      this.jobs.delete(oldestId);
    }
  }
}

export function probeCodexLogin(): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('codex', ['login', 'status'], { stdio: 'ignore', windowsHide: true, shell: false });
    let finished = false;
    const finish = (authenticated: boolean): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve(authenticated);
    };
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      finish(false);
    }, AUTH_PROBE_MS);
    child.on('error', () => finish(false));
    child.on('close', (code) => finish(code === 0));
  });
}

export function createLoginStatusCache(
  probe: AuthProbe,
  ttlMs = LOGIN_STATUS_CACHE_MS,
  now: () => number = Date.now,
): () => Promise<boolean> {
  let cached: { value: boolean; expiresAt: number } | undefined;
  let pending: Promise<boolean> | undefined;
  const safeTtl = Math.max(0, Number.isFinite(ttlMs) ? ttlMs : LOGIN_STATUS_CACHE_MS);

  return async () => {
    if (cached && now() < cached.expiresAt) return cached.value;
    if (pending) return pending;

    const current = Promise.resolve().then(probe).catch(() => false);
    pending = current;
    try {
      const value = await current;
      cached = { value, expiresAt: now() + safeTtl };
      return value;
    } finally {
      if (pending === current) pending = undefined;
    }
  };
}

export function createComponentLabHandler(
  jobs = new ComponentLabJobs(),
  probeLogin: AuthProbe = probeCodexLogin,
): RequestHandler {
  const getLoginStatus = createLoginStatusCache(probeLogin);
  return (request, response, next) => {
    const rawUrl = request.url;
    if (!rawUrl || !rawUrl.startsWith(COMPONENT_LAB_PREFIX)) {
      next();
      return;
    }
    void (async () => {
      if (!isLoopbackHost(request.headers.host) || !isLoopbackAddress(request.socket.remoteAddress)) {
        sendJson(response, 403, { error: 'This local-only endpoint accepts loopback requests.' });
        return;
      }
      let pathname: string;
      try {
        pathname = new URL(rawUrl, `http://${request.headers.host}`).pathname;
      } catch {
        sendJson(response, 400, { error: 'Request path is invalid.' });
        return;
      }
      if (request.method === 'GET' && pathname === `${COMPONENT_LAB_PREFIX}/status`) {
        const available = await getLoginStatus();
        sendJson(response, 200, available ? { available: true } : { available: false, reason: 'Codex CLI is unavailable or not signed in for this local session.' });
        return;
      }

      if (request.method === 'POST' && pathname === `${COMPONENT_LAB_PREFIX}/generate`) {
        if (!hasSameOrigin(request) || request.headers[REQUIRED_REQUEST_HEADER] !== '1') {
          sendJson(response, 403, { error: 'A same-origin component-lab request header is required.' });
          return;
        }
        try {
          const input = parseGenerateRequest(await readJsonBody(request));
          const promptSize = Buffer.byteLength(JSON.stringify(input), 'utf8');
          if (promptSize > MAX_PROMPT_BYTES) throw new ApiError(413, 'Generation input is too large.');
          const jobId = jobs.start(input);
          sendJson(response, 202, { jobId });
        } catch (error) {
          if (error instanceof ApiError) {
            sendJson(response, error.statusCode, { error: error.publicMessage });
          } else {
            sendJson(response, 500, { error: 'The generation request could not be started.' });
          }
        }
        return;
      }

      const jobMatch = pathname.match(/^\/api\/component-lab\/jobs\/([0-9a-f-]{36})$/i);
      if (jobMatch && request.method === 'GET') {
        const job = jobs.get(jobMatch[1]);
        sendJson(response, job ? 200 : 404, job ?? { error: 'Generation job was not found.' });
        return;
      }
      if (jobMatch && request.method === 'DELETE') {
        if (!hasSameOrigin(request) || request.headers[REQUIRED_REQUEST_HEADER] !== '1') {
          sendJson(response, 403, { error: 'A same-origin component-lab request header is required.' });
          return;
        }
        const job = jobs.cancel(jobMatch[1]);
        sendJson(response, job ? 200 : 404, job ?? { error: 'Generation job was not found.' });
        return;
      }

      if (pathname.startsWith(`${COMPONENT_LAB_PREFIX}/jobs/`) || pathname.startsWith(`${COMPONENT_LAB_PREFIX}/`)) {
        sendJson(response, 405, { error: 'This component-lab route or method is not supported.' });
        return;
      }
      next();
    })().catch(() => {
      if (!response.headersSent) sendJson(response, 500, { error: 'The local component-lab request failed.' });
    });
  };
}

export function componentLabPlugin(): Plugin {
  return {
    name: 'procedural-component-lab',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(createComponentLabHandler());
    },
  };
}

export const componentLabLimits = Object.freeze({
  bodyBytes: MAX_BODY_BYTES,
  inputBytes: MAX_PROMPT_BYTES,
  generationMs: MAX_GENERATION_MS,
  retainedJobs: MAX_RETAINED_JOBS,
});
