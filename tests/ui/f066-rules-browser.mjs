import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const systemBrowser = process.platform === 'win32'
  ? [
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] && join(process.env['PROGRAMFILES(X86)'], 'Microsoft/Edge/Application/msedge.exe'),
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Microsoft/Edge/Application/msedge.exe'),
  ].find((path) => path && existsSync(path))
  : undefined;
const browser = await chromium.launch({ headless: true, ...(systemBrowser ? { executablePath: systemBrowser } : {}) });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, deviceScaleFactor: 1 });
  const failures = [];
  page.on('pageerror', error => failures.push(error.message));
  await page.goto(pathToFileURL(resolve('tests/ui/f066-rules.html')).href);
  await page.getByRole('heading', { name: 'Weekend market' }).waitFor();
  await page.getByRole('heading', { name: 'Mark an order as paid' }).waitFor();
  await page.getByRole('heading', { name: 'Count orders' }).waitFor();
  await page.getByRole('heading', { name: 'Calculated results' }).waitFor();
  assert.match(await page.locator('.tt-table-rules__label').innerText(), /Rules in use/u);
  assert.match(await page.locator('.tt-compute-module__ports').innerText(), /Last changed by Alex/u);
  assert.match(await page.locator('.tt-compute-module__ports').innerText(), /Added by Alex/u);
  assert.match(await page.locator('.tt-linked-compute__result').innerText(), /Tea/u);
  assert.equal(await page.locator('.tt-compute-source pre').isVisible(), false, 'code starts folded under Advanced');
  await page.screenshot({ path: resolve('test-results/f066-rules-desktop.png'), fullPage: true });

  await page.getByText('Calculated fields · 3', { exact: true }).click();
  const ownedFormula = page.locator('.tt-table-program__group').filter({ has: page.getByRole('heading', { name: 'Double quantity' }) });
  await ownedFormula.locator('.tt-compute-advanced > summary').click();
  assert.match(await ownedFormula.innerText(), /quantity \* 2/u, 'program-owned formula is visible in Rules');
  await ownedFormula.getByRole('button', { name: 'Change this rule' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Change this rule');
  assert.match(await page.locator('.tt-table-chat-bar__reference').innerText(), /Double quantity/u, 'the Rules action selects the canonical formula for editing');

  const computedEditor = page.getByRole('region', { name: 'Computed columns for Orders' });
  await computedEditor.getByRole('button', { name: 'Computed columns (2)' }).click();
  const ruleOwnedReadOnly = computedEditor.getByRole('region', { name: 'Rule-owned formulas' });
  assert.match(await ruleOwnedReadOnly.innerText(), /Double quantity/u);
  assert.match(await ruleOwnedReadOnly.innerText(), /Rules card, then Calculated fields → Change this rule/u);
  assert.match(await ruleOwnedReadOnly.innerText(), /quantity \* 2/u);
  assert.equal(await ruleOwnedReadOnly.locator('input, button, textarea, select').count(), 0, 'program formulas expose no legacy edit controls');
  const legacyInputs = computedEditor.locator('.tt-table-computed__row input');
  assert.equal(await legacyInputs.count(), 2, 'only the legacy formula is in the editable draft list');
  assert.equal(await legacyInputs.nth(0).inputValue(), 'Legacy extra');
  assert.equal(await legacyInputs.nth(1).inputValue(), 'quantity + 1');
  await computedEditor.screenshot({ path: resolve('test-results/f066-computed-editor.png') });
  await legacyInputs.nth(0).fill('Legacy extra revised');
  await legacyInputs.nth(1).fill('quantity + 3');
  await computedEditor.getByRole('button', { name: 'Add row' }).click();
  await legacyInputs.nth(2).fill('New legacy calculation');
  await legacyInputs.nth(3).fill('quantity * 4');
  await computedEditor.getByRole('button', { name: 'Save computed columns' }).click();
  await computedEditor.getByRole('status').filter({ hasText: 'rejected' }).waitFor();
  const legacySave = await page.evaluate(() => window.__f066Commands?.findLast(({ type }) => type === 'table.setComputedColumns'));
  assert.deepEqual(legacySave, {
    type: 'table.setComputedColumns',
    payload: { columns: [
      { id: 'summary_calc1', collection: 'summary', label: 'Legacy summary extra', expression: { op: 'add', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 5 } } },
      { id: 'calc1', collection: 'orders', label: 'Legacy extra revised', expression: { op: 'add', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 3 } } },
      { id: 'calc2', collection: 'orders', label: 'New legacy calculation', expression: { op: 'multiply', left: { op: 'field', field: 'quantity' }, right: { op: 'literal', value: 4 } } },
    ] },
  }, 'legacy save preserves stable ids and other collections while excluding the canonical program formula');
  assert.equal(legacySave.payload.columns.some(({ id }) => id === 'double_quantity'), false, 'program-owned formula is never submitted to the legacy setter');
  await computedEditor.getByRole('button', { name: 'Close' }).click();

  const actionRule = page.locator('.tt-table-program__group').filter({ has: page.getByRole('heading', { name: 'Mark an order as paid' }) });
  await actionRule.getByRole('button', { name: 'Ask' }).click();
  const computeRule = page.locator('.tt-compute-module');
  await computeRule.getByRole('button', { name: 'Ask' }).click();
  assert.equal(await page.locator('.tt-table-chat-bar__reference-chip').count(), 3, 'selected action, calculation, and program formula remain available together');
  const promptBeforeEdit = await page.getByTestId('wire-prompt').innerText();
  assert.match(promptBeforeEdit, /\[\[table-rule:action:mark_paid\]\]/u);
  assert.match(promptBeforeEdit, /\[\[table-rule:compute:count_orders\]\]/u);

  await actionRule.getByRole('button', { name: 'Change this rule' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Message' }).inputValue(), 'Change this rule');
  assert.match(await page.locator('.tt-table-chat-bar__reference').innerText(), /Your message changes the selected rules/u);

  await computeRule.locator('.tt-compute-advanced > summary').click();
  assert.match(await computeRule.locator('.tt-compute-advanced').innerText(), /Profile tools: Python standard library, pandas 2\.3\.3/u);
  await page.locator('.tt-compute-source > summary').click();
  assert.match(await page.locator('.tt-compute-source pre').innerText(), /def run/u);
  await page.locator('.tt-compute-runtime-choice select').selectOption('javascript');
  await page.getByRole('button', { name: 'Ask to switch to JavaScript' }).click();
  assert.match(await page.getByRole('textbox', { name: 'Message' }).inputValue(), /Change Count orders to use JavaScript/u);

  const runButton = computeRule.getByRole('button', { name: 'Run calculation' });
  await runButton.click();
  await page.getByRole('alert').filter({ hasText: 'did not accept this run' }).waitFor();
  assert.equal(await page.evaluate(() => window.__f066Commands?.some(({ type, payload }) => type === 'table.compute.run' && payload.moduleId === 'count_orders')), true, 'run control sends the real command shape');
  assert.equal(await page.locator('.tt-compute-module__actions [role="status"]').filter({ hasText: 'Run requested' }).count(), 0, 'a rejected command never becomes a fake success');

  await page.getByTestId('toggle-role').click();
  assert.equal(await page.getByRole('button', { name: 'Change this rule' }).count(), 0, 'viewers see Ask without edit controls');
  assert.equal(await page.getByRole('button', { name: 'Run calculation' }).count(), 0, 'viewers cannot run calculations');
  assert.ok(await page.locator('.tt-compute-module__actions').innerText().then(text => text.includes('Ask a table editor to run')));
  await page.getByTestId('toggle-role').click();

  const importSection = page.getByRole('region', { name: 'Import rows into Orders' });
  await importSection.getByRole('button', { name: 'Import rows' }).click();
  await importSection.getByLabel('Or paste CSV').fill('item,quantity,paid\nTea,6,no\nJam,2,yes');
  await importSection.getByLabel(/Replace all 2 current rows/u).check();
  const replaceButton = importSection.getByRole('button', { name: 'Replace 2 rows with 2' });
  assert.equal(await replaceButton.isDisabled(), true, 'replace stays disabled until separately confirmed');
  await importSection.getByLabel(/Yes, replace all 2 existing rows/u).check();
  await replaceButton.click();
  await importSection.getByRole('status').filter({ hasText: 'Import failed' }).waitFor();
  const replaceCall = await page.evaluate(() => window.__f066Commands?.findLast(({ type }) => type === 'table.importRows'));
  assert.deepEqual(replaceCall, { type: 'table.importRows', payload: { collection: 'orders', mode: 'replace', rows: [{ item: 'Tea', quantity: 6, paid: false }, { item: 'Jam', quantity: 2, paid: true }] } });
  assert.equal(await page.getByRole('button', { name: 'Import rows' }).count(), 0, 'calculation-owned table does not expose direct import');
  assert.match(await page.getByRole('status').last().innerText(), /filled by a calculation/u);

  const widths = [];
  for (const width of [280, 320, 390, 414]) {
    await page.setViewportSize({ width, height: 844 });
    widths.push(await page.evaluate(() => ({
      viewport: window.innerWidth,
      document: document.documentElement.scrollWidth,
    })));
  }
  assert.ok(widths.every((item) => item.document <= item.viewport), `no page overflow at mobile widths: ${JSON.stringify(widths)}`);
  assert.deepEqual(failures, [], `browser console errors: ${failures.join('; ')}`);
  await page.goto(pathToFileURL(resolve('tests/ui/f066-rules.html')).href);
  await page.setViewportSize({ width: 414, height: 844 });
  await page.getByRole('heading', { name: 'Weekend market' }).waitFor();
  await page.screenshot({ path: resolve('test-results/f066-rules-mobile.png'), fullPage: true });
  console.log(JSON.stringify({ interactions: 'PASS', mobileWidths: widths, screenshots: ['test-results/f066-rules-desktop.png', 'test-results/f066-rules-mobile.png', 'test-results/f066-computed-editor.png'], noPageErrors: true }, null, 2));
} finally {
  await browser.close();
}
