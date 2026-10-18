import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const base = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const reportDir = 'test-results/demo-controls';
await mkdir(reportDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const player = page.getByTestId('demo-player');
const mark = label => { checks.push(label); console.log(`PASS ${label}`); };

async function pauseAtReading() {
  await expect(player).toHaveAttribute('data-phase', 'reading', { timeout: 30000 });
  if (await page.getByLabel('Pause demo', { exact: true }).isVisible()) {
    await page.getByLabel('Pause demo', { exact: true }).click();
  }
}

async function advanceTo(action) {
  await page.getByLabel('Next demo scene', { exact: true }).click();
  await expect(player).toHaveAttribute('data-scene', action, { timeout: 30000 });
  await pauseAtReading();
}

try {
  let releaseDatabase;
  let signalDatabaseRequest;
  const databaseGate = new Promise(resolve => { releaseDatabase = resolve; });
  const databaseRequested = new Promise(resolve => { signalDatabaseRequest = resolve; });
  await page.route('**/data/northstar-db-snapshot.json', async route => {
    signalDatabaseRequest();
    await databaseGate;
    await route.continue();
  });

  await page.goto(base);
  await page.getByTestId('watch-demo').click();
  await page.getByLabel('Demo playback speed').selectOption('16');
  await databaseRequested;
  await page.getByLabel('Pause demo', { exact: true }).click();
  await expect(page.getByLabel('Resume demo', { exact: true })).toBeVisible();
  releaseDatabase();
  await page.waitForTimeout(500);
  for (const kind of ['context', 'source', 'worker', 'table']) {
    await expect(page.getByTestId(`object-${kind}`)).toHaveCount(0);
  }
  mark('A paused source load creates no canvas objects after the held database request resolves');

  await page.getByLabel('Resume demo', { exact: true }).click();
  await expect(page.getByTestId('object-table').locator('tbody tr').first()).toBeVisible({ timeout: 30000 });
  await page.getByLabel('Demo playback speed').selectOption('4');
  await pauseAtReading();
  await expect(page.getByTestId('object-table').locator('th')).toHaveCount(2);
  mark('Resuming the paused load continues to the real first table');

  for (const action of ['compare', 'why', 'teach', 'test', 'approve', 'experiment']) await advanceTo(action);
  const proof = page.getByTestId('demo-learning-proof');
  const slider = page.getByLabel('Experiment laptop useful life in months');
  await expect(proof).toHaveAttribute('data-focus', 'experiment');
  await expect(slider).toHaveValue('48');
  await slider.scrollIntoViewIfNeeded();
  await slider.fill('60');
  await expect(proof).toContainText('ทดลองอายุใช้งาน 60 เดือน');
  mark('The guided experiment slider is editable while its scene is active');

  await page.getByLabel('Previous demo scene', { exact: true }).click();
  await expect(player).toHaveAttribute('data-scene', 'approve');
  await page.getByLabel('Resume demo', { exact: true }).click();
  await expect(player).toHaveAttribute('data-phase', 'reading', { timeout: 30000 });
  await expect(proof).toHaveAttribute('data-focus', 'approved');
  await page.getByLabel('Pause demo', { exact: true }).click();
  expect(await slider.inputValue()).toBe('60');

  await advanceTo('experiment');
  await expect(proof).toHaveAttribute('data-focus', 'experiment');
  await expect(slider).toHaveValue('48');
  await expect(proof).toContainText('ทดลองอายุใช้งาน 48 เดือน');
  await expect(proof).toContainText('฿375.00');
  mark('Rewinding to approval and returning to the experiment resets the slider to the 48-month result');

  await page.getByRole('button', { name: 'ลองเอง', exact: true }).click();
  await expect(player).toHaveCount(0);
  await slider.scrollIntoViewIfNeeded();
  await slider.fill('60');
  await expect(slider).toHaveValue('60');
  mark('Taking over leaves the manual Learning Lens slider editable');

  expect(errors).toEqual([]);
  const report = { checks, errors };
  await writeFile(`${reportDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { checks, errors, failure: String(error) };
  await writeFile(`${reportDir}/report.json`, JSON.stringify(report, null, 2));
  throw error;
} finally {
  await browser.close();
}
