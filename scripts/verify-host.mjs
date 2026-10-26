#!/usr/bin/env node
/**
 * F080 host verification: what an unauthenticated client can prove about a deployed environment.
 *
 *   node scripts/verify-host.mjs --url https://<host>
 *
 * It never signs in and never writes. Each line is one claim with PASS / FAIL / SKIPPED, so a hosted
 * report can quote real statuses instead of guessing. Checks that need a session are reported SKIPPED
 * (never PASS) because this script cannot prove them.
 */

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const base = urlIndex >= 0 ? args[urlIndex + 1] : process.env.STAGING_URL ?? '';
if (!base) {
  console.error('usage: node scripts/verify-host.mjs --url https://<host>');
  process.exit(2);
}

const root = base.replace(/\/+$/u, '');
const unknownRoom = '11111111-1111-4111-8111-111111111111';
const rows = [];

async function fetchStatus(path, init = {}) {
  try {
    const response = await fetch(root + path, { redirect: 'manual', ...init, signal: AbortSignal.timeout(15_000) });
    return { status: response.status, type: response.headers.get('content-type') ?? '', body: await response.text() };
  } catch (error) {
    return { status: 0, type: '', body: String(error) };
  }
}

function record(name, outcome, detail) {
  rows.push({ name, outcome, detail });
}

// 1. the Worker answers at all
const health = await fetchStatus('/healthz');
record('worker answers /healthz', health.status === 200 ? 'PASS' : 'FAIL', `status ${health.status}`);
if (health.status === 200) {
  let parsed = null;
  try { parsed = JSON.parse(health.body); } catch { parsed = null; }
  record('health body is json', parsed ? 'PASS' : 'FAIL', parsed ? 'parsed' : 'not json');
}

// 2. the deployed revision is reported (not guessed from chat)
const version = await fetchStatus('/version');
let sha = 'unknown';
if (version.status === 200) {
  try { sha = String(JSON.parse(version.body).sha ?? 'unknown'); } catch { sha = 'unknown'; }
}
record('reports the deployed revision', sha !== 'unknown' ? 'PASS' : 'FAIL', `sha ${sha}`);

// 3. the app shell is served, and client routes reach it (the room route included)
const shell = await fetchStatus('/');
record('serves the app shell at /', shell.status === 200 && shell.type.includes('text/html') ? 'PASS' : 'FAIL', `${shell.status} ${shell.type}`);
const room = await fetchStatus(`/s/${unknownRoom}`);
record('serves the room route /s/:id', room.status === 200 && room.type.includes('text/html') ? 'PASS' : 'FAIL', `${room.status} ${room.type}`);

// 4. the new API routes exist and fail closed without a session (401, not 404)
for (const path of [
  `/api/workspaces/${unknownRoom}`,
  `/api/workspaces/${unknownRoom}/space/recap`,
  `/api/workspaces/${unknownRoom}/space/export?source=${unknownRoom}&grant=g&port=p`,
  '/api/session',
]) {
  const response = await fetchStatus(path);
  const label = `refuses ${path} without a session`;
  record(label, response.status === 401 ? 'PASS' : response.status === 404 ? 'FAIL' : 'FAIL', `status ${response.status}`);
}

// 5. what this script cannot prove
record('a signed-in member reaches the room and its joined data', 'SKIPPED', 'needs a session');
record('revoke/export/action behave on this host', 'SKIPPED', 'needs a session');

const passed = rows.filter(row => row.outcome === 'PASS').length;
const failed = rows.filter(row => row.outcome === 'FAIL').length;
const skipped = rows.filter(row => row.outcome === 'SKIPPED').length;
for (const row of rows) console.log(`${row.outcome.padEnd(7)} ${row.name} - ${row.detail}`);
console.log(`\nhost ${root} · sha ${sha} · ${passed} PASS / ${failed} FAIL / ${skipped} SKIPPED`);
process.exitCode = failed === 0 ? 0 : 1;
