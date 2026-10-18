import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text());
});

try {
  await mkdir('test-results', { recursive: true });
  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/');
  const storeUrl = await page.evaluate(() =>
    performance.getEntriesByType('resource').find((entry) => entry.name.includes('/src/state/store.ts'))?.name,
  );
  expect(storeUrl).toBeTruthy();

  await page.evaluate(async (url) => {
    if (url === undefined) throw new Error('Workspace store module was not loaded.');
    const { useWorkspace, ACCOUNTING_PROMPT } = await import(url);
    const store = useWorkspace.getState();
    store.startDemo();
    const generation = store.begin('accounting', ACCOUNTING_PROMPT);
    store.addObject('table', generation);
    store.finish(generation);
    store.setLens('constellation');
  }, storeUrl);

  await expect(page.getByTestId('knowledge-constellation')).toBeVisible();
  await expect(page.getByTestId('guided-knowledge-path')).toHaveCount(0);

  await page.evaluate(async (url) => {
    if (url === undefined) throw new Error('Workspace store module was not loaded.');
    const { useWorkspace } = await import(url);
    const store = useWorkspace.getState();
    const before = structuredClone(store.workspace.policy);
    store.propose({
      ...before,
      laptop: { threshold: 15_000, usefulLifeMonths: 36, start: 'in-service' },
    }, 'Set the laptop threshold to ฿15,000 and use 36 months from the in-service month.');
    store.testProposal();
    store.approve();
  }, storeUrl);

  const proof = page.getByTestId('guided-knowledge-path');
  await expect(proof).toBeVisible();
  await expect(page.getByTestId('guided-knowledge-step')).toHaveCount(5);
  await expect(proof).toContainText('จากคำสั่งสู่ผลจริง');
  await expect(proof).toContainText('ไม่ได้หมายความว่าทุกขั้นเป็นเส้นเชื่อมตรงในกราฟ');
  await expect(proof.locator('[data-step="2"]')).toContainText('Policy v2');
  await expect(proof.locator('[data-step="3"]')).toContainText('ไม่ผ่าน 0');
  await expect(proof.locator('[data-step="4"]')).toContainText('Approved · v2');
  await expect(proof.locator('[data-step="5"]')).toContainText('FA-001');
  await expect(proof.locator('[data-step="5"]')).toContainText('฿500');
  for (let step = 1; step <= 5; step += 1) {
    expect(await proof.locator(`[data-step="${step}"] .guided-proof__evidence code`).count()).toBeGreaterThan(0);
  }
  const pathBounds = await proof.boundingBox();
  const finalStepBounds = await proof.locator('[data-step="5"]').boundingBox();
  expect(pathBounds).not.toBeNull();
  expect(finalStepBounds).not.toBeNull();
  expect(finalStepBounds.y + finalStepBounds.height).toBeLessThanOrEqual(pathBounds.y + pathBounds.height + 1);
  await page.screenshot({ path: 'test-results/constellation-guided-proof-1600x900.png' });

  for (const viewport of [{ width: 1024, height: 768 }, { width: 319, height: 612 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await proof.locator('[data-step="5"]').scrollIntoViewIfNeeded();
    await expect(proof.locator('[data-step="5"]')).toBeVisible();
    const screenshot = `test-results/constellation-guided-proof-${viewport.width}x${viewport.height}.png`;
    await page.screenshot({ path: screenshot });
  }

  await page.setViewportSize({ width: 1600, height: 900 });
  await page.getByTestId('explore-knowledge-graph').click();
  await expect(page.getByTestId('guided-knowledge-path')).toHaveCount(0);
  await expect(page.getByTestId('knowledge-detail')).toBeVisible();
  await page.getByRole('button', { name: 'Map view', exact: true }).click();
  await expect(page.locator('.knowledge-map__flow')).toBeVisible();
  await page.getByRole('button', { name: 'Readable list', exact: true }).click();
  await expect(page.getByLabel('Knowledge list')).toBeVisible();
  await page.getByRole('button', { name: 'Include history', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Current story', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Relationships', exact: true }).click();
  await page.getByRole('button', { name: 'กลับสู่เส้นทางหลักฐาน', exact: true }).click();
  await expect(page.getByTestId('guided-knowledge-path')).toBeVisible();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: 'passed', steps: 5, viewports: [1600, 1024, 319], errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/constellation-guided-proof-failure.png' });
  throw error;
} finally {
  await browser.close();
}
