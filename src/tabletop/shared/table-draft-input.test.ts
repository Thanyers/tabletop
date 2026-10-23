import { describe, expect, it } from 'vitest';
import { computeRuntimeCapabilities } from './compute-runtime-profiles';
import { tableDraftBytes, tableDraftInput, type TableDraftState } from './table-draft-input';

const state: TableDraftState = { sources: [], program: null, records: {}, turn: null };

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
