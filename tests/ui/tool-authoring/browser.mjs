import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * F080 / C3 acceptance: a person edits a package's source, the shared pipeline checks it, and an
 * activation comes back with a readback the person can act on.
 *
 * Run `node scripts/build-tool-authoring-harness.mjs` first. Evidence goes to
 * `test-results/tool-authoring/` (gitignored).
 */

const root = resolve(import.meta.dirname, '..', '..', '..');
const pages = resolve(root, 'test-results/tool-authoring-harness/index.html');
const output = resolve(root, 'test-results/tool-authoring');
await mkdir(output, { recursive: true });

const checks = [];
const mark = (name, detail = '') => {
  checks.push({ name, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
};
const fail = (name, detail) => {
  checks.push({ name, detail, failed: true });
  throw new Error(`${name}: ${detail}`);
};

const GOOD = `export function Tool() {
  return <p>ผังกิจกรรม (แก้โดยคน)</p>;
}
`;
const BROKEN = `export function Tool() {
  return <p>ผังกิจกรรม;
}
`;

const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1000, height: 900 }, reducedMotion: 'reduce' });
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(String(error)));

try {
  await page.goto(pathToFileURL(pages).href);
  await page.getByText('C3 — authoring panel').waitFor();

  const title = await page.getByTestId('package-title').innerText();
  const version = await page.getByTestId('package-version').innerText();
  if (!title.includes('ผังพื้นที่กิจกรรม')) fail('package header', title);
  if (!version.includes('v1')) fail('package version readback', version);
  mark('the panel opens on the package a person would edit', `${title} · ${version}`);

  const tabs = await page.locator('[role="tab"]').count();
  if (tabs !== 2) fail('one tab per source file', String(tabs));
  mark('both source files are reachable', `${tabs} files`);

  // A syntax error must be reported against the file and must not activate anything.
  await page.getByTestId('source-editor').fill(BROKEN);
  await page.getByTestId('validate').click();
  const problemsAfterBreak = await page.getByTestId('problems').innerText();
  if (!problemsAfterBreak.includes('ui/main.tsx')) fail('diagnostics name the file', problemsAfterBreak);
  await page.getByTestId('activate').click();
  await page.waitForTimeout(300);
  const statusAfterBreak = await page.getByTestId('status').innerText();
  if (statusAfterBreak.includes('เปิดใช้แล้ว')) fail('a broken source must not activate', statusAfterBreak);
  if (await page.getByTestId('activation-readback').count() !== 0) fail('no readback for a refused activation', 'readback present');
  const afterRefusal = await page.evaluate(() => globalThis.__AUTHORING__.activations.length);
  if (afterRefusal !== 0) fail('a refused source never reaches the pipeline', String(afterRefusal));
  mark('a syntax error is reported against its file and blocks activation without touching the pipeline', problemsAfterBreak.split('\n')[0]);

  // A fixed source activates through the real pipeline and returns a readback.
  await page.getByTestId('source-editor').fill(GOOD);
  await page.getByTestId('validate').click();
  const problemsAfterFix = await page.getByTestId('problems').innerText();
  if (problemsAfterFix.trim().length > 0) fail('a fixed source validates clean', problemsAfterFix);
  await page.getByTestId('activate').click();
  await page.getByTestId('activation-readback').waitFor();
  const readback = {
    version: await page.getByTestId('readback-version').innerText(),
    hash: await page.getByTestId('readback-hash').innerText(),
    generator: await page.getByTestId('readback-generator').innerText(),
    reviewer: await page.getByTestId('readback-reviewer').innerText(),
    requester: await page.getByTestId('readback-requester').innerText(),
    host: await page.getByTestId('host-readback').innerText(),
  };
  if (readback.generator !== 'human') fail('the human route is recorded', readback.generator);
  if (readback.reviewer !== 'manual') fail('the reviewer is recorded separately', readback.reviewer);
  if (!readback.host.includes('v1')) fail('the caller receives the activation', readback.host);
  mark('the edited source activates with a readback of version, hash, route and reviewer', JSON.stringify(readback));

  await page.screenshot({ path: join(output, '01-activated.png'), fullPage: true });

  // Editing again must produce a different content hash, i.e. the pipeline really used the new source.
  const firstHash = readback.hash;
  await page.getByTestId('source-editor').fill(GOOD.replace('แก้โดยคน', 'แก้รอบสอง'));
  await page.getByTestId('activate').click();
  await page.getByTestId('activation-readback').waitFor();
  const secondHash = await page.getByTestId('readback-hash').innerText();
  if (secondHash === firstHash) fail('a changed source must change the content hash', `${firstHash} vs ${secondHash}`);
  mark('a second edit produces a different content hash', `${firstHash} → ${secondHash}`);

  // Keyboard-only path for the same job.
  await page.getByTestId('source-editor').focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(GOOD.replace('แก้โดยคน', 'คีย์บอร์ด'));
  await page.getByTestId('activate').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const keyboardStatus = await page.getByTestId('status').innerText();
  if (!keyboardStatus.includes('เปิดใช้แล้ว')) fail('keyboard-only activation', keyboardStatus);
  mark('the same job is reachable by keyboard only');

  const activations = await page.evaluate(() => globalThis.__AUTHORING__.activations.map(entry => ({ ok: entry.ok, code: entry.ok ? null : entry.code })));
  const hashes = await page.evaluate(() => globalThis.__AUTHORING__.hashes.length);
  if (activations.length !== 3) fail('one pipeline run per activation attempt', JSON.stringify(activations));
  if (activations.some(entry => !entry.ok)) fail('every pipeline run activated', JSON.stringify(activations));
  if (hashes < 2) fail('distinct activations were recorded', String(hashes));
  mark('three activations, three pipeline runs, and the refused source never started one', JSON.stringify(activations));

  if (pageErrors.length > 0) fail('no uncaught page errors', pageErrors.join(' | '));
  mark('no uncaught page errors');

  // G1-01: the same panel drives the AI route when a generator is supplied; the record must say so.
  await page.goto(`${pathToFileURL(pages).href}?route=ai`);
  await page.getByTestId('package-title').waitFor();
  await page.getByTestId('activate').click();
  await page.getByTestId('activation-readback').waitFor();
  const aiGenerator = await page.getByTestId('readback-generator').innerText();
  if (aiGenerator !== 'ai') fail('the AI route is recorded', aiGenerator);
  const aiHost = await page.getByTestId('host-readback').innerText();
  if (!aiHost.includes('v1')) fail('the caller receives the AI activation', aiHost);
  mark('the same panel activates through the AI route (fixture generator) and records it', `route ${aiGenerator} · ${aiHost}`);

  await page.screenshot({ path: join(output, '02-second-edit.png'), fullPage: true });
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'PASS', node: process.version, checks, readback, activations }, null, 2));
  console.log(`\n${checks.length} checks passed`);
} catch (error) {
  await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(join(output, 'report.json'), JSON.stringify({ status: 'FAIL', node: process.version, checks, failure: String(error), pageErrors }, null, 2));
  console.error(`FAIL ${String(error)}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
