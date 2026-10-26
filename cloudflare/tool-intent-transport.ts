import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import type { CollaborationSpace } from '../src/tabletop/shared/collaboration-space.js';
import { TOOL_PACKAGE_LIMITS } from '../src/tabletop/shared/tool-package.js';
import { toolIntentStatus, type ToolIntentInput, type ToolIntentRun } from './room-http.js';

/**
 * F080 / D-038 — running one behaviour of the room's installed tool, Worker side.
 *
 * The Worker answers the same two questions it answers for every space route: is this person in the
 * space, and does that space exist. Everything else is the room's decision, because the room is the
 * only place that holds the installed package, the isolate binding and the authority that commits.
 * This handler can therefore only forward an intent the room will refuse if it should.
 */

export interface ToolIntentTransportDeps {
  authenticate(request: Request): Promise<{ actorId: string } | undefined>;
  workspaceView(request: Request, workspaceId: string): Promise<WorkspaceView | undefined>;
  /** Forwards to the room; the room compiles, runs, plans and — only then — commits. */
  runToolIntent(request: Request, workspaceId: string, input: ToolIntentInput): Promise<ToolIntentRun>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const BEHAVIOR_ID = /^[a-z][a-z0-9-]{1,39}$/u;
const MAX_INPUT_CHARS = 2_000;

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function refusal(status: number, code: string, message: string): Response {
  return json(status, { ok: false, code, message });
}

function spaceOf(view: WorkspaceView): CollaborationSpace | undefined {
  return (view.domain as unknown as { collaborationSpace?: CollaborationSpace }).collaborationSpace;
}

/**
 * Read the intent body here rather than in the room: a caller sending more inputs than the package
 * ABI allows, or a value that is not a bridge scalar, is refused before anything is forwarded.
 */
export function readToolIntent(value: unknown): ToolIntentInput | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as { behaviorId?: unknown; inputs?: unknown };
  if (Object.keys(record).some(key => key !== 'behaviorId' && key !== 'inputs')) return undefined;
  if (typeof record.behaviorId !== 'string' || !BEHAVIOR_ID.test(record.behaviorId)) return undefined;
  const raw = record.inputs === undefined ? {} : record.inputs;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > TOOL_PACKAGE_LIMITS.maxBehaviorInputs) return undefined;
  const inputs: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of entries) {
    if (key.length === 0 || key.length > TOOL_PACKAGE_LIMITS.maxIdChars) return undefined;
    if (typeof value === 'string') {
      if (value.length > MAX_INPUT_CHARS) return undefined;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return undefined;
    } else if (typeof value !== 'boolean' && value !== null) {
      return undefined;
    }
    inputs[key] = value;
  }
  return { behaviorId: record.behaviorId, inputs };
}

export async function handleToolIntent(
  request: Request,
  deps: ToolIntentTransportDeps,
  options: { spaceId?: string } = {},
): Promise<Response> {
  if (request.method !== 'POST') return refusal(405, 'METHOD_NOT_ALLOWED', 'Use POST.');

  const spaceId = options.spaceId ?? new URL(request.url).searchParams.get('space') ?? '';
  if (!UUID.test(spaceId)) return refusal(400, 'SPACE_WORKSPACE_INVALID', 'A space workspace id is required.');

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return refusal(400, 'TOOL_INTENT_PAYLOAD', 'The request body is not JSON.');
  }
  const input = readToolIntent(raw);
  if (!input) return refusal(400, 'TOOL_INTENT_PAYLOAD', 'A behaviour id and scalar inputs are required.');

  const session = await deps.authenticate(request);
  if (!session) return refusal(401, 'SESSION_EXPIRED', 'Sign in again.');

  const destination = await deps.workspaceView(request, spaceId);
  if (!destination) return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  const collaborationSpace = spaceOf(destination);
  if (!collaborationSpace) return refusal(404, 'SPACE_NOT_FOUND', 'That workspace does not hold a collaboration space.');
  if (!collaborationSpace.members.some(member => member.actorId === session.actorId)) {
    return refusal(403, 'SPACE_NOT_MEMBER', 'This person is not a member of that space.');
  }

  const answer = await deps.runToolIntent(request, spaceId, input);
  if (!answer.ok) return json(toolIntentStatus(answer), answer);
  return json(200, {
    ok: true,
    actionId: answer.actionId,
    revision: answer.ack.workspace.revision,
    duplicate: answer.ack.duplicate,
  });
}
