import { z } from 'zod';
import type { ActorContext } from '../shared/contracts';
import { DomainError } from '../shared/contracts';
import {
  TOOL_CONNECTION_LIMITS,
  authorizeProjectionRead,
  type ToolProjectionGrant,
} from '../shared/tool-connection';
import type { TableState } from '../shared/table-contracts';
import { requirePermission, TABLE_ACTIVITY_LIMIT } from './helpers';

/**
 * F080 / C7: issuing and revoking a projection grant at the source table.
 *
 * A grant is the source's decision and lives on the source. The client may describe *what* it
 * wants to share — space, audience, projections, actions — but never the epoch, the data revision,
 * the issuing actor or the grant version: those are stamped here from the live state, so a client
 * cannot claim a revision it has not read or an epoch that was already reset.
 */

const idSchema = z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u);

const grantRequestSchema = z.strictObject({
  grantId: idSchema,
  spaceId: idSchema,
  audience: z.union([
    z.strictObject({ kind: z.literal('space-members') }),
    z.strictObject({ kind: z.literal('actors'), actorIds: z.array(z.string().min(1).max(160)).min(1).max(TOOL_CONNECTION_LIMITS.maxAudienceActors) }),
  ]),
  projections: z.array(z.strictObject({
    portId: idSchema,
    resource: idSchema,
    fields: z.array(idSchema).min(1).max(TOOL_CONNECTION_LIMITS.maxFields),
    maxRows: z.number().int().positive().max(200),
  })).min(1).max(TOOL_CONNECTION_LIMITS.maxProjections),
  actions: z.array(z.strictObject({ actionId: idSchema })).max(TOOL_CONNECTION_LIMITS.maxActions),
});

const revokeRequestSchema = z.strictObject({ grantId: idSchema });

export const SOURCE_GRANT_COMMANDS = ['source.grantProjection', 'source.revokeProjection'] as const;
export type SourceGrantCommand = typeof SOURCE_GRANT_COMMANDS[number];

export function isSourceGrantCommand(type: string): type is SourceGrantCommand {
  return (SOURCE_GRANT_COMMANDS as readonly string[]).includes(type);
}

function payloadOf<Schema extends z.ZodType>(schema: Schema, payload: unknown): z.infer<Schema> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new DomainError('SOURCE_GRANT_PAYLOAD', issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid grant payload.');
  }
  return parsed.data;
}

/** Sharing authority at the source; the space role never substitutes for it. */
function requireSharingAuthority(ctx: ActorContext): void {
  requirePermission(ctx, 'members.invite', ['owner']);
}

export function handleSourceGrantCommand(
  state: TableState,
  type: string,
  payload: unknown,
  ctx: ActorContext,
): { state: TableState; label: string } | null {
  if (!isSourceGrantCommand(type)) return null;
  requireSharingAuthority(ctx);

  if (type === 'source.grantProjection') {
    const request = payloadOf(grantRequestSchema, payload);
    const grants = state.spaceGrants ?? [];
    if (grants.some(grant => grant.grantId === request.grantId)) {
      throw new DomainError('SOURCE_GRANT_EXISTS', 'This grant already exists; change it or issue a new one.');
    }
    const live = grants.filter(grant => grant.status === 'granted');
    if (live.length >= TOOL_CONNECTION_LIMITS.maxGrantsPerSource) {
      throw new DomainError('SOURCE_GRANT_LIMIT', `At most ${TOOL_CONNECTION_LIMITS.maxGrantsPerSource} active grants per table.`);
    }
    // Every projection must name something the source actually has, so a grant cannot promise
    // data the table does not own.
    const program = state.program;
    for (const projection of request.projections) {
      const collection = program?.collections.find(entry => entry.id === projection.resource);
      if (program && !collection) {
        throw new DomainError('SOURCE_GRANT_PROJECTION', `The table has no resource "${projection.resource}".`);
      }
      if (collection) {
        const fieldIds = new Set(collection.fields.map(field => field.id));
        const unknown = projection.fields.filter(field => !fieldIds.has(field));
        if (unknown.length > 0) {
          throw new DomainError('SOURCE_GRANT_PROJECTION', `"${projection.resource}" has no field ${unknown.join(', ')}.`);
        }
      }
    }
    const grant: ToolProjectionGrant = {
      grantId: request.grantId,
      spaceId: request.spaceId,
      sourceWorkspaceId: ctx.workspaceId,
      sourceEpoch: ctx.epoch,
      sourceDataRevision: state.dataRevision,
      grantedBy: ctx.actorId,
      issuedAt: ctx.now,
      grantVersion: 1,
      status: 'granted',
      audience: request.audience,
      projections: request.projections,
      actions: request.actions,
    };
    return {
      state: {
        ...state,
        spaceGrants: [...grants, grant],
        actionRevision: state.actionRevision + 1,
        activity: [...state.activity, { actorId: ctx.actorId, action: type, at: ctx.now }].slice(-TABLE_ACTIVITY_LIMIT),
      },
      label: `Projection granted to ${grant.spaceId}.`,
    };
  }

  const request = payloadOf(revokeRequestSchema, payload);
  const grants = state.spaceGrants ?? [];
  const existing = grants.find(grant => grant.grantId === request.grantId);
  if (!existing) throw new DomainError('SOURCE_GRANT_NOT_FOUND', 'That grant does not exist on this table.');
  if (existing.status === 'revoked') return { state, label: 'This grant was already revoked.' };
  const revoked: ToolProjectionGrant = {
    ...existing,
    status: 'revoked',
    revokedAt: ctx.now,
    revokedBy: ctx.actorId,
    grantVersion: existing.grantVersion + 1,
  };
  return {
    state: {
      ...state,
      spaceGrants: grants.map(grant => (grant.grantId === revoked.grantId ? revoked : grant)),
      actionRevision: state.actionRevision + 1,
      activity: [...state.activity, { actorId: ctx.actorId, action: type, at: ctx.now }].slice(-48),
    },
    label: `Projection revoked for ${revoked.spaceId}.`,
  };
}

/**
 * Read one projection from the source state, using the same grant check the transport will use.
 *
 * Keeping this here means the read path and the future HTTP path cannot disagree about
 * authorization: both go through `authorizeProjectionRead`.
 */
export function readGrantedProjection(
  state: TableState,
  input: { grantId: string; actorId: string; portId: string; isSpaceMember: boolean; sourceEpoch: number },
): { ok: true; grant: ToolProjectionGrant; projection: { portId: string; resource: string; fields: string[]; maxRows: number } } | { ok: false; code: string; message: string } {
  const grant = (state.spaceGrants ?? []).find(entry => entry.grantId === input.grantId);
  if (!grant) return { ok: false, code: 'GRANT_NOT_FOUND', message: 'That grant does not exist on this table.' };
  const verdict = authorizeProjectionRead(grant, {
    sourceEpoch: input.sourceEpoch,
    actorId: input.actorId,
    portId: input.portId,
    isSpaceMember: input.isSpaceMember,
  });
  if (!verdict.ok) return { ok: false, code: verdict.code, message: verdict.message };
  return { ok: true, grant, projection: verdict.projection };
}
