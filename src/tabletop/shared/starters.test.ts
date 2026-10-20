import { describe, expect, it } from 'vitest';
import { STARTERS, starterFor } from './starters';

describe('start page starters', () => {
  it('offers the three prepared demo tables, each opening its own room kind', () => {
    expect(STARTERS.map((starter) => starter.kind)).toEqual(['invoice', 'teaching', 'encounter']);
    expect(new Set(STARTERS.map((starter) => starter.id)).size).toBe(STARTERS.length);
    for (const starter of STARTERS) {
      expect(starter.title.trim()).not.toBe('');
      expect(starter.summary.trim()).not.toBe('');
      expect(starterFor(starter.kind)).toBe(starter);
    }
  });
});
