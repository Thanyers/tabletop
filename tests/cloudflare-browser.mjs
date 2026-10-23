// Disposable local Workers runtime. All accounts and session tokens below are synthetic.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { chromium, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { verifyInteractiveDemo } from './interactive-demo.mjs';
import { verifyGenericTableBrowser } from './generic-table-browser.mjs';

const listener = createServer();
await new Promise(resolveReady => listener.listen(0, '127.0.0.1', resolveReady));
const port = listener.address().port;
await new Promise(resolveClosed => listener.close(resolveClosed));
const origin = `http://127.0.0.1:${port}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const csrf = token => createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
const output = resolve('test-results/cloudflare-browser');
let providerCalls = 0;
let tableAIReply = null;
let tableAssistantReply = null;
const modelStatuses = [];
await mkdir(output, { recursive: true });

/** F050: a synthetic SSE reply whose reasoning streams first, then holds on the gate and sends the JSON. */
function streamingChangeResponse(reasoning, change, gate) {
  const encoder = new TextEncoder();
  const line = payload => encoder.encode(`data: ${JSON.stringify(payload)}\n\n`);
  return new Response(new ReadableStream({
    async start(controller) {
      for (const step of reasoning) {
        controller.enqueue(line({ model: 'deepseek-flash', choices: [{ index: 0, delta: { reasoning_content: step }, finish_reason: null }] }));
        await new Promise(resolveStep => setTimeout(resolveStep, 90));
      }
      if (gate) await gate;
      controller.enqueue(line({ model: 'deepseek-flash', choices: [{ index: 0, delta: { content: JSON.stringify(change) }, finish_reason: null }] }));
      controller.enqueue(line({ model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      controller.enqueue(line({
        model: 'deepseek-flash',
        choices: [],
        usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 30, completion_tokens_details: { reasoning_tokens: 0 } },
      }));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port,
  log: new Log(LogLevel.ERROR),
  workers: [{
  name: 'tabletop-local-browser-fixture',
  modules: true, scriptPath: resolve('worker-build/index.js'),
  compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'],
  durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, BILLING: { className: 'Billing', useSQLite: true } },
  bindings: { PUBLIC_ORIGIN: origin, GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
    DEEPSEEK_KEY: 'synthetic-provider-key', AI_MONTHLY_BUDGET_MICRO_USD: '1000000', AI_DAILY_BUDGET_MICRO_USD: '1000000' },
  outboundService: async request => {
    if (request.url !== 'https://api.deepseek.com/chat/completions') throw new Error('Unexpected external request in isolated browser test');
    providerCalls++;
    const body = await request.json();
    expect(JSON.stringify(body)).not.toContain('PRIVATE_DM_CF_BROWSER_MARKER');
    expect(body.model).toBe('deepseek-flash');
    const input = JSON.parse(body.messages?.[1]?.content ?? '{}');
    let change;
    if (input.kind === 'table-assistant') {
      if (!tableAssistantReply) throw new Error('Unexpected table assistant request without an armed synthetic response.');
      expect(Object.keys(input).sort()).toEqual(['context', 'kind', 'prompt']);
      expect(Object.keys(input.context).sort()).toEqual(['conversation', 'notes', 'program', 'records', 'role', 'seat', 'turn']);
      expect(Array.isArray(input.context.notes)).toBe(true);
      expect(input.context.notes.length).toBeLessThanOrEqual(20);
      expect(Array.isArray(input.context.conversation)).toBe(true);
      expect(input.context.conversation.length).toBeLessThanOrEqual(6);
      if (input.context.program) {
        expect(input.context.program).not.toHaveProperty('evidence');
        expect(input.context.program).not.toHaveProperty('assumptions');
      }
      if (tableAssistantReply.expectedRole) expect(input.context.role).toBe(tableAssistantReply.expectedRole);
      if (tableAssistantReply.expectedSeat) expect(input.context.seat).toBe(tableAssistantReply.expectedSeat);
      for (const marker of tableAssistantReply.forbiddenTexts ?? []) expect(JSON.stringify(input)).not.toContain(marker);
      for (const marker of tableAssistantReply.expectedConversationContains ?? []) expect(JSON.stringify(input.context.conversation)).toContain(marker);
      if (tableAssistantReply.expectedConversationCount !== undefined) expect(input.context.conversation).toHaveLength(tableAssistantReply.expectedConversationCount);
      expect(typeof input.prompt).toBe('string');
      if (tableAssistantReply.expectedPromptContains) expect(input.prompt).toContain(tableAssistantReply.expectedPromptContains);
      change = tableAssistantReply.result;
      const assistantGate = tableAssistantReply.gate;
      tableAssistantReply = null;
      // F038: an armed gate holds the answer so other members can observe the running card.
      if (assistantGate) await assistantGate;
    } else if (input.kind === 'table') {
      if (!tableAIReply) throw new Error('Unexpected table model request without an armed synthetic response.');
      if (tableAIReply.expectedSources) {
        expect(input.sources).toEqual(tableAIReply.expectedSources);
        expect((input.importedSources ?? []).map(({ id, filename }) => ({ id, filename }))).toEqual(tableAIReply.expectedImportedSources ?? []);
      }
      else {
        expect(input.sources).toHaveLength(1);
        expect(input.sources[0].filename).toBe(tableAIReply.expectedFilename);
        expect(input.sources[0].text).toBe(tableAIReply.expectedText);
      }
      expect(typeof input.prompt).toBe('string');
      change = tableAIReply.change;
      const gate = tableAIReply.gate;
      const streamReasoning = tableAIReply.streamReasoning;
      tableAIReply = null;
      // F050: stream synthetic reasoning before the JSON, so the waiting card can be observed
      // showing what the model is doing instead of only counting characters.
      if (streamReasoning) return streamingChangeResponse(streamReasoning, change, gate);
      // An armed gate holds the reply so the browser can observe the waiting card.
      if (gate) await gate;
    } else {
      change = { kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } };
    }
    return Response.json({ model: 'deepseek-flash',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(change) } }],
      usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 30, completion_tokens_details: { reasoning_tokens: 0 } },
    });
  },
  assets: { directory: resolve('dist'), binding: 'ASSETS',
    run_worker_first: ['/api/*', '/healthz', '/readyz', '/version', '/internal/*'],
    routerConfig: { has_user_worker: true },
    assetConfig: { not_found_handling: 'single-page-application' } },
  }],
}));
const checks = []; const errors = []; const pages = [];
let browser;
const mark = value => { checks.push(value); console.log('PASS ' + value); };
try {
  await mf.ready;
  const db = await mf.getD1Database('DB');
  for (const migration of ['0001_identity.sql', '0002_table_kind.sql']) {
    const schema = await readFile(`cloudflare/migrations/${migration}`, 'utf8');
    await db.batch(schema.replace(/^--.*$/gmu, '').split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  }
  const actors = ['DM', 'Mira', 'Pip', 'Outsider'].map((name, i) => ({ id: randomUUID(), name, token: String.fromCharCode(65 + i).repeat(43) }));
  const genericOwners = ['Equipment Owner', 'Shift Owner', 'Game Owner'].map((name, i) => ({ id: randomUUID(), name, token: String.fromCharCode(69 + i).repeat(43) }));
  const genericMembers = ['Table Member', 'Second Member'].map((name, i) => ({ id: randomUUID(), name, token: String.fromCharCode(72 + i).repeat(43) }));
  const now = Date.now();
  for (const actor of [...actors, ...genericOwners, ...genericMembers]) await db.batch([
    db.prepare('INSERT INTO users(id,provider_sub,email,name,is_admin,created_at) VALUES(?,?,?,?,?,?)')
      .bind(actor.id, `fixture:${actor.id}`, `${actor.name.toLowerCase()}@example.test`, actor.name, actor.name === 'DM' ? 1 : 0, now),
    db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
      .bind(hash(actor.token), hash(csrf(actor.token)), actor.id, now, now, now + 7 * 86_400_000),
  ]);
  const probe = await fetch(`${origin}/api/auth/status`);
  if (!probe.ok) throw new Error(`Fixture auth readiness: ${probe.status} ${(await probe.text()).slice(0, 1600)}`);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  async function newPage(actor, url = origin) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    // Long scenarios idle between assistant steps; the dedicated collapse check opts back in.
    await context.addInitScript(() => { try { if (localStorage.getItem('tabletop.assistant.idleMs') === null) localStorage.setItem('tabletop.assistant.idleMs', 'off'); } catch { /* storage blocked */ } });
    if (actor) await context.addCookies([{ name: 'tabletop_local_session', value: actor.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage(); pages.push(page);
    page.on('pageerror', error => errors.push(error.message));
    // The fixture cannot contact a real identity or model provider from the browser.
    await page.route(/https:\/\/(accounts\.google\.com|api\.deepseek\.com)\//, route => route.abort());
    await page.goto(url); await page.waitForLoadState('networkidle');
    return page;
  }
  async function api(page, path, body) {
    return page.evaluate(async ({ path, body }) => {
      const session = await (await fetch('/api/session')).json();
      const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    }, { path, body });
  }
  async function openCanvasObject(page, id) {
    const editor = page.getByTestId('canvas-object-editor');
    if (await editor.isVisible().catch(() => false) && await editor.getAttribute('data-canvas-object') === id) return editor;
    const trigger = page.getByTestId('canvas-object-menu-trigger');
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    const dock = page.getByTestId('canvas-object-dock');
    await expect(dock).toBeVisible();
    await dock.getByTestId(`open-canvas-${id}`).click();
    await expect(editor).toHaveAttribute('data-canvas-object', id);
    await expect(editor).toBeVisible();
    return editor;
  }
  async function setTableOptionsOpen(page, open) {
    const options = page.locator('.tt-table-options');
    const isOpen = await options.getAttribute('open') !== null;
    if (isOpen !== open) await options.locator('summary').click();
    if (open) await expect(options).toHaveAttribute('open', '');
    else await expect(options).not.toHaveAttribute('open');
  }
  const welcomeIdentityCounts = () => db.prepare('SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM web_sessions) AS sessions, (SELECT COUNT(*) FROM oauth_states) AS oauth, (SELECT COUNT(*) FROM rooms) AS rooms').first();
  const beforeWelcome = await welcomeIdentityCounts();
  const anonymous = await newPage();
  await expect(anonymous.getByRole('heading', { name: "The best tool is the one you don't have to think about.", exact: true })).toBeVisible();
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toHaveCount(1);
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', '/api/auth/google/start');
  await expect(anonymous.getByRole('link', { name: /^Auto demo/ })).toHaveAttribute('href', '/demo');
  await expect(anonymous.getByRole('link', { name: /^Auto demo/ })).toHaveAttribute('target', '_blank');
  await expect(anonymous.getByText('Work defines what software becomes.', { exact: true })).toBeVisible();
  await expect(anonymous.locator('.tt-canvas-panel')).toHaveCount(0);
  const conceptImage = anonymous.locator('.tt-public-welcome__story-frame img');
  await expect(conceptImage).toHaveAttribute('src', /\.png$/);
  await anonymous.getByRole('button', { name: 'Replay the concept animation', exact: true }).click();
  await expect(conceptImage).toHaveAttribute('src', /\.gif\?replay=1$/);
  await anonymous.getByRole('button', { name: 'Show the still illustration', exact: true }).click();
  await expect(conceptImage).toHaveAttribute('src', /\.png$/);
  await anonymous.screenshot({ path: join(output, 'public-welcome-desktop.png'), fullPage: true });
  await anonymous.setViewportSize({ width: 390, height: 844 });
  expect(await anonymous.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await anonymous.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toBeInViewport();
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await anonymous.screenshot({ path: join(output, 'public-welcome-narrow.png'), fullPage: true });
  await anonymous.setViewportSize({ width: 1440, height: 1000 });
  expect((await api(anonymous, '/api/session')).status).toBe(401);
  mark('Public welcome explains the concept on desktop/mobile, preserves the Google/demo entry points and keeps anonymous users outside the Canvas');

  const failedSignIn = await newPage(null, `${origin}/?auth_error=google_login_failed`);
  await expect(failedSignIn.getByRole('alert')).toContainText('Google sign-in did not complete.');
  await expect(failedSignIn.getByRole('link', { name: 'Continue with Google' })).toHaveAttribute('href', '/api/auth/google/start');
  await failedSignIn.getByRole('button', { name: 'Dismiss message', exact: true }).click();
  await expect(failedSignIn.getByRole('alert')).toHaveCount(0);
  await failedSignIn.getByRole('button', { name: 'Already signed in? Check again', exact: true }).click();
  await expect(failedSignIn.getByRole('heading', { name: "The best tool is the one you don't have to think about.", exact: true })).toBeVisible();
  expect(providerCalls).toBe(0);
  await failedSignIn.context().close();
  expect(await welcomeIdentityCounts()).toEqual(beforeWelcome);
  mark('Public welcome preserves sign-in failure, notice dismissal and retry without a provider call');

  const builtVersion = JSON.parse(await readFile('dist/version.json', 'utf8'));
  const servedVersion = await mf.dispatchFetch(`${origin}/version`);
  expect(servedVersion.status).toBe(200);
  expect(servedVersion.headers.get('cache-control')).toBe('no-store');
  expect(await servedVersion.json()).toEqual(builtVersion);
  expect(Object.keys(builtVersion).sort()).toEqual(['built_at', 'sha', 'version']);
  mark('GET /version reports the build identity written next to the static assets');

  // Both public experiences must stay separate from authenticated application sessions.
  const publicDemoRequests = []; const publicDemoSockets = [];
  const demoContext = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const demo = await demoContext.newPage(); pages.push(demo);
  demo.on('pageerror', error => errors.push(error.message));
  demoContext.on('request', request => {
    const url = new URL(request.url());
    // Edge may open its internal downloads UI during export checks. Its
    // browser-owned resources are not application network requests.
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    if (url.origin !== origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) {
      publicDemoRequests.push({ method: request.method(), pathname: url.pathname });
    }
  });
  demo.on('websocket', socket => publicDemoSockets.push(socket.url()));
  demoContext.on('page', page => {
    page.on('pageerror', error => errors.push(error.message));
    page.on('websocket', socket => publicDemoSockets.push(socket.url()));
  });
  await demo.route(url => url.origin !== origin, route => route.abort());
  const identityCounts = async () => ({
    users: (await db.prepare('SELECT COUNT(*) AS n FROM users').first()).n,
    sessions: (await db.prepare('SELECT COUNT(*) AS n FROM web_sessions').first()).n,
    rooms: (await db.prepare('SELECT COUNT(*) AS n FROM rooms').first()).n,
  });
  const beforeDemo = await identityCounts();
  await verifyInteractiveDemo(demo, origin, output);
  expect(publicDemoRequests).toEqual([]); expect(publicDemoSockets).toEqual([]);
  expect(await identityCounts()).toEqual(beforeDemo);
  expect(await demoContext.cookies()).toEqual([]);
  expect(providerCalls).toBe(0);
  mark('Canvas demo starts empty, imports by drag/drop, opens rules on canvas and supports takeover, role isolation and narrow layout without API calls or persistent storage');
  await demo.setViewportSize({ width: 1440, height: 1000 });
  await demo.goto(`${origin}/demo/replay?legacy-demo=1`);
  await expect(demo.getByTestId('public-auto-demo')).toBeVisible();
  await expect(demo.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  const demoCounter = demo.getByTestId('demo-step-counter');
  const firstDemoStep = await demoCounter.innerText();
  await demo.getByRole('button', { name: 'เล่นเรื่องนี้', exact: true }).click();
  await expect.poll(() => demoCounter.innerText(), { timeout: 12_000 }).not.toBe(firstDemoStep);
  // The first invoice story has two steps and must stop at its end.
  await expect(demo.getByRole('button', { name: 'หยุดเล่นชั่วคราว', exact: true })).toHaveCount(0);
  await demo.getByRole('button', { name: 'เริ่มใหม่', exact: true }).click();
  await expect(demoCounter).toHaveText(firstDemoStep);
  await demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true }).click();
  await expect(demoCounter).not.toHaveText(firstDemoStep);
  await demo.getByRole('button', { name: 'ย้อนหนึ่งจังหวะ', exact: true }).click();
  await expect(demoCounter).toHaveText(firstDemoStep);
  await demo.getByRole('button', { name: 'บทเรียน', exact: true }).click();
  await demo.getByRole('button', { name: 'โจทย์ร่วม คำตอบแยกคน', exact: true }).click();
  await expect(demo.getByTestId('demo-checkpoint')).toContainText('มวล');
  await demo.getByRole('button', { name: 'เล่นเรื่องนี้', exact: true }).click();
  await demo.getByRole('button', { name: 'หยุดเล่นชั่วคราว', exact: true }).click();
  await expect(demo.getByRole('button', { name: 'เล่นเรื่องนี้', exact: true })).toBeVisible();
  await demo.getByRole('button', { name: 'กลับมาตอบโจทย์เก่า', exact: true }).click();
  await demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true }).click();
  await expect(demo.getByTestId('public-auto-demo')).toContainText('ระบบให้โหลดโจทย์ปัจจุบันก่อนตอบใหม่');
  await demo.getByRole('button', { name: 'การผจญภัย', exact: true }).click();
  await demo.getByRole('button', { name: 'ช่วยเพื่อนด้วยโล่', exact: true }).click();
  for (let step = 1; step < 9; step++) await demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true }).click();
  await expect(demo.getByTestId('demo-checkpoint')).toContainText('Pip');
  await expect(demo.getByTestId('demo-checkpoint')).toContainText('Mira');
  await expect(demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true })).toBeDisabled();
  await demo.getByRole('button', { name: 'ทุกโต๊ะ', exact: true }).click();
  for (const title of ['บิลที่ยังขาดหลักฐาน', 'อัตราที่ใช้ได้เฉพาะช่วงวันที่', 'กติกาซ้อนและการกดซ้ำ',
    'โจทย์ร่วม คำตอบแยกคน', 'กลับมาตอบโจทย์เก่า', 'มวลศูนย์ที่คำนวณไม่ได้',
    'ช่วยเพื่อนด้วยโล่', 'พักเกมแล้วกลับมาเล่นต่อ', 'คำอนุมัติที่หมดอายุ']) {
    await expect(demo.getByRole('button', { name: title, exact: true })).toBeVisible();
    await demo.getByRole('button', { name: title, exact: true }).click();
    await expect(demo.getByRole('button', { name: 'ย้อนหนึ่งจังหวะ', exact: true })).toBeDisabled();
    await demo.getByRole('list', { name: 'ลำดับการเล่น' }).getByRole('button').last().click();
    await expect(demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true })).toBeDisabled();
    await expect(demo.getByRole('button', { name: 'เล่นเรื่องนี้อีกครั้ง', exact: true })).toBeEnabled();
  }
  await demo.screenshot({ path: join(output, 'public-demo-desktop.png'), fullPage: true });
  await demo.setViewportSize({ width: 304, height: 844 });
  await demo.reload();
  await expect(demo.getByTestId('public-auto-demo')).toBeVisible();
  expect(await demo.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await demo.getByRole('button', { name: 'ไปจังหวะถัดไป', exact: true }).click();
  await demo.getByRole('button', { name: 'ย้อนหนึ่งจังหวะ', exact: true }).click();
  await demo.screenshot({ path: join(output, 'public-demo-narrow.png'), fullPage: true });
  expect(publicDemoRequests).toEqual([]); expect(publicDemoSockets).toEqual([]);
  expect(await identityCounts()).toEqual(beforeDemo);
  expect(await demoContext.cookies()).toEqual([]);
  expect(providerCalls).toBe(0);
  await demoContext.close();
  mark('Public Auto demo plays nine recorded stories without sign-in, API calls, sockets, cookies, AI or room creation; narrow controls and reload work');

  const dm = await newPage(actors[0]);
  dm.on('response', async response => {
    if (/\/model(?:\/[a-f0-9]{64})?$/.test(new URL(response.url()).pathname)) {
      const body = await response.json().catch(() => null);
      modelStatuses.push({ http: response.status(), body });
    }
  });
  // F004: `/` is the landing page for everyone; a signed-in account gets "Your tables" instead of sign-in.
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await expect(dm.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(dm.getByRole('link', { name: 'Your tables', exact: true })).toHaveCount(2);
  for (const link of await dm.getByRole('link', { name: 'Your tables', exact: true }).all()) await expect(link).toHaveAttribute('href', '/tables');
  await expect(dm.locator('.tt-canvas-panel')).toHaveCount(0);
  await expect(dm.getByRole('link', { name: /^Auto demo/ })).toHaveAttribute('href', '/demo');
  await dm.locator('.tt-public-welcome header').getByRole('link', { name: 'Your tables', exact: true }).click();
  await expect(dm).toHaveURL(`${origin}/tables`);
  await expect(dm.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
  await expect(dm.locator('.tt-public-welcome')).toHaveCount(0);
  await dm.goBack();
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  mark('Signed-in `/` shows the landing page with Your tables (header link and button to /tables) and no sign-in; Back from /tables returns to it');
  const created = dm.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  await dm.getByRole('button', { name: 'Start a new table', exact: true }).click();
  await expect(dm).toHaveURL(`${origin}/new`);
  await dm.getByTestId('start-page').getByRole('button', { name: /Shared encounter.*Run turns/ }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  const room = await createdResponse.json();
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  await setTableOptionsOpen(dm, true);
  await expect(dm.getByRole('link', { name: 'Try a demo', exact: true })).toHaveAttribute('target', '_blank');
  await setTableOptionsOpen(dm, false);
  let miraInvite = await api(dm, `/api/workspaces/${room.id}/invites`, { seat: 'mira' });
  const pipInvite = await api(dm, `/api/workspaces/${room.id}/invites`, { seat: 'pip' });
  expect(miraInvite.status).toBe(201); expect(pipInvite.status).toBe(201);
  // The first response is intentionally ignored by the owner UI, like a lost acknowledgement.
  const lostTicket = miraInvite.body.ticket;
  await openCanvasObject(dm, 'workspace.people');
  await dm.getByTestId('canvas-object-editor').getByRole('button', { name: 'Invite someone', exact: true }).click();
  const inviteDialog = dm.getByRole('dialog', { name: 'People at this table' });
  await inviteDialog.getByRole('button', { name: /Mira.*Player view/ }).click();
  await inviteDialog.getByText('Lost an unused invitation link?', { exact: true }).click();
  const inviteReplacement = dm.waitForResponse(response => response.url().endsWith(`/workspaces/${room.id}/invites`) && response.request().method() === 'POST');
  await inviteDialog.getByRole('button', { name: 'Revoke old link and issue new link' }).click();
  const replacementResponse = await inviteReplacement;
  expect(replacementResponse.status()).toBe(201);
  miraInvite = { status: 201, body: await replacementResponse.json() };
  expect(miraInvite.body.ticket).not.toBe(lostTicket);
  await expect(inviteDialog.getByLabel('One-use invitation link')).toHaveValue(new RegExp(miraInvite.body.ticket));
  await inviteDialog.getByRole('button', { name: 'Close', exact: true }).click();
  mark('Owner recovers a lost invitation through explicit revoke-and-reissue in the UI');
  // Simulate the return from verified Google login. The actual OAuth exchange is tested in auth.test.ts.
  await anonymous.goto(`${origin}/#invite=${miraInvite.body.ticket}`);
  await expect(anonymous.getByText('Your invitation is saved in this tab and will be used after sign-in.')).toBeVisible();
  expect(new URL(anonymous.url()).hash).toBe('');
  await anonymous.context().addCookies([{ name: 'tabletop_local_session', value: actors[1].token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await anonymous.goto(origin);
  const mira = anonymous;
  await expect(mira.locator('.tt-canvas-panel')).toBeVisible();
  const pip = await newPage(actors[2], `${origin}/#invite=${pipInvite.body.ticket}`);
  await expect(pip.locator('.tt-canvas-panel')).toBeVisible();
  expect(await mira.evaluate(() => sessionStorage.getItem('tabletop.pendingInvite'))).toBeNull();
  await expect.poll(async () => (await api(dm, `/api/workspaces/${room.id}`)).body.members.length).toBe(3);
  mark('Three separate accounts join assigned seats; invitation survives the sign-in round trip');

  async function command(page, type, payload = {}) {
    const current = await api(page, `/api/workspaces/${room.id}`);
    const result = await api(page, `/api/workspaces/${room.id}/commands`, { commandId: randomUUID(), expectedRevision: current.body.revision, expectedEpoch: current.body.epoch, type, payload });
    return result;
  }
  expect((await command(dm, 'encounter.saveNote', { text: 'PRIVATE_DM_CF_BROWSER_MARKER' })).status).toBe(200);
  await openCanvasObject(dm, 'encounter.actions');
  const action = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'encounter.declareHit');
  await dm.getByRole('button', { name: 'Hit Pip', exact: true }).click();
  expect((await action).status()).toBe(200);
  await expect.poll(async () => (await api(pip, `/api/workspaces/${room.id}`)).body.domain.phase).toBe('reaction.open');
  // F015 open visibility: the player now reads the pending roll/damage and the DM note (was: hidden);
  // F035: an unassigned player may run the encounter (game.direct); on the Player preset they may not.
  const pipProjection = (await api(pip, `/api/workspaces/${room.id}`)).body;
  const dmProjection = (await api(dm, `/api/workspaces/${room.id}`)).body;
  expect(typeof pipProjection.domain.pendingHit.roll).toBe('number');
  expect(pipProjection.domain.pendingHit.roll).toBe(dmProjection.domain.pendingHit.roll);
  expect(pipProjection.domain.pendingHit.damage).toBe(dmProjection.domain.pendingHit.damage);
  expect(JSON.stringify(pipProjection)).toContain('PRIVATE_DM_CF_BROWSER_MARKER');
  await openCanvasObject(pip, 'encounter.actions');
  const pipResolveButton = pip.getByTestId('canvas-object-editor').getByRole('button', { name:'Resolve hit', exact:true });
  await expect(pipResolveButton).toBeVisible();
  const pipActorId = (await api(pip, `/api/workspaces/${room.id}`)).body.actor.actorId;
  expect((await command(dm, 'access.assign', { actorId: pipActorId, roleId: 'player' })).status).toBe(200);
  // The button follows the permission once the new projection arrives; the server refuses the command too.
  await expect(pipResolveButton).toHaveCount(0);
  const pipResolve = await command(pip, 'encounter.resolve');
  expect(pipResolve.status).toBe(403);
  expect(pipResolve.body.errorCode).toBe('FORBIDDEN');
  expect((await command(dm, 'encounter.pause')).status).toBe(200);
  const pausedAction = await command(pip, 'encounter.shield', { target: 'pip' });
  expect(pausedAction.status).toBe(422);
  expect(pausedAction.body.errorCode).toBe('ENCOUNTER_PAUSED');
  await dm.reload();
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  await expect(dm).toHaveURL(`${origin}/t/${room.id}`);
  expect((await api(dm, `/api/workspaces/${room.id}`)).body.domain.paused).toBeTruthy();
  expect((await command(dm, 'encounter.resume')).status).toBe(200);
  expect((await command(pip, 'encounter.shield', { target: 'pip' })).status).toBe(200);
  expect((await command(dm, 'encounter.resolve')).status).toBe(200);
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  await pip.reload();
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  mark('Live multiplayer shares DM hit values and note with players (F015 open visibility; was: DM/player privacy) while an unassigned player sees Resolve hit and a player on the Player preset neither sees nor can use it (F035); pause/resume and committed HP survive browser reload');

  const outsider = await newPage(actors[3]);
  expect((await api(outsider, `/api/workspaces/${room.id}`)).status).toBe(403);
  expect((await api(outsider, '/api/admin/workspaces')).status).toBe(403);

  // A table URL is an address, not access: outsiders get the same notice as for a missing table.
  const outsiderLink = await newPage(actors[3], `${origin}/t/${room.id}`);
  await expect(outsiderLink.getByText('This table is not available to this account.', { exact: false })).toBeVisible();
  await expect(outsiderLink).toHaveURL(`${origin}/tables`);
  await expect(outsiderLink.locator('.tt-canvas-panel')).toHaveCount(0);
  const missingLink = await newPage(actors[3], `${origin}/t/${randomUUID()}`);
  await expect(missingLink.getByText('This table is not available to this account.', { exact: false })).toBeVisible();
  // Signed-out visitors return to the requested table after signing in.
  const signedOut = await newPage(null, `${origin}/t/${room.id}`);
  await expect(signedOut.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await signedOut.context().addCookies([{ name: 'tabletop_local_session', value: actors[0].token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await signedOut.goto(origin); await signedOut.waitForLoadState('networkidle');
  await expect(signedOut).toHaveURL(`${origin}/t/${room.id}`);
  await expect(signedOut.locator('.tt-canvas-panel')).toBeVisible();
  // Back and forward move between the landing page and the open table.
  // Creating the table replaced the /new entry, so Back skips the start page and returns to `/`.
  await dm.goBack();
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await expect(dm.getByTestId('start-page')).toHaveCount(0);
  await expect(dm.locator('.tt-canvas-panel')).toHaveCount(0);
  await dm.goForward();
  await expect(dm).toHaveURL(`${origin}/t/${room.id}`);
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  mark('Each table has its own /t/<id> URL: reload and back/forward follow it, Back after creating from /new skips /new, sign-in returns to it, and outsiders see only an unavailable notice on /tables');
  const metadata = await api(dm, '/api/admin/workspaces');
  expect(metadata.status).toBe(200);
  expect(JSON.stringify(metadata.body)).not.toContain('PRIVATE_DM_CF_BROWSER_MARKER');
  expect(metadata.body.workspaces.some(item => item.id === room.id)).toBe(true);
  await setTableOptionsOpen(dm, true);
  await dm.getByRole('button', { name: 'Admin', exact: true }).click();
  await expect(dm.getByRole('dialog', { name: 'Table metadata' })).toContainText(room.id);
  await dm.getByRole('button', { name: 'Close admin panel' }).click();
  await setTableOptionsOpen(dm, false);
  mark('Admin sees room metadata; an unrelated account cannot read the room or admin directory');

  // F002: the owner renames the table from the top bar; members see it live and in My tables but cannot rename.
  await expect(pip.getByRole('button', { name: 'Rename table', exact: true })).toHaveCount(0);
  await dm.getByRole('button', { name: 'Rename table', exact: true }).click();
  const renameInput = dm.getByLabel('Table name', { exact: true });
  await expect(renameInput).toBeFocused();
  await renameInput.fill('Dragon bridge');
  await renameInput.press('Escape');
  await expect(dm.locator('.tt-workspace-picker__button')).not.toContainText('Dragon bridge');
  await dm.getByRole('button', { name: 'Rename table', exact: true }).click();
  await renameInput.fill('  Dragon bridge  ');
  await renameInput.press('Enter');
  await expect(dm.locator('.tt-workspace-picker__button')).toContainText('Dragon bridge');
  await expect(pip.locator('.tt-workspace-picker__button')).toContainText('Dragon bridge');
  expect((await api(pip, '/api/session')).body.workspaces.find(item => item.id === room.id)?.title).toBe('Dragon bridge');
  const memberRename = await command(pip, 'workspace.rename', { title: 'Stolen name' });
  expect(memberRename.status).toBe(403);
  await dm.getByRole('button', { name: 'Rename table', exact: true }).click();
  await renameInput.fill('   ');
  await renameInput.press('Enter');
  await expect(dm.getByText('A table name needs 1 to 100 characters', { exact: false })).toBeVisible();
  await expect(renameInput).toBeVisible();
  await renameInput.press('Escape');
  await expect(dm.locator('.tt-workspace-picker__button')).toContainText('Dragon bridge');
  mark('Owner renames the table from the top bar; members see the new name live and in My tables, cannot rename, and blank names are refused');

  // /new start page: prepared cards, reload and history, and a typed description that waits in the rule draft.
  const starter = missingLink;
  await starter.getByRole('button', { name: 'Start a new table', exact: true }).click();
  await expect(starter).toHaveURL(`${origin}/new`);
  const startPage = starter.getByTestId('start-page');
  await expect(startPage.getByRole('heading', { name: 'What should we start with?' })).toBeVisible();
  await expect(startPage.getByRole('list', { name: 'Ways to start' }).getByRole('button')).toHaveText([/Invoice check/, /Physics lesson/, /Shared encounter/, /Start empty/]);
  await starter.reload(); await starter.waitForLoadState('networkidle');
  await expect(startPage).toBeVisible();
  await starter.goBack();
  await expect(starter).toHaveURL(`${origin}/tables`);
  await expect(starter.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
  await starter.goForward();
  await expect(startPage).toBeVisible();
  await expect(startPage.getByRole('button', { name: 'Start with this', exact: true })).toBeDisabled();
  const description = 'Track who borrows the team cameras and when they come back.';
  await startPage.getByLabel('Or describe what you want to make').fill(description);
  const createdFromText = starter.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  await startPage.getByRole('button', { name: 'Start with this', exact: true }).click();
  const textRoom = await (await createdFromText).json();
  expect(textRoom.kind).toBe('table');
  await expect(starter).toHaveURL(`${origin}/t/${textRoom.id}`);
  const chat = starter.getByTestId('table-chat-bar');
  const composer = chat.getByRole('textbox', { name: 'Message', exact: true });
  await expect(composer).toHaveValue(description);
  await expect(starter.locator('.tt-canvas-node')).toHaveCount(0);
  await expect(starter.getByTestId('table-chat-answer')).toHaveCount(0);
  expect((await api(starter, `/api/workspaces/${textRoom.id}`)).body.domain.program).toBeNull();
  mark('Start page at /new offers the prepared tables, survives reload and back/forward, and a typed description opens an empty table with the prompt in its chat bar');
  await starter.setViewportSize({ width: 390, height: 844 });
  const canvasBox = await starter.locator('.tt-canvas-panel').boundingBox();
  const chatBox = await chat.boundingBox();
  expect(canvasBox).toBeTruthy();
  expect(chatBox).toBeTruthy();
  expect(chatBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1);
  expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
  expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
  expect(await starter.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await composer.fill(Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n'));
  await expect.poll(() => composer.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(110);
  await composer.fill('first line');
  await composer.press('Shift+Enter');
  await composer.type('second line');
  await expect(composer).toHaveValue('first line\nsecond line');
  mark('F006 chat bar stays inside the narrow Canvas, has no horizontal overflow, and caps multiline entry at five rows');
  const requestsBeforeCancel = providerCalls;
  let modelPosts = 0;
  const countModelPosts = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/model')) modelPosts += 1;
  };
  starter.on('request', countModelPosts);
  await composer.fill('Require consent before a table prompt is sent.');
  await composer.press('Enter');
  const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
  await expect(consent).toBeVisible();
  const consentCopy = (await consent.innerText()).replace(/\s+/gu, ' ');
  expect(consentCopy).toMatch(/current active rules, records, and turn|current table context/iu);
  expect(consentCopy).toContain('Chat history is not included.');
  expect(consentCopy).toContain('Table files included');
  expect(consentCopy).toContain('No table files are attached.');
  expect(consentCopy).toContain('You will not be asked again on this table');
  expect(modelPosts).toBe(0);
  await consent.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(composer).toHaveValue('Require consent before a table prompt is sent.');
  expect(modelPosts).toBe(0);
  expect(providerCalls).toBe(requestsBeforeCancel);
  starter.off('request', countModelPosts);
  mark('F006 Enter opens explicit table-context consent; Cancel preserves the draft message and makes no provider request');
  await starter.setViewportSize({ width: 1440, height: 1000 });

  await openCanvasObject(dm, 'workspace.ai');
  await dm.getByLabel('What would you like to change?', { exact: true }).fill('Allow a shield for an ally, with one AP cost and once each turn.');
  const askAI = dm.getByRole('button', { name: 'Prepare draft', exact: true });
  await expect(askAI).toBeDisabled();
  await dm.getByLabel('Send this request and current rules or parameters to AI.', { exact: true }).check();
  await askAI.click();
  // F039 auto-applies a pending draft of every case kind, so the card goes from "Preparing draft"
  // straight to "Rules in use"; the review-first label is no longer a state this flow reaches.
  await expect(dm.locator('.tt-ai-proposal__job strong')).toHaveText('Rules in use', { timeout: 15_000 });
  // F039: the draft passes every review check and goes into use on its own as a new rule revision.
  await expect(dm.getByText('The new rules are in use.', { exact: true })).toBeVisible({ timeout: 15_000 });
  const proposed = (await api(dm, `/api/workspaces/${room.id}`)).body;
  expect(proposed.domain.candidate.status).toBe('active');
  expect(proposed.domain.candidate.approval?.actorId).toBe(proposed.actor.actorId);
  expect(proposed.domain.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
  expect(proposed.domain.candidate.change.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
  expect(proposed.domain.revisions.at(-1)?.revision).toBe(proposed.domain.ruleRevision);
  expect(providerCalls).toBe(1);
  await expect.poll(async () => (await api(pip, `/api/workspaces/${room.id}`)).body.domain.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
  await expect(pip.getByLabel('What would you like to change?', { exact: true })).toHaveCount(0);
  await expect(pip.getByTestId('canvas-object-dock').getByTestId('open-canvas-workspace.ai')).toHaveCount(0);
  mark('Ask AI uses explicit consent, one mocked provider call and the durable ledger; the draft passes every check and goes into use on its own (F039)');

  const logoutResponse = pip.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
  await setTableOptionsOpen(pip, true);
  await pip.getByRole('button', { name: 'Sign out of Google account' }).click();
  expect((await logoutResponse).status()).toBe(200);
  await expect(pip.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  const stale = await mf.dispatchFetch(`${origin}/api/workspaces/${room.id}`, { headers: { Cookie: `tabletop_local_session=${actors[2].token}` } });
  expect(stale.status).toBe(401);
  // A fresh login for the same stable account recovers the seat without reusing the invitation.
  const replacement = 'Z'.repeat(43);
  await db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(hash(replacement), hash(csrf(replacement)), actors[2].id, Date.now(), Date.now(), Date.now() + 7 * 86_400_000).run();
  await pip.context().addCookies([{ name: 'tabletop_local_session', value: replacement, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  // F004: `/` no longer resumes a table; the account reaches it through its table list.
  await pip.goto(origin);
  await expect(pip.getByRole('heading', { name: 'Welcome back, Pip', exact: true })).toBeVisible();
  await expect(pip.locator('.tt-canvas-panel')).toHaveCount(0);
  await pip.locator('.tt-account-gate__google').click();
  await expect(pip).toHaveURL(`${origin}/tables`);
  await pip.locator('.tt-existing-tables').getByRole('button', { name: /Dragon bridge/ }).click();
  await expect(pip).toHaveURL(`${origin}/t/${room.id}`);
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  const resumed = (await api(pip, `/api/workspaces/${room.id}`)).body;
  expect(resumed.actor.seat).toBe('pip');
  mark('Logout revokes the old cookie; a new session for the same account resumes its existing seat');

  // F004 navigation: landing, table list, logo, table menu and unknown paths each keep their own URL.
  const signInFromLanding = await newPage(null);
  await expect(signInFromLanding.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  await signInFromLanding.context().addCookies([{ name: 'tabletop_local_session', value: actors[0].token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await signInFromLanding.goto(origin); await signInFromLanding.waitForLoadState('networkidle');
  await expect(signInFromLanding).toHaveURL(`${origin}/tables`);
  await expect(signInFromLanding.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
  await signInFromLanding.context().close();
  mark('Signing in from the landing page returns to /tables');
  await dm.goto(origin); await dm.waitForLoadState('networkidle');
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await dm.reload(); await dm.waitForLoadState('networkidle');
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await expect(dm.locator('.tt-canvas-panel')).toHaveCount(0);
  await dm.locator('.tt-account-gate__google').click();
  await expect(dm).toHaveURL(`${origin}/tables`);
  const tableList = dm.locator('.tt-existing-tables');
  await expect(tableList.getByRole('heading', { name: 'Pick up where you left off' })).toBeVisible();
  await expect(tableList.getByRole('button').first()).toContainText('Dragon bridge');
  await expect(tableList.getByRole('button').first()).toContainText('Last opened · ');
  await expect(dm.locator('.tt-canvas-panel')).toHaveCount(0);
  await dm.reload(); await dm.waitForLoadState('networkidle');
  await expect(dm).toHaveURL(`${origin}/tables`);
  await expect(dm.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
  await expect(dm.locator('.tt-canvas-panel')).toHaveCount(0);
  mark('Signed-in `/` survives reload as the landing page; /tables lists the last-opened table first and neither page auto-opens a table, even after reload');
  await tableList.getByRole('button', { name: /Dragon bridge/ }).click();
  await expect(dm).toHaveURL(`${origin}/t/${room.id}`);
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  const tableLogo = dm.locator('.tt-topbar a.tt-brand');
  await expect(tableLogo).toHaveAttribute('aria-label', 'Tabletop home');
  await expect(tableLogo).toHaveAttribute('href', '/');
  await tableLogo.click();
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await dm.goBack();
  await expect(dm).toHaveURL(`${origin}/t/${room.id}`);
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  await dm.locator('.tt-workspace-picker__button').click();
  await dm.locator('.tt-workspace-menu').getByRole('menuitem', { name: /All tables/ }).click();
  await expect(dm).toHaveURL(`${origin}/tables`);
  await expect(dm.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
  const chooserLogo = dm.locator('.tt-chooser__top a.tt-brand');
  await expect(chooserLogo).toHaveAttribute('aria-label', 'Tabletop home');
  await chooserLogo.click();
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await dm.goBack();
  await expect(dm).toHaveURL(`${origin}/tables`);
  await dm.goBack();
  await expect(dm).toHaveURL(`${origin}/t/${room.id}`);
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  mark('Logo goes to `/` and Back returns to the table; the table menu "All tables" opens /tables and the chooser logo also goes to `/`');
  await dm.goto(`${origin}/no-such-page`); await dm.waitForLoadState('networkidle');
  await expect(dm).toHaveURL(`${origin}/`);
  await expect(dm.getByRole('heading', { name: 'Welcome back, DM', exact: true })).toBeVisible();
  await dm.goto(`${origin}/t/${room.id}`); await dm.waitForLoadState('networkidle');
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  mark('An unknown path shows the landing page at `/`');
  await verifyGenericTableBrowser({
    actors: { owners: genericOwners, members: genericMembers },
    newPage,
    api,
    setTableReply: value => { tableAIReply = value; },
    setAssistantReply: value => { tableAssistantReply = value; },
    getProviderCalls: () => providerCalls,
    mark,
  });
  await dm.screenshot({ path: join(output, 'dm-desktop.png'), fullPage: true });
  await pip.setViewportSize({ width: 390, height: 844 }); await pip.reload();
  await expect(pip.getByRole('button', { name: 'Canvas', exact: true })).toHaveCount(0);
  await expect(pip.getByRole('button', { name: /^(Use|Arrange)$/ })).toHaveCount(0);
  await expect(pip.getByTestId('canvas-object-menu-trigger')).toBeVisible();
  await expect(pip.locator('.tt-canvas-panel')).toBeVisible();
  await pip.screenshot({ path: join(output, 'player-mobile.png'), fullPage: true });
  expect(errors).toEqual([]);
  mark('Desktop and mobile render without uncaught browser errors');
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors, runtime: 'local Cloudflare Workers, D1 and SQLite Durable Objects', googleLogin: 'synthetic session fixtures; OAuth verified separately', ai: 'synthetic outbound provider, real local ledger and room commit; no paid calls', providerCalls }, null, 2));
} catch (error) {
  for (let i = 0; i < pages.length; i++) if (!pages[i].isClosed()) await pages[i].screenshot({ path: join(output, `failure-${i}.png`) }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors, providerCalls, modelStatuses, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser?.close(); await mf.dispose();
}
