import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import type { SpaceProjectionRead } from '../src/tabletop/shared/space-projection-read.js';

/**
 * F080 / C6 — the cross-workspace read, Worker side (see D-020).
 *
 * The Worker is the only place that holds both the caller's session and the ability to reach two
 * Rooms, so it is where the two questions are answered in order: is this person in the destination
 * space, and does the source still grant it. It decides nothing about the grant itself — the source
 * answers that with `resolveSpaceProjectionRead` — and it never caches: every read re-asks.
 *
 * Dependencies are injected so the whole decision is testable without standing up two Durable
 * Objects; the untested remainder is only the four wiring lines in `index.ts`.
 */

export interface SpaceProjectionTransportDeps {
  /** Resolves the caller from the request cookies, the same way every other route does. */
  authenticate(request: Request): Promise<{ actorId: string } | undefined>;
  /** Reads one workspace view through its own Room (`/internal/view`). */
  workspaceView(request: Request, workspaceId: string): Promise<WorkspaceView | undefined>;
  /** Asks the source Room for its decision; the Worker does not judge the grant itself. */
  readSourceProjection(
    request: Request,
    sourceWorkspaceId: string,
    body: { grantId: string; spaceId: string; spaceWorkspaceId: string; actorId: string; portId: string },
  ): Promise<SpaceProjectionRead | { ok: false; code: string; message: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const PORT = /^[a-z][a-z0-9-]{1,39}$/u;
const GRANT = /^[a-z][a-z0-9-]{1,39}$/u;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function refusal(status: number, code: string, message: string): Response {
  // Canonical ApiError shape: the browser client and every other route read `errorCode`.
  return json(status, { ok: false, errorCode: code, message });
}

/** Which space state (if any) this workspace holds; absent on any non-table or pre-feature workspace. */
function spaceOf(view: WorkspaceView): CollaborationSpace | undefined {
  const domain = view.domain as unknown as { collaborationSpace?: CollaborationSpace };
  return domain.collaborationSpace;
}

export async function handleSpaceProjectionRead(
  request: Request,
  deps: SpaceProjectionTransportDeps,
  /** The workspace id from the route; when present it wins over the query string. */
  options: { spaceId?: string } = {},
): Promise<Response> {
  if (request.method !== 'GET') return refusal(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  const url = new URL(request.url);
  const source = url.searchParams.get('source');
  const grant = url.searchParams.get('grant');
  const port = url.searchParams.get('port');
  const space = options.spaceId ?? url.searchParams.get('space');

  if (!source || !UUID.test(source)) return refusal(400, 'SPACE_SOURCE_INVALID', 'A source workspace id is required.');
  if (!grant || !GRANT.test(grant)) return refusal(400, 'SPACE_GRANT_INVALID', 'A grant id is required.');
  if (!port || !PORT.test(port)) return refusal(400, 'SPACE_PORT_INVALID', 'A port id is required.');
  if (!space || !UUID.test(space)) return refusal(400, 'SPACE_WORKSPACE_INVALID', 'A space workspace id is required.');

  const session = await deps.authenticate(request);
  if (!session) return refusal(401, 'SESSION_EXPIRED', 'Sign in again.');

  // The destination is authoritative for its own membership: if it will not serve the view, the
  // caller is not a member and there is nothing to ask the source about.
  const destination = await deps.workspaceView(request, space);
  if (!destination) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  const collaborationSpace = spaceOf(destination);
  if (!collaborationSpace) return refusal(404, 'SPACE_NOT_FOUND', 'That workspace does not hold a collaboration space.');

  const membership = collaborationSpace.members.find(member => member.actorId === session.actorId);
  if (!membership) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');

  // The space must actually reference the table it is asking about; a space cannot reach an
  // arbitrary workspace by guessing its id.
  const reference = collaborationSpace.sources.find(entry => entry.workspaceId === source);
  if (!reference || reference.status !== 'linked') {
    return refusal(404, 'SPACE_SOURCE_NOT_LINKED', 'That table is not linked to this space.');
  }

  const answer = await deps.readSourceProjection(request, source, {
    grantId: grant,
    spaceId: collaborationSpace.spaceId,
    // The workspace the source must have authorized; the slug above is display data only.
    spaceWorkspaceId: space,
    actorId: session.actorId,
    portId: port,
  });
  if (!answer.ok) {
    // Revocation and audience failures are conflicts with a stale expectation, not server errors.
    const status = answer.code === 'SPACE_GRANT_REVOKED' || answer.code === 'SPACE_GRANT_STALE_EPOCH' ? 409 : 404;
    return refusal(status, answer.code, answer.message);
  }
  return json(200, {
    ok: true,
    grantId: answer.grantId,
    portId: port,
    projection: answer.projection,
    sourceDataRevision: answer.sourceDataRevision,
    grantVersion: answer.grantVersion,
    readAt: answer.readAt,
  });
}
