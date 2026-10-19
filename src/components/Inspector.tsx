import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import accountingSource from '../domain/accounting.ts?raw';
import maintenanceSource from '../domain/maintenance.ts?raw';
import {
  AlertTriangle,
  ArrowDownUp,
  ArrowRight,
  ArrowUpRight,
  BadgeCheck,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  FileClock,
  GitBranch,
  History,
  Layers3,
  ListChecks,
  MapPinned,
  Play,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Sparkles,
  Table2,
  X,
  XCircle,
} from 'lucide-react';
import type { Category, EquipmentResult, Policy } from '../domain/types';
import { evaluateEquipment } from '../domain/maintenance';
import AssetPolicyDraft from './AssetPolicyDraft';
import {
  TEACHING_PROMPT,
  activeProposal,
  useWorkspace,
} from '../state/store';
import type { InspectorTarget, TraceEvent, Workspace } from '../state/types';
import './inspector.css';

type IconType = typeof Database;

const money = (value: number | null | undefined) =>
  value == null || !Number.isFinite(value)
    ? '—'
    : `฿${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value)}`;
const signedMoney = (value: number | null | undefined) => {
  if (value == null || !Number.isFinite(value)) return 'Unknown';
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}฿${new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(rounded))}`;
};
const dateTime = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
};
const dateOnly = (value: string | null | undefined) => {
  if (!value) return 'Not recorded';
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(date);
};
const shortId = (value: string | null | undefined) => value ? value.slice(0, 18) : 'Not available';
const policyLabel = (policy: Pick<Policy, 'version'>) => `v${policy.version}`;
const formatBool = (value: string | number | boolean) => typeof value === 'boolean' ? (value ? 'Yes' : 'No') : String(value);

const targetCopy: Record<InspectorTarget['type'], { title: string; eyebrow: string; icon: IconType; description: string }> = {
  source: { title: 'Source material', eyebrow: 'DATA & FIELD MAP', icon: Database, description: 'Inspect the rows that feed this workspace.' },
  script: { title: 'Calculation worker', eyebrow: 'DETERMINISTIC LOGIC', icon: Code2, description: 'See the active calculation and propose a parameter change.' },
  policy: { title: 'Rule versions', eyebrow: 'POLICY HISTORY', icon: GitBranch, description: 'Review approved versions and restore prior behavior.' },
  teach: { title: 'Teach this workspace', eyebrow: 'HUMAN INPUT', icon: Sparkles, description: 'Turn an instruction into a scoped, reviewable action.' },
  proposal: { title: 'Rule proposal', eyebrow: 'REVIEW BEFORE PUBLISHING', icon: ShieldCheck, description: 'Compare the candidate with the active rule.' },
  evaluation: { title: 'Verification bench', eyebrow: 'REGRESSION RESULTS', icon: ListChecks, description: 'Review each expected and observed outcome.' },
  history: { title: 'Run history', eyebrow: 'REPLAYABLE EVIDENCE', icon: History, description: 'Inspect what each calculation used and produced.' },
  help: { title: 'How this canvas works', eyebrow: 'QUICK GUIDE', icon: CircleHelp, description: 'A short path through the deterministic local demo.' },
  intake: { title: 'Report an issue', eyebrow: 'MAINTENANCE INTAKE', icon: CalendarDays, description: 'Record an equipment issue for the maintenance team.' },
  asset: { title: 'Asset record', eyebrow: 'CASE INSPECTOR', icon: Table2, description: 'Trace the source row through calculation and ledger evidence.' },
  handoff: { title: 'Review handoff', eyebrow: 'HUMAN FOLLOW-UP', icon: ArrowDownUp, description: 'Carry this exception with its evidence and next action.' },
};

function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'teal' }) {
  return <span className={`inspector__pill inspector__pill--${tone}`}>{children}</span>;
}

function Section({ title, trailing, children }: { title: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <section className="inspector__section">
      <div className="inspector__section-head"><h3>{title}</h3>{trailing}</div>
      {children}
    </section>
  );
}

function Metric({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return <div className="inspector__metric"><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</div>;
}

function EmptyState({ icon: Icon = Layers3, title, children }: { icon?: IconType; title: string; children: ReactNode }) {
  return <div className="inspector__empty"><Icon size={19} strokeWidth={1.8} /><strong>{title}</strong><p>{children}</p></div>;
}

function ActionButton({ children, onClick, kind = 'secondary', disabled = false, testId, type = 'button' }: {
  children: ReactNode; onClick?: () => void; kind?: 'primary' | 'secondary' | 'quiet' | 'danger'; disabled?: boolean; testId?: string; type?: 'button' | 'submit';
}) {
  return <button type={type} className={`inspector__button inspector__button--${kind}`} onClick={onClick} disabled={disabled} data-testid={testId}>{children}</button>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="inspector__field"><span className="inspector__field-label">{label}</span>{children}{hint && <small>{hint}</small>}</label>;
}

function Definition({ label, value, mono = false }: { label: string; value: ReactNode; mono?: boolean }) {
  return <div className="inspector__definition"><dt>{label}</dt><dd className={mono ? 'inspector__mono' : undefined}>{value}</dd></div>;
}

function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return <div className="inspector__summary">{items.map(item => <div key={item.label}><span>{item.label}</span><strong>{item.value}</strong></div>)}</div>;
}

function EventCard({ event, showRuleVersion = true }: { event: TraceEvent; showRuleVersion?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const statusTone = event.status === 'completed' ? 'good' : event.status === 'rejected' ? 'neutral' : event.status === 'needs-input' ? 'warn' : 'bad';
  return (
    <div className="inspector__event">
      <button className="inspector__event-toggle" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span className="inspector__event-mark"><Clock3 size={14} /></span>
        <span className="inspector__event-copy"><strong>{event.title}</strong><small>{dateTime(event.endedAt)} · {event.workerType} · {event.workerId}</small></span>
        <Pill tone={statusTone}>{event.status}</Pill>
        {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
      </button>
      {expanded && <div className="inspector__event-detail">
        <p>{event.detail}</p>
        {event.error && <p className="inspector__error-text"><AlertTriangle size={14} />{event.error}</p>}
        <dl className="inspector__definitions">
          <Definition label="Task" value={event.taskId} mono />
          {showRuleVersion && <Definition label="Rule version" value={policyLabel({ version: event.ruleVersion })} />}
          <Definition label="Started" value={dateTime(event.startedAt)} />
          <Definition label="Inputs" value={event.inputs.length ? event.inputs.join(', ') : 'None recorded'} mono />
          <Definition label="Outputs" value={event.outputs.length ? event.outputs.join(', ') : 'None recorded'} mono />
          {event.approvalRef && <Definition label="Approval reference" value={event.approvalRef} mono />}
        </dl>
      </div>}
    </div>
  );
}

function SourcePanel({ workspace, setInspector, initialTab, initialQuery }: { workspace: Workspace; setInspector: (target: InspectorTarget | null) => void; initialTab?: 'ledger'; initialQuery?: string }) {
  const [tab, setTab] = useState<'assets' | 'ledger' | 'mapping'>(workspace.domain === 'accounting' ? initialTab ?? 'assets' : 'assets');
  const [query, setQuery] = useState(workspace.domain === 'accounting' ? initialQuery ?? '' : '');
  const assets = useMemo(() => workspace.dataset.assets.filter(row => `${row.assetId} ${row.description} ${row.category} ${row.department}`.toLowerCase().includes(query.toLowerCase())), [workspace.dataset.assets, query]);
  const ledger = useMemo(() => workspace.dataset.ledger.filter(row => `${row.assetId} ${row.account} ${row.period} ${row.id}`.toLowerCase().includes(query.toLowerCase())), [workspace.dataset.ledger, query]);
  const allLedgerFindings = workspace.result.ledgerFindings ?? [];
  const ledgerFindings = allLedgerFindings.filter(({ entry, finding }) => `${entry.id} ${entry.assetId} ${entry.period} ${entry.account} ${finding.code} ${finding.message}`.toLowerCase().includes(query.toLowerCase()));
  const equipmentResults = useMemo(() => evaluateEquipment(workspace.equipment), [workspace.equipment]);
  if (workspace.domain === 'maintenance') {
    const filtered = equipmentResults.filter(({ equipment }) => `${equipment.id} ${equipment.name} ${equipment.category} ${equipment.owner} ${equipment.location}`.toLowerCase().includes(query.toLowerCase()));
    const fieldMap = [['id', 'Equipment ID'], ['name', 'Equipment name'], ['category', 'Equipment category'], ['owner', 'Responsible owner'], ['warrantyUntil', 'Warranty end date'], ['condition', 'Current condition'], ['location', 'Location']];
    return <>
      <SummaryStrip items={[
        { label: 'Inventory', value: 'Demo equipment' },
        { label: 'Equipment', value: workspace.equipment.length },
        { label: 'Urgent', value: equipmentResults.filter(row => row.priority === 'urgent').length },
        { label: 'Due soon', value: equipmentResults.filter(row => row.priority === 'soon').length },
      ]} />
      <div className="inspector__tabs" role="tablist" aria-label="Equipment source views">
        <button role="tab" aria-selected={tab !== 'mapping'} className={tab !== 'mapping' ? 'is-active' : ''} onClick={() => { setTab('assets'); setQuery(''); }}>Equipment rows</button>
        <button role="tab" aria-selected={tab === 'mapping'} className={tab === 'mapping' ? 'is-active' : ''} onClick={() => { setTab('mapping'); setQuery(''); }}>Field map</button>
      </div>
      {tab !== 'mapping' && <div className="inspector__search"><Database size={15} /><input aria-label="Filter equipment rows" value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter equipment rows" /></div>}
      {tab === 'mapping' ? <div className="inspector__mapping-list">
        <p className="inspector__callout"><MapPinned size={16} /> These source fields are read directly by the warranty and condition worker.</p>
        {fieldMap.map(([raw, mapped]) => <div className="inspector__mapping-row inspector__mapping-row--equipment" key={raw}><span>Inventory</span><code>{raw}</code><ArrowRight size={14} /><strong>{mapped}</strong></div>)}
      </div> : <div className="inspector__table-wrap">
        {filtered.length ? <table className="inspector__table inspector__table--equipment"><thead><tr><th>Equipment</th><th>Owner / location</th><th>Warranty</th><th>Condition</th><th>Priority</th></tr></thead><tbody>{filtered.map(({ equipment, warrantyDays, priority, reason }) => <tr key={equipment.id}><td><strong>{equipment.name}</strong><small>{equipment.id} · {equipment.category}</small></td><td>{equipment.owner}<small>{equipment.location}</small></td><td>{dateOnly(equipment.warrantyUntil)}<small>{warrantyDays < 0 ? `${Math.abs(warrantyDays)} days expired` : `${warrantyDays} days remaining`}</small></td><td>{equipment.condition.replaceAll('-', ' ')}</td><td><Pill tone={priority === 'healthy' ? 'good' : priority === 'soon' ? 'warn' : 'bad'}>{priority}</Pill><small>{reason}</small></td></tr>)}</tbody></table> : <EmptyState title="No matching equipment">Try a different equipment name, owner, or location.</EmptyState>}
      </div>}
      <p className="inspector__footnote"><span className="inspector__dot" /> Live inventory · warranty rules evaluated as of 30 September 2026 · {workspace.incidents.length} incident reports</p>
    </>;
  }
  const maps = [
    ['Asset register', 'assetId', 'Asset identifier'], ['Asset register', 'description', 'Description'], ['Asset register', 'category', 'Category'],
    ['Asset register', 'cost', 'Original cost'], ['Asset register', 'acquisitionDate', 'Acquisition date'], ['Asset register', 'inServiceDate', 'In-service date'],
    ['Asset register', 'usefulLifeMonths', 'Useful life (months)'], ['Asset register', 'recordedMonthlyDepreciation', 'Recorded monthly depreciation'],
    ['Ledger', 'assetId', 'Asset identifier'], ['Ledger', 'period', 'Posting period'], ['Ledger', 'account', 'GL account'], ['Ledger', 'amount', 'Posted amount'],
  ];
  return <>
    {workspace.sourceConnections?.map(connection => <div className="inspector__source-connection" key={connection.id}>
      <strong>{connection.kind==='database'?'Database · snapshot ตัวอย่าง':'Excel · อ่านไฟล์จริง'}</strong><code>{connection.resource}</code>
      <small>{connection.rowCount} แถว · {connection.mode==='demo-snapshot'?'ข้อมูลสมมติที่แนบมากับเดโม ไม่เชื่อม SQL ภายนอก':'อ่านและคำนวณในเบราว์เซอร์'}</small>
    </div>)}
    <SummaryStrip items={[
      { label: 'Source', value: workspace.dataset.source === 'synthetic' ? 'Synthetic' : 'Imported' },
      { label: 'Period', value: workspace.dataset.period },
      { label: 'Asset rows', value: workspace.dataset.assets.length },
      { label: 'Ledger rows', value: workspace.dataset.ledger.length },
    ]} />
    <div className="inspector__tabs" role="tablist" aria-label="Source data views">
      {(['assets', 'ledger', 'mapping'] as const).map(value => <button role="tab" aria-selected={tab === value} className={tab === value ? 'is-active' : ''} key={value} onClick={() => { setTab(value); setQuery(''); }}>{value === 'assets' ? 'Asset rows' : value === 'ledger' ? 'Ledger rows' : 'Field map'}</button>)}
    </div>
    {tab !== 'mapping' && <div className="inspector__search"><Database size={15} /><input aria-label="Filter source rows" value={query} onChange={event => setQuery(event.target.value)} placeholder={`Filter ${tab === 'assets' ? 'asset' : 'ledger'} rows`} /></div>}
    {tab === 'assets' && <div className="inspector__table-wrap">
      {assets.length ? <table className="inspector__table"><thead><tr><th>Asset</th><th>Category</th><th>Cost</th><th>In service</th><th>Recorded / month</th></tr></thead><tbody>{assets.map(row => <tr key={row.rowId}><td><button className="inspector__row-open" data-testid="source-open-row" onClick={() => setInspector({ type: 'asset', rowId: row.rowId })}>{row.assetId}</button><small>{row.description}</small><code>{row.rowId}</code></td><td>{row.category}</td><td>{money(row.cost)}</td><td>{dateOnly(row.inServiceDate)}</td><td>{money(row.recordedMonthlyDepreciation)}</td></tr>)}</tbody></table> : <EmptyState title="No matching asset rows">Try a different identifier or description.</EmptyState>}
    </div>}
    {tab === 'ledger' && <div className="inspector__table-wrap">
      {ledger.length ? <table className="inspector__table"><thead><tr><th>Entry</th><th>Asset</th><th>Period</th><th>GL account</th><th>Amount</th></tr></thead><tbody>{ledger.map(row => <tr key={row.id}><td><code>{row.id}</code></td><td><strong>{row.assetId}</strong></td><td>{row.period}</td><td>{row.account}</td><td>{money(row.amount)}</td></tr>)}</tbody></table> : <EmptyState title="No matching ledger rows">Try a different asset, period, or account.</EmptyState>}
    </div>}
    {tab === 'ledger' && allLedgerFindings.length > 0 && <Section title="Ledger-only warnings" trailing={<Pill tone={ledgerFindings.some(({ finding }) => finding.severity === 'error') ? 'bad' : 'warn'}>{ledgerFindings.length} shown</Pill>}>
      {ledgerFindings.length ? <div className="inspector__table-wrap"><table className="inspector__table inspector__table--ledger-findings"><thead><tr><th>Entry</th><th>Ledger asset ID</th><th>Amount</th><th>GL account</th><th>Reason</th></tr></thead><tbody>{ledgerFindings.map(({ entry, finding }, index) => <tr key={`${entry.id}-${finding.code}-${index}`}><td><code>{entry.id || 'Not recorded'}</code><small>{entry.period}</small></td><td>{entry.assetId || 'Not recorded'}</td><td>{money(entry.amount)}</td><td>{entry.account || 'Blank GL account'}</td><td><Pill tone={finding.severity === 'error' ? 'bad' : 'warn'}>{finding.code}</Pill><small>{finding.message}</small></td></tr>)}</tbody></table></div> : <EmptyState icon={AlertTriangle} title="No matching ledger warnings">No ledger-only warnings match this filter.</EmptyState>}
    </Section>}
    {tab === 'mapping' && <div className="inspector__mapping-list">
      <p className="inspector__callout"><MapPinned size={16} /> Original row values remain available in the source views. The mapping below shows how this demo reads each field.</p>
      {maps.map(([source, raw, mapped]) => <div className="inspector__mapping-row" key={`${source}:${raw}`}><span>{source}</span><code>{raw}</code><ArrowRight size={14} /><strong>{mapped}</strong></div>)}
    </div>}
    <p className="inspector__footnote"><span className="inspector__dot" /> {workspace.dataset.name} · dataset {workspace.dataset.id}</p>
  </>;
}

function ScriptPanel({ workspace, propose }: { workspace: Workspace; propose: (candidate: Policy, instruction: string) => void }) {
  const { policy, result } = workspace;
  const [threshold, setThreshold] = useState(String(policy.laptop.threshold));
  const [life, setLife] = useState(String(policy.laptop.usefulLifeMonths));
  const [start, setStart] = useState<Policy['laptop']['start']>(policy.laptop.start);
  const [formError, setFormError] = useState('');
  useEffect(() => {
    setThreshold(String(policy.laptop.threshold));
    setLife(String(policy.laptop.usefulLifeMonths));
    setStart(policy.laptop.start);
  }, [policy.version]);
  if (workspace.domain === 'maintenance') return <MaintenanceScriptPanel workspace={workspace} />;
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const thresholdValue = Number(threshold);
    const lifeValue = Number(life);
    if (!Number.isFinite(thresholdValue) || thresholdValue < 0 || !Number.isInteger(lifeValue) || lifeValue < 1 || lifeValue > 600) {
      setFormError('Enter a non-negative threshold and a whole useful life from 1 to 600 months.');
      return;
    }
    setFormError('');
    propose({ ...policy, laptop: { threshold: thresholdValue, usefulLifeMonths: lifeValue, start } }, `Parameter update proposed from the calculation worker: laptop threshold ${money(thresholdValue)}, useful life ${lifeValue} months, start ${start}.`);
  };
  return <>
    <div className="inspector__algorithm-card">
      <div className="inspector__algorithm-heading"><span className="inspector__icon-box"><Code2 size={17} /></span><div><strong>Straight-line depreciation</strong><small>Rule version {policyLabel(policy)} · deterministic calculation</small></div><Pill tone="teal">Active</Pill></div>
      <div className="inspector__formula"><span>MONTHLY DEPRECIATION</span><code>round(cost ÷ useful life) · capped at remaining carrying value</code></div>
      <ol className="inspector__steps">
        <li><span>01</span><p>Apply the laptop threshold to laptops and the default threshold to other categories. Cost below its threshold produces no depreciation.</p></li>
        <li><span>02</span><p>Laptops use the policy life and start convention. Other categories keep each source row’s useful life and begin in the month after service.</p></li>
        <li><span>03</span><p>Round cost divided by useful life to cents, then cap the month at cost less accumulated depreciation. Before the effective start month the amount is zero.</p></li>
        <li><span>04</span><p>Compare calculated to recorded amounts, then compare recorded amounts with matching period ledger entries. Dates, accounts, IDs, and other source issues remain review findings.</p></li>
      </ol>
    </div>
    <Section title="Laptop parameters" trailing={<Pill>v{policy.version}</Pill>}>
      <form className="inspector__form" onSubmit={submit}>
        <div className="inspector__field-grid">
          <Field label="Capitalization threshold" hint="Assets at or above this amount follow the laptop rule."><div className="inspector__input-prefix"><span>฿</span><input aria-label="Laptop threshold" inputMode="decimal" type="number" min="0" step="0.01" value={threshold} onChange={event => setThreshold(event.target.value)} /></div></Field>
          <Field label="Useful life" hint="Whole months, from 1 to 600."><div className="inspector__input-suffix"><input aria-label="Laptop useful life in months" type="number" min="1" max="600" step="1" value={life} onChange={event => setLife(event.target.value)} /><span>months</span></div></Field>
        </div>
        <Field label="Depreciation begins"><select value={start} onChange={event => setStart(event.target.value as Policy['laptop']['start'])}><option value="in-service">Month placed in service</option><option value="following-month">Following month</option></select></Field>
        {formError && <p className="inspector__inline-error" role="alert">{formError}</p>}
        <ActionButton kind="primary" type="submit"><GitBranch size={15} /> Propose parameter change</ActionButton>
      </form>
    </Section>
    <p className="inspector__callout"><ShieldCheck size={16} /> Editing here creates a candidate. The active rule changes only after passing tests and your approval.</p>
    <SummaryStrip items={[{ label: 'Rows evaluated', value: result.summary.totalAssets }, { label: 'Need review', value: result.summary.exceptions }, { label: 'Current policy', value: `v${policy.version}` }]} />
    <ExecutableSource source={accountingSource} label="Accounting calculation" />
  </>;
}

function MaintenanceScriptPanel({ workspace }: { workspace: Workspace }) {
  const results = evaluateEquipment(workspace.equipment);
  const urgent = results.filter(result => result.priority === 'urgent').length;
  const soon = results.filter(result => result.priority === 'soon').length;
  const healthy = results.filter(result => result.priority === 'healthy').length;
  return <>
    <div className="inspector__algorithm-card">
      <div className="inspector__algorithm-heading"><span className="inspector__icon-box"><Clock3 size={17} /></span><div><strong>Warranty and condition worker</strong><small>Deterministic evaluation · as of 30 September 2026</small></div><Pill tone="teal">Live</Pill></div>
      <div className="inspector__formula"><span>PRIORITY RULES</span><code>condition + calendar-day warranty window</code></div>
      <ol className="inspector__steps">
        <li><span>01</span><p>An invalid warranty or reference date is marked urgent for review.</p></li>
        <li><span>02</span><p>Any condition other than working is urgent. An expired warranty is also urgent.</p></li>
        <li><span>03</span><p>A working item with 0–30 days remaining is due soon.</p></li>
        <li><span>04</span><p>A working item with more than 30 days remaining is healthy. Day counts use calendar days from the fixed demo reference date.</p></li>
      </ol>
    </div>
    <SummaryStrip items={[{ label: 'Equipment', value: results.length }, { label: 'Urgent', value: urgent }, { label: 'Due soon', value: soon }, { label: 'Healthy', value: healthy }]} />
    <Section title="Current worker output"><div className="inspector__equipment-results">
      {results.map(({ equipment, warrantyDays, priority, reason }) => <article className="inspector__equipment-result" key={equipment.id}>
        <div><strong>{equipment.name}</strong><small>{equipment.id} · {equipment.condition.replaceAll('-', ' ')} · warranty {dateOnly(equipment.warrantyUntil)}</small></div>
        <Pill tone={priority === 'healthy' ? 'good' : priority === 'soon' ? 'warn' : 'bad'}>{priority}</Pill>
        <p>{reason}{warrantyDays >= 0 ? ` (${warrantyDays} days remaining)` : ''}</p>
      </article>)}
      {!results.length && <EmptyState title="No equipment records">The worker has no inventory rows to evaluate.</EmptyState>}
    </div></Section>
    <p className="inspector__callout"><ShieldCheck size={16} /> This worker uses the live equipment inventory and the fixed 30-day rule shown above. Its output is stored with maintenance run snapshots.</p>
    <ExecutableSource source={maintenanceSource} label="Maintenance calculation" />
  </>;
}

function ExecutableSource({ source, label }: { source: string; label: string }) {
  return <details className="inspector__source-details" data-testid="executable-source">
    <summary><Code2 size={15} /> View executable source</summary>
    <p>{label} · TypeScript · loaded from the active domain module</p>
    <pre aria-label={`${label} source code`} data-testid="executable-source-code" tabIndex={0}><code>{source}</code></pre>
  </details>;
}

function TeachPanel({ workspace, initialAssetId, initialInstruction, propose, setInspector }: { workspace: Workspace; initialAssetId: string | null; initialInstruction?: string; propose: (candidate: Policy, instruction: string) => void; setInspector: (target: InspectorTarget | null) => void }) {
  const demoActive = useWorkspace(state => state.demoActive);
  const demoDraftStage = useWorkspace(state => state.demoDraftStage);
  const guidedTeach = demoActive && demoDraftStage !== null;
  const [instruction, setInstruction] = useState(initialInstruction?.trim() || TEACHING_PROMPT);
  const [scope, setScope] = useState<'reusable' | 'record' | 'preference' | 'workflow'>(() => initialInstruction?.trim() ? 'reusable' : initialAssetId ? 'record' : 'reusable');
  useEffect(() => {
    if (initialInstruction?.trim()) {
      setInstruction(initialInstruction);
      setScope('reusable');
    }
  }, [initialInstruction]);
  const [assetId, setAssetId] = useState(initialAssetId || workspace.dataset.assets[0]?.rowId || '');
  const selectedAsset = workspace.dataset.assets.find(asset => asset.rowId === assetId) ?? workspace.dataset.assets[0];
  const [category, setCategory] = useState<Category>(selectedAsset?.category ?? 'Unknown');
  const [acquisitionDate, setAcquisitionDate] = useState(selectedAsset?.acquisitionDate ?? '');
  const [inServiceDate, setInServiceDate] = useState(selectedAsset?.inServiceDate ?? '');
  const [recorded, setRecorded] = useState(String(selectedAsset?.recordedMonthlyDepreciation ?? 0));
  const [error, setError] = useState('');
  const visibleScope = guidedTeach ? 'reusable' : scope;
  const correctOneRecord = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = Number(recorded);
    if (!instruction.trim()) { setError('Write a short note describing the correction.'); return; }
    if (!selectedAsset || !Number.isFinite(amount) || amount < 0) { setError('Select an asset and enter a non-negative recorded amount.'); return; }
    setError('');
    useWorkspace.getState().correctAsset(selectedAsset.rowId, { category, acquisitionDate: acquisitionDate || null, inServiceDate: inServiceDate || null, recordedMonthlyDepreciation: amount }, instruction);
    useWorkspace.getState().notify(`Record correction applied: ${selectedAsset.assetId}. Note: ${instruction.trim()}`);
    setInspector({ type: 'asset', rowId: selectedAsset.rowId });
  };
  const applyPreference = () => {
    if (!instruction.trim()) { setError('Write an instruction before applying a preference.'); return; }
    useWorkspace.getState().setHideMatched(!workspace.preferences.hideMatched);
    useWorkspace.getState().notify(`View preference updated: matched rows ${workspace.preferences.hideMatched ? 'shown' : 'hidden'}.`);
    setError('');
  };
  return <>
    {guidedTeach ? <div className="inspector__guided-draft-intro"><Sparkles size={13} /><strong>กำลังเพิ่มตัวตั้งค่า · Draft</strong></div> : <>
      <div className="inspector__teaching-intro"><span className="inspector__icon-box inspector__icon-box--glow"><Sparkles size={17} /></span><p>Your prompt stays in view. This demo does not parse arbitrary text; the selected controls below define its supported action.</p></div>
      <Field label="Your instruction"><textarea className="inspector__prompt" value={instruction} onChange={event => setInstruction(event.target.value)} rows={4} /></Field>
      <Field label="Apply this as"><select value={scope} onChange={event => { setScope(event.target.value as typeof scope); setError(''); }}>
        <option value="reusable">Reusable accounting rule</option>
        <option value="record">One source record</option>
        <option value="preference">View preference</option>
        <option value="workflow">Workflow change</option>
      </select></Field>
    </>}
    {visibleScope === 'reusable' && <AssetPolicyDraft workspace={workspace} initialInstruction={instruction} propose={propose} />}
    {visibleScope === 'record' && <form className="inspector__form" onSubmit={correctOneRecord}>
      <div className="inspector__form-note"><Table2 size={15} /> This changes one source row and recalculates the workspace. It does not change the reusable policy. The instruction is retained with the recorded correction event.</div>
      <Field label="Asset record"><select value={selectedAsset?.rowId ?? ''} onChange={event => { const next = workspace.dataset.assets.find(asset => asset.rowId === event.target.value); if (next) { setAssetId(next.rowId); setCategory(next.category); setAcquisitionDate(next.acquisitionDate ?? ''); setInServiceDate(next.inServiceDate ?? ''); setRecorded(String(next.recordedMonthlyDepreciation)); } }}>
        {workspace.dataset.assets.map(asset => <option key={asset.rowId} value={asset.rowId}>{asset.assetId} · {asset.description}</option>)}
      </select></Field>
      {selectedAsset && <div className="inspector__field-grid"><Field label="Category"><select value={category} onChange={event => setCategory(event.target.value as Category)}>{(['Laptop', 'Furniture', 'Equipment', 'Vehicle', 'Unknown'] as const).map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Recorded / month"><div className="inspector__input-prefix"><span>฿</span><input aria-label="Recorded monthly depreciation" type="number" min="0" step="0.01" value={recorded} onChange={event => setRecorded(event.target.value)} /></div></Field><Field label="Acquisition date"><input type="date" value={acquisitionDate} onChange={event => setAcquisitionDate(event.target.value)} /></Field><Field label="In-service date"><input type="date" value={inServiceDate} onChange={event => setInServiceDate(event.target.value)} /></Field></div>}
      {error && <p className="inspector__inline-error" role="alert">{error}</p>}
      <ActionButton kind="primary" type="submit" disabled={!selectedAsset}><Check size={15} /> Apply record correction</ActionButton>
    </form>}
    {visibleScope === 'preference' && <div className="inspector__preference-card"><div><strong>Matched rows in the canvas</strong><p>This supported preference controls whether reconciled rows are tucked away in the main view.</p></div><span className="inspector__preference-state">{workspace.preferences.hideMatched ? 'Hidden' : 'Shown'}</span><ActionButton kind="primary" onClick={applyPreference}><Check size={15} /> {workspace.preferences.hideMatched ? 'Show matched rows' : 'Hide matched rows'}</ActionButton>{error && <p className="inspector__inline-error" role="alert">{error}</p>}</div>}
    {visibleScope === 'workflow' && <div className="inspector__unsupported"><span className="inspector__icon-box"><Layers3 size={17} /></span><strong>Workflow changes are not available here</strong><p>This demo does not add or rewire workflow steps from an instruction. The request stays visible above; choose a rule, one-record correction, or view preference to make a supported change.</p><ActionButton onClick={() => setInspector({ type: 'help' })}>See the quick guide <ArrowRight size={14} /></ActionButton></div>}
  </>;
}

function ProposalPanel({ workspace, testProposal, approve, reject, setInspector }: { workspace: Workspace; testProposal: () => void; approve: () => void; reject: () => void; setInspector: (target: InspectorTarget | null) => void }) {
  const proposal = activeProposal(workspace);
  if (!proposal) return <EmptyState icon={GitBranch} title="No active proposal">Use “Teach this workspace” to create a candidate rule that can be tested here.</EmptyState>;
  const mayApprove = proposal.status === 'tested' && !!proposal.evaluation && proposal.evaluation.failed === 0 && proposal.before.version === workspace.policy.version;
  const testedStale = proposal.before.version !== workspace.policy.version;
  return <>
    <div className="inspector__proposal-status"><span className="inspector__icon-box"><GitBranch size={17} /></span><div><strong>{proposal.status === 'tested' ? 'Candidate tested' : `Candidate based on v${proposal.before.version}`}</strong><small>Created {dateTime(proposal.createdAt)}</small></div><Pill tone={proposal.status === 'approved' ? 'good' : proposal.status === 'rejected' ? 'neutral' : proposal.status === 'tested' && proposal.evaluation?.failed ? 'bad' : 'warn'}>{proposal.status}</Pill></div>
    <Section title="Original instruction"><blockquote className="inspector__quote">{proposal.instruction}</blockquote></Section>
    <Section title="Policy diff"><div className="inspector__diff">
      <div className="inspector__diff-label"><span>Before · v{proposal.before.version}</span><span>After · candidate v{proposal.candidate.version}</span></div>
      <div className="inspector__diff-row"><span>Laptop threshold</span><strong>{money(proposal.before.laptop.threshold)}</strong><ArrowRight size={15} /><strong>{money(proposal.candidate.laptop.threshold)}</strong></div>
      <div className="inspector__diff-row"><span>Useful life</span><strong>{proposal.before.laptop.usefulLifeMonths} months</strong><ArrowRight size={15} /><strong>{proposal.candidate.laptop.usefulLifeMonths} months</strong></div>
      <div className="inspector__diff-row"><span>Start month</span><strong>{proposal.before.laptop.start === 'in-service' ? 'In service' : 'Following month'}</strong><ArrowRight size={15} /><strong>{proposal.candidate.laptop.start === 'in-service' ? 'In service' : 'Following month'}</strong></div>
      {(['Furniture','Equipment','Vehicle'] as const).filter(category=>JSON.stringify(proposal.before.categoryRules?.[category])!==JSON.stringify(proposal.candidate.categoryRules?.[category])).map(category=>{const a=proposal.before.categoryRules?.[category],b=proposal.candidate.categoryRules?.[category];const describe=(rule:typeof a,policy:Policy)=>`${money(rule?.threshold??policy.defaultThreshold)} · ${rule?.usefulLifeMonths===undefined?'source life':rule.usefulLifeMonths+' months'} · ${rule?.start??'following-month'}`;return <div className="inspector__diff-row" key={category}><span>{category}</span><strong>{describe(a,proposal.before)}</strong><ArrowRight size={15}/><strong>{describe(b,proposal.candidate)}</strong></div>;})}
    </div></Section>
    {proposal.evaluation ? <>
      <SummaryStrip items={[{ label: 'Tests passed', value: proposal.evaluation.passed }, { label: 'Failed', value: proposal.evaluation.failed }, { label: 'Changed rows', value: proposal.evaluation.impacts.length }]} />
      <Section title="Changed record preview" trailing={<ActionButton kind="quiet" onClick={() => setInspector({ type: 'evaluation' })}>All test cases <ArrowRight size={13} /></ActionButton>}>
        {proposal.evaluation.impacts.length ? <div className="inspector__impact-list">{proposal.evaluation.impacts.slice(0, 8).map(impact => <div key={impact.rowId} className="inspector__impact-row"><span><strong>{impact.assetId}</strong><small>{impact.rowId}</small></span><span>{money(impact.before)} <ArrowRight size={13} /> <strong>{money(impact.after)}</strong></span></div>)}</div> : <p className="inspector__muted">No calculated row values changed under this candidate.</p>}
      </Section>
      {testedStale && <p className="inspector__inline-error" role="alert">The active rule changed after this proposal was created. Create a new proposal against the current version.</p>}
    </> : <div className="inspector__callout"><ListChecks size={16} /> Run the regression suite to see affected outputs before approval.</div>}
    <div className="inspector__action-row">
      <ActionButton kind="primary" onClick={testProposal} disabled={!['proposed', 'tested'].includes(proposal.status) || testedStale} testId="run-tests"><Play size={15} /> {proposal.evaluation ? 'Run tests again' : 'Run tests'}</ActionButton>
      <ActionButton kind="secondary" onClick={approve} disabled={!mayApprove} testId="approve-proposal"><BadgeCheck size={15} /> Approve</ActionButton>
      <ActionButton kind="danger" onClick={reject} disabled={!['proposed', 'tested'].includes(proposal.status)}>Reject</ActionButton>
    </div>
    <p className="inspector__footnote">Approval requires passing tests against current policy v{workspace.policy.version}. The next calculation then records the approved rule version.</p>
  </>;
}

function EvaluationPanel({ workspace, setInspector }: { workspace: Workspace; setInspector: (target: InspectorTarget | null) => void }) {
  const proposal = activeProposal(workspace);
  const evaluation = proposal?.evaluation;
  const [filter, setFilter] = useState<'all' | 'regression' | 'new' | 'failed'>('all');
  const cases = evaluation?.cases.filter(test => filter === 'all' || (filter === 'failed' ? !test.passed : test.group === filter)) ?? [];
  if (!evaluation) return <EmptyState icon={ListChecks} title="No test run yet">Create a rule proposal, then run its test suite to compare expected and actual behavior.<ActionButton kind="primary" onClick={() => setInspector({ type: 'teach' })}><Sparkles size={14} /> Teach a rule</ActionButton></EmptyState>;
  return <>
    <div className="inspector__evaluation-banner"><span className={evaluation.failed ? 'inspector__result-icon inspector__result-icon--bad' : 'inspector__result-icon'}>{evaluation.failed ? <XCircle size={18} /> : <CheckCircle2 size={18} />}</span><div><strong>{evaluation.failed ? 'Candidate needs another review' : 'All test cases passed'}</strong><small>Ran {dateTime(evaluation.ranAt)} · candidate v{proposal?.candidate.version ?? '—'}</small></div></div>
    <SummaryStrip items={[{ label: 'Passed', value: evaluation.passed }, { label: 'Failed', value: evaluation.failed }, { label: 'Regressions', value: evaluation.regressions }, { label: 'New cases', value: evaluation.cases.filter(test => test.group === 'new').length }]} />
    <Section title="Case results" trailing={<select className="inspector__compact-select" aria-label="Filter test cases" value={filter} onChange={event => setFilter(event.target.value as typeof filter)}><option value="all">All cases</option><option value="regression">Regression</option><option value="new">New behavior</option><option value="failed">Failed only</option></select>}>
      {cases.length ? <div className="inspector__case-list">{cases.map(test => <article key={test.id} className={`inspector__case ${test.passed ? '' : 'inspector__case--failed'}`}>
        <span className="inspector__case-status">{test.passed ? <CheckCircle2 size={16} /> : <XCircle size={16} />}</span>
        <div className="inspector__case-body"><div className="inspector__case-title"><strong>{test.title.replaceAll('$', '฿')}</strong><Pill tone={test.group === 'regression' ? 'neutral' : 'teal'}>{test.group}</Pill></div><div className="inspector__case-values"><span><small>Expected</small><strong>{typeof test.expected === 'number' && test.id !== 'proposal-laptop-life' ? money(test.expected) : formatBool(test.expected)}</strong></span><ArrowRight size={13} /><span><small>Actual</small><strong className={test.passed ? '' : 'inspector__error-text'}>{typeof test.actual === 'number' && test.id !== 'proposal-laptop-life' ? money(test.actual) : formatBool(test.actual)}</strong></span></div>{!test.passed && <p className="inspector__failed-note">This case failed; approval remains disabled until a passing proposal is tested.</p>}</div>
      </article>)}</div> : <EmptyState title="No cases in this view">Choose another filter.</EmptyState>}
    </Section>
    <Section title="Result impact"><SummaryStrip items={[{ label: 'Exceptions before', value: evaluation.beforeExceptions }, { label: 'After candidate', value: evaluation.afterExceptions }, { label: 'Changed outputs', value: evaluation.impacts.length }]} />{evaluation.impacts.length ? <div className="inspector__impact-list">{evaluation.impacts.map(impact => <div key={impact.rowId} className="inspector__impact-row"><span><strong>{impact.assetId}</strong><small>{impact.rowId}</small></span><span>{money(impact.before)} <ArrowRight size={13} /> <strong>{money(impact.after)}</strong></span></div>)}</div> : <p className="inspector__muted">This candidate leaves calculated monthly amounts unchanged.</p>}</Section>
  </>;
}

function AssetPanel({ workspace, rowId, setInspector, onTeach, onOpenLearning }: { workspace: Workspace; rowId: string; setInspector: (target: InspectorTarget | null) => void; onTeach: () => void; onOpenLearning: () => void }) {
  const [showTrace, setShowTrace] = useState(false);
  const current = workspace.result.rows.find(row => row.asset.rowId === rowId);
  const sourceAsset = workspace.dataset.assets.find(asset => asset.rowId === rowId) ?? current?.asset;
  const snapshotRows = workspace.runs.flatMap(run => {
    const row = run.result.rows.find(result => result.asset.rowId === rowId);
    return row ? [{ run, row }] : [];
  }).reverse();
  const latestRun = snapshotRows[0]?.run;
  if (!sourceAsset || !current) return <EmptyState icon={Table2} title="Record is no longer available">The selected row is not in the active dataset.</EmptyState>;
  return <>
    <div className="inspector__record-heading"><div><span className="inspector__record-id">{sourceAsset.assetId}</span><h3>{sourceAsset.description}</h3><small>{sourceAsset.department} · {sourceAsset.category} · source row {sourceAsset.rowId}</small></div><Pill tone={current.status === 'matched' ? 'good' : 'warn'}>{current.status === 'matched' ? 'Matched' : 'Needs review'}</Pill></div>
    <SummaryStrip items={[
      { label: 'Calculated', value: money(current.calculated) },
      { label: 'Register', value: money(current.recorded) },
      { label: 'Calculated − register', value: signedMoney(current.difference) },
      { label: 'Calculated − ledger', value: signedMoney(current.ledgerAmount === null ? null : Math.round((current.calculated - current.ledgerAmount + Number.EPSILON) * 100) / 100) },
    ]} />
    {current.status === 'review' && <div className="inspector__action-row"><ActionButton onClick={() => setInspector({ type: 'handoff', rowId })}><ArrowDownUp size={15} /> Open handoff</ActionButton><ActionButton onClick={onTeach}><Table2 size={15} /> Correct this record</ActionButton></div>}
    <Section title="Source evidence"><dl className="inspector__definitions">
      <Definition label="Description" value={sourceAsset.description} />
      <Definition label="Category" value={sourceAsset.category} />
      <Definition label="Acquisition date" value={dateOnly(sourceAsset.acquisitionDate)} />
      <Definition label="In-service date" value={dateOnly(sourceAsset.inServiceDate)} />
      <Definition label="Original cost" value={money(sourceAsset.cost)} />
      <Definition label="Useful life" value={`${sourceAsset.usefulLifeMonths} months`} />
      <Definition label="Accumulated depreciation" value={money(sourceAsset.accumulatedDepreciation)} />
      <Definition label="Recorded monthly amount" value={money(sourceAsset.recordedMonthlyDepreciation)} />
      <Definition label="GL account" value={sourceAsset.glAccount} mono />
      <Definition label={`Ledger amount · ${workspace.dataset.period}`} value={money(current.ledgerAmount)} />
      <Definition label="Rule version" value={policyLabel({ version: current.ruleVersion })} />
      <Definition label="Dataset / period" value={`${workspace.dataset.name} · ${workspace.dataset.period}`} />
    </dl></Section>
    <Section title="Findings">{current.findings.length ? <div className="inspector__finding-list">{current.findings.map((finding, index) => <div className={`inspector__finding inspector__finding--${finding.severity}`} key={`${finding.code}-${index}`}><AlertTriangle size={15} /><span><strong>{finding.code}</strong><small>{finding.message}</small></span><Pill tone={finding.severity === 'error' ? 'bad' : 'warn'}>{finding.severity}</Pill></div>)}</div> : <p className="inspector__success-note"><CheckCircle2 size={15} /> No findings for this result.</p>}</Section>
    <Section title="Calculation and ledger check"><dl className="inspector__definitions">
      <Definition label="Calculated amount" value={money(current.calculated)} />
      <Definition label="Recorded amount" value={money(current.recorded)} />
      <Definition label="Matched ledger amount" value={money(current.ledgerAmount)} />
      <Definition label="Calculated − register" value={signedMoney(current.difference)} />
      <Definition label="Calculated − ledger" value={signedMoney(current.ledgerAmount === null ? null : Math.round((current.calculated - current.ledgerAmount + Number.EPSILON) * 100) / 100)} />
      <Definition label="Result rule version" value={`v${current.ruleVersion}`} />
    </dl></Section>
    <Section title="Trace for this result" trailing={<ActionButton kind="quiet" onClick={() => setShowTrace(value => !value)}>{showTrace ? 'Hide trace' : 'Show trace'} {showTrace ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</ActionButton>}>
      {showTrace && (snapshotRows.length ? <div className="inspector__trace-list">{snapshotRows.slice(0, 5).map(({ run, row }) => <div className="inspector__snapshot" key={run.id}><div className="inspector__snapshot-head"><strong>{run.cause}</strong><Pill tone="teal">policy v{run.policy.version}</Pill></div><small>{dateTime(run.createdAt)} · recorded in run {shortId(run.id)}</small><div className="inspector__snapshot-values"><span>Calculated <strong>{money(row.calculated)}</strong></span><span>Recorded <strong>{money(row.recorded)}</strong></span><span>Ledger <strong>{money(row.ledgerAmount)}</strong></span></div>{workspace.events.filter(event => event.runId === run.id).map(event => <EventCard event={event} key={event.id} />)}</div>)}</div> : <EmptyState icon={FileClock} title="No run snapshot for this row">The active workspace has not recorded a calculation run containing this row yet.</EmptyState>)}
    </Section>
    <div className="inspector__action-row"><ActionButton kind="primary" onClick={onOpenLearning}><Sparkles size={15} /> Learning Lens</ActionButton><ActionButton onClick={onTeach}><Table2 size={15} /> Teach this record</ActionButton><ActionButton onClick={() => setInspector({ type: 'history' })}><History size={15} /> Full run history</ActionButton></div>
    <div className="inspector__footnote"><span>Latest matching snapshot: {latestRun ? `${latestRun.cause} · ${dateTime(latestRun.createdAt)}` : 'none recorded'}</span></div>
  </>;
}

function HandoffPanel({ workspace, rowId, setInspector }: { workspace: Workspace; rowId: string; setInspector: (target: InspectorTarget | null) => void }) {
  const handoff = workspace.handoffs.find(item => item.rowId === rowId&&(!item.datasetId||item.datasetId===workspace.dataset.id));
  const result = workspace.result.rows.find(item => item.asset.rowId === rowId);
  const matchingRunIds = new Set(workspace.runs.filter(run=>run.dataset.id===workspace.dataset.id).map(run=>run.id));
  const relatedEvents = workspace.events.filter(event => matchingRunIds.has(event.runId)&&(event.inputs.includes(rowId) || event.outputs.includes(rowId)));
  const [owner, setOwner] = useState(handoff?.owner ?? 'Finance manager');
  const action = useWorkspace(state => state.handoffAction);
  const [actionNote, setActionNote] = useState('');
  const doAction = (kind: 'retry' | 'continue' | 'reject' | 'resolve') => {
    action(rowId, kind, owner);
    setActionNote(kind === 'resolve' ? 'Resolve attempted. The source evidence is rechecked before the handoff closes.' : `Handoff ${kind} recorded with the current owner.`);
  };
  return <>
    <div className="inspector__handoff-card"><div><span className="inspector__eyebrow-small">ASSET UNDER REVIEW</span><h3>{result?.asset.assetId ?? rowId}</h3><p>{result?.asset.description ?? 'Selected source row'} · {result?.findings.length ?? 0} current findings</p></div><Pill tone={handoff?.status === 'resolved' ? 'good' : handoff?.status === 'rejected' ? 'neutral' : 'warn'}>{handoff?.status ?? 'waiting'}</Pill></div>
    <div className="handoff-context"><strong>Original objective</strong><p>{workspace.prompt}</p><strong>Continue from here</strong><p>{result?.findings.length?'Verify the flagged source evidence, correct the specific record, then retry. Resolve closes only when the current findings are cleared.':'Review the current result and rerun verification before closing.'}</p><p>Required role: source-data reviewer; script inspection is available to technical reviewers. Roles here are fictional labels, without authenticated permissions.</p><button className="button secondary" onClick={()=>setInspector({type:'script'})}>Inspect the same calculation <ArrowUpRight size={13}/></button></div>
    <Section title="Task context"><dl className="inspector__definitions">
      <Definition label="Current run" value={workspace.runs.at(-1)?.id??'Not recorded'} mono/><Definition label="Task ID" value={relatedEvents.at(-1)?.taskId ?? `${workspace.domain}-investigation`} mono />
      <Definition label="Worker" value={relatedEvents.at(-1)?.workerId ?? (workspace.domain === 'accounting' ? 'depreciation-worker' : 'maintenance-worker')} mono />
      <Definition label="Worker type" value={relatedEvents.at(-1)?.workerType ?? 'deterministic'} />
      <Definition label="Last error" value={relatedEvents.slice().reverse().find(event => event.error)?.error ?? (result?.findings.length ? 'Source evidence requires review before resolution.' : 'No error recorded.')} />
      <Definition label="Owner" value={<Field label="Handoff owner"><input aria-label="Handoff owner" value={owner} onChange={event => setOwner(event.target.value)} /></Field>} />
    </dl></Section>
    <Section title="Evidence and data flow"><div className="inspector__evidence-card"><strong>Current source evidence</strong>{result ? <><p>{result.asset.assetId} · {result.asset.category} · {money(result.asset.cost)} · in service {dateOnly(result.asset.inServiceDate)}</p><p>Register {money(result.recorded)} · calculated {money(result.calculated)} · ledger {money(result.ledgerAmount)}</p><p>Calculated − register {signedMoney(result.difference)} · calculated − ledger {signedMoney(result.ledgerAmount === null ? null : Math.round((result.calculated - result.ledgerAmount + Number.EPSILON) * 100) / 100)}</p>{result.findings.map(finding => <p className="inspector__error-text" key={finding.code}><AlertTriangle size={13} /> {finding.code}: {finding.message}</p>)}</> : <p>Source result is no longer present in the active period.</p>}</div>
      <dl className="inspector__definitions"><Definition label="Inputs" value={relatedEvents.at(-1)?.inputs.join(', ') || `${workspace.dataset.id}, ${rowId}`} mono /><Definition label="Previous outputs" value={relatedEvents.at(-1)?.outputs.join(', ') || `reconciliation · ${shortId(workspace.runs.at(-1)?.id)}`} mono /></dl>
    </Section>
    <Section title="Attempt history">{handoff?.attempts.length ? <ol className="inspector__attempts">{handoff.attempts.map((attempt, index) => <li key={`${index}-${attempt}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{attempt}</p></li>)}</ol> : <p className="inspector__muted">No handoff action has been recorded for this row.</p>}</Section>
    <Section title="Recent worker events">{relatedEvents.length ? relatedEvents.slice().reverse().slice(0, 6).map(event => <EventCard event={event} key={event.id} />) : <p className="inspector__muted">No row-specific worker event is recorded yet. The task ID and deterministic worker above come from this workspace’s current investigation.</p>}</Section>
    {actionNote && <p className="inspector__success-note"><CheckCircle2 size={15} /> {actionNote}</p>}
    <div className="inspector__action-grid">
      <ActionButton kind="primary" onClick={() => doAction('continue')}><ArrowRight size={15} /> Continue</ActionButton>
      <ActionButton onClick={() => doAction('retry')}><RefreshCw size={15} /> Retry calculation</ActionButton>
      <ActionButton onClick={() => setInspector({ type: 'asset', rowId })}><Table2 size={15} /> Correct source row</ActionButton>
      <ActionButton kind="secondary" onClick={() => doAction('resolve')}><Check size={15} /> Resolve</ActionButton>
      <ActionButton kind="danger" onClick={() => doAction('reject')}><X size={15} /> Reject</ActionButton>
    </div>
    <p className="inspector__footnote">Resolve replays the current data and only closes the handoff when no current finding remains.</p>
  </>;
}

function PolicyPanel({ workspace, rollback }: { workspace: Workspace; rollback: (version: number) => void }) {
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const versions = workspace.versions.slice().reverse();
  return <>
    <div className="inspector__callout"><GitBranch size={16} /> Current active behavior is policy v{workspace.policy.version}. Restoring an older version creates a new version and keeps this history.</div>
    <div className="inspector__version-list">{versions.map(version => {
      const isCurrent = version.version === workspace.policy.version;
      return <article className={`inspector__version ${isCurrent ? 'inspector__version--current' : ''}`} key={`${version.version}-${version.createdAt}`}>
        <div className="inspector__version-head"><span className="inspector__version-mark">{isCurrent ? <Check size={15} /> : version.version}</span><div><strong>Policy v{version.version}</strong><small>{dateTime(version.createdAt)}{version.parentVersion ? ` · from v${version.parentVersion}` : ''}</small></div>{isCurrent && <Pill tone="good">Active</Pill>}</div>
        <p>{version.source || 'Initial policy'}</p>
        <dl className="inspector__definitions inspector__definitions--compact"><Definition label="Laptop threshold" value={money(version.laptop.threshold)} /><Definition label="Useful life" value={`${version.laptop.usefulLifeMonths} months`} /><Definition label="Start" value={version.laptop.start === 'in-service' ? 'In service' : 'Following month'} />{Object.entries(version.categoryRules??{}).map(([category,rule])=><Definition key={category} label={category} value={`${money(rule.threshold??version.defaultThreshold)} · ${rule.usefulLifeMonths??'source'} months · ${rule.start??'following-month'}`}/>)}</dl>
        {!isCurrent && <div className="inspector__restore-row">{confirmVersion === version.version ? <div className="inspector__confirm-restore"><p>Restore v{version.version} behavior as a new policy version?</p><ActionButton kind="primary" onClick={() => { rollback(version.version); setConfirmVersion(null); }}><RotateCcw size={14} /> Confirm restore</ActionButton><ActionButton kind="quiet" onClick={() => setConfirmVersion(null)}>Cancel</ActionButton></div> : <ActionButton kind="quiet" onClick={() => setConfirmVersion(version.version)}><RotateCcw size={14} /> Restore behavior</ActionButton>}</div>}
      </article>;
    })}</div>
    {versions.length === 1 && <EmptyState icon={History} title="One version so far">Approved changes and restores appear here as durable policy history.</EmptyState>}
  </>;
}

function HistoryPanel({ workspace }: { workspace: Workspace }) {
  const [expanded, setExpanded] = useState<string | null>(workspace.runs.at(-1)?.id ?? null);
  const runs = workspace.runs.slice().reverse();
  const eventsWithoutRun = workspace.events.filter(event => !workspace.runs.some(run => run.id === event.runId));
  if (workspace.domain === 'maintenance') return <MaintenanceHistoryPanel workspace={workspace} />;
  if (!runs.length) return <EmptyState icon={History} title="No calculation runs yet">Start an investigation from the canvas to create an immutable run snapshot.</EmptyState>;
  return <>
    <SummaryStrip items={[{ label: 'Saved run snapshots', value: workspace.runs.length }, { label: 'Timeline events', value: workspace.events.length }, { label: 'Current policy', value: `v${workspace.policy.version}` }]} />
    <div className="inspector__timeline">{runs.map((run, index) => {
      const events = workspace.events.filter(event => event.runId === run.id);
      const open = expanded === run.id;
      return <article className="inspector__run" key={run.id}>
        <div className="inspector__timeline-rail"><span>{index === 0 ? <Clock3 size={14} /> : <span className="inspector__timeline-dot" />}</span></div>
        <div className="inspector__run-main">
          <button className="inspector__run-toggle" onClick={() => setExpanded(open ? null : run.id)} aria-expanded={open}>
            <span><strong>{run.cause}</strong><small>{dateTime(run.createdAt)} · {shortId(run.id)}</small></span><Pill tone="teal">policy v{run.policy.version}</Pill>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <div className="inspector__run-totals"><Metric label="Assets" value={run.result.summary.totalAssets} /><Metric label="Exceptions" value={run.result.summary.exceptions} /><Metric label="Calculated" value={money(run.result.summary.calculated)} /><Metric label="Recorded" value={money(run.result.summary.recorded)} /></div>
          {open && <div className="inspector__run-detail">
            <div className="inspector__snapshot-caption"><FileClock size={14} /><span>This historical run used its own stored dataset, result, and policy v{run.policy.version}. Current workspace figures are separate.</span></div>
            <dl className="inspector__definitions"><Definition label="Snapshot dataset" value={`${run.dataset.name} · ${run.dataset.period} · ${run.dataset.source}`} /><Definition label="Snapshot sources" value={run.sourceConnections?.map(c=>`${c.kind} · ${c.resource} · ${c.rowCount} rows`).join('; ')??'Generated demo or CSV source'} /><Definition label="Snapshot assets / ledger" value={`${run.dataset.assets.length} asset rows · ${run.dataset.ledger.length} ledger rows`} /><Definition label="Absolute register variance" value={money(run.result.summary.difference)} /><Definition label="Historical matches" value={run.result.summary.matched} /><Definition label="Run ID" value={run.id} mono />{run.approvalRef && <Definition label="Approval reference" value={run.approvalRef} mono />}</dl>
            <div className="inspector__run-policy"><strong>Policy values used in this run</strong><span>laptop ≥ {money(run.policy.laptop.threshold)} · {run.policy.laptop.usefulLifeMonths} months · {run.policy.laptop.start === 'in-service' ? 'in service' : 'following month'}</span></div>
            <div className="inspector__event-list">{events.length ? events.map(event => <EventCard event={event} key={event.id} />) : <p className="inspector__muted">No structured events were attached to this run.</p>}</div>
          </div>}
        </div>
      </article>;
    })}</div>
    {!!eventsWithoutRun.length && <Section title="Workspace events without a run snapshot">{eventsWithoutRun.slice().reverse().map(event => <EventCard event={event} key={event.id} />)}</Section>}
  </>;
}

function MaintenanceHistoryPanel({ workspace }: { workspace: Workspace }) {
  const [expanded, setExpanded] = useState<string | null>(workspace.runs.at(-1)?.id ?? null);
  const runs = workspace.runs.slice().reverse();
  const eventsWithoutRun = workspace.events.filter(event => !workspace.runs.some(run => run.id === event.runId));
  if (!runs.length) return <EmptyState icon={History} title="No maintenance runs yet">Start the equipment-care workspace to save an inventory and priority snapshot.</EmptyState>;
  return <>
    <SummaryStrip items={[{ label: 'Run snapshots', value: workspace.runs.length }, { label: 'Worker events', value: workspace.events.length }, { label: 'Source', value: 'Equipment inventory' }]} />
    <p className="inspector__callout"><History size={16} /> Each run below reads its own stored equipment rows and worker output. Missing snapshot fields stay marked as unavailable; current equipment is never substituted for past results.</p>
    <div className="inspector__timeline">{runs.map((run, index) => {
      const events = workspace.events.filter(event => event.runId === run.id);
      const open = expanded === run.id;
      const equipmentSnapshot = run.equipmentSnapshot;
      const results: EquipmentResult[] | undefined = run.equipmentResults;
      const hasSnapshot = Array.isArray(equipmentSnapshot) && Array.isArray(results);
      const urgent = results?.filter(result => result.priority === 'urgent').length;
      const soon = results?.filter(result => result.priority === 'soon').length;
      const healthy = results?.filter(result => result.priority === 'healthy').length;
      return <article className="inspector__run" key={run.id}>
        <div className="inspector__timeline-rail"><span>{index === 0 ? <Clock3 size={14} /> : <span className="inspector__timeline-dot" />}</span></div>
        <div className="inspector__run-main">
          <button className="inspector__run-toggle" onClick={() => setExpanded(open ? null : run.id)} aria-expanded={open}>
            <span><strong>{run.cause}</strong><small>{dateTime(run.createdAt)} · {shortId(run.id)}</small></span><Pill tone="teal">maintenance</Pill>{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          </button>
          <div className="inspector__run-totals"><Metric label="Equipment" value={hasSnapshot ? equipmentSnapshot.length : 'Unavailable'} /><Metric label="Urgent" value={hasSnapshot ? urgent : 'Unavailable'} /><Metric label="Due soon" value={hasSnapshot ? soon : 'Unavailable'} /><Metric label="Healthy" value={hasSnapshot ? healthy : 'Unavailable'} /></div>
          {open && <div className="inspector__run-detail">
            <div className="inspector__snapshot-caption"><FileClock size={14} /><span>These are historical maintenance results captured by this run. No accounting dataset, policy, or current inventory is used here.</span></div>
            {hasSnapshot ? <>
              <dl className="inspector__definitions"><Definition label="Snapshot records" value={`${equipmentSnapshot.length} equipment rows`} /><Definition label="Snapshot ID" value={run.id} mono /><Definition label="Priority totals" value={`${urgent} urgent · ${soon} due soon · ${healthy} healthy`} />{run.approvalRef && <Definition label="Action reference" value={run.approvalRef} mono />}</dl>
              <div className="inspector__equipment-results">{results.map(({ equipment, warrantyDays, priority, reason }) => <article className="inspector__equipment-result" key={equipment.id}><div><strong>{equipment.name}</strong><small>{equipment.id} · {equipment.condition.replaceAll('-', ' ')} · warranty {dateOnly(equipment.warrantyUntil)}</small></div><Pill tone={priority === 'healthy' ? 'good' : priority === 'soon' ? 'warn' : 'bad'}>{priority}</Pill><p>{reason}{warrantyDays >= 0 ? ` (${warrantyDays} days remaining)` : ''}</p></article>)}</div>
            </> : <p className="inspector__muted">This older or incomplete run has no stored equipment snapshot. The current inventory is not shown as a substitute.</p>}
            <div className="inspector__event-list">{events.length ? events.map(event => <EventCard event={event} key={event.id} showRuleVersion={false} />) : <p className="inspector__muted">No structured worker events were attached to this maintenance run.</p>}</div>
          </div>}
        </div>
      </article>;
    })}</div>
    {!!eventsWithoutRun.length && <Section title="Workspace events without a run snapshot">{eventsWithoutRun.slice().reverse().map(event => <EventCard event={event} key={event.id} showRuleVersion={false} />)}</Section>}
  </>;
}

function IntakePanel({ workspace }: { workspace: Workspace }) {
  const [equipmentId, setEquipmentId] = useState(workspace.equipment[0]?.id ?? '');
  const [reporter, setReporter] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState('');
  const addIncident = useWorkspace(state => state.addIncident);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!equipmentId || !reporter.trim() || !description.trim()) { setError('Choose equipment and enter a reporter and issue description.'); return; }
    addIncident(equipmentId, description, reporter);
    setError(''); setReporter(''); setDescription('');
  };
  const selected = workspace.equipment.find(item => item.id === equipmentId);
  return <>
    <div className="inspector__intake-note"><CalendarDays size={17} /><div><strong>Local maintenance intake</strong><p>Submitting records an incident and marks the selected equipment for repair in this workspace.</p></div></div>
    <form className="inspector__form" onSubmit={submit}>
      <Field label="Equipment"><select value={equipmentId} onChange={event => setEquipmentId(event.target.value)}>{workspace.equipment.map(item => <option key={item.id} value={item.id}>{item.name} · {item.id}</option>)}</select></Field>
      {selected && <div className="inspector__equipment-card"><div><strong>{selected.name}</strong><small>{selected.category} · {selected.location} · owned by {selected.owner}</small></div><Pill tone={selected.condition === 'working' ? 'good' : 'warn'}>{selected.condition.replace('-', ' ')}</Pill><span>Warranty through {dateOnly(selected.warrantyUntil)}</span></div>}
      <Field label="Reported by"><input value={reporter} onChange={event => setReporter(event.target.value)} autoComplete="name" placeholder="Name or team" /></Field>
      <Field label="Issue description"><textarea value={description} onChange={event => setDescription(event.target.value)} rows={4} placeholder="What happened, and when did you notice it?" /></Field>
      {error && <p className="inspector__inline-error" role="alert">{error}</p>}
      <ActionButton kind="primary" type="submit"><Check size={15} /> Record issue</ActionButton>
    </form>
    {workspace.incidents.length > 0 && <Section title="Recently reported">{workspace.incidents.slice().reverse().slice(0, 5).map(incident => <article className="inspector__incident" key={incident.id}><div><strong>{workspace.equipment.find(item => item.id === incident.equipmentId)?.name ?? incident.equipmentId}</strong><small>{dateTime(incident.createdAt)} · reported by {incident.reporter}</small></div><Pill tone={incident.status === 'resolved' ? 'good' : 'warn'}>{incident.status}</Pill><p>{incident.description}</p></article>)}</Section>}
  </>;
}

function HelpPanel({ workspace, save }: { workspace: Workspace; save: () => void }) {
  return <>
    <div className="inspector__help-hero"><span className="inspector__icon-box inspector__icon-box--glow"><BookOpen size={18} /></span><div><strong>Procedural · Your software, alive.</strong><p>A small, local working demo. Inputs, calculations, proposals, approvals, incidents, and history run in this browser with seeded synthetic data. No LLM or external API is needed.</p></div></div>
    <Section title="A 4–6 minute walkthrough"><ol className="inspector__walkthrough">
      <li><span>1</span><div><strong>Read the source</strong><p>Open Source material. Compare asset-register rows, ledger entries, and the field map.</p></div></li>
      <li><span>2</span><div><strong>Inspect a result</strong><p>Choose an asset or exception on the canvas. Review the source evidence, calculation, rule version, and run trace.</p></div></li>
      <li><span>3</span><div><strong>Teach a reusable rule</strong><p>Use the teaching card to propose the laptop threshold, useful life, and start convention. The active policy remains unchanged.</p></div></li>
      <li><span>4</span><div><strong>Test, then approve</strong><p>Review expected and actual cases. Only a passing evaluation against the current policy enables approval.</p></div></li>
      <li><span>5</span><div><strong>Replay and follow evidence</strong><p>Check the new run and historical snapshots, or record an equipment incident in the maintenance workspace.</p></div></li>
    </ol></Section>
    <Section title="Canvas controls"><div className="inspector__help-grid"><div><strong>Move around</strong><p>Drag the open canvas to pan; use the canvas zoom controls or trackpad to change scale.</p></div><div><strong>Arrange nodes</strong><p>Drag a node by its header. Open a node’s inspector to see its source, logic, outputs, or history.</p></div><div><strong>Save locally</strong><p>Save stores this workspace on this device. The app restores saved workspaces when it loads again.</p><ActionButton kind="secondary" onClick={save}><Save size={14} /> Save this workspace</ActionButton></div><div><strong>Restore saved work</strong><p>Switching shows each domain’s current in-memory workspace. Workspaces saved on this device are restored when the app loads again.</p></div></div></Section>
    <Section title="Accounting CSV examples"><div className="inspector__download-list">
      <a href="/data/assets-2026-09.csv" download><Database size={15} /><span><strong>Asset register</strong><small>September 2026 · CSV</small></span><span>Download</span></a>
      <a href="/data/ledger-2026-09.csv" download><Database size={15} /><span><strong>General ledger</strong><small>September 2026 · CSV</small></span><span>Download</span></a>
      <a href="/data/policy.json" download><FileClock size={15} /><span><strong>Policy example</strong><small>Reference JSON · not imported</small></span><span>Download</span></a>
    </div><p className="inspector__import-limit">Import supports the asset-register and general-ledger CSV schemas shown above. Add both CSVs together. Equipment CSV, policy JSON, Excel, and PDF files are not imported by this demo.</p></Section>
    <div className="inspector__help-foot"><span className="inspector__dot" /> Local browser state · deterministic demo orchestration · synthetic seed data{workspace.dataset.source === 'imported' ? ' (current data is imported)' : ''}</div>
  </>;
}

export default function Inspector() {
  const target = useWorkspace(state => state.inspector);
  const workspace = useWorkspace(state => state.workspace);
  const demoActive = useWorkspace(state => state.demoActive);
  const demoDraftStage = useWorkspace(state => state.demoDraftStage);
  const setInspector = useWorkspace(state => state.setInspector);
  const propose = useWorkspace(state => state.propose);
  const testProposal = useWorkspace(state => state.testProposal);
  const approve = useWorkspace(state => state.approve);
  const reject = useWorkspace(state => state.reject);
  const rollback = useWorkspace(state => state.rollback);
  const save = useWorkspace(state => state.save);
  const openLearning = useWorkspace(state => state.openLearning);
  const [teachingAssetId, setTeachingAssetId] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const inspectorRef = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);
  const returnFocus = useRef<HTMLElement | null>(null);
  const guidedTeach = target?.type === 'teach' && demoActive && demoDraftStage !== null;

  useLayoutEffect(() => {
    const inspector = inspectorRef.current;
    if (!inspector) return;
    if (!guidedTeach) {
      inspector.style.removeProperty('--guided-inspector-height');
      return;
    }

    const content = inspector.querySelector<HTMLElement>('.inspector__content');
    const topLine = inspector.querySelector<HTMLElement>('.inspector__topline');
    const heading = inspector.querySelector<HTMLElement>('.inspector__heading');
    if (!content || !topLine || !heading) return;

    let frame = 0;
    const measure = () => {
      const contentStyle = getComputedStyle(content);
      const number = (value: string) => Number.parseFloat(value) || 0;
      let contentHeight = number(contentStyle.paddingTop) + number(contentStyle.paddingBottom);
      Array.from(content.children).forEach((child, index) => {
        const childStyle = getComputedStyle(child);
        contentHeight += child.getBoundingClientRect().height;
        if (index > 0) contentHeight += number(childStyle.marginTop);
      });
      const inspectorStyle = getComputedStyle(inspector);
      const naturalHeight = Math.ceil(
        topLine.getBoundingClientRect().height
        + heading.getBoundingClientRect().height
        + contentHeight
        + number(inspectorStyle.borderTopWidth)
        + number(inspectorStyle.borderBottomWidth),
      );
      const next = `${Math.max(190, naturalHeight)}px`;
      if (inspector.style.getPropertyValue('--guided-inspector-height') !== next) {
        inspector.style.setProperty('--guided-inspector-height', next);
      }
    };
    const scheduleMeasure = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };

    measure();
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(content);
    Array.from(content.children).forEach(child => resizeObserver.observe(child));
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(content, { subtree: true, childList: true, characterData: true, attributes: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [guidedTeach, demoDraftStage, target?.type]);

  useEffect(() => {
    const isOpen = target !== null;
    if (isOpen && !wasOpen.current) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      requestAnimationFrame(() => {
        if (headingRef.current) headingRef.current.focus();
        else closeRef.current?.focus();
      });
    } else if (!isOpen && wasOpen.current) {
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
      returnFocus.current = null;
    }
    wasOpen.current = isOpen;
  }, [target]);
  if (!target) return null;
  const copy = targetCopy[target.type];
  const HeaderIcon = copy.icon;
  const title = target.type === 'asset' ? workspace.dataset.assets.find(row => row.rowId === target.rowId)?.assetId || copy.title
    : target.type === 'handoff' ? 'Review handoff' : copy.title;
  const contentKey = target.type === 'source' ? `source:${target.initialTab ?? 'assets'}:${target.initialQuery ?? ''}`
    : target.type === 'asset' || target.type === 'handoff' ? `${target.type}:${target.rowId}` : target.type;
  const renderContent = () => {
    switch (target.type) {
      case 'source': return <SourcePanel workspace={workspace} setInspector={setInspector} initialTab={target.initialTab} initialQuery={target.initialQuery} />;
      case 'script': return <ScriptPanel workspace={workspace} propose={propose} />;
      case 'policy': return <PolicyPanel workspace={workspace} rollback={rollback} />;
      case 'teach': return <TeachPanel workspace={workspace} initialAssetId={teachingAssetId} initialInstruction={target.instruction} propose={propose} setInspector={setInspector} />;
      case 'proposal': return <ProposalPanel workspace={workspace} testProposal={testProposal} approve={approve} reject={reject} setInspector={setInspector} />;
      case 'evaluation': return <EvaluationPanel workspace={workspace} setInspector={setInspector} />;
      case 'history': return <HistoryPanel workspace={workspace} />;
      case 'help': return <HelpPanel workspace={workspace} save={save} />;
      case 'intake': return <IntakePanel workspace={workspace} />;
      case 'asset': return <AssetPanel workspace={workspace} rowId={target.rowId} setInspector={setInspector} onOpenLearning={() => openLearning(target.rowId, 'table')} onTeach={() => { setTeachingAssetId(target.rowId); setInspector({ type: 'teach' }); }} />;
      case 'handoff': return <HandoffPanel workspace={workspace} rowId={target.rowId} setInspector={setInspector} />;
      default: return null;
    }
  };
  return <aside ref={inspectorRef} className="inspector" aria-label={`${title} inspector`} data-testid="workspace-inspector" data-guided-teach={guidedTeach ? 'true' : undefined}>
    <div className="inspector__topline"><span className="inspector__topline-mark"><HeaderIcon size={14} strokeWidth={1.8} /></span><span>{copy.eyebrow}</span><button ref={closeRef} className="inspector__close" aria-label="Close inspector" onClick={() => setInspector(null)}><X size={17} /></button></div>
    <div className="inspector__heading"><h2 ref={headingRef} tabIndex={-1}>{title}</h2><p>{copy.description}</p></div>
    <div className="inspector__content" key={contentKey}>{renderContent()}</div>
  </aside>;
}
