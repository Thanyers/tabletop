import { describe, expect, it } from 'vitest';
import { deriveLearning, explainWorkspace, simulateUsefulLife } from './learning';
import { reconcile } from './accounting';
import { withCategoryPolicy } from './policy';
import { createDataset } from './seed';
import { newWorkspace } from '../state/store';
import { makeObject } from '../state/objects';
import type { Proposal, RunSnapshot, TraceEvent, Workspace } from '../state/types';
import type { Policy } from './types';

function approvedWorkspace(): Workspace {
  const base = newWorkspace('accounting');
  const policy: Policy = {
    ...base.policy,
    version: 2,
    laptop: { threshold: 15_000, usefulLifeMonths: 36, start: 'in-service' },
    source: 'approved synthetic policy',
    parentVersion: 1,
  };
  const result = reconcile(base.dataset, policy);
  const run: RunSnapshot = {
    id: 'RUN-CURRENT',
    createdAt: '2026-09-30T23:00:00.000Z',
    cause: 'Initial calculation',
    dataset: structuredClone(base.dataset),
    policy: structuredClone(policy),
    result: structuredClone(result),
  };
  return { ...base, policy, result, runs: [run] };
}

function calculationEvent(workspace: Workspace): TraceEvent {
  return {
    id: 'EVENT-CALC-001',
    runId: workspace.runs.at(-1)?.id ?? 'RUN-CALC-001',
    taskId: 'accounting-investigation',
    workerId: 'depreciation-worker',
    workerType: 'deterministic',
    title: 'Calculated monthly depreciation',
    detail: 'Evaluated the source row with the active policy.',
    inputs: [workspace.dataset.id, 'ROW-001', 'policy-v2'],
    outputs: ['reconciliation:ROW-001'],
    ruleVersion: workspace.policy.version,
    startedAt: '2026-09-01T00:00:00.000Z',
    endedAt: '2026-09-01T00:00:00.000Z',
    status: 'completed',
  };
}

function eventWith(
  workspace: Workspace,
  id: string,
  runId: string,
  patch: Partial<TraceEvent>,
): TraceEvent {
  return { ...calculationEvent(workspace), id, runId, ...patch };
}

function evaluationProposal(workspace: Workspace, patch: Partial<Proposal>): Proposal {
  const candidate: Policy = {
    ...workspace.policy,
    version: workspace.policy.version + 1,
    parentVersion: workspace.policy.version,
    source: 'test proposal',
  };
  return {
    id: 'PROPOSAL-001',
    before: structuredClone(workspace.policy),
    candidate,
    instruction: 'Test a policy change.',
    source: 'human',
    status: 'tested',
    createdAt: '2026-09-30T23:00:00.000Z',
    evaluation: {
      cases: [],
      passed: 150,
      failed: 0,
      regressions: 0,
      impacts: [],
      beforeExceptions: workspace.result.summary.exceptions,
      afterExceptions: workspace.result.summary.exceptions,
      ranAt: '2026-09-30T23:00:00.000Z',
    },
    ...patch,
  };
}

describe('learning lens', () => {
  it('simulates a 48-month laptop life in isolation and exposes life-expiry reviews', () => {
    const workspace = approvedWorkspace();
    const beforePolicy = structuredClone(workspace.policy);
    const beforeDataset = structuredClone(workspace.dataset);
    const beforeRuns = structuredClone(workspace.runs);
    const beforeEvents = structuredClone(workspace.events);
    const beforeProposals = structuredClone(workspace.proposals);

    const experiment = simulateUsefulLife(workspace, 48);

    expect(experiment.persisted).toBe(false);
    expect(experiment.candidatePolicy.laptop.threshold).toBe(15_000);
    expect(experiment.candidatePolicy.laptop.usefulLifeMonths).toBe(48);
    expect(experiment.before.rows.find((row) => row.asset.rowId === 'ROW-001')?.calculated).toBe(500);
    expect(experiment.after.rows.find((row) => row.asset.rowId === 'ROW-001')?.calculated).toBe(375);
    expect(experiment.impacts).toContainEqual({ rowId: 'ROW-001', assetId: 'FA-001', before: 500, after: 375, difference: -125 });
    expect(experiment.after.rows.some((row) => row.findings.some((finding) => finding.code === 'life-exhausted-with-balance'))).toBe(true);
    expect(workspace.policy).toEqual(beforePolicy);
    expect(workspace.dataset).toEqual(beforeDataset);
    expect(workspace.runs).toEqual(beforeRuns);
    expect(workspace.events).toEqual(beforeEvents);
    expect(workspace.proposals).toEqual(beforeProposals);
    expect(() => simulateUsefulLife(workspace, 0)).toThrow(/whole number/);
    expect(() => simulateUsefulLife(workspace, 48.5)).toThrow(/whole number/);
  });

  it('grounds an explanation in the actual asset, policy, calculation, and matching lineage', () => {
    let workspace = approvedWorkspace();
    workspace = {
      ...workspace,
      objects: [
        makeObject('context', workspace.domain),
        makeObject('source', workspace.domain),
        makeObject('table', workspace.domain),
        makeObject('learning', workspace.domain),
        makeObject('overview', workspace.domain),
      ],
      events: [calculationEvent(workspace)],
    };

    const lens = deriveLearning(workspace, 'ROW-001');

    expect(lens.subjectId).toBe('FA-001');
    expect(lens.rowId).toBe('ROW-001');
    expect(lens.calculation).toMatchObject({ recorded: 500, calculated: 500, difference: 0 });
    expect(lens.policy.version).toBe(2);
    expect(lens.provenance.sourceRefs).toContain(workspace.dataset.id);
    expect(lens.provenance.sourceRefs).toContain('ROW-001');
    expect(lens.provenance.objectIds).toEqual(expect.arrayContaining(['source', 'table']));
    expect(lens.provenance.objectIds).not.toEqual(expect.arrayContaining(['context', 'learning', 'overview']));
    expect(lens.provenance.workerIds).toContain('depreciation-worker');
    expect(lens.provenance.events.map((event) => event.id)).toContain('EVENT-CALC-001');
    expect(lens.provenance.eventScopes['EVENT-CALC-001']).toContain('current-run');
    expect(lens.provenance.eventScopes['EVENT-CALC-001']).toContain('selected-row');
  });

  it('scopes row lineage to the same dataset, current run, and active-policy decision', () => {
    const base = approvedWorkspace();
    const previousDataset = createDataset('2026-09');
    const currentDataset = createDataset('2026-10');
    const previousResult = reconcile(previousDataset, base.policy);
    const currentResult = reconcile(currentDataset, base.policy);
    const snapshots: RunSnapshot[] = [
      {
        id: 'RUN-SEPTEMBER', createdAt: '2026-09-30T23:00:00.000Z', cause: 'Monthly replay · 2026-09',
        dataset: previousDataset, policy: base.policy, result: previousResult,
      },
      {
        id: 'RUN-OCTOBER-1', createdAt: '2026-10-15T23:00:00.000Z', cause: 'Correction replay',
        dataset: structuredClone(currentDataset), policy: base.policy, result: structuredClone(currentResult),
      },
      {
        id: 'RUN-OCTOBER-CURRENT', createdAt: '2026-10-31T23:00:00.000Z', cause: 'Monthly replay · 2026-10',
        dataset: structuredClone(currentDataset), policy: base.policy, result: structuredClone(currentResult),
      },
    ];
    const workspace: Workspace = {
      ...base,
      dataset: currentDataset,
      result: currentResult,
      runs: snapshots,
      events: [
        eventWith(base, 'EVENT-OLD-DATA-ROW-001', 'RUN-SEPTEMBER', {
          humanAction: 'case-correction', inputs: ['ROW-001'], outputs: ['ROW-001'],
        }),
        eventWith(base, 'EVENT-ROW-001-SAME-DATA', 'RUN-OCTOBER-1', {
          humanAction: 'case-correction', inputs: ['ROW-001'], outputs: ['ROW-001'],
        }),
        eventWith(base, 'EVENT-ROW-002-SAME-DATA', 'RUN-OCTOBER-1', {
          humanAction: 'case-correction', inputs: ['ROW-002'], outputs: ['ROW-002'],
        }),
        eventWith(base, 'EVENT-CURRENT-RUN', 'RUN-OCTOBER-CURRENT', {
          title: 'Executed current calculation', inputs: [currentDataset.id, 'policy-v2'],
        }),
        eventWith(base, 'EVENT-OTHER-ROW-CURRENT', 'RUN-OCTOBER-CURRENT', {
          humanAction: 'case-correction', inputs: ['ROW-002'], outputs: ['ROW-002'],
        }),
        eventWith(base, 'EVENT-POLICY-APPROVAL', 'RUN-SEPTEMBER', {
          title: 'Human approved the rule', workerId: 'local-human', workerType: 'human', humanAction: 'approve',
          ruleVersion: 2, inputs: ['PROPOSAL-002'], outputs: ['policy-v2'],
        }),
        eventWith(base, 'EVENT-OLD-POLICY-APPROVAL', 'RUN-SEPTEMBER', {
          workerType: 'human', humanAction: 'approve', ruleVersion: 1, outputs: ['policy-v1'],
        }),
        eventWith(base, 'EVENT-LEARNING-UI', 'RUN-OCTOBER-CURRENT', {
          workerType: 'orchestrator', workerId: 'learning-lens', inputs: [currentDataset.id, 'table'], outputs: ['learning-1'],
        }),
      ],
    };

    const lens = deriveLearning(workspace, 'ROW-001');
    const eventIds = lens.provenance.events.map((event) => event.id);

    expect(eventIds).toContain('EVENT-CURRENT-RUN');
    expect(eventIds).toContain('EVENT-ROW-001-SAME-DATA');
    expect(eventIds).toContain('EVENT-POLICY-APPROVAL');
    expect(eventIds).not.toContain('EVENT-OLD-DATA-ROW-001');
    expect(eventIds).not.toContain('EVENT-ROW-002-SAME-DATA');
    expect(eventIds).not.toContain('EVENT-OTHER-ROW-CURRENT');
    expect(eventIds).not.toContain('EVENT-OLD-POLICY-APPROVAL');
    expect(eventIds).not.toContain('EVENT-LEARNING-UI');
    expect(lens.provenance.eventScopes['EVENT-ROW-001-SAME-DATA']).toEqual(['selected-row']);
    expect(lens.provenance.eventScopes['EVENT-POLICY-APPROVAL']).toEqual(['active-policy']);
  });

  it('resolves a generic canvas subject to its actual object without inventing a row', () => {
    const base = approvedWorkspace();
    const source = makeObject('source', base.domain);
    const worker = makeObject('worker', base.domain);
    const table = makeObject('table', base.domain);
    const workspace: Workspace = {
      ...base,
      objects: [source, worker, table],
      events: [eventWith(base, 'EVENT-TABLE-CREATED', 'RUN-CURRENT', {
        workerType: 'orchestrator', workerId: 'workspace-builder', inputs: [base.dataset.id], outputs: ['table'],
      })],
    };

    const lens = deriveLearning(workspace, 'table');

    expect(lens.title).toBe(table.title);
    expect(lens.purpose).toContain('reconciliation');
    expect(lens.rowId).toBeNull();
    expect(lens.subjectId).toBe('table');
    expect(lens.inputs.find((input) => input.label === 'Canvas object')?.value).toBe(table.title);
    expect(lens.inputs.find((input) => input.label === 'Dependencies')?.value).toContain('Calculation worker');
    expect(lens.provenance.objectIds).toContain('table');
    expect(lens.provenance.eventScopes['EVENT-TABLE-CREATED']).toContain('selected-object');
  });

  it('explains maintenance findings from current equipment state', () => {
    const workspace = newWorkspace('maintenance');
    const lens = deriveLearning(workspace, 'EQ-005');

    expect(lens.subjectId).toBe('EQ-005');
    expect(lens.calculation).toBeNull();
    expect(lens.status).toBe('review');
    expect(lens.inputs.find((input) => input.label === 'Priority')?.value).toBe('urgent');
    expect(lens.findings[0]?.message).toMatch(/repair/i);
  });

  it('shows configured category rules in the Learning Lens calculation inputs', () => {
    const base = approvedWorkspace();
    const asset = base.dataset.assets.find((item) => item.category === 'Furniture');
    expect(asset).toBeDefined();
    if (asset === undefined) return;
    const policy = withCategoryPolicy(base.policy, 'Furniture', {
      threshold: 10_000,
      usefulLifeMonths: 48,
      start: 'in-service',
    });
    const workspace = { ...base, policy, result: reconcile(base.dataset, policy) };
    const lens = deriveLearning(workspace, asset.rowId);

    expect(lens.inputs.find((input) => input.label === 'Threshold')?.value).toBe(10_000);
    expect(lens.inputs.find((input) => input.label === 'Useful life (months)')?.value).toBe(48);
    expect(lens.inputs.find((input) => input.label === 'Start rule')?.value).toBe('in-service');
  });

  it('derives a concise evidence-based workflow and core references from current state', () => {
    let workspace = approvedWorkspace();
    workspace = {
      ...workspace,
      title: 'Northstar monthly close',
      prompt: 'Explain the current monthly close.',
      objects: [
        makeObject('context', workspace.domain),
        makeObject('source', workspace.domain),
        makeObject('worker', workspace.domain),
        makeObject('table', workspace.domain),
        makeObject('exceptions', workspace.domain),
        makeObject('learning', workspace.domain),
        makeObject('overview', workspace.domain),
      ],
      events: [calculationEvent(workspace)],
    };

    const explanation = explainWorkspace(workspace);

    expect(explanation.purpose).toBe(workspace.prompt);
    expect(explanation.workflow).toHaveLength(4);
    expect(explanation.workflow[0]).toContain(`Source: ${workspace.dataset.assets.length} asset rows and ${workspace.dataset.ledger.length} GL postings`);
    expect(explanation.workflow[1]).toContain('accounting.ts#calculateMonthly');
    expect(explanation.workflow[1]).toContain('active policy v2');
    expect(explanation.workflow[2]).toContain(`Current results: ${workspace.result.summary.matched} matched`);
    expect(explanation.workflow[3]).toContain('Review queue:');
    expect(explanation.workflow.join(' ')).not.toContain('Learning lens');
    expect(explanation.workflow.join(' ')).not.toContain('· ready');
    expect(explanation.activeCapabilities.join(' ')).toContain('15,000');
    expect(explanation.recentChanges.join(' ')).toContain('Calculated monthly depreciation');
    expect(explanation.attention.length).toBeGreaterThan(0);
    expect(explanation.objectRefs).toEqual(['source', 'worker', 'table', 'exceptions']);
  });

  it('keeps ledger findings ahead of truncated asset findings and includes open handoffs in attention', () => {
    const base = newWorkspace('accounting');
    const rows = base.result.rows.map((row) => ({
      ...row,
      status: 'review' as const,
      findings: [{ code: 'asset-review', message: `Review ${row.asset.rowId}.`, severity: 'warning' as const }],
    }));
    const ledgerFinding = {
      entry: base.dataset.ledger[0]!,
      finding: { code: 'orphan-ledger-entry', message: 'Ledger posting has no asset row.', severity: 'error' as const },
    };
    const workspace: Workspace = {
      ...base,
      objects: [makeObject('exceptions', base.domain)],
      result: {
        ...base.result,
        rows,
        ledgerFindings: [ledgerFinding],
        summary: { ...base.result.summary, exceptions: rows.length + 1 },
      },
      handoffs: [
        { rowId: rows[0]!.asset.rowId, owner: 'Finance', status: 'waiting', attempts: [] },
        { rowId: rows[1]!.asset.rowId, datasetId: 'northstar-2026-08', owner: 'Finance', status: 'waiting', attempts: [] },
      ],
    };

    const explanation = explainWorkspace(workspace);

    expect(explanation.attention[0]).toContain('Ledger posting has no asset row.');
    expect(explanation.attention).toContain('1 open handoff remains.');
    expect(explanation.attention).toHaveLength(8);
    expect(explanation.workflow).toEqual([
      `Review queue: ${rows.length} asset rows and 1 GL postings need review.`,
    ]);
  });

  it('recommends approval only for a passing proposal against the active policy', () => {
    const base = approvedWorkspace();
    const failedProposal = evaluationProposal(base, {
      evaluation: {
        ...evaluationProposal(base, {}).evaluation!,
        passed: 149,
        failed: 1,
        cases: [{ id: 'threshold', title: 'Laptop threshold', group: 'new', expected: 15_000, actual: 20_000, passed: false }],
      },
    });
    const failedWorkspace = { ...base, proposals: [failedProposal], activeProposalId: failedProposal.id };
    expect(explainWorkspace(failedWorkspace).nextActions.join(' ')).toMatch(/1 failed verification case.*revise.*retesting/i);

    const staleProposal = evaluationProposal(base, {
      before: { ...base.policy, version: 1 },
    });
    const staleWorkspace = { ...base, proposals: [staleProposal], activeProposalId: staleProposal.id };
    expect(explainWorkspace(staleWorkspace).nextActions.join(' ')).toMatch(/Create a new proposal against active policy v2/i);

    const passingProposal = evaluationProposal(base, {});
    const approval = eventWith(base, 'EVENT-POLICY-APPROVAL', 'RUN-CURRENT', {
      title: 'Human approved the rule', workerType: 'human', workerId: 'local-human', humanAction: 'approve',
      ruleVersion: 2, outputs: ['policy-v2'],
    });
    const passingWorkspace = {
      ...base,
      proposals: [passingProposal],
      activeProposalId: passingProposal.id,
      events: [approval],
    };
    const explanation = explainWorkspace(passingWorkspace);
    expect(explanation.nextActions.join(' ')).toMatch(/passed verification.*explicitly approve or reject/i);
    expect(explanation.activeCapabilities.join(' ')).toContain('recorded human approval');
  });

  it('keeps recent changes in event order and filters contextual-card creation events', () => {
    const base = approvedWorkspace();
    const events = [
      eventWith(base, 'EVENT-OLDER-APPROVAL', 'RUN-CURRENT', {
        title: 'Human approved the rule', workerType: 'human', workerId: 'local-human', humanAction: 'approve',
        ruleVersion: 2, outputs: ['policy-v2'], startedAt: '2026-09-20T00:00:00.000Z',
      }),
      eventWith(base, 'EVENT-CORRECTION', 'RUN-CURRENT', {
        title: 'Corrected one source record', workerType: 'human', humanAction: 'case-correction',
        inputs: ['ROW-002'], outputs: ['ROW-002'], startedAt: '2026-09-28T00:00:00.000Z',
      }),
      eventWith(base, 'EVENT-REPLAY', 'RUN-CURRENT', {
        title: 'Recalculated after record correction', workerType: 'deterministic',
        startedAt: '2026-09-28T00:00:01.000Z',
      }),
      eventWith(base, 'EVENT-NEXT-MONTH', 'RUN-CURRENT', {
        title: 'Monthly replay · 2026-10', workerType: 'deterministic',
        startedAt: '2026-10-01T00:00:00.000Z',
      }),
      eventWith(base, 'EVENT-OPENED-LEARNING', 'RUN-CURRENT', {
        title: 'Opened Learning Lens', workerType: 'orchestrator', workerId: 'learning-lens',
        startedAt: '2026-10-02T00:00:00.000Z',
      }),
      eventWith(base, 'EVENT-EXPLAINED-WORKSPACE', 'RUN-CURRENT', {
        title: 'Explained this workspace', workerType: 'orchestrator', workerId: 'workspace-explainer',
        startedAt: '2026-10-03T00:00:00.000Z',
      }),
    ];

    const explanation = explainWorkspace({ ...base, events });

    expect(explanation.recentChanges[0]).toContain('Monthly replay · 2026-10');
    expect(explanation.recentChanges.join(' ')).toContain('Corrected one source record');
    expect(explanation.recentChanges.join(' ')).toContain('Human approved the rule');
    expect(explanation.recentChanges.join(' ')).not.toContain('Opened Learning Lens');
    expect(explanation.recentChanges.join(' ')).not.toContain('Explained this workspace');
  });
});
