import { env } from 'cloudflare:workers';
import { runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { priceMicroUsd, usageMicroUsd, type BillingRequestBinding, type BillingUsage } from './billing.js';
import type { Env } from './contracts.js';

const testEnv = env as Env;

function binding(key: string): BillingRequestBinding {
  const id = key.padStart(64, '0').slice(-64);
  return {
    id,
    actorId: 'actor-owner',
    workspaceId: 'workspace-invoice',
    epoch: 1,
    inputHash: id.replace(/.$/u, 'a'),
  };
}

function stubFor(name: string) {
  return testEnv.BILLING.get(testEnv.BILLING.idFromName(`test-${name}-${crypto.randomUUID()}`));
}

async function call(stub: DurableObjectStub, path: string, body: unknown): Promise<{ response: Response; value: Record<string, unknown> }> {
  const response = await stub.fetch(`https://billing.internal${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value: unknown = await response.json();
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Expected billing JSON object');
  return { response, value: value as Record<string, unknown> };
}

function reserveBody(item: BillingRequestBinding, maxInputTokens = 56_000, maxOutputTokens = 2_048) {
  return { ...item, maxInputTokens, maxOutputTokens };
}

function usage(): BillingUsage {
  return { promptTokens: 100, completionTokens: 20, cacheHitTokens: 60, cacheMissTokens: 40, reasoningTokens: 5 };
}

describe('Cloudflare Billing Durable Object', () => {
  it('prices exact integer micro-USD at peak rates with upward rounding', () => {
    expect(priceMicroUsd(1_000_000, 1_000_000)).toBe(1_500_000);
    expect(priceMicroUsd(1, 0)).toBe(1);
    expect(priceMicroUsd(0, 1)).toBe(2);
    expect(usageMicroUsd(usage())).toBe(37);
    expect(usageMicroUsd({ promptTokens: 1_000_000, completionTokens: 0, cacheHitTokens: 1_000_000, cacheMissTokens: 0 })).toBe(6_000);
    expect(() => usageMicroUsd({ ...usage(), cacheMissTokens: Number.MAX_SAFE_INTEGER })).toThrow();
  });

  it('reserves once per immutable binding, rejects changed hashes, dispatches once, and settles idempotently', async () => {
    const stub = stubFor('idempotency');
    const item = binding('1');
    const body = reserveBody(item);
    const [first, duplicate] = await Promise.all([
      call(stub, '/reserve', body),
      call(stub, '/reserve', body),
    ]);
    expect(first.response.status).toBe(200);
    expect(duplicate.response.status).toBe(200);
    expect([first.value.duplicate, duplicate.value.duplicate].sort()).toEqual([false, true]);
    expect(first.value.reservedMicroUsd).toBe(priceMicroUsd(56_000, 2_048));

    const conflict = await call(stub, '/reserve', { ...body, inputHash: 'f'.repeat(64) });
    expect(conflict.response.status).toBe(409);
    expect(conflict.value.errorCode).toBe('BILLING_CONFLICT');

    const [dispatchA, dispatchB] = await Promise.all([
      call(stub, '/dispatch', item),
      call(stub, '/dispatch', item),
    ]);
    expect([dispatchA.value.claimed, dispatchB.value.claimed].filter(Boolean)).toHaveLength(1);
    expect([dispatchA.value.claimed, dispatchB.value.claimed].filter((value) => value === false)).toHaveLength(1);

    const settlement = { ...item, outcome: 'settled', usage: usage() };
    const settled = await call(stub, '/settle', settlement);
    const repeated = await call(stub, '/settle', settlement);
    expect(settled.value).toMatchObject({ status: 'settled', actualMicroUsd: 37 });
    expect(repeated.value).toMatchObject({ status: 'settled', actualMicroUsd: 37 });
    const conflictingSettlement = await call(stub, '/settle', {
      ...settlement,
      usage: { ...usage(), cacheHitTokens: 61, cacheMissTokens: 39 },
    });
    expect(conflictingSettlement.response.status).toBe(409);

    const status = await call(stub, '/status', item);
    expect(status.value).toMatchObject({ status: 'settled', actualMicroUsd: 37 });
    const columns = await runInDurableObject(stub, (_instance, state) => state.storage.sql
      .exec<{ name: string }>('PRAGMA table_info(billing_jobs)').toArray().map((row) => row.name));
    expect(columns).not.toContain('prompt');
    expect(columns).not.toContain('output');
    expect(columns).not.toContain('api_key');
  });

  it('enforces the global in-flight ceiling across concurrent reservations', async () => {
    const stub = stubFor('concurrency');
    const reservations = await Promise.all(Array.from({ length: 8 }, (_, index) => {
      const item = binding(String(index + 10));
      return call(stub, '/reserve', reserveBody(item, 100, 100));
    }));
    expect(reservations.every((item) => item.response.status === 200)).toBe(true);
    const blocked = await call(stub, '/reserve', reserveBody(binding('99'), 100, 100));
    expect(blocked.response.status).toBe(429);
    expect(blocked.value.errorCode).toBe('BILLING_QUOTA');
  });

  it('turns expired dispatch leases into uncertain charges and frees their concurrency slots', async () => {
    const stub = stubFor('lease');
    const items = Array.from({ length: 8 }, (_, index) => binding(String(index + 100)));
    for (const item of items) {
      await call(stub, '/reserve', reserveBody(item, 56_000, 2_048));
      const dispatched = await call(stub, '/dispatch', item);
      expect(dispatched.value.claimed).toBe(true);
    }
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('UPDATE billing_jobs SET lease_expires_at = 1');
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    const prior = await call(stub, '/status', items[0]);
    expect(prior.value).toMatchObject({ status: 'uncertain', reservedMicroUsd: priceMicroUsd(56_000, 2_048) });

    const next = await call(stub, '/reserve', reserveBody(binding('999'), 100, 100));
    expect(next.response.status).toBe(200);
    expect(next.value.status).toBe('reserved');
  });

  it('rejects usage above the reservation instead of settling an underfunded charge', async () => {
    const stub = stubFor('usage-limit');
    const item = binding('8');
    await call(stub, '/reserve', reserveBody(item, 10, 10));
    await call(stub, '/dispatch', item);
    const oversized = await call(stub, '/settle', {
      ...item,
      outcome: 'settled',
      usage: { promptTokens: 11, completionTokens: 1, cacheHitTokens: 0, cacheMissTokens: 11 },
    });
    expect(oversized.response.status).toBe(400);
    expect(oversized.value.errorCode).toBe('BILLING_USAGE_INVALID');
    const stillReserved = await call(stub, '/status', item);
    expect(stillReserved.value).toMatchObject({ status: 'dispatching', reservedMicroUsd: priceMicroUsd(10, 10) });
  });

  it('fails closed when billing configuration or strict input validation is invalid', async () => {
    const stub = stubFor('validation');
    const invalid = await call(stub, '/reserve', { ...reserveBody(binding('7'), 10, 10), injected: 'ignored' });
    expect(invalid.response.status).toBe(400);
    expect(invalid.value.errorCode).toBe('BILLING_REQUEST_INVALID');
    const unknown = await stub.fetch('https://billing.internal/not-a-route', { method: 'POST', body: '{}' });
    expect(unknown.status).toBe(404);
  });
});
