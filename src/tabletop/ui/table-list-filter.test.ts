import { describe, expect, it } from 'vitest';
import { NO_TABLE_FILTER, filterTables, isFiltered, listDate, sortByUpdated, sortTables } from './table-list-filter';

const now = new Date(2026, 9, 22, 18, 0).getTime();
const day = 86_400_000;
const hour = 3_600_000;
const tables = [
  { id: 'a', title: 'Old lesson', kind: 'teaching' as const, role: 'teacher' as const, createdAt: now - 60 * day, updatedAt: now - 40 * day },
  { id: 'b', title: 'GitHub Flow', kind: 'table' as const, role: 'owner' as const, createdAt: now - 50 * day, updatedAt: now - 1 * hour },
  { id: 'c', title: 'Camera loans', kind: 'table' as const, role: 'participant' as const, createdAt: now - 2 * day, updatedAt: now - 3 * day },
  { id: 'd', title: 'No time yet', kind: 'table' as const, role: 'owner' as const },
];
const kindTitle = (kind: string) => kind === 'table' ? 'Shared table' : 'Lesson';

describe('table list (F053)', () => {
  it('sorts by the newest change; tables without a time go last in server order', () => {
    expect(sortByUpdated(tables).map((table) => table.id)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('can switch the clock to when each table was created', () => {
    expect(sortTables(tables, 'created').map((table) => table.id)).toEqual(['c', 'b', 'a', 'd']);
  });

  it('filters by type, ownership, recency and words together', () => {
    const ids = (filter: Partial<typeof NO_TABLE_FILTER>) => filterTables(tables, { ...NO_TABLE_FILTER, ...filter }, now, kindTitle).map((table) => table.id);
    expect(ids({})).toEqual(['b', 'c', 'a', 'd']);
    expect(ids({ kind: 'teaching' })).toEqual(['a']);
    expect(ids({ ownership: 'mine' })).toEqual(['b', 'a', 'd']);
    expect(ids({ ownership: 'joined' })).toEqual(['c']);
    expect(ids({ recency: 'today' })).toEqual(['b']);
    expect(ids({ recency: 'week' })).toEqual(['b', 'c']);
    expect(ids({ recency: 'month', kind: 'table', query: 'camera' })).toEqual(['c']);
    expect(ids({ sort: 'created' })).toEqual(['c', 'b', 'a', 'd']);
    expect(isFiltered(NO_TABLE_FILTER)).toBe(false);
    expect(isFiltered({ ...NO_TABLE_FILTER, recency: 'week' })).toBe(true);
    // The sort switch is a preference: it does not count as a filtered list.
    expect(isFiltered({ ...NO_TABLE_FILTER, sort: 'created' })).toBe(false);
  });

  it('shows the year only for older dates', () => {
    expect(listDate(now - day, now, 'en-GB')).not.toMatch(/2026/u);
    expect(listDate(new Date(2025, 0, 5).getTime(), now, 'en-GB')).toMatch(/2025/u);
  });
});
