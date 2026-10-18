import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTabletopServer } from '../server/bootstrap.ts';

const output = resolve('test-results/tabletop-r1');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'tabletop-browser-'));
const server = await startTabletopServer({ environment: 'local', port: 0, dataDir: directory, staticDir: resolve('dist') });
const base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], errors = [], pages = [];
let caseStartedAt = Date.now();
const mark = name => { checks.push(name); console.log('PASS ' + name) };
const workbench = page => page.locator('.tt-inspector-panel');
const board = page => page.locator('.tt-canvas-panel');
const surface = async page => (await page.getByRole('button', { name: 'Focus table', exact: true }).getAttribute('aria-pressed')) === 'true' ? workbench(page) : board(page);
async function newPage() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const page = await context.newPage(); pages.push(page);
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  return page;
}
async function current(page) {
  return page.evaluate(async () => {
    const id = localStorage.getItem('tabletop.lastWorkspace');
    const response = await fetch('/api/workspaces/' + id);
    if (!response.ok) throw Error(`Workspace read failed: HTTP ${response.status}`);
    return response.json();
  });
}
async function nextCase() {
  // Seven automated actors share one loopback IP. Keep separate scenarios outside
  // the real one-minute API limit instead of weakening application throttling.
  const remaining = 60_250 - (Date.now() - caseStartedAt);
  if (remaining > 0) await new Promise(resolveWait => setTimeout(resolveWait, Math.min(remaining, 60_000)));
  caseStartedAt = Date.now();
}
async function expectSeparatedObjects(page) {
  await expect.poll(async () => board(page).locator('.tt-canvas-node').evaluateAll(elements => {
    const boxes = elements.map(element => ({ name: element.getAttribute('aria-label'), rect: element.getBoundingClientRect() }));
    const overlaps = [];
    for (let a = 0; a < boxes.length; a++) for (let b = a + 1; b < boxes.length; b++) {
      const left = boxes[a].rect, right = boxes[b].rect;
      if (Math.min(left.right, right.right) - Math.max(left.left, right.left) > 2
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 2) overlaps.push([boxes[a].name, boxes[b].name]);
    }
    return overlaps;
  })).toEqual([]);
}
async function commandFrom(page, type, payload, overrides = {}) {
  const view = await current(page);
  return page.evaluate(async ({ view, type, payload, overrides }) => {
    const session = await (await fetch('/api/session')).json();
    const response = await fetch('/api/workspaces/' + view.id + '/commands', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': session.csrfToken }, body: JSON.stringify({ commandId: crypto.randomUUID(), expectedRevision: view.revision, expectedEpoch: view.epoch, type, payload, ...overrides }) });
    return { status: response.status, body: await response.json() };
  }, { view, type, payload, overrides });
}
async function clickCommand(page, locator, type) {
  // Observe both promises immediately so a response timeout cannot bypass the
  // diagnostic catch while Playwright is still trying to click a moving control.
  const [response] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/commands') && response.request().method() === 'POST' && response.request().postDataJSON().type === type),
    locator.click(),
  ]);
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole('button', { name: 'Refresh latest table' })).toBeEnabled();
  return response.json();
}
async function start(page, label) {
  await page.getByRole('button', { name: new RegExp(label) }).click();
  await expect(page.locator('.tt-canvas-node').first()).toBeVisible();
}
async function focus(page) { await page.getByRole('button', { name: 'Focus table', exact: true }).click() }
async function canvas(page) { await page.getByRole('button', { name: 'Canvas', exact: true }).click() }
async function upload(page, label, filename) {
  const result = page.waitForResponse(r => r.url().endsWith('/uploads') && r.request().method() === 'POST');
  await (await surface(page)).getByLabel(label, { exact: true }).setInputFiles(resolve('public/samples/r1', filename));
  const response = await result;
  expect(response.status(), await response.text()).toBe(200);
  await expect(page.getByRole('button', { name: 'Refresh latest table' })).toBeEnabled();
}
async function verifySource(page, filename) {
  const card = workbench(page).locator('.tt-source-card').filter({ has: page.locator('strong', { hasText: filename }) }).filter({ hasText: 'provided' });
  await card.locator('.tt-source-card__open').click();
  await clickCommand(page, card.getByRole('button', { name: 'Verify', exact: true }), 'invoice.reviewSource');
  await expect(card).toHaveCount(0);
}
async function lifecycle(page) {
  for (const [label, type] of [['Simulate','evolve.simulate'],['Validate','evolve.validate'],['Approve','evolve.approve'],['Activate','evolve.activate']]) {
    await clickCommand(page, (await surface(page)).getByRole('button', { name: new RegExp(label) }).filter({ hasNotText: 'Propose' }), type);
  }
}
async function invite(page, seat) {
  await page.getByRole('button', { name: /^People at this table,/ }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: new RegExp('^' + seat) }).click();
  await dialog.getByRole('button', { name: 'Create invitation for ' + seat, exact: true }).click();
  const field = dialog.getByLabel('One-use invitation link');
  await expect(field).toBeVisible();
  const url = await field.inputValue();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return url;
}
async function joinSeat(url) {
  const page = await newPage();
  await page.goto(url);
  await expect(page.locator('.tt-canvas-node').first()).toBeVisible();
  expect(new URL(page.url()).hash).not.toContain('invite=');
  return page;
}
try {
  const invoice = await newPage();
  await start(invoice, 'Invoice check');
  await expect(invoice.locator('.tt-canvas-node--invoice-table')).toContainText('THB');
  await upload(invoice, 'Choose shipment csv', 'shipments.csv');
  await focus(invoice);
  await verifySource(invoice, 'shipments.csv');
  await upload(invoice, 'Choose invoice pdf', 'invoice.pdf');
  await verifySource(invoice, 'invoice.pdf');
  await upload(invoice, 'Choose rate card pdf', 'rate-card.pdf');
  await verifySource(invoice, 'rate-card.pdf');
  const before = await current(invoice);
  expect(before.domain.shipments).toHaveLength(3);
  expect(before.domain.ruleRevision).toBe(0);
  mark('Real canvas CSV upload and PDF evidence review, including shipment verification');
  await workbench(invoice).getByRole('combobox', { name: /^Rate family/ }).selectOption('surcharge');
  await workbench(invoice).getByRole('combobox', { name: /^Zone/ }).selectOption('*');
  await workbench(invoice).getByLabel('Amount (satang)', { exact: true }).fill('750');
  await workbench(invoice).getByLabel('Start date · inclusive').fill('2026-10-20');
  await workbench(invoice).getByRole('combobox', { name: /^Reviewed rate evidence/ }).selectOption({ label: 'rate-card.pdf · rate-card' });
  await clickCommand(invoice, invoice.getByRole('button', { name: 'Propose this rate' }), 'evolve.propose');
  expect((await current(invoice)).domain.ruleRevision).toBe(0);
  await lifecycle(invoice);
  await expect(workbench(invoice).getByRole('columnheader', { name: 'Surcharge', exact: true })).toBeVisible();
  await expect(workbench(invoice).getByRole('row', { name: 'ALT-BKK-20, matches', exact: true })).toContainText('52.50');
  await expect(workbench(invoice).getByLabel('Current invoice totals')).toContainText('155.00');
  const downloadEvent = invoice.waitForEvent('download');
  await invoice.getByRole('button', { name: 'CSV', exact: true }).click();
  const downloaded = await downloadEvent;
  const exported = await readFile(await downloaded.path(), 'utf8');
  expect(exported).toContain('5250'); expect(exported).toContain('ALT-BKK-20');
  await clickCommand(invoice, invoice.getByRole('button', { name: 'Save run', exact: true }), 'invoice.saveRun');
  await workbench(invoice).getByRole('row', { name: 'ALT-BKK-20, matches', exact: true }).click();
  await expect(workbench(invoice).locator('.tt-source-card.is-focused').filter({ hasText: 'rate-card.pdf' })).toBeVisible();
  await canvas(invoice);
  await expectSeparatedObjects(invoice);
  await expect(invoice.locator('.tt-canvas-node--invoice-table')).toContainText('Extra');
  await invoice.screenshot({ path: join(output, 'invoice-desktop.png') });
  await invoice.reload(); await expect(invoice.locator('.tt-canvas-node--invoice-table')).toContainText('52.50');
  mark('Manual proposal requires simulation, validation, approval and activation; surcharge table, evidence link, CSV and reload agree');
  await invoice.setViewportSize({ width: 390, height: 844 }); await focus(invoice);
  expect(await invoice.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(invoice.getByRole('button', { name: 'Report', exact: true })).toBeVisible();
  await invoice.screenshot({ path: join(output, 'invoice-mobile.png') });
  mark('Narrow viewport retains readable work controls without page overflow');

  await nextCase();
  const teacher = await newPage(); await start(teacher, 'Physics lesson');
  const learner1 = await joinSeat(await invite(teacher, 'Learner 1'));
  const learner2 = await joinSeat(await invite(teacher, 'Learner 2'));
  await board(teacher).getByLabel('Private teacher note', { exact: true }).fill('private-teacher-browser-marker');
  await clickCommand(teacher, board(teacher).getByRole('button', { name: 'Save note', exact: true }), 'teaching.saveNote');
  const firstLearner = await current(learner1);
  const secondLearner = await current(learner2);
  expect(JSON.stringify(firstLearner)).not.toContain('private-teacher-browser-marker');
  await board(teacher).getByLabel('Mass value in kg', { exact: true }).fill('5');
  await clickCommand(teacher, teacher.getByRole('button', { name: 'Update lesson', exact: true }), 'teaching.setParameters');
  await expect(learner1.locator('.tt-canvas-node--lesson-scene')).toContainText('4 m');
  await board(learner1).getByLabel('Mass value in kg', { exact: true }).fill('2');
  await expect(learner1.locator('.tt-canvas-node--lesson-scene')).toContainText('10 m');
  expect((await current(teacher)).domain.parameters.mass).toBe(5);
  const setting = teacher.locator('.tt-inline-learner').filter({ hasText: 'learner-1' });
  await setting.getByRole('combobox', { name: /^View/ }).selectOption('graph');
  await setting.getByRole('combobox', { name: /^Level/ }).selectOption('advanced');
  await clickCommand(teacher, setting.getByRole('button'), 'teaching.setRepresentation');
  await expect(learner1.locator('.tt-canvas-node--lesson-graph')).toBeVisible();
  await expect(learner2.locator('.tt-canvas-node--lesson-graph')).toHaveCount(0);
  await board(learner1).getByLabel('Position in meters', { exact: true }).fill('4');
  await clickCommand(learner1, learner1.getByRole('button', { name: 'Check answer', exact: true }), 'teaching.answer');
  await expect(teacher.locator('.tt-inline-answers')).toContainText('Correct');
  const peer = await current(learner2);
  expect(peer.domain.answers).toEqual([]);
  expect(peer.domain.representations[firstLearner.actor.actorId]).toBeUndefined();
  expect(peer.domain.difficulties[firstLearner.actor.actorId]).toBeUndefined();
  const forbidden = await commandFrom(learner2, 'teaching.setParameters', { force: 0, mass: 1, time: 2 });
  expect(forbidden.status).toBe(403);
  await expectSeparatedObjects(teacher);
  await expectSeparatedObjects(learner1);
  await teacher.screenshot({ path: join(output, 'teaching-teacher.png') });
  await learner1.screenshot({ path: join(output, 'teaching-learner.png') });
  mark('Three real sessions share physics; learner exploration, representation and answers stay correctly scoped');
  await learner2.reload(); await expect(learner2.locator('.tt-canvas-node--lesson-scene')).toContainText('4 m');
  await teacher.getByRole('button', { name: 'Reset table', exact: true }).click();
  await teacher.getByRole('dialog').getByRole('button', { name: 'Keep current table' }).focus();
  await teacher.keyboard.press('Shift+Tab');
  await expect(teacher.getByRole('dialog').getByRole('button', { name: 'Reset table', exact: true })).toBeFocused();
  await clickCommand(teacher, teacher.getByRole('dialog').getByRole('button', { name: 'Reset table', exact: true }), 'workspace.reset');
  const revoked = await learner2.request.get(`${base}/api/workspaces/${secondLearner.id}`);
  expect([401,403]).toContain(revoked.status());
  mark('Reset dialog keyboard trap works and reset revokes prior learner sessions');

  await nextCase();
  const dm = await newPage(); await start(dm, 'Shared encounter');
  const mira = await joinSeat(await invite(dm, 'Mira'));
  const pip = await joinSeat(await invite(dm, 'Pip'));
  await board(dm).getByLabel('Private DM note', { exact: true }).fill('private-dm-browser-marker');
  await clickCommand(dm, board(dm).getByRole('button', { name: 'Save note', exact: true }), 'encounter.saveNote');
  await board(dm).getByLabel('Allow shielding an ally').check();
  await board(dm).getByLabel('Shield cost').selectOption('1');
  await board(dm).getByLabel('Once per character turn').check();
  await clickCommand(dm, dm.getByRole('button', { name: 'Propose rule', exact: true }), 'evolve.propose');
  await lifecycle(dm);
  // The canvas initially focuses the board, while rule activation can add objects.
  // Use the same navigation as a player before targeting the separate action card.
  await dm.getByRole('button', { name: 'Fit objects', exact: true }).click();
  await mira.getByRole('button', { name: 'Fit objects', exact: true }).click();
  await clickCommand(dm, dm.getByRole('button', { name: 'Hit Pip', exact: true }), 'encounter.declareHit');
  const playerProjection = await current(mira);
  expect(playerProjection.domain.pendingHit.roll).toBeNull();
  expect(playerProjection.domain.pendingHit.damage).toBeNull();
  expect(playerProjection.domain.characters.some(c => c.id === 'goblin')).toBe(false);
  expect(JSON.stringify(playerProjection)).not.toContain('private-dm-browser-marker');
  await clickCommand(mira, mira.getByRole('button', { name: /Shield Pip as ally/ }), 'encounter.shield');
  await clickCommand(dm, dm.getByRole('button', { name: 'Resolve hit', exact: true }), 'encounter.resolve');
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  await expect(mira.locator('.tt-inline-character-list')).toContainText('1 AP');
  await expectSeparatedObjects(dm);
  await expectSeparatedObjects(mira);
  await dm.screenshot({ path: join(output, 'encounter-dm.png') });
  await mira.screenshot({ path: join(output, 'encounter-player.png') });
  const illegalResolve = await commandFrom(mira, 'encounter.resolve', {});
  expect(illegalResolve.status).toBe(403);
  await clickCommand(dm, dm.getByRole('button', { name: /End .*turn/ }), 'encounter.endTurn');
  await expect(mira.locator('.tt-inline-character-list')).toContainText('2 AP');
  await pip.reload(); await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  mark('DM + two players share a real reaction; private hit values stay hidden, ally shield consumes AP, turn restores AP and reload preserves HP');
  expect(errors).toEqual([]);
  mark('No uncaught browser JavaScript errors across all seven independent contexts');
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors, date: new Date().toISOString(), liveModel: 'not configured', hosting: 'local loopback' }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors }));
} catch (error) {
  for (let i=0;i<pages.length;i++) if (!pages[i].isClosed()) await pages[i].screenshot({ path: join(output, `failure-${i}.png`) }).catch(()=>{});
  await writeFile(join(output, 'report.json'), JSON.stringify({ checks, errors, failure: String(error) }, null, 2));
  throw error;
} finally {
  await browser.close(); await server.close();
  const absolute = resolve(directory);
  if (!absolute.startsWith(resolve(tmpdir()) + sep) || !absolute.includes('tabletop-browser-')) throw Error('Unsafe test cleanup');
  await rm(absolute, { recursive: true, force: true });
}
