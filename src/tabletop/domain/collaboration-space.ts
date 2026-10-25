import type { ActorContext } from '../shared/contracts';
import {
  readCollaborationSpace,
  decideSpace,
  type CollaborationSpace,
  type SpaceCommand,
  type SpaceDecision,
} from '../shared/collaboration-space';
import type { TableState } from '../shared/table-contracts';

/**
 * F080 / C5: where a collaboration space lives.
 *
 * It is an optional field on the workspace that owns the shared tools, exactly like notes and
 * card metadata were added before it: additive, absent in older workspaces, and never a reason to
 * reject stored state. That keeps the whole slice migration-free — no new table, no D1 change —
 * while the space still only *references* the source tables it was linked to.
 */

export interface SpaceCommandContext {
  state: TableState;
  actor: ActorContext;
  now: number;
}

export type SpaceCommandResult =
  | { ok: true; state: TableState; space: CollaborationSpace }
  | { ok: false; code: string; message: string };

/** How many activity entries the space commands keep; the table trims the same way. */
const ACTIVITY_LIMIT = 48;

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
