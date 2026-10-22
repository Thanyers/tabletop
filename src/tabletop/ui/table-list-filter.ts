// The /tables list: newest change first, with search and filters (F053).
import type { CaseKind, Role } from '../shared/contracts';
import { matchesSearch } from './relative-time';

export interface ListedTable { id: string; title: string; kind: CaseKind; role: Role; updatedAt?: number }

/** "mine" = tables you created (owner, teacher, DM); "joined" = tables someone invited you to. */
export type TableOwnership = 'all' | 'mine' | 'joined';
export type TableRecency = 'any' | 'today' | 'week' | 'month';

export interface TableListFilter {
  query: string;
  kind: CaseKind | 'all';
  ownership: TableOwnership;
  recency: TableRecency;
}

export const NO_TABLE_FILTER: TableListFilter = { query: '', kind: 'all', ownership: 'all', recency: 'any' };

const CREATOR_ROLES: readonly Role[] = ['owner', 'teacher', 'dm'];
const DAY = 86_400_000;

/** Start of the window a recency filter keeps; "today" begins at local midnight. */
function recencyStart(recency: TableRecency, now: number): number {
  if (recency === 'today') { const day = new Date(now); day.setHours(0, 0, 0, 0); return day.getTime(); }
  if (recency === 'week') return now - 7 * DAY;
  if (recency === 'month') return now - 30 * DAY;
  return Number.NEGATIVE_INFINITY;
}

/** Newest change first; tables without a time (Node runtime) keep their server order at the end. */
export function sortByUpdated<T extends ListedTable>(tables: readonly T[]): T[] {
  return tables.map((table, index) => ({ table, index }))
    .sort((a, b) => (b.table.updatedAt ?? -1) - (a.table.updatedAt ?? -1) || a.index - b.index)
    .map(({ table }) => table);
}

export function filterTables<T extends ListedTable>(tables: readonly T[], filter: TableListFilter, now: number, kindTitle: (kind: CaseKind) => string): T[] {
  const since = recencyStart(filter.recency, now);
  return sortByUpdated(tables).filter((table) => (filter.kind === 'all' || table.kind === filter.kind)
    && (filter.ownership === 'all' || (filter.ownership === 'mine') === CREATOR_ROLES.includes(table.role))
    && (filter.recency === 'any' || (table.updatedAt !== undefined && table.updatedAt >= since))
    && matchesSearch(filter.query, [table.title, kindTitle(table.kind), table.role]));
}

export function isFiltered(filter: TableListFilter): boolean {
  return filter.query.trim() !== '' || filter.kind !== 'all' || filter.ownership !== 'all' || filter.recency !== 'any';
}

/** The date shown on each row: "22 Oct, 23:10" this year, with the year when it is older. */
export function updatedDate(at: number, now: number, locale?: string): string {
  const date = new Date(at);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString(locale, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}
