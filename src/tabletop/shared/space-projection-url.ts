/**
 * F080 / C6: the one place that builds the cross-workspace projection URL.
 *
 * The client, the Worker route and the end-to-end test all need the same path and the same query
 * keys. Building it here means a typo cannot make the panel ask a URL that the Worker does not
 * answer — both sides are checked against this function.
 */

export interface SpaceProjectionQuery {
  /** The source table's workspace id. */
  source: string;
  /** The grant id recorded on that table. */
  grant: string;
  /** The port the grant exposes. */
  port: string;
}

export function spaceProjectionQuery(query: SpaceProjectionQuery): string {
  return `source=${encodeURIComponent(query.source)}&grant=${encodeURIComponent(query.grant)}&port=${encodeURIComponent(query.port)}`;
}

/** Path plus query for `GET` on the API origin. */
export function spaceProjectionUrl(spaceWorkspaceId: string, query: SpaceProjectionQuery): string {
  return `/api/workspaces/${encodeURIComponent(spaceWorkspaceId)}/space/projection?${spaceProjectionQuery(query)}`;
}
