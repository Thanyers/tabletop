import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * F080 / JT-V acceptance for the room shell (variant C).
 *
 * The layout is measured by ui-gate; this file checks the things a measurement cannot see: that the
 * table rail really selects, that a withdrawn source stops showing data without hiding the others,
 * and that none of it needs a mouse.
 *
 * D-044 adds a second part: the tool frame is served from its own origin, under its own CSP, while the
 * page that embeds it keeps `script-src 'self'`. Two local servers provide those origins, with the
 * policies read from the real `_headers` files.
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const pages = resolve(root, 'test-results/room-shell-harness/index.html');
const output = resolve(root, 'test-results/room-shell');
await mkdir(output, { recursive: true });

const checks = [];
const notes = [];
const mark = (name, detail = '') => {
  checks.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` - ${detail}` : ''}`);
};
const note = detail => {
  notes.push(detail);
  console.log(`NOTE ${detail}`);
};
const fail = (name, detail) => {
  checks.push({ name, detail, failed: true });
  throw new Error(`${name}: ${detail}`);
};

/* ------------------------------------------------------------------------------------------------
 * F080 / D-044: two origins, each with the policy its own `_headers` file declares.
 * ---------------------------------------------------------------------------------------------- */

/** The headers of the site-wide block in a Cloudflare `_headers` file, lower-cased. */
async function readSiteHeaders(file) {
  const rules = [];
  let rule;
  for (const line of (await readFile(file, 'utf8')).split(/\r?\n/u)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/u.test(line)) {
      rule = { pattern: line.trim(), headers: new Map() };
      rules.push(rule);
      continue;
    }
    const at = line.indexOf(':');
    if (!rule || at < 0) continue;
    rule.headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
  }
  const site = rules.find(entry => entry.pattern === '/*');
  if (!site) throw new Error(`${file} has no "/*" block`);
  return site.headers;
}

/** Replace one directive of a CSP, leaving every other directive as it was written. */
function replaceDirective(policy, name, value) {
  const directives = policy.split(';').map(part => part.trim()).filter(Boolean);
  let found = false;
  const next = directives.map(directive => {
    if (directive !== name && !directive.startsWith(`${name} `)) return directive;
    found = true;
    return `${name} ${value}`;
  });
  if (!found) next.push(`${name} ${value}`);
  return next.join('; ');
}

/** Add sources to a directive that is already there. */
function appendDirective(policy, name, sources) {
  return policy.split(';').map(part => part.trim()).filter(Boolean)
    .map(directive => (directive === name || directive.startsWith(`${name} `) ? `${directive} ${sources}` : directive))
    .join('; ');
}

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
]);

/** Serve one directory on 127.0.0.1 with a header map that the caller fills in after listening. */
function serve(directory, headers) {
  const server = createServer((request, response) => {
    void (async () => {
      const path = decodeURIComponent(new URL(request.url ?? '/', 'http://127.0.0.1').pathname);
      // The harness page declares no icon; browsers ask anyway, and that request is not a finding.
      if (path === '/favicon.ico') {
        response.statusCode = 204;
        response.end();
        return;
      }
      const target = resolve(directory, path.replace(/^\/+/u, '') || 'index.html');
      const body = target.startsWith(directory) ? await readFile(target).catch(() => undefined) : undefined;
      if (body === undefined) {
        response.statusCode = 404;
        response.end('not found');
        return;
      }
      for (const [name, value] of headers) response.setHeader(name, value);
      response.setHeader('content-type', CONTENT_TYPES.get(extname(target).toLowerCase()) ?? 'application/octet-stream');
      response.end(body);
    })();
  });
  return new Promise((done, failed) => {
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => done(server));
  });
}

const originOf = server => `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
const consoleErrors = [];
const servers = [];
page.on('pageerror', error => pageErrors.push(String(error)));
page.on('console', message => {
  if (message.type() === 'error') consoleErrors.push(message.text());
});

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

  /* ----------------------------------------------------------------------------------------------
   * D-044: the same host, with the frame document served from the sandbox's own origin.
   *
   * The page is no longer `file://` here: an origin can only be framed by a named ancestor, so the
   * harness is served from a first local origin under the app's real policy, and the frame document
   * from a second one under the sandbox's own. Only the two directives that must name a local port
   * differ from the `_headers` files, and that is reported below.
   * -------------------------------------------------------------------------------------------- */

  if (await readFile(resolve(root, 'sandbox-assets/frame.js'), 'utf8').catch(() => undefined) === undefined) {
    fail('the sandbox origin has its script', 'sandbox-assets/frame.js is missing; run node scripts/build-tool-sandbox-runtime.mjs');
  }

  const sandboxHeaders = new Map();
  const appHeaders = new Map();
  const sandboxHost = await serve(resolve(root, 'sandbox-assets'), sandboxHeaders);
  servers.push(sandboxHost);
  const appHost = await serve(resolve(root, 'test-results/room-shell-harness'), appHeaders);
  servers.push(appHost);
  const sandboxOrigin = originOf(sandboxHost);
  const appOrigin = originOf(appHost);

  for (const [name, value] of await readSiteHeaders(resolve(root, 'sandbox-assets/_headers'))) sandboxHeaders.set(name, value);
  sandboxHeaders.set('content-security-policy', replaceDirective(sandboxHeaders.get('content-security-policy'), 'frame-ancestors', appOrigin));
  note(`the sandbox policy is sandbox-assets/_headers with frame-ancestors narrowed to ${appOrigin} for the local run`);

  for (const [name, value] of await readSiteHeaders(resolve(root, 'public/_headers'))) appHeaders.set(name, value);
  const appPolicyFile = appHeaders.get('content-security-policy');
  appHeaders.set('content-security-policy', appendDirective(appPolicyFile, 'frame-src', sandboxOrigin));
  const appFrameSrc = appPolicyFile.split(';').map(part => part.trim()).find(part => part.startsWith('frame-src')) ?? '';
  note(`public/_headers still says \`${appFrameSrc}\`; the measured copy adds ${sandboxOrigin}, which the app's own policy needs before this ships`);

  const served = await fetch(`${sandboxOrigin}/frame.html`);
  const servedPolicy = served.headers.get('content-security-policy') ?? '';
  if (!servedPolicy.includes("default-src 'none'")) fail('the sandbox origin serves its own policy', servedPolicy);
  if (!servedPolicy.includes(`frame-ancestors ${appOrigin}`)) fail('the sandbox policy names the app origin as an allowed ancestor', servedPolicy);
  if (served.headers.get('x-content-type-options') !== 'nosniff') fail('the sandbox origin sends nosniff', String(served.headers.get('x-content-type-options')));
  if (served.headers.get('referrer-policy') !== 'no-referrer') fail('the sandbox origin sends no-referrer', String(served.headers.get('referrer-policy')));
  mark('the sandbox origin serves the policy and headers from sandbox-assets/_headers', servedPolicy);

  consoleErrors.length = 0;
  pageErrors.length = 0;
  const appResponse = await page.goto(`${appOrigin}/index.html?sandbox=origin&sandboxOrigin=${encodeURIComponent(sandboxOrigin)}`);
  const servedAppPolicy = appResponse.headers()['content-security-policy'] ?? '';
  if (!servedAppPolicy.includes("script-src 'self'")) fail('the app page keeps script-src self', servedAppPolicy);
  if (/script-src[^;]*'unsafe-inline'/u.test(servedAppPolicy)) fail('the app page does not loosen script-src', servedAppPolicy);
  mark('the app page that embeds the tool keeps its strict script-src', servedAppPolicy.split(';').find(part => part.includes('script-src'))?.trim() ?? servedAppPolicy);

  const originFrame = page.locator('iframe[title="เครื่องมือวางผังห้อง"]');
  await originFrame.waitFor({ state: 'attached' });
  const frameSrc = await originFrame.getAttribute('src');
  if (frameSrc !== `${sandboxOrigin}/frame.html`) fail('the frame document comes from the sandbox origin', String(frameSrc));
  if (await originFrame.getAttribute('srcdoc') !== null) fail('the origin case does not fall back to srcDoc', 'srcdoc attribute present');
  const servedFrame = page.frames().find(frame => frame.url() === `${sandboxOrigin}/frame.html`);
  if (!servedFrame) fail('the frame really is the document the sandbox origin served', page.frames().map(frame => frame.url()).join(' | '));
  mark('the host loads /frame.html from the sandbox origin instead of a srcDoc document', frameSrc);

  const originView = page.frameLocator('iframe[title="เครื่องมือวางผังห้อง"]');
  await originView.locator('[data-testid="room-tool-package"]').waitFor();
  const originHeading = await originView.locator('h3').innerText();
  if (!originHeading.includes('ตรวจผังห้อง')) fail('the package UI mounts inside the served document', originHeading);
  if (await page.getByTestId('origin-case').count() !== 1) fail('the page really is the origin case', 'origin-case marker missing');
  mark('the installed package renders from the frame the sandbox origin serves', originHeading);

  await originView.getByTestId('room-tool-check').click();
  await originView.locator('[data-testid="room-tool-package-note"]').filter({ hasText: 'บันทึกแล้ว' }).waitFor();
  const originIntents = await page.evaluate(() => globalThis.__ROOM_HARNESS__.intents);
  if (originIntents.length !== 1) fail('one intent reached runToolIntent from the served frame', JSON.stringify(originIntents));
  if (originIntents[0].behaviorId !== 'check-room') fail('the intent names a declared behaviour', JSON.stringify(originIntents[0]));
  if (originIntents[0].inputs?.note !== 'จากห้อง') fail('the intent carries the frame inputs across the new origin', JSON.stringify(originIntents[0].inputs));
  const hostNote = await page.getByTestId('origin-note').innerText();
  if (!hostNote.includes('committed:action-1')) fail('the host reports the outcome back to the page', hostNote);
  mark('a declared behaviour from the served frame reaches the runToolIntent stub', `${JSON.stringify(originIntents[0].inputs)} · ${hostNote}`);
  await page.screenshot({ path: join(output, 'space-tool-origin.png'), fullPage: true });

  const policyViolations = consoleErrors.filter(text => /content security policy|refused to (?:load|execute|frame)|violates the following/iu.test(text));
  if (policyViolations.length > 0) fail('the served frame starts without a policy violation', policyViolations.join(' | '));
  if (consoleErrors.length > 0) fail('the origin case raises no console errors', consoleErrors.join(' | '));
  if (pageErrors.length > 0) fail('the origin case raises no uncaught errors', pageErrors.join(' | '));
  mark('no policy violation or console error is reported for the served frame');

  // The note above is a claim about the app's own policy, so measure it: with `frame-src 'self' blob:`
  // as shipped, the same page refuses the frame. That is what makes the `_headers` change required
  // rather than assumed.
  appHeaders.set('content-security-policy', appPolicyFile);
  consoleErrors.length = 0;
  await page.goto(`${appOrigin}/index.html?sandbox=origin&sandboxOrigin=${encodeURIComponent(sandboxOrigin)}`);
  await page.waitForTimeout(500);
  const refusedRendered = await page.frameLocator('iframe[title="เครื่องมือวางผังห้อง"]').locator('[data-testid="room-tool-package"]').count().catch(() => 0);
  const frameRefusals = consoleErrors.filter(text => /frame-src|refused to frame/iu.test(text));
  if (refusedRendered !== 0) fail('the app policy without the sandbox origin refuses the frame', 'the package rendered anyway');
  if (frameRefusals.length === 0) fail('the refusal names frame-src', consoleErrors.join(' | ') || 'no console error at all');
  mark('the app policy as shipped refuses the frame, so naming the sandbox origin is required', frameRefusals[0]);

  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'PASS', node: process.version, checks, notes }, null, 2));
  console.log(`\n${checks.length} checks passed`);
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'FAIL', node: process.version, checks, notes, failure: String(error), pageErrors, consoleErrors }, null, 2));
  console.error(`FAIL ${String(error)}`);
  process.exitCode = 1;
} finally {
  for (const server of servers) server.close();
  await browser.close();
}
