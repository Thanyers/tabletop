import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp, mkdir, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import {
  BASELINE_LIMITS,
  ensureBaselineOutputDirectory,
  parseBaselineOptions,
  percentile,
  runArchitectureBaseline,
} from '../scripts/architecture-baseline.js';

describe('disposable architecture baseline', () => {
  it('uses nearest-rank percentiles and rejects out-of-range workload counts', async () => {
    expect(percentile([9, 1, 5, 3], 0.5)).toBe(3);
    expect(percentile([9, 1, 5, 3], 0.95)).toBe(9);
    expect(parseBaselineOptions(['--records', '100', '--samples', '10', '--stale-samples', '5'])).toEqual({
      records: 100,
      successfulSamples: 10,
      staleSamples: 5,
    });
    expect(parseBaselineOptions(['--records', String(BASELINE_LIMITS.maximumRecords)])?.records)
      .toBe(BASELINE_LIMITS.maximumRecords);
    expect(() => parseBaselineOptions(['--records', '101'])).toThrow('OUT_OF_RANGE_RECORDS');
    expect(() => parseBaselineOptions(['--samples', String(BASELINE_LIMITS.maximumSamplesPerGroup + 1)]))
      .toThrow('OUT_OF_RANGE_SAMPLES');
    await expect(runArchitectureBaseline({ records: 101, successfulSamples: 1, staleSamples: 1 }))
      .rejects.toThrow('BASELINE_OPTIONS_OUT_OF_RANGE');
  });

  it.each(['test-results', 'architecture-baseline'])(
    'rejects a %s output junction before creating files outside the repository root',
    async junctionName => {
      const temporaryRoot = await mkdtemp(join(tmpdir(), 'architecture-baseline-path-'));
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
          await symlink(externalDirectory, join(resultsDirectory, 'architecture-baseline'), 'junction');
        }
        await expect(ensureBaselineOutputDirectory(repositoryRoot)).rejects.toThrow('OUTPUT_PATH_NOT_SAFE');
        expect(await readdir(externalDirectory)).toEqual([]);
      } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    },
  );

  it('measures successful and stale commands separately against isolated PGlite', async () => {
    const report = await runArchitectureBaseline({ records: 8, successfulSamples: 4, staleSamples: 3 });

    expect(report.metadata.database).toBe('PGlite in-memory');
    expect(report.metadata.pgliteVersion).toMatch(/^\d+\.\d+\.\d+(?:[-+].*)?$/u);
    expect(report.metadata.sourceCommit).toMatch(/^[a-f0-9]{40}$/u);
    expect(report.metadata.sourceScriptSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(report.setupCommands.map(sample => sample.commandType)).toEqual([
      'evolve.propose', 'evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate',
    ]);
    expect(report.measurements.successfulActions.samples).toHaveLength(4);
    expect(report.measurements.staleActions.samples).toHaveLength(3);
    expect(report.measurements.staleActions.expectedErrorCode).toBe('STALE_REVISION');
    expect(report.measurements.successfulActions.p50).toBeLessThanOrEqual(report.measurements.successfulActions.p95);
    expect(report.measurements.staleActions.p50).toBeLessThanOrEqual(report.measurements.staleActions.p95);

    const storage = new Map(report.storage.map(table => [table.table, table]));
    expect(storage.get('workspaces')).toMatchObject({ rows: 1 });
    expect(storage.get('snapshots')?.rows).toBe((storage.get('commands')?.rows ?? 0) + 1);
    expect(storage.get('events')?.rows).toBe(storage.get('commands')?.rows);
    expect(storage.get('outbox')?.rows).toBe(storage.get('commands')?.rows);
    expect(storage.get('commands')?.rows).toBe(report.setupCommands.length + report.measurements.successfulActions.count);
    expect(storage.get('model_jobs')).toMatchObject({ rows: 0 });
    expect(report.storage.every(table => table.byteUnit === 'bytes' && table.relationBytes > 0)).toBe(true);
  });
});
