import type { CollaborationSpace } from './collaboration-space';
import { authorizeProjectionRead, type ToolProjectionGrant } from './tool-connection';

/**
 * F080 / JT-4A: a deep link is a read like any other.
 *
 * A link that points at one port (and optionally one row) of a source must pass the same three
 * questions as the normal read: is this person in the room, does the source still grant this
 * connection, and does the grant expose that port. Row identity is deliberately *not* answered here
 * — the source checks that when it produces the rows, so a link cannot be used to probe whether a
 * row exists.
 */

export interface DeepLinkTarget {
  grantId: string;
  portId: string;
  /** Optional row the link points at; existence is decided by the source, never here. */
  rowId?: string;
}

export type DeepLinkVerdict =
  | { ok: true; portId: string; rowId?: string; /** What the caller must do next. */ resolve: 'read-source' }
  | { ok: false; code: 'SPACE_NOT_MEMBER' | 'SPACE_GRANT_NOT_FOUND' | 'SPACE_GRANT_REVOKED' | 'SPACE_GRANT_STALE_EPOCH' | 'SPACE_GRANT_AUDIENCE' | 'SPACE_GRANT_PORT'; message: string };

export function resolveDeepLink(input: {
  space: CollaborationSpace;
  actorId: string;
  spaceWorkspaceId: string;
  /** The connection the link names, when the source reported one. */
  grant: ToolProjectionGrant | undefined;
  target: DeepLinkTarget;
  sourceEpoch: number;
}): DeepLinkVerdict {
  const member = input.space.members.find(entry => entry.actorId === input.actorId);
  if (!member) return { ok: false, code: 'SPACE_NOT_MEMBER', message: 'That person is not a member of this room.' };

  const grant = input.grant;
  if (!grant || grant.grantId !== input.target.grantId || grant.spaceWorkspaceId !== input.spaceWorkspaceId) {
    return { ok: false, code: 'SPACE_GRANT_NOT_FOUND', message: 'That connection is not held by this room.' };
  }

  const verdict = authorizeProjectionRead(grant, {
    sourceEpoch: input.sourceEpoch,
    actorId: input.actorId,
    portId: input.target.portId,
    membershipVerifiedBy: 'destination',
  });
  if (!verdict.ok) {
    const code = verdict.code === 'GRANT_REVOKED' ? 'SPACE_GRANT_REVOKED'
      : verdict.code === 'GRANT_STALE_EPOCH' ? 'SPACE_GRANT_STALE_EPOCH'
        : verdict.code === 'GRANT_AUDIENCE' ? 'SPACE_GRANT_AUDIENCE'
          : 'SPACE_GRANT_PORT';
    return { ok: false, code, message: verdict.message };
  }

  return {
    ok: true,
    portId: input.target.portId,
    ...(input.target.rowId === undefined ? {} : { rowId: input.target.rowId }),
    resolve: 'read-source',
  };
}
