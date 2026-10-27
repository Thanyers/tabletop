import type { CategoryPolicyRule, EquipmentResult, Evaluation, Finding, Policy, Reconciliation } from './types';
import type { CanvasObject, Handoff, Proposal, RunSnapshot, TraceEvent, Workspace } from '../state/types';

export type KnowledgeCategory = 'question' | 'source' | 'worker' | 'rule' | 'person' | 'exception' | 'test' | 'outcome';
export type KnowledgeStatus = 'active' | 'approved' | 'pending' | 'failed' | 'rejected' | 'unknown';
export type KnowledgeRelation =
  | 'derived_from'
  | 'produced_by'
  | 'corrected_by'
  | 'approved_by'
  | 'tested_by'
  | 'supersedes'
  | 'depends_on'
  | 'used_by'
  | 'handed_off_to'
  | 'references';

export interface KnowledgeNode {
  id: string;
  title: string;
  category: KnowledgeCategory;
  status: KnowledgeStatus;
  summary: string;
  detail: string[];
  workObjectId?: string;
  rowId?: string;
  datasetId?: string;
  runId?: string;
  ruleVersion?: number;
  evidenceRefs: string[];
  x: number;
  y: number;
}

export interface KnowledgeLink {
  id: string;
  fromId: string;
  toId: string;
  relation: KnowledgeRelation;
  evidenceRefs: string[];
}

export interface KnowledgeGraph {
  nodes: KnowledgeNode[];
  links: KnowledgeLink[];
}

interface Coordinate {
  x: number;
  y: number;
}

interface ExceptionGroup {
  key: string;
  title: string;
  summary: string;
  detail: string[];
  status: KnowledgeStatus;
  rowIds: string[];
  evidenceRefs: string[];
}

const CATEGORY_ORIGINS: Record<KnowledgeCategory, Coordinate> = {
  question: { x: 415, y: 20 },
  source: { x: 35, y: 180 },
  worker: { x: 270, y: 235 },
  rule: { x: 705, y: 25 },
  person: { x: 825, y: 260 },
  exception: { x: 470, y: 325 },
  test: { x: 760, y: 430 },
  outcome: { x: 160, y: 455 },
};

const CATEGORY_SPACING_X = 190;
const CATEGORY_SPACING_Y = 175;
const SECONDARY_WORKER_POSITION: Coordinate = { x: 210, y: 20 };
const MAX_DEFAULT_EXCEPTION_GROUPS = 1;
const MAX_DETAIL_EXAMPLES = 4;

function refs(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim() !== '')));
}

function amount(value: number): string {
  return `฿${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function policyReference(version: number): string {
  return `policy-v${version}`;
}

function evaluationReference(proposalId: string): string {
  return `evaluation:${proposalId}`;
}

function sameReference(values: readonly string[], expected: string): boolean {
  return values.includes(expected);
}

function eventRun(workspace: Workspace, event: TraceEvent): RunSnapshot | undefined {
  return workspace.runs.find((run) => run.id === event.runId);
}

function eventApprovesPolicy(workspace: Workspace, event: TraceEvent, version: number): boolean {
  if (event.workerType !== 'human' || event.ruleVersion !== version) return false;
  if (event.humanAction === 'approve' && sameReference(event.outputs, policyReference(version))) return true;
  if (event.humanAction !== 'rollback') return false;
  return eventRun(workspace, event)?.policy.version === version;
}

function proposalStatus(proposal: Proposal): KnowledgeStatus {
  if (proposal.status === 'approved') return 'approved';
  if (proposal.status === 'rejected') return 'rejected';
  if (proposal.evaluation?.failed !== undefined && proposal.evaluation.failed > 0) return 'failed';
  return 'pending';
}

function policyDetails(policy: Policy): string[] {
  const detail = [
    `Default threshold: ${amount(policy.defaultThreshold)}.`,
    `Laptop rule: ${amount(policy.laptop.threshold)}, ${policy.laptop.usefulLifeMonths} months, starts ${policy.laptop.start}.`,
  ];
  for (const [category, rule] of Object.entries(policy.categoryRules ?? {})) {
    const ruleDetail = categoryRuleDescription(category, rule);
    detail.push(ruleDetail);
  }
  detail.push(`Recorded policy source: ${policy.source}.`);
  return detail;
}

function categoryRuleDescription(category: string, rule: CategoryPolicyRule): string {
  const threshold = rule.threshold === undefined ? 'default threshold' : amount(rule.threshold);
  const life = rule.usefulLifeMonths === undefined ? 'source useful life' : `${rule.usefulLifeMonths} months`;
  const start = rule.start ?? 'following-month';
  return `${category} override: ${threshold}; ${life}; starts ${start}.`;
}

function proposalDetail(proposal: Proposal): string[] {
  const detail = [
    `Based on policy v${proposal.before.version}; candidate policy v${proposal.candidate.version}.`,
    proposal.instruction,
    ...policyDetails(proposal.candidate),
  ];
  if (proposal.evaluation !== undefined) {
    detail.push(`Stored evaluation: ${proposal.evaluation.passed} passed, ${proposal.evaluation.failed} failed, ${proposal.evaluation.impacts.length} calculated outputs changed.`);
  } else {
    detail.push('No saved evaluation is attached to this proposal.');
  }
  return detail;
}

function evaluationStatus(proposal: Proposal, evaluation: Evaluation): KnowledgeStatus {
  if (evaluation.failed > 0) return 'failed';
  if (proposal.status === 'rejected') return 'rejected';
  if (proposal.status === 'approved') return 'approved';
  return 'pending';
}

function evaluationDetail(evaluation: Evaluation): string[] {
  const examples = evaluation.cases.slice(0, MAX_DETAIL_EXAMPLES).map((testCase) => {
    const result = testCase.passed ? 'Passed' : 'Failed';
    return `${result}: ${testCase.title} (expected ${String(testCase.expected)}; actual ${String(testCase.actual)}).`;
  });
  if (evaluation.cases.length > MAX_DETAIL_EXAMPLES) {
    examples.push(`${evaluation.cases.length - MAX_DETAIL_EXAMPLES} additional stored test cases are available in the proposal evaluation.`);
  }
  if (evaluation.cases.length === 0) examples.push('The stored evaluation contains no case-level details.');
  return examples;
}

function exceptionGroups(result: Reconciliation, datasetId: string): ExceptionGroup[] {
  const groups = new Map<string, { finding: Finding; rows: Set<string>; ledgerIds: Set<string> }>();
  for (const row of result.rows) {
    for (const finding of row.findings) {
      const group = groups.get(finding.code) ?? { finding, rows: new Set<string>(), ledgerIds: new Set<string>() };
      group.rows.add(row.asset.rowId);
      groups.set(finding.code, group);
    }
  }
  for (const item of result.ledgerFindings) {
    const group = groups.get(item.finding.code) ?? { finding: item.finding, rows: new Set<string>(), ledgerIds: new Set<string>() };
    if (item.entry.id.trim() !== '') group.ledgerIds.add(item.entry.id);
    groups.set(item.finding.code, group);
  }

  return Array.from(groups.entries())
    .sort(([leftCode, left], [rightCode, right]) => {
      const leftLedgerPriority = left.ledgerIds.size > 0 ? 1 : 0;
      const rightLedgerPriority = right.ledgerIds.size > 0 ? 1 : 0;
      return rightLedgerPriority - leftLedgerPriority
        || right.rows.size + right.ledgerIds.size - (left.rows.size + left.ledgerIds.size)
        || leftCode.localeCompare(rightCode);
    })
    .map(([code, group]) => {
      const rowIds = Array.from(group.rows);
      const ledgerIds = Array.from(group.ledgerIds);
      const details = [group.finding.message];
      if (rowIds.length > 0) details.push(`Affected asset rows: ${rowIds.slice(0, MAX_DETAIL_EXAMPLES).join(', ')}${rowIds.length > MAX_DETAIL_EXAMPLES ? ', …' : ''}.`);
      if (ledgerIds.length > 0) details.push(`Affected GL postings: ${ledgerIds.slice(0, MAX_DETAIL_EXAMPLES).join(', ')}${ledgerIds.length > MAX_DETAIL_EXAMPLES ? ', …' : ''}.`);
      return {
        key: code,
        title: `${group.ledgerIds.size > 0 ? 'GL posting' : 'Asset'} · ${code.replaceAll('-', ' ')}`,
        summary: `${rowIds.length} asset rows and ${ledgerIds.length} GL postings; ${group.finding.message}`,
        detail: details,
        status: group.finding.severity === 'error' ? 'failed' as const : 'pending' as const,
        rowIds,
        evidenceRefs: refs([datasetId, ...rowIds, ...ledgerIds]),
      };
    });
}

function equipmentExceptionGroups(run: RunSnapshot | undefined): ExceptionGroup[] {
  const results = run?.equipmentResults ?? [];
  const groups = new Map<EquipmentResult['priority'], EquipmentResult[]>();
  for (const result of results) {
    if (result.priority === 'healthy') continue;
    const group = groups.get(result.priority) ?? [];
    group.push(result);
    groups.set(result.priority, group);
  }
  return Array.from(groups.entries()).map(([priority, items]) => ({
    key: `equipment-${priority}`,
    title: `${priority === 'urgent' ? 'Urgent' : 'Upcoming'} equipment attention`,
    summary: `${items.length} equipment records are ${priority}; ${items[0]?.reason ?? 'the saved evaluation requires review.'}`,
    detail: items.slice(0, MAX_DETAIL_EXAMPLES).map((item) => `${item.equipment.id} · ${item.equipment.name}: ${item.reason}`),
    status: priority === 'urgent' ? 'failed' : 'pending',
    rowIds: items.map((item) => item.equipment.id),
    evidenceRefs: refs([run?.id, ...items.map((item) => item.equipment.id)]),
  }));
}

function reconciliationSummary(workspace: Workspace, result: Reconciliation, run?: RunSnapshot): string {
  if (workspace.domain === 'maintenance') {
    const equipmentResults = run?.equipmentResults;
    if (equipmentResults === undefined) return `Current equipment inventory contains ${workspace.equipment.length} records; no saved equipment run is available.`;
    const attention = equipmentResults.filter((item) => item.priority !== 'healthy').length;
    return `${equipmentResults.length} equipment records evaluated; ${attention} need attention.`;
  }
  return `${result.summary.matched} matched; ${result.summary.exceptions} require review; ${amount(result.summary.calculated)} calculated for ${run?.dataset.period ?? workspace.dataset.period}.`;
}

function currentRunFor(workspace: Workspace): RunSnapshot | undefined {
  for (let index = workspace.runs.length - 1; index >= 0; index -= 1) {
    const run = workspace.runs[index];
    if (run.dataset.id === workspace.dataset.id && run.policy.version === workspace.policy.version) return run;
  }
  return undefined;
}

function runContainsRecord(workspace: Workspace, run: RunSnapshot, rowId: string): boolean {
  if (workspace.domain === 'accounting') return run.dataset.assets.some((asset) => asset.rowId === rowId);
  return run.equipmentSnapshot?.some((equipment) => equipment.id === rowId) ?? false;
}

function sortedEvents(events: readonly TraceEvent[]): TraceEvent[] {
  return [...events].sort((left, right) => left.startedAt.localeCompare(right.startedAt) || left.id.localeCompare(right.id));
}

function proposalEvaluationEvents(workspace: Workspace, proposalId: string): TraceEvent[] {
  const events = sortedEvents(workspace.events.filter((event) =>
    event.outputs.includes(evaluationReference(proposalId)) && event.inputs.includes(proposalId),
  ));
  return events.slice(-1);
}

export function deriveKnowledge(workspace: Workspace, includeHistory = false): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const links: KnowledgeLink[] = [];
  const categoryIndexes = new Map<KnowledgeCategory, number>();
  const objectNodeIds = new Map<string, string>();
  const policyNodeIds = new Map<number, string>();
  const workerNodeIds = new Map<string, string>();
  const proposalNodeIds = new Map<string, string>();
  const testNodeIds = new Map<string, string>();

  function addNode(node: Omit<KnowledgeNode, 'x' | 'y'>): KnowledgeNode {
    const index = categoryIndexes.get(node.category) ?? 0;
    categoryIndexes.set(node.category, index + 1);
    const origin = CATEGORY_ORIGINS[node.category];
    const column = index % 2;
    const row = Math.floor(index / 2);
    const curatedPosition = node.category === 'worker' && index === 1 ? SECONDARY_WORKER_POSITION : undefined;
    const positioned: KnowledgeNode = {
      ...node,
      x: curatedPosition?.x ?? origin.x + column * CATEGORY_SPACING_X,
      y: curatedPosition?.y ?? origin.y + row * CATEGORY_SPACING_Y + column * 28,
    };
    nodes.push(positioned);
    return positioned;
  }

  function addLink(fromId: string | undefined, toId: string | undefined, relation: KnowledgeRelation, evidenceRefs: string[]): void {
    const evidence = refs(evidenceRefs);
    if (fromId === undefined || toId === undefined || fromId === toId || evidence.length === 0) return;
    if (!nodes.some((node) => node.id === fromId) || !nodes.some((node) => node.id === toId)) return;
    const id = `${fromId}:${relation}:${toId}`;
    if (links.some((link) => link.id === id)) return;
    links.push({ id, fromId, toId, relation, evidenceRefs: evidence });
  }

  const questionObject = workspace.objects.find((object) => object.kind === 'context' || object.kind === 'intake');
  const hasQuestion = workspace.prompt.trim() !== '';
  const question = addNode({
    id: 'question:workspace',
    title: hasQuestion ? 'The current question' : 'Workspace context',
    category: 'question',
    status: hasQuestion ? 'active' : 'unknown',
    summary: hasQuestion ? workspace.prompt.trim() : `No problem statement is recorded. Workspace: ${workspace.title}.`,
    detail: hasQuestion
      ? [workspace.prompt.trim(), `Workspace: ${workspace.title}.`]
      : [`Workspace title: ${workspace.title}.`, 'No user question is recorded in the current workspace.'],
    ...(questionObject === undefined ? {} : { workObjectId: questionObject.id }),
    evidenceRefs: [],
  });
  if (questionObject !== undefined) objectNodeIds.set(questionObject.id, question.id);

  const sourceObjects = workspace.objects.filter((object) => object.kind === 'source');
  const currentDataset = workspace.dataset;
  const activeRun = currentRunFor(workspace);
  const activeLedgerCount = currentDataset.ledger.filter((entry) => entry.period === currentDataset.period).length;
  const sourceSummary = workspace.domain === 'accounting'
    ? `${currentDataset.assets.length} asset rows and ${activeLedgerCount} GL postings for ${currentDataset.period}.`
    : `${workspace.equipment.length} equipment records in the current workspace.`;
  const sourceObjectsToRender: Array<CanvasObject | undefined> = sourceObjects.length > 0 ? sourceObjects : [undefined];
  const sourceNodeIds: string[] = [];
  for (const object of sourceObjectsToRender) {
    const sourceNode = addNode({
      id: `source:${object?.id ?? currentDataset.id}`,
      title: object?.title ?? currentDataset.name,
      category: 'source',
      status: 'active',
      summary: sourceSummary,
      detail: [
        `Dataset: ${currentDataset.name} (${currentDataset.id}).`,
        `Reporting period: ${currentDataset.period}.`,
        ...(workspace.sourceConnections??[]).map(c=>`${c.kind}: ${c.resource} · ${c.rowCount} rows · ${c.mode}.`),
        ...currentDataset.assets.slice(0, 2).map((asset) => `${asset.rowId} · ${asset.assetId} · ${asset.description}.`),
      ],
      ...(object === undefined ? {} : { workObjectId: object.id }),
      datasetId: currentDataset.id,
      ...(activeRun === undefined ? {} : { runId: activeRun.id }),
      evidenceRefs: refs([currentDataset.id, ...(object?.dataRefs ?? []), ...(object === undefined ? [] : [object.id])]),
    });
    sourceNodeIds.push(sourceNode.id);
    if (object !== undefined) objectNodeIds.set(object.id, sourceNode.id);
  }
  for (const sourceNodeId of sourceNodeIds) {
    addLink(question.id, sourceNodeId, 'depends_on', [currentDataset.id, sourceNodeId]);
  }

  const outcomeResult = activeRun?.result ?? workspace.result;
  const outcomeDatasetId = activeRun?.dataset.id ?? workspace.dataset.id;
  const outcomePolicy = activeRun?.policy ?? workspace.policy;
  const currentResultVerified = activeRun !== undefined
    || (workspace.domain === 'accounting'
      && workspace.result.summary.totalAssets === workspace.dataset.assets.length
      && workspace.result.rows.every((row) => row.ruleVersion === workspace.policy.version));
  const currentSummary = reconciliationSummary(workspace, outcomeResult, activeRun);
  const currentOutcomeObjects = workspace.objects.filter((object) => object.kind === 'table' || object.kind === 'dashboard');
  const outcomeObjectsToRender: Array<CanvasObject | undefined> = currentOutcomeObjects.length > 0 ? currentOutcomeObjects : [undefined];
  const currentOutcomeNodeIds: string[] = [];
  for (const object of outcomeObjectsToRender) {
    const outcome = addNode({
      id: `outcome:${object?.id ?? activeRun?.id ?? `${outcomeDatasetId}:${outcomePolicy.version}`}`,
      title: object?.title ?? `Current outcome · ${workspace.dataset.period}`,
      category: 'outcome',
      status: currentResultVerified ? 'active' : 'unknown',
      summary: currentSummary,
      detail: [
        `Dataset snapshot: ${outcomeDatasetId}.`,
        `Policy snapshot: v${outcomePolicy.version}.`,
        activeRun === undefined ? 'Shown from the workspace current result.' : `Run: ${activeRun.id} · ${activeRun.cause}.`,
        ...(!currentResultVerified ? ['The current result does not carry a matching active policy version; verification is unknown.'] : []),
      ],
      ...(object === undefined ? {} : { workObjectId: object.id }),
      datasetId: outcomeDatasetId,
      ...(activeRun === undefined ? {} : { runId: activeRun.id }),
      ruleVersion: outcomePolicy.version,
      evidenceRefs: refs([outcomeDatasetId, policyReference(outcomePolicy.version), ...(activeRun === undefined ? [] : [activeRun.id])]),
    });
    currentOutcomeNodeIds.push(outcome.id);
    if (object !== undefined) objectNodeIds.set(object.id, outcome.id);
  }

  const includedProposals = includeHistory
    ? workspace.proposals
    : workspace.activeProposalId === null
      ? []
      : workspace.proposals.filter((proposal) => proposal.id === workspace.activeProposalId);
  for (const proposal of includedProposals) {
    const proposalObject = workspace.objects.find((object) => object.kind === 'proposal');
    const node = addNode({
      id: `proposal:${proposal.id}`,
      title: proposal.instruction.trim() || `Reusable policy proposal v${proposal.candidate.version}`,
      category: 'rule',
      status: proposalStatus(proposal),
      summary: `Policy v${proposal.before.version} → v${proposal.candidate.version}; proposal is ${proposal.status}.`,
      detail: proposalDetail(proposal),
      ...(proposalObject === undefined
        ? {}
        : { workObjectId: proposalObject.id }),
      ruleVersion: proposal.candidate.version,
      evidenceRefs: refs([
        proposal.id,
        policyReference(proposal.before.version),
        policyReference(proposal.candidate.version),
        ...(proposal.evaluation === undefined ? [] : [evaluationReference(proposal.id)]),
      ]),
    });
    proposalNodeIds.set(proposal.id, node.id);
    if (proposalObject !== undefined) objectNodeIds.set(proposalObject.id, node.id);
  }

  const includedTests = includedProposals.filter((proposal) => proposal.evaluation !== undefined);
  for (const proposal of includedTests) {
    const evaluation = proposal.evaluation;
    if (evaluation === undefined) continue;
    const storedEvaluationEvents = proposalEvaluationEvents(workspace, proposal.id);
    const knownDatasetIds = new Set([workspace.dataset.id, ...workspace.runs.map((run) => run.dataset.id)]);
    const evaluationDatasetRefs = refs(storedEvaluationEvents.flatMap((event) => {
      const inputDatasets = event.inputs.filter((input) => knownDatasetIds.has(input));
      const runDataset = workspace.runs.find((run) => run.id === event.runId)?.dataset.id;
      return [...inputDatasets, ...(runDataset === undefined ? [] : [runDataset])];
    }));
    const evaluationDatasetId = evaluationDatasetRefs.length === 1 ? evaluationDatasetRefs[0] : undefined;
    const evaluationRunId = storedEvaluationEvents.length === 1
      && workspace.runs.some((run) => run.id === storedEvaluationEvents[0]?.runId)
      ? storedEvaluationEvents[0]?.runId
      : undefined;
    const evaluationObject = workspace.objects.find((object) => object.kind === 'evaluation');
    const node = addNode({
      id: `test:${proposal.id}`,
      title: `Verification · policy v${proposal.candidate.version}`,
      category: 'test',
      status: evaluationStatus(proposal, evaluation),
      summary: `${evaluation.passed} passed, ${evaluation.failed} failed, ${evaluation.regressions} regressions; ${evaluation.impacts.length} calculated outputs changed.`,
      detail: [
        `Stored evaluation timestamp: ${evaluation.ranAt}.`,
        `Compared ${evaluation.beforeExceptions} review items before with ${evaluation.afterExceptions} after.`,
        ...(storedEvaluationEvents.length === 0
          ? ['No test-run event records the dataset input for this saved evaluation.']
          : storedEvaluationEvents.map((event) => {
            const eventDatasets = refs([
              ...event.inputs.filter((input) => knownDatasetIds.has(input)),
              workspace.runs.find((run) => run.id === event.runId)?.dataset.id,
            ]);
            return `Test run ${event.id} recorded dataset input${eventDatasets.length === 1 ? '' : 's'} ${eventDatasets.join(', ') || 'not identified'}.`;
          })),
        ...evaluationDetail(evaluation),
      ],
      ...(evaluationObject === undefined
        ? {}
        : { workObjectId: evaluationObject.id }),
      ...(evaluationDatasetId === undefined ? {} : { datasetId: evaluationDatasetId }),
      ...(evaluationRunId === undefined ? {} : { runId: evaluationRunId }),
      ruleVersion: proposal.candidate.version,
      evidenceRefs: refs([proposal.id, evaluationReference(proposal.id), policyReference(proposal.candidate.version), ...storedEvaluationEvents.map((event) => event.id), ...evaluationDatasetRefs]),
    });
    testNodeIds.set(proposal.id, node.id);
    if (evaluationObject !== undefined) objectNodeIds.set(evaluationObject.id, node.id);
  }

  const activeApprovalEvents = workspace.events.filter((event) => eventApprovesPolicy(workspace, event, workspace.policy.version));
  const approvedProposalForActivePolicy = workspace.proposals.find((proposal) =>
    proposal.candidate.version === workspace.policy.version && proposal.status === 'approved' && proposal.approvalRef !== undefined,
  );
  const activePolicyNode = addNode({
    id: `policy:${workspace.policy.version}`,
    title: `Active policy · v${workspace.policy.version}`,
    category: 'rule',
    status: approvedProposalForActivePolicy !== undefined || activeApprovalEvents.length > 0 ? 'approved' : 'active',
    summary: `Active depreciation policy v${workspace.policy.version} from ${workspace.policy.source}.`,
    detail: policyDetails(workspace.policy),
    ...(workspace.objects.find((object) => object.kind === 'knowledge') === undefined
      ? {}
      : { workObjectId: workspace.objects.find((object) => object.kind === 'knowledge')?.id }),
    ruleVersion: workspace.policy.version,
    evidenceRefs: refs([policyReference(workspace.policy.version), ...(approvedProposalForActivePolicy === undefined ? [] : [approvedProposalForActivePolicy.id])]),
  });
  policyNodeIds.set(workspace.policy.version, activePolicyNode.id);
  if (workspace.objects.some((object) => object.kind === 'knowledge')) {
    const knowledgeObject = workspace.objects.find((object) => object.kind === 'knowledge');
    if (knowledgeObject !== undefined) objectNodeIds.set(knowledgeObject.id, activePolicyNode.id);
  }

  const currentResultGroups = workspace.domain === 'accounting'
    ? exceptionGroups(outcomeResult, outcomeDatasetId)
    : equipmentExceptionGroups(activeRun);
  const exceptionObject = workspace.objects.find((object) => object.kind === 'exceptions');
  const currentHandoffs = workspace.handoffs.filter((handoff) => {
    if (includeHistory) return true;
    const runDatasetId = handoff.runId === undefined
      ? undefined
      : workspace.runs.find((run) => run.id === handoff.runId)?.dataset.id;
    const scopedDatasetId = handoff.datasetId ?? runDatasetId;
    if (handoff.datasetId !== undefined && runDatasetId !== undefined && handoff.datasetId !== runDatasetId) return false;
    return (scopedDatasetId === undefined || scopedDatasetId === workspace.dataset.id)
      && handoff.status !== 'resolved'
      && handoff.status !== 'rejected';
  });
  const includedHandoffs = currentHandoffs;
  const handoffActions = new Set(['retry', 'continue', 'reject', 'resolve']);
  const isRecordedHandoffAction = (event: TraceEvent): boolean => {
    if (event.workerType !== 'human' || !handoffActions.has(event.humanAction ?? '')) return false;
    return includedHandoffs.some((handoff) => {
      if (handoff.runId === undefined || event.runId !== handoff.runId) return false;
      if (![...event.inputs, ...event.outputs].includes(handoff.rowId)) return false;
      const run = eventRun(workspace, event);
      const datasetId = handoff.datasetId ?? run?.dataset.id;
      return run !== undefined
        && datasetId === run.dataset.id
        && runContainsRecord(workspace, run, handoff.rowId);
    });
  };
  const exceptionNodeIds: string[] = [];
  const handoffNodeEntries: Array<{ handoff: Handoff; node: KnowledgeNode }> = [];
  for (const group of currentResultGroups.slice(0, includeHistory ? currentResultGroups.length : MAX_DEFAULT_EXCEPTION_GROUPS)) {
    const node = addNode({
      id: `exception:${outcomeDatasetId}:${group.key}`,
      title: group.title,
      category: 'exception',
      status: group.status,
      summary: group.summary,
      detail: group.detail,
      ...(exceptionObject === undefined ? {} : { workObjectId: exceptionObject.id }),
      ...(group.rowIds[0] === undefined ? {} : { rowId: group.rowIds[0] }),
      datasetId: outcomeDatasetId,
      ...(activeRun === undefined ? {} : { runId: activeRun.id }),
      ruleVersion: outcomePolicy.version,
      evidenceRefs: group.evidenceRefs,
    });
    exceptionNodeIds.push(node.id);
    if (exceptionObject !== undefined && !objectNodeIds.has(exceptionObject.id)) objectNodeIds.set(exceptionObject.id, node.id);
    for (const outcomeId of currentOutcomeNodeIds) {
      addLink(node.id, outcomeId, 'derived_from', refs([outcomeDatasetId, ...group.evidenceRefs]));
    }
  }

  for (const handoff of includedHandoffs) {
    const handoffRun = handoff.runId === undefined ? undefined : workspace.runs.find((run) => run.id === handoff.runId);
    const runDatasetId = handoffRun?.dataset.id;
    const scopedDatasetId = handoff.datasetId ?? runDatasetId;
    const scopeConflict = handoff.datasetId !== undefined && runDatasetId !== undefined && handoff.datasetId !== runDatasetId;
    const status: KnowledgeStatus = scopedDatasetId === undefined || scopeConflict
      ? 'unknown'
      : handoff.status === 'rejected'
      ? 'rejected'
      : handoff.status === 'resolved'
        ? 'active'
        : 'pending';
    const node = addNode({
      id: `exception:handoff:${scopedDatasetId ?? 'legacy'}:${handoff.rowId}`,
      title: `Handoff · ${handoff.rowId}`,
      category: 'exception',
      status,
      summary: scopedDatasetId === undefined
        ? `Legacy handoff is ${handoff.status}; its dataset scope is unknown. Owner field: ${handoff.owner}.`
        : `Recorded handoff is ${handoff.status} for dataset ${scopedDatasetId}; owner field is ${handoff.owner}.`,
      detail: [
        `Asset or equipment reference: ${handoff.rowId}.`,
        ...(scopeConflict
          ? [`Scope conflict: handoff dataset ${handoff.datasetId} differs from run dataset ${runDatasetId}.`]
          : scopedDatasetId === undefined
            ? ['Dataset period is not recorded on this legacy handoff.']
            : [`Dataset snapshot: ${scopedDatasetId}.`]),
        ...(handoff.runId === undefined ? [] : [`Run reference: ${handoff.runId}.`]),
        ...(handoffRun !== undefined && handoffRun.id !== activeRun?.id && scopedDatasetId === currentDataset.id
          ? ['This handoff remains open from a prior saved run; the later replay has not rewritten its evidence.']
          : []),
        `Recorded owner: ${handoff.owner}.`,
        ...handoff.attempts,
      ],
      ...(exceptionObject === undefined ? {} : { workObjectId: exceptionObject.id }),
      rowId: handoff.rowId,
      ...(scopedDatasetId === undefined ? {} : { datasetId: scopedDatasetId }),
      ...(handoff.runId === undefined ? {} : { runId: handoff.runId }),
      evidenceRefs: refs([handoff.rowId, scopedDatasetId, handoff.runId]),
    });
    exceptionNodeIds.push(node.id);
    handoffNodeEntries.push({ handoff, node });
    if (exceptionObject !== undefined && !objectNodeIds.has(exceptionObject.id)) objectNodeIds.set(exceptionObject.id, node.id);
  }
  if (exceptionNodeIds.length > 0 && exceptionObject !== undefined) objectNodeIds.set(exceptionObject.id, exceptionNodeIds[0] ?? '');

  const handoffRunIds = new Set(includedHandoffs.flatMap((handoff) => handoff.runId === undefined ? [] : [handoff.runId]));
  const historicalRuns = includeHistory ? workspace.runs : workspace.runs.filter((run) => handoffRunIds.has(run.id));
  const historicalOutcomes: Array<{ run: RunSnapshot; node: KnowledgeNode }> = [];
  for (const run of historicalRuns) {
    if (activeRun?.id === run.id) continue;
    const runNode = addNode({
      id: `outcome:run:${run.id}`,
      title: `Past outcome · ${run.dataset.period}`,
      category: 'outcome',
      status: 'unknown',
      summary: reconciliationSummary(workspace, run.result, run),
      detail: [
        `Historical run: ${run.id} · ${run.cause}.`,
        `Dataset snapshot: ${run.dataset.id}.`,
        `Policy snapshot: v${run.policy.version}.`,
        'Values are read from this saved run snapshot.',
      ],
      datasetId: run.dataset.id,
      runId: run.id,
      ruleVersion: run.policy.version,
      evidenceRefs: refs([run.id, run.dataset.id, policyReference(run.policy.version)]),
    });
    historicalOutcomes.push({ run, node: runNode });
  }

  const versionsToShow = includeHistory
    ? new Map<number, Policy>([
      ...workspace.versions.map((policy) => [policy.version, policy] as const),
      ...historicalOutcomes.map(({ run }) => [run.policy.version, run.policy] as const),
    ])
    : new Map<number, Policy>();
  if (includeHistory) versionsToShow.set(workspace.policy.version, workspace.policy);
  for (const policy of versionsToShow.values()) {
    if (policy.version === workspace.policy.version) continue;
    const approvedEvents = workspace.events.filter((event) => eventApprovesPolicy(workspace, event, policy.version));
    const approvedProposal = workspace.proposals.find((proposal) =>
      proposal.candidate.version === policy.version && proposal.status === 'approved' && proposal.approvalRef !== undefined,
    );
    const node = addNode({
      id: `policy:${policy.version}`,
      title: `${policy.version === activeRun?.policy.version ? 'Run policy' : 'Historical policy'} · v${policy.version}`,
      category: 'rule',
      status: approvedEvents.length > 0 || approvedProposal !== undefined ? 'approved' : 'unknown',
      summary: `Stored policy v${policy.version} from ${policy.source}.`,
      detail: policyDetails(policy),
      ruleVersion: policy.version,
      evidenceRefs: refs([policyReference(policy.version), ...(approvedProposal === undefined ? [] : [approvedProposal.id])]),
    });
    policyNodeIds.set(policy.version, node.id);
  }

  const workerObjects = workspace.objects.filter((object) => object.kind === 'worker');
  const relevantEvents = includeHistory
    ? workspace.events
    : workspace.events.filter((event) => {
      if (activeRun !== undefined && event.runId === activeRun.id) return true;
      if (eventApprovesPolicy(workspace, event, workspace.policy.version)) return true;
      if (isRecordedHandoffAction(event)) return true;
      return includedProposals.some((proposal) =>
        event.inputs.includes(proposal.id)
        || event.outputs.includes(proposal.id)
        || event.inputs.includes(evaluationReference(proposal.id))
        || event.outputs.includes(evaluationReference(proposal.id))
        || (proposal.approvalRef !== undefined && event.approvalRef === proposal.approvalRef),
      );
    });
  const humanEvents = sortedEvents(relevantEvents.filter((event) => event.workerType === 'human'));
  let personNode: KnowledgeNode | undefined;
  if (humanEvents.length > 0) {
    const currentHumanCount = includeHistory
      ? humanEvents.length
      : humanEvents.filter((event) => (activeRun !== undefined && event.runId === activeRun.id)
        || eventApprovesPolicy(workspace, event, workspace.policy.version)
        || isRecordedHandoffAction(event)
        || includedProposals.some((proposal) => event.inputs.includes(proposal.id) || event.outputs.includes(proposal.id))).length;
    personNode = addNode({
      id: 'person:recorded-human-actions',
      title: 'Recorded human instruction',
      category: 'person',
      status: currentHumanCount > 0 ? 'active' : 'unknown',
      summary: `${currentHumanCount} recorded human action${currentHumanCount === 1 ? '' : 's'} in the current workspace scope. Identity is not verified here.`,
      detail: humanEvents.slice(-MAX_DETAIL_EXAMPLES).map((event) => `${event.title}: ${event.detail}`),
      evidenceRefs: humanEvents.map((event) => event.id),
    });
  }

  const workerEvents = sortedEvents(relevantEvents.filter((event) => event.workerType === 'deterministic'));
  const workerObjectNodeById = new Map<string, string>();
  for (const object of workerObjects) {
    const executionEvents = workerEvents.filter((event) => object.executionRef === event.runId);
    const node = addNode({
      id: `worker:${object.id}`,
      title: object.title,
      category: 'worker',
      status: object.status === 'needs-review' ? 'unknown' : 'active',
      summary: executionEvents.at(-1)?.detail ?? `This capability is present as a ${workspace.agentConfiguration.mode} workspace worker.`,
      detail: [
        `Workspace object: ${object.id}.`,
        ...executionEvents.slice(-MAX_DETAIL_EXAMPLES).map((event) => `${event.title} · ${event.startedAt} · ${event.status}.`),
      ],
      workObjectId: object.id,
      evidenceRefs: refs([object.id, object.executionRef, ...executionEvents.map((event) => event.id)]),
    });
    workerObjectNodeById.set(object.id, node.id);
    objectNodeIds.set(object.id, node.id);
  }

  for (const event of workerEvents) {
    const associatedObject = event.workerId === 'policy-evaluator'
      ? undefined
      : workerObjects.find((object) => object.executionRef === event.runId)
        ?? (event.runId === activeRun?.id
          ? workerObjects.filter((object) => object.executionRef === undefined).length === 1
            ? workerObjects.find((object) => object.executionRef === undefined)
            : undefined
          : undefined);
    if (associatedObject !== undefined) {
      const associatedNodeId = workerObjectNodeById.get(associatedObject.id);
      if (associatedNodeId !== undefined) workerNodeIds.set(`${event.workerId}:${event.runId}`, associatedNodeId);
      continue;
    }
    const nodeId = `worker:${event.workerId}:${event.runId}`;
    if (!nodes.some((node) => node.id === nodeId)) {
      const node = addNode({
        id: nodeId,
        title: event.workerId,
        category: 'worker',
        status: event.status === 'failed' ? 'failed' : 'active',
        summary: event.detail,
        detail: [`${event.title} · ${event.startedAt} · ${event.status}.`, `Execution run: ${event.runId}.`],
        evidenceRefs: refs([event.id, event.runId, ...event.inputs, ...event.outputs]),
      });
      workerNodeIds.set(`${event.workerId}:${event.runId}`, node.id);
    } else {
      workerNodeIds.set(`${event.workerId}:${event.runId}`, nodeId);
    }
  }

  const objectById = new Map(workspace.objects.map((object) => [object.id, object]));
  for (const object of workspace.objects) {
    const fromId = objectNodeIds.get(object.id);
    for (const dependencyId of object.dependencies) {
      const dependency = objectById.get(dependencyId);
      if (dependency === undefined) continue;
      const toId = objectNodeIds.get(dependencyId);
      addLink(fromId, toId, 'depends_on', [object.id, dependency.id, ...object.dataRefs, ...dependency.dataRefs]);
    }
  }

  for (const sourceNodeId of sourceNodeIds) {
    for (const outcomeNodeId of currentOutcomeNodeIds) {
      addLink(outcomeNodeId, sourceNodeId, 'derived_from', [outcomeDatasetId, ...(activeRun === undefined ? [] : [activeRun.id])]);
    }
  }
  for (const outcomeNodeId of currentOutcomeNodeIds) {
    addLink(activePolicyNode.id, outcomeNodeId, 'used_by', [policyReference(outcomePolicy.version), outcomeDatasetId, ...(activeRun === undefined ? [] : [activeRun.id])]);
    if (activeRun !== undefined) {
      const runEvents = workerEvents.filter((event) => event.runId === activeRun.id);
      for (const event of runEvents) {
        const workerId = workerNodeIds.get(`${event.workerId}:${event.runId}`);
        addLink(outcomeNodeId, workerId, 'produced_by', [activeRun.id, event.id]);
      }
    }
  }

  for (const proposal of includedProposals) {
    const proposalNodeId = proposalNodeIds.get(proposal.id);
    const testNodeId = testNodeIds.get(proposal.id);
    const evaluationEvents = proposalEvaluationEvents(workspace, proposal.id);
    const evaluationEvidence = refs([
      proposal.id,
      evaluationReference(proposal.id),
      ...evaluationEvents.map((event) => event.id),
      ...evaluationEvents.flatMap((event) => [
        ...event.inputs.filter((input) => input === workspace.dataset.id || workspace.runs.some((run) => run.dataset.id === input)),
        workspace.runs.find((run) => run.id === event.runId)?.dataset.id,
      ]),
    ]);
    addLink(proposalNodeId, testNodeId, 'tested_by', evaluationEvidence);
    if (proposal.status === 'approved') {
      const candidatePolicyNodeId = policyNodeIds.get(proposal.candidate.version);
      const beforePolicyNodeId = policyNodeIds.get(proposal.before.version);
      const approvalEvents = workspace.events.filter((event) =>
        event.workerType === 'human'
        && event.humanAction === 'approve'
        && (event.approvalRef === proposal.approvalRef || event.inputs.includes(proposal.id))
        && event.outputs.includes(policyReference(proposal.candidate.version)),
      );
      const approvalRefs = refs([proposal.id, proposal.approvalRef, ...approvalEvents.map((event) => event.id)]);
      if (candidatePolicyNodeId !== undefined && beforePolicyNodeId !== undefined) {
        addLink(candidatePolicyNodeId, beforePolicyNodeId, 'supersedes', approvalRefs);
      }
      if (candidatePolicyNodeId !== undefined && proposalNodeId !== undefined) {
        addLink(candidatePolicyNodeId, proposalNodeId, 'produced_by', approvalRefs);
      }
      if (candidatePolicyNodeId !== undefined && personNode !== undefined && approvalEvents.length > 0) {
        addLink(candidatePolicyNodeId, personNode.id, 'approved_by', approvalEvents.map((event) => event.id));
      }
    }
    const proposedByEvents = humanEvents.filter((event) =>
      event.humanAction === 'propose' && (event.inputs.includes(proposal.id) || event.outputs.includes(proposal.id)),
    );
    if (proposalNodeId !== undefined && personNode !== undefined && proposedByEvents.length > 0) {
      addLink(proposalNodeId, personNode.id, 'produced_by', proposedByEvents.map((event) => event.id));
    }
    if (testNodeId !== undefined) {
      const evaluatorEvents = relevantEvents.filter((event) =>
        event.workerType === 'deterministic'
        && (event.inputs.includes(proposal.id)
          || event.outputs.includes(evaluationReference(proposal.id))),
      );
      for (const event of evaluatorEvents) {
        addLink(testNodeId, workerNodeIds.get(`${event.workerId}:${event.runId}`), 'produced_by', [proposal.id, evaluationReference(proposal.id), event.id]);
      }
    }
  }

  if (personNode !== undefined) {
    for (const event of humanEvents.filter((item) => item.humanAction === 'case-correction')) {
      const rowReferences = [...event.inputs, ...event.outputs];
      const correctionRun = eventRun(workspace, event);
      const matchingExceptions = nodes.filter((node) => node.category === 'exception'
        && node.rowId !== undefined
        && rowReferences.some((reference) => reference === node.rowId)
        && correctionRun !== undefined
        && (node.evidenceRefs.includes(correctionRun.id) || node.evidenceRefs.includes(correctionRun.dataset.id)));
      for (const exception of matchingExceptions) addLink(exception.id, personNode.id, 'corrected_by', [event.id, exception.rowId ?? '']);
      const currentRow = workspace.dataset.assets.find((asset) => rowReferences.includes(asset.rowId));
      if (currentRow !== undefined && activeRun !== undefined && event.runId === activeRun.id) {
        for (const sourceNodeId of sourceNodeIds) addLink(sourceNodeId, personNode.id, 'corrected_by', [event.id, currentRow.rowId, workspace.dataset.id]);
      }
    }
    for (const event of activeApprovalEvents) addLink(activePolicyNode.id, personNode.id, 'approved_by', [event.id, policyReference(workspace.policy.version)]);
  }

  for (const { run, node: outcomeNode } of historicalOutcomes) {
    const sourceSnapshot = addNode({
      id: `source:run:${run.id}`,
      title: `Saved source · ${run.dataset.period}`,
      category: 'source',
      status: 'unknown',
      summary: `${run.dataset.assets.length} asset rows and ${run.dataset.ledger.filter((entry) => entry.period === run.dataset.period).length} GL postings in the saved snapshot.`,
      detail: [
        `Dataset snapshot: ${run.dataset.name} (${run.dataset.id}).`,
        `Reporting period: ${run.dataset.period}.`,
        ...(run.sourceConnections??[]).map(c=>`${c.kind}: ${c.resource} · ${c.rowCount} rows · ${c.mode}.`),
        ...run.dataset.assets.slice(0, 2).map((asset) => `${asset.rowId} · ${asset.assetId} · ${asset.description}.`),
      ],
      datasetId: run.dataset.id,
      runId: run.id,
      evidenceRefs: [run.id, run.dataset.id],
    });
    addLink(outcomeNode.id, sourceSnapshot.id, 'derived_from', [run.id, run.dataset.id]);
    const policyId = policyNodeIds.get(run.policy.version);
    addLink(policyId, outcomeNode.id, 'used_by', [run.id, run.dataset.id, policyReference(run.policy.version)]);
    const eventsForRun = relevantEvents.filter((event) => event.runId === run.id && event.workerType === 'deterministic');
    for (const event of eventsForRun) addLink(outcomeNode.id, workerNodeIds.get(`${event.workerId}:${event.runId}`), 'produced_by', [run.id, event.id]);

    if (includeHistory) {
      const groups = workspace.domain === 'accounting'
        ? exceptionGroups(run.result, run.dataset.id)
        : equipmentExceptionGroups(run);
      for (const group of groups.slice(0, MAX_DEFAULT_EXCEPTION_GROUPS)) {
        const exception = addNode({
          id: `exception:${run.id}:${group.key}`,
          title: `Past ${group.title.toLowerCase()}`,
          category: 'exception',
          status: 'unknown',
          summary: `${group.summary} (saved run ${run.id}).`,
          detail: [...group.detail, `Historical run: ${run.id}.`, 'Finding details are read from the saved run result.'],
          ...(group.rowIds[0] === undefined ? {} : { rowId: group.rowIds[0] }),
          datasetId: run.dataset.id,
          runId: run.id,
          ruleVersion: run.policy.version,
          evidenceRefs: refs([run.id, run.dataset.id, ...group.evidenceRefs]),
        });
        addLink(exception.id, outcomeNode.id, 'derived_from', [run.id, run.dataset.id, ...group.evidenceRefs]);
      }
    }
  }

  for (const { handoff, node } of handoffNodeEntries) {
    if (handoff.runId === undefined) continue;
    const run = workspace.runs.find((item) => item.id === handoff.runId);
    const datasetId = handoff.datasetId ?? run?.dataset.id;
    if (run === undefined || datasetId === undefined || datasetId !== run.dataset.id) continue;
    if (!runContainsRecord(workspace, run, handoff.rowId)) continue;
    const evidence = [handoff.rowId, datasetId, run.id];
    const sourceNode = nodes.find((candidate) => candidate.category === 'source'
      && candidate.datasetId === datasetId
      && candidate.runId === run.id);
    const outcomeNode = nodes.find((candidate) => candidate.category === 'outcome'
      && candidate.datasetId === datasetId
      && candidate.runId === run.id);
    addLink(node.id, sourceNode?.id, 'derived_from', evidence);
    addLink(node.id, outcomeNode?.id, 'handed_off_to', evidence);

    const matchingActions = humanEvents.filter((event) => {
      if (!handoffActions.has(event.humanAction ?? '') || event.runId !== run.id) return false;
      if (![...event.inputs, ...event.outputs].includes(handoff.rowId)) return false;
      const actionRun = eventRun(workspace, event);
      return actionRun?.dataset.id === datasetId && runContainsRecord(workspace, actionRun, handoff.rowId);
    });
    for (const event of matchingActions) {
      addLink(node.id, personNode?.id, 'produced_by', [event.id, handoff.rowId, datasetId, run.id]);
    }
  }

  return { nodes, links };
}
