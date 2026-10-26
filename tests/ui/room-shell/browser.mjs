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

  // D-036: a room that holds only the version reference shows the installation card, not a host.
  await page.goto(`${pathToFileURL(pages).href}?screen=space&tool=reference`);
  await page.getByTestId('room-tool-title').waitFor();
  const toolTitle = await page.getByTestId('room-tool-title').innerText();
  const toolVersion = await page.getByTestId('room-tool-version').innerText();
  const toolOwner = await page.getByTestId('room-tool-owner').innerText();
  if (!toolTitle.includes('เครื่องมือ')) fail('the room shows the installed tool title', toolTitle);
  if (!toolVersion.includes('v2') || !toolVersion.includes('AI')) fail('the room shows the installed version and route', toolVersion);
  if (!toolOwner.includes('actor-b')) fail('the room shows who installed it', toolOwner);
  if (await page.getByTestId('space-room-note').count() !== 0) fail('the placeholder is not shown when a tool is referenced', 'placeholder present');
  mark('a room that holds only the tool reference keeps the installation card', `${toolTitle} · ${toolVersion}`);

  // D-040: with a package definition the room mounts the real host frame instead of the card.
  await page.goto(`${pathToFileURL(pages).href}?screen=space`);
  const toolFrame = page.locator('iframe[title="เครื่องมือวางผังห้อง"]');
  await toolFrame.waitFor({ state: 'attached' });
  const sandbox = await toolFrame.getAttribute('sandbox');
  if (sandbox !== 'allow-scripts') fail('the room tool frame keeps the sandbox attribute', String(sandbox));
  const packageView = page.frameLocator('iframe[title="เครื่องมือวางผังห้อง"]');
  await packageView.locator('[data-testid="room-tool-package"]').waitFor();
  if (await page.getByTestId('room-tool-title').count() !== 0) fail('the card is not shown when the host mounted', 'room-tool-title present');
  if (await page.getByTestId('space-room-note').count() !== 0) fail('the placeholder is not shown when the host mounted', 'placeholder present');
  mark('the product room screen mounts the installed package in a sandboxed host frame');
  await page.screenshot({ path: join(output, 'space-tool-host.png'), fullPage: true });

  const loadsBefore = await page.evaluate(() => globalThis.__ROOM_HARNESS__.loads);
  await packageView.getByTestId('room-tool-check').click();
  await packageView.locator('[data-testid="room-tool-package-note"]').filter({ hasText: 'บันทึกแล้ว' }).waitFor();
  const intents = await page.evaluate(() => globalThis.__ROOM_HARNESS__.intents);
  if (intents.length !== 1) fail('one intent reached the room dep', JSON.stringify(intents));
  if (intents[0].behaviorId !== 'check-room') fail('the intent names a declared behaviour', JSON.stringify(intents[0]));
  if (intents[0].inputs?.note !== 'จากห้อง') fail('the intent carries the frame inputs', JSON.stringify(intents[0].inputs));
  const loadsAfter = await page.evaluate(() => globalThis.__ROOM_HARNESS__.loads);
  if (loadsAfter <= loadsBefore) fail('a committed intent re-reads the room', `${loadsBefore} -> ${loadsAfter}`);
  // A re-read replaces every object the room returns; the frame must keep its own state across it.
  const packageCount = await packageView.getByTestId('room-tool-package-count').innerText();
  if (!packageCount.includes('n = 1')) fail('the frame survives the re-read after a commit', packageCount);
  mark('a declared behaviour goes through runToolIntent and a commit re-reads the room', `${JSON.stringify(intents[0].inputs)} · loads ${loadsBefore}->${loadsAfter}`);

  // A package that does not compile keeps the card and states the problem instead of failing silently.
  await page.goto(`${pathToFileURL(pages).href}?screen=space&tool=broken`);
  await page.getByTestId('room-tool-problem').waitFor();
  const problem = await page.getByTestId('room-tool-problem').innerText();
  if (!problem.includes('ui/main.tsx')) fail('the compile problem names the file it came from', problem);
  if (await page.getByTestId('room-tool-title').count() !== 1) fail('the card stays when the package does not compile', 'no card');
  mark('a package that fails to compile keeps the card and states the problem', problem);

  // And a room with no tool still shows the empty slot rather than an empty box.
  await page.goto(`${pathToFileURL(pages).href}?screen=space&tool=none`);
  await page.getByTestId('space-room-note').waitFor();
  if (await page.getByTestId('room-tool-title').count() !== 0) fail('a room with no tool shows no card', 'card present');
  mark('a room with no tool keeps the empty slot', await page.getByTestId('space-room-note').innerText());

  if (pageErrors.length > 0) fail('no uncaught page errors on the product screen', pageErrors.join(' | '));
  mark('the product screen raises no uncaught errors');

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
