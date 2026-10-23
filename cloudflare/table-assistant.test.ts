import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createDomain } from '../src/tabletop/domain/index.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import type { ActorContext, Member, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { TableAssistantInput } from '../src/tabletop/shared/table-assistant-contracts.js';
import type { Env } from './contracts.js';
import { respondToTablePrompt } from './table-assistant.js';

const testEnv = env as Env;
const ownerId = 'acct-secret-owner-3917';
const participantId = 'acct-secret-player-5824';
const ownerName = 'Taylor Private Owner';
const participantName = 'Jordan Private Player';
const revision = 'a'.repeat(64);

describe('builder handoff from the same conversation', () => {
  it('offers owners a builder handoff without executing or changing the table', async () => {
    const input = await assistantInput(undefined, { prompt: 'I want a different way to enter these items' });
    const before = JSON.stringify(input.workspace.domain);
    const response = await respondToTablePrompt(testEnv, input, providerFetch({ kind: 'build-request', text: 'We can prepare a data-entry form for review.' }));
    expect(response.result).toEqual({ kind: 'build-request', text: 'We can prepare a data-entry form for review.' });
    expect(JSON.stringify(input.workspace.domain)).toBe(before);
  });

  it('may offer a participant a build request; preparing it is gated by rules.draft at POST /model (F035)', async () => {
    const workspace = createWorkspace({ actorId: participantId, name: participantName, role: 'participant', seat: 'member-1' });
    const input = await assistantInput(workspace, { prompt: 'Add a different form' });
    await expect(respondToTablePrompt(testEnv, input, providerFetch({ kind: 'build-request', text: 'Prepare a form.' })))
      .resolves.toMatchObject({ result: { kind: 'build-request', text: 'Prepare a form.' } });
  });
});

function hash(value: unknown): string {
  return typeof value === 'string' ? 'b'.repeat(64) : 'c'.repeat(64);
}

function createWorkspace(actor: Member = { actorId: ownerId, name: ownerName, role: 'owner' }): WorkspaceView {
  const context: ActorContext = {
    actorId: actor.actorId,
    name: actor.name,
    role: actor.role,
    ...(actor.seat ? { seat: actor.seat } : {}),
    workspaceId: 'room-table-assistant-test',
    epoch: 9,
    now: Date.UTC(2026, 9, 19),
    hash,
  };
  const domain = createDomain('table', context);
  if (domain.kind !== 'table') throw new Error('Expected a table fixture.');
  const sourceId = 'source_fixture';
  const change = equipmentChange(sourceId);
  domain.sources.push({
    id: sourceId,
    filename: tableScenarioSources.equipment.filename,
    text: `${tableScenarioSources.equipment.text}\nHIDDEN_SOURCE_SECRET`,
    sha256: 'd'.repeat(64),
    createdAt: context.now,
  });
  domain.program = change.program;
  domain.records = structuredClone(change.initialRecords);
  domain.records.equipment![0]!.values.borrower = ownerId;
  domain.ruleRevision = 4;
  domain.actionRevision = 12;
  domain.activity = [{ actorId: ownerId, action: 'ROOM_ACTIVITY_SECRET', at: context.now }];
  const participant: Member = { actorId: participantId, name: participantName, role: 'participant', seat: 'member-1' };
  const members = actor.role === 'owner' ? [actor, participant] : [
    { actorId: ownerId, name: ownerName, role: 'owner' as const },
    actor,
  ];
  return {
    id: 'room-table-assistant-test',
    title: 'Community equipment',
    kind: 'table',
    epoch: context.epoch,
    revision,
    actor,
    members,
    domain,
    createdAt: context.now,
    expiresAt: context.now + 60 * 60_000,
  };
}

async function digest(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((entry) => entry.toString(16).padStart(2, '0')).join('');
}

async function assistantInput(workspace = createWorkspace(), overrides: Partial<TableAssistantInput> = {}): Promise<TableAssistantInput> {
  const commandId = crypto.randomUUID();
  return {
    workspace,
    actorId: workspace.actor.actorId,
    jobId: await digest(`${workspace.actor.actorId}:${commandId}:${crypto.randomUUID()}`),
    commandId,
    prompt: 'Explain which rule controls borrowing equipment.',
    consent: true,
    conversation: [],
    conversationOmittedCount: 0,
    ...overrides,
  };
}

function providerFetch(result: unknown, inspect?: (content: string, body: Record<string, unknown>) => void): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.deepseek.com/chat/completions' || init?.method !== 'POST'
      || init.redirect !== 'manual' || !(init.signal instanceof AbortSignal)) {
      throw new Error('Unexpected table assistant provider request.');
    }
    const text = typeof init.body === 'string' ? init.body : '';
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Expected provider object.');
    const body = parsed as Record<string, unknown>;
    if (body.model !== 'deepseek-flash' || body.max_tokens !== 32768 || body.tool_choice !== 'none'
      || body.stream !== true || !isRecord(body.stream_options) || body.stream_options.include_usage !== true
      || body.thinking === undefined || !Array.isArray(body.messages)) throw new Error('Unexpected provider limits.');
    const user = body.messages.find((message) => typeof message === 'object' && message !== null
      && (message as { role?: unknown }).role === 'user') as { content?: unknown } | undefined;
    if (typeof user?.content !== 'string') throw new Error('Expected a bounded user context.');
    inspect?.(user.content, body);
    const payload = JSON.stringify(result);
    const chunks: string[] = [];
    for (let index = 0; index < payload.length; index += 37) chunks.push(payload.slice(index, index + 37));
    const events = [
      ...chunks.map((content) => ({ model: 'deepseek-flash', choices: [{ index: 0, delta: { content } }] })),
      { model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
      {
        model: 'deepseek-flash',
        choices: [],
        usage: { prompt_tokens: 45, completion_tokens: 80, total_tokens: 125, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 35 },
      },
    ];
    const stream = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function billingRow(jobId: string): Promise<{ status: string; max_input_tokens: number; max_output_tokens: number } | undefined> {
  const stub = testEnv.BILLING.get(testEnv.BILLING.idFromName('global'));
  return runInDurableObject(stub, (_instance, state) => state.storage.sql.exec<{
    status: string;
    max_input_tokens: number;
    max_output_tokens: number;
  }>('SELECT status, max_input_tokens, max_output_tokens FROM billing_jobs WHERE id = ?', jobId).toArray()[0]);
}

describe('Cloudflare table assistant', () => {
  it('answers PD035 library availability from enabled compute capabilities without a draft or data change', async () => {
    const input = await assistantInput(createWorkspace(), {
      prompt: 'ถ้าฉันขอให้ใช้ Polars แทน pandas บนระบบนี้ ทำได้จริงไหม มี library นี้ให้ใช้อยู่แล้วหรือไม่ ขอคำตอบตามความสามารถที่เปิดจริง ไม่ต้องสร้างร่างหรือแก้ข้อมูล',
    });
    const assistantEnv: Env = {
      ...testEnv,
      DEEPSEEK_KEY: testEnv.DEEPSEEK_KEY ?? 'test-provider-key',
      COMPUTE_LOADER: undefined,
      TABLE_COMPUTE_PYTHON: undefined,
    };
    const before = JSON.stringify(input.workspace.domain);
    const rejectedLibraryReply = providerFetch({ kind: 'explanation', text: 'Polars is installed and ready.' });
    let providerCalls = 0;
    const provider: typeof fetch = (url, init) => {
      providerCalls += 1;
      return rejectedLibraryReply(url, init);
    };

    const response = await respondToTablePrompt(assistantEnv, input, provider);

    expect(response.result.kind).toBe('explanation');
    if (response.result.kind !== 'explanation') throw new Error('Expected a capability explanation.');
    expect(response.result.text).toContain('Polars');
    expect(response.result.text).toContain('pandas');
    expect(response.result.text).toContain('ไม่รองรับ Polars');
    expect(response.result.text).toMatch(/JavaScript|Python/u);
    expect(response.result.references).toEqual([]);
    expect(providerCalls).toBe(0);
    expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
    expect(JSON.stringify(input.workspace.domain)).toBe(before);
    expect(await billingRow(input.jobId)).toBeUndefined();
  });

  it.each([
    'Create a dashboard using the available pandas package.',
    'ใช้ Python ที่มีอยู่แล้ว สร้างตารางยอดขายให้หน่อย',
    'Is Polars supported? Build a dashboard with it.',
  ])('does not intercept a positive request to build with a library: %s', async (prompt) => {
    const input = await assistantInput(createWorkspace(), { prompt });
    let providerCalls = 0;
    const provider: typeof fetch = (url, init) => {
      providerCalls += 1;
      return providerFetch({ kind: 'build-request', text: 'We can prepare an equipment summary form for review.' })(url, init);
    };

    const response = await respondToTablePrompt(testEnv, input, provider);

    expect(response.result).toEqual({ kind: 'build-request', text: 'We can prepare an equipment summary form for review.' });
    expect(providerCalls).toBe(1);
  });

  it('leaves table availability questions for the table assistant', async () => {
    const input = await assistantInput(createWorkspace(), { prompt: 'Which records are available in this system?' });
    let providerCalls = 0;
    const provider: typeof fetch = (url, init) => {
      providerCalls += 1;
      return providerFetch({ kind: 'explanation', text: 'The table rules and records determine availability.', references: [] })(url, init);
    };

    const response = await respondToTablePrompt(testEnv, input, provider);

    expect(response.result.kind).toBe('explanation');
    expect(providerCalls).toBe(1);
  });

  it('does not treat GeoPandas as pandas when answering the enabled package list', async () => {
    const input = await assistantInput(createWorkspace(), { prompt: 'Is GeoPandas available on this system?' });
    const assistantEnv: Env = {
      ...testEnv,
      DEEPSEEK_KEY: testEnv.DEEPSEEK_KEY ?? 'test-provider-key',
      COMPUTE_LOADER: undefined,
      TABLE_COMPUTE_PYTHON: 'enabled',
    };

    const response = await respondToTablePrompt(assistantEnv, input, providerFetch({ kind: 'refusal', text: 'The provider should not be called.' }));

    expect(response.result.kind).toBe('explanation');
    if (response.result.kind !== 'explanation') throw new Error('Expected a capability explanation.');
    expect(response.result.text).toContain('pandas 2.3.3');
    expect(response.result.text).toContain('GeoPandas is not listed');
    expect(response.result.text).toContain('pandas is a separate package');
    expect(response.usage).toEqual({ promptTokens: 0, completionTokens: 0, cacheHitTokens: 0, cacheMissTokens: 0 });
  });

  it('recommends pandas only when the Python runtime is enabled', async () => {
    const input = await assistantInput(createWorkspace(), { prompt: 'Is Polars supported here?' });
    const assistantEnv: Env = {
      ...testEnv,
      DEEPSEEK_KEY: testEnv.DEEPSEEK_KEY ?? 'test-provider-key',
      COMPUTE_LOADER: undefined,
      TABLE_COMPUTE_PYTHON: 'enabled',
    };

    const response = await respondToTablePrompt(assistantEnv, input, providerFetch({ kind: 'refusal', text: 'The provider should not be called.' }));

    expect(response.result.kind).toBe('explanation');
    if (response.result.kind !== 'explanation') throw new Error('Expected a capability explanation.');
    expect(response.result.text).toContain('Polars is not supported');
    expect(response.result.text).toContain('pandas is listed and available to use instead');
  });

  it('sends only current public table context, redacts member identities, and enriches references from active state', async () => {
    const input = await assistantInput();
    const assistantEnv: Env = { ...testEnv, COMPUTE_LOADER: undefined, TABLE_COMPUTE_PYTHON: 'enabled' };
    const raw = {
      kind: 'explanation',
      text: 'The borrow action requires available equipment.',
      references: [
        { kind: 'action', id: 'borrow' },
        { kind: 'field', collectionId: 'equipment', id: 'available' },
        { kind: 'record', collectionId: 'equipment', id: 'camera' },
      ],
    };
    const stateBefore = JSON.stringify(input.workspace.domain);
    const response = await respondToTablePrompt(assistantEnv, input, providerFetch(raw, (content, body) => {
      expect(body.max_tokens).toBe(32768);
      expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(48 * 1024);
      const user = JSON.parse(content) as { kind: string; prompt: string; context: Record<string, unknown> };
      expect(user.kind).toBe('table-assistant');
      expect(user.prompt).toBe(input.prompt);
      expect(Object.keys(user.context).sort()).toEqual(['computeCapabilities', 'conversation', 'notes', 'program', 'records', 'role', 'seat', 'turn']);
      expect(user.context.computeCapabilities).toEqual({
        profile: 'tabletop-compute-1',
        runtimes: ['python'],
        pythonLibraries: ['Python standard library', 'pandas 2.3.3', 'numpy 2.3.4', 'scipy 1.16.3', 'openpyxl 3.1.5', 'python-dateutil 2.9.0.post0'],
      });
      expect(user.context.notes).toEqual([]);
      expect(user.context.role).toBe('owner');
      expect(user.context.seat).toBe('host');
      expect(user.context.conversation).toEqual([]);
      const serialized = JSON.stringify(user.context);
      for (const secret of [ownerId, participantId, ownerName, participantName, 'HIDDEN_SOURCE_SECRET', 'ROOM_ACTIVITY_SECRET']) {
        expect(serialized).not.toContain(secret);
      }
      expect(serialized).toContain('host');
      expect(serialized).not.toContain('evidence');
      expect(serialized).not.toContain('assumptions');
    }));
    expect(response.result.kind).toBe('explanation');
    if (response.result.kind !== 'explanation') throw new Error('Expected an explanation.');
    expect(response.result.references).toEqual([
      { kind: 'action', id: 'borrow', label: 'borrow' },
      { kind: 'field', collectionId: 'equipment', id: 'available', label: 'Available' },
      { kind: 'record', collectionId: 'equipment', id: 'camera', label: 'Record camera' },
    ]);
    expect(response).toMatchObject({ serverOmittedConversationEntries: 0, providerOmittedConversationEntries: 0 });
    expect(response.jobId).toBe(input.jobId);
    expect(response.usage).toMatchObject({ promptTokens: 45, completionTokens: 80, cacheMissTokens: 35 });
    expect(JSON.stringify(input.workspace.domain)).toBe(stateBefore);
    const bill = await billingRow(input.jobId);
    expect(bill).toMatchObject({ status: 'settled', max_output_tokens: 32768 });
    expect(bill?.max_input_tokens).toBeGreaterThan(0);
  });

  it('returns a revision-bound action proposal without applying it', async () => {
    const workspace = createWorkspace();
    const input = await assistantInput(workspace, { prompt: 'Please prepare the borrow action for the camera; do not apply it.' });
    const before = JSON.stringify(workspace.domain);
    const response = await respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'action-proposal',
      text: 'I prepared the borrow action for the camera. Confirm before it is applied.',
      actionId: 'borrow',
      inputs: { item: 'camera' },
    }));
    expect(response.result).toEqual({
      kind: 'action-proposal',
      text: 'I prepared the borrow action for the camera. Confirm before it is applied.',
      actionId: 'borrow',
      inputs: { item: 'camera' },
      expectedRevision: revision,
      expectedRuleRevision: 4,
      expectedActionRevision: 12,
      confirmationRequired: true,
    });
    expect(JSON.stringify(workspace.domain)).toBe(before);
    const bill = await billingRow(input.jobId);
    expect(bill?.status).toBe('settled');
  });

  it('asks for clarification when translated wording cannot identify an exact action, without applying it', async () => {
    const input = await assistantInput(createWorkspace(), {
      prompt: 'ช่วยเตรียมยืมกล้อง camera ให้ฉันตรวจและยืนยันเองก่อน',
    });
    const before = JSON.stringify(input.workspace.domain);
    const response = await respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'action-proposal', text: 'Untrusted proposed text', actionId: 'borrow', inputs: { item: 'camera' },
    }));
    expect(response.result).toMatchObject({ kind: 'clarification' });
    expect(response.result.text).toContain('กรุณาระบุชื่อคำสั่ง');
    expect(response.result.text).not.toContain('Untrusted proposed text');
    expect(response.result).not.toHaveProperty('actionId');
    expect(response.result).not.toHaveProperty('confirmationRequired');
    expect(JSON.stringify(input.workspace.domain)).toBe(before);
    expect((await billingRow(input.jobId))?.status).toBe('settled');
  });

  it('rejects an invalid action proposal after settling known provider usage', async () => {
    const participant: Member = { actorId: participantId, name: participantName, role: 'participant', seat: 'member-1' };
    const input = await assistantInput(createWorkspace(participant), { prompt: 'Prepare return for camera.' });
    await expect(respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'action-proposal', text: 'Try returning the camera.', actionId: 'return', inputs: { item: 'camera' },
    }))).rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    expect((await billingRow(input.jobId))?.status).toBe('settled');
  });

  it('carries only bounded prior dialogue and reports whole-entry omissions separately from server omissions', async () => {
    const input = await assistantInput(createWorkspace(), {
      conversation: Array.from({ length: 6 }, (_, index) => ({
        prompt: `Prior prompt ${index} ${'p'.repeat(3_500)} ${ownerId}`,
        result: { kind: 'explanation' as const, text: `Prior answer ${index} ${'r'.repeat(2_500)} ${participantName}` },
        expectedRevision: String(index + 1).repeat(64).slice(0, 64),
      })),
      conversationOmittedCount: 3,
    });
    let retainedPrompts: string[] = [];
    const response = await respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'clarification', text: 'Which item would you like to borrow?',
    }, (content) => {
      const user = JSON.parse(content) as { context: { conversation: Array<{ prompt: string; result: { text: string } }> } };
      retainedPrompts = user.context.conversation.map((entry) => entry.prompt);
      const historyText = JSON.stringify(user.context.conversation);
      expect(historyText).not.toContain(ownerId);
      expect(historyText).not.toContain(participantName);
      expect(retainedPrompts.length).toBeLessThan(6);
      expect(retainedPrompts.every((entry) => /Prior prompt [3-5]/u.test(entry))).toBe(true);
    }));
    expect(response.result.kind).toBe('clarification');
    expect(response.serverOmittedConversationEntries).toBe(3);
    expect(response.providerOmittedConversationEntries).toBeGreaterThan(0);
    expect(retainedPrompts).toHaveLength(6 - response.providerOmittedConversationEntries);
    expect((await billingRow(input.jobId))?.status).toBe('settled');
  });

  it('drops optional conversation entries to meet the complete 48 KiB provider request cap', async () => {
    const workspace = createWorkspace();
    const domain = workspace.domain;
    if (domain.kind !== 'table') throw new Error('Expected table state.');
    domain.records.equipment = Array.from({ length: 80 }, (_, index) => ({
      id: `item-${index}`,
      values: { name: 'r'.repeat(400), available: true, borrower: null },
    }));
    const conversation = Array.from({ length: 6 }, (_, index) => ({
      prompt: `Prior prompt ${index} ${'p'.repeat(2500)}`,
      result: { kind: 'explanation' as const, text: `Prior answer ${index} ${'r'.repeat(1000)}` },
      expectedRevision: String(index + 1).repeat(64).slice(0, 64),
    }));
    const input = await assistantInput(workspace, { conversation });
    let retainedCount = 0;
    const response = await respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'clarification', text: 'Which item should I check?',
    }, (content, body) => {
      expect(new TextEncoder().encode(JSON.stringify(body)).byteLength).toBeLessThanOrEqual(48 * 1024);
      const user = JSON.parse(content) as { context: { records: Record<string, unknown[]>; conversation: unknown[] } };
      expect(user.context.records.equipment).toHaveLength(80);
      retainedCount = user.context.conversation.length;
    }));
    expect(response.providerConversationLimitOmittedEntries).toBeGreaterThan(0);
    expect(response.providerRequestLimitOmittedEntries).toBeGreaterThan(0);
    expect(response.providerOmittedConversationEntries).toBe(
      response.providerConversationLimitOmittedEntries + response.providerRequestLimitOmittedEntries,
    );
    expect(retainedCount + response.providerOmittedConversationEntries).toBe(6);
    expect((await billingRow(input.jobId))?.status).toBe('settled');
  });

  it('rejects oversized authoritative state before reserving billing or calling the provider', async () => {
    const workspace = createWorkspace();
    const domain = workspace.domain;
    if (domain.kind !== 'table') throw new Error('Expected table state.');
    domain.records.equipment = Array.from({ length: 100 }, (_, index) => ({
      id: `item-${index}`,
      values: { name: 'x'.repeat(480), available: true, borrower: null },
    }));
    const input = await assistantInput(workspace);
    let calls = 0;
    const deniedFetch: typeof fetch = async () => { calls += 1; throw new Error('Oversized table must not reach provider.'); };
    await expect(respondToTablePrompt(testEnv, input, deniedFetch)).rejects.toMatchObject({ code: 'TABLE_ASSISTANT_CONTEXT_TOO_LARGE' });
    expect(calls).toBe(0);
    expect(await billingRow(input.jobId)).toBeUndefined();
  });

  it('marks a dispatched provider failure uncertain and requires explicit consent and matching membership', async () => {
    const input = await assistantInput();
    const failingFetch: typeof fetch = async () => { throw new Error('secret provider error'); };
    await expect(respondToTablePrompt(testEnv, input, failingFetch)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_REQUEST_FAILED' });
    expect((await billingRow(input.jobId))?.status).toBe('uncertain');

    const noConsent = { ...input, jobId: await digest(`no-consent:${crypto.randomUUID()}`), consent: false };
    await expect(respondToTablePrompt(testEnv, noConsent as unknown as TableAssistantInput, failingFetch))
      .rejects.toMatchObject({ code: 'TABLE_ASSISTANT_CONSENT_REQUIRED' });
    const forged = { ...input, jobId: await digest(`forged:${crypto.randomUUID()}`), actorId: 'other-account' };
    await expect(respondToTablePrompt(testEnv, forged, failingFetch)).rejects.toMatchObject({ code: 'TABLE_ASSISTANT_FORBIDDEN' });
  });

  it('accepts stored note records and sends only their text and colour (F037 regression)', async () => {
    const input = await assistantInput();
    const domain = input.workspace.domain;
    if (domain.kind !== 'table') throw new Error('Expected a table fixture.');
    domain.notes = [{
      id: 'note_ab12cd34', text: 'Borrow only after training.', color: 'yellow',
      x: 10, y: 20, width: 236, height: 172, createdBy: ownerId, createdAt: 1, updatedAt: 1,
    }];
    const seen: unknown[] = [];
    const response = await respondToTablePrompt(testEnv, input, providerFetch({ kind: 'explanation', text: 'ok', references: [] }, (content) => {
      const user = JSON.parse(content) as { context?: { notes?: unknown } };
      seen.push(user.context?.notes);
    }));
    expect(response.result.kind).toBe('explanation');
    expect(seen[0]).toEqual([{ text: 'Borrow only after training.', color: 'yellow' }]);
  });

  it('passes follow-up suggestions through as choices, redacted and without duplicates', async () => {
    const input = await assistantInput();
    const response = await respondToTablePrompt(testEnv, input, providerFetch({
      kind: 'explanation', text: 'Pick where the clock goes.', references: [],
      suggestions: ['Put a clock next to each step', 'Put a clock next to each step', `Ask ${participantName}`, ' '],
    }));
    expect(response.result.kind).toBe('explanation');
    const suggestions = response.result.kind === 'explanation' ? response.result.suggestions ?? [] : [];
    expect(suggestions[0]).toBe('Put a clock next to each step');
    expect(suggestions).toHaveLength(2);
    expect(JSON.stringify(suggestions)).not.toContain(participantName);
  });

  it('accepts a small answer whose SSE envelope exceeds the old 64 KiB response cap (F041)', async () => {
    const input = await assistantInput();
    const payload = { kind: 'build-request', text: 'Prepare a form.' };
    const content = JSON.stringify(payload);
    const padding = JSON.stringify({ model: 'deepseek-flash', choices: [{ index: 0, delta: { content: '' } }], padding: 'x'.repeat(2_000) });
    const usage = JSON.stringify({
      model: 'deepseek-flash', choices: [],
      usage: { prompt_tokens: 45, completion_tokens: 12, total_tokens: 57, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 45 },
    });
    const stream = `${`data: ${padding}\n\n`.repeat(40)}data: ${JSON.stringify({ model: 'deepseek-flash', choices: [{ index: 0, delta: { content }, finish_reason: 'stop' }] })}\n\ndata: ${usage}\n\ndata: [DONE]\n\n`;
    expect(new TextEncoder().encode(stream).byteLength).toBeGreaterThan(64 * 1024);
    const fetchStream: typeof fetch = async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    const response = await respondToTablePrompt(testEnv, input, fetchStream);
    expect(response.result).toMatchObject({ kind: 'build-request', text: 'Prepare a form.' });
  });

  it('reports incremental provider progress before the final JSON is complete (F037)', async () => {
    const input = await assistantInput();
    const payload = { kind: 'build-request', text: 'Prepare a form.' };
    const seen: number[] = [];
    const response = await respondToTablePrompt(testEnv, input, providerFetch(payload), (progress) => {
      seen.push(progress.receivedChars);
    });
    expect(response.result).toMatchObject({ kind: 'build-request' });
    expect(seen.length).toBeGreaterThan(1);
    expect(seen.at(-1)).toBe(JSON.stringify(payload).length);
    expect([...seen].sort((left, right) => left - right)).toEqual(seen);
  });

  it('reports a streamed answer cut by the token ceiling as truncated (F037)', async () => {
    const input = await assistantInput();
    const events = [
      { model: 'deepseek-flash', choices: [{ index: 0, delta: { content: '{"kind":' } }] },
      { model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'length' }] },
      {
        model: 'deepseek-flash',
        choices: [],
        usage: { prompt_tokens: 45, completion_tokens: 8_192, total_tokens: 8_237, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 35 },
      },
    ];
    const stream = `${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
    const truncatedFetch: typeof fetch = async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    await expect(respondToTablePrompt(testEnv, input, truncatedFetch)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_TRUNCATED' });
  });
});
