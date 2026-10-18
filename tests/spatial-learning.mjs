import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

await mkdir('test-results', { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
const checks = [], errors = [], warnings = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); if (m.type() === 'warning') warnings.push(m.text()); });
const state = () => page.evaluate(async () => {
  const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/state/store.ts')).name;
  return (await import(url)).useWorkspace.getState().workspace;
});
const mark = name => { checks.push(name); console.log('PASS ' + name); };
const fit = async () => { await page.getByLabel('Fit to work', { exact: true }).click(); await page.waitForTimeout(650); };
const closeInspector = async () => { if (await page.getByLabel('Close inspector').count()) await page.getByLabel('Close inspector').click(); };
const core = w => JSON.stringify({ policy: w.policy, dataset: w.dataset, result: w.result, runs: w.runs, proposals: w.proposals });
try {
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/');
  await expect(page).toHaveTitle(/Procedural/);
  await expect(page.getByTestId('start-accounting')).toBeVisible();
  await page.getByTestId('start-accounting').click();
  await page.getByTestId('object-knowledge').waitFor(); await page.waitForTimeout(1500);
  let w = await state();
  expect(new Set(w.objects.map(o => o.position.y)).size).toBeGreaterThanOrEqual(6);
  expect(new Set(w.objects.map(o => o.width)).size).toBeGreaterThanOrEqual(5);
  await expect(page.getByLabel('Toggle snapping')).toHaveAttribute('aria-pressed', 'false');
  await page.screenshot({ path: 'test-results/v2-01-organic-canvas.png' });
  mark('Procedural starts with asymmetric objects and optional snapping off');

  await page.getByRole('button', { name: 'Expand worker', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Inspect calculation', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Collapse worker', exact: true }).click();
  expect((await state()).objects.find(o => o.id === 'worker').collapsed).toBe(true);
  mark('Worker bubble expands into the real worker and collapses');

  await fit();
 await page.getByLabel('Arrange workspace', {exact:true}).click();
  const header = page.getByTestId('object-source').locator('.card-header');
  await header.click();
  const box = await header.boundingBox(); const before = (await state()).objects.find(o => o.id === 'source').position;
  await page.mouse.move(box.x + 70, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 103, box.y + 37, { steps: 8 }); await page.mouse.up();
  w = await state(); const moved = w.objects.find(o => o.id === 'source');
  expect(moved.position).not.toEqual(before); expect(moved.placementMode).toBe('user');
  await page.getByLabel('Pin object', { exact: true }).click();
  const pinned = (await state()).objects.find(o => o.id === 'source'); const pinBox = await header.boundingBox();
  await page.mouse.move(pinBox.x + 70, pinBox.y + 20); await page.mouse.down(); await page.mouse.move(pinBox.x + 110, pinBox.y + 50, { steps: 8 }); await page.mouse.up();
  expect((await state()).objects.find(o => o.id === 'source').position).toEqual(pinned.position);
  await page.getByLabel('Bring to front', { exact: true }).click();
  const front = (await state()).objects.find(o => o.id === 'source').zIndex;
  await page.getByLabel('Send backward', { exact: true }).click();
  expect((await state()).objects.find(o => o.id === 'source').zIndex).toBeLessThan(front);
  await page.getByLabel('Focus selected object', { exact: true }).click();
  await page.waitForTimeout(650);
  mark('Free drag, pin, layer ordering and selected-object focus work');

  await page.getByRole('button', { name: 'Keep workspace', exact: true }).click(); const saved = await state();
  await page.reload(); await page.getByTestId('object-table').waitFor();
  expect((await state()).objects.find(o => o.id === 'source')).toMatchObject({ placementMode: 'pinned', position: pinned.position, zIndex: saved.objects.find(o => o.id === 'source').zIndex });
  mark('Spatial modes and coordinates survive saved refresh');
  await fit();
  const untouched = core(await state());
  await page.getByLabel('Explain calculation for FA-001', { exact: true }).click();
  await expect(page.getByTestId('learning-object')).toContainText('FA-001');
  await expect(page.getByTestId('learning-object')).toContainText('18,000');
  await expect(page.getByTestId('learning-object')).toContainText('Calculation result');
  await page.waitForTimeout(800); await page.screenshot({ path: 'test-results/v2-02-learning-lens.png' });
  expect(core(await state())).toBe(untouched);
  await page.getByLabel('Experiment laptop useful life in months').fill('48');
  await expect(page.getByTestId('useful-life-experiment')).toContainText('48 months');
  expect(core(await state())).toBe(untouched);
  mark('Learning Lens uses actual row evidence; what-if leaves active data, rules and runs unchanged');

  await page.getByTestId('send-experiment-proposal').click();
  expect((await state()).policy.version).toBe(1);
  await page.getByTestId('run-tests').click(); await expect(page.getByTestId('approve-proposal')).toBeDisabled();
  expect((await state()).proposals.at(-1).evaluation.failed).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Reject', exact: true }).click(); await closeInspector();
  mark('An experiment becomes a candidate only; failing authored requirements block approval');
  await page.getByRole('button', { name: 'Teach a rule', exact: true }).click();
  await page.getByTestId('teach-rule').click(); await page.getByTestId('run-tests').click(); await page.getByTestId('approve-proposal').click();
  await page.waitForTimeout(1000); w = await state();
  expect(w.result.rows[0].calculated).toBe(500); expect(w.policy.version).toBe(2);
  expect(w.objects.find(o => o.id === 'source').position).toEqual(pinned.position);
  expect(w.objects.find(o => o.id === 'source').placementMode).toBe('pinned');
  mark('Approved teaching recalculates real results without relocating user-pinned objects');

  await page.getByLabel('Explain calculation for FA-001', { exact: true }).click();
  await page.waitForTimeout(800);
  await expect(page.getByTestId('learning-object')).toContainText('Recorded human instruction');
  await expect(page.getByTestId('useful-life-experiment')).toContainText('฿500.00');
  await expect(page.getByTestId('useful-life-experiment')).toContainText('฿375.00');
  await page.getByTestId('useful-life-experiment').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/v2-03-what-if.png' });
  expect((await state()).policy.laptop.usefulLifeMonths).toBe(36);
  mark('Approved 36-month result shows recorded teaching and simulates 48 months as 500 to 375');

  await page.getByRole('button', { name: 'Explain this workspace', exact: true }).click();
  await page.waitForTimeout(800);
  const overview = page.getByTestId('workspace-overview');
  await expect(overview).toContainText('Northstar'); await expect(overview).toContainText('36'); await expect(overview).toContainText('20');
  await expect(overview).toContainText('Recent changes'); await expect(overview).toContainText('Needs attention');
  await page.screenshot({ path: 'test-results/v2-04-workspace-explanation.png' });
  const viewportBefore = (await state()).viewport;
  await overview.getByRole('button', { name: /Source material source/ }).click(); await page.waitForTimeout(700);
  expect((await state()).viewport).not.toEqual(viewportBefore);
  mark('Workspace explanation derives current capabilities, decisions and attention; links focus real objects');

  await page.reload(); await page.getByTestId('object-overview').waitFor();
  expect((await state()).policy.version).toBe(2); expect((await state()).objects.some(o => o.kind === 'learning')).toBe(true);
  mark('Saved learning and workspace explanation objects restore alongside approved capabilities');
  await page.setViewportSize({ width: 390, height: 844 }); await fit();
  await page.getByRole('button', { name: 'Explain this workspace', exact: true }).click(); await page.waitForTimeout(600);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/v2-05-mobile.png' });
  mark('Mobile spatial controls and explanation stay within the viewport');
  expect(errors).toEqual([]); mark('No browser errors in the V2 interaction journey');
  await writeFile('test-results/spatial-learning-report.json', JSON.stringify({ checks, errors, warnings }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/v2-failure.png' });
  await writeFile('test-results/spatial-learning-report.json', JSON.stringify({ checks, errors, warnings, failure: String(error) }, null, 2));
  throw error;
} finally { await browser.close(); }
