import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  STORAGE_GROWTH_DEFAULTS,
  STORAGE_GROWTH_LIMITS,
  ensureStorageGrowthOutputDirectory,
  parseStorageGrowthOptions,
  runStorageGrowth,
  samplingSteps,
} from '../scripts/storage-growth.js';

describe('disposable storage growth measurement', () => {
  it('uses documented defaults, bounded flags and increasing sampling steps', () => {
    expect(parseStorageGrowthOptions([])).toEqual(STORAGE_GROWTH_DEFAULTS);
    expect(parseStorageGrowthOptions(['--help'])).toBeNull();
    expect(parseStorageGrowthOptions(['--workspaces', '3', '--commits', '10', '--records', '5', '--points', '4']))
      .toEqual({ workspaces: 3, commitsPerWorkspace: 10, recordsPerWorkspace: 5, points: 4 });

    expect(() => parseStorageGrowthOptions(['--workspaces', String(STORAGE_GROWTH_LIMITS.maximumWorkspaces + 1)]))
      .toThrow('OUT_OF_RANGE_WORKSPACES');
    expect(() => parseStorageGrowthOptions(['--commits', '0'])).toThrow('OUT_OF_RANGE_COMMITS');
    expect(() => parseStorageGrowthOptions(['--records', String(STORAGE_GROWTH_LIMITS.maximumRecordsPerWorkspace + 1)]))
      .toThrow('OUT_OF_RANGE_RECORDS');
    expect(() => parseStorageGrowthOptions(['--points', '1'])).toThrow('OUT_OF_RANGE_POINTS');
    expect(() => parseStorageGrowthOptions(['--commits', '2', '--points', '4'])).toThrow('OUT_OF_RANGE_POINTS');
    expect(() => parseStorageGrowthOptions(['--unknown', '1'])).toThrow('UNKNOWN_OPTION');
    expect(() => parseStorageGrowthOptions(['--commits', '1', '--commits', '2'])).toThrow('DUPLICATE_OPTION');
    expect(() => parseStorageGrowthOptions(['--commits'])).toThrow('OPTION_VALUE_REQUIRED');

    expect(samplingSteps(24, 4)).toEqual([0, 8, 16, 24]);
    expect(samplingSteps(4, 3)).toEqual([0, 2, 4]);
    expect(() => samplingSteps(1, 3)).toThrow('SAMPLING_INPUT_INVALID');
  });

  it.each(['test-results', 'storage-growth'])(
    'rejects a %s output junction before writing outside the repository root',
    async junctionName => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'storage-growth-path-'));
      const repositoryRoot = join(temporaryRoot, 'repo');
      const externalDirectory = join(temporaryRoot, 'external');
      try {
        await Promise.all([mkdir(repositoryRoot), mkdir(externalDirectory)]);
        await writeFile(join(repositoryRoot, '.gitignore'), 'test-results/\n', 'utf8');
        const resultsDirectory = join(repositoryRoot, 'test-results');
        if (junctionName === 'test-results') {
          await symlink(externalDirectory, resultsDirectory, 'junction');
        } else {
          await mkdir(resultsDirectory);
          await symlink(externalDirectory, join(resultsDirectory, 'storage-growth'), 'junction');
        }
        await expect(ensureStorageGrowthOutputDirectory(repositoryRoot)).rejects.toThrow('OUTPUT_PATH_NOT_SAFE');
        expect(await readdir(externalDirectory)).toEqual([]);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it('measures relation bytes and row counts at several commit points across two workspaces', async () => {
    const report = await runStorageGrowth({
      workspaces: 2,
      commitsPerWorkspace: 4,
      recordsPerWorkspace: 4,
      points: 3,
    });

    expect(report.metadata.database).toBe('PGlite in-memory');
    expect(report.metadata.pgliteVersion).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/u);
    expect(report.metadata.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(report.metadata.sourceScriptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.workload).toMatchObject({
      workspaces: 2,
      commitsPerWorkspace: 4,
      recordsPerWorkspace: 4,
      totalCommits: 8,
      points: 3,
    });
    expect(report.measurement).toMatchObject({
      byteSource: 'pg_total_relation_size',
      byteUnit: 'bytes',
      capacityClaim: false,
    });
    expect(report.measurement.excludes).toContain('WAL');

    expect(report.points.map(point => point.commitsPerWorkspace)).toEqual([0, 2, 4]);
    expect(report.points.map(point => point.totalCommits)).toEqual([0, 4, 8]);
    expect(report.points.every(point => point.relations.length === 13)).toBe(true);
    expect(report.points.every(point => point.relations.every(relation => relation.meaning.length > 0
      && relation.relationBytes >= 0 && Number.isSafeInteger(relation.rows)))).toBe(true);
    for (let index = 1; index < report.points.length; index += 1) {
      expect(report.points[index]!.totalRelationBytes).toBeGreaterThanOrEqual(report.points[index - 1]!.totalRelationBytes);
    }

    // Growth model: every commit adds one snapshot, event, receipt and outbox row; creation adds one snapshot.
    expect(report.finalRows).toMatchObject({
      authority_meta: 1,
      sessions: 2,
      workspaces: 2,
      memberships: 2,
      snapshots: 20,
      events: 18,
      commands: 18,
      outbox: 18,
      model_jobs: 0,
    });

    const first = report.points[0]!;
    const last = report.points[report.points.length - 1]!;
    const snapshots = (point: typeof last) => point.relations.find(relation => relation.table === 'snapshots')!.relationBytes;
    expect(snapshots(last)).toBeGreaterThan(snapshots(first));
    expect(report.growth).toMatchObject({ fromPoint: 1, toPoint: 3, commitDelta: 8 });
    expect(report.growth.bytesPerCommit).toBeGreaterThan(0);
    expect(report.growth.relations.find(relation => relation.table === 'snapshots')?.relationByteDelta)
      .toBeGreaterThan(0);
  });

  it('rejects an out-of-range workload before opening a database', async () => {
    await expect(runStorageGrowth({ workspaces: 5, commitsPerWorkspace: 1, recordsPerWorkspace: 1, points: 2 }))
      .rejects.toThrow('STORAGE_GROWTH_OPTIONS_OUT_OF_RANGE');
  });
});
