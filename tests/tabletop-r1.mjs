import { chromium, expect } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTabletopServer } from '../server/bootstrap.ts';

const output = resolve('test-results/tabletop-r1');
await mkdir(output, { recursive: true });
const directory = await mkdtemp(join(tmpdir(), 'tabletop-browser-'));
// Each scenario gets its own server so the real per-IP API limit starts fresh
// without waiting out its one-minute window or weakening application throttling.
let caseNumber = 0;
const startCaseServer = () => startTabletopServer({ environment: 'local', port: 0, dataDir: join(directory, `case-${++caseNumber}`), staticDir: resolve('dist') });
let server = await startCaseServer();
let base = `http://127.0.0.1:${server.port}`;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [], errors = [], pages = [];
const mark = name => { checks.push(name); console.log('PASS ' + name) };
const board = page => page.locator('.tt-canvas-panel');
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
  // Seven automated actors share one loopback IP. Close the previous scenario's
  // contexts before its server so no open socket reports a disconnect as a page error.
  for (const page of pages) if (!page.isClosed()) await page.context().close();
  await server.close();
  server = await startCaseServer();
  base = `http://127.0.0.1:${server.port}`;
}
async function expectSeparatedObjects(page) {
  await closeExpandedObjects(page);
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
  return response.json();
}
async function start(page, label) {
  const templates = page.locator('.tt-template-choices');
  const choice = templates.getByRole('button', { name: new RegExp(label) });
  if (!(await choice.isVisible().catch(() => false))) {
    await expect(templates.locator('summary')).toHaveText('Or explore what a table can become');
    await expect(templates).not.toHaveAttribute('open', '');
    await templates.locator('summary').click();
    await expect(choice).toBeVisible();
  }
  await choice.click();
  await expect(page.locator('.tt-canvas-node').first()).toBeVisible();
}
async function openObject(page, id) {
  const editor = board(page).locator(`.tt-canvas-node[data-testid="canvas-object-editor"][data-object-id="${id}"]`);
  if (await editor.isVisible().catch(() => false)) return editor;
  await closeExpandedObjects(page);
  const trigger = page.getByTestId('canvas-object-menu-trigger');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const dock = page.getByTestId('canvas-object-dock');
  await expect(dock).toBeVisible();
  await dock.getByTestId('open-canvas-' + id).click();
  await expect(editor).toBeVisible();
  return editor;
}
async function closeExpandedObjects(page) {
  const editors = board(page).locator('.tt-canvas-node.is-expanded');
  while (await editors.count()) {
    const editor = editors.first();
    const objectId = await editor.getAttribute('data-canvas-object');
    await editor.getByRole('button', { name: 'Close object', exact: true }).click();
    await expect(board(page).locator(`.tt-canvas-node[data-canvas-object="${objectId}"]`)).not.toHaveClass(/is-expanded/);
  }
}
async function upload(page, label, filename) {
  const result = page.waitForResponse(r => r.url().endsWith('/uploads') && r.request().method() === 'POST');
  const editor = await openObject(page, 'invoice.source');
  await editor.getByLabel(label, { exact: true }).setInputFiles(resolve('public/samples/r1', filename));
  const response = await result;
  expect(response.status(), await response.text()).toBe(200);
  await expect(editor.locator('.tt-source-card').filter({ has: page.getByText(filename, { exact: true }) })).toBeVisible();
}
async function verifySource(page, filename) {
  const editor = await openObject(page, 'invoice.source');
  const card = editor.locator('.tt-source-card').filter({ has: page.getByText(filename, { exact: true }) }).filter({ hasText: 'provided' });
  if (await card.locator('.tt-source-preview').count() === 0) await card.locator('.tt-source-card__open').click();
  await clickCommand(page, card.getByRole('button', { name: 'Verify', exact: true }), 'invoice.reviewSource');
  await expect(card).toHaveCount(0);
}
async function lifecycle(page, objectId) {
  let editor;
  for (const [label, type] of [['Preview change','evolve.simulate'],['Check rules','evolve.validate'],['Approve rules','evolve.approve'],['Use these rules','evolve.activate']]) {
    editor = await openObject(page, objectId);
    // The lifecycle label describes the next owner decision at each stage.
    await clickCommand(page, editor.getByRole('region', { name:/^(Review this change|Rules in use)$/ }).getByRole('button', { name:new RegExp('\\b' + label + '$') }), type);
  }
  return editor;
}
async function invite(page, seat) {
  const people = await openObject(page, 'workspace.people');
  await people.getByRole('button', { name: 'Invite someone', exact: true }).click();
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
  const workspacePicker = invoice.locator('.tt-workspace-picker__button');
  await expect(workspacePicker).toBeVisible();
  await workspacePicker.click();
  await expect(workspacePicker).toHaveAttribute('aria-expanded', 'true');
  const workspaceMenu = invoice.locator('.tt-workspace-menu');
  await expect(workspaceMenu).toBeVisible();
  await expect(workspaceMenu).toContainText('START A TABLE');
  await invoice.getByRole('button', { name:'Close table menu', exact:true }).click();
  await expect(invoice.locator('.tt-canvas-node--invoice-table')).toContainText('THB');
  await upload(invoice, 'Choose shipment csv', 'shipments.csv');
  await verifySource(invoice, 'shipments.csv');
  await upload(invoice, 'Choose invoice pdf', 'invoice.pdf');
  await verifySource(invoice, 'invoice.pdf');
  await upload(invoice, 'Choose rate card pdf', 'rate-card.pdf');
  await verifySource(invoice, 'rate-card.pdf');
  const before = await current(invoice);
  expect(before.domain.shipments).toHaveLength(3);
  expect(before.domain.ruleRevision).toBe(0);
  mark('Real canvas CSV upload and PDF evidence review, including shipment verification');
  const rules = await openObject(invoice, 'invoice.rules');
  await rules.getByRole('combobox', { name: /^Rate family/ }).selectOption('surcharge');
  await rules.getByRole('combobox', { name: /^Zone/ }).selectOption('*');
  await rules.getByLabel('Amount (satang)', { exact: true }).fill('750');
  await rules.getByLabel('Start · inclusive', { exact: true }).fill('2026-10-20');
  await rules.getByRole('combobox', { name: /^Verified rate evidence/ }).selectOption({ label: 'rate-card.pdf' });
  await clickCommand(invoice, rules.getByRole('button', { name: 'Propose dated rule', exact: true }), 'evolve.propose');
  expect((await current(invoice)).domain.ruleRevision).toBe(0);
  await lifecycle(invoice, 'invoice.rules');
  const table = await openObject(invoice, 'invoice.table');
  await expect(table.getByRole('columnheader', { name: 'Extra', exact: true })).toBeVisible();
  await expect(table.getByRole('row', { name: /ALT-BKK-20, matches/ })).toContainText('52.50');
  await expect(table.locator('.tt-inline-kpis')).toContainText('155.00');
  const downloadEvent = invoice.waitForEvent('download');
  await table.getByRole('button', { name: 'CSV', exact: true }).click();
  const downloaded = await downloadEvent;
  const exported = await readFile(await downloaded.path(), 'utf8');
  expect(exported).toContain('5250'); expect(exported).toContain('ALT-BKK-20');
  await clickCommand(invoice, table.getByRole('button', { name: 'Save run', exact: true }), 'invoice.saveRun');
  await table.getByRole('row', { name: /ALT-BKK-20, matches/ }).click();
  const source = await openObject(invoice, 'invoice.source');
  await expect(source.locator('.tt-source-card.is-focused').filter({ hasText: 'rate-card.pdf' })).toBeVisible();
  await expectSeparatedObjects(invoice);
  await expect(invoice.locator('.tt-canvas-node--invoice-table')).toContainText('155.00');
  await invoice.screenshot({ path: join(output, 'invoice-desktop.png') });
  await invoice.reload();
  const reloadedTable = await openObject(invoice, 'invoice.table');
  await expect(reloadedTable.getByRole('row', { name: /ALT-BKK-20, matches/ })).toContainText('52.50');
  mark('Manual proposal requires simulation, validation, approval and activation; surcharge table, evidence link, CSV and reload agree');
  await invoice.setViewportSize({ width: 390, height: 844 });
  expect(await invoice.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const mobileTable = await openObject(invoice, 'invoice.table');
  await expect(mobileTable.getByRole('button', { name: 'Report', exact: true })).toBeVisible();
  await invoice.screenshot({ path: join(output, 'invoice-mobile.png') });
  mark('Narrow viewport retains readable work controls without page overflow');

  await nextCase();
  const teacher = await newPage(); await start(teacher, 'Physics lesson');
  const learner1 = await joinSeat(await invite(teacher, 'Learner 1'));
  const learner2 = await joinSeat(await invite(teacher, 'Learner 2'));
  let teacherQuestions = await openObject(teacher, 'lesson.question');
  await teacherQuestions.getByLabel('Private teacher note', { exact: true }).fill('private-teacher-browser-marker');
  await clickCommand(teacher, teacherQuestions.getByRole('button', { name: 'Save note', exact: true }), 'teaching.saveNote');
  const firstLearner = await current(learner1);
  const secondLearner = await current(learner2);
  expect(JSON.stringify(firstLearner)).not.toContain('private-teacher-browser-marker');
  const teacherSource = await openObject(teacher, 'lesson.source');
  await teacherSource.getByLabel('Mass value in kg', { exact: true }).fill('5');
  await clickCommand(teacher, teacherSource.getByRole('button', { name: 'Update lesson', exact: true }), 'teaching.setParameters');
  await expect(learner1.locator('.tt-canvas-node--lesson-scene')).toContainText('4 m');
  const learnerSource = await openObject(learner1, 'lesson.source');
  await learnerSource.getByLabel('Mass value in kg', { exact: true }).fill('2');
  await expect(learner1.locator('.tt-canvas-node--lesson-scene')).toContainText('10 m');
  expect((await current(teacher)).domain.parameters.mass).toBe(5);
  teacherQuestions = await openObject(teacher, 'lesson.question');
  const setting = teacherQuestions.locator('.tt-inline-learner').filter({ hasText: 'learner-1' });
  await setting.getByRole('combobox', { name: /^View/ }).selectOption('graph');
  await setting.getByRole('combobox', { name: /^Level/ }).selectOption('advanced');
  await clickCommand(teacher, setting.getByRole('button'), 'teaching.setRepresentation');
  await expect(learner1.locator('.tt-canvas-node--lesson-graph')).toBeVisible();
  await expect(learner2.locator('.tt-canvas-node--lesson-graph')).toHaveCount(0);
  const learnerQuestion = await openObject(learner1, 'lesson.question');
  await learnerQuestion.getByLabel('Position in meters', { exact: true }).fill('4');
  await clickCommand(learner1, learnerQuestion.getByRole('button', { name: 'Check answer', exact: true }), 'teaching.answer');
  teacherQuestions = await openObject(teacher, 'lesson.question');
  await expect(teacherQuestions.locator('.tt-inline-answers')).toContainText('Correct');
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
  const tableOptions = teacher.locator('.tt-table-options');
  if (await tableOptions.getAttribute('open') === null) await tableOptions.locator('summary').click();
  await expect(tableOptions).toHaveAttribute('open', '');
  await tableOptions.getByRole('button', { name: 'Reset table', exact: true }).click();
  // Wait for the dialog's initial focus effect before testing its keyboard trap.
  // Forcing focus here races the dialog's scheduled autofocus.
  await expect(teacher.getByRole('dialog').getByRole('button', { name: 'Keep current table' })).toBeFocused();
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
  const dmRules = await openObject(dm, 'encounter.source');
  await dmRules.getByLabel('Private DM note', { exact: true }).fill('private-dm-browser-marker');
  await clickCommand(dm, dmRules.getByRole('button', { name: 'Save note', exact: true }), 'encounter.saveNote');
  await dmRules.getByLabel('Allow shielding an ally').check();
  await dmRules.getByLabel('Shield cost').selectOption('1');
  await dmRules.getByLabel('Once per character turn').check();
  await clickCommand(dm, dmRules.getByRole('button', { name: 'Propose rule', exact: true }), 'evolve.propose');
  await lifecycle(dm, 'encounter.source');
  const dmActions = await openObject(dm, 'encounter.actions');
  await clickCommand(dm, dmActions.getByRole('button', { name: 'Hit Pip', exact: true }), 'encounter.declareHit');
  const playerProjection = await current(mira);
  expect(playerProjection.domain.pendingHit.roll).toBeNull();
  expect(playerProjection.domain.pendingHit.damage).toBeNull();
  expect(playerProjection.domain.characters.some(c => c.id === 'goblin')).toBe(false);
  expect(JSON.stringify(playerProjection)).not.toContain('private-dm-browser-marker');
  const miraActions = await openObject(mira, 'encounter.actions');
  await clickCommand(mira, miraActions.getByRole('button', { name: /Shield Pip as ally/ }), 'encounter.shield');
  const refreshedDmActions = await openObject(dm, 'encounter.actions');
  await clickCommand(dm, refreshedDmActions.getByRole('button', { name: 'Resolve hit', exact: true }), 'encounter.resolve');
  await expect(pip.locator('.tt-inline-character-list')).toContainText('8/10 HP');
  await expect(mira.locator('.tt-inline-character-list')).toContainText('1 AP');
  await expectSeparatedObjects(dm);
  await expectSeparatedObjects(mira);
  await dm.screenshot({ path: join(output, 'encounter-dm.png') });
  await mira.screenshot({ path: join(output, 'encounter-player.png') });
  const illegalResolve = await commandFrom(mira, 'encounter.resolve', {});
  expect(illegalResolve.status).toBe(403);
  const endTurnActions = await openObject(dm, 'encounter.actions');
  await clickCommand(dm, endTurnActions.getByRole('button', { name: /End .*turn/ }), 'encounter.endTurn');
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
