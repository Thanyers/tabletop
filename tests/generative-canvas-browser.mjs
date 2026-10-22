// End-to-end generated Canvas checks against disposable local Workers, D1 and SQLite DOs.
// Login identities and model replies are synthetic; the only provider URL is intercepted locally.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { chromium, expect } from '@playwright/test';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  cafeQueueChange,
  cooperativeWaterChange,
  lightShadowChange,
  loanAmortizationChange,
} from '../src/tabletop/testing/generative-scenarios.ts';

const output = resolve('test-results/generative-canvas');
for (const required of ['dist/index.html', 'worker-build/index.js']) {
  if (!existsSync(required)) throw new Error(`Build output is missing: ${required}. Build the app and Cloudflare worker before running this harness.`);
}
await mkdir(output, { recursive: true });

const listener = createServer();
await new Promise((ready) => listener.listen(0, '127.0.0.1', ready));
const port = listener.address().port;
await new Promise((closed) => listener.close(closed));
const origin = `http://127.0.0.1:${port}`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const csrf = (token) => createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
const checks = [];
const browserErrors = [];
const blockedExternal = [];
const providerResponses = [];
const tableActRequests = [];
let providerCalls = 0;
let lastUiDiagnostics = null;
let browser;
const pages = [];
const actorsById = new Map();

const mark = (message) => { checks.push(message); console.log(`PASS ${message}`); };
const literalExpression = (value) => ({ op: 'literal', value });

function responseAfter(page, predicate) {
  // Keep the response waiter handled even if the following UI action fails first.
  const pending = page.waitForResponse(predicate).then(
    (response) => ({ response }),
    (error) => ({ error }),
  );
  return async (action) => {
    await action();
    const result = await pending;
    if (result.error) throw result.error;
    return result.response;
  };
}

const sourceFixtures = {
  shadow: {
    filename: 'synthetic-shadow-geometry.txt',
    text: 'Synthetic light model: light starts at (20,10), object x=50, object top y=50, ground y=90. Move the light to recalculate the shadow tip.',
  },
  novel: {
    filename: 'synthetic-loan-terms.txt',
    text: 'Synthetic loan terms: principal=1000; annual rate=0.12; term=12 months. Calculate a monthly payment using monthly compounding.',
  },
};

function novelChange(source) {
  const change = structuredClone(loanAmortizationChange);
  change.program.evidence = [{ sourceId: source.id, quote: source.text }];
  change.program.canvas = {
    version: 1,
    views: [
      {
        id: 'monthly-payment', kind: 'metric', title: 'Monthly payment',
        value: { op: 'recordField', collection: 'loans', recordId: 'loan-1', field: 'payment' },
        format: 'number', relatedTo: { collections: ['loans'] },
      },
      {
        id: 'loan-controls', kind: 'controls', title: 'Loan calculation', relatedTo: { collections: ['loans'] },
        controls: [{
          id: 'recalculate-payment', kind: 'button', label: 'Recalculate payment', actionId: 'recalculate',
          inputs: { loan: { kind: 'record', collection: 'loans', recordId: 'loan-1' } },
        }],
      },
    ],
  };
  return change;
}

function waterBrowserChange() {
  const change = structuredClone(cooperativeWaterChange);
  change.program.turnOrder = ['member-1', 'host', 'member-2'];
  return change;
}

function decorateForSource(change, source) {
  const result = structuredClone(change);
  if (source) result.program.evidence = [{ sourceId: source.id, quote: source.text }];
  return result;
}

function incrementalEdit(input) {
  const program = structuredClone(input.program);
  const previous = program.canvas?.views ?? [];
  const relatedView = previous[0]?.id;
  program.description = `${program.description} Incremental Canvas revision.`;
  program.canvas ??= { version: 1, views: [] };
  program.canvas.views.push({
    id: 'incremental-result', kind: 'metric', title: 'Incremental result',
    value: literalExpression(previous.length + 1), format: 'number',
    ...(relatedView ? { relatedTo: { views: [relatedView] } } : {}),
  });
  return { kind: 'table', program, initialRecords: {} };
}

function scenarioForInput(input) {
  const prompt = String(input.prompt ?? '');
  const id = ['cafe', 'shadow', 'water', 'novel'].find((name) => prompt.includes(`scenario:${name}`));
  if (!id) throw new Error(`Synthetic provider received an unknown scenario prompt: ${prompt.slice(0, 80)}`);
  if (prompt.includes('phase:incremental-edit')) return { id, change: incrementalEdit(input), edit: true };
  if (id === 'cafe') return { id, change: cafeQueueChange, edit: false };
  if (id === 'shadow') return { id, change: decorateForSource(lightShadowChange, input.sources?.[0]), edit: false };
  if (id === 'water') return { id, change: waterBrowserChange(), edit: false };
  const source = input.sources?.[0];
  if (!source) throw new Error('The synthetic loan case requires its attached source file.');
  return { id, change: novelChange(source), edit: false };
}

const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1',
  port,
  log: new Log(LogLevel.ERROR),
  workers: [{
    name: 'generative-canvas-local-browser-fixture',
    modules: true,
    scriptPath: resolve('worker-build/index.js'),
    compatibilityDate: '2026-10-18',
    compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'],
    durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, BILLING: { className: 'Billing', useSQLite: true } },
    bindings: {
      PUBLIC_ORIGIN: origin,
      GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client',
      GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
      DEEPSEEK_KEY: 'synthetic-provider-key',
      AI_MONTHLY_BUDGET_MICRO_USD: '1000000',
      AI_DAILY_BUDGET_MICRO_USD: '1000000',
    },
    outboundService: async (request) => {
      if (request.url !== 'https://api.deepseek.com/chat/completions') {
        blockedExternal.push(request.url);
        throw new Error(`Unexpected external worker request: ${new URL(request.url).origin}`);
      }
      providerCalls += 1;
      const body = await request.json();
      expect(body.model).toBe('deepseek-flash');
      const input = JSON.parse(body.messages?.[1]?.content ?? '{}');
      expect(input.kind).toBe('table');
      const reply = scenarioForInput(input);
      const attached = input.sources?.[0];
      if (reply.id === 'shadow') {
        expect(attached?.filename).toBe(sourceFixtures.shadow.filename);
        expect(attached?.text).toBe(sourceFixtures.shadow.text);
      } else if (reply.id === 'novel') {
        expect(attached?.filename).toBe(sourceFixtures.novel.filename);
        expect(attached?.text).toBe(sourceFixtures.novel.text);
      } else expect(input.sources).toEqual([]);
      providerResponses.push({ scenario: reply.id, edit: reply.edit, attachedFile: Boolean(attached) });
      return Response.json({
        model: 'deepseek-flash',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(reply.change) } }],
        usage: {
          prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 30,
          completion_tokens_details: { reasoning_tokens: 0 },
        },
      });
    },
    assets: {
      directory: resolve('dist'),
      binding: 'ASSETS',
      run_worker_first: ['/api/*', '/healthz', '/readyz', '/version', '/internal/*'],
      routerConfig: { has_user_worker: true },
      assetConfig: { not_found_handling: 'single-page-application' },
    },
  }],
}));

try {
  await mf.ready;
  const db = await mf.getD1Database('DB');
  for (const migration of ['0001_identity.sql', '0002_table_kind.sql']) {
    const source = await readFile(resolve('cloudflare/migrations', migration), 'utf8');
    const statements = source.replace(/^--.*$/gmu, '').split(';').map((sql) => sql.trim()).filter(Boolean);
    await db.batch(statements.map((sql) => db.prepare(sql)));
  }

  const cases = [
    { id: 'cafe', file: null, action: 'button' },
    { id: 'shadow', file: sourceFixtures.shadow, action: 'scene-drag' },
    { id: 'water', file: null, action: 'slider' },
    { id: 'novel', file: sourceFixtures.novel, action: 'button' },
  ];
  const actors = cases.flatMap(({ id }) => [
    { id: randomUUID(), name: `${id} Owner`, token: randomBytes(32).toString('base64url'), role: 'owner' },
    { id: randomUUID(), name: `${id} Member One`, token: randomBytes(32).toString('base64url'), role: 'member-1' },
    { id: randomUUID(), name: `${id} Member Two`, token: randomBytes(32).toString('base64url'), role: 'member-2' },
  ]);
  const now = Date.now();
  for (const actor of actors) {
    actorsById.set(actor.name, actor);
    await db.batch([
      db.prepare('INSERT INTO users(id,provider_sub,email,name,is_admin,created_at) VALUES(?,?,?,?,?,?)')
        .bind(actor.id, `fixture:${actor.id}`, `${actor.id}@example.test`, actor.name, 0, now),
      db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
        .bind(sha256(actor.token), sha256(csrf(actor.token)), actor.id, now, now, now + 7 * 86_400_000),
    ]);
  }
  const authProbe = await fetch(`${origin}/api/auth/status`);
  if (!authProbe.ok) throw new Error(`Local fixture authentication failed: ${authProbe.status}`);
  browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });

  async function newPage(actor, url = origin) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 980 }, reducedMotion: 'reduce' });
    if (actor) await context.addCookies([{
      name: 'tabletop_local_session', value: actor.token, url: origin, httpOnly: true, sameSite: 'Lax',
    }]);
    const page = await context.newPage();
    pages.push(page);
    page.on('pageerror', (error) => browserErrors.push(error.message));
    page.on('request', (request) => {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin !== origin) blockedExternal.push(`${request.method()} ${requestUrl.origin}`);
      if (requestUrl.pathname.endsWith('/commands') && request.method() === 'POST') {
        try {
          if (request.postDataJSON()?.type === 'table.act') tableActRequests.push(requestUrl.pathname);
        } catch { /* Non-JSON requests are not table commands. */ }
      }
    });
    await page.route((requestUrl) => new URL(requestUrl).origin !== origin, (route) => route.abort());
    await page.goto(url);
    await page.waitForLoadState('networkidle');
    return page;
  }

  async function api(page, path, body) {
    return page.evaluate(async ({ path, body }) => {
      const sessionResponse = await fetch('/api/session');
      const session = sessionResponse.ok ? await sessionResponse.json() : {};
      const options = body === undefined ? {} : {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrfToken ?? '' },
        body: JSON.stringify(body),
      };
      const response = await fetch(path, options);
      const text = await response.text();
      let parsed;
      try { parsed = JSON.parse(text); } catch { parsed = text; }
      return { status: response.status, body: parsed };
    }, { path, body });
  }

  async function openObjects(page) {
    const trigger = page.getByTestId('canvas-object-menu-trigger');
    await expect(trigger).toBeVisible();
    if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
    const dock = page.getByTestId('canvas-object-dock');
    await expect(dock).toBeVisible();
    return dock;
  }

  async function waitForStableBoundingBox(locator) {
    let previous = null;
    let stableSince = 0;
    await expect.poll(async () => {
      const box = await locator.boundingBox();
      if (!box) { previous = null; stableSince = 0; return false; }
      const current = [box.x, box.y, box.width, box.height];
      const stable = previous !== null && current.every((value, index) => Math.abs(value - previous[index]) < 0.5);
      if (stable) stableSince ||= Date.now();
      else stableSince = 0;
      previous = current;
      return stableSince > 0 && Date.now() - stableSince >= 180;
    }, { timeout: 3_000, intervals: [50, 100, 150] }).toBe(true);
  }

  async function openCanvasObject(page, id) {
    const editor = page.getByTestId('canvas-object-editor');
    if (!(await editor.isVisible().catch(() => false) && await editor.getAttribute('data-canvas-object') === id)) {
      const dock = await openObjects(page);
      const button = dock.getByTestId(`open-canvas-${id}`);
      await expect(button).toBeVisible();
      await button.click();
      await expect(editor).toHaveAttribute('data-canvas-object', id);
      await expect(editor).toBeVisible();
    }
    await waitForStableBoundingBox(editor);
    return editor;
  }

  async function requestCanvasObjectFocusImmediately(page, id) {
    const editor = page.getByTestId('canvas-object-editor');
    const dock = await openObjects(page);
    const button = dock.getByTestId(`open-canvas-${id}`);
    await expect(button).toBeVisible();
    await button.click();
    await expect(editor).toHaveAttribute('data-canvas-object', id);
    await expect(editor).toBeVisible();
    return editor;
  }

  async function readCanvasViewport(page) {
    return page.locator('.react-flow__viewport').evaluate((element) => {
      const transform = getComputedStyle(element).transform;
      const matrix = transform === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
      return { x: matrix.m41, y: matrix.m42, zoom: matrix.a };
    });
  }

  async function waitForStableCanvasViewport(page) {
    await page.waitForTimeout(350);
    let previous = null;
    let stableSamples = 0;
    await expect.poll(async () => {
      const current = await readCanvasViewport(page);
      const stable = previous !== null
        && Math.abs(current.x - previous.x) < 0.5
        && Math.abs(current.y - previous.y) < 0.5
        && Math.abs(current.zoom - previous.zoom) < 0.001;
      stableSamples = stable ? stableSamples + 1 : 0;
      previous = current;
      return stableSamples >= 2;
    }, { timeout: 3_000, intervals: [50, 100, 150] }).toBe(true);
    return readCanvasViewport(page);
  }

  async function assertZoomSurvivesPendingObjectFocus(page, tableId, nodeId) {
    const editor = page.getByTestId('canvas-object-editor');
    const closeCurrentEditor = async () => {
      const closeObject = page.getByRole('button', { name: /^Minimize /u });
      if (await closeObject.count() > 0) {
        await closeObject.first().click();
        await expect(editor).toHaveCount(0);
      }
    };
    await closeCurrentEditor();
    await waitForStableCanvasViewport(page);
    await closeCurrentEditor();
    await expect(editor).toHaveCount(0);
    const waitForVisibleSharedPositions = async () => {
      await expect.poll(async () => {
        const nodeStates = await page.locator('.tt-canvas-node').evaluateAll((nodes) => nodes.map((node) => ({
          id: node.closest('.react-flow__node')?.getAttribute('data-id'),
          opened: node.getAttribute('data-testid') === 'canvas-object-editor',
        })));
        const visibleStates = nodeStates.filter(({ id }) => id && (/^table\.(collection|view)\.[a-z][a-z0-9_-]{0,39}$|^table\.(actions|rules)$|^workspace\.(people|history)$/).test(id));
        const eligibleIds = visibleStates.filter(({ opened }) => !opened).map(({ id }) => id);
        const domain = (await api(page, `/api/workspaces/${tableId}`)).body.domain;
        const missingIds = eligibleIds.filter((id) => {
          const position = domain.canvasLayout?.positions?.[id];
          return !position || !Number.isFinite(position.x) || !Number.isFinite(position.y);
        });
        return {
          ready: eligibleIds.length > 0 && missingIds.length === 0,
          eligibleIds,
          openedIds: visibleStates.filter(({ opened }) => opened).map(({ id }) => id),
          missingIds,
        };
      }, { timeout: 10_000, intervals: [50, 100, 150] }).toMatchObject({ ready: true });
    };
    await waitForVisibleSharedPositions();
    await waitForStableCanvasViewport(page);
    await waitForVisibleSharedPositions();
    await expect(editor).toHaveCount(0);
    const before = (await api(page, `/api/workspaces/${tableId}`)).body.domain;
    const beforeViewport = await readCanvasViewport(page);
    const mutatingRequests = [];
    const recordMutation = request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutatingRequests.push(`${request.method()} ${requestUrl.pathname}`);
      }
    };
    page.on('request', recordMutation);
    try {
      const dock = await openObjects(page);
      const openCard = dock.getByTestId(`open-canvas-${nodeId}`);
      const zoomIn = page.getByRole('button', { name: 'Zoom In', exact: true });
      await expect(openCard).toBeVisible();
      await expect(zoomIn).toBeVisible();
      // Keep the two real pointer clicks adjacent: the second lands while the opened card's
      // geometry-based focus request is still pending, without waiting for the card to settle.
      await openCard.click();
      await zoomIn.click();
      await expect.poll(async () => (await readCanvasViewport(page)).zoom)
        .toBeGreaterThan(beforeViewport.zoom);
      const zoomAfterClick = await readCanvasViewport(page);
      await expect(editor).toHaveAttribute('data-canvas-object', nodeId);
      await expect(editor).toBeVisible();
      await waitForStableBoundingBox(editor);
      const settledViewport = await waitForStableCanvasViewport(page);
      expect(zoomAfterClick.zoom).toBeGreaterThan(beforeViewport.zoom);
      expect(Math.abs(settledViewport.zoom - zoomAfterClick.zoom)).toBeLessThan(0.01);
      expect(Math.abs(settledViewport.x - zoomAfterClick.x)).toBeLessThan(1);
      expect(Math.abs(settledViewport.y - zoomAfterClick.y)).toBeLessThan(1);
      const after = (await api(page, `/api/workspaces/${tableId}`)).body.domain;
      expect(mutatingRequests).toEqual([]);
      expect(after).toEqual(before);
      mark('Generated card open followed immediately by user zoom; settled viewport retained the zoom with no API mutations');
    } finally {
      page.off('request', recordMutation);
    }
  }

  async function createFreshTable(owner) {
    const created = responseAfter(owner, (response) => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
    await owner.getByRole('button', { name: 'Start a new table', exact: true }).click();
    const startPage = owner.getByTestId('start-page');
    await expect(startPage.getByRole('heading', { name: 'What should we start with?' })).toBeVisible();
    await expect(owner).toHaveURL(/\/new$/);
    const response = await created(() => startPage.getByRole('button', { name: 'Start empty with your own files', exact: true }).click());
    expect(response.status()).toBe(201);
    const room = await response.json();
    await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
    await expect(owner.getByTestId('table-chat-bar')).toBeVisible();
    await expect(owner.locator('.tt-canvas-node')).toHaveCount(0);
    return room;
  }

  async function attachSource(owner, tableId, file) {
    const bar = owner.getByTestId('table-chat-bar');
    await expect(bar).toBeVisible();
    await bar.getByLabel('Choose a file to attach', { exact: true }).setInputFiles({
      name: file.filename, mimeType: 'text/plain', buffer: Buffer.from(file.text, 'utf8'),
    });
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.sources.length).toBe(1);
    const current = await api(owner, `/api/workspaces/${tableId}`);
    const source = current.body.domain.sources[0];
    expect(source).toMatchObject({ filename: file.filename, text: file.text });
    return source;
  }

  async function sendTableMessage(page, promptText, { sourceNames = [], expectConsent = true, cancelFirst = false, workspaceId = null } = {}) {
    const bar = page.getByTestId('table-chat-bar');
    const composer = bar.getByRole('textbox', { name: 'Message', exact: true });
    const submit = bar.getByRole('button', { name: 'Send message', exact: true });
    await expect(composer).toBeVisible();
    await composer.fill(promptText);
    const consent = bar.getByRole('alertdialog', { name: 'Send to AI', exact: true });
    if (!expectConsent) {
      // F013: one grant covers this actor on this table epoch, so a later request sends straight away.
      const modelPost = (request) => request.method() === 'POST' && /\/api\/workspaces\/[^/]+\/model$/.test(new URL(request.url()).pathname);
      const response = responseAfter(page, (item) => modelPost(item.request()));
      const sent = await response(() => submit.click());
      await expect(consent).toHaveCount(0);
      expect(sent.request().postDataJSON()).toMatchObject({ prompt: promptText, consent: true });
      return sent;
    }
    let modelPosts = 0;
    const countModelPosts = (request) => {
      if (request.method() === 'POST' && /\/api\/workspaces\/[^/]+\/model$/.test(new URL(request.url()).pathname)) modelPosts += 1;
    };
    page.on('request', countModelPosts);
    try {
      await submit.click();
      await expect(consent).toBeVisible();
      const dialogText = (await consent.innerText()).replace(/\s+/gu, ' ');
      expect(dialogText).toMatch(/current active rules, records, and turn|current table context/iu);
      expect(dialogText).toContain('Chat history is not included.');
      expect(dialogText).toContain('Table files included');
      for (const filename of sourceNames) expect(dialogText).toContain(filename);
      if (sourceNames.length === 0) expect(dialogText).toMatch(/no table files are attached|not included/iu);
      expect(dialogText).toContain('You will not be asked again on this table');
      if (cancelFirst) {
        expect(modelPosts).toBe(0);
        await consent.getByRole('button', { name: 'Cancel', exact: true }).click();
        await expect(consent).toHaveCount(0);
        await expect(composer).toHaveValue(promptText);
        expect(modelPosts).toBe(0);
        await submit.click();
        await expect(consent).toBeVisible();
        for (const filename of sourceNames) expect((await consent.innerText()).replace(/\s+/gu, ' ')).toContain(filename);
      }
      expect(modelPosts).toBe(0);
      const sendButton = consent.getByRole('button', { name: 'Send', exact: true });
      await expect(sendButton).toBeEnabled();
      const modelPost = (request) => request.method() === 'POST' && /\/api\/workspaces\/[^/]+\/model$/.test(new URL(request.url()).pathname);
      const response = responseAfter(page, (item) => modelPost(item.request()) && item.request().method() === 'POST');
      const requestObserved = page.waitForRequest(modelPost, { timeout: 5_000 }).then(
        (request) => ({ request }),
        (error) => ({ error }),
      );
      await sendButton.evaluate((button) => {
        window.__tableChatConsentClickCount = 0;
        button.addEventListener('click', () => { window.__tableChatConsentClickCount += 1; }, { capture: true, once: true });
      });
      try {
        await sendButton.click();
        // Consent acceptance closes the dialog synchronously in the UI before the request resolves.
        // This makes a click that never reaches the handler distinguishable from a slow endpoint.
        await expect(consent).toHaveCount(0, { timeout: 3_000 });
        const observed = await requestObserved;
        if (observed.error) throw observed.error;
        expect(modelPosts).toBe(1);
        return await response(() => Promise.resolve());
      } catch (error) {
        const clickCount = await page.evaluate(() => window.__tableChatConsentClickCount ?? 0).catch(() => null);
        const sendState = await sendButton.evaluate((button) => ({
          disabled: button.disabled,
          ariaDisabled: button.getAttribute('aria-disabled'),
          text: button.textContent?.trim() ?? '',
        })).catch(() => null);
        const uiState = {
          promptText,
          workspaceId,
          sourceNames,
          modelPosts,
          consentVisible: await consent.isVisible().catch(() => false),
          composerEnabled: await composer.isEnabled().catch(() => false),
          sendState,
          consentClickCount: clickCount,
          barText: (await bar.innerText().catch(() => '')).replace(/\s+/gu, ' ').slice(0, 1_000),
          workspace: workspaceId ? await api(page, `/api/workspaces/${workspaceId}`).catch((apiError) => ({ error: String(apiError) })) : null,
        };
        lastUiDiagnostics = uiState;
        const requestState = await requestObserved;
        throw new Error(`Consent Send handoff failed: ${error instanceof Error ? error.message : String(error)}\n${JSON.stringify({ ...uiState, requestObserved: !requestState.error, requestError: requestState.error ? String(requestState.error) : undefined }, null, 2)}`, { cause: error });
      }
    } finally {
      page.off('request', countModelPosts);
    }
  }

  function draftPrompt(scenario, phase) {
    return `scenario:${scenario.id}; phase:${phase}. Create a bounded, understandable Canvas for this synthetic fixture.`;
  }

  function draftCardForPrompt(page, prompt) {
    const draftNode = page.locator('.tt-canvas-node--auxiliary').filter({ hasText: prompt.slice(0, 36) }).first();
    return draftNode.getByTestId('table-chat-answer');
  }

  async function askForDraft(owner, tableId, scenario, phase, file, { cancelFirst = false, expectConsent = true } = {}) {
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
    if (before.domain.program || before.domain.candidate?.status === 'active') {
      const rules = await openCanvasObject(owner, 'table.rules');
      await clickVisible(rules.getByRole('button', { name: 'Edit rules', exact: true }));
    }
    const sourceNames = before.domain.sources.map((source) => source.filename);
    const prompt = draftPrompt(scenario, phase);
    const response = await sendTableMessage(owner, prompt, { sourceNames, cancelFirst, expectConsent, workspaceId: tableId });
    expect(response?.status()).toBe(202);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe('draft');
    const candidate = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(candidate.domain.program).toEqual(before.domain.program);
    expect(candidate.domain.records).toEqual(before.domain.records);
    expect(candidate.domain.candidate?.change.kind).toBe('table');
    const draftCard = draftCardForPrompt(owner, prompt);
    await expect(draftCard).toBeVisible({ timeout: 30_000 });
    await expect(draftCard).toContainText('A rule draft is ready. Review it before anyone uses it.', { timeout: 30_000 });
    await expect(draftCard.getByRole('button', { name: 'Review rules', exact: true })).toBeEnabled();
    return candidate;
  }

  async function assertPrivateCandidatePreview(owner, tableId, candidate, expectedControl, prompt) {
    const draftCard = draftCardForPrompt(owner, prompt);
    await expect(draftCard).toContainText('A rule draft is ready. Review it before anyone uses it.', { timeout: 30_000 });
    await clickVisible(draftCard.getByRole('button', { name: 'Review rules', exact: true }));
    const editor = owner.getByTestId('canvas-object-editor');
    await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
    await expect(editor).toBeVisible();
    await waitForStableBoundingBox(editor);
    await openReviewSection(editor, 'tt-table-private-preview');
    const preview = editor.getByRole('region', { name: 'Proposed generated canvas preview', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Trial changes stay in this private copy; the active table is unchanged.');
    await exercisePrivateTrial(owner, tableId, candidate, preview, expectedControl);
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
    await openReviewSection(editor, 'tt-table-advanced-checks');
    const previewStep = editor.getByRole('button', { name: 'Preview change', exact: true });
    await previewStep.scrollIntoViewIfNeeded();
    await expect(previewStep).toBeInViewport();
    const responsePromise = responseAfter(owner, (response) => isCommandResponse(response, 'evolve.simulate'));
    expect((await responsePromise(() => previewStep.click())).status()).toBe(200);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe('simulated');
    const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(after.domain.program).toEqual(before.domain.program);
    expect(after.domain.records).toEqual(before.domain.records);
    expect(after.domain.dataRevision).toBe(before.domain.dataRevision);
    expect(candidate.domain.candidate?.change.program.canvas?.views.length).toBeGreaterThan(0);
    return editor;
  }

  async function clickVisible(locator) {
    await locator.scrollIntoViewIfNeeded();
    await expect(locator).toBeInViewport();
    await locator.click();
  }

  async function openReviewSection(editor, className) {
    const section = editor.locator(`details.${className}`);
    if (await section.getAttribute('open') === null) await clickVisible(section.locator('summary').first());
  }

  async function assertTrialDidNotChangeActiveTable(owner, tableId, before, requestCount) {
    const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
    for (const key of ['program', 'records', 'dataRevision', 'ruleRevision', 'actionRevision']) {
      expect(after.domain[key]).toEqual(before.domain[key]);
    }
    expect(after.domain.candidate?.status).toBe(before.domain.candidate?.status);
    expect(after.domain.candidate?.change).toEqual(before.domain.candidate?.change);
    expect(tableActRequests).toHaveLength(requestCount);
  }

  async function exercisePrivateTrial(owner, tableId, candidate, preview, expectedControl) {
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const requestCount = tableActRequests.length;
    const candidateInitialRecords = candidate.domain.candidate?.change?.initialRecords ?? {};
    const trialRecords = Object.keys(candidateInitialRecords).length ? candidateInitialRecords : before.domain.records;
    if (expectedControl === 'Advance 5 minutes') {
      const scene = preview.getByRole('region', { name: 'Cafe floor', exact: true });
      const metric = preview.getByRole('region', { name: 'Average queue wait', exact: true }).locator('.tt-generated-metric strong');
      const queue = trialRecords.queue;
      const clock = trialRecords.clock.find((record) => record.id === 'clock-1').values.minute;
      const selectedOrder = queue.find((record) => record.id === 'order-1');
      const expectedWait = clock - selectedOrder.values.arrived_at;
      const expectedAverageWait = queue.reduce((sum, record) => sum + (record.id === 'order-1' ? expectedWait : record.values.wait_minutes), 0) / queue.length;
      const baselineAverageWait = queue.reduce((sum, record) => sum + record.values.wait_minutes, 0) / queue.length;
      const form = preview.locator('.tt-generated-control__form').filter({ hasText: 'Start service' });
      await form.locator('select').nth(0).selectOption('order-1');
      await form.locator('select').nth(1).selectOption('staff-1');
      await clickVisible(form.getByRole('button', { name: 'Start service', exact: true }));
      await expect(scene).toContainText('serving');
      await expect(metric).toHaveText(String(expectedAverageWait));
      await clickVisible(preview.getByRole('button', { name: 'Reset trial', exact: true }));
      await expect(preview.getByRole('region', { name: 'Cafe floor', exact: true })).toContainText('waiting');
      await expect(metric).toHaveText(String(baselineAverageWait));
    } else if (expectedControl === 'scene') {
      const scene = preview.locator('svg.tt-generated-scene');
      await scene.scrollIntoViewIfNeeded();
      await expect(scene).toBeInViewport();
      await expect(scene).toBeVisible();
      const light = scene.locator('.tt-generated-scene__shape[aria-label="Move light-source"]');
      await expect(light).toHaveAttribute('data-drag-enabled', 'true');
      const beforeValues = trialRecords.lights.find((record) => record.id === 'light-1').values;
      const target = { x: Math.min(100, beforeValues.light_x + 20), y: Math.min(100, beforeValues.light_y + 10) };
      expect(target.x).toBeGreaterThan(beforeValues.light_x);
      expect(target.y).toBeGreaterThan(beforeValues.light_y);
      const points = await light.evaluate((element, targetPoint) => {
        const svg = element.ownerSVGElement;
        const matrix = svg.getScreenCTM();
        const screen = (x, y) => {
          const point = svg.createSVGPoint(); point.x = x; point.y = y;
          const mapped = point.matrixTransform(matrix);
          return { x: mapped.x, y: mapped.y };
        };
        return { start: screen(Number(element.getAttribute('cx')), Number(element.getAttribute('cy'))), target: screen(targetPoint.x, targetPoint.y) };
      }, target);
      const drag = pageMouse(owner);
      await drag.move(points.start.x, points.start.y);
      await drag.down();
      await drag.move(points.target.x, points.target.y, { steps: 8 });
      await drag.up();
      const expectedShadow = (x, y) => x + ((beforeValues.ground_y - y) * (beforeValues.object_x - x)) / (beforeValues.top_y - y);
      const formatShadow = value => Number(value.toFixed(2)).toLocaleString('en', { maximumFractionDigits: 2 });
      const trialMetric = preview.getByRole('region', { name: 'Shadow tip x', exact: true }).locator('.tt-generated-metric strong');
      await expect(trialMetric).toHaveText(formatShadow(expectedShadow(target.x, target.y)));
      await clickVisible(preview.getByRole('button', { name: 'Reset trial', exact: true }));
      await expect(trialMetric).toHaveText(formatShadow(expectedShadow(beforeValues.light_x, beforeValues.light_y)));
    } else if (expectedControl === 'Recalculate payment') {
      const metric = preview.getByRole('region', { name: 'Monthly payment', exact: true }).locator('.tt-generated-metric strong');
      const initial = Number(await metric.innerText());
      const loan = trialRecords.loans.find((record) => record.id === 'loan-1').values;
      const monthlyRate = loan.annual_rate / 12;
      const factor = (1 + monthlyRate) ** loan.months;
      const expectedPayment = loan.principal * monthlyRate * factor / (factor - 1);
      await clickVisible(preview.getByRole('button', { name: 'Recalculate payment', exact: true }));
      await expect(metric).toHaveText(expectedPayment.toLocaleString('en', { maximumFractionDigits: 2 }));
      if (Math.abs(initial - expectedPayment) > 0.005) expect(Number(await metric.innerText())).not.toBe(initial);
      await clickVisible(preview.getByRole('button', { name: 'Reset trial', exact: true }));
      await expect(metric).toHaveText(Number(loan.payment).toLocaleString('en', { maximumFractionDigits: 2 }));
    } else if (expectedControl === 'slider') {
      const slider = preview.locator('input[type="range"]');
      await expect(slider).toHaveCount(1);
      await expect(slider).toBeDisabled();
      const expectedSeat = String(before.domain.turn ?? 'member-1').replace('-', ' ');
      await expect(preview.locator('.tt-generated-control__range [role="status"]')).toContainText(new RegExp(`waiting for ${expectedSeat}`, 'i'));
    }
    await assertTrialDidNotChangeActiveTable(owner, tableId, before, requestCount);
  }

  function isCommandResponse(response, type) {
    if (!response.url().endsWith('/commands') || response.request().method() !== 'POST') return false;
    try { return response.request().postDataJSON()?.type === type; } catch { return false; }
  }

  async function advanceLifecycle(owner, tableId, editor) {
    await openReviewSection(editor, 'tt-table-advanced-checks');
    for (const [label, type, status] of [
      ['Check rules', 'evolve.validate', 'validated'],
      ['Approve rules', 'evolve.approve', 'approved'],
      ['Use these rules', 'evolve.activate', 'active'],
    ]) {
      const responsePromise = responseAfter(owner, (response) => isCommandResponse(response, type));
      expect((await responsePromise(() => clickVisible(editor.getByRole('button', { name: label, exact: true })))).status()).toBe(200);
      await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe(status);
    }
    return (await api(owner, `/api/workspaces/${tableId}`)).body;
  }

  // F003-T5: invite through the table's reusable link; joins take the next free seat in order.
  async function inviteByUi(owner) {
    await owner.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'People at this table' });
    const panel = dialog.getByRole('region', { name: 'INVITE LINK' });
    const turnOn = panel.getByRole('button', { name: 'Turn on invite link', exact: true });
    await expect(turnOn.or(panel.getByLabel('Invite link'))).toBeVisible();
    if (await turnOn.isVisible()) {
      const responsePromise = responseAfter(owner, (response) => response.url().endsWith('/invite-link') && response.request().method() === 'POST');
      expect((await responsePromise(() => turnOn.click())).status()).toBe(201);
    }
    const url = await panel.getByLabel('Invite link').inputValue();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    return url;
  }

  async function addMember(owner, actor, seat, tableId) {
    const invite = await inviteByUi(owner);
    const member = await newPage(actor, invite);
    await expect(member.locator('.tt-canvas-panel')).toBeVisible();
    await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).status).toBe(200);
    expect((await api(member, `/api/workspaces/${tableId}`)).body.actor.seat).toBe(seat);
    return member;
  }

  async function canvasNodePosition(page, id) {
    const node = page.locator(`[data-canvas-object="${id}"]`).first();
    return node.evaluate((element) => {
      const wrapper = element.closest('.react-flow__node');
      if (!wrapper) return null;
      const value = window.getComputedStyle(wrapper).transform;
      if (!value || value === 'none') return null;
      const matrix = new DOMMatrixReadOnly(value);
      return { x: matrix.m41, y: matrix.m42 };
    });
  }

  async function assertSharedPosition(page, id, point) {
    await expect.poll(async () => {
      const current = await canvasNodePosition(page, id);
      return Boolean(current && Math.abs(current.x - point.x) < 0.1 && Math.abs(current.y - point.y) < 0.1);
    }).toBe(true);
  }

  async function pinViewPosition(owner, members, tableId, viewId, viewTitle) {
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const beforeActionState = {
      dataRevision: before.domain.dataRevision,
      ruleRevision: before.domain.ruleRevision,
      actionRevision: before.domain.actionRevision,
    };
    const editor = await openCanvasObject(owner, viewId);
    // 5.1.0: follows #144 (the "Move … without dragging" popup is gone). Clicking the card header
    // selects it; an arrow key then moves it one grid step and saves it like a drag.
    await editor.locator('.tt-canvas-node__head .tt-canvas-node__title').click();
    const responsePromise = responseAfter(owner, (response) => isCommandResponse(response, 'canvas.layout'));
    expect((await responsePromise(() => owner.keyboard.press('ArrowRight'))).status()).toBe(200);
    await expect(owner.locator('.tt-canvas-visually-hidden[role="status"]')).toHaveText(`${viewTitle} moved right.`);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.canvasLayout?.positions?.[viewId]?.pinned).toBe(true);
    const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const point = after.domain.canvasLayout.positions[viewId];
    expect(after.domain.dataRevision).toBe(beforeActionState.dataRevision);
    expect(after.domain.ruleRevision).toBe(beforeActionState.ruleRevision);
    expect(after.domain.actionRevision).toBe(beforeActionState.actionRevision);
    expect(after.domain.canvasLayout.revision).toBeGreaterThan(before.domain.canvasLayout?.revision ?? 0);
    await assertSharedPosition(owner, viewId, point);
    for (const member of members) {
      const projected = await api(member, `/api/workspaces/${tableId}`);
      expect(projected.status).toBe(200);
      expect(projected.body.domain.canvasLayout.positions[viewId]).toEqual(point);
      await assertSharedPosition(member, viewId, point);
    }
    return { point, layout: after.domain.canvasLayout };
  }

  async function commitAction(page, tableId, action) {
    const beforeRevision = (await api(page, `/api/workspaces/${tableId}`)).body.domain.actionRevision;
    const responsePromise = responseAfter(page, (response) => isCommandResponse(response, 'table.act'));
    const response = await responsePromise(action);
    expect(response.status()).toBe(200);
    await expect.poll(async () => (await api(page, `/api/workspaces/${tableId}`)).body.domain.actionRevision).toBeGreaterThan(beforeRevision);
    return (await api(page, `/api/workspaces/${tableId}`)).body;
  }

  async function exerciseAction(scenario, owner, members, tableId, active) {
    if (scenario.action === 'button' && scenario.id === 'cafe') {
      const editor = await openCanvasObject(owner, 'table.view.service-controls');
      const controls = editor.locator('.tt-generated-controls');
      const button = controls.getByRole('button', { name: 'Advance 5 minutes', exact: true });
      await expect(button).toBeEnabled();
      await commitAction(owner, tableId, () => button.click());
      let updated = (await api(owner, `/api/workspaces/${tableId}`)).body;
      const actual = updated.domain.records.clock.find((record) => record.id === 'clock-1').values.minute;
      expect(actual).toBe(20 + 5);
      await commitAction(owner, tableId, () => button.click());
      updated = (await api(owner, `/api/workspaces/${tableId}`)).body;
      const afterSecondStep = updated.domain.records.clock.find((record) => record.id === 'clock-1').values.minute;
      expect(afterSecondStep).toBe(20 + 10);
      const metric = (await openCanvasObject(owner, 'table.view.average-wait')).locator('.tt-generated-metric strong');
      await expect(metric).toHaveText('0');
      return updated;
    }
    if (scenario.action === 'scene-drag') {
      const beforeValues = active.domain.records.lights[0].values;
      const tableActCount = tableActRequests.length;
      const sceneId = 'table.view.light-shadow-scene';
      const editor = await openCanvasObject(owner, sceneId);
      const scene = editor.locator('svg.tt-generated-scene');
      const light = scene.locator('.tt-generated-scene__shape[aria-label="Move light-source"]');
      await expect(light).toHaveAttribute('data-drag-enabled', 'true');
      const viewportBeforeZoom = await readCanvasViewport(owner);
      await owner.getByRole('button', { name: 'Zoom Out', exact: true }).click();
      const zoomedViewport = await waitForStableCanvasViewport(owner);
      expect(zoomedViewport.zoom).toBeLessThan(viewportBeforeZoom.zoom);
      await expect(light).toBeVisible();

      // Re-request focus on the already-open scene, so its size stays fixed while
      // the canvas has a pending focus request when the real pointer gesture begins.
      await requestCanvasObjectFocusImmediately(owner, sceneId);
      const viewportBeforeGesture = await readCanvasViewport(owner);
      const points = await light.evaluate((element) => {
        const svg = element.ownerSVGElement;
        const matrix = svg.getScreenCTM();
        const screen = (x, y) => {
          const point = svg.createSVGPoint(); point.x = x; point.y = y;
          const mapped = point.matrixTransform(matrix);
          return { x: mapped.x, y: mapped.y };
        };
        const circle = element;
        return { start: screen(Number(circle.getAttribute('cx')), Number(circle.getAttribute('cy'))), target: screen(40, 20) };
      });
      const drag = pageMouse(owner);
      await drag.move(points.start.x, points.start.y);
      const hitTarget = await owner.evaluate(({ x, y }) => {
        const hit = document.elementFromPoint(x, y);
        return Boolean(hit?.closest('.tt-generated-scene__shape[aria-label="Move light-source"]'));
      }, points.start);
      expect(hitTarget).toBe(true);
      await drag.down();
      await drag.move(points.target.x, points.target.y, { steps: 8 });
      await drag.up();
      const viewportAtRelease = await readCanvasViewport(owner);
      await expect.poll(async () => {
        const value = (await api(owner, `/api/workspaces/${tableId}`)).body.domain.records.lights[0].values;
        return Math.abs(value.light_x - 40) <= 0.001 && Math.abs(value.light_y - 20) <= 0.001 ? value : null;
      }).not.toBeNull();
      const settledViewport = await waitForStableCanvasViewport(owner);
      expect(Math.abs(viewportAtRelease.zoom - viewportBeforeGesture.zoom)).toBeLessThan(0.01);
      expect(Math.abs(settledViewport.zoom - viewportAtRelease.zoom)).toBeLessThan(0.01);
      expect(Math.abs(settledViewport.x - viewportAtRelease.x)).toBeLessThan(1);
      expect(Math.abs(settledViewport.y - viewportAtRelease.y)).toBeLessThan(1);
      const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
      const values = current.domain.records.lights[0].values;
      expect(Math.abs(values.light_x - beforeValues.light_x)).toBeGreaterThan(1);
      expect(Math.abs(values.light_y - beforeValues.light_y)).toBeGreaterThan(1);
      expect(tableActRequests).toHaveLength(tableActCount + 1);
      mark('Generated-scene drag hit its visible target during a pending focus request; the settled camera stayed at the gesture position');
      const independentlyComputedShadow = values.light_x
        + ((values.ground_y - values.light_y) * (values.object_x - values.light_x))
        / (values.top_y - values.light_y);
      expect(independentlyComputedShadow.toFixed(2)).toBe('63.33');
      await expect((await openCanvasObject(owner, 'table.view.shadow-tip')).locator('.tt-generated-metric strong')).toHaveText(independentlyComputedShadow.toFixed(2));
      return current;
    }
    if (scenario.action === 'slider') {
      const member = members[0];
      expect((await api(member, `/api/workspaces/${tableId}`)).body.domain.turn).toBe('member-1');
      const editor = await openCanvasObject(member, 'table.view.water-controls');
      const slider = editor.locator('input[type="range"]');
      await expect(slider).toBeEnabled();
      const box = await slider.boundingBox();
      expect(box).toBeTruthy();
      const target = { x: box.x + box.width * (25 - 1) / (50 - 1), y: box.y + box.height / 2 };
      await pageMouse(member).click(target.x, target.y);
      const selectedAmount = Number(await slider.inputValue());
      expect(selectedAmount).toBeGreaterThan(20);
      expect(selectedAmount).toBeLessThan(30);
      await expect.poll(async () => {
        const state = (await api(member, `/api/workspaces/${tableId}`)).body.domain;
        return state.actionRevision > active.domain.actionRevision ? state : null;
      }, { timeout: 15_000 }).not.toBeNull();
      const updated = (await api(member, `/api/workspaces/${tableId}`)).body;
      const water = updated.domain.records.reservoirs[0].values.water;
      const delivered = updated.domain.records.teams[0].values.delivered;
      expect(water).toBe(100 - selectedAmount);
      expect(delivered).toBe(selectedAmount);
      expect(updated.domain.turn).toBe('host');

      const beforeForm = (await api(owner, `/api/workspaces/${tableId}`)).body;
      expect(beforeForm.domain.turn).toBe('host');
      const requestsBeforeForm = tableActRequests.length;
      await openCanvasObject(owner, 'table.view.water-controls');
      const form = owner.locator('[data-canvas-object="table.view.water-controls"] .tt-generated-control__form').filter({ hasText: 'Choose a team and amount' });
      const team = form.locator('select').first();
      const amount = form.locator('input[type="number"]').first();
      await team.selectOption('team-south');
      await amount.fill('7');
      await expect.poll(async () => Number(await owner.locator('[data-canvas-object="table.view.water-stock"] .tt-generated-metric strong').innerText()))
        .toBeCloseTo(beforeForm.domain.records.reservoirs[0].values.water - 7, 8);
      await expect(owner.locator('[data-canvas-object="table.view.south-delivery"] .tt-generated-metric strong')).toHaveText('7');
      expect((await api(owner, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(beforeForm.domain.records);
      expect((await api(owner, `/api/workspaces/${tableId}`)).body.domain.turn).toBe('host');
      expect((await api(owner, `/api/workspaces/${tableId}`)).body.domain.actionRevision).toBe(beforeForm.domain.actionRevision);
      expect(tableActRequests).toHaveLength(requestsBeforeForm);
      const submit = form.getByRole('button', { name: 'Choose a team and amount', exact: true });
      await expect(submit).toBeEnabled();
      await expect(team.locator('option[value="team-south"]')).toHaveText('0 · team-south');

      const responsePromise = responseAfter(owner, (response) => isCommandResponse(response, 'table.act'));
      expect((await responsePromise(() => submit.click())).status()).toBe(200);
      await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.actionRevision)
        .toBeGreaterThan(beforeForm.domain.actionRevision);
      const afterForm = (await api(owner, `/api/workspaces/${tableId}`)).body;
      expect(afterForm.domain.records.reservoirs[0].values.water).toBe(beforeForm.domain.records.reservoirs[0].values.water - 7);
      expect(afterForm.domain.records.teams.find((record) => record.id === 'team-south').values.delivered).toBe(7);
      expect(afterForm.domain.turn).toBe('member-2');
      expect(tableActRequests).toHaveLength(requestsBeforeForm + 1);
      for (const actorPage of [owner, member]) {
        await expect.poll(async () => (await api(actorPage, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(afterForm.domain.records);
        await expect(actorPage.locator('[data-canvas-object="table.view.south-delivery"] .tt-generated-metric strong')).toHaveText('7');
        await actorPage.reload();
        await expect(actorPage.locator('.tt-canvas-panel')).toBeVisible();
        expect((await api(actorPage, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(afterForm.domain.records);
      }

      const nextSeat = members[1];
      expect((await api(nextSeat, `/api/workspaces/${tableId}`)).body.domain.turn).toBe('member-2');
      const nextEditor = await openCanvasObject(nextSeat, 'table.view.water-controls');
      const nextSlider = nextEditor.locator('input[type="range"]');
      await expect(nextSlider).toBeEnabled();
      const nextBox = await nextSlider.boundingBox();
      expect(nextBox).toBeTruthy();
      await pageMouse(nextSeat).click(nextBox.x + nextBox.width * (20 - 1) / (50 - 1), nextBox.y + nextBox.height / 2);
      await expect.poll(async () => (await api(nextSeat, `/api/workspaces/${tableId}`)).body.domain.actionRevision)
        .toBeGreaterThan(afterForm.domain.actionRevision);
      const afterNextSeat = (await api(nextSeat, `/api/workspaces/${tableId}`)).body;
      expect(afterNextSeat.domain.turn).toBe('member-1');
      for (const actorPage of [owner, ...members]) {
        await expect.poll(async () => (await api(actorPage, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(afterNextSeat.domain.records);
      }
      mark('Water: member slider, owner form preview with unchanged server state, one committed form action shared and persisted to both pages, then next seat acts');
      return afterNextSeat;
    }
    const editor = await openCanvasObject(owner, 'table.view.loan-controls');
    const button = editor.locator('.tt-generated-controls').getByRole('button', { name: 'Recalculate payment', exact: true });
    await expect(button).toBeEnabled();
    await commitAction(owner, tableId, () => button.click());
    const updated = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const loan = updated.domain.records.loans[0].values;
    const monthlyRate = loan.annual_rate / 12;
    const factor = (1 + monthlyRate) ** loan.months;
    const expectedPayment = loan.principal * monthlyRate * factor / (factor - 1);
    expect(loan.payment).toBeCloseTo(expectedPayment, 8);
    await expect((await openCanvasObject(owner, 'table.view.monthly-payment')).locator('.tt-generated-metric strong')).toHaveText(expectedPayment.toLocaleString('en', { maximumFractionDigits: 2 }));
    return updated;
  }

  function pageMouse(page) {
    return {
      move: (x, y, options = {}) => page.mouse.move(x, y, options),
      down: () => page.mouse.down(),
      up: () => page.mouse.up(),
      click: (x, y) => page.mouse.click(x, y),
    };
  }

  async function assignRole(owner, tableId, actorId, roleId) {
    const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const assigned = await api(owner, `/api/workspaces/${tableId}/commands`, {
      commandId: randomUUID(), expectedRevision: current.revision, expectedEpoch: current.epoch,
      type: 'access.assign', payload: { actorId, roleId },
    });
    expect(assigned.status).toBe(200);
  }

  // F035: drafting with AI needs rules.draft. An unassigned member holds it, so the check uses a Viewer and
  // then returns the member to the default role for the rest of the case.
  async function assertMemberCannotUsePrivateTools(owner, member, tableId, source) {
    if (source) expect([403, 404]).toContain((await api(member, `/api/workspaces/${tableId}/sources/${source.id}`)).status);
    const memberView = (await api(member, `/api/workspaces/${tableId}`)).body;
    await assignRole(owner, tableId, memberView.actor.actorId, 'viewer');
    const viewerView = (await api(member, `/api/workspaces/${tableId}`)).body;
    const beforeCalls = providerCalls;
    const denied = await api(member, `/api/workspaces/${tableId}/model`, {
      commandId: randomUUID(), expectedRevision: viewerView.revision, expectedEpoch: viewerView.epoch,
      prompt: 'A Viewer must not request a table draft.', consent: true,
    });
    expect(denied.status).toBe(403);
    expect(denied.body.errorCode).toBe('ROLE_FORBIDDEN');
    expect(providerCalls).toBe(beforeCalls);
    await assignRole(owner, tableId, memberView.actor.actorId, 'default');
  }

  async function runCase(scenario, index) {
    const ownerActor = actors[index * 3];
    const memberOneActor = actors[index * 3 + 1];
    const memberTwoActor = actors[index * 3 + 2];
    const owner = await newPage(ownerActor);
    await expect(owner.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
    const created = await createFreshTable(owner);
    const tableId = created.id;
    const source = scenario.file ? await attachSource(owner, tableId, scenario.file) : null;
    const draft = await askForDraft(owner, tableId, scenario, 'initial-draft', source, { cancelFirst: scenario.id === 'cafe' });
    const expectedControl = scenario.action === 'button'
      ? scenario.id === 'cafe' ? 'Advance 5 minutes' : 'Recalculate payment'
      : scenario.action === 'slider' ? 'slider' : 'scene';
    const simulatedEditor = await assertPrivateCandidatePreview(owner, tableId, draft, expectedControl, draftPrompt(scenario, 'initial-draft'));
    const activated = await advanceLifecycle(owner, tableId, simulatedEditor);
    expect(activated.domain.program.canvas.views.length).toBeGreaterThan(0);
    expect(activated.domain.records).toEqual(draft.domain.candidate.change.initialRecords);
    if (scenario.id === 'cafe') await assertZoomSurvivesPendingObjectFocus(owner, tableId, 'table.view.cafe-floor');
    const memberOne = await addMember(owner, memberOneActor, 'member-1', tableId);
    const memberTwo = await addMember(owner, memberTwoActor, 'member-2', tableId);
    const members = [memberOne, memberTwo];
    let ownerReady = (await api(owner, `/api/workspaces/${tableId}`)).body;
    // F015 open visibility: members receive the owner's whole table, including evidence quotations,
    // draft and draft history (was: evidence stripped and draft hidden for members).
    const visibleProgram = structuredClone(ownerReady.domain.program);
    for (const member of members) {
      const projection = await api(member, `/api/workspaces/${tableId}`);
      expect(projection.status).toBe(200);
      expect(projection.body.domain.program).toEqual(visibleProgram);
      expect(projection.body.domain.records).toEqual(ownerReady.domain.records);
      expect(projection.body.domain.canvasLayout).toEqual(ownerReady.domain.canvasLayout);
      expect(projection.body.domain.sources).toEqual(ownerReady.domain.sources);
      expect(projection.body.domain.candidate).toEqual(ownerReady.domain.candidate);
      expect(projection.body.domain.revisions).toEqual(ownerReady.domain.revisions);
    }
    await assertMemberCannotUsePrivateTools(owner, memberOne, tableId, source);
    ownerReady = (await api(owner, `/api/workspaces/${tableId}`)).body;

    const activeAfterAction = await exerciseAction(scenario, owner, members, tableId, ownerReady);
    for (const member of members) {
      await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(activeAfterAction.domain.records);
    }
    const viewsBeforeEdit = activeAfterAction.domain.program.canvas.views;
    const pinnedView = viewsBeforeEdit.find((view) => view.kind === 'scene') ?? viewsBeforeEdit[0];
    const pin = await pinViewPosition(owner, members, tableId, `table.view.${pinnedView.id}`, pinnedView.title);
    const beforeEdit = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const recordSnapshot = structuredClone(beforeEdit.domain.records);
    // The owner consented for the initial draft on this table epoch; the edit must not ask again.
    const editDraft = await askForDraft(owner, tableId, scenario, 'incremental-edit', source, { expectConsent: false });
    expect(editDraft.domain.candidate.change.initialRecords).toEqual({});
    expect(editDraft.domain.records).toEqual(recordSnapshot);
    const editEditor = await openCanvasObject(owner, 'table.rules');
    await openReviewSection(editEditor, 'tt-table-private-preview');
    const editPreview = editEditor.getByRole('region', { name: 'Proposed generated canvas preview', exact: true });
    await expect(editPreview).toBeVisible();
    await exercisePrivateTrial(owner, tableId, editDraft, editPreview, expectedControl);
    await openReviewSection(editEditor, 'tt-table-advanced-checks');
    const simulateEdit = responseAfter(owner, (response) => isCommandResponse(response, 'evolve.simulate'));
    expect((await simulateEdit(() => editEditor.getByRole('button', { name: 'Preview change', exact: true }).click())).status()).toBe(200);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe('simulated');
    const currentEditor = await openCanvasObject(owner, 'table.rules');
    const afterSimulation = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(afterSimulation.domain.records).toEqual(recordSnapshot);
    expect(afterSimulation.domain.program).toEqual(beforeEdit.domain.program);
    await advanceLifecycle(owner, tableId, currentEditor);
    const newViewId = 'table.view.incremental-result';
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.canvasLayout?.positions?.[newViewId], { timeout: 15_000 }).toBeTruthy();
    const afterEdit = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const newViewPoint = afterEdit.domain.canvasLayout.positions[newViewId];
    expect(afterEdit.domain.records).toEqual(recordSnapshot);
    expect(afterEdit.domain.dataRevision).toBe(beforeEdit.domain.dataRevision);
    expect(afterEdit.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
    expect(afterEdit.domain.canvasLayout.revision).toBeGreaterThan(pin.layout.revision);
    expect(afterEdit.domain.program.canvas.views).toHaveLength(viewsBeforeEdit.length + 1);
    expect(afterEdit.domain.program.canvas.views.at(-1).id).toBe('incremental-result');
    await assertSharedPosition(owner, `table.view.${pinnedView.id}`, pin.point);
    await assertSharedPosition(owner, newViewId, newViewPoint);

    for (const member of members) {
      await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).body.domain.program.canvas.views.length).toBe(viewsBeforeEdit.length + 1);
      const projected = (await api(member, `/api/workspaces/${tableId}`)).body;
      expect(projected.domain.records).toEqual(recordSnapshot);
      expect(projected.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
      expect(projected.domain.canvasLayout.positions[newViewId]).toEqual(newViewPoint);
      await assertSharedPosition(member, `table.view.${pinnedView.id}`, pin.point);
      await assertSharedPosition(member, newViewId, newViewPoint);
      await member.reload();
      await expect(member.locator('.tt-canvas-panel')).toBeVisible();
      const resumed = (await api(member, `/api/workspaces/${tableId}`)).body;
      expect(resumed.domain.records).toEqual(recordSnapshot);
      expect(resumed.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
      expect(resumed.domain.canvasLayout.positions[newViewId]).toEqual(newViewPoint);
      await assertSharedPosition(member, `table.view.${pinnedView.id}`, pin.point);
      await assertSharedPosition(member, newViewId, newViewPoint);
    }
    if (source) await assertMemberCannotUsePrivateTools(owner, memberOne, tableId, source);
    const screenshotViewId = {
      cafe: 'table.view.cafe-floor',
      shadow: 'table.view.light-shadow-scene',
      water: 'table.view.water-stock',
      novel: 'table.view.monthly-payment',
    }[scenario.id];
    const screenshotEditor = await openCanvasObject(owner, screenshotViewId);
    await expect(screenshotEditor).toHaveAttribute('data-canvas-object', screenshotViewId);
    const renderedScene = screenshotEditor.locator('svg.tt-generated-scene');
    const renderedMetric = screenshotEditor.locator('.tt-generated-metric strong');
    if (scenario.id === 'cafe' || scenario.id === 'shadow') await expect(renderedScene).toBeVisible();
    else await expect(renderedMetric).toBeVisible();
    await owner.screenshot({ path: join(output, `${scenario.id}-canvas.png`), fullPage: true });
    const realAction = scenario.id === 'water' ? 'slider + turn-advancing generated form' : scenario.action;
    mark(`${scenario.id}: synthetic ${source ? 'file' : 'prompt'} draft, private preview, activation, real ${realAction}, shared rows/layout, reload and incremental edit`);
  }

  for (let index = 0; index < cases.length; index += 1) await runCase(cases[index], index);
  expect(blockedExternal).toEqual([]);
  expect(browserErrors).toEqual([]);
  expect(providerCalls).toBe(8);
  mark('All four fresh local rooms completed; generated views and rules made eight intercepted synthetic provider calls with no browser errors or external network requests');
  await writeFile(join(output, 'report.json'), JSON.stringify({
    status: 'PASS', checks, providerCalls, providerResponses, browserErrors, blockedExternal,
    runtime: 'Disposable local Miniflare Workers, D1 and SQLite Durable Objects; no production endpoint or database.',
    login: 'Synthetic fixture accounts and sessions; no OAuth provider was contacted.',
    ai: 'Explicit fixture outputs from src/tabletop/testing/generative-scenarios.ts plus one synthetic loan view; every DeepSeek URL was intercepted locally.',
    generatedAt: new Date().toISOString(),
  }, null, 2));
} catch (error) {
  for (let index = 0; index < pages.length; index += 1) {
    if (!pages[index].isClosed()) await pages[index].screenshot({ path: join(output, `failure-${index}.png`), fullPage: true }).catch(() => {});
  }
  await writeFile(join(output, 'report.json'), JSON.stringify({
    status: 'FAIL', checks, providerCalls, providerResponses, browserErrors, blockedExternal, lastUiDiagnostics,
    failure: String(error),
    runtime: 'Disposable local Miniflare Workers, D1 and SQLite Durable Objects; no production endpoint or database.',
    login: 'Synthetic fixture accounts and sessions; no OAuth provider was contacted.',
    ai: 'Synthetic intercepted provider replies only.',
  }, null, 2));
  throw error;
} finally {
  await browser?.close();
  await mf.dispose();
}
