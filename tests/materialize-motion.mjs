import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const base = process.env.TRIO_URL || 'http://127.0.0.1:5173/';
const output = 'test-results/materialize-motion';
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [], errors = [];
const mark = text => { checks.push(text); console.log(`PASS ${text}`); };
const watch = page => {
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if(message.type() === 'error') errors.push(message.text()); });
};

async function trace(page) {
  await page.evaluate(() => {
    window.motionTrace = [];
    const previous = new WeakMap();
    new MutationObserver(() => {
      for (const el of document.querySelectorAll('[data-testid="materialize-surface"]')) {
        if (previous.get(el) === el.dataset.state) continue;
        previous.set(el, el.dataset.state);
        const content = el.querySelector('.materialize-surface__content');
        window.motionTrace.push({ state: el.dataset.state, at: performance.now(),
          id: el.closest('[data-testid^="canvas-object-"]')?.dataset.testid || 'lab',
          visibility: getComputedStyle(content).visibility, inert: content.inert });
      }
    }).observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
  });
}

try {
  for (const id of ['shipping', 'quest', 'music']) {
    const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
    watch(page);
    await page.goto(base);
    await page.getByTestId(`case-${id}`).click();
    await page.getByLabel('Story playback speed', { exact: true }).selectOption('1');
    await trace(page);
    await page.getByLabel('Start demo', { exact: true }).click();
    const shell = page.getByTestId('canvas-object-minimal').getByTestId('materialize-surface');
    await expect(shell).toHaveAttribute('data-state', 'pending', { timeout: 20000 });
    await expect(shell.getByTestId('materialize-skeleton')).toBeVisible();
    await page.screenshot({ path: `${output}/${id}-skeleton.png` });
    await expect(shell).toHaveAttribute('data-state', 'revealing');
    await expect(shell.locator('.materialize-surface__content')).toBeVisible();
    await expect(shell.locator('.materialize-surface__content')).toHaveAttribute('inert', '');
    await page.screenshot({ path: `${output}/${id}-morph.png` });
    await expect(shell).toHaveAttribute('data-state', 'ready');
    await expect(shell.locator('.materialize-surface__content')).not.toHaveAttribute('inert', '');
    const events = await page.evaluate(() => window.motionTrace.filter(item => item.id === 'canvas-object-minimal'));
    expect(events.map(item => item.state)).toEqual(['pending', 'revealing', 'ready']);
    const box = await shell.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(1501);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + Math.min(box.height, 150)).toBeLessThan(960);
    await page.screenshot({ path: `${output}/${id}-ready.png` });
    mark(`${id}: skeleton → visible inert morph → interactive UI, with camera in view`);
    await page.close();
  }

  const result = JSON.parse(await readFile('test-results/component-lab-live/round-0-result.json', 'utf8')).result;
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 850 }, reducedMotion });
    watch(page);
    let complete = false;
    await page.route('**/api/component-lab/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      const data = pathname.endsWith('/status') ? { available: true }
        : pathname.endsWith('/generate') ? { jobId: 'motion-replay' }
        : complete ? { jobId: 'motion-replay', status: 'complete', result }
        : { jobId: 'motion-replay', status: 'running' };
      await route.fulfill({ json: data });
    });
    await page.goto(`${base}?componentLab=1`);
    await expect(page.getByTestId('component-lab-generate')).toBeEnabled();
    await trace(page);
    await page.getByTestId('component-lab-generate').click();
    const shell = page.getByTestId('materialize-surface');
    await expect(shell).toHaveAttribute('data-state', 'pending');
    await shell.evaluate(el => { window.originalMotionShell = el; });
    await page.waitForTimeout(1200);
    await expect(shell).toHaveAttribute('data-state', 'pending');
    await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toBeInViewport();
    complete = true;
    await expect(shell).toHaveAttribute('data-state', 'ready', { timeout: 12000 });
    expect(await shell.evaluate(el => el === window.originalMotionShell)).toBe(true);
    await expect(page.frameLocator('iframe[title^="รุ่นทดลอง:"]').locator('[data-start]')).toBeVisible();
    await page.getByRole('tab', { name: /รุ่นทดลอง/ }).click();
    await expect(shell).toHaveAttribute('data-state', 'ready');
    const events = await page.evaluate(() => window.motionTrace);
    expect(events.some(item => item.state === 'revealing')).toBe(reducedMotion === 'no-preference');
    await page.screenshot({ path: `${output}/lab-${reducedMotion}.png` });
    mark(`Lab ${reducedMotion}: actual waiting holds skeleton; same shell reveals ready iframe; selected tab stays ready`);
    await page.close();
  }
  expect(errors).toEqual([]);
  await writeFile(`${output}/report.json`, JSON.stringify({ checks, errors }, null, 2));
} finally { await browser.close(); }
