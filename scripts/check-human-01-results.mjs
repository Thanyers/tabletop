#!/usr/bin/env node
/**
 * F080 / HUMAN-01: check a human-study result file before it is recorded as evidence.
 *
 *   node scripts/check-human-01-results.mjs <results.csv>
 *
 * The CSV comes from docs/features/F080-custom-tools-joined-tables/human-01-kit/form.html. This script
 * refuses to call a study passed unless the file itself shows five participants, a three-day gap, and
 * four participants who answered all three questions and started the next step within 30 seconds.
 */

import { readFileSync } from 'node:fs';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/check-human-01-results.mjs <results.csv>');
  console.error('');
  console.error('The template lives at:');
  console.error('  docs/features/F080-custom-tools-joined-tables/human-01-kit/results-template.csv');
  process.exit(2);
}

let raw;
try {
  raw = readFileSync(path, 'utf8');
} catch (error) {
  // The person running the study should not have to read a stack trace to learn a path is wrong.
  if (error && error.code === 'ENOENT') {
    console.error(`no results file at ${path}`);
    console.error('');
    console.error('Copy the template first, then fill it in during the sessions:');
    console.error('  copy docs\\features\\F080-custom-tools-joined-tables\\human-01-kit\\results-template.csv <your-file>.csv');
    process.exit(2);
  }
  throw error;
}

const lines = raw.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter(line => line.trim().length > 0);
const meta = {};
const rows = [];
let headerSeen = false;

for (const line of lines) {
  const cells = line.split(',').map(cell => cell.trim());
  if (cells[0] === 'start_date') { meta.start = cells[1]; continue; }
  if (cells[0] === 'repeat_date') { meta.repeat = cells[1]; continue; }
  if (!headerSeen) { headerSeen = cells[0] === 'participant'; continue; }
  rows.push({
    participant: Number(cells[0]),
    q1: cells[1],
    q2: cells[2],
    q3: cells[3],
    seconds: Number(cells[4]),
    pass: cells[5],
  });
}

const checks = [];
const check = (name, ok, detail) => {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

check('the file names both dates', Boolean(meta.start && meta.repeat), `${meta.start || 'missing'} → ${meta.repeat || 'missing'}`);
const gapDays = meta.start && meta.repeat
  ? Math.round((Date.parse(meta.repeat) - Date.parse(meta.start)) / 86_400_000)
  : Number.NaN;
check('the study waited at least three days', Number.isFinite(gapDays) && gapDays >= 3, Number.isFinite(gapDays) ? `${gapDays} days` : 'not computable');

check('five participants were recorded', rows.length === 5, `${rows.length} rows`);
check('every row has a real Q4 duration', rows.every(row => Number.isFinite(row.seconds) && row.seconds > 0), rows.map(row => row.seconds).join(', '));

for (const row of rows) {
  const answered = row.q1 === 'yes' && row.q2 === 'yes' && row.q3 === 'yes';
  const fastEnough = Number.isFinite(row.seconds) && row.seconds <= 30;
  const expected = answered && fastEnough ? 'yes' : 'no';
  if (row.pass !== expected) {
    check(`participant ${row.participant} is scored honestly`, false, `recorded ${row.pass}, the answers imply ${expected}`);
  }
}

const passedCount = rows.filter(row => row.pass === 'yes' && row.q1 === 'yes' && row.q2 === 'yes' && row.q3 === 'yes' && row.seconds <= 30).length;
check('at least four participants passed', passedCount >= 4, `${passedCount} of ${rows.length}`);

const failed = checks.filter(entry => !entry.ok).length;
console.log(`\n${checks.length - failed} passed · ${failed} failed`);
if (failed > 0) {
  console.error('HUMAN-01 cannot be recorded as PASS from this file.');
  process.exitCode = 1;
}
