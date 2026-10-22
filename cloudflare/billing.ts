import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import type { Env } from './contracts.js';

const MAX_INPUT_TOKENS = 65_000;
const MAX_OUTPUT_TOKENS = 32_768;
const RESERVED_OUTPUT_TOKENS = 16_384;
const MAX_BODY_BYTES = 16_384;
const RESERVED_LEASE_MS = 5 * 60_000;
const DISPATCH_LEASE_MS = 2 * 60_000;
const MAX_GLOBAL_IN_FLIGHT = 8;
const MAX_ROOM_DAILY_JOBS = 50;
const MAX_ACTOR_DAILY_JOBS = 200;

type JobStatus = 'reserved' | 'dispatching' | 'settled' | 'uncertain';

interface JobBinding {
  id: string;
  actorId: string;
  workspaceId: string;
  epoch: number;
  inputHash: string;
}

interface Usage {
  promptTokens: number;
  completionTokens: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  reasoningTokens?: number;
}

interface JobRow extends Record<string, SqlStorageValue> {
  id: string;
  actor_id: string;
  workspace_id: string;
  epoch: number;
  input_hash: string;
  max_input_tokens: number;
  max_output_tokens: number;
  reserved_micro_usd: number;
  actual_micro_usd: number | null;
  status: JobStatus;
  created_at: number;
  day_key: string;
  month_key: string;
  lease_expires_at: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  cache_hit_tokens: number | null;
  cache_miss_tokens: number | null;
  reasoning_tokens: number | null;
}

const idSchema = z.string().min(1).max(160).refine((value) => value.trim() === value && !/[\u0000-\u001f]/.test(value));
const bindingShape = {
  id: z.string().regex(/^[a-f0-9]{64}$/),
  actorId: idSchema,
  workspaceId: idSchema,
  epoch: z.number().int().safe().nonnegative(),
  inputHash: z.string().regex(/^[a-f0-9]{64}$/),
};
const bindingSchema = z.strictObject(bindingShape);
const reserveSchema = z.strictObject({
  ...bindingShape,
  maxInputTokens: z.number().int().min(1).max(MAX_INPUT_TOKENS),
  maxOutputTokens: z.number().int().min(1).max(MAX_OUTPUT_TOKENS),
});
const usageSchema: z.ZodType<Usage> = z.strictObject({
  promptTokens: z.number().int().safe().nonnegative(),
  completionTokens: z.number().int().safe().nonnegative(),
  cacheHitTokens: z.number().int().safe().nonnegative(),
  cacheMissTokens: z.number().int().safe().nonnegative(),
  reasoningTokens: z.number().int().safe().nonnegative().optional(),
}).refine((usage) => Number.isSafeInteger(usage.cacheHitTokens + usage.cacheMissTokens)
  && usage.cacheHitTokens + usage.cacheMissTokens === usage.promptTokens)
  .refine((usage) => usage.reasoningTokens === undefined || usage.reasoningTokens <= usage.completionTokens);
const settleSchema = z.discriminatedUnion('outcome', [
  z.strictObject({ ...bindingShape, outcome: z.literal('uncertain') }),
  z.strictObject({ ...bindingShape, outcome: z.literal('settled'), usage: usageSchema }),
]);

class BillingError extends Error {
  constructor(readonly code: string) { super(code); }
}

function requireCondition(condition: unknown, code: string): asserts condition {
  if (!condition) throw new BillingError(code);
}

/** Peak rates: $0.30 / million cache-miss input tokens and $1.20 / million output tokens. */
export function priceMicroUsd(maxInputTokens: number, maxOutputTokens: number): number {
  if (!Number.isSafeInteger(maxInputTokens) || maxInputTokens < 0
    || !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 0) {
    throw new BillingError('BILLING_INPUT_INVALID');
  }
  const numerator = 3n * BigInt(maxInputTokens) + 12n * BigInt(maxOutputTokens);
  const amount = (numerator + 9n) / 10n;
  requireCondition(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'BILLING_INPUT_INVALID');
  return Number(amount);
}

export function usageMicroUsd(usage: Usage): number {
  const parsed = usageSchema.safeParse(usage);
  requireCondition(parsed.success, 'BILLING_USAGE_INVALID');
  // Peak input hit/miss/output prices are $0.006/$0.30/$1.20 per million tokens.
  // Sum before rounding so every settled call reserves a conservative whole micro-USD.
  const numerator = 6n * BigInt(parsed.data.cacheHitTokens)
    + 300n * BigInt(parsed.data.cacheMissTokens) + 1_200n * BigInt(parsed.data.completionTokens);
  const amount = (numerator + 999n) / 1_000n;
  requireCondition(amount <= BigInt(Number.MAX_SAFE_INTEGER), 'BILLING_USAGE_INVALID');
  return Number(amount);
}

// F036: there is no money cap. Usage is still reserved and settled per job so real spend stays
// measurable; only the job-count guards and the token bounds remain.

function utcKeys(now: number): { day: string; month: string } {
  const date = new Date(now);
  requireCondition(Number.isFinite(date.getTime()), 'BILLING_CLOCK_INVALID');
  return { day: date.toISOString().slice(0, 10), month: date.toISOString().slice(0, 7) };
}

function sameBinding(row: JobRow, binding: JobBinding): boolean {
  return row.id === binding.id && row.actor_id === binding.actorId
    && row.workspace_id === binding.workspaceId && row.epoch === binding.epoch
    && row.input_hash === binding.inputHash;
}

function rowFor(sql: DurableObjectState['storage']['sql'], id: string): JobRow | null {
  return sql.exec<JobRow>('SELECT * FROM billing_jobs WHERE id = ?', id).toArray()[0] ?? null;
}

function publicJob(row: JobRow) {
  return {
    status: row.status,
    reservedMicroUsd: row.reserved_micro_usd,
    ...(row.actual_micro_usd === null ? {} : { actualMicroUsd: row.actual_micro_usd }),
    ...(row.status === 'settled' ? {
      usage: {
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        cacheHitTokens: row.cache_hit_tokens,
        cacheMissTokens: row.cache_miss_tokens,
        ...(row.reasoning_tokens === null ? {} : { reasoningTokens: row.reasoning_tokens }),
      },
    } : {}),
  };
}

async function readBoundedJson(request: Request): Promise<unknown> {
  const contentLength = request.headers.get('content-length');
  if (contentLength !== null) {
    const declared = Number(contentLength);
    requireCondition(Number.isSafeInteger(declared) && declared >= 0 && declared <= MAX_BODY_BYTES, 'BILLING_REQUEST_INVALID');
  }
  requireCondition(request.body !== null, 'BILLING_REQUEST_INVALID');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => undefined);
        throw new BillingError('BILLING_REQUEST_INVALID');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    throw new BillingError('BILLING_REQUEST_INVALID');
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Durable, global billing ledger. The Worker must keep its routes private to binding calls. */
export class Billing extends DurableObject<Env> {
  private readonly sql: DurableObjectState['storage']['sql'];
  private alarmArming: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS billing_jobs (
      id TEXT PRIMARY KEY,
      actor_id TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      epoch INTEGER NOT NULL,
      input_hash TEXT NOT NULL,
      max_input_tokens INTEGER NOT NULL,
      max_output_tokens INTEGER NOT NULL,
      reserved_micro_usd INTEGER NOT NULL,
      actual_micro_usd INTEGER,
      status TEXT NOT NULL CHECK(status IN ('reserved','dispatching','settled','uncertain')),
      created_at INTEGER NOT NULL,
      day_key TEXT NOT NULL,
      month_key TEXT NOT NULL,
      lease_expires_at INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      cache_hit_tokens INTEGER,
      cache_miss_tokens INTEGER,
      reasoning_tokens INTEGER
    )`);
    this.sql.exec('CREATE INDEX IF NOT EXISTS billing_day_idx ON billing_jobs(day_key)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS billing_month_idx ON billing_jobs(month_key)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS billing_lease_idx ON billing_jobs(status, lease_expires_at)');
  }

  async fetch(request: Request): Promise<Response> {
    try {
      if (request.method !== 'POST') return json({ ok: false, errorCode: 'BILLING_NOT_FOUND' }, 404);
      const path = new URL(request.url).pathname;
      const body = await readBoundedJson(request);
      if (path === '/reserve') return await this.reserve(body);
      if (path === '/dispatch') return await this.dispatch(body);
      if (path === '/settle') return await this.settle(body);
      if (path === '/status') return this.status(body);
      return json({ ok: false, errorCode: 'BILLING_NOT_FOUND' }, 404);
    } catch (error) {
      const code = error instanceof BillingError ? error.code : 'BILLING_UNAVAILABLE';
      const status = code === 'BILLING_NOT_FOUND' ? 404
        : code === 'BILLING_QUOTA' || code === 'BILLING_BUDGET' ? 429
          : code === 'BILLING_CONFLICT' ? 409
            : code === 'MODEL_NOT_CONFIGURED' ? 503 : 400;
      return json({ ok: false, errorCode: code }, status);
    }
  }

  private async reserve(raw: unknown): Promise<Response> {
    const parsed = reserveSchema.safeParse(raw);
    requireCondition(parsed.success, 'BILLING_REQUEST_INVALID');
    const input = parsed.data;
    // F036: the money cap is off by default so testing measures real usage instead of
    // tripping a reservation cap. Rows are still written and settled, so spend stays auditable.
    requireCondition(Boolean(this.env.DEEPSEEK_KEY), 'MODEL_NOT_CONFIGURED');
    const now = Date.now();
    const keys = utcKeys(now);
    // F032: thinking runs can request 32K output, but reserving that much per call trips the daily/monthly cap long before real spend. Reserve a realistic ceiling; settlement still charges actual usage.
  const reserved = priceMicroUsd(input.maxInputTokens, Math.min(input.maxOutputTokens, RESERVED_OUTPUT_TOKENS));
    const result = this.ctx.storage.transactionSync(() => {
      const existing = rowFor(this.sql, input.id);
      if (existing) {
        const bindingMatches = sameBinding(existing, input)
          && existing.max_input_tokens === input.maxInputTokens
          && existing.max_output_tokens === input.maxOutputTokens
          && existing.reserved_micro_usd === reserved;
        requireCondition(bindingMatches, 'BILLING_CONFLICT');
        return { ...publicJob(existing), duplicate: true };
      }

      const roomJobs = Number(this.sql.exec<{ amount: number }>(
        'SELECT COUNT(*) AS amount FROM billing_jobs WHERE workspace_id = ? AND day_key = ?', input.workspaceId, keys.day,
      ).toArray()[0]?.amount ?? 0);
      const actorJobs = Number(this.sql.exec<{ amount: number }>(
        'SELECT COUNT(*) AS amount FROM billing_jobs WHERE actor_id = ? AND day_key = ?', input.actorId, keys.day,
      ).toArray()[0]?.amount ?? 0);
      const activeJobs = Number(this.sql.exec<{ amount: number }>(
        `SELECT COUNT(*) AS amount FROM billing_jobs
         WHERE status IN ('reserved','dispatching') AND lease_expires_at > ?`, now,
      ).toArray()[0]?.amount ?? 0);
      requireCondition(roomJobs < MAX_ROOM_DAILY_JOBS && actorJobs < MAX_ACTOR_DAILY_JOBS
        && activeJobs < MAX_GLOBAL_IN_FLIGHT, 'BILLING_QUOTA');

      this.sql.exec(
        `INSERT INTO billing_jobs (
          id, actor_id, workspace_id, epoch, input_hash, max_input_tokens, max_output_tokens,
          reserved_micro_usd, actual_micro_usd, status, created_at, day_key, month_key,
          lease_expires_at, prompt_tokens, completion_tokens, cache_hit_tokens, cache_miss_tokens, reasoning_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'reserved', ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL)`,
        input.id, input.actorId, input.workspaceId, input.epoch, input.inputHash,
        input.maxInputTokens, input.maxOutputTokens, reserved, now, keys.day, keys.month, now + RESERVED_LEASE_MS,
      );
      return {
        status: 'reserved' as const,
        reservedMicroUsd: reserved,
        duplicate: false,
      };
    });
    await this.armNextAlarm();
    return json({ ok: true, ...result });
  }

  private async dispatch(raw: unknown): Promise<Response> {
    const parsed = bindingSchema.safeParse(raw);
    requireCondition(parsed.success, 'BILLING_REQUEST_INVALID');
    const binding = parsed.data;
    const now = Date.now();
    const result = this.ctx.storage.transactionSync(() => {
      const row = rowFor(this.sql, binding.id);
      requireCondition(row !== null && sameBinding(row, binding), 'BILLING_NOT_FOUND');
      if (row.status === 'reserved' && (row.lease_expires_at ?? 0) > now) {
        this.sql.exec(
          "UPDATE billing_jobs SET status = 'dispatching', lease_expires_at = ? WHERE id = ? AND status = 'reserved'",
          now + DISPATCH_LEASE_MS, binding.id,
        );
        return { claimed: true, status: 'dispatching' as const };
      }
      if (row.status === 'reserved') {
        this.sql.exec("UPDATE billing_jobs SET status = 'uncertain', lease_expires_at = NULL WHERE id = ?", binding.id);
        return { claimed: false, status: 'uncertain' as const };
      }
      return { claimed: false, status: row.status };
    });
    await this.armNextAlarm();
    return json({ ok: true, ...result });
  }

  private async settle(raw: unknown): Promise<Response> {
    const parsed = settleSchema.safeParse(raw);
    requireCondition(parsed.success, 'BILLING_REQUEST_INVALID');
    const input = parsed.data;
    const result = this.ctx.storage.transactionSync(() => {
      const row = rowFor(this.sql, input.id);
      requireCondition(row !== null && sameBinding(row, input), 'BILLING_NOT_FOUND');
      if (input.outcome === 'uncertain') {
        if (row.status === 'settled') return publicJob(row);
        requireCondition(row.status === 'dispatching' || row.status === 'uncertain', 'BILLING_CONFLICT');
        this.sql.exec("UPDATE billing_jobs SET status = 'uncertain', lease_expires_at = NULL WHERE id = ?", input.id);
        const updated = rowFor(this.sql, input.id)!;
        return publicJob(updated);
      }

      const actual = usageMicroUsd(input.usage);
      if (row.status === 'settled') {
        const sameUsage = row.prompt_tokens === input.usage.promptTokens
          && row.completion_tokens === input.usage.completionTokens
          && row.cache_hit_tokens === input.usage.cacheHitTokens
          && row.cache_miss_tokens === input.usage.cacheMissTokens
          && row.reasoning_tokens === (input.usage.reasoningTokens ?? null);
        requireCondition(sameUsage, 'BILLING_CONFLICT');
        return publicJob(row);
      }
      requireCondition(input.usage.promptTokens <= row.max_input_tokens
        && input.usage.completionTokens <= row.max_output_tokens, 'BILLING_USAGE_INVALID');
      requireCondition(row.status === 'dispatching' || row.status === 'uncertain', 'BILLING_CONFLICT');
      this.sql.exec(
        `UPDATE billing_jobs SET status = 'settled', actual_micro_usd = ?, lease_expires_at = NULL,
           prompt_tokens = ?, completion_tokens = ?, cache_hit_tokens = ?, cache_miss_tokens = ?, reasoning_tokens = ?
         WHERE id = ? AND status IN ('dispatching','uncertain')`,
        actual, input.usage.promptTokens, input.usage.completionTokens, input.usage.cacheHitTokens,
        input.usage.cacheMissTokens, input.usage.reasoningTokens ?? null, input.id,
      );
      return publicJob(rowFor(this.sql, input.id)!);
    });
    await this.armNextAlarm();
    return json({ ok: true, ...result });
  }

  private status(raw: unknown): Response {
    const parsed = bindingSchema.safeParse(raw);
    requireCondition(parsed.success, 'BILLING_REQUEST_INVALID');
    const row = rowFor(this.sql, parsed.data.id);
    requireCondition(row !== null && sameBinding(row, parsed.data), 'BILLING_NOT_FOUND');
    return json({ ok: true, ...publicJob(row) });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    this.ctx.storage.transactionSync(() => {
      this.sql.exec(
        `UPDATE billing_jobs SET status = 'uncertain', lease_expires_at = NULL
         WHERE status IN ('reserved','dispatching') AND lease_expires_at <= ?`, now,
      );
    });
    await this.armNextAlarm();
  }

  private armNextAlarm(): Promise<void> {
    const current = this.alarmArming.then(() => this.updateNextAlarm());
    this.alarmArming = current.catch(() => undefined);
    return current;
  }

  private async updateNextAlarm(): Promise<void> {
    const next = this.sql.exec<{ due: number | null }>(
      `SELECT MIN(lease_expires_at) AS due FROM billing_jobs
       WHERE status IN ('reserved','dispatching') AND lease_expires_at IS NOT NULL`,
    ).toArray()[0]?.due;
    if (typeof next === 'number' && Number.isSafeInteger(next)) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }
}

export type BillingRequestBinding = JobBinding;
export type BillingUsage = Usage;
