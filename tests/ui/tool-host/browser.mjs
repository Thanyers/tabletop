import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

/**
 * F080 / C2 browser acceptance: the generated tool really renders inside a sandboxed frame and
 * really asks the host for a behaviour.
 *
 * Run `node scripts/build-tool-sandbox-runtime.mjs` then `node scripts/build-tool-host-harness.mjs`
 * before this script. Evidence goes to `test-results/tool-host/` (gitignored).
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const harnessDir = resolve(root, 'test-results/tool-host-harness');
const output = resolve(root, 'test-results/tool-host');
await mkdir(output, { recursive: true });

/**
 * Serve the harness from a real http origin.
 *
 * This matters for the isolation proof: from `file://` a *non-sandboxed* frame also reports
 * `origin === "null"` and has no cookie jar, so the probe would pass without proving anything.
 * Every response sets a cookie, so the parent page demonstrably holds one and a frame that could
 * read it would be caught instead of silently "empty".
 */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const relative = normalize(url.pathname === '/' ? '/index.html' : url.pathname).replace(/^([/\\])+/, '');
  const file = join(harnessDir, relative);
  if (!file.startsWith(harnessDir)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'set-cookie': 'tabletop_probe=sandbox-canary; Path=/; SameSite=Lax',
      'cache-control': 'no-store',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const origin = `http://127.0.0.1:${server.address().port}`;

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
const context = await browser.newContext({ viewport: { width: 1100, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(`${origin}/index.html`);
  await page.getByText('C2 — generated tool host').waitFor();

  const parentCookie = await page.evaluate(() => document.cookie);
  if (!parentCookie.includes('tabletop_probe=sandbox-canary')) fail('the parent page holds a cookie', parentCookie);
  mark('host page runs from a real http origin and holds a session-style cookie', parentCookie);

  const compile = await page.getByTestId('compile').innerText();
  if (!compile.includes('compile: ok')) fail('package compiles', compile);
  mark('package compiles from source text', compile.trim());

  const frame = page.locator('iframe[title="ผังพื้นที่กิจกรรม (ตัวอย่าง)"]');
  await frame.waitFor({ state: 'attached' });
  const sandbox = await frame.getAttribute('sandbox');
  if (sandbox !== 'allow-scripts') fail('frame sandbox attribute', String(sandbox));
  mark('frame uses sandbox="allow-scripts" without allow-same-origin', String(sandbox));

  const view = page.frameLocator('iframe[title="ผังพื้นที่กิจกรรม (ตัวอย่าง)"]');
  await view.locator('[data-testid="source-status"]').waitFor();
  const status = await view.locator('[data-testid="source-status"]').innerText();
  if (!status.includes('rev 3') || !status.includes('rev 7')) fail('two sources projected', status);
  mark('the package reads two different source revisions', status.replace(/\s+/gu, ' ').trim());

  const roomCount = await view.locator('[data-testid^="room-"]').count();
  if (roomCount !== 2) fail('rooms rendered from a records port', String(roomCount));
  mark('records port rendered as interactive rooms', `${roomCount} rooms`);

  await page.screenshot({ path: join(output, '01-initial.png'), fullPage: true });

  // Pointer drag (the interaction that does not exist in the built-in canvas catalog).
  const room = view.locator('[data-testid="room-ห้องประชุม"]');
  const zone = view.locator('[data-testid="zone-โซนกลาง"]');
  const roomBox = await room.boundingBox();
  const zoneBox = await zone.boundingBox();
  if (!roomBox || !zoneBox) fail('drag targets visible', 'missing bounding box');
  const frameHandle = await page.$('iframe[title="ผังพื้นที่กิจกรรม (ตัวอย่าง)"]');
  const frameBox = await frameHandle.boundingBox();
  if (!frameBox) fail('frame has a box', 'missing');
  // Playwright reports an iframe element's box relative to the main-frame viewport already.
  await page.mouse.move(roomBox.x + roomBox.width / 2, roomBox.y + roomBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(zoneBox.x + zoneBox.width / 2, zoneBox.y + 40, { steps: 10 });
  await page.mouse.up();
  await view.locator('[data-testid="placed-ห้องประชุม"]').waitFor();
  mark('room moved by pointer drag into a zone');

  const total = await view.getByTestId('total').innerText();
  if (!total.includes('1800')) fail('cost from the second source', total);
  mark('cost is computed from the second table', total.replace(/\s+/gu, ' ').trim());

  await view.getByTestId('propose').click();
  await view.locator('[data-testid="note"]').filter({ hasText: 'บันทึกข้อเสนอแล้ว' }).waitFor();
  const intents = await page.evaluate(() => globalThis.__HARNESS__.intents.map(intent => ({ behaviorId: intent.behaviorId, inputs: intent.inputs })));
  if (intents.length !== 1) fail('one intent reached the host', JSON.stringify(intents));
  if (intents[0].behaviorId !== 'allocate') fail('intent names a declared behaviour', JSON.stringify(intents[0]));
  mark('declared behaviour invoked with typed inputs', JSON.stringify(intents[0].inputs));

  // Live projection update: revision moves without remounting the package.
  await page.getByTestId('push-ports').click();
  await view.locator('[data-testid="source-status"]').filter({ hasText: 'rev 4' }).waitFor();
  const updatedStatus = await view.locator('[data-testid="source-status"]').innerText();
  const updatedTotal = await view.getByTestId('total').innerText();
  if (!updatedStatus.includes('rev 9')) fail('second source revision updated live', updatedStatus);
  if (!updatedTotal.includes('2600')) fail('recomputed from the new revision', updatedTotal);
  const stillPlaced = await view.locator('[data-testid="placed-ห้องประชุม"]').count();
  if (stillPlaced !== 1) fail('package state survives a projection update', String(stillPlaced));
  mark('projections update live without remounting or losing package state', updatedTotal.replace(/\s+/gu, ' ').trim());

  await page.screenshot({ path: join(output, '02-after-update.png'), fullPage: true });

  // Keyboard path for the same interaction.
  await view.locator('[data-testid="room-ห้องอเนกประสงค์"]').focus();
  await page.keyboard.press('Enter');
  await view.locator('[data-testid="zone-pick-โซนหลัง"]').focus();
  await page.keyboard.press('Enter');
  await view.locator('[data-testid="placed-ห้องอเนกประสงค์"]').waitFor();
  mark('same placement reachable by keyboard only');

  // A message the page sends itself must not be mistaken for a frame message.
  const beforeSpoof = await page.evaluate(() => globalThis.__HARNESS__.intents.length);
  await page.getByTestId('spoof').click();
  await page.waitForTimeout(150);
  const afterSpoof = await page.evaluate(() => globalThis.__HARNESS__.intents.length);
  if (afterSpoof !== beforeSpoof) fail('page-originated spoof ignored', `${beforeSpoof} -> ${afterSpoof}`);
  mark('a message that is not from the frame is ignored');

  // Isolation probes executed inside the frame.
  const isolation = await view.locator('body').evaluate(async () => {
    const report = { cookie: 'unknown', storage: 'unknown', fetch: 'unknown' };
    try { report.cookie = document.cookie === '' ? 'empty' : `read:${document.cookie}`; } catch (error) { report.cookie = `blocked:${String(error)}`; }
    try { globalThis.localStorage.getItem('x'); report.storage = 'readable'; } catch (error) { report.storage = `blocked:${String(error).slice(0, 60)}`; }
    try {
      // Same-site and definitely served by the harness server, so a failure here is CSP, not 404.
      const response = await fetch('/index.html');
      report.fetch = `reachable:${response.status}`;
    } catch (error) {
      report.fetch = `blocked:${String(error).slice(0, 60)}`;
    }
    return { ...report, origin: location.origin, href: location.href.slice(0, 40) };
  });
  // The parent provably holds this cookie, so "readable" here would be a real leak.
  if (!isolation.cookie.startsWith('blocked')) fail('a sandboxed frame must not read cookies', isolation.cookie);
  if (!isolation.storage.startsWith('blocked')) fail('storage is blocked in frame', isolation.storage);
  if (!isolation.fetch.startsWith('blocked')) fail('network is blocked in frame', isolation.fetch);
  mark('frame has no cookie/storage/network access', JSON.stringify(isolation));

  await page.getByTestId('remount').click();
  await view.locator('[data-testid="source-status"]').waitFor();
  mark('remount replaces the instance cleanly');

  if (pageErrors.length > 0) fail('no uncaught page errors', pageErrors.join(' | '));
  mark('no uncaught page errors');

  await page.screenshot({ path: join(output, '03-keyboard.png'), fullPage: true });
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'PASS', node: process.version, checks, isolation, intents }, null, 2));
  console.log(`\n${checks.length} checks passed`);
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'FAIL', node: process.version, checks, failure: String(error), pageErrors }, null, 2));
  console.error(`FAIL ${String(error)}`);
  process.exitCode = 1;
} finally {
  await context.close();
  await browser.close();
  await new Promise(done => server.close(done));
}
