import { managesTable } from '../shared/visibility';
import type { Candidate, WorkspaceView } from '../shared/contracts';
import type { TableChange, TableState } from '../shared/table-contracts';
import type { Command } from './types';

type TableCandidate = Candidate & { change: TableChange };
type TableCandidateView = WorkspaceView & { kind: 'table'; domain: TableState & { candidate: TableCandidate } };
type ReviewStage = { type: 'evolve.simulate' | 'evolve.validate' | 'evolve.approve' | 'evolve.activate'; status: 'simulated' | 'validated' | 'approved' | 'active' };

const reviewStages: ReviewStage[] = [
  { type: 'evolve.simulate', status: 'simulated' },
  { type: 'evolve.validate', status: 'validated' },
  { type: 'evolve.approve', status: 'approved' },
  { type: 'evolve.activate', status: 'active' },
];

export type TableCandidateApplyResult =
  | { ok: true; view: WorkspaceView }
  | { ok: false; reason: string };

function tableCandidateView(view: WorkspaceView | null | undefined): view is TableCandidateView {
  return view?.kind === 'table'
    && view.domain.kind === 'table'
    && view.domain.candidate !== null
    && view.domain.candidate.change.kind === 'table';
}

export function sameTableCandidateScope(current: WorkspaceView | null | undefined, expected: WorkspaceView): boolean {
  if (!tableCandidateView(current) || !tableCandidateView(expected)) return false;
  const currentCandidate = current.domain.candidate;
  const expectedCandidate = expected.domain.candidate;
  return current.id === expected.id
    && current.kind === expected.kind
    && current.epoch === expected.epoch
    && current.actor.actorId === expected.actor.actorId
    && current.actor.role === expected.actor.role
    && current.actor.seat === expected.actor.seat
    && currentCandidate.id === expectedCandidate.id
    && currentCandidate.hash === expectedCandidate.hash;
}

/** Exact pre-command guard for a stage in the pinned table candidate review. */
export function matchesExpectedTableCandidateView(current: WorkspaceView | null | undefined, expected: WorkspaceView): boolean {
  return sameTableCandidateScope(current, expected)
    && tableCandidateView(current)
    && tableCandidateView(expected)
    && current.revision === expected.revision
    && current.domain.dataRevision === expected.domain.dataRevision
    && current.domain.ruleRevision === expected.domain.ruleRevision
    && managesTable(expected)
    && expected.domain.candidate?.status !== 'active';
}

function candidateAt(view: WorkspaceView): TableCandidate | null {
  return tableCandidateView(view) ? view.domain.candidate : null;
}

function passingValidation(view: WorkspaceView): boolean {
  const candidate = candidateAt(view);
  return candidate !== null
    && candidate.simulation !== null
    && candidate.proof?.passed === true
    && candidate.proof.candidateHash === candidate.hash
    && candidate.proof.hash.length > 0
    && candidate.proof.sourceHash.length > 0
    && candidate.simulation.checks.every(check => check.passed);
}

function validApproval(view: WorkspaceView): boolean {
  const candidate = candidateAt(view);
  return candidate !== null
    && candidate.proof?.passed === true
    && candidate.approval !== null
    && candidate.approval.id.length > 0
    && candidate.approval.actorId === view.actor.actorId
    && candidate.approval.candidateHash === candidate.hash
    && candidate.approval.proofHash === candidate.proof.hash
    && candidate.approval.epoch === view.epoch
    && !candidate.approval.revoked;
}

/** Runs the existing authority stages in order, binding each one to the view returned by the prior stage. */
export async function applyTableCandidate(
  initialView: WorkspaceView,
  onCommand: Command,
  options: { readOnly?: boolean } = {},
): Promise<TableCandidateApplyResult> {
  if (options.readOnly) return { ok: false, reason: 'This table is read-only. The proposal was not changed.' };
  if (!tableCandidateView(initialView) || initialView.domain.candidate?.status === 'active') {
    return { ok: false, reason: 'There is no pending table proposal to apply.' };
  }
  if (!managesTable(initialView)) return { ok: false, reason: 'Only a table manager can apply this proposal.' };

  const pinned = initialView.domain.candidate;
  let current = initialView;
  for (const stage of reviewStages) {
    if (options.readOnly) return { ok: false, reason: 'This table became read-only. The review stopped safely.' };
    if (!matchesExpectedTableCandidateView(current, current)) {
      return { ok: false, reason: 'The proposal changed during review. Review the latest proposal before applying it.' };
    }

    let next: WorkspaceView | null;
    try { next = await onCommand(stage.type, {}, current); }
    catch { return { ok: false, reason: 'A review step could not be completed. Review the latest table state and try again.' }; }
    if (!next) return { ok: false, reason: 'The table changed during review. Review the latest proposal before trying again.' };
    if (!tableCandidateView(next) || !sameTableCandidateScope(next, initialView)) {
      return { ok: false, reason: 'The proposal was replaced during review. Review the latest proposal before applying it.' };
    }
    if (next.revision === current.revision) {
      return { ok: false, reason: 'The table did not confirm the next review step. Review the latest proposal before continuing.' };
    }

    const candidate = next.domain.candidate;
    if (candidate.baseDataRevision !== pinned.baseDataRevision
      || candidate.baseRuleRevision !== pinned.baseRuleRevision
      || next.domain.dataRevision !== pinned.baseDataRevision) {
      return { ok: false, reason: 'The table data changed during review. Review the latest proposal before applying it.' };
    }
    if (stage.type !== 'evolve.activate' && next.domain.ruleRevision !== pinned.baseRuleRevision) {
      return { ok: false, reason: 'The active rules changed during review. Review the latest proposal before applying it.' };
    }
    if (candidate.status !== stage.status) {
      const reason = stage.type === 'evolve.validate'
        ? 'Trusted validation did not pass. Review the checks before applying this table.'
        : 'The review stopped at an unexpected stage. Review the latest proposal before continuing.';
      return { ok: false, reason };
    }
    if (stage.type === 'evolve.simulate' && candidate.simulation === null) {
      return { ok: false, reason: 'The table did not return a simulation. Review the latest proposal before continuing.' };
    }
    if ((stage.type === 'evolve.validate' || stage.type === 'evolve.approve' || stage.type === 'evolve.activate') && !passingValidation(next)) {
      return { ok: false, reason: 'Trusted validation did not pass. Review the checks before applying this table.' };
    }
    if ((stage.type === 'evolve.approve' || stage.type === 'evolve.activate') && !validApproval(next)) {
      return { ok: false, reason: 'The approval is missing or no longer matches this proposal. Review the latest proposal before continuing.' };
    }
    if (stage.type === 'evolve.activate'
      && (next.domain.ruleRevision !== pinned.baseRuleRevision + 1 || next.domain.program === null)) {
      return { ok: false, reason: 'The table did not confirm activation. Review the latest table state before continuing.' };
    }
    current = next;
  }

  return { ok: true, view: current };
}
