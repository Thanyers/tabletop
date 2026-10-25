import { reconcile } from './accounting';
import { evaluateEquipment } from './maintenance';
import { resolveCategoryPolicy } from './policy';
import type { Finding, Impact, Policy, Reconciliation } from './types';
import type { TraceEvent, Workspace } from '../state/types';

export type LearningEventScope = 'current-run' | 'selected-row' | 'selected-object' | 'active-policy';

export interface LearningInput {
  label: string;
  value: string | number | null;
}

export interface LearningExplanation {
  subjectId: string | null;
  rowId: string | null;
  title: string;
  purpose: string;
  explanation: string[];
  inputs: LearningInput[];
  calculation: { formula: string; recorded: number; calculated: number; difference: number } | null;
  policy: Policy;
  findings: Finding[];
  provenance: {
    sourceRefs: string[];
    objectIds: string[];
    workerIds: string[];
    ruleVersion: number;
    events: TraceEvent[];
    eventScopes: Record<string, LearningEventScope[]>;
  };
  status: 'matched' | 'review' | 'unavailable';
}

export interface UsefulLifeExperiment {
  months: number;
  candidatePolicy: Policy;
  before: Reconciliation;
  after: Reconciliation;
  impacts: Impact[];
  persisted: false;
}

export interface WorkspaceExplanation {
  title: string;
  purpose: string;
  workflow: string[];
  activeCapabilities: string[];
  recentChanges: string[];
  attention: string[];
  nextActions: string[];
  objectRefs: string[];
}

const CENTS_PER_UNIT = 100;
const MAX_USEFUL_LIFE_MONTHS = 600;
const MAX_RECENT_CHANGES = 5;
const MAX_ATTENTION_ITEMS = 8;
const ACCOUNTING_SCRIPT_REF = 'src/domain/accounting.ts#calculateMonthly';
const MAINTENANCE_SCRIPT_REF = 'src/domain/maintenance.ts#evaluateEquipment';

function copyPolicy(policy: Policy): Policy {
  return {
    ...policy,
    laptop: { ...policy.laptop },
    ...(policy.categoryRules === undefined ? {} : {
      categoryRules: {
        ...policy.categoryRules,
        ...(policy.categoryRules.Furniture === undefined ? {} : { Furniture: { ...policy.categoryRules.Furniture } }),
        ...(policy.categoryRules.Equipment === undefined ? {} : { Equipment: { ...policy.categoryRules.Equipment } }),
        ...(policy.categoryRules.Vehicle === undefined ? {} : { Vehicle: { ...policy.categoryRules.Vehicle } }),
      },
    }),
  };
}

function sourceValue(value: number): number | string {
  return Number.isFinite(value) ? value : String(value);
}

function formatMoney(value: number): string {
  return `฿${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function referenceMatches(reference: string, identifier: string): boolean {
  return reference === identifier || reference.endsWith(`:${identifier}`);
}

function isActivePolicyDecision(workspace: Workspace, event: TraceEvent): boolean {
  if ((event.humanAction !== 'approve' && event.humanAction !== 'rollback') || event.ruleVersion !== workspace.policy.version) return false;
  const policyReference = `policy-v${workspace.policy.version}`;
  const referencesPolicy = [...event.inputs, ...event.outputs].includes(policyReference);
  const eventRun = workspace.runs.find((run) => run.id === event.runId);
  return referencesPolicy || eventRun?.policy.version === workspace.policy.version;
}

function isMeaningfulChange(event: TraceEvent): boolean {
  return event.workerType === 'deterministic' || event.humanAction !== undefined;
}

function matchingEvents(
  workspace: Workspace,
  rowId: string | null,
  subjectId: string | null,
): { events: TraceEvent[]; eventScopes: Record<string, LearningEventScope[]> } {
  const currentDatasetRuns = workspace.runs.filter((run) => run.dataset.id === workspace.dataset.id);
  const currentRunId = currentDatasetRuns.at(-1)?.id;
  const currentDatasetRunIds = new Set(currentDatasetRuns.map((run) => run.id));
  const recordIds = new Set<string>();
  const selectedRecordIds = new Set<string>();
  if (workspace.domain === 'accounting') {
    const snapshots = [workspace.dataset, ...currentDatasetRuns.map((run) => run.dataset)];
    for (const dataset of snapshots) {
      for (const asset of dataset.assets) {
        recordIds.add(asset.rowId);
        recordIds.add(asset.assetId);
      }
    }
    if (rowId !== null) selectedRecordIds.add(rowId);
    if (subjectId !== null && workspace.dataset.assets.filter((asset) => asset.assetId === subjectId).length === 1) {
      selectedRecordIds.add(subjectId);
    }
  } else {
    for (const equipment of workspace.equipment) recordIds.add(equipment.id);
    if (rowId !== null) selectedRecordIds.add(rowId);
    if (subjectId !== null && workspace.equipment.some((equipment) => equipment.id === subjectId)) selectedRecordIds.add(subjectId);
  }

  const selectedObjectIds = new Set(workspace.objects.map((object) => object.id));
  const scopesByEvent = new Map<string, { event: TraceEvent; scopes: Set<LearningEventScope> }>();
  for (const event of workspace.events) {
    if (event.workerId === 'learning-lens' || event.workerId === 'workspace-explainer') continue;
    const references = [...event.inputs, ...event.outputs];
    const recordReferences = Array.from(recordIds).filter((identifier) => references.some((reference) => referenceMatches(reference, identifier)));
    const matchesSelectedRecord = Array.from(selectedRecordIds).some((identifier) => references.some((reference) => referenceMatches(reference, identifier)));
    const matchesSelectedObject = subjectId !== null
      && selectedObjectIds.has(subjectId)
      && references.some((reference) => referenceMatches(reference, subjectId));
    const scopes = new Set<LearningEventScope>();
    if (currentDatasetRunIds.has(event.runId) && matchesSelectedRecord) scopes.add('selected-row');
    if (currentDatasetRunIds.has(event.runId) && matchesSelectedObject) scopes.add('selected-object');
    if (event.workerType === 'deterministic'
      && event.runId === currentRunId
      && (recordReferences.length === 0 || matchesSelectedRecord)) scopes.add('current-run');
    if (isActivePolicyDecision(workspace, event)) scopes.add('active-policy');
    if (scopes.size === 0) continue;
    const existing = scopesByEvent.get(event.id);
    if (existing === undefined) scopesByEvent.set(event.id, { event, scopes });
    else for (const scope of scopes) existing.scopes.add(scope);
  }
  const eventScopes: Record<string, LearningEventScope[]> = {};
  for (const [eventId, value] of scopesByEvent) eventScopes[eventId] = Array.from(value.scopes);
  const events = Array.from(scopesByEvent.values()).map(({ event }) => ({ ...event, inputs: [...event.inputs], outputs: [...event.outputs] }));
  return { events, eventScopes };
}

function objectRefsFor(workspace: Workspace, subjectId: string | null, rowId: string | null): string[] {
  return workspace.objects
    .filter((object) => object.kind !== 'context' && object.kind !== 'learning' && object.kind !== 'overview')
    .filter((object) => object.id === subjectId
      || object.configuration.rowId === rowId
      || object.dataRefs.includes(workspace.dataset.id)
      || object.kind === 'source'
      || object.kind === 'table')
    .map((object) => object.id);
}

function learningProvenance(
  workspace: Workspace,
  subjectId: string | null,
  rowId: string | null,
  sourceRefs: string[],
): LearningExplanation['provenance'] {
  const objectIds = objectRefsFor(workspace, subjectId, rowId);
  const { events, eventScopes } = matchingEvents(workspace, rowId, subjectId);
  return {
    sourceRefs,
    objectIds,
    workerIds: Array.from(new Set(events.map((event) => event.workerId))),
    ruleVersion: workspace.policy.version,
    events,
    eventScopes,
  };
}

function accountingExplanation(workspace: Workspace, requestedId: string): LearningExplanation | null {
  const result = workspace.result.rows.find((row) => row.asset.rowId === requestedId || row.asset.assetId === requestedId);
  const asset = result?.asset ?? workspace.dataset.assets.find((item) => item.rowId === requestedId || item.assetId === requestedId);
  if (asset === undefined) return null;

  const currentResult = result ?? null;
  const categoryPolicy = resolveCategoryPolicy(workspace.policy, asset);
  const { threshold, usefulLifeMonths, start: startRule } = categoryPolicy;
  const relatedLedgerEntries = workspace.dataset.ledger.filter((entry) => entry.assetId === asset.assetId && entry.period === workspace.dataset.period);
  const sourceRefs = [workspace.dataset.id, asset.rowId, asset.assetId, ACCOUNTING_SCRIPT_REF, ...relatedLedgerEntries.map((entry) => entry.id)];
  const subjectId = asset.assetId;
  const findings = currentResult?.findings.map((finding) => ({ ...finding })) ?? [{
    code: 'result-unavailable',
    message: 'The asset exists in the current register, but no current reconciliation result is available.',
    severity: 'warning' as const,
  }];
  const inputs: LearningInput[] = [
    { label: 'Asset row', value: asset.rowId },
    { label: 'Asset ID', value: asset.assetId },
    { label: 'Category', value: asset.category },
    { label: 'Description', value: asset.description },
    { label: 'Cost', value: sourceValue(asset.cost) },
    { label: 'Accumulated depreciation', value: sourceValue(asset.accumulatedDepreciation) },
    { label: 'In-service date', value: asset.inServiceDate },
    { label: 'Threshold', value: threshold },
    { label: 'Useful life (months)', value: usefulLifeMonths },
    { label: 'Start rule', value: startRule },
    { label: 'Ledger entries', value: relatedLedgerEntries.map((entry) => entry.id).join(', ') || null },
  ];
  const calculation = currentResult === null ? null : {
    formula: 'Round cost ÷ useful life to cents, apply threshold and service-month eligibility, then cap at remaining carrying value.',
    recorded: currentResult.recorded,
    calculated: currentResult.calculated,
    difference: currentResult.difference,
  };
  const explanation = [
    `The current ${workspace.dataset.period} result is calculated from asset row ${asset.rowId} and the active policy v${workspace.policy.version}.`,
    `The active ${asset.category} threshold is ${threshold}; the effective useful life is ${usefulLifeMonths} months with the ${startRule} start rule.`,
    currentResult === null
      ? 'No reconciliation output is available for this row, so the result is not presented as verified.'
      : `The calculation is ${currentResult.calculated}; the source register records ${currentResult.recorded}.`,
  ];

  return {
    subjectId,
    rowId: asset.rowId,
    title: `${asset.assetId} · ${asset.description}`,
    purpose: 'Explain the current depreciation result and its source evidence.',
    explanation,
    inputs,
    calculation,
    policy: copyPolicy(workspace.policy),
    findings,
    provenance: learningProvenance(workspace, subjectId, asset.rowId, sourceRefs),
    status: currentResult?.status ?? 'unavailable',
  };
}

function maintenanceExplanation(workspace: Workspace, requestedId: string): LearningExplanation | null {
  const equipment = workspace.equipment.find((item) => item.id === requestedId);
  if (equipment === undefined) return null;
  const result = evaluateEquipment([equipment])[0] ?? null;
  const findings: Finding[] = result !== null && result.priority !== 'healthy'
    ? [{
      code: `equipment-${result.priority}`,
      message: result.reason,
      severity: result.priority === 'urgent' ? 'error' : 'warning',
    }]
    : [];
  const sourceRefs = [workspace.dataset.id, equipment.id, MAINTENANCE_SCRIPT_REF];
  const inputs: LearningInput[] = [
    { label: 'Equipment ID', value: equipment.id },
    { label: 'Equipment', value: equipment.name },
    { label: 'Category', value: equipment.category },
    { label: 'Owner', value: equipment.owner },
    { label: 'Warranty until', value: equipment.warrantyUntil },
    { label: 'Condition', value: equipment.condition },
    { label: 'Location', value: equipment.location },
    { label: 'Priority', value: result?.priority ?? null },
    { label: 'Warranty days', value: result?.warrantyDays ?? null },
  ];
  return {
    subjectId: equipment.id,
    rowId: equipment.id,
    title: `${equipment.id} · ${equipment.name}`,
    purpose: 'Explain this equipment record and its current warranty or repair priority.',
    explanation: result === null ? ['No maintenance result is available for this equipment.'] : [
      `The current equipment condition is ${equipment.condition}.`,
      result.reason,
      'Priority is derived by the deterministic warranty and repair evaluator.',
    ],
    inputs,
    calculation: null,
    policy: copyPolicy(workspace.policy),
    findings,
    provenance: learningProvenance(workspace, equipment.id, equipment.id, sourceRefs),
    status: result?.priority === 'healthy' ? 'matched' : result === null ? 'unavailable' : 'review',
  };
}

function objectPurpose(workspace: Workspace, objectKind: Workspace['objects'][number]['kind']): string {
  switch (objectKind) {
    case 'source': return 'Provides the current source records for this workspace.';
    case 'worker': return workspace.domain === 'accounting'
      ? `Runs ${ACCOUNTING_SCRIPT_REF} with policy v${workspace.policy.version}.`
      : `Runs ${MAINTENANCE_SCRIPT_REF} with the current equipment state.`;
    case 'table': return workspace.domain === 'accounting'
      ? `Shows the current reconciliation for ${workspace.dataset.period}.`
      : `Shows the current equipment results for ${workspace.dataset.period}.`;
    case 'dashboard': return 'Summarizes the current workspace results.';
    case 'exceptions': return 'Surfaces current records and ledger postings that need review.';
    case 'knowledge': return 'Holds workspace guidance and reusable knowledge.';
    case 'proposal': return 'Presents a candidate rule for verification and human decision.';
    case 'evaluation': return 'Shows deterministic verification cases and their outcomes.';
    case 'intake': return 'Captures new source issues for review.';
    case 'context': return workspace.prompt || `Frames the current question for ${workspace.title}.`;
    case 'learning': return 'Explains the current source, policy, calculation, and evidence.';
    case 'overview': return 'Summarizes the current workspace workflow, decisions, and review queue.';
  }
}

function genericExplanation(workspace: Workspace, requestedId?: string): LearningExplanation {
  const selectedObject = requestedId === undefined
    ? undefined
    : workspace.objects.find((object) => object.id === requestedId || object.kind === requestedId);
  const defaultObject = selectedObject
    ?? workspace.objects.find((object) => object.kind === 'context')
    ?? workspace.objects.find((object) => object.kind !== 'learning' && object.kind !== 'overview');
  const subjectId = defaultObject?.id ?? null;
  const sourceRefs = Array.from(new Set([
    workspace.dataset.id,
    `policy-v${workspace.policy.version}`,
    ...(defaultObject?.dataRefs ?? []),
    ...(defaultObject?.dependencies ?? []),
  ]));
  const dependencies = defaultObject?.dependencies
    .map((dependencyId) => workspace.objects.find((object) => object.id === dependencyId)?.title ?? dependencyId) ?? [];
  const examples = workspace.domain === 'accounting'
    ? [`${workspace.result.summary.totalAssets} asset rows in ${workspace.dataset.period}.`, `${workspace.result.summary.exceptions} asset or ledger findings require review.`]
    : [`${workspace.equipment.length} equipment records in the current workspace.`, `${evaluateEquipment(workspace.equipment).filter((item) => item.priority !== 'healthy').length} equipment records need attention.`];
  const explanation = defaultObject === undefined
    ? examples
    : [
      `${defaultObject.title} is the ${defaultObject.kind} object in the current ${workspace.domain} workspace.`,
      dependencies.length > 0 ? `Recorded dependencies: ${dependencies.join(', ')}.` : 'No object dependencies are recorded.',
      objectPurpose(workspace, defaultObject.kind),
      ...examples,
    ];
  const inputs: LearningInput[] = [
    { label: 'Workspace', value: workspace.title },
    { label: 'Dataset', value: workspace.dataset.id },
    { label: 'Reporting period', value: workspace.dataset.period },
    { label: 'Active policy version', value: workspace.policy.version },
  ];
  if (defaultObject !== undefined) {
    inputs.push(
      { label: 'Canvas object', value: defaultObject.title },
      { label: 'Object type', value: defaultObject.kind },
      { label: 'Dependencies', value: dependencies.join(', ') || null },
      { label: 'Data references', value: defaultObject.dataRefs.join(', ') || null },
    );
  }
  return {
    subjectId,
    rowId: null,
    title: defaultObject?.title ?? workspace.title,
    purpose: selectedObject === undefined
      ? workspace.prompt || `Explain how ${workspace.title} works from its current workspace state.`
      : objectPurpose(workspace, selectedObject.kind),
    explanation,
    inputs,
    calculation: null,
    policy: copyPolicy(workspace.policy),
    findings: [],
    provenance: learningProvenance(workspace, subjectId, null, sourceRefs),
    status: 'unavailable',
  };
}

export function deriveLearning(workspace: Workspace, rowId?: string): LearningExplanation {
  if (rowId !== undefined) {
    const subject = workspace.domain === 'accounting'
      ? accountingExplanation(workspace, rowId)
      : maintenanceExplanation(workspace, rowId);
    if (subject !== null) return subject;
  }
  return genericExplanation(workspace, rowId);
}

export function simulateUsefulLife(workspace: Workspace, months: number): UsefulLifeExperiment {
  if (!Number.isInteger(months) || months < 1 || months > MAX_USEFUL_LIFE_MONTHS) {
    throw new RangeError(`Useful life must be a whole number from 1 to ${MAX_USEFUL_LIFE_MONTHS} months.`);
  }
  const before = reconcile(workspace.dataset, workspace.policy);
  const candidatePolicy: Policy = {
    ...copyPolicy(workspace.policy),
    laptop: { ...workspace.policy.laptop, usefulLifeMonths: months },
    source: `isolated what-if · ${months} months · not approved`,
  };
  const after = reconcile(workspace.dataset, candidatePolicy);
  const beforeRows = new Map(before.rows.map((row) => [row.asset.rowId, row]));
  const impacts = after.rows.flatMap((row) => {
    const prior = beforeRows.get(row.asset.rowId);
    if (prior === undefined) return [];
    const beforeCents = Math.round((prior.calculated + Number.EPSILON) * CENTS_PER_UNIT);
    const afterCents = Math.round((row.calculated + Number.EPSILON) * CENTS_PER_UNIT);
    if (beforeCents === afterCents) return [];
    return [{
      rowId: row.asset.rowId,
      assetId: row.asset.assetId,
      before: prior.calculated,
      after: row.calculated,
      difference: Math.round((row.calculated - prior.calculated + Number.EPSILON) * CENTS_PER_UNIT) / CENTS_PER_UNIT,
    }];
  });
  return { months, candidatePolicy, before, after, impacts, persisted: false };
}

function currentAttention(workspace: Workspace, handoffCount: number): string[] {
  const findingsLimit = Math.max(0, MAX_ATTENTION_ITEMS - (handoffCount > 0 ? 1 : 0));
  if (workspace.domain === 'accounting') {
    const ledgerAttention = workspace.result.ledgerFindings
      .slice(0, findingsLimit)
      .map(({ entry, finding }) => `${entry.id}: ${finding.message}`);
    const remaining = Math.max(0, findingsLimit - ledgerAttention.length);
    const assetAttention = workspace.result.rows
      .filter((row) => row.status === 'review')
      .slice(0, remaining)
      .map((row) => `${row.asset.rowId} · ${row.asset.assetId}: ${row.findings.map((finding) => finding.message).join(' ')}`);
    return [...ledgerAttention, ...assetAttention];
  }
  return evaluateEquipment(workspace.equipment)
    .filter((item) => item.priority !== 'healthy')
    .slice(0, findingsLimit)
    .map((item) => `${item.equipment.id} · ${item.equipment.name}: ${item.reason}`);
}

export function explainWorkspace(workspace: Workspace): WorkspaceExplanation {
  const activeProposal = workspace.proposals.find((proposal) => proposal.id === workspace.activeProposalId);
  const pendingHandoffs = workspace.handoffs.filter((handoff) =>
    (handoff.datasetId === undefined || handoff.datasetId === workspace.dataset.id)
    && (handoff.status === 'waiting' || handoff.status === 'in-progress'),
  );
  const findingAttention = currentAttention(workspace, pendingHandoffs.length);
  const attention = pendingHandoffs.length > 0
    ? [...findingAttention, `${pendingHandoffs.length} open handoff${pendingHandoffs.length === 1 ? '' : 's'} ${pendingHandoffs.length === 1 ? 'remains' : 'remain'}.`]
    : findingAttention;
  const coreObjects = workspace.objects.filter((object) => object.kind !== 'context' && object.kind !== 'learning' && object.kind !== 'overview');
  const objectRefs = coreObjects.map((object) => object.id);
  const workflow: string[] = [];
  const hasKind = (kind: Workspace['objects'][number]['kind']) => coreObjects.some((object) => object.kind === kind);
  if (hasKind('source')) {
    workflow.push(workspace.domain === 'accounting'
      ? `Source: ${workspace.dataset.assets.length} asset rows and ${workspace.dataset.ledger.length} GL postings for ${workspace.dataset.period}.`
      : `Source: ${workspace.equipment.length} equipment records for ${workspace.dataset.period}.`);
  }
  if (hasKind('worker')) {
    const script = workspace.domain === 'accounting' ? ACCOUNTING_SCRIPT_REF : MAINTENANCE_SCRIPT_REF;
    const worker = coreObjects.find((object) => object.kind === 'worker');
    if (worker !== undefined) workflow.push(`${worker.title} applies ${script} with active policy v${workspace.policy.version}.`);
  }
  if (hasKind('table') || hasKind('dashboard')) {
    if (workspace.domain === 'accounting') {
      workflow.push(`Current results: ${workspace.result.summary.matched} matched and ${workspace.result.summary.exceptions} exceptions across ${workspace.result.summary.totalAssets} asset rows.`);
    } else {
      const equipmentResults = evaluateEquipment(workspace.equipment);
      const needsAttention = equipmentResults.filter((item) => item.priority !== 'healthy').length;
      workflow.push(`Current results: ${equipmentResults.length - needsAttention} healthy and ${needsAttention} need review across ${equipmentResults.length} equipment records.`);
    }
  }
  if (hasKind('exceptions')) {
    if (workspace.domain === 'accounting') {
      const assetReviewCount = workspace.result.rows.filter((row) => row.status === 'review').length;
      workflow.push(`Review queue: ${assetReviewCount} asset rows and ${workspace.result.ledgerFindings.length} GL postings need review.`);
    } else {
      workflow.push(`Review queue: ${findingAttention.length} equipment records need attention.`);
    }
  }
  const activeCapabilities = workspace.domain === 'accounting'
    ? [
      `Active policy v${workspace.policy.version}: default threshold ${formatMoney(workspace.policy.defaultThreshold)}.`,
      `Laptop threshold ${formatMoney(workspace.policy.laptop.threshold)}, ${workspace.policy.laptop.usefulLifeMonths} months, ${workspace.policy.laptop.start}.`,
      ...Object.entries(workspace.policy.categoryRules ?? {}).map(([category, rule]) => {
        const life = rule.usefulLifeMonths === undefined ? 'source useful life' : `${rule.usefulLifeMonths} months`;
        const threshold = rule.threshold === undefined ? 'default threshold' : formatMoney(rule.threshold);
        const start = rule.start ?? 'following-month';
        return `${category} override: ${threshold}, ${life}, ${start}.`;
      }),
      'Deterministic straight-line calculation with integer-cent rounding and GL reconciliation.',
    ]
    : [
      `Workspace mode: ${workspace.agentConfiguration.mode}.`,
      'Deterministic warranty and repair-priority evaluation.',
      `${workspace.equipment.length} equipment records are in the current workspace.`,
    ];
  const activePolicyDecision = workspace.events.filter((event) => isActivePolicyDecision(workspace, event)).at(-1);
  if (activePolicyDecision?.humanAction === 'approve') activeCapabilities.push(`Active policy v${workspace.policy.version} has a recorded human approval.`);
  if (activePolicyDecision?.humanAction === 'rollback') activeCapabilities.push(`Active policy v${workspace.policy.version} has a recorded human rollback.`);
  const changes = workspace.events
    .filter(isMeaningfulChange)
    .slice(-MAX_RECENT_CHANGES)
    .reverse()
    .map((event) => `${event.title}: ${event.detail} (${event.startedAt})`);
  const nextActions: string[] = [];
  const proposalIsActionable = activeProposal !== undefined && (activeProposal.status === 'proposed' || activeProposal.status === 'tested');
  if (proposalIsActionable && activeProposal.before.version !== workspace.policy.version) {
    nextActions.push(`Create a new proposal against active policy v${workspace.policy.version}; ${activeProposal.id} was based on v${activeProposal.before.version}.`);
  } else if (activeProposal?.status === 'tested') {
    const failedCases = activeProposal.evaluation?.cases.filter((testCase) => !testCase.passed).length ?? 0;
    if (activeProposal.evaluation === undefined) nextActions.push(`Verification results for ${activeProposal.id} are unavailable; rerun the tests before deciding.`);
    else if (activeProposal.evaluation.failed > 0 || failedCases > 0) nextActions.push(`Review ${activeProposal.evaluation.failed || failedCases} failed verification case${(activeProposal.evaluation.failed || failedCases) === 1 ? '' : 's'} for ${activeProposal.id} and revise it before retesting.`);
    else nextActions.push(`Proposal ${activeProposal.id} passed verification against the active policy; explicitly approve or reject it.`);
  } else if (activeProposal?.status === 'proposed') nextActions.push(`Run verification for proposal ${activeProposal.id} before approval.`);
  if (pendingHandoffs.length > 0) nextActions.push(`Follow up on ${pendingHandoffs.length} open handoff${pendingHandoffs.length === 1 ? '' : 's'}.`);
  if (findingAttention.length > 0) nextActions.push(`Review current findings (${workspace.domain === 'accounting' ? workspace.result.summary.exceptions : findingAttention.length} require attention).`);
  if (workspace.dataset.source === 'imported') nextActions.push('Import the next reporting period when its source files are ready.');
  if (nextActions.length === 0) nextActions.push('Inspect the current canvas objects and continue from the latest recorded run.');
  return {
    title: `Explain this workspace · ${workspace.title}`,
    purpose: workspace.prompt || `Current purpose and configuration for ${workspace.title}.`,
    workflow: workflow.length > 0 ? workflow.slice(0, 4) : ['No functional canvas objects have been generated yet.'],
    activeCapabilities,
    recentChanges: changes.length > 0 ? changes : ['No meaningful run or human decision events have been recorded yet.'],
    attention: attention.length > 0 ? attention : ['No current attention items were found in the workspace result.'],
    nextActions,
    objectRefs,
  };
}

