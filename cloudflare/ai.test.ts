import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { createDomain } from '../src/tabletop/domain/index.js';
import type { ActorContext, CaseKind, ChangeSet, Member, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import { proposeChange, type AIProposalRequest } from './ai.js';
import { ModelStreamFailure, measureDeepSeekChangeRequest, type DeepSeekChangeInput, type DeepSeekChangeProgress } from '../server/providers/deepseek-changes.js';
import type { Env } from './contracts.js';
import type { ComputeRuntimeCapabilities } from '../src/tabletop/shared/compute-runtime-profiles.js';

const testEnv = env as Env;

function testHash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
  let state = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    state = Math.imul(state ^ text.charCodeAt(index), 0x01000193) >>> 0;
  }
  return state.toString(16).padStart(8, '0').repeat(8);
}

function workspace(kind: CaseKind, actorId = `actor-${kind}`): WorkspaceView {
  const role: Member['role'] = kind === 'invoice' || kind === 'table' ? 'owner' : kind === 'teaching' ? 'teacher' : 'dm';
  const member: Member = { actorId, name: `Trusted ${role}`, role };
  const id = `workspace-${kind}-${crypto.randomUUID()}`;
  const context: ActorContext = {
    actorId,
    name: member.name,
    role,
    workspaceId: id,
    epoch: 3,
    now: Date.UTC(2026, 9, 18),
    hash: testHash,
  };
  const domain = createDomain(kind, context);
  if (domain.kind === 'invoice') {
    domain.sources.find((source) => source.id === 'sample_rate_card')!.excerpt = 'SELECTED_RATE_CARD_SENTINEL: remote surcharge is 5.00 THB.';
    domain.sources.find((source) => source.id === 'sample_rate_card')!.pages[0]!.text = 'SOURCE_PAGE_PRIVATE_SENTINEL';
    domain.shipments[0]!.id = 'SHIPMENT_PRIVATE_SENTINEL';
    domain.invoiceLines[0]!.billedSatang = 999_999;
    domain.runs.push({
      id: 'RUN_PRIVATE_SENTINEL',
      createdAt: context.now,
      dataRevision: domain.dataRevision,
      ruleRevision: domain.ruleRevision,
      result: { rows: [], gaps: [], knownExpectedSatang: 0, knownBilledSatang: 0, deltaSatang: 0, unknownCount: 0 },
      sourceIds: [],
    });
  } else if (domain.kind === 'teaching') {
    domain.teacherNote = 'TEACHER_NOTE_PRIVATE_SENTINEL';
    domain.answers.push({
      actorId: 'learner-one',
      name: 'Learner One',
      questionId: domain.questionId,
      lessonRevision: domain.ruleRevision,
      value: 123,
      correct: false,
      feedback: 'LEARNER_ANSWER_PRIVATE_SENTINEL',
      submittedAt: context.now,
    });
  } else if (domain.kind === 'table') {
    domain.sources.push({
      id: 'source_fixture',
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
      sha256: 'a'.repeat(64),
      createdAt: context.now,
    });
  } else {
    domain.dmNote = 'DM_NOTE_PRIVATE_SENTINEL';
    domain.events[0]!.text = 'ENCOUNTER_EVENT_PRIVATE_SENTINEL';
  }
  return {
    id,
    title: `Fixture ${kind}`,
    kind,
    epoch: context.epoch,
    revision: 'room-revision-3',
    actor: member,
    members: [member],
    domain,
    createdAt: context.now,
    expiresAt: context.now + 60 * 60_000,
  };
}

function request(kind: CaseKind, overrides: Partial<AIProposalRequest> = {}): AIProposalRequest {
  const target = workspace(kind);
  return {
    workspace: target,
    actorId: target.actor.actorId,
    commandId: crypto.randomUUID(),
    prompt: 'Suggest one bounded rule adjustment using the provided current context.',
    consent: true,
    ...(kind === 'invoice' ? { sourceId: 'sample_rate_card' } : {}),
    ...overrides,
  };
}

function proposal(kind: CaseKind): ChangeSet {
  if (kind === 'invoice') {
    return {
      kind,
      operations: [{
        op: 'setSurcharge',
        id: 'remote-surcharge-draft',
        zone: '*',
        amountSatang: 500,
        from: '2026-10-15',
        to: null,
        sourceId: 'sample_rate_card',
      }],
    };
  }
  if (kind === 'teaching') return { kind, parameters: { force: 12, mass: 2, time: 2 } };
  if (kind === 'table') return equipmentChange('source_fixture');
  return { kind, rule: { allyTarget: true, apCost: 1, oncePerTurn: true } };
}

type ClarifyReply = { kind: 'clarify'; question: string; options: string[] };

function providerFetch(change: ChangeSet | ClarifyReply, inspect?: (userContent: string, body: Record<string, unknown>) => void): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.deepseek.com/chat/completions') throw new Error('Unexpected provider URL');
    if (init?.method !== 'POST' || init.redirect !== 'manual' || !(init.signal instanceof AbortSignal)) {
      throw new Error('Provider request omitted required safety options');
    }
    const bodyText = typeof init.body === 'string' ? init.body : '';
    const body: unknown = JSON.parse(bodyText);
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Expected provider JSON object');
    const object = body as Record<string, unknown>;
    if (!Array.isArray(object.messages)) throw new Error('Expected provider messages');
    const user = object.messages.find((message) => typeof message === 'object' && message !== null
      && (message as { role?: unknown }).role === 'user') as { content?: unknown } | undefined;
    if (typeof user?.content !== 'string') throw new Error('Expected bounded user message');
    inspect?.(user.content, object);
    return new Response(JSON.stringify({
      model: 'deepseek-flash',
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(change) } }],
      usage: { prompt_tokens: 20, completion_tokens: 12, prompt_cache_hit_tokens: 5, prompt_cache_miss_tokens: 15 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

/** F045: the same provider call, answered as the SSE stream the real endpoint sends. */
function streamingFetch(
  content: string,
  options: { finish?: boolean } = {},
): typeof fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.deepseek.com/chat/completions' || init?.method !== 'POST'
      || init.redirect !== 'manual' || !(init.signal instanceof AbortSignal)) {
      throw new Error('Unexpected streamed provider request.');
    }
    const body: unknown = JSON.parse(typeof init.body === 'string' ? init.body : '');
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new Error('Expected provider JSON object');
    const object = body as Record<string, unknown>;
    if (object.model !== 'deepseek-flash' || object.stream !== true
      || !isRecord(object.stream_options) || object.stream_options.include_usage !== true) {
      throw new Error('Expected a streamed request with usage.');
    }
    const events: string[] = [];
    for (let index = 0; index < content.length; index += 37) {
      events.push(`data: ${JSON.stringify({
        model: 'deepseek-flash',
        choices: [{ index: 0, delta: { content: content.slice(index, index + 37) } }],
      })}\n\n`);
    }
    if (options.finish !== false) {
      events.push(`data: ${JSON.stringify({ model: 'deepseek-flash', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`);
      events.push(`data: ${JSON.stringify({
        model: 'deepseek-flash',
        choices: [],
        usage: { prompt_tokens: 45, completion_tokens: 80, total_tokens: 125, prompt_cache_hit_tokens: 10, prompt_cache_miss_tokens: 35 },
      })}\n\n`);
    }
    events.push('data: [DONE]\n\n');
    return new Response(events.join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe('Cloudflare AI proposal helper', () => {
  it('sends only the selected verified invoice excerpt and current rules, then returns a validated draft', async () => {
    const input = request('invoice');
    let observed = '';
    const result = await proposeChange(testEnv, input, providerFetch(proposal('invoice'), (content, body) => {
      observed = content;
      expect(body.model).toBe('deepseek-flash');
      expect(body.thinking).toEqual({ type: 'disabled' });
      expect(body.tool_choice).toBe('none');
    }));

    expect(result.change).toEqual(proposal('invoice'));
    expect(result.jobId).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.usage).toMatchObject({ promptTokens: 20, completionTokens: 12, cacheMissTokens: 15 });
    expect(observed).toContain('SELECTED_RATE_CARD_SENTINEL');
    for (const secret of ['SOURCE_PAGE_PRIVATE_SENTINEL', 'SHIPMENT_PRIVATE_SENTINEL', 'RUN_PRIVATE_SENTINEL']) {
      expect(observed).not.toContain(secret);
    }
  });

  it('excludes learner answers and teacher notes from teaching proposals', async () => {
    let observed = '';
    const result = await proposeChange(testEnv, request('teaching'), providerFetch(proposal('teaching'), (content) => {
      observed = content;
      expect(JSON.parse(content)).toEqual({
        kind: 'teaching',
        prompt: 'Suggest one bounded rule adjustment using the provided current context.',
        parameters: { force: 10, mass: 2, time: 2 },
      });
    }));
    expect(result.change).toEqual(proposal('teaching'));
    expect(observed).not.toContain('TEACHER_NOTE_PRIVATE_SENTINEL');
    expect(observed).not.toContain('LEARNER_ANSWER_PRIVATE_SENTINEL');
  });

  it('sends only the current encounter rule, excluding DM notes and event history', async () => {
    let observed = '';
    const result = await proposeChange(testEnv, request('encounter'), providerFetch(proposal('encounter'), (content) => {
      observed = content;
      expect(JSON.parse(content)).toEqual({
        kind: 'encounter',
        prompt: 'Suggest one bounded rule adjustment using the provided current context.',
        rule: { allyTarget: false, apCost: 0, oncePerTurn: false },
      });
    }));
    expect(result.change).toEqual(proposal('encounter'));
    expect(observed).not.toContain('DM_NOTE_PRIVATE_SENTINEL');
    expect(observed).not.toContain('ENCOUNTER_EVENT_PRIVATE_SENTINEL');
  });

  it('sends every table source and current program under the reserved 32768-token output cap', async () => {
    const input = request('table');
    const table = input.workspace.domain;
    if (table.kind !== 'table') throw new Error('Expected table fixture.');
    const computeCapabilities: ComputeRuntimeCapabilities = { profile: 'tabletop-compute-1', runtimes: ['javascript'], pythonLibraries: [] };
    const measuredInput: DeepSeekChangeInput = {
      kind: 'table', prompt: input.prompt,
      sources: table.sources.map(({ id, filename, text }) => ({ id, filename, text })),
      program: table.program, turn: table.turn,
      records: table.records, computeCapabilities,
    };
    const requestBytes = measureDeepSeekChangeRequest(measuredInput);
    let observed = '';
    const result = await proposeChange(testEnv, input, providerFetch(proposal('table'), (content, body) => {
      observed = content;
      expect(body.max_tokens).toBe(32_768);
      const sent = JSON.parse(content) as {
        kind: string;
        sources: Array<{ id: string; filename: string; text: string }>;
        program: unknown;
        turn: string | null;
      };
      expect(sent).toEqual({
        kind: 'table',
        prompt: input.prompt,
        sources: [{ id: 'source_fixture', filename: tableScenarioSources.equipment.filename, text: tableScenarioSources.equipment.text }],
        program: null,
        turn: null,
        records: {}, computeCapabilities,
      });
    }));
    expect(result.change).toEqual(proposal('table'));
    const observedRequest = JSON.parse(observed) as { sources: Array<{ text: string }> };
    expect(observedRequest.sources[0]?.text).toBe(tableScenarioSources.equipment.text);
    const billingStub = testEnv.BILLING.get(testEnv.BILLING.idFromName('global'));
    const reservation = await runInDurableObject(billingStub, (_instance, state) => state.storage.sql
      .exec<{ max_input_tokens: number; max_output_tokens: number }>(
        'SELECT max_input_tokens, max_output_tokens FROM billing_jobs WHERE id = ?', result.jobId,
      ).toArray()[0]);
    expect(reservation?.max_input_tokens).toBeGreaterThanOrEqual(requestBytes);
    expect(reservation?.max_output_tokens).toBe(32_768);

    // F035: the Room checks rules.draft before dispatch; the helper still refuses a caller whose
    // claimed role does not match their room membership.
    const member: Member = { ...input.workspace.actor, role: 'participant', seat: 'member-1' };
    const participantInput: AIProposalRequest = {
      ...input,
      workspace: { ...input.workspace, actor: member, members: [{ ...member, role: 'owner' }] },
    };
    let calls = 0;
    const deniedFetch: typeof fetch = async () => { calls += 1; throw new Error('Provider must not run for a mismatched member.'); };
    await expect(proposeChange(testEnv, participantInput, deniedFetch)).rejects.toMatchObject({ code: 'AI_FORBIDDEN' });
    expect(calls).toBe(0);
  });

  it('leaves out the text of files the active rules already cite, so a grown table can still be edited', async () => {
    const input = request('table');
    const table = input.workspace.domain;
    if (table.kind !== 'table') throw new Error('Expected table fixture.');
    const change = proposal('table');
    if (change.kind !== 'table') throw new Error('Expected a table change.');
    table.program = change.program;
    table.records = change.initialRecords;
    table.sources.push({ id: 'source_new', filename: 'new.csv', text: 'date,commits\n2026-10-22,5\n', sha256: 'b'.repeat(64), createdAt: 1 });
    expect(change.program.evidence.some((item) => item.sourceId === 'source_fixture')).toBe(true);
    let sent: { sources: Array<{ id: string; text: string }>; importedSources?: Array<{ id: string; filename: string }> } | undefined;
    await proposeChange(testEnv, input, providerFetch({ ...change, initialRecords: {} }, (content) => {
      sent ??= JSON.parse(content) as typeof sent;
    })).catch((error: unknown) => { if (!sent) throw error; });
    expect(sent?.sources).toEqual([{ id: 'source_new', filename: 'new.csv', text: 'date,commits\n2026-10-22,5\n' }]);
    expect(sent?.importedSources).toMatchObject([{ id: 'source_fixture', filename: tableScenarioSources.equipment.filename }]);
    expect(sent?.importedSources?.[0]).toHaveProperty('note');
    expect(JSON.stringify(sent)).not.toContain(tableScenarioSources.equipment.text.slice(0, 40));
  });

  it('rejects complete table source sets above the bounded model input before reserving or calling the provider', async () => {
    const input = request('table');
    const domain = input.workspace.domain;
    if (domain.kind !== 'table') throw new Error('Expected table fixture.');
    domain.sources = Array.from({ length: 4 }, (_, index) => ({
      id: `source_${index}`,
      filename: `source-${index}.txt`,
      text: 'x'.repeat(15_000),
      sha256: 'b'.repeat(64),
      createdAt: input.workspace.createdAt,
    }));
    let calls = 0;
    const deniedFetch: typeof fetch = async () => { calls += 1; throw new Error('Oversized input must not reach provider.'); };
    await expect(proposeChange(testEnv, input, deniedFetch))
      .rejects.toMatchObject({ code: 'MODEL_PROVIDER_INPUT_TOO_LARGE' });
    expect(calls).toBe(0);
  });

  it('supports prompt-only creation without fabricating evidence', async () => {
    const input = request('table');
    if (input.workspace.domain.kind !== 'table') throw new Error('Expected table fixture.');
    input.workspace.domain.sources = [];
    let calls = 0;
    const change = equipmentChange('unused');
    change.program.evidence = [];
    change.program.assumptions = ['Hypothetical equipment for this requested example.'];
    const result = await proposeChange(testEnv, input, providerFetch(change, content => {
      calls += 1;
      expect(JSON.parse(content)).toMatchObject({ sources: [], records: {}, program: null });
    }));
    expect(result.change).toEqual(change);
    expect(calls).toBe(1);
  });

  it('repairs a semantically invalid generated tool with separate metered attempts', async () => {
    const input = request('table');
    const bad = equipmentChange('source_fixture');
    bad.program.actions[0].effects[0].field = 'missing_field';
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      const data = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
      const sent = JSON.parse(data.messages[1].content);
      calls++;
      if (calls === 2) {
        expect(sent.repair.attempt).toBe(2);
        expect(sent.repair.issues.join(' ')).toContain('unknown record field');
        expect(sent.repair.previousOutput).toContain('missing_field');
      }
      return providerFetch(calls === 1 ? bad : proposal('table'))(url, init);
    };
    const result = await proposeChange(testEnv, input, fetchImpl);
    expect(calls).toBe(2);
    expect(result.usage.promptTokens).toBe(40);
    expect(result.usage.completionTokens).toBe(24);
    expect(result.change).toEqual(proposal('table'));
    const stub = testEnv.BILLING.get(testEnv.BILLING.idFromName('global'));
    const rows = await runInDurableObject(stub, (_instance, state) => state.storage.sql
      .exec<{ status: string }>('SELECT status FROM billing_jobs WHERE workspace_id = ?', input.workspace.id).toArray());
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.status === 'settled')).toBe(true);
  });

  it('returns a table clarification after one settled attempt without validating rules (F012)', async () => {
    const input = request('table');
    const clarification = { question: 'Which records should the table track?', options: ['Equipment', 'Shifts', 'I will attach a file'] };
    let calls = 0;
    const result = await proposeChange(testEnv, input, providerFetch({ kind: 'clarify', ...clarification }, () => { calls += 1; }));
    expect(calls).toBe(1);
    expect('change' in result).toBe(false);
    if (!('clarification' in result)) throw new Error('Expected a clarification.');
    expect(result.clarification).toEqual(clarification);
    expect(result.jobId).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.usage).toEqual({ promptTokens: 20, completionTokens: 12, cacheHitTokens: 5, cacheMissTokens: 15 });
    expect(input.workspace.domain.candidate).toBeNull();
    const stub = testEnv.BILLING.get(testEnv.BILLING.idFromName('global'));
    const rows = await runInDurableObject(stub, (_instance, state) => state.storage.sql
      .exec<{ id: string; status: string; completion_tokens: number }>(
        'SELECT id, status, completion_tokens FROM billing_jobs WHERE workspace_id = ?', input.workspace.id,
      ).toArray());
    expect(rows).toEqual([{ id: result.jobId, status: 'settled', completion_tokens: 12 }]);
  });

  it('does not turn a repairable failure into a clarification (F031)', async () => {
    const input = request('table');
    const bad = equipmentChange('source_fixture');
    bad.program.actions[0].effects[0].field = 'missing_field';
    const clarification = { kind: 'clarify', question: 'Which field records who borrowed the item?', options: ['Borrower', 'Owner', 'Nobody'] };
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      calls += 1;
      return providerFetch(calls === 1 ? bad : clarification)(url, init);
    };
    const rejection = await proposeChange(testEnv, input, fetchImpl).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    expect((rejection as { reasons?: string[] }).reasons?.join(' ')).toContain('Do not ask a clarifying question');
    expect(calls).toBe(4);
    const stub = testEnv.BILLING.get(testEnv.BILLING.idFromName('global'));
    const rows = await runInDurableObject(stub, (_instance, state) => state.storage.sql
      .exec<{ status: string }>('SELECT status FROM billing_jobs WHERE workspace_id = ?', input.workspace.id).toArray());
    expect(rows).toHaveLength(4);
    expect(rows.every(row => row.status === 'settled')).toBe(true);
  });

  it('repairs a malformed clarify reply like any other rejected table reply (F012)', async () => {
    const input = request('table');
    let calls = 0;
    const fetchImpl: typeof fetch = async (url, init) => {
      calls += 1;
      if (calls === 2) {
        const data = JSON.parse(String(init?.body)) as { messages: { content: string }[] };
        const sent = JSON.parse(data.messages[1].content) as { repair: { attempt: number; issues: string[] } };
        expect(sent.repair.attempt).toBe(2);
        expect(sent.repair.issues.length).toBeGreaterThan(0);
      }
      return providerFetch(calls === 1 ? { kind: 'clarify', question: 'Which records?', options: ['Only two', 'answers'] } : proposal('table'))(url, init);
    };
    const result = await proposeChange(testEnv, input, fetchImpl);
    expect(calls).toBe(2);
    if (!('change' in result)) throw new Error('Expected a repaired table draft.');
    expect(result.change).toEqual(proposal('table'));
  });

  it('treats a clarify reply for teaching or encounter as rejected output (F012)', async () => {
    for (const kind of ['teaching', 'encounter'] as const) {
      await expect(proposeChange(testEnv, request(kind), providerFetch({ kind: 'clarify', question: 'What should change?', options: ['A', 'B', 'C'] })))
        .rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    }
  });

  it('caps generated repairs at four attempts (three repairs plus one minimal fallback) without accepting a broken artifact', async () => {
    const input = request('table');
    const invalid = equipmentChange('source_fixture');
    invalid.program.actions[0].effects[0].field = 'missing_field';
    let calls = 0;
    const rejection = await proposeChange(testEnv, input, providerFetch(invalid, () => { calls++; })).catch((error: unknown) => error);
    expect(rejection).toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    // F016: the last validation issues travel with the error so the requester sees the real cause.
    expect((rejection as { reasons?: string[] }).reasons?.length).toBeGreaterThan(0);
    expect(calls).toBe(4);
    expect(input.workspace.domain.candidate).toBeNull();
  });

  it('falls back to the smallest valid table on the final attempt', async () => {
    const input = request('table');
    const invalid = equipmentChange('source_fixture');
    invalid.program.actions[0].effects[0].field = 'missing_field';
    const minimal: ChangeSet = {
      kind: 'table',
      program: {
        version: 1, title: 'Minimal', description: 'Smallest table that satisfies the request.',
        collections: [{ id: 'items', title: 'Items', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }] }],
        actions: [{
          id: 'add_item', title: 'Add item', description: 'Add one item.', roles: ['owner'],
          parameters: [], conditions: [], effects: [],
          creates: [{ collection: 'items', values: { name: { literal: 'Sample' } } }],
          requireTurn: false, advanceTurn: false,
        }],
        invariants: [], turnOrder: [], evidence: structuredClone(invalid.program.evidence), assumptions: [],
      },
      initialRecords: { items: [] },
    };
    const sequence: ChangeSet[] = [invalid, invalid, invalid, minimal];
    let calls = 0;
    const fetchImpl: typeof fetch = async (fetchInput, init) => {
      const change = sequence[Math.min(calls, sequence.length - 1)];
      calls += 1;
      return providerFetch(change)(fetchInput, init);
    };
    const result = await proposeChange(testEnv, input, fetchImpl);
    expect(calls).toBe(4);
    expect(result.change.kind).toBe('table');
    if (result.change.kind !== 'table') throw new Error('Expected a table change.');
    expect(result.change.program.title).toBe('Minimal');
  });

  it('reserves and dispatches each stable command once, rejecting replay and changed input', async () => {
    const input = request('teaching');
    let calls = 0;
    const fetchImpl = providerFetch(proposal('teaching'), () => { calls += 1; });
    const first = await proposeChange(testEnv, input, fetchImpl);
    expect(first.jobId).toMatch(/^[a-f0-9]{64}$/u);
    await expect(proposeChange(testEnv, input, fetchImpl)).rejects.toMatchObject({ code: 'AI_PROPOSAL_ALREADY_DISPATCHED' });
    await expect(proposeChange(testEnv, { ...input, prompt: 'Use a different supported adjustment.' }, fetchImpl))
      .rejects.toMatchObject({ code: 'BILLING_CONFLICT' });
    expect(calls).toBe(1);
  });

  it('keeps a failed provider call uncertain and refuses to bill or dispatch a retry', async () => {
    const input = request('encounter');
    let calls = 0;
    const failingFetch: typeof fetch = async () => {
      calls += 1;
      throw new Error('synthetic provider failure');
    };
    await expect(proposeChange(testEnv, input, failingFetch)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_REQUEST_FAILED' });
    await expect(proposeChange(testEnv, input, failingFetch)).rejects.toMatchObject({ code: 'AI_PROPOSAL_ALREADY_DISPATCHED' });
    expect(calls).toBe(1);
  });

  it('rejects missing consent, unverified evidence, forged actor identity, and unconfigured billing before provider use', async () => {
    const deniedFetch: typeof fetch = async () => { throw new Error('Provider must not be called'); };
    const invoice = request('invoice');
    await expect(proposeChange(testEnv, { ...invoice, consent: false } as unknown as AIProposalRequest, deniedFetch))
      .rejects.toMatchObject({ code: 'AI_INPUT_INVALID' });
    await expect(proposeChange(testEnv, { ...invoice, actorId: 'other-actor' }, deniedFetch))
      .rejects.toMatchObject({ code: 'AI_FORBIDDEN' });
    await expect(proposeChange(testEnv, { ...invoice, sourceId: 'not-a-reviewed-source' }, deniedFetch))
      .rejects.toMatchObject({ code: 'SOURCE_REQUIRED' });

    const missingKeyEnv: Env = { ...testEnv, DEEPSEEK_KEY: undefined };
    await expect(proposeChange(missingKeyEnv, request('teaching'), deniedFetch))
      .rejects.toMatchObject({ code: 'MODEL_NOT_CONFIGURED' });
  });

  it('forwards increasing stream progress for a table draft and still returns the validated change (F045)', async () => {
    const input = request('table');
    const expected = proposal('table');
    const payload = JSON.stringify(expected);
    const samples: DeepSeekChangeProgress[] = [];
    const result = await proposeChange(testEnv, input, streamingFetch(payload), (progress) => {
      samples.push(progress);
    });

    expect(result.change).toEqual(expected);
    expect(samples.length).toBeGreaterThan(2);
    expect(samples[0]?.receivedChars).toBeGreaterThan(0);
    expect(samples.at(-1)?.receivedChars).toBe(payload.length);
    for (let index = 1; index < samples.length; index += 1) {
      expect(samples[index]!.receivedChars).toBeGreaterThanOrEqual(samples[index - 1]!.receivedChars);
    }
    // The counters grow with the stream, not only when it finishes.
    expect(new Set(samples.map((sample) => sample.receivedChars)).size).toBeGreaterThan(2);
    expect(samples.every((sample) => sample.reasoningChars === 0)).toBe(true);
  });

  it('keeps bounded stream details when the provider closes without a finish reason (F045)', async () => {
    const input = request('table');
    const partial = '{"kind":"table"';
    const rejection = await proposeChange(testEnv, input, streamingFetch(partial, { finish: false }))
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(ModelStreamFailure);
    expect(rejection).toMatchObject({ code: 'MODEL_PROVIDER_REQUEST_FAILED' });
    const details = (rejection as ModelStreamFailure).details;
    expect(details).toMatchObject({
      timedOutBy: 'provider',
      limitMs: 240_000,
      receivedChars: partial.length,
      reasoningChars: 0,
      partialContent: partial,
    });
    expect(details.elapsedMs).toBeGreaterThanOrEqual(0);
  });
});
