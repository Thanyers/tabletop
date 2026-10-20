import { expect } from '@playwright/test';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';

// Runs only against the disposable Workers browser fixture. Its caller checks
// all pages for API/provider/WebSocket/cookie and durable-storage side effects.
export async function verifyInteractiveDemo(page, origin, output) {
  const root = page.getByTestId('interactive-auto-demo');
  const mode = page.getByTestId('practice-mode');
  const counter = page.getByTestId('practice-step-counter');
  const canvas = page.getByRole('region', { name: 'พื้นที่ Canvas ทดลอง', exact: true });
  const editor = page.getByTestId('canvas-object-editor');
  const node = id => page.locator(`[data-canvas-object="${id}"]`);
  const fileTray = page.getByRole('complementary', { name: 'ไฟล์สำหรับเริ่มโต๊ะ', exact: true });
  async function openAdvancedOptions() {
    const options = page.locator('.tt-practice-options');
    const summary = page.getByLabel('ตัวเลือกเดโม', { exact: true });
    if (await options.getAttribute('open') === null) await summary.click();
    await expect(options).toHaveAttribute('open', '');
  }
  async function selectActor(actorId) {
    await openAdvancedOptions();
    await page.getByLabel('ลองเป็น', { exact: true }).selectOption(actorId);
  }
  async function setFileTrayVisible(visible) {
    if (await fileTray.isVisible() !== visible) {
      await openAdvancedOptions();
      await page.getByRole('button', { name: 'ไฟล์ตัวอย่าง', exact: true }).click();
    }
    if (visible) await expect(fileTray).toBeVisible();
    else await expect(fileTray).toBeHidden();
  }
  async function setPracticeFile(file) {
    await setFileTrayVisible(true);
    await page.getByLabel('เลือกไฟล์เข้า Canvas', { exact: true }).setInputFiles(file);
  }
  const next = async () => {
    const before = await counter.innerText();
    await openAdvancedOptions();
    await page.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true }).click();
    await expect.poll(() => counter.innerText()).not.toBe(before);
  };
  async function fresh(id) {
    await page.goto(`${origin}/demo?legacy-demo=1`);
    await expect(root).toBeVisible();
    await page.getByLabel('เลือกโจทย์', { exact: true }).selectOption(id);
    await expect(page.getByTestId('practice-empty-canvas')).toBeVisible();
    await expect(page.locator('[data-canvas-object]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Focus table', exact: true })).toHaveCount(0);
    await expect(fileTray).toBeVisible();
    await expect(page.getByRole('button', { name: 'เล่นเดโม', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'ลองเอง', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'พักเดโม', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Use|Arrange)$/ })).toHaveCount(0);
    const options = page.locator('.tt-practice-options');
    await expect(options).not.toHaveAttribute('open', '');
    await openAdvancedOptions();
    await expect(options.getByRole('button', { name: 'ทำขั้นถัดไป', exact: true })).toBeVisible();
    await expect(options.getByLabel('ลองเป็น', { exact: true })).toBeVisible();
    await expect(options.getByRole('button', { name: 'เริ่มโต๊ะทดลองใหม่', exact: true })).toBeVisible();
    await expect(options.getByRole('button', { name: 'ไฟล์ตัวอย่าง', exact: true })).toBeVisible();
    await options.locator('summary').click();
  }
  async function open(id) {
    const isCurrent = await editor.isVisible().catch(() => false) && await editor.getAttribute('data-canvas-object') === id;
    if (!isCurrent) {
      const trigger = page.getByTestId('canvas-object-menu-trigger');
      await expect(trigger).toBeVisible();
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
      const dock = page.getByTestId('canvas-object-dock');
      await expect(dock).toBeVisible();
      await dock.getByTestId(`open-canvas-${id}`).click();
    }
    await expect(editor).toHaveAttribute('data-canvas-object', id);
    await expect(editor).toBeVisible();
    await expect(canvas).toBeVisible();
    await expect.poll(() => editor.evaluate(element => {
      const card = element.getBoundingClientRect(), area = element.closest('.tt-flow-wrap').getBoundingClientRect();
      return card.left >= area.left - 2 && card.right <= area.right + 2 && card.top >= area.top - 2 && card.bottom <= area.bottom + 2;
    })).toBe(true);
  }
  async function finish() {
    for (let index = 0; index < 45; index++) {
      if (await mode.getAttribute('data-mode') === 'complete') break;
      await next();
      await expect(mode).not.toHaveAttribute('data-mode', 'blocked');
    }
    await expect(mode).toHaveAttribute('data-mode', 'complete');
  }
  async function buildUntil(id) {
    for (let i = 0; i < 25 && await node(id).count() === 0; i++) await next();
    await expect(node(id)).toBeVisible();
  }

  await fresh('invoice-rules');
  await expect(page.getByRole('link', { name: 'Continue with Google' })).toHaveCount(0);
  await page.screenshot({ path: join(output, 'canvas-demo-empty.png'), fullPage: true });
  // Real HTML drag/drop enters the same parser as the manual/sample buttons.
  await page.locator('[data-sample-id="invoice-shipments"]').dragTo(canvas);
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  await expect(node('practice.files')).toContainText('october-shipments.csv');
  await expect(fileTray).toBeHidden();
  await expect(node('invoice.source')).toContainText(/provided/i);
  await expect(page.getByRole('button', { name: /^(Use|Arrange)$/ })).toHaveCount(0);
  await expect(node('invoice.rules')).toHaveCount(0);
  await expect(node('invoice.table')).toHaveCount(0);
  // Moving objects and the camera stays in memory for the public practice table.
  const sourceNodeBefore = await node('invoice.source').boundingBox();
  const sourceHeaderElement = node('invoice.source').locator('.tt-canvas-node__head');
  await expect(sourceHeaderElement).toBeVisible();
  const sourceHeader = await sourceHeaderElement.boundingBox();
  expect(sourceNodeBefore).not.toBeNull();
  expect(sourceHeader).not.toBeNull();
  await page.mouse.move(sourceHeader.x + 30, sourceHeader.y + 15);
  await page.mouse.down();
  await page.mouse.move(sourceHeader.x + 80, sourceHeader.y + 40, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => {
    const after = await node('invoice.source').boundingBox();
    return after && (Math.abs(after.x - sourceNodeBefore.x) > 20 || Math.abs(after.y - sourceNodeBefore.y) > 20);
  }).toBe(true);
  await page.getByRole('button', { name: 'Zoom In', exact: true }).click();
  await open('invoice.source');
  await page.getByRole('button', { name: 'เพิ่มบนโต๊ะ', exact: true }).click();
  await page.getByRole('navigation', { name: 'เพิ่ม container บนโต๊ะ' }).getByRole('button', { name: 'กฎค่าขนส่ง', exact: true }).click();
  await open('invoice.rules');
  await expect(editor).toContainText('No rate rules are active');
  // Invalid file cannot replace existing normalized rows or add a phantom file.
  const existingFileCount = await node('practice.files').locator('details').count();
  await setFileTrayVisible(true);
  await setPracticeFile({ name: 'invalid.csv', mimeType: 'text/csv', buffer: Buffer.from('unsupported,header\na,b') });
  await expect(root.locator('.tt-practice-notice')).toBeVisible();
  await expect(node('practice.files').locator('details')).toHaveCount(existingFileCount);
  await setFileTrayVisible(false);
  await page.screenshot({ path: join(output, 'canvas-demo-dragged.png'), fullPage: true });

  await fresh('invoice-rules');
  await next();
  await expect(node('practice.files')).toBeVisible();
  await expect(fileTray).toBeHidden();
  await expect(node('invoice.rules')).toHaveCount(0);
  await finish();
  await open('invoice.rules');
  await expect(editor.getByRole('region', { name:/^(Review this change|Rules in use)$/ })).toContainText('Active');
  await expect(editor.locator('.tt-inline-rule-list > div')).toHaveCount(5);
  await open('invoice.table');
  await expect(editor.locator('.tt-inline-kpis')).toContainText('80.00');
  await editor.getByRole('button', { name: 'Save run', exact: true }).click();
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  const csvDownload = page.waitForEvent('download');
  await editor.getByRole('button', { name: 'CSV', exact: true }).click();
  const csv = await readFile(await (await csvDownload).path(), 'utf8');
  expect(csv).toContain('shipment_id'); expect(csv).toContain('S-BKK-1000');
  await open('workspace.history');
  await expect(editor).toContainText('Saved');
  await page.screenshot({ path: join(output, 'canvas-demo-invoice.png'), fullPage: true });

  await fresh('teaching-physics');
  await buildUntil('lesson.scene');
  await open('lesson.source');
  await page.getByRole('button', { name: 'เล่นเดโม', exact: true }).click();
  await editor.getByText('Force, mass, and time', { exact: true }).dispatchEvent('pointerdown', { pointerType: 'touch' });
  await editor.getByLabel('Force value in N', { exact: true }).press('Tab');
  await expect(mode).toHaveAttribute('data-mode', 'playing');
  // Programmatic canvas following must never trigger the user-selection pause.
  const beforePlay = await counter.innerText();
  await expect.poll(() => counter.innerText(), { timeout: 10_000 }).not.toBe(beforePlay);
  await expect(mode).toHaveAttribute('data-mode', 'playing');
  await page.getByRole('button', { name: 'พักเดโม', exact: true }).click();
  const paused = await counter.innerText();
  await page.waitForTimeout(3700); await expect(counter).toHaveText(paused);
  await open('lesson.source');
  await page.getByRole('button', { name: 'เล่นเดโม', exact: true }).click();
  await editor.getByLabel('Force value in N', { exact: true }).fill('12');
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  await editor.getByLabel('Mass value in kg', { exact: true }).fill('3');
  await editor.getByLabel('Time value in s', { exact: true }).fill('2');
  await editor.getByRole('button', { name: 'Update lesson', exact: true }).click();
  await expect(editor.getByLabel('Force value in N', { exact: true })).toHaveValue('12');
  await open('lesson.scene');
  await expect(editor.locator('svg.tt-track-svg')).toHaveAttribute('aria-label', 'Cart travels 8 meters in 2 seconds');
  const takenOver = await counter.innerText();
  await page.waitForTimeout(3700); await expect(counter).toHaveText(takenOver);
  await expect(page.getByRole('button', { name: 'เล่นเดโม', exact: true })).toBeDisabled();
  // Add the question container manually at a partly built table.
  if (await node('lesson.question').count() === 0) {
    await page.getByRole('button', { name: 'เพิ่มบนโต๊ะ', exact: true }).click();
    await page.getByRole('navigation', { name: 'เพิ่ม container บนโต๊ะ' }).getByRole('button', { name: 'โจทย์และคำตอบ', exact: true }).click();
  }
  await open('lesson.question');
  await editor.getByLabel('Private teacher note', { exact: true }).fill('PRACTICE_TEACHER_PRIVATE');
  await editor.getByRole('button', { name: 'Save note', exact: true }).click();
  await selectActor('practice-learner-1');
  await open('lesson.question');
  await expect(root).not.toContainText('PRACTICE_TEACHER_PRIVATE');
  await editor.getByLabel('Position in meters', { exact: true }).fill('8');
  await editor.getByRole('button', { name: 'Check answer', exact: true }).click();
  await expect(editor).toContainText('Correct');
  await selectActor('practice-learner-2');
  await open('lesson.question');
  await expect(editor).not.toContainText('Correct');
  await selectActor('practice-teacher');
  await open('lesson.source');
  const historyDetails = page.locator('.tt-practice-footer details');
  if (await historyDetails.getAttribute('open') === null) await historyDetails.locator('summary').click();
  await expect(historyDetails).toHaveAttribute('open', '');
  const historyDownload = page.waitForEvent('download');
  await historyDetails.getByRole('button', { name: 'ดาวน์โหลดบันทึก', exact: true }).click();
  const history = JSON.parse(await readFile(await (await historyDownload).path(), 'utf8'));
  expect(history.currentView.domain.parameters).toEqual({ force: 12, mass: 3, time: 2 });
  expect(history.events.some(event => event.type === 'teaching.setParameters' && event.outcome === 'applied')).toBe(true);
  await writeFile(join(output, 'interactive-demo-manual-state.json'), JSON.stringify({ force:12, mass:3, time:2, position:8, mode: await mode.getAttribute('data-mode'), history }, null, 2));
  await page.getByLabel('เลือกโจทย์', { exact: true }).selectOption('encounter-shield');
  await page.getByRole('dialog', { name: 'เริ่มโต๊ะทดลองใหม่?', exact: true }).getByRole('button', { name: 'Keep current table', exact: true }).click();
  await expect(page.getByLabel('เลือกโจทย์', { exact: true })).toHaveValue('teaching-physics');
  await expect(editor.getByLabel('Force value in N', { exact: true })).toHaveValue('12');
  await page.screenshot({ path: join(output, 'interactive-demo-teaching.png'), fullPage: true });
  const independent = await page.context().newPage();
  await independent.goto(`${origin}/demo`);
  await expect(independent.getByTestId('practice-empty-canvas')).toBeVisible();
  await expect(independent.locator('[data-canvas-object]')).toHaveCount(0);
  await independent.close();

  await fresh('teaching-physics'); await finish();
  await open('lesson.rules');
  await expect.poll(() => page.locator('[data-canvas-object]').evaluateAll(elements => {
    const cards = elements.map(element => ({ id:element.getAttribute('data-canvas-object'), rect:element.getBoundingClientRect() }));
    const overlaps = [];
    for (let a = 0; a < cards.length; a++) for (let b = a + 1; b < cards.length; b++) {
      const left = cards[a].rect, right = cards[b].rect;
      if (Math.min(left.right,right.right) - Math.max(left.left,right.left) > 2 && Math.min(left.bottom,right.bottom) - Math.max(left.top,right.top) > 2) overlaps.push([cards[a].id,cards[b].id]);
    }
    return overlaps;
  })).toEqual([]);
  await expect(editor).toContainText('a = F ÷ m');
  await editor.getByRole('button', { name:'Open force and mass controls', exact:true }).click();
  await expect(editor).toHaveAttribute('data-canvas-object', 'lesson.source');
  await expect(editor.getByLabel('Mass value in kg', { exact:true })).toHaveValue('5');

  // The first native click must keep focus/value when playback hands over.
  await fresh('teaching-physics'); await next(); await open('lesson.source');
  await page.getByRole('button', { name:'เล่นเดโม', exact:true }).click();
  const forceField = editor.getByLabel('Force value in N', { exact:true });
  await forceField.click();
  await expect(forceField).toBeFocused();
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  await forceField.fill('13');
  await editor.getByRole('button', { name:'Update lesson', exact:true }).click();
  await expect(forceField).toHaveValue('13');

  await fresh('encounter-shield'); await next(); await open('encounter.source');
  const allyControl = editor.getByRole('checkbox', { name:/^Allow shielding an ally/ });
  const allyBefore = await allyControl.isChecked();
  await page.getByRole('button', { name:'เล่นเดโม', exact:true }).click();
  await allyControl.click();
  await expect(allyControl).toBeChecked({ checked:!allyBefore });
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  const afterControlClick = await counter.innerText();
  await page.waitForTimeout(3700); await expect(counter).toHaveText(afterControlClick);

  // A local file selected by one role cannot finish importing as another role.
  await fresh('teaching-physics');
  await page.evaluate(() => {
    const original = File.prototype.text;
    File.prototype.text = function () {
      const file = this;
      return new Promise(resolve => {
        window.releasePracticeFileRead = async () => {
          File.prototype.text = original;
          resolve(await original.call(file));
          delete window.releasePracticeFileRead;
        };
      });
    };
  });
  await setPracticeFile({ name: 'slow-lesson.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ kind:'teaching-lesson', version:1, parameters:{force:12,mass:3,time:2} })) });
  await selectActor('practice-learner-1');
  await page.evaluate(async () => { await window.releasePracticeFileRead(); });
  await expect(page.locator('[data-canvas-object]')).toHaveCount(0);
  await expect(root.locator('.tt-practice-notice')).toHaveCount(0);
  await expect(page.getByRole('button', { name:'เลือกไฟล์จากเครื่อง', exact:true })).toBeEnabled();

  await fresh('teaching-physics');
  await setPracticeFile({ name:'my-lesson.json', mimeType:'application/json', buffer:Buffer.from(JSON.stringify({ kind:'teaching-lesson', version:1, parameters:{force:9,mass:3,time:2} })) });
  await expect(mode).toHaveAttribute('data-mode', 'manual');
  await expect(node('practice.files')).toContainText('my-lesson.json');
  await page.getByRole('button', { name:'เพิ่มบนโต๊ะ', exact:true }).click();
  await page.getByRole('navigation', { name:'เพิ่ม container บนโต๊ะ' }).getByRole('button', { name:'รางทดลอง', exact:true }).click();
  await open('lesson.scene');
  await expect(editor.locator('svg.tt-track-svg')).toHaveAttribute('aria-label', 'Cart travels 6 meters in 2 seconds');

  await fresh('encounter-shield'); await finish();
  await open('encounter.board'); await expect(editor).toContainText('8/10 HP');
  await fresh('encounter-shield');
  for (let index = 0; index < 30 && await node('encounter.actions').getByText(/has opened a reaction/).count() === 0; index++) await next();
  await page.getByRole('button', { name: 'ลองเอง', exact: true }).click();
  await selectActor('practice-mira'); await open('encounter.actions');
  const clock = editor.locator('.tt-countdown'), held = await clock.innerText();
  await page.waitForTimeout(31_100); await expect(clock).toHaveText(held, { useInnerText:true });
  await editor.getByRole('button', { name:'Shield Pip as ally', exact:true }).click();
  await selectActor('practice-dm'); await open('encounter.actions');
  await editor.getByRole('button', { name:'Resolve hit', exact:true }).click();
  await open('encounter.board'); await expect(editor).toContainText('8/10 HP');
  await page.screenshot({ path:join(output,'interactive-demo-encounter.png'), fullPage:true });

  await page.setViewportSize({ width:304, height:844 });
  await fresh('teaching-physics'); await buildUntil('lesson.scene'); await open('lesson.source');
  await editor.getByLabel('Force value in N', { exact:true }).fill('6');
  await editor.getByRole('button', { name:'Update lesson', exact:true }).click();
  await open('lesson.scene');
  await expect(editor.locator('svg.tt-track-svg')).toHaveAttribute('aria-label','Cart travels 2.4 meters in 2 seconds');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await page.evaluate(() => ({ local:Object.entries(localStorage), session:Object.entries(sessionStorage) }))).toEqual({ local:[], session:[] });
  await page.screenshot({ path:join(output,'interactive-demo-narrow.png'), fullPage:true });
}
