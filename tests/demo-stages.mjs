import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const reportDir = 'test-results/demo-stages';
await mkdir(reportDir, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 319, height: 612 }, reducedMotion: 'reduce' });
const checks = [];
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
const player = page.getByTestId('demo-player');
const mark = label => { checks.push(label); console.log(`PASS ${label}`); };

try {
  let releaseDatabase;
  let signalDatabaseRequest;
  const databaseGate = new Promise(resolve => { releaseDatabase = resolve; });
  const databaseRequested = new Promise(resolve => { signalDatabaseRequest = resolve; });
  await page.addInitScript(() => {
    window.__demoStageTrace = [];
    window.__demoThinkingSnapshots = [];
    window.__demoTableCommit = null;
    window.__demoFirstShell = null;
    let lastStage = null;
    const observer = new MutationObserver(() => {
      const playerNode = document.querySelector('[data-testid="demo-player"]');
      if (!playerNode) return;
      const stage = playerNode.getAttribute('data-stage');
      if (!stage) return;
      if(!window.__demoFirstShell&&document.querySelector('.construction-shell'))window.__demoFirstShell={stage,at:performance.now()};
      if(!window.__demoTableCommit&&document.querySelector('[data-testid="object-table"] tbody tr'))window.__demoTableCommit={stage,at:performance.now()};
      if (stage !== lastStage) {
        lastStage = stage;
        window.__demoStageTrace.push({ stage, at: performance.now(), phase: playerNode.getAttribute('data-phase') });
      }
      if (stage === 'thinking') {
        window.__demoThinkingSnapshots.push({
          at: performance.now(),
          canvasObjects: document.querySelectorAll('.canvas-area [data-testid^="object-"]').length,
          shells: document.querySelectorAll('.canvas-area .construction-shell').length,
        });
      }
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-stage'] });
  });
  await page.route('**/data/northstar-db-snapshot.json', async route => {
    signalDatabaseRequest();
    await databaseGate;
    await route.continue();
  });

  await page.goto(process.env.DEMO_URL || 'http://127.0.0.1:5173/');
  await page.getByTestId('watch-demo').click();
  await expect(player).toHaveAttribute('data-stage', 'typing');
  await page.getByLabel('Demo playback speed').selectOption('16');
  const rail = page.getByTestId('demo-stage-rail');
  await expect(rail.getByRole('listitem')).toHaveCount(5);
  await expect(rail).toContainText('พิมพ์');
  await expect(rail).toContainText('คิด');
  await expect(rail).toContainText('แก้ไข');
  await expect(rail).toContainText('วาง');
  await expect(rail).toContainText('ดูผล');
  await expect(page.getByTestId('demo-request-block')).toContainText('คำขอของคุณ');
  await expect(page.getByTestId('demo-bot-status')).toContainText('ผู้ช่วยเดโม');
  await expect(page.locator('.demo-beat__speaker')).toHaveText('ผู้ช่วยเดโม');
  mark('The 319px player distinguishes the user request from an honest local-demo status and shows all five steps');

  await databaseRequested;
  await expect(player).toHaveAttribute('data-stage', 'editing');
  await page.getByLabel('Pause demo', { exact: true }).click();
  await expect(page.getByLabel('Resume demo', { exact: true })).toBeVisible();
  releaseDatabase();
  await page.waitForTimeout(350);
  await expect(player).toHaveAttribute('data-stage', 'editing');
  for (const kind of ['context', 'source', 'worker', 'table']) await expect(page.getByTestId(`object-${kind}`)).toHaveCount(0);
  const thinkingSnapshots = await page.evaluate(() => window.__demoThinkingSnapshots);
  expect(thinkingSnapshots.length).toBeGreaterThan(0);
  expect(thinkingSnapshots[0].canvasObjects).toBe(0);
  expect(thinkingSnapshots[0].shells).toBe(0);
  mark('Thinking starts before any canvas object or construction shell, and pausing the held source request prevents content edits');

  await page.getByLabel('Resume demo', { exact: true }).click();
  await expect(player).toHaveAttribute('data-stage', 'reading', { timeout: 30000 });
  await expect(player).toHaveAttribute('data-phase', 'reading');
  await expect(page.getByTestId('object-table').locator('tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('object-table').locator('th')).toHaveCount(2);
  const placement=await page.evaluate(()=>({shell:window.__demoFirstShell,commit:window.__demoTableCommit}));
  expect(placement.shell.stage).toBe('editing');expect(placement.commit.stage).toBe('placing');
  mark('Editing prepares an uncommitted shell; the real table enters the canvas during placing');
  const trace = await page.evaluate(() => window.__demoStageTrace);
  expect(trace.map(item => item.stage)).toEqual(expect.arrayContaining(['typing', 'thinking', 'editing', 'placing', 'reading']));
  const stageOrder = ['typing', 'thinking', 'editing', 'placing', 'reading'];
  expect(stageOrder.map(stage => trace.findIndex(item => item.stage === stage))).toEqual([...stageOrder].map(stage => trace.findIndex(item => item.stage === stage)).sort((a, b) => a - b));
  const activeStep = rail.locator('[aria-current="step"]');
  await expect(activeStep).toHaveAttribute('data-demo-stage', 'reading');
  await expect(rail.locator('[data-stage-state="complete"]')).toHaveCount(4);
  const layout = await page.evaluate(() => {
    const dock = document.querySelector('[data-testid="demo-player"]');
    const stageRail = document.querySelector('[data-testid="demo-stage-rail"]');
    const steps = [...stageRail.querySelectorAll('[role="listitem"]')];
    const rr = stageRail.getBoundingClientRect();
    return {
      viewportWidth: innerWidth,
      documentFits: document.documentElement.scrollWidth <= innerWidth,
      dockFits: dock.scrollWidth <= dock.clientWidth,
      railFits: stageRail.scrollWidth <= stageRail.clientWidth,
      stepsWithinRail: steps.every(step => { const r = step.getBoundingClientRect(); return r.left >= rr.left && r.right <= rr.right; }),
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      activeAnimation: getComputedStyle(stageRail.querySelector('[aria-current="step"]')).animationDuration,
    };
  });
  expect(layout).toMatchObject({ viewportWidth: 319, documentFits: true, dockFits: true, railFits: true, stepsWithinRail: true, reducedMotion: true, activeAnimation: '0s' });
  await page.screenshot({ path: `${reportDir}/01-reading-small.png` });
  mark('The stage rail reaches reading in order, remains inside the 319px dock, and respects reduced motion');

  expect(errors).toEqual([]);
  const report = { checks, errors, stageTrace: trace, layout };
  await writeFile(`${reportDir}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  const report = { checks, errors, failure: String(error) };
  await writeFile(`${reportDir}/report.json`, JSON.stringify(report, null, 2));
  await page.screenshot({ path: `${reportDir}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
