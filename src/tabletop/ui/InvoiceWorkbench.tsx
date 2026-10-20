import { useMemo, useState } from 'react';
import { AlertCircle, ArrowDownToLine, CalendarDays, Check, ChevronDown, FilePlus2, Filter, FolderOpen, Minus, Plus, Scale, Table2 } from 'lucide-react';
import type { InvoiceResult, InvoiceState, RateRule, RuleOperation, Zone } from '../shared/contracts';
import { CandidateLifecycle, EvidenceList, UploadCard } from './WorkbenchShared';
import type { WorkbenchProps } from './types';
import { formatMoney } from './types';

const dates = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export function InvoiceWorkbench(props: WorkbenchProps) {
  if (props.view.domain.kind !== 'invoice') return null;
  return <InvoiceWorkbenchBody {...props} state={props.view.domain} />;
}

// Split from the guard so every hook below runs on every render.
function InvoiceWorkbenchBody({ state, ...props }: WorkbenchProps & { state: InvoiceState }) {
  const { view, plan, onCommand, busy, onUpload, onExport, onFocusEvidence, onBackFromEvidence, focusSourceIds } = props;
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [family, setFamily] = useState<'base' | 'step' | 'surcharge'>('base');
  const [zone, setZone] = useState<Zone | '*'>('bangkok');
  const [amount, setAmount] = useState('3500');
  const [from, setFrom] = useState(dates());
  const [to, setTo] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [ruleId, setRuleId] = useState('');
  const [ruleError, setRuleError] = useState('');
  const [onlyUnknown, setOnlyUnknown] = useState(false);
  const result = plan.nodes.find((node) => node.id === 'invoice.table')?.inputs.result as InvoiceResult | undefined;
  const reviewItems = plan.nodes.find((node) => node.id === 'invoice.review')?.inputs.items as { id: string; shipmentId: string; reason: string; sourceIds: string[] }[] | undefined;
  const selectedRow = result?.rows.find((row) => row.key === selectedKey) ?? null;
  const verifiedSources = useMemo(() => state.sources.filter((source) => source.status === 'verified' && (source.kind === 'rate-card' || source.kind === 'excerpt')), [state.sources]);
  const selectedRule = state.rules.find((rule) => rule.id === ruleId);
  const showSurcharge = state.rules.some((rule) => rule.kind === 'surcharge' && rule.enabled);
  const rows = (result?.rows ?? []).filter((row) => !onlyUnknown || row.expectedSatang === null || row.billedSatang === null || row.reasons.length > 0);
  const canEdit = view.actor.role === 'owner';

  const editRule = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setRuleError('');
    const satang = Number(amount);
    if (!Number.isSafeInteger(satang) || satang < 0) { setRuleError('Enter a whole amount in satang.'); return; }
    if (!from || (to && to <= from)) { setRuleError('The end date must be later than the start date.'); return; }
    if (!sourceId) { setRuleError('Verify a rate source before using it for a draft.'); return; }
    const operation: RuleOperation = {
      op: family === 'base' ? 'setZoneBase' : family === 'step' ? 'setWeightStep' : 'setSurcharge',
      id: ruleId || `rule-${crypto.randomUUID()}`,
      zone,
      amountSatang: satang,
      from,
      to: to || null,
      sourceId,
    };
    void onCommand('evolve.propose', { change: { kind: 'invoice', operations: [operation] } });
  };

  const disableRule = () => {
    if (!selectedRule) return;
    void onCommand('evolve.propose', { change: { kind: 'invoice', operations: [{ op: 'disableRule', id: selectedRule.id }] } });
  };

  const focusRow = (key: string, sourceIds: string[]) => {
    setSelectedKey(key);
    onFocusEvidence(sourceIds);
  };

  return (
    <div className="tt-workbench-body tt-invoice">
      <section className="tt-case-heading">
        <div><span className="tt-kicker">INVOICE TABLE · {view.actor.role.toUpperCase()}</span><h1>Check the billed amount against its source</h1><p>Each expected amount uses the rules and evidence visible at this table.</p></div>
        <div className="tt-case-heading__actions">
          <button className="tt-button tt-button--quiet" type="button" disabled={busy !== null || !canEdit} onClick={() => void onCommand('invoice.saveRun', {})}><Check size={14} /> Save run</button>
          <button className="tt-button tt-button--quiet" type="button" disabled={busy !== null || !result} onClick={() => void onExport('csv')}><ArrowDownToLine size={14} /> CSV</button>
          <button className="tt-button tt-button--quiet" type="button" disabled={busy !== null || !result} onClick={() => void onExport('html')}><FolderOpen size={14} /> Report</button>
        </div>
      </section>

      {state.shipments.length === 0 && state.invoiceLines.length === 0 && <section className="tt-start-card"><div className="tt-start-card__mark"><Table2 size={18} /></div><div><strong>Start with the included example</strong><p>Load a small invoice and shipment set to see the evidence table, unknowns, and draft controls.</p></div><button className="tt-button tt-button--primary" type="button" disabled={busy !== null || !canEdit} onClick={() => void onCommand('invoice.sample', {})}><FilePlus2 size={15} /> Load example</button></section>}

      <section className="tt-invoice-kpis" aria-label="Current invoice totals">
        <div><span>Known expected</span><strong>{result ? formatMoney(result.knownExpectedSatang) : '—'}</strong><small>Only rows with enough evidence</small></div>
        <div><span>Known billed</span><strong>{result ? formatMoney(result.knownBilledSatang) : '—'}</strong><small>Matched invoice lines</small></div>
        <div><span>Known difference</span><strong className={result && result.deltaSatang !== 0 ? 'tt-number--amber' : ''}>{result ? formatSignedMoney(result.deltaSatang) : '—'}</strong><small>Unknown rows are excluded</small></div>
        <div className="tt-kpi-unknown"><span>Needs more evidence</span><strong>{result?.unknownCount ?? '—'}</strong><small>{result?.gaps.length ?? 0} grouped request{result?.gaps.length === 1 ? '' : 's'}</small></div>
      </section>

      <section className="tt-section tt-table-section" aria-labelledby="tt-invoice-table-heading">
        <header className="tt-section__header tt-table-heading"><div><span className="tt-kicker">ACTIVE RESULT · RULE r{state.ruleRevision}</span><h2 id="tt-invoice-table-heading">Shipment reconciliation</h2></div><button type="button" className={`tt-filter-button${onlyUnknown ? ' is-active' : ''}`} aria-pressed={onlyUnknown} onClick={() => setOnlyUnknown((value) => !value)}><Filter size={14} /> Needs review{onlyUnknown ? ' only' : ''}</button></header>
        {!result ? <div className="tt-empty-note"><AlertCircle size={17} /><p>The current plan has no calculated invoice result. Refresh the table or add the required source data.</p></div> : result.rows.length === 0 ? <div className="tt-empty-note"><Table2 size={16} /><p>No shipment rows are available yet. Add a shipment CSV and invoice PDF, or load the example.</p></div> : (
          <div className="tt-table-scroll"><table className="tt-data-table"><caption className="tt-visually-hidden">Invoice rows. Select a row to open its exact source evidence.</caption><thead><tr><th scope="col">Shipment</th><th scope="col">Service date</th><th scope="col">Zone</th><th scope="col">Weight</th><th scope="col">Billed</th><th scope="col">Expected</th>{showSurcharge && <th scope="col">Surcharge</th>}<th scope="col">Difference</th><th scope="col">Check</th></tr></thead>
            <tbody>{rows.map((row) => {
              const needsReview = row.expectedSatang === null || row.billedSatang === null || row.reasons.length > 0 || row.deltaSatang !== 0;
              const status = row.expectedSatang === null || row.billedSatang === null ? 'Unknown' : needsReview ? 'Review' : 'Matches';
              return <tr key={row.key} id={`tt-invoice-row-${row.key}`} className={selectedKey === row.key ? 'is-selected' : ''} onClick={() => focusRow(row.key, row.sourceIds)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); focusRow(row.key, row.sourceIds); } }} tabIndex={0} aria-label={`${row.shipmentId}, ${needsReview ? 'needs review' : 'matches'}`}>
                <th scope="row"><strong>{row.shipmentId}</strong><small>{row.sourceIds.length} source{row.sourceIds.length === 1 ? '' : 's'} · row {row.key}</small></th>
                <td>{row.date || 'Unknown'}</td><td>{row.zone ?? 'Unknown'}</td>
                <td>{row.weightGram === null ? <span className="tt-unknown">Unknown</span> : `${row.weightGram.toLocaleString()} g`}</td>
                <td>{row.billedSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.billedSatang)}</td>
                <td>{row.expectedSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.expectedSatang)}</td>
                {showSurcharge && <td>{row.surchargeSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.surchargeSatang)}</td>}
                <td className={row.deltaSatang ? 'tt-difference' : ''}>{row.deltaSatang === null ? <span className="tt-unknown">Unknown</span> : formatSignedMoney(row.deltaSatang)}</td>
                <td><span className={`tt-row-status${needsReview ? ' is-review' : ' is-clear'}`}>{status}</span></td>
              </tr>;
            })}</tbody></table>{rows.length === 0 && <p className="tt-empty-table">No rows need review under this filter.</p>}</div>
        )}
        {selectedRow && <div className="tt-selected-row"><div><span className="tt-kicker">SELECTED SHIPMENT</span><strong>{selectedRow.shipmentId}</strong><small>{selectedRow.reasons.length ? selectedRow.reasons.join(' · ') : 'No unresolved reason was reported for this row.'}</small></div><button type="button" className="tt-text-button" onClick={() => onFocusEvidence(selectedRow.sourceIds)}>Open source evidence <ChevronDown size={14} /></button></div>}
        {reviewItems && reviewItems.length > 0 && <div className="tt-review-items"><strong>{reviewItems.length} item{reviewItems.length === 1 ? '' : 's'} linked to evidence review</strong><span>These are derived from the current typed review output.</span></div>}
      </section>

      <section className="tt-section" aria-labelledby="tt-gaps-title"><header className="tt-section__header"><div><span className="tt-kicker">EVIDENCE GAPS</span><h2 id="tt-gaps-title">What would resolve the unknowns</h2></div><span className="tt-count-mark">{result?.gaps.length ?? 0}</span></header>
        {!result || result.gaps.length === 0 ? <div className="tt-empty-note"><Check size={16} /><p>No evidence requests are open for the current result.</p></div> : <div className="tt-gap-list">{result.gaps.map((gap) => <article className="tt-gap-card" key={gap.id}><div><span className={`tt-gap-status tt-gap-status--${gap.status}`}>{gap.status}</span><strong>{gap.documentType}</strong></div><p>{gap.whyNeeded}</p><small>{gap.affectedRecordIds.length} affected row{gap.affectedRecordIds.length === 1 ? '' : 's'} · {gap.sourceRequirements}</small></article>)}</div>}
      </section>

      <section className="tt-section" id="tt-evidence-section" aria-labelledby="tt-upload-title"><header className="tt-section__header"><div><span className="tt-kicker">SOURCE DOCUMENTS</span><h2 id="tt-upload-title">Add source files</h2></div><span className="tt-count-mark">{state.sources.length} in table</span></header>
        {canEdit ? <><div className="tt-upload-grid"><UploadCard kind="shipments" title="Shipment list" description="Imports replace the current shipment rows." onUpload={onUpload} busy={busy !== null} /><UploadCard kind="invoice" title="Invoice PDF" description="Imports replace the current invoice lines." onUpload={onUpload} busy={busy !== null} /><UploadCard kind="rate-card" title="Rate card PDF" description="A dated rate source for human review." onUpload={onUpload} busy={busy !== null} /></div><p className="tt-section-intro">New-period imports replace current rows so periods do not mix. Saved runs, source documents, and approved rates remain available.</p><nav className="tt-sample-links" aria-label="Download sample source files"><a href="/samples/r1/shipments.csv" download>Shipment CSV sample</a><a href="/samples/r1/invoice.pdf" download>Invoice PDF sample</a><a href="/samples/r1/rate-card.pdf" download>Rate card PDF sample</a></nav></> : <p className="tt-permission-note">Only the table owner can add source files or change invoice rules.</p>}
        {focusSourceIds.length > 0 && <button type="button" className="tt-back-evidence" onClick={onBackFromEvidence}>← Back to the previous position{selectedRow ? ` · ${selectedRow.shipmentId}` : ''}</button>}
        <EvidenceList view={view} focusSourceIds={focusSourceIds} onFocusEvidence={onFocusEvidence} onCommand={onCommand} busy={busy} />
      </section>

      <section className="tt-section" aria-labelledby="tt-rules-title"><header className="tt-section__header"><div><span className="tt-kicker">BOUNDED RULE EDITOR</span><h2 id="tt-rules-title">Draft a dated rate change</h2></div><span className="tt-status-pill tt-status-pill--active">Active r{state.ruleRevision}</span></header>
        {!canEdit ? <p className="tt-permission-note">Rule editing is available to the table owner.</p> : <>
            <p className="tt-section-intro">Choose one of the supported rate families and attach a reviewed source. This creates a draft; Active stays on the current revision.</p>
            <p className="tt-manual-mode-note">Manual rules · live AI not configured</p>
          <form className="tt-rate-editor" onSubmit={editRule}>
            <label>Rate family<select value={family} onChange={(event) => { setFamily(event.target.value as typeof family); setRuleId(''); }}><option value="base">Zone base</option><option value="step">Each started extra kg</option><option value="surcharge">Remote surcharge</option></select></label>
            <label>Change an existing rule<select value={ruleId} onChange={(event) => { const value = event.target.value; setRuleId(value); const selected = state.rules.find((rule) => rule.id === value); if (selected) { setFamily(selected.kind === 'base' ? 'base' : selected.kind === 'step' ? 'step' : 'surcharge'); setZone(selected.zone); setAmount(String(selected.amountSatang)); setFrom(selected.from); setTo(selected.to ?? ''); setSourceId(selected.sourceId); } }}><option value="">Add a new rule</option>{state.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.kind} · {rule.zone} · from {rule.from}{rule.enabled ? '' : ' · disabled'}</option>)}</select></label>
            <label>Zone<select value={zone} onChange={(event) => setZone(event.target.value as Zone | '*')}><option value="bangkok">Bangkok</option><option value="regional">Regional</option><option value="*">All zones</option></select></label>
            <label>Amount (satang)<input type="number" min="0" step="1" max={Number.MAX_SAFE_INTEGER} inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label>
            <label>Start date · inclusive<span className="tt-date-field"><CalendarDays size={14} /><input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></span></label>
            <label>End date · exclusive<span className="tt-date-field"><CalendarDays size={14} /><input type="date" value={to} min={from} onChange={(event) => setTo(event.target.value)} /></span></label>
            <label className="tt-rate-editor__source">Reviewed rate evidence<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose verified evidence</option>{verifiedSources.map((source) => <option key={source.id} value={source.id}>{source.filename} · {source.kind}</option>)}</select></label>
            {ruleError && <p className="tt-field-error" role="alert">{ruleError}</p>}
            {verifiedSources.length === 0 && <p className="tt-inline-hint"><AlertCircle size={14} /> Upload and verify a rate card before proposing a rule.</p>}
            <footer className="tt-rate-editor__actions"><button type="submit" className="tt-button tt-button--primary" disabled={busy !== null || verifiedSources.length === 0}><Plus size={14} /> Propose this rate</button>{selectedRule?.enabled && <button className="tt-button tt-button--quiet" type="button" disabled={busy !== null} onClick={disableRule}><Minus size={14} /> Propose disabling</button>}</footer>
          </form>
          <div className="tt-rate-list" aria-label="Active rate rules">{state.rules.map((rule) => <RuleRow key={rule.id} rule={rule} />)}</div>
        </>}
      </section>

      <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />
      <section className="tt-footer-note"><Scale size={14} /><span>Reconciliation evidence for a human reviewer. Unknown amounts stay separate; this table does not approve payment or post to another system.</span></section>
    </div>
  );
}

function RuleRow({ rule }: { rule: RateRule }) {
  return <div className={`tt-rule-row${rule.enabled ? '' : ' is-disabled'}`}><span className="tt-rule-glyph"><Scale size={14} /></span><span><strong>{rule.kind === 'base' ? 'Zone base' : rule.kind === 'step' ? 'Extra kg' : 'Remote surcharge'} · {rule.zone}</strong><small>{rule.from} → {rule.to ?? 'No end date'} · source {rule.sourceId.slice(0, 10)}</small></span><b>{formatMoney(rule.amountSatang)}</b><span className="tt-rule-active">{rule.enabled ? 'Active' : 'Disabled'}</span></div>;
}

function formatSignedMoney(satang: number): string {
  if (!Number.isSafeInteger(satang)) return 'Unknown';
  const value = formatMoney(Math.abs(satang));
  return satang > 0 ? `+${value}` : satang < 0 ? `−${value}` : value;
}
