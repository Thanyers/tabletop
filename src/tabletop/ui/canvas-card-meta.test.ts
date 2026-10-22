import { describe, expect, it } from 'vitest';
import type { CanvasCardMeta } from '../shared/table-contracts';
import {
  CARD_SORT_OPTIONS,
  DEFAULT_CARD_SORT,
  cardMetaDescription,
  cardMetaLabel,
  formatRelative,
  formatShortDate,
  parseCardSortMode,
  sortCardRows,
} from './canvas-card-meta';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const NOW = Date.UTC(2026, 9, 22, 12, 0, 0);

function meta(overrides: Partial<CanvasCardMeta> = {}): CanvasCardMeta {
  return {
    createdAt: NOW - 10 * DAY,
    updatedAt: NOW - 5 * MINUTE,
    origin: 'ai',
    source: 'recorded',
    ...overrides,
  };
}

describe('formatShortDate', () => {
  it('prints a localized day and month without a year', () => {
    const at = Date.UTC(2026, 9, 12, 14, 5);
    expect(formatShortDate(at)).toBe(new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' }).format(at));
    expect(formatShortDate(at)).not.toContain('2026');
  });
});

describe('formatRelative', () => {
  it('reads minutes, hours and days', () => {
    expect(formatRelative(NOW - 20_000, NOW)).toBe('just now');
    expect(formatRelative(NOW - 5 * MINUTE, NOW)).toBe('5m ago');
    expect(formatRelative(NOW - 2 * HOUR - 4 * MINUTE, NOW)).toBe('2h ago');
    expect(formatRelative(NOW - 3 * DAY - 6 * HOUR, NOW)).toBe('3d ago');
  });

  it('falls back to the short date beyond a week', () => {
    expect(formatRelative(NOW - 8 * DAY, NOW)).toBe(formatShortDate(NOW - 8 * DAY));
  });

  it('clamps a future timestamp to just now', () => {
    expect(formatRelative(NOW + 5 * MINUTE, NOW)).toBe('just now');
  });
});

describe('cardMetaLabel', () => {
  it('says not recorded when there is no evidence', () => {
    expect(cardMetaLabel(undefined, { now: NOW })).toBe('not recorded');
  });

  it('names the person who applied an AI-drafted card', () => {
    const label = cardMetaLabel(meta(), { now: NOW, actorName: 'Mali' });
    expect(label).toMatch(/^AI · Mali · .+ → 5m ago$/u);
    expect(label).not.toContain('~');
  });

  it('uses the member name as the token for a human card and does not repeat it', () => {
    const label = cardMetaLabel(meta({ origin: 'human', createdAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR }), { now: NOW, actorName: 'Mali' });
    expect(label).toMatch(/^Mali · created .+$/u);
  });

  it('uppercases only the fallback token of a human card', () => {
    const label = cardMetaLabel(meta({ origin: 'human', createdAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR }), { now: NOW });
    expect(label).toMatch(/^MEMBER · created .+$/u);
  });

  it('says since for a system card and created for the others', () => {
    const unchanged = { createdAt: NOW - 2 * HOUR, updatedAt: NOW - 2 * HOUR };
    expect(cardMetaLabel(meta({ origin: 'system', ...unchanged }), { now: NOW })).toMatch(/^SYSTEM · since .+$/u);
    expect(cardMetaLabel(meta({ origin: 'demo', ...unchanged }), { now: NOW })).toMatch(/^DEMO · created .+$/u);
  });

  it('marks inferred times with ~', () => {
    const label = cardMetaLabel(meta({ source: 'inferred' }), { now: NOW, actorName: 'Mali' });
    expect(label).toMatch(/^AI · Mali · ~.+ → ~5m ago$/u);
  });

  it('does not change the label for the viewer, only the tooltip', () => {
    const options = { now: NOW, actorName: 'Mali' };
    expect(cardMetaLabel(meta(), { ...options, self: true })).toBe(cardMetaLabel(meta(), options));
    expect(cardMetaDescription(meta(), { ...options, self: true })).toContain('(you)');
  });
});

describe('cardMetaDescription', () => {
  it('spells out created, updated and the revision', () => {
    const description = cardMetaDescription(meta({ revision: 7 }), { now: NOW, actorName: 'Mali' });
    expect(description).toContain('Created ');
    expect(description).toContain('Updated ');
    expect(description).toContain('by Mali');
    expect(description).toContain('revision 7');
  });

  it('says not changed since for a card nobody touched', () => {
    const at = NOW - 3 * DAY;
    expect(cardMetaDescription(meta({ createdAt: at, updatedAt: at }), { now: NOW, actorName: 'Mali' })).toMatch(/ · not changed since$/u);
  });

  it('labels an estimated time instead of presenting it as recorded', () => {
    expect(cardMetaDescription(meta({ source: 'inferred' }), { now: NOW })).toMatch(/^Estimated time · Created /u);
    expect(cardMetaDescription(undefined, { now: NOW })).toBe('Card time not recorded');
  });
});

describe('sortCardRows', () => {
  const rows = [
    { id: 'b', meta: { createdAt: 200, updatedAt: 300 } },
    { id: 'a', meta: { createdAt: 100, updatedAt: 900 } },
    { id: 'c' },
    { id: 'd', meta: { createdAt: 400, updatedAt: 950 } },
  ];

  it('orders by created newest first by default', () => {
    expect(DEFAULT_CARD_SORT).toBe('created-desc');
    expect(sortCardRows(rows, 'created-desc').map((row) => row.id)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('orders by created oldest first and by updated newest first', () => {
    expect(sortCardRows(rows, 'created-asc').map((row) => row.id)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortCardRows(rows, 'updated-desc').map((row) => row.id)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('keeps the canvas order untouched', () => {
    expect(sortCardRows(rows, 'canvas').map((row) => row.id)).toEqual(['b', 'a', 'c', 'd']);
  });

  it('keeps ties in their original order', () => {
    const tied = [
      { id: 'first', meta: { createdAt: 100, updatedAt: 100 } },
      { id: 'second', meta: { createdAt: 100, updatedAt: 100 } },
      { id: 'third', meta: { createdAt: 100, updatedAt: 100 } },
    ];
    expect(sortCardRows(tied, 'created-desc').map((row) => row.id)).toEqual(['first', 'second', 'third']);
    expect(sortCardRows(tied, 'updated-desc').map((row) => row.id)).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the input list', () => {
    sortCardRows(rows, 'created-asc');
    expect(rows.map((row) => row.id)).toEqual(['b', 'a', 'c', 'd']);
  });
});

describe('sort choice storage', () => {
  it('accepts only known modes and falls back to the default', () => {
    expect(parseCardSortMode('updated-desc')).toBe('updated-desc');
    expect(parseCardSortMode('canvas')).toBe('canvas');
    expect(parseCardSortMode('newest')).toBe(DEFAULT_CARD_SORT);
    expect(parseCardSortMode(null)).toBe(DEFAULT_CARD_SORT);
    expect(CARD_SORT_OPTIONS[0]?.mode).toBe(DEFAULT_CARD_SORT);
  });
});
