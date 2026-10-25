import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import { buildSpaceRecap, paginateRecap, type SpaceRecap } from '../src/tabletop/shared/space-recap.js';
import type { GrantedConnection } from '../src/tabletop/shared/space-grants.js';

/**
 * F080 / JT-4A — "what happened in this room", Worker side.
 *
 * The recap is assembled from answers the sources give about connections they actually hold; a
 * source that cannot be asked makes the recap say it is incomplete instead of quietly leaving it
 * out. Nothing here reads projection rows, so a recap can never show more than the ids and counters
 * a member already knows.
 */

export interface SourceRecapAnswer {
  connection: GrantedConnection;
  /** The source's live revision, or undefined when it could not be read. */
  liveDataRevision?: number;
}

export interface SpaceRecapDeps {
  authenticate(request: Request): Promise<{ actorId: string } | undefined>;
  workspaceView(request: Request, workspaceId: string): Promise<WorkspaceView | undefined>;
  listSourceGrants(
    request: Request,
    sourceWorkspaceId: string,
    body: { spaceWorkspaceId: string; actorId: string },
  ): Promise<SourceRecapAnswer[]>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

function refusal(status: number, errorCode: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, errorCode, message }), { status, headers: { 'content-type': 'application/json' } });
}

function spaceOf(view: WorkspaceView): CollaborationSpace | undefined {
  return (view.domain as unknown as { collaborationSpace?: CollaborationSpace }).collaborationSpace;
}

export async function handleSpaceRecap(
  request: Request,
  deps: SpaceRecapDeps,
  options: { spaceId?: string } = {},
): Promise<Response> {
  if (request.method !== 'GET') return refusal(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  const space = options.spaceId ?? new URL(request.url).searchParams.get('space') ?? '';
  if (!UUID.test(space)) return refusal(400, 'SPACE_WORKSPACE_INVALID', 'A space workspace id is required.');

  const session = await deps.authenticate(request);
  if (!session) return refusal(401, 'SESSION_EXPIRED', 'Sign in again.');

  const view = await deps.workspaceView(request, space);
  if (!view) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  const collaborationSpace = spaceOf(view);
  if (!collaborationSpace) return refusal(404, 'SPACE_NOT_FOUND', 'That workspace does not hold a collaboration space.');
  if (!collaborationSpace.members.some(member => member.actorId === session.actorId)) {
    return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  }

  const grants: { grant: GrantedConnection; liveDataRevision?: number }[] = [];
  for (const source of collaborationSpace.sources) {
    if (source.status !== 'linked') continue;
    let answers: SourceRecapAnswer[] = [];
    try {
      answers = await deps.listSourceGrants(request, source.workspaceId, { spaceWorkspaceId: space, actorId: session.actorId });
    } catch {
      // A source that will not answer is reported as unreadable, never as "nothing there".
      answers = [];
    }
    for (const answer of answers) {
      if (answer.connection.sourceWorkspaceId !== source.workspaceId) continue;
      grants.push({ grant: answer.connection, ...(answer.liveDataRevision === undefined ? {} : { liveDataRevision: answer.liveDataRevision }) });
    }
    if (answers.length === 0) {
      // Nothing came back: mark the room as incomplete through a connection we do not invent.
      grants.push({
        grant: {
          grantId: `unreadable-${source.workspaceId}`,
          sourceWorkspaceId: source.workspaceId,
          grantedRevision: 0,
          status: 'granted',
          grantVersion: 0,
          exportAllowed: false,
          actions: [],
          ports: [],
        },
      });
    }
  }

  const recap: SpaceRecap = buildSpaceRecap({
    space: collaborationSpace,
    grants: grants.map(entry => ({
      grant: {
        grantId: entry.grant.grantId,
        spaceId: collaborationSpace.spaceId,
        spaceWorkspaceId: space,
        sourceWorkspaceId: entry.grant.sourceWorkspaceId,
        sourceEpoch: collaborationSpace.epoch,
        sourceDataRevision: entry.grant.grantedRevision,
        grantedBy: '',
        issuedAt: 0,
        grantVersion: entry.grant.grantVersion,
        status: entry.grant.status,
        audience: { kind: 'space-members' },
        projections: entry.grant.ports.map(portId => ({ portId, resource: portId, fields: ['id'], maxRows: 1 })),
        actions: entry.grant.actions.map(actionId => ({ actionId })),
        exportAllowed: entry.grant.exportAllowed,
      },
      ...(entry.liveDataRevision === undefined ? {} : { liveDataRevision: entry.liveDataRevision }),
    })),
  });

  // The page is part of the answer, so a client that deep-links to a later page learns how many
  // there really are instead of guessing.
  const page = paginateRecap(recap, {
    page: Number(new URL(request.url).searchParams.get('page') ?? '1'),
    pageSize: Number(new URL(request.url).searchParams.get('pageSize') ?? '10'),
  });

  return new Response(JSON.stringify({ ok: true, recap, page }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
}
