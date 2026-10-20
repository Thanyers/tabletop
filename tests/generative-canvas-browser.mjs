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
const lastUiDiagnostics = null;
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
  if (id === 'water') return { id, change: cooperativeWaterChange, edit: false };
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
    const before = (await api(page, `/api/workspaces/${tableId}`)).body.domain;
    const beforeViewport = await readCanvasViewport(page);
    const dock = await openObjects(page);
    const openCard = dock.getByTestId(`open-canvas-${nodeId}`);
    const zoomIn = page.getByRole('button', { name: 'Zoom In', exact: true });
    await expect(openCard).toBeVisible();
    await expect(zoomIn).toBeVisible();
    const mutatingRequests = [];
    const recordMutation = request => {
      const requestUrl = new URL(request.url());
      if (requestUrl.origin === origin && !['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        mutatingRequests.push(`${request.method()} ${requestUrl.pathname}`);
      }
    };
    page.on('request', recordMutation);
    try {
      // Keep the two real pointer clicks adjacent: the second lands while the opened card's
      // geometry-based focus request is still pending, without waiting for the card to settle.
      await openCard.click();
      await zoomIn.click();
    } finally {
      page.off('request', recordMutation);
    }
    await expect.poll(async () => (await readCanvasViewport(page)).zoom)
      .toBeGreaterThan(beforeViewport.zoom);
    const zoomAfterClick = await readCanvasViewport(page);
    const editor = page.getByTestId('canvas-object-editor');
    await expect(editor).toHaveAttribute('data-canvas-object', nodeId);
    await expect(editor).toBeVisible();
    await waitForStableBoundingBox(editor);
    const settledViewport = await waitForStableCanvasViewport(page);
    expect(zoomAfterClick.zoom).toBeGreaterThan(beforeViewport.zoom);
    expect(Math.abs(settledViewport.zoom - zoomAfterClick.zoom)).toBeLessThan(0.01);
    expect(Math.abs(settledViewport.x - zoomAfterClick.x)).toBeLessThan(1);
    expect(Math.abs(settledViewport.y - zoomAfterClick.y)).toBeLessThan(1);
    expect(mutatingRequests).toEqual([]);
    const after = (await api(page, `/api/workspaces/${tableId}`)).body.domain;
    expect(after).toEqual(before);
    mark('Generated card open followed immediately by user zoom; settled viewport retained the zoom with no API mutations');
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
    return room;
  }

  async function attachSource(owner, tableId, file) {
    const editor = await openCanvasObject(owner, 'table.sources');
    await editor.getByLabel('Choose table source files').setInputFiles({
      name: file.filename, mimeType: 'text/plain', buffer: Buffer.from(file.text, 'utf8'),
    });
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.sources.length).toBe(1);
    const current = await api(owner, `/api/workspaces/${tableId}`);
    const source = current.body.domain.sources[0];
    expect(source).toMatchObject({ filename: file.filename, text: file.text });
    return source;
  }

  async function openAssistantIfCollapsed(page) {
    const island = page.getByTestId('table-assistant-panel');
    if (await island.getAttribute('data-collapsed') !== 'true') return;
    const bubble = page.getByTestId('table-assistant-bubble');
    await expect(bubble).toBeVisible();
    await bubble.click();
    await expect(island).toHaveAttribute('data-collapsed', 'false');
  }

  async function askForDraft(owner, tableId, scenario, phase, file) {
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
    await openAssistantIfCollapsed(owner);
    const assistant = owner.getByTestId('table-assistant');
    await expect(assistant).toBeVisible();
    await assistant.getByRole('button', { name: /Open rules and sources|Set up this table from sources/ }).click();
    await assistant.getByLabel('How should this table work?', { exact: true }).fill(
      `scenario:${scenario.id}; phase:${phase}. Create a bounded, understandable Canvas for this synthetic fixture.`,
    );
    const consent = assistant.getByLabel(file
      ? `Send this request, table state and 1 source file to AI.`
      : 'Send this request, table state and 0 source files to AI.');
    await consent.check();
    const request = responseAfter(owner, (response) => response.url().endsWith(`/api/workspaces/${tableId}/model`) && response.request().method() === 'POST');
    expect((await request(() => assistant.getByRole('button', { name: 'Prepare rule draft', exact: true }).click())).status()).toBe(202);
    await expect(assistant.getByText('Draft ready for review', { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe('draft');
    const candidate = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(candidate.domain.program).toEqual(before.domain.program);
    expect(candidate.domain.records).toEqual(before.domain.records);
    expect(candidate.domain.candidate?.change.kind).toBe('table');
    return candidate;
  }

  async function assertPrivateCandidatePreview(owner, tableId, candidate, expectedControl) {
    await openAssistantIfCollapsed(owner);
    await owner.getByRole('button', { name: 'Review draft', exact: true }).click();
    const editor = owner.getByTestId('canvas-object-editor');
    await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
    await expect(editor).toBeVisible();
    await waitForStableBoundingBox(editor);
    const preview = editor.getByRole('region', { name: 'Proposed generated canvas preview', exact: true });
    await expect(preview).toBeVisible();
    await expect(preview).toContainText('Trial changes stay in this private copy; the active table is unchanged.');
    await exercisePrivateTrial(owner, tableId, candidate, preview, expectedControl);
    const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
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

  async function inviteByUi(owner, seat) {
    await owner.getByRole('button', { name: 'Invite', exact: true }).click();
    const dialog = owner.getByRole('dialog', { name: 'People at this table' });
    const number = seat === 'member-1' ? '1' : '2';
    await dialog.getByRole('button', { name: new RegExp(`Member ${number}`) }).click();
    const responsePromise = responseAfter(owner, (response) => response.url().endsWith('/invites') && response.request().method() === 'POST');
    const response = await responsePromise(() => dialog.getByRole('button', { name: `Create invitation for Member ${number}`, exact: true }).click());
    expect(response.status()).toBe(201);
    const ticket = (await response.json()).ticket;
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    return `${origin}/#invite=${ticket}`;
  }

  async function addMember(owner, actor, seat, tableId) {
    const invite = await inviteByUi(owner, seat);
    const member = await newPage(actor, invite);
    await expect(member.locator('.tt-canvas-panel')).toBeVisible();
    await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).status).toBe(200);
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
    await editor.getByRole('button', { name: `Move ${viewTitle} without dragging`, exact: true }).click();
    const responsePromise = responseAfter(owner, (response) => isCommandResponse(response, 'canvas.layout'));
    expect((await responsePromise(() => owner.getByRole('group', { name: `Move ${viewTitle} without dragging` }).getByRole('button', { name: `Move ${viewTitle} right`, exact: true }).click())).status()).toBe(200);
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
      expect(updated.domain.turn).toBe('member-2');
      return updated;
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

  async function assertMemberCannotUsePrivateTools(member, tableId, revision, epoch, source) {
    if (source) expect([403, 404]).toContain((await api(member, `/api/workspaces/${tableId}/sources/${source.id}`)).status);
    const beforeCalls = providerCalls;
    const denied = await api(member, `/api/workspaces/${tableId}/model`, {
      commandId: randomUUID(), expectedRevision: revision, expectedEpoch: epoch,
      prompt: 'A participant must not request a private table draft.', consent: true,
    });
    expect(denied.status).toBe(403);
    expect(providerCalls).toBe(beforeCalls);
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
    const draft = await askForDraft(owner, tableId, scenario, 'initial-draft', source);
    const expectedControl = scenario.action === 'button'
      ? scenario.id === 'cafe' ? 'Advance 5 minutes' : 'Recalculate payment'
      : scenario.action === 'slider' ? 'slider' : 'scene';
    const simulatedEditor = await assertPrivateCandidatePreview(owner, tableId, draft, expectedControl);
    const activated = await advanceLifecycle(owner, tableId, simulatedEditor);
    expect(activated.domain.program.canvas.views.length).toBeGreaterThan(0);
    expect(activated.domain.records).toEqual(draft.domain.candidate.change.initialRecords);
    if (scenario.id === 'cafe') await assertZoomSurvivesPendingObjectFocus(owner, tableId, 'table.view.cafe-floor');
    const memberOne = await addMember(owner, memberOneActor, 'member-1', tableId);
    const memberTwo = await addMember(owner, memberTwoActor, 'member-2', tableId);
    const members = [memberOne, memberTwo];
    const ownerReady = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const visibleProgram = structuredClone(ownerReady.domain.program);
    if (scenario.file) visibleProgram.evidence = [];
    for (const member of members) {
      const projection = await api(member, `/api/workspaces/${tableId}`);
      expect(projection.status).toBe(200);
      expect(projection.body.domain.program).toEqual(visibleProgram);
      expect(projection.body.domain.records).toEqual(ownerReady.domain.records);
      expect(projection.body.domain.canvasLayout).toEqual(ownerReady.domain.canvasLayout);
      expect(projection.body.domain.sources).toEqual([]);
      expect(projection.body.domain.candidate).toBeNull();
      if (scenario.file) expect(JSON.stringify(projection.body.domain)).not.toContain(scenario.file.filename);
    }
    await assertMemberCannotUsePrivateTools(memberOne, tableId, ownerReady.revision, ownerReady.epoch, source);

    const activeAfterAction = await exerciseAction(scenario, owner, members, tableId, ownerReady);
    for (const member of members) {
      await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).body.domain.records).toEqual(activeAfterAction.domain.records);
    }
    const viewsBeforeEdit = activeAfterAction.domain.program.canvas.views;
    const pinnedView = viewsBeforeEdit.find((view) => view.kind === 'scene') ?? viewsBeforeEdit[0];
    const pin = await pinViewPosition(owner, members, tableId, `table.view.${pinnedView.id}`, pinnedView.title);
    const beforeEdit = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const recordSnapshot = structuredClone(beforeEdit.domain.records);
    const editDraft = await askForDraft(owner, tableId, scenario, 'incremental-edit', source);
    expect(editDraft.domain.candidate.change.initialRecords).toEqual({});
    expect(editDraft.domain.records).toEqual(recordSnapshot);
    const editEditor = await openCanvasObject(owner, 'table.rules');
    const editPreview = editEditor.getByRole('region', { name: 'Proposed generated canvas preview', exact: true });
    await expect(editPreview).toBeVisible();
    await exercisePrivateTrial(owner, tableId, editDraft, editPreview, expectedControl);
    const simulateEdit = responseAfter(owner, (response) => isCommandResponse(response, 'evolve.simulate'));
    expect((await simulateEdit(() => editEditor.getByRole('button', { name: 'Preview change', exact: true }).click())).status()).toBe(200);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe('simulated');
    const currentEditor = await openCanvasObject(owner, 'table.rules');
    const afterSimulation = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(afterSimulation.domain.records).toEqual(recordSnapshot);
    expect(afterSimulation.domain.program).toEqual(beforeEdit.domain.program);
    await advanceLifecycle(owner, tableId, currentEditor);
    const afterEdit = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(afterEdit.domain.records).toEqual(recordSnapshot);
    expect(afterEdit.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
    expect(afterEdit.domain.canvasLayout.revision).toBe(pin.layout.revision);
    expect(afterEdit.domain.program.canvas.views).toHaveLength(viewsBeforeEdit.length + 1);
    expect(afterEdit.domain.program.canvas.views.at(-1).id).toBe('incremental-result');
    await assertSharedPosition(owner, `table.view.${pinnedView.id}`, pin.point);

    for (const member of members) {
      await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).body.domain.program.canvas.views.length).toBe(viewsBeforeEdit.length + 1);
      const projected = (await api(member, `/api/workspaces/${tableId}`)).body;
      expect(projected.domain.records).toEqual(recordSnapshot);
      expect(projected.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
      await assertSharedPosition(member, `table.view.${pinnedView.id}`, pin.point);
      await member.reload();
      await expect(member.locator('.tt-canvas-panel')).toBeVisible();
      const resumed = (await api(member, `/api/workspaces/${tableId}`)).body;
      expect(resumed.domain.records).toEqual(recordSnapshot);
      expect(resumed.domain.canvasLayout.positions[`table.view.${pinnedView.id}`]).toEqual(pin.point);
      await assertSharedPosition(member, `table.view.${pinnedView.id}`, pin.point);
    }
    if (source) await assertMemberCannotUsePrivateTools(memberOne, tableId, afterEdit.revision, afterEdit.epoch, source);
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
    mark(`${scenario.id}: synthetic ${source ? 'file' : 'prompt'} draft, private preview, activation, real ${scenario.action}, shared rows/layout, reload and incremental edit`);
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
