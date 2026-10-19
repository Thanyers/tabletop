import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/tabletop/shared/contracts.js';
import { tableScenarioSources, equipmentChange } from '../../src/tabletop/testing/table-scenarios.js';
import { DeepSeekChangeProvider, measureDeepSeekChangeRequest, type DeepSeekChangeInput } from './deepseek-changes.js';

const API_KEY = 'test-only-deepseek-key';

function response(content: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model: 'deepseek-flash',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content } }],
    usage: {
      prompt_tokens: 40,
      completion_tokens: 30,
      prompt_cache_hit_tokens: 10,
      prompt_cache_miss_tokens: 30,
      completion_tokens_details: { reasoning_tokens: 0 },
    },
    ...overrides,
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function input(): DeepSeekChangeInput {
  return { kind: 'teaching', prompt: 'Use a smaller force for the example.', parameters: { force: 10, mass: 2, time: 2 } };
}

describe('DeepSeekChangeProvider', () => {
  it('sends bounded no-thinking JSON requests and validates teaching and encounter changes', async () => {
    let endpoint = '';
    let init: RequestInit | undefined;
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async (url, options) => {
        endpoint = String(url);
        init = options;
        return response(JSON.stringify({ kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 } }));
      },
    });
    const result = await provider.propose(input(), new AbortController().signal);
    expect(endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(init?.method).toBe('POST');
    expect(init?.redirect).toBe('manual');
    expect(new Headers(init?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body.model).toBe('deepseek-flash');
    expect(body.stream).toBe(false);
    expect(body.max_tokens).toBe(512);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain('parameters');
    const messages = body.messages as Array<{ role: string; content: string }>;
    expect(messages[1].content).not.toContain('answers');
    expect(result).toEqual({
      change: { kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 } },
      usage: { promptTokens: 40, completionTokens: 30, cacheHitTokens: 10, cacheMissTokens: 30, reasoningTokens: 0 },
    });

    const encounter = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => response(JSON.stringify({ kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } })),
    });
    await expect(encounter.propose({ kind: 'encounter', prompt: 'Let allies protect each other.', rule: { allyTarget: false, apCost: 0, oncePerTurn: false } }, new AbortController().signal))
      .resolves.toMatchObject({ change: { kind: 'encounter', rule: { allyTarget: true, apCost: 1, oncePerTurn: true } } });
    expect(Object.keys(provider)).not.toContain('apiKey');
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
  });

  it('rejects unknown request/output fields, malformed output, and out-of-bound domain values', async () => {
    let calls = 0;
    const invalidInput = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => { calls++; return response('{}'); } });
    await expect(invalidInput.propose({ ...input(), answers: ['private'] } as unknown as DeepSeekChangeInput, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MODEL_PROVIDER_INPUT_INVALID' });
    expect(calls).toBe(0);

    const invalidOutputs = [
      '{broken',
      JSON.stringify({ kind: 'teaching', parameters: { force: 21, mass: 2, time: 2 } }),
      JSON.stringify({ kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 }, approve: true }),
      JSON.stringify({ kind: 'encounter', rule: { allyTarget: true, apCost: 2, oncePerTurn: false } }),
    ];
    for (const content of invalidOutputs) {
      const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(content) });
      await expect(provider.propose(input(), new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    }
  });

  it('sends all bounded table sources with the declarative schema and rejects unsupported operators', async () => {
    const tableChange = equipmentChange('source_equipment');
    const tableInput: DeepSeekChangeInput = {
      kind: 'table',
      prompt: 'Make equipment borrowing safe.',
      sources: [{ id: 'source_equipment', filename: tableScenarioSources.equipment.filename, text: tableScenarioSources.equipment.text }],
      program: null,
      turn: null,
    };
    const captured: { body?: Record<string, unknown> } = {};
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async (_url, options) => {
        captured.body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return response(JSON.stringify(tableChange));
      },
    });
    await expect(provider.propose(tableInput, new AbortController().signal))
      .resolves.toMatchObject({ change: tableChange });
    const body = captured.body;
    if (!body) throw new Error('Provider request body was not captured.');
    expect(body?.max_tokens).toBe(8_192);
    expect(measureDeepSeekChangeRequest(tableInput)).toBe(new TextEncoder().encode(JSON.stringify(body)).byteLength);
    const messages = body?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('"properties"');
    expect(messages[0]?.content).toContain('"contains"');
    expect(messages[0]?.content).toContain('exact existing source id');
    expect(messages[0]?.content).toContain('compare distinct selected rows with {"input":"first"} neq {"input":"second"}');
    expect(messages[0]?.content).toContain('{"record":"first","field":"name"} must use a field declared');
    expect(messages[0]?.content).toContain('The row id is metadata, never an implicit field');
    expect(messages[0]?.content).toContain('exact contiguous substring of the raw source text');
    expect(messages[0]?.content).toContain('never parse, reserialize, normalize, or reconstruct it to make a quote');
    expect(messages[0]?.content).toContain('Invariants express composite uniqueness only');
    expect(messages[0]?.content).toContain('Put numeric bounds on the field min and max');
    expect(messages[0]?.content).toContain('Conditions are all ANDed');
    expect(messages[0]?.content).toContain('The system actor is an opaque account id');
    expect(messages[0]?.content).toContain('Never compare actor to seat');
    expect(messages[0]?.content).toContain('requireTurn checks that the acting seat equals the current turn');
    expect(messages[0]?.content).toContain('advanceTurn cycles through turnOrder');
    expect(messages[0]?.content).toContain('use an empty turnOrder when actions have no turn order');
    expect(messages[0]?.content).toContain('Resolve every effect against the state before the action');
    expect(messages[0]?.content).toContain('commit all effects atomically');
    const userInput = JSON.parse(messages[1]!.content) as { sources: Array<{ text: string }> };
    expect(userInput.sources).toEqual([{ id: 'source_equipment', filename: tableScenarioSources.equipment.filename, text: tableScenarioSources.equipment.text }]);

    const unsupportedOutput = structuredClone(tableChange);
    unsupportedOutput.program.actions[0]!.effects[0]!.op = 'execute' as 'set';
    const rejecting = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => response(JSON.stringify(unsupportedOutput)),
    });
    await expect(rejecting.propose(tableInput, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
  });

  it('rejects a table proposal whose complete input exceeds the provider budget before fetch', async () => {
    let calls = 0;
    const oversized: DeepSeekChangeInput = {
      kind: 'table',
      prompt: 'Create a table from all source files.',
      sources: Array.from({ length: 4 }, (_, index) => ({
        id: `source_${index}`,
        filename: `source-${index}.txt`,
        text: 'x'.repeat(15_000),
      })),
      program: null,
      turn: null,
    };
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => { calls += 1; return response('{}'); },
    });
    await expect(provider.propose(oversized, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MODEL_PROVIDER_INPUT_TOO_LARGE' });
    expect(calls).toBe(0);
  });

  it('rejects malformed envelopes, bad usage, provider errors, and oversized bodies without leaking details', async () => {
    const cases: Array<{ fetch: typeof fetch; code: string }> = [
      { fetch: async () => response('{}', { model: 'other-model' }), code: 'MODEL_PROVIDER_RESPONSE_INVALID' },
      { fetch: async () => response(JSON.stringify({ kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 } }), { usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 10 } }), code: 'MODEL_PROVIDER_RESPONSE_INVALID' },
      { fetch: async () => new Response(`provider echoed ${API_KEY}`, { status: 401 }), code: 'MODEL_PROVIDER_HTTP_ERROR' },
      { fetch: async () => { throw new Error(`raw error ${API_KEY}`); }, code: 'MODEL_PROVIDER_REQUEST_FAILED' },
      { fetch: async () => new Response('x'.repeat(130_000)), code: 'MODEL_PROVIDER_RESPONSE_TOO_LARGE' },
    ];
    for (const testCase of cases) {
      const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: testCase.fetch });
      const result = provider.propose(input(), new AbortController().signal);
      await expect(result).rejects.toMatchObject({ code: testCase.code });
      await expect(result).rejects.not.toThrow(API_KEY);
    }
  });

  it('enforces size and timeout bounds before accepting model output', async () => {
    let calls = 0;
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      timeoutMs: 10,
      fetch: async () => {
        calls++;
        return new Promise<Response>(() => undefined);
      },
    });
    await expect(provider.propose({ ...input(), prompt: 'x'.repeat(4001) }, new AbortController().signal))
      .rejects.toMatchObject({ code: 'MODEL_PROVIDER_INPUT_INVALID' });
    expect(calls).toBe(0);
    await expect(provider.propose(input(), new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_TIMEOUT' });
    expect(calls).toBe(1);
  });

  it('uses fixed safe configuration errors', () => {
    expect(() => new DeepSeekChangeProvider({ apiKey: ` ${API_KEY} ` })).toThrow(DomainError);
    expect(() => new DeepSeekChangeProvider({ apiKey: API_KEY, timeoutMs: 60_001 })).toThrow(DomainError);
  });
});
