import type { CollaborationSpace } from './collaboration-space';
import type { ToolProjectionGrant } from './tool-connection';

/**
 * F080 / JT-4A (first brick): what happened in a room, in one honest sentence.
 *
 * A recap is derived, never stored: it reads the space's own revision and the grants its sources
 * issued, so it cannot claim something the room does not hold. It names only what a member may see
 * — no projection rows and no other rooms' titles.
 */

export interface RecapGrantInput {
  grant: ToolProjectionGrant;
  /** The source's live revision at read time, when the caller knows it. */
  liveDataRevision?: number;
}

export interface SpaceRecap {
  spaceId: string;
  revision: number;
  headline: string;
  /** Sources that answered at the revision the grant recorded. */
  current: { workspaceId: string; grantId: string; dataRevision: number }[];
  /** Sources whose data moved since the grant was issued. */
  changed: { workspaceId: string; grantId: string; from: number; to: number }[];
  /** Sources whose connection was withdrawn. */
  withdrawn: { workspaceId: string; grantId: string }[];
  /** True when at least one source could not be read at all. */
  incomplete: boolean;
}

export interface SpaceRecapInput {
  space: CollaborationSpace;
  grants: readonly RecapGrantInput[];
}

const TH = {
  empty: 'ห้องนี้ยังไม่มีแหล่งข้อมูลที่เชื่อมอยู่',
  stable: 'ข้อมูลตรงกับที่เชื่อมไว้',
  changed: (count: number): string => `มี ${count} แหล่งที่ข้อมูลเปลี่ยนไปหลังเชื่อม`,
  withdrawn: (count: number): string => `มี ${count} แหล่งที่ถูกถอนการเชื่อมต่อ`,
};

export function buildSpaceRecap(input: SpaceRecapInput): SpaceRecap {
  const current: SpaceRecap['current'] = [];
  const changed: SpaceRecap['changed'] = [];
  const withdrawn: SpaceRecap['withdrawn'] = [];
  let incomplete = false;

  for (const entry of input.grants) {
    const { grant } = entry;
    if (grant.status === 'revoked') {
      withdrawn.push({ workspaceId: grant.sourceWorkspaceId, grantId: grant.grantId });
      continue;
    }
    if (entry.liveDataRevision === undefined) {
      // The caller could not read this source; the recap says so instead of guessing.
      incomplete = true;
      continue;
    }
    if (entry.liveDataRevision !== grant.sourceDataRevision) {
      changed.push({
        workspaceId: grant.sourceWorkspaceId,
        grantId: grant.grantId,
        from: grant.sourceDataRevision,
        to: entry.liveDataRevision,
      });
      continue;
    }
    current.push({ workspaceId: grant.sourceWorkspaceId, grantId: grant.grantId, dataRevision: entry.liveDataRevision });
  }

  const parts: string[] = [];
  if (current.length > 0) parts.push(TH.stable);
  if (changed.length > 0) parts.push(TH.changed(changed.length));
  if (withdrawn.length > 0) parts.push(TH.withdrawn(withdrawn.length));
  if (incomplete) parts.push('อ่านบางแหล่งไม่ได้');
  const headline = parts.length > 0 ? parts.join(' · ') : TH.empty;

  return {
    spaceId: input.space.spaceId,
    revision: input.space.revision,
    headline,
    current,
    changed,
    withdrawn,
    incomplete,
  };
}

/** One recap entry, tagged so a reader can tell a change from a withdrawal. */
export interface RecapEntry {
  kind: 'current' | 'changed' | 'withdrawn';
  workspaceId: string;
  grantId: string;
  from?: number;
  to?: number;
}

export interface RecapPage {
  entries: RecapEntry[];
  page: number;
  pageSize: number;
  pages: number;
  total: number;
  hasMore: boolean;
}

/** Historical entries first (a change or a withdrawal is news), then the stable ones. */
export function recapEntries(recap: SpaceRecap): RecapEntry[] {
  return [
    ...recap.changed.map(entry => ({ kind: 'changed' as const, ...entry })),
    ...recap.withdrawn.map(entry => ({ kind: 'withdrawn' as const, ...entry })),
    ...recap.current.map(entry => ({ kind: 'current' as const, ...entry })),
  ];
}

/**
 * Page the recap so a busy room can be read without shipping every entry at once. The page number is
 * clamped rather than rejected: asking for page 99 of three returns the last page, which is what a
 * deep link that outlived its data should do.
 */
export function paginateRecap(recap: SpaceRecap, options: { page?: number; pageSize?: number } = {}): RecapPage {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? 10), 1), 50);
  const total = recap.changed.length + recap.withdrawn.length + recap.current.length;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  const page = Math.min(Math.max(Math.trunc(options.page ?? 1), 1), pages);
  const entries = recapEntries(recap).slice((page - 1) * pageSize, page * pageSize);
  return { entries, page, pageSize, pages, total, hasMore: page < pages };
}
