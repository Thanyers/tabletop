import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { IncomingMessage } from 'node:http';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Socket } from 'node:net';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CommandAck, CommandEnvelope } from '../src/tabletop/shared/contracts.js';
import { TABLE_LIMITS } from '../src/tabletop/domain/table.js';
import type { TableChange } from '../src/tabletop/shared/table-contracts.js';
import { CommandAuthority } from '../server/authority.js';
import { createPGliteDatabase } from '../server/database.js';
import { AuthorityError } from '../server/errors.js';
import { migrateDatabase } from '../server/migrations.js';
import { SqlWorkspaceRepository } from '../server/repository.js';

const executeFile = promisify(execFile);
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = fileURLToPath(import.meta.url);
const recordIdWidth = String(TABLE_LIMITS.rowsTotal).length;
const sourcePathLengthBytes = 4;
const sourceContentLengthBytes = 8;

export const BASELINE_DEFAULTS = {
  records: 100,
  successfulSamples: 40,
  staleSamples: 20,
} as const;

export const BASELINE_LIMITS = {
  maximumRecords: TABLE_LIMITS.rowsPerCollection,
  maximumSamplesPerGroup: 500,
} as const;

export interface BaselineOptions {
  readonly records: number;
  readonly successfulSamples: number;
  readonly staleSamples: number;
}

export interface SourceMetadata {
  readonly generatedAt: string;
  readonly sourceCommit: string;
  readonly sourceScriptSha256: string;
  readonly sourceFilesSha256: string;
  readonly sourceFileCount: number;
  readonly sourceFilesScope: string;
  readonly worktreeDirty: boolean;
  readonly nodeVersion: string;
  readonly platform: string;
  readonly architecture: string;
  readonly database: 'PGlite in-memory';
  readonly pgliteVersion: string;
}

export interface LatencySummary {
  readonly count: number;
  readonly unit: 'ms';
  readonly percentileMethod: 'nearest-rank';
  readonly p50: number;
  readonly p95: number;
  readonly samples: readonly number[];
}

interface SetupSample {
  readonly commandType: string;
  readonly durationMs: number;
}

interface StorageMeasurement {
  readonly table: string;
  readonly meaning: string;
  readonly rows: number;
  readonly relationBytes: number;
  readonly byteUnit: 'bytes';
}

export interface ArchitectureBaselineReport {
  readonly metadata: SourceMetadata;
  readonly workload: {
    readonly records: number;
    readonly successfulSamples: number;
    readonly staleSamples: number;
  };
  readonly setupCommands: readonly SetupSample[];
  readonly measurements: {
    readonly successfulActions: LatencySummary & { readonly operation: 'table.act' };
    readonly staleActions: LatencySummary & {
      readonly operation: 'table.act';
      readonly expectedErrorCode: 'STALE_REVISION';
    };
  };
  readonly storage: readonly StorageMeasurement[];
}

export interface StorageTableDefinition {
  readonly name: string;
  readonly relation: `public.${string}`;
  readonly meaning: string;
}

interface RelationMeasurementRow extends Record<string, unknown> {
  readonly row_count: number | string;
  readonly relation_bytes: number | string;
}

export const STORAGE_TABLES: readonly StorageTableDefinition[] = [
  { name: 'workspaces', relation: 'public.workspaces', meaning: 'Current workspace state rows.' },
  { name: 'snapshots', relation: 'public.snapshots', meaning: 'Stored state snapshots, one per committed revision.' },
  { name: 'events', relation: 'public.events', meaning: 'Committed domain event rows.' },
  { name: 'commands', relation: 'public.commands', meaning: 'Idempotency receipts for committed commands.' },
  { name: 'outbox', relation: 'public.outbox', meaning: 'Undelivered event outbox rows in this direct-authority workload.' },
  { name: 'model_jobs', relation: 'public.model_jobs', meaning: 'Durable model-job rows; this workload creates none.' },
];

const SOURCE_FILES_SCOPE = 'tracked and non-ignored untracked .ts/.tsx under src/tabletop and server, excluding credential-named files, declarations, generated outputs, and vendored sources; scripts/architecture-baseline.ts; package.json; package-lock.json';

interface SourceFileContent {
  readonly path: string;
  readonly content: Buffer;
}

function boundedInteger(flag: string, rawValue: string | undefined, minimum: number, maximum: number): number {
  if (!rawValue || !/^(0|[1-9]\d*)$/u.test(rawValue)) throw new Error(`INVALID_${flag.toUpperCase().replaceAll('-', '_')}`);
  const value = Number(rawValue);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`OUT_OF_RANGE_${flag.toUpperCase().replaceAll('-', '_')}`);
  }
  return value;
}

export function parseBaselineOptions(args: readonly string[]): BaselineOptions | null {
  if (args.length === 1 && args[0] === '--help') return null;

  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== '--records' && flag !== '--samples' && flag !== '--stale-samples') {
      throw new Error('UNKNOWN_OPTION');
    }
    if (values.has(flag)) throw new Error('DUPLICATE_OPTION');
    if (!value || value.startsWith('--')) throw new Error('OPTION_VALUE_REQUIRED');
    values.set(flag, value);
  }

  return {
    records: values.has('--records')
      ? boundedInteger('records', values.get('--records'), 1, BASELINE_LIMITS.maximumRecords)
      : BASELINE_DEFAULTS.records,
    successfulSamples: values.has('--samples')
      ? boundedInteger('samples', values.get('--samples'), 1, BASELINE_LIMITS.maximumSamplesPerGroup)
      : BASELINE_DEFAULTS.successfulSamples,
    staleSamples: values.has('--stale-samples')
      ? boundedInteger('stale-samples', values.get('--stale-samples'), 1, BASELINE_LIMITS.maximumSamplesPerGroup)
      : BASELINE_DEFAULTS.staleSamples,
  };
}

export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0 || !Number.isFinite(fraction) || fraction <= 0 || fraction > 1) {
    throw new Error('PERCENTILE_INPUT_INVALID');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return sorted[Math.ceil(fraction * sorted.length) - 1]!;
}

export function latencySummary(samples: readonly number[]): LatencySummary {
  return {
    count: samples.length,
    unit: 'ms',
    percentileMethod: 'nearest-rank',
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    samples,
  };
}

export function syntheticRecordId(index: number): string {
  return `record_${String(index + 1).padStart(recordIdWidth, '0')}`;
}

export function createSyntheticChange(recordCount: number): TableChange {
  return {
    kind: 'table',
    program: {
      version: 1,
      title: 'Synthetic authority baseline',
      description: 'A bounded local workload for authority and SQL storage measurement.',
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
      assumptions: ['All rows and values are synthetic benchmark data.'],
    },
    initialRecords: {
      records: Array.from({ length: recordCount }, (_, index) => ({
        id: syntheticRecordId(index),
        values: { label: `Synthetic row ${index + 1}`, count: 0 },
      })),
    },
  };
}

function isSourceFilePath(path: string): boolean {
  const normalized = path.replaceAll('\\', '/');
  const inApplicationSource = /^(?:src\/tabletop|server)\/.+\.tsx?$/u.test(normalized)
    && !normalized.endsWith('.d.ts');
  const isBaselineSource = normalized === 'scripts/architecture-baseline.ts';
  const isPackageManifest = normalized === 'package.json' || normalized === 'package-lock.json';
  const isGeneratedArtifact = /(?:^|\/)(?:dist|build|coverage|test-results|generated|vendor|third_party|third-party)(?:\/|$)/iu.test(normalized)
    || /(?:\.generated|\.gen)\.tsx?$/iu.test(normalized);
  const isCredentialMaterial = /(?:^|\/)(?:\.env(?:\..*)?|credentials?(?:\.[^/]*)?|secrets?(?:\.[^/]*)?)(?:\/|$)/iu.test(normalized);
  return (inApplicationSource || isBaselineSource || isPackageManifest) && !isGeneratedArtifact && !isCredentialMaterial;
}

async function sourceFiles(): Promise<SourceFileContent[]> {
  const { stdout: listedPaths } = await executeFile('git', [
    'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
    'src/tabletop', 'server', 'scripts/architecture-baseline.ts', 'package.json', 'package-lock.json',
  ], { cwd: repositoryRoot, windowsHide: true });
  const paths = [...new Set(listedPaths.split('\0').filter(isSourceFilePath))].sort();
  const files: SourceFileContent[] = [];
  for (const path of paths) {
    const absolutePath = resolve(repositoryRoot, path);
    if (!isWithin(repositoryRoot, absolutePath)) throw new Error('SOURCE_FINGERPRINT_PATH_INVALID');
    let entry;
    try {
      entry = await lstat(absolutePath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) continue;
      throw error;
    }
    if (entry.isSymbolicLink()) throw new Error('SOURCE_FINGERPRINT_SYMLINK_UNSUPPORTED');
    if (entry.isFile()) files.push({ path, content: await readFile(absolutePath) });
  }
  if (!files.some(file => file.path === 'scripts/architecture-baseline.ts')
      || !files.some(file => file.path === 'package.json')
      || !files.some(file => file.path === 'package-lock.json')) {
    throw new Error('SOURCE_FINGERPRINT_INPUTS_UNAVAILABLE');
  }
  return files;
}

export async function sourceMetadata(): Promise<SourceMetadata> {
  const [{ stdout: sourceCommit }, { stdout: status }, sourceContents, scriptContents, pglitePackageContents] = await Promise.all([
    executeFile('git', ['rev-parse', '--verify', 'HEAD'], { cwd: repositoryRoot, windowsHide: true }),
    executeFile('git', ['status', '--porcelain=v1'], { cwd: repositoryRoot, windowsHide: true }),
    sourceFiles(),
    readFile(scriptPath),
    readFile(join(repositoryRoot, 'node_modules', '@electric-sql', 'pglite', 'package.json')),
  ]);
  const sourceHash = createHash('sha256').update('architecture-baseline-source-v1\0');
  for (const file of sourceContents) {
    const pathBytes = Buffer.from(file.path, 'utf8');
    const pathLength = Buffer.alloc(sourcePathLengthBytes);
    pathLength.writeUInt32BE(pathBytes.length);
    const contentLength = Buffer.alloc(sourceContentLengthBytes);
    contentLength.writeBigUInt64BE(BigInt(file.content.length));
    sourceHash.update(pathLength).update(pathBytes).update(contentLength).update(file.content);
  }
  const pglitePackage: unknown = JSON.parse(pglitePackageContents.toString('utf8'));
  if (typeof pglitePackage !== 'object' || pglitePackage === null || !('version' in pglitePackage)
      || typeof pglitePackage.version !== 'string') {
    throw new Error('PGLITE_VERSION_UNAVAILABLE');
  }
  return {
    generatedAt: new Date().toISOString(),
    sourceCommit: sourceCommit.trim(),
    sourceScriptSha256: createHash('sha256').update(scriptContents).digest('hex'),
    sourceFilesSha256: sourceHash.digest('hex'),
    sourceFileCount: sourceContents.length,
    sourceFilesScope: SOURCE_FILES_SCOPE,
    worktreeDirty: Boolean(status.trim()),
    nodeVersion: process.version,
    platform: process.platform,
    architecture: process.arch,
    database: 'PGlite in-memory',
    pgliteVersion: pglitePackage.version,
  };
}

function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
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

export async function ensureBaselineOutputDirectory(rootDirectory: string, subdirectory = 'architecture-baseline'): Promise<string> {
  const root = await realpath(rootDirectory);
  const ignoreRules = await readFile(resolve(root, '.gitignore'), 'utf8');
  if (!ignoreRules.split(/\r?\n/u).includes('test-results/')) throw new Error('OUTPUT_DIRECTORY_NOT_IGNORED');

  const resultsPath = resolve(root, 'test-results');
  await ensureDirectoryAtPath(resultsPath);
  const resultsRoot = await realpath(resultsPath);
  if (relative(root, resultsRoot) !== 'test-results') throw new Error('OUTPUT_PATH_NOT_SAFE');

  const expectedOutputRoot = resolve(resultsRoot, subdirectory);
  await ensureDirectoryAtPath(expectedOutputRoot);
  const outputRoot = await realpath(expectedOutputRoot);
  if (relative(root, outputRoot) !== join('test-results', subdirectory) || !isWithin(root, outputRoot)) {
    throw new Error('OUTPUT_PATH_NOT_SAFE');
  }
  return outputRoot;
}

async function storageMeasurements(database: ReturnType<typeof createPGliteDatabase>): Promise<StorageMeasurement[]> {
  const measurements: StorageMeasurement[] = [];
  for (const table of STORAGE_TABLES) {
    const result = await database.query<RelationMeasurementRow>(
      `SELECT COUNT(*)::bigint AS row_count, pg_total_relation_size($1::regclass)::bigint AS relation_bytes FROM ${table.relation}`,
      [table.relation],
    );
    const row = result.rows[0];
    if (!row) throw new Error('STORAGE_MEASUREMENT_UNAVAILABLE');
    const rows = Number(row.row_count);
    const relationBytes = Number(row.relation_bytes);
    if (!Number.isSafeInteger(rows) || rows < 0 || !Number.isSafeInteger(relationBytes) || relationBytes < 0) {
      throw new Error('STORAGE_MEASUREMENT_INVALID');
    }
    measurements.push({ table: table.name, meaning: table.meaning, rows, relationBytes, byteUnit: 'bytes' });
  }
  return measurements;
}

export async function runArchitectureBaseline(options: BaselineOptions): Promise<ArchitectureBaselineReport> {
  if (!Number.isSafeInteger(options.records) || options.records < 1 || options.records > BASELINE_LIMITS.maximumRecords
      || !Number.isSafeInteger(options.successfulSamples) || options.successfulSamples < 1
      || options.successfulSamples > BASELINE_LIMITS.maximumSamplesPerGroup
      || !Number.isSafeInteger(options.staleSamples) || options.staleSamples < 1
      || options.staleSamples > BASELINE_LIMITS.maximumSamplesPerGroup) {
    throw new Error('BASELINE_OPTIONS_OUT_OF_RANGE');
  }

  const metadata = await sourceMetadata();
  const database = createPGliteDatabase(':memory:');
  const repository = new SqlWorkspaceRepository(database);
  try {
    await migrateDatabase(database, 'local');
    const authority = new CommandAuthority({ repository });
    const sessionResult = await authority.createOrRefreshSession(new IncomingMessage(new Socket()), { name: 'Synthetic baseline owner' });
    let workspace = await authority.createWorkspace(sessionResult.session, {
      kind: 'table',
      title: 'Synthetic local architecture baseline',
    });
    const setupCommands: SetupSample[] = [];
    const runSetupCommand = async (commandType: string, payload: unknown): Promise<void> => {
      const envelope: CommandEnvelope = {
        commandId: randomUUID(),
        expectedRevision: workspace.revision,
        expectedEpoch: workspace.epoch,
        type: commandType,
        payload,
      };
      const startedAt = performance.now();
      const ack: CommandAck = await authority.execute(sessionResult.session, envelope, workspace.id);
      setupCommands.push({ commandType, durationMs: performance.now() - startedAt });
      workspace = ack.workspace;
    };

    await runSetupCommand('evolve.propose', { change: createSyntheticChange(options.records) });
    await runSetupCommand('evolve.simulate', {});
    await runSetupCommand('evolve.validate', {});
    await runSetupCommand('evolve.approve', {});
    await runSetupCommand('evolve.activate', {});

    if (workspace.kind !== 'table' || workspace.domain.kind !== 'table'
        || workspace.domain.records.records?.length !== options.records) {
      throw new Error('SYNTHETIC_TABLE_SETUP_FAILED');
    }

    const successSamples: number[] = [];
    let staleRevision = workspace.revision;
    for (let index = 0; index < options.successfulSamples; index += 1) {
      staleRevision = workspace.revision;
      const recordId = syntheticRecordId(index % options.records);
      const envelope: CommandEnvelope = {
        commandId: randomUUID(),
        expectedRevision: workspace.revision,
        expectedEpoch: workspace.epoch,
        type: 'table.act',
        payload: { actionId: 'increment', inputs: { record: recordId } },
      };
      const startedAt = performance.now();
      const ack = await authority.execute(sessionResult.session, envelope, workspace.id);
      successSamples.push(performance.now() - startedAt);
      workspace = ack.workspace;
    }

    const staleSamples: number[] = [];
    for (let index = 0; index < options.staleSamples; index += 1) {
      const envelope: CommandEnvelope = {
        commandId: randomUUID(),
        expectedRevision: staleRevision,
        expectedEpoch: workspace.epoch,
        type: 'table.act',
        payload: { actionId: 'increment', inputs: { record: syntheticRecordId(0) } },
      };
      const startedAt = performance.now();
      try {
        await authority.execute(sessionResult.session, envelope, workspace.id);
        throw new Error('STALE_COMMAND_ACCEPTED');
      } catch (error) {
        const durationMs = performance.now() - startedAt;
        if (!(error instanceof AuthorityError) || error.code !== 'STALE_REVISION') throw error;
        staleSamples.push(durationMs);
      }
    }

    return {
      metadata,
      workload: {
        records: options.records,
        successfulSamples: options.successfulSamples,
        staleSamples: options.staleSamples,
      },
      setupCommands,
      measurements: {
        successfulActions: {
          operation: 'table.act',
          ...latencySummary(successSamples),
        },
        staleActions: {
          operation: 'table.act',
          expectedErrorCode: 'STALE_REVISION',
          ...latencySummary(staleSamples),
        },
      },
      storage: await storageMeasurements(database),
    };
  } finally {
    await repository.close();
  }
}

function printHelp(): void {
  process.stdout.write([
    'Usage: node --import tsx scripts/architecture-baseline.ts [options]',
    '',
    'Options:',
    `  --records <count>       Synthetic records (1-${BASELINE_LIMITS.maximumRecords}; default ${BASELINE_DEFAULTS.records})`,
    `  --samples <count>       Successful table.act samples (1-${BASELINE_LIMITS.maximumSamplesPerGroup}; default ${BASELINE_DEFAULTS.successfulSamples})`,
    `  --stale-samples <count> Stale-revision table.act samples (1-${BASELINE_LIMITS.maximumSamplesPerGroup}; default ${BASELINE_DEFAULTS.staleSamples})`,
    '  --help                  Show this help',
    '',
    'The workload uses a fresh in-memory PGlite database and writes one JSON result under ignored test-results/.',
  ].join('\n') + '\n');
}

function isWithin(parent: string, child: string): boolean {
  const relativePath = relative(parent, child);
  return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    && !isAbsolute(relativePath);
}

async function writeReport(report: ArchitectureBaselineReport): Promise<string> {
  const root = await realpath(repositoryRoot);
  const outputRoot = await ensureBaselineOutputDirectory(root);
  const stamp = report.metadata.generatedAt.replaceAll(/[:.]/gu, '-');
  const outputPath = join(outputRoot, `architecture-baseline-${stamp}-${report.metadata.sourceScriptSha256.slice(0, 12)}.json`);
  if (!isWithin(outputRoot, outputPath)) throw new Error('OUTPUT_PATH_NOT_SAFE');
  if (await realpath(dirname(outputPath)) !== outputRoot) throw new Error('OUTPUT_PATH_NOT_SAFE');
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return relative(root, outputPath).replaceAll('\\', '/');
}

async function main(): Promise<void> {
  const options = parseBaselineOptions(process.argv.slice(2));
  if (options === null) {
    printHelp();
    return;
  }
  const report = await runArchitectureBaseline(options);
  const output = await writeReport(report);
  process.stdout.write(`Architecture baseline saved to ${output}\n`);
  process.stdout.write(`${JSON.stringify({
    sourceCommit: report.metadata.sourceCommit,
    nodeVersion: report.metadata.nodeVersion,
    workload: report.workload,
    successfulActions: {
      p50Ms: report.measurements.successfulActions.p50,
      p95Ms: report.measurements.successfulActions.p95,
    },
    staleActions: {
      p50Ms: report.measurements.staleActions.p50,
      p95Ms: report.measurements.staleActions.p95,
      errorCode: report.measurements.staleActions.expectedErrorCode,
    },
    storage: report.storage,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const code = error instanceof AuthorityError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : 'UNEXPECTED_ERROR';
    process.stderr.write(`ARCHITECTURE_BASELINE_FAILED ${code}\n`);
    process.exitCode = 1;
  });
}
