import { describe, expect, it } from 'vitest';
import { reconcile } from './accounting';
import { evaluateProposal } from './evaluation';
import { deriveKnowledge } from './knowledge';
import { BASE_POLICY, createDataset } from './seed';
import type { Asset, Dataset, Evaluation, Policy } from './types';
import type { KnowledgeCategory } from './knowledge';
import { makeObject } from '../state/objects';
import { newWorkspace } from '../state/store';
import type { Proposal, RunSnapshot, TraceEvent, Workspace } from '../state/types';

const CANDIDATE_POLICY: Policy = {
  ...BASE_POLICY,
  version: 2,
  parentVersion: 1,
  laptop: { threshold: 15_000, usefulLifeMonths: 36, start: 'in-service' },
  source: 'approved synthetic policy',
};

function showcaseDataset(period = '2026-09'): Dataset {
  const asset: Asset = {
    rowId: 'ROW-001',
    assetId: 'FA-001',
    description: 'Northstar Laptop flagship',
    category: 'Laptop',
    acquisitionDate: null,
    inServiceDate: `${period}-01`,
    cost: 18_000,
    usefulLifeMonths: 36,
    method: 'straight-line',
    accumulatedDepreciation: 0,
    recordedMonthlyDepreciation: 0,
    glAccount: '1500-LAPTOP',
    department: 'Technology',
  };
  return {
    id: `northstar-${period}`,
    name: `Northstar asset register ${period}`,
    period,
    assets: [asset],
    ledger: [{ id: `LEDGER-ROW-001-${period}`, assetId: asset.assetId, period, account: '1500-LAPTOP', amount: 0 }],
    source: 'synthetic',
  };
}

function event(
  id: string,
  runId: string,
  workerId: string,
  workerType: TraceEvent['workerType'],
  patch: Partial<TraceEvent> = {},
): TraceEvent {
  return {
    id,
    runId,
    taskId: 'accounting-investigation',
    workerId,
    workerType,
    title: 'Recorded workspace action',
    detail: 'Evidence was recorded for the synthetic workspace.',
    inputs: [],
    outputs: [],
    ruleVersion: CANDIDATE_POLICY.version,
    startedAt: '2026-09-30T12:00:00.000Z',
    endedAt: '2026-09-30T12:00:00.000Z',
    status: 'completed',
    ...patch,
  };
}

function makeRun(id: string, dataset: Dataset, policy: Policy, result = reconcile(dataset, policy)): RunSnapshot {
  return { id, createdAt: `${dataset.period}-30T23:00:00.000Z`, cause: 'Monthly replay', dataset: structuredClone(dataset), policy: structuredClone(policy), result: structuredClone(result) };
}

function storedEvaluation(patch: Partial<Evaluation> = {}): Evaluation {
  return {
    cases: [{ id: 'stored-fixture', title: 'September FA-001 calculation', group: 'new', expected: 500, actual: 500, passed: true }],
    passed: 150,
    failed: 0,
    regressions: 0,
    impacts: [],
    beforeExceptions: 1,
    afterExceptions: 0,
    ranAt: '2026-09-30T12:00:00.000Z',
    ...patch,
  };
}

function approvedWorkspace(): Workspace {
  const base = newWorkspace('accounting');
  const dataset = showcaseDataset();
  const policy = structuredClone(CANDIDATE_POLICY);
  const result = reconcile(dataset, policy);
  const run = makeRun('RUN-CURRENT', dataset, policy, result);
  const proposalId = 'PROPOSAL-APPROVED';
  const evaluation = evaluateProposal(dataset, BASE_POLICY, policy);
  const proposal: Proposal = {
    id: proposalId,
    before: structuredClone(BASE_POLICY),
    candidate: structuredClone(policy),
    instruction: 'Capitalize laptops at ฿15,000 over 36 months.',
    source: 'human',
    status: 'approved',
    createdAt: '2026-09-30T11:00:00.000Z',
    evaluation,
    approvalRef: 'APPROVAL-001',
  };
  const objects = [
    makeObject('context', 'accounting'),
    makeObject('source', 'accounting'),
    makeObject('worker', 'accounting', run.id),
    makeObject('table', 'accounting'),
    makeObject('dashboard', 'accounting'),
    makeObject('exceptions', 'accounting'),
    makeObject('knowledge', 'accounting'),
    makeObject('proposal', 'accounting'),
    makeObject('evaluation', 'accounting'),
  ];
  const events = [
    event('EVENT-CALC', run.id, 'depreciation-worker', 'deterministic', {
      title: 'Calculated monthly depreciation',
      inputs: [dataset.id, 'ROW-001', 'policy-v2'],
      outputs: ['reconciliation:ROW-001'],
    }),
    event('EVENT-TEST', run.id, 'policy-evaluator', 'deterministic', {
      title: 'Executed regression tests',
      inputs: [proposalId, dataset.id],
      outputs: [`evaluation:${proposalId}`],
    }),
    event('EVENT-PROPOSE', run.id, 'local-human', 'human', {
      title: 'Human proposed a reusable rule',
      humanAction: 'propose',
      inputs: [],
      outputs: [proposalId],
    }),
    event('EVENT-APPROVE', run.id, 'local-human', 'human', {
      title: 'Human approved the rule',
      humanAction: 'approve',
      approvalRef: 'APPROVAL-001',
      inputs: [proposalId, `evaluation:${proposalId}`],
      outputs: ['policy-v2'],
    }),
    event('EVENT-CORRECT', run.id, 'local-human', 'human', {
      title: 'Corrected one source record',
      humanAction: 'case-correction',
      inputs: ['ROW-001'],
      outputs: ['ROW-001'],
    }),
  ];
  return {
    ...base,
    prompt: 'Explain the laptop depreciation review.',
    objects,
    dataset,
    policy,
    versions: [structuredClone(BASE_POLICY), structuredClone(policy)],
    proposals: [proposal],
    activeProposalId: proposalId,
    result,
    runs: [run],
    events,
  };
}

describe('knowledge constellation', () => {
  it('derives a compact approved-workspace graph with scoped evidence links', () => {
    const workspace = approvedWorkspace();
    const graph = deriveKnowledge(workspace);
    const categories = new Set(graph.nodes.map((node) => node.category));
    const findLink = (fromId: string, relation: string, toId: string) => graph.links.find((link) =>
      link.fromId === fromId && link.relation === relation && link.toId === toId,
    );

    expect(deriveKnowledge(newWorkspace('accounting')).nodes.length).toBeLessThanOrEqual(12);
    expect(graph.nodes).toHaveLength(11);
    const expectedCategories: KnowledgeCategory[] = ['question', 'source', 'worker', 'rule', 'person', 'exception', 'test', 'outcome'];
    expect(expectedCategories.every((category) => categories.has(category))).toBe(true);
    expect(graph.nodes.every((node) => node.x >= 0 && node.y >= 0)).toBe(true);
    expect(graph.nodes.find((node) => node.id === 'question:workspace')?.summary).toContain(workspace.prompt);

    const source = graph.nodes.find((node) => node.category === 'source' && node.evidenceRefs.includes(workspace.dataset.id));
    const currentOutcome = graph.nodes.find((node) => node.id === 'outcome:table');
    const activePolicy = graph.nodes.find((node) => node.id === 'policy:2');
    const proposal = graph.nodes.find((node) => node.id === 'proposal:PROPOSAL-APPROVED');
    const test = graph.nodes.find((node) => node.id === 'test:PROPOSAL-APPROVED');
    const person = graph.nodes.find((node) => node.category === 'person');
    const policyEvaluator = graph.nodes.find((node) => node.id === 'worker:policy-evaluator:RUN-CURRENT');
    const exception = graph.nodes.find((node) => node.category === 'exception' && node.rowId === 'ROW-001');

    expect(source).toBeDefined();
    expect(currentOutcome).toBeDefined();
    expect(activePolicy?.status).toBe('approved');
    expect(proposal?.status).toBe('approved');
    expect(test?.summary).toContain(`${workspace.proposals[0]?.evaluation?.passed} passed`);
    expect(person?.title).toBe('Recorded human instruction');
    expect(JSON.stringify(person)).not.toContain('local-human');
    expect(policyEvaluator).toMatchObject({ x: 210, y: 20 });
    expect(findLink('question:workspace', 'depends_on', source?.id ?? '')?.evidenceRefs).toContain(workspace.dataset.id);
    expect(findLink(currentOutcome?.id ?? '', 'derived_from', source?.id ?? '')?.evidenceRefs).toContain(workspace.dataset.id);
    expect(findLink('policy:2', 'used_by', currentOutcome?.id ?? '')?.evidenceRefs).toContain(workspace.dataset.id);
    expect(findLink('policy:2', 'produced_by', proposal?.id ?? '')?.evidenceRefs).toContain('APPROVAL-001');
    expect(findLink(proposal?.id ?? '', 'tested_by', test?.id ?? '')?.evidenceRefs).toContain('EVENT-TEST');
    expect(findLink(exception?.id ?? '', 'corrected_by', person?.id ?? '')?.evidenceRefs).toContain('EVENT-CORRECT');
  });

  it('keeps an unresolved handoff attached to its saved run after a same-dataset replay', () => {
    const base = newWorkspace('accounting');
    const originalDataset = createDataset('2026-09');
    const replayDataset = structuredClone(originalDataset);
    const correctedRow = replayDataset.assets.find((asset) => asset.rowId === 'ROW-002');
    if (correctedRow === undefined) throw new Error('Expected ROW-002 in the synthetic dataset.');
    correctedRow.description = 'Northstar corrected after the handoff';

    const policy = structuredClone(CANDIDATE_POLICY);
    const handoffRun = makeRun('RUN-HANDOFF-A', originalDataset, policy);
    const replayRun = makeRun('RUN-REPLAY-B', replayDataset, policy);
    const workspace: Workspace = {
      ...base,
      dataset: replayDataset,
      policy,
      versions: [structuredClone(BASE_POLICY), policy],
      result: replayRun.result,
      runs: [handoffRun, replayRun],
      events: [
        event('EVENT-HANDOFF-A', handoffRun.id, 'local-human', 'human', {
          title: 'Human continued the handoff',
          humanAction: 'continue',
          inputs: ['ROW-001'],
        }),
        event('EVENT-ROW-002-CORRECTION-B', replayRun.id, 'local-human', 'human', {
          title: 'Corrected a different source row',
          humanAction: 'case-correction',
          inputs: ['ROW-002'],
          outputs: ['ROW-002'],
        }),
        event('EVENT-CALC-B', replayRun.id, 'depreciation-worker', 'deterministic', {
          inputs: [replayDataset.id],
          outputs: ['reconciliation:ROW-001'],
        }),
      ],
      objects: [
        makeObject('source', 'accounting'),
        makeObject('worker', 'accounting', replayRun.id),
        makeObject('table', 'accounting'),
        makeObject('dashboard', 'accounting'),
        makeObject('exceptions', 'accounting'),
      ],
      handoffs: [{
        rowId: 'ROW-001',
        datasetId: originalDataset.id,
        runId: handoffRun.id,
        owner: 'Finance',
        status: 'waiting',
        attempts: [],
      }],
    };

    const graph = deriveKnowledge(workspace);
    const handoffId = `exception:handoff:${originalDataset.id}:ROW-001`;
    const handoff = graph.nodes.find((node) => node.id === handoffId);
    const activeSource = graph.nodes.find((node) => node.id === 'source:source');
    const savedSource = graph.nodes.find((node) => node.id === `source:run:${handoffRun.id}`);
    const currentException = graph.nodes.find((node) => node.category === 'exception'
      && !node.id.startsWith('exception:handoff:'));
    const handoffLinks = graph.links.filter((link) => link.fromId === handoffId);

    expect(handoff).toMatchObject({ datasetId: originalDataset.id, runId: handoffRun.id, rowId: 'ROW-001' });
    expect(handoff?.detail.join(' ')).toContain('prior saved run');
    expect(activeSource).toMatchObject({ datasetId: replayDataset.id, runId: replayRun.id });
    expect(activeSource?.detail.join(' ')).toContain('Northstar corrected after the handoff');
    expect(savedSource).toMatchObject({ datasetId: originalDataset.id, runId: handoffRun.id });
    expect(savedSource?.detail.join(' ')).not.toContain('Northstar corrected after the handoff');
    expect(currentException).toMatchObject({ datasetId: replayDataset.id, runId: replayRun.id });
    expect(handoffLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({
        toId: `source:run:${handoffRun.id}`,
        relation: 'derived_from',
        evidenceRefs: expect.arrayContaining(['ROW-001', originalDataset.id, handoffRun.id]),
      }),
      expect.objectContaining({
        toId: `outcome:run:${handoffRun.id}`,
        relation: 'handed_off_to',
        evidenceRefs: expect.arrayContaining(['ROW-001', originalDataset.id, handoffRun.id]),
      }),
      expect.objectContaining({
        toId: 'person:recorded-human-actions',
        relation: 'produced_by',
        evidenceRefs: expect.arrayContaining(['EVENT-HANDOFF-A', 'ROW-001', originalDataset.id, handoffRun.id]),
      }),
    ]));
    expect(handoffLinks.some((link) => link.toId === 'outcome:table' || link.toId === 'outcome:dashboard')).toBe(false);
    expect(handoffLinks.some((link) => link.evidenceRefs.includes('EVENT-ROW-002-CORRECTION-B'))).toBe(false);
    expect(graph.nodes.some((node) => node.id === `outcome:${replayRun.id}`)).toBe(false);
    expect(graph.nodes.find((node) => node.id === 'outcome:table')).toMatchObject({ datasetId: replayDataset.id, runId: replayRun.id });
    expect(graph.nodes.find((node) => node.id === 'outcome:dashboard')).toMatchObject({ datasetId: replayDataset.id, runId: replayRun.id });
  });

  it('keeps historical verification and outcomes tied to their saved data snapshots', () => {
    const base = newWorkspace('accounting');
    const oldDataset = createDataset('2026-09');
    const olderSeed = createDataset('2026-09');
    const olderDataset: Dataset = {
      ...olderSeed,
      id: 'northstar-2026-08',
      name: 'Northstar asset register 2026-08',
      period: '2026-08',
      ledger: olderSeed.ledger.map((entry) => ({ ...entry, period: '2026-08' })),
    };
    const currentDataset = createDataset('2026-10');
    const oldPolicy = structuredClone(CANDIDATE_POLICY);
    const currentPolicy: Policy = { ...oldPolicy, version: 3, parentVersion: 2, source: 'current policy' };
    const oldRun = makeRun('RUN-SEPTEMBER', oldDataset, oldPolicy);
    const olderRun = makeRun('RUN-AUGUST', olderDataset, BASE_POLICY);
    const currentRun = makeRun('RUN-OCTOBER', currentDataset, currentPolicy);
    const oldProposalId = 'PROPOSAL-SEPTEMBER';
    const oldProposal: Proposal = {
      id: oldProposalId,
      before: structuredClone(BASE_POLICY),
      candidate: oldPolicy,
      instruction: 'September laptop proposal.',
      source: 'human',
      status: 'tested',
      createdAt: '2026-09-30T12:00:00.000Z',
      evaluation: storedEvaluation(),
    };
    const events = [
      event('EVENT-OLD-CALC', oldRun.id, 'depreciation-worker', 'deterministic', {
        inputs: [oldDataset.id], outputs: ['reconciliation:ROW-001'], ruleVersion: oldPolicy.version,
      }),
      event('EVENT-CURRENT-CALC', currentRun.id, 'depreciation-worker', 'deterministic', {
        inputs: [currentDataset.id], outputs: ['reconciliation:ROW-001'], ruleVersion: currentPolicy.version,
      }),
      event('EVENT-OLDER-TEST', olderRun.id, 'policy-evaluator', 'deterministic', {
        title: 'Earlier test of September proposal',
        inputs: [oldProposalId, olderDataset.id],
        outputs: [`evaluation:${oldProposalId}`],
        ruleVersion: oldPolicy.version,
        startedAt: '2026-09-15T12:00:00.000Z',
      }),
      event('EVENT-OLD-TEST', oldRun.id, 'policy-evaluator', 'deterministic', {
        title: 'Tested September proposal',
        inputs: [oldProposalId, oldDataset.id],
        outputs: [`evaluation:${oldProposalId}`],
        ruleVersion: oldPolicy.version,
      }),
      event('EVENT-OLD-HANDOFF', oldRun.id, 'local-human', 'human', {
        title: 'Handoff continue',
        humanAction: 'continue',
        inputs: ['ROW-001'],
        startedAt: '2026-09-30T13:00:00.000Z',
      }),
      event('EVENT-CURRENT-HANDOFF', currentRun.id, 'local-human', 'human', {
        title: 'Handoff continue',
        humanAction: 'continue',
        inputs: ['ROW-001'],
        startedAt: '2026-10-30T13:00:00.000Z',
      }),
    ];
    const workspace: Workspace = {
      ...base,
      dataset: currentDataset,
      policy: currentPolicy,
      versions: [structuredClone(BASE_POLICY), oldPolicy, currentPolicy],
      proposals: [oldProposal],
      activeProposalId: null,
      result: currentRun.result,
      runs: [olderRun, oldRun, currentRun],
      objects: [
        makeObject('source', 'accounting'),
        makeObject('worker', 'accounting', currentRun.id),
        makeObject('table', 'accounting'),
        makeObject('dashboard', 'accounting'),
      ],
      events,
      handoffs: [
        { rowId: 'ROW-001', datasetId: oldDataset.id, runId: oldRun.id, owner: 'Finance', status: 'waiting', attempts: [] },
        { rowId: 'ROW-001', datasetId: currentDataset.id, runId: currentRun.id, owner: 'Finance', status: 'waiting', attempts: [] },
      ],
    };

    const currentOnly = deriveKnowledge(workspace);
    const withHistory = deriveKnowledge(workspace, true);
    const oldTest = withHistory.nodes.find((node) => node.id === `test:${oldProposalId}`);
    const oldOutcome = withHistory.nodes.find((node) => node.id === `outcome:run:${oldRun.id}`);
    const oldSource = withHistory.nodes.find((node) => node.id === `source:run:${oldRun.id}`);
    const oldException = withHistory.nodes.find((node) => node.category === 'exception'
      && node.runId === oldRun.id
      && !node.id.startsWith('exception:handoff:'));
    const oldHandoff = withHistory.nodes.find((node) => node.id === `exception:handoff:${oldDataset.id}:ROW-001`);
    const currentHandoff = withHistory.nodes.find((node) => node.id === `exception:handoff:${currentDataset.id}:ROW-001`);
    const oldHandoffAction = withHistory.links.find((link) => link.fromId === oldHandoff?.id
      && link.toId === 'person:recorded-human-actions'
      && link.relation === 'produced_by');
    const currentOnlyHandoff = currentOnly.nodes.find((node) => node.id === `exception:handoff:${currentDataset.id}:ROW-001`);
    const currentHandoffAction = currentOnly.links.find((link) => link.fromId === currentOnlyHandoff?.id
      && link.toId === 'person:recorded-human-actions'
      && link.relation === 'produced_by');

    expect(currentOnly.nodes.some((node) => node.id === `test:${oldProposalId}`)).toBe(false);
    expect(currentOnly.nodes.some((node) => node.category === 'exception' && node.evidenceRefs.includes(oldDataset.id))).toBe(false);
    expect(oldTest?.detail.join(' ')).toContain('September FA-001 calculation');
    expect(oldTest?.evidenceRefs).toContain(oldDataset.id);
    expect(oldTest?.evidenceRefs).not.toContain(olderDataset.id);
    expect(oldTest?.evidenceRefs).not.toContain(currentDataset.id);
    expect(oldTest).toMatchObject({ datasetId: oldDataset.id, runId: oldRun.id });
    expect(oldTest?.detail.join(' ')).not.toContain(olderDataset.id);
    expect(oldOutcome?.evidenceRefs).toEqual(expect.arrayContaining([oldRun.id, oldDataset.id, 'policy-v2']));
    expect(oldOutcome).toMatchObject({ datasetId: oldDataset.id, runId: oldRun.id });
    expect(oldSource?.evidenceRefs).toEqual(expect.arrayContaining([oldRun.id, oldDataset.id]));
    expect(oldSource).toMatchObject({ datasetId: oldDataset.id, runId: oldRun.id });
    expect(oldSource?.evidenceRefs).not.toContain(currentDataset.id);
    expect(oldException).toMatchObject({ datasetId: oldDataset.id, runId: oldRun.id });
    expect(oldHandoff).toMatchObject({ rowId: 'ROW-001', datasetId: oldDataset.id, runId: oldRun.id });
    expect(currentHandoff).toMatchObject({ rowId: 'ROW-001', datasetId: currentDataset.id, runId: currentRun.id });
    expect(oldHandoffAction?.evidenceRefs).toEqual(expect.arrayContaining(['EVENT-OLD-HANDOFF', 'ROW-001', oldDataset.id, oldRun.id]));
    expect(oldHandoffAction?.evidenceRefs).not.toContain('EVENT-CURRENT-HANDOFF');
    expect(currentOnlyHandoff).toMatchObject({ datasetId: currentDataset.id, runId: currentRun.id });
    expect(currentHandoffAction?.evidenceRefs).toEqual(expect.arrayContaining(['EVENT-CURRENT-HANDOFF', 'ROW-001', currentDataset.id, currentRun.id]));
    expect(currentOnly.links.some((link) => link.fromId === currentOnlyHandoff?.id
      && link.toId === 'outcome:table'
      && link.relation === 'handed_off_to')).toBe(true);
    expect(currentOnly.links.some((link) => link.fromId === currentOnlyHandoff?.id
      && link.toId === 'source:source'
      && link.relation === 'derived_from'
      && link.evidenceRefs.includes(currentDataset.id))).toBe(true);
    expect(withHistory.nodes.filter((node) => node.category === 'exception' && node.id.startsWith('exception:handoff:'))).toHaveLength(2);
    expect(withHistory.links.some((link) => link.fromId === oldOutcome?.id && link.toId === oldSource?.id && link.relation === 'derived_from')).toBe(true);
    expect(withHistory.links.some((link) => link.fromId === oldHandoff?.id && link.toId === oldSource?.id && link.relation === 'derived_from' && link.evidenceRefs.includes(oldDataset.id))).toBe(true);
    expect(withHistory.links.some((link) => link.fromId === oldHandoff?.id && link.toId === oldOutcome?.id && link.relation === 'handed_off_to' && link.evidenceRefs.includes(oldRun.id))).toBe(true);
    expect(withHistory.links.some((link) => link.fromId === oldHandoff?.id && link.toId === 'outcome:table' && link.relation === 'handed_off_to')).toBe(false);
    expect(withHistory.links.some((link) => link.fromId === oldHandoff?.id && link.toId === 'source:source' && link.relation === 'derived_from')).toBe(false);
    expect(withHistory.links.some((link) => link.fromId === oldOutcome?.id
      && link.toId === 'worker:depreciation-worker:RUN-SEPTEMBER'
      && link.relation === 'produced_by'
      && link.evidenceRefs.includes(oldRun.id))).toBe(true);
  });
});
