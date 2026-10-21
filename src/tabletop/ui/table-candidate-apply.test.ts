import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createTableState } from '../domain/table';
import { decideDomain } from '../domain';
import type { ActorContext, Candidate, WorkspaceView } from '../shared/contracts';
import { loanAmortizationChange } from '../testing/generative-scenarios';
import { applyTableCandidate, matchesExpectedTableCandidateView } from './table-candidate-apply';
import type { Command } from './types';

const owner: ActorContext = {
  actorId: 'owner-account', name: 'Owner', role: 'owner', workspaceId: 'table-apply', epoch: 1, now: 1000,
  hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
};

function draftView(): WorkspaceView {
  const domain = decideDomain(createTableState(), { type: 'evolve.propose', payload: { change: loanAmortizationChange } }, owner).state;
  return {
    id: owner.workspaceId, title: 'Loan table', kind: 'table', epoch: owner.epoch, revision: 'revision-0',
    actor: { actorId: owner.actorId, name: owner.name, role: owner.role },
    members: [{ actorId: owner.actorId, name: owner.name, role: owner.role }],
    domain, createdAt: 0, expiresAt: 999999,
  };
}

function advance(view: WorkspaceView, type: string, payload: unknown): WorkspaceView {
  if (view.domain.kind !== 'table') throw new Error('Expected a table view.');
  const next = decideDomain(view.domain, { type, payload }, owner).state;
  return { ...view, revision: `revision-${Number(view.revision.slice('revision-'.length)) + 1}`, domain: next };
}

function withCandidate(view: WorkspaceView, candidate: Candidate): WorkspaceView {
  if (view.domain.kind !== 'table') throw new Error('Expected a table view.');
  return { ...view, domain: { ...view.domain, candidate } };
}

describe('generic table apply flow', () => {
  it('runs every review stage in order against each returned candidate revision', async () => {
    const initial = draftView();
    const calls: { type: string; revision: string }[] = [];
    let current = initial;
    const command: Command = async (type, payload, expectedView) => {
      expect(expectedView).toBe(current);
      expect(matchesExpectedTableCandidateView(current, expectedView!)).toBe(true);
      calls.push({ type, revision: expectedView!.revision });
      current = advance(current, type, payload);
      return current;
    };

    const result = await applyTableCandidate(initial, command);

    expect(result.ok).toBe(true);
    expect(calls.map(call => call.type)).toEqual(['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']);
    expect(calls.map(call => call.revision)).toEqual(['revision-0', 'revision-1', 'revision-2', 'revision-3']);
    expect(result.ok && result.view.domain.kind === 'table' ? result.view.domain.candidate?.status : null).toBe('active');
  });

  it('stops after a candidate is replaced while a stage is in flight', async () => {
    const initial = draftView();
    let current = initial;
    const calls: string[] = [];
    const command: Command = async (type, payload, expectedView) => {
      calls.push(type);
      if (!matchesExpectedTableCandidateView(current, expectedView!)) return null;
      const simulated = advance(current, type, payload);
      if (simulated.domain.kind !== 'table' || !simulated.domain.candidate) throw new Error('Expected a candidate.');
      current = withCandidate(simulated, { ...simulated.domain.candidate, id: 'replacement-candidate', hash: 'b'.repeat(64) });
      return current;
    };

    const result = await applyTableCandidate(initial, command);

    expect(result.ok).toBe(false);
    expect(calls).toEqual(['evolve.simulate']);
  });

  it.each([
    ['a null command result', async () => null],
    ['a rejected command', async () => { throw new Error('connection lost'); }],
  ])('stops when a review stage returns %s', async (_description, outcome) => {
    const calls: string[] = [];
    const result = await applyTableCandidate(draftView(), async type => {
      calls.push(type);
      return outcome() as Promise<WorkspaceView | null>;
    });

    expect(result.ok).toBe(false);
    expect(calls).toEqual(['evolve.simulate']);
  });

  it('does not approve a candidate whose trusted validation failed', async () => {
    let current = draftView();
    const calls: string[] = [];
    const command: Command = async (type, payload, expectedView) => {
      calls.push(type);
      if (!matchesExpectedTableCandidateView(current, expectedView!)) return null;
      current = advance(current, type, payload);
      if (type === 'evolve.validate' && current.domain.kind === 'table' && current.domain.candidate) {
        current = withCandidate(current, {
          ...current.domain.candidate,
          status: 'simulated',
          proof: { hash: 'failed-proof', candidateHash: current.domain.candidate.hash, sourceHash: 'source', passed: false, createdAt: 1001 },
          simulation: { before: {}, after: {}, checks: [{ id: 'domain-invariants', passed: false, message: 'A required invariant failed.' }] },
        });
      }
      return current;
    };

    const result = await applyTableCandidate(draftView(), command);

    expect(result.ok).toBe(false);
    expect(calls).toEqual(['evolve.simulate', 'evolve.validate']);
  });

  it('requires the live view to match the pinned owner, revision and candidate identity', () => {
    const expected = draftView();
    if (expected.domain.kind !== 'table' || !expected.domain.candidate) throw new Error('Expected a table candidate.');
    const replaced = withCandidate(expected, { ...expected.domain.candidate, hash: 'c'.repeat(64) });
    const changedSeat = { ...expected, actor: { ...expected.actor, role: 'participant' as const, seat: 'member-1' as const } };

    expect(matchesExpectedTableCandidateView(expected, expected)).toBe(true);
    expect(matchesExpectedTableCandidateView({ ...expected, revision: 'revision-new' }, expected)).toBe(false);
    expect(matchesExpectedTableCandidateView(replaced, expected)).toBe(false);
    expect(matchesExpectedTableCandidateView(changedSeat, expected)).toBe(false);
  });

  it('does not send review stages for read-only tables or non-owner seats', async () => {
    const ownerView = draftView();
    const memberView = { ...ownerView, actor: { actorId: 'member-account', name: 'Member', role: 'participant' as const, seat: 'member-1' as const } };
    let calls = 0;
    const command: Command = async () => { calls += 1; return null; };

    expect((await applyTableCandidate(ownerView, command, { readOnly: true })).ok).toBe(false);
    expect((await applyTableCandidate(memberView, command)).ok).toBe(false);
    expect(calls).toBe(0);
  });
});
