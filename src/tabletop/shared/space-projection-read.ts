import type { ToolPortRow } from './tool-protocol';
import {
  authorizeProjectionRead,
  effectiveRevocationAt,
  projectionUsableAt,
  type ToolGrantProjection,
  type ToolProjectionGrant,
} from './tool-connection';

/**
 * F080 / C6: the one decision a cross-workspace projection read makes.
 *
 * The transport (a Worker route plus an internal Room route) does no judging of its own: it gathers
 * the grant list of the source, what the space references, the live epoch, and who the destination
 * says is a member — and this function answers. Keeping it pure is what makes the authorization
 * testable without standing up two Durable Objects, and it means the HTTP layer cannot drift from
 * the unit tests.
 */

export type SpaceProjectionRefusal =
  | 'SPACE_GRANT_NOT_FOUND'
  | 'SPACE_GRANT_REVOKED'
  | 'SPACE_GRANT_STALE_EPOCH'
  | 'SPACE_GRANT_AUDIENCE'
  | 'SPACE_GRANT_PORT';

export interface SpaceProjectionReadInput {
  /** Every grant recorded on the source table. */
  grants: readonly ToolProjectionGrant[];
  grantId: string;
  /** The space asking, as a display reference only. */
  spaceId: string;
  /** The workspace hosting the space — the identity the grant was issued to. */
  spaceWorkspaceId: string;
  sourceWorkspaceId: string;
  /** The source table's live epoch. */
  sourceEpoch: number;
  actorId: string;
  portId: string;
  /**
   * The destination's assertion that `actorId` is a member *of this space*, and of whom.
   * `undefined` means the destination did not vouch, which is refused — the source cannot check
   * membership it does not hold.
   */
  membership: { verifiedBy: 'destination'; actorId: string } | undefined;
  now: number;
}

export type SpaceProjectionRead =
  | {
    ok: true;
    grantId: string;
    projection: ToolGrantProjection;
    /** The revision these rows were read at; a caller that caches must quote it back. */
    sourceDataRevision: number;
    grantVersion: number;
    readAt: number;
    /**
     * Attached by the source host, which is the only layer holding records. Absent when the caller
     * asked only for the grant descriptor.
     */
    rows?: ToolPortRow[];
  }
  | { ok: false; code: SpaceProjectionRefusal; message: string };

export function resolveSpaceProjectionRead(input: SpaceProjectionReadInput): SpaceProjectionRead {
  const grant = input.grants.find(entry => entry.grantId === input.grantId);
  // A grant belongs to one workspace and one table. Identity is the workspace id: a space slug is
  // chosen by the destination, so matching on it alone would let any workspace reuse someone
  // else's slug and read through their grant.
  if (!grant
    || grant.spaceWorkspaceId !== input.spaceWorkspaceId
    || grant.sourceWorkspaceId !== input.sourceWorkspaceId) {
    return { ok: false, code: 'SPACE_GRANT_NOT_FOUND', message: 'That connection is not granted to this space.' };
  }
  if (!projectionUsableAt(grant, input.now)) {
    const revokedAt = effectiveRevocationAt(grant);
    return { ok: false, code: 'SPACE_GRANT_REVOKED', message: `The source revoked this connection at ${revokedAt ?? input.now}.` };
  }
  if (input.membership === undefined || input.membership.actorId !== input.actorId) {
    return { ok: false, code: 'SPACE_GRANT_AUDIENCE', message: 'The destination did not confirm this person is in the space.' };
  }

  const verdict = authorizeProjectionRead(grant, {
    sourceEpoch: input.sourceEpoch,
    actorId: input.actorId,
    portId: input.portId,
    membershipVerifiedBy: input.membership.verifiedBy,
  });
  if (!verdict.ok) {
    const code: SpaceProjectionRefusal = verdict.code === 'GRANT_FIELD_NOT_PERMITTED'
      ? 'SPACE_GRANT_PORT'
      : verdict.code === 'GRANT_REVOKED'
        ? 'SPACE_GRANT_REVOKED'
        : verdict.code === 'GRANT_STALE_EPOCH'
          ? 'SPACE_GRANT_STALE_EPOCH'
          : 'SPACE_GRANT_AUDIENCE';
    return { ok: false, code, message: verdict.message };
  }
  return {
    ok: true,
    grantId: grant.grantId,
    projection: verdict.projection,
    sourceDataRevision: grant.sourceDataRevision,
    grantVersion: grant.grantVersion,
    readAt: input.now,
  };
}
