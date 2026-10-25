import type { ToolProjectionGrant } from './tool-connection';

/**
 * F080 / JT-4A: which connections a table holds for one room.
 *
 * The destination never guesses a grant id: it asks each source, and the source answers from the
 * grants it actually stored. Revoked grants are included on purpose — a recap has to be able to
 * say a connection was withdrawn instead of silently listing nothing.
 */

export interface GrantedConnection {
  grantId: string;
  sourceWorkspaceId: string;
  /** The revision the grant was issued at; a caller compares it with the live one. */
  grantedRevision: number;
  status: ToolProjectionGrant['status'];
  grantVersion: number;
  exportAllowed: boolean;
  actions: string[];
  ports: string[];
}

export function selectGrantsForSpace(
  grants: readonly ToolProjectionGrant[],
  spaceWorkspaceId: string,
): GrantedConnection[] {
  return grants
    .filter(grant => grant.spaceWorkspaceId === spaceWorkspaceId)
    .map(grant => ({
      grantId: grant.grantId,
      sourceWorkspaceId: grant.sourceWorkspaceId,
      grantedRevision: grant.sourceDataRevision,
      status: grant.status,
      grantVersion: grant.grantVersion,
      exportAllowed: grant.exportAllowed === true,
      actions: grant.actions.map(action => action.actionId),
      ports: grant.projections.map(projection => projection.portId),
    }))
    .sort((left, right) => left.grantId.localeCompare(right.grantId));
}

/**
 * The newest live grant per source, which is what a tool should read through when a source was
 * connected more than once. A source with only revoked grants keeps the revoked one so the reason
 * stays visible.
 */
export function latestGrantPerSource(grants: readonly ToolProjectionGrant[]): GrantedConnection[] {
  const bySource = new Map<string, ToolProjectionGrant>();
  for (const grant of grants) {
    const current = bySource.get(grant.sourceWorkspaceId);
    if (!current) {
      bySource.set(grant.sourceWorkspaceId, grant);
      continue;
    }
    const better = grant.status !== 'revoked' && (current.status === 'revoked' || grant.grantVersion > current.grantVersion);
    if (better) bySource.set(grant.sourceWorkspaceId, grant);
  }
  return selectGrantsForSpace([...bySource.values()], [...bySource.values()][0]?.spaceWorkspaceId ?? '');
}
