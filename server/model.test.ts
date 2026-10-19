import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPGliteDatabase } from './database.js';
import { ModelGateway, SqlModelJobStore, type ModelJob, type ModelJobStore } from './model.js';
import { createDomain } from '../src/tabletop/domain';
import { DomainError, type InvoiceState } from '../src/tabletop/shared/contracts.js';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request(commandId = 'command') {
  const state = createDomain('invoice', {
    actorId: 'owner',
    name: 'Owner',
    role: 'owner',
    workspaceId: 'workspace',
    epoch: 1,
    now: 1,
    hash: (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  }) as InvoiceState;
  return {
    workspaceId: 'workspace',
    epoch: 1,
    actorId: 'owner',
    sessionTokenHash: 'hash-only',
    expectedRevision: 'opaque',
    commandId,
    state,
  };
}

function inputFor(r = request()) {
  const source = r.state.sources.find((item) => item.status === 'verified' && item.kind === 'rate-card')!;
  return {
    prompt: 'Add the reviewed surcharge',
    sourceId: source.id,
    consent: true as const,
  };
}

function proposalFor(sourceId: string) {
  return {
    kind: 'invoice',
    operations: [{
      op: 'setSurcharge',
      id: 'test-surcharge',
      zone: '*',
      amountSatang: 750,
      from: '2026-10-20',
      to: null,
      sourceId,
    }],
  };
}

function makeJob(commandId = 'command', prompt = 'same prompt'): ModelJob {
  const r = request(commandId);
  const source = r.state.sources.find((item) => item.status === 'verified' && item.kind === 'rate-card')!;
  return {
    id: `job-${commandId}-${prompt}`,
    workspaceId: r.workspaceId,
    epoch: r.epoch,
    actorId: r.actorId,
    createdAt: 1,
    status: 'queued',
    revokedAt: null,
    data: {
      input: { prompt, sourceId: source.id, excerpt: source.excerpt, rules: structuredClone(r.state.rules) },
      sessionTokenHash: r.sessionTokenHash,
      expectedRevision: r.expectedRevision,
      commandId,
      reservedMicroUsd: 10,
      provider: 'test-only',
      model: 'test-only',
    },
  };
}

function requestPayload(job: ModelJob): string {
  return JSON.stringify({
    input: job.data.input,
    expectedRevision: job.data.expectedRevision,
  });
}

class Store implements ModelJobStore {
  jobs = new Map<string, ModelJob>();

  async reserve(job: ModelJob, cap: number): Promise<ModelJob> {
    const existing = [...this.jobs.values()].find((item) => (
      item.workspaceId === job.workspaceId
      && item.actorId === job.actorId
      && item.epoch === job.epoch
      && item.data.commandId === job.data.commandId
    ));
    if (existing) {
      if (requestPayload(existing) !== requestPayload(job)) {
        throw new DomainError('MODEL_COMMAND_CONFLICT', 'command payload changed');
      }
      return structuredClone(existing);
    }
    const all = [...this.jobs.values()];
    if (all.filter((item) => item.workspaceId === job.workspaceId && item.createdAt >= 0).length >= 5) {
      throw new DomainError('MODEL_ROOM_QUOTA', 'quota');
    }
    if (all.reduce((sum, item) => sum + item.data.reservedMicroUsd, 0) + job.data.reservedMicroUsd > cap) {
      throw new DomainError('MODEL_BUDGET', 'budget');
    }
    this.jobs.set(job.id, structuredClone(job));
    return structuredClone(job);
  }

  async claim(id: string): Promise<ModelJob | null> {
    const job = this.jobs.get(id);
    if (!job || job.status !== 'queued' || job.revokedAt != null) return null;
    job.status = 'running';
    return structuredClone(job);
  }

  async get(id: string): Promise<ModelJob | null> {
    return structuredClone(this.jobs.get(id) ?? null);
  }

  async save(job: ModelJob): Promise<void> {
    const current = this.jobs.get(job.id);
    if (!current || current.revokedAt != null || !['queued', 'running'].includes(current.status)) return;
    this.jobs.set(job.id, structuredClone(job));
  }

  async cancel(id: string): Promise<ModelJob | null> {
    const job = this.jobs.get(id);
    if (!job) return null;
    if (job.revokedAt == null && ['queued', 'running'].includes(job.status)) job.status = 'cancelled';
    return structuredClone(job);
  }

  async pending(): Promise<ModelJob[]> {
    return [...this.jobs.values()]
      .filter((job) => ['queued', 'running'].includes(job.status) && job.revokedAt == null)
      .map((job) => structuredClone(job));
  }

  revoke(id: string): void {
    const job = this.jobs.get(id);
    if (!job) return;
    job.status = 'revoked';
    job.revokedAt = 123;
  }
}

async function waitFor(predicate: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
}

describe('bounded model gateway (injected test providers only)', () => {
  it('fails closed without an approved provider and budget', async () => {
    const gateway = new ModelGateway(new Store(), async () => ({ candidateId: 'never' }), {});
    await expect(gateway.enqueue(request(), {})).rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  });

  it('a provider can propose a typed draft but cannot approve or activate', async () => {
    const store = new Store();
    const r = request();
    const source = r.state.sources.find((item) => item.status === 'verified' && item.kind === 'rate-card')!;
    const dispatched: unknown[] = [];
    const gateway = new ModelGateway(store, async (_, change) => {
      dispatched.push(change);
      return { candidateId: 'draft' };
    }, {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async () => ({
          kind: 'invoice',
          operations: [{ op: 'setSurcharge', id: 'new', zone: '*', amountSatang: 750, from: '2026-10-20', to: null, sourceId: source.id }],
        }),
      },
      dailyBudgetMicroUsd: 100,
      reservationMicroUsd: 10,
    });
    const job = await gateway.enqueue(r, inputFor(r));
    await waitFor(asyncStatus(store, job.id, 'completed'), 'typed proposal did not finish');
    expect(dispatched).toHaveLength(1);
    expect(r.state.ruleRevision).toBe(0);
    await expect(gateway.status(job.id, 'other', 'workspace', 1)).rejects.toMatchObject({ code: 'MODEL_JOB_NOT_FOUND' });
    await gateway.close();
  });

  it('rejects executable output and retains the reservation against later billing', async () => {
    const store = new Store();
    const r = request();
    let dispatches = 0;
    const gateway = new ModelGateway(store, async () => {
      dispatches++;
      return { candidateId: 'bad' };
    }, {
      provider: { name: 'test-only', model: 'test-only', propose: async () => ({ kind: 'invoice', operations: [], javascript: 'fetch("secret")' }) },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
    });
    const job = await gateway.enqueue(r, inputFor(r));
    await waitFor(asyncStatus(store, job.id, 'failed'), 'invalid model output did not fail');
    expect((await store.get(job.id))?.data.errorCode).toBe('MODEL_OUTPUT_REJECTED');
    expect(dispatches).toBe(0);
    await expect(gateway.enqueue(request('another-command'), { ...inputFor(r), prompt: 'Another request' }))
      .rejects.toMatchObject({ code: 'MODEL_BUDGET' });
    await gateway.close();
  });

  it('deduplicates SQL reservations under the transaction lock and rejects changed payloads', async () => {
    const database = createPGliteDatabase();
    try {
      await database.query('CREATE TABLE authority_meta (singleton BOOLEAN PRIMARY KEY)');
      await database.query('INSERT INTO authority_meta(singleton) VALUES(TRUE)');
      await database.query('CREATE TABLE model_jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT)');
      const store = new SqlModelJobStore(database);
      const first = makeJob('sql-command');
      const retry = { ...structuredClone(first), id: 'retry-id', createdAt: 2 };
      const [reservedFirst, reservedRetry] = await Promise.all([
        store.reserve(first, 10),
        store.reserve(retry, 10),
      ]);
      expect(reservedFirst.id).toBe(reservedRetry.id);
      expect((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM model_jobs')).rows[0].count).toBe('1');
      await expect(store.reserve({ ...makeJob('sql-command', 'changed prompt'), id: 'conflicting-id' }, 10))
        .rejects.toMatchObject({ code: 'MODEL_COMMAND_CONFLICT' });
      expect((await database.query<{ count: string }>('SELECT count(*)::text AS count FROM model_jobs')).rows[0].count).toBe('1');
      await database.query("UPDATE model_jobs SET status = 'revoked', revoked_at = 123 WHERE id = $1", [reservedFirst.id]);
      expect(await store.claim(reservedFirst.id)).toBeNull();
    } finally {
      await database.close();
    }
  });

  it('returns the existing command reservation and charges/proposes only once', async () => {
    const store = new Store();
    const r = request();
    const started = deferred();
    const release = deferred();
    let providerCalls = 0;
    const gateway = new ModelGateway(store, async () => ({ candidateId: 'single-draft' }), {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async () => {
          providerCalls++;
          started.resolve();
          await release.promise;
          return proposalFor(inputFor(r).sourceId);
        },
      },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
    });
    const first = await gateway.enqueue(r, inputFor(r));
    await started.promise;
    const retry = await gateway.enqueue(r, inputFor(r));
    expect(retry.id).toBe(first.id);
    expect(store.jobs.size).toBe(1);
    await expect(gateway.enqueue(r, { ...inputFor(r), prompt: 'Different payload' }))
      .rejects.toMatchObject({ code: 'MODEL_COMMAND_CONFLICT' });
    release.resolve();
    await waitFor(asyncStatus(store, first.id, 'completed'), 'duplicate command did not complete');
    expect(providerCalls).toBe(1);
    await gateway.close();
  });

  it('keeps jobs enqueued during a drain from being stranded', async () => {
    const store = new Store();
    const firstStarted = deferred();
    const finishFirst = deferred();
    const seenPrompts: string[] = [];
    const gateway = new ModelGateway(store, async () => ({ candidateId: 'draft' }), {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async (input) => {
          seenPrompts.push(input.prompt);
          if (input.prompt === 'First queued request') {
            firstStarted.resolve();
            await finishFirst.promise;
          }
          return proposalFor(input.sourceId);
        },
      },
      dailyBudgetMicroUsd: 100,
      reservationMicroUsd: 10,
    });
    const firstInput = { ...inputFor(request('first')), prompt: 'First queued request' };
    const first = await gateway.enqueue(request('first'), firstInput);
    await firstStarted.promise;
    const secondInput = { ...inputFor(request('second')), prompt: 'Second queued request' };
    const second = await gateway.enqueue(request('second'), secondInput);
    expect((await store.get(second.id))?.status).toBe('queued');
    finishFirst.resolve();
    await waitFor(asyncStatus(store, second.id, 'completed'), 'job queued during drain was stranded');
    await waitFor(asyncStatus(store, first.id, 'completed'), 'first job did not complete');
    expect(seenPrompts).toEqual(['First queued request', 'Second queued request']);
    await gateway.close();
  });

  it('cancels a running request promptly even when the provider ignores AbortSignal', async () => {
    const store = new Store();
    const started = deferred();
    const ignoreAbort = deferred<unknown>();
    let dispatches = 0;
    const gateway = new ModelGateway(store, async () => {
      dispatches++;
      return { candidateId: 'must-not-dispatch' };
    }, {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async () => {
          started.resolve();
          return ignoreAbort.promise;
        },
      },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
    });
    const job = await gateway.enqueue(request(), inputFor());
    await started.promise;
    await expect(gateway.cancel(job.id, 'owner', 'workspace', 1)).resolves.toMatchObject({ status: 'cancelled' });
    expect((await store.get(job.id))?.status).toBe('cancelled');
    expect(dispatches).toBe(0);
    ignoreAbort.resolve({ kind: 'invoice', operations: [] });
    await gateway.close();
  });

  it('times out a provider that never settles, without waiting for its abort cooperation', async () => {
    const store = new Store();
    const started = deferred();
    const ignoreAbort = deferred<unknown>();
    const gateway = new ModelGateway(store, async () => ({ candidateId: 'never' }), {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async () => {
          started.resolve();
          return ignoreAbort.promise;
        },
      },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
      timeoutMs: 25,
    });
    const job = await gateway.enqueue(request(), inputFor());
    await started.promise;
    await waitFor(asyncStatus(store, job.id, 'failed'), 'provider timeout did not settle the job');
    expect((await store.get(job.id))?.data.errorCode).toBe('MODEL_TIMEOUT');
    ignoreAbort.resolve({ kind: 'invoice', operations: [] });
    await gateway.close();
  });

  it('closes promptly and settles a hung provider as failed', async () => {
    const store = new Store();
    const started = deferred();
    const ignoreAbort = deferred<unknown>();
    const gateway = new ModelGateway(store, async () => ({ candidateId: 'never' }), {
      provider: {
        name: 'test-only',
        model: 'test-only',
        propose: async () => {
          started.resolve();
          return ignoreAbort.promise;
        },
      },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
    });
    const job = await gateway.enqueue(request(), inputFor());
    await started.promise;
    await expect(gateway.close()).resolves.toBeUndefined();
    expect((await store.get(job.id))?.status).toBe('failed');
    expect((await store.get(job.id))?.data.errorCode).toBe('MODEL_CLOSED');
    ignoreAbort.resolve({ kind: 'invoice', operations: [] });
  });

  it('does not dispatch a queued snapshot after workspace reset revokes the job', async () => {
    const store = new Store();
    const pendingStarted = deferred();
    const unblockPending = deferred();
    class DelayedSnapshotStore extends Store {
      private first = true;
      override async pending(): Promise<ModelJob[]> {
        const snapshot = await super.pending();
        if (this.first) {
          this.first = false;
          pendingStarted.resolve();
          await unblockPending.promise;
        }
        return snapshot;
      }
    }
    const delayedStore = new DelayedSnapshotStore();
    let providerCalls = 0;
    const gateway = new ModelGateway(delayedStore, async () => ({ candidateId: 'forbidden' }), {
      provider: { name: 'test-only', model: 'test-only', propose: async () => {
        providerCalls++;
        return { kind: 'invoice', operations: [] };
      } },
      dailyBudgetMicroUsd: 10,
      reservationMicroUsd: 10,
    });
    const job = await gateway.enqueue(request(), inputFor());
    await pendingStarted.promise;
    delayedStore.revoke(job.id);
    unblockPending.resolve();
    await gateway.close();
    expect((await delayedStore.get(job.id))?.status).toBe('revoked');
    expect(providerCalls).toBe(0);
  });

  it('treats a reset SQL row as a private tombstone when a running provider fails', async () => {
    const database = createPGliteDatabase();
    const started = deferred();
    const failAfterReset = deferred<unknown>();
    const unhandled: unknown[] = [];
    const captureUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', captureUnhandled);
    try {
      await database.query('CREATE TABLE authority_meta (singleton BOOLEAN PRIMARY KEY)');
      await database.query('INSERT INTO authority_meta(singleton) VALUES(TRUE)');
      await database.query('CREATE TABLE model_jobs (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, epoch INTEGER NOT NULL, actor_id TEXT NOT NULL, status TEXT NOT NULL, data JSONB NOT NULL, created_at BIGINT NOT NULL, revoked_at BIGINT)');
      const store = new SqlModelJobStore(database);
      let dispatches = 0;
      const gateway = new ModelGateway(store, async () => {
        dispatches++;
        return { candidateId: 'must-not-dispatch' };
      }, {
        provider: {
          name: 'test-only',
          model: 'test-only',
          propose: async () => {
            started.resolve();
            return failAfterReset.promise;
          },
        },
        dailyBudgetMicroUsd: 10,
        reservationMicroUsd: 10,
        now: () => 1,
      });

      const job = await gateway.enqueue(request(), inputFor());
      await started.promise;
      await database.query(
        "UPDATE model_jobs SET revoked_at = 123, status = 'revoked', data = '{}'::jsonb WHERE id = $1",
        [job.id],
      );

      const tombstone = await store.get(job.id);
      expect(tombstone).toMatchObject({ status: 'revoked', revokedAt: 123 });
      expect(tombstone?.data).toMatchObject({
        input: { prompt: '', sourceId: '', excerpt: '', rules: [] },
        sessionTokenHash: '',
        commandId: '',
        provider: '',
        model: '',
      });
      expect(await store.pending()).toEqual([]);
      await expect(gateway.status(job.id, 'owner', 'workspace', 1))
        .rejects.toMatchObject({ code: 'MODEL_JOB_NOT_FOUND' });

      failAfterReset.reject(new Error('provider failed after reset'));
      await expect(gateway.close()).resolves.toBeUndefined();
      await new Promise((resolve) => setImmediate(resolve));
      expect(dispatches).toBe(0);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', captureUnhandled);
      await database.close();
    }
  });
});

function asyncStatus(store: Store, id: string, status: ModelJob['status']): () => boolean {
  return () => store.jobs.get(id)?.status === status;
}
