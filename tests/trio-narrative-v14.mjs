import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const out = process.env.TRIO_REPORT_DIR || 'test-results/narrative-v14';
const base = process.env.TRIO_URL || 'http://127.0.0.1:5173/';
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
try {
 for (const width of [1600, 319]) {
  for (const id of ['shipping', 'quest', 'music']) {
   const context = await browser.newContext({ viewport: { width, height: width === 319 ? 612 : 900 }, reducedMotion: width === 319 ? 'reduce' : 'no-preference' });
   const page = await context.newPage();
   page.on('pageerror', e => errors.push(e.message));
   try {
    await page.goto(base);
    await page.getByTestId('case-' + id).click();
    await page.getByLabel('Story playback speed', { exact: true }).selectOption('2');
    await page.getByLabel('Start demo', { exact: true }).click();
    const source = page.getByTestId('canvas-object-sources');
    await expect(source.locator('[data-source-record]')).toHaveCount(id === 'shipping' ? 6 : id === 'quest' ? 3 : 7, { timeout: 15000 });
    await page.getByLabel('Pause story', { exact: true }).click();
    await expect(source.locator('.source-preview')).toContainText('ข้อมูลสมมติ');
    expect(await source.locator('.source-preview').evaluate(el => getComputedStyle(el).borderColor)).toMatch(/^rgb\((33, 115, 70|22, 132, 71)\)$/);
    if (width === 1600) expect(await source.locator('.source-preview__viewport').evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: `${out}/${id}-${width}-source.png` });
    checks.push(`${id}/${width}: real source preview with all sample rows and green spreadsheet border`);
    await page.getByLabel('Resume story', { exact: true }).click();
    await expect(page.getByTestId('trio-player')).toHaveAttribute('data-step', 'notice', { timeout: 20000 });
    await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase', 'thinking', { timeout: 15000 });
    await page.getByLabel('Pause story', { exact: true }).click();
    const minimal = page.getByTestId('canvas-object-minimal');
    await expect(minimal).toHaveAttribute('data-spotlight', 'focused');
    await expect(source).toHaveAttribute('data-spotlight', 'dimmed');
    const record = id === 'shipping' ? 'SH-001' : id === 'quest' ? 'library' : 'MU-004';
    await expect(minimal.locator(`[data-narrative-record="${record}"].is-narrative-record`)).toBeVisible();
    const detail = minimal.locator('.is-narrative-detail').first();
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('trio-request').locator('mark')).not.toHaveCount(0);
    await page.waitForTimeout(400);
    const detailBox = await detail.boundingBox(), stageBox = await page.getByTestId('trio-stage').boundingBox();
    expect(detailBox.x).toBeGreaterThanOrEqual(stageBox.x - 2);
    expect(detailBox.x + detailBox.width).toBeLessThanOrEqual(stageBox.x + stageBox.width + 2);
    expect(detailBox.y).toBeGreaterThanOrEqual(stageBox.y - 2);
    expect(detailBox.y + detailBox.height).toBeLessThanOrEqual(stageBox.y + stageBox.height + 2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
    await page.screenshot({ path: `${out}/${id}-${width}-reference.png` });
    checks.push(`${id}/${width}: matching request, record, detail, dimmed context and visible camera framing`);
    await page.getByLabel('Follow interactions', { exact: true }).click();
    await expect(page.locator('[data-spotlight="focused"],[data-spotlight="dimmed"]')).toHaveCount(0);
    await expect(page.locator('.is-narrative-record,.is-narrative-detail')).toHaveCount(0);
    await page.getByLabel('Follow interactions', { exact: true }).click();
    await expect(minimal).toHaveAttribute('data-spotlight','focused');
    await page.getByLabel('Story playback speed', { exact: true }).selectOption('4');
    await page.getByLabel('Resume story', { exact: true }).click();
    await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase','complete',{timeout:45000});
    await expect(page.locator('[data-spotlight="focused"],[data-spotlight="dimmed"]')).toHaveCount(0);
    checks.push(`${id}/${width}: camera OFF clears attention, ON restores it, completion releases spotlight`);
   } catch (e) { await page.screenshot({ path: `${out}/${id}-${width}-failure.png` }); throw e; }
   finally { await context.close(); }
  }
 }
 expect(errors).toEqual([]);
 await writeFile(`${out}/report.json`, JSON.stringify({ checks, errors }, null, 2));
 console.log(JSON.stringify({ checks: checks.length, errors }));
} finally { await browser.close(); }

