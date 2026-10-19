import { useId } from 'react';
import type { ChangeEvent } from 'react';
import { AlertCircle, ArrowRight, Check, Database, FileSpreadsheet, Link2, LoaderCircle, Upload, X } from 'lucide-react';
import type { Asset, LedgerEntry } from '../domain/types';
import type { SourceConnection } from '../domain/connections';
import './connections-panel.css';

export interface ConnectionDraft {
  database: { assets: Asset[]; connection: SourceConnection } | null;
  workbook: { ledger: LedgerEntry[]; connection: SourceConnection } | null;
}

export interface ConnectionsPanelProps {
  draft: ConnectionDraft;
  active: 'database' | 'excel' | 'ready';
  busy: boolean;
  error: string | null;
  guided: boolean;
  onSelect: (tab: 'database' | 'excel' | 'ready') => void;
  onConnect: (kind: 'database' | 'excel') => void;
  onFile: (file: File) => void;
  onStart: () => void;
  onClose: () => void;
}

type ConnectionStage = ConnectionsPanelProps['active'];

const STAGES: Array<{ id: ConnectionStage; label: string }> = [
  { id: 'database', label: 'Database' },
  { id: 'excel', label: 'Excel' },
  { id: 'ready', label: 'Ready' },
];

const money = (value: number) => `฿${new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)}`;
const displayCount = (value: number) => new Intl.NumberFormat('en-US').format(value);

function SourceBadge({ connection }: { connection: SourceConnection | null }) {
  if (!connection) return <span className="connections-panel__source-badge">Not connected</span>;
  return <span className="connections-panel__source-badge connections-panel__source-badge--connected"><Check size={11} /> {connection.mode === 'demo-snapshot' ? 'Bundled snapshot' : 'Local workbook'}</span>;
}

function StepIcon({ stage }: { stage: ConnectionStage }) {
  if (stage === 'database') return <Database size={15} />;
  if (stage === 'excel') return <FileSpreadsheet size={15} />;
  return <Check size={15} />;
}

function AssetRows({ assets }: { assets: Asset[] }) {
  if (!assets.length) return <p className="connections-panel__empty">No asset rows are available.</p>;
  return <div className="connections-panel__sample-rows" aria-label="First three fixed-asset rows">
    {assets.slice(0, 3).map(asset => <div className="connections-panel__sample-row" key={asset.rowId}>
      <strong>{asset.assetId}</strong><code>{asset.rowId}</code><span>{money(asset.cost)}</span>
    </div>)}
  </div>;
}

function LedgerRows({ ledger }: { ledger: LedgerEntry[] }) {
  if (!ledger.length) return <p className="connections-panel__empty">No workbook rows are available.</p>;
  return <div className="connections-panel__sample-rows" aria-label="First three general-ledger rows">
    {ledger.slice(0, 3).map(entry => <div className="connections-panel__sample-row" key={entry.id}>
      <strong>{entry.assetId}</strong><code>{entry.period}</code><span>{money(entry.amount)}</span>
    </div>)}
  </div>;
}

function Mapping({ items }: { items: Array<{ source: string; target: string }> }) {
  return <div className="connections-panel__mapping" aria-label="Field mappings">
    {items.map(item => <span key={item.source}><code>{item.source}</code><ArrowRight size={12} /><strong>{item.target}</strong></span>)}
  </div>;
}

export default function ConnectionsPanel({ draft, active, busy, error, guided, onSelect, onConnect, onFile, onStart, onClose }: ConnectionsPanelProps) {
  const titleId = useId();
  const canOpenExcel = !!draft.database;
  const canOpenReady = !!draft.database && !!draft.workbook;
  const canSelect = (stage: ConnectionStage) => !guided && !busy && (stage === 'database' || stage === 'excel' && canOpenExcel || stage === 'ready' && canOpenReady);
  const focusId = active === 'database' ? 'connection-database' : active === 'excel' ? 'connection-excel' : 'connection-ready';
  const assetCount = draft.database?.assets.length ?? 0;
  const ledgerCount = draft.workbook?.ledger.length ?? 0;
  const canStart = canOpenReady && !busy && !guided;

  const handleFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (file) onFile(file);
    event.currentTarget.value = '';
  };

  return <div className={`connections-panel__backdrop ${guided ? 'connections-panel__backdrop--guided' : 'connections-panel__backdrop--manual'}`} data-testid="connections-panel">
    <section className="connections-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} data-guided={guided ? 'true' : 'false'}>
      <header className="connections-panel__header">
        <div className="connections-panel__brand-mark"><Link2 size={17} /></div>
        <div className="connections-panel__heading"><span>CONNECT YOUR SOURCES</span><h2 id={titleId}>Bring the records together</h2><p>Two local inputs · one evidence-based workspace</p></div>
        {!guided && <button className="connections-panel__close" type="button" aria-label="Close connections panel" onClick={onClose}><X size={17} /></button>}
      </header>

      <nav className="connections-panel__steps" aria-label="Connection steps">
        {STAGES.map((stage, index) => {
          const selected = active === stage.id;
          const completed = stage.id === 'database' ? !!draft.database : stage.id === 'excel' ? !!draft.workbook : canOpenReady;
          const enabled = canSelect(stage.id);
          return <div className="connections-panel__step-wrap" key={stage.id}>
            <button type="button" className={`connections-panel__step${selected ? ' is-active' : ''}${completed ? ' is-complete' : ''}`} aria-current={selected ? 'step' : undefined} aria-disabled={!enabled} onClick={() => enabled && onSelect(stage.id)}>
              <span className="connections-panel__step-icon">{completed ? <Check size={13} /> : <StepIcon stage={stage.id} />}</span><span>{stage.label}</span>
            </button>
            {index < STAGES.length - 1 && <span className={`connections-panel__step-line${completed ? ' is-complete' : ''}`} aria-hidden="true" />}
          </div>;
        })}
      </nav>

      <div className="connections-panel__body">
        {active === 'database' && <section className="connections-panel__stage" data-demo-focus={focusId} data-demo-spotlight={guided ? 'true' : undefined} aria-labelledby={`${titleId}-database`}>
          <div className="connections-panel__stage-heading"><span className="connections-panel__source-icon connections-panel__source-icon--violet"><Database size={16} /></span><div><h3 id={`${titleId}-database`}>Fixed-asset database</h3><p>Bundled fictional snapshot · no external SQL connection</p></div><SourceBadge connection={draft.database?.connection ?? null} /></div>
          <div className="connections-panel__resource"><span>SNAPSHOT RESOURCE</span><code>accounting.fixed_assets · {draft.database?.connection.period??'2026-09'}</code></div>
          {draft.database ? <>
            <div className="connections-panel__count"><strong>{displayCount(assetCount)}</strong><span>fixed-asset records loaded from the snapshot</span></div>
            <AssetRows assets={draft.database.assets} />
          </> : <div className="connections-panel__explain"><strong>A prepared local data snapshot</strong><p>The demo reads its bundled JSON snapshot and validates the source fields before loading it into the workspace.</p></div>}
          <Mapping items={[{ source: 'assetId', target: 'Asset ID' }, { source: 'rowId', target: 'Source row' }, { source: 'cost', target: 'Original cost' }]} />
          <div className="connections-panel__actions">
            {!draft.database ? <button className="connections-panel__button connections-panel__button--primary" type="button" disabled={busy || guided} onClick={() => onConnect('database')}>
              {busy ? <LoaderCircle className="connections-panel__spin" size={15} /> : <Database size={15} />}{guided ? 'Connecting in this demo' : 'Connect bundled snapshot'}
            </button> : <button className="connections-panel__button connections-panel__button--primary" type="button" disabled={busy || guided} onClick={() => onSelect('excel')}>Continue to Excel <ArrowRight size={15} /></button>}
            {busy && <span className="connections-panel__busy" role="status">Validating source…</span>}
          </div>
        </section>}

        {active === 'excel' && <section className="connections-panel__stage" data-demo-focus={focusId} data-demo-spotlight={guided ? 'true' : undefined} aria-labelledby={`${titleId}-excel`}>
          <div className="connections-panel__stage-heading"><span className="connections-panel__source-icon connections-panel__source-icon--cyan"><FileSpreadsheet size={16} /></span><div><h3 id={`${titleId}-excel`}>General-ledger workbook</h3><p>Use the bundled Excel file or select a local workbook</p></div><SourceBadge connection={draft.workbook?.connection ?? null} /></div>
          {!draft.database && <div className="connections-panel__notice"><AlertCircle size={14} /><span>Connect the fixed-asset snapshot first.</span><button type="button" onClick={() => onSelect('database')} disabled={guided || busy}>Go to database</button></div>}
          <div className="connections-panel__resource"><span>WORKBOOK SHEET</span><code>GL postings</code></div>
          <Mapping items={[{ source: 'assetId', target: 'Asset ID' }, { source: 'amount', target: 'Posted amount' }, { source: 'period', target: 'Posting month' }]} />
          {draft.workbook ? <>
            <div className="connections-panel__count"><strong>{displayCount(ledgerCount)}</strong><span>ledger postings loaded from {draft.workbook.connection.name}</span></div>
            <LedgerRows ledger={draft.workbook.ledger} />
          </> : <div className="connections-panel__explain"><strong>Required columns</strong><p><code>id, assetId, period, account, amount</code></p><p>The sheet must be named <code>GL postings</code> and contain the same month as the asset snapshot (2026-09).</p></div>}
          <a className="connections-panel__download" href="/data/general-ledger-2026-09.xlsx" download><FileSpreadsheet size={14} /><span><strong>Download the sample workbook</strong><small>general-ledger-2026-09.xlsx · September 2026</small></span><ArrowRight size={14} /></a>
          {!guided && <label className="connections-panel__upload"><input type="file" accept=".xlsx" onChange={handleFile} disabled={busy || !draft.database} /><Upload size={14} /><span>Choose a local workbook</span><small>Optional · .xlsx</small></label>}
          <div className="connections-panel__actions">
            {!draft.workbook ? <button className="connections-panel__button connections-panel__button--primary" type="button" disabled={busy || guided || !draft.database} onClick={() => onConnect('excel')}>
              {busy ? <LoaderCircle className="connections-panel__spin" size={15} /> : <FileSpreadsheet size={15} />}{guided ? 'Loading workbook in this demo' : 'Connect sample workbook'}
            </button> : <button className="connections-panel__button connections-panel__button--primary" type="button" disabled={busy || guided} onClick={() => onSelect('ready')}>Review connection <ArrowRight size={15} /></button>}
            {busy && <span className="connections-panel__busy" role="status">Reading workbook…</span>}
          </div>
        </section>}

        {active === 'ready' && <section className="connections-panel__stage" data-demo-focus={focusId} data-demo-spotlight={guided ? 'true' : undefined} aria-labelledby={`${titleId}-ready`}>
          <div className="connections-panel__ready-mark"><Check size={20} /></div>
          <h3 id={`${titleId}-ready`}>{canOpenReady ? 'Both sources are ready' : 'Complete the source connections'}</h3>
          <p className="connections-panel__ready-copy">{canOpenReady ? <>The workspace will compare asset records with GL postings using <code>assetId + period</code>. Reconciliation results appear after the workspace starts.</> : 'Connect the fixed-asset snapshot and GL workbook before starting a workspace.'}</p>
          <div className="connections-panel__ready-sources">
            <div><Database size={15} /><span><strong>Fixed assets</strong><small>{draft.database?.connection.name ?? 'Not connected'}</small></span><b>{displayCount(assetCount)}</b></div>
            <div><FileSpreadsheet size={15} /><span><strong>GL postings</strong><small>{draft.workbook?.connection.name ?? 'Not connected'}</small></span><b>{displayCount(ledgerCount)}</b></div>
          </div>
          {!draft.database || !draft.workbook ? <div className="connections-panel__notice"><AlertCircle size={14} /><span>Connect both sources before starting the workspace.</span></div> : <p className="connections-panel__no-results">Connection complete · match status has not been calculated yet.</p>}
          <div className="connections-panel__actions">
            <button className="connections-panel__button connections-panel__button--primary" type="button" disabled={!canStart} onClick={onStart}>{busy ? <LoaderCircle className="connections-panel__spin" size={15} /> : <Check size={15} />}{guided ? 'Workspace starts in this demo' : 'Start workspace'}</button>
            {busy && <span className="connections-panel__busy" role="status">Starting workspace…</span>}
          </div>
        </section>}
      </div>

      {error && <div className="connections-panel__error" role="alert"><AlertCircle size={14} /><span>{error}</span></div>}
      <footer className="connections-panel__footer"><span><span className="connections-panel__footer-dot" />Local processing · database is fictional · no external service</span>{active !== 'ready' && <span>Step {STAGES.findIndex(stage => stage.id === active) + 1} of 3</span>}</footer>
    </section>
  </div>;
}
