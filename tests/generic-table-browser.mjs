import { expect } from '@playwright/test';

const equipmentPolicy = 'Borrow only an available equipment item and add a completion note. Only the member who borrowed it may return it.';
const shiftPolicy = 'Swap two different people only when both can work the new slot.';
const gamePolicy = 'On your turn, move your own boat forward by two points and pass the turn.';
const equipmentNotes = {
  filename: 'equipment-recording-notes.md',
  text: '# Equipment recording notes\nKeep a short completion note with each equipment reservation.\n',
};

const fixtures = {
  equipment: {
    filename: 'community-equipment.md',
    text: `# Community equipment\n${equipmentPolicy}\n\nItems: camera (Field camera), tripod (Tripod).\n`,
    quote: equipmentPolicy,
  },
  shifts: {
    filename: 'team-shifts.json',
    text: JSON.stringify({ policy: shiftPolicy, people: [
      { id: 'ada', name: 'Ada', seat: 'host', slot: 'morning', available: ['morning', 'evening'] },
      { id: 'bo', name: 'Bo', seat: 'member-1', slot: 'evening', available: ['morning', 'evening'] },
      { id: 'cy', name: 'Cy', seat: 'member-2', slot: 'night', available: ['night'] },
    ] }),
    quote: shiftPolicy,
  },
  game: {
    filename: 'river-race.txt',
    text: `River Race\n${gamePolicy}\nStart red (owner) and blue (Member 1) at zero. Keep every score from 0 to 20.\n`,
    quote: gamePolicy,
  },
};

const literal = (value) => ({ literal: value });
const record = (parameter, field) => ({ record: parameter, field });
const baseProgram = (title, sourceId, quote) => ({
  version: 1,
  title,
  description: title,
  collections: [],
  actions: [],
  invariants: [],
  turnOrder: [],
  evidence: [{ sourceId, quote }],
  assumptions: [],
});

function buildChange(kind, sourceId) {
  const source = fixtures[kind];
  if (kind === 'equipment') {
    const program = baseProgram('Community equipment', sourceId, source.quote);
    program.collections = [{ id: 'equipment', title: 'Equipment', fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'borrower', label: 'Borrower', type: 'text', required: false },
      { id: 'available', label: 'Available', type: 'boolean', required: true },
      { id: 'borrow_note', label: 'Completion note', type: 'text', required: false },
    ] }];
    const itemParameter = { id: 'item', label: 'Item', type: 'record', collection: 'equipment' };
    const completionNoteParameter = { id: 'note', label: 'Completion note', type: 'text' };
    program.actions = [
      { id: 'borrow', title: 'Borrow equipment', description: 'Reserve one available item for yourself.', roles: ['owner', 'participant'], parameters: [itemParameter, completionNoteParameter], conditions: [
        { left: record('item', 'available'), op: 'eq', right: literal(true), message: 'This item is already reserved.' },
      ], effects: [
        { record: 'item', field: 'available', op: 'set', value: literal(false) },
        { record: 'item', field: 'borrower', op: 'set', value: { system: 'actor' } },
        { record: 'item', field: 'borrow_note', op: 'set', value: { input: 'note' } },
      ], requireTurn: false, advanceTurn: false },
      { id: 'return', title: 'Return equipment', description: 'Only the borrower can return an item.', roles: ['owner', 'participant'], parameters: [itemParameter], conditions: [
        { left: record('item', 'borrower'), op: 'eq', right: { system: 'actor' }, message: 'Only the borrower may return this item.' },
      ], effects: [
        { record: 'item', field: 'available', op: 'set', value: literal(true) },
        { record: 'item', field: 'borrower', op: 'set', value: literal(null) },
        { record: 'item', field: 'borrow_note', op: 'set', value: literal(null) },
      ], requireTurn: false, advanceTurn: false },
    ];
    return { kind: 'table', program, initialRecords: { equipment: [
      { id: 'camera', values: { name: 'Field camera', borrower: null, available: true, borrow_note: null } },
      { id: 'tripod', values: { name: 'Tripod', borrower: null, available: true, borrow_note: null } },
    ] } };
  }
  if (kind === 'shifts') {
    const program = baseProgram('Team shift exchange', sourceId, source.quote);
    program.collections = [{ id: 'people', title: 'Shift roster', fields: [
      { id: 'name', label: 'Name', type: 'text', required: true },
      { id: 'seat', label: 'Seat', type: 'text', required: true },
      { id: 'slot', label: 'Shift', type: 'text', required: true },
      { id: 'available', label: 'Available shifts', type: 'list', required: true },
    ] }];
    program.actions = [{ id: 'swap', title: 'Swap shifts', description: 'Swap two available shifts as one change.', roles: ['participant'], parameters: [
      { id: 'first', label: 'First person', type: 'record', collection: 'people' },
      { id: 'second', label: 'Second person', type: 'record', collection: 'people' },
    ], conditions: [
      { left: { input: 'first' }, op: 'neq', right: { input: 'second' }, message: 'Select two different people.' },
      { left: record('first', 'seat'), op: 'eq', right: { system: 'seat' }, message: 'Start with your own shift.' },
      { left: record('first', 'available'), op: 'contains', right: record('second', 'slot'), message: 'The first person is unavailable for that shift.' },
      { left: record('second', 'available'), op: 'contains', right: record('first', 'slot'), message: 'The second person is unavailable for that shift.' },
    ], effects: [
      { record: 'first', field: 'slot', op: 'set', value: record('second', 'slot') },
      { record: 'second', field: 'slot', op: 'set', value: record('first', 'slot') },
    ], requireTurn: false, advanceTurn: false }];
    program.invariants = [{ id: 'one_person_per_shift', collection: 'people', fields: ['slot'], message: 'Each shift must have one person.' }];
    return { kind: 'table', program, initialRecords: { people: [
      { id: 'ada', values: { name: 'Ada', seat: 'host', slot: 'morning', available: ['morning', 'evening'] } },
      { id: 'bo', values: { name: 'Bo', seat: 'member-1', slot: 'evening', available: ['morning', 'evening'] } },
      { id: 'cy', values: { name: 'Cy', seat: 'member-2', slot: 'night', available: ['night'] } },
    ] } };
  }
  const program = baseProgram('River Race', sourceId, source.quote);
  program.collections = [{ id: 'boats', title: 'Boats and scores', fields: [
    { id: 'seat', label: 'Seat', type: 'text', required: true },
    { id: 'score', label: 'Score', type: 'number', required: true, min: 0, max: 20 },
  ] }];
  program.turnOrder = ['host', 'member-1'];
  program.actions = [{ id: 'advance', title: 'Advance boat', description: 'Move your boat forward by two points.', roles: ['owner', 'participant'], parameters: [
    { id: 'boat', label: 'Your boat', type: 'record', collection: 'boats' },
  ], conditions: [
    { left: record('boat', 'seat'), op: 'eq', right: { system: 'seat' }, message: 'Choose your own boat.' },
  ], effects: [{ record: 'boat', field: 'score', op: 'add', value: literal(2) }], requireTurn: true, advanceTurn: true }];
  return { kind: 'table', program, initialRecords: { boats: [
    { id: 'red', values: { seat: 'host', score: 0 } },
    { id: 'blue', values: { seat: 'member-1', score: 0 } },
  ] } };
}

const expectedRules = {
  equipment: [
    { action: 'Borrow equipment', rows: [
      { predicate: 'Item · Available equals Yes', message: 'This item is already reserved.' },
    ] },
    { action: 'Return equipment', rows: [
      { predicate: 'Item · Borrower equals the acting member', message: 'Only the borrower may return this item.' },
    ] },
  ],
  shifts: [
    { action: 'Swap shifts', rows: [
      { predicate: 'First person does not equal Second person', message: 'Select two different people.' },
      { predicate: 'First person · Seat equals the current seat', message: 'Start with your own shift.' },
      { predicate: 'First person · Available shifts contains Second person · Shift', message: 'The first person is unavailable for that shift.' },
      { predicate: 'Second person · Available shifts contains First person · Shift', message: 'The second person is unavailable for that shift.' },
    ] },
  ],
  game: [
    { action: 'Advance boat', rows: [
      { predicate: 'Your boat · Seat equals the current seat', message: 'Choose your own boat.' },
    ] },
  ],
};

function isCommandResponse(response, type) {
  if (!response.url().endsWith('/commands') || response.request().method() !== 'POST') return false;
  try { return response.request().postDataJSON()?.type === type; }
  catch { return false; }
}

async function openObjectsMenu(page) {
  const trigger = page.getByTestId('canvas-object-menu-trigger');
  await expect(trigger).toBeVisible();
  if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
  const dock = page.getByTestId('canvas-object-dock');
  await expect(dock).toBeVisible();
  return dock;
}

async function openCanvasObject(page, id) {
  const editor = page.getByTestId('canvas-object-editor');
  if (await editor.isVisible().catch(() => false) && await editor.getAttribute('data-canvas-object') === id) return editor;
  const dock = await openObjectsMenu(page);
  await dock.getByTestId(`open-canvas-${id}`).click();
  await expect(editor).toHaveAttribute('data-canvas-object', id);
  await expect(editor).toBeVisible();
  return editor;
}

async function refreshTable(page, tableId) {
  const options = page.locator('.tt-table-options');
  if (await options.getAttribute('open') === null) await options.locator('summary').click();
  await expect(options).toHaveAttribute('open', '');
  const refreshed = page.waitForResponse((response) => response.url().endsWith(`/api/workspaces/${tableId}`) && response.request().method() === 'GET');
  await options.getByRole('button', { name: 'Refresh table', exact: true }).click();
  const response = await refreshed;
  expect(response.status()).toBe(200);
}

async function openNewTable(owner, api) {
  const created = owner.waitForResponse((response) => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  await owner.getByRole('button', { name: 'Start a new table', exact: true }).click();
  const startPage = owner.getByTestId('start-page');
  await expect(startPage.getByRole('heading', { name: 'What should we start with?' })).toBeVisible();
  await expect(owner).toHaveURL(/\/new$/);
  await expect(startPage.getByRole('list', { name: 'Prepared tables' }).getByRole('button')).toHaveCount(3);
  await startPage.getByRole('button', { name: 'Start empty with your own files', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const view = await response.json();
  await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
  await expect(owner).toHaveURL(new RegExp(`/t/${view.id}$`));
  const workspacePicker = owner.locator('.tt-workspace-picker__button');
  await expect(workspacePicker).toBeVisible();
  await workspacePicker.click();
  await expect(workspacePicker).toHaveAttribute('aria-expanded', 'true');
  await expect(owner.locator('.tt-workspace-menu')).toBeVisible();
  await owner.getByRole('button', { name: 'Close table menu', exact: true }).click();
  const assistant = owner.getByTestId('table-assistant');
  await expect(assistant.getByRole('button', { name: 'Set up this table from sources', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const dock = await openObjectsMenu(owner);
  await expect(dock.getByTestId('open-canvas-table.sources')).toHaveText('Files');
  await expect(dock.getByTestId('open-canvas-table.rules')).toHaveText('Rules');
  await owner.getByTestId('canvas-object-menu-trigger').click();
  expect((await api(owner, `/api/workspaces/${view.id}`)).body.kind).toBe('table');
  return view;
}

async function addSource(page, tableId, source, api, method = 'assistant') {
  const assistant = page.getByTestId('table-assistant');
  await expect(assistant).toBeVisible();
  const sourceCountBefore = (await api(page, `/api/workspaces/${tableId}`)).body.domain.sources.length;
  let importRequests = 0;
  let modelRequests = 0;
  let assistantRequests = 0;
  const trackImport = (request) => {
    if (request.method() !== 'POST') return;
    try {
      if (request.postDataJSON()?.type === 'table.import') importRequests += 1;
      if (request.url().endsWith(`/api/workspaces/${tableId}/model`)) modelRequests += 1;
      if (request.url().endsWith(`/api/workspaces/${tableId}/assistant`)) assistantRequests += 1;
    }
    catch { /* Ignore non-JSON requests. */ }
  };
  page.on('request', trackImport);
  const imported = page.waitForResponse((response) => isCommandResponse(response, 'table.import'));
  if (method === 'drop') {
    const editor = await openCanvasObject(page, 'table.sources');
    await expect(editor).toHaveAttribute('data-canvas-object', 'table.sources');
    await page.evaluate(({ filename, text }) => {
      const zone = document.querySelector('.tt-table-dropzone');
      if (!zone) throw new Error('Expanded source file drop area is missing.');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], filename, { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, source);
  } else {
    const prompt = assistant.getByLabel('How should this table work?');
    const retainedPrompt = 'Keep this request while I attach the source.';
    await prompt.fill(retainedPrompt);
    await assistant.getByLabel('Choose table source files').setInputFiles({ name: source.filename, mimeType: source.filename.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(source.text, 'utf8') });
    await expect(prompt).toHaveValue(retainedPrompt);
  }
  const response = await imported;
  expect(response.status()).toBe(200);
  await expect(assistant).toContainText(source.filename);
  expect(modelRequests).toBe(0);
  if (method === 'assistant') expect(importRequests).toBe(1);
  if (method === 'drop') {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    expect(importRequests).toBe(1);
  }
  page.off('request', trackImport);
  const current = await api(page, `/api/workspaces/${tableId}`);
  expect(current.status).toBe(200);
  expect(current.body.domain.sources).toHaveLength(sourceCountBefore + 1);
  const importedSource = current.body.domain.sources.find((item) => item.filename === source.filename && item.text === source.text);
  expect(importedSource).toBeTruthy();
  expect(assistantRequests).toBe(0);
  return importedSource;
}

async function requestProposal(owner, tableId, source, change, setTableReply, api) {
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const assistant = owner.getByTestId('table-assistant');
  await expect(assistant).toBeVisible();
  const rulesMode = assistant.getByRole('button', { name: before.domain.program ? 'Open rules and sources' : 'Set up this table from sources', exact: true });
  await expect(rulesMode).toBeVisible();
  await expect(rulesMode).toHaveText(before.domain.program ? 'Rules' : 'Set up');
  if (await rulesMode.getAttribute('aria-pressed') !== 'true') await rulesMode.click();
  const consentCopy = assistant.locator('.tt-ai-proposal__privacy');
  await expect(consentCopy).not.toHaveAttribute('open', '');
  await consentCopy.locator('summary').click();
  await expect(consentCopy).toContainText('Your prompt, current rules, shared records, and all 1 private source file on this table go to the AI provider after you agree.');
  await expect(consentCopy).toContainText('Member profiles and activity are excluded.');
  await expect(consentCopy).toContainText('Review the generated rules, views and records before sharing them through activation.');
  await assistant.getByLabel('How should this table work?').fill('Build a shared table from the source, with bounded actions and checks.');
  const ask = assistant.getByRole('button', { name: 'Prepare rule draft', exact: true });
  await expect(ask).toBeDisabled();
  await assistant.getByLabel('Send this request, table state and 1 source file to AI.', { exact: true }).check();
  setTableReply({ change, expectedFilename: source.filename, expectedText: source.text });
  await ask.click();
  await expect(assistant.getByText('Draft ready for review', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(assistant.getByLabel('Send this request, table state and 1 source file to AI.', { exact: true })).not.toBeChecked();
  await expect(ask).toBeDisabled();
  await owner.reload();
  const refreshedAssistant = owner.getByTestId('table-assistant');
  await expect(refreshedAssistant.getByText('Draft ready for review', { exact: true })).toBeVisible();
  await refreshedAssistant.getByRole('button', { name: 'Review draft', exact: true }).click();
  const editor = owner.getByTestId('canvas-object-editor');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
  const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(current.domain.candidate?.status).toBe('draft');
  expect(current.domain.program).toEqual(before.domain.program);
  expect(current.domain.records).toEqual(before.domain.records);
  return current;
}

async function progressThroughLifecycle(owner, tableId, api, rules) {
  const editor = await openCanvasObject(owner, 'table.rules');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
  const proposedRules = editor.getByRole('region', { name: 'Proposed rules', exact: true });
  const actionDetails = proposedRules.locator('details.tt-table-rule-details').filter({ has: owner.locator('summary').filter({ hasText: /^Actions · / }) });
  await actionDetails.locator('summary').click();
  await expect(proposedRules.locator('.tt-table-rule-list')).toHaveCount(rules.length);
  for (const rule of rules) {
    const action = proposedRules.locator('.tt-table-program__group').filter({ hasText: rule.action });
    await expect(action).toHaveCount(1);
    const conditionRows = action.locator('.tt-table-rule-list li');
    await expect(conditionRows).toHaveCount(rule.rows.length);
    for (let index = 0; index < rule.rows.length; index += 1) {
      const row = conditionRows.nth(index);
      await expect(row.locator('strong')).toHaveText(rule.rows[index].predicate);
      await expect(row.locator('span')).toHaveText(rule.rows[index].message);
    }
  }
  const proposedRows = editor.locator('.tt-table-proposed-records').first();
  await expect(proposedRows).toBeVisible();
  await proposedRows.locator('summary').click();
  const candidate = (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate;
  const firstCollection = candidate.change.program.collections[0];
  const firstRow = candidate.change.initialRecords[firstCollection.id]?.[0];
  if (firstRow) await expect(proposedRows).toContainText(String(Object.values(firstRow.values)[0]));
  else await expect(proposedRows).toContainText('No new rows in this proposal. Existing records stay unchanged.');
  for (const [label, type, nextStatus] of [
    [/Preview change/, 'evolve.simulate', 'simulated'],
    [/Check rules/, 'evolve.validate', 'validated'],
    [/Approve rules/, 'evolve.approve', 'approved'],
    [/Use these rules/, 'evolve.activate', 'active'],
  ]) {
    const responsePromise = owner.waitForResponse((response) => isCommandResponse(response, type));
    await editor.getByRole('button', { name: label }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe(nextStatus);
  }
  const active = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(active.domain.program).toBeTruthy();
  await expect(owner.getByTestId('table-assistant').getByRole('button', { name: 'Open rules and sources', exact: true })).toHaveText('Rules');
  return active;
}

async function inviteMember(owner, seatNumber) {
  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'People at this table' });
  await dialog.getByRole('button', { name: new RegExp(`Member ${seatNumber}`) }).click();
  const responsePromise = owner.waitForResponse((response) => response.url().endsWith('/invites') && response.request().method() === 'POST');
  await dialog.getByRole('button', { name: `Create invitation for Member ${seatNumber}`, exact: true }).click();
  expect((await responsePromise).status()).toBe(201);
  const url = await dialog.getByLabel('One-use invitation link').inputValue();
  expect(url).toContain('#invite=');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return url;
}

async function joinAndCheckPrivateFiles(newPage, api, actor, inviteUrl, tableId, filename) {
  const page = await newPage(actor, inviteUrl);
  await expect(page.locator('.tt-canvas-panel')).toBeVisible();
  const workspace = await api(page, `/api/workspaces/${tableId}`);
  expect(workspace.status).toBe(200);
  expect(workspace.body.domain.sources).toEqual([]);
  expect(workspace.body.domain.candidate).toBeNull();
  expect(workspace.body.domain.revisions).toEqual([]);
  expect(JSON.stringify(workspace.body.domain)).not.toContain(filename);
  const dock = await openObjectsMenu(page);
  await expect(dock.getByTestId('open-canvas-table.sources')).toHaveCount(0);
  await expect(dock.getByTestId('open-canvas-table.rules')).toBeVisible();
  await expect(dock.getByTestId('open-canvas-table.rules')).toHaveText('Rules');
  await expect(dock.getByTestId('open-canvas-table.actions')).toHaveText('Actions');
  await page.getByTestId('canvas-object-menu-trigger').click();
  const assistant = page.getByTestId('table-assistant');
  await expect(assistant.getByRole('heading', { name: 'Table assistant', exact: true })).toBeVisible();
  const privacy = assistant.locator('.tt-table-chat__privacy');
  await privacy.locator('summary').click();
  await expect(privacy).toContainText('The owner manages private source files and rule drafts');
  await privacy.locator('summary').click();
  const tableTools = assistant.locator('.tt-table-assistant__canvas-tools');
  await expect(tableTools).toHaveCount(0);
  await openCanvasObject(page, 'table.rules');
  await expect(page.getByTestId('canvas-object-editor').getByRole('region', { name: 'Current active rules', exact: true })).toBeVisible();
  await openCanvasObject(page, 'table.actions');
  await expect(page.getByTestId('canvas-object-editor').locator('.tt-table-action-picker')).toBeVisible();
  await expect(assistant.getByTestId('table-ai-composer')).toHaveCount(0);
  await expect(assistant.getByLabel('Choose table source files')).toHaveCount(0);
  await expect(assistant.getByRole('button', { name: 'Prepare rule draft', exact: true })).toHaveCount(0);
  await expect(assistant).not.toContainText(filename);
  return page;
}

// F007: every member sees table-wide cards at the same place.
async function nodeTransforms(page, ids) {
  return page.evaluate((nodeIds) => Object.fromEntries(nodeIds.map((id) => {
    const element = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    return [id, element instanceof HTMLElement ? element.style.transform : null];
  })), ids);
}

async function verifySharedCardLayout(owner, member, tableId, api) {
  const shared = ['table.rules', 'table.actions', 'table.collection.equipment', 'workspace.people', 'workspace.history'];
  await expect.poll(async () => {
    const layout = (await api(owner, `/api/workspaces/${tableId}`)).body.domain.canvasLayout?.positions ?? {};
    return shared.filter((id) => id.startsWith('workspace.') || id === 'table.rules').every((id) => layout[id]);
  }, { timeout: 15_000 }).toBe(true);
  await owner.reload(); await member.reload();
  await expect(owner.locator('.react-flow__node[data-id="workspace.people"]')).toHaveCount(1);
  await expect(member.locator('.react-flow__node[data-id="workspace.people"]')).toHaveCount(1);
  await expect.poll(async () => JSON.stringify(await nodeTransforms(member, shared)), { timeout: 10_000 })
    .toBe(JSON.stringify(await nodeTransforms(owner, shared)));
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const moved = await api(owner, `/api/workspaces/${tableId}/commands`, {
    commandId: crypto.randomUUID(), expectedRevision: before.revision, expectedEpoch: before.epoch,
    type: 'canvas.layout', payload: { expectedLayoutRevision: before.domain.canvasLayout.revision, positions: { 'workspace.history': { x: 1480, y: 960, pinned: true } } },
  });
  expect(moved.status).toBe(200);
  await expect.poll(async () => (await nodeTransforms(member, ['workspace.history']))['workspace.history'], { timeout: 10_000 })
    .toBe('translate(1480px, 960px)');
  const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(after.domain.records).toEqual(before.domain.records);
  expect(after.domain.dataRevision).toBe(before.domain.dataRevision);
}

async function performAction(page, actionTitle, inputs, expectedStatus = 200) {
  const editor = await openCanvasObject(page, 'table.actions');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.actions');
  const forms = editor.locator('form.tt-table-action');
  const picker = editor.locator('.tt-table-action-picker select');
  await picker.selectOption('');
  await expect(forms).toHaveCount(0);
  await picker.selectOption({ label: actionTitle });
  const form = editor.locator('form.tt-table-action').filter({ hasText: actionTitle });
  await expect(forms).toHaveCount(1);
  await expect(form).toBeVisible();
  const requirements = form.locator('details.tt-table-action__requirements');
  if (await requirements.count()) await expect(requirements).not.toHaveAttribute('open', '');
  for (const [label, value] of Object.entries(inputs)) await form.getByLabel(label, { exact: false }).selectOption(value);
  const responsePromise = page.waitForResponse((response) => isCommandResponse(response, 'table.act'));
  // Keep a failed UI click as the primary error so the runner can save its
  // screenshot; the response waiter is still awaited and must succeed below.
  void responsePromise.catch(() => {});
  await form.getByRole('button', { name: actionTitle, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  if (expectedStatus !== 200) {
    const failure = await response.json();
    expect(failure.message).toEqual(expect.any(String));
    const notice = page.locator('.tt-notice[role="alert"]');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText(failure.message);
  }
  return response;
}

async function performContextualAction(page, collectionId, { recordId, recordLabel, actionTitle, recordFieldLabel, recordParameterChoice, inputs = {}, resetTextOnRecordChange }) {
  const editor = await openCanvasObject(page, `table.collection.${collectionId}`);
  const selectRecord = editor.getByRole('button', { name: `Select ${recordLabel} · ${recordId}`, exact: true });
  await selectRecord.click();
  await expect(editor.locator('.tt-table-record-select[aria-pressed="true"]')).toHaveCount(1);
  let actions = editor.getByRole('region', { name: `Actions for ${recordLabel} · ${recordId}`, exact: true });
  await expect(actions).toBeVisible();
  await actions.getByRole('combobox', { name: 'Action', exact: true }).selectOption({ label: actionTitle });
  let form = actions.locator('form.tt-table-action');
  if (recordParameterChoice) {
    await actions.getByRole('combobox', { name: 'Use this record as', exact: true }).selectOption({ label: recordParameterChoice });
  }
  await expect(form).toBeVisible();
  const requirements = form.locator('details.tt-table-action__requirements');
  if (await requirements.count()) await expect(requirements).not.toHaveAttribute('open', '');
  const prefilledField = form.getByRole('combobox', { name: recordFieldLabel, exact: true });
  await expect(prefilledField).toHaveValue(recordId);
  for (const [label, value] of Object.entries(inputs)) {
    const field = form.getByRole('combobox', { name: label, exact: true });
    await expect(field).toHaveValue('');
    await field.selectOption(value);
  }
  if (resetTextOnRecordChange) {
    const textField = form.getByLabel(resetTextOnRecordChange.label, { exact: true });
    await textField.fill(resetTextOnRecordChange.discardValue);
    for (const nextRecord of resetTextOnRecordChange.records) {
      await editor.getByRole('button', { name: `Select ${nextRecord.label} · ${nextRecord.id}`, exact: true }).click();
      actions = editor.getByRole('region', { name: `Actions for ${nextRecord.label} · ${nextRecord.id}`, exact: true });
      form = actions.locator('form.tt-table-action');
      await expect(actions).toBeVisible();
      await expect(form).toBeVisible();
      await expect(form.getByRole('combobox', { name: recordFieldLabel, exact: true })).toHaveValue(nextRecord.id);
      await expect(form.getByLabel(resetTextOnRecordChange.label, { exact: true })).toHaveValue('');
    }
    await form.getByLabel(resetTextOnRecordChange.label, { exact: true }).fill(resetTextOnRecordChange.submitValue);
  }
  await expect(form).toHaveCount(1);
  const responsePromise = page.waitForResponse((response) => isCommandResponse(response, 'table.act'));
  await form.getByRole('button', { name: actionTitle, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(200);
  return response;
}

const tableChatConsent = 'I agree to share this message and table context with the AI provider.';

async function askTableAssistant(page, promptText, syntheticReply, setAssistantReply) {
  const chat = page.getByTestId('table-chat');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const send = chat.getByRole('button', { name: 'Send', exact: true });
  await expect(prompt).toBeEnabled();
  await prompt.fill(promptText);
  await expect(send).toBeDisabled();
  setAssistantReply(syntheticReply);
  await chat.getByLabel(tableChatConsent, { exact: true }).check();
  const responsePromise = page.waitForResponse((response) => response.url().endsWith('/assistant') && response.request().method() === 'POST');
  await send.click();
  const response = await responsePromise;
  expect([200, 202]).toContain(response.status());
  const history = chat.locator('.tt-table-chat__history');
  if (await history.getAttribute('open') === null) await history.locator('summary').click();
  await expect(chat).toContainText(syntheticReply.result.text, { timeout: 20_000 });
  return chat;
}

async function seedConversationPage({ page, tableId, profile, api, setAssistantReply }) {
  const created = [];
  for (let index = 0; index < 21; index += 1) {
    const number = String(index).padStart(2, '0');
    const prompt = `Archive question ${number}: summarize item ${number}.`;
    const answer = `Archive answer ${number}: item ${number} remains in the saved history.`;
    created.push({ prompt, answer });
    setAssistantReply({
      result: { kind: 'explanation', text: answer, references: [] },
      expectedRole: 'participant',
      expectedSeat: 'member-1',
      expectedPromptContains: prompt,
      expectedConversationCount: Math.min(2 + index, 6),
      ...(index === 20 ? { expectedConversationContains: [created[14].prompt, created[14].answer, created[19].prompt, created[19].answer] } : {}),
    });
    const accepted = await api(page, `/api/workspaces/${tableId}/assistant`, {
      commandId: crypto.randomUUID(),
      expectedRevision: profile.revision,
      expectedEpoch: profile.epoch,
      prompt,
      consent: true,
    });
    expect([200, 202]).toContain(accepted.status);
    let job = accepted.body;
    const deadline = Date.now() + 8_000;
    while (job.status === 'running' && Date.now() < deadline) {
      await page.waitForTimeout(100);
      const polled = await api(page, `/api/workspaces/${tableId}/assistant/${job.id}`);
      expect([200, 202]).toContain(polled.status);
      job = polled.body;
    }
    expect(job.status).toBe('completed');
    expect(job.result?.text).toBe(answer);
  }
  return created;
}

async function verifyParticipantConversation({ owner, member, tableId, source, api, setAssistantReply, getProviderCalls }) {
  const profile = (await api(member, `/api/workspaces/${tableId}`)).body;
  const initialCalls = getProviderCalls();
  const firstPrompt = 'What does the Available rule mean?';
  const firstText = 'An item can be borrowed only while its Available field is true.';
  const forbidden = [source.filename, fixtures.equipment.quote, profile.actor.actorId, profile.actor.name];
  const firstReply = {
    result: { kind: 'explanation', text: firstText, references: [{ kind: 'field', collectionId: 'equipment', id: 'available' }] },
    expectedRole: 'participant', expectedSeat: 'member-1', expectedConversationCount: 0,
    expectedPromptContains: firstPrompt, forbiddenTexts: forbidden,
  };
  const chat = await askTableAssistant(member, firstPrompt, firstReply, setAssistantReply);
  expect(getProviderCalls()).toBe(initialCalls + 1);
  const afterAnswer = (await api(member, `/api/workspaces/${tableId}`)).body;
  expect(afterAnswer.revision).toBe(profile.revision);
  expect(afterAnswer.domain.records).toEqual(profile.domain.records);
  const reference = chat.getByRole('button', { name: 'Available', exact: true });
  await expect(reference).toBeVisible();
  await reference.click();
  await expect(member.getByTestId('canvas-object-editor')).toHaveAttribute('data-canvas-object', 'table.collection.equipment');

  await member.reload();
  await expect(member.getByTestId('table-chat')).toContainText(firstPrompt);
  await expect(member.getByTestId('table-chat')).toContainText(firstText);
  const followup = 'Does that apply to every item in the list?';
  const followupReply = {
    result: { kind: 'explanation', text: 'Yes. Each equipment row follows the same active availability check.', references: [{ kind: 'field', collectionId: 'equipment', id: 'available' }] },
    expectedRole: 'participant', expectedSeat: 'member-1', expectedConversationCount: 1,
    expectedConversationContains: [firstPrompt, firstText], expectedPromptContains: followup,
    forbiddenTexts: forbidden,
  };
  const beforeFollowup = (await api(member, `/api/workspaces/${tableId}`)).body;
  await askTableAssistant(member, followup, followupReply, setAssistantReply);
  expect(getProviderCalls()).toBe(initialCalls + 2);
  const afterFollowup = (await api(member, `/api/workspaces/${tableId}`)).body;
  expect(afterFollowup.revision).toBe(beforeFollowup.revision);
  expect(afterFollowup.domain.records).toEqual(beforeFollowup.domain.records);

  // A different actor at the same room must see only their own assistant history.
  await owner.reload();
  await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
  const ownerProfile = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const ownerPrompt = 'Who is allowed to return a borrowed item?';
  const ownerReply = {
    result: { kind: 'explanation', text: 'Only the member who borrowed an item may return it.', references: [{ kind: 'action', id: 'return' }] },
    expectedRole: 'owner', expectedSeat: 'host', expectedConversationCount: 0,
    expectedPromptContains: ownerPrompt, forbiddenTexts: [...forbidden, firstPrompt, firstText, followup],
  };
  const ownerCalls = getProviderCalls();
  await expect(owner.getByTestId('table-chat')).not.toContainText(firstPrompt);
  await askTableAssistant(owner, ownerPrompt, ownerReply, setAssistantReply);
  expect(getProviderCalls()).toBe(ownerCalls + 1);
  expect((await api(owner, `/api/workspaces/${tableId}`)).body.revision).toBe(ownerProfile.revision);

  const providerCallsBeforeArchive = getProviderCalls();
  const archived = await seedConversationPage({ page: member, tableId, profile: afterFollowup, api, setAssistantReply });
  expect(getProviderCalls()).toBe(providerCallsBeforeArchive + archived.length);
  await member.reload();
  const restored = member.getByTestId('table-chat');
  await expect(restored).toContainText(archived[20].prompt);
  await expect(restored).not.toContainText(archived[0].prompt);
  const callsBeforeHistoryRead = getProviderCalls();
  const historyDetails = restored.locator('details.tt-table-chat__history');
  if (await historyDetails.getAttribute('open') === null) await historyDetails.locator('summary').click();
  await expect(historyDetails).toHaveAttribute('open', '');
  const older = historyDetails.getByRole('button', { name: 'Older messages', exact: true });
  await expect(older).toBeVisible();
  await older.click();
  await expect(restored).toContainText(archived[0].prompt);
  expect(getProviderCalls()).toBe(callsBeforeHistoryRead);
}

async function equipmentScenario({ owner, member, secondMember, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const room = await openNewTable(owner, api);
  await owner.setViewportSize({ width: 390, height: 844 });
  const canvasBox = await owner.locator('.tt-canvas-panel').boundingBox();
  const assistantBox = await owner.getByTestId('table-assistant-panel').boundingBox();
  const flowBox = await owner.locator('.tt-canvas-panel .react-flow').boundingBox();
  expect(canvasBox).toBeTruthy();
  expect(assistantBox).toBeTruthy();
  expect(flowBox).toBeTruthy();
  expect(assistantBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1);
  expect(assistantBox.y).toBeGreaterThanOrEqual(canvasBox.y - 1);
  expect(assistantBox.x + assistantBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
  expect(assistantBox.y + assistantBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
  expect(flowBox.height).toBeGreaterThan(100);
  expect(flowBox.y + flowBox.height).toBeLessThanOrEqual(assistantBox.y - 1);
  await owner.setViewportSize({ width: 1280, height: 820 });
  const source = await addSource(owner, room.id, fixtures.equipment, api);
  await requestProposal(owner, room.id, source, buildChange('equipment', source.id), setTableReply, api);
  let active = await progressThroughLifecycle(owner, room.id, api, expectedRules.equipment);
  expect(active.domain.records.equipment).toHaveLength(2);

  const ownerAssistant = owner.getByTestId('table-assistant');
  const rulesMode = ownerAssistant.getByRole('button', { name: 'Open rules and sources', exact: true });
  if (await rulesMode.getAttribute('aria-pressed') !== 'true') await rulesMode.click();
  const initialSourceConsent = ownerAssistant.getByLabel('Send this request, table state and 1 source file to AI.', { exact: true });
  await initialSourceConsent.check();
  const sourcePrompt = ownerAssistant.getByLabel('How should this table work?', { exact: true });
  await sourcePrompt.fill('Check that approval consent follows the selected source files.');
  const prepareDraft = ownerAssistant.getByRole('button', { name: 'Prepare rule draft', exact: true });
  await expect(prepareDraft).toBeEnabled();
  await addSource(owner, room.id, equipmentNotes, api);
  const updatedSourceConsent = ownerAssistant.getByLabel('Send this request, table state and 2 source files to AI.', { exact: true });
  await expect(updatedSourceConsent).not.toBeChecked();
  await expect(prepareDraft).toBeDisabled();
  await updatedSourceConsent.check();
  await expect(prepareDraft).toBeEnabled();

  const firstInvite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, firstInvite, room.id, source.filename);
  await verifySharedCardLayout(owner, member, room.id, api);
  mark('Shared card layout: rules, people, history and table cards sit at the same place for owner and member, and a move reaches the other screen live');
  await verifyParticipantConversation({ owner, member, tableId: room.id, source, api, setAssistantReply, getProviderCalls });
  mark('Generic table assistant: explicit consent, participant-only conversation history, grounded reference, reload continuity, and no table mutation');
  await performContextualAction(member, 'equipment', {
    recordId: 'camera', recordLabel: 'Field camera', actionTitle: 'Borrow equipment', recordFieldLabel: 'Item',
    resetTextOnRecordChange: {
      label: 'Completion note', discardValue: 'Draft for the wrong item', submitValue: 'Reserved for the community workshop',
      records: [{ id: 'tripod', label: 'Tripod' }, { id: 'camera', label: 'Field camera' }],
    },
  });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  const camera = active.domain.records.equipment.find((row) => row.id === 'camera');
  expect(camera.values).toMatchObject({ available: false, borrower: active.actor.actorId, borrow_note: 'Reserved for the community workshop' });
  const expandedEquipment = await openCanvasObject(member, 'table.collection.equipment');
  await expandedEquipment.getByRole('button', { name: 'Close object', exact: true }).click();
  const equipmentPreview = member.locator('.tt-canvas-node[data-canvas-object="table.collection.equipment"] .tt-table-collection__preview');
  await expect(equipmentPreview).toContainText(`Borrower: ${active.actor.name}`);
  await expect(equipmentPreview).not.toContainText(active.actor.actorId);

  const secondInvite = await inviteMember(owner, 2);
  secondMember = await joinAndCheckPrivateFiles(newPage, api, secondMember, secondInvite, room.id, source.filename);
  const people = await openCanvasObject(member, 'workspace.people');
  await expect(people).toContainText('Second Member');
  mark('Generic table: existing participant receives the new membership projection over its live connection');
  await performAction(secondMember, 'Return equipment', { Item: 'camera' }, 422);
  const rejected = (await api(secondMember, `/api/workspaces/${room.id}`)).body.domain.records.equipment.find((row) => row.id === 'camera');
  expect(rejected.values).toMatchObject({ available: false, borrower: active.actor.actorId });

  await performAction(member, 'Return equipment', { Item: 'camera' });
  const returned = (await api(member, `/api/workspaces/${room.id}`)).body.domain.records.equipment.find((row) => row.id === 'camera');
  expect(returned.values).toMatchObject({ available: true, borrower: null });
  await member.reload();
  await expect(member.locator('.tt-canvas-panel')).toBeVisible();
  const resumed = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(resumed.domain.records.equipment.find((row) => row.id === 'camera').values.available).toBe(true);
  mark('Generic table: text source, reviewed lifecycle, shared equipment actions, borrower-only return, private source projection, and reload persistence');
}

async function shiftScenario({ owner, member, newPage, api, setTableReply, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.shifts, api, 'drop');
  await requestProposal(owner, room.id, source, buildChange('shifts', source.id), setTableReply, api);
  await progressThroughLifecycle(owner, room.id, api, expectedRules.shifts);
  const ownerRoster = await openCanvasObject(owner, 'table.collection.people');
  await ownerRoster.getByRole('button', { name: 'Select Ada · ada', exact: true }).click();
  const ownerRecordActions = ownerRoster.getByRole('region', { name: 'Actions for Ada · ada', exact: true });
  await expect(ownerRecordActions).toContainText('Actions for this collection are limited to members.');
  await expect(ownerRecordActions.getByRole('combobox', { name: 'Action', exact: true })).toHaveCount(0);
  const invite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, invite, room.id, source.filename);
  await performContextualAction(member, 'people', {
    recordId: 'bo', recordLabel: 'Bo', actionTitle: 'Swap shifts', recordFieldLabel: 'First person',
    recordParameterChoice: 'First person', inputs: { 'Second person': 'ada' },
  });
  let current = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(current.domain.records.people.find((row) => row.id === 'bo').values.slot).toBe('morning');
  expect(current.domain.records.people.find((row) => row.id === 'ada').values.slot).toBe('evening');
  await performAction(member, 'Swap shifts', { 'First person': 'bo', 'Second person': 'cy' }, 422);
  current = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(current.domain.records.people.find((row) => row.id === 'bo').values.slot).toBe('morning');
  expect(current.domain.records.people.find((row) => row.id === 'cy').values.slot).toBe('night');
  const memberRoster = await openCanvasObject(member, 'table.collection.people');
  await expect(memberRoster).toContainText('Shift roster');
  mark('Generic table: JSON source, atomic multi-record action, availability check, unique records, and one-import drag/drop');
}

async function gameScenario({ owner, member, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.game, api);
  await requestProposal(owner, room.id, source, buildChange('game', source.id), setTableReply, api);
  let active = await progressThroughLifecycle(owner, room.id, api, expectedRules.game);
  expect(active.domain.turn).toBe('host');
  const invite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, invite, room.id, source.filename);
  const memberName = (await api(member, `/api/workspaces/${room.id}`)).body.actor.name;
  const people = await openCanvasObject(owner, 'workspace.people');
  await expect(people).toContainText(memberName);
  const memberActions = await openCanvasObject(member, 'table.actions');
  await expect(memberActions.locator('form.tt-table-action')).toHaveCount(0);
  await memberActions.locator('.tt-table-action-picker select').selectOption({ label: 'Advance boat' });
  await expect(memberActions.locator('form.tt-table-action')).toHaveCount(1);
  await expect(memberActions).toContainText('Turn: Owner');
  await expect(memberActions).toContainText('Waiting for the owner to act.');
  await expect(memberActions.getByRole('button', { name: 'Advance boat', exact: true })).toBeDisabled();

  const ownerBeforeProposal = (await api(owner, `/api/workspaces/${room.id}`)).body;
  const ownerCalls = getProviderCalls();
  const ownerProposal = {
    result: { kind: 'action-proposal', text: 'Prepare the red boat advance for the owner turn.', actionId: 'advance', inputs: { boat: 'red' } },
    expectedRole: 'owner', expectedSeat: 'host', expectedConversationCount: 0,
    expectedPromptContains: 'Prepare my red boat advance for this turn.',
    forbiddenTexts: [source.filename, fixtures.game.quote, ownerBeforeProposal.actor.actorId, ownerBeforeProposal.actor.name],
  };
  const ownerChat = await askTableAssistant(owner, ownerProposal.expectedPromptContains, ownerProposal, setAssistantReply);
  expect(getProviderCalls()).toBe(ownerCalls + 1);
  const afterOwnerProposal = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(afterOwnerProposal.revision).toBe(ownerBeforeProposal.revision);
  expect(afterOwnerProposal.domain.records.boats.map((row) => row.values.score)).toEqual([0, 0]);
  expect(afterOwnerProposal.domain.turn).toBe('host');
  const ownerProposalCard = ownerChat.locator('.tt-table-chat__answer.is-proposal').last();
  const ownerConfirm = ownerProposalCard.getByRole('button', { name: 'Confirm action', exact: true });
  await expect(ownerConfirm).toBeEnabled();
  const ownerConfirmation = owner.waitForResponse((response) => response.url().endsWith('/confirm') && response.request().method() === 'POST');
  await ownerConfirm.click();
  expect((await ownerConfirmation).status()).toBe(200);
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('member-1');
  expect(active.domain.records.boats.find((row) => row.id === 'red').values.score).toBe(2);

  await openCanvasObject(member, 'table.collection.boats');
  await refreshTable(member, room.id);
  const memberBeforeProposal = (await api(member, `/api/workspaces/${room.id}`)).body;
  const memberCalls = getProviderCalls();
  const memberPrompt = 'Prepare my blue boat advance for this turn.';
  const memberProposal = {
    result: { kind: 'action-proposal', text: 'Prepare the blue boat advance for the member turn.', actionId: 'advance', inputs: { boat: 'blue' } },
    expectedRole: 'participant', expectedSeat: 'member-1', expectedConversationCount: 0,
    expectedPromptContains: memberPrompt,
    forbiddenTexts: [source.filename, fixtures.game.quote, memberBeforeProposal.actor.actorId, memberBeforeProposal.actor.name],
  };
  const memberChat = await askTableAssistant(member, memberPrompt, memberProposal, setAssistantReply);
  expect(getProviderCalls()).toBe(memberCalls + 1);
  const afterMemberProposal = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(afterMemberProposal.revision).toBe(memberBeforeProposal.revision);
  expect(afterMemberProposal.domain.records.boats.map((row) => row.values.score)).toEqual([2, 0]);
  expect(afterMemberProposal.domain.turn).toBe('member-1');

  await performAction(member, 'Advance boat', { 'Your boat': 'blue' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('host');
  expect(active.domain.records.boats.find((row) => row.id === 'blue').values.score).toBe(2);
  await expect(memberChat.locator('.tt-table-chat__answer.is-proposal').last().getByRole('button', { name: 'Confirm action', exact: true })).toBeDisabled();
  await expect(memberChat).toContainText('The table changed after this proposal. It cannot be confirmed');
  mark('Generic table assistant: action proposal requires a separate confirmation; a direct table action makes a pending proposal stale');

  await openCanvasObject(owner, 'table.collection.boats');
  await refreshTable(owner, room.id);
  await expect(owner.getByTestId('canvas-object-editor').getByRole('cell', { name: '2', exact: true })).toHaveCount(2);
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  const revisedProgram = structuredClone(active.domain.program);
  revisedProgram.description = 'A revised scoring rule changes the gain from two to three points. Current scores stay in place.';
  revisedProgram.actions.find((action) => action.id === 'advance').effects[0].value = literal(3);
  const revisedChange = { kind: 'table', program: revisedProgram, initialRecords: {} };
  await requestProposal(owner, room.id, source, revisedChange, setTableReply, api);
  active = await progressThroughLifecycle(owner, room.id, api, expectedRules.game);
  expect(active.domain.records.boats.find((row) => row.id === 'red').values.score).toBe(2);
  expect(active.domain.records.boats.find((row) => row.id === 'blue').values.score).toBe(2);
  expect(active.domain.turn).toBe('host');
  await performAction(owner, 'Advance boat', { 'Your boat': 'red' });
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('member-1');
  expect(active.domain.records.boats.map((row) => row.values.score)).toEqual([5, 2]);
  await performAction(member, 'Advance boat', { 'Your boat': 'blue' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('host');
  expect(active.domain.records.boats.map((row) => row.values.score)).toEqual([5, 5]);
  await member.reload();
  const resumed = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(resumed.domain.records.boats.map((row) => row.values.score)).toEqual([5, 5]);
  mark('Generic table: text source, role and turn-gated actions, rule revision preserves live scores, and member reload resumes shared data');
}

export async function verifyGenericTableBrowser({ actors, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const [equipmentOwner, shiftsOwner, gameOwner] = actors.owners;
  const [member, secondMember] = actors.members;
  const owners = [equipmentOwner, shiftsOwner, gameOwner];
  const scenarios = [equipmentScenario, shiftScenario, gameScenario];
  for (let index = 0; index < scenarios.length; index += 1) {
    const owner = await newPage(owners[index]);
    await expect(owner.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
    await scenarios[index]({ owner, member: actors.members[0], secondMember, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark });
    await owner.screenshot({ path: `test-results/cloudflare-browser/generic-table-${['equipment', 'shifts', 'game'][index]}.png`, fullPage: true });
  }
}
