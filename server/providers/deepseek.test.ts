import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/tabletop/shared/contracts.js';
import { DeepSeekProvider } from './deepseek.js';
import type { ModelInput } from './model-contracts.js';

const API_KEY = 'sentinel-deepseek-test-key';
const SOURCE_ID = 'verified-rate-card';

function input(): ModelInput {
  return {
    prompt: 'Propose the reviewed surcharge from this rate card.',
    sourceId: SOURCE_ID,
    excerpt: 'Remote surcharge: THB 7.50, effective 2026-10-20.',
    rules: [{
      id: 'rule-base-bangkok',
      kind: 'base',
      zone: 'bangkok',
      amountSatang: 3500,
      from: '2026-01-01',
      to: null,
      sourceId: 'prior-source',
      enabled: true,
    }],
  };
}

function proposal(sourceId = SOURCE_ID): string {
  return JSON.stringify({
    kind: 'invoice',
    operations: [{
      op: 'setSurcharge',
      id: 'rule-remote-surcharge',
      zone: '*',
      amountSatang: 750,
      from: '2026-10-20',
      to: null,
      sourceId,
    }],
  });
}

function completionResponse(content: string, overrides: Record<string, unknown> = {}): Response {
  return new Response(JSON.stringify({
    model: 'deepseek-flash',
    choices: [{
      index: 0,
      finish_reason: 'stop',
      message: { role: 'assistant', content },
    }],
    usage: {
      prompt_tokens: 42,
      completion_tokens: 100,
      prompt_cache_hit_tokens: 20,
      prompt_cache_miss_tokens: 22,
      completion_tokens_details: { reasoning_tokens: 12 },
    },
    ...overrides,
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function readRequest(init: RequestInit | undefined): Record<string, unknown> {
  if (typeof init?.body !== 'string') throw new Error('Expected a serialized request body');
  const body: unknown = JSON.parse(init.body);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new Error('Expected a JSON object body');
  }
  return body as Record<string, unknown>;
}

function expectProviderError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    code,
    message: expect.not.stringContaining(API_KEY),
  });
}

describe('DeepSeekProvider', () => {
  it('uses the fixed server endpoint, bounded no-thinking JSON request, and returns a typed proposal with usage', async () => {
    let endpoint = '';
    let requestInit: RequestInit | undefined;
    const provider = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async (url, init) => {
        endpoint = String(url);
        requestInit = init;
        return completionResponse(proposal());
      },
    });

    const result = await provider.proposeWithUsage(input(), new AbortController().signal);
    expect(endpoint).toBe('https://api.deepseek.com/chat/completions');
    expect(requestInit?.method).toBe('POST');
    expect(requestInit?.redirect).toBe('manual');
    expect(new Headers(requestInit?.headers).get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(new Headers(requestInit?.headers).get('content-type')).toBe('application/json');

    const body = readRequest(requestInit);
    expect(body.model).toBe('deepseek-flash');
    expect(body.max_tokens).toBe(2048);
    expect(body.stream).toBe(false);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.thinking).toEqual({ type: 'disabled' });
    expect(body.tool_choice).toBe('none');
    expect(body.tools).toBeUndefined();
    expect(JSON.stringify(body.messages)).toContain('42.50 THB is 4250 satang');
    expect(JSON.stringify(body.messages)).toContain('from is inclusive and to is exclusive');
    expect(JSON.stringify(body.messages)).toContain('do not subtract a day');

    expect(result).toEqual({
      change: JSON.parse(proposal()),
      usage: {
        promptTokens: 42,
        completionTokens: 100,
        cacheHitTokens: 20,
        cacheMissTokens: 22,
        reasoningTokens: 12,
      },
      model: 'deepseek-flash',
    });
    expect(Object.keys(provider)).not.toContain('apiKey');
    expect(JSON.stringify(provider)).not.toContain(API_KEY);
    await expect(provider.propose(input(), new AbortController().signal)).resolves.toEqual(JSON.parse(proposal()));
  });

  it('rejects malformed JSON, non-schema output, and source substitution with fixed provider errors', async () => {
    const cases = [
      { name: 'malformed JSON', content: '{bad json' },
      { name: 'unsupported fields', content: JSON.stringify({ kind: 'invoice', operations: [], code: 'fetch()' }) },
      { name: 'different source', content: proposal('another-source') },
    ];
    for (const testCase of cases) {
      const provider = new DeepSeekProvider({ apiKey: API_KEY, fetch: async () => completionResponse(testCase.content) });
      await expectProviderError(provider.propose(input(), new AbortController().signal), 'MODEL_PROVIDER_OUTPUT_REJECTED');
    }
  });

  it('rejects truncated and malformed provider envelopes without exposing their contents', async () => {
    const truncatedProvider = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => completionResponse(proposal(), {
        choices: [{ index: 0, finish_reason: 'length', message: { role: 'assistant', content: proposal() } }],
      }),
    });
    await expectProviderError(
      truncatedProvider.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_INVALID',
    );

    const malformedProvider = new DeepSeekProvider({ apiKey: API_KEY, fetch: async () => new Response('not json') });
    await expectProviderError(
      malformedProvider.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_INVALID',
    );

    const erroringBody = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.error(new DomainError('PROVIDER_BODY_SENTINEL', `raw body error ${API_KEY}`));
        },
      })),
    });
    await expectProviderError(
      erroringBody.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_INVALID',
    );
  });

  it('rejects provider errors without reading or surfacing response bodies', async () => {
    const provider = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => new Response(`provider echoed ${API_KEY}`, { status: 401 }),
    });
    await expectProviderError(
      provider.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_HTTP_ERROR',
    );
  });

  it('converts fetch exceptions to a fixed error and never exposes the API key', async () => {
    const provider = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => { throw new Error(`network detail contained ${API_KEY}`); },
    });
    const result = provider.propose(input(), new AbortController().signal);
    await expectProviderError(result, 'MODEL_PROVIDER_REQUEST_FAILED');
    await expect(result).rejects.not.toThrow(API_KEY);
  });

  it('rejects over-limit input and response bodies before parsing', async () => {
    let fetchCalls = 0;
    const provider = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => {
        fetchCalls++;
        return new Response('x'.repeat(130_000), { status: 200 });
      },
    });

    const oversizedRules = Array.from({ length: 200 }, (_, index) => ({
      id: `${String(index).padStart(3, '0')}-${'r'.repeat(155)}`,
      kind: 'base' as const,
      zone: 'bangkok' as const,
      amountSatang: 3500,
      from: '2026-01-01',
      to: null,
      sourceId: 'source',
      enabled: true,
    }));
    await expectProviderError(
      provider.propose({ ...input(), rules: oversizedRules }, new AbortController().signal),
      'MODEL_PROVIDER_INPUT_TOO_LARGE',
    );
    expect(fetchCalls).toBe(0);

    await expectProviderError(
      provider.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_TOO_LARGE',
    );
    expect(fetchCalls).toBe(1);
  });

  it('rejects caller cancellation before dispatch and maps timeout without exposing fetch errors', async () => {
    let fetchCalls = 0;
    const cancelled = new AbortController();
    cancelled.abort(new Error(`caller detail ${API_KEY}`));
    const provider = new DeepSeekProvider({
      apiKey: API_KEY,
      timeoutMs: 5,
      fetch: async (_url, init) => {
        fetchCalls++;
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error(`aborted ${API_KEY}`)), { once: true });
        });
      },
    });
    await expectProviderError(provider.propose(input(), cancelled.signal), 'MODEL_PROVIDER_ABORTED');
    expect(fetchCalls).toBe(0);
    await expectProviderError(provider.propose(input(), new AbortController().signal), 'MODEL_PROVIDER_TIMEOUT');
    expect(fetchCalls).toBe(1);

    const uncooperativeFetch = new DeepSeekProvider({
      apiKey: API_KEY,
      timeoutMs: 5,
      fetch: async () => new Promise<Response>(() => undefined),
    });
    await expectProviderError(
      uncooperativeFetch.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_TIMEOUT',
    );

    const stalledBody = new DeepSeekProvider({
      apiKey: API_KEY,
      timeoutMs: 5,
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        pull() { return new Promise<void>(() => undefined); },
      })),
    });
    await expectProviderError(stalledBody.propose(input(), new AbortController().signal), 'MODEL_PROVIDER_TIMEOUT');
  });

  it('rejects invalid usage counters and output exceeding configured token bounds', async () => {
    const invalidUsage = new DeepSeekProvider({
      apiKey: API_KEY,
      fetch: async () => completionResponse(proposal(), {
        usage: { prompt_tokens: 42, completion_tokens: 1, prompt_cache_hit_tokens: 41, prompt_cache_miss_tokens: 2 },
      }),
    });
    await expectProviderError(
      invalidUsage.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_INVALID',
    );

    const smallBound = new DeepSeekProvider({
      apiKey: API_KEY,
      maxTokens: 5,
      fetch: async () => completionResponse(proposal(), {
        usage: { prompt_tokens: 42, completion_tokens: 6, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 22 },
      }),
    });
    await expectProviderError(
      smallBound.propose(input(), new AbortController().signal),
      'MODEL_PROVIDER_RESPONSE_INVALID',
    );
  });

  it('is compatible with the ModelProvider method shape', async () => {
    const provider = new DeepSeekProvider({ apiKey: API_KEY, fetch: async () => completionResponse(proposal()) });
    const modelProvider: { propose: (request: ModelInput, signal: AbortSignal) => Promise<unknown> } = provider;
    await expect(modelProvider.propose(input(), new AbortController().signal)).resolves.toEqual(JSON.parse(proposal()));
  });

  it('uses fixed safe errors for invalid local configuration', () => {
    expect(() => new DeepSeekProvider({ apiKey: ` ${API_KEY} ` })).toThrow(DomainError);
    expect(() => new DeepSeekProvider({ apiKey: API_KEY, maxTokens: 2049 })).toThrow(DomainError);
    expect(() => new DeepSeekProvider({ apiKey: API_KEY, timeoutMs: 120_001 })).toThrow(DomainError);
  });
});
