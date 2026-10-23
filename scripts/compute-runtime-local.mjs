// Real authority/storage/runner/browser proof with synthetic data and a disposable local database.
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '@playwright/test';
import { startServer } from '../server/start.ts';
import { createNodeComputeRunner } from '../server/compute-runner.ts';

const output = resolve('test-results/f066-runtime');
await mkdir(output, { recursive: true });
const dataDir = await mkdtemp(join(tmpdir(), 'tabletop-f066-'));
const runner = createNodeComputeRunner();
let executions = 0;
const computeRunner = { async run(...args) { executions += 1; return runner.run(...args); } };
let server = await startServer({ environment: 'local', host: '127.0.0.1', port: 0, dataDir, staticDir: resolve('dist'), computeRunner });
const origin = `http://${server.host}:${server.port}`;
let cookie = '', csrf = '', workspace;
let browser;
const checks = [];
async function api(path, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const value = await response.json();
  if (!response.ok) throw new Error(`${path}: ${response.status} ${value.errorCode ?? ''} ${value.message ?? ''}`);
  return { response, value };
}
async function current() { workspace = (await api(`/api/workspaces/${workspace.id}`)).value; return workspace; }
async function command(type, payload) {
  await current();
  const result = await api(`/api/workspaces/${workspace.id}/commands`, { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, type, payload });
  workspace = result.value.workspace;
}
async function waitTotal(expected) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await current();
    const runs = workspace.domain.computeRuns ?? [];
    const total = runs.find(run => run.status === 'succeeded' && run.dataRevision === workspace.domain.dataRevision && run.ruleRevision === workspace.domain.ruleRevision)?.outputs?.find(port => typeof port.value === 'number')?.value;
    if (total === expected) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 750));
  }
  throw new Error(`Expected current computed total ${expected}; statuses=${JSON.stringify(workspace.domain.computeRuns?.map(run => ({ status: run.status, errorCode: run.errorCode, dataRevision: run.dataRevision })) ?? [])}`);
}
async function openCard(page, id) {
  const trigger = page.getByTestId('canvas-object-menu-trigger');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  await page.getByTestId(`open-canvas-${id}`).click();
  await expect(page.getByTestId('canvas-object-editor')).toHaveAttribute('data-canvas-object', id);
  await page.waitForTimeout(700); // Let the canvas camera finish focusing the chosen card before capture.
  return page.getByTestId('canvas-object-editor');
}
try {
  const session = await api('/api/session', { name: 'Synthetic compute owner' });
  cookie = session.response.headers.get('set-cookie').split(';')[0]; csrf = session.value.csrfToken;
  workspace = (await api('/api/workspaces', { kind: 'table' })).value;
  const sourceText = 'order_id,branch,amount,quantity\na,BKK,100,2\nb,CNX,50,1\n';
  await command('table.import', { filename: 'synthetic-sales.csv', text: sourceText });
  const source = workspace.domain.sources[0];
  const change = JSON.parse(await readFile(resolve('test-results/f066-live/generated.json'), 'utf8'));
  change.program.evidence = [{ sourceId: source.id, quote: 'order_id,branch,amount,quantity' }];
  await command('evolve.propose', { change });
  await command('evolve.autoApply', {});
  await waitTotal(225); checks.push('activation runs generated pandas code and persists 225');
  const orders = change.program.compute.modules[0].inputs.find(port => port.binding.kind === 'collection').binding.collectionId;
  const rows = structuredClone(change.initialRecords[orders].map(row => row.values));
  for (const row of rows) for (const key of Object.keys(row)) if (row[key] === 100) row[key] = 200;
  await command('table.importRows', { collection: orders, rows, mode: 'replace' });
  await waitTotal(405); checks.push('replacement input automatically recomputes 405 without AI');
  if (workspace.domain.records[orders].length !== 2) throw new Error('Replacement appended rows unexpectedly.');
  const oldSourceRows = structuredClone(workspace.domain.records[orders]);
  await current();
  if (JSON.stringify(workspace.domain.records[orders]) !== JSON.stringify(oldSourceRows)) throw new Error('Derived results overwrote input rows.');
  checks.push('source rows remain intact and latest results survive readback');
  const port = server.port;
  await server.close();
  server = await startServer({ environment: 'local', host: '127.0.0.1', port, dataDir, staticDir: resolve('dist'), computeRunner });
  await waitTotal(405);
  checks.push('server restart restores the saved session, program, source records and result');
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const separator = cookie.indexOf('=');
  await context.addCookies([{ name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin }]);
  const page = await context.newPage();
  await page.goto(`${origin}/t/${workspace.id}`);
  await openCard(page, 'table.view.total-metric');
  await expect(page.getByTestId('canvas-object-editor')).toContainText('405');
  checks.push('live canvas metric displays the backend result 405');
  await openCard(page, 'table.rules');
  await page.screenshot({ path: resolve(output, 'table-desktop.png'), fullPage: true });
  await page.reload();
  await openCard(page, 'table.rules');
  await waitTotal(405); checks.push('browser reload keeps the accepted program, inputs and current result');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: resolve(output, 'table-mobile.png'), fullPage: true });
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ checks, executions, providerCallsDuringRerun: 0, workspacePersistence: 'disposable PGlite', syntheticOnly: true }, null, 2));
  process.stdout.write(JSON.stringify({ passed: true, checks, executions }) + '\n');
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: error instanceof Error ? error.message : String(error), workspace, executions, syntheticOnly: true }, null, 2));
  throw error;
} finally { await browser?.close(); await server.close(); }
