import { chromium, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const base = process.env.TRIO_URL || 'http://127.0.0.1:4173/';
const output = process.env.TRIO_REPORT_DIR || 'test-results/creative-v15';
const outputPath = resolve(output);
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const checks = [];
const reports = [];

await mkdir(outputPath, { recursive: true });

function mark(label) {
  checks.push(label);
  console.log(`PASS ${label}`);
}

function watchErrors(page, errors) {
  page.on('pageerror', (error) => errors.push({ type: 'pageerror', message: error.message }));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push({ type: 'console', message: message.text() });
  });
}

async function openStory(id, errors) {
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    acceptDownloads: true,
  });
  const page = await context.newPage();
  watchErrors(page, errors);
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByTestId('trio-demo-picker').waitFor();
  await page.getByTestId(`case-${id}`).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-case', id);
  return { context, page };
}

async function completeGuidedStory(page, id) {
  const speed = page.getByLabel('Story playback speed', { exact: true });
  await speed.selectOption('4');
  expect(await speed.inputValue()).toBe('4');
  await page.evaluate(() => {
    const trace = [];
    let previousId = '';
    const capture = () => {
      const player = document.querySelector('[data-testid="trio-player"]');
      if (player?.getAttribute('data-step') !== 'verify' || player.getAttribute('data-phase') !== 'reading') return;
      const sample = document.querySelector('[data-testid="canvas-object-verify"] [data-testid="verification-sample"]');
      const id = sample?.getAttribute('data-sample-id') ?? '';
      if (id && id !== previousId) {
        trace.push({ id, at: performance.now() });
        previousId = id;
      }
    };
    const observer = new MutationObserver(capture);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-phase', 'data-sample-id', 'data-step'],
      childList: true,
      subtree: true,
    });
    window.__trioAuditCarousel = { trace, observer };
    capture();
  });
  const startedAt = Date.now();
  await page.getByLabel('Start demo', { exact: true }).click();
  await expect(page.getByTestId('trio-player')).toHaveAttribute('data-phase', 'complete', { timeout: 90_000 });
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-level', '8');
  await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-step', 'handoff');
  const carousel = await page.evaluate(() => {
    window.__trioAuditCarousel?.observer.disconnect();
    return window.__trioAuditCarousel?.trace ?? [];
  });
  expect(carousel.length, `${id} 4× verification carousel should show multiple samples`).toBeGreaterThanOrEqual(3);
  const carouselIntervalsMs = carousel.slice(1, 4).map((sample, index) => Math.round(sample.at - carousel[index].at));
  expect(carouselIntervalsMs).toHaveLength(3);
  for (const interval of carouselIntervalsMs) {
    expect(interval, `${id} 4× carousel interval in ms`).toBeGreaterThanOrEqual(450);
    expect(interval, `${id} 4× carousel interval in ms`).toBeLessThan(1_600);
  }
  await page.screenshot({ path: `${outputPath}/${id}-guided-complete.png` });
  return {
    speed: 4,
    elapsedMs: Date.now() - startedAt,
    carousel: {
      sampleIds: carousel.map((sample) => sample.id),
      intervalsMs: carouselIntervalsMs,
    },
  };
}

async function focusCreativeObject(page, step = 'minimal') {
  await page.getByLabel('Fit to work', { exact: true }).click();
  await page.waitForTimeout(250);
  const node = page.getByTestId(`canvas-object-${step}`);
  await node.locator('.trio-canvas-node__chrome').dblclick({ timeout: 10_000 });
  await page.waitForTimeout(400);
  return node;
}

async function testQuest() {
  const errors = [];
  const report = { id: 'quest', checks: [], errors };
  const localMark = (label) => {
    report.checks.push(label);
    mark(`quest: ${label}`);
  };
  const { context, page } = await openStory('quest', errors);

  try {
    report.guided = await completeGuidedStory(page, 'quest');
    localMark(`4× verification carousel advanced ${report.guided.carousel.sampleIds.length} samples in ${report.guided.carousel.intervalsMs.join(', ')} ms`);
    await expect(page.getByLabel('Take over workspace', { exact: true })).toBeVisible();
    await page.getByLabel('Take over workspace', { exact: true }).click();
    await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-guided', 'false');
    const questNode = await focusCreativeObject(page);
    const quest = questNode.getByTestId('quest-game');
    await expect(quest).toBeVisible();
    await page.screenshot({ path: `${outputPath}/quest-after-takeover.png` });
    localMark('completed all eight guided steps at 4×, then took over the same live quest workspace');

    const garden = page.getByRole('group', { name: 'ตัวเลือกคำตอบ: สวน', exact: true });
    const libraryNode = quest.getByRole('button', { name: 'ห้องสมุด · ล็อกอยู่', exact: true });
    const treasureNode = quest.getByRole('button', { name: 'กล่องสมบัติ · ล็อกอยู่', exact: true });
    await expect(libraryNode).toBeDisabled();
    await expect(treasureNode).toBeDisabled();

    const timerReadout = quest.locator('.quest-game__rule-clock strong');
    await quest.getByLabel('Start game timer', { exact: true }).click();
    await expect(quest.getByLabel('Pause game timer', { exact: true })).toBeEnabled();
    await page.waitForTimeout(1_100);
    expect(await timerReadout.innerText()).not.toBe('0:00');

    await garden.getByRole('button', { name: /แสงจันทร์/ }).click();
    await expect(quest.locator('.quest-game__feedback')).toContainText('คำตอบยังไม่ตรง');
    await expect(quest.getByRole('group', { name: 'ตัวเลือกคำตอบ: สวน', exact: true })).toBeVisible();
    await expect(libraryNode).toBeDisabled();
    await garden.getByRole('button', { name: /แสงแดด/ }).click();
    await expect(quest.getByRole('button', { name: 'ห้องสมุด · เปิดแล้ว', exact: true })).toBeEnabled();
    await expect(treasureNode).toBeDisabled();
    const adaptive = questNode.getByTestId('trio-adaptive-surface');
    await adaptive.getByTestId('adaptive-surface-options').click();
    await adaptive.getByTestId('adaptive-surface-choice-table').click();
    await expect(adaptive.getByTestId('adaptive-surface-original-tools')).toBeHidden();
    await adaptive.getByTestId('adaptive-surface-tools').click();
    await expect(quest.getByRole('group', { name: 'ตัวเลือกคำตอบ: ห้องสมุด', exact: true })).toBeVisible();
    await expect(quest.getByLabel('Start game timer', { exact: true })).toBeVisible();
    const pausedAt = await timerReadout.innerText();
    await page.waitForTimeout(550);
    await expect(timerReadout).toHaveText(pausedAt);
    await quest.getByLabel('Start game timer', { exact: true }).click();
    await expect(quest.getByLabel('Pause game timer', { exact: true })).toBeEnabled();
    localMark('switching to a table pauses the hidden timer; reopening tools preserves the unlocked library puzzle');
    localMark('a wrong garden answer keeps the route locked; the correct answer unlocks the library');

    const library = page.getByRole('group', { name: 'ตัวเลือกคำตอบ: ห้องสมุด', exact: true });
    await library.getByRole('button', { name: /โคมไฟ/ }).click();
    await expect(quest.locator('.quest-game__feedback')).toContainText('คำตอบยังไม่ตรง');
    await expect(treasureNode).toBeDisabled();
    await library.getByRole('button', { name: /หนังสือ/ }).click();
    await expect(quest.getByRole('button', { name: 'กล่องสมบัติ · เปิดแล้ว', exact: true })).toBeEnabled();
    localMark('a wrong library answer does not unlock the treasure; the correct answer does');

    const treasure = page.getByRole('group', { name: 'ตัวเลือกคำตอบ: กล่องสมบัติ', exact: true });
    await treasure.getByRole('button', { name: /ริบบิ้น/ }).click();
    await expect(quest.locator('.quest-game__feedback')).toContainText('คำตอบยังไม่ตรง');
    await treasure.getByRole('button', { name: /กุญแจ/ }).click();
    await expect(quest.locator('.quest-game__progress')).toHaveAttribute('aria-label', 'ผ่านแล้ว 3 จาก 3 ด่าน');
    await expect(quest.locator('.quest-game__complete')).toContainText('ผ่านครบทั้งสามด่านแล้ว · เกมจบแล้ว');
    await expect(quest.locator('.quest-game__complete')).toBeVisible();
    await expect(quest.getByLabel('Start game timer', { exact: true })).toBeDisabled();
    await page.screenshot({ path: `${outputPath}/quest-three-stations-solved.png` });
    localMark('wrong then correct answers across all three stations complete the route and automatically stop the timer');

    const finishedAt = await timerReadout.innerText();
    await page.waitForTimeout(1_100);
    await expect(timerReadout).toHaveText(finishedAt);
    await page.screenshot({ path: `${outputPath}/quest-finished-timer-stopped.png` });
    localMark('the timer remains stopped at a stable reading after the final correct answer');

    await quest.getByLabel('Restart game', { exact: true }).click();
    await expect(timerReadout).toHaveText('0:00');
    await expect(quest.locator('.quest-game__progress')).toHaveAttribute('aria-label', 'ผ่านแล้ว 0 จาก 3 ด่าน');
    await expect(quest.getByLabel('Start game timer', { exact: true })).toBeEnabled();
    await expect(quest.getByRole('button', { name: 'ห้องสมุด · ล็อกอยู่', exact: true })).toBeDisabled();
    await page.screenshot({ path: `${outputPath}/quest-reset.png` });
    localMark('reset clears solved stations and elapsed time and locks later stations again');

    const handoffNode = await focusCreativeObject(page, 'handoff');
    const deliverables = handoffNode.getByTestId('trio-deliverables');
    const downloadPromise = page.waitForEvent('download');
    await deliverables.getByRole('button', { name: /เกมที่เล่นได้/ }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^quest-playable-v\d+\.html$/);
    const htmlPath = resolve(outputPath, 'quest-game.html');
    await download.saveAs(htmlPath);
    const html = await readFile(htmlPath, 'utf8');
    expect(html).toContain('<!doctype html>');
    expect(html).toContain('data-first-hint="180"');
    expect(html).toContain('data-second-hint="300"');
    expect(html).toContain('data-auto-reveal="false"');
    expect(html).not.toMatch(/\b(?:fetch|XMLHttpRequest|eval)\s*\(|https?:\/\//i);
    report.exportedHtmlBytes = Buffer.byteLength(html);

    const offlineContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    });
    const offlinePage = await offlineContext.newPage();
    const offlineErrors = [];
    const externalRequests = [];
    watchErrors(offlinePage, offlineErrors);
    offlinePage.on('request', (request) => {
      if (/^https?:\/\//i.test(request.url())) externalRequests.push(request.url());
    });
    await offlinePage.route(/^https?:\/\//i, (route) => route.abort());
    await offlinePage.goto(pathToFileURL(htmlPath).href, { waitUntil: 'load' });
    const exported = offlinePage.locator('[data-quest-app]');
    await expect(exported).toBeVisible();
    const exportedLibrary = offlinePage.locator('[data-station="library"]');
    const exportedTreasure = offlinePage.locator('[data-station="treasure"]');
    await expect(exportedLibrary).toBeDisabled();
    await expect(exportedTreasure).toBeDisabled();

    await offlinePage.locator('[data-puzzle="garden"] [data-choice="moonlight"]').click();
    await expect(offlinePage.locator('[data-puzzle="garden"] [data-feedback]')).toContainText('คำตอบยังไม่ตรง');
    await expect(exportedLibrary).toBeDisabled();
    await offlinePage.locator('[data-puzzle="garden"] [data-choice="sunlight"]').click();
    await expect(exportedLibrary).toBeEnabled();
    await expect(offlinePage.locator('[data-puzzle="library"]')).toBeVisible();

    await offlinePage.locator('[data-puzzle="library"] [data-choice="lamp"]').click();
    await expect(offlinePage.locator('[data-puzzle="library"] [data-feedback]')).toContainText('คำตอบยังไม่ตรง');
    await expect(exportedTreasure).toBeDisabled();
    await offlinePage.locator('[data-puzzle="library"] [data-choice="book"]').click();
    await expect(exportedTreasure).toBeEnabled();
    await expect(offlinePage.locator('[data-puzzle="treasure"]')).toBeVisible();

    await offlinePage.locator('[data-puzzle="treasure"] [data-choice="ribbon"]').click();
    await expect(offlinePage.locator('[data-puzzle="treasure"] [data-feedback]')).toContainText('คำตอบยังไม่ตรง');
    await offlinePage.locator('[data-puzzle="treasure"] [data-choice="key"]').click();
    await expect(offlinePage.locator('[data-result]')).toContainText('ครบทั้งสามด่านแล้ว');
    expect(externalRequests).toEqual([]);
    expect(offlineErrors).toEqual([]);
    await offlinePage.screenshot({ path: `${outputPath}/quest-exported-offline-complete.png` });
    await offlineContext.close();
    localMark('the downloaded HTML runs from disk with no HTTP requests and advances through wrong/correct answers to completion');

    expect(errors).toEqual([]);
    reports.push(report);
    await page.screenshot({ path: `${outputPath}/quest-final.png` });
    await writeFile(`${outputPath}/quest-report.json`, JSON.stringify({ ...report, offlineErrors, externalRequests }, null, 2));
  } catch (error) {
    report.error = String(error);
    report.pageText = await page.locator('body').innerText().catch(() => '');
    reports.push(report);
    await page.screenshot({ path: `${outputPath}/quest-failure.png` }).catch(() => {});
    await writeFile(`${outputPath}/quest-failure.json`, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}

async function testMusic() {
  const errors = [];
  const report = { id: 'music', checks: [], errors };
  const localMark = (label) => {
    report.checks.push(label);
    mark(`music: ${label}`);
  };
  const { context, page } = await openStory('music', errors);

  try {
    report.guided = await completeGuidedStory(page, 'music');
    localMark(`4× verification carousel advanced ${report.guided.carousel.sampleIds.length} samples in ${report.guided.carousel.intervalsMs.join(', ')} ms`);
    await page.getByLabel('Take over workspace', { exact: true }).click();
    await expect(page.getByTestId('trio-stage')).toHaveAttribute('data-guided', 'false');
    const musicNode = await focusCreativeObject(page);
    const lab = musicNode.getByTestId('music-lab');
    await expect(lab).toBeVisible();
    await page.screenshot({ path: `${outputPath}/music-after-takeover.png` });
    localMark('completed all eight guided steps at 4× and took over the live MusicLab');

    const waveform = lab.getByTestId('music-waveform');
    const playhead = lab.getByTestId('music-playhead');
    const beat = lab.getByTestId('music-beat');
    const initialX = Number(await playhead.getAttribute('x1'));
    const initialBeat = await beat.getAttribute('aria-label');
    await expect(lab.getByLabel('Start metronome', { exact: true })).toBeEnabled();
    await lab.getByLabel('Start metronome', { exact: true }).click();
    await expect(lab.getByLabel('Stop metronome', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead.getAttribute('x1')), { timeout: 4_000 }).toBeGreaterThan(initialX);
    await expect(beat).not.toHaveAttribute('aria-label', initialBeat, { timeout: 4_000 });
    await page.screenshot({ path: `${outputPath}/music-audio-playing.png` });
    localMark('an explicit audio start click advances both waveform playhead and beat indicator');

    const mute = lab.getByRole('button', { name: 'Mute preview', exact: true });
    await mute.click();
    await expect(lab.getByRole('button', { name: 'Unmute preview', exact: true })).toHaveAttribute('aria-pressed', 'true');
    const volume = lab.getByLabel('Preview volume', { exact: true });
    await volume.focus();
    await volume.press('Home');
    for (let index = 0; index < 7; index += 1) await volume.press('ArrowRight');
    await expect(volume).toHaveValue('35');
    await expect(lab.getByText('Muted', { exact: true })).toBeVisible();
    await lab.getByRole('button', { name: 'Unmute preview', exact: true }).click();
    await expect(lab.getByRole('button', { name: 'Mute preview', exact: true })).toHaveAttribute('aria-pressed', 'false');
    await expect(lab.getByText('35%', { exact: true })).toBeVisible();
    localMark('mute/unmute and keyboard volume control update while the audio preview is playing');

    const adaptive = musicNode.getByTestId('trio-adaptive-surface');
    await adaptive.getByTestId('adaptive-surface-options').click();
    await adaptive.getByTestId('adaptive-surface-choice-table').click();
    await expect(adaptive).toHaveAttribute('data-presentation', 'table');
    await expect(adaptive.getByTestId('adaptive-surface-original-tools')).toBeHidden();
    await adaptive.getByTestId('adaptive-surface-tools').click();
    await expect(lab.getByLabel('Start metronome', { exact: true })).toBeVisible();
    const tableStoppedAt = Number(await playhead.getAttribute('x1'));
    await page.waitForTimeout(550);
    expect(Number(await playhead.getAttribute('x1'))).toBeCloseTo(tableStoppedAt, 1);
    localMark('hiding MusicLab behind the table stops audio; reopening tools shows Start and a frozen playhead');

    await lab.getByLabel('Start metronome', { exact: true }).click();
    await expect(lab.getByLabel('Stop metronome', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead.getAttribute('x1'))).toBeGreaterThan(0);
    const lenses = page.locator('.lens-switch');
    await lenses.getByRole('button', { name: 'Constellation', exact: true }).click();
    await expect(lenses.getByRole('button', { name: 'Constellation', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await lenses.getByRole('button', { name: 'Work', exact: true }).click();
    await expect(lenses.getByRole('button', { name: 'Work', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await focusCreativeObject(page);
    await expect(lab.getByLabel('Start metronome', { exact: true })).toBeVisible();
    const lensStoppedAt = Number(await playhead.getAttribute('x1'));
    await page.waitForTimeout(550);
    expect(Number(await playhead.getAttribute('x1'))).toBeCloseTo(lensStoppedAt, 1);
    localMark('leaving Work for Constellation stops music; returning to Work exposes Start and a frozen playhead');

    const sections = lab.getByRole('group', { name: 'เลือกท่อนเพลง', exact: true });
    const intro = sections.getByRole('button', { name: /Intro \(ท่อนเปิด\)/ });
    await intro.click();
    await expect(intro).toHaveAttribute('aria-pressed', 'true');
    await expect(lab.getByLabel('Start metronome', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead.getAttribute('x1'))).toBe(0);
    await page.screenshot({ path: `${outputPath}/music-section-switched.png` });
    localMark('switching to another section stops the active phrase and resets the playhead');

    await lab.getByLabel('Start metronome', { exact: true }).click();
    await expect(lab.getByLabel('Stop metronome', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead.getAttribute('x1')), { timeout: 3_000 }).toBeGreaterThan(0);
    await lab.getByLabel('Stop metronome', { exact: true }).click();
    await expect(lab.getByLabel('Start metronome', { exact: true })).toBeVisible();
    await expect.poll(async () => Number(await playhead.getAttribute('x1'))).toBe(0);
    const stoppedBeat = await beat.getAttribute('aria-label');
    await page.waitForTimeout(550);
    await expect(beat).toHaveAttribute('aria-label', stoppedBeat);
    await page.screenshot({ path: `${outputPath}/music-stopped.png` });
    localMark('explicit stop resets the playhead and leaves the beat indicator stable');

    const downloadPromise = page.waitForEvent('download');
    await lab.getByLabel('ดาวน์โหลดเสียงตัวอย่าง WAV', { exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^music-loop-.*-4-beat-phrase\.wav$/);
    const wavPath = resolve(outputPath, download.suggestedFilename());
    await download.saveAs(wavPath);
    const wav = await readFile(wavPath);
    expect(wav.byteLength).toBeGreaterThan(44);
    expect(wav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(wav.toString('ascii', 8, 12)).toBe('WAVE');
    report.wav = { file: download.suggestedFilename(), bytes: wav.byteLength, signature: wav.toString('ascii', 0, 12) };
    localMark('downloaded WAV contains a RIFF/WAVE header and PCM payload');

    const handoffNode = await focusCreativeObject(page, 'handoff');
    const deliverables = handoffNode.getByTestId('trio-deliverables');
    const handoffDownloadPromise = page.waitForEvent('download');
    await deliverables.getByRole('button', { name: /เสียงซ้อมตัวอย่าง/ }).click();
    const handoffDownload = await handoffDownloadPromise;
    expect(handoffDownload.suggestedFilename()).toMatch(/^chorus-80bpm-4-beats\.wav$/);
    const handoffWavPath = resolve(outputPath, handoffDownload.suggestedFilename());
    await handoffDownload.saveAs(handoffWavPath);
    const handoffWav = await readFile(handoffWavPath);
    expect(handoffWav.byteLength).toBeGreaterThan(44);
    expect(handoffWav.toString('ascii', 0, 4)).toBe('RIFF');
    expect(handoffWav.toString('ascii', 8, 12)).toBe('WAVE');
    report.handoffWav = { file: handoffDownload.suggestedFilename(), bytes: handoffWav.byteLength, signature: handoffWav.toString('ascii', 0, 12) };
    localMark('handoff exports the active 80 BPM chorus as a RIFF/WAVE file');

    expect(errors).toEqual([]);
    reports.push(report);
    await page.screenshot({ path: `${outputPath}/music-final.png` });
    await writeFile(`${outputPath}/music-report.json`, JSON.stringify(report, null, 2));
  } catch (error) {
    report.error = String(error);
    report.pageText = await page.locator('body').innerText().catch(() => '');
    reports.push(report);
    await page.screenshot({ path: `${outputPath}/music-failure.png` }).catch(() => {});
    await writeFile(`${outputPath}/music-failure.json`, JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await testQuest();
  await testMusic();
  const summary = { base, checks: checks.length, reports };
  await writeFile(`${outputPath}/report.json`, JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ checks: checks.length, reports: `${outputPath}/report.json` }));
} catch (error) {
  await writeFile(`${outputPath}/failure.json`, JSON.stringify({ error: String(error), checks, reports }, null, 2));
  throw error;
} finally {
  await browser.close();
}
