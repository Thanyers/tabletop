import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, FileText, LoaderCircle, RotateCcw, ShieldCheck, Upload, X } from 'lucide-react';
import type { Candidate, WorkspaceView } from '../shared/contracts';
import type { Command, WorkbenchProps } from './types';
import { formatMoney, summarize } from './types';

const UploadCapabilityContext = createContext({ enabled: true, reason: '' });

export function UploadCapabilityProvider({ enabled, reason, children }: { enabled: boolean; reason: string; children: ReactNode }) {
  return <UploadCapabilityContext.Provider value={{ enabled, reason }}>{children}</UploadCapabilityContext.Provider>;
}

export function CandidateLifecycle({ view, onCommand, busy }: { view: WorkspaceView; onCommand: Command; busy: string | null }) {
  const candidate = view.domain.candidate;
  const [rollbackRevision, setRollbackRevision] = useState('');
  const run = (type: string, payload: unknown = {}) => { void onCommand(type, payload); };
  const isBusy = busy?.startsWith('evolve.') ?? false;

  return (
    <section className="tt-section tt-lifecycle" aria-labelledby="tt-lifecycle-title">
      <header className="tt-section__header">
        <div><span className="tt-kicker">CHANGE CONTROL</span><h2 id="tt-lifecycle-title">Draft lifecycle</h2></div>
        <span className={`tt-status-pill tt-status-pill--${candidate?.status ?? 'idle'}`}>{candidate?.status ?? 'No draft'}</span>
      </header>
      {!candidate ? (
        <div className="tt-empty-note"><ShieldCheck size={17} /><p>Make a bounded edit to create a draft. The Active table keeps its current rules until activation.</p></div>
      ) : (
        <>
          <div className="tt-candidate-meta">
            <span>Draft by {candidate.createdBy}</span>
            <span>Data r{candidate.baseDataRevision} · Rules r{candidate.baseRuleRevision}</span>
            <small title={candidate.hash}>Candidate {candidate.hash.slice(0, 12)}</small>
          </div>
          {candidate.simulation && <SimulationComparison simulation={candidate.simulation} />}
          {candidate.simulation && candidate.simulation.checks.length > 0 && (
            <div className="tt-check-list" aria-label="Simulation checks">
              {candidate.simulation.checks.map((check) => <div className={check.passed ? 'is-passed' : 'is-failed'} key={check.id}><span aria-hidden="true">{check.passed ? <Check size={13} /> : <X size={13} />}</span><span>{check.message}</span><b>{check.passed ? 'Pass' : 'Needs work'}</b></div>)}
            </div>
          )}
          <div className="tt-lifecycle-actions">
            {candidate.status === 'draft' && <button type="button" onClick={() => run('evolve.simulate')} disabled={isBusy}><span>1</span> Simulate</button>}
            {candidate.status === 'simulated' && <button type="button" onClick={() => run('evolve.validate')} disabled={isBusy}><span>2</span> Validate</button>}
            {candidate.status === 'validated' && <button type="button" onClick={() => run('evolve.approve')} disabled={isBusy}><span>3</span> Approve</button>}
            {candidate.status === 'approved' && <button className="is-primary" type="button" onClick={() => run('evolve.activate')} disabled={isBusy}><span>4</span> Activate</button>}
            {candidate.status === 'active' && view.domain.revisions.length > 0 && (
              <div className="tt-rollback">
                <label htmlFor="tt-rollback-revision">Restore a compatible revision</label>
                <div><select id="tt-rollback-revision" value={rollbackRevision} onChange={(event) => setRollbackRevision(event.target.value)}><option value="">Choose a revision</option>{view.domain.revisions.map((record) => <option value={record.revision} key={record.revision}>Revision {record.revision}</option>)}</select><button type="button" disabled={!rollbackRevision || isBusy} onClick={() => run('evolve.rollback', { revision: Number(rollbackRevision) })}><RotateCcw size={14} /> Restore</button></div>
              </div>
            )}
            {candidate.status === 'active' && <span className="tt-lifecycle-complete"><CheckCircle2 size={14} /> Active revision {view.domain.ruleRevision}</span>}
          </div>
          {candidate.proof && <p className="tt-proof-note">Validation proof {candidate.proof.passed ? 'passed' : 'failed'} · {candidate.proof.hash.slice(0, 12)}</p>}
        </>
      )}
      {isBusy && <span className="tt-inline-progress" role="status"><LoaderCircle size={13} className="tt-spin" /> Updating draft…</span>}
    </section>
  );
}

function SimulationComparison({ simulation }: { simulation: NonNullable<Candidate['simulation']> }) {
  const before = comparisonFacts(simulation.before);
  const after = comparisonFacts(simulation.after);
  return (
    <div className="tt-simulation">
      <div className="tt-simulation__head"><span>SIMULATION</span><small>same source revision</small></div>
      <div className="tt-simulation__grid">
        <div><span>Before</span><strong>{before.primary}</strong><small>{before.secondary}</small></div>
        <ChevronRight size={15} aria-hidden="true" />
        <div><span>After</span><strong>{after.primary}</strong><small>{after.secondary}</small></div>
      </div>
      <span className="tt-neutral-hint">Simulation results stay separate from Active data.</span>
    </div>
  );
}

function comparisonFacts(value: unknown): { primary: string; secondary: string } {
  if (typeof value !== 'object' || value === null) return { primary: summarize(value), secondary: 'No detailed comparison' };
  const record = value as Record<string, unknown>;
  const nestedResult = typeof record.result === 'object' && record.result !== null ? record.result as Record<string, unknown> : null;
  if (nestedResult && typeof nestedResult.knownExpectedSatang === 'number') {
    const rows = Array.isArray(nestedResult.rows) ? nestedResult.rows.length : 0;
    const unknown = typeof nestedResult.unknownCount === 'number' ? nestedResult.unknownCount : 0;
    const delta = typeof nestedResult.deltaSatang === 'number' ? nestedResult.deltaSatang : 0;
    const columns = typeof record.surface === 'object' && record.surface !== null && Array.isArray((record.surface as Record<string, unknown>).columns)
      ? ((record.surface as { columns: unknown[] }).columns.length)
      : null;
    return {
      primary: 'Expected ' + formatMoney(nestedResult.knownExpectedSatang),
      secondary: 'Difference ' + formatMoney(Math.abs(delta)) + ' · ' + rows + ' rows · ' + unknown + ' unknown' + (columns === null ? '' : ' · ' + columns + ' columns'),
    };
  }
  const physics = typeof record.result === 'object' && record.result !== null ? record.result as Record<string, unknown> : null;
  const parameters = typeof record.parameters === 'object' && record.parameters !== null ? record.parameters as Record<string, unknown> : null;
  if (physics && parameters && typeof physics.position === 'number') {
    return {
      primary: physics.position.toLocaleString('en', { maximumFractionDigits: 3 }) + ' m at ' + summarize(parameters.time) + ' s',
      secondary: 'Acceleration ' + summarize(physics.acceleration) + ' m/s² · velocity ' + summarize(physics.velocity) + ' m/s',
    };
  }
  const scenario = typeof record.scenario === 'object' && record.scenario !== null ? record.scenario as Record<string, unknown> : null;
  if (scenario && typeof scenario.hpAfter === 'number') {
    return {
      primary: 'Pip ' + scenario.hpAfter + ' HP after hit',
      secondary: 'Shield ' + (scenario.shieldApplied ? 'applies' : 'does not apply') + ' · recorded seed ' + summarize(record.recordedSeed),
    };
  }
  const primary = record.deltaSatang ?? record.knownExpectedSatang ?? record.expected ?? record.value;
  const secondary = record.rowCount ?? record.unknownCount ?? record.rows ?? record.checks;
  return {
    primary: primary === undefined ? summarize(value) : summarize(primary),
    secondary: secondary === undefined ? 'Value from the simulation' : `${summarize(secondary)} rows or checks`,
  };
}

interface UploadCardProps {
  kind: 'shipments' | 'invoice' | 'rate-card';
  title: string;
  description: string;
  onUpload: WorkbenchProps['onUpload'];
  busy: boolean;
}

export function UploadCard({ kind, title, description, onUpload, busy }: UploadCardProps) {
  const capability = useContext(UploadCapabilityContext);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const chooseFile = async (file?: File) => {
    if (!file) return;
    const limit = kind === 'shipments' ? 5 * 1024 * 1024 : 10 * 1024 * 1024;
    if (file.size > limit) {
      setError(`This file is over the ${kind === 'shipments' ? '5 MiB' : '10 MiB'} limit. Choose a smaller file.`);
      return;
    }
    setError('');
    setUploading(true);
    try { await onUpload(kind, file); } catch (reason) { setError(reason instanceof Error ? reason.message : 'The file could not be added.'); }
    finally { setUploading(false); if (input.current) input.current.value = ''; }
  };
  const disabled = busy || uploading || !capability.enabled;
  return (
    <div className="tt-upload-card">
      <div className="tt-upload-card__icon"><FileText size={16} /></div>
      <div className="tt-upload-card__copy"><strong>{title}</strong><p>{description}</p><small>{capability.enabled ? kind === 'shipments' ? 'CSV · up to 5 MiB' : 'Text PDF · up to 10 MiB' : capability.reason}</small>{error && <span className="tt-field-error" role="alert">{error}</span>}</div>
      <input ref={input} type="file" accept={kind === 'shipments' ? '.csv,text/csv' : kind === 'invoice' ? '.pdf,.csv,application/pdf,text/csv' : '.pdf,.txt,application/pdf,text/plain'} className="tt-visually-hidden" disabled={!capability.enabled} onChange={(event) => void chooseFile(event.currentTarget.files?.[0])} aria-label={`Choose ${title.toLowerCase()}`} />
      <button type="button" className="tt-icon-button" disabled={disabled} onClick={() => input.current?.click()} aria-label={capability.enabled ? `Add ${title.toLowerCase()}` : `${title} upload is disabled`} title={!capability.enabled ? capability.reason : undefined}>{disabled && capability.enabled ? <LoaderCircle size={15} className="tt-spin" /> : <Upload size={15} />}</button>
    </div>
  );
}

export function EvidenceList({ view, focusSourceIds, onFocusEvidence, onCommand, busy }: Pick<WorkbenchProps, 'view' | 'focusSourceIds' | 'onFocusEvidence' | 'onCommand' | 'busy'>) {
  const state = view.domain.kind === 'invoice' ? view.domain : null;
  if (!state || state.sources.length === 0) return <div className="tt-empty-note"><FileText size={16} /><p>Uploaded documents and reviewed excerpts will appear here with their page text.</p></div>;
  return (
    <div className="tt-source-list">
      {state.sources.map((source) => {
        const focused = focusSourceIds.includes(source.id);
        return (
          <article className={`tt-source-card${focused ? ' is-focused' : ''}`} key={source.id}>
            <button className="tt-source-card__open" type="button" onClick={() => onFocusEvidence([source.id])} aria-expanded={focused}>
              <span className="tt-source-card__icon"><FileText size={15} /></span>
              <span><strong>{source.filename}</strong><small>{source.kind} · {source.pages.length} page{source.pages.length === 1 ? '' : 's'}</small></span>
              <span className={`tt-source-status tt-source-status--${source.status}`}>{source.status}</span>
            </button>
            {focused && <div className="tt-source-preview">
              {source.excerpt && <p>{source.excerpt}</p>}
              {source.pages.map((page) => <details key={page.number}><summary>Page {page.number}</summary><pre>{page.text}</pre></details>)}
              {/^[0-9a-f-]{36}$/i.test(source.id) && <p><a href={`/api/workspaces/${view.id}/sources/${source.id}`} download>Download original source</a><small> Text-file previews are limited to the first 100,000 characters.</small></p>}
              {source.status === 'provided' && <div className="tt-review-actions"><span>Check the extracted text and normalized rows before relying on this source.</span><button type="button" disabled={busy !== null} onClick={() => void onCommand('invoice.reviewSource', { sourceId: source.id, status: 'verified' })}><Check size={14} /> Verify</button><button type="button" className="is-muted" disabled={busy !== null} onClick={() => void onCommand('invoice.reviewSource', { sourceId: source.id, status: 'rejected' })}><AlertTriangle size={14} /> Reject</button></div>}
              {source.reviewedBy && <small className="tt-reviewer">Reviewed by {view.members.find(member => member.actorId === source.reviewedBy)?.name ?? 'the table owner'}</small>}
            </div>}
          </article>
        );
      })}
    </div>
  );
}

export function MemberStrip({ view }: { view: WorkspaceView }) {
  return <div className="tt-member-strip" aria-label="People at this table">{view.members.map((member) => <span className={`tt-member tt-member--${member.role}`} key={member.actorId} title={`${member.name} · ${member.role}`}><i aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</i><span>{member.name}</span><small>{member.seat ?? member.role}</small></span>)}</div>;
}

export function ConfirmDialog({ title, children, confirmLabel, onConfirm, onClose, busy = false }: { title: string; children: React.ReactNode; confirmLabel: string; onConfirm: () => void; onClose: () => void; busy?: boolean }) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => { window.clearTimeout(timer); previous?.focus(); };
  }, []);
  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !busy) { onClose(); return; }
    if (event.key !== 'Tab') return;
    const controls = [closeRef.current, confirmRef.current].filter((item): item is HTMLButtonElement => !!item && !item.disabled);
    if (controls.length === 0) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };
  return (
    <div className="tt-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialogRef} className="tt-dialog" role="dialog" aria-modal="true" aria-labelledby="tt-dialog-title" aria-describedby="tt-dialog-description" tabIndex={-1} onKeyDown={trapFocus}>
        <span className="tt-dialog__mark"><AlertTriangle size={17} /></span><h2 id="tt-dialog-title">{title}</h2><div id="tt-dialog-description" className="tt-dialog__body">{children}</div>
        <footer><button ref={closeRef} type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={onClose}>Keep current table</button><button ref={confirmRef} type="button" className="tt-button tt-button--danger" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle size={14} className="tt-spin" /> : null}{confirmLabel}</button></footer>
      </section>
    </div>
  );
}
