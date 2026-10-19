import { expect } from '@playwright/test';

const equipmentPolicy = 'Borrow only an available item. Only the member who borrowed it may return it.';
const shiftPolicy = 'Swap two different people only when both can work the new slot.';
const gamePolicy = 'On your turn, move your own boat forward by two points and pass the turn.';

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
      { id: 'available', label: 'Available', type: 'boolean', required: true },
      { id: 'borrower', label: 'Borrower', type: 'text', required: false },
    ] }];
    const itemParameter = { id: 'item', label: 'Item', type: 'record', collection: 'equipment' };
    program.actions = [
      { id: 'borrow', title: 'Borrow equipment', description: 'Reserve one available item for yourself.', roles: ['owner', 'participant'], parameters: [itemParameter], conditions: [
        { left: record('item', 'available'), op: 'eq', right: literal(true), message: 'This item is already reserved.' },
      ], effects: [
        { record: 'item', field: 'available', op: 'set', value: literal(false) },
        { record: 'item', field: 'borrower', op: 'set', value: { system: 'actor' } },
      ], requireTurn: false, advanceTurn: false },
      { id: 'return', title: 'Return equipment', description: 'Only the borrower can return an item.', roles: ['owner', 'participant'], parameters: [itemParameter], conditions: [
        { left: record('item', 'borrower'), op: 'eq', right: { system: 'actor' }, message: 'Only the borrower may return this item.' },
      ], effects: [
        { record: 'item', field: 'available', op: 'set', value: literal(true) },
        { record: 'item', field: 'borrower', op: 'set', value: literal(null) },
      ], requireTurn: false, advanceTurn: false },
    ];
    return { kind: 'table', program, initialRecords: { equipment: [
      { id: 'camera', values: { name: 'Field camera', available: true, borrower: null } },
      { id: 'tripod', values: { name: 'Tripod', available: true, borrower: null } },
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

function isCommandResponse(response, type) {
  if (!response.url().endsWith('/commands') || response.request().method() !== 'POST') return false;
  try { return response.request().postDataJSON()?.type === type; }
  catch { return false; }
}

async function openNewTable(owner, api) {
  const created = owner.waitForResponse((response) => response.url().endsWith('/api/workspaces') && response.request().method() === 'POST');
  await owner.getByRole('button', { name: /Shared data table/ }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  const view = await response.json();
  await expect(owner.locator('.tt-canvas-panel')).toBeVisible();
  expect((await api(owner, `/api/workspaces/${view.id}`)).body.kind).toBe('table');
  return view;
}

async function addSource(page, tableId, source, api, method = 'picker') {
  await page.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.sources').click();
  const editor = page.getByTestId('canvas-object-editor');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.sources');
  let importRequests = 0;
  const trackImport = (request) => {
    if (!request.url().endsWith('/commands') || request.method() !== 'POST') return;
    try { if (request.postDataJSON()?.type === 'table.import') importRequests += 1; }
    catch { /* Ignore non-JSON requests. */ }
  };
  page.on('request', trackImport);
  const imported = page.waitForResponse((response) => isCommandResponse(response, 'table.import'));
  if (method === 'drop') {
    await page.evaluate(({ filename, text }) => {
      const zone = document.querySelector('.tt-table-dropzone');
      if (!zone) throw new Error('Expanded source file drop area is missing.');
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], filename, { type: filename.endsWith('.json') ? 'application/json' : 'text/plain' }));
      zone.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    }, source);
  } else {
    await editor.getByLabel('Choose table source files').setInputFiles({ name: source.filename, mimeType: source.filename.endsWith('.json') ? 'application/json' : 'text/plain', buffer: Buffer.from(source.text, 'utf8') });
  }
  const response = await imported;
  expect(response.status()).toBe(200);
  await expect(editor).toContainText(source.filename);
  if (method === 'drop') {
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(250);
    expect(importRequests).toBe(1);
  }
  page.off('request', trackImport);
  const current = await api(page, `/api/workspaces/${tableId}`);
  expect(current.status).toBe(200);
  expect(current.body.domain.sources).toHaveLength(1);
  expect(current.body.domain.sources[0].text).toBe(source.text);
  return current.body.domain.sources[0];
}

async function requestProposal(owner, tableId, source, change, setTableReply, api) {
  const before = (await api(owner, `/api/workspaces/${tableId}`)).body;
  await owner.getByTestId('canvas-object-dock').getByTestId('open-canvas-workspace.ai').click();
  const editor = owner.getByTestId('canvas-object-editor');
  await expect(editor).toHaveAttribute('data-canvas-object', 'workspace.ai');
  const consentCopy = editor.locator('.tt-ai-proposal__privacy');
  await expect(consentCopy).toContainText('After you consent, the AI provider receives your prompt, current rules, and every source file on this table (1 total).');
  await expect(consentCopy).toContainText('Shared records and member activity are excluded.');
  await expect(consentCopy).toContainText('Source files and drafts remain private to the owner; active rules and records are shared with members.');
  await editor.getByLabel('What should the draft change or explain?').fill('Build a shared table from the source, with bounded actions and checks.');
  const ask = editor.getByRole('button', { name: 'Ask AI for a draft', exact: true });
  await expect(ask).toBeDisabled();
  await editor.getByLabel('I agree to send this request for an AI draft.').check();
  setTableReply({ change, expectedFilename: source.filename, expectedText: source.text });
  await ask.click();
  await expect(owner.getByText('Draft ready for review', { exact: true })).toBeVisible({ timeout: 15_000 });
  const current = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(current.domain.candidate?.status).toBe('draft');
  expect(current.domain.program).toEqual(before.domain.program);
  expect(current.domain.records).toEqual(before.domain.records);
  return current;
}

async function progressThroughLifecycle(owner, tableId, api) {
  await owner.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.rules').click();
  const editor = owner.getByTestId('canvas-object-editor');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.rules');
  await expect(editor.locator('.tt-table-rule-list')).toContainText('equals');
  const proposedRows = editor.locator('.tt-table-proposed-records').first();
  await expect(proposedRows).toBeVisible();
  await proposedRows.locator('summary').click();
  const candidate = (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate;
  const firstCollection = candidate.change.program.collections[0];
  const firstRow = candidate.change.initialRecords[firstCollection.id]?.[0];
  if (firstRow) await expect(proposedRows).toContainText(String(Object.values(firstRow.values)[0]));
  else await expect(proposedRows).toContainText('No new rows in this proposal. Existing records stay unchanged.');
  for (const [label, type, nextStatus] of [
    [/Simulate/, 'evolve.simulate', 'simulated'],
    [/Validate/, 'evolve.validate', 'validated'],
    [/Approve/, 'evolve.approve', 'approved'],
    [/Activate/, 'evolve.activate', 'active'],
  ]) {
    const responsePromise = owner.waitForResponse((response) => isCommandResponse(response, type));
    await editor.getByRole('button', { name: label }).click();
    expect((await responsePromise).status()).toBe(200);
    await expect.poll(async () => (await api(owner, `/api/workspaces/${tableId}`)).body.domain.candidate?.status).toBe(nextStatus);
  }
  const active = (await api(owner, `/api/workspaces/${tableId}`)).body;
  expect(active.domain.program).toBeTruthy();
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
  await expect(page.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.sources')).toHaveCount(0);
  await expect(page.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.rules')).toBeVisible();
  return page;
}

async function performAction(page, actionTitle, inputs, expectedStatus = 200) {
  const editor = page.getByTestId('canvas-object-editor');
  await expect(editor).toHaveAttribute('data-canvas-object', 'table.actions');
  const form = editor.locator('form.tt-table-action').filter({ hasText: actionTitle });
  for (const [label, value] of Object.entries(inputs)) await form.getByLabel(label, { exact: true }).selectOption(value);
  const responsePromise = page.waitForResponse((response) => isCommandResponse(response, 'table.act'));
  await form.getByRole('button', { name: actionTitle, exact: true }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(expectedStatus);
  return response;
}

async function equipmentScenario({ owner, member, secondMember, newPage, api, setTableReply, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.equipment, api);
  await requestProposal(owner, room.id, source, buildChange('equipment', source.id), setTableReply, api);
  let active = await progressThroughLifecycle(owner, room.id, api);
  expect(active.domain.records.equipment).toHaveLength(2);

  const firstInvite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, firstInvite, room.id, source.filename);
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(member, 'Borrow equipment', { Item: 'camera' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  const camera = active.domain.records.equipment.find((row) => row.id === 'camera');
  expect(camera.values).toMatchObject({ available: false, borrower: active.actor.actorId });

  const secondInvite = await inviteMember(owner, 2);
  secondMember = await joinAndCheckPrivateFiles(newPage, api, secondMember, secondInvite, room.id, source.filename);
  await secondMember.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(secondMember, 'Return equipment', { Item: 'camera' }, 422);
  const rejected = (await api(secondMember, `/api/workspaces/${room.id}`)).body.domain.records.equipment.find((row) => row.id === 'camera');
  expect(rejected.values).toMatchObject({ available: false, borrower: active.actor.actorId });

  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
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
  await progressThroughLifecycle(owner, room.id, api);
  const invite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, invite, room.id, source.filename);
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(member, 'Swap shifts', { 'First person': 'bo', 'Second person': 'ada' });
  let current = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(current.domain.records.people.find((row) => row.id === 'bo').values.slot).toBe('morning');
  expect(current.domain.records.people.find((row) => row.id === 'ada').values.slot).toBe('evening');
  await performAction(member, 'Swap shifts', { 'First person': 'bo', 'Second person': 'cy' }, 422);
  current = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(current.domain.records.people.find((row) => row.id === 'bo').values.slot).toBe('morning');
  expect(current.domain.records.people.find((row) => row.id === 'cy').values.slot).toBe('night');
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.collection.people').click();
  await expect(member.getByTestId('canvas-object-editor')).toContainText('Shift roster');
  mark('Generic table: JSON source, atomic multi-record action, availability check, unique records, and one-import drag/drop');
}

async function gameScenario({ owner, member, newPage, api, setTableReply, mark }) {
  const room = await openNewTable(owner, api);
  const source = await addSource(owner, room.id, fixtures.game, api);
  await requestProposal(owner, room.id, source, buildChange('game', source.id), setTableReply, api);
  let active = await progressThroughLifecycle(owner, room.id, api);
  expect(active.domain.turn).toBe('host');
  const invite = await inviteMember(owner, 1);
  member = await joinAndCheckPrivateFiles(newPage, api, member, invite, room.id, source.filename);
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await expect(member.getByRole('button', { name: 'Advance boat', exact: true })).toBeDisabled();

  await owner.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(owner, 'Advance boat', { 'Your boat': 'red' });
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('member-1');
  expect(active.domain.records.boats.find((row) => row.id === 'red').values.score).toBe(2);
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(member, 'Advance boat', { 'Your boat': 'blue' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('host');
  expect(active.domain.records.boats.find((row) => row.id === 'blue').values.score).toBe(2);

  await owner.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.collection.boats').click();
  const refresh = owner.waitForResponse((response) => response.url().endsWith(`/api/workspaces/${room.id}`) && response.request().method() === 'GET');
  await owner.getByRole('button', { name: 'Refresh latest table', exact: true }).click();
  expect((await refresh).status()).toBe(200);
  await expect(owner.getByTestId('canvas-object-editor').getByRole('cell', { name: '2', exact: true })).toHaveCount(2);
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  const revisedProgram = structuredClone(active.domain.program);
  revisedProgram.description = 'A revised scoring rule changes the gain from two to three points. Current scores stay in place.';
  revisedProgram.actions.find((action) => action.id === 'advance').effects[0].value = literal(3);
  const revisedChange = { kind: 'table', program: revisedProgram, initialRecords: {} };
  await requestProposal(owner, room.id, source, revisedChange, setTableReply, api);
  active = await progressThroughLifecycle(owner, room.id, api);
  expect(active.domain.records.boats.find((row) => row.id === 'red').values.score).toBe(2);
  expect(active.domain.records.boats.find((row) => row.id === 'blue').values.score).toBe(2);
  expect(active.domain.turn).toBe('host');
  await owner.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(owner, 'Advance boat', { 'Your boat': 'red' });
  active = (await api(owner, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('member-1');
  expect(active.domain.records.boats.map((row) => row.values.score)).toEqual([5, 2]);
  await member.getByTestId('canvas-object-dock').getByTestId('open-canvas-table.actions').click();
  await performAction(member, 'Advance boat', { 'Your boat': 'blue' });
  active = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(active.domain.turn).toBe('host');
  expect(active.domain.records.boats.map((row) => row.values.score)).toEqual([5, 5]);
  await member.reload();
  const resumed = (await api(member, `/api/workspaces/${room.id}`)).body;
  expect(resumed.domain.records.boats.map((row) => row.values.score)).toEqual([5, 5]);
  mark('Generic table: text source, role and turn-gated actions, rule revision preserves live scores, and member reload resumes shared data');
}

export async function verifyGenericTableBrowser({ actors, newPage, api, setTableReply, mark }) {
  const [equipmentOwner, shiftsOwner, gameOwner] = actors.owners;
  const [member, secondMember] = actors.members;
  const owners = [equipmentOwner, shiftsOwner, gameOwner];
  const scenarios = [equipmentScenario, shiftScenario, gameScenario];
  for (let index = 0; index < scenarios.length; index += 1) {
    const owner = await newPage(owners[index]);
    await expect(owner.getByRole('heading', { name: 'Choose a table' })).toBeVisible();
    await scenarios[index]({ owner, member: actors.members[0], secondMember, newPage, api, setTableReply, mark });
    await owner.screenshot({ path: `test-results/cloudflare-browser/generic-table-${['equipment', 'shifts', 'game'][index]}.png`, fullPage: true });
  }
}
