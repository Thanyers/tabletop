// Opt-in paid provider acceptance; uses only synthetic files and disposable local rooms.
// Run through generic-table-local.mjs --real-ai --generative-auto.
import { chromium, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateGenerativeCanvas } from '../src/tabletop/runtime/generative/evaluator.ts';

const cases = [
  {
    id: 'cafe',
    source: { filename: 'coffee-queue.md', text: '# Fictional coffee queue\nEspresso takes 3 minutes. Tea takes 5 minutes. Both start unfinished. Finish each order only once. Show total minutes of finished orders.' },
    prompt: 'Build an interactive coffee queue from the file. Use collection orders with fields name (text), minutes (number), finished (boolean), row IDs espresso and tea. Action finish takes record parameter order, permits owner/participant, requires unfinished and sets finished true. Include a scene, a form bound to finish, a chart, and metric completed-minutes that sums minutes of ONLY finished orders using an aggregate/filter expression. Every control must work. Keep this small.',
  },
  {
    id: 'shadow',
    prompt: 'Create a tiny light/shadow experiment without a file. Collection lights: one row main, numeric light_x=20 bounded 0..100 and light_y=10 bounded 0..40. Action move_light parameters light(record), x(number0..100), y(number0..40) sets both coordinates. Scene 120 by 120: draggable circle light-source bound to this action; object top is (50,50), and ground is y=90. Draw ray from (light_x,light_y) to (50,50). Draw the shadow edge from (50,50) to the ground intersection, with endpoint x = light_x + (90-light_y)*(50-light_x)/(50-light_y) and y=90. Use this exact same ground-intersection expression for the shadow edge and metric shadow-x; do not use light_x as the shadow endpoint. Include sliders reading committed x and y. Both roles may act; no turns. All geometry must update from actual expressions; never a prerecorded picture.',
  },
  {
    id: 'water',
    source: { filename: 'village-water.md', text: '# Fictional cooperative water game\nReservoir village starts with 100 litres. Red belongs to host and Blue to member-1; deliveries start at zero. Players alternate, host first. A player may deliver 1 to 30 litres from the reservoir to their own team, only when enough water remains. Water plus all deliveries must remain 100.' },
    prompt: 'Create the water game in this file. Collections tanks (field water number0..100, row village) and teams (seat text, delivered number0..100, rows red and blue). Action deliver has parameters tank(record), team(record), amount(number1..30). Check team.seat equals system seat and sufficient water; requireTurn and advanceTurn. Turn order host,member-1. Effects subtract amount from tank water and add to delivered atomically. Include a scene, a form control bound to deliver and metric conserved-total = reservoir water + sum team delivered. Preserve total100. Small usable views with relatedTo links.',
  },
];

export async function runGenerativeLiveAcceptance({ origin, actors, output, real }) {
  if (!real) throw Error('This acceptance requires an explicit --real-ai run.');
  const selectedCase = process.env.GENERATIVE_CASE;
  if (selectedCase && !cases.some(item => item.id === selectedCase)) throw Error('Unknown generative acceptance case');
  const report = { runtime: 'disposable local Cloudflare Worker/D1/Durable Objects', selection: selectedCase ?? 'all', provider: 'real, capped by fixture at 6 calls and $0.20 ledger', accounts: 'two synthetic accounts; not Google OAuth acceptance', checks: [], cases: [], errors: [] };
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const contexts = [];
  const mark = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  async function pageFor(actor) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    contexts.push(context);
    await context.addCookies([{ name: 'tabletop_local_session', value: actor.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(origin);
    return page;
  }
  async function read(page, id) {
    return page.evaluate(async id => {
      const response = await fetch(`/api/workspaces/${id}`);
      if (!response.ok) throw Error(`Readback failed ${response.status}`);
      return response.json();
    }, id);
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
  async function object(page, id) {
    const editor = page.getByTestId('canvas-object-editor');
    if (!(await editor.isVisible().catch(() => false) && await editor.getAttribute('data-canvas-object') === id)) {
      const trigger = page.getByTestId('canvas-object-menu-trigger');
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      await page.getByTestId(`open-canvas-${id}`).click();
      await expect(editor).toHaveAttribute('data-canvas-object', id);
    }
    await expect(editor).toBeVisible();
    await waitForStableBoundingBox(editor);
    return editor;
  }
  const commandResponse = (page, type) => {
    const response = page.waitForResponse(response => {
      if (!response.url().endsWith('/commands') || response.request().method() !== 'POST') return false;
      try { return response.request().postDataJSON()?.type === type; } catch { return false; }
    });
    // A failed click still gets reported in its case; closing that page must not
    // produce an unrelated unhandled rejection from the pending event waiter.
    void response.catch(() => {});
    return response;
  };
  async function requestDraft(page, id, prompt) {
    const before = await read(page, id);
    if (before.domain.program || before.domain.candidate?.status === 'active') {
      const rules = await object(page, 'table.rules');
      await rules.getByRole('button', { name: 'Edit rules', exact: true }).click();
    }
    const chat = page.getByTestId('table-chat-bar');
    const composer = chat.getByRole('textbox', { name: 'Message', exact: true });
    await expect(composer).toBeVisible();
    await composer.fill(prompt);
    await chat.getByRole('button', { name: 'Send message', exact: true }).click();
    const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
    await expect(consent).toBeVisible();
    const consentCopy = (await consent.innerText()).replace(/\s+/gu, ' ');
    expect(consentCopy).toMatch(/current active rules, records, and turn|current table context/iu);
    expect(consentCopy).toContain('Chat history is not included.');
    expect(consentCopy).toContain('Private source files included');
    for (const source of before.domain.sources) expect(consentCopy).toContain(source.filename);
    const request = page.waitForResponse(response => response.url().endsWith(`/api/workspaces/${id}/model`) && response.request().method() === 'POST');
    void request.catch(() => {});
    await consent.getByRole('button', { name: 'Send', exact: true }).click();
    const accepted = await request;
    expect(accepted.status()).toBe(202);
    const job = await accepted.json();
    await expect.poll(async () => page.evaluate(async ({ id, jobId }) => {
      const response = await fetch(`/api/workspaces/${id}/model/${jobId}`);
      return (await response.json()).status;
    }, { id, jobId: job.id }), { timeout: 40_000, intervals: [500, 1000] }).not.toBe('running');
    const final = await page.evaluate(async ({ id, jobId }) => (await fetch(`/api/workspaces/${id}/model/${jobId}`)).json(), { id, jobId: job.id });
    if (final.status !== 'completed') throw Error(`Model stopped: ${final.message ?? final.status}`);
    const draftNode = page.locator('.tt-canvas-node--auxiliary').filter({ hasText: prompt.slice(0, 36) }).first();
    const draftCard = draftNode.getByTestId('table-chat-answer');
    await expect(draftCard).toBeVisible({ timeout: 10_000 });
    await expect(draftCard).toContainText('A rule draft is ready. Review it before anyone uses it.', { timeout: 10_000 });
    await expect(draftCard.getByRole('button', { name: 'Review rules', exact: true })).toBeEnabled();
    await draftCard.getByRole('button', { name: 'Review rules', exact: true }).click();
    const draft = await read(page, id);
    expect(draft.domain.candidate.status).toBe('draft');
    expect(draft.domain.candidate.change.program.canvas.views.length).toBeGreaterThan(0);
    return draft;
  }
  async function activate(page, id) {
    const editor = await object(page, 'table.rules');
    for (const [label, type] of [
      [/Preview change/, 'evolve.simulate'], [/Check rules/, 'evolve.validate'],
      [/Approve rules/, 'evolve.approve'], [/Use these rules/, 'evolve.activate'],
    ]) {
      const response = commandResponse(page, type);
      await editor.getByRole('button', { name: label }).click();
      const result = await response;
      if (result.status() !== 200) throw Error(`${type}: ${JSON.stringify(await result.json())}`);
    }
    return read(page, id);
  }
  async function act(page, id, actionId, inputs, expectedStatus = 200) {
    const view = await read(page, id);
    const action = view.domain.program.actions.find(item => item.id === actionId);
    expect(action).toBeTruthy();
    const editor = await object(page, 'table.actions');
    await editor.locator('.tt-table-action-picker select').selectOption(actionId);
    const form = editor.locator('form.tt-table-action');
    for (const parameter of action.parameters) {
      const control = form.getByLabel(parameter.label, { exact: false });
      if (parameter.type === 'record' || parameter.choices?.length) await control.selectOption(String(inputs[parameter.id]));
      else if (parameter.type === 'boolean') await control.setChecked(Boolean(inputs[parameter.id]));
      else await control.fill(String(inputs[parameter.id]));
    }
    const response = commandResponse(page, 'table.act');
    await form.getByRole('button', { name: action.title, exact: true }).click();
    const result = await response;
    if (result.status() !== expectedStatus) throw Error(`${actionId}: ${JSON.stringify(await result.json())}`);
    return read(page, id);
  }
  async function metric(page, view, id, expected, title) {
    const outputs = evaluateGenerativeCanvas(view.domain.program.canvas, {
      program: view.domain.program, records: view.domain.records, actor: view.actor.actorId, seat: view.actor.seat ?? 'host', turn: view.domain.turn,
    });
    // A model can choose hyphens or underscores for a semantic identifier.
    // Resolve that spelling difference only; still check the actual formula
    // against the independent expected number and the real rendered card.
    const normalizedId = id.replaceAll('_', '-');
    const metrics = outputs.filter(item => item.kind === 'metric');
    let matches = metrics.filter(item => item.id.replaceAll('_', '-') === normalizedId);
    if (!matches.length && title) {
      const descriptorIds = view.domain.program.canvas.views.filter(item => item.kind === 'metric' && item.title.toLowerCase().startsWith(title.toLowerCase())).map(item => item.id);
      matches = metrics.filter(item => descriptorIds.includes(item.id));
    }
    // Generated identifiers are not user-facing requirements. A single metric
    // is unambiguous; never select a result by its calculated value.
    if (!matches.length && metrics.length === 1) matches = metrics;
    expect(matches).toHaveLength(1);
    const result = matches[0];
    expect(result?.kind).toBe('metric');
    expect(result.value).toBeCloseTo(expected, 5);
    const editor = await object(page, `table.view.${result.id}`);
    await expect(editor.locator('.tt-generated-metric')).toContainText(String(Math.round(expected * 100) / 100));
  }
  function assertShadowScene(view) {
    const point = view.domain.records.lights.find(row => row.id === 'main')?.values;
    expect(point).toBeTruthy();
    if (!point) throw Error('The shadow source record is missing.');
    const outputs = evaluateGenerativeCanvas(view.domain.program.canvas, {
      program: view.domain.program, records: view.domain.records, actor: view.actor.actorId, seat: view.actor.seat ?? 'host', turn: view.domain.turn,
    });
    const scenes = outputs.filter(item => item.kind === 'scene');
    expect(scenes).toHaveLength(1);
    const segments = scenes[0].elements.filter(element => element.shape === 'line'
      && Math.abs(element.x1 - 50) < 0.001
      && Math.abs(element.y1 - 50) < 0.001
      && Math.abs(element.y2 - 90) < 0.001);
    expect(segments).toHaveLength(1);
    const expectedShadowX = point.light_x + (90 - point.light_y) * (50 - point.light_x) / (50 - point.light_y);
    expect(segments[0].x2).toBeCloseTo(expectedShadowX, 5);
    expect(segments[0].y2).toBeCloseTo(90, 5);
    return expectedShadowX;
  }
  const owner = await pageFor(actors[0]);
  try {
    for (const scenario of cases.filter(item => !selectedCase || item.id === selectedCase)) {
      const result = { scenario: scenario.id, result: 'RUNNING' };
      report.cases.push(result);
      try {
        if (await owner.getByRole('link', { name: 'Tabletop home', exact: true }).isVisible().catch(() => false)) {
          await owner.getByRole('link', { name: 'Tabletop home', exact: true }).click();
        }
        const created = owner.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
        await owner.getByRole('button', { name: 'Start a new table', exact: true }).click();
        await owner.getByTestId('start-page').getByRole('button', { name: 'Start empty with your own files', exact: true }).click();
        const room = await (await created).json();
        if (scenario.source) {
          await writeFile(join(output, scenario.source.filename), scenario.source.text);
          const imported = commandResponse(owner, 'table.import');
          await owner.getByTestId('table-chat-bar').getByLabel('Choose a file to attach', { exact: true }).setInputFiles({
            name: scenario.source.filename, mimeType: 'text/markdown', buffer: Buffer.from(scenario.source.text),
          });
          expect((await imported).status()).toBe(200);
        }
        await requestDraft(owner, room.id, scenario.prompt);
        let view = await activate(owner, room.id);
        await writeFile(join(output, `${scenario.id}-generated.json`), JSON.stringify(view.domain.program, null, 2));
        mark(`${scenario.id}: real model creates and activates a reviewed generated tool`);
        if (scenario.id === 'cafe') {
          const espresso = view.domain.records.orders.find(row => row.values.name.toLowerCase() === 'espresso');
          const tea = view.domain.records.orders.find(row => row.values.name.toLowerCase() === 'tea');
          expect(espresso).toBeTruthy();
          expect(tea).toBeTruthy();
          view = await act(owner, room.id, 'finish', { order: espresso.id });
          await metric(owner, view, 'completed-minutes', 3);
          view = await act(owner, room.id, 'finish', { order: tea.id });
          await metric(owner, view, 'completed-minutes', 8);
          const before = structuredClone(view.domain.records);
          await requestDraft(owner, room.id, 'Keep the same collections, actions and records. Add one new metric view id unfinished-count, title Remaining orders, counting only unfinished orders. Preserve all existing view IDs and initialRecords must be empty.');
          view = await activate(owner, room.id);
          expect(view.domain.records).toEqual(before);
          await metric(owner, view, 'unfinished-count', 0, 'Remaining orders');
          mark('cafe: actual UI actions calculate 3 then 8; a real AI edit grows a new card while retaining finished orders');
        } else if (scenario.id === 'shadow') {
          assertShadowScene(view);
          await metric(owner, view, 'shadow-x', 80);
          view = await act(owner, room.id, 'move_light', { light: 'main', x: 30, y: 10 });
          assertShadowScene(view);
          await metric(owner, view, 'shadow-x', 70);
          const scene = view.domain.program.canvas.views.find(item => item.kind === 'scene');
          const editor = await object(owner, `table.view.${scene.id}`);
          const lightShapes = scene.elements.filter(element => element.shape === 'circle' && element.drag?.actionId === 'move_light');
          expect(lightShapes).toHaveLength(1);
          const handle = editor.getByRole('button', { name: `Move ${lightShapes[0].id}`, exact: true });
          await expect(handle).toBeVisible();
          const box = await handle.boundingBox();
          expect(box).not.toBeNull();
          if (!box) throw Error('The draggable light has no visible bounds.');
          const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          const response = commandResponse(owner, 'table.act');
          await owner.mouse.move(start.x, start.y);
          const hitTarget = await owner.evaluate(({ x, y }) => {
            const hit = document.elementFromPoint(x, y);
            return Boolean(hit?.closest('.tt-generated-scene__shape[aria-label="Move light-source"]'));
          }, start);
          expect(hitTarget).toBe(true);
          await owner.mouse.down();
          await owner.mouse.move(start.x + 28, start.y, { steps: 8 });
          await owner.mouse.up();
          expect((await response).status()).toBe(200);
          view = await read(owner, room.id);
          const point = view.domain.records.lights.find(row => row.id === 'main').values;
          expect(point.light_x).not.toBe(30);
          assertShadowScene(view);
          await metric(owner, view, 'shadow-x', point.light_x + (90 - point.light_y) * (50 - point.light_x) / (50 - point.light_y));
          mark('shadow: independent geometry oracle gives 80 then 70; actual pointer drag commits coordinates and recomputes the shadow');
        } else {
          await owner.getByRole('button', { name: 'Invite', exact: true }).click();
          const dialog = owner.getByRole('dialog', { name: 'People at this table' });
          await dialog.getByRole('button', { name: /Member 1/ }).click();
          await dialog.getByRole('button', { name: 'Create invitation for Member 1', exact: true }).click();
          const invite = dialog.getByLabel('One-use invitation link');
          await expect(invite).toBeVisible();
          const inviteUrl = await invite.inputValue();
          await dialog.getByRole('button', { name: 'Close', exact: true }).click();
          const member = await pageFor(actors[1]);
          await member.goto(inviteUrl);
          await expect(member.locator('.tt-canvas-panel')).toBeVisible();
          expect(view.domain.records.tanks).toHaveLength(1);
          const tank = view.domain.records.tanks[0].id;
          const red = view.domain.records.teams.filter(row => row.values.seat === 'host');
          const blue = view.domain.records.teams.filter(row => row.values.seat === 'member-1');
          expect(red).toHaveLength(1);
          expect(blue).toHaveLength(1);
          view = await act(owner, room.id, 'deliver', { tank, team: red[0].id, amount: 20 });
          const memberView = await act(member, room.id, 'deliver', { tank, team: blue[0].id, amount: 15 });
          expect(memberView.domain.records.tanks[0].values.water).toBe(65);
          expect(memberView.domain.records.teams.reduce((sum, row) => sum + row.values.delivered, 0)).toBe(35);
          view = await read(owner, room.id);
          await metric(owner, view, 'conserved-total', 100, 'Conserved total');
          await member.reload();
          await expect(member.locator('.tt-canvas-panel')).toBeVisible();
          expect((await read(member, room.id)).domain.records).toEqual(view.domain.records);
          mark('water: two browser accounts play alternate turns, conserve 100 litres and resume after reload');
        }
        await owner.screenshot({ path: join(output, `${scenario.id}-played.png`), fullPage: true });
        await owner.reload();
        await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
        expect((await read(owner, room.id)).domain.records).toEqual(view.domain.records);
        result.result = 'PASS';
      } catch (error) {
        result.result = 'FAIL';
        result.failure = String(error);
        await owner.screenshot({ path: join(output, `${scenario.id}-failure.png`), fullPage: true }).catch(() => {});
        console.log(`FAIL ${scenario.id}: ${String(error).slice(0, 600)}`);
      }
      await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    }
  } finally {
    await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
    await Promise.all(contexts.map(context => context.close()));
    await browser.close();
  }
  if (report.cases.some(result => result.result !== 'PASS') || report.errors.length) throw Error('Live generative acceptance has failures; see ignored local report.');
}
