// Offline/read-only preparation checks. This never runs hosted acceptance or marks a case PASS.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = join(root, 'docs/testing/f066-post-deploy');
const json = async name => JSON.parse(await readFile(join(base, name), 'utf8'));
const [catalog, template, expected, faults, guide] = await Promise.all([
  json('cases.json'), json('results-template.json'), json('expected.json'), json('controlled-faults.json'),
  readFile(join(base, 'README_TH.md'), 'utf8'),
]);
assert.equal(catalog.preparationOnly, true);
assert.equal(catalog.acceptanceExecuted, false);
assert.equal(catalog.cases.length, 48);
assert.equal(new Set(catalog.cases.map(c => c.id)).size, 48);
assert.equal(new Set(catalog.cases.map(c => c.group)).size, 8);
assert.equal(catalog.cases.filter(c => c.priority === 'P0').length, 12);
assert.equal(template.overallStatus, 'NOT_RUN');
assert.deepEqual(template.cases.map(c => c.id), catalog.cases.map(c => c.id));
const files = await readdir(join(base, 'fixtures'));
const rowsByFile = new Map();
for (const file of files) {
  assert.match(file, /^[a-z0-9-]+\.csv$/u);
  const content = await readFile(join(base, 'fixtures', file), 'utf8');
  assert.ok(Buffer.byteLength(content) <= 32 * 1024, `${file}: source file exceeds current file cap`);
  assert.ok(!content.includes('"'), 'The offline oracle parser supports these simple unquoted fixtures only.');
  const [headerLine, ...lines] = content.trimEnd().split(/\r?\n/u);
  const headers = headerLine.split(',');
  assert.ok(headers.length <= 12);
  assert.ok(lines.length <= 100);
  rowsByFile.set(file, lines.map(line => {
    const values = line.split(',');
    assert.equal(values.length, headers.length, `${file}: CSV row width`);
    return Object.fromEntries(headers.map((key, index) => [key, values[index]]));
  }));
}
const fixtureReferences = new Set();
const scopes = new Set(['hosted-ui', 'local-or-staging']);
for (const [index, c] of catalog.cases.entries()) {
  assert.equal(c.id, `F066-PD-${String(index + 1).padStart(3, '0')}`);
  assert.equal(c.status, 'NOT_RUN');
  assert.ok(scopes.has(c.scope));
  assert.ok(c.title && c.setup && c.steps.length >= 2 && c.assertions.length >= 2, `${c.id}: incomplete instructions`);
  assert.ok(c.runtimes.every(engine => ['javascript', 'python'].includes(engine)));
  assert.ok(guide.includes(`#### ${c.id} — ${c.title}`), `${c.id}: guide entry missing`);
  assert.ok(c.fixtures.length <= 4);
  let fixtureBytes = 0;
  for (const file of c.fixtures) {
    assert.ok(rowsByFile.has(file), `${c.id}: missing fixture ${file}`);
    fixtureReferences.add(file);
    fixtureBytes += Buffer.byteLength(await readFile(join(base, 'fixtures', file)));
  }
  assert.ok(fixtureBytes <= 64 * 1024, `${c.id}: exceeds current total source cap`);
  if (c.oracle) assert.notEqual(c.oracle.split('.').reduce((node, key) => node?.[key], expected), undefined, `${c.id}: missing oracle`);
  const result = template.cases[index];
  assert.equal(result.status, 'NOT_RUN');
  assert.equal(result.actual, null);
  assert.deepEqual(result.evidence, []);
  assert.equal(result.providerCallEvidence, null);
}
assert.deepEqual([...fixtureReferences].sort(), [...files].sort());
for (const variants of Object.values(faults.javascript)) assert.ok(typeof variants === 'string' && variants.length > 0);
assert.ok(faults.usage.includes('local/staging'));

let arithmeticChecks = 0;
function equal(actual, wanted) { assert.deepEqual(actual, wanted); arithmeticChecks += 1; }
function close(actual, wanted) { assert.ok(Math.abs(actual - wanted) <= expected.units.tolerance); arithmeticChecks += 1; }
function saleSummary(file) {
  const rows = rowsByFile.get(file);
  const byBranch = {};
  let satang = 0;
  let quantity = 0;
  for (const row of rows) {
    const count = Number(row.quantity);
    const amount = count * Math.round(Number(row.unit_price) * 100);
    assert.ok(Number.isFinite(count) && Number.isFinite(amount));
    satang += amount;
    quantity += count;
    byBranch[row.branch] = (byBranch[row.branch] ?? 0) + amount / 100;
  }
  return { gross: satang / 100, rows: rows.length, quantity, meanLineAmount: satang / 100 / rows.length, byBranch, discount10: Math.round(satang * 90 / 100) / 100, taxedAfterDiscount10: Math.round(Math.round(satang * 90 / 100) * 107 / 100) / 100 };
}
equal(saleSummary('sales-v1.csv'), expected.sales.initial);
equal(saleSummary('sales-v2.csv'), expected.sales.replaced);
equal(saleSummary('sales-v3.csv').gross, expected.sales.latest.gross);
equal(saleSummary('sales-v3.csv').rows, expected.sales.latest.rows);
equal(saleSummary('sales-v1.csv').gross + saleSummary('sales-append.csv').gross, expected.sales.appendedToInitial.gross);
equal(saleSummary('sales-v1.csv').rows + saleSummary('sales-append.csv').rows, expected.sales.appendedToInitial.rows);
equal(rowsByFile.get('sales-invalid.csv').some(row => !Number.isFinite(Number(row.quantity))), true);
equal(rowsByFile.get('sales-missing.csv')[0].quantity, '');
const seen = new Set();
equal(rowsByFile.get('transactions.csv').length, expected.clean.sourceRows);
const clean = rowsByFile.get('transactions.csv').filter(row => {
  if (seen.has(row.transaction_id)) return false;
  seen.add(row.transaction_id);
  return row.status.trim().toLowerCase() === 'paid';
});
const branch = {};
for (const row of clean) {
  const label = row.branch.trim().toLowerCase() === 'north' ? 'North' : 'South';
  branch[label] = (branch[label] ?? 0) + Number(row.quantity) * Number(row.unit_price);
}
equal(clean.length, expected.clean.keptRows);
equal(branch, expected.clean.byBranch);
equal(Object.values(branch).reduce((a, b) => a + b, 0), expected.clean.gross);
equal(Object.keys(branch).sort((a, b) => branch[b] - branch[a]), expected.clean.sortedBranches);
for (const [key, value] of Object.entries(branch)) equal(Math.round(value * 10000 / expected.clean.gross) / 100, expected.clean.percent[key]);
for (const [file, result] of [['scores-v1.csv', expected.game.initialTopTwo], ['scores-v2.csv', expected.game.replacedTopTwo]]) {
  equal(rowsByFile.get(file).map(row => Number(row.score)).sort((a, b) => b - a).slice(0, 2).reduce((a, b) => a + b, 0), result);
}
const vector = rowsByFile.get('vector.csv').map(row => Number(row.value));
const sum = vector.reduce((a, b) => a + b, 0);
const mean = sum / vector.length;
const variance = vector.reduce((total, value) => total + (value - mean) ** 2, 0) / vector.length;
equal(vector.length, expected.numpy.count); equal(sum, expected.numpy.sum); equal(mean, expected.numpy.mean);
equal(variance, expected.numpy.populationVariance); close(Math.sqrt(variance), expected.numpy.populationStd);
const stats = rowsByFile.get('statistics.csv').map(row => ({ x: Number(row.x), y: Number(row.y) }));
const mx = stats.reduce((a, p) => a + p.x, 0) / stats.length;
const my = stats.reduce((a, p) => a + p.y, 0) / stats.length;
const slope = stats.reduce((a, p) => a + (p.x - mx) * (p.y - my), 0) / stats.reduce((a, p) => a + (p.x - mx) ** 2, 0);
const intercept = my - slope * mx;
equal(slope, expected.scipy.slope); equal(intercept, expected.scipy.intercept); equal(slope * 5 + intercept, expected.scipy.predictionAt5);
const prices = new Map(rowsByFile.get('products.csv').map(row => [row.product_id, Number(row.unit_price)]));
const lineTotals = rowsByFile.get('orders.csv').map(row => prices.get(row.product_id) * Number(row.quantity));
equal(lineTotals, expected.joined.lines); equal(lineTotals.reduce((a, b) => a + b, 0), expected.joined.gross);
for (const [file, dates, span] of [['dates-v1.csv', expected.dates.initial, expected.dates.initialSpanDays], ['dates-v2.csv', expected.dates.replaced, expected.dates.replacedSpanDays]]) {
  const actual = rowsByFile.get(file).map(row => {
    const value = row.date_text;
    if (/^\d{4}-\d{2}-\d{2}$/u.test(value)) return value;
    const parts = value.includes('/') ? value.split('/').reverse() : [value.split(' ')[2], '10', value.split(' ')[0]];
    return parts.map((part, index) => index === 0 ? part : part.padStart(2, '0')).join('-');
  });
  equal(actual, dates);
  equal((Date.parse(actual.at(-1)) - Date.parse(actual[0])) / 86400000, span);
}
equal(expected.legacy.invoiceRows.reduce((a, b) => a + b, 0), expected.legacy.invoiceTotal);
equal(0.5 * (10 / 5) * 2 ** 2, expected.legacy.teachingSharedPosition);
equal(0.5 * (10 / 2) * 2 ** 2, expected.legacy.teachingLocalPosition);
equal(10 - (4 - 2), expected.legacy.encounterHp);
equal(2 - 1, expected.legacy.encounterApAfterShield);
equal([3, 3 + 5], expected.legacy.cafeMinutes);
equal(expected.legacy.waterRemaining + expected.legacy.waterDelivered, 100);
console.log(JSON.stringify({ check: 'f066-post-deploy-pack', caseDefinitions: catalog.cases.length, fixtureFiles: files.length, goldenArithmeticChecks: arithmeticChecks, resultTemplate: '48 NOT_RUN', acceptanceExecuted: false, networkRequests: 0 }, null, 2));
