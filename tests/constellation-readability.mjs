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
  await page.getByTestId('start-accounting').click();
  try {
    await page.getByTestId('object-knowledge').waitFor({ timeout: 20000 });
  } catch (error) {
    console.error(JSON.stringify({
      phase: await page.locator('.worker-bubble').innerText().catch(() => null),
      caption: await page.locator('.canvas-caption').innerText().catch(() => null),
      toast: await page.locator('.toast').innerText().catch(() => null),
      objectCount: await page.locator('.react-flow__node').count(),
      appState: await page.locator('main.app').getAttribute('class'),
      pageText: (await page.locator('body').innerText()).slice(0, 800),
      errors,
    }, null, 2));
    throw error;
  }
  await page.getByRole('button', { name: 'Constellation', exact: true }).click();

  const lens = page.getByTestId('knowledge-constellation');
  await expect(lens).toBeVisible();
  await expect(page.getByTestId('knowledge-detail')).toContainText('Evidence references');
  await expect(page.getByRole('button', { name: 'Relationships', exact: false })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByLabel('Recorded relationships')).toBeVisible();
  expect(await page.locator('.knowledge-relation').count()).toBeGreaterThan(0);
  await page.screenshot({ path: 'test-results/constellation-1600x900.png' });

  const focusedRelationshipCount = await page.locator('.knowledge-relation').count();
  await page.getByRole('button', { name: 'Show all recorded links', exact: true }).click();
  const allLinksPanel = page.locator('.knowledge-relationships[aria-label="All recorded links"]');
  await expect(allLinksPanel).toBeVisible();
  await expect(page.locator('.knowledge-story__header').getByRole('heading', { name: 'All recorded links', exact: true })).toBeVisible();
  await expect(allLinksPanel.getByRole('heading', { name: 'All recorded links', exact: true })).toBeVisible();
  expect(await page.locator('.knowledge-relation').count()).toBeGreaterThan(focusedRelationshipCount);
  const unrelatedLinks = page.locator('.knowledge-relation').filter({
    has: page.locator('.sr-only', { hasText: 'Recorded relationship.' }),
  });
  expect(await unrelatedLinks.count()).toBeGreaterThan(0);
  await expect(unrelatedLinks.first().locator('.knowledge-relation__endpoint')).toHaveCount(2);
  await page.getByRole('button', { name: 'Focus relationships', exact: true }).click();
  await expect(page.getByLabel('Relationships for selected record')).toBeVisible();
  await expect(page.locator('.knowledge-relation')).toHaveCount(focusedRelationshipCount);
  await page.getByRole('button', { name: 'Readable list', exact: true }).click();
  await expect(page.getByLabel('Knowledge list')).toBeVisible();
  expect(await page.locator('.knowledge-list > button').count()).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Map view', exact: true }).click();
  await expect(page.locator('.knowledge-map__flow .react-flow__node').first()).toBeVisible();
  const mapNodeCount = await page.locator('.knowledge-map__flow .react-flow__node').count();
  expect(mapNodeCount).toBeLessThanOrEqual(4);

  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/constellation-1024x768.png' });
  const zoomStyle = await page.locator('.knowledge-map__flow .react-flow__viewport').getAttribute('style');
  const zoom = Number(zoomStyle?.match(/scale\(([^)]+)\)/)?.[1] ?? 0);
  expect(zoom).toBeGreaterThanOrEqual(0.5);

  await page.getByRole('button', { name: 'Relationships', exact: false }).click();
  await page.setViewportSize({ width: 319, height: 612 });
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByLabel('Search knowledge')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Readable list', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Include history', exact: true })).toBeVisible();
  const mobileControls = await page.locator('.constellation-view-controls').boundingBox();
  const mobileWorld = await page.locator('.constellation-world').boundingBox();
  expect(mobileControls).not.toBeNull();
  expect(mobileWorld).not.toBeNull();
  expect(mobileControls.y + mobileControls.height).toBeLessThanOrEqual(mobileWorld.y);
  await page.screenshot({ path: 'test-results/constellation-319x612.png' });
  await page.getByTestId('knowledge-detail').scrollIntoViewIfNeeded();
  await expect(page.getByRole('button', { name: 'Open connected work', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(JSON.stringify({ result: 'passed', mapNodeCount, zoom, errors }, null, 2));
} catch (error) {
  await page.screenshot({ path: 'test-results/constellation-readability-failure.png' });
  throw error;
} finally {
  await browser.close();
}
