import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { createDomain } from '../src/tabletop/domain/index.js';
import type { ActorContext, CaseKind, ChangeSet, Member, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { proposeChange, type AIProposalRequest } from './ai.js';
import type { Env } from './contracts.js';

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
  const role: Member['role'] = kind === 'invoice' ? 'owner' : kind === 'teaching' ? 'teacher' : 'dm';
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
  return { kind, rule: { allyTarget: true, apCost: 1, oncePerTurn: true } };
}

function providerFetch(change: ChangeSet, inspect?: (userContent: string, body: Record<string, unknown>) => void): typeof fetch {
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
});
