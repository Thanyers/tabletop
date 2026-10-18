import { chromium, expect } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const out = process.env.TRIO_REPORT_DIR || 'test-results/viewer-audit-v15-before';
const base = process.env.TRIO_URL || 'http://127.0.0.1:4173/';
const cases = ['shipping', 'quest', 'music'];
const expectedSteps = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];

await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const reports = [];

try {
  for (const id of cases) {
    const context = await browser.newContext({
      viewport: { width: 1600, height: 900 },
      reducedMotion: 'no-preference',
      colorScheme: 'light',
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.addInitScript(() => {
      window.__viewerAudit = { startedAt: null, trace: [] };
      let lastState = '';

      const bounds = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          x: Math.round(rect.x * 10) / 10,
          y: Math.round(rect.y * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          bottom: Math.round(rect.bottom * 10) / 10,
        };
      };
      const intersect = (a, b) => {
        const left = Math.max(a.left, b.left);
        const right = Math.min(a.right, b.right);
        const top = Math.max(a.top, b.top);
        const bottom = Math.min(a.bottom, b.bottom);
        return { left, right, top, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      };
      const clippedTarget = (element, canvas) => {
        const initial = element.getBoundingClientRect();
        let visible = { left: initial.left, right: initial.right, top: initial.top, bottom: initial.bottom };
        let parent = element.parentElement;
        while (parent && parent !== canvas.parentElement) {
          const style = getComputedStyle(parent);
          const clipX = /auto|scroll|hidden|clip/.test(style.overflowX);
          const clipY = /auto|scroll|hidden|clip/.test(style.overflowY);
          if (clipX || clipY) {
            const rect = parent.getBoundingClientRect();
            visible = intersect(visible, {
              left: clipX ? rect.left : -Infinity,
              right: clipX ? rect.right : Infinity,
              top: clipY ? rect.top : -Infinity,
              bottom: clipY ? rect.bottom : Infinity,
            });
          }
          parent = parent.parentElement;
        }
        const canvasRect = canvas.getBoundingClientRect();
        visible = intersect(visible, canvasRect);
        const area = Math.max(0, initial.width) * Math.max(0, initial.height);
        const visibleArea = visible.width * visible.height;
        return {
          bounds: bounds(element),
          visibleBounds: {
            x: Math.round(visible.left * 10) / 10,
            y: Math.round(visible.top * 10) / 10,
            width: Math.round(visible.width * 10) / 10,
            height: Math.round(visible.height * 10) / 10,
          },
          visibleFraction: area ? Math.round((visibleArea / area) * 1000) / 1000 : null,
        };
      };
      const sample = () => {
        const audit = window.__viewerAudit;
        const player = document.querySelector('[data-testid="trio-player"]');
        if (!audit.startedAt || !player) return;
        const canvas = document.querySelector('.canvas-area');
        const stage = document.querySelector('[data-testid="trio-stage"]');
        const focused = canvas?.querySelector('.trio-canvas-node[data-spotlight="focused"]') ?? null;
        const request = player.querySelector('.demo-request') ?? player.querySelector('[data-testid="trio-request"]');
        const marks = [...(request?.querySelectorAll('mark') ?? [])].map((mark) => ({
          text: mark.innerText,
          current: mark.classList.contains('is-current-reference'),
        }));
        const semantic = focused
          ? [...focused.querySelectorAll('.is-narrative-detail, .is-narrative-record')]
              .filter((element) => element.getClientRects().length > 0)
              .slice(0, 5)
          : [];
        const cueTargets = semantic.map((element) => clippedTarget(element, canvas));
        const sourceViewport = focused?.querySelector('.source-preview__viewport') ?? null;
        const sourceViewportRect = sourceViewport?.getBoundingClientRect() ?? null;
        const sourceRows = sourceViewport
          ? [...sourceViewport.querySelectorAll('tbody tr')].map((row) => {
              const rect = row.getBoundingClientRect();
              const visible = sourceViewportRect ? intersect(rect, sourceViewportRect) : null;
              const area = Math.max(0, rect.width) * Math.max(0, rect.height);
              return {
                id: row.getAttribute('data-narrative-record') ?? row.innerText.split('\n')[0] ?? '',
                bounds: bounds(row),
                visibleFraction: area && visible ? Math.round((visible.width * visible.height / area) * 1000) / 1000 : null,
              };
            })
          : [];
        const verificationExamples = focused
          ? [...focused.querySelectorAll('[data-testid="verification-sample"]')].map((element) => ({
              id: element.getAttribute('data-sample-id'),
              label: element.querySelector('.trio-sample__label')?.innerText ?? '',
              bounds: bounds(element),
              visibleFraction: clippedTarget(element, canvas).visibleFraction,
            }))
          : [];
        const scrollers = [];
        if (focused) {
          for (let parent = focused.querySelector('.trio-stage__object') ?? focused; parent && parent !== focused.parentElement; parent = parent.parentElement) {
            const style = getComputedStyle(parent);
            const hasOverflow = parent.scrollHeight > parent.clientHeight + 1 || parent.scrollWidth > parent.clientWidth + 1;
            if (hasOverflow && /auto|scroll|hidden/.test(`${style.overflowX} ${style.overflowY}`)) {
              scrollers.push({
                selector: parent.className?.baseVal ?? parent.className ?? parent.tagName.toLowerCase(),
                bounds: bounds(parent),
                clientWidth: parent.clientWidth,
                scrollWidth: parent.scrollWidth,
                scrollLeft: Math.round(parent.scrollLeft),
                clientHeight: parent.clientHeight,
                scrollHeight: parent.scrollHeight,
                scrollTop: Math.round(parent.scrollTop),
              });
            }
          }
          const laneSelectors = '.trio-rate-table-wrap, .trio-route-list, .trio-music-strip-wrap, .trio-sample-list, .trio-simulation-table-wrap';
          for (const lane of focused.querySelectorAll(laneSelectors)) {
            if (!scrollers.some((item) => item.bounds?.x === bounds(lane)?.x && item.bounds?.y === bounds(lane)?.y)) {
              const style = getComputedStyle(lane);
              if (lane.scrollWidth > lane.clientWidth + 1 || lane.scrollHeight > lane.clientHeight + 1) {
                scrollers.push({
                  selector: lane.className?.baseVal ?? lane.className ?? lane.tagName.toLowerCase(),
                  bounds: bounds(lane),
                  clientWidth: lane.clientWidth,
                  scrollWidth: lane.scrollWidth,
                  scrollLeft: Math.round(lane.scrollLeft),
                  clientHeight: lane.clientHeight,
                  scrollHeight: lane.scrollHeight,
                  scrollTop: Math.round(lane.scrollTop),
                  overflowX: style.overflowX,
                  overflowY: style.overflowY,
                });
              }
            }
          }
        }
        const canvasBox = bounds(canvas);
        const focusedBox = bounds(focused);
        const traceItem = {
          elapsedMs: Math.round(performance.now() - audit.startedAt),
          step: player.getAttribute('data-step'),
          phase: player.getAttribute('data-phase'),
          status: player.querySelector('[data-testid="trio-status"]')?.innerText ?? '',
          request: request?.innerText ?? '',
          requestChars: request?.innerText?.length ?? 0,
          highlights: marks,
          focusedObject: focused?.getAttribute('data-trio-object') ?? focused?.getAttribute('data-step') ?? null,
          focusedState: focused?.getAttribute('data-spotlight') ?? null,
          canvasBounds: canvasBox,
          stageBounds: bounds(stage),
          focusedBounds: focusedBox,
          focusedOffsetInCanvas: canvasBox && focusedBox ? {
            x: Math.round((focusedBox.x - canvasBox.x) * 10) / 10,
            y: Math.round((focusedBox.y - canvasBox.y) * 10) / 10,
            right: Math.round((focusedBox.right - canvasBox.x) * 10) / 10,
            bottom: Math.round((focusedBox.bottom - canvasBox.y) * 10) / 10,
          } : null,
          cueRecord: focused?.getAttribute('data-cue-record') ?? null,
          cueTargets,
          sourceViewport: sourceViewport ? {
            bounds: bounds(sourceViewport),
            clientWidth: sourceViewport.clientWidth,
            scrollWidth: sourceViewport.scrollWidth,
            scrollLeft: Math.round(sourceViewport.scrollLeft),
            clientHeight: sourceViewport.clientHeight,
            scrollHeight: sourceViewport.scrollHeight,
            scrollTop: Math.round(sourceViewport.scrollTop),
            rows: sourceRows,
          } : null,
          verificationExamples,
          scrollers,
          flowTransform: canvas?.querySelector('.react-flow__viewport')?.getAttribute('style') ?? null,
          pageHorizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        };
        const compare = JSON.stringify({ ...traceItem, elapsedMs: 0 });
        if (compare !== lastState) {
          lastState = compare;
          audit.trace.push(traceItem);
        }
      };
      const observer = new MutationObserver(sample);
      observer.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'data-testid', 'data-step', 'data-phase', 'data-level', 'data-spotlight', 'data-cue-record'],
      });
      window.setInterval(sample, 100);
    });

    await page.goto(base, { waitUntil: 'networkidle' });
    await expect(page.getByTestId('case-' + id)).toBeVisible();
    await page.screenshot({ path: `${out}/${id}-00-first-screen.png` });
    const screenshotFiles = [`${id}-00-first-screen.png`];
    const journeyWallStart = Date.now();
    await page.getByTestId('case-' + id).click();
    const player = page.getByTestId('trio-player');
    await expect(player).toHaveAttribute('data-phase', 'ready');
    await expect(page.getByLabel('Story playback speed', { exact: true })).toHaveValue('1');
    await page.screenshot({ path: `${out}/${id}-01-ready.png` });
    screenshotFiles.push(`${id}-01-ready.png`);
    await page.evaluate(() => { window.__viewerAudit.startedAt = performance.now(); });
    const startClickedAt = Date.now();
    await page.getByLabel('Start demo', { exact: true }).click();

    const captured = new Set();
    const capture = async (step, phase, label, settleMs = 0) => {
      const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '-');
      const key = `${step}:${safeLabel}`;
      if (captured.has(key)) return;
      captured.add(key);
      if (settleMs) await page.waitForTimeout(settleMs);
      const file = `${id}-${step}-${safeLabel}.png`;
      await page.screenshot({ path: `${out}/${file}` });
      screenshotFiles.push(file);
    };

    let deadline = Date.now() + 240000;
    let lastPhaseKey = '';
    while (Date.now() < deadline) {
      const state = await player.evaluate((element) => {
        const sample = document.querySelector('[data-testid="trio-stage"] [data-testid="verification-sample"]');
        return {
          step: element.getAttribute('data-step'),
          phase: element.getAttribute('data-phase'),
          sampleId: sample?.getAttribute('data-sample-id') ?? null,
          sampleLabel: sample?.querySelector('.trio-sample__label')?.textContent?.trim() ?? '',
        };
      });
      const phaseKey = `${state.step}:${state.phase}`;
      if (state.phase === 'thinking' && phaseKey !== lastPhaseKey) {
        await capture(state.step, state.phase, 'request-complete');
        await capture(state.step, state.phase, 'thinking', 180);
      }
      if (state.phase === 'reading' && phaseKey !== lastPhaseKey) {
        await capture(state.step, state.phase, 'reading', 240);
      }
      if (state.step === 'verify' && state.phase === 'reading' && state.sampleId) {
        const label = `sample-${state.sampleId}`.replace(/[^a-zA-Z0-9_-]/g, '-');
        const key = `verify:${label}`;
        if (!captured.has(key)) {
          await capture('verify', state.phase, label);
        }
      }
      if (state.phase === 'complete') break;
      lastPhaseKey = phaseKey;
      await page.waitForTimeout(35);
    }
    await expect(player).toHaveAttribute('data-phase', 'complete', { timeout: 1000 });
    await page.screenshot({ path: `${out}/${id}-complete.png` });
    screenshotFiles.push(`${id}-complete.png`);

    const trace = await page.evaluate(() => window.__viewerAudit.trace);
    const phaseTransitions = [];
    let previous = '';
    for (const entry of trace) {
      const key = `${entry.step}:${entry.phase}`;
      if (key !== previous) {
        phaseTransitions.push({
          step: entry.step,
          phase: entry.phase,
          atMs: entry.elapsedMs,
          requestChars: entry.requestChars,
          request: entry.request,
          status: entry.status,
          focusedObject: entry.focusedObject,
          focusedBounds: entry.focusedBounds,
          canvasBounds: entry.canvasBounds,
          cueTargets: entry.cueTargets,
          scrollers: entry.scrollers,
          highlights: entry.highlights,
          sourceViewport: entry.sourceViewport,
          verificationExamples: entry.verificationExamples,
        });
        previous = key;
      }
    }
    const dwell = phaseTransitions.map((transition, index) => ({
      ...transition,
      durationMs: (phaseTransitions[index + 1]?.atMs ?? trace.at(-1)?.elapsedMs ?? transition.atMs) - transition.atMs,
    }));
    const readingDwell = dwell.filter((item) => item.phase === 'reading');
    const thinkingDwell = dwell.filter((item) => item.phase === 'thinking');
    const sourceReading = trace.filter((item) => item.step === 'sources' && item.phase === 'reading' && item.sourceViewport).at(-1)?.sourceViewport ?? null;
    const verificationExamplesSeen = [];
    const seenVerificationIds = new Set();
    for (const item of trace.filter((entry) => entry.step === 'verify' && entry.phase === 'reading')) {
      for (const example of item.verificationExamples) {
        if (!example.id || seenVerificationIds.has(example.id)) continue;
        seenVerificationIds.add(example.id);
        verificationExamplesSeen.push({ elapsedMs: item.elapsedMs, ...example });
      }
    }
    const report = {
      story: id,
      viewport: { width: 1600, height: 900 },
      speed: 1,
      reducedMotion: 'no-preference',
      journeyElapsedMs: Date.now() - journeyWallStart,
      playbackElapsedMs: Date.now() - startClickedAt,
      stepCoverage: [...new Set(phaseTransitions.map((item) => item.step))],
      phaseTransitions: dwell,
      readingDwellMs: Object.fromEntries(readingDwell.map((item) => [item.step, item.durationMs])),
      thinkingDwellMs: Object.fromEntries(thinkingDwell.map((item) => [item.step, item.durationMs])),
      potentiallyShortDwell: {
        thinkingUnder1000ms: thinkingDwell.filter((item) => item.durationMs < 1000).map((item) => ({ step: item.step, durationMs: item.durationMs })),
        readingUnder1200ms: readingDwell.filter((item) => item.durationMs < 1200).map((item) => ({ step: item.step, durationMs: item.durationMs })),
      },
      sourceViewportAtReading: sourceReading,
      verificationExamplesSeen,
      screenshots: screenshotFiles,
      trace,
      errors,
    };
    await writeFile(`${out}/${id}-report.json`, JSON.stringify(report, null, 2));

    expect(report.stepCoverage).toEqual(expectedSteps);
    expect(phaseTransitions.filter((item) => item.phase === 'thinking').map((item) => item.step)).toEqual(expectedSteps);
    expect(phaseTransitions.filter((item) => item.phase === 'reading').map((item) => item.step)).toEqual(expectedSteps);
    expect(errors).toEqual([]);
    console.log(JSON.stringify({
      story: id,
      playbackElapsedMs: report.playbackElapsedMs,
      steps: report.stepCoverage.length,
      thinkingUnder1000ms: report.potentiallyShortDwell.thinkingUnder1000ms,
      readingUnder1200ms: report.potentiallyShortDwell.readingUnder1200ms,
      screenshots: screenshotFiles.length,
      errors: errors.length,
    }));
    reports.push(report);
    await context.close();
  }

  await writeFile(`${out}/report.json`, JSON.stringify({ reports }, null, 2));
} catch (error) {
  await writeFile(`${out}/failure.json`, JSON.stringify({ error: String(error), reports }, null, 2));
  throw error;
} finally {
  await browser.close();
}
