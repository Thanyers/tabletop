import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { IncomingMessage } from 'node:http';
import { Socket } from 'node:net';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandAck, CommandEnvelope, WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { TABLE_LIMITS } from '../src/tabletop/domain/table.js';
import type { TableChange } from '../src/tabletop/shared/table-contracts.js';
import { CommandAuthority, type AuthenticatedSession } from '../server/authority.js';
import { createPGliteDatabase, type SqlDatabase } from '../server/database.js';
import { AuthorityError } from '../server/errors.js';
import { migrateDatabase } from '../server/migrations.js';
import { SqlWorkspaceRepository } from '../server/repository.js';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const recordIdWidth = String(TABLE_LIMITS.rowsTotal).length;

export const STORAGE_GROWTH_DEFAULTS = {
  workspaces: 2,
  commitsPerWorkspace: 24,
  recordsPerWorkspace: 20,
  points: 4,
} as const;

export const STORAGE_GROWTH_LIMITS = {
  maximumWorkspaces: 4,
  maximumCommitsPerWorkspace: 200,
  maximumRecordsPerWorkspace: TABLE_LIMITS.rowsPerCollection,
  maximumPoints: 8,
} as const;

export interface StorageGrowthOptions {
  readonly workspaces: number;
  readonly commitsPerWorkspace: number;
  readonly recordsPerWorkspace: number;
  readonly points: number;
}

interface StorageGrowthMetadata {
  readonly generatedAt: string;
  readonly sourceCommit: string;
  readonly sourceScriptSha256: string;
  readonly worktreeDirty: boolean;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly database: 'PGlite in-memory';
  readonly pgliteVersion: string;
}

export interface RelationSample {
  readonly table: string;
  readonly meaning: string;
  readonly rows: number;
  readonly relationBytes: number;
}

export interface StorageGrowthPoint {
  readonly point: number;
  readonly commitsPerWorkspace: number;
  readonly totalCommits: number;
  readonly relations: readonly RelationSample[];
  readonly totalRelationBytes: number;
}

export interface RelationGrowth {
  readonly table: string;
  readonly relationByteDelta: number;
  readonly bytesPerCommit: number;
}

export interface StorageGrowthReport {
  readonly metadata: StorageGrowthMetadata;
  readonly workload: {
    readonly workspaces: number;
    readonly commitsPerWorkspace: number;
    readonly recordsPerWorkspace: number;
    readonly totalCommits: number;
    readonly points: number;
  };
  readonly measurement: {
    readonly byteSource: 'pg_total_relation_size';
    readonly byteUnit: 'bytes';
    readonly includes: string;
    readonly excludes: string;
    readonly capacityClaim: false;
  };
  readonly points: readonly StorageGrowthPoint[];
  readonly growth: {
    readonly fromPoint: number;
    readonly toPoint: number;
    readonly commitDelta: number;
    readonly relationByteDelta: number;
    readonly bytesPerCommit: number;
    readonly relations: readonly RelationGrowth[];
  };
  readonly finalRows: Readonly<Record<string, number>>;
}

interface StorageRelationDefinition {
  readonly name: string;
  readonly meaning: string;
}

interface RelationMeasurementRow extends Record<string, unknown> {
  readonly row_count: number | string;
  readonly relation_bytes: number | string;
}

/** The local adapter's 13 tables (server/schema.sql), in declaration order. */
const STORAGE_RELATIONS: readonly StorageRelationDefinition[] = [
  { name: 'schema_migrations', meaning: 'Applied local schema versions.' },
  { name: 'authority_meta', meaning: 'Singleton authority row (the workspace-count lock).' },
  { name: 'sessions', meaning: 'Guest sessions bound to one actor and at most one workspace.' },
  { name: 'workspaces', meaning: 'Current workspace state rows.' },
  { name: 'memberships', meaning: 'Actor membership, role and seat per workspace epoch.' },
  { name: 'invitations', meaning: 'Single-use invitation tickets.' },
  { name: 'snapshots', meaning: 'Full state snapshot written by workspace creation and every commit.' },
  { name: 'events', meaning: 'Committed domain event rows, one per commit.' },
  { name: 'commands', meaning: 'Idempotency receipts for committed commands.' },
  { name: 'outbox', meaning: 'Undelivered event outbox rows; this workload has no dispatcher.' },
  { name: 'artifact_cleanup', meaning: 'Requested private-object removals for reset or expired workspaces.' },
  { name: 'approvals', meaning: 'Stored activation approvals referenced by a candidate.' },
  { name: 'model_jobs', meaning: 'Durable model-job rows; this workload creates none.' },
];

function boundedInteger(flag: string, rawValue: string | undefined, minimum: number, maximum: number): number {
  if (!rawValue || !/^(0|[1-9]\d*)$/u.test(rawValue)) throw new Error(`INVALID_${flag.toUpperCase().replaceAll('-', '_')}`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`OUT_OF_RANGE_${flag.toUpperCase().replaceAll('-', '_')}`);
  }
  return value;
}

export function parseStorageGrowthOptions(args: readonly string[]): StorageGrowthOptions | null {
  if (args.length === 1 && args[0] === '--help') return null;

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== '--workspaces' && flag !== '--commits' && flag !== '--records' && flag !== '--points') {
      throw new Error('UNKNOWN_OPTION');
    }
    if (values.has(flag)) throw new Error('DUPLICATE_OPTION');
    if (!value || value.startsWith('--')) throw new Error('OPTION_VALUE_REQUIRED');
    values.set(flag, value);
  }

  const options: StorageGrowthOptions = {
    workspaces: values.has('--workspaces')
      ? boundedInteger('workspaces', values.get('--workspaces'), 1, STORAGE_GROWTH_LIMITS.maximumWorkspaces)
      : STORAGE_GROWTH_DEFAULTS.workspaces,
    commitsPerWorkspace: values.has('--commits')
      ? boundedInteger('commits', values.get('--commits'), 1, STORAGE_GROWTH_LIMITS.maximumCommitsPerWorkspace)
      : STORAGE_GROWTH_DEFAULTS.commitsPerWorkspace,
    recordsPerWorkspace: values.has('--records')
      ? boundedInteger('records', values.get('--records'), 1, STORAGE_GROWTH_LIMITS.maximumRecordsPerWorkspace)
      : STORAGE_GROWTH_DEFAULTS.recordsPerWorkspace,
    points: values.has('--points')
      ? boundedInteger('points', values.get('--points'), 2, STORAGE_GROWTH_LIMITS.maximumPoints)
      : STORAGE_GROWTH_DEFAULTS.points,
  };
  if (options.points - 1 > options.commitsPerWorkspace) throw new Error('OUT_OF_RANGE_POINTS');
  return options;
}

/** Commit counts to sample, ending exactly at the requested commit budget. */
export function samplingSteps(commitsPerWorkspace: number, points: number): number[] {
  if (!Number.isSafeInteger(commitsPerWorkspace) || commitsPerWorkspace < 1
    || !Number.isSafeInteger(points) || points < 2 || points - 1 > commitsPerWorkspace) {
    throw new Error('SAMPLING_INPUT_INVALID');
  }
  const steps = Array.from({ length: points }, (_, index) => Math.round((index * commitsPerWorkspace) / (points - 1)));
  for (let index = 1; index < steps.length; index += 1) {
    if (steps[index]! <= steps[index - 1]!) throw new Error('SAMPLING_STEPS_NOT_INCREASING');
  }
  return steps;
}

function syntheticRecordId(index: number): string {
  return `record_${String(index + 1).padStart(recordIdWidth, '0')}`;
}

function createSyntheticChange(recordCount: number): TableChange {
  return {
    kind: 'table',
    program: {
      version: 1,
      title: 'Synthetic storage growth',
      description: 'A bounded local workload for storage-growth measurement.',
      collections: [{
        id: 'records',
        title: 'Synthetic records',
        fields: [
          { id: 'label', label: 'Label', type: 'text', required: true },
          { id: 'count', label: 'Count', type: 'number', required: true },
        ],
      }],
      actions: [{
        id: 'increment',
        title: 'Increment record',
        description: 'Increase one synthetic record count by one.',
        roles: ['owner'],
        parameters: [{ id: 'record', label: 'Record', type: 'record', collection: 'records' }],
        conditions: [],
        effects: [{ record: 'record', field: 'count', op: 'add', value: { literal: 1 } }],
        requireTurn: false,
        advanceTurn: false,
      }],
      invariants: [],
      turnOrder: [],
      evidence: [],
      assumptions: ['All rows and values are synthetic measurement data.'],
    },
    initialRecords: {
      records: Array.from({ length: recordCount }, (_, index) => ({
        id: syntheticRecordId(index),
        values: { label: `Synthetic row ${index + 1}`, count: 0 },
      })),
    },
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

async function sourceMetadata(): Promise<StorageGrowthMetadata> {
  const [{ stdout: sourceCommit }, { stdout: status }, scriptContents, pglitePackageContents] = await Promise.all([
    executeFile('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repositoryRoot, windowsHide: true }),
    executeFile('git', ['status', '--porcelain=v1'], { cwd: repositoryRoot, windowsHide: true }),
    readFile(scriptPath),
    readFile(join(repositoryRoot, 'node_modules', '@electric-sql', 'pglite', 'package.json')),
  ]);
  const pglitePackage: unknown = JSON.parse(pglitePackageContents.toString('utf8'));
  if (typeof pglitePackage !== 'object' || pglitePackage === null || !('version' in pglitePackage)
      || typeof pglitePackage.version !== 'string') {
    throw new Error('PGLITE_VERSION_UNAVAILABLE');
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceCommit: sourceCommit.trim(),
    sourceScriptSha256: createHash('sha256').update(scriptContents).digest('hex'),
    worktreeDirty: Boolean(status.trim()),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    database: 'PGlite in-memory',
    pgliteVersion: pglitePackage.version,
  };
}

async function ensureDirectoryAtPath(path: string): Promise<void> {
  try {
    await mkdir(path);
  } catch (error) {
    if (!hasErrorCode(error, 'EEXIST')) throw error;
  }
  const entry = await lstat(path);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error('OUTPUT_PATH_NOT_SAFE');
}

export async function ensureStorageGrowthOutputDirectory(rootDirectory: string): Promise<string> {
  const root = await realpath(rootDirectory);
  const ignoreRules = await readFile(resolve(root, '.gitignore'), 'utf8');
  if (!ignoreRules.split(/\r?\n/u).includes('test-results/')) throw new Error('OUTPUT_DIRECTORY_NOT_IGNORED');

  const resultsPath = resolve(root, 'test-results');
  await ensureDirectoryAtPath(resultsPath);
  const resultsRoot = await realpath(resultsPath);
  if (relative(root, resultsRoot) !== 'test-results') throw new Error('OUTPUT_PATH_NOT_SAFE');

  const expectedOutputRoot = resolve(resultsRoot, 'storage-growth');
  await ensureDirectoryAtPath(expectedOutputRoot);
  const outputRoot = await realpath(expectedOutputRoot);
  if (relative(root, outputRoot) !== join('test-results', 'storage-growth') || !isWithin(root, outputRoot)) {
    throw new Error('OUTPUT_PATH_NOT_SAFE');
  }
  return outputRoot;
}

async function sampleRelations(database: SqlDatabase): Promise<RelationSample[]> {
  const samples: RelationSample[] = [];
  for (const relation of STORAGE_RELATIONS) {
    const result = await database.query<RelationMeasurementRow>(
      `SELECT COUNT(*)::bigint AS row_count, pg_total_relation_size($1::regclass)::bigint AS relation_bytes
       FROM public.${relation.name}`,
      [`public.${relation.name}`],
    );
    const row = result.rows[0];
    if (!row) throw new Error('STORAGE_MEASUREMENT_UNAVAILABLE');
    const rows = Number(row.row_count);
    const relationBytes = Number(row.relation_bytes);
    if (!Number.isSafeInteger(rows) || rows < 0 || !Number.isSafeInteger(relationBytes) || relationBytes < 0) {
      throw new Error('STORAGE_MEASUREMENT_INVALID');
    }
    samples.push({ table: relation.name, meaning: relation.meaning, rows, relationBytes });
  }
  return samples;
}

interface WorkloadTarget {
  readonly session: AuthenticatedSession;
  workspace: WorkspaceView;
}

function expectedFinalRows(workload: StorageGrowthReport['workload']): Record<string, number> {
  const commands = workload.workspaces * (5 + workload.commitsPerWorkspace);
  return {
    authority_meta: 1,
    sessions: workload.workspaces,
    workspaces: workload.workspaces,
    memberships: workload.workspaces,
    snapshots: commands + workload.workspaces,
    events: commands,
    commands,
    outbox: commands,
    model_jobs: 0,
  };
}

export async function runStorageGrowth(options: StorageGrowthOptions): Promise<StorageGrowthReport> {
  if (!Number.isSafeInteger(options.workspaces) || options.workspaces < 1
      || options.workspaces > STORAGE_GROWTH_LIMITS.maximumWorkspaces
      || !Number.isSafeInteger(options.commitsPerWorkspace) || options.commitsPerWorkspace < 1
      || options.commitsPerWorkspace > STORAGE_GROWTH_LIMITS.maximumCommitsPerWorkspace
      || !Number.isSafeInteger(options.recordsPerWorkspace) || options.recordsPerWorkspace < 1
      || options.recordsPerWorkspace > STORAGE_GROWTH_LIMITS.maximumRecordsPerWorkspace
      || !Number.isSafeInteger(options.points) || options.points < 2
      || options.points > STORAGE_GROWTH_LIMITS.maximumPoints
      || options.points - 1 > options.commitsPerWorkspace) {
    throw new Error('STORAGE_GROWTH_OPTIONS_OUT_OF_RANGE');
  }

  const metadata = await sourceMetadata();
  const database = createPGliteDatabase(':memory:');
  const repository = new SqlWorkspaceRepository(database);
  try {
    await migrateDatabase(database, 'local');
    const authority = new CommandAuthority({ repository, identity: repository });
    const targets: WorkloadTarget[] = [];
    for (let index = 0; index < options.workspaces; index += 1) {
      const created = await authority.createOrRefreshSession(
        new IncomingMessage(new Socket()),
        { name: `Synthetic storage owner ${index + 1}` },
      );
      const target: WorkloadTarget = {
        session: created.session,
        workspace: await authority.createWorkspace(created.session, {
          kind: 'table',
          title: `Synthetic storage workspace ${index + 1}`,
        }),
      };
      const setup: readonly (readonly [string, unknown])[] = [
        ['evolve.propose', { change: createSyntheticChange(options.recordsPerWorkspace) }],
        ['evolve.simulate', {}],
        ['evolve.validate', {}],
        ['evolve.approve', {}],
        ['evolve.activate', {}],
      ];
      for (const [type, payload] of setup) {
        await executeCommand(authority, target, type, payload);
      }
      targets.push(target);
    }

    const workload = {
      workspaces: options.workspaces,
      commitsPerWorkspace: options.commitsPerWorkspace,
      recordsPerWorkspace: options.recordsPerWorkspace,
      totalCommits: options.workspaces * options.commitsPerWorkspace,
      points: options.points,
    } as const;

    const points: StorageGrowthPoint[] = [];
    let completed = 0;
    for (const step of samplingSteps(options.commitsPerWorkspace, options.points)) {
      while (completed < step) {
        for (const target of targets) {
          await executeCommand(authority, target, 'table.act', {
            actionId: 'increment',
            inputs: { record: syntheticRecordId(completed % options.recordsPerWorkspace) },
          });
        }
        completed += 1;
      }
      const relations = await sampleRelations(database);
      points.push({
        point: points.length + 1,
        commitsPerWorkspace: completed,
        totalCommits: completed * options.workspaces,
        relations,
        totalRelationBytes: relations.reduce((total, relation) => total + relation.relationBytes, 0),
      });
    }

    const first = points[0]!;
    const last = points[points.length - 1]!;
    const commitDelta = last.totalCommits - first.totalCommits;
    if (commitDelta <= 0) throw new Error('STORAGE_GROWTH_NO_COMMITS_SAMPLED');
    const relationByteDelta = last.totalRelationBytes - first.totalRelationBytes;
    const firstByTable = new Map(first.relations.map(relation => [relation.table, relation.relationBytes]));
    const growth = {
      fromPoint: first.point,
      toPoint: last.point,
      commitDelta,
      relationByteDelta,
      bytesPerCommit: relationByteDelta / commitDelta,
      relations: last.relations.map(relation => {
        const delta = relation.relationBytes - (firstByTable.get(relation.table) ?? relation.relationBytes);
        return { table: relation.table, relationByteDelta: delta, bytesPerCommit: delta / commitDelta };
      }),
    };

    const finalRows: Record<string, number> = {};
    for (const relation of last.relations) finalRows[relation.table] = relation.rows;
    const expected = expectedFinalRows(workload);
    for (const [table, rows] of Object.entries(expected)) {
      if (finalRows[table] !== rows) throw new Error('STORAGE_GROWTH_INVARIANT_MISMATCH');
    }

    return {
      metadata,
      workload,
      measurement: {
        byteSource: 'pg_total_relation_size',
        byteUnit: 'bytes',
        includes: 'Each relation\'s heap table, its indexes and TOAST storage, as reported by PGlite for this database.',
        excludes: 'Process memory, the whole PGlite database image, WAL, filesystem block allocation and persistence to disk.',
        capacityClaim: false,
      },
      points,
      growth,
      finalRows,
    };
  } finally {
    await repository.close();
  }
}

async function executeCommand(
  authority: CommandAuthority,
  target: WorkloadTarget,
  type: string,
  payload: unknown,
): Promise<void> {
  const envelope: CommandEnvelope = {
    commandId: randomUUID(),
    expectedRevision: target.workspace.revision,
    expectedEpoch: target.workspace.epoch,
    type,
    payload,
  };
  const ack: CommandAck = await authority.execute(target.session, envelope, target.workspace.id);
  if (ack.duplicate || !ack.ok) throw new Error('STORAGE_GROWTH_COMMIT_REJECTED');
  target.workspace = ack.workspace;
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node --import tsx scripts/storage-growth.ts [options]',
    '',
    'Options:',
    `  --workspaces <count>  Synthetic workspaces (1-${STORAGE_GROWTH_LIMITS.maximumWorkspaces}; default ${STORAGE_GROWTH_DEFAULTS.workspaces})`,
    `  --commits <count>     Commits per workspace (1-${STORAGE_GROWTH_LIMITS.maximumCommitsPerWorkspace}; default ${STORAGE_GROWTH_DEFAULTS.commitsPerWorkspace})`,
    `  --records <count>     Records per workspace (1-${STORAGE_GROWTH_LIMITS.maximumRecordsPerWorkspace}; default ${STORAGE_GROWTH_DEFAULTS.recordsPerWorkspace})`,
    `  --points <count>      Measurement points across the commit budget (2-${STORAGE_GROWTH_LIMITS.maximumPoints}; default ${STORAGE_GROWTH_DEFAULTS.points})`,
    '  --help                Show this help',
    '',
    'The workload uses a fresh in-memory PGlite database and writes one JSON result under ignored test-results/.',
    'Relation bytes are pg_total_relation_size values; they are not a capacity claim for hosted storage.',
  ].join('\n') + '\n');
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(relativePath);
}

async function writeReport(report: StorageGrowthReport): Promise<string> {
  const root = await realpath(repositoryRoot);
  const outputRoot = await ensureStorageGrowthOutputDirectory(root);
  const stamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, '-');
  const outputPath = join(outputRoot, `storage-growth-${stamp}-${report.metadata.sourceScriptSha256.slice(0, 12)}.json`);
  if (!isWithin(outputRoot, outputPath)) throw new Error('OUTPUT_PATH_NOT_SAFE');
  if (await realpath(dirname(outputPath)) !== outputRoot) throw new Error('OUTPUT_PATH_NOT_SAFE');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return relative(root, outputPath).replaceAll('\\', '/');
}

async function main(): Promise<void> {
  const options = parseStorageGrowthOptions(process.argv.slice(2));
  if (options === null) {
    printHelp();
    return;
  }
  const report = await runStorageGrowth(options);
  const output = await writeReport(report);
  process.stdout.write(`Storage growth report saved to ${output}\n`);
  process.stdout.write(`${JSON.stringify({
    sourceCommit: report.metadata.sourceCommit,
    nodeVersion: report.metadata.nodeVersion,
    workload: report.workload,
    measurement: {
      byteSource: report.measurement.byteSource,
      capacityClaim: report.measurement.capacityClaim,
    },
    points: report.points.map(point => ({
      point: point.point,
      commitsPerWorkspace: point.commitsPerWorkspace,
      totalCommits: point.totalCommits,
      totalRelationBytes: point.totalRelationBytes,
      rows: Object.fromEntries(point.relations.map(relation => [relation.table, relation.rows])),
    })),
    growth: {
      commitDelta: report.growth.commitDelta,
      relationByteDelta: report.growth.relationByteDelta,
      bytesPerCommit: report.growth.bytesPerCommit,
      relations: report.growth.relations,
    },
    finalRows: report.finalRows,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof AuthorityError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED_ERROR';
    process.stderr.write(`STORAGE_GROWTH_FAILED ${code}\n`);
    process.exitCode = 1;
  });
}
