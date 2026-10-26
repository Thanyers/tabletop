import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * F080 / JT-V acceptance for the room shell (variant C).
 *
 * The layout is measured by ui-gate; this file checks the things a measurement cannot see: that the
 * table rail really selects, that a withdrawn source stops showing data without hiding the others,
 * and that none of it needs a mouse.
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const pages = resolve(root, 'test-results/room-shell-harness/index.html');
const output = resolve(root, 'test-results/room-shell');
await mkdir(output, { recursive: true });

const checks = [];
const mark = (name, detail = '') => {
  checks.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
};
const fail = (name, detail) => {
  checks.push({ name, detail, failed: true });
  throw new Error(`${name}: ${detail}`);
};

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(pathToFileURL(pages).href);
  await page.getByTestId('room-shell').waitFor();
  await page.getByTestId('room-linked-count').filter({ hasText: '3/3' }).waitFor();
  mark('the shell shows every table in the room', await page.getByTestId('room-linked-count').innerText());

  const active = await page.getByTestId('room-table-workspace-plan').getAttribute('aria-current');
  if (active !== 'true') fail('the first table starts selected', String(active));
  await page.getByTestId('room-table-workspace-budget').click();
  const moved = await page.getByTestId('room-table-workspace-budget').getAttribute('aria-current');
  const previous = await page.getByTestId('room-table-workspace-plan').getAttribute('aria-current');
  if (moved !== 'true' || previous !== null) fail('selecting a table moves the current marker', `${moved}/${previous}`);
  mark('the table rail really selects, and keeps one current row');

  // A source withdrawn at the source must be visible as such, and must not leak its values.
  // (The viewer label also contains the name "กานต์", so the check is on the source's own nodes.)
  if (await page.getByTestId('rows-people').count() !== 0) fail('a withdrawn source must not render a table', 'rows-people still present');
  if (await page.getByTestId('unavailable-people').count() !== 1) fail('a withdrawn source is shown as unavailable', 'no unavailable card');
  const body = await page.locator('body').innerText();
  if (!body.includes('ถูกถอน')) fail('a withdrawn source is shown as withdrawn', 'no withdrawal text');
  if (!body.includes('ห้องอเนกประสงค์')) fail('the other sources keep their data', 'live rows missing');
  mark('a withdrawn source stops serving without hiding the others');

  await page.getByTestId('joined-refresh').click();
  await page.getByTestId('revision-plan').filter({ hasText: '5' }).waitFor();
  const refreshedBody = await page.locator('body').innerText();
  if (refreshedBody.includes('60')) fail('the refresh replaces the old values', 'stale area still shown');
  if (!refreshedBody.includes('5200')) fail('the refresh shows the new values', 'new price missing');
  mark('a refresh re-reads and replaces the values');

  // Keyboard: reach the second table and select it without a mouse.
  await page.getByTestId('room-table-workspace-budget').focus();
  await page.keyboard.press('Enter');
  await page.getByTestId('room-table-workspace-people').focus();
  await page.keyboard.press('Enter');
  const keyboardSelected = await page.getByTestId('room-table-workspace-people').getAttribute('aria-current');
  if (keyboardSelected !== 'true') fail('a table can be selected from the keyboard', String(keyboardSelected));
  mark('the table rail works from the keyboard');

  if (pageErrors.length > 0) fail('no uncaught page errors', pageErrors.join(' | '));
  mark('no uncaught page errors');

  // D-036: the product screen shows the tool the room installed, not a placeholder.
  await page.goto(`${pathToFileURL(pages).href}?screen=space`);
  await page.getByTestId('room-tool-title').waitFor();
  const toolTitle = await page.getByTestId('room-tool-title').innerText();
  const toolVersion = await page.getByTestId('room-tool-version').innerText();
  const toolOwner = await page.getByTestId('room-tool-owner').innerText();
  if (!toolTitle.includes('เครื่องมือ')) fail('the room shows the installed tool title', toolTitle);
  if (!toolVersion.includes('v2') || !toolVersion.includes('AI')) fail('the room shows the installed version and route', toolVersion);
  if (!toolOwner.includes('actor-b')) fail('the room shows who installed it', toolOwner);
  if (await page.getByTestId('space-room-note').count() !== 0) fail('the placeholder is not shown when a tool is installed', 'placeholder present');
  mark('the product room screen shows the installed tool version', `${toolTitle} · ${toolVersion}`);

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
