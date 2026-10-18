import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/tabletop/shared/contracts.js';
import { DeepSeekChangeProvider, type DeepSeekChangeInput } from './deepseek-changes.js';

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
    await expect(invalidInput.propose({ ...input(), answers: ['private'] } as DeepSeekChangeInput, new AbortController().signal))
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
