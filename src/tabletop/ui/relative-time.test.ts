import { describe, expect, it } from 'vitest';
import { matchesSearch, relativeTime } from './relative-time';

const now = Date.UTC(2026, 9, 22, 12, 0, 0);

describe('relativeTime', () => {
  it('says now under a minute and picks the largest whole unit after that', () => {
    expect(relativeTime(now - 20_000, now)).toBe('now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 minutes ago');
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(relativeTime(now - 86_400_000, now)).toBe('yesterday');
    expect(relativeTime(now - 15 * 86_400_000, now)).toBe('2 weeks ago');
  });

  it('never reports a future time for a clock that is slightly ahead', () => {
    expect(relativeTime(now + 30_000, now)).toBe('now');
  });
});

describe('matchesSearch', () => {
  it('matches every word in any order, ignoring case and accents', () => {
    expect(matchesSearch('dragon owner', ['Dragon bridge', 'Encounter', 'owner'])).toBe(true);
    expect(matchesSearch('CAFÉ', ['Cafe orders'])).toBe(true);
    expect(matchesSearch('dragon player', ['Dragon bridge', 'owner'])).toBe(false);
  });

  it('matches Thai titles and treats a blank query as a match', () => {
    expect(matchesSearch('ตาราง', ['ตารางเวรพยาบาล'])).toBe(true);
    expect(matchesSearch('ที่', ['ที่ทำงาน'])).toBe(true);
    expect(matchesSearch('ที่', ['ทาง'])).toBe(false);
    expect(matchesSearch('   ', ['anything'])).toBe(true);
  });
});
