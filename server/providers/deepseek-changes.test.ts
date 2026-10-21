import { describe, expect, it } from 'vitest';
import { DomainError } from '../../src/tabletop/shared/contracts.js';
import { tableScenarioSources, equipmentChange } from '../../src/tabletop/testing/table-scenarios.js';
import { DeepSeekChangeProvider, RejectedChangeReply, measureDeepSeekChangeRequest, type DeepSeekChangeInput } from './deepseek-changes.js';

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
    expect(body.thinking).toEqual({ type: 'enabled' });
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
    expect(body?.max_tokens).toBe(32_768);
    expect(measureDeepSeekChangeRequest(tableInput)).toBe(new TextEncoder().encode(JSON.stringify(body)).byteLength);
    const messages = body?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('TABLE-CHANGE COMPACT SCHEMA v1');
    expect(messages[0]?.content).not.toContain('"$schema"');
    expect(messages[0]?.content.length).toBeLessThan(20_000);
    expect(messages[0]?.content).toContain('contains');
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

  it('accepts one bounded table clarifying question with three answers and asks for it in the table prompt (F012)', async () => {
    const tableInput: DeepSeekChangeInput = { kind: 'table', prompt: 'Make a table.', sources: [], program: null, turn: null };
    const captured: { body?: Record<string, unknown> } = {};
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async (_url, options) => {
        captured.body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return response(JSON.stringify({
          kind: 'clarify',
          question: '  What records does the table track?  ',
          options: [' Equipment loans ', 'Shift swaps', 'I will attach a file'],
        }));
      },
    });
    await expect(provider.propose(tableInput, new AbortController().signal)).resolves.toEqual({
      clarification: { question: 'What records does the table track?', options: ['Equipment loans', 'Shift swaps', 'I will attach a file'] },
      usage: { promptTokens: 40, completionTokens: 30, cacheHitTokens: 10, cacheMissTokens: 30, reasoningTokens: 0 },
    });
    const messages = captured.body?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content).toContain('Ask instead of guessing');
    expect(messages[0]?.content).toContain('{"kind":"clarify","question":"...","options":["...","...","..."]}');
    expect(messages[0]?.content).toContain('exactly 3 short, distinct answers');

    const teachingPrompt: { body?: Record<string, unknown> } = {};
    const teaching = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async (_url, options) => {
        teachingPrompt.body = JSON.parse(String(options?.body)) as Record<string, unknown>;
        return response(JSON.stringify({ kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 } }));
      },
    });
    await teaching.propose(input(), new AbortController().signal);
    expect((teachingPrompt.body?.messages as Array<{ content: string }>)[0]?.content).not.toContain('Ask instead of guessing');
  });

  it('rejects out-of-bound clarify replies as metered repairable replies, and clarify for teaching or encounter (F012)', async () => {
    const tableInput: DeepSeekChangeInput = { kind: 'table', prompt: 'Make a table.', sources: [], program: null, turn: null };
    const three = ['One', 'Two', 'Three'];
    const invalid: unknown[] = [
      { kind: 'clarify', question: 'Which records?', options: ['One', 'Two'] },
      { kind: 'clarify', question: 'Which records?', options: ['One', 'Two', 'Three', 'Four'] },
      { kind: 'clarify', question: 'Which records?', options: [] },
      { kind: 'clarify', question: 'Which records?', options: ['One', '   ', 'Three'] },
      { kind: 'clarify', question: 'Which records?', options: ['One', 'x'.repeat(121), 'Three'] },
      { kind: 'clarify', question: 'Which records?', options: ['One', 2, 'Three'] },
      { kind: 'clarify', question: 'x'.repeat(201), options: three },
      { kind: 'clarify', question: '  ok  ', options: three },
      { kind: 'clarify', options: three },
      { kind: 'clarify', question: 'Which records?' },
      { kind: 'clarify', question: 'Which records?', options: three, extra: true },
      { kind: 'clarify', questions: ['Which records?'] },
    ];
    for (const output of invalid) {
      const content = JSON.stringify(output);
      const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(content) });
      let rejection: unknown;
      try { await provider.propose(tableInput, new AbortController().signal); } catch (error: unknown) { rejection = error; }
      expect(rejection, content).toBeInstanceOf(RejectedChangeReply);
      if (!(rejection instanceof RejectedChangeReply)) throw new Error('Expected a metered rejected reply.');
      expect(rejection.code).toBe('MODEL_PROVIDER_OUTPUT_REJECTED');
      expect(rejection.usage.completionTokens).toBe(30);
      expect(rejection.issues.length).toBeGreaterThan(0);
      expect(rejection.previousOutput).toBe(content);
    }

    const exactlyBounded = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => response(JSON.stringify({ kind: 'clarify', question: 'abc', options: ['a', 'y'.repeat(120), 'z'.repeat(119)] })),
    });
    await expect(exactlyBounded.propose(tableInput, new AbortController().signal))
      .resolves.toMatchObject({ clarification: { question: 'abc', options: ['a', 'y'.repeat(120), 'z'.repeat(119)] } });
    const longestQuestion = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => response(JSON.stringify({ kind: 'clarify', question: 'q'.repeat(200), options: three })),
    });
    await expect(longestQuestion.propose(tableInput, new AbortController().signal))
      .resolves.toMatchObject({ clarification: { question: 'q'.repeat(200), options: three } });

    const clarify = JSON.stringify({ kind: 'clarify', question: 'What should change?', options: three });
    const teaching = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(clarify) });
    await expect(teaching.propose(input(), new AbortController().signal)).rejects.toMatchObject({ code: 'MODEL_PROVIDER_OUTPUT_REJECTED' });
    const encounter = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(clarify) });
    await expect(encounter.propose({ kind: 'encounter', prompt: 'Let allies protect each other.', rule: { allyTarget: false, apCost: 0, oncePerTurn: false } }, new AbortController().signal))
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

  it('salvages a malformed scene expression wrapper and keeps metered usage', async () => {
    const tableChange = equipmentChange('source_equipment');
    const invalidOutput: unknown = {
      ...tableChange,
      program: {
        ...tableChange.program,
        canvas: {
          version: 1,
          views: [{
            id: 'repair_scene',
            kind: 'scene',
            title: 'Repair scene',
            width: 320,
            height: 200,
            elements: [{
              id: 'wrapped_width',
              shape: 'rect',
              x: 0,
              y: 0,
              width: { expression: { op: 'math', fn: 'multiply', args: [{ op: 'literal', value: 2 }, { op: 'literal', value: 4 }] } },
              height: 20,
            }],
          }],
        },
      },
    };
    const content = JSON.stringify(invalidOutput);
    const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(content) });
    // F023: a malformed scene is dropped; the rest of the draft is returned and still metered.
    const result = await provider.propose({
      kind: 'table',
      prompt: 'Show a computed rectangle width.',
      sources: [{ id: 'source_equipment', filename: tableScenarioSources.equipment.filename, text: tableScenarioSources.equipment.text }],
      program: null,
      turn: null,
    }, new AbortController().signal);

    if ('clarification' in result) throw new Error('Expected a salvaged change.');
    if (result.change.kind !== 'table') throw new Error('Expected a table change.');
    expect(result.usage).toEqual({ promptTokens: 40, completionTokens: 30, cacheHitTokens: 10, cacheMissTokens: 30, reasoningTokens: 0 });
    expect(result.change.program.canvas?.views.some((view) => view.id === 'repair_scene') ?? false).toBe(false);
  });

  it('rejects malformed envelopes, bad usage, provider errors, and oversized bodies without leaking details', async () => {
    const cases: Array<{ fetch: typeof fetch; code: string }> = [
      { fetch: async () => response('{}', { model: 'other-model' }), code: 'MODEL_PROVIDER_RESPONSE_INVALID' },
      { fetch: async () => response(JSON.stringify({ kind: 'teaching', parameters: { force: 8, mass: 2, time: 2 } }), { usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 20, prompt_cache_miss_tokens: 10 } }), code: 'MODEL_PROVIDER_RESPONSE_INVALID' },
      { fetch: async () => new Response(`provider echoed ${API_KEY}`, { status: 401 }), code: 'MODEL_PROVIDER_HTTP_ERROR' },
      { fetch: async () => { throw new Error(`raw error ${API_KEY}`); }, code: 'MODEL_PROVIDER_REQUEST_FAILED' },
      { fetch: async () => new Response('x'.repeat(1_100_000)), code: 'MODEL_PROVIDER_RESPONSE_TOO_LARGE' },
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

  it('accepts a 180s timeout and rejects longer ones (F031)', () => {
    expect(() => new DeepSeekChangeProvider({ apiKey: API_KEY, timeoutMs: 180_000 })).not.toThrow();
    expect(() => new DeepSeekChangeProvider({ apiKey: API_KEY, timeoutMs: 180_001 })).toThrow(DomainError);
  });

  it('treats a length-truncated reply as a repairable issue (F031)', async () => {
    const content = '{"kind":"table","program":{';
    const provider = new DeepSeekChangeProvider({
      apiKey: API_KEY,
      fetch: async () => response(content, { choices: [{ finish_reason: 'length', message: { role: 'assistant', content } }] }),
    });
    let rejection: unknown;
    try {
      await provider.propose({ kind: 'table', prompt: 'build a table', sources: [], program: null, turn: null }, new AbortController().signal);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RejectedChangeReply);
    if (!(rejection instanceof RejectedChangeReply)) throw new Error('Expected a rejected truncation.');
    expect(rejection.issues[0]).toContain('truncated at the max_tokens limit');
  });

  it('reports the position and a bounded excerpt for invalid JSON (F031)', async () => {
    const content = '{"kind":"table","program":{"version":1,OPS}';
    const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(content) });
    let rejection: unknown;
    try {
      await provider.propose({ kind: 'table', prompt: 'build a table', sources: [], program: null, turn: null }, new AbortController().signal);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RejectedChangeReply);
    if (!(rejection instanceof RejectedChangeReply)) throw new Error('Expected a rejected JSON payload.');
    expect(rejection.issues[0]).toContain('Invalid JSON');
    const context = rejection.issues[0].split('Context: ')[1] ?? '';
    expect(context.length).toBeGreaterThan(0);
    expect(context.length).toBeLessThanOrEqual(400);
  });
  it('uses fixed safe configuration errors', () => {
    expect(() => new DeepSeekChangeProvider({ apiKey: ` ${API_KEY} ` })).toThrow(DomainError);
    expect(() => new DeepSeekChangeProvider({ apiKey: API_KEY, timeoutMs: 180_001 })).toThrow(DomainError);
  });
});

describe('clarify language enforcement (F026)', () => {
  it('rejects a Chinese clarification for an English request', async () => {
    const clarify = JSON.stringify({
      kind: 'clarify',
      question: '你的请求需要更多细节，请问要管理什么数据？',
      options: ['选项一', '选项二', '选项三'],
    });
    const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(clarify) });
    const tableInput: DeepSeekChangeInput = { kind: 'table', prompt: 'create a table for cookies with numbers', sources: [], program: null, turn: null };
    let rejection: unknown;
    try {
      await provider.propose(tableInput, new AbortController().signal);
    } catch (error) {
      rejection = error;
    }
    expect(rejection).toBeInstanceOf(RejectedChangeReply);
    if (!(rejection instanceof RejectedChangeReply)) throw new Error('Expected a rejected clarification.');
    expect(rejection.issues).toHaveLength(1);
    expect(rejection.issues[0]).toContain('language of the request');
  });

  it('accepts a Thai clarification for a Thai request', async () => {
    const clarify = JSON.stringify({
      kind: 'clarify',
      question: 'ต้องการให้ตารางนี้เก็บข้อมูลอะไรบ้าง?',
      options: ['รายการงาน', 'รายรับรายจ่าย', 'แนบไฟล์ข้อมูล'],
    });
    const provider = new DeepSeekChangeProvider({ apiKey: API_KEY, fetch: async () => response(clarify) });
    const thaiInput: DeepSeekChangeInput = { kind: 'table', prompt: 'สร้างตารางให้หน่อย', sources: [], program: null, turn: null };
    const result = await provider.propose(thaiInput, new AbortController().signal);
    expect('clarification' in result).toBe(true);
  });
});

