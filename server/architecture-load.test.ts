import { describe, expect, it } from 'vitest';
import {
  LOAD_DEFAULTS,
  LOAD_LIMITS,
  assertLoadOptions,
  compareLoadReports,
  parseLoadOptions,
  runArchitectureLoad,
  type ArchitectureLoadReport,
} from '../scripts/architecture-load.js';

/**
 * F078-T9: the load harness must be bounded, and it must refuse to show a delta when the two
 * captures are not comparable. Those are the two properties worth pinning before any number.
 */

const smallRun = {
  rooms: 1,
  samples: 2,
  staleSamples: 1,
  hotRoomCommits: 2,
  records: 4,
  points: 1,
} as const;

describe('load harness options', () => {
  it('defaults and help', () => {
    expect(parseLoadOptions([])).toEqual(LOAD_DEFAULTS);
    expect(parseLoadOptions(['--help'])).toBeNull();
    expect(parseLoadOptions(['-h'])).toBeNull();
    expect(parseLoadOptions(['--rooms', '3', '--samples=4'])).toMatchObject({ rooms: 3, samples: 4 });
    expect(parseLoadOptions(['--compare', 'capture.json'])).toMatchObject({ compare: 'capture.json' });
  });

  it('rejects unknown, duplicated and out-of-range flags', () => {
    expect(() => parseLoadOptions(['--nope'])).toThrow('UNKNOWN_OPTION');
    expect(() => parseLoadOptions(['--rooms', '1', '--rooms', '2'])).toThrow('DUPLICATE_OPTION');
    expect(() => parseLoadOptions(['--rooms'])).toThrow('OPTION_VALUE_REQUIRED');
    expect(() => parseLoadOptions(['--rooms', '0'])).toThrow('OUT_OF_RANGE_ROOMS');
    expect(() => parseLoadOptions([`--rooms`, String(LOAD_LIMITS.maximumRooms + 1)])).toThrow('OUT_OF_RANGE_ROOMS');
    expect(() => parseLoadOptions(['--stale-samples', '0'])).toThrow('OUT_OF_RANGE_STALE_SAMPLES');
    expect(() => parseLoadOptions(['--rooms', 'abc'])).toThrow('INVALID_ROOMS');
  });

  it('bounds a direct API call as well, not only the CLI', () => {
    expect(() => assertLoadOptions({ ...smallRun, rooms: 0 })).toThrow('LOAD_OPTIONS_OUT_OF_RANGE:rooms');
    expect(() => assertLoadOptions({ ...smallRun, points: LOAD_LIMITS.maximumPoints + 1 })).toThrow('LOAD_OPTIONS_OUT_OF_RANGE:points');
    expect(() => assertLoadOptions({ ...smallRun })).not.toThrow();
  });
});

describe('load comparison', () => {
  function stub(overrides: Partial<ArchitectureLoadReport> = {}): ArchitectureLoadReport {
    return {
      metadata: {
        generatedAt: '2026-10-24T00:00:00.000Z',
        sourceCommit: 'a'.repeat(40),
        sourceScriptSha256: 'b'.repeat(64),
        sourceFilesSha256: 'c'.repeat(64),
        sourceFileCount: 10,
        sourceFilesScope: 'scope',
        worktreeDirty: false,
        nodeVersion: 'v22.23.2',
        platform: 'win32',
        architecture: 'x64',
        database: 'PGlite in-memory',
        pgliteVersion: '0.5.10',
      },
      workload: { rooms: 1, samples: 2, staleSamples: 1, hotRoomCommits: 2, records: 4, points: 1 },
      measurementScope: 'scope',
      rooms: [{
        index: 1,
        committedActions: 4,
        successful: { count: 2, unit: 'ms', percentileMethod: 'nearest-rank', p50: 5, p95: 6, samples: [5, 6] },
        stale: { count: 1, unit: 'ms', percentileMethod: 'nearest-rank', p50: 2, p95: 2, samples: [2], expectedErrorCode: 'STALE_REVISION' },
      }],
      hotRoom: { index: 1, commits: 2, successful: { count: 2, unit: 'ms', percentileMethod: 'nearest-rank', p50: 7, p95: 8, samples: [7, 8] } },
      storageCurve: [{ commits: 4, totalRelationBytes: 1024, relations: [] }],
      outbox: { pendingRows: 4, deliveredRows: 0, oldestPendingAgeMs: 10, interpretation: 'backlog' },
      unmeasured: [],
      ...overrides,
    };
  }

  it('compares two captures that describe the same measurement', () => {
    const comparison = compareLoadReports(stub(), stub());
    expect(comparison.comparable).toBe(true);
    expect(comparison.reasons).toEqual([]);
    expect(comparison.deltas.map(delta => delta.metric)).toEqual(['room1.successful', 'room1.stale', 'hotRoom.successful']);
  });

  it('refuses to compare when the measured source or workload differs', () => {
    const current = stub();
    const sourceChanged = compareLoadReports(stub(), {
      ...current,
      metadata: { ...current.metadata, sourceFilesSha256: 'd'.repeat(64) },
    });
    expect(sourceChanged.comparable).toBe(false);
    expect(sourceChanged.deltas).toEqual([]);
    expect(sourceChanged.reasons.join(' ')).toContain('sourceFilesSha256');

    const workloadChanged = compareLoadReports(stub(), {
      ...current,
      workload: { ...current.workload, hotRoomCommits: 9 },
    });
    expect(workloadChanged.comparable).toBe(false);
    expect(workloadChanged.reasons.join(' ')).toContain('hotRoomCommits');

    const runtimeChanged = compareLoadReports(stub(), {
      ...current,
      metadata: { ...current.metadata, pgliteVersion: '0.5.9' },
    });
    expect(runtimeChanged.comparable).toBe(false);
  });
});

describe('load harness run', () => {
  it('drives several rooms plus a hot room and records the curve without claiming capacity', async () => {
    const report = await runArchitectureLoad({ ...smallRun });

    expect(report.metadata.database).toBe('PGlite in-memory');
    expect(report.measurementScope).toContain('in-memory PGlite');
    expect(report.rooms).toHaveLength(1);
    expect(report.rooms[0]?.successful.count).toBe(smallRun.samples);
    expect(report.rooms[0]?.stale.count).toBe(smallRun.staleSamples);
    expect(report.rooms[0]?.stale.expectedErrorCode).toBe('STALE_REVISION');
    expect(report.rooms[0]?.successful.p50).toBeLessThanOrEqual(report.rooms[0]?.successful.p95 ?? 0);
    expect(report.hotRoom.commits).toBe(smallRun.hotRoomCommits);

    // The curve starts before the hot room and grows; relation bytes are page-quantized, so it
    // may stay flat between adjacent points but never shrink.
    expect(report.storageCurve.length).toBeGreaterThanOrEqual(2);
    for (let index = 1; index < report.storageCurve.length; index += 1) {
      const before = report.storageCurve[index - 1];
      const after = report.storageCurve[index];
      expect(after?.commits ?? 0).toBeGreaterThan(before?.commits ?? 0);
      expect(after?.totalRelationBytes ?? 0).toBeGreaterThanOrEqual(before?.totalRelationBytes ?? 0);
    }

    // No dispatcher runs here, so every outbox row stays pending and the label says so.
    expect(report.outbox.pendingRows).toBeGreaterThan(0);
    expect(report.outbox.deliveredRows).toBe(0);
    expect(report.outbox.interpretation).toContain('not a delivery lag');

    // Signals this harness cannot see are listed with a reason rather than reported as zero.
    expect(report.unmeasured.map(item => item.signal)).toContain('AI queue wait and job age');
    expect(report.unmeasured.map(item => item.signal)).toContain('hosted capacity');
  }, 60_000);
});
