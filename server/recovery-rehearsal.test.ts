import { describe, expect, it } from 'vitest';
import { REHEARSAL_DEFAULTS, runRecoveryRehearsal } from '../scripts/recovery-rehearsal.js';

/**
 * F078-T7b: the rehearsal must prove the recovery invariants from the T7a contract on a
 * disposable database, and it must state what it did not prove.
 */

describe('recovery rehearsal', () => {
  it('restores a snapshot and re-checks every invariant through the authority', async () => {
    const report = await runRecoveryRehearsal({ commits: 2, pendingJobs: 1 });

    expect(report.invariants.every((item) => item.passed)).toBe(true);
    expect(report.invariants.map((item) => item.name)).toEqual(expect.arrayContaining([
      'state hash matches',
      'epoch and revision match',
      'snapshot, event and receipt counts match',
      'outbox pending count matches',
      'pending model jobs survive as queued',
      'revoked member stays revoked',
      'exact retry replays the original receipt',
      'exact retry adds no event or receipt',
      'revoked member is refused after restore',
    ]));

    // The manifest is snapshotted before the close and re-read after the restore.
    expect(report.after).toEqual(report.before);
    expect(report.before.revision).toBeGreaterThan(1);
    expect(report.before.snapshots).toBe(report.before.receipts + 1);
    expect(report.before.revokedMembers).toBeGreaterThanOrEqual(1);

    // A clean-shutdown copy loses nothing, and the report says why that is not a general RPO.
    expect(report.rpo.modelledCommitsLost).toBe(0);
    expect(report.rpo.statement).toContain('clean close');
    expect(report.rto.reopenAndVerifyMs).toBeGreaterThan(0);
    expect(report.rto.statement).toContain('hosted');

    // Limits are part of the result, so a reader cannot treat this as a hosted restore.
    expect(report.limits.join(' ')).toContain('not crash-consistent');
    expect(report.limits.join(' ')).toContain('Billing');
  }, 120_000);

  it('refuses options outside the bounded range instead of running a huge rehearsal', async () => {
    await expect(runRecoveryRehearsal({ commits: 0, pendingJobs: 0 })).rejects.toThrow('REHEARSAL_OPTIONS_OUT_OF_RANGE:commits');
    await expect(runRecoveryRehearsal({ commits: 1, pendingJobs: 99 })).rejects.toThrow('REHEARSAL_OPTIONS_OUT_OF_RANGE:pendingJobs');
    expect(REHEARSAL_DEFAULTS.commits).toBeGreaterThan(0);
  });
});
