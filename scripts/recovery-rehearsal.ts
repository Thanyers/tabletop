import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandAck, CommandEnvelope } from '../src/tabletop/shared/contracts.js';
import { CommandAuthority, type AuthenticatedSession } from '../server/authority.js';
import { createPGliteDatabase } from '../server/database.js';
import { AuthorityError } from '../server/errors.js';
import { migrateDatabase } from '../server/migrations.js';
import { SqlWorkspaceRepository } from '../server/repository.js';
import { createSyntheticChange, ensureBaselineOutputDirectory, sourceMetadata, syntheticRecordId, type SourceMetadata } from './architecture-baseline.js';

/**
 * F078-T7b — a disposable recovery rehearsal.
 *
 * The T7a contract says what a restore must preserve. This harness proves the parts a local
 * process can actually prove: it builds a room with several revisions, a revoked member, a
 * pending model job and command receipts, snapshots the state, closes the database, restores it
 * by copying the disposable directory, reopens it, and then re-checks every invariant through the
 * same authority the application uses.
 *
 * What this **is**: a clean-shutdown snapshot restore on a disposable local database.
 * What this is **not**: a crash-consistent point-in-time restore, a hosted D1/Room/Billing
 * coordinated restore, or evidence about production RPO/RTO. Those limits are written into the
 * report next to the measured numbers so they cannot be read as a guarantee.
 */

export interface RecoveryManifest {
  epoch: number;
  revision: number;
  stateHash: string;
  snapshots: number;
  events: number;
  receipts: number;
  outboxPending: number;
  pendingJobs: number;
  revokedMembers: number;
}

export interface RecoveryInvariant {
  name: string;
  passed: boolean;
  detail: string;
}

export interface RecoveryRehearsalReport {
  metadata: SourceMetadata;
  workload: { committedActions: number; revokedMember: boolean; pendingJobs: number };
  before: RecoveryManifest;
  after: RecoveryManifest;
  invariants: RecoveryInvariant[];
  timings: { buildMs: number; snapshotMs: number; restoreMs: number; verifyMs: number };
  rpo: { modelledCommitsLost: number; statement: string };
  rto: { reopenAndVerifyMs: number; statement: string };
  limits: string[];
}

export const REHEARSAL_DEFAULTS = { commits: 3, pendingJobs: 2 } as const;

export interface RehearsalOptions {
  commits: number;
  pendingJobs: number;
}

const REHEARSAL_LIMITS = { maximumCommits: 20, maximumPendingJobs: 5 } as const;

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function ownerSessionRecord(actorId: string, now: number) {
  return {
    tokenHash: 'a'.repeat(64),
    csrfHash: 'c'.repeat(64),
    actorId,
    name: 'Recovery rehearsal owner',
    createdAt: now,
    lastSeenAt: now,
    hardExpiresAt: now + 60 * 60 * 1_000,
    revokedAt: null,
    workspaceId: null,
    rotatedToTokenHash: null,
    rotationTicketHash: null,
  };
}

function memberSessionRecord(actorId: string, now: number) {
  return { ...ownerSessionRecord(actorId, now), tokenHash: 'b'.repeat(64), name: 'Recovery rehearsal member' };
}

async function inspect(database: ReturnType<typeof createPGliteDatabase>, workspaceId: string): Promise<RecoveryManifest> {
  const workspace = await database.query<{ epoch: number; revision: number; state_hash: string }>(
    'SELECT epoch, revision, state_hash FROM workspaces WHERE id = $1', [workspaceId],
  );
  const row = workspace.rows[0];
  if (!row) throw new Error('REHEARSAL_WORKSPACE_MISSING');
  const counts = await database.query<{
    snapshots: string; events: string; receipts: string; outbox: string; jobs: string; revoked: string;
  }>(
    `SELECT
       (SELECT COUNT(*)::bigint FROM snapshots WHERE workspace_id = $1) AS snapshots,
       (SELECT COUNT(*)::bigint FROM events WHERE workspace_id = $1) AS events,
       (SELECT COUNT(*)::bigint FROM commands WHERE workspace_id = $1) AS receipts,
       (SELECT COUNT(*)::bigint FROM outbox WHERE workspace_id = $1 AND delivered_at IS NULL) AS outbox,
       (SELECT COUNT(*)::bigint FROM model_jobs WHERE workspace_id = $1 AND status = 'queued') AS jobs,
       (SELECT COUNT(*)::bigint FROM memberships WHERE workspace_id = $1 AND revoked_at IS NOT NULL) AS revoked`,
    [workspaceId],
  );
  const row2 = counts.rows[0];
  if (!row2) throw new Error('REHEARSAL_COUNTS_MISSING');
  return {
    epoch: Number(row.epoch),
    revision: Number(row.revision),
    stateHash: String(row.state_hash),
    snapshots: Number(row2.snapshots),
    events: Number(row2.events),
    receipts: Number(row2.receipts),
    outboxPending: Number(row2.outbox),
    pendingJobs: Number(row2.jobs),
    revokedMembers: Number(row2.revoked),
  };
}

export async function runRecoveryRehearsal(options: RehearsalOptions): Promise<RecoveryRehearsalReport> {
  if (!Number.isSafeInteger(options.commits) || options.commits < 1 || options.commits > REHEARSAL_LIMITS.maximumCommits) {
    throw new Error('REHEARSAL_OPTIONS_OUT_OF_RANGE:commits');
  }
  if (!Number.isSafeInteger(options.pendingJobs) || options.pendingJobs < 0 || options.pendingJobs > REHEARSAL_LIMITS.maximumPendingJobs) {
    throw new Error('REHEARSAL_OPTIONS_OUT_OF_RANGE:pendingJobs');
  }

  const metadata = await sourceMetadata();
  const root = await mkdtemp(join(tmpdir(), 'tabletop-recovery-'));
  const sourceDirectory = join(root, 'source');
  const restoreDirectory = join(root, 'restore');
  const now = Date.now();
  const buildStartedAt = Date.now();
  const invariants: RecoveryInvariant[] = [];

  let retryEnvelope: CommandEnvelope | null = null;
  let retryAck: CommandAck | null = null;
  // The revision the authority accepts is its opaque token, not the numeric manifest counter.
  let currentRevision: CommandEnvelope['expectedRevision'] | null = null;
  let currentEpoch = 0;

  try {
    const database = createPGliteDatabase(sourceDirectory);
    const repository = new SqlWorkspaceRepository(database);
    try {
      await migrateDatabase(database, 'local');
      const authority = new CommandAuthority({ repository });
      const ownerRecord = ownerSessionRecord('owner-rehearsal', now);
      await repository.createSession(ownerRecord);
      const ownerSession: AuthenticatedSession = { record: ownerRecord, csrfToken: 'rehearsal-csrf', expiresAt: ownerRecord.hardExpiresAt };
      const memberRecord = memberSessionRecord('member-rehearsal', now);
      await repository.createSession(memberRecord);
      const memberSession: AuthenticatedSession = { record: memberRecord, csrfToken: 'rehearsal-csrf', expiresAt: memberRecord.hardExpiresAt };

      let workspace = await authority.createWorkspace(ownerSession, { kind: 'table', title: 'Recovery rehearsal room' });

      const setup: [string, unknown][] = [
        ['evolve.propose', { change: createSyntheticChange(2) }],
        ['evolve.simulate', {}],
        ['evolve.validate', {}],
        ['evolve.approve', {}],
        ['evolve.activate', {}],
      ];
      for (const [type, payload] of setup) {
        const ack: CommandAck = await authority.execute(ownerSession, {
          commandId: randomUUID(),
          expectedRevision: workspace.revision,
          expectedEpoch: workspace.epoch,
          type,
          payload,
        }, workspace.id);
        workspace = ack.workspace;
      }

      // Several committed revisions on top of the activated program.
      for (let index = 0; index < options.commits; index += 1) {
        const commandId = randomUUID();
        const envelope: CommandEnvelope = {
          commandId,
          expectedRevision: workspace.revision,
          expectedEpoch: workspace.epoch,
          type: 'table.act',
          payload: { actionId: 'increment', inputs: { record: syntheticRecordId(index % 2) } },
        };
        const ack: CommandAck = await authority.execute(ownerSession, envelope, workspace.id);
        workspace = ack.workspace;
        currentRevision = workspace.revision;
        currentEpoch = workspace.epoch;
        // The last commit is the one retried after the restore.
        retryEnvelope = envelope;
        retryAck = ack;
      }

      // A member who is invited through a real membership row and then revoked through the
      // transaction the authority itself uses.
      await database.query(
        `INSERT INTO memberships (workspace_id, epoch, actor_id, actor_name, role, seat, created_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
         ON CONFLICT DO NOTHING`,
        [workspace.id, workspace.epoch, memberRecord.actorId, 'Rehearsal member', 'learner', 'learner-1', now],
      );
      await repository.withWorkspaceTransaction(workspace.id, async (transaction) => {
        await transaction.revokeMember(memberRecord.actorId, now + 1);
      });

      // Pending model jobs are fixtures seeded directly, the way the conformance suite seeds a
      // membership: the behavior under test is persistence and recovery, not job reservation.
      for (let index = 0; index < options.pendingJobs; index += 1) {
        await database.query(
          `INSERT INTO model_jobs (id, workspace_id, epoch, actor_id, status, data, created_at, revoked_at)
           VALUES ($1, $2, $3, $4, 'queued', $5::jsonb, $6, NULL)`,
          [randomUUID(), workspace.id, workspace.epoch, ownerRecord.actorId, JSON.stringify({ kind: 'draft' }), now],
        );
      }

      const buildMs = Date.now() - buildStartedAt;
      const snapshotStartedAt = Date.now();
      const before = await inspect(database, workspace.id);
      const snapshotMs = Date.now() - snapshotStartedAt;

      // Close cleanly, then restore by copying the disposable directory.
      await repository.close();

      const restoreStartedAt = Date.now();
      await cp(sourceDirectory, restoreDirectory, { recursive: true });
      const restoredDatabase = createPGliteDatabase(restoreDirectory);
      const restoredRepository = new SqlWorkspaceRepository(restoredDatabase);
      try {
        await restoredRepository.isReady();
        const restoredAuthority = new CommandAuthority({ repository: restoredRepository });
        const verifyStartedAt = Date.now();
        const after = await inspect(restoredDatabase, workspace.id);

        const expect = (name: string, passed: boolean, detail: string): void => {
          invariants.push({ name, passed, detail });
        };
        expect('state hash matches', before.stateHash === after.stateHash, `${before.stateHash.slice(0, 12)} vs ${after.stateHash.slice(0, 12)}`);
        expect('epoch and revision match', before.epoch === after.epoch && before.revision === after.revision, `epoch ${after.epoch} revision ${after.revision}`);
        expect('snapshot, event and receipt counts match',
          before.snapshots === after.snapshots && before.events === after.events && before.receipts === after.receipts,
          `snapshots ${after.snapshots}, events ${after.events}, receipts ${after.receipts}`);
        expect('outbox pending count matches', before.outboxPending === after.outboxPending, `${after.outboxPending} pending`);
        expect('pending model jobs survive as queued', after.pendingJobs === before.pendingJobs, `${after.pendingJobs} queued`);
        expect('revoked member stays revoked', after.revokedMembers === before.revokedMembers && after.revokedMembers >= 1, `${after.revokedMembers} revoked`);

        // Exact retry of a command that committed before the restore: the receipt must replay the
        // original acknowledgement and must not create a new event.
        if (retryEnvelope) {
          const replay = await restoredAuthority.execute(ownerSession, retryEnvelope, workspace.id);
          const eventsAfterRetry = await inspect(restoredDatabase, workspace.id);
          expect('exact retry replays the original receipt',
            replay.duplicate === true && String(replay.workspace.revision) === String(retryAck?.workspace.revision),
            `duplicate=${String(replay.duplicate)} revision=${String(replay.workspace.revision)}`);
          expect('exact retry adds no event or receipt',
            eventsAfterRetry.events === after.events && eventsAfterRetry.receipts === after.receipts,
            `events ${eventsAfterRetry.events}, receipts ${eventsAfterRetry.receipts}`);
        }

        // A revoked member is still refused after the restore, through the authority.
        let revokedRefused = false;
        let revokedCode = '';
        try {
          await restoredAuthority.execute(memberSession, {
            commandId: randomUUID(),
            expectedRevision: currentRevision ?? retryEnvelope?.expectedRevision,
            expectedEpoch: currentEpoch,
            type: 'table.act',
            payload: { actionId: 'increment', inputs: { record: syntheticRecordId(0) } },
          }, workspace.id);
        } catch (error) {
          revokedRefused = error instanceof AuthorityError;
          revokedCode = error instanceof AuthorityError ? error.code : 'UNEXPECTED_ERROR';
        }
        expect('revoked member is refused after restore', revokedRefused && revokedCode === 'MEMBERSHIP_REVOKED', revokedCode);

        const verifyMs = Date.now() - verifyStartedAt;
        const restoreMs = Date.now() - restoreStartedAt;
        const passed = invariants.every((item) => item.passed);

        return {
          metadata,
          workload: { committedActions: options.commits, revokedMember: true, pendingJobs: options.pendingJobs },
          before,
          after,
          invariants,
          timings: { buildMs, snapshotMs, restoreMs, verifyMs },
          rpo: {
            modelledCommitsLost: passed ? 0 : Number.NaN,
            statement: 'snapshot taken after a clean close, so the modelled RPO is 0 commits; a crash before the close would lose everything since the last committed transaction',
          },
          rto: {
            reopenAndVerifyMs: restoreMs,
            statement: 'measured reopen + invariant verification on a disposable local directory; hosted D1/Room/Billing restore has an unknown RTO',
          },
          limits: [
            'clean-shutdown directory copy, not crash-consistent point-in-time recovery',
            'Node PGlite adapter only: no D1 directory, Room SQLite or Billing ledger is restored together',
            'billing outcomes are not represented on the Node path, so ledger reconciliation is untested here',
            'diagnostic only: no production or shared database was read or written',
          ],
        };
      } finally {
        await restoredRepository.close();
      }
    } finally {
      // The source repository may already be closed; closing twice is harmless for a disposable DB.
      await repository.close().catch(() => undefined);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith('..')
    && !/^[A-Za-z]:/u.test(relativePath) && !relativePath.startsWith('/');
}

async function writeReport(report: RecoveryRehearsalReport): Promise<string> {
  const root = await realpath(repositoryRoot);
  const outputRoot = await ensureBaselineOutputDirectory(root, 'recovery-rehearsal');
  const stamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, '-');
  const outputPath = join(outputRoot, `recovery-rehearsal-${stamp}-${report.metadata.sourceScriptSha256.slice(0, 12)}.json`);
  if (!isWithin(outputRoot, outputPath)) throw new Error('OUTPUT_PATH_NOT_SAFE');
  if (await realpath(dirname(outputPath)) !== outputRoot) throw new Error('OUTPUT_PATH_NOT_SAFE');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return relative(root, outputPath).replaceAll('\\', '/');
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node --import tsx scripts/recovery-rehearsal.ts [options]',
    '',
    `  --commits <n>       Committed revisions before the snapshot (1-${REHEARSAL_LIMITS.maximumCommits}, default ${REHEARSAL_DEFAULTS.commits})`,
    `  --pending-jobs <n>  Queued model jobs seeded before the snapshot (0-${REHEARSAL_LIMITS.maximumPendingJobs}, default ${REHEARSAL_DEFAULTS.pendingJobs})`,
    '  --help              Show this help',
    '',
    'Builds a disposable on-disk PGlite room, snapshots it, restores by copying the directory, and',
    're-checks state hash, counts, exact retry, revoked member and pending jobs through the real',
    'authority. It writes one JSON result under ignored test-results/ and touches no shared data.',
  ].join('\n') + '\n');
}

function parseOptions(args: readonly string[]): RehearsalOptions | null {
  const options: RehearsalOptions = { ...REHEARSAL_DEFAULTS };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return null;
    const [flag, inlineValue] = argument.split('=', 2);
    const name = (flag ?? '').replace(/^--/u, '');
    if (seen.has(name)) throw new Error('DUPLICATE_OPTION');
    seen.add(name);
    const rawValue = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;
    if (rawValue === undefined || rawValue.startsWith('--')) throw new Error('OPTION_VALUE_REQUIRED');
    if (!/^(0|[1-9]\d*)$/u.test(rawValue)) throw new Error(`INVALID_${name.toUpperCase().replace(/-/gu, '_')}`);
    const value = Number(rawValue);
    if (name === 'commits') {
      if (value < 1 || value > REHEARSAL_LIMITS.maximumCommits) throw new Error('OUT_OF_RANGE_COMMITS');
      options.commits = value;
    } else if (name === 'pending-jobs') {
      if (value < 0 || value > REHEARSAL_LIMITS.maximumPendingJobs) throw new Error('OUT_OF_RANGE_PENDING_JOBS');
      options.pendingJobs = value;
    } else {
      throw new Error('UNKNOWN_OPTION');
    }
  }
  return options;
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options === null) {
    printHelp();
    return;
  }
  const report = await runRecoveryRehearsal(options);
  const output = await writeReport(report);
  const failed = report.invariants.filter((item) => !item.passed);
  process.stdout.write(`Recovery rehearsal saved to ${output}\n`);
  process.stdout.write(`${JSON.stringify({
    sourceCommit: report.metadata.sourceCommit,
    workload: report.workload,
    invariants: report.invariants,
    timings: report.timings,
    rpo: report.rpo,
    rto: report.rto,
    limits: report.limits,
  }, null, 2)}\n`);
  if (failed.length > 0) throw new Error('REHEARSAL_INVARIANT_FAILED');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof AuthorityError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_:]+$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED_ERROR';
    process.stderr.write(`RECOVERY_REHEARSAL_FAILED ${code}\n`);
    process.exitCode = 1;
  });
}
