import type { AuthorizedWorkspace, CommandAuthority } from '../server/authority.js';
import { isRecord, randomToken, sha256 } from '../server/codec.js';
import { AuthorityError } from '../server/errors.js';
import { exportInvoice } from '../src/tabletop/shared/export-invoice.js';
import { MAX_MEMBERS_PER_WORKSPACE } from '../server/limits.js';
import { projectionCursor } from '../server/projection-cursor.js';
import { UPDATED_AT_HEADER, UPDATED_BY_HEADER, type Env } from './contracts.js';
import { authenticateRequest, isAdminSession, requireMutation } from './auth.js';
import { z } from 'zod';
import type { SpaceProjectionRead } from '../src/tabletop/shared/space-projection-read.js';
import { PROJECTION_CURSOR_PATTERN } from './room-job-view.js';
import type { RoomRepository } from './room-repository.js';
import { requireWorkspaceWritable } from './table-mode.js';
import { prepareWebEvidenceCommand } from './web-evidence.js';
import { isSeat, type CommandAck, type WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { TOOL_PACKAGE_LIMITS } from '../src/tabletop/shared/tool-package.js';

/**
 * F078-T6c: the Room's HTTP surface as one module.
 *
 * `matchRoomRoute` turns a request into a named route without touching storage,
 * the clock or the Durable Object. Routes marked `handler: 'room'` stay on the
 * Room because they need its instance (sockets, AI job runners, alarm
 * scheduling); everything else is served here from an explicit dependency list.
 *
 * Behavior is preserved deliberately: same status codes, same header names, the
 * same `x-request-id` on every response, the same guard order
 * (session → mutation → writable → body → authority) and the same error mapping
 * left in the caller. The module knows no `this`, no `ctx` and no alarms, so its
 * interface is the test surface.
 */

const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_JSON_DEPTH_LIMIT = 96;
const MAX_EXPORT_BYTES = 10 * 1024 * 1024;
/** Actor ids are opaque account ids (UUIDs today); bound the shape before touching storage. */
const MEMBER_ACTOR_ID_PATTERN = /^[A-Za-z0-9_-]{1,160}$/u;
const INVITE_LINK_DAYS: readonly number[] = [1, 7, 30];

const IMAGE_ROUTE = /^\/api\/workspaces\/([0-9a-f-]{36})\/images(?:\/(img_[0-9a-f]{32}))?$/u;
const WORKSPACE_ROUTE = /^\/api\/workspaces\/([0-9a-f-]{36})(?:\/(commands|invites|invite-link|members\/remove|events|socket|model(?:\/[a-f0-9]{64})?|assistant(?:\/[a-f0-9]{64}(?:\/confirm)?)?|export))?$/iu;
const MODEL_JOB_SUFFIX = /^model\/[a-f0-9]{64}$/u;
const ASSISTANT_JOB_SUFFIX = /^assistant\/[a-f0-9]{64}$/u;
const ASSISTANT_CONFIRM_SUFFIX = /^assistant\/[a-f0-9]{64}\/confirm$/u;

interface RedeemInput {
  ticket: string;
}

/**
 * Which side serves the route. `room-http` routes are answered by this module;
 * `room` routes need the Durable Object instance and are dispatched there.
 */
export interface RoomRouteMatch {
  readonly handler: 'room-http' | 'room';
  readonly name: string;
  readonly workspaceId?: string;
  readonly suffix?: string;
  readonly imageId?: string;
}

const spaceGrantsRequestSchema = z.strictObject({
  spaceWorkspaceId: z.string().uuid(),
  actorId: z.string().min(1).max(160),
});

const spaceGrantsRequestSchemaMaybeUnused = spaceGrantsRequestSchema;
const spaceExportRequestSchema = z.strictObject({
  grantId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  spaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/u),
  spaceWorkspaceId: z.string().uuid(),
  actorId: z.string().min(1).max(160),
  portId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  format: z.enum(['csv', 'html']),
});


const spaceActionRequestSchema = z.strictObject({
  grantId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  spaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/u),
  spaceWorkspaceId: z.string().uuid(),
  actorId: z.string().min(1).max(160),
  actionId: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{1,39}$/u),
  inputs: z.record(z.string().min(1).max(40), z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()])),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9._:-]{8,80}$/u),
});

const spaceProjectionRequestSchema = z.strictObject({
  grantId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  spaceId: z.string().regex(/^[a-z0-9][a-z0-9-]{1,39}$/u),
  spaceWorkspaceId: z.string().uuid(),
  actorId: z.string().min(1).max(160),
  portId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
});

/**
 * F080 / D-038: one behaviour of the room's installed tool.
 *
 * Only the behaviour id and its declared scalar inputs travel here; the package, the compiled
 * module, the field allowlists and the expected revisions are all read from the room's own state,
 * so a caller cannot widen the scope of the run by sending more than it may ask for.
 */
const toolIntentRequestSchema = z.strictObject({
  behaviorId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  inputs: z.record(z.string().min(1).max(40), z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()])),
}).superRefine((value, context) => {
  if (Object.keys(value.inputs).length > TOOL_PACKAGE_LIMITS.maxBehaviorInputs) {
    context.addIssue({ code: 'custom', path: ['inputs'], message: `At most ${TOOL_PACKAGE_LIMITS.maxBehaviorInputs} inputs.` });
  }
});

export interface ToolIntentInput {
  behaviorId: string;
  inputs: Record<string, string | number | boolean | null>;
}

/**
 * F080 / D-038: what one tool intent run reports.
 *
 * A refusal is a value, never a throw: the route answers with the code and nothing was committed,
 * which is what lets a package tell "the authority said no" apart from a transport or runtime fault.
 */
export type ToolIntentRun =
  | { ok: true; actionId: string; ack: CommandAck }
  | { ok: false; code: string; message: string };

export function parseToolIntentInput(value: unknown): ToolIntentInput | undefined {
  const parsed = toolIntentRequestSchema.safeParse(value);
  return parsed.success ? { behaviorId: parsed.data.behaviorId, inputs: parsed.data.inputs } : undefined;
}

/** The status a refusal is reported with; the code, not the status, is the contract. */
export function toolIntentStatus(answer: ToolIntentRun): number {
  if (answer.ok) return 200;
  if (answer.code === 'TOOL_INTENT_PAYLOAD' || answer.code === 'TOOL_UNKNOWN_BEHAVIOR' || answer.code === 'TOOL_BEHAVIOR_INPUT_INVALID') return 400;
  if (answer.code === 'TOOL_NOT_INSTALLED') return 404;
  if (answer.code === 'TOOL_NOT_AUTHORIZED') return 403;
  if (answer.code === 'TOOL_HASH_MISMATCH' || answer.code === 'TOOL_STALE_REVISION') return 409;
  return 422;
}

export interface RoomHttpDeps {
  env(): Env;
  readonly repository: RoomRepository;
  readonly authority: CommandAuthority;
  requireBoundRoomId(): string;
  authorize(request: Request, workspaceId?: string): Promise<AuthorizedWorkspace>;
  create(request: Request, input: unknown): Promise<WorkspaceView>;
  redeemInvite(request: Request, rawTicket: string): Promise<WorkspaceView>;
  joinByInviteLink(request: Request, rawToken: string): Promise<WorkspaceView>;
  scheduleDirectorySync(): void;
  /**
   * F080: decide one cross-workspace projection read against this table's own grants.
   * The Worker vouches for space membership; this table decides everything else.
   */
  readSpaceProjection(input: {
    grantId: string;
    spaceId: string;
    spaceWorkspaceId: string;
    actorId: string;
    portId: string;
  }): Promise<SpaceProjectionRead>;
  /**
   * F080: run one source action through a connection. The source authorizes it inside its own
   * commit transaction; this dependency only forwards and reports.
   */
  executeSpaceAction(input: {
    grantId: string;
    spaceId: string;
    spaceWorkspaceId: string;
    actorId: string;
    actionId: string;
    inputs: Record<string, string | number | boolean | null>;
    idempotencyKey: string;
  }): Promise<{ ok: true; revision: string; duplicate: boolean } | { ok: false; code: string; message: string }>;
  /** F080: build one export file from this table's own rows and grant; the source decides. */
  /** F080: the connections this table holds for one room, with the revision each was issued at. */
  listSpaceGrants(input: { spaceWorkspaceId: string; actorId: string }): Promise<{
    grantId: string;
    sourceWorkspaceId: string;
    grantedRevision: number;
    status: string;
    grantVersion: number;
    exportAllowed: boolean;
    actions: string[];
    ports: string[];
    liveDataRevision: number;
  }[]>;
  exportSpaceProjection(input: {
    grantId: string;
    spaceId: string;
    spaceWorkspaceId: string;
    actorId: string;
    portId: string;
    format: 'csv' | 'html';
  }): Promise<
    | { ok: true; filename: string; format: 'csv' | 'html'; content: string; sourceDataRevision: number; grantVersion: number }
    | { ok: false; code: string; message: string }
  >;
  /**
   * F080 / D-038: run one behaviour of this room's installed tool. The room compiles, runs and plans;
   * the commit is the ordinary `table.act` command, so a refusal here never reaches the authority.
   */
  runToolIntent(request: Request, workspaceId: string, input: ToolIntentInput): Promise<ToolIntentRun>;
}

export interface RoomHttp {
  handle(request: Request, match: RoomRouteMatch, requestId: string): Promise<Response>;
}

export function matchRoomRoute(request: Request, boundRoomId: string | null): RoomRouteMatch | null {
  const url = new URL(request.url);
  if (request.method === 'POST' && url.pathname === '/internal/create') {
    return { handler: 'room-http', name: 'internal.create' };
  }
  if (request.method === 'POST' && url.pathname === '/internal/redeem') {
    return { handler: 'room-http', name: 'internal.redeem' };
  }
  if (request.method === 'POST' && url.pathname === '/internal/join-link') {
    return { handler: 'room-http', name: 'internal.join-link' };
  }
  if (request.method === 'GET' && url.pathname === '/internal/view') {
    return { handler: 'room-http', name: 'internal.view' };
  }
  if (request.method === 'GET' && url.pathname === '/internal/metadata') {
    return { handler: 'room-http', name: 'internal.metadata' };
  }
  // F080: only the Worker can produce this path (clients are forwarded /api/workspaces/<id>… only).
  if (request.method === 'POST' && url.pathname === '/internal/space-projection') {
    return { handler: 'room-http', name: 'internal.space-projection' };
  }
  if (request.method === 'POST' && url.pathname === '/internal/space-action') {
    return { handler: 'room-http', name: 'internal.space-action' };
  }
  // F080 / D-038: the room runs the behaviour only after the Worker answered the membership question.
  if (request.method === 'POST' && url.pathname === '/internal/space-tool-intent') {
    return { handler: 'room-http', name: 'internal.space-tool-intent' };
  }
  if (request.method === 'POST' && url.pathname === '/internal/space-export') {
    return { handler: 'room-http', name: 'internal.space-export' };
  }
  if (request.method === 'POST' && url.pathname === '/internal/space-grants') {
    return { handler: 'room-http', name: 'internal.space-grants' };
  }
  const imageRoute = IMAGE_ROUTE.exec(url.pathname);
  if (imageRoute) {
    return { handler: 'room', name: 'image', workspaceId: imageRoute[1]!, ...(imageRoute[2] === undefined ? {} : { imageId: imageRoute[2] }) };
  }
  const route = WORKSPACE_ROUTE.exec(url.pathname);
  if (!route || boundRoomId === null || route[1] !== boundRoomId) return null;
  const workspaceId = route[1]!;
  const suffix = route[2] ?? '';
  if (suffix === 'socket') return { handler: 'room', name: 'socket', workspaceId, suffix };
  if (request.method === 'GET' && suffix === '') return { handler: 'room-http', name: 'workspace.view', workspaceId };
  if (request.method === 'GET' && suffix === 'events') return { handler: 'room-http', name: 'events', workspaceId, suffix };
  if (request.method === 'POST' && suffix === 'commands') return { handler: 'room-http', name: 'commands', workspaceId, suffix };
  if (suffix === 'invite-link' && (request.method === 'GET' || request.method === 'POST')) {
    return { handler: 'room-http', name: 'invite-link', workspaceId, suffix };
  }
  if (request.method === 'POST' && suffix === 'members/remove') {
    return { handler: 'room-http', name: 'members.remove', workspaceId, suffix };
  }
  if (request.method === 'POST' && suffix === 'invites') return { handler: 'room-http', name: 'invites', workspaceId, suffix };
  if (request.method === 'GET' && suffix === 'export') return { handler: 'room-http', name: 'export', workspaceId, suffix };
  if (suffix === 'model' && (request.method === 'POST' || request.method === 'GET')) {
    return { handler: 'room', name: request.method === 'POST' ? 'model.post' : 'model.list', workspaceId, suffix };
  }
  if (request.method === 'GET' && MODEL_JOB_SUFFIX.test(suffix)) {
    return { handler: 'room', name: 'model.get', workspaceId, suffix };
  }
  if (suffix === 'assistant' && (request.method === 'POST' || request.method === 'GET')) {
    return { handler: 'room', name: request.method === 'POST' ? 'assistant.post' : 'assistant.list', workspaceId, suffix };
  }
  if (request.method === 'GET' && ASSISTANT_JOB_SUFFIX.test(suffix)) {
    return { handler: 'room', name: 'assistant.get', workspaceId, suffix };
  }
  if (request.method === 'POST' && ASSISTANT_CONFIRM_SUFFIX.test(suffix)) {
    return { handler: 'room', name: 'assistant.confirm', workspaceId, suffix };
  }
  return null;
}

export function createRoomHttp(deps: RoomHttpDeps): RoomHttp {
  async function handle(request: Request, match: RoomRouteMatch, requestId: string): Promise<Response> {
    switch (match.name) {
      case 'internal.create':
        return json(201, await deps.create(request, await readJson(request)), { 'x-request-id': requestId });
      case 'internal.redeem':
        return json(200, await deps.redeemInvite(request, parseRedeemInput(await readJson(request)).ticket), { 'x-request-id': requestId });
      case 'internal.join-link':
        return json(200, await deps.joinByInviteLink(request, parseRedeemInput(await readJson(request)).ticket), { 'x-request-id': requestId });
      case 'internal.view':
        return internalView(request, requestId);
      case 'internal.metadata':
        return internalMetadata(request, requestId);
      case 'internal.space-projection':
        return internalSpaceProjection(request, requestId);
      case 'internal.space-action':
        return internalSpaceAction(request, requestId);
      case 'internal.space-tool-intent':
        return internalSpaceToolIntent(request, requestId);
      case 'internal.space-export':
        return internalSpaceExport(request, requestId);
      case 'internal.space-grants':
        return internalSpaceGrants(request, requestId);
      case 'workspace.view':
        return workspaceView(request, requestId, match.workspaceId);
      case 'events':
        return events(request, requestId, match.workspaceId);
      case 'commands':
        return commands(request, requestId, match.workspaceId);
      case 'invite-link':
        return inviteLink(request, requestId, match.workspaceId);
      case 'members.remove':
        return removeMember(request, requestId, match.workspaceId);
      case 'invites':
        return invites(request, requestId, match.workspaceId);
      case 'export':
        return exportWorkspace(request, requestId, match.workspaceId);
      default:
        throw new AuthorityError('NOT_FOUND', 'Not found.', 404);
    }
  }

  /**
   * F053: the table list shows when each table last changed and who changed it;
   * the view contract itself stays unchanged.
   */
  async function internalView(request: Request, requestId: string): Promise<Response> {
    const authorized = await deps.authorize(request);
    const change = deps.repository.lastChange(authorized.workspace.id, authorized.workspace.epoch);
    const headers: Record<string, string> = {
      'x-request-id': requestId,
      [UPDATED_AT_HEADER]: String(change?.at ?? authorized.workspace.createdAt),
    };
    // Header values must survive non-Latin names, so the name travels percent-encoded.
    if (change?.actorName) headers[UPDATED_BY_HEADER] = encodeURIComponent(change.actorName);
    return json(200, authorized.workspace, headers);
  }

  async function internalSpaceProjection(request: Request, requestId: string): Promise<Response> {
    const parsed = spaceProjectionRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { ok: false, code: 'SPACE_PROJECTION_PAYLOAD', message: 'Invalid projection request.' }, { 'x-request-id': requestId });
    const answer = await deps.readSpaceProjection(parsed.data);
    if (answer.ok) return json(200, answer, { 'x-request-id': requestId });
    const status = answer.code === 'SPACE_GRANT_REVOKED' || answer.code === 'SPACE_GRANT_STALE_EPOCH' ? 409 : 404;
    return json(status, answer, { 'x-request-id': requestId });
  }

  async function internalSpaceAction(request: Request, requestId: string): Promise<Response> {
    const parsed = spaceActionRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { ok: false, errorCode: 'SPACE_ACTION_PAYLOAD', message: 'Invalid action request.' }, { 'x-request-id': requestId });
    const answer = await deps.executeSpaceAction(parsed.data);
    if (answer.ok) return json(200, answer, { 'x-request-id': requestId });
    const status = answer.code === 'SPACE_ACTION_REVOKED' || answer.code === 'SPACE_ACTION_STALE' ? 409
      : answer.code === 'SPACE_ACTION_FORBIDDEN' ? 403
        : answer.code === 'SPACE_ACTION_FAILED' ? 422
          : 404;
    return json(status, answer, { 'x-request-id': requestId });
  }

  async function internalSpaceToolIntent(request: Request, requestId: string): Promise<Response> {
    const parsed = parseToolIntentInput(await readJson(request));
    if (!parsed) return json(400, { ok: false, code: 'TOOL_INTENT_PAYLOAD', message: 'Invalid tool intent request.' }, { 'x-request-id': requestId });
    const answer = await deps.runToolIntent(request, deps.requireBoundRoomId(), parsed);
    return json(toolIntentStatus(answer), answer, { 'x-request-id': requestId });
  }

  async function internalSpaceGrants(request: Request, requestId: string): Promise<Response> {
    const parsed = spaceGrantsRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { ok: false, code: 'SPACE_GRANTS_PAYLOAD', message: 'Invalid grants request.' }, { 'x-request-id': requestId });
    const grants = await deps.listSpaceGrants(parsed.data);
    return json(200, { ok: true, grants }, { 'x-request-id': requestId });
  }

  async function internalSpaceExport(request: Request, requestId: string): Promise<Response> {
    const parsed = spaceExportRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) return json(400, { ok: false, code: 'SPACE_EXPORT_PAYLOAD', message: 'Invalid export request.' }, { 'x-request-id': requestId });
    const answer = await deps.exportSpaceProjection(parsed.data);
    if (answer.ok) return json(200, answer, { 'x-request-id': requestId });
    const status = answer.code === 'SPACE_GRANT_REVOKED' || answer.code === 'SPACE_GRANT_STALE_EPOCH' ? 409
      : answer.code === 'EXPORT_NOT_PERMITTED' ? 403
        : 404;
    return json(status, answer, { 'x-request-id': requestId });
  }

  async function internalMetadata(request: Request, requestId: string): Promise<Response> {
    const session = await authenticateRequest(request, deps.env());
    if (!await isAdminSession(session, deps.env())) throw new AuthorityError('ROLE_FORBIDDEN');
    const roomId = deps.requireBoundRoomId();
    const workspace = await deps.repository.getWorkspace(roomId);
    if (!workspace) throw new AuthorityError('WORKSPACE_NOT_FOUND');
    const members = await deps.repository.withWorkspaceTransaction(roomId, async (transaction) => transaction.listMembers());
    return json(200, {
      id: workspace.id,
      kind: workspace.kind,
      createdAt: workspace.createdAt,
      ownerId: workspace.ownerActorId,
      memberCount: Math.min(MAX_MEMBERS_PER_WORKSPACE, members.length),
      status: workspace.expiresAt <= Date.now() ? 'expired'
        : workspace.domainState.kind === 'encounter' && workspace.domainState.paused ? 'paused' : 'active',
    }, { 'x-request-id': requestId });
  }

  async function workspaceView(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    return json(200, authorized.workspace, { 'x-request-id': requestId });
  }

  async function events(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    const url = new URL(request.url);
    const afterValues = url.searchParams.getAll('after');
    const unexpected = [...url.searchParams.keys()].some((key) => key !== 'after');
    if (unexpected || afterValues.length > 1
        || (afterValues[0] !== undefined && !PROJECTION_CURSOR_PATTERN.test(afterValues[0]))) {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const cursor = projectionCursor(authorized.workspace);
    return json(200, {
      resync: afterValues[0] !== cursor,
      cursor,
      workspace: authorized.workspace,
    }, { 'x-request-id': requestId });
  }

  async function commands(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    requireMutation(request, deps.env(), authorized.session);
    requireWorkspaceWritable(deps.env(), authorized.workspace.kind);
    const envelope = await readJson(request, MAX_JSON_BODY_BYTES);
    const prepared = prepareWebEvidenceCommand(deps.env(), authorized.workspace, envelope);
    if (!prepared.ok) throw new AuthorityError(prepared.code);
    const result = await deps.authority.execute(authorized.session, prepared.envelope, workspaceId!);
    deps.scheduleDirectorySync();
    return json(200, result, { 'x-request-id': requestId });
  }

  async function inviteLink(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    // F003-T3: only the owner of a data table manages its reusable link.
    if (authorized.workspace.kind !== 'table'
        || !authorized.context.permissions?.has('members.invite')) throw new AuthorityError('ROLE_FORBIDDEN');
    if (request.method === 'GET') {
      return json(200, deps.repository.inviteLinkStatus(workspaceId!, Date.now()), { 'x-request-id': requestId });
    }
    requireMutation(request, deps.env(), authorized.session);
    requireWorkspaceWritable(deps.env(), authorized.workspace.kind);
    const body = await readJson(request);
    if (isRecord(body) && body.action === 'disable' && Object.keys(body).length === 1) {
      await deps.repository.disableInviteLink(workspaceId!, Date.now());
      return json(200, { enabled: false, expiresAt: null }, { 'x-request-id': requestId });
    }
    if (!isRecord(body) || body.action !== 'create' || !INVITE_LINK_DAYS.includes(body.days as number)
        || Object.keys(body).some((key) => key !== 'action' && key !== 'days')) {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const token = randomToken();
    const now = Date.now();
    const created = await deps.repository.createInviteLink(
      workspaceId!, authorized.session.record.actorId, sha256(token), now, now + (body.days as number) * 86_400_000,
    );
    // The raw link is returned once; only its hash is stored.
    return json(201, { enabled: true, expiresAt: created.expiresAt, link: `${workspaceId}_${token}` }, { 'x-request-id': requestId });
  }

  async function removeMember(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    requireMutation(request, deps.env(), authorized.session);
    requireWorkspaceWritable(deps.env(), authorized.workspace.kind);
    const body = await readJson(request);
    if (!isRecord(body) || typeof body.actorId !== 'string' || !MEMBER_ACTOR_ID_PATTERN.test(body.actorId)
        || Object.keys(body).some((key) => key !== 'actorId')) {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const workspace = await deps.authority.removeMember(authorized.session, workspaceId!, body.actorId);
    deps.scheduleDirectorySync();
    return json(200, workspace, { 'x-request-id': requestId });
  }

  async function invites(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    requireMutation(request, deps.env(), authorized.session);
    requireWorkspaceWritable(deps.env(), authorized.workspace.kind);
    const body = await readJson(request);
    if (!isRecord(body) || !isSeat(body.seat)
        || (body.replaceOutstanding !== undefined && typeof body.replaceOutstanding !== 'boolean')
        || Object.keys(body).some((key) => key !== 'seat' && key !== 'replaceOutstanding')) {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const invite = await deps.authority.createInvite(
      authorized.session, workspaceId!, body.seat, body.replaceOutstanding === true,
    );
    return json(201, { ticket: `${workspaceId}_${invite.ticket}`, expiresAt: invite.expiresAt }, { 'x-request-id': requestId });
  }

  async function exportWorkspace(request: Request, requestId: string, workspaceId: string | undefined): Promise<Response> {
    const authorized = await deps.authorize(request, workspaceId);
    const url = new URL(request.url);
    const formats = url.searchParams.getAll('format');
    if ([...url.searchParams.keys()].some((key) => key !== 'format') || formats.length > 1) {
      throw new AuthorityError('INVALID_REQUEST');
    }
    const format = formats[0] ?? 'csv';
    if (format !== 'csv' && format !== 'html') throw new AuthorityError('INVALID_REQUEST');
    if (authorized.workspace.kind !== 'invoice' || authorized.member.role !== 'owner') {
      throw new AuthorityError('ROLE_FORBIDDEN');
    }
    const domain = authorized.workspace.domain;
    if (domain.kind !== 'invoice') throw new AuthorityError('WORKSPACE_NOT_FOUND');
    const content = exportInvoice(domain, format);
    const bytes = new TextEncoder().encode(content);
    if (bytes.byteLength > MAX_EXPORT_BYTES) throw new AuthorityError('BODY_TOO_LARGE');
    return new Response(bytes, {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/html; charset=utf-8',
        'content-disposition': `attachment; filename="tabletop-invoice.${format}"`,
        'x-content-type-options': 'nosniff',
        'x-request-id': requestId,
      },
    });
  }

  return { handle };
}

export function json(status: number, body: unknown, headers: HeadersInit = {}): Response {
  const resultHeaders = new Headers(headers);
  resultHeaders.set('content-type', 'application/json; charset=utf-8');
  resultHeaders.set('cache-control', 'no-store');
  resultHeaders.set('x-content-type-options', 'nosniff');
  return new Response(JSON.stringify(body), { status, headers: resultHeaders });
}

export async function readJson(request: Request, maxBytes = MAX_JSON_BODY_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') throw new AuthorityError('CONTENT_TYPE_REQUIRED');
  const bytes = await readBodyBytes(request, maxBytes, 'INVALID_JSON');
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown;
  } catch {
    throw new AuthorityError('INVALID_JSON');
  }
  if (hasExcessiveDepth(value)) throw new AuthorityError('INVALID_REQUEST');
  return value;
}

/** Reads a request body without ever buffering more than `maxBytes`. */
export async function readBodyBytes(request: Request, maxBytes: number, emptyCode: string): Promise<Uint8Array> {
  const statedLength = request.headers.get('content-length');
  if (statedLength !== null) {
    const length = Number(statedLength);
    if (!Number.isSafeInteger(length) || length < 0) throw new AuthorityError('INVALID_REQUEST');
    if (length > maxBytes) throw new AuthorityError('BODY_TOO_LARGE');
  }
  if (!request.body) throw new AuthorityError(emptyCode);
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel();
        throw new AuthorityError('BODY_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function hasExcessiveDepth(value: unknown, depth = 0): boolean {
  if (depth > MAX_JSON_DEPTH_LIMIT) return true;
  if (Array.isArray(value)) return value.some((item) => hasExcessiveDepth(item, depth + 1));
  if (isRecord(value)) return Object.values(value).some((item) => hasExcessiveDepth(item, depth + 1));
  return false;
}

function parseRedeemInput(value: unknown): RedeemInput {
  if (!isRecord(value) || typeof value.ticket !== 'string' || Object.keys(value).some((key) => key !== 'ticket')) {
    throw new AuthorityError('INVALID_REQUEST');
  }
  return { ticket: value.ticket };
}
