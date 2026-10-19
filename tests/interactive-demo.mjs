import { expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// Called only by the disposable Workers browser fixture. Network and identity
// side effects are checked by that fixture around this entire interaction.
export async function verifyInteractiveDemo(page, origin, output) {
  const root = page.getByTestId('interactive-auto-demo');
  const mode = page.getByTestId('practice-mode');
  const counter = page.getByTestId('practice-step-counter');
  const workbench = page.getByRole('region', { name: 'Table workbench', exact: true });
  async function freshScenario(id) {
    await page.goto(`${origin}/demo?legacy-demo=1`);
    await expect(root).toBeVisible();
    await page.getByLabel('เลือกโจทย์', { exact: true }).selectOption(id);
    await page.getByRole('button', { name: 'Focus table', exact: true }).click();
    await expect(workbench).toBeVisible();
  }
  async function finishWalkthrough() {
    for (let step = 0; step < 35; step++) {
      if (await mode.getAttribute('data-mode') === 'complete') break;
      await page.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true }).click();
      await expect(mode).not.toHaveAttribute('data-mode', 'blocked');
    }
    await expect(mode).toHaveAttribute('data-mode', 'complete');
    await expect(page.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true })).toBeDisabled();
  }

  await freshScenario('invoice-rules');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  await expect(workbench.getByRole('heading', { name: 'Shipment reconciliation' })).toBeVisible();
  await page.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true }).click();
  await expect(workbench.getByRole('heading', { name: 'Draft lifecycle', exact: true })).toBeInViewport();
  await finishWalkthrough();
  await expect(workbench.getByRole('region', { name: 'Draft lifecycle' })).toContainText('Active');
  await page.getByRole('button', { name: 'หยุดแล้วลองเอง', exact: true }).click();
  await workbench.getByRole('button', { name: 'Save run', exact: true }).click();
  await expect(mode).toHaveAttribute('data-mode', 'manual');

  await freshScenario('teaching-physics');
  const initialCounter = await counter.innerText();
  await page.getByRole('button', { name: 'เล่นเดโม', exact: true }).click();
  // Reading/touch-scrolling the surface and tabbing between controls is not an edit.
  await workbench.getByRole('heading', { name: 'A cart, a force, and one shared model' }).dispatchEvent('pointerdown', { pointerType: 'touch' });
  await workbench.getByLabel('Force value in N', { exact: true }).press('Tab');
  await expect(mode).toHaveAttribute('data-mode', 'playing');
  await expect.poll(() => counter.innerText(), { timeout: 10_000 }).not.toBe(initialCounter);
  await page.getByRole('button', { name: 'หยุดเดโม', exact: true }).click();
  const pausedCounter = await counter.innerText();
  // This delay crosses the next scheduled action: paused means no queued update.
  await page.waitForTimeout(3700);
  await expect(counter).toHaveText(pausedCounter);
  await expect(mode).toHaveAttribute('data-mode', 'paused');
  await page.getByRole('button', { name: 'เล่นเดโม', exact: true }).click();
  // Interacting directly with a form also cancels the demo before changing it.
  await workbench.getByLabel('Force value in N', { exact: true }).fill('12');
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  await workbench.getByLabel('Mass value in kg', { exact: true }).fill('3');
  await workbench.getByLabel('Time value in s', { exact: true }).fill('2');
  await workbench.getByRole('button', { name: 'Update shared lesson', exact: true }).click();
  const scene = workbench.locator('svg.tt-track-svg');
  await writeFile(join(output, 'interactive-demo-manual-state.json'), JSON.stringify({
    mode: await mode.getAttribute('data-mode'), counter: await counter.innerText(),
    force: await workbench.getByLabel('Force value in N', { exact: true }).inputValue(),
    mass: await workbench.getByLabel('Mass value in kg', { exact: true }).inputValue(),
    time: await workbench.getByLabel('Time value in s', { exact: true }).inputValue(),
    scene: await scene.getAttribute('aria-label'),
    result: await root.locator('.tt-practice-last-event').innerText(),
  }, null, 2));
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('aria-label', 'Cart position 8 meters, velocity 8 meters per second');
  const takenOverCounter = await counter.innerText();
  await page.waitForTimeout(3700);
  await expect(counter).toHaveText(takenOverCounter);
  await expect(workbench.getByLabel('Force value in N', { exact: true })).toHaveValue('12');
  await expect(page.getByRole('button', { name: 'เล่นเดโม', exact: true })).toBeDisabled();
  await workbench.getByLabel('Private teacher note', { exact: true }).fill('PRACTICE_TEACHER_PRIVATE');
  await workbench.getByRole('button', { name: 'Save note', exact: true }).click();
  await page.getByLabel('ลองเป็น', { exact: true }).selectOption('practice-learner-1');
  await expect(workbench.getByLabel('Private teacher note', { exact: true })).toHaveCount(0);
  await expect(workbench).not.toContainText('PRACTICE_TEACHER_PRIVATE');
  await workbench.getByLabel('Position in meters', { exact: true }).fill('8');
  await workbench.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(workbench.locator('.tt-answer-feedback.is-correct')).toContainText('8 m');
  await page.getByLabel('ลองเป็น', { exact: true }).selectOption('practice-learner-2');
  await expect(workbench.locator('.tt-answer-feedback')).toHaveCount(0);
  await page.getByLabel('ลองเป็น', { exact: true }).selectOption('practice-teacher');
  await expect(workbench.getByLabel('Private teacher note', { exact: true })).toHaveValue('PRACTICE_TEACHER_PRIVATE');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'ดาวน์โหลดบันทึก', exact: true }).click();
  const history = JSON.parse(await readFile(await (await downloaded).path(), 'utf8'));
  expect(history.format).toBe('tabletop-practice-history-v1');
  expect(history.currentView.domain.parameters).toEqual({ force: 12, mass: 3, time: 2 });
  expect(history.events.some(event => event.type === 'teaching.setParameters' && event.outcome === 'applied')).toBe(true);
  // Cancelling a new-scenario request preserves the manually changed table.
  await page.getByLabel('เลือกโจทย์', { exact: true }).selectOption('encounter-shield');
  const reset = page.getByRole('dialog', { name: 'เริ่มโต๊ะทดลองใหม่?', exact: true });
  await expect(reset).toBeVisible();
  await reset.getByRole('button', { name: 'Keep current table', exact: true }).click();
  await expect(page.getByLabel('เลือกโจทย์', { exact: true })).toHaveValue('teaching-physics');
  await expect(workbench.getByLabel('Force value in N', { exact: true })).toHaveValue('12');
  await page.screenshot({ path: join(output, 'interactive-demo-teaching.png'), fullPage: true });

  // A second anonymous tab has independent state even on the same origin.
  const independent = await page.context().newPage();
  await independent.goto(`${origin}/demo`);
  await expect(independent.getByTestId('practice-mode')).toHaveAttribute('data-mode', 'ready');
  await independent.getByLabel('เลือกโจทย์', { exact: true }).selectOption('teaching-physics');
  await independent.getByRole('button', { name: 'Focus table', exact: true }).click();
  await expect(independent.getByRole('region', { name: 'Table workbench' }).getByLabel('Force value in N', { exact: true })).toHaveValue('10');
  await independent.close();

  await freshScenario('encounter-shield');
  await finishWalkthrough();
  await expect(workbench.getByRole('meter', { name: 'Pip health', exact: true })).toHaveAttribute('aria-valuenow', '8');
  await freshScenario('encounter-shield');
  for (let step = 0; step < 6; step++) await page.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true }).click();
  await page.getByRole('button', { name: 'หยุดแล้วลองเอง', exact: true }).click();
  await page.getByLabel('ลองเป็น', { exact: true }).selectOption('practice-mira');
  const heldTime = await workbench.locator('.tt-countdown').innerText();
  // Practice lets a person read and switch roles beyond the live reaction limit.
  await page.waitForTimeout(31_100);
  await expect(workbench.locator('.tt-countdown')).toHaveText(heldTime, { useInnerText: true });
  await workbench.getByRole('button', { name: 'Shield ally · Pip', exact: true }).click();
  await page.getByLabel('ลองเป็น', { exact: true }).selectOption('practice-dm');
  await workbench.getByRole('button', { name: 'Resolve hit', exact: true }).click();
  await expect(workbench.getByRole('meter', { name: 'Pip health', exact: true })).toHaveAttribute('aria-valuenow', '8');
  await workbench.getByRole('button', { name: /End .*turn/ }).click();
  await expect(workbench).toContainText('Mira’s turn');
  await page.screenshot({ path: join(output, 'interactive-demo-encounter.png'), fullPage: true });

  // Each new tab/reload starts fresh; narrow controls and real table stay usable.
  await page.setViewportSize({ width: 304, height: 844 });
  await page.reload();
  await expect(root).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByLabel('เลือกโจทย์', { exact: true }).selectOption('teaching-physics');
  await page.getByRole('button', { name: 'หยุดแล้วลองเอง', exact: true }).click();
  await workbench.getByLabel('Force value in N', { exact: true }).fill('6');
  await workbench.getByRole('button', { name: 'Update shared lesson', exact: true }).click();
  await expect(scene).toBeVisible();
  await expect(scene).toHaveAttribute('aria-label', 'Cart position 6 meters, velocity 6 meters per second');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.screenshot({ path: join(output, 'interactive-demo-narrow.png'), fullPage: true });
}
