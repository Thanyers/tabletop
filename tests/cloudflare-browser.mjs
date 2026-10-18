// Disposable local Workers runtime. All accounts and session tokens below are synthetic.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { chromium, expect } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const listener = createServer();
await new Promise(resolveReady => listener.listen(0, '127.0.0.1', resolveReady));
const port = listener.address().port;
await new Promise(resolveClosed => listener.close(resolveClosed));
const origin = `http://127.0.0.1:${port}`;
const hash = text => createHash('sha256').update(text).digest('hex');
const csrf = token => createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
const output = resolve('test-results/cloudflare-browser');
let providerCalls = 0;
const modelStatuses = [];
await mkdir(output, { recursive: true });
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
    return Response.json({ model: 'deepseek-flash',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify({ kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } }) } }],
      usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 30, completion_tokens_details: { reasoning_tokens: 0 } },
    });
  },
  assets: { directory: resolve('dist'), binding: 'ASSETS',
    run_worker_first: ['/api/*', '/healthz', '/readyz', '/internal/*'],
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
  const schema = await readFile('cloudflare/migrations/0001_identity.sql', 'utf8');
  await db.batch(schema.replace(/^--.*$/gmu, '').split(';').map(sql => sql.trim()).filter(Boolean).map(sql => db.prepare(sql)));
  const actors = ['DM', 'Mira', 'Pip', 'Outsider'].map((name, i) => ({ id: randomUUID(), name, token: String.fromCharCode(65 + i).repeat(43) }));
  const now = Date.now();
  for (const actor of actors) await db.batch([
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
  const anonymous = await newPage();
  await expect(anonymous.getByRole('link', { name: 'Continue with Google' })).toBeVisible();
  expect((await api(anonymous, '/api/session')).status).toBe(401);
  mark('Anonymous browser is gated by Google sign-in; no guest account is created');

  const dm = await newPage(actors[0]);
  dm.on('response', async response => {
    if (/\/model(?:\/[a-f0-9]{64})?$/.test(new URL(response.url()).pathname)) {
      const body = await response.json().catch(() => null);
      modelStatuses.push({ http: response.status(), body });
    }
  });
  await expect(dm.getByRole('heading', { name: 'Choose a table' })).toBeVisible();
  const created = dm.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  await dm.getByRole('button', { name: /Shared encounter.*Run turns/ }).click();
  const createdResponse = await created;
  expect(createdResponse.status()).toBe(201);
  let room = await createdResponse.json();
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  let miraInvite = await api(dm, `/api/workspaces/${room.id}/invites`, { seat: 'mira' });
  const pipInvite = await api(dm, `/api/workspaces/${room.id}/invites`, { seat: 'pip' });
  expect(miraInvite.status).toBe(201); expect(pipInvite.status).toBe(201);
  // The first response is intentionally ignored by the owner UI, like a lost acknowledgement.
  const lostTicket = miraInvite.body.ticket;
  await dm.getByRole('button', { name: 'Invite', exact: true }).click();
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
  const action = dm.waitForResponse(response => response.url().endsWith('/commands') && response.request().postDataJSON()?.type === 'encounter.declareHit');
  await dm.getByRole('button', { name: 'Hit Pip', exact: true }).click();
  expect((await action).status()).toBe(200);
  await expect.poll(async () => (await api(pip, `/api/workspaces/${room.id}`)).body.domain.phase).toBe('reaction.open');
  const pipProjection = (await api(pip, `/api/workspaces/${room.id}`)).body;
  expect(pipProjection.domain.pendingHit.roll).toBeNull();
  expect(pipProjection.domain.pendingHit.damage).toBeNull();
  expect(JSON.stringify(pipProjection)).not.toContain('PRIVATE_DM_CF_BROWSER_MARKER');
  expect((await command(pip, 'encounter.resolve')).status).toBe(403);
  expect((await command(dm, 'encounter.pause')).status).toBe(200);
  const pausedAction = await command(pip, 'encounter.shield', { target: 'pip' });
  expect(pausedAction.status).toBe(422);
  expect(pausedAction.body.errorCode).toBe('ENCOUNTER_PAUSED');
  await dm.reload();
  await expect(dm.locator('.tt-canvas-panel')).toBeVisible();
  expect((await api(dm, `/api/workspaces/${room.id}`)).body.domain.paused).toBeTruthy();
  expect((await command(dm, 'encounter.resume')).status).toBe(200);
  expect((await command(pip, 'encounter.shield', { target: 'pip' })).status).toBe(200);
  expect((await command(dm, 'encounter.resolve')).status).toBe(200);
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  await pip.reload();
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  mark('Live multiplayer respects DM/player privacy; pause/resume and committed HP survive browser reload');

  const outsider = await newPage(actors[3]);
  expect((await api(outsider, `/api/workspaces/${room.id}`)).status).toBe(403);
  expect((await api(outsider, '/api/admin/workspaces')).status).toBe(403);
  const metadata = await api(dm, '/api/admin/workspaces');
  expect(metadata.status).toBe(200);
  expect(JSON.stringify(metadata.body)).not.toContain('PRIVATE_DM_CF_BROWSER_MARKER');
  expect(metadata.body.workspaces.some(item => item.id === room.id)).toBe(true);
  await dm.getByRole('button', { name: 'Admin', exact: true }).click();
  await expect(dm.getByRole('dialog', { name: 'Table metadata' })).toContainText(room.id);
  await dm.getByRole('button', { name: 'Close admin panel' }).click();
  mark('Admin sees room metadata; an unrelated account cannot read the room or admin directory');

  await dm.getByRole('button', { name: 'Focus table', exact: true }).click();
  await dm.getByLabel('What should the draft change or explain?').fill('Allow a shield for an ally, with one AP cost and once each turn.');
  const askAI = dm.getByRole('button', { name: 'Ask AI for a draft', exact: true });
  await expect(askAI).toBeDisabled();
  await dm.getByLabel('I agree to send this request for an AI draft.').check();
  await askAI.click();
  await expect(dm.getByText('Draft ready for review', { exact: true })).toBeVisible({ timeout: 15_000 });
  const proposed = (await api(dm, `/api/workspaces/${room.id}`)).body;
  expect(proposed.domain.candidate.status).toBe('draft');
  expect(proposed.domain.rule).toEqual({ allyTarget: false, apCost: 0, oncePerTurn: false });
  expect(proposed.domain.candidate.change.rule).toEqual({ allyTarget: true, apCost: 1, oncePerTurn: true });
  expect(providerCalls).toBe(1);
  await expect(pip.getByLabel('What should the draft change or explain?')).toHaveCount(0);
  mark('Ask AI uses explicit consent, one mocked provider call and the durable ledger; creates a draft without activating it');

  const logoutResponse = pip.waitForResponse(response => response.url().endsWith('/api/auth/logout'));
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
  await pip.goto(origin);
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  const resumed = (await api(pip, `/api/workspaces/${room.id}`)).body;
  expect(resumed.actor.seat).toBe('pip');
  mark('Logout revokes the old cookie; a new session for the same account resumes its existing seat');
  await dm.screenshot({ path: join(output, 'dm-desktop.png'), fullPage: true });
  await pip.setViewportSize({ width: 390, height: 844 }); await pip.reload();
  await expect(pip.getByRole('button', { name: 'Focus table', exact: true })).toHaveAttribute('aria-pressed', 'true');
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
