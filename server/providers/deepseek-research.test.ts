import { describe, expect, it, vi } from 'vitest';
import { MAX_QUERIES_PER_ROUND, MAX_RESEARCH_ROUNDS, RESEARCH_BUDGET_MS, runResearch } from './deepseek-research.js';
import { MAX_JOB_SEARCH_QUERY_CHARS, MAX_JOB_SEARCH_TITLE_CHARS, type ModelJobSearchProgress } from '../../src/tabletop/shared/model-job-progress.js';

interface Scripted {
  chat: unknown[];
  search: unknown[];
}

/** Routes chat and search calls so each test scripts the model's turns explicitly. */
function scriptedFetch(script: Scripted) {
  const chatBodies: Array<Record<string, unknown>> = [];
  const searchBodies: Array<Record<string, unknown>> = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as Record<string, unknown> : {};
    if (url.includes('/v1/tools/search')) {
      searchBodies.push(body);
      const next = script.search.shift();
      return new Response(JSON.stringify(next ?? { results: [] }), { status: 200 });
    }
    chatBodies.push(body);
    const next = script.chat.shift();
    return new Response(JSON.stringify(next ?? { choices: [{ message: { content: '{}' } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, chatBodies, searchBodies };
}

function toolTurn(query: string) {
  return {
    choices: [{
      message: {
        content: '',
        tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query }) } }],
      },
    }],
    usage: { prompt_tokens: 100, completion_tokens: 10 },
  };
}

function finalTurn(payload: unknown) {
  return {
    choices: [{ message: { content: JSON.stringify(payload) } }],
    usage: { prompt_tokens: 200, completion_tokens: 20 },
  };
}

const searchResults = {
  results: [
    { title: 'รัฐบาลไทย', url: 'https://www.thaigov.go.th/th/news/166956', authority: 4, rerank_score: 2.8, date: '2026-07-26T16:00:00+00:00', summary: 'ขยายเวลาลด VAT 7% ถึง 30 ก.ย. 2570' },
    { title: 'noise', url: 'https://noise.example/a', authority: 0, rerank_score: 0.1, summary: 'x' },
  ],
};

describe('runResearch', () => {
  it('searches only when the model asks, then forces a final answer', async () => {
    const { fetchImpl, chatBodies } = scriptedFetch({
      chat: [
        toolTurn('VAT ไทย 2569'),
        finalTurn({ brief: 'VAT 7% ถึง 30 ก.ย. 2570', sourceUrls: ['https://www.thaigov.go.th/th/news/166956'] }),
      ],
      search: [searchResults],
    });
    const outcome = await runResearch('VAT ไทยปี 2026', { apiKey: 'k', fetchImpl });
    expect(outcome.usedSearch).toBe(true);
    expect(outcome.queries).toEqual(['VAT ไทย 2569']);
    expect(outcome.sources).toHaveLength(1);
    expect(outcome.sources[0].id).toBe('web-1');
    expect(outcome.sources[0].authority).toBe(4);
    expect(outcome.citations.accepted).toBe(1);
    expect(outcome.citations.rejected).toBe(0);
    expect(outcome.rounds).toBe(1);
    // The tool stays offered while the round budget remains.
    expect(chatBodies[0].tool_choice).toBe('auto');
    expect(chatBodies[1].tool_choice).toBe('auto');
  });

  it('rejects a brief that cites a URL the model was never shown', async () => {
    const outcome = await runResearch('ค่าคงที่', {
      apiKey: 'k',
      fetchImpl: scriptedFetch({
        chat: [
          toolTurn('constants'),
          finalTurn({ brief: 'c = 299 792 458', sourceUrls: ['https://invented.example/x'] }),
        ],
        search: [searchResults],
      }).fetchImpl,
    });
    expect(outcome.citations.accepted).toBe(0);
    expect(outcome.citations.rejected).toBe(1);
    expect(outcome.citations.rejectedUrls).toEqual(['https://invented.example/x']);
    expect(outcome.brief).toContain('299 792 458');
  });

  it('stops at the round budget and never exceeds it', async () => {
    const { fetchImpl, chatBodies } = scriptedFetch({
      chat: [
        toolTurn('q1'),
        toolTurn('q2'),
        toolTurn('q3'),
        finalTurn({ brief: 'done', sourceUrls: [] }),
      ],
      search: [searchResults, searchResults, searchResults],
    });
    const outcome = await runResearch('everything', { apiKey: 'k', fetchImpl });
    expect(outcome.rounds).toBe(MAX_RESEARCH_ROUNDS);
    expect(chatBodies).toHaveLength(MAX_RESEARCH_ROUNDS + 1);
    expect(chatBodies.at(-1)?.tool_choice).toBe('none');
  });

  // F091: a list request asks for many narrow searches in one turn; they run together, capped per round.
  it('runs one turn of searches together, capped per round, and answers every call', async () => {
    const calls = Array.from({ length: MAX_QUERIES_PER_ROUND + 2 }, (_, index) => ({
      id: `call-${index}`, type: 'function', function: { name: 'web_search', arguments: JSON.stringify({ query: `month ${index + 1}` }) },
    }));
    const { fetchImpl, chatBodies, searchBodies } = scriptedFetch({
      chat: [{ choices: [{ message: { content: '', tool_calls: calls } }] }, finalTurn({ brief: 'list', sourceUrls: [] })],
      search: Array.from({ length: MAX_QUERIES_PER_ROUND }, () => searchResults),
    });
    const outcome = await runResearch('releases per month', { apiKey: 'k', fetchImpl });
    expect(searchBodies).toHaveLength(MAX_QUERIES_PER_ROUND);
    expect(outcome.queries).toHaveLength(MAX_QUERIES_PER_ROUND);
    const toolMessages = (chatBodies[1]?.messages as Array<{ role: string; tool_call_id?: string }>).filter((message) => message.role === 'tool');
    expect(toolMessages.map((message) => message.tool_call_id)).toEqual(calls.map((call) => call.id));
  });

  it('stops starting new rounds once the research budget is spent', async () => {
    const start = 1_000_000;
    const now = vi.spyOn(Date, 'now').mockReturnValue(start);
    const { fetchImpl, chatBodies } = scriptedFetch({
      chat: [toolTurn('q1'), toolTurn('q2'), finalTurn({ brief: 'done', sourceUrls: [] })],
      search: [searchResults, searchResults],
    });
    // The first round's search finishes after the budget.
    const timed: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes('/v1/tools/search')) now.mockReturnValue(start + RESEARCH_BUDGET_MS + 1);
      return fetchImpl(input, init);
    }) as typeof fetch;
    const outcome = await runResearch('everything', { apiKey: 'k', fetchImpl: timed });
    now.mockRestore();
    expect(outcome.rounds).toBe(1);
    expect(chatBodies).toHaveLength(2);
    expect(chatBodies.at(-1)?.tool_choice).toBe('none');
  });

  it('skips search entirely for a file-only request', async () => {
    const { fetchImpl, searchBodies } = scriptedFetch({
      chat: [finalTurn({ brief: '', sourceUrls: [] })],
      search: [],
    });
    const outcome = await runResearch('บวกเลขจากยอดที่ให้', { apiKey: 'k', fetchImpl });
    expect(outcome.usedSearch).toBe(false);
    expect(searchBodies).toHaveLength(0);
  });

  it('surfaces transport faults as typed errors', async () => {
    const failing = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    await expect(runResearch('x', { apiKey: 'k', fetchImpl: failing }))
      .rejects.toMatchObject({ code: 'RESEARCH_REQUEST_FAILED' });
    await expect(runResearch('x', { apiKey: '' }))
      .rejects.toMatchObject({ code: 'RESEARCH_NOT_CONFIGURED' });
  });

  it('reports what it searches and what it kept, so a waiting card can show it (F064)', async () => {
    const events: ModelJobSearchProgress[] = [];
    const { fetchImpl } = scriptedFetch({
      chat: [
        toolTurn('VAT ไทย 2569'),
        finalTurn({ brief: 'VAT 7% ถึง 30 ก.ย. 2570', sourceUrls: ['https://www.thaigov.go.th/th/news/166956'] }),
      ],
      search: [searchResults],
    });

    await runResearch('VAT ไทยปี 2026', { apiKey: 'k', fetchImpl, onProgress: (event) => events.push(event) });

    expect(events.map((event) => event.phase)).toEqual(['searching', 'reading', 'done']);
    expect(events[0]).toMatchObject({ query: 'VAT ไทย 2569', resultsCount: 0 });
    // The count is what the adapter kept after filtering, not the raw provider row count.
    expect(events[1]).toMatchObject({ query: 'VAT ไทย 2569', resultsCount: 1, topTitle: 'รัฐบาลไทย' });
    expect(events[2]).toMatchObject({ resultsCount: 1, topTitle: 'รัฐบาลไทย' });
    expect(events[1].topTitle).not.toBe('noise');
  });

  it('stays silent when the request needs no search (F064)', async () => {
    const events: ModelJobSearchProgress[] = [];
    const { fetchImpl } = scriptedFetch({
      chat: [finalTurn({ brief: '', sourceUrls: [] })],
      search: [],
    });

    await runResearch('บวกเลขจากยอดที่ให้', { apiKey: 'k', fetchImpl, onProgress: (event) => events.push(event) });

    // No "used 0 sources" line: nothing searched means nothing to report.
    expect(events).toEqual([]);
  });

  it('never lets progress break the research step, and bounds what it reports (F064)', async () => {
    const events: ModelJobSearchProgress[] = [];
    const longTitle = { results: [{ title: `T${'t'.repeat(400)}`, url: 'https://example.go.th/x', authority: 4, rerank_score: 3, summary: 'ok' }] };
    const { fetchImpl } = scriptedFetch({
      chat: [toolTurn('Q'.repeat(300)), finalTurn({ brief: 'ok', sourceUrls: [] })],
      search: [longTitle],
    });

    const outcome = await runResearch('ขอตัวเลข', {
      apiKey: 'k',
      fetchImpl,
      onProgress: (event) => {
        events.push(event);
        throw new Error('a broken listener must not stop the draft');
      },
    });

    expect(outcome.usedSearch).toBe(true);
    expect(outcome.sources).toHaveLength(1);
    expect(events).not.toHaveLength(0);
    for (const event of events) {
      expect(event.query.length).toBeLessThanOrEqual(MAX_JOB_SEARCH_QUERY_CHARS);
      expect(event.topTitle?.length ?? 0).toBeLessThanOrEqual(MAX_JOB_SEARCH_TITLE_CHARS);
    }
  });
});
