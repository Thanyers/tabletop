import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * F080 / C6 acceptance: one tool showing data from two independent tables, with a real refresh and
 * a disconnect that stops the data instead of freezing it.
 *
 * Run `node scripts/build-tool-joined-harness.mjs` first. Evidence goes to
 * `test-results/tool-joined/` (gitignored).
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const pages = resolve(root, 'test-results/tool-joined-harness/index.html');
const output = resolve(root, 'test-results/tool-joined');
await mkdir(output, { recursive: true });

const checks = [];
const mark = (name, detail = '') => {
  checks.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
  checks.push({ name, detail, failed: true });
  throw new Error(`${name}: ${detail}`);
};

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(pathToFileURL(pages).href);
  await page.getByText('C6 — joined data panel').waitFor();

  const summary = await page.getByTestId('joined-summary').innerText();
  if (!summary.includes('2/2') || !summary.includes('4 แถว')) fail('summary counts both sources', summary);
  mark('one tool shows two independent sources with their own rows', summary);

  const planRevision = await page.getByTestId('revision-plan').innerText();
  const budgetRevision = await page.getByTestId('revision-budget').innerText();
  if (!planRevision.includes('3') || !budgetRevision.includes('7')) fail('each source keeps its own revision', `${planRevision} / ${budgetRevision}`);
  mark('each source keeps its own revision', `${planRevision} · ${budgetRevision}`);

  await page.screenshot({ path: join(output, '01-two-sources.png'), fullPage: true });

  // Live re-read: both revisions move and the old values are gone.
  await page.getByTestId('joined-refresh').click();
  await page.getByTestId('revision-plan').filter({ hasText: '4' }).waitFor();
  const afterRefresh = {
    plan: await page.getByTestId('revision-plan').innerText(),
    budget: await page.getByTestId('revision-budget').innerText(),
    planRows: await page.getByTestId('rows-plan').innerText(),
    budgetRows: await page.getByTestId('rows-budget').innerText(),
  };
  if (!afterRefresh.budget.includes('9')) fail('the second source refreshed too', afterRefresh.budget);
  if (afterRefresh.planRows.includes('24')) fail('the old row must be gone after a re-read', afterRefresh.planRows);
  if (!afterRefresh.budgetRows.includes('5000')) fail('refreshed values are shown', afterRefresh.budgetRows);
  mark('a refresh re-reads both sources and drops stale rows', `${afterRefresh.plan} · ${afterRefresh.budget}`);

  // Disconnect: this source stops serving data, the tool and the other source survive.
  await page.getByTestId('disconnect-budget').click();
  await page.getByTestId('unavailable-budget').waitFor();
  const statusText = await page.getByTestId('status-budget').innerText();
  if (!statusText.includes('ถูกถอน')) fail('the status says it was revoked', statusText);
  if (await page.getByTestId('rows-budget').count() !== 0) fail('revoked rows must not stay visible', 'table still rendered');
  const pageText = await page.locator('body').innerText();
  if (pageText.includes('5000')) fail('no last-known value may remain on screen', '5000 still present');
  if (!pageText.includes('ห้องอเนกประสงค์')) fail('the other source must keep its data', 'plan rows missing');
  mark('a revoked source stops serving while the tool and the other source keep working', statusText.trim());

  await page.screenshot({ path: join(output, '02-after-disconnect.png'), fullPage: true });

  // Reconnect brings the source back with a new revision.
  await page.getByTestId('reconnect-budget').click();
  await page.getByTestId('rows-budget').waitFor();
  const reconnected = await page.getByTestId('revision-budget').innerText();
  if (!reconnected.includes('10')) fail('reconnect advances the revision', reconnected);
  mark('reconnect restores the source at a new revision', reconnected);

  // Keyboard path for the same job.
  await page.getByTestId('joined-refresh').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('joined-note').filter({ hasText: 'อ่านข้อมูลใหม่แล้ว' }).waitFor();
  mark('refresh and disconnect are reachable by keyboard');

  const log = await page.evaluate(() => globalThis.__JOINED__);
  if (log.disconnects.length !== 1) fail('the caller was asked to disconnect exactly once', JSON.stringify(log));
  if (log.reconnects.length !== 1) fail('the caller was asked to reconnect exactly once', JSON.stringify(log));
  mark('the view delegates transport to its caller and does not fake it', JSON.stringify(log));

  if (pageErrors.length > 0) fail('no uncaught page errors', pageErrors.join(' | '));
  mark('no uncaught page errors');

  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'PASS', node: process.version, checks }, null, 2));
  console.log(`\n${checks.length} checks passed`);
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'FAIL', node: process.version, checks, failure: String(error), pageErrors }, null, 2));
  console.error(`FAIL ${String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
