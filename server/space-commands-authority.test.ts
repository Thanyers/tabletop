import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandAck, CommandEnvelope } from '../src/tabletop/shared/contracts.js';
import { createPGliteDatabase } from './database.js';
import { migrateDatabase } from './migrations.js';
import { sha256 } from './codec.js';
import { CommandAuthority, type AuthenticatedSession } from './authority.js';
import { SqlWorkspaceRepository, type SessionRecord } from './repository.js';

/**
 * F080: the space and grant commands must be reachable through the real command authority.
 *
 * This file exists because the unit tests could not catch a blocker: the authority rejects any
 * payload carrying an identity-shaped key (`actorId`, `role`, `workspaceId`, `epoch`) before the
 * domain runs, which silently killed four of the eight space commands. Only an `execute()`
 * round-trip sees that path, so every command family gets one here.
 */

async function harness() {
  const database = createPGliteDatabase();
  await migrateDatabase(database, 'local');
  const repository = new SqlWorkspaceRepository(database);
  const authority = new CommandAuthority({ repository, identity: repository });
  const now = Date.now();
  const actorId = randomUUID();
  const record: SessionRecord = {
    tokenHash: sha256(`space:${randomUUID()}`),
    csrfHash: sha256(`space-csrf:${randomUUID()}`),
    actorId,
    name: 'Space owner',
    createdAt: now,
    lastSeenAt: now,
    hardExpiresAt: now + 60 * 60 * 1_000,
    revokedAt: null,
    workspaceId: null,
    rotatedToTokenHash: null,
    rotationTicketHash: null,
  };
  await repository.createSession(record);
  const session: AuthenticatedSession = { record, csrfToken: 'space-csrf-token', expiresAt: record.hardExpiresAt };
  const created = await authority.createWorkspace(session, { kind: 'table', title: 'Space table' });

  const view = async () => (await authority.authorizeSession(session, created.id)).workspace;

  /** Execute with the revision the workspace actually has, so the CAS is genuinely exercised. */
  const execute = async (type: string, payload: unknown): Promise<CommandAck> => {
    const workspace = await view();
    const envelope = {
      commandId: randomUUID(),
      type,
      payload,
      expectedRevision: workspace.revision,
      expectedEpoch: workspace.epoch,
    } as unknown as CommandEnvelope;
    return authority.execute(session, envelope, created.id);
  };

  /** Add a real member row, the way an invite would. */
  const addMember = async (memberActorId: string, role = 'participant'): Promise<void> => {
    await database.query(
      `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, NULL)`,
      [created.id, created.epoch, memberActorId, 'Space target', role, Date.now()],
    );
  };

  const domain = async () => (await view()).domain as unknown as Record<string, unknown>;

  return { authority, session, workspaceId: created.id, actorId, execute, domain, addMember };
}

describe('space commands survive the authority guard', () => {
  it('creates a space through execute()', async () => {
    const h = await harness();
    const ack = await h.execute('space.create', { spaceId: 'activity-room', title: 'ห้องวางผังกิจกรรม', sharedToolWorkspaceId: h.workspaceId });
    expect(ack.workspace.revision).toBeTruthy();
    const space = (await h.domain()).collaborationSpace as { managerActorId: string; title: string } | undefined;
    expect(space?.managerActorId).toBe(h.actorId);
    expect(space?.title).toBe('ห้องวางผังกิจกรรม');
  });

  it('accepts the four commands whose payload names a target', async () => {
    const h = await harness();
    await h.execute('space.create', { spaceId: 'activity-room', title: 'ห้อง', sharedToolWorkspaceId: h.workspaceId });
    const target = randomUUID();
    await h.addMember(target);
    // The space's own workspace cannot be a source, so link a different table.
    const sourceWorkspace = randomUUID();

    await h.execute('space.addMember', { member: { actorId: target, name: 'Target', role: 'maker', joinedAt: 1 } });
    // `actorId` + `role` at the top level — the exact shape the identity guard used to reject.
    await h.execute('space.setRole', { actorId: target, role: 'participant' });
    // `workspaceId` at the top level.
    await h.execute('space.addSource', { source: { workspaceId: sourceWorkspace, epoch: 1, addedBy: h.actorId, addedAt: 1, status: 'linked' } });
    await h.execute('space.leaveSource', { workspaceId: sourceWorkspace });
    // `actorId` at the top level; transferring hands management over, so it goes last.
    await h.execute('space.transferManager', { actorId: target });

    const space = (await h.domain()).collaborationSpace as {
      members: { actorId: string; role: string }[];
      sources: { workspaceId: string; status: string }[];
      managerActorId: string;
    } | undefined;
    expect(space?.members.find(member => member.actorId === target)?.role).toBe('manager');
    expect(space?.members.find(member => member.actorId === h.actorId)?.role).toBe('maker');
    expect(space?.managerActorId).toBe(target);
    expect(space?.sources).toEqual([expect.objectContaining({ workspaceId: sourceWorkspace, status: 'left' })]);
  });

  it('refuses to add someone who is not at the table', async () => {
    const h = await harness();
    await h.execute('space.create', { spaceId: 'activity-room', title: 'ห้อง', sharedToolWorkspaceId: h.workspaceId });
    const outsider = randomUUID();
    await expect(h.execute('space.addMember', { member: { actorId: outsider, name: 'Outsider', role: 'viewer', joinedAt: 1 } }))
      .rejects.toMatchObject({ code: 'MEMBER_NOT_FOUND' });
  });

  it('still refuses a spoofed identity on a command that does not name a target', async () => {
    const h = await harness();
    await expect(h.execute('canvas.layout', { actorId: 'someone-else' })).rejects.toMatchObject({ code: 'COMMAND_IDENTITY_SPOOF' });
  });
});

describe('grant commands survive the authority guard', () => {
  it('reaches the domain payload check rather than the identity guard', async () => {
    const h = await harness();
    const code = await h
      .execute('source.grantProjection', { grantId: 'grant-empty', spaceId: 'activity-room', spaceWorkspaceId: h.workspaceId, audience: { kind: 'space-members' }, projections: [], actions: [] })
      .then(() => 'accepted')
      .catch((error: { code?: string }) => error.code);
    // An empty projection list is refused by the strict payload schema: proof the command is no
    // longer eaten by COMMAND_IDENTITY_SPOOF before the domain can see it.
    expect(code).toBe('SOURCE_GRANT_PAYLOAD');
  });

  it('grants and revokes a projection, recording the revocation on the source', async () => {
    const h = await harness();
    const granted = await h.execute('source.grantProjection', {
      grantId: 'grant-budget',
      spaceId: 'activity-room',
      spaceWorkspaceId: h.workspaceId,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 25 }],
      actions: [],
    });
    expect(granted.workspace.revision).toBeTruthy();

    const afterGrant = (await h.domain()).spaceGrants as { grantId: string; status: string; sourceEpoch: number; grantedBy: string }[];
    expect(afterGrant).toHaveLength(1);
    expect(afterGrant[0]).toMatchObject({ grantId: 'grant-budget', status: 'granted', grantedBy: h.actorId });
    // The epoch is stamped by the server, never supplied by the payload.
    expect(typeof afterGrant[0]?.sourceEpoch).toBe('number');

    await h.execute('source.revokeProjection', { grantId: 'grant-budget' });
    const afterRevoke = (await h.domain()).spaceGrants as { status: string; revokedAt?: number; revokedBy?: string; grantVersion: number }[];
    expect(afterRevoke[0]).toMatchObject({ status: 'revoked', revokedBy: h.actorId, grantVersion: 2 });
    expect(typeof afterRevoke[0]?.revokedAt).toBe('number');
  });
});
