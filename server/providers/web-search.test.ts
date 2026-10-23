import { describe, expect, it, vi } from 'vitest';
import {
  matchCitations,
  normalizeSearchUrl,
  rankSearchResults,
  searchWeb,
  WebSearchError,
} from './web-search.js';

describe('normalizeSearchUrl', () => {
  it('strips the provider suffix that broke the WHO citation', () => {
    expect(normalizeSearchUrl('https://apps.who.int/nutrition/landscape/help.aspx?menu=0&helpid=392&lang=EN(accessed'))
      .toBe('https://apps.who.int/nutrition/landscape/help.aspx?menu=0&helpid=392&lang=EN');
  });

  it('drops fragments so a rewritten model URL still matches', () => {
    expect(normalizeSearchUrl('https://www.who.int/data/nutrition/nlis/info/malnutrition-in-women#1'))
      .toBe('https://www.who.int/data/nutrition/nlis/info/malnutrition-in-women');
    expect(normalizeSearchUrl('http://zenodo.org/records/1/files/a.pdf?download=1#13#13#13'))
      .toBe('http://zenodo.org/records/1/files/a.pdf?download=1');
  });

  it('upgrades protocol-relative and bare hosts, strips tracking and credentials', () => {
    expect(normalizeSearchUrl('//Example.COM/Path/')).toBe('https://example.com/Path');
    expect(normalizeSearchUrl('example.com/a?utm_source=x&id=2')).toBe('https://example.com/a?id=2');
    expect(normalizeSearchUrl('https://user:pass@example.com/a')).toBe('https://example.com/a');
  });

  it('rejects unusable values', () => {
    expect(normalizeSearchUrl('')).toBeNull();
    expect(normalizeSearchUrl('not a url')).toBeNull();
    expect(normalizeSearchUrl('javascript:alert(1)')).toBeNull();
    expect(normalizeSearchUrl(`https://${'a'.repeat(9000)}.com`)).toBeNull();
  });
});

describe('rankSearchResults', () => {
  it('drops low-signal rows, dedupes normalized URLs and keeps authority first', () => {
    const { kept, dropped } = rankSearchResults([
      { title: 'Junk PDF', url: 'http://zenodo.org/x.pdf', authority: 1, rerank_score: 1.2, summary: 'noise' },
      { title: 'NIST', url: 'https://physics.nist.gov/cuu/Value?gn', authority: 4, rerank_score: 1.8, summary: 'g = 9.806 65' },
      { title: 'NIST duplicate', url: 'https://physics.nist.gov/cuu/Value?gn#x', authority: 4, rerank_score: 1.9, summary: 'g' },
      { title: 'Weak but scored', url: 'https://example.com/a', authority: 1, rerank_score: 1.6, summary: 'scored' },
    ]);
    expect(dropped).toBe(2);
    expect(kept.map((result) => result.normalizedUrl)).toEqual([
      // A bare `?gn` param round-trips through URLSearchParams as `?gn=`; both sides normalize identically.
      'https://physics.nist.gov/cuu/Value?gn=',
      'https://example.com/a',
    ]);
    expect(kept[0].summary).toBe('g = 9.806 65');
  });

  it('clamps long summaries and caps the kept list', () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      title: `t${index}`,
      url: `https://example.com/${index}`,
      authority: 3,
      summary: 'x'.repeat(900),
    }));
    const { kept } = rankSearchResults(rows, 2);
    expect(kept).toHaveLength(2);
    expect(kept[0].summary.length).toBeLessThanOrEqual(400);
  });
});

function fakeFetch(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe('searchWeb', () => {
  const apiKey = 'test-key';

  it('returns ranked, bounded results', async () => {
    const outcome = await searchWeb('  speed   of light  ', {
      apiKey,
      fetchImpl: fakeFetch(200, {
        results: [
          { title: 'BIPM', url: 'https://www.bipm.org/x', authority: 4, rerank_score: 2, summary: 'c = 299 792 458' },
          { title: 'noise', url: 'https://noise.example/a', authority: 0, rerank_score: 0.2, summary: 'x' },
        ],
      }),
    });
    expect(outcome.query).toBe('speed of light');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].summary).toBe('c = 299 792 458');
  });

  it('maps provider failures to typed errors', async () => {
    await expect(searchWeb('x', { apiKey, fetchImpl: fakeFetch(429, {}) }))
      .rejects.toThrow(WebSearchError);
    await expect(searchWeb('x', { apiKey, fetchImpl: fakeFetch(500, {}) }))
      .rejects.toMatchObject({ code: 'WEB_SEARCH_REQUEST_FAILED' });
    await expect(searchWeb('x', { apiKey, fetchImpl: fakeFetch(200, { nope: true }) }))
      .rejects.toMatchObject({ code: 'WEB_SEARCH_RESPONSE_INVALID' });
    await expect(searchWeb('x', { apiKey: '' }))
      .rejects.toMatchObject({ code: 'WEB_SEARCH_NOT_CONFIGURED' });
  });

  it('times out a hanging provider', async () => {
    const hanging = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
    })) as unknown as typeof fetch;
    await expect(searchWeb('x', { apiKey, fetchImpl: hanging, timeoutMs: 5 }))
      .rejects.toMatchObject({ code: 'WEB_SEARCH_TIMEOUT' });
  });
});

describe('matchCitations', () => {
  const results = rankSearchResults([
    { title: 'Malnutrition in women', url: 'https://www.who.int/data/nutrition/nlis/info/malnutrition-in-women#1', authority: 4, summary: 'a' },
    { title: 'Nutrition Landscape Help', url: 'https://apps.who.int/nutrition/landscape/help.aspx?menu=0&helpid=392&lang=EN(accessed', authority: 4, summary: 'b' },
  ]).kept;

  it('accepts citations the model rewrote', () => {
    const report = matchCitations([
      { url: 'https://www.who.int/data/nutrition/nlis/info/malnutrition-in-women' },
      { url: 'https://apps.who.int/nutrition/landscape/help.aspx?menu=0&helpid=392&lang=EN' },
    ], results);
    expect(report.matched).toHaveLength(2);
    expect(report.matched.every((match) => match.matchedBy === 'url')).toBe(true);
    expect(report.unmatched).toHaveLength(0);
  });

  it('falls back to title and rejects invented URLs', () => {
    const report = matchCitations([
      { title: 'Malnutrition in women', url: 'https://invented.example/paper' },
      { title: 'Unknown', url: 'https://invented.example/other' },
    ], results);
    expect(report.matched).toHaveLength(1);
    expect(report.matched[0].matchedBy).toBe('title');
    expect(report.unmatched).toHaveLength(1);
  });
});
