import { randomUUID } from 'node:crypto';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { IncomingMessage } from 'node:http';
import { dirname, join, relative } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Socket } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandAck, CommandEnvelope } from '../src/tabletop/shared/contracts.js';
import { CommandAuthority } from '../server/authority.js';
import { createPGliteDatabase } from '../server/database.js';
import { AuthorityError } from '../server/errors.js';
import { migrateDatabase } from '../server/migrations.js';
import { SqlWorkspaceRepository } from '../server/repository.js';
import {
  BASELINE_LIMITS,
  STORAGE_TABLES,
  createSyntheticChange,
  ensureBaselineOutputDirectory,
  latencySummary,
  sourceMetadata,
  syntheticRecordId,
  type LatencySummary,
  type SourceMetadata,
} from './architecture-baseline.js';

/**
 * F078-T9 — a bounded local load/soak comparison on top of the T2 baseline harness.
 *
 * It drives several workspaces plus one hot room through the *real* `CommandAuthority` and
 * `SqlWorkspaceRepository` against a fresh in-memory PGlite, and reports success/stale latency,
 * the storage curve and the outbox backlog. Nothing here changes infrastructure, concurrency or
 * retention: it measures before anyone adjusts capacity, which is the point of the task.
 *
 * Two honesty rules are built into the output:
 *
 * 1. A comparison is only printed when the workload and the measured source are the same. Any
 *    mismatch (workload counts, source digest, Node/PGlite version, platform) makes the report
 *    say NOT COMPARABLE with the differing fields instead of a delta.
 * 2. `outbox` is a **backlog**, not a delivery lag: this harness never starts the outbox
 *    dispatcher, so every row it writes is still pending. Queue/job age and reconnect counts do
 *    not exist on the Node path at all and are reported as unmeasured rather than as zero.
 */

export const LOAD_DEFAULTS = {
  rooms: 2,
  samples: 6,
  staleSamples: 3,
  hotRoomCommits: 12,
  records: 20,
  points: 4,
} as const;

export const LOAD_LIMITS = {
  maximumRooms: 6,
  maximumSamplesPerGroup: 200,
  maximumHotRoomCommits: 60,
  maximumPoints: 8,
  maximumRecords: BASELINE_LIMITS.maximumRecords,
} as const;

export interface LoadOptions {
  rooms: number;
  samples: number;
  staleSamples: number;
  hotRoomCommits: number;
  records: number;
  points: number;
  /** Optional path to a previous load report to compare against. */
  compare?: string;
}

export interface StoragePoint {
  commits: number;
  totalRelationBytes: number;
  relations: { table: string; rows: number; relationBytes: number }[];
}

export interface OutboxBacklog {
  pendingRows: number;
  deliveredRows: number;
  oldestPendingAgeMs: number | null;
  /** What the number means, kept next to it so it cannot be read as a delivery lag. */
  interpretation: string;
}

export interface RoomMeasurement {
  index: number;
  committedActions: number;
  successful: LatencySummary;
  stale: LatencySummary & { expectedErrorCode: 'STALE_REVISION' };
}

export interface UnmeasuredSignals {
  signal: string;
  reason: string;
}

export interface ArchitectureLoadReport {
  metadata: SourceMetadata;
  workload: Omit<LoadOptions, 'compare'>;
  measurementScope: string;
  rooms: RoomMeasurement[];
  hotRoom: { index: number; commits: number; successful: LatencySummary };
  storageCurve: StoragePoint[];
  outbox: OutboxBacklog;
  unmeasured: UnmeasuredSignals[];
}

export interface LoadDelta {
  metric: string;
  previousP50Ms: number;
  currentP50Ms: number;
  previousP95Ms: number;
  currentP95Ms: number;
}

export interface LoadComparison {
  comparable: boolean;
  reasons: string[];
  deltas: LoadDelta[];
}

const MEASUREMENT_SCOPE = 'local synthetic, single process, in-memory PGlite, direct authority (no HTTP, no provider)';

function boundedInteger(flag: string, rawValue: string | undefined, minimum: number, maximum: number): number {
  if (rawValue === undefined || !/^(0|[1-9]\d*)$/u.test(rawValue)) throw new Error(`INVALID_${flag}`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`OUT_OF_RANGE_${flag}`);
  return value;
}

export function parseLoadOptions(args: readonly string[]): LoadOptions | null {
  const options: LoadOptions = { ...LOAD_DEFAULTS };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === undefined) continue;
    if (argument === '--help' || argument === '-h') return null;
    const [flag, inlineValue] = argument.split('=', 2);
    if (flag === undefined) throw new Error('UNKNOWN_OPTION');
    const name = flag.replace(/^--/u, '');
    const allowed = ['rooms', 'samples', 'stale-samples', 'hot-room-commits', 'records', 'points', 'compare'];
    if (!allowed.includes(name)) throw new Error('UNKNOWN_OPTION');
    if (seen.has(name)) throw new Error('DUPLICATE_OPTION');
    seen.add(name);
    const rawValue = inlineValue ?? args[index + 1];
    if (inlineValue === undefined) index += 1;
    if (rawValue === undefined || rawValue.startsWith('--')) throw new Error('OPTION_VALUE_REQUIRED');
    switch (name) {
      case 'rooms': options.rooms = boundedInteger('ROOMS', rawValue, 1, LOAD_LIMITS.maximumRooms); break;
      case 'samples': options.samples = boundedInteger('SAMPLES', rawValue, 1, LOAD_LIMITS.maximumSamplesPerGroup); break;
      case 'stale-samples': options.staleSamples = boundedInteger('STALE_SAMPLES', rawValue, 1, LOAD_LIMITS.maximumSamplesPerGroup); break;
      case 'hot-room-commits': options.hotRoomCommits = boundedInteger('HOT_ROOM_COMMITS', rawValue, 1, LOAD_LIMITS.maximumHotRoomCommits); break;
      case 'records': options.records = boundedInteger('RECORDS', rawValue, 1, LOAD_LIMITS.maximumRecords); break;
      case 'points': options.points = boundedInteger('POINTS', rawValue, 1, LOAD_LIMITS.maximumPoints); break;
      case 'compare': options.compare = rawValue; break;
      default: throw new Error('UNKNOWN_OPTION');
    }
  }
  return options;
}

/** Bounds are checked again at runtime so a direct API call cannot skip CLI validation. */
export function assertLoadOptions(options: LoadOptions): void {
  const checks: [boolean, string][] = [
    [Number.isSafeInteger(options.rooms) && options.rooms >= 1 && options.rooms <= LOAD_LIMITS.maximumRooms, 'rooms'],
    [Number.isSafeInteger(options.samples) && options.samples >= 1 && options.samples <= LOAD_LIMITS.maximumSamplesPerGroup, 'samples'],
    [Number.isSafeInteger(options.staleSamples) && options.staleSamples >= 1 && options.staleSamples <= LOAD_LIMITS.maximumSamplesPerGroup, 'staleSamples'],
    [Number.isSafeInteger(options.hotRoomCommits) && options.hotRoomCommits >= 1 && options.hotRoomCommits <= LOAD_LIMITS.maximumHotRoomCommits, 'hotRoomCommits'],
    [Number.isSafeInteger(options.records) && options.records >= 1 && options.records <= LOAD_LIMITS.maximumRecords, 'records'],
    [Number.isSafeInteger(options.points) && options.points >= 1 && options.points <= LOAD_LIMITS.maximumPoints, 'points'],
  ];
  for (const [ok, name] of checks) if (!ok) throw new Error(`LOAD_OPTIONS_OUT_OF_RANGE:${name}`);
}

/**
 * Decide whether two captures may be compared, and only then produce deltas.
 * Everything that changes what the number means is part of the decision.
 */
export function compareLoadReports(previous: ArchitectureLoadReport, current: ArchitectureLoadReport): LoadComparison {
  const reasons: string[] = [];
  const same = (name: string, left: unknown, right: unknown): void => {
    if (left !== right) reasons.push(`${name} differs (${String(left)} vs ${String(right)})`);
  };
  same('sourceFilesSha256', previous.metadata.sourceFilesSha256, current.metadata.sourceFilesSha256);
  same('nodeVersion', previous.metadata.nodeVersion, current.metadata.nodeVersion);
  same('pgliteVersion', previous.metadata.pgliteVersion, current.metadata.pgliteVersion);
  same('platform', previous.metadata.platform, current.metadata.platform);
  same('architecture', previous.metadata.architecture, current.metadata.architecture);
  same('rooms', previous.workload.rooms, current.workload.rooms);
  same('samples', previous.workload.samples, current.workload.samples);
  same('staleSamples', previous.workload.staleSamples, current.workload.staleSamples);
  same('hotRoomCommits', previous.workload.hotRoomCommits, current.workload.hotRoomCommits);
  same('records', previous.workload.records, current.workload.records);
  if (reasons.length > 0) return { comparable: false, reasons, deltas: [] };

  const deltas: LoadDelta[] = [];
  for (let index = 0; index < current.rooms.length; index += 1) {
    const before = previous.rooms[index];
    const after = current.rooms[index];
    if (!before || !after) {
      return { comparable: false, reasons: [`room ${index + 1} missing on one side`], deltas: [] };
    }
    deltas.push({
      metric: `room${index + 1}.successful`,
      previousP50Ms: before.successful.p50,
      currentP50Ms: after.successful.p50,
      previousP95Ms: before.successful.p95,
      currentP95Ms: after.successful.p95,
    });
    deltas.push({
      metric: `room${index + 1}.stale`,
      previousP50Ms: before.stale.p50,
      currentP50Ms: after.stale.p50,
      previousP95Ms: before.stale.p95,
      currentP95Ms: after.stale.p95,
    });
  }
  deltas.push({
    metric: 'hotRoom.successful',
    previousP50Ms: previous.hotRoom.successful.p50,
    currentP50Ms: current.hotRoom.successful.p50,
    previousP95Ms: previous.hotRoom.successful.p95,
    currentP95Ms: current.hotRoom.successful.p95,
  });
  return { comparable: true, reasons: [], deltas };
}

/** The signals this harness cannot observe, stated with the reason instead of being zeroed. */
export function unmeasuredSignals(): UnmeasuredSignals[] {
  return [
    { signal: 'outbox delivery lag', reason: 'the harness never starts the Node outbox dispatcher, so pending rows measure backlog under load, not delivery delay' },
    { signal: 'AI queue wait and job age', reason: 'the Node local runtime has no configured AI provider or model-job queue; that lifecycle exists only in the Cloudflare Room' },
    { signal: 'reservation and queue rejections', reason: 'no provider reservation path is exercised on the Node path' },
    { signal: 'reconnect count', reason: 'no WebSocket session is opened by this direct-authority harness' },
    { signal: 'hosted capacity', reason: 'in-memory PGlite in one process is not D1, Room SQLite, Billing or a Cloudflare isolate' },
  ];
}

async function storagePoint(database: ReturnType<typeof createPGliteDatabase>, commits: number): Promise<StoragePoint> {
  const relations: StoragePoint['relations'] = [];
  let totalRelationBytes = 0;
  for (const table of STORAGE_TABLES) {
    const result = await database.query<{ rows: string; bytes: string }>(
      `SELECT COUNT(*)::bigint AS rows, pg_total_relation_size($1::regclass)::bigint AS bytes FROM ${table.relation}`,
      [table.relation],
    );
    const row = result.rows[0];
    if (!row) throw new Error('LOAD_STORAGE_MEASUREMENT_UNAVAILABLE');
    const rows = Number(row.rows);
    const relationBytes = Number(row.bytes);
    if (!Number.isSafeInteger(rows) || rows < 0 || !Number.isSafeInteger(relationBytes) || relationBytes < 0) {
      throw new Error('LOAD_STORAGE_MEASUREMENT_INVALID');
    }
    relations.push({ table: table.name, rows, relationBytes });
    totalRelationBytes += relationBytes;
  }
  return { commits, totalRelationBytes, relations };
}

async function outboxBacklog(database: ReturnType<typeof createPGliteDatabase>, commits: number): Promise<OutboxBacklog> {
  const pending = await database.query<{ count: string; oldest: string | null }>(
    'SELECT COUNT(*)::bigint AS count, MIN(created_at)::bigint AS oldest FROM outbox WHERE delivered_at IS NULL',
  );
  const delivered = await database.query<{ count: string }>('SELECT COUNT(*)::bigint AS count FROM outbox WHERE delivered_at IS NOT NULL');
  const pendingRows = Number(pending.rows[0]?.count ?? 0);
  const deliveredRows = Number(delivered.rows[0]?.count ?? 0);
  const oldest = pending.rows[0]?.oldest;
  const oldestPendingAgeMs = oldest === null || oldest === undefined ? null : Math.max(0, Date.now() - Number(oldest));
  return {
    pendingRows,
    deliveredRows,
    oldestPendingAgeMs,
    interpretation: `backlog after ${commits} commits with no dispatcher running; not a delivery lag`,
  };
}

export async function runArchitectureLoad(options: LoadOptions): Promise<ArchitectureLoadReport> {
  assertLoadOptions(options);
  const metadata = await sourceMetadata();
  const database = createPGliteDatabase(':memory:');
  const repository = new SqlWorkspaceRepository(database);
  try {
    await migrateDatabase(database, 'local');
    const authority = new CommandAuthority({ repository, identity: repository });

    interface LiveRoom {
      session: Awaited<ReturnType<CommandAuthority['createOrRefreshSession']>>['session'];
      workspace: Awaited<ReturnType<CommandAuthority['createWorkspace']>>;
      successful: number[];
      stale: number[];
      commits: number;
    }

    const rooms: LiveRoom[] = [];
    for (let index = 0; index < options.rooms; index += 1) {
      const sessionResult = await authority.createOrRefreshSession(new IncomingMessage(new Socket()), {
        name: `Synthetic load owner ${index + 1}`,
      });
      let workspace = await authority.createWorkspace(sessionResult.session, {
        kind: 'table',
        title: `Synthetic load room ${index + 1}`,
      });
      const setup: [string, unknown][] = [
        ['evolve.propose', { change: createSyntheticChange(options.records) }],
        ['evolve.simulate', {}],
        ['evolve.validate', {}],
        ['evolve.approve', {}],
        ['evolve.activate', {}],
      ];
      for (const [type, payload] of setup) {
        const envelope: CommandEnvelope = {
          commandId: randomUUID(),
          expectedRevision: workspace.revision,
          expectedEpoch: workspace.epoch,
          type,
          payload,
        };
        const ack: CommandAck = await authority.execute(sessionResult.session, envelope, workspace.id);
        workspace = ack.workspace;
      }
      if (workspace.kind !== 'table' || workspace.domain.kind !== 'table'
          || workspace.domain.records.records?.length !== options.records) {
        throw new Error('LOAD_TABLE_SETUP_FAILED');
      }
      rooms.push({ session: sessionResult.session, workspace, successful: [], stale: [], commits: 0 });
    }

    for (const room of rooms) {
      let staleRevision = room.workspace.revision;
      for (let index = 0; index < options.samples; index += 1) {
        staleRevision = room.workspace.revision;
        const envelope: CommandEnvelope = {
          commandId: randomUUID(),
          expectedRevision: room.workspace.revision,
          expectedEpoch: room.workspace.epoch,
          type: 'table.act',
          payload: { actionId: 'increment', inputs: { record: syntheticRecordId(index % options.records) } },
        };
        const startedAt = performance.now();
        const ack: CommandAck = await authority.execute(room.session, envelope, room.workspace.id);
        room.successful.push(performance.now() - startedAt);
        room.workspace = ack.workspace;
        room.commits += 1;
      }
      for (let index = 0; index < options.staleSamples; index += 1) {
        const envelope: CommandEnvelope = {
          commandId: randomUUID(),
          expectedRevision: staleRevision,
          expectedEpoch: room.workspace.epoch,
          type: 'table.act',
          payload: { actionId: 'increment', inputs: { record: syntheticRecordId(0) } },
        };
        const startedAt = performance.now();
        try {
          await authority.execute(room.session, envelope, room.workspace.id);
          throw new Error('LOAD_STALE_COMMAND_ACCEPTED');
        } catch (error) {
          const durationMs = performance.now() - startedAt;
          if (!(error instanceof AuthorityError) || error.code !== 'STALE_REVISION') throw error;
          room.stale.push(durationMs);
        }
      }
    }

    const totalBeforeHot = rooms.reduce((sum, room) => sum + room.commits, 0);
    const storageCurve: StoragePoint[] = [await storagePoint(database, totalBeforeHot)];
    const hot = rooms[0];
    if (!hot) throw new Error('LOAD_NO_ROOM');
    const hotSuccessful: number[] = [];
    const hotPoints = Math.max(1, Math.min(options.points, Math.max(1, options.hotRoomCommits)));
    let nextPointAt = Math.max(1, Math.ceil(options.hotRoomCommits / hotPoints));
    for (let index = 0; index < options.hotRoomCommits; index += 1) {
      const envelope: CommandEnvelope = {
        commandId: randomUUID(),
        expectedRevision: hot.workspace.revision,
        expectedEpoch: hot.workspace.epoch,
        type: 'table.act',
        payload: { actionId: 'increment', inputs: { record: syntheticRecordId(index % options.records) } },
      };
      const startedAt = performance.now();
      const ack: CommandAck = await authority.execute(hot.session, envelope, hot.workspace.id);
      hotSuccessful.push(performance.now() - startedAt);
      hot.workspace = ack.workspace;
      hot.commits += 1;
      if (index + 1 >= nextPointAt || index + 1 === options.hotRoomCommits) {
        storageCurve.push(await storagePoint(database, rooms.reduce((sum, room) => sum + room.commits, 0)));
        nextPointAt += Math.max(1, Math.ceil(options.hotRoomCommits / hotPoints));
      }
    }

    const totalCommits = rooms.reduce((sum, room) => sum + room.commits, 0);
    if (hotSuccessful.length === 0) storageCurve.push(await storagePoint(database, totalCommits));

    return {
      metadata,
      workload: {
        rooms: options.rooms,
        samples: options.samples,
        staleSamples: options.staleSamples,
        hotRoomCommits: options.hotRoomCommits,
        records: options.records,
        points: options.points,
      },
      measurementScope: MEASUREMENT_SCOPE,
      rooms: rooms.map((room, index) => ({
        index: index + 1,
        committedActions: room.commits,
        successful: latencySummary(room.successful),
        stale: { ...latencySummary(room.stale), expectedErrorCode: 'STALE_REVISION' as const },
      })),
      hotRoom: { index: 1, commits: hotSuccessful.length, successful: latencySummary(hotSuccessful) },
      storageCurve,
      outbox: await outboxBacklog(database, totalCommits),
      unmeasured: unmeasuredSignals(),
    };
  } finally {
    await repository.close();
  }
}

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath !== '' && relativePath !== '..'
    && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !relativePath.startsWith('/');
}

async function writeReport(report: ArchitectureLoadReport): Promise<string> {
  const root = await realpath(repositoryRoot);
  const outputRoot = await ensureBaselineOutputDirectory(root, 'architecture-load');
  const stamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, '-');
  const outputPath = join(outputRoot, `architecture-load-${stamp}-${report.metadata.sourceScriptSha256.slice(0, 12)}.json`);
  if (!isWithin(outputRoot, outputPath)) throw new Error('OUTPUT_PATH_NOT_SAFE');
  if (await realpath(dirname(outputPath)) !== outputRoot) throw new Error('OUTPUT_PATH_NOT_SAFE');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return relative(root, outputPath).replaceAll('\\', '/');
}

async function readPreviousReport(path: string): Promise<ArchitectureLoadReport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new Error('LOAD_COMPARE_UNREADABLE');
  }
  if (typeof parsed !== 'object' || parsed === null) throw new Error('LOAD_COMPARE_INVALID');
  const candidate = parsed as Partial<ArchitectureLoadReport>;
  if (!candidate.metadata || typeof candidate.metadata.sourceFilesSha256 !== 'string'
      || !candidate.workload || !Array.isArray(candidate.rooms) || !candidate.hotRoom) {
    throw new Error('LOAD_COMPARE_INVALID');
  }
  return candidate as ArchitectureLoadReport;
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node --import tsx scripts/architecture-load.ts [options]',
    '',
    `  --rooms <n>             Workspaces to drive (1-${LOAD_LIMITS.maximumRooms}, default ${LOAD_DEFAULTS.rooms})`,
    `  --samples <n>           Timed successful actions per room (1-${LOAD_LIMITS.maximumSamplesPerGroup}, default ${LOAD_DEFAULTS.samples})`,
    `  --stale-samples <n>     Timed stale attempts per room (1-${LOAD_LIMITS.maximumSamplesPerGroup}, default ${LOAD_DEFAULTS.staleSamples})`,
    `  --hot-room-commits <n>  Extra commits on room 1 (1-${LOAD_LIMITS.maximumHotRoomCommits}, default ${LOAD_DEFAULTS.hotRoomCommits})`,
    `  --records <n>           Rows in the synthetic table (default ${LOAD_DEFAULTS.records})`,
    `  --points <n>            Storage-curve samples during the hot room (1-${LOAD_LIMITS.maximumPoints}, default ${LOAD_DEFAULTS.points})`,
    '  --compare <path>        Compare against an earlier report, only when it is comparable',
    '  --help                  Show this help',
    '',
    'Drives the real CommandAuthority and SqlWorkspaceRepository on a fresh in-memory PGlite and',
    'writes one JSON result under ignored test-results/. It never changes infrastructure or',
    'concurrency, and its numbers are not hosted capacity.',
  ].join('\n') + '\n');
}

async function main(): Promise<void> {
  const options = parseLoadOptions(process.argv.slice(2));
  if (options === null) {
    printHelp();
    return;
  }
  const report = await runArchitectureLoad(options);
  const comparison = options.compare ? compareLoadReports(await readPreviousReport(options.compare), report) : null;
  const output = await writeReport(report);
  process.stdout.write(`Architecture load saved to ${output}\n`);
  process.stdout.write(`${JSON.stringify({
    sourceCommit: report.metadata.sourceCommit,
    nodeVersion: report.metadata.nodeVersion,
    workload: report.workload,
    rooms: report.rooms.map(room => ({
      room: room.index,
      successful: { p50Ms: room.successful.p50, p95Ms: room.successful.p95, count: room.successful.count },
      stale: { p50Ms: room.stale.p50, p95Ms: room.stale.p95, count: room.stale.count },
    })),
    hotRoom: {
      commits: report.hotRoom.commits,
      p50Ms: report.hotRoom.successful.p50,
      p95Ms: report.hotRoom.successful.p95,
    },
    storageCurve: report.storageCurve.map(point => ({ commits: point.commits, totalRelationBytes: point.totalRelationBytes })),
    outbox: report.outbox,
    comparison,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof AuthorityError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_:]+$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED_ERROR';
    process.stderr.write(`ARCHITECTURE_LOAD_FAILED ${code}\n`);
    process.exitCode = 1;
  });
}
