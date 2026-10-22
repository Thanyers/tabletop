// Focused local acceptance: owner-created invoice rows survive a later additive edit.
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';

const POLL_MS = 500;
const POLL_TIMEOUT_MS = 45_000;
const VIEWPORTS = [320, 414, 1440];

export async function runCanvasEvolutionBrowser({ origin, actors, workspaceId, programTitle, output, real }) {
  const report = {
    status: 'RUNNING',
    runtime: 'disposable local Worker, D1, and SQLite Durable Objects',
    provider: real ? 'real DeepSeek, bounded by local fixture' : 'synthetic DeepSeek response fixture',
    accounts: 'two synthetic browser contexts; Google OAuth not tested',
    checks: [],
    responsive: [],
    errors: [],
  };
  const mark = label => { report.checks.push(label); console.log(`PASS ${label}`); };
  const contexts = [];
  let draftRequests = 0;
  const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL || 'msedge', headless: true });
  const saveReport = () => writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));

  async function pageFor(actor) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' });
    contexts.push(context);
    await context.addCookies([{ name: 'tabletop_local_session', value: actor.token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    await page.goto(`${origin}/t/${workspaceId}`);
    await expect(page.getByRole('button', { name: programTitle })).toBeVisible();
    await expect(page.getByTestId('table-chat-bar')).toBeVisible();
    return page;
  }

  async function read(page) {
    return page.evaluate(async id => {
      const response = await fetch(`/api/workspaces/${id}`);
      if (!response.ok) throw Error(`Workspace readback failed (${response.status}).`);
      return response.json();
    }, workspaceId);
  }

  async function openObject(page, id) {
    const editor = page.getByTestId('canvas-object-editor');
    const menu = page.getByTestId('canvas-object-menu-trigger');
    if (await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
    await page.getByTestId(`open-canvas-${id}`).click();
    await expect(editor).toHaveAttribute('data-canvas-object', id);
    await expect(editor).toBeVisible();
    await expect.poll(() => editor.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= window.innerWidth && rect.top >= 0 && rect.bottom <= window.innerHeight;
    })).toBe(true);
    return editor;
  }

  async function requestChange(page, prompt) {
    const before = await read(page);
    const bar = page.getByTestId('table-chat-bar');
    const composer = bar.getByRole('textbox', { name: 'Message', exact: true });
    await composer.fill(prompt);
    const responsePromise = page.waitForResponse(response => response.url().endsWith(`/api/workspaces/${workspaceId}/model`) && response.request().method() === 'POST');
    await bar.getByRole('button', { name: 'Send message', exact: true }).click();
    const consent = page.getByRole('alertdialog', { name: 'Send to AI', exact: true });
    if (draftRequests === 0) {
      await expect(consent).toBeVisible();
      await consent.getByRole('button', { name: 'Send', exact: true }).click();
    } else await expect(consent).toHaveCount(0);
    const accepted = await responsePromise;
    expect(accepted.status()).toBe(202);
    expect(accepted.request().postDataJSON().consent).toBe(true);
    draftRequests += 1;
    const acceptedJob = await accepted.json();
    await expect.poll(() => page.evaluate(async ({ workspaceId: roomId, id }) => {
      const response = await fetch(`/api/workspaces/${roomId}/model/${id}`);
      return response.json();
    }, { workspaceId, id: acceptedJob.id }), { timeout: POLL_TIMEOUT_MS, intervals: [POLL_MS, 1000] }).toMatchObject({ status: 'completed', autoApply: 'applied' });
    // F039: the Room runs every review check and puts the asker's draft into use on its own.
    await expect.poll(async () => (await read(page)).domain.candidate?.status, { timeout: 10_000 }).toBe('active');
    const applied = await read(page);
    expect(applied.domain.ruleRevision).toBe(before.domain.ruleRevision + 1);
    return { applied, before };
  }

  async function viewAppliedChange(page, expectedRuleRevision) {
    const editor = await openObject(page, 'table.rules');
    await expect(editor.getByRole('region', { name: 'Current active rules', exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(editor.getByRole('button', { name: 'Apply to table', exact: true })).toHaveCount(0);
    const current = await read(page);
    expect(current.domain.candidate?.status).toBe('active');
    expect(current.domain.ruleRevision).toBe(expectedRuleRevision);
    return current;
  }

  function descriptorParts(program) {
    const actions = program.actions.filter(action => (action.creates ?? []).some(create => create.collection === 'invoices'));
    const createAction = actions.find(action => action.parameters.length > 0);
    const sampleAction = actions.find(action => action.parameters.length === 0);
    if (!createAction || !sampleAction) throw Error('The proposal must include an invoice form action and a no-input sample action.');
    const controlsView = program.canvas?.views.find(view => view.kind === 'controls'
      && view.controls.some(control => control.kind === 'form' && control.actionId === createAction.id)
      && view.controls.some(control => control.kind === 'button' && control.actionId === sampleAction.id));
    if (!controlsView) throw Error('The proposal must bind both the invoice form and sample button to generated controls.');
    return {
      createAction,
      sampleAction,
      view: controlsView,
      form: controlsView.controls.find(control => control.kind === 'form' && control.actionId === createAction.id),
      button: controlsView.controls.find(control => control.kind === 'button' && control.actionId === sampleAction.id),
    };
  }

  function submittedInput(parameter, ordinal) {
    if (parameter.type === 'text') return parameter.choices?.[0] ?? `F010-${parameter.id}`;
    if (parameter.type === 'number') {
      const preferred = 650 + ordinal;
      return Math.max(parameter.min ?? 0, Math.min(preferred, parameter.max ?? preferred));
    }
    if (parameter.type === 'boolean') return false;
    throw Error(`Unsupported generated form parameter type: ${parameter.type}`);
  }

  async function waitForTableAction(page) {
    const response = await page.waitForResponse(candidate => {
      if (!candidate.url().endsWith('/commands') || candidate.request().method() !== 'POST') return false;
      try { return candidate.request().postDataJSON()?.type === 'table.act'; } catch { return false; }
    });
    expect(response.status()).toBe(200);
    return response;
  }

  try {
    const ownerPage = await pageFor(actors.find(actor => actor.role === 'owner'));
    let current = await read(ownerPage);
    expect(current.domain.program.actions.map(action => action.id)).toEqual(['mark_paid', 'mark_unpaid']);
    expect(current.domain.records.invoices).toEqual([]);
    mark('starts from an active empty invoice table with only mark/unmark-paid actions');

    const firstPrompt = 'Add a usable invoice form with customer and amount inputs, plus a no-input Add sample button that inserts one fictional invoice. Keep the existing mark paid and mark unpaid actions.';
    const draft = await requestChange(ownerPage, firstPrompt);
    expect(draft.applied.domain.candidate.change.initialRecords).toEqual({});
    current = await viewAppliedChange(ownerPage, draft.before.domain.ruleRevision + 1);
    const generated = descriptorParts(current.domain.program);
    expect(current.domain.records.invoices).toEqual([]);
    mark('owner applies a create action, zero-row form, and sample-data button');

    const controls = await openObject(ownerPage, `table.view.${generated.view.id}`);
    const form = controls.locator('.tt-generated-control__form').filter({ hasText: generated.form.label });
    await expect(form).toBeVisible();
    const inputs = {};
    for (const [index, parameter] of generated.createAction.parameters.entries()) {
      const binding = generated.form.inputs[parameter.id];
      if (binding?.kind === 'control') {
        const value = submittedInput(parameter, index);
        inputs[parameter.id] = value;
        const field = form.getByLabel(parameter.label, { exact: true });
        if (parameter.type === 'boolean') await field.setChecked(Boolean(value));
        else await field.fill(String(value));
      } else if (binding?.kind === 'literal') inputs[parameter.id] = binding.value;
      else throw Error(`Form parameter ${parameter.id} is not bound to a usable entry control.`);
    }
    const invalidInputs = await form.locator('input').evaluateAll(inputs => inputs.filter(input => !input.validity.valid).map(input => ({ type: input.type, value: input.value, min: input.min, step: input.step, stepMismatch: input.validity.stepMismatch })));
    expect(invalidInputs, 'Native form inputs must accept values within their declared bounds').toEqual([]);
    const formAction = waitForTableAction(ownerPage);
    await form.getByRole('button', { name: generated.form.label, exact: true }).click();
    await formAction;
    current = await read(ownerPage);
    expect(current.domain.records.invoices).toHaveLength(1);
    const created = current.domain.records.invoices[0];
    expect(created.id).toMatch(/^record_[0-9]+_[0-9]{2}_[a-z0-9_-]+$/u);
    const createDescriptor = generated.createAction.creates.find(create => create.collection === 'invoices');
    for (const [field, operand] of Object.entries(createDescriptor.values)) {
      if (operand.input) expect(created.values[field]).toEqual(inputs[operand.input]);
      else if (Object.hasOwn(operand, 'literal')) expect(created.values[field]).toEqual(operand.literal);
    }
    mark('zero-row form inputs create a validated host-ID invoice through the Canvas');

    const sampleCreate = generated.sampleAction.creates.find(create => create.collection === 'invoices');
    const sampleButton = controls.getByRole('button', { name: generated.button.label, exact: true });
    const sampleActionResponse = waitForTableAction(ownerPage);
    await sampleButton.click();
    await sampleActionResponse;
    current = await read(ownerPage);
    expect(current.domain.records.invoices).toHaveLength(2);
    const sample = current.domain.records.invoices.find(row => row.id !== created.id);
    expect(sample).toBeTruthy();
    for (const [field, operand] of Object.entries(sampleCreate.values)) {
      if (operand.input) throw Error('The no-input sample action must use literal values.');
      if (Object.hasOwn(operand, 'literal')) expect(sample.values[field]).toEqual(operand.literal);
    }
    mark('sample button creates one fictional invoice from literal data');

    const markPaid = current.domain.program.actions.find(action => action.effects.some(effect => effect.field === 'paid'
      && effect.op === 'set' && Object.hasOwn(effect.value, 'literal') && effect.value.literal === true));
    if (!markPaid) throw Error('The active program lost its mark-paid action.');
    const invoiceTable = await openObject(ownerPage, 'table.collection.invoices');
    const gridOverflow = await invoiceTable.locator('.tt-table-grid-scroll').evaluate(element => element.scrollWidth - element.clientWidth);
    expect(gridOverflow, 'Three invoice fields should fit the opened table without a forced 720px floor').toBeLessThanOrEqual(1);
    const createdRow = invoiceTable.locator('tbody tr').filter({ hasText: String(created.values.customer) });
    await expect(createdRow).toBeVisible();
    await createdRow.getByRole('button', { name: /Select/u }).click();
    const rowActions = invoiceTable.locator('.tt-table-record-actions');
    await expect(rowActions).toBeVisible();
    await rowActions.getByRole('combobox').first().selectOption(markPaid.id);
    const paidActionResponse = waitForTableAction(ownerPage);
    await invoiceTable.getByRole('button', { name: markPaid.title, exact: true }).click();
    await paidActionResponse;
    current = await read(ownerPage);
    expect(current.domain.records.invoices.find(row => row.id === created.id)?.values.paid).toBe(true);
    mark('owner marks the newly added invoice paid through the shared action control');

    const recordsBeforeEdit = structuredClone(current.domain.records.invoices);
    const secondPrompt = 'Add a summary card showing the total unpaid amount. Add a review_notes collection with a required text field label defaulting to Pending review, and add a required invoices field reference defaulting to LOCAL. Preserve the current invoice rows, form, sample button, and payment actions.';
    const secondDraft = await requestChange(ownerPage, secondPrompt);
    expect(secondDraft.applied.domain.candidate.change.initialRecords).toEqual({});
    current = await viewAppliedChange(ownerPage, secondDraft.before.domain.ruleRevision + 1);
    expect(current.domain.records.invoices.map(row => row.id)).toEqual(recordsBeforeEdit.map(row => row.id));
    expect(current.domain.records.invoices.map(row => row.values.paid)).toEqual(recordsBeforeEdit.map(row => row.values.paid));
    expect(current.domain.records.invoices.every(row => row.values.reference === 'LOCAL')).toBe(true);
    expect(current.domain.records.review_notes).toEqual([]);
    expect(current.domain.program.collections.find(collection => collection.id === 'review_notes')?.fields)
      .toContainEqual(expect.objectContaining({ id: 'label', default: 'Pending review' }));
    const summary = current.domain.program.canvas?.views.find(view => view.kind === 'metric' && /unpaid/i.test(view.title));
    expect(summary).toBeTruthy();
    expect(descriptorParts(current.domain.program).view.id).toBe(generated.view.id);
    mark('additive summary and default fields apply while preserving both invoice rows and generated form descriptors');

    const summaryEditor = await openObject(ownerPage, `table.view.${summary.id}`);
    const unpaidTotal = summaryEditor.locator('.tt-generated-metric');
    await expect(unpaidTotal).toBeVisible();
    const expectedUnpaid = current.domain.records.invoices.filter(row => row.values.paid === false)
      .reduce((sum, row) => sum + Number(row.values.amount), 0);
    const renderedTotal = Number((await unpaidTotal.innerText()).replaceAll(',', ''));
    expect(renderedTotal).toBe(expectedUnpaid);
    mark('summary card renders the computed unpaid total from active shared records');

    await ownerPage.reload();
    await expect(ownerPage.getByRole('button', { name: programTitle })).toBeVisible();
    await expect.poll(async () => (await read(ownerPage)).domain.records.invoices.map(row => row.values.reference), { timeout: 10_000 }).toEqual(['LOCAL', 'LOCAL']);
    current = await read(ownerPage);
    expect(current.domain.records.invoices.map(row => row.id)).toEqual(recordsBeforeEdit.map(row => row.id));
    expect(current.domain.records.invoices.find(row => row.id === created.id)?.values.paid).toBe(true);
    mark('reload restores the applied rows, payment status, and additive defaults');

    const generatedAfterReload = descriptorParts(current.domain.program);
    await openObject(ownerPage, `table.view.${generatedAfterReload.view.id}`);
    await expect(ownerPage.locator('.tt-generated-control__form').filter({ hasText: generatedAfterReload.form.label })).toBeVisible();
    for (const width of VIEWPORTS) {
      await ownerPage.setViewportSize({ width, height: 960 });
      const editor = await openObject(ownerPage, `table.view.${generatedAfterReload.view.id}`);
      const formView = editor.locator('.tt-generated-control__form').filter({ hasText: generatedAfterReload.form.label });
      await expect(formView).toBeVisible();
      const measurement = await ownerPage.evaluate(() => {
        const measure = selector => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return {
            x: Number(rect.x.toFixed(1)), width: Number(rect.width.toFixed(1)),
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth,
            paddingLeft: style.paddingLeft, paddingRight: style.paddingRight,
            overflowX: style.overflowX,
          };
        };
        const form = measure('.tt-generated-control__form');
        const chat = measure('.tt-table-chat-bar__box');
        const panel = measure('.tt-table-chat-bar');
        return {
          viewportWidth: window.innerWidth,
          documentScrollWidth: document.documentElement.scrollWidth,
          bodyScrollWidth: document.body.scrollWidth,
          form, chat, panel,
        };
      });
      expect(measurement.viewportWidth).toBe(width);
      expect(measurement.documentScrollWidth).toBeLessThanOrEqual(width);
      expect(measurement.bodyScrollWidth).toBeLessThanOrEqual(width);
      expect(measurement.form).not.toBeNull();
      expect(measurement.form.x).toBeGreaterThanOrEqual(0);
      expect(measurement.form.x + measurement.form.width).toBeLessThanOrEqual(width);
      expect(measurement.form.scrollWidth).toBeLessThanOrEqual(measurement.form.clientWidth + 1);
      expect(measurement.chat).not.toBeNull();
      expect(measurement.chat.scrollWidth).toBeLessThanOrEqual(measurement.chat.clientWidth + 1);
      await ownerPage.screenshot({ path: resolve(output, `canvas-evolution-${width}.png`), fullPage: false });
      report.responsive.push(measurement);
    }
    mark('rendered form and chat fit at 320px, 414px, and desktop widths; measurements and screenshots saved');

    const memberPage = await pageFor(actors.find(actor => actor.role === 'member'));
    let memberModelRequest = false;
    memberPage.on('request', request => {
      if (request.method() === 'POST' && request.url().endsWith(`/api/workspaces/${workspaceId}/model`)) memberModelRequest = true;
    });
    const memberBar = memberPage.getByTestId('table-chat-bar');
    await memberBar.getByRole('textbox', { name: 'Message', exact: true }).fill('Add a new invoice form to this table.');
    await memberBar.getByRole('button', { name: 'Send message', exact: true }).click();
    const memberConsent = memberPage.getByRole('alertdialog', { name: 'Send to AI', exact: true });
    await expect(memberConsent).toBeVisible();
    const assistantResponse = memberPage.waitForResponse(response => response.url().endsWith(`/api/workspaces/${workspaceId}/assistant`) && response.request().method() === 'POST');
    await memberConsent.getByRole('button', { name: 'Send', exact: true }).click();
    const assistantAccepted = await assistantResponse;
    expect(assistantAccepted.status()).toBe(202);
    const assistantJob = await assistantAccepted.json();
    await expect.poll(() => memberPage.evaluate(async ({ workspaceId: roomId, id }) => {
      const response = await fetch(`/api/workspaces/${roomId}/assistant/${id}`);
      return response.json();
    }, { workspaceId, id: assistantJob.id }), { timeout: POLL_TIMEOUT_MS, intervals: [POLL_MS, 1000] }).toMatchObject({ status: 'completed', result: { kind: 'explanation' } });
    const answer = memberPage.getByTestId('table-chat-answer');
    await expect(answer).toBeVisible();
    report.answerCard = await answer.evaluate(element => ({ paddingLeft: parseFloat(getComputedStyle(element).paddingLeft), paddingTop: parseFloat(getComputedStyle(element).paddingTop), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
    expect(report.answerCard.paddingLeft).toBeGreaterThanOrEqual(12);
    expect(report.answerCard.paddingTop).toBeGreaterThanOrEqual(12);
    expect(report.answerCard.scrollWidth).toBeLessThanOrEqual(report.answerCard.clientWidth + 1);
    expect(memberModelRequest).toBe(false);
    await expect(memberPage.getByRole('button', { name: 'Apply to table', exact: true })).toHaveCount(0);
    mark('participant chat stays conversational and never opens the table builder');

    expect(report.errors).toEqual([]);
    report.status = 'PASS';
    return report;
  } catch (error) {
    report.status = 'FAIL';
    report.error = error instanceof Error ? error.message : 'Canvas evolution browser acceptance failed.';
    const page = contexts[0]?.pages()[0];
    if (page) {
      await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: false }).catch(() => undefined);
      report.editorAtFailure = await page.getByTestId('canvas-object-editor').evaluateAll(elements => elements.map(element => ({ object: element.getAttribute('data-canvas-object'), text: element.textContent?.slice(0, 2500) }))).catch(() => []);
    }
    throw error;
  } finally {
    await saveReport();
    for (const context of contexts) await context.close();
    await browser.close();
  }
}
