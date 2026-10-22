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

async function setTableOptionsOpen(page, open) {
  const options = page.locator('.tt-table-options');
  const isOpen = await options.getAttribute('open') !== null;
  if (isOpen !== open) await options.locator('summary').click();
  if (open) await expect(options).toHaveAttribute('open', '');
  else await expect(options).not.toHaveAttribute('open');
}

async function refreshTable(page, tableId) {
  await setTableOptionsOpen(page, true);
  const options = page.locator('.tt-table-options');
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
  await expect(startPage.getByRole('list', { name: 'Ways to start' }).getByRole('button')).toHaveCount(4);
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
  await expect(owner.getByTestId('table-chat-bar')).toBeVisible();
  await expect(owner.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(owner.locator('.tt-canvas-node')).toHaveCount(0);
  expect((await api(owner, `/api/workspaces/${view.id}`)).body.kind).toBe('table');
  return view;
}

async function addSource(page, tableId, source, api, method = 'chat', { aiDisabled = false, failHistory = false, onCapabilitiesReady } = {}) {
  const chat = page.getByTestId('table-chat-bar');
  await expect(chat).toBeVisible();
  const capabilitiesRoute = url => new URL(url).pathname === '/api/capabilities';
  const historyRoute = url => {
    const parsed = new URL(url);
    return parsed.pathname === `/api/workspaces/${tableId}/assistant` && parsed.searchParams.has('limit');
  };
  if (aiDisabled) {
    await page.route(capabilitiesRoute, route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ uploads: true, tableReadOnly: false, tableAssistant: { available: true }, model: { enabled: false, reason: 'AI disabled for this fixture.' } }),
    }));
    if (failHistory) {
      await page.route(historyRoute, route => route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Synthetic private history read failure.' }),
      }));
    }
    await page.reload();
    await expect(page.getByTestId('table-chat-bar')).toBeVisible();
    const disabledChat = page.getByTestId('table-chat-bar');
    const disabledComposer = disabledChat.getByRole('textbox', { name: 'Message', exact: true });
    await disabledComposer.fill('Keep this message ready while AI is off.');
    await expect(disabledComposer).toHaveValue('Keep this message ready while AI is off.');
    await expect(disabledChat.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
    await expect(disabledChat.getByRole('button', { name: 'Attach a file', exact: true })).toBeEnabled();
    if (failHistory) await expect(disabledChat.getByRole('alert')).toContainText('Table conversation history could not be loaded.');
  }
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
    await page.evaluate(({ filename, text }) => {
      const zone = document.querySelector('.tt-canvas-panel');
      if (!zone) throw new Error('Canvas file drop area is missing.');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], filename, { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, source);
  } else {
    const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
    const retainedPrompt = 'Keep this request while I attach the source.';
    await prompt.fill(retainedPrompt);
    await chat.getByLabel('Choose a file to attach', { exact: true }).setInputFiles({ name: source.filename, mimeType: source.filename.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(source.text, 'utf8') });
    await expect(prompt).toHaveValue(retainedPrompt);
  }
  const response = await imported;
  expect(response.status()).toBe(200);
  expect(modelRequests).toBe(0);
  expect(importRequests).toBe(1);
  page.off('request', trackImport);
  const current = await api(page, `/api/workspaces/${tableId}`);
  expect(current.status).toBe(200);
  expect(current.body.domain.sources).toHaveLength(sourceCountBefore + 1);
  const importedSource = current.body.domain.sources.find((item) => item.filename === source.filename && item.text === source.text);
  expect(importedSource).toBeTruthy();
  expect(assistantRequests).toBe(0);
  if (aiDisabled) {
    expect(modelRequests).toBe(0);
    await page.unroute(capabilitiesRoute);
    if (failHistory) await page.unroute(historyRoute);
    const capabilitiesReady = page.waitForResponse(response => response.url().endsWith('/api/capabilities') && response.request().method() === 'GET');
    void capabilitiesReady.catch(() => {});
    await page.reload();
    const capabilitiesResponse = await capabilitiesReady;
    expect(capabilitiesResponse.status()).toBe(200);
    const restoredCapabilities = await capabilitiesResponse.json();
    expect(restoredCapabilities.model?.enabled).toBe(true);
    onCapabilitiesReady?.({ receivedAt: Date.now(), modelEnabled: restoredCapabilities.model.enabled });
    await expect(page.getByTestId('table-chat-bar')).toBeVisible();
  }
  const sourceObject = await openCanvasObject(page, 'table.sources');
  await expect(sourceObject).toContainText(source.filename);
  return importedSource;
}

// F011: while the provider is held, the card is busy, its glyph orbits (still under reduced motion), and its status is centred.
async function verifyPendingChatMotion(owner, draftNode, draftCard) {
  const glyph = draftNode.locator('.tt-object-glyph');
  await expect(draftCard).toContainText('Preparing a rule draft…');
  await expect(draftNode).toHaveAttribute('aria-busy', 'true');
  await expect(glyph).toHaveClass(/\bis-busy\b/u);
  const motion = () => glyph.evaluate(node => ({
    orbit: getComputedStyle(node, '::after').animationName,
    breathe: getComputedStyle(node.querySelector('svg')).animationName,
    dot: getComputedStyle(node.closest('.tt-canvas-node').querySelector('.tt-chat-dots i')).animationName,
  }));
  expect(await motion()).toEqual({ orbit: 'none', breathe: 'none', dot: 'none' });
  await owner.emulateMedia({ reducedMotion: 'no-preference' });
  try {
    await expect.poll(motion).toEqual({ orbit: 'tt-glyph-orbit', breathe: 'tt-glyph-breathe', dot: 'tt-chat-dot' });
  } finally {
    await owner.emulateMedia({ reducedMotion: 'reduce' });
  }
  const offset = await draftNode.evaluate(node => {
    const body = node.querySelector('.tt-canvas-node__body').getBoundingClientRect();
    const text = node.querySelector('.tt-chat-card__pending--working').getBoundingClientRect();
    return { x: Math.abs((body.left + body.right) / 2 - (text.left + text.right) / 2), y: Math.abs((body.top + body.bottom) / 2 - (text.top + text.bottom) / 2) };
  });
  expect(offset.x, JSON.stringify(offset)).toBeLessThanOrEqual(2);
  expect(offset.y, JSON.stringify(offset)).toBeLessThanOrEqual(2);
}

async function requestProposal(owner, tableId, source, change, setTableReply, api, { failDraftRefresh = false, getProviderCalls, expectConsent = true, observePending = false } = {}) {
  const stepLabel = `Table draft: ${change.program.title}`;
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const sourceNames = before.domain.sources.map(item => item.filename);
  expect(sourceNames.length).toBeGreaterThan(0);
  expect(sourceNames).toContain(source.filename);
  const editingActiveRules = Boolean(before.domain.program || before.domain.candidate?.status === 'active');
  if (editingActiveRules) {
    const rules = await openCanvasObject(owner, 'table.rules');
    await rules.getByRole('button', { name: 'Edit rules', exact: true }).click();
  }
  const chat = owner.getByTestId('table-chat-bar');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const send = chat.getByRole('button', { name: 'Send message', exact: true });
  if (editingActiveRules) {
    const cancelRuleEdit = chat.getByRole('button', { name: 'Cancel rule edit', exact: true });
    await expect(cancelRuleEdit).toBeVisible();
    await prompt.fill('Discard this unsent rule edit.');
    await cancelRuleEdit.click();
    await expect(prompt).toHaveValue('');
    await expect(cancelRuleEdit).toHaveCount(0);
    const rules = await openCanvasObject(owner, 'table.rules');
    await rules.getByRole('button', { name: 'Edit rules', exact: true }).click();
  }
  const proposalPrompt = 'Build a shared table from the source, with bounded actions and checks.';
  await prompt.fill(proposalPrompt);
  let modelRequests = 0;
  const countModelRequests = request => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/workspaces/${tableId}/model`)) modelRequests += 1;
  };
  owner.on('request', countModelRequests);
  const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
  if (expectConsent) {
    await send.click();
    await expect(consent).toBeVisible();
    const copy = (await consent.innerText()).replace(/\s+/gu, ' ');
    expect(copy).toMatch(/current active rules, records, and turn|current table context/iu);
    expect(copy).toContain('Table files included');
    expect(copy).toContain('Chat history is not included.');
    expect(copy).toContain('You will not be asked again on this table');
    for (const filename of sourceNames) expect(copy).toContain(filename);
    expect(modelRequests).toBe(0);
    await consent.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(consent).toHaveCount(0);
    await expect(prompt).toHaveValue('Build a shared table from the source, with bounded actions and checks.');
    expect(modelRequests).toBe(0);
    // Cancel grants nothing, so the next Send asks again.
    await send.click();
    await expect(consent).toBeVisible();
    for (const filename of sourceNames) expect((await consent.innerText()).replace(/\s+/gu, ' ')).toContain(filename);
  }
  let releaseProvider = () => {};
  const gate = observePending ? new Promise(resolve => { releaseProvider = resolve; }) : undefined;
  setTableReply({ change, gate, expectedSources: before.domain.sources.map(item => ({ id: item.id, filename: item.filename, text: item.text })) });
  let modelAccepted = false;
  let failedDraftRefresh = false;
  let workspaceRefreshRequests = 0;
  // Keep failing every post-draft refresh until the test observes the failure UI and disarms.
  // The app can refresh more than once (POST response, poll, and retry), and a single armed
  // failure could be consumed by an earlier refresh than the one that renders the card.
  let failRefresh = Boolean(failDraftRefresh);
  const workspaceRoute = async route => {
    if (route.request().method() === 'GET' && modelAccepted) {
      workspaceRefreshRequests += 1;
      if (failDraftRefresh && failRefresh) {
        failedDraftRefresh = true;
        await route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'Synthetic draft refresh failure.' }),
        });
        return;
      }
    }
    await route.continue();
  };
  const workspaceUrl = `**/api/workspaces/${tableId}`;
  const modelUrl = `**/api/workspaces/${tableId}/model`;
  // Arm the refresh failure before the browser sees the 202. Setting it after reading the
  // response in the test raced the app's own refresh on slow CI machines.
  const modelRoute = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const response = await route.fetch();
    if (response.status() === 202) modelAccepted = true;
    await route.fulfill({ response });
  };
  if (failDraftRefresh) {
    await owner.route(workspaceUrl, workspaceRoute);
    await owner.route(modelUrl, modelRoute);
  }
  const providerCallsBefore = failDraftRefresh ? getProviderCalls() : undefined;
  const modelResponse = owner.waitForResponse(response => response.url().endsWith(`/api/workspaces/${tableId}/model`) && response.request().method() === 'POST');
  void modelResponse.catch(() => {});
  // F013: after one grant for this owner on this table epoch, a later rule request sends without asking.
  await (expectConsent ? consent.getByRole('button', { name: 'Send', exact: true }) : send).click();
  if (!expectConsent) await expect(consent).toHaveCount(0);
  let accepted;
  try {
    accepted = await modelResponse;
  } catch (error) {
    throw new Error(`${stepLabel}: model POST did not return`, { cause: error });
  }
  expect(accepted.status()).toBe(202);
  const acceptedJob = await accepted.json();
  modelAccepted = true;
  const draftNode = owner.getByRole('article', { name: /^Build a shared table from the source, with/iu }).first();
  const draftCard = draftNode.getByTestId('table-chat-answer');
  // F039 + dev #156/#157: a draft that passes every check leaves the canvas and becomes a success
  // notice; a draft whose table refresh failed keeps its card so the owner can retry.
  const appliedNotice = owner.locator('.tt-notice--success').filter({ hasText: 'New rules added' });
  try {
    if (observePending || failDraftRefresh) await expect(draftCard).toBeVisible({ timeout: 20_000 });
    if (observePending) {
      try {
        await verifyPendingChatMotion(owner, draftNode, draftCard);
      } finally {
        releaseProvider();
      }
    }
    if (failDraftRefresh) {
      await expect(draftCard).toContainText('The rule draft is ready, but the table could not refresh.', { timeout: 20_000 });
    } else {
      await expect(appliedNotice).toBeVisible({ timeout: 25_000 });
      await expect(draftNode).toHaveCount(0);
      await expect(appliedNotice.getByRole('button', { name: 'View rules', exact: true })).toBeEnabled();
    }
    if (observePending && failDraftRefresh) {
      await expect(draftNode).not.toHaveAttribute('aria-busy', /.*/u);
      await expect(draftNode.locator('.tt-object-glyph')).not.toHaveClass(/\bis-busy\b/u);
    }
  } catch (error) {
    const answerDiagnostics = await owner.getByTestId('table-chat-answer').evaluateAll(cards => cards.map(card => ({
      text: card.textContent?.trim() ?? '',
      statuses: [...card.querySelectorAll('[role="alert"], [role="status"]')].map(node => node.textContent?.trim() ?? ''),
    })));
    const jobStatus = await api(owner, `/api/workspaces/${tableId}/model/${acceptedJob.id}`).catch(statusError => ({
      status: 0,
      body: { message: statusError instanceof Error ? statusError.message : String(statusError) },
    }));
    const jobDetails = {
      id: acceptedJob.id,
      http: jobStatus.status,
      status: jobStatus.body?.status,
      message: jobStatus.body?.message,
      candidateId: jobStatus.body?.candidateId,
    };
    const refreshDiagnostics = { failDraftRefresh, modelAccepted, failedDraftRefresh, workspaceRefreshRequests };
    throw new Error(`${stepLabel}\n${error instanceof Error ? error.message : String(error)}\nAccepted model job: ${JSON.stringify(jobDetails)}\nRefresh arm: ${JSON.stringify(refreshDiagnostics)}\nVisible answer cards: ${JSON.stringify(answerDiagnostics)}`, { cause: error });
  }
  if (failDraftRefresh) {
    const retryRefresh = draftCard.getByRole('button', { name: 'Retry table refresh', exact: true });
    await expect(draftCard.getByRole('alert')).toBeVisible({ timeout: 20_000 });
    await expect(retryRefresh).toBeVisible();
    await expect(draftCard.getByRole('button', { name: 'Review rules', exact: true })).toBeDisabled();
    expect(failedDraftRefresh).toBe(true);
    expect(workspaceRefreshRequests).toBeGreaterThanOrEqual(1);
    expect(getProviderCalls()).toBe(providerCallsBefore + 1);
    const requestsBeforeRetry = workspaceRefreshRequests;
    // The retry must reach the server; stop intercepting right before the click.
    failRefresh = false;
    const refreshResponse = owner.waitForResponse(response => response.url().endsWith(`/api/workspaces/${tableId}`) && response.request().method() === 'GET');
    void refreshResponse.catch(() => {});
    // F039: the draft is already in use, so the live projection adds the new table cards and the canvas
    // focuses them, which can pan the draft card out of view. Wait for that, then go back to the card.
    await expect(owner.locator(`.tt-canvas-node[data-canvas-object="table.collection.${change.program.collections[0].id}"]`)).toHaveCount(1, { timeout: 20_000 });
    const draftObjectId = await draftCard.evaluate(element => element.closest('[data-canvas-object]')?.getAttribute('data-canvas-object'));
    expect(draftObjectId).toBeTruthy();
    const objects = await openObjectsMenu(owner);
    await objects.getByTestId(`open-canvas-${draftObjectId}`).click();
    await expect(retryRefresh).toBeInViewport();
    await retryRefresh.click();
    expect((await refreshResponse).status()).toBe(200);
    await expect(retryRefresh).toHaveCount(0);
    await expect(draftNode).toHaveCount(0, { timeout: 20_000 });
    await expect(appliedNotice).toBeVisible();
    await expect(appliedNotice.getByRole('button', { name: 'View rules', exact: true })).toBeEnabled();
    expect(workspaceRefreshRequests).toBeGreaterThan(requestsBeforeRetry);
    expect(modelRequests).toBe(1);
    expect(getProviderCalls()).toBe(providerCallsBefore + 1);
    await owner.unroute(workspaceUrl, workspaceRoute);
    await owner.unroute(modelUrl, modelRoute);
  }
  // The notice's View rules button resolves but is covered by the fixed topbar in this viewport
  // (dev #156 UI defect, reported separately), so open the same card from the Objects menu instead
  // of force-clicking it; the affordance itself is asserted above.
  await openCanvasObject(owner, 'table.rules');
  await expect(owner.getByTestId('canvas-object-editor')).toHaveAttribute('data-canvas-object', 'table.rules');
  owner.off('request', countModelRequests);
  expect(modelRequests).toBe(1);
  await owner.reload();
  const refreshedRules = await openCanvasObject(owner, 'table.rules');
  await expect(refreshedRules.getByRole('region', { name: 'Current active rules', exact: true })).toBeVisible();
  await expect(refreshedRules.getByRole('region', { name: 'Proposed rules', exact: true })).toHaveCount(0);
  await expect(refreshedRules.getByRole('button', { name: 'Apply to table', exact: true })).toHaveCount(0);
  const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(current.domain.candidate?.status).toBe('active');
  expect(current.domain.ruleRevision).toBe(before.domain.ruleRevision + 1);
  expect(current.domain.program?.title).toBe(change.program.title);
  expect(current.domain.program?.actions.map(action => action.id)).toEqual(change.program.actions.map(action => action.id));
  // A rule edit keeps the records on the table; a first draft starts from its proposed rows.
  if (before.domain.program) expect(current.domain.records).toEqual(before.domain.records);
  else expect(current.domain.records).toEqual(change.initialRecords);
  return current;
}

// F012: the model asks the owner one question with three answers instead of drafting; nothing on the table changes.
// Picking an answer sends a new rule request at once under the table consent.
async function requestClarifyingQuestion(owner, tableId, setTableReply, api) {
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const expectedSources = before.domain.sources.map(item => ({ id: item.id, filename: item.filename, text: item.text }));
  const expectUnchanged = async () => {
    const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(current.revision).toBe(before.revision);
    expect(current.domain.candidate).toEqual(before.domain.candidate);
    expect(current.domain.program).toEqual(before.domain.program);
    expect(current.domain.records).toEqual(before.domain.records);
  };
  const chat = owner.getByTestId('table-chat-bar');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
  const modelPosts = [];
  const recordModelPost = request => {
    if (request.method() === 'POST' && request.url().endsWith(`/api/workspaces/${tableId}/model`)) modelPosts.push(request.postDataJSON());
  };
  owner.on('request', recordModelPost);

  const clarifyPrompt = 'Make a shift table.';
  const clarification = { question: 'Who must agree before two people swap shifts?', options: ['Both people', 'Only the owner', 'Nobody'] };
  await prompt.fill(clarifyPrompt);
  setTableReply({ change: { kind: 'clarify', ...clarification }, expectedSources });
  const firstPost = owner.waitForResponse(response => response.url().endsWith(`/api/workspaces/${tableId}/model`) && response.request().method() === 'POST');
  await chat.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(consent).toBeVisible();
  await consent.getByRole('button', { name: 'Send', exact: true }).click();
  expect((await firstPost).status()).toBe(202);
  const questionArticle = owner.getByRole('article', { name: clarifyPrompt, exact: true });
  const card = questionArticle.getByTestId('table-chat-answer');
  await expect(card).toHaveClass(/tt-chat-card--questions/u, { timeout: 20_000 });
  await expect(card).toContainText('A few details would help build this table. Nothing on the table changed.');
  await expect(card.locator('.tt-chat-card__question')).toHaveText(clarification.question);
  await expect(card).toContainText('Pick one or more answers, or write your own, then send. Your request stays the same.');
  const list = card.getByRole('list', { name: 'Answer choices', exact: true });
  // F022: three AI choices plus "Write my own answer", all multi-select; nothing sends until Send answer.
  await expect(list.getByRole('checkbox')).toHaveCount(4);
  for (const option of clarification.options) await expect(list.getByRole('checkbox', { name: option, exact: true })).toBeEnabled();
  const sendAnswer = card.getByRole('button', { name: 'Send answer', exact: true });
  await expect(sendAnswer).toBeDisabled();
  await list.getByRole('checkbox', { name: 'Write my own answer', exact: true }).check();
  await expect(card.getByRole('textbox', { name: 'Your answer', exact: true })).toBeFocused();
  await expect(sendAnswer).toBeDisabled();
  await list.getByRole('checkbox', { name: 'Write my own answer', exact: true }).uncheck();
  await expect(card.getByRole('textbox', { name: 'Your answer', exact: true })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Review rules', exact: true })).toHaveCount(0);
  await expectUnchanged();
  expect(modelPosts).toHaveLength(1);

  // The follow-up job completes with neither a candidate nor a clarification (the poll response is stripped),
  // so its card must offer the message again instead of Review rules.
  const answeredPrompt = `${clarifyPrompt}\n\n${clarification.question} ${clarification.options[1]}`;
  setTableReply({ change: { kind: 'clarify', question: 'Which shifts exist?', options: ['Morning and evening', 'Three shifts', 'I will attach a file'] }, expectedSources });
  const pollUrl = `**/api/workspaces/${tableId}/model/*`;
  const stripClarification = async route => {
    if (route.request().method() !== 'GET') { await route.continue(); return; }
    const response = await route.fetch();
    const body = await response.json();
    if (body.status === 'completed') {
      expect(body.candidateId).toBeUndefined();
      expect(body.clarification?.question).toBe('Which shifts exist?');
      delete body.clarification;
    }
    await route.fulfill({ response, json: body });
  };
  await owner.route(pollUrl, stripClarification);
  const answerPost = owner.waitForResponse(response => response.url().endsWith(`/api/workspaces/${tableId}/model`) && response.request().method() === 'POST');
  await list.getByRole('checkbox', { name: clarification.options[1], exact: true }).check();
  expect(modelPosts).toHaveLength(1);
  await sendAnswer.click();
  await expect(consent).toHaveCount(0);
  expect((await answerPost).status()).toBe(202);
  expect(modelPosts).toHaveLength(2);
  expect(modelPosts[1]).toMatchObject({ prompt: answeredPrompt, consent: true });
  await expect(questionArticle).toHaveCount(0);
  // Long prompts are shortened with an ellipsis in the card's accessible name.
  const answeredCard = owner.getByRole('article', { name: /^Make a shift table\. Who must agree/u }).getByTestId('table-chat-answer');
  await expect(answeredCard).toBeVisible();
  await expect(answeredCard).toContainText('No rule draft was created. Try rephrasing your request.', { timeout: 20_000 });
  await expect(answeredCard.getByRole('button', { name: 'Review rules', exact: true })).toHaveCount(0);
  await expect(answeredCard.getByRole('list', { name: 'Answer choices', exact: true })).toHaveCount(0);
  await answeredCard.getByRole('button', { name: 'Use this message again', exact: true }).click();
  await expect(prompt).toHaveValue(answeredPrompt);
  await owner.unroute(pollUrl, stripClarification);
  owner.off('request', recordModelPost);
  expect(modelPosts).toHaveLength(2);
  await expectUnchanged();
  await prompt.fill('');
}

// F039: the draft is already in use; the Rules card shows the applied rules with their conditions.
async function inspectAppliedRules(owner, tableId, api, rules) {
  const editor = await openCanvasObject(owner, 'table.rules');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
  const activeRules = editor.getByRole('region', { name: 'Current active rules', exact: true });
  await expect(activeRules).toBeVisible();
  const actionDetails = activeRules.locator('details.tt-table-rule-details').filter({ has: owner.locator('summary').filter({ hasText: /^Actions · / }) });
  if (await actionDetails.getAttribute('open') === null) await actionDetails.locator('summary').click();
  await expect(activeRules.locator('.tt-table-rule-list')).toHaveCount(rules.length);
  for (const rule of rules) {
    const action = activeRules.locator('.tt-table-program__group').filter({ hasText: rule.action });
    await expect(action).toHaveCount(1);
    await expect(action.getByRole('button', { name: `Remove ${rule.action}`, exact: true })).toBeVisible();
    const conditionRows = action.locator('.tt-table-rule-list li');
    await expect(conditionRows).toHaveCount(rule.rows.length);
    for (let index = 0; index < rule.rows.length; index += 1) {
      const row = conditionRows.nth(index);
      await expect(row.locator('strong')).toHaveText(rule.rows[index].predicate);
      await expect(row.locator('span')).toHaveText(rule.rows[index].message);
    }
  }
  const active = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(active.domain.candidate?.status).toBe('active');
  expect(active.domain.program).toBeTruthy();
  await expect(owner.getByTestId('table-chat-bar')).toBeVisible();
  return active;
}

// F039: the owner takes one action out from the Rules card; a collection asks before its rows go too.
async function removeActionFromRules(owner, tableId, api, { actionTitle, actionId, collectionTitle }) {
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const editor = await openCanvasObject(owner, 'table.rules');
  const activeRules = editor.getByRole('region', { name: 'Current active rules', exact: true });
  const actionDetails = activeRules.locator('details.tt-table-rule-details').filter({ has: owner.locator('summary').filter({ hasText: /^Actions · / }) });
  if (await actionDetails.getAttribute('open') === null) await actionDetails.locator('summary').click();
  const removed = owner.waitForResponse(response => isCommandResponse(response, 'evolve.removeItem'));
  await activeRules.getByRole('button', { name: `Remove ${actionTitle}`, exact: true }).click();
  expect((await removed).status()).toBe(200);
  await expect(activeRules.locator('.tt-table-program__group').filter({ hasText: actionTitle })).toHaveCount(0);
  await expect(activeRules.getByRole('button', { name: `Remove ${actionTitle}`, exact: true })).toHaveCount(0);
  const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(after.domain.program.actions.map(action => action.id)).not.toContain(actionId);
  expect(after.domain.ruleRevision).toBe(before.domain.ruleRevision + 1);
  expect(after.domain.records).toEqual(before.domain.records);
  // Removing a table asks first; Cancel keeps it and its rows.
  const dataFields = activeRules.locator('details.tt-table-rule-details').filter({ has: owner.locator('summary').filter({ hasText: /^Data fields · / }) });
  if (await dataFields.getAttribute('open') === null) await dataFields.locator('summary').click();
  await activeRules.getByRole('button', { name: `Remove ${collectionTitle}`, exact: true }).click();
  const confirm = editor.getByRole('alertdialog', { name: `Remove ${collectionTitle}`, exact: true });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('button', { name: 'Remove table and rows', exact: true })).toBeVisible();
  await confirm.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(confirm).toHaveCount(0);
  expect((await api(owner, `/api/workspaces/${tableId}`)).body.domain.ruleRevision).toBe(after.domain.ruleRevision);
  return after;
}

// F003-T5: data tables on the Worker invite through the reusable link only; the seat picker is gone.
async function shareInviteLink(owner) {
  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'People at this table' });
  await expect(dialog.getByText('AVAILABLE SEATS', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /^Create invitation for/u })).toHaveCount(0);
  const panel = dialog.getByRole('region', { name: 'INVITE LINK' });
  const turnOn = panel.getByRole('button', { name: 'Turn on invite link', exact: true });
  await expect(turnOn.or(panel.getByLabel('Invite link'))).toBeVisible();
  if (await turnOn.isVisible()) {
    const created = owner.waitForResponse((response) => response.url().endsWith('/invite-link') && response.request().method() === 'POST');
    await turnOn.click();
    expect((await created).status()).toBe(201);
  }
  const url = await panel.getByLabel('Invite link').inputValue();
  expect(url).toContain('#invite=link%3A');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return url;
}

async function turnOnInviteLink(owner) {
  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'People at this table' });
  await expect(dialog.getByLabel('Seats in use')).toHaveText('0/7 members');
  const panel = dialog.getByRole('region', { name: 'INVITE LINK' });
  await panel.getByLabel('Expires after').selectOption('7');
  const created = owner.waitForResponse((response) => response.url().endsWith('/invite-link') && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Turn on invite link', exact: true }).click();
  expect((await created).status()).toBe(201);
  const url = await panel.getByLabel('Invite link').inputValue();
  expect(url).toContain('#invite=link%3A');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  return url;
}

async function turnOffInviteLink(owner) {
  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'People at this table' });
  await expect(dialog.getByLabel('Seats in use')).toHaveText('1/7 members');
  const panel = dialog.getByRole('region', { name: 'INVITE LINK' });
  await panel.getByRole('button', { name: 'Turn off link', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Turn on invite link', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

async function joinAndCheckSharedFiles(newPage, api, actor, inviteUrl, tableId, filename, owner) {
  const page = await newPage(actor, inviteUrl);
  await expect(page.locator('.tt-canvas-panel')).toBeVisible();
  const workspace = await api(page, `/api/workspaces/${tableId}`);
  expect(workspace.status).toBe(200);
  // F008: members read the table files. F015 open visibility: members also read the owner's draft and
  // draft history (was: hidden from members), so the member's copy matches the owner's.
  expect(workspace.body.domain.sources.map((source) => source.filename)).toContain(filename);
  const ownerDomain = (await api(owner, `/api/workspaces/${tableId}`)).body.domain;
  expect(workspace.body.domain.candidate).toEqual(ownerDomain.candidate);
  expect(workspace.body.domain.revisions).toEqual(ownerDomain.revisions);
  expect(workspace.body.domain.program?.evidence).toEqual(ownerDomain.program?.evidence);
  const files = page.locator('[data-canvas-object="table.sources"]');
  await expect(files).toContainText(filename);
  await expect(page.getByRole('button', { name: `Remove ${filename}`, exact: true })).toHaveCount(0);
  const chat = page.getByTestId('table-chat-bar');
  await expect(chat).toBeVisible();
  await expect(chat.getByRole('button', { name: 'Attach a file', exact: true })).toBeEnabled();
  await expect(chat.getByRole('button', { name: 'Send message', exact: true })).toBeDisabled();
  await openCanvasObject(page, 'table.rules');
  await expect(page.getByTestId('canvas-object-editor').getByRole('region', { name: 'Current active rules', exact: true })).toBeVisible();
  await openCanvasObject(page, 'table.actions');
  await expect(page.getByTestId('canvas-object-editor').locator('.tt-table-action-picker')).toBeVisible();
  return page;
}

// F007: every member sees table-wide cards at the same place.
async function nodeTransforms(page, ids) {
  return page.evaluate((nodeIds) => Object.fromEntries(nodeIds.map((id) => {
    const element = document.querySelector(`.react-flow__node[data-id="${CSS.escape(id)}"]`);
    return [id, element instanceof HTMLElement ? element.style.transform : null];
  })), ids);
}

async function verifyLiveCursor(owner, member) {
  // F009: the owner's pointer appears on the member's canvas with the owner's name, then leaves.
  const ownerSession = await owner.evaluate(async () => (await fetch('/api/session')).json());
  const ownerName = ownerSession?.name ?? '';
  const box = await owner.getByTestId('canvas-object-workspace').boundingBox();
  if (!box) throw new Error('Owner canvas is not visible.');
  // The member's own pointer may still rest on its canvas from earlier clicks; move it away first.
  await member.mouse.move(0, 0);
  const cursor = member.locator(`[data-testid="live-cursor"][data-actor-id="${ownerSession.actorId}"]`);
  await expect.poll(async () => {
    await owner.mouse.move(box.x + box.width / 2 + Math.random() * 40, box.y + box.height / 2);
    return cursor.count();
  }, { timeout: 10_000 }).toBe(1);
  if (ownerName) await expect(cursor).toContainText(ownerName);
  await expect(owner.locator(`[data-testid="live-cursor"][data-actor-id="${ownerSession.actorId}"]`)).toHaveCount(0);
  await owner.mouse.move(box.x + box.width + 40, box.y - 40);
  await expect(cursor).toHaveCount(0);
}

async function verifySharedCardLayout(owner, member, tableId, api) {
  const shared = ['table.sources', 'table.rules', 'table.actions', 'table.collection.equipment', 'workspace.people', 'workspace.history'];
  // These auxiliary cards are created after activation. Materialize them through
  // the Objects menu so late-card layout seeding is exercised without a reload.
  for (const page of [owner, member]) {
    for (const id of shared) await openCanvasObject(page, id);
  }
  await expect.poll(async () => {
    const ownerView = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const memberView = (await api(member, `/api/workspaces/${tableId}`)).body;
    const ownerLayout = ownerView.domain.canvasLayout?.positions ?? {};
    const memberLayout = memberView.domain.canvasLayout?.positions ?? {};
    return shared.every((id) => ownerLayout[id] && JSON.stringify(ownerLayout[id]) === JSON.stringify(memberLayout[id]));
  }, { timeout: 15_000 }).toBe(true);
  const beforeReload = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const memberBeforeReload = (await api(member, `/api/workspaces/${tableId}`)).body;
  const canonical = Object.fromEntries(shared.map(id => [id, beforeReload.domain.canvasLayout.positions[id]]));
  expect(memberBeforeReload.domain.canvasLayout.positions).toMatchObject(canonical);
  for (const domain of [beforeReload.domain, memberBeforeReload.domain]) {
    expect(Object.keys(domain.canvasLayout?.positions ?? {}).some(id => id.startsWith('chat.'))).toBe(false);
  }
  // F008: the Files card and its files are shared with members.
  expect(memberBeforeReload.domain.sources).toEqual(beforeReload.domain.sources);
  await expect.poll(async () => JSON.stringify(await nodeTransforms(member, shared)), { timeout: 10_000 })
    .toBe(JSON.stringify(await nodeTransforms(owner, shared)));
  await owner.reload(); await member.reload();
  for (const page of [owner, member]) {
    for (const id of shared) await openCanvasObject(page, id);
  }
  await expect.poll(async () => JSON.stringify(await nodeTransforms(member, shared)), { timeout: 10_000 })
    .toBe(JSON.stringify(await nodeTransforms(owner, shared)));
  const afterReload = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(afterReload.domain.canvasLayout.positions).toMatchObject(canonical);
  await expect.poll(async () => JSON.stringify(await nodeTransforms(member, shared)), { timeout: 10_000 })
    .toBe(JSON.stringify(await nodeTransforms(owner, shared)));
  const beforeMove = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const historyEditor = await openCanvasObject(owner, 'workspace.history');
  // Clicking the card header selects it; an arrow key then moves it one grid step and saves it like a drag.
  await historyEditor.locator('.tt-canvas-node__head .tt-canvas-node__title').click();
  const moveResponse = owner.waitForResponse(response => isCommandResponse(response, 'canvas.layout'));
  void moveResponse.catch(() => {});
  await owner.keyboard.press('ArrowDown');
  expect((await moveResponse).status()).toBe(200);
  await expect(owner.locator('.tt-canvas-visually-hidden[role="status"]')).toHaveText('Table history moved down.');
  const after = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(after.domain.canvasLayout.positions['workspace.history']).toMatchObject({
    x: beforeMove.domain.canvasLayout.positions['workspace.history'].x,
    y: beforeMove.domain.canvasLayout.positions['workspace.history'].y + 48,
    pinned: true,
  });
  await expect.poll(async () => (await nodeTransforms(member, ['workspace.history']))['workspace.history'], { timeout: 10_000 })
    .toBe(`translate(${after.domain.canvasLayout.positions['workspace.history'].x}px, ${after.domain.canvasLayout.positions['workspace.history'].y}px)`);
  expect(after.domain.records).toEqual(beforeMove.domain.records);
  expect(after.domain.dataRevision).toBe(beforeMove.domain.dataRevision);
}

async function createBlankTableFromPicker(page) {
  const readyNotice = page.locator('.tt-notice').filter({ hasText: 'Shared data table is ready.' });
  if (await readyNotice.count()) await readyNotice.getByRole('button', { name: 'Dismiss message' }).click();
  await expect(readyNotice).toHaveCount(0);
  const created = page.waitForResponse(response => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  void created.catch(() => {});
  await page.locator('.tt-workspace-picker__button').click();
  await page.locator('.tt-workspace-menu').getByRole('menuitem', { name: /New table/u }).click();
  const startPage = page.getByTestId('start-page');
  await expect(startPage.getByRole('heading', { name: 'What should we start with?' })).toBeVisible();
  await startPage.getByRole('button', { name: 'Start empty with your own files', exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const table = await response.json();
  await expect(page).toHaveURL(new RegExp(`/t/${table.id}$`));
  const visibleTitle = await page.locator('.tt-workspace-picker__button strong').innerText();
  await expect(page.locator('.tt-canvas-node')).toHaveCount(0);
  await expect(readyNotice).toBeVisible();
  await expect(page.locator('.tt-workspace-picker__button')).toHaveAttribute('aria-expanded', 'false');
  return { ...table, visibleTitle };
}

async function selectOtherTable(page, title, tableId) {
  const picker = page.locator('.tt-workspace-picker__button');
  await picker.click();
  const target = page.locator('.tt-workspace-menu > button[role="menuitem"]:not(.is-current)').filter({ hasText: title });
  await expect(target).toHaveCount(1);
  await target.click();
  await expect(page).toHaveURL(new RegExp(`/t/${tableId}$`));
  await expect(page.locator('.tt-canvas-panel')).toBeVisible();
}

async function verifyDelayedLayoutAckDoesNotCrossTables({ owner, tableId, api, privatePrompt, privateAnswer, capabilities, getProviderCalls, mark }) {
  expect(capabilities).toMatchObject({ modelEnabled: true });
  const original = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const originalVisibleTitle = await owner.locator('.tt-workspace-picker__button strong').innerText();
  const otherTable = await createBlankTableFromPicker(owner);
  await selectOtherTable(owner, originalVisibleTitle, tableId);
  const chat = owner.getByTestId('table-chat-bar');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const send = chat.getByRole('button', { name: 'Send message', exact: true });
  const pendingPrompt = 'Can I ask a question while this table is being arranged?';
  await prompt.fill(pendingPrompt);
  await expect(send).toBeEnabled();

  let modelPosts = 0;
  let assistantPosts = 0;
  const countPrivatePosts = request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/model')) modelPosts += 1;
    if (path.endsWith('/assistant')) assistantPosts += 1;
  };
  owner.on('request', countPrivatePosts);
  await openCanvasObject(owner, 'table.actions');
  const actionNode = owner.getByTestId('canvas-object-editor');
  await actionNode.locator('.tt-canvas-node__head .tt-canvas-node__title').click();

  let releaseAck;
  const ackGate = new Promise(resolve => { releaseAck = resolve; });
  let acceptedResolve;
  const serverAccepted = new Promise(resolve => { acceptedResolve = resolve; });
  let heldAck = false;
  let layoutCommand;
  const commandUrl = `**/api/workspaces/${tableId}/commands`;
  const holdLayoutAck = async route => {
    const request = route.request();
    if (heldAck || request.method() !== 'POST' || request.postDataJSON()?.type !== 'canvas.layout') return route.continue();
    heldAck = true;
    layoutCommand = request.postDataJSON();
    const response = await route.fetch();
    acceptedResolve(response.status());
    await ackGate;
    await route.fulfill({ response });
  };
  await owner.route(commandUrl, holdLayoutAck);
  const layoutResponse = owner.waitForResponse(response => isCommandResponse(response, 'canvas.layout'));
  void layoutResponse.catch(() => {});
  try {
    await owner.keyboard.press('ArrowRight');
    expect(await Promise.race([serverAccepted, layoutResponse.then(response => response.status())])).toBe(200);
    const accepted = (await api(owner, `/api/workspaces/${tableId}`)).body;
    const acceptedPoint = accepted.domain.canvasLayout.positions['table.actions'];
    expect(acceptedPoint.x).toBe(original.domain.canvasLayout.positions['table.actions'].x + 48);
    expect(acceptedPoint.pinned).toBe(true);

    const pendingLayoutState = {
      capabilities,
      promptDisabled: await prompt.isDisabled(),
      sendDisabled: await send.isDisabled(),
      prompt: await prompt.inputValue(),
      layoutCommand,
    };
    if (pendingLayoutState.promptDisabled || pendingLayoutState.sendDisabled) {
      throw new Error(`A server-accepted canvas.layout ACK disabled chat before completion: ${JSON.stringify(pendingLayoutState)}`);
    }
    await expect(prompt).toBeEnabled();
    await expect(send).toBeEnabled();
    // F013: this owner already consented on this table epoch, so Send goes straight out. The request is
    // answered here so nothing reaches the server or the provider while the layout ACK is held.
    const callsBeforePendingAsk = getProviderCalls();
    const pendingAskBodies = [];
    const assistantUrl = `**/api/workspaces/${tableId}/assistant`;
    const stopPendingAsk = async route => {
      if (route.request().method() !== 'POST') return route.continue();
      pendingAskBodies.push(route.request().postDataJSON());
      await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic question stop during a held layout ACK.' }) });
    };
    await owner.route(assistantUrl, stopPendingAsk);
    try {
      const pendingAskResponse = owner.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/api/workspaces/${tableId}/assistant`) && response.request().method() === 'POST');
      void pendingAskResponse.catch(() => {});
      await send.click();
      expect((await pendingAskResponse).status()).toBe(422);
    } finally {
      await owner.unroute(assistantUrl, stopPendingAsk);
    }
    const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
    await expect(consent).toHaveCount(0);
    expect(pendingAskBodies).toHaveLength(1);
    expect(pendingAskBodies[0]).toMatchObject({ prompt: pendingPrompt, consent: true });
    await expect(prompt).toHaveValue(pendingPrompt);
    expect(modelPosts).toBe(0);
    expect(assistantPosts).toBe(1);
    expect(getProviderCalls()).toBe(callsBeforePendingAsk);
    mark(`Layout/chat concurrency: enabled model capabilities were restored at ${capabilities.receivedAt}; accepted canvas.layout ACK left the composer enabled, and Send under the earlier table grant went out once with consent and no provider call.`);

    await selectOtherTable(owner, otherTable.visibleTitle, otherTable.id);
    await expect(owner.getByTestId('table-chat-answer')).toHaveCount(0);
    await expect(owner.locator('.tt-canvas-node')).toHaveCount(0);
    const otherState = (await api(owner, `/api/workspaces/${otherTable.id}`)).body;
    expect(otherState.domain.canvasLayout?.positions?.['table.actions']).toBeUndefined();

    releaseAck();
    expect((await layoutResponse).status()).toBe(200);
    await expect(owner).toHaveURL(new RegExp(`/t/${otherTable.id}$`));
    await expect(owner.locator('.tt-canvas-node')).toHaveCount(0);
    expect((await api(owner, `/api/workspaces/${otherTable.id}`)).body.domain.canvasLayout?.positions?.['table.actions']).toBeUndefined();
    // The grant belongs to the first table only: the same owner on another table is asked again.
    const otherTablePrompt = 'Draft rules for this other table.';
    await prompt.fill(otherTablePrompt);
    await expect(send).toBeEnabled();
    await send.click();
    await expect(consent).toBeVisible();
    expect((await consent.innerText()).replace(/\s+/gu, ' ')).toContain('You will not be asked again on this table');
    await consent.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(consent).toHaveCount(0);
    await expect(prompt).toHaveValue(otherTablePrompt);
    await prompt.fill('');
    expect(modelPosts).toBe(0);
    expect(assistantPosts).toBe(1);
    expect(getProviderCalls()).toBe(callsBeforePendingAsk);

    await selectOtherTable(owner, originalVisibleTitle, tableId);
    const privateArticle = owner.getByRole('article', { name: privatePrompt, exact: true });
    await expect(privateArticle.getByTestId('table-chat-answer')).toContainText(privateAnswer);
    const resumed = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(resumed.domain.canvasLayout.positions['table.actions']).toEqual(acceptedPoint);
    expect(Object.keys(resumed.domain.canvasLayout.positions).some(id => id.startsWith('chat.'))).toBe(false);
    await openCanvasObject(owner, 'table.actions');
    await expect.poll(async () => (await nodeTransforms(owner, ['table.actions']))['table.actions'], { timeout: 10_000 })
      .toBe(`translate(${acceptedPoint.x}px, ${acceptedPoint.y}px)`);
  } finally {
    releaseAck();
    await owner.unroute(commandUrl, holdLayoutAck);
    owner.off('request', countPrivatePosts);
  }
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

async function askTableAssistant(page, promptText, syntheticReply, setAssistantReply, { cancelFirst = false, loseFirstAck = false, beforeRetry, expectConsent = true } = {}) {
  const chat = page.getByTestId('table-chat-bar');
  const matchingPromptCards = () => page.locator('.tt-canvas-node--auxiliary')
    .filter({ hasText: promptText.slice(0, 36) });
  const answerCardForPrompt = () => matchingPromptCards()
    .getByTestId('table-chat-answer');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const send = chat.getByRole('button', { name: 'Send message', exact: true });
  await expect(prompt).toBeVisible();
  await prompt.fill(promptText);
  await expect(send).toBeEnabled();
  const consent = chat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
  let assistantRequests = 0;
  let modelRequests = 0;
  const assistantBodies = [];
  let lostAckStatus;
  const countRequests = request => {
    if (request.method() !== 'POST') return;
    const path = new URL(request.url()).pathname;
    if (path.endsWith('/assistant')) assistantRequests += 1;
    if (path.endsWith('/model')) modelRequests += 1;
  };
  const assistantRoute = async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    assistantBodies.push(request.postDataJSON());
    const response = await route.fetch();
    if (loseFirstAck && assistantBodies.length === 1) {
      lostAckStatus = response.status();
      await route.abort('connectionreset');
      return;
    }
    await route.fulfill({ response });
  };
  page.on('request', countRequests);
  try {
    if (expectConsent) {
      await send.click();
      await expect(consent).toBeVisible();
      const copy = (await consent.innerText()).replace(/\s+/gu, ' ');
      expect(copy).toMatch(/current active rules, records, and turn|current table context/iu);
      expect(copy).toContain('up to six of your recent chat exchanges, including relevant older ones when available');
      expect(copy).toContain('Everyone at this table can see your questions, the answers and rule drafts.');
      expect(copy).toContain('Table files are not sent.');
      expect(copy).toContain('You will not be asked again on this table');
      expect(assistantRequests).toBe(0);
      expect(modelRequests).toBe(0);
    }
    if (expectConsent && cancelFirst) {
      await consent.getByRole('button', { name: 'Cancel', exact: true }).click();
      await expect(consent).toHaveCount(0);
      await expect(prompt).toHaveValue(promptText);
      expect(assistantRequests).toBe(0);
      expect(modelRequests).toBe(0);
      await send.click();
      await expect(consent).toBeVisible();
    }
    setAssistantReply(syntheticReply);
    if (loseFirstAck) await page.route('**/api/workspaces/*/assistant', assistantRoute);
    const initialResponsePromise = loseFirstAck ? null : page.waitForResponse(candidate => candidate.url().endsWith('/assistant') && candidate.request().method() === 'POST');
    if (initialResponsePromise) void initialResponsePromise.catch(() => {});
    // F013: once this actor consented on this table epoch (in either mode), Send goes straight to the assistant.
    await (expectConsent ? consent.getByRole('button', { name: 'Send', exact: true }) : send).click();
    if (!expectConsent) await expect(consent).toHaveCount(0);
    let response;
    if (loseFirstAck) {
      await expect(matchingPromptCards()).toHaveCount(1);
      const failedCard = answerCardForPrompt();
      await expect(failedCard).toBeVisible({ timeout: 20_000 });
      await expect(failedCard.getByRole('button', { name: 'Retry same request', exact: true })).toBeVisible({ timeout: 20_000 });
      await expect(failedCard).toContainText('connection was lost before the request could be confirmed');
      expect([200, 202]).toContain(lostAckStatus);
      expect(assistantBodies).toHaveLength(1);
      if (beforeRetry) await beforeRetry(assistantBodies[0]);
      const retryResponsePromise = page.waitForResponse(candidate => candidate.url().endsWith('/assistant') && candidate.request().method() === 'POST');
      void retryResponsePromise.catch(() => {});
      const failedNodeId = await failedCard.evaluate(element => element.closest('.react-flow__node')?.getAttribute('data-id'));
      expect(failedNodeId).toMatch(/^chat\./u);
      await openCanvasObject(page, failedNodeId);
      await expect(failedCard).toBeVisible();
      await failedCard.scrollIntoViewIfNeeded();
      await failedCard.getByRole('button', { name: 'Retry same request', exact: true }).click();
      try {
        response = await retryResponsePromise;
      } catch (error) {
        throw new Error(`Table assistant retry did not return: ${promptText}`, { cause: error });
      }
      expect(assistantBodies).toHaveLength(2);
      expect(assistantBodies[1]).toEqual(assistantBodies[0]);
      expect(assistantBodies[1].prompt).toBe(promptText);
    } else {
      try {
        response = await initialResponsePromise;
      } catch (error) {
        throw new Error(`Table assistant request did not return: ${promptText}`, { cause: error });
      }
    }
    expect([200, 202]).toContain(response.status());
    await expect.poll(() => modelRequests).toBe(0);
    const answer = answerCardForPrompt();
    await expect(answer).toBeVisible({ timeout: 20_000 });
    await expect(answer).toContainText(syntheticReply.result.text, { timeout: 20_000 });
    expect(assistantRequests).toBe(loseFirstAck ? 2 : 1);
    expect(modelRequests).toBe(0);
    return answer;
  } finally {
    page.off('request', countRequests);
    if (loseFirstAck) await page.unroute('**/api/workspaces/*/assistant', assistantRoute);
  }
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

async function verifyParticipantConversation({ owner, member, tableId, source, api, setAssistantReply, getProviderCalls, capabilities, mark }) {
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
  const rehydratedMemberNode = member.getByRole('article', { name: firstPrompt, exact: true });
  const rehydratedMemberAnswer = rehydratedMemberNode.getByTestId('table-chat-answer');
  await expect(rehydratedMemberNode).toBeVisible();
  await expect(rehydratedMemberAnswer).toContainText(firstText);
  const followup = 'Does that apply to every item in the list?';
  const followupReply = {
    result: { kind: 'explanation', text: 'Yes. Each equipment row follows the same active availability check.', references: [{ kind: 'field', collectionId: 'equipment', id: 'available' }] },
    expectedRole: 'participant', expectedSeat: 'member-1', expectedConversationCount: 1,
    expectedConversationContains: [firstPrompt, firstText], expectedPromptContains: followup,
    forbiddenTexts: forbidden,
  };
  const beforeFollowup = (await api(member, `/api/workspaces/${tableId}`)).body;
  // The member's grant survived the reload, so the follow-up does not ask again.
  await askTableAssistant(member, followup, followupReply, setAssistantReply, { expectConsent: false });
  expect(getProviderCalls()).toBe(initialCalls + 2);
  const afterFollowup = (await api(member, `/api/workspaces/${tableId}`)).body;
  expect(afterFollowup.revision).toBe(beforeFollowup.revision);
  expect(afterFollowup.domain.records).toEqual(beforeFollowup.domain.records);

  // F015 open visibility: a different actor at the same room sees the member's chat, labelled with the
  // asker (was: only their own history). The AI context sent for the owner's question stays the owner's own.
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
  // F038: another member's card is titled with the prompt; the asker's name is a muted subtitle under it.
  const memberCardForOwner = owner.getByRole('article', { name: firstPrompt, exact: true });
  await expect(memberCardForOwner).toBeVisible();
  await expect(memberCardForOwner.locator('.tt-canvas-node__subtitle')).toHaveText(profile.actor.name);
  await expect(memberCardForOwner.getByTestId('table-chat-answer')).toContainText(firstText);
  await expect(memberCardForOwner.locator('.tt-chat-card__asker')).toHaveText(`Asked by ${profile.actor.name}`);
  // The owner consented for a rule draft on this table epoch; one grant also covers questions.
  await askTableAssistant(owner, ownerPrompt, ownerReply, setAssistantReply, { expectConsent: false });
  expect(getProviderCalls()).toBe(ownerCalls + 1);
  expect((await api(owner, `/api/workspaces/${tableId}`)).body.revision).toBe(ownerProfile.revision);
  await verifyDelayedLayoutAckDoesNotCrossTables({
    owner, tableId, api, privatePrompt: ownerPrompt, privateAnswer: ownerReply.result.text,
    capabilities, getProviderCalls, mark,
  });
  // The member sees the owner's card too, labelled with the owner as the asker.
  await member.reload();
  const ownerCardForMember = member.getByRole('article', { name: ownerPrompt, exact: true });
  await expect(ownerCardForMember.locator('.tt-canvas-node__subtitle')).toHaveText(ownerProfile.actor.name);
  await expect(ownerCardForMember.getByTestId('table-chat-answer')).toContainText(ownerReply.result.text);
  await expect(ownerCardForMember.locator('.tt-chat-card__asker')).toHaveText(`Asked by ${ownerProfile.actor.name}`);
  await expect(member.getByRole('article', { name: firstPrompt, exact: true }).locator('.tt-chat-card__asker')).toHaveCount(0);
  await expect(member.getByRole('article', { name: firstPrompt, exact: true }).locator('.tt-canvas-node__subtitle')).toHaveCount(0);

  const providerCallsBeforeArchive = getProviderCalls();
  const archived = await seedConversationPage({ page: member, tableId, profile: afterFollowup, api, setAssistantReply });
  expect(getProviderCalls()).toBe(providerCallsBeforeArchive + archived.length);
  await member.reload();
  const restored = member.getByTestId('table-chat-answer');
  const newestHistoryNode = member.getByRole('article', { name: archived[20].prompt, exact: true });
  await expect(newestHistoryNode).toBeVisible();
  await expect(newestHistoryNode.getByTestId('table-chat-answer')).toContainText(archived[20].answer);
  await expect(member.getByRole('article', { name: archived[0].prompt, exact: true })).toHaveCount(0);
  const callsBeforeHistoryRead = getProviderCalls();
  await expect(restored).toHaveCount(6);
  expect(getProviderCalls()).toBe(callsBeforeHistoryRead);
}

async function equipmentScenario({ owner, member, secondMember, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  let capabilities;
  const room = await openNewTable(owner, api);
  await owner.setViewportSize({ width: 390, height: 844 });
  const canvasBox = await owner.locator('.tt-canvas-panel').boundingBox();
  const chatBox = await owner.getByTestId('table-chat-bar').boundingBox();
  expect(canvasBox).toBeTruthy();
  expect(chatBox).toBeTruthy();
  expect(chatBox.x).toBeGreaterThanOrEqual(canvasBox.x - 1);
  expect(chatBox.y).toBeGreaterThanOrEqual(canvasBox.y - 1);
  expect(chatBox.x + chatBox.width).toBeLessThanOrEqual(canvasBox.x + canvasBox.width + 1);
  expect(chatBox.y + chatBox.height).toBeLessThanOrEqual(canvasBox.y + canvasBox.height + 1);
  expect(chatBox.width).toBeLessThanOrEqual(370);
  expect(canvasBox.height).toBeGreaterThan(100);
  expect(await owner.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const mobileComposer = owner.getByTestId('table-chat-bar').getByRole('textbox', { name: 'Message', exact: true });
  await expect(mobileComposer).toHaveAttribute('rows', '1');
  await mobileComposer.fill(Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n'));
  await expect.poll(() => mobileComposer.evaluate(element => element.clientHeight)).toBeLessThanOrEqual(110);
  await mobileComposer.fill('');
  await owner.setViewportSize({ width: 1280, height: 820 });
  const source = await addSource(owner, room.id, fixtures.equipment, api, 'chat', {
    aiDisabled: true,
    onCapabilitiesReady: ready => { capabilities = ready; },
  });
  await requestProposal(owner, room.id, source, buildChange('equipment', source.id), setTableReply, api, { failDraftRefresh: true, getProviderCalls });
  let active = await inspectAppliedRules(owner, room.id, api, expectedRules.equipment);
  expect(active.domain.records.equipment).toHaveLength(2);

  // F015: the owner imports rows straight into the active collection, with no model call or consent.
  const callsBeforeImport = getProviderCalls();
  const collectionEditor = await openCanvasObject(owner, 'table.collection.equipment');
  await collectionEditor.getByRole('button', { name: 'Import rows', exact: true }).click();
  await collectionEditor.getByRole('textbox', { name: 'Or paste CSV', exact: true }).fill('name,available,borrower,borrow_note\nMegaphone,yes,,Imported in bulk\nSpare tripod,no,owner,');
  await expect(collectionEditor.getByText('2 rows ready · 0 invalid', { exact: true })).toBeVisible();
  await collectionEditor.getByRole('button', { name: 'Import 2 rows', exact: true }).click();
  await expect(collectionEditor.getByText('Imported 2 rows into Equipment.', { exact: true })).toBeVisible();
  await expect.poll(async () => (await api(owner, `/api/workspaces/${room.id}`)).body.domain.records.equipment.length).toBe(4);
  await expect(collectionEditor.getByText('Megaphone', { exact: true })).toBeVisible();
  expect(getProviderCalls()).toBe(callsBeforeImport);

  const callsBeforeSecondSource = getProviderCalls();
  await addSource(owner, room.id, equipmentNotes, api, 'chat', { aiDisabled: true, failHistory: true });
  expect(getProviderCalls()).toBe(callsBeforeSecondSource);
  const ownerRules = await openCanvasObject(owner, 'table.rules');
  await ownerRules.getByRole('button', { name: 'Edit rules', exact: true }).click();
  const ownerChat = owner.getByTestId('table-chat-bar');
  const ownerPrompt = ownerChat.getByRole('textbox', { name: 'Message', exact: true });
  // F013: the owner already consented on this table epoch, so a file added later does not ask again;
  // the rule request is sent at once. The request is answered here without reaching the server or the
  // provider, so the test leaves no draft behind.
  const laterFilePrompt = 'Check that a file added later is sent without asking again.';
  await ownerPrompt.fill(laterFilePrompt);
  const laterFileBodies = [];
  const laterFileUrl = `**/api/workspaces/${room.id}/model`;
  const laterFileRoute = async route => {
    if (route.request().method() !== 'POST') return route.continue();
    laterFileBodies.push(route.request().postDataJSON());
    await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ message: 'Synthetic draft stop after the consent check.' }) });
  };
  await owner.route(laterFileUrl, laterFileRoute);
  try {
    const laterFileResponse = owner.waitForResponse(response => response.url().endsWith(`/api/workspaces/${room.id}/model`) && response.request().method() === 'POST');
    void laterFileResponse.catch(() => {});
    await ownerChat.getByRole('button', { name: 'Send message', exact: true }).click();
    expect((await laterFileResponse).status()).toBe(422);
  } finally {
    await owner.unroute(laterFileUrl, laterFileRoute);
  }
  await expect(ownerChat.getByRole('alertdialog', { name: 'Send to AI', exact: true })).toHaveCount(0);
  expect(laterFileBodies).toHaveLength(1);
  expect(laterFileBodies[0]).toMatchObject({ prompt: laterFilePrompt, consent: true, expectedEpoch: active.epoch });
  await expect(ownerPrompt).toHaveValue(laterFilePrompt);
  expect(getProviderCalls()).toBe(callsBeforeSecondSource);
  const cancelRuleEdit = ownerChat.getByRole('button', { name: 'Cancel rule edit', exact: true });
  await expect(cancelRuleEdit).toBeVisible();
  await cancelRuleEdit.click();
  await expect(cancelRuleEdit).toHaveCount(0);
  await expect(ownerPrompt).toHaveValue('');
  // Drop the local failed-request card; the grant itself is remembered across the reload.
  await owner.reload();
  await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
  expect(await owner.evaluate(() => JSON.parse(window.localStorage.getItem('tabletop.aiConsent.v1') ?? '[]').length)).toBe(1);

  const firstInvite = await shareInviteLink(owner);
  member = await joinAndCheckSharedFiles(newPage, api, member, firstInvite, room.id, source.filename, owner);
  await verifySharedCardLayout(owner, member, room.id, api);
  await verifyLiveCursor(owner, member);
  mark('Shared card layout: rules, people, history and table cards sit at the same place for owner and member, and a move reaches the other screen live');
  await verifyParticipantConversation({ owner, member, tableId: room.id, source, api, setAssistantReply, getProviderCalls, capabilities, mark });
  mark('Generic table chat: explicit consent, shared answer history labelled "Asked by" (F015 open visibility; was: participant-only), asker-only AI context, grounded reference, reload continuity, and no table mutation');
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
  await expandedEquipment.getByRole('button', { name: /^Minimize /u }).click();
  const equipmentPreview = member.locator('.tt-canvas-node[data-canvas-object="table.collection.equipment"] .tt-table-collection__preview');
  await expect(equipmentPreview).toContainText(`Borrower: ${active.actor.name}`);
  await expect(equipmentPreview).not.toContainText(active.actor.actorId);

  const secondInvite = await shareInviteLink(owner);
  secondMember = await joinAndCheckSharedFiles(newPage, api, secondMember, secondInvite, room.id, source.filename, owner);
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
  await refreshTable(owner, room.id);
  const ownerAsk = {
    result: { kind: 'explanation', text: 'Borrowing and returns are recorded as table actions.', references: [{ kind: 'action', id: 'borrow' }] },
    expectedRole: 'owner', expectedSeat: 'host', expectedConversationCount: 1,
    expectedConversationContains: ['Who is allowed to return a borrowed item?', 'Only the member who borrowed an item may return it.'],
    expectedPromptContains: 'Summarize how this table records equipment changes.',
    forbiddenTexts: [source.filename, fixtures.equipment.quote, equipmentNotes.filename],
  };
  const callsBeforeOwnerAsk = getProviderCalls();
  await askTableAssistant(owner, ownerAsk.expectedPromptContains, ownerAsk, setAssistantReply, {
    expectConsent: false,
    loseFirstAck: true,
    beforeRetry: async firstRequest => {
      const beforeAction = (await api(owner, `/api/workspaces/${room.id}`)).body;
      expect(firstRequest.expectedRevision).toBe(beforeAction.revision);
      await performContextualAction(owner, 'equipment', {
        recordId: 'camera', recordLabel: 'Field camera', actionTitle: 'Borrow equipment', recordFieldLabel: 'Item',
        resetTextOnRecordChange: { label: 'Completion note', discardValue: 'Temporary reservation note', submitValue: 'Owner reservation during retry', records: [] },
      });
      const afterAction = (await api(owner, `/api/workspaces/${room.id}`)).body;
      expect(afterAction.revision).not.toBe(beforeAction.revision);
      expect(afterAction.domain.records.equipment.find((row) => row.id === 'camera').values).toMatchObject({
        available: false, borrower: afterAction.actor.actorId, borrow_note: 'Owner reservation during retry',
      });
    },
  });
  expect(getProviderCalls()).toBe(callsBeforeOwnerAsk + 1);
  const beforeReset = (await api(owner, `/api/workspaces/${room.id}`)).body;
  const beforeResetCalls = getProviderCalls();
  await setTableOptionsOpen(owner, true);
  await owner.locator('.tt-table-options').getByRole('button', { name: 'Reset table', exact: true }).click();
  const resetDialog = owner.getByRole('dialog', { name: 'Reset this table?', exact: true });
  const resetResponse = owner.waitForResponse(response => isCommandResponse(response, 'workspace.reset'));
  void resetResponse.catch(() => {});
  await resetDialog.getByRole('button', { name: 'Reset table', exact: true }).click();
  expect((await resetResponse).status()).toBe(200);
  await expect(owner.getByTestId('table-chat-bar')).toBeVisible();
  const afterReset = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(afterReset.epoch).toBeGreaterThan(beforeReset.epoch);
  expect(afterReset.domain.sources).toEqual([]);
  await expect(owner.getByTestId('table-chat-answer')).toHaveCount(0);
  const resetChat = owner.getByTestId('table-chat-bar');
  const resetPrompt = resetChat.getByRole('textbox', { name: 'Message', exact: true });
  await resetPrompt.fill('Start a private draft after the table reset.');
  await resetChat.getByRole('button', { name: 'Send message', exact: true }).click();
  const resetConsent = resetChat.getByRole('alertdialog', { name: 'Send to AI', exact: true });
  await expect(resetConsent).toBeVisible();
  // A reset starts a new epoch, so the earlier grant no longer covers this owner.
  const resetConsentCopy = (await resetConsent.innerText()).replace(/\s+/gu, ' ');
  expect(resetConsentCopy).toMatch(/current active rules, records, and turn|current table context/iu);
  expect(resetConsentCopy).toContain('You will not be asked again on this table');
  await resetConsent.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(getProviderCalls()).toBe(beforeResetCalls);
  mark('Generic table: text source, reviewed lifecycle, shared equipment actions, borrower-only return, shared read-only files, and reload persistence');
}

async function shiftScenario({ owner, member, newPage, api, setTableReply, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.shifts, api, 'drop');
  await requestClarifyingQuestion(owner, room.id, setTableReply, api);
  // F013: the owner consented on this table epoch during the clarifying exchange.
  await requestProposal(owner, room.id, source, buildChange('shifts', source.id), setTableReply, api, { expectConsent: false, observePending: true });
  await inspectAppliedRules(owner, room.id, api, expectedRules.shifts);
  const ownerRoster = await openCanvasObject(owner, 'table.collection.people');
  await ownerRoster.getByRole('button', { name: 'Select Ada · ada', exact: true }).click();
  const ownerRecordActions = ownerRoster.getByRole('region', { name: 'Actions for Ada · ada', exact: true });
  await expect(ownerRecordActions).toContainText('Actions for this collection are limited to members.');
  await expect(ownerRecordActions.getByRole('combobox', { name: 'Action', exact: true })).toHaveCount(0);
  const invite = await shareInviteLink(owner);
  member = await joinAndCheckSharedFiles(newPage, api, member, invite, room.id, source.filename, owner);
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
  await verifyRoleAssignment(owner, member, room.id, api);
  mark('Generic table: AI clarifying question with three answers sends the picked answer under table consent, empty completed job offers the message again, table unchanged (F012), JSON source, atomic multi-record action, availability check, unique records, and one-import drag/drop');
}

// F035: the owner gives a member a role in People; the member's rule controls follow the live projection.
async function verifyRoleAssignment(owner, member, tableId, api) {
  const memberView = (await api(member, `/api/workspaces/${tableId}`)).body;
  const memberName = memberView.actor.name;
  expect(memberView.domain.access?.assignments?.[memberView.actor.actorId]).toBeUndefined();
  const memberRules = await openCanvasObject(member, 'table.rules');
  await expect(memberRules.getByRole('button', { name: 'Edit rules', exact: true })).toBeVisible();

  await owner.getByRole('button', { name: 'Invite', exact: true }).click();
  const dialog = owner.getByRole('dialog', { name: 'People at this table' });
  const roles = dialog.getByRole('region', { name: 'Roles and permissions' });
  const select = roles.getByRole('combobox', { name: `Role for ${memberName}`, exact: true });
  await expect(select.locator('option:checked')).toHaveText('Default (all except delete table)');
  const assigned = owner.waitForResponse((response) => isCommandResponse(response, 'access.assign'));
  await select.selectOption({ label: 'Viewer' });
  expect((await assigned).status()).toBe(200);
  await expect(select.locator('option:checked')).toHaveText('Viewer');
  await expect.poll(async () => (await api(member, `/api/workspaces/${tableId}`)).body.domain.access?.assignments?.[memberView.actor.actorId]).toBe('viewer');
  // The member's screen drops the rule controls once the new projection arrives, without a reload.
  await expect(memberRules.getByRole('button', { name: 'Edit rules', exact: true })).toHaveCount(0);

  await roles.locator('summary').filter({ hasText: 'Manage roles' }).click();
  await roles.getByRole('button', { name: 'New role', exact: true }).click();
  await roles.getByLabel('Role name').fill('Shift lead');
  await roles.getByRole('checkbox', { name: 'Use table actions', exact: true }).check();
  const saved = owner.waitForResponse((response) => isCommandResponse(response, 'access.saveRole'));
  await roles.getByRole('button', { name: 'Create role', exact: true }).click();
  expect((await saved).status()).toBe(200);
  await expect(roles.getByRole('list', { name: 'Roles created at this table' })).toContainText('Shift lead');
  await expect(select.locator('option', { hasText: 'Shift lead' })).toHaveCount(1);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
}

async function gameScenario({ owner, member, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.game, api);
  await requestProposal(owner, room.id, source, buildChange('game', source.id), setTableReply, api);
  let active = await inspectAppliedRules(owner, room.id, api, expectedRules.game);
  expect(active.domain.turn).toBe('host');

  // F017: the owner defines a computed column; the table shows it without a model call.
  const boatsEditor = await openCanvasObject(owner, 'table.collection.boats');
  await boatsEditor.getByRole('button', { name: 'Add computed column', exact: true }).click();
  const computedSection = boatsEditor.getByRole('region', { name: 'Computed columns for Boats and scores', exact: true });
  await computedSection.getByRole('button', { name: 'Add row', exact: true }).click();
  await computedSection.getByLabel('Label', { exact: true }).fill('Score plus 5');
  await computedSection.getByLabel('Number', { exact: true }).fill('5');
  await computedSection.getByRole('button', { name: 'Save computed columns', exact: true }).click();
  const computedState = (await api(owner, `/api/workspaces/${room.id}`)).body.domain;
  expect(computedState.computedColumns).toHaveLength(1);
  expect(computedState.computedColumns[0].collection).toBe('boats');
  await expect(boatsEditor.getByRole('columnheader', { name: /Score plus 5/u })).toBeVisible();
  await expect(boatsEditor.getByRole('cell', { name: '5', exact: true })).toHaveCount(2);

  // F019: the rules card explains what the table can and cannot do.
  const capabilityRules = await openCanvasObject(owner, 'table.rules');
  await capabilityRules.getByText('What this table can do', { exact: true }).click();
  await expect(capabilityRules.getByText(/8 capabilities · 5 known gaps/u)).toBeVisible();
  await capabilityRules.getByText(/Known gaps \(5\)/u).click();
  await expect(capabilityRules.getByText(/Joins and rollups across collections/u)).toBeVisible();
  const generatedTableTitle = 'River Race: Active Canvas';
  await owner.getByRole('button', { name: 'Rename table', exact: true }).click();
  const renameInput = owner.getByLabel('Table name', { exact: true });
  await renameInput.fill(generatedTableTitle);
  await renameInput.press('Enter');
  await expect(owner.locator('.tt-workspace-picker__button')).toContainText(generatedTableTitle);
  expect((await api(owner, `/api/workspaces/${room.id}`)).body.title).toBe(generatedTableTitle);
  // F003-T3: this member joins through the table's reusable invite link instead of a one-seat invitation.
  const invite = await turnOnInviteLink(owner);
  member = await joinAndCheckSharedFiles(newPage, api, member, invite, room.id, source.filename, owner);
  expect((await api(member, `/api/workspaces/${room.id}`)).body.actor.seat).toBe('member-1');
  await turnOffInviteLink(owner);
  await expect(member.locator('.tt-workspace-picker__button')).toContainText(generatedTableTitle);
  await expect(member.getByRole('button', { name: 'Rename table', exact: true })).toHaveCount(0);
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
  const ownerChat = await askTableAssistant(owner, ownerProposal.expectedPromptContains, ownerProposal, setAssistantReply, { expectConsent: false });
  expect(getProviderCalls()).toBe(ownerCalls + 1);
  const afterOwnerProposal = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(afterOwnerProposal.revision).toBe(ownerBeforeProposal.revision);
  expect(afterOwnerProposal.domain.records.boats.map((row) => row.values.score)).toEqual([0, 0]);
  expect(afterOwnerProposal.domain.turn).toBe('host');
  const ownerProposalCard = ownerChat;
  const ownerConfirm = ownerProposalCard.getByRole('button', { name: 'Confirm action', exact: true });
  await expect(ownerConfirm).toBeEnabled();
  const confirmationBodies = [];
  let lostConfirmationStatus;
  const confirmationRoute = async route => {
    const request = route.request();
    if (request.method() !== 'POST') return route.continue();
    confirmationBodies.push(request.postDataJSON());
    const response = await route.fetch();
    lostConfirmationStatus = response.status();
    await route.abort('connectionreset');
  };
  const confirmationUrl = `**/api/workspaces/${room.id}/assistant/*/confirm`;
  await owner.route(confirmationUrl, confirmationRoute);
  try {
    await ownerConfirm.dblclick();
    // #157: a confirmed proposal leaves the canvas and becomes a "Done" notice with Table history.
    await expect(owner.locator('.tt-notice--success').filter({ hasText: 'Done:' })).toBeVisible({ timeout: 25_000 });
    await expect(ownerProposalCard).toHaveCount(0);
    expect([200, 202]).toContain(lostConfirmationStatus);
    expect(confirmationBodies).toHaveLength(1);
    expect(confirmationBodies[0].commandId).toMatch(/^[0-9a-f-]{36}$/iu);
  } finally {
    await owner.unroute(confirmationUrl, confirmationRoute);
  }
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
  const memberChat = await askTableAssistant(member, memberPrompt, memberProposal, setAssistantReply, { cancelFirst: true });
  expect(getProviderCalls()).toBe(memberCalls + 1);
  const afterMemberProposal = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(afterMemberProposal.revision).toBe(memberBeforeProposal.revision);
  expect(afterMemberProposal.domain.records.boats.map((row) => row.values.score)).toEqual([2, 0]);
  expect(afterMemberProposal.domain.turn).toBe('member-1');
  // F015 open visibility: the owner sees the member's pending proposal, labelled with the asker, but only the
  // asker can confirm it (no Confirm button on the owner's screen).
  await owner.reload();
  await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
  const memberProposalForOwner = owner.getByRole('article', { name: memberPrompt, exact: true });
  await expect(memberProposalForOwner.locator('.tt-canvas-node__subtitle')).toHaveText(memberName);
  await expect(memberProposalForOwner.getByTestId('table-chat-answer')).toContainText(memberProposal.result.text);
  await expect(memberProposalForOwner.locator('.tt-chat-card__asker')).toHaveText(`Asked by ${memberName}`);
  await expect(memberProposalForOwner).toContainText(`Only ${memberName} can confirm this proposal.`);
  await expect(memberProposalForOwner.getByRole('button', { name: 'Confirm action', exact: true })).toHaveCount(0);
  await expect(memberChat.getByRole('button', { name: 'Confirm action', exact: true })).toBeVisible();

  await performAction(member, 'Advance boat', { 'Your boat': 'blue' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('host');
  expect(active.domain.records.boats.find((row) => row.id === 'blue').values.score).toBe(2);
  await expect(memberChat.getByRole('button', { name: 'Confirm action', exact: true })).toHaveCount(0);
  await expect(memberChat).toContainText('The table changed after this proposal. Ask again for a fresh proposal.');
  mark('Generic table chat: lost ask and confirm acknowledgements retry or reconcile once; another member sees the proposal with "Asked by" and no Confirm button (F015); a direct table action makes a pending proposal stale');

  await openCanvasObject(owner, 'table.collection.boats');
  await refreshTable(owner, room.id);
  await expect(owner.getByTestId('canvas-object-editor').getByRole('cell', { name: '2', exact: true })).toHaveCount(2);
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  const revisedProgram = structuredClone(active.domain.program);
  revisedProgram.description = 'A revised scoring rule changes the gain from two to three points. Current scores stay in place.';
  revisedProgram.actions.find((action) => action.id === 'advance').effects[0].value = literal(3);
  const revisedChange = { kind: 'table', program: revisedProgram, initialRecords: {} };
  // Same owner, table and epoch as the first draft: the rule edit sends without asking again.
  await requestProposal(owner, room.id, source, revisedChange, setTableReply, api, { expectConsent: false });
  active = await inspectAppliedRules(owner, room.id, api, expectedRules.game);
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
  await owner.reload();
  await expect(owner.locator('.tt-workspace-picker__button')).toContainText(generatedTableTitle);
  await expect(member.locator('.tt-workspace-picker__button')).toContainText(generatedTableTitle);
  const ownerAfterReload = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(ownerAfterReload.domain.program.description).toContain('A revised scoring rule');
  expect(ownerAfterReload.domain.records.boats.map((row) => row.values.score)).toEqual([5, 5]);
  mark('Generic table: generated program rename survives AI rule edit and both reloads; role, turn and live scores persist');

  await verifyParallelRequests({ owner, member, tableId: room.id, api, setTableReply, setAssistantReply, getProviderCalls, mark });

  await removeActionFromRules(owner, room.id, api, { actionTitle: 'Advance boat', actionId: 'advance', collectionTitle: 'Boats and scores' });
  mark('Generic table: an AI draft goes into use on its own, and the owner removes one action from the Rules card as a new rule revision (F039)');
}

// Evidence screenshot of the page with one canvas card opened in view.
async function snapshotCard(page, card, path) {
  try {
    // Open the card so the canvas brings it into view; a closed off-screen node renders blank.
    const nodeId = await card.evaluate(element => element.closest('.react-flow__node')?.getAttribute('data-id'));
    if (nodeId) await expect(await openCanvasObject(page, nodeId)).toBeInViewport({ ratio: 0.5 });
  } catch { /* evidence only: fall through to the page as it is */ }
  await page.screenshot({ path });
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

// F038: while a rule draft is still generating, the owner can queue a second rule request and ask a
// question; the joined member sees both running cards live, named after the owner, without reloading.
async function verifyParallelRequests({ owner, member, tableId, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  const ownerName = before.actor.name;
  const expectedSources = before.domain.sources.map(item => ({ id: item.id, filename: item.filename, text: item.text }));
  const draftChange = (description) => {
    const program = structuredClone(before.domain.program);
    program.description = description;
    return { kind: 'table', program, initialRecords: {} };
  };
  // Prompts stay under the 48-character card title limit and match the owner's builder/question routing.
  const firstPrompt = 'Add a column for boat colour.';
  const secondPrompt = 'Add another column for crew size.';
  const questionPrompt = 'What is each boat score right now?';
  const questionText = 'Red and blue both have five points.';
  const chat = owner.getByTestId('table-chat-bar');
  const prompt = chat.getByRole('textbox', { name: 'Message', exact: true });
  const send = chat.getByRole('button', { name: 'Send message', exact: true });
  const ownCard = (text) => owner.getByRole('article', { name: new RegExp(`^${escapeRegExp(text)}$`, 'u') }).first();
  const memberCard = (text) => member.getByRole('article', { name: text, exact: true }).first();
  const modelPosts = [];
  const countModelPosts = request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === `/api/workspaces/${tableId}/model`) modelPosts.push(request.postDataJSON());
  };
  owner.on('request', countModelPosts);
  let releaseFirst = () => {};
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  try {
    const callsBefore = getProviderCalls();
    setTableReply({ change: draftChange('F038 first queued-draft check.'), gate, expectedSources });
    await prompt.fill(firstPrompt);
    await send.click();
    // The provider received the first draft and is held by the gate.
    await expect.poll(() => getProviderCalls(), { timeout: 20_000 }).toBe(callsBefore + 1);
    const firstCard = ownCard(firstPrompt).getByTestId('table-chat-answer');
    await expect(firstCard).toHaveAttribute('data-phase', 'waiting', { timeout: 20_000 });
    await expect(firstCard).toContainText('Preparing a rule draft…');
    // The member sees the owner's running draft live, named after the owner.
    await expect(memberCard(firstPrompt).getByTestId('table-chat-answer')).toContainText(`${ownerName} is preparing a rule draft…`, { timeout: 20_000 });
    await expect(memberCard(firstPrompt).locator('.tt-canvas-node__subtitle')).toHaveText(ownerName);
    await expect(ownCard(firstPrompt).locator('.tt-canvas-node__subtitle')).toHaveCount(0);
    await snapshotCard(member, memberCard(firstPrompt), 'test-results/f038-member-card.png');

    // (a) A second rule request queues instead of being blocked.
    await prompt.fill(secondPrompt);
    await expect(send).toBeEnabled();
    await send.click();
    const secondNode = ownCard(secondPrompt);
    const secondCard = secondNode.getByTestId('table-chat-answer');
    await expect(secondCard).toHaveAttribute('data-phase', 'queued');
    await expect(secondCard).toContainText('Queued.');
    await expect(secondCard.getByRole('button', { name: 'Cancel this request', exact: true })).toBeVisible();
    // The open editor hides the eyebrow, so the queued state is read from the card itself.
    expect(modelPosts.map(body => body.prompt)).toEqual([firstPrompt]);

    // (b) A question runs in parallel with the held draft.
    await prompt.fill(questionPrompt);
    await expect(send).toBeEnabled();
    let releaseQuestion = () => {};
    const questionGate = new Promise(resolve => { releaseQuestion = resolve; });
    try {
      setAssistantReply({ result: { kind: 'explanation', text: questionText, references: [] }, gate: questionGate, expectedRole: 'owner', expectedPromptContains: questionPrompt });
      const questionResponse = owner.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/${tableId}/assistant` && response.request().method() === 'POST');
      void questionResponse.catch(() => {});
      await send.click();
      await expect(ownCard(questionPrompt).getByTestId('table-chat-answer')).toHaveAttribute('data-phase', /^(sending|waiting)$/u);
      // The member sees the owner's running question live, named after the owner.
      const memberQuestion = memberCard(questionPrompt).getByTestId('table-chat-answer');
      await expect(memberQuestion).toContainText(`${ownerName} is waiting for an answer…`, { timeout: 20_000 });
      releaseQuestion();
      expect([200, 202]).toContain((await questionResponse).status());
      await expect(ownCard(questionPrompt).getByTestId('table-chat-answer')).toContainText(questionText, { timeout: 20_000 });
      await expect(memberQuestion).toContainText(questionText, { timeout: 20_000 });
    } finally {
      releaseQuestion();
    }
    // The first draft is still held and the second still queued.
    await expect(firstCard).toHaveAttribute('data-phase', 'waiting');
    await expect(secondCard).toHaveAttribute('data-phase', 'queued');
    expect(modelPosts).toHaveLength(1);

    // Release the first draft: it completes, then the queued draft starts on its own and completes.
    setTableReply({ change: draftChange('F038 second queued-draft check.'), expectedSources });
    releaseFirst();
    // F039 + dev #157: both drafts go into use and leave the canvas; each becomes a success notice.
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.ruleRevision, { timeout: 30_000 })
      .toBe(before.domain.ruleRevision + 2);
    await expect(ownCard(firstPrompt)).toHaveCount(0);
    await expect(ownCard(secondPrompt)).toHaveCount(0);
    await expect(memberCard(firstPrompt)).toHaveCount(0);
    await expect(owner.locator('.tt-notice--success').filter({ hasText: 'New rules added' })).toBeVisible();
    expect(modelPosts.map(body => body.prompt)).toEqual([firstPrompt, secondPrompt]);
    await expect.poll(async () => JSON.stringify((await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate ?? null), { timeout: 20_000 })
      .toContain('F038 second queued-draft check.');
    const afterQueue = (await api(owner, `/api/workspaces/${tableId}`)).body;
    expect(afterQueue.domain.candidate?.status).toBe('active');
    expect(afterQueue.domain.program.description).toBe('F038 second queued-draft check.');
    expect(afterQueue.domain.ruleRevision).toBe(before.domain.ruleRevision + 2);
    await member.screenshot({ path: 'test-results/f038-member-card-finished.png' });
  } finally {
    releaseFirst();
    owner.off('request', countModelPosts);
  }
  mark('Generic table chat (F038): a second rule request queues behind a generating draft and starts after it; a question is answered meanwhile; the member sees the running cards live');
}

export async function verifyGenericTableBrowser({ actors, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark }) {
  const [equipmentOwner, shiftsOwner, gameOwner] = actors.owners;
  const secondMember = actors.members[1];
  const owners = [equipmentOwner, shiftsOwner, gameOwner];
  const scenarios = [equipmentScenario, shiftScenario, gameScenario];
  for (let index = 0; index < scenarios.length; index += 1) {
    const owner = await newPage(owners[index]);
    await expect(owner.getByRole('heading', { name: 'What are you here to do?' })).toBeVisible();
    await scenarios[index]({ owner, member: actors.members[0], secondMember, newPage, api, setTableReply, setAssistantReply, getProviderCalls, mark });
    await owner.screenshot({ path: `test-results/cloudflare-browser/generic-table-${['equipment', 'shifts', 'game'][index]}.png`, fullPage: true });
  }
}
