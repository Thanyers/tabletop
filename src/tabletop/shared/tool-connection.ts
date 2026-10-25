import { z } from 'zod';

/**
 * F080 / C7: the connection protocol between a collaboration space and a source table.
 *
 * The plan requires a written protocol before any cross-table behaviour: what snapshot each
 * source is read at, what freshness is actually guaranteed, who commits, how a revocation and an
 * in-flight request interact, and what recovery means. This module is that note in executable
 * form, so the docs, the UI and the tests read the same values instead of three prose copies.
 *
 * The short version: there is no distributed atomicity here. Each read is stamped with the
 * revision it came from, each action commits on exactly one authority, and an unsupported
 * multi-authority operation is refused *before* any side effect.
 */

export const TOOL_CONNECTION_PROTOCOL = {
  inputSnapshot: 'ทุกแหล่งถูกอ่านที่ dataRevision ของตัวเอง และ snapshot นั้นติดไปกับ projection',
  freshness: 'ข้อมูลสดด้วยการอ่านใหม่หลัง invalidate — ไม่มี global snapshot ข้ามแหล่ง และไม่อ้างความสดพร้อมกัน',
  commitment: 'action เขียนหนึ่ง target authority เท่านั้น และ authority ของ target เป็นผู้ commit',
  atomicity: 'ไม่มี distributed atomicity; operation ที่ต้องเขียนหลาย authority ถูกปฏิเสธก่อน side effect',
  inFlight: 'คำขอที่ยังไม่ commit เมื่อ grant ถูกถอนต้องถูกปฏิเสธ ไม่ใช่ commit ตามหลัง',
  revocation: 'revoke มีผลที่ revision ของ grant; destination อ่าน/เสิร์ฟแถวที่ cache ไว้ต่อไม่ได้',
  recovery: 'คำขอที่ถูกปฏิเสธ retry ได้หลัง rebind และไม่มีการอ้างว่า compensation คือ rollback',
} as const;


export const TOOL_CONNECTION_LIMITS = {
  /** Grants one source table may have outstanding; a reset or a new space needs a new grant. */
  maxGrantsPerSource: 8,
  maxProjections: 8,
  maxFields: 24,
  maxActions: 8,
  maxAudienceActors: 64,
} as const;

export const toolProjectionGrantSchema = z.strictObject({
  grantId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  spaceId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
  sourceWorkspaceId: z.string().uuid(),
  sourceEpoch: z.number().int().nonnegative(),
  sourceDataRevision: z.number().int().nonnegative(),
  grantedBy: z.string().min(1).max(160),
  issuedAt: z.number().int().nonnegative(),
  grantVersion: z.number().int().positive(),
  status: z.enum(['granted', 'revoked']),
  revokedAt: z.number().int().nonnegative().optional(),
  revokedBy: z.string().min(1).max(160).optional(),
  audience: z.union([
    z.strictObject({ kind: z.literal('space-members') }),
    z.strictObject({ kind: z.literal('actors'), actorIds: z.array(z.string().min(1).max(160)).min(1).max(64) }),
  ]),
  projections: z.array(z.strictObject({
    portId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
    resource: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u),
    fields: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u)).min(1).max(24),
    maxRows: z.number().int().positive().max(200),
  })).min(1).max(8),
  actions: z.array(z.strictObject({ actionId: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/u) })).max(8),
});
export type ConnectionStatus = 'proposed' | 'granted' | 'active' | 'revoked' | 'missing' | 'incompatible';

/** The wire form of a grant the source is about to issue; derived fields are added by the domain. */
export type ToolProjectionGrantInput = z.infer<typeof toolProjectionGrantSchema>;

/** A projection the source authorizes the destination space to read. */
export interface ToolGrantProjection {
  portId: string;
  resource: string;
  /** Field allowlist; the source decides, the package may read only this intersection. */
  fields: string[];
  maxRows: number;
}

/**
 * The grant lives at the source. The destination only keeps a reference to it, which is why a
 * copied tool definition cannot carry access: the source can revoke without telling anyone.
 */
export interface ToolProjectionGrant {
  grantId: string;
  /** The collaboration space that may read. */
  spaceId: string;
  sourceWorkspaceId: string;
  /** Epoch the grant was issued under; a source reset invalidates it. */
  sourceEpoch: number;
  sourceDataRevision: number;
  grantedBy: string;
  issuedAt: number;
  /** Bumped on every change to the grant, including revocation. */
  grantVersion: number;
  status: 'granted' | 'revoked';
  revokedAt?: number;
  revokedBy?: string;
  audience: { kind: 'space-members' } | { kind: 'actors'; actorIds: string[] };
  projections: ToolGrantProjection[];
  /** Source actions the destination may invoke through the connection. */
  actions: { actionId: string }[];
}

export type GrantProblemCode =
  | 'GRANT_NOT_FOUND'
  | 'GRANT_REVOKED'
  | 'GRANT_STALE_EPOCH'
  | 'GRANT_AUDIENCE'
  | 'GRANT_FIELD_NOT_PERMITTED';

export type GrantVerdict =
  | { ok: true; projection: ToolGrantProjection }
  | { ok: false; code: GrantProblemCode; message: string };

/** Whether the grant is still a usable one for this source epoch at this moment. */
export function grantIsLive(grant: ToolProjectionGrant, sourceEpoch: number): boolean {
  return grant.status === 'granted' && grant.sourceEpoch === sourceEpoch;
}

/**
 * Adjudicate one read.
 *
 * The order matters: a revoked grant is refused even if the epoch and audience still match, and a
 * reset epoch is refused even when the grant was never revoked, so neither condition can be
 * relied on to mask the other.
 */
export function authorizeProjectionRead(
  grant: ToolProjectionGrant,
  input: { sourceEpoch: number; actorId: string; portId: string; isSpaceMember: boolean },
): GrantVerdict {
  if (grant.status === 'revoked') return { ok: false, code: 'GRANT_REVOKED', message: 'The source revoked this connection.' };
  if (grant.sourceEpoch !== input.sourceEpoch) return { ok: false, code: 'GRANT_STALE_EPOCH', message: 'The source was reset after this grant was issued.' };
  if (!input.isSpaceMember) return { ok: false, code: 'GRANT_AUDIENCE', message: 'Only a member of the space may read through this connection.' };
  if (grant.audience.kind === 'actors' && !grant.audience.actorIds.includes(input.actorId)) {
    return { ok: false, code: 'GRANT_AUDIENCE', message: 'This member is not in the audience of the grant.' };
  }
  const projection = grant.projections.find(entry => entry.portId === input.portId);
  if (!projection) return { ok: false, code: 'GRANT_FIELD_NOT_PERMITTED', message: 'The grant does not expose this port.' };
  return { ok: true, projection };
}

export type InFlightVerdict =
  | { ok: true }
  | { ok: false; code: 'GRANT_REVOKED' | 'GRANT_STALE_EPOCH'; message: string };

/**
 * Adjudicate a request that started before a grant changed.
 *
 * Re-reading before the commit is not enough on its own — this is the explicit rule the plan asks
 * for: if the grant is revoked (or the source was reset) by the time the commit would happen, the
 * request is rejected and nothing is written.
 */
export function adjudicateInFlight(
  grant: ToolProjectionGrant,
  input: { sourceEpoch: number; now: number },
): InFlightVerdict {
  if (grant.status === 'revoked') {
    return { ok: false, code: 'GRANT_REVOKED', message: `The source revoked this connection at ${grant.revokedAt ?? input.now}.` };
  }
  if (grant.sourceEpoch !== input.sourceEpoch) {
    return { ok: false, code: 'GRANT_STALE_EPOCH', message: 'The source was reset while this request was in flight.' };
  }
  return { ok: true };
}

/** The moment after which a revoked connection must not be served; `undefined` while it is live. */
export function effectiveRevocationAt(grant: ToolProjectionGrant): number | undefined {
  return grant.status === 'revoked' ? grant.revokedAt : undefined;
}

/**
 * A cache or projection served after this point is stale by definition, so the destination must
 * re-authorize rather than reuse the rows it already had.
 */
export function projectionUsableAt(grant: ToolProjectionGrant, at: number): boolean {
  // Fail closed: a revoked grant is unusable even if a stored record lost its timestamp.
  if (grant.status === 'revoked') {
    const revokedAt = effectiveRevocationAt(grant);
    return revokedAt !== undefined && at < revokedAt;
  }
  return true;
}

/* ------------------------------------------------------------------------------------------------
 * Lifecycle.
 * ---------------------------------------------------------------------------------------------- */

const TRANSITIONS: Record<ConnectionStatus, readonly ConnectionStatus[]> = {
  proposed: ['granted', 'revoked', 'missing'],
  granted: ['active', 'revoked', 'missing', 'incompatible'],
  active: ['revoked', 'missing', 'incompatible'],
  revoked: [],
  missing: ['granted'],
  incompatible: ['revoked'],
};

export function connectionTransition(current: ConnectionStatus, event: ConnectionStatus): ConnectionStatus | undefined {
  return TRANSITIONS[current].includes(event) ? event : undefined;
}

/** Every status a connection can be in; used by the UI so it cannot invent a state. */
export const CONNECTION_STATUSES: readonly ConnectionStatus[] = ['proposed', 'granted', 'active', 'revoked', 'missing', 'incompatible'];

/** A revoked connection is terminal: a person reconnects, which issues a new grant. */
export function connectionIsTerminal(status: ConnectionStatus): boolean {
  return status === 'revoked';
}
