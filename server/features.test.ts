import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTabletopServer } from './bootstrap';
import type { CommandAck, WorkspaceView } from '../src/tabletop/shared/contracts';
import { planForWorkspace } from '../src/tabletop/runtime';
let server: Awaited<ReturnType<typeof startTabletopServer>>, directory: string, base: string;
let cookie = '', csrf = '', view: WorkspaceView;
let taskNow = Date.now();
async function request(path: string, body?: unknown, credentials = true) {
  const response = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin: base, ...(credentials ? { cookie, 'x-csrf-token': csrf } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { response, data: await response.json() };
}
async function command(type: string, payload: unknown) {
  const result = await request(`/api/workspaces/${view.id}/commands`, { commandId: randomUUID(), expectedRevision: view.revision, expectedEpoch: view.epoch, type, payload });
  expect(result.response.status, JSON.stringify(result.data)).toBe(200);
  view = (result.data as CommandAck).workspace;
}
async function upload(filename: string, kind: string, mime: string) {
  const body = { filename, mime, kind, dataBase64: (await readFile(join('public/samples/r1', filename))).toString('base64'), commandId: randomUUID(), expectedRevision: view.revision, expectedEpoch: view.epoch };
  const result = await request(`/api/workspaces/${view.id}/uploads`, body);
  expect(result.response.status, JSON.stringify(result.data)).toBe(200);
  view = result.data.workspace;
  return { body, result };
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'tabletop-feature-test-'));
  server = await startTabletopServer({ environment: 'local', dataDir: directory, port: 0, now: () => taskNow });
  base = `http://127.0.0.1:${server.port}`;
  const session = await request('/api/session', {});
  cookie = session.response.headers.get('set-cookie')!.split(';')[0]; csrf = session.data.csrfToken;
  const room = await request('/api/workspaces', { kind: 'invoice' });
  expect(room.response.status).toBe(201); view = room.data;
});
afterAll(async () => {
  await server?.close();
  const absolute = resolve(directory);
  if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes('tabletop-feature-test-')) throw new Error('Unsafe cleanup path');
  await rm(absolute, { recursive: true, force: true });
});

describe('real local source-to-approved-result HTTP path', () => {
  it('imports original CSV and text PDF, deduplicates a lost Ack and keeps sources provided', async () => {
    const { body } = await upload('shipments.csv', 'shipments', 'text/csv');
    const duplicate = await request(`/api/workspaces/${view.id}/uploads`, body);
    expect(duplicate.data.duplicate).toBe(true);
    expect(await readdir(join(directory, 'objects'))).toHaveLength(1);
    const mismatch = await request(`/api/workspaces/${view.id}/uploads`, { ...body, filename: 'different.csv' });
    expect(mismatch.response.status).toBe(409);
    await upload('invoice.pdf', 'invoice', 'application/pdf');
    if (view.domain.kind !== 'invoice') throw Error('Wrong kind');
    expect(view.domain.shipments.map(s => s.id)).toEqual(['ALT-BKK-20', 'ALT-REG-20', 'ALT-BOUNDARY']);
    expect(view.domain.sources.slice(-2).every(s => s.status === 'provided')).toBe(true);
    expect(planForWorkspace(view).outputs['invoice.table'].result).toMatchObject({ unknownCount: 3 });
  });
  it('requires review and explicit approval before dated surcharge composition becomes active', async () => {
    if (view.domain.kind !== 'invoice') throw Error('Wrong kind');
    const dataSources = view.domain.sources.slice(-2).map(s => s.id);
    for (const sourceId of dataSources) await command('invoice.reviewSource', { sourceId, status: 'verified' });
    await upload('rate-card.pdf', 'rate-card', 'application/pdf');
    if (view.domain.kind !== 'invoice') throw Error('Wrong kind');
    const sourceId = view.domain.sources.at(-1)!.id;
    await command('invoice.reviewSource', { sourceId, status: 'verified' });
    const change = { kind: 'invoice', operations: [{ op: 'setSurcharge', id: 'remote-750', zone: '*', amountSatang: 750, from: '2026-10-20', to: null, sourceId }] };
    await command('evolve.propose', { change });
    await command('evolve.simulate', {});
    await command('evolve.validate', {});
    const early = await request(`/api/workspaces/${view.id}/commands`, { commandId: randomUUID(), expectedRevision: view.revision, expectedEpoch: view.epoch, type: 'evolve.activate', payload: {} });
    expect(early.response.ok).toBe(false);
    expect(view.domain.ruleRevision).toBe(0);
    await command('evolve.approve', {});
    expect(planForWorkspace(view).nodes.some(n => n.id === 'invoice.merge')).toBe(false);
    await command('evolve.activate', {});
    const plan = planForWorkspace(view);
    expect(plan.nodes.some(n => n.id === 'invoice.merge')).toBe(true);
    expect(plan.outputs['invoice.table'].result).toMatchObject({ unknownCount: 0, knownExpectedSatang: 15_500, deltaSatang: 0 });
    await command('invoice.saveRun', {});
  });
  it('scopes file download and export to the owner and rejects forged direct imports', async () => {
    if (view.domain.kind !== 'invoice') throw Error('Wrong kind');
    const source = view.domain.sources.find(s => s.filename === 'invoice.pdf')!;
    const raw = await fetch(`${base}/api/workspaces/${view.id}/sources/${source.id}`, { headers: { cookie } });
    expect(raw.status).toBe(200); expect(raw.headers.get('content-disposition')).toContain('attachment');
    expect(Buffer.from(await raw.arrayBuffer()).subarray(0,5).toString()).toBe('%PDF-');
    const denied = await fetch(`${base}/api/workspaces/${view.id}/sources/${source.id}`);
    expect(denied.status).toBe(401);
    const exportResult = await fetch(`${base}/api/workspaces/${view.id}/export?format=csv`, { headers: { cookie } });
    expect(exportResult.status).toBe(200); expect(await exportResult.text()).toContain('5250');
    const forged = await request(`/api/workspaces/${view.id}/commands`, { commandId: randomUUID(), expectedRevision: view.revision, expectedEpoch: view.epoch, type: 'invoice.import', payload: { artifact: source } });
    expect(forged.response.status).toBe(400);
    const foreign = await request('/api/session', {}, false);
    const foreignCookie = foreign.response.headers.get('set-cookie')!.split(';')[0];
    const foreignExport = await fetch(`${base}/api/workspaces/${view.id}/export?format=html`, { headers: { cookie: foreignCookie } });
    expect(foreignExport.status).toBe(403);
  });
  it('rejects malformed files atomically and clearly reports the deferred live model', async () => {
    const before = view.revision;
    const invalid = await request(`/api/workspaces/${view.id}/uploads`, { filename: 'spoof.pdf', mime: 'application/pdf', kind: 'invoice', dataBase64: Buffer.from('not a PDF').toString('base64'), commandId: randomUUID(), expectedRevision: before, expectedEpoch: view.epoch });
    expect(invalid.data.errorCode).toBe('PDF_MAGIC');
    const fresh = await request(`/api/workspaces/${view.id}`);
    expect(fresh.data.revision).toBe(before);
    const model = await request(`/api/workspaces/${view.id}/model`, {});
    expect(model.response.status).toBe(503); expect(model.data.errorCode).toBe('MODEL_NOT_CONFIGURED');
  });
  it('recovers accepted rules, sources, runs and opaque revision after process-level database reopen', async () => {
    const expected = structuredClone(view);
    await server.close();
    server = await startTabletopServer({ environment: 'local', dataDir: directory, port: 0, now: () => taskNow });
    base = `http://127.0.0.1:${server.port}`;
    const fresh = await request(`/api/workspaces/${view.id}`);
    expect(fresh.response.status).toBe(200);
    expect(fresh.data).toEqual(expected);
  });
  it('purges expired local workspace content and physically removes queued artifacts', async () => {
    taskNow = view.expiresAt + 1;
    const denied = await request(`/api/workspaces/${view.id}`);
    expect(denied.response.ok).toBe(false);
    await server.sweepArtifacts();
    expect(await readdir(join(directory, 'objects'))).toEqual([]);
    expect(await server.repository.listPendingArtifactCleanup()).toEqual([]);
    const stored = await server.database.query('SELECT domain_state FROM workspaces WHERE id=$1', [view.id]);
    expect(JSON.stringify(stored.rows)).not.toContain('ALT-BKK-20');
  });
});
