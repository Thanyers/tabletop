import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';

/**
 * F080 / C7 — calling a source action from a space, Worker side (see D-020).
 *
 * The same two questions as the read are answered here before anything is executed: is this person
 * in the destination space, and does that space reference this table. The *authorization* of the
 * action itself stays at the source: it re-checks the grant inside its commit transaction, so this
 * handler can only ever forward a request that the source will refuse if it should.
 */

export interface SpaceActionTransportDeps {
  authenticate(request: Request): Promise<{ actorId: string } | undefined>;
  workspaceView(request: Request, workspaceId: string): Promise<WorkspaceView | undefined>;
  /** Forwards to the source Room; the source decides and commits. */
  executeSourceAction(
    request: Request,
    sourceWorkspaceId: string,
    body: {
      grantId: string;
      spaceWorkspaceId: string;
      spaceId: string;
      actorId: string;
      actionId: string;
      inputs: Record<string, unknown>;
      idempotencyKey: string;
    },
  ): Promise<{ ok: true; revision: string; duplicate: boolean } | { ok: false; code: string; message: string }>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const GRANT = /^[a-z][a-z0-9-]{1,39}$/u;
const ACTION = /^[A-Za-z][A-Za-z0-9_-]{1,39}$/u;
const KEY = /^[A-Za-z0-9._:-]{8,80}$/u;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function refusal(status: number, errorCode: string, message: string): Response {
  return json(status, { ok: false, errorCode, message });
}

function spaceOf(view: WorkspaceView): CollaborationSpace | undefined {
  return (view.domain as unknown as { collaborationSpace?: CollaborationSpace }).collaborationSpace;
}

export async function handleSpaceAction(
  request: Request,
  deps: SpaceActionTransportDeps,
  options: { spaceId?: string } = {},
): Promise<Response> {
  if (request.method !== 'POST') return refusal(405, 'METHOD_NOT_ALLOWED', 'Use POST.');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return refusal(400, 'SPACE_ACTION_PAYLOAD', 'The request body is not JSON.');
  }
  const body = raw as Partial<Record<'source' | 'grant' | 'actionId' | 'idempotencyKey', unknown>> & { inputs?: unknown };
  const space = options.spaceId ?? new URL(request.url).searchParams.get('space') ?? '';
  if (!UUID.test(space)) return refusal(400, 'SPACE_WORKSPACE_INVALID', 'A space workspace id is required.');
  if (typeof body.source !== 'string' || !UUID.test(body.source)) return refusal(400, 'SPACE_SOURCE_INVALID', 'A source workspace id is required.');
  if (typeof body.grant !== 'string' || !GRANT.test(body.grant)) return refusal(400, 'SPACE_GRANT_INVALID', 'A grant id is required.');
  if (typeof body.actionId !== 'string' || !ACTION.test(body.actionId)) return refusal(400, 'SPACE_ACTION_INVALID', 'A valid action id is required.');
  if (typeof body.idempotencyKey !== 'string' || !KEY.test(body.idempotencyKey)) {
    return refusal(400, 'SPACE_KEY_INVALID', 'An idempotency key of 8 to 80 characters is required.');
  }
  const inputs = body.inputs === undefined ? {} : body.inputs;
  if (typeof inputs !== 'object' || inputs === null || Array.isArray(inputs)) return refusal(400, 'SPACE_ACTION_INPUTS', 'Inputs must be an object.');

  const session = await deps.authenticate(request);
  if (!session) return refusal(401, 'SESSION_EXPIRED', 'Sign in again.');

  const destination = await deps.workspaceView(request, space);
  if (!destination) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  const collaborationSpace = spaceOf(destination);
  if (!collaborationSpace) return refusal(404, 'SPACE_NOT_FOUND', 'That workspace does not hold a collaboration space.');
  if (!collaborationSpace.members.some(member => member.actorId === session.actorId)) {
    return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  }
  const reference = collaborationSpace.sources.find(entry => entry.workspaceId === body.source);
  if (!reference || reference.status !== 'linked') return refusal(404, 'SPACE_SOURCE_NOT_LINKED', 'That table is not linked to this space.');

  const answer = await deps.executeSourceAction(request, body.source as string, {
    grantId: body.grant,
    spaceWorkspaceId: space,
    spaceId: collaborationSpace.spaceId,
    actorId: session.actorId,
    actionId: body.actionId,
    inputs: inputs as Record<string, unknown>,
    idempotencyKey: body.idempotencyKey,
  });
  if (answer.ok) {
    return json(200, { ok: true, committed: true, revision: answer.revision, duplicate: answer.duplicate });
  }
  const status = answer.code === 'SPACE_ACTION_REVOKED' || answer.code === 'SPACE_ACTION_STALE' ? 409
    : answer.code === 'SPACE_ACTION_FORBIDDEN' ? 403
      : 404;
  return refusal(status, answer.code, answer.message);
}
