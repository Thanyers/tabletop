import { describe, expect, it } from 'vitest';
import { computeRuntimeCapabilities } from './compute-runtime-profiles';
import { IMPORTED_SOURCE_NOTE, tableDraftBytes, tableDraftInput, type TableDraftState } from './table-draft-input';
import type { TableSource } from './table-contracts';

const state: TableDraftState = { sources: [], program: null, records: {}, turn: null };

describe('web sources in the draft input (F064 C)', () => {
  const file = (id: string): TableSource => ({ id, filename: `${id}.txt`, text: 'file text', sha256: 'a'.repeat(64), createdAt: 1 });
  const web = (id: string, status: 'provided' | 'verified' | 'rejected'): TableSource => ({
    id, filename: `web-${id}.md`, text: `${id} title\n${id} summary`, sha256: 'b'.repeat(64), createdAt: 2,
    origin: 'web', status, url: `https://${id}.example/x`, publishedAt: null, authority: 4,
  });
  const draftState = (sources: TableSource[], evidence: { sourceId: string; quote: string }[] = []): TableDraftState => ({
    sources,
    program: evidence.length
      ? { version: 1, title: 'Rules', description: 'Rules.', collections: [], actions: [], invariants: [], turnOrder: [], evidence, assumptions: [] }
      : null,
    records: {},
    turn: null,
  });

  it('sends only verified web sources; provided and rejected ones never reach the model', () => {
    const input = tableDraftInput(draftState([
      file('file'),
      web('verified', 'verified'),
      web('provided', 'provided'),
      web('rejected', 'rejected'),
    ]), 'Draft rules.');
    expect(input.sources.map((source) => source.id)).toEqual(['file', 'verified']);
    expect(input.importedSources).toBeUndefined();
  });

  it('names a cited verified web source without its text, exactly like a cited file', () => {
    const input = tableDraftInput(draftState(
      [file('file'), web('verified', 'verified')],
      [{ sourceId: 'verified', quote: 'verified summary' }],
    ), 'Draft rules.');
    expect(input.sources.map((source) => source.id)).toEqual(['file']);
    expect(input.importedSources).toEqual([{ id: 'verified', filename: 'web-verified.md', note: IMPORTED_SOURCE_NOTE }]);
  });
});

describe('table draft runtime capabilities', () => {
  it('keeps the legacy table payload unchanged when capabilities are omitted', () => {
    expect(tableDraftInput(state, 'Suggest a rule.')).toEqual({
      kind: 'table', prompt: 'Suggest a rule.', sources: [], program: null, records: {}, turn: null,
    });
  });

  it.each([
    ['disabled', { javascript: false, python: false }],
    ['JavaScript only', { javascript: true, python: false }],
    ['Python enabled', { javascript: true, python: true }],
  ] as const)('counts the exact %s capability payload', (_label, availability) => {
    const capabilities = computeRuntimeCapabilities(availability);
    const input = tableDraftInput(state, 'Suggest a rule.', capabilities);

    expect(input.computeCapabilities).toEqual(capabilities);
    expect(tableDraftBytes(state, 'Suggest a rule.', capabilities))
      .toBe(new TextEncoder().encode(JSON.stringify(input)).byteLength);
  });
});
