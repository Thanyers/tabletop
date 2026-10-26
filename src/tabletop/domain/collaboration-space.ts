import type { ActorContext } from '../shared/contracts';
import {
  readCollaborationSpace,
  decideSpace,
  type CollaborationSpace,
  type SpaceCommand,
  type SpaceDecision,
} from '../shared/collaboration-space';
import { isSpaceCommand, parseSpaceCommand } from '../shared/collaboration-space-command';
import type { TableState } from '../shared/table-contracts';
import { DomainError } from '../shared/contracts';
import { TABLE_ACTIVITY_LIMIT } from './helpers';

/**
 * F080 / C5: where a collaboration space lives and how a command reaches it.
 *
 * It is an optional field on the workspace that owns the shared tools, exactly like notes and
 * card metadata were added before it: additive, absent in older workspaces, and never a reason to
 * reject stored state. That keeps the slice migration-free — no new table, no D1 change — while
 * the space still only *references* the source tables it was linked to.
 */

export interface SpaceCommandContext {
  state: TableState;
  actor: ActorContext;
  now: number;
}

export type SpaceCommandResult =
  | { ok: true; state: TableState; space: CollaborationSpace }
  | { ok: false; code: string; message: string };

/** The table trims its activity at 100; space commands must not shorten history the table keeps. */
const ACTIVITY_LIMIT = TABLE_ACTIVITY_LIMIT;

/** Read the space from a workspace, tolerating one written by an older or newer build. */
export function readSpaceFromState(state: TableState): { space: CollaborationSpace | undefined; problems: string[] } {
  const result = readCollaborationSpace(state.collaborationSpace);
  return { space: result.space, problems: result.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`) };
}

/**
 * Apply one space command to a workspace.
 *
 * The space decides the roles; the workspace decides the commit. Nothing here touches the source
 * tables — a space command can add a member or link a table, and the linked table's own authority
 * is what still decides whether anyone may read it.
 */
export function applySpaceCommand(context: SpaceCommandContext, command: SpaceCommand): SpaceCommandResult {
  const existing = readSpaceFromState(context.state);
  if (!existing.space) {
    return { ok: false, code: 'SPACE_NOT_FOUND', message: 'This workspace does not hold a collaboration space yet.' };
  }
  const decision: SpaceDecision = decideSpace(existing.space, context.actor.actorId, command, context.now);
  if (!decision.ok) return decision;

  const next: TableState = {
    ...context.state,
    collaborationSpace: decision.space,
    actionRevision: context.state.actionRevision + 1,
    activity: [...context.state.activity, { actorId: context.actor.actorId, action: command.type, at: context.now }].slice(-ACTIVITY_LIMIT),
  };
  return { ok: true, state: next, space: decision.space };
}

/**
 * Create the first space for a workspace whose owner is the manager.
 *
 * Kept separate from {@link applySpaceCommand} because creating a space is the one operation that
 * has no existing membership to check; the workspace owner is the only actor allowed to do it.
 */
export interface CreateSpaceInput {
  spaceId: string;
  title: string;
  sharedToolWorkspaceId: string;
  actor: ActorContext;
  now: number;
}

export function createSpaceState(state: TableState, input: CreateSpaceInput): SpaceCommandResult {
  if (state.collaborationSpace) {
    return { ok: false, code: 'SPACE_EXISTS', message: 'This workspace already holds a collaboration space.' };
  }
  const title = input.title.trim();
  if (title.length === 0) {
    return { ok: false, code: 'SPACE_INVALID', message: 'Use a title of 1 to 80 characters.' };
  }
  const space: CollaborationSpace = {
    schemaVersion: 1,
    spaceId: input.spaceId,
    title,
    sharedToolWorkspaceId: input.sharedToolWorkspaceId,
    managerActorId: input.actor.actorId,
    members: [{ actorId: input.actor.actorId, name: input.actor.name, role: 'manager', joinedAt: input.now }],
    sources: [],
    revision: 1,
    epoch: 1,
    createdAt: input.now,
    updatedAt: input.now,
  };
  const next: TableState = {
    ...state,
    collaborationSpace: space,
    actionRevision: state.actionRevision + 1,
    activity: [...state.activity, { actorId: input.actor.actorId, action: 'space.create', at: input.now }].slice(-ACTIVITY_LIMIT),
  };
  return { ok: true, state: next, space };
}

/**
 * Domain entry point for the space commands.
 *
 * Returns `null` for any other command so `handleTableCommand` can keep its own chain unchanged.
 * A rejected command throws `DomainError` with a stable code, which is how every other domain
 * command reports a refusal, so the authority maps it to a rejected ack rather than a crash.
 */
export function handleSpaceCommand(
  state: TableState,
  type: string,
  payload: unknown,
  ctx: ActorContext,
): { state: TableState; label: string } | null {
  if (!isSpaceCommand(type)) return null;
  const parsed = parseSpaceCommand(type, payload);
  if (!parsed.ok) throw new DomainError(parsed.code, parsed.message);

  if (parsed.type === 'space.create') {
    if (ctx.role !== 'owner') throw new DomainError('SPACE_FORBIDDEN', 'Only the workspace owner can create the space.');
    const created = createSpaceState(state, {
      spaceId: parsed.spaceId,
      title: parsed.title,
      sharedToolWorkspaceId: parsed.sharedToolWorkspaceId,
      actor: ctx,
      now: ctx.now,
    });
    if (!created.ok) throw new DomainError(created.code, created.message);
    return { state: created.state, label: `Space created: ${created.space.title}.` };
  }

  const command = toSpaceCommand(parsed);
  const applied = applySpaceCommand({ state, actor: ctx, now: ctx.now }, command);
  if (!applied.ok) throw new DomainError(applied.code, applied.message);
  return { state: applied.state, label: spaceLabel(parsed.type) };
}

function toSpaceCommand(parsed: Exclude<ReturnType<typeof parseSpaceCommand>, { ok: false } | { type: 'space.create' }>): SpaceCommand {
  switch (parsed.type) {
    case 'space.rename': return { type: 'space.rename', title: parsed.title };
    case 'space.addMember': return { type: 'space.addMember', member: parsed.member };
    case 'space.removeMember': return { type: 'space.removeMember', actorId: parsed.actorId };
    case 'space.setRole': return { type: 'space.setRole', actorId: parsed.actorId, role: parsed.role };
    case 'space.transferManager': return { type: 'space.transferManager', actorId: parsed.actorId };
    case 'space.addSource': return { type: 'space.addSource', source: parsed.source };
    case 'space.leaveSource': return { type: 'space.leaveSource', workspaceId: parsed.workspaceId };
    case 'space.seen': return { type: 'space.seen', revision: parsed.revision };
    case 'space.setBrief': return { type: 'space.setBrief', text: parsed.text };
    case 'space.clearBrief': return { type: 'space.clearBrief' };
  }
}

function spaceLabel(type: string): string {
  switch (type) {
    case 'space.rename': return 'Space renamed.';
    case 'space.addMember': return 'Member added to the space.';
    case 'space.removeMember': return 'Member removed from the space.';
    case 'space.setRole': return 'Space role changed.';
    case 'space.transferManager': return 'Space management transferred.';
    case 'space.addSource': return 'Source table linked to the space.';
    case 'space.leaveSource': return 'Source table unlinked from the space.';
    case 'space.seen': return 'Reading position recorded.';
    case 'space.setBrief': return 'Room brief saved.';
    case 'space.clearBrief': return 'Room brief cleared.';
    default: return 'Space updated.';
  }
}
