import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { SqlDatabase } from './database.js';
import { invoiceChangeSchema } from '../src/tabletop/domain/index.js';
import { DomainError, type ChangeSet, type InvoiceState } from '../src/tabletop/shared/contracts.js';

export interface ModelInput {
  prompt: string;
  sourceId: string;
  excerpt: string;
  rules: InvoiceState['rules'];
}

export interface ModelProvider {
  readonly name: string;
  readonly model: string;
  propose(input: ModelInput, signal: AbortSignal): Promise<unknown>;
}

type JobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'revoked';

export interface ModelJob {
  id: string;
  workspaceId: string;
  epoch: number;
  actorId: string;
  createdAt: number;
  status: JobStatus;
  revokedAt?: number | null;
  data: {
    input: ModelInput;
    sessionTokenHash: string;
    expectedRevision: string;
    commandId: string;
    reservedMicroUsd: number;
    errorCode?: string;
    candidateId?: string;
    provider: string;
    model: string;
  };
}

export interface ModelJobStore {
  /** Atomically reserves budget or returns the reservation already made for this command. */
  reserve(job: ModelJob, dailyBudgetMicroUsd: number): Promise<ModelJob>;
  /** Claims only an unrevoked queued row; stale queue snapshots cannot dispatch reset jobs. */
  claim(id: string): Promise<ModelJob | null>;
  get(id: string): Promise<ModelJob | null>;
  save(job: ModelJob): Promise<void>;
  cancel(id: string): Promise<ModelJob | null>;
  pending(): Promise<ModelJob[]>;
}

const storedRuleSchema = z.strictObject({
  id: z.string(),
  kind: z.enum(['base', 'step', 'surcharge']),
  zone: z.union([z.enum(['bangkok', 'regional']), z.literal('*')]),
  amountSatang: z.number().int().safe(),
  from: z.string(),
  to: z.string().nullable(),
  sourceId: z.string(),
  enabled: z.boolean(),
});

const storedDataSchema = z.strictObject({
  input: z.strictObject({
    prompt: z.string(),
    sourceId: z.string(),
    excerpt: z.string(),
    rules: z.array(storedRuleSchema),
  }),
  sessionTokenHash: z.string(),
  expectedRevision: z.string(),
  commandId: z.string(),
  reservedMicroUsd: z.number().int().safe().nonnegative(),
  errorCode: z.string().optional(),
  candidateId: z.string().optional(),
  provider: z.string(),
  model: z.string(),
});

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`).join(',')}}`;
}

function sameRequest(left: ModelJob, right: ModelJob): boolean {
  const payload = (job: ModelJob) => ({
    input: job.data.input,
    expectedRevision: job.data.expectedRevision,
  });
  return canonicalJson(payload(left)) === canonicalJson(payload(right));
}

function isRevoked(job: ModelJob): boolean {
  return job.revokedAt != null || job.status === 'revoked';
}

/** A revoked SQL row is only a tombstone. Never recover serialized private job data from it. */
function tombstoneData(): ModelJob['data'] {
  return {
    input: { prompt: '', sourceId: '', excerpt: '', rules: [] },
    sessionTokenHash: '',
    expectedRevision: '',
    commandId: '',
    reservedMicroUsd: 0,
    provider: '',
    model: '',
  };
}

function mapNumber(value: unknown, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number)) throw new DomainError('MODEL_JOB_CORRUPT', `Invalid model job ${field}`);
  return number;
}

export class SqlModelJobStore implements ModelJobStore {
  constructor(private readonly database: SqlDatabase) {}

  private decode(row: Record<string, unknown>): ModelJob {
    const revokedAt = row.revoked_at === null || row.revoked_at === undefined ? null : mapNumber(row.revoked_at, 'revoked_at');
    const status = z.enum(['queued', 'running', 'completed', 'failed', 'cancelled', 'revoked']).safeParse(row.status);
    const base = {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      epoch: mapNumber(row.epoch, 'epoch'),
      actorId: String(row.actor_id),
      createdAt: mapNumber(row.created_at, 'created_at'),
    };
    // Reset deliberately erases job JSON. Recognize revocation before parsing data so an
    // in-flight provider failure reads as a scoped tombstone instead of MODEL_JOB_CORRUPT.
    if (revokedAt !== null || row.status === 'revoked') {
      return { ...base, status: 'revoked', revokedAt, data: tombstoneData() };
    }
    const dataValue = typeof row.data === 'string' ? JSON.parse(row.data) as unknown : row.data;
    const data = storedDataSchema.safeParse(dataValue);
    if (!status.success || !data.success) throw new DomainError('MODEL_JOB_CORRUPT', 'Invalid stored model job');
    return { ...base, status: status.data, revokedAt: null, data: data.data };
  }

  async reserve(job: ModelJob, cap: number): Promise<ModelJob> {
    return this.database.transaction(async (tx) => {
      // This row lock serializes budget accounting and idempotency checks across processes.
      await tx.query('SELECT singleton FROM authority_meta WHERE singleton = TRUE FOR UPDATE');
      const existing = await tx.query(
        `SELECT * FROM model_jobs
         WHERE workspace_id = $1 AND actor_id = $2 AND epoch = $3 AND data->>'commandId' = $4
         ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [job.workspaceId, job.actorId, job.epoch, job.data.commandId],
      );
      if (existing.rows[0]) {
        const reserved = this.decode(existing.rows[0]);
        if (isRevoked(reserved)) {
          throw new DomainError('MODEL_JOB_NOT_FOUND', 'ไม่พบข้อเสนอ AI ในสิทธิ์ของคุณ');
        }
        if (!sameRequest(reserved, job)) {
          throw new DomainError('MODEL_COMMAND_CONFLICT', 'ข้อเสนอคำสั่งนี้ถูกใช้กับคำขออื่นแล้ว');
        }
        return reserved;
      }

      const midnight = Math.floor(job.createdAt / 86_400_000) * 86_400_000;
      const room = await tx.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM model_jobs WHERE workspace_id = $1 AND created_at >= $2',
        [job.workspaceId, midnight],
      );
      if (Number(room.rows[0]?.count ?? 0) >= 5) {
        throw new DomainError('MODEL_ROOM_QUOTA', 'ครบจำนวนข้อเสนอ AI ของโต๊ะนี้สำหรับวันนี้แล้ว');
      }
      const usage = await tx.query<{ spent: string }>(
        `SELECT COALESCE(SUM((data->>'reservedMicroUsd')::bigint), 0)::text AS spent
         FROM model_jobs WHERE created_at >= $1`,
        [midnight],
      );
      if (Number(usage.rows[0]?.spent ?? 0) + job.data.reservedMicroUsd > cap) {
        throw new DomainError('MODEL_BUDGET', 'ถึงเพดานงบที่ตั้งไว้แล้ว ใช้ตัวแก้ไขกฎต่อได้');
      }
      await tx.query(
        `INSERT INTO model_jobs(id, workspace_id, epoch, actor_id, status, created_at, revoked_at, data)
         VALUES($1, $2, $3, $4, $5, $6, NULL, $7::jsonb)`,
        [job.id, job.workspaceId, job.epoch, job.actorId, job.status, job.createdAt, JSON.stringify(job.data)],
      );
      return structuredClone(job);
    });
  }

  async claim(id: string): Promise<ModelJob | null> {
    const result = await this.database.query(
      `UPDATE model_jobs SET status = 'running'
       WHERE id = $1 AND status = 'queued' AND revoked_at IS NULL
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? this.decode(result.rows[0]) : null;
  }

  async get(id: string): Promise<ModelJob | null> {
    const result = await this.database.query('SELECT * FROM model_jobs WHERE id = $1', [id]);
    return result.rows[0] ? this.decode(result.rows[0]) : null;
  }

  async save(job: ModelJob): Promise<void> {
    await this.database.query(
      `UPDATE model_jobs SET status = $2, data = $3::jsonb
       WHERE id = $1 AND revoked_at IS NULL AND status IN ('queued', 'running')`,
      [job.id, job.status, JSON.stringify(job.data)],
    );
  }

  async cancel(id: string): Promise<ModelJob | null> {
    const result = await this.database.query(
      `UPDATE model_jobs SET status = 'cancelled'
       WHERE id = $1 AND revoked_at IS NULL AND status IN ('queued', 'running')
       RETURNING *`,
      [id],
    );
    return result.rows[0] ? this.decode(result.rows[0]) : this.get(id);
  }

  async pending(): Promise<ModelJob[]> {
    const result = await this.database.query(
      `SELECT * FROM model_jobs
       WHERE status IN ('queued', 'running') AND revoked_at IS NULL
       ORDER BY created_at`,
    );
    return result.rows
      .map((row) => this.decode(row))
      .filter((job) => !isRevoked(job) && (job.status === 'queued' || job.status === 'running'));
  }
}

/**
 * Persists only a draft candidate. Future adapters must atomically recheck the current
 * workspace epoch and expected revision with candidate creation. The gateway's read
 * before dispatch narrows the reset race but is not an atomic guarantee; AbortSignal
 * remains advisory for adapters whose operation is already in flight.
 */
export interface CandidateDispatch {
  (job: ModelJob, change: ChangeSet, signal: AbortSignal): Promise<{ candidateId: string }>;
}

export class ModelGateway {
  private running = false;
  private rerunRequested = false;
  private closed = false;
  private readonly active = new Map<string, AbortController>();
  private readonly activeRuns = new Map<string, Promise<void>>();

  constructor(
    private readonly store: ModelJobStore,
    private readonly dispatch: CandidateDispatch,
    private readonly options: {
      provider?: ModelProvider;
      dailyBudgetMicroUsd?: number;
      reservationMicroUsd?: number;
      timeoutMs?: number;
      now?: () => number;
    },
  ) {}

  get enabled(): boolean {
    return Boolean(
      this.options.provider
      && Number.isSafeInteger(this.options.dailyBudgetMicroUsd)
      && this.options.dailyBudgetMicroUsd! > 0
      && Number.isSafeInteger(this.options.reservationMicroUsd)
      && this.options.reservationMicroUsd! > 0,
    );
  }

  async enqueue(
    request: {
      workspaceId: string;
      epoch: number;
      actorId: string;
      sessionTokenHash: string;
      expectedRevision: string;
      commandId: string;
      state: InvoiceState;
    },
    raw: unknown,
  ) {
    if (!this.enabled) {
      throw new DomainError('MODEL_NOT_CONFIGURED', 'ยังไม่ได้เลือกและอนุมัติบริการ AI ใช้ตัวแก้ไขกฎและการตรวจข้อเสนอได้ตามปกติ');
    }
    const parsed = z.strictObject({
      prompt: z.string().min(3).max(4000),
      sourceId: z.string().min(1).max(160),
      consent: z.literal(true),
    }).safeParse(raw);
    if (!parsed.success) {
      throw new DomainError('MODEL_INPUT', 'ระบุคำขอ หลักฐานที่ตรวจแล้ว และยืนยันข้อมูลที่จะส่ง');
    }
    const source = request.state.sources.find((item) => (
      item.id === parsed.data.sourceId
      && item.status === 'verified'
      && (item.kind === 'rate-card' || item.kind === 'excerpt')
    ));
    if (!source) throw new DomainError('SOURCE_REQUIRED', 'ต้องเลือก rate card หรือ excerpt ที่ตรวจยืนยันแล้ว');

    const job: ModelJob = {
      id: randomUUID(),
      workspaceId: request.workspaceId,
      epoch: request.epoch,
      actorId: request.actorId,
      createdAt: (this.options.now ?? Date.now)(),
      status: 'queued',
      revokedAt: null,
      data: {
        input: {
          prompt: parsed.data.prompt,
          sourceId: source.id,
          excerpt: source.excerpt.slice(0, 4000),
          rules: structuredClone(request.state.rules),
        },
        sessionTokenHash: request.sessionTokenHash,
        expectedRevision: request.expectedRevision,
        commandId: request.commandId,
        reservedMicroUsd: this.options.reservationMicroUsd!,
        provider: this.options.provider!.name,
        model: this.options.provider!.model,
      },
    };
    const reserved = await this.store.reserve(job, this.options.dailyBudgetMicroUsd!);
    void this.drain();
    return this.publicJob(reserved);
  }

  publicJob(job: ModelJob) {
    if (isRevoked(job)) throw new DomainError('MODEL_JOB_NOT_FOUND', 'ไม่พบข้อเสนอ AI ในสิทธิ์ของคุณ');
    return {
      id: job.id,
      status: job.status,
      createdAt: job.createdAt,
      errorCode: job.data.errorCode,
      candidateId: job.data.candidateId,
      provider: job.data.provider,
      model: job.data.model,
    };
  }

  async status(id: string, actorId: string, workspaceId: string, epoch: number) {
    const job = await this.store.get(id);
    if (!job || job.revokedAt != null || job.status === 'revoked'
      || job.actorId !== actorId || job.workspaceId !== workspaceId || job.epoch !== epoch) {
      throw new DomainError('MODEL_JOB_NOT_FOUND', 'ไม่พบข้อเสนอ AI ในสิทธิ์ของคุณ');
    }
    return this.publicJob(job);
  }

  async cancel(id: string, actorId: string, workspaceId: string, epoch: number) {
    const existing = await this.store.get(id);
    if (!existing || existing.revokedAt != null || existing.status === 'revoked'
      || existing.actorId !== actorId || existing.workspaceId !== workspaceId || existing.epoch !== epoch) {
      throw new DomainError('MODEL_JOB_NOT_FOUND', 'ไม่พบข้อเสนอ AI ในสิทธิ์ของคุณ');
    }
    if (existing.status === 'completed' || existing.status === 'failed') {
      return this.publicJob(existing);
    }
    const job = await this.store.cancel(id);
    if (!job || job.revokedAt != null || job.status === 'revoked'
      || job.actorId !== actorId || job.workspaceId !== workspaceId || job.epoch !== epoch) {
      throw new DomainError('MODEL_JOB_NOT_FOUND', 'ไม่พบข้อเสนอ AI ในสิทธิ์ของคุณ');
    }
    if (job.status === 'cancelled') this.active.get(id)?.abort(new DomainError('MODEL_CANCELLED', 'Model request cancelled'));
    return this.publicJob(job);
  }

  async recover(): Promise<void> {
    for (const job of await this.store.pending()) {
      if (job.status === 'running') {
        job.status = 'failed';
        job.data.errorCode = 'MODEL_INTERRUPTED';
        await this.store.save(job);
      }
    }
    void this.drain();
  }

  private async drain(): Promise<void> {
    if (this.closed) return;
    if (this.running) {
      this.rerunRequested = true;
      return;
    }
    if (!this.enabled) return;

    this.running = true;
    try {
      do {
        this.rerunRequested = false;
        const snapshot = await this.store.pending();
        for (const queued of snapshot) {
          if (this.closed) break;
          if (queued.status !== 'queued') continue;
          const run = this.run(queued);
          this.activeRuns.set(queued.id, run);
          try {
            await run;
          } finally {
            this.activeRuns.delete(queued.id);
          }
        }
        if (this.closed) break;
        if (this.rerunRequested) continue;
        const remaining = await this.store.pending();
        if (remaining.some((job) => job.status === 'queued') || this.rerunRequested) continue;
        break;
      } while (!this.closed);
    } finally {
      this.running = false;
      this.rerunRequested = false;
    }
  }

  private async raceAbort<T>(signal: AbortSignal, operation: () => Promise<T>): Promise<T> {
    if (signal.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new DomainError('MODEL_ABORTED', 'Model request aborted');
    }
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(signal.reason instanceof Error
        ? signal.reason
        : new DomainError('MODEL_ABORTED', 'Model request aborted'));
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    });
    const work = Promise.resolve().then(operation);
    try {
      return await Promise.race([work, aborted]);
    } finally {
      if (onAbort) signal.removeEventListener('abort', onAbort);
    }
  }

  private async run(queued: ModelJob): Promise<void> {
    const controller = new AbortController();
    this.active.set(queued.id, controller);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let job = queued;
    try {
      const claimed = await this.store.claim(queued.id);
      if (!claimed) return;
      job = claimed;
      if (controller.signal.aborted) throw controller.signal.reason;

      const timeoutMs = Math.max(1, Math.min(this.options.timeoutMs ?? 60_000, 60_000));
      timer = setTimeout(() => {
        controller.abort(new DomainError('MODEL_TIMEOUT', 'Model timeout'));
      }, timeoutMs);
      let output: unknown;
      try {
        output = await this.raceAbort(controller.signal, () => this.options.provider!.propose(job.data.input, controller.signal));
      } finally {
        if (timer) clearTimeout(timer);
        timer = undefined;
      }

      const change = invoiceChangeSchema.safeParse(output);
      if (!change.success || change.data.operations.some((operation) => (
        'sourceId' in operation && operation.sourceId !== job.data.input.sourceId
      ))) {
        throw new DomainError('MODEL_OUTPUT_REJECTED', 'Model returned an unsupported changeset');
      }

      const current = await this.store.get(job.id);
      if (!current || current.revokedAt != null || current.status !== 'running' || current.epoch !== job.epoch) return;
      if (controller.signal.aborted || this.closed) throw controller.signal.reason;
      const result = await this.raceAbort(
        controller.signal,
        () => this.dispatch(current, change.data, controller.signal),
      );
      const latest = await this.store.get(job.id);
      if (!latest || latest.revokedAt != null || latest.status !== 'running' || latest.epoch !== job.epoch) return;
      if (controller.signal.aborted || this.closed) throw controller.signal.reason;
      latest.status = 'completed';
      latest.data.candidateId = result.candidateId;
      await this.store.save(latest);
    } catch (error) {
      const current = await this.store.get(job.id);
      if (current && current.revokedAt == null && current.status === 'running') {
        current.status = 'failed';
        current.data.errorCode = error instanceof DomainError ? error.code : 'MODEL_PROVIDER_FAILURE';
        await this.store.save(current);
      }
    } finally {
      if (timer) clearTimeout(timer);
      this.active.delete(queued.id);
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const controller of this.active.values()) {
      controller.abort(new DomainError('MODEL_CLOSED', 'Model gateway closed'));
    }
    await Promise.all([...this.activeRuns.values()]);
  }
}
