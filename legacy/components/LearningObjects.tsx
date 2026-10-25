import { useEffect, useMemo, useState } from 'react';
import { useReactFlow } from '@xyflow/react';
import { ArrowRight, BookOpen, CircleHelp, Clock3, Code2, Database, GitBranch, History, RefreshCw, ShieldCheck, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { deriveLearning, explainWorkspace as deriveWorkspaceExplanation, simulateUsefulLife } from '../domain/learning';
import type { CanvasObject, DemoLearningFocus, Workspace } from '../state/types';
import { useWorkspace } from '../state/store';
import './learning.css';
import './content-layout.css';
import './learning-demo.css';

type LearningObjectProps = { object: CanvasObject };

const money = (value: number | null | undefined) => value == null || !Number.isFinite(value)
  ? 'Unknown'
  : `฿${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const signedMoney = (value: number) => {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${money(Math.abs(rounded))}`;
};

function objectValue(object: CanvasObject, key: 'rowId' | 'subjectId'): string | undefined {
  const value = object.configuration[key];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function learningStatus(status: string) {
  if (status === 'matched' || status === 'healthy') return { label: 'Deterministic check · clear', tone: 'good' };
  if (status === 'review' || status === 'soon') return { label: 'Deterministic check · review', tone: 'warn' };
  return { label: 'Deterministic check · unavailable', tone: 'neutral' };
}

export function LearningObject({ object }: LearningObjectProps) {
  const workspace = useWorkspace(state => state.workspace);
  const demoActive = useWorkspace(state => state.demoActive);
  const demoLearningFocus = useWorkspace(state => state.demoLearningFocus);
  const setInspector = useWorkspace(state => state.setInspector);
  const propose = useWorkspace(state => state.propose);
  const rowId = objectValue(object, 'rowId');
  const subjectId = objectValue(object, 'subjectId');
  const explanation = useMemo(() => deriveLearning(workspace, rowId ?? subjectId), [workspace, rowId, subjectId]);
  const [months, setMonths] = useState(48);
  useEffect(() => {
    if (demoActive && demoLearningFocus === 'experiment') setMonths(48);
  }, [demoActive, demoLearningFocus]);
  const experiment = useMemo(
    () => workspace.domain === 'accounting' ? simulateUsefulLife(workspace, months) : null,
    [workspace, months],
  );
  const status = learningStatus(explanation.status);
  const inputValue = (label: string) => explanation.inputs.find(input => input.label === label)?.value ?? null;
  const recordIdValue = inputValue('Asset ID') ?? inputValue('Equipment ID');
  const recordIdentifier = typeof recordIdValue === 'string' ? recordIdValue : null;
  const category = typeof inputValue('Category') === 'string' ? inputValue('Category') as string : null;
  const thresholdInput = inputValue('Threshold');
  const threshold = typeof thresholdInput === 'number' ? thresholdInput : null;
  const costInput = inputValue('Cost');
  const cost = typeof costInput === 'number' ? costInput : null;
  const usefulLife = inputValue('Useful life (months)');
  const startRule = inputValue('Start rule');
  const belowLaptopThreshold = workspace.domain === 'accounting' && category === 'Laptop' && cost !== null && threshold !== null && cost < threshold;
  const sourceRefs = explanation.provenance.sourceRefs;
  const events = explanation.provenance.events;
  const recordedWorkers = Array.from(new Set(events.filter(event => event.workerType !== 'human').map(event => event.workerId)));
  const hasRecordedHumanAction = events.some(event => event.workerType === 'human' && (event.humanAction === 'approve' || event.humanAction === 'rollback'));
  const approvedProposal = workspace.proposals.find(proposal => proposal.status === 'approved' && proposal.candidate.version === workspace.policy.version);
  const approvalEvent = events.find(event => event.humanAction === 'approve' && event.ruleVersion === workspace.policy.version)
    ?? workspace.events.find(event => event.humanAction === 'approve' && event.ruleVersion === workspace.policy.version);
  const subject = explanation.inputs.find(input => /asset|equipment|row|subject|record/i.test(input.label));
  const beforeRow = experiment?.before.rows.find(result => result.asset.rowId === (explanation.rowId ?? rowId));
  const afterRow = experiment?.after.rows.find(result => result.asset.rowId === (explanation.rowId ?? rowId));
  const guidedFocus: Exclude<DemoLearningFocus, null> | null = demoActive ? demoLearningFocus : null;
  const priorRun = guidedFocus === 'approved'
    ? [...workspace.runs].reverse().find(run => run.dataset.id === workspace.dataset.id && run.policy.version < workspace.policy.version)
    : undefined;
  const priorRow = priorRun?.result.rows.find(result => result.asset.rowId === (explanation.rowId ?? rowId)
    || result.asset.assetId === (explanation.subjectId ?? subjectId));
  const approvalRecorded = Boolean(approvedProposal || approvalEvent);
  const keyFacts = (workspace.domain === 'accounting'
    ? ['Cost', 'Threshold', 'Useful life (months)']
    : ['Priority', 'Warranty days', 'Condition'])
    .map(label => ({ label, value: inputValue(label) }));
  const showKeyFact = (label: string, value: string | number | null) => {
    if (value == null) return 'Not recorded';
    if ((label === 'Cost' || label === 'Threshold') && typeof value === 'number') return money(value);
    if (label === 'Useful life (months)') return `${value} months`;
    return String(value);
  };

  const sendExperiment = () => {
    if (!experiment) return;
    propose(experiment.candidatePolicy, `Learning Lens experiment: test a ${months}-month laptop useful life. The active policy remains unchanged until the proposal passes verification and is approved.`);
  };

  const proofValue = (value: number | null | undefined) => value == null ? 'ไม่พบผลที่บันทึก' : money(value);
  const proofMoney = (value: number) => `฿${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value)}`;
  const proofReason = explanation.calculation === null
    ? 'ยังไม่มีผลคำนวณของรายการนี้ในรอบปัจจุบัน'
    : belowLaptopThreshold && threshold !== null && cost !== null
      ? `Laptop · ต้นทุน ${proofMoney(cost)} < เกณฑ์ ${proofMoney(threshold)} → ฿0`
      : explanation.findings[0]?.message ?? explanation.explanation[2] ?? 'ผลนี้มาจากข้อมูลและกฎที่แสดงในหลักฐาน';
  const experimentBefore = beforeRow?.calculated ?? explanation.calculation?.calculated;
  const experimentAfter = afterRow?.calculated ?? (explanation.rowId ? undefined : experiment?.after.summary.calculated);

  const introSection = <section className="learning-object__intro">
    <div className="learning-object__intro-icon"><Sparkles size={17} /></div>
    <div className="learning-object__intro-copy">
      <span className="learning-object__eyebrow">LEARNING LENS</span>
      <h2>{explanation.title || 'Why this result exists'}</h2>
      <p>{explanation.purpose}</p>
    </div>
    <span className={`learning-object__status learning-object__status--${status.tone}`}><i />{status.label}</span>
  </section>;

  const policySection = <section className="learning-object__section">
    <h3><GitBranch size={14} /> Applied capability</h3>
    {workspace.domain === 'accounting' ? <div className="learning-object__policy-card">
      <div><span>Active policy</span><strong>v{workspace.policy.version}</strong></div>
      <p>{category ? `Applied to this ${category}: threshold ${threshold === null ? 'not recorded' : money(threshold)} · ${usefulLife ?? 'unknown'} months · starts ${startRule === 'in-service' ? 'in service' : 'the following month'}.` : `Workspace laptop rule: ${money(workspace.policy.laptop.threshold)} threshold · ${workspace.policy.laptop.usefulLifeMonths} months · ${workspace.policy.laptop.start}.`}</p>
      <small>{category === 'Laptop' ? 'Laptop-specific rule applied to this result.' : category ? 'This result uses its category schedule; the laptop rule remains a separate capability.' : 'Select a calculated amount to inspect one record.'} {approvedProposal ? `Recorded human instruction: ${approvedProposal.instruction}` : approvalEvent ? `Recorded human approval · ${approvalEvent.approvalRef ?? 'approval recorded'}` : `Policy source: ${workspace.policy.source || 'initial workspace policy'}`}</small>
      {(approvedProposal || approvalEvent) && <small>Approver identity is not verified in this browser-local demo.</small>}
    </div> : <div className="learning-object__policy-card">
      <div><span>Warranty evaluator</span><strong>30-day window</strong></div>
      <p>Equipment condition and warranty date determine whether this record is urgent, due soon, or healthy.</p>
      <small>As of 30 September 2026 · deterministic local maintenance logic.</small>
    </div>}
    {explanation.explanation.map((line, index) => <p className="learning-object__explanation" key={`${index}-${line}`}>{line}</p>)}
  </section>;

  const maintenanceSection = workspace.domain === 'maintenance' && explanation.rowId ? <section className="learning-object__section" data-testid="equipment-result-summary">
    <h3><ShieldCheck size={14} /> Current equipment result</h3>
    <dl className="learning-object__key-facts" aria-label="Current equipment result inputs">
      {keyFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{showKeyFact(fact.label, fact.value)}</dd></div>)}
    </dl>
  </section> : null;

  const calculationSection = explanation.calculation ? <section className="learning-object__section">
    <h3><Code2 size={14} /> Calculation result</h3>
    <dl className="learning-object__key-facts" aria-label="Key result inputs">
      {keyFacts.map(fact => <div key={fact.label}><dt>{fact.label}</dt><dd>{showKeyFact(fact.label, fact.value)}</dd></div>)}
    </dl>
    <div className="learning-object__formula"><code>{explanation.calculation.formula}</code></div>
    <div className="learning-object__compare">
      <div><span>Register</span><strong>{money(explanation.calculation.recorded)}</strong></div>
      <ArrowRight size={14} />
      <div><span>Calculated</span><strong>{money(explanation.calculation.calculated)}</strong></div>
      <div className="learning-object__delta"><span>Calculated − register</span><strong>{signedMoney(explanation.calculation.difference)}</strong></div>
    </div>
  </section> : null;

  const findingsSection = !!explanation.findings.length ? <section className="learning-object__section">
    <h3><CircleHelp size={14} /> Deterministic validation <span>{explanation.findings.length}</span></h3>
    <ul className="learning-object__findings">{explanation.findings.map((finding, index) => <li key={`${finding.code}-${index}`} className={finding.severity === 'error' ? 'is-error' : ''}><i />{finding.message}</li>)}</ul>
  </section> : null;

  const sourceDetails = <details className="learning-object__source-details">
    <summary><Database size={14} /> View all source inputs</summary>
    {subject && <div className="learning-object__subject"><span>{subject.label}</span><strong>{String(subject.value ?? 'Unknown')}</strong></div>}
    <dl className="learning-object__facts">
      {explanation.inputs.filter(input => input !== subject).map((input, index) => <div key={`${input.label}-${index}`}><dt>{input.label}</dt><dd>{input.value == null ? 'Not recorded' : String(input.value)}</dd></div>)}
      {sourceRefs.map((reference, index) => <div key={`${reference}-${index}`}><dt>Source reference</dt><dd><code>{reference}</code></dd></div>)}
    </dl>
    {!explanation.inputs.length && !sourceRefs.length && <p className="learning-object__muted">No source inputs are recorded for this object.</p>}
  </details>;

  const experimentPanel = workspace.domain === 'accounting' && experiment ? <section className={`learning-object__section learning-object__lab${guidedFocus === 'experiment' ? ' learning-object__lab--guided' : ''}`} data-testid="useful-life-experiment">
    <div className="learning-object__lab-title"><span><Sparkles size={14} /> Try an assumption</span><small>Deterministic what-if · active policy unchanged</small></div>
    <label className="learning-object__slider-label" htmlFor={`learning-life-${object.id}`}>Laptop useful life <strong>{months} months</strong></label>
    <input id={`learning-life-${object.id}`} type="range" min="1" max="600" step="1" value={months} onChange={event => setMonths(Number(event.target.value))} aria-label="Experiment laptop useful life in months" />
    <div className="learning-object__experiment-result">
      <span>{beforeRow?.asset.assetId ?? 'Workspace total'}</span>
      {beforeRow && afterRow
        ? <strong>{money(beforeRow.calculated)} <ArrowRight size={13} /> {money(afterRow.calculated)}</strong>
        : <strong>{money(experiment.before.summary.calculated)} <ArrowRight size={13} /> {money(experiment.after.summary.calculated)}</strong>}
      <small>{experiment.impacts.length} affected rows · {experiment.after.summary.exceptions} need review after simulation</small>
    </div>
    {guidedFocus === 'experiment' ? <details className="learning-object__experiment-details">
      <summary>What changes in this simulation?</summary>
      <p className="learning-object__experiment-scope">Only useful life changes. Threshold and start convention stay unchanged.{belowLaptopThreshold && beforeRow ? ` ${beforeRow.asset.assetId} remains at ฿0.00 because its ${money(beforeRow.asset.cost)} cost is below the active ${money(threshold)} threshold.` : category && category !== 'Laptop' ? ` The selected ${category} record is outside this laptop-only experiment.` : ''}</p>
      {months !== 36 && <p className="learning-object__caveat">The authored policy tests expect 36 months. A {months}-month candidate will fail the useful-life case; review all test results before any approval.</p>}
    </details> : <>
      <p className="learning-object__experiment-scope">Only useful life changes in this simulation. Threshold and start convention stay unchanged.{belowLaptopThreshold && beforeRow ? ` ${beforeRow.asset.assetId} remains at ฿0.00 because its ${money(beforeRow.asset.cost)} cost is below the active ${money(threshold)} threshold.` : category && category !== 'Laptop' ? ` The selected ${category} record is outside this laptop-only experiment.` : ''}</p>
      {months !== 36 && <p className="learning-object__caveat">The authored policy tests expect 36 months. A {months}-month candidate will fail the useful-life case; review all test results before any approval.</p>}
    </>}
    <button className="learning-object__button learning-object__button--primary" onClick={sendExperiment} data-testid="send-experiment-proposal"><GitBranch size={14} /> Send experiment to proposal review</button>
    <small className="learning-object__guardrail">This creates a candidate only. Tests and explicit approval are still required.</small>
  </section> : null;

  const provenanceSection = <section className="learning-object__section">
    <h3><History size={14} /> Provenance and trace</h3>
    <div className="learning-object__provenance">
      <div><span>Rule version</span><strong>v{explanation.provenance.ruleVersion}</strong></div>
      <div><span>Source references</span><strong>{sourceRefs.length || 'None recorded'}</strong></div>
      <div><span>Workers</span><strong>{recordedWorkers.length ? recordedWorkers.join(', ') : 'None recorded'}</strong></div>
      {hasRecordedHumanAction && <div><span>Human decision</span><strong>Approval or rollback recorded</strong></div>}
      {explanation.provenance.objectIds.map((id, index) => <div key={`${id}-${index}`}><span>Related object</span><strong>{id}</strong></div>)}
    </div>
    {events.length ? <ol className="learning-object__trace">{events.slice(-3).reverse().map(event => <li key={event.id}><span>{event.title}</span><small>{event.detail}</small><small>Scope: {(explanation.provenance.eventScopes[event.id] ?? []).map(scope => scope.replaceAll('-', ' ')).join(' · ')}</small><small>{new Date(event.endedAt).toLocaleString()} · v{event.ruleVersion} · {event.status} · {event.taskId}</small></li>)}</ol> : <p className="learning-object__muted">No matching execution event is recorded yet.</p>}
  </section>;

  const actionsSection = <footer className="learning-object__actions">
    <button onClick={() => setInspector({ type: 'source' })}><Database size={14} /> Inspect sources</button>
    <button onClick={() => setInspector({ type: 'script' })}><Code2 size={14} /> Inspect script</button>
    <button onClick={() => setInspector({ type: 'history' })}><History size={14} /> Run history</button><button onClick={()=>useWorkspace.getState().setLens('constellation')}><GitBranch size={14}/>Knowledge links</button>
  </footer>;

  const fullEvidence = (includeExperiment: boolean) => <>
    {introSection}
    {policySection}
    {maintenanceSection}
    {calculationSection}
    {findingsSection}
    {sourceDetails}
    {includeExperiment && experimentPanel}
    {provenanceSection}
    {actionsSection}
  </>;

  if (guidedFocus) {
    const focusedResult = guidedFocus === 'experiment' ? experimentBefore : explanation.calculation?.calculated;
    const comparisonValue = guidedFocus === 'why'
      ? explanation.calculation?.recorded
      : guidedFocus === 'approved' ? priorRow?.calculated : experimentAfter;
    const leftLabel = guidedFocus === 'why' ? 'ทะเบียน' : guidedFocus === 'approved' ? `ก่อน · v${priorRun?.policy.version ?? '—'}` : 'ผลปัจจุบัน';
    const rightLabel = guidedFocus === 'why' ? 'คำนวณจริง' : guidedFocus === 'approved' ? `หลัง · v${workspace.policy.version}` : `ทดลอง · ${months} เดือน`;
    const heroTitle = guidedFocus === 'why'
      ? belowLaptopThreshold ? 'ทำไมคำนวณได้ ฿0' : 'ผลคำนวณของรายการนี้'
      : guidedFocus === 'approved' ? 'ผลหลังใช้กฎที่อนุมัติ' : `ทดลองอายุใช้งาน ${months} เดือน`;
    const heroNote = guidedFocus === 'why'
      ? proofReason
      : guidedFocus === 'approved'
        ? approvalRecorded
          ? `ใช้กฎ v${workspace.policy.version} ที่อนุมัติแล้ว · ผลเดิมยังดูย้อนหลังได้`
          : `ใช้กฎ v${workspace.policy.version} ปัจจุบัน · ไม่พบการอนุมัติที่บันทึกไว้`
        : `ทดลอง ${months} เดือน · ผลจริงและกฎ v${workspace.policy.version} / ${workspace.policy.laptop.usefulLifeMonths} เดือนยังไม่เปลี่ยน`;
    const proof = <section className="learning-demo-proof" data-testid="demo-learning-proof" data-focus={guidedFocus} aria-live="polite">
      <div className="learning-demo-proof__eyebrow"><Sparkles size={13} /> LEARNING LENS {recordIdentifier && <code>{recordIdentifier}</code>} <span>{guidedFocus === 'experiment' ? 'WHAT-IF' : 'ผลจริง'}</span></div>
      <h2>{heroTitle}</h2>
      {guidedFocus === 'approved' && !priorRow ? <div className="learning-demo-proof__single">
        <span>ผลคำนวณปัจจุบัน · v{workspace.policy.version}</span>
        <strong>{proofValue(explanation.calculation?.calculated)}</strong>
      </div> : <div className="learning-demo-proof__comparison">
        <div><span>{leftLabel}</span><strong>{proofValue(guidedFocus === 'experiment' ? focusedResult : comparisonValue)}</strong></div>
        <ArrowRight size={16} aria-hidden="true" />
        <div><span>{rightLabel}</span><strong>{proofValue(guidedFocus === 'experiment' ? experimentAfter : focusedResult)}</strong></div>
      </div>}
      <p>{heroNote}</p>
      {guidedFocus === 'approved' && !priorRow && <small>ไม่พบผลจาก run ก่อนหน้าสำหรับแถวนี้ จึงไม่แสดงค่าเปรียบเทียบที่ไม่มีหลักฐาน</small>}
    </section>;
    return <div className="learning-object learning-object--guided" data-testid="learning-object">
      {proof}
      {guidedFocus === 'experiment' && experimentPanel}
      <details className="learning-demo-evidence">
        <summary><Database size={14} /> ดูที่มา สูตร และการตรวจสอบทั้งหมด</summary>
        {fullEvidence(guidedFocus !== 'experiment')}
      </details>
    </div>;
  }

  return <div className="learning-object" data-testid="learning-object">{fullEvidence(true)}</div>;
}

function resolveObject(workspace: Workspace, reference: string): CanvasObject | undefined {
  return workspace.objects.find(item => item.id === reference || item.kind === reference)
    ?? workspace.objects.find(item => item.dataRefs.includes(reference) || Object.values(item.configuration).some(value => value === reference));
}

function focusCanvasObject(workspace: Workspace, reference: string, fitView: ReturnType<typeof useReactFlow>['fitView'], getNodes: ReturnType<typeof useReactFlow>['getNodes']) {
  const object = resolveObject(workspace, reference);
  if (!object) return false;
  const node = getNodes().find(candidate => candidate.id === object.id);
  if (!node) return false;
  void fitView({ nodes: [node], duration: 550, padding: 0.4, maxZoom: 1.2 });
  return true;
}

export function WorkspaceOverview({ object }: LearningObjectProps) {
  const workspace = useWorkspace(state => state.workspace);
  const setInspector = useWorkspace(state => state.setInspector);
  const openLearning = useWorkspace(state => state.openLearning);
  const flow = useReactFlow();
  const overview = useMemo(() => deriveWorkspaceExplanation(workspace), [workspace]);
  const relevantObjects = overview.objectRefs.map(reference => ({ reference, object: resolveObject(workspace, reference) })).filter(item => item.object);
  const recentEvents = workspace.events.slice(-4).reverse();
  const activeProposal = workspace.proposals.find(proposal => proposal.id === workspace.activeProposalId);
  const pendingHandoffs = workspace.handoffs.filter(handoff => (!handoff.datasetId||handoff.datasetId===workspace.dataset.id)&&(handoff.status === 'waiting' || handoff.status === 'in-progress'));
  const firstLedgerFinding = workspace.domain === 'accounting' ? (workspace.result.ledgerFindings || [])[0] : undefined;
  const firstReviewRow = workspace.domain === 'accounting'
    ? workspace.result.rows.find(result => result.status === 'review' || result.findings.length > 0)
    : undefined;
  const firstEquipmentAttention = workspace.domain === 'maintenance'
    ? workspace.runs.at(-1)?.equipmentResults?.find(result => result.priority !== 'healthy')
    : undefined;

  const focus = (reference: string) => {
    if (!focusCanvasObject(workspace, reference, flow.fitView, flow.getNodes)) {
      setInspector({ type: 'history' });
    }
  };
  const runNextAction = (action: string) => {
    if (activeProposal && action.includes(activeProposal.id)) {
      setInspector({ type: 'proposal' });
      return;
    }
    if (pendingHandoffs.length > 0 && action.toLowerCase().startsWith('follow up on ') && action.toLowerCase().includes('handoff')) {
      setInspector({ type: 'handoff', rowId: pendingHandoffs[0].rowId });
      return;
    }
    if (action.toLowerCase().startsWith('review current findings')) {
      if (firstLedgerFinding) {
        setInspector({ type: 'source', initialTab: 'ledger', initialQuery: firstLedgerFinding.entry.id });
        return;
      }
      if (firstReviewRow) {
        setInspector({ type: 'asset', rowId: firstReviewRow.asset.rowId });
        return;
      }
      if (workspace.domain === 'maintenance' && firstEquipmentAttention) {
        openLearning(firstEquipmentAttention.equipment.id, 'table');
        return;
      }
      const exceptions = workspace.objects.find(item => item.kind === 'exceptions');
      if (exceptions) {
        focus(exceptions.id);
        return;
      }
      setInspector({ type: 'history' });
      return;
    }
    if (workspace.dataset.source === 'imported' && action.startsWith('Import the next reporting period')) {
      setInspector({ type: 'source' });
      return;
    }
    setInspector({ type: 'history' });
  };

  return <div className="workspace-overview" data-testid="workspace-overview" data-object-id={object.id}>
    <section className="workspace-overview__hero">
      <div className="workspace-overview__mark"><BookOpen size={17} /></div>
      <div><span className="workspace-overview__eyebrow">EXECUTABLE WORKSPACE KNOWLEDGE</span><h2>{overview.title}</h2><p>{overview.purpose}</p></div>
    </section>

    <OverviewList title="How the work flows" icon={<ArrowRight size={14} />} items={overview.workflow} />
    <OverviewList title="Capabilities in this workspace" icon={<ShieldCheck size={14} />} items={overview.activeCapabilities} />
    <OverviewList title="Recent changes" icon={<RefreshCw size={14} />} items={overview.recentChanges} />
    <OverviewList title="Needs attention" icon={<CircleHelp size={14} />} items={overview.attention} empty="No unresolved attention items are recorded." tone="attention" />

    <section className="workspace-overview__section">
      <div className="workspace-overview__section-title"><span><Sparkles size={14} /> Suggested next actions</span></div>
      {overview.nextActions.length ? <div className="workspace-overview__actions">{overview.nextActions.map((action, index) => <button key={`${index}-${action}`} onClick={() => runNextAction(action)}><span>{action}</span><ArrowRight size={14} /></button>)}</div> : <p className="workspace-overview__empty">No next action has been derived from the current workspace state.</p>}
    </section>

    <section className="workspace-overview__section">
      <div className="workspace-overview__section-title"><span><GitBranch size={14} /> Related canvas objects</span><small>{relevantObjects.length}</small></div>
      {relevantObjects.length ? <div className="workspace-overview__object-list">{relevantObjects.map(({ reference, object: item }) => item && <button key={`${reference}-${item.id}`} onClick={() => focus(reference)}><span className="workspace-overview__object-icon">{item.kind === 'source' ? <Database size={14} /> : item.kind === 'worker' ? <Code2 size={14} /> : <GitBranch size={14} />}</span><span><strong>{item.title}</strong><small>{item.kind} · {item.status}</small></span><ArrowRight size={14} /></button>)}</div> : <p className="workspace-overview__empty">The explanation did not identify any linked canvas objects.</p>}
    </section>

    <section className="workspace-overview__section">
      <div className="workspace-overview__section-title"><span><Clock3 size={14} /> Latest recorded events</span><button onClick={() => setInspector({ type: 'history' })}>Open history <ArrowRight size={12} /></button></div>
      {recentEvents.length ? <ol className="workspace-overview__events">{recentEvents.map(event => <li key={event.id}><strong>{event.title}</strong><span>{event.detail}</span><small>{new Date(event.endedAt).toLocaleString()} · {event.status}</small></li>)}</ol> : <p className="workspace-overview__empty">No execution or teaching events have been recorded.</p>}
    </section>
    <div className="workspace-overview__actions"><button onClick={()=>useWorkspace.getState().setLens('constellation')}><GitBranch size={14}/>Explore connected knowledge<ArrowRight size={14}/></button></div><footer className="workspace-overview__foot">Derived from this workspace’s current data, policy, outputs, proposals, handoffs, and recorded events. No names or approvals are inferred.</footer>
  </div>;
}

function OverviewList({ title, icon, items, empty, tone }: { title: string; icon: ReactNode; items: string[]; empty?: string; tone?: 'attention' }) {
  return <section className={`workspace-overview__section ${tone === 'attention' ? 'workspace-overview__section--attention' : ''}`}>
    <div className="workspace-overview__section-title"><span>{icon} {title}</span><small>{items.length}</small></div>
    {items.length ? <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="workspace-overview__empty">{empty ?? 'No recorded items yet.'}</p>}
  </section>;
}
