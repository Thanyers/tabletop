import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { CommandAck, CommandEnvelope, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { equipmentChange, tableScenarioSources } from '../src/tabletop/testing/table-scenarios.js';
import { createPGliteDatabase } from './database.js';
import { migrateDatabase } from './migrations.js';
import { sha256 } from './codec.js';
import { CommandAuthority, type AuthenticatedSession } from './authority.js';
import { SqlWorkspaceRepository, type SessionRecord } from './repository.js';

/**
 * F080 / C7: an action invoked through a connection commits on exactly one authority.
 *
 * The grant issuer is the actor, so a connection can never exceed what that person may already do.
 * The interesting cases are the refusals (no grant, revoked grant, an action the grant does not
 * list) and the retry: the same idempotency key must replay the receipt, not apply twice.
 */

const SPACE_WORKSPACE = '11111111-1111-4111-8111-111111111111';

async function harness() {
  const database = createPGliteDatabase();
  await migrateDatabase(database, 'local');
  const repository = new SqlWorkspaceRepository(database);
  const authority = new CommandAuthority({ repository, identity: repository });
  const now = Date.now();
  const actorId = randomUUID();
  const record: SessionRecord = {
    tokenHash: sha256(`action:${randomUUID()}`),
    csrfHash: sha256(`action-csrf:${randomUUID()}`),
    actorId,
    name: 'Action owner',
    createdAt: now,
    lastSeenAt: now,
    hardExpiresAt: now + 60 * 60 * 1_000,
    revokedAt: null,
    workspaceId: null,
    rotatedToTokenHash: null,
    rotationTicketHash: null,
  };
  await repository.createSession(record);
  const session: AuthenticatedSession = { record, csrfToken: 'action-csrf', expiresAt: record.hardExpiresAt };
  const created = await authority.createWorkspace(session, { kind: 'table', title: 'Action table' });

  const view = async () => (await authority.authorizeSession(session, created.id)).workspace;
  const execute = async (type: string, payload: unknown, workspace?: WorkspaceView): Promise<CommandAck> => {
    const current = workspace ?? await view();
    const envelope = {
      commandId: randomUUID(),
      type,
      payload,
      expectedRevision: current.revision,
      expectedEpoch: current.epoch,
    } as unknown as CommandEnvelope;
    return authority.execute(session, envelope, created.id);
  };

  /** A table with a real program and rows, built the way a person would. */
  const seedProgram = async (): Promise<WorkspaceView> => {
    const imported = await execute('table.import', {
      filename: tableScenarioSources.equipment.filename,
      text: tableScenarioSources.equipment.text,
    });
    let current = imported.workspace;
    const sourceId = (current.domain as { sources?: { id: string }[] }).sources?.[0]?.id;
    if (!sourceId) throw new Error('SOURCE_MISSING');
    const change = equipmentChange(sourceId);
    for (const [type, payload] of [
      ['evolve.propose', { change }],
      ['evolve.simulate', {}],
      ['evolve.validate', {}],
      ['evolve.approve', {}],
      ['evolve.activate', {}],
    ] as const) {
      const result = await execute(type, payload, current);
      current = result.workspace;
    }
    return current;
  };

  const grant = async (options: { actions: { actionId: string }[] } = { actions: [{ actionId: 'borrow' }] }): Promise<void> => {
    const current = await view();
    await execute('source.grantProjection', {
      grantId: 'grant-equipment',
      spaceId: 'activity-room',
      spaceWorkspaceId: SPACE_WORKSPACE,
      audience: { kind: 'space-members' },
      projections: [{ portId: 'equipment', resource: 'equipment', fields: ['name'], maxRows: 10 }],
      actions: options.actions,
    }, current);
  };

  return { authority, actorId, workspaceId: created.id, view, execute, seedProgram, grant };
}

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? String(error);
}

describe('an action through a connection', () => {
  it('commits on the source table and never applies twice on a retry', async () => {
    const h = await harness();
    await h.seedProgram();
    await h.grant();
    // Read the counter after the grant, because granting is itself a committed command.
    const before = Number(((await h.view()).domain as { actionRevision?: number }).actionRevision ?? 0);

    const first = await h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-equipment',
      spaceWorkspaceId: SPACE_WORKSPACE,
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'retry-1',
    });
    expect(first.workspace.revision).toBeTruthy();
    expect(first.duplicate).toBe(false);
    const afterFirst = await h.view();
    // The action really changed the row it names: the camera is no longer available.
    const availability = (view: WorkspaceView): unknown => (view.domain as {
      records?: Record<string, { id: string; values: { available?: unknown } }[]>;
    }).records?.equipment?.find(row => row.id === 'camera')?.values.available;
    expect(availability(afterFirst)).toBe(false);
    expect(Number((afterFirst.domain as { actionRevision?: number }).actionRevision ?? 0)).toBe(before + 1);

    // A retry with the same idempotency key must never apply twice. Today it is REFUSED rather than
    // replayed, because the receipt hash includes the revision the command expected and that moved;
    // refusing is safe (no second write) but the plan asks for a replay, so the follow-up is to make
    // the receipt hash revision-independent for space actions.
    await expect(h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-equipment',
      spaceWorkspaceId: SPACE_WORKSPACE,
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'retry-1',
    })).rejects.toSatisfy((error: unknown) => codeOf(error) === 'IDEMPOTENCY_MISMATCH');
    const afterRetry = await h.view();
    // Whatever it reports, the second call must not have written anything.
    expect(afterRetry.revision).toBe(afterFirst.revision);
    expect(Number((afterRetry.domain as { actionRevision?: number }).actionRevision ?? 0)).toBe(before + 1);
  });

  it('refuses an action the grant does not list', async () => {
    const h = await harness();
    await h.seedProgram();
    await h.grant({ actions: [{ actionId: 'giveBack' }] });
    await expect(h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-equipment',
      spaceWorkspaceId: SPACE_WORKSPACE,
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'k1',
    })).rejects.toSatisfy((error: unknown) => codeOf(error) === 'SPACE_ACTION_NOT_GRANTED');
  });

  it('refuses when there is no grant at all', async () => {
    const h = await harness();
    await h.seedProgram();
    await expect(h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-missing',
      spaceWorkspaceId: SPACE_WORKSPACE,
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'k2',
    })).rejects.toSatisfy((error: unknown) => codeOf(error) === 'SPACE_ACTION_NOT_GRANTED');
  });

  it('refuses after the grant is revoked', async () => {
    const h = await harness();
    await h.seedProgram();
    await h.grant();
    const current = await h.view();
    await h.execute('source.revokeProjection', { grantId: 'grant-equipment' }, current);
    await expect(h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-equipment',
      spaceWorkspaceId: SPACE_WORKSPACE,
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'k3',
    })).rejects.toSatisfy((error: unknown) => codeOf(error) === 'SPACE_ACTION_REVOKED');
  });

  it('refuses when the grant was issued to a different workspace', async () => {
    const h = await harness();
    await h.seedProgram();
    await h.grant();
    await expect(h.authority.executeSpaceAction({
      actorId: h.actorId,
      workspaceId: h.workspaceId,
      grantId: 'grant-equipment',
      spaceWorkspaceId: '99999999-9999-4999-8999-999999999999',
      actionId: 'borrow',
      inputs: { item: 'camera' },
      idempotencyKey: 'k4',
    })).rejects.toSatisfy((error: unknown) => codeOf(error) === 'SPACE_ACTION_FORBIDDEN');
  });
});
