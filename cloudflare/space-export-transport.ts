import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import type { ToolExportFormat } from '../src/tabletop/shared/tool-export.js';

/**
 * F080 / JT-X — downloading one granted projection, Worker side.
 *
 * Same mediation as the read (membership, then the space must reference that table), and the file
 * itself is produced by the source: it is the only side that can see its rows and its export flag.
 * The response is the file, not JSON, so a person can open it in a spreadsheet.
 */

export interface SpaceExportDeps {
  authenticate(request: Request): Promise<{ actorId: string } | undefined>;
  workspaceView(request: Request, workspaceId: string): Promise<WorkspaceView | undefined>;
  exportSourceProjection(
    request: Request,
    sourceWorkspaceId: string,
    body: {
      grantId: string;
      spaceId: string;
      spaceWorkspaceId: string;
      actorId: string;
      portId: string;
      format: ToolExportFormat;
    },
  ): Promise<
    | { ok: true; filename: string; format: ToolExportFormat; content: string; sourceDataRevision: number; grantVersion: number }
    | { ok: false; code: string; message: string }
  >;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GRANT = /^[a-z][a-z0-9-]{1,39}$/u;
const PORT = /^[a-z][a-z0-9-]{1,39}$/u;

function refusal(status: number, errorCode: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, errorCode, message }), { status, headers: { 'content-type': 'application/json' } });
}

function spaceOf(view: WorkspaceView): CollaborationSpace | undefined {
  return (view.domain as unknown as { collaborationSpace?: CollaborationSpace }).collaborationSpace;
}

export async function handleSpaceExport(
  request: Request,
  deps: SpaceExportDeps,
  options: { spaceId?: string } = {},
): Promise<Response> {
  if (request.method !== 'GET') return refusal(405, 'METHOD_NOT_ALLOWED', 'Use GET.');
  const url = new URL(request.url);
  const space = options.spaceId ?? url.searchParams.get('space') ?? '';
  const source = url.searchParams.get('source') ?? '';
  const grant = url.searchParams.get('grant') ?? '';
  const port = url.searchParams.get('port') ?? '';
  const formatParam = url.searchParams.get('format') ?? 'csv';

  if (!UUID.test(space)) return refusal(400, 'SPACE_WORKSPACE_INVALID', 'A space workspace id is required.');
  if (!UUID.test(source)) return refusal(400, 'SPACE_SOURCE_INVALID', 'A source workspace id is required.');
  if (!GRANT.test(grant)) return refusal(400, 'SPACE_GRANT_INVALID', 'A grant id is required.');
  if (!PORT.test(port)) return refusal(400, 'SPACE_PORT_INVALID', 'A port id is required.');
  if (formatParam !== 'csv' && formatParam !== 'html') return refusal(400, 'EXPORT_FORMAT_INVALID', 'Use csv or html.');
  const format: ToolExportFormat = formatParam;

  const session = await deps.authenticate(request);
  if (!session) return refusal(401, 'SESSION_EXPIRED', 'Sign in again.');

  const destination = await deps.workspaceView(request, space);
  if (!destination) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  const collaborationSpace = spaceOf(destination);
  if (!collaborationSpace) return refusal(404, 'SPACE_NOT_FOUND', 'That workspace does not hold a collaboration space.');
  if (!collaborationSpace.members.some(member => member.actorId === session.actorId)) {
    return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  }
  const reference = collaborationSpace.sources.find(entry => entry.workspaceId === source);
  if (!reference || reference.status !== 'linked') return refusal(404, 'SPACE_SOURCE_NOT_LINKED', 'That table is not linked to this space.');

  const answer = await deps.exportSourceProjection(request, source, {
    grantId: grant,
    spaceId: collaborationSpace.spaceId,
    spaceWorkspaceId: space,
    actorId: session.actorId,
    portId: port,
    format,
  });
  if (!answer.ok) {
    const status = answer.code === 'SPACE_GRANT_REVOKED' || answer.code === 'SPACE_GRANT_STALE_EPOCH' ? 409
      : answer.code === 'EXPORT_NOT_PERMITTED' ? 403
        : 404;
    return refusal(status, answer.code, answer.message);
  }
  return new Response(answer.content, {
    status: 200,
    headers: {
      'content-type': answer.format === 'csv' ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
      'content-disposition': `attachment; filename="${answer.filename}"`,
      'cache-control': 'no-store',
      // Provenance travels with the file so a reader can tell which revision it came from.
      'x-source-data-revision': String(answer.sourceDataRevision),
      'x-grant-version': String(answer.grantVersion),
    },
  });
}
