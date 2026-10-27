import { describe, expect, it, vi } from 'vitest';
import { DeepSeekChangeProvider, measureDeepSeekChangeRequest, type DeepSeekChangeInput } from './deepseek-changes.js';

const tableInput: DeepSeekChangeInput = {
  kind: 'table',
  prompt: 'สร้างตารางสรุปอัตรา VAT ของไทยปี 2026',
  sources: [],
  program: null,
  turn: null,
};

const research = {
  brief: 'VAT 7% ถูกขยายถึง 30 กันยายน 2570',
  sources: [{
    id: 'web-1',
    title: 'รัฐบาลไทย | ขยายเวลาลด VAT 7%',
    url: 'https://www.thaigov.go.th/th/news/166956',
    date: '2026-07-26T16:00:00+00:00',
    authority: 4,
    summary: 'ขยายระยะเวลาการลดอัตราภาษีมูลค่าเพิ่มเหลือร้อยละ 7 ออกไปถึงวันที่ 30 กันยายน 2570',
  }],
};

function captureProvider() {
  let body: Record<string, unknown> | null = null;
  const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : null;
    return new Response(JSON.stringify({
      model: 'deepseek-flash',
      choices: [{
        finish_reason: 'stop',
        message: { role: 'assistant', content: '{"kind":"clarify","question":"Which rate applies?","options":["7%","0%","Exempt"]}' },
      }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 100 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { provider: new DeepSeekChangeProvider({ apiKey: 'test-key', fetch: fetchImpl }), body: () => body };
}

describe('table research input (F064)', () => {
  it('carries the research block into the request and the system prompt', async () => {
    const capture = captureProvider();
    // The reply content is irrelevant here; the request body is what this test inspects.
    await capture.provider.propose({ ...tableInput, research } as DeepSeekChangeInput, new AbortController().signal).catch(() => undefined);
    const body = capture.body();
    expect(body).not.toBeNull();
    const messages = body!.messages as Array<{ role: string; content: string }>;
    expect(messages[0].content).toContain('When research is present');
    // F090: research is grounding, never program.evidence, unless the source is a table file.
    expect(messages[0].content).toContain('Research grounds values, not program.evidence');
    expect(messages[1].content).toContain('web-1');
    expect(messages[1].content).toContain('https://www.thaigov.go.th/th/news/166956');
    expect(messages[1].content).toContain('VAT 7%');
  });

  it('counts the research block in the measured request size', () => {
    const without = measureDeepSeekChangeRequest(tableInput);
    const withResearch = measureDeepSeekChangeRequest({ ...tableInput, research } as DeepSeekChangeInput);
    expect(withResearch).toBeGreaterThan(without);
  });

  it('rejects an oversized or malformed research block', () => {
    const tooMany = {
      ...research,
      sources: Array.from({ length: 7 }, (_, index) => ({ ...research.sources[0], id: `web-${index}` })),
    };
    expect(() => measureDeepSeekChangeRequest({ ...tableInput, research: tooMany } as DeepSeekChangeInput))
      .toThrow();
    const badUrl = { ...research, sources: [{ ...research.sources[0], url: `https://x.test/${'a'.repeat(2_001)}` }] };
    expect(() => measureDeepSeekChangeRequest({ ...tableInput, research: badUrl } as DeepSeekChangeInput))
      .toThrow();
  });
});
