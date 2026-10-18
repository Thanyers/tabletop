import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.TRIO_URL || 'http://127.0.0.1:5173/';
const output = process.env.TRIO_REPORT_DIR || 'test-results/trio-case-interactions';
const cases = ['shipping', 'quest', 'music'];
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
const reports = [];
await mkdir(output, { recursive: true });

function mark(caseId, label) {
  checks.push(`${caseId}: ${label}`);
  console.log(`PASS ${caseId}: ${label}`);
}

async function focusNode(page, step) {
  await page.getByLabel('Fit to work', { exact: true }).click();
  await page.waitForTimeout(250);
  const header = page.getByTestId(`canvas-object-${step}`).locator('.trio-canvas-node__chrome');
  await header.dblclick({ timeout: 10_000 });
  await page.waitForTimeout(300);
}

async function openCase(page, id, errors) {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByTestId('trio-demo-picker').waitFor();
  const originalFlow = await page.locator('.canvas-area .react-flow').elementHandle();
  expect(originalFlow).toBeTruthy();
  await page.getByTestId(`case-${id}`).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-case', id);
  expect(await originalFlow.evaluate((element) => element.isConnected), 'story uses the original ReactFlow instance').toBe(true);
  await page.getByLabel('Story playback speed', { exact: true }).selectOption('4');
  await page.getByLabel('Start demo', { exact: true }).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase', 'complete', { timeout: 90_000 });
  await expect(page.locator('[data-trio-object]')).toHaveCount(8);
  await page.screenshot({ path: `${output}/${id}-guided-complete.png` });
  await page.getByLabel('Take over workspace', { exact: true }).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-guided', 'false');
  await expect(page.locator('.trio-manual-dock')).toBeVisible();
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-guided', 'false');
  return { errors, originalFlow };
}

async function testEarlyManualPath() {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(base, { waitUntil: 'networkidle' });
    await page.getByTestId('trio-demo-picker').waitFor();
    await page.getByTestId('case-shipping').click();
    await page.getByLabel('Take over workspace', { exact: true }).click();
    const stage = page.getByTestId('trio-stage');
    await expect(stage).toHaveAttribute('data-level', '0');
    await page.getByTestId('trio-continue').click();
    await expect(stage).toHaveAttribute('data-level', '1');
    const source = page.getByTestId('canvas-object-sources');
    await source.getByRole('button', { name: 'เปิดรายละเอียดข้อมูลต้นทาง' }).click();
    await expect(source.locator('a[href="/data/shipping-orders.csv"]')).toBeVisible();
    await expect(source.locator('a[href="/data/shipping-contract.json"]')).toBeVisible();
    mark('shipping', 'early takeover exposes source details and attached files');

    for (const level of [2, 3, 4, 5, 6, 7, 8]) {
      await page.getByTestId('trio-continue').click();
      await expect(stage).toHaveAttribute('data-level', String(level));
    }
    await expect(page.getByTestId('canvas-object-handoff')).toBeVisible();
    mark('shipping', 'manual Continue advances from level 0 through verification, approval, simulation, and handoff');
    expect(errors).toEqual([]);
    await page.screenshot({ path: `${output}/shipping-early-manual-path.png` });
    await writeFile(`${output}/early-manual.json`, JSON.stringify({ checks: checks.slice(-2), errors }, null, 2));
  } catch (error) {
    await page.screenshot({ path: `${output}/early-manual-failure.png` });
    await writeFile(`${output}/early-manual-failure.json`, JSON.stringify({ error: String(error), errors }, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}

async function testCase(id) {
  const context = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const report = { id, checks: [], errors };

  const localMark = (label) => {
    report.checks.push(label);
    mark(id, label);
  };

  try {
    await openCase(page, id, errors);

    const expectedSource = {
      shipping: ['/data/shipping-orders.csv', '/data/shipping-contract.json'],
      quest: ['/data/quest-playtest.csv'],
      music: ['/data/music-rehearsal.csv'],
    }[id];
    await focusNode(page, 'sources');
    const source = page.getByTestId('canvas-object-sources');
    await source.getByRole('button', { name: 'เปิดรายละเอียดข้อมูลต้นทาง' }).click();
    for (const href of expectedSource) await expect(source.locator(`a[href="${href}"]`)).toBeVisible();
    localMark('source details expose the case files in the original Canvas');

    await page.getByLabel('Learning Lens', { exact: true }).click();
    const fieldId = { shipping: 'draft-bangkok', quest: 'draft-firstHint', music: 'draft-chorusBpm' }[id];
    const badValue = { shipping: '34', quest: '120', music: '90' }[id];
    const goodValue = { shipping: '35', quest: '180', music: '80' }[id];
    const field = page.locator(`#${fieldId}`);
    await expect(field).toBeVisible();
    await expect(field).toBeEnabled();
    const approve = page.getByLabel('Approve tested rule', { exact: true });
    const activeBefore = await page.getByTestId('active-rule-summary').innerText();

    await field.fill(badValue);
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-guided', 'false');
    localMark('editing the real draft immediately invalidates the prior approval gate');

    const dock = page.locator('.trio-manual-dock');
    await dock.getByRole('button', { name: 'Run example checks', exact: true }).click();
    await expect(approve).toBeDisabled();
    localMark('failing current draft cannot be approved');

    await field.fill(goodValue);
    await expect(approve).toBeDisabled();
    await dock.getByRole('button', { name: 'Run example checks', exact: true }).click();
    await expect(page.getByText(/8 ผ่าน · 0 ไม่ผ่าน|ตัวอย่างตรงกับกติกา/).first()).toBeVisible({ timeout: 10_000 });
    await expect(approve).toBeDisabled();
    await expect(approve).toContainText('กำลังใช้อยู่');
    expect(await page.getByTestId('active-rule-summary').innerText()).toBe(activeBefore);
    localMark('restoring the taught value passes all examples; the already-active version remains approved without a duplicate version');

    expect(await page.getByTestId('active-rule-summary').innerText()).toBe(activeBefore);
    const activeAfterApproval = await page.getByTestId('active-rule-summary').innerText();

    if (id === 'shipping') {
      await dock.getByLabel('Describe a rule change', { exact: true }).fill('ทดลอง');
      await dock.getByLabel('Apply rule instruction', { exact: true }).click();
      const slider = page.getByTestId('canvas-object-simulate').getByTestId('simulation-control');
      await expect(slider).toBeVisible();
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press('ArrowRight');
      expect(await slider.inputValue()).not.toBe(before);
      expect(await page.getByTestId('active-rule-summary').innerText()).toBe(activeAfterApproval);
      localMark('shipping simulation changes independently while Active remains at the approved rate');
    }

    if (id === 'quest') {
      await focusNode(page, 'minimal');
      const minimal = page.getByTestId('canvas-object-minimal');
      await minimal.getByLabel('Start game timer', { exact: true }).click();
      await page.waitForTimeout(1_150);
      await minimal.getByLabel('Pause game timer', { exact: true }).click();
      const stoppedAt = await minimal.locator('.trio-quest-clock strong').innerText();
      expect(stoppedAt).not.toBe('0:00');
      await page.waitForTimeout(1_050);
      await expect(minimal.locator('.trio-quest-clock strong')).toHaveText(stoppedAt);
      await minimal.getByRole('button', { name: 'ทำเครื่องหมายว่าจบ', exact: true }).click();
      await expect(minimal.getByLabel('Start game timer', { exact: true })).toBeDisabled();
      localMark('quest timer starts, pauses at a stable elapsed time, and records solved state');

      await dock.getByLabel('Describe a rule change', { exact: true }).fill('ทดลอง');
      await dock.getByLabel('Apply rule instruction', { exact: true }).click();
      const slider = page.getByTestId('canvas-object-simulate').getByTestId('simulation-control');
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press('ArrowRight');
      expect(await slider.inputValue()).not.toBe(before);
      expect(await page.getByTestId('active-rule-summary').innerText()).toBe(activeAfterApproval);
      await focusNode(page, 'minimal');
      await expect(page.getByTestId('canvas-object-minimal').locator('.trio-quest-clock strong')).toHaveText(stoppedAt);
      localMark('quest simulation time moves independently from the paused game timer and Active rule');
    }

    if (id === 'music') {
      await focusNode(page, 'minimal');
      const minimal = page.getByTestId('canvas-object-minimal');
      const beatTrack = minimal.locator('.trio-beat-track');
      const initialBeat = await beatTrack.getAttribute('aria-label');
      await minimal.getByLabel('Start metronome', { exact: true }).click();
      await page.waitForTimeout(1_000);
      await expect(minimal.getByLabel('Stop metronome', { exact: true })).toBeVisible();
      const playingBeat = await beatTrack.getAttribute('aria-label');
      expect(playingBeat).not.toBe(initialBeat);
      await minimal.getByLabel('Stop metronome', { exact: true }).click();
      const stoppedBeat = await beatTrack.getAttribute('aria-label');
      await page.waitForTimeout(850);
      await expect(beatTrack).toHaveAttribute('aria-label', stoppedBeat);
      await minimal.getByLabel('Mark late entry', { exact: true }).click();
      await expect(minimal.locator('.trio-music-feedback')).toContainText('เข้าช้า');
      localMark('music visual metronome advances and stops; user marks a late entry');

      await dock.getByLabel('Describe a rule change', { exact: true }).fill('ทดลอง');
      await dock.getByLabel('Apply rule instruction', { exact: true }).click();
      const slider = page.getByTestId('canvas-object-simulate').getByTestId('simulation-control');
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press('ArrowRight');
      expect(await slider.inputValue()).not.toBe(before);
      expect(await page.getByTestId('active-rule-summary').innerText()).toBe(activeAfterApproval);
      localMark('music simulation slider changes only the separate experimental tempo');
    }

    await page.getByLabel('Save workspace', { exact: true }).click();
    const saved = await page.evaluate((caseId) => {
      const raw = localStorage.getItem(`procedural.trio.manual.v1.${caseId}`);
      return raw ? JSON.parse(raw) : null;
    }, id);
    expect(saved?.snapshot?.caseId).toBe(id);
    expect(saved.snapshot.approved).toBe(true);
    expect(saved.snapshot.evaluation?.failed).toBe(0);
    if (id === 'shipping') expect(saved.snapshot.active.shipping.bangkok).toBe(35);
    if (id === 'quest') expect(saved.snapshot.active.quest.firstHint).toBe(180);
    if (id === 'music') {
      expect(saved.snapshot.active.music.chorusBpm).toBe(80);
      expect(saved.snapshot.events.some((event) => event.kind === 'source' && event.title === 'บันทึกจากคนซ้อม' && event.detail.includes('เข้าช้า'))).toBe(true);
    }
    localMark('Save persists this case’s approved result and user interaction evidence');
    expect(errors).toEqual([]);
    report.errors = errors;
    reports.push(report);
    await page.screenshot({ path: `${output}/${id}-manual-workspace.png` });
    await writeFile(`${output}/${id}-report.json`, JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error);
    report.pageText = await page.locator('body').innerText().catch(() => '');
    reports.push(report);
    await page.screenshot({ path: `${output}/${id}-failure.png` }).catch(() => {});
    await writeFile(`${output}/${id}-failure.json`, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await testEarlyManualPath();
  for (const id of cases) await testCase(id);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, reports }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, cases: cases.length, reports: `${output}/report.json` }));
} catch (error) {
  await writeFile(`${output}/failure.json`, JSON.stringify({ error: String(error), checks, reports }, null, 2));
  throw error;
} finally {
  await browser.close();
}
