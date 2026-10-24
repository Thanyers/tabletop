import { MODEL_JOB_ID_PATTERN } from './room-job-view.js';
import type { RoomModelJob, RoomRepository } from './room-repository.js';

/**
 * F078-T6b (first path) — Room job *recovery and reconciliation*.
 *
 * `Room` used to own transport, authority wiring, both AI job lifecycles, the read-side
 * projection and this recovery slice in one class. This module is the recovery slice only: given
 * a stored job it decides whether an interrupted or uncertain job may be finished, and it never
 * starts provider work itself.
 *
 * The guards here are the ones that make retries safe, so they are preserved exactly:
 *
 * - A committed command is proven by its **receipt**, matched on both the command id and the
 *   payload hash. A receipt that exists marks the job complete; it is never failed afterwards.
 * - A confirmation that cannot be proven is settled as rejected only after the recorded start
 *   time plus the recovery window, so a slow commit is not reported as interrupted too early.
 * - A still-running job is interrupted only after the configured deadline plus grace.
 * - Every path returns the freshest stored row, and a missing row falls back to the input job
 *   rather than inventing one.
 *
 * `Date.now()` is read at call time and the recovery window is injected, so the caller keeps
 * ownership of configuration and the module keeps no clock of its own.
 */

export interface RoomJobRecoveryDeps {
  repository: RoomRepository;
  /** The whole-job deadline plus its grace, recomputed from the environment by the caller. */
  modelRecoveryMs(): number;
}

export interface RoomJobRecovery {
  reconcileTableAssistantJob(job: RoomModelJob): Promise<RoomModelJob>;
  reconcileModelJob(job: RoomModelJob): Promise<RoomModelJob>;
  /** Reconcile every stale job; called from the alarm before directory and outbox work. */
  recoverStaleModelJobs(): Promise<void>;
}

export function createRoomJobRecovery(deps: RoomJobRecoveryDeps): RoomJobRecovery {
  const { repository } = deps;

  const reconcileTableAssistantJob = async (job: RoomModelJob): Promise<RoomModelJob> => {
    if (job.data.kind !== 'table-assistant' || (job.status !== 'running' && job.status !== 'committing')) return job;
    const commandId = typeof job.data.confirmCommandId === 'string' ? job.data.confirmCommandId : '';
    const proposalHash = typeof job.data.proposalHash === 'string' ? job.data.proposalHash : '';
    const receipt = commandId && proposalHash
      ? await repository.findCommandReceipt(job.workspaceId, job.epoch, job.actorId, commandId)
      : null;
    if (job.status === 'committing') {
      if (receipt && receipt.payloadHash === proposalHash) {
        await repository.completeTableAssistantConfirmation(
          job.id, job.workspaceId, job.epoch, job.actorId, commandId,
          { ...job.data, confirmationStatus: 'confirmed' },
        );
      } else {
        const startedAt = typeof job.data.confirmationStartedAt === 'number'
          && Number.isSafeInteger(job.data.confirmationStartedAt)
          ? job.data.confirmationStartedAt : job.createdAt;
        if (receipt || Date.now() - startedAt >= deps.modelRecoveryMs()) {
          await repository.settleTableAssistantConfirmationFailure({
            id: job.id,
            workspaceId: job.workspaceId,
            epoch: job.epoch,
            actorId: job.actorId,
            commandId,
            proposalHash,
            confirmationStatus: 'rejected',
            failure: 'CONFIRMATION_INTERRUPTED',
          });
        }
      }
      return (await repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
    }
    if (Date.now() - job.createdAt >= deps.modelRecoveryMs()) {
      await repository.finishTableAssistantJob(
        job.id, job.workspaceId, job.epoch, job.actorId, 'failed',
        { ...job.data, failure: 'ASSISTANT_INTERRUPTED' },
      );
    }
    return (await repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
  };

  const reconcileModelJob = async (job: RoomModelJob): Promise<RoomModelJob> => {
    if (job.status !== 'running' && job.status !== 'committing') return job;
    const commandId = typeof job.data.commandId === 'string' ? job.data.commandId : '';
    const proposalHash = typeof job.data.proposalHash === 'string' ? job.data.proposalHash : '';
    const receipt = commandId
      ? await repository.findCommandReceipt(job.workspaceId, job.epoch, job.actorId, commandId)
      : null;
    if (receipt && proposalHash && MODEL_JOB_ID_PATTERN.test(proposalHash)
        && receipt.payloadHash === proposalHash) {
      const candidateId = receipt.response.workspace.domain.candidate?.id;
      await repository.finishModelJob(job.id, job.workspaceId, job.epoch, job.actorId, 'completed', {
        ...job.data,
        ...(candidateId ? { candidateId } : {}),
      });
    }
    if (Date.now() - job.createdAt >= deps.modelRecoveryMs()) {
      const current = await repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch);
      if (current && (current.status === 'running' || current.status === 'committing')) {
        await repository.failModelJobAfterReceiptCheck(
          job.id, job.workspaceId, job.epoch, job.actorId, 'MODEL_JOB_INTERRUPTED',
        );
      }
    }
    return (await repository.getModelJob(job.id, job.actorId, job.workspaceId, job.epoch)) ?? job;
  };

  const recoverStaleModelJobs = async (): Promise<void> => {
    const stale = await repository.listStaleRunningModelJobs(Date.now() - deps.modelRecoveryMs());
    for (const job of stale) {
      if (job.data.kind === 'table-assistant') await reconcileTableAssistantJob(job);
      else await reconcileModelJob(job);
    }
  };

  return { reconcileTableAssistantJob, reconcileModelJob, recoverStaleModelJobs };
}
