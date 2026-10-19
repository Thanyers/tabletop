import { chromium, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';

// These fixtures are the exact API results and exported workspaces captured by
// tests/component-lab-live.mjs. Every API route below is intercepted: this test
// replays returned artifacts and never calls the model or the local generator.
const base = process.env.DEMO_URL || 'http://127.0.0.1:5173';
const output = 'test-results/component-lab-regression';
const liveOutput = 'test-results/component-lab-live';
await fs.mkdir(output, { recursive: true });

const liveResults = await Promise.all([0, 1, 2, 3].map(async round =>
  JSON.parse(await fs.readFile(path.join(liveOutput, `round-${round}-result.json`), 'utf8')).result,
));
const round3ExportPath = path.resolve(liveOutput, 'round-3-export.json');
const round3Export = JSON.parse(await fs.readFile(round3ExportPath, 'utf8'));

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const checks = [];
const errors = [];
const reports = [];
const layoutFailures = [];
const mark = name => { checks.push(name); console.log(`PASS ${name}`); };

function makeGate() {
  let resolve;
  const promise = new Promise(accept => { resolve = accept; });
  return { promise, release: resolve };
}

function installApiReplay(page) {
  const jobs = new Map();
  const plans = [];
  const requests = [];

  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.route('**/api/component-lab/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const pathname = url.pathname;
    requests.push({ method, pathname, gate: request.headers()['x-component-lab'] ?? null });

    if (pathname === '/api/component-lab/status' && method === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ available: true }) });
      return;
    }

    if (pathname === '/api/component-lab/generate' && method === 'POST') {
      const plan = plans.shift();
      if (!plan) {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Unexpected generation request in replay test' }) });
        return;
      }
      plan.requestBody = request.postDataJSON();
      jobs.set(plan.jobId, plan);
      await route.fulfill({ status: 202, contentType: 'application/json', body: JSON.stringify({ jobId: plan.jobId }) });
      return;
    }

    const jobMatch = pathname.match(/^\/api\/component-lab\/jobs\/([^/]+)$/);
    if (jobMatch) {
      const jobId = decodeURIComponent(jobMatch[1]);
      const job = jobs.get(jobId);
      if (!job) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Unknown replay fixture' }) });
        return;
      }

      if (method === 'DELETE') {
        job.deleteCount += 1;
        job.signalDelete?.();
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId, status: 'cancelled' }) });
        return;
      }

      if (method === 'GET' && job.kind === 'cancel-race') {
        job.pollCount += 1;
        if (job.pollCount === 1) {
          job.signalPoll();
          await job.pollGate.promise;
          // Deliberately return a late complete response after Cancel/Delete.
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId, status: 'complete', result: job.result }) });
          return;
        }
      }

      if (method === 'GET' && job.kind === 'complete') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId, status: 'complete', result: job.result }) });
        return;
      }
      if (method === 'GET' && job.kind === 'failed') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId, status: 'failed', error: job.error }) });
        return;
      }
      if (method === 'GET' && job.kind === 'cancel-race') {
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ jobId, status: 'cancelled' }) });
        return;
      }
    }

    await route.fulfill({ status: 501, contentType: 'application/json', body: JSON.stringify({ error: `Unstubbed replay API request: ${method} ${pathname}` }) });
  });

  return {
    requests,
    enqueueComplete(round, jobId = `replay-${round}-${plans.length}`) {
      plans.push({ kind: 'complete', result: liveResults[round], jobId, deleteCount: 0 });
    },
    enqueueArtifact(artifact, jobId = `replay-artifact-${plans.length}`) {
      plans.push({ kind: 'complete', result: artifact, jobId, deleteCount: 0 });
    },
    enqueueFailure(error = 'Fixture failure; active revision must remain unchanged', jobId = `failed-${plans.length}`) {
      plans.push({ kind: 'failed', error, jobId, deleteCount: 0 });
    },
    enqueueCancelRace(round = 3, jobId = 'cancel-race') {
      const pollGate = makeGate();
      const pollSeen = makeGate();
      const deleteSeen = makeGate();
      const plan = {
        kind: 'cancel-race', result: liveResults[round], jobId, deleteCount: 0, pollCount: 0,
        pollGate, signalPoll: pollSeen.release, pollSeen: pollSeen.promise,
        signalDelete: deleteSeen.release, deleteSeen: deleteSeen.promise,
      };
      plans.push(plan);
      return { plan, releasePoll: pollGate.release };
    },
    jobs,
  };
}

async function openLab(viewport = { width: 1440, height: 900 }) {
  const page = await browser.newPage({ viewport });
  const api = installApiReplay(page);
  await page.goto(`${base}/?componentLab=1`);
  await expect(page.getByTestId('component-lab')).toBeVisible();
  await expect(page.locator('.component-lab__availability')).toContainText('พร้อมทดลอง');
  await waitForStableLabRect(page, 'initial open');
  return { page, api };
}

async function waitForStableLabRect(page, label) {
  let previous = null;
  await expect.poll(async () => {
    const current = await page.locator('.component-lab').boundingBox();
    if (!current) {
      previous = null;
      return false;
    }
    const stable = previous != null
      && ['x', 'y', 'width', 'height'].every(key => Math.abs(current[key] - previous[key]) < 0.35);
    previous = current;
    return stable;
  }, { timeout: 2000, intervals: [80, 120, 180, 250] }).toBe(true);
  reports.push({ panelSettlement: label });
}

function activeFrame(page) {
  return page.frameLocator('iframe[title^="เครื่องมือที่ใช้อยู่:"]');
}

function candidateFrame(page) {
  return page.frameLocator('iframe[title^="รุ่นทดลอง:"]');
}

async function generateAndApprove(page, api, round) {
  api.enqueueComplete(round);
  await page.locator('#component-lab-prompt').fill(`Replay captured round ${round} only`);
  await page.getByTestId('component-lab-generate').click();
  const preview = candidateFrame(page);
  await expect(page.locator('.component-lab__candidate-heading h3')).toHaveText(liveResults[round].title, { timeout: 10000 });
  await expect(preview.locator('[data-start]')).toBeVisible({ timeout: 10000 });
  await page.getByTestId('component-lab-run-tests').click();
  await expect(page.getByTestId('component-lab-activate')).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTestId('component-lab-checks')).toContainText('6/6 ผ่าน');
  await page.getByTestId('component-lab-activate').click();
  const active = activeFrame(page);
  await expect(active.locator('[data-start]')).toBeVisible({ timeout: 10000 });
  await expect(page.locator('.component-lab__candidate-heading')).toHaveCount(0);
  await waitForStableLabRect(page, `active ${liveResults[round].title}`);
  return active;
}

async function tapActive(frame, count) {
  await expect(frame.locator('[data-start]')).toBeEnabled();
  // The generated frame is nested in a transformed canvas; dispatch the native
  // button click in its own document to avoid coordinate drift across frames.
  await frame.locator('[data-start]').evaluate(element => element.click());
  try {
    await expect(frame.locator('[data-stop]')).toBeEnabled({ timeout: 2000 });
  } catch (error) {
    const state = await frame.locator('[data-status]').evaluate(element => ({
      status: element.textContent,
      startDisabled: element.ownerDocument.querySelector('[data-start]')?.disabled,
      stopDisabled: element.ownerDocument.querySelector('[data-stop]')?.disabled,
      visibleDocument: element.ownerDocument.visibilityState,
    }));
    throw new Error(`Replayed active start did not begin: ${JSON.stringify(state)}; ${String(error)}`);
  }
  const pads = frame.locator('[data-tap]');
  const padCount = await pads.count();
  if (!padCount) throw new Error('Active replay has no tap controls');
  for (let index = 0; index < count; index += 1) await pads.nth(index % padCount).evaluate(element => element.click());
  await frame.locator('[data-stop]').evaluate(element => element.click());
  await expect(frame.locator('[data-stop]')).toBeDisabled();
}

async function captureHistory(frame) {
  return {
    count: await frame.locator('[data-count]').innerText(),
    rows: (await frame.locator('[data-history] li').allTextContents()).map(text => text.replace(/\s+/g, ' ').trim()),
    offsets: (await frame.locator('[data-history] li').allTextContents()).map(text => text.match(/[+−-]?\d+\s*ms/)?.[0].replace(/\s/g, '') ?? null),
  };
}

async function checkGeometry(page, label) {
  // The hook fits the lab after mount/resize with a short camera animation.
  // Poll measured DOM bounds, rather than sleeping a fixed amount, and keep
  // collecting geometry after the bounded wait so a persistent clip is visible.
  let cameraSettled = false;
  try {
    await expect.poll(async () => page.evaluate(() => {
      const lab = document.querySelector('.component-lab')?.getBoundingClientRect();
      const canvas = document.querySelector('.canvas-area')?.getBoundingClientRect();
      if (!lab || !canvas) return false;
      return lab.left >= Math.max(0, canvas.left) - 1
        && lab.top >= canvas.top - 1
        && lab.right <= Math.min(window.innerWidth, canvas.right) + 1
        && lab.bottom <= canvas.bottom + 1;
    }), { timeout: 2000, intervals: [80, 120, 180, 250] }).toBe(true);
    cameraSettled = true;
  } catch { /* report the final bounds below if camera fit did not settle */ }

  const documentGeometry = await page.evaluate(() => {
    const selectors = ['.component-lab', '.component-lab__body', '.component-lab__stage', '.component-lab__frame-wrap'];
    return {
      viewportWidth: window.innerWidth,
      document: { clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth },
      elements: Object.fromEntries(selectors.map(selector => {
        const element = document.querySelector(selector);
        return [selector, element ? { clientWidth: element.clientWidth, scrollWidth: element.scrollWidth } : null];
      })),
      labRect: (() => { const rect = document.querySelector('.component-lab')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
      canvasRect: (() => { const rect = document.querySelector('.canvas-area')?.getBoundingClientRect(); return rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null; })(),
    };
  });
  const frameGeometry = await activeFrame(page).locator('html').evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
    viewportWidth: window.innerWidth,
  }));
  reports.push({ geometry: label, document: documentGeometry, generatedFrame: frameGeometry });

  expect(documentGeometry.document.scrollWidth, `${label}: document horizontal overflow`).toBeLessThanOrEqual(documentGeometry.document.clientWidth + 1);
  for (const [selector, size] of Object.entries(documentGeometry.elements)) {
    if (size) expect(size.scrollWidth, `${label}: ${selector} horizontal overflow`).toBeLessThanOrEqual(size.clientWidth + 1);
  }
  expect(frameGeometry.scrollWidth, `${label}: generated document horizontal overflow`).toBeLessThanOrEqual(frameGeometry.clientWidth + 1);
  const lab = documentGeometry.labRect;
  const canvas = documentGeometry.canvasRect;
  const right = Math.min(documentGeometry.viewportWidth, canvas.x + canvas.width);
  const bottom = canvas.y + canvas.height;
  const insideCanvas = lab.x >= Math.max(0, canvas.x) - 1
    && lab.y >= canvas.y - 1
    && lab.x + lab.width <= right + 1
    && lab.y + lab.height <= bottom + 1;
  if (!insideCanvas) {
    layoutFailures.push(`${label}: component bounds x=${lab.x.toFixed(1)}..${(lab.x + lab.width).toFixed(1)}, y=${lab.y.toFixed(1)}..${(lab.y + lab.height).toFixed(1)} escape canvas x=${canvas.x.toFixed(1)}..${right.toFixed(1)}, y=${canvas.y.toFixed(1)}..${bottom.toFixed(1)}; cameraSettled=${cameraSettled}`);
  }
  reports.push({ geometrySettlement: label, cameraSettled });
  expect(cameraSettled, `${label}: camera bounds did not settle inside the visible canvas within 2 seconds`).toBe(true);
  await page.screenshot({ path: path.join(output, `${label}.png`), fullPage: true });
  mark(`${label} document, lab surfaces, and generated frame have no local horizontal scroll overflow`);
  if (insideCanvas) mark(`${label} component remains inside all four visible canvas bounds`);
  else console.error(`FAIL ${layoutFailures.at(-1)}`);
}

async function importRound3(page, api) {
  await page.locator('input[type="file"]').setInputFiles(round3ExportPath);
  const preview = candidateFrame(page);
  await expect(page.locator('.component-lab__candidate-heading h3')).toHaveText(liveResults[3].title);
  await expect(preview.locator('[data-start]')).toBeVisible({ timeout: 10000 });
  const appearance = await preview.locator('.rhythm').evaluate(element => ({
    orange: getComputedStyle(element).getPropertyValue('--orange').trim(),
    surface: getComputedStyle(element).backgroundColor,
    pads: Array.from(document.querySelectorAll('[data-tap]')).map(pad => ({
      hand: pad.getAttribute('data-tap'), label: pad.getAttribute('aria-label'), text: pad.textContent?.replace(/\s+/g, ' ').trim(),
    })),
  }));
  expect(appearance.orange).toBe('#ffb568');
  expect(appearance.surface).toBe('rgb(255, 249, 238)');
  expect(appearance.pads.map(pad => pad.hand)).toEqual(['left', 'right']);
  expect((await preview.locator('[data-tap]').allTextContents()).join(' ')).toContain('เคาะมือซ้าย');
  expect((await preview.locator('[data-tap]').allTextContents()).join(' ')).toContain('เคาะมือขวา');
  expect(api.requests.filter(request => request.method === 'POST' && request.pathname.endsWith('/generate'))).toHaveLength(0);

  await page.screenshot({ path: path.join(output, 'round3-import-preview.png'), fullPage: true });
  mark('Round 3 file import replays actual orange/cream CSS and split-hand controls without a generation request');

  await page.getByTestId('component-lab-run-tests').click();
  await expect(page.getByTestId('component-lab-activate')).toBeEnabled({ timeout: 15000 });
  await expect(page.getByTestId('component-lab-checks')).toContainText('6/6 ผ่าน');
  await expect(page.getByTestId('component-lab-checks')).toContainText('ครบสองมือ');
  await page.getByTestId('component-lab-activate').click();
  const active = activeFrame(page);
  await expect(active.locator('[data-start]')).toBeVisible();
  await expect(active.locator('[data-count]')).toHaveText(`${round3Export.state.history.length} ครั้ง`);
  await expect(active.locator('.rhythm')).toHaveCSS('background-color', 'rgb(255, 249, 238)');
  await expect(active.locator('[data-tap]')).toHaveCount(2);
  expect(api.requests.filter(request => request.method === 'POST' && request.pathname.endsWith('/generate'))).toHaveLength(0);
  mark(`Imported round 3 was retested and activated with its ${round3Export.state.history.length} saved taps intact`);
}

async function scrollWorkingControlsIntoView(page, frame) {
  const body = page.locator('.component-lab__body');
  const controls = [frame.locator('[data-start]'), ...(await frame.locator('[data-tap]').all())];
  if (controls.length < 3) throw new Error('Expected Start plus two hand controls in the active frame');
  const initialBody = await body.boundingBox();
  const initialBoxes = await Promise.all(controls.map(control => control.boundingBox()));
  if (!initialBody || initialBoxes.some(box => !box)) throw new Error('Component Lab body or generated controls are not rendered');

  // Center the full control group in the Lab's own scroller, accounting for
  // React Flow's rendered scale. On narrow screens the group may be taller
  // than the viewport; callers then verify each control is reachable in turn.
  const minY = Math.min(...initialBoxes.map(box => box.y));
  const maxY = Math.max(...initialBoxes.map(box => box.y + box.height));
  const metrics = await body.evaluate(element => ({
    rectHeight: element.getBoundingClientRect().height,
    clientHeight: element.clientHeight,
    scrollTop: element.scrollTop,
  }));
  const scale = metrics.rectHeight / Math.max(1, metrics.clientHeight);
  const screenDelta = (minY + maxY) / 2 - (initialBody.y + initialBody.height / 2);
  await body.evaluate((element, delta) => { element.scrollTop += delta; }, screenDelta / scale);

  const finalBody = await body.boundingBox();
  const finalBoxes = await Promise.all(controls.map(control => control.boundingBox()));
  const allVisible = !!finalBody && finalBoxes.every(box => box
    && box.y >= finalBody.y - 1
    && box.y + box.height <= finalBody.y + finalBody.height + 1);
  return { body: finalBody, controls: finalBoxes, allVisible };
}

async function verifyControlsReachable(page, frame) {
  const body = page.locator('.component-lab__body');
  const selectors = ['[data-start]', '[data-tap="left"]', '[data-tap="right"]'];
  const bodyMetrics = await body.evaluate(element => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
  }));
  expect(bodyMetrics.overflowY).toBe('auto');
  expect(bodyMetrics.scrollHeight).toBeGreaterThan(bodyMetrics.clientHeight);
  const bounds = [];
  for (const selector of selectors) {
    const control = frame.locator(selector);
    await expect(control).toBeVisible();
    const initialBox = await control.boundingBox();
    const initialBodyBox = await body.boundingBox();
    const metrics = await body.evaluate(element => ({
      rectHeight: element.getBoundingClientRect().height,
      clientHeight: element.clientHeight,
      scrollTop: element.scrollTop,
    }));
    if (!initialBox || !initialBodyBox) throw new Error(`No rendered bounds for ${selector}`);
    const scale = metrics.rectHeight / Math.max(1, metrics.clientHeight);
    const controlCenter = initialBox.y + initialBox.height / 2;
    const bodyCenter = initialBodyBox.y + initialBodyBox.height / 2;
    await body.evaluate((element, delta) => { element.scrollTop += delta; }, (controlCenter - bodyCenter) / scale);
    const bodyBox = await body.boundingBox();
    const box = await control.boundingBox();
    const reachable = !!bodyBox && !!box
      && box.y >= bodyBox.y - 1
      && box.y + box.height <= bodyBox.y + bodyBox.height + 1;
    expect(reachable, `${selector} should be reachable by scrolling the Lab body: ${JSON.stringify({ bodyBox, box })}`).toBe(true);
    bounds.push({ selector, box });
  }
  return bounds;
}

async function waitForStableFrameHeight(frame, label) {
  let previous = null;
  let steadySince = Date.now();
  let finalHeight = 0;
  await expect.poll(async () => {
    finalHeight = await frame.evaluate(element => Number.parseFloat(element.style.height) || element.getBoundingClientRect().height);
    if (previous == null || Math.abs(finalHeight - previous) > 0.5) {
      previous = finalHeight;
      steadySince = Date.now();
    }
    return finalHeight > 0 && Date.now() - steadySince >= 500;
  }, { timeout: 2500, intervals: [80, 120, 180, 250] }).toBe(true);
  expect(finalHeight, `${label}: intrinsic iframe height should remain bounded`).toBeLessThan(3000);
  return finalHeight;
}

try {
  // A captured real result can be replayed and approved before testing the
  // failure path; the subsequent failed job must not replace or clear it.
  {
    const { page, api } = await openLab();
    const active = await generateAndApprove(page, api, 0);
    await expect(active.locator('[data-tolerance]')).toContainText('±80 ms');
    await tapActive(active, 2);
    const before = await captureHistory(active);

    api.enqueueFailure();
    await page.locator('#component-lab-prompt').fill('Replay a failed generation response');
    await page.getByTestId('component-lab-generate').click();
    await expect(page.locator('.component-lab__composer .component-lab__error')).toContainText('Fixture failure', { timeout: 5000 });
    await expect(page.getByTestId('component-lab-generate')).toBeEnabled();
    await expect(page.locator('.component-lab__candidate-heading')).toHaveCount(0);
    await expect(active.locator('[data-tolerance]')).toContainText('±80 ms');
    const after = await captureHistory(active);
    expect(after).toEqual(before);
    await page.screenshot({ path: path.join(output, 'failed-generation-keeps-active.png'), fullPage: true });
    mark('A failed replay leaves the active artifact, policy, and tap history intact');
    reports.push({ scenario: 'failed-generation', activeTolerance: '80 ms', history: after });
    await page.close();
  }

  // Hold an in-flight GET, send Cancel/Delete, then return a deliberately late
  // complete result to exercise the cancellation race at the UI boundary.
  {
    const { page, api } = await openLab();
    const race = api.enqueueCancelRace(3);
    await page.locator('#component-lab-prompt').fill('Replay cancellation race; do not generate');
    await page.getByTestId('component-lab-generate').click();
    await race.plan.pollSeen;
    await expect(page.getByRole('button', { name: 'ยกเลิก', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
    await race.plan.deleteSeen;
    race.releasePoll();
    await expect(page.getByTestId('component-lab-generate')).toBeEnabled({ timeout: 10000 });
    await expect(page.locator('.component-lab__composer .component-lab__error')).toContainText('ยกเลิกรอบทดลองแล้ว');
    await expect(page.locator('.component-lab__candidate-heading')).toHaveCount(0);
    await expect(page.getByTestId('component-lab-activate')).toHaveCount(0);
    const deletion = api.requests.find(request => request.method === 'DELETE' && request.pathname.endsWith('/jobs/cancel-race'));
    expect(deletion?.gate).toBe('1');
    await page.screenshot({ path: path.join(output, 'cancel-race-late-completion-hidden.png'), fullPage: true });
    mark('A completed poll arriving after Cancel is discarded and never becomes a candidate');
    reports.push({ scenario: 'cancel-race', deleteGate: deletion?.gate, pollCount: race.plan.pollCount });
    await page.close();
  }

  // Replay the captured third-party-free artifact with a 100vh rule appended;
  // this guards the iframe's intrinsic-height measurement against feedback.
  {
    const { page, api } = await openLab();
    const viewportArtifact = {
      ...liveResults[3],
      title: 'Viewport-height replay fixture',
      css: `${liveResults[3].css}\n.rhythm { min-height: 100vh !important; }`,
    };
    api.enqueueArtifact(viewportArtifact, 'viewport-min-height');
    await page.locator('#component-lab-prompt').fill('Replay the captured artifact with min-height: 100vh');
    await page.getByTestId('component-lab-generate').click();
    await expect(page.locator('.component-lab__candidate-heading h3')).toHaveText(viewportArtifact.title, { timeout: 10000 });
    const iframe = page.locator('iframe[title^="รุ่นทดลอง:"]');
    const preview = candidateFrame(page);
    await expect(preview.locator('[data-start]')).toBeVisible({ timeout: 10000 });
    const settledHeight = await waitForStableFrameHeight(iframe, 'min-height:100vh fixture');
    const frameMetrics = await preview.locator('html').evaluate(element => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
      viewportHeight: window.innerHeight,
    }));
    expect(frameMetrics.scrollWidth).toBeLessThanOrEqual(frameMetrics.clientWidth + 1);
    expect(frameMetrics.scrollHeight).toBeLessThanOrEqual(frameMetrics.clientHeight + 2);
    const pageMetrics = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));
    expect(pageMetrics.scrollWidth).toBeLessThanOrEqual(pageMetrics.clientWidth + 1);
    await page.screenshot({ path: path.join(output, 'viewport-min-height-100vh.png'), fullPage: true });
    mark(`A replayed min-height:100vh artifact stays stable for 500 ms at ${Math.round(settledHeight)} px without document overflow`);
    reports.push({ scenario: 'viewport-min-height-100vh', settledHeight, frameMetrics, pageMetrics, modelRequests: api.requests.filter(request => request.method === 'POST').length });
    await page.close();
  }

  // The older revision can be selected again while preserving taps made after
  // the newer revision was activated.
  {
    const { page, api } = await openLab();
    await generateAndApprove(page, api, 0);
    let active = activeFrame(page);
    await tapActive(active, 2);

    const secondPostIndex = api.requests.filter(request => request.method === 'POST' && request.pathname.endsWith('/generate')).length;
    await generateAndApprove(page, api, 1);
    const bodies = [...api.jobs.values()].map(job => job.requestBody).filter(Boolean);
    expect(bodies[1]?.prior?.title).toBe(liveResults[0].title);
    active = activeFrame(page);
    await expect(active.locator('[data-tolerance]')).toContainText('±150 ms');
    await tapActive(active, 1);
    const latest = await captureHistory(active);

    await page.locator('.component-lab__history > summary').click();
    const revisions = page.locator('.component-lab__revision');
    await expect(revisions).toHaveCount(2);
    await revisions.nth(1).locator('.component-lab__rollback').click();
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await page.getByRole('button', { name: 'สลับรุ่น', exact: true }).click();
    await expect(active.locator('[data-tolerance]')).toContainText('±80 ms');
    const afterRollback = await captureHistory(active);
    expect(afterRollback.count).toBe(latest.count);
    expect(afterRollback.offsets).toEqual(latest.offsets);
    await expect(page.locator('.component-lab__revision')).toHaveCount(2);
    await page.screenshot({ path: path.join(output, 'rollback-keeps-latest-taps.png'), fullPage: true });
    mark('Rollback restores the earlier rule while retaining every latest tap and both history revisions');
    reports.push({ scenario: 'rollback', revisionCount: await revisions.count(), latest, afterRollback, secondPostIndex });
    await page.close();
  }

  // The fixture is the actual exported round 3, including its 12 real replay
  // taps. Import/retest/activate must not make a generation POST.
  {
    const { page, api } = await openLab();
    await importRound3(page, api);
    await checkGeometry(page, 'desktop-1440x900');
    const controlBounds = await scrollWorkingControlsIntoView(page, activeFrame(page));
    await page.screenshot({ path: path.join(output, 'round3-desktop-active-controls.png'), fullPage: false });
    mark(`Scrolled the Component Lab body to show generated controls${controlBounds.allVisible ? ' together' : ' as far as the viewport allows'} on desktop`);
    reports.push({ scenario: 'round3-desktop-active-controls', controlBounds });
    reports.push({ scenario: 'round3-import-desktop', historyLength: round3Export.state.history.length, requests: api.requests });
    await page.close();
  }

  // Start a separate app at the narrow viewport so the canvas node receives
  // its real mobile width rather than retaining its desktop width.
  {
    const { page, api } = await openLab({ width: 319, height: 612 });
    await importRound3(page, api);
    await checkGeometry(page, 'narrow-319x612');
    const mobileControlBounds = await verifyControlsReachable(page, activeFrame(page));
    reports.push({ scenario: 'round3-mobile-controls-reachable', controlBounds: mobileControlBounds });
    mark('Start and both generated pads remain reachable by scrolling the Lab body on mobile');
    await page.setViewportSize({ width: 1440, height: 900 });
    await checkGeometry(page, 'narrow-to-desktop-1440x900');
    reports.push({ scenario: 'round3-import-narrow', historyLength: round3Export.state.history.length, requests: api.requests });
    await page.close();
  }

  // Hiding Work must notify the generated frame and stop its timer/visual beat.
  {
    const { page, api } = await openLab();
    const active = await generateAndApprove(page, api, 0);
    await active.locator('[data-start]').evaluate(element => element.click());
    await expect(active.locator('[data-status]')).toHaveText('กำลังเดินจังหวะ');
    await expect(active.locator('.rh-beats .active')).toHaveCount(1);
    await page.getByLabel('Arrange workspace').click();
    await expect(active.locator('[data-status]')).toHaveText('พักการฝึก', { timeout: 5000 });
    await expect(active.locator('[data-stop]')).toBeDisabled();
    await expect(active.locator('[data-tap]')).toBeDisabled();
    await expect(active.locator('.rh-beats .active')).toHaveCount(0);
    await page.waitForTimeout(200);
    await expect(active.locator('.rh-beats .active')).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'hidden-work-stops-beat.png'), fullPage: true });
    mark('Changing out of Work stops the active generated beat and disables tap controls');
    reports.push({ scenario: 'hidden-work', status: await active.locator('[data-status]').innerText() });
    await page.close();
  }

  expect(errors).toEqual([]);
  mark('No browser JavaScript or console errors');
  expect(layoutFailures).toEqual([]);
  mark('Component bounds remain within the visible canvas at both viewports');
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({
    passed: true,
    checks,
    errors,
    layoutFailures,
    reports,
    fixtureSource: 'test-results/component-lab-live/round-0..3-result.json and round-3-export.json',
    modelRequests: 0,
  }, null, 2));
  console.log(JSON.stringify({ checks: checks.length, errors, reports }, null, 2));
} catch (error) {
  const failure = String(error);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({
    passed: false,
    checks,
    errors,
    layoutFailures,
    reports,
    failure,
    fixtureSource: 'test-results/component-lab-live/round-0..3-result.json and round-3-export.json',
    modelRequests: 0,
  }, null, 2));
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
}
