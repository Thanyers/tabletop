import { viewerCan } from '../shared/permissions';
import { checkboxAction, checkboxUnavailableReason } from './checkbox-actions';
import { recordChoiceLabels, recordSummary } from './record-summary';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { AlertCircle, Database, FilePlus2, Pencil, Play, Trash2, Users } from 'lucide-react';
import type { TableAction, TableChange, TableOperand, TableCollection, TableField, TableProgram, TableRecord, TableSource, TableState, TableValue } from '../shared/table-contracts';
import type { ComputedColumn } from '../shared/table-contracts';
import { computeRecordRow, MAX_COMPUTED_COLUMNS } from '../shared/computed-columns';
import { formatComputedExpression, parseComputedFormula } from '../shared/computed-formula';
import { TABLE_CAPABILITIES, TABLE_CAPABILITY_LIMITS } from '../shared/table-capabilities';
import { MAX_TABLE_SOURCES, TABLE_FILE_BYTES, TABLE_TOTAL_SOURCE_BYTES } from '../shared/table-source-limits';
import type { ActorContext, WorkspaceView } from '../shared/contracts';
import type { PlanNode } from '../runtime';
import { applyTableChange, handleTableCommand } from '../domain/table';
import type { GenerativeViewDescriptor } from '../shared/generative-contracts';
import { CandidateLifecycle } from './WorkbenchShared';
import type { Command, WorkbenchProps } from './types';
import { clearGeneratedCanvasPreview, GeneratedCanvasObject } from './GeneratedCanvasObjects';
import { applyTableCandidate } from '../workspace/table-candidate-apply';
import { NoteCard } from './NoteCard';
import { autoMapping, buildImportRows, parseCsv, worksheetToCsvTable } from './table-row-import';
import { RollParameterControl } from './RollParameterControl';
import { RuleChatActions } from './RuleChatActions';
import { hasLinkedComputeOutput, LinkedComputeOutputs, TableComputeModuleCard } from './TableComputeModuleCard';
import { serverRollFor, useServerRollsTick } from './roll-store';
import { describeProgramDiff, diffProgram, ruleBadge, type ProgramDiff, type RuleBadge } from './rules-summary';
import { webSourceMeta, webSourceStatusLabel } from './table-source-view';
import { fixedProgramRecordIds, matchRowsByIdentity, requiredTextIdentityCandidates } from '../shared/row-identity';
import './record-actions.css';
import './rules-card.css';

interface TableCanvasObjectProps {
  view: WorkspaceView;
  node: PlanNode;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onTableImport?: WorkbenchProps['onTableImport'];
  outputs: Record<string, unknown>;
  expanded?: boolean;
  onEditRules?: (prompt?: string) => void;
}

const MAX_SOURCE_FILES = MAX_TABLE_SOURCES;
const MAX_SOURCE_BYTES = TABLE_TOTAL_SOURCE_BYTES;

export function TableCanvasObject(props: TableCanvasObjectProps) {
  if (props.view.domain.kind !== 'table') return null;
  if (props.node.id === 'table.sources') return <TableSources {...props} state={props.view.domain} />;
  if (props.node.id === 'table.rules') return <TableRules {...props} state={props.view.domain} />;
  if (props.node.id.startsWith('table.collection.')) return <TableCollectionView {...props} state={props.view.domain} />;
  if (props.node.id === 'table.actions') return <TableActions {...props} state={props.view.domain} />;
  if (props.node.id.startsWith('table.note.')) {
    const note = props.view.domain.notes?.find((item) => `table.note.${item.id}` === props.node.id);
    return note
      ? <NoteCard view={props.view} note={note} busy={props.busy} onCommand={props.onCommand} expanded={props.expanded} />
      : <p className="tt-canvas-inline__note">This note was removed.</p>;
  }
  if (props.node.id.startsWith('table.view.')) {
    const descriptor = props.outputs.descriptor as GenerativeViewDescriptor | undefined;
    return descriptor ? <GeneratedCanvasObject view={props.view} state={props.view.domain} descriptor={descriptor} busy={props.busy} onCommand={props.onCommand} expanded={props.expanded} /> : <p className="tt-canvas-inline__note">This generated view is not available.</p>;
  }
  return <p className="tt-canvas-inline__note">This table object is not available.</p>;
}

function TableSources({ view, state, busy, onTableImport, onCommand, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const totalBytes = state.sources.reduce((sum, source) => sum + new TextEncoder().encode(source.text).byteLength, 0);
  const readOnly = busy === 'table.readOnly';
  const canAdd = !readOnly && !!onTableImport && state.sources.length < MAX_SOURCE_FILES && totalBytes < MAX_SOURCE_BYTES;

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!onTableImport) {
      setError('Files cannot be added here.');
      return;
    }
    setError('');
    setImporting(true);
    let target = view;
    try {
      for (const file of files) target = await onTableImport(target, file);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The source file could not be added.');
    } finally {
      setImporting(false);
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    void addFiles(files);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    void addFiles(Array.from(event.dataTransfer.files));
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); event.stopPropagation(); };
  const referencedSourceIds = new Set([
    ...(state.program?.evidence.map((item) => item.sourceId) ?? []),
    ...state.revisions.flatMap((revision) => revision.snapshot.kind === 'table' ? revision.snapshot.program.evidence.map((item) => item.sourceId) : []),
  ]);

  return <div className="tt-canvas-inline tt-table-sources">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">SHARED TABLE FILES</span><strong>Files for this table</strong><small>{state.sources.length}/{MAX_SOURCE_FILES} · {Math.ceil(totalBytes / 1024)} KiB</small></div>
    <p className="tt-canvas-inline__note"><Users size={13} aria-hidden="true" /> Everyone at this table can read and add files. Only the owner removes them.</p>
    {expanded && readOnly && <p className="tt-table-readonly-inline" role="status">This table is temporarily read-only. You can still inspect the files and shared records.</p>}
    {expanded && <>
      {readOnly ? null : canAdd ? <div className="tt-table-dropzone" onDrop={onDrop} onDragOver={onDragOver}>
        <FilePlus2 size={19} aria-hidden="true" />
        <strong>Drop files here</strong>
        <small>CSV, JSON, TXT or Markdown · 32 KiB each</small>
        <button type="button" className="tt-button tt-button--quiet" onClick={() => inputRef.current?.click()} disabled={busy !== null || importing}>Choose files</button>
        <input ref={inputRef} type="file" accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown" multiple hidden onChange={onInput} aria-label="Choose table source files" />
        <details><summary>File limits</summary><small>UTF-8 text · four files, 64 KiB total. PDF and images are not supported. AI rule requests can carry 128 KiB: your message, these files (files the rules already cite go by name only), the current rules and rows.</small></details>
      </div> : <p className="tt-table-limit-note">{state.sources.length >= MAX_SOURCE_FILES ? 'All four source file slots are in use.' : totalBytes >= MAX_SOURCE_BYTES ? 'The 64 KiB source limit has been reached.' : 'Files cannot be added here.'}</p>}
    </>}
    {error && <p className="tt-table-error" role="alert"><AlertCircle size={14} />{error}</p>}
    {state.sources.length === 0 ? !expanded && <p className="tt-canvas-inline__empty">{readOnly ? 'No files yet.' : 'Add a file or describe the table you want.'}</p> : <ul className="tt-table-source-list" aria-label="Table source files">{state.sources.map((source) => <SourceCard key={source.id} source={source} view={view} expanded={expanded} canRemove={viewerCan(view, 'files.remove') && !readOnly && !referencedSourceIds.has(source.id)} readOnly={readOnly} referenced={referencedSourceIds.has(source.id)} busy={busy !== null} onRemove={() => void onCommand('table.removeSource', { sourceId: source.id })} onCommand={onCommand} />)}</ul>}
  </div>;
}

function SourceCard({ source, view, expanded, canRemove, readOnly, referenced, busy, onRemove, onCommand }: { source: TableSource; view: WorkspaceView; expanded: boolean; canRemove: boolean; readOnly: boolean; referenced: boolean; busy: boolean; onRemove: () => void; onCommand: WorkbenchProps['onCommand'] }) {
  const web = source.origin === 'web';
  const meta = web ? webSourceMeta(source) : null;
  const canReview = web && source.status === 'provided' && view.actor.role === 'owner' && !readOnly && !busy;
  return <li className="tt-table-source-card">
    <div className="tt-table-source-card__head"><Database size={15} aria-hidden="true" /><span><strong>{source.filename}</strong><small>{(new TextEncoder().encode(source.text).byteLength / 1024).toFixed(1)} KiB · added {new Date(source.createdAt).toLocaleString()}</small></span>{web && <span className={`tt-table-source-status tt-table-source-status--${source.status ?? 'provided'}`} data-testid="source-web-status">{webSourceStatusLabel(source.status)}</span>}{canRemove && <button type="button" className="tt-icon-button" aria-label={`Remove ${source.filename}`} disabled={busy} onClick={onRemove}><Trash2 size={14} /></button>}</div>
    {meta && <p className="tt-table-source-card__origin">{meta.href ? <a href={meta.href} target="_blank" rel="noopener">{meta.host || 'Web source'}</a> : <span>{meta.host || 'Web source'}</span>}{meta.dateLabel && <span>{meta.dateLabel}</span>}{meta.authorityLabel && <span>{meta.authorityLabel}</span>}</p>}
    {canReview && <div className="tt-table-source-card__review"><button type="button" className="tt-button tt-button--quiet" data-testid="source-verify" disabled={busy} onClick={() => void onCommand('table.reviewWebSource', { sourceId: source.id, status: 'verified' })}>Verify</button><button type="button" className="tt-button tt-button--danger" data-testid="source-reject" disabled={busy} onClick={() => void onCommand('table.reviewWebSource', { sourceId: source.id, status: 'rejected' })}>Reject</button></div>}
    {expanded && <details><summary>Review source text</summary><pre>{source.text}</pre></details>}
    {!canRemove && <small className="tt-table-source-card__citation">{referenced ? 'Used by an active or retained rule set · keep with this table' : readOnly ? 'Source editing is temporarily paused.' : web ? 'Only the table owner can remove this web source.' : 'Only the table owner can remove this file.'}</small>}
  </li>;
}

function TableRules({ view, state, onCommand, busy, expanded = false, onEditRules }: TableCanvasObjectProps & { state: TableState }) {
  const [manualChange, setManualChange] = useState('');
  const [manualError, setManualError] = useState('');
  const [applying, setApplying] = useState(false);
  const [applyFeedback, setApplyFeedback] = useState('');
  // Equal permissions (F015): every member manages rules like the owner.
  const isOwner = viewerCan(view, 'rules.approve');
  const readOnly = busy === 'table.readOnly';
  const program = state.program;
  const candidateChange = state.candidate?.change.kind === 'table' ? state.candidate.change : null;
  const candidateKey = state.candidate ? `${state.candidate.id}:${state.candidate.hash}` : '';
  const candidateState = useMemo(() => {
    if (!candidateChange) return null;
    try { return applyTableChange(structuredClone(state), structuredClone(candidateChange)); }
    catch { return null; }
  }, [candidateChange, state]);

  useEffect(() => { setApplyFeedback(''); }, [candidateKey]);

  // F039: anyone who may draft rules may take one out; a collection asks first because its rows go too.
  const canRemove = viewerCan(view, 'rules.draft') && !readOnly;
  const [pendingRemoval, setPendingRemoval] = useState<RuleRemoval | null>(null);
  const [removeFeedback, setRemoveFeedback] = useState('');
  const removeRule = async (removal: RuleRemoval) => {
    setRemoveFeedback('');
    setPendingRemoval(null);
    try {
      // A refusal is already shown as the table notice with its reason.
      await onCommand('evolve.removeItem', { kind: removal.kind, id: removal.id });
    } catch (error) {
      setRemoveFeedback(error instanceof Error && error.message ? error.message : `${removal.title} could not be removed.`);
    }
  };
  const requestRemoval = (removal: RuleRemoval) => {
    if (busy !== null) return;
    if (removal.kind === 'collection') setPendingRemoval(removal);
    else void removeRule(removal);
  };

  const applyProposal = async () => {
    if (!isOwner || readOnly || busy !== null || applying || state.candidate?.status === 'active') return;
    setApplyFeedback('');
    setApplying(true);
    try {
      const result = await applyTableCandidate(view, onCommand, { readOnly });
      if (!result.ok) setApplyFeedback(result.reason);
    } catch {
      setApplyFeedback('A review step could not be completed. Review the latest proposal and try again.');
    } finally { setApplying(false); }
  };

  const proposeManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let parsed: unknown;
    try { parsed = JSON.parse(manualChange); }
    catch { setManualError('Enter a valid table change.'); return; }
    if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== 'table') { setManualError('The change must include a table program and initial records.'); return; }
    setManualError('');
    void onCommand('evolve.propose', { change: parsed });
  };

  const reviewingProposal = Boolean(candidateChange) && state.candidate?.status !== 'active';
  const diff = useMemo<ProgramDiff | null>(() => {
    if (!candidateChange) return null;
    const startingRows = Object.values(candidateChange.initialRecords).reduce((sum, rows) => sum + rows.length, 0);
    return diffProgram(state.program, candidateChange.program, { startingRows });
  }, [candidateChange, state.program]);
  const diffLine = diff ? describeProgramDiff(diff) : '';
  const displayProgram = reviewingProposal ? candidateChange?.program ?? null : program;
  const displayRuleCount = displayProgram ? displayProgram.actions.length + displayProgram.invariants.length + (displayProgram.compute?.modules.length ?? 0) : 0;

  return <div className="tt-canvas-inline tt-table-rules">
    <div className="tt-canvas-inline__heading"><span className="tt-table-rules__label">{reviewingProposal ? 'Rules to review' : program ? 'Rules in use' : 'Table rules'}</span><strong>{displayProgram?.title ?? 'Your table'}</strong><small>{displayProgram ? `${displayRuleCount} ${displayRuleCount === 1 ? 'rule' : 'rules'} · ${displayProgram.collections.length} ${displayProgram.collections.length === 1 ? 'table' : 'tables'}` : 'No rules yet'}</small></div>
    {isOwner && program && onEditRules && <div className="tt-inline-action-row"><button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || readOnly || Boolean(state.candidate && state.candidate.status !== 'active')} onClick={() => onEditRules()}><Pencil size={13} />Describe a rule change</button></div>}
    {!expanded ? <p className="tt-canvas-inline__note">{reviewingProposal ? 'Open to review the proposed rules.' : program ? 'Open to read each rule, ask a question, or request a change.' : 'Add a file, or describe the table you want.'}</p> : <>
      {reviewingProposal && candidateChange ? <>
        <section className="tt-table-proposal" aria-labelledby="tt-table-proposal-title">
          <span className="tt-kicker">NOT ACTIVE YET</span>
          <h3 id="tt-table-proposal-title">{candidateChange.program.title}</h3>
          {diffLine && <p className="tt-table-proposal__changes">{diffLine}</p>}
          <ProgramOverview program={candidateChange.program} state={state} label="Proposed rules" change={candidateChange} members={view.members} diff={diff} view={view} busy={busy} onCommand={onCommand} interactive={false} />
          {isOwner && candidateState?.program?.canvas?.views.length ? <details className="tt-table-private-preview"><summary>Private preview</summary><DraftCanvasPreview key={`${state.candidate?.id ?? 'candidate'}:${state.candidate?.hash ?? 'draft'}`} candidateKey={`${state.candidate?.id ?? 'candidate'}:${state.candidate?.hash ?? 'draft'}`} view={view} initialState={candidateState} busy={busy} /></details> : null}
        </section>
        {isOwner && <div className="tt-card-cta tt-table-proposal__apply">
          <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || readOnly || applying} onClick={() => void applyProposal()}>{applying ? 'Applying…' : 'Apply to table'}</button>
          {applying && <p className="tt-canvas-inline__note" role="status">Simulating and checking this proposal before activation.</p>}
          {applyFeedback && <p className="tt-table-error" role="alert">{applyFeedback}</p>}
        </div>}
      </> : null}

      {program
        ? reviewingProposal
          ? <details className="tt-table-current-setup"><summary>Current setup</summary><ProgramOverview program={program} state={state} label="Current active rules" members={view.members} view={view} busy={busy} onCommand={onCommand} onEditRules={onEditRules} interactive /></details>
          : <ProgramOverview program={program} state={state} label="Current active rules" members={view.members} onRemove={canRemove && busy === null ? requestRemoval : undefined} view={view} busy={busy} onCommand={onCommand} onEditRules={onEditRules} interactive />
        : !candidateChange && <div className="tt-canvas-inline__empty"><Database size={15} /> Describe the table you want, or add a source file.</div>}

      {pendingRemoval && <div className="tt-table-remove-confirm" role="alertdialog" aria-label={`Remove ${pendingRemoval.title}`}>
        <p>Remove the table <strong>{pendingRemoval.title}</strong>? Its {state.records[pendingRemoval.id]?.length ?? 0} rows are deleted too. You can bring the rules back from history, but not the rows.</p>
        <div className="tt-inline-action-row"><button type="button" className="tt-button tt-button--quiet" onClick={() => setPendingRemoval(null)}>Cancel</button><button type="button" className="tt-button tt-button--danger" onClick={() => void removeRule(pendingRemoval)}><Trash2 size={13} />Remove table and rows</button></div>
      </div>}
      {removeFeedback && <p className="tt-table-error" role="alert">{removeFeedback}</p>}

      <details className="tt-table-capabilities"><summary>What this table can do</summary>
        <p className="tt-table-inline-hint">{TABLE_CAPABILITIES.supported.length} capabilities · {TABLE_CAPABILITIES.gaps.length} known gaps · limits: {TABLE_CAPABILITY_LIMITS.collections} collections, {TABLE_CAPABILITY_LIMITS.fieldsPerCollection} fields, {TABLE_CAPABILITY_LIMITS.rowsPerCollection} rows per collection, {TABLE_CAPABILITY_LIMITS.canvasViews} views, {TABLE_CAPABILITY_LIMITS.computedColumns} computed columns</p>
        <ul className="tt-table-capability-list">{TABLE_CAPABILITIES.supported.map((item) => <li key={item.id}><strong>{item.title}</strong> — {item.detail}</li>)}</ul>
        <details className="tt-table-capability-gaps"><summary>Known gaps ({TABLE_CAPABILITIES.gaps.length})</summary><ul className="tt-table-capability-list">{TABLE_CAPABILITIES.gaps.map((item) => <li key={item.id}><strong>{item.title}</strong> — {item.detail}</li>)}</ul></details>
      </details>
      <details className="tt-table-advanced-meta"><summary>Advanced table details</summary><p>{program ? `Active rules revision r${state.ruleRevision} · data revision r${state.dataRevision}.` : 'No rules are active yet.'} The owner reviews and applies proposals before they change this table.</p></details>
      {isOwner && state.candidate && <details className={state.candidate.status === 'active' ? 'tt-table-history' : 'tt-table-advanced-checks'}><summary>{state.candidate.status === 'active' ? 'History and restore' : 'Advanced checks'}</summary><CandidateLifecycle view={view} onCommand={onCommand} busy={busy} readOnly={readOnly} /></details>}
      {isOwner && !readOnly && <details className="tt-table-manual-editor"><summary>Advanced manual rule change</summary><p>Paste a prepared table change only if needed. Normal requests can be written in plain language in the AI draft assistant.</p><form onSubmit={proposeManual}><label htmlFor="tt-table-manual-change">Table change</label><textarea id="tt-table-manual-change" rows={7} value={manualChange} onChange={(event) => { setManualChange(event.target.value); setManualError(''); }} placeholder={'{"kind":"table","program":{...},"initialRecords":{...}}'} spellCheck={false} /><small>New tables include initial records. Changes to an active table must preserve its collections and current records.</small>{manualError && <span role="alert" className="tt-table-error">{manualError}</span>}<button className="tt-button tt-button--quiet" type="submit" disabled={busy !== null || manualChange.trim().length === 0}>Propose manual change</button></form></details>}
      {!isOwner && <p className="tt-canvas-inline__note">Proposals and review controls are private to the owner. Files, active rules and records are shared with this table.</p>}
    </>}
  </div>;
}

function DraftCanvasPreview({ candidateKey, view, initialState, busy }: { candidateKey: string; view: WorkspaceView; initialState: TableState; busy: string | null }) {
  const [trialState, setTrialState] = useState(() => structuredClone(initialState));
  const [resetRevision, setResetRevision] = useState(0);
  const [trialCommitting, setTrialCommitting] = useState(false);
  const trialLock = useRef(false);
  const scope = `draft:${candidateKey}:${resetRevision}`;
  const trialViews = trialState.program?.canvas?.views ?? [];
  const hasControls = trialViews.some(descriptor => descriptor.kind === 'controls' && descriptor.controls.length > 0);
  const hasDraggableShapes = trialViews.some(descriptor => descriptor.kind === 'scene' && descriptor.elements.some(element => element.drag));
  const trialBusy = busy ?? (trialCommitting ? 'table.trial' : null);
  useEffect(() => () => clearGeneratedCanvasPreview(view, scope), [view.id, view.epoch, view.actor.actorId, view.actor.role, view.actor.seat, scope]);
  const trialView = useMemo<WorkspaceView>(() => ({
    ...view,
    revision: `${view.revision}:draft:${trialState.dataRevision}:${trialState.ruleRevision}:${trialState.actionRevision}`,
    domain: trialState,
  }), [view, trialState]);
  const sandboxCommand = useCallback<Command>(async (type, payload) => {
    if (type !== 'table.act') return null;
    if (busy !== null || trialLock.current) throw new Error('Finish the current table update before using the private trial.');
    trialLock.current = true;
    setTrialCommitting(true);
    try {
      const result = handleTableCommand(structuredClone(trialState), type, payload, localSandboxActor(view));
      if (!result || result.state.kind !== 'table') return null;
      setTrialState(result.state);
      return {
        ...trialView,
        revision: `${view.revision}:draft:${result.state.dataRevision}:${result.state.ruleRevision}:${result.state.actionRevision}`,
        domain: result.state,
      };
    } finally { trialLock.current = false; setTrialCommitting(false); }
  }, [busy, trialState, trialView, view]);
  const resetTrial = () => {
    clearGeneratedCanvasPreview(view, scope);
    setTrialState(structuredClone(initialState));
    setResetRevision(value => value + 1);
  };

  return <section className="tt-generated-preview" aria-label="Proposed generated canvas preview">
    <div className="tt-generated-preview__header"><span className="tt-kicker">VISUAL PREVIEW · PRIVATE TRIAL</span><button type="button" className="tt-button tt-button--quiet" disabled={trialBusy !== null} onClick={resetTrial}>Reset trial</button></div>
    <p className="tt-canvas-inline__note">{hasControls || hasDraggableShapes ? `Try ${[hasControls ? 'the controls' : '', hasDraggableShapes ? 'dragging marked shapes' : ''].filter(Boolean).join(' and ')}. ` : 'Review the generated view. '}Trial changes stay in this private copy; the active table is unchanged. Reset the trial at any time.</p>
    <div className="tt-generated-preview__views">{trialViews.map((descriptor) => <GeneratedCanvasObject key={`${descriptor.id}:${scope}`} view={trialView} state={trialState} descriptor={descriptor} busy={trialBusy} onCommand={async () => null} previewOnly sandboxCommand={sandboxCommand} previewScope={scope} />)}</div>
  </section>;
}

function localSandboxActor(view: WorkspaceView): ActorContext {
  return {
    actorId: view.actor.actorId,
    name: view.actor.name,
    role: view.actor.role === 'owner' ? 'owner' : 'participant',
    ...(view.actor.seat ? { seat: view.actor.seat } : {}),
    workspaceId: view.id,
    epoch: view.epoch,
    now: Date.now(),
    hash: value => JSON.stringify(value),
  };
}

type RuleRemoval = { kind: 'action' | 'invariant' | 'view' | 'collection' | 'compute'; id: string; title: string };

function RemoveRuleButton({ removal, onRemove }: { removal: RuleRemoval; onRemove?: (removal: RuleRemoval) => void }) {
  if (!onRemove) return null;
  return <button type="button" className="tt-table-rule-remove" aria-label={`Remove ${removal.title}`} title="Remove from the rules" onClick={() => onRemove(removal)}><Trash2 size={13} /></button>;
}

function RuleBadgeMark({ badge }: { badge?: RuleBadge }) {
  if (!badge) return null;
  return <span className={`tt-rule-badge tt-rule-badge--${badge}`}>{badge === 'new' ? 'New' : badge === 'changed' ? 'Edited' : 'Removed'}</span>;
}

/** The Rules card keeps abilities, checks, tables, calculations, and views together. */
function ProgramOverview({ program, state, label, change, members, onRemove, diff = null, view, busy = null, onCommand, onEditRules, interactive = false }: { program: TableProgram; state: TableState; label: string; change?: TableChange; members?: WorkspaceView['members']; onRemove?: (removal: RuleRemoval) => void; diff?: ProgramDiff | null; view?: WorkspaceView; busy?: string | null; onCommand?: WorkbenchProps['onCommand']; onEditRules?: (prompt?: string) => void; interactive?: boolean }) {
  const sources = new Map(state.sources.map((source) => [source.id, source.filename]));
  const evidence = program.evidence ?? [];
  const views = program.canvas?.views ?? [];
  const canEditRules = Boolean(interactive && onEditRules && view && viewerCan(view, 'rules.draft'));
  // A proposal already states its size in the change line; repeating the counts
  // right under it is the kind of noise this card is meant to lose.
  const changeLine = diff ? describeProgramDiff(diff) : '';
  return <section className="tt-table-program" aria-label={label}>
    {changeLine ? null : <p className="tt-table-program__summary"><span><strong>{program.actions.length + (program.compute?.modules.length ?? 0)}</strong> {program.actions.length + (program.compute?.modules.length ?? 0) === 1 ? 'ability' : 'abilities'}</span><span><strong>{program.collections.length}</strong> {program.collections.length === 1 ? 'table' : 'tables'}</span><span><strong>{program.invariants.length}</strong> {program.invariants.length === 1 ? 'check' : 'checks'}</span></p>}
    {program.description && <p className="tt-table-program__description">{program.description}</p>}

    <details className="tt-table-rule-details" open>
      <summary>Ways to use this table · {program.actions.length}</summary>
      {program.actions.length === 0
        ? <p className="tt-table-inline-hint">No action buttons yet. Describe an action people can use on this table.</p>
        : program.actions.map((action) => <ActionDefinition key={action.id} action={action} program={program} members={members} onRemove={onRemove} badge={ruleBadge(diff, 'action', action.id)} interactive={interactive} canEdit={canEditRules} onEditRules={onEditRules} />)}
    </details>

    {program.invariants.length > 0 && <details className="tt-table-rule-details" open>
      <summary>Checks before saving · {program.invariants.length}</summary>
      <ul className="tt-table-check-list">{program.invariants.map((invariant) => <li key={invariant.id}>
        <div className="tt-table-check-list__body"><strong>{invariant.message}</strong><small>Checks {onLabel(program, invariant.collection)} · {invariant.fields.map((fieldId) => fieldLabel(program, invariant.collection, fieldId)).join(', ')}</small></div>
        <RuleBadgeMark badge={ruleBadge(diff, 'check', invariant.id)} />
        <RemoveRuleButton removal={{ kind: 'invariant', id: invariant.id, title: invariant.message }} onRemove={onRemove} />
        {interactive && <RuleChatActions kind="check" id={invariant.id} title={invariant.message} detail={`data check; ${invariant.message}; applies to ${onLabel(program, invariant.collection)}`} canEdit={canEditRules} onEdit={onEditRules} />}
      </li>)}</ul>
    </details>}

    <details className="tt-table-rule-details">
      <summary>Tables and their fields · {program.collections.length}</summary>
      {program.collections.map((collection) => <CollectionDefinition key={collection.id} collection={collection} onRemove={onRemove} badge={ruleBadge(diff, 'table', collection.id)} interactive={interactive} canEdit={canEditRules} onEditRules={onEditRules} />)}
    </details>

    {interactive && (state.computedColumns ?? []).filter((column) => program.collections.some((collection) => collection.id === column.collection)).length > 0 && <details className="tt-table-rule-details">
      <summary>Calculated fields · {(state.computedColumns ?? []).filter((column) => program.collections.some((collection) => collection.id === column.collection)).length}</summary>
      {(state.computedColumns ?? []).filter((column) => program.collections.some((collection) => collection.id === column.collection)).map((column) => <section className="tt-table-program__group" key={column.id}>
        <header className="tt-rule-head"><h4>{column.label}</h4></header>
        <p className="tt-rule-description">Updates from each row in {onLabel(program, column.collection)}.</p>
        <details className="tt-compute-advanced"><summary>Formula details</summary><code>{formatComputedExpression(column.expression)}</code></details>
        <RuleChatActions kind="formula" id={column.id} title={column.label} detail={`calculated field; ${column.label}; collection ${onLabel(program, column.collection)}; formula ${formatComputedExpression(column.expression)}`} canEdit={canEditRules} onEdit={onEditRules} />
      </section>)}
    </details>}

    {views.length > 0 && <details className="tt-table-rule-details"><summary>Views · {views.length}</summary><ul className="tt-table-view-list">{views.map((descriptor) => <li key={descriptor.id}><span><strong>{descriptor.title}</strong><small>A {descriptor.kind} view of this table</small></span><RuleBadgeMark badge={ruleBadge(diff, 'view', descriptor.id)} /><RemoveRuleButton removal={{ kind: 'view', id: descriptor.id, title: descriptor.title }} onRemove={onRemove} />{interactive && <RuleChatActions kind="view" id={descriptor.id} title={descriptor.title} detail={`canvas view; ${descriptor.title}; ${descriptor.kind}`} canEdit={canEditRules} onEdit={onEditRules} />}</li>)}</ul></details>}

    {program.compute?.modules.length ? <details className="tt-table-rule-details tt-compute-modules" open>
      <summary>Calculations · {program.compute.modules.length}</summary>
      <p className="tt-table-inline-hint">Reusable calculations can power more than one rule or table card. Their latest results stay connected to this table.</p>
      {view && onCommand ? program.compute.modules.map((module) => <TableComputeModuleCard key={module.id} module={module} program={program} state={state} view={view} busy={busy} onCommand={onCommand} onEditRules={onEditRules} onRemove={onRemove} interactive={interactive} />) : null}
    </details> : null}

    {program.turnOrder.length > 0 && <p className="tt-table-turn-order">Turn order: {program.turnOrder.map((seat) => seat === 'host' ? 'Owner' : seat.replace('member-', 'Member ')).join(' → ')}</p>}
    {change && program.collections.filter((collection) => (change.initialRecords[collection.id] ?? []).length > 0).map((collection) => <ProposedRecords key={`proposed-${collection.id}`} collection={collection} records={change.initialRecords[collection.id] ?? []} members={members} />)}
    {evidence.length > 0 && <details className="tt-table-rule-details"><summary>Source evidence · {evidence.length}</summary><ul>{evidence.map((item, index) => <li key={`${item.sourceId}-${index}`}><strong>{sources.get(item.sourceId) ?? 'Source file'}</strong><blockquote>{item.quote}</blockquote></li>)}</ul></details>}
    {program.assumptions.length > 0 && <section className="tt-table-assumptions"><h4>Assumptions to review</h4><ul>{program.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul><p>Structural checks do not confirm these assumptions match your policy. The owner should review them and the cited evidence before approval.</p></section>}
    {program.assumptions.length === 0 && label === 'Proposed rules' && <p className="tt-table-owner-review">Structural checks do not confirm source-policy fit. The owner should review the cited evidence before approval.</p>}
    {change && <p className="tt-canvas-inline__note">{Object.values(change.initialRecords).reduce((sum, rows) => sum + rows.length, 0)} starting rows in this proposal. Active records remain unchanged until activation.</p>}
  </section>;
}

/** The table a rule points at, by the name people see on the canvas. */
function onLabel(program: TableProgram, collectionId: string): string {
  return program.collections.find((collection) => collection.id === collectionId)?.title ?? collectionId;
}

function CollectionDefinition({ collection, onRemove, badge, interactive = false, canEdit = false, onEditRules }: { collection: TableCollection; onRemove?: (removal: RuleRemoval) => void; badge?: RuleBadge; interactive?: boolean; canEdit?: boolean; onEditRules?: (prompt?: string) => void }) {
  return <section className="tt-table-program__group"><header className="tt-rule-head"><h4>{collection.title}</h4><RuleBadgeMark badge={badge} /><RemoveRuleButton removal={{ kind: 'collection', id: collection.id, title: collection.title }} onRemove={onRemove} /></header><ul className="tt-table-field-list">{collection.fields.map((field) => <li key={field.id}><strong>{field.label}</strong><span>{fieldTypeLabel(field)}{field.required ? ' · needed' : ''}{field.min !== undefined ? ` · min ${field.min}` : ''}{field.max !== undefined ? ` · max ${field.max}` : ''}{field.choices?.length ? ` · ${field.choices.join(', ')}` : ''}</span></li>)}</ul>{interactive && <RuleChatActions kind="table" id={collection.id} title={collection.title} detail={`table fields; ${collection.title}; ${collection.fields.map((field) => `${field.label} (${fieldTypeLabel(field)})`).join(', ')}`} canEdit={canEdit} onEdit={onEditRules} />}</section>;
}

function ActionDefinition({ action, program, members, onRemove, badge, interactive = false, canEdit = false, onEditRules }: { action: TableAction; program: TableProgram; members?: WorkspaceView['members']; onRemove?: (removal: RuleRemoval) => void; badge?: RuleBadge; interactive?: boolean; canEdit?: boolean; onEditRules?: (prompt?: string) => void }) {
  const effects = action.effects.map((effect) => {
    const param = action.parameters.find((item) => item.id === effect.record);
    const collection = param?.collection;
    const target = collection ? `${onLabel(program, collection)} · ${fieldLabel(program, collection, effect.field)}` : (param?.label ?? 'The selected row');
    const written = collection ? fieldLabel(program, collection, effect.field) : '';
    // F081: a toggle has no value; it flips the yes/no field.
    if (effect.op === 'toggle') return `${target} switches between yes and no`;
    // "Completion note becomes Completion note" is noise: say what the person supplies instead.
    let value: string;
    if ('input' in effect.value) {
      const inputId = effect.value.input;
      const supplied = action.parameters.find((item) => item.id === inputId);
      value = supplied && supplied.label !== written ? `the ${supplied.label} you type` : 'what you type';
    } else {
      value = operandLabel(effect.value, action, program, members);
    }
    return `${target} ${effect.op === 'add' ? 'gains' : 'becomes'} ${value}`;
  });
  // What the rule touches: the tables whose rows it changes, with the fields it writes.
  const targets = new Map<string, Set<string>>();
  const noteTarget = (collectionId: string, fieldId?: string) => {
    const title = onLabel(program, collectionId);
    const fields = targets.get(title) ?? new Set<string>();
    if (fieldId) fields.add(fieldLabel(program, collectionId, fieldId));
    targets.set(title, fields);
  };
  for (const effect of action.effects) {
    const param = action.parameters.find((item) => item.id === effect.record);
    if (param?.collection) noteTarget(param.collection, effect.field);
  }
  for (const create of action.creates ?? []) noteTarget(create.collection);
  const appliesTo = targets.size === 0
    ? 'no shared records'
    : [...targets].map(([title, fields]) => fields.size ? `${title} · ${[...fields].join(', ')}` : title).join(' · ');
  const who = action.roles.includes('owner') && action.roles.includes('participant') ? 'everyone at this table' : action.roles.includes('owner') ? 'the owner' : 'members';
  const flags = action.advanceTurn ? 'Passes the turn to the next player.' : '';
  const whenClauses = action.conditions.map((condition) => `${operandLabel(condition.left, action, program, members)} ${conditionOperator(condition.op)} ${operandLabel(condition.right, action, program, members)}`);
  if (action.requireTurn) whenClauses.push('it is the current turn');
  const when = whenClauses.length > 0 ? whenClauses.join(' and ') : 'someone chooses this rule';
  const behavior = `When ${when}, it ${effects.length > 0 ? effects.join('; ') : 'does not change shared records'}.`;
  const explanation = action.description.trim() || (targets.size > 0 ? `Updates ${[...targets.keys()].join(' and ')} when chosen.` : 'Checks the information before the action can continue.');
  return <section className="tt-table-program__group">
    <header className="tt-rule-head"><h4>{action.title}</h4><RuleBadgeMark badge={badge} /><RemoveRuleButton removal={{ kind: 'action', id: action.id, title: action.title }} onRemove={onRemove} /></header>
    <p className="tt-rule-description">{explanation}</p>
    <p className="tt-rule-meta">For {who} · affects {appliesTo}{flags ? ` · ${flags}` : ''}</p>
    <details className="tt-rule-failure-details"><summary>How this rule works</summary>
      <p className="tt-rule-behavior">{behavior}</p>
      {action.conditions.length > 0 && <><p className="tt-rule-meta">If something does not match</p><ul>{action.conditions.map((condition, index) => <li key={index}>{condition.message}</li>)}</ul></>}
    </details>
    {interactive && <RuleChatActions kind="action" id={action.id} title={action.title} detail={`table rule; ${action.title}; ${action.description || behavior}; changes ${appliesTo}`} canEdit={canEdit} onEdit={onEditRules} />}
  </section>;
}

function ProposedRecords({ collection, records, members }: { collection: TableCollection; records: TableRecord[]; members?: WorkspaceView['members'] }) {
  return <details className="tt-table-proposed-records"><summary>Proposed starting rows · {collection.title} · {records.length}</summary>
    {records.length === 0 ? <p>No new rows in this proposal. Existing records stay unchanged.</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid"><caption>New {collection.title} rows in this proposal</caption><thead><tr>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead><tbody>{records.map((row) => <tr key={row.id}>{collection.fields.map((field) => <td key={field.id}>{displayValue(row.values[field.id], members)}</td>)}</tr>)}</tbody></table></div>}
  </details>;
}

/** F081: rows a collapsed checklist card shows before pointing at the full card. */
const CHECKLIST_PREVIEW_ROWS = 8;

function TableCollectionView({ view, state, node, busy, onCommand, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const collectionId = node.id.slice('table.collection.'.length);
  const collection = state.program?.collections.find((item) => item.id === collectionId);
  const rows = (node.inputs.rows as TableRecord[] | undefined) ?? state.records[collectionId] ?? [];
  const fixedRecordIds = fixedProgramRecordIds(state.program, collectionId);
  const computeWriter = state.program?.compute?.modules.some((module) => module.outputs.some((output) => output.type === 'table' && output.collectionId === collectionId)) ?? false;
  const hasCalculatedRows = hasLinkedComputeOutput(collectionId, state);
  const computed = (state.computedColumns ?? []).filter((column) => column.collection === collectionId);
  // F055: prefer the authority's numbers for the state on screen; a local candidate preview
  // (different dataRevision) falls back to the same bounded evaluator.
  const serverValues = state.computedValues?.revision === state.dataRevision ? state.computedValues.values : undefined;
  const actionController = useTableActionController(view, onCommand);
  const contextId = useId().replace(/:/g, '');
  const actionSelectId = `${contextId}-tt-table-record-action`;
  // F081: yes/no fields are checkboxes that run the rule which toggles (or sets) that field for the row.
  const checkRole = view.actor.role === 'owner' ? 'owner' : 'participant';
  const [checking, setChecking] = useState<string | null>(null);
  const checkbox = (row: TableRecord, field: TableField) => {
    const checked = row.values[field.id] === true;
    const match = checkboxAction(state.program?.actions ?? [], collectionId, field.id, row.values[field.id], checkRole);
    const label = `${field.label}: ${recordSummary(row, collection, view.members, { omitYesNo: true })}`;
    const toggle = async () => {
      if (!match || busy !== null || checking) return;
      setChecking(`${row.id}.${field.id}`);
      try { await onCommand('table.act', { actionId: match.action.id, inputs: { [match.parameterId]: row.id } }); }
      finally { setChecking(null); }
    };
    return <input type="checkbox" className="tt-table-checkbox nodrag" checked={checked} aria-label={label}
      title={match ? match.action.title : checkboxUnavailableReason(checked)}
      disabled={!match || busy !== null || checking !== null} onChange={() => void toggle()} />;
  };
  // A collapsed card reads as a checklist only when a yes/no field can be ticked both ways (a toggle, or a pair of
  // set rules); a field changed by other means (e.g. equipment availability) keeps the plain preview.
  const checkField = collection?.fields.find((field) => field.type === 'boolean'
    && checkboxAction(state.program?.actions ?? [], collectionId, field.id, false, checkRole) !== null
    && checkboxAction(state.program?.actions ?? [], collectionId, field.id, true, checkRole) !== null);
  const parameterSelectId = `${contextId}-tt-table-record-parameter`;
  const [selectedRecordId, setSelectedRecordId] = useState('');
  const [selectedActionId, setSelectedActionId] = useState('');
  const [selectedParameterId, setSelectedParameterId] = useState('');
  const currentActorRole = view.actor.role === 'owner' ? 'owner' : 'participant';
  const selectedRecord = rows.find((row) => row.id === selectedRecordId);
  const collectionActions = (state.program?.actions ?? []).filter((action) => action.parameters.some((parameter) => parameter.type === 'record' && parameter.collection === collectionId));
  const eligibleActions = collectionActions.filter((action) => action.roles.includes(currentActorRole));
  const selectedAction = selectedRecord ? eligibleActions.find((action) => action.id === selectedActionId) : undefined;
  const selectedActionRecordParameters = selectedAction?.parameters.filter((parameter) => parameter.type === 'record' && parameter.collection === collectionId) ?? [];

  useEffect(() => {
    setSelectedRecordId('');
    setSelectedActionId('');
    setSelectedParameterId('');
  }, [view.id, view.epoch, view.actor.actorId, collectionId]);

  const chooseRecord = (recordId: string) => {
    const nextRecordId = selectedRecordId === recordId ? '' : recordId;
    setSelectedRecordId(nextRecordId);
    if (!nextRecordId) {
      setSelectedActionId('');
      setSelectedParameterId('');
    }
    if (selectedAction) actionController.setRecordSelection(selectedAction.id, selectedActionRecordParameters.map((parameter) => parameter.id), nextRecordId ? selectedParameterId : '', nextRecordId);
  };

  const chooseAction = (actionId: string) => {
    const action = eligibleActions.find((item) => item.id === actionId);
    const recordParameters = action?.parameters.filter((parameter) => parameter.type === 'record' && parameter.collection === collectionId) ?? [];
    const prefillParameterId = recordParameters.length === 1 ? recordParameters[0].id : '';
    setSelectedActionId(actionId);
    setSelectedParameterId(prefillParameterId);
    if (action && selectedRecord) actionController.setRecordSelection(action.id, recordParameters.map((parameter) => parameter.id), prefillParameterId, selectedRecord.id);
  };

  const chooseRecordParameter = (parameterId: string) => {
    setSelectedParameterId(parameterId);
    if (selectedAction && selectedRecord) actionController.setRecordSelection(selectedAction.id, selectedActionRecordParameters.map((parameter) => parameter.id), parameterId, selectedRecord.id);
  };

  return <div className="tt-canvas-inline tt-table-collection">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">SHARED RECORDS</span><strong>{collection?.title ?? node.title}</strong><small>{rows.length} {rows.length === 1 ? 'record' : 'records'} · data r{state.dataRevision}</small></div>
    {collection && <LinkedComputeOutputs collectionId={collectionId} state={state} view={view} expanded={expanded} />}
    {expanded && collection && viewerCan(view, 'data.columns') && <TableComputedColumns collection={collection} state={state} busy={busy} onCommand={onCommand} />}
    {expanded && collection && viewerCan(view, 'data.import') && !computeWriter && <TableRowImport collection={collection} existingRecords={state.records[collectionId] ?? []} fixedRecordIds={fixedRecordIds} busy={busy} onCommand={onCommand} />}
    {expanded && collection && computeWriter && <p className="tt-table-readonly-inline" role="status">This table is filled by a calculation. Run it from Rules to refresh these results; rows cannot be imported directly here.</p>}
    {!expanded && collection && checkField && rows.length > 0 ? <ul className="tt-table-checklist tt-table-collection__preview" aria-label={`${collection.title} checklist`}>
      {rows.slice(0, CHECKLIST_PREVIEW_ROWS).map((row) => <li key={row.id} className={row.values[checkField.id] === true ? 'is-done' : undefined}>
        <label>{checkbox(row, checkField)}<span>{recordSummary(row, collection, view.members, { omitYesNo: true })}</span></label>
      </li>)}
      {rows.length > CHECKLIST_PREVIEW_ROWS && <li className="tt-table-checklist__more">+{rows.length - CHECKLIST_PREVIEW_ROWS} more — open the card to see all</li>}
    </ul> : !expanded ? <div className="tt-table-collection__preview">{rows.slice(0, 2).map((row) => <span key={row.id}>{collection?.fields.slice(0, 2).map((field) => `${field.label}: ${displayValue(row.values[field.id], view.members)}`).join(' · ') || displayValue(row.id, view.members)}</span>)}{rows.length === 0 && !hasCalculatedRows && <p className="tt-canvas-inline__note">No records yet.</p>}</div> : !collection ? <p className="tt-canvas-inline__empty">This collection is not in the active table rules.</p> : rows.length === 0 ? <p className="tt-canvas-inline__empty">{hasCalculatedRows ? 'No source records are available. Calculated results are shown above.' : 'No records are available in this collection.'}</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid tt-table-record-grid"><caption>{collection.title} · shared records</caption><thead><tr><th scope="col"><span className="tt-visually-hidden">Select a record</span></th>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}{computed.map((column) => <th scope="col" key={column.id}>{column.label} <span className="tt-table-computed-badge">calculated</span></th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={row.id === selectedRecordId ? 'is-selected' : undefined}><td><button type="button" className="tt-table-record-select" aria-label={`${row.id === selectedRecordId ? 'Deselect' : 'Select'} ${recordLabel(row, collection, view.members)}`} aria-pressed={row.id === selectedRecordId} disabled={busy !== null} onClick={() => chooseRecord(row.id)}>{row.id === selectedRecordId ? 'Selected' : 'Select'}</button></td>{collection.fields.map((field) => <td key={field.id}>{field.type === 'boolean' ? checkbox(row, field) : displayValue(row.values[field.id], view.members)}</td>)}{computed.map((column) => { const serverRow = serverValues?.[collectionId]?.[row.id]; const value = serverRow && column.id in serverRow ? serverRow[column.id] : computeRecordRow(computed, collectionId, row)[column.id]; return <td key={column.id}>{formatComputed(value)}</td>; })}</tr>)}</tbody></table></div>}
    {expanded && selectedRecord && <section className="tt-table-record-actions" aria-label={`Actions for ${recordLabel(selectedRecord, collection, view.members)}`}>
      <div><strong>{recordLabel(selectedRecord, collection, view.members)}</strong></div>
      {eligibleActions.length === 0 ? <p className="tt-canvas-inline__note">{collectionActions.length === 0 ? 'No table actions use this collection.' : `Actions for this collection are limited to ${formatActionRoles(collectionActions)}.`}</p> : <>
        <label htmlFor={actionSelectId}>Action<select id={actionSelectId} value={selectedActionId} disabled={busy !== null} onChange={(event) => chooseAction(event.target.value)}><option value="">Choose an action…</option>{eligibleActions.map((action) => <option value={action.id} key={action.id}>{action.title}</option>)}</select></label>
        {selectedAction && selectedActionRecordParameters.length > 1 && <label htmlFor={parameterSelectId}>Use this record as<select id={parameterSelectId} value={selectedParameterId} disabled={busy !== null} onChange={(event) => chooseRecordParameter(event.target.value)}><option value="">Choose a record field…</option>{selectedActionRecordParameters.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label}</option>)}</select></label>}
        {selectedAction && (selectedActionRecordParameters.length === 1 || selectedParameterId) && <ActionForm view={view} action={selectedAction} state={state} currentSeat={view.actor.seat ?? 'host'} members={view.members} busy={busy} values={actionController.values[selectedAction.id] ?? {}} onUpdate={actionController.update} onSubmit={actionController.submit} onRoll={actionController.roll} />}
        {selectedAction && selectedActionRecordParameters.length > 1 && !selectedParameterId && <p className="tt-table-inline-hint">This action uses multiple records from this collection. Choose which record field should use the selected row.</p>}
      </>}
      {actionController.message && <p className="tt-table-error" role="alert">{actionController.message}</p>}
    </section>}
    <p className="tt-table-turn-indicator">{view.actor.role === 'owner' ? 'Owner' : view.actor.name} · shared active data</p>
  </div>;
}

interface ComputedDraft { id?: string; label: string; formula: string }

function TableComputedColumns({ collection, state, busy, onCommand }: {
  collection: TableCollection;
  state: TableState;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
}) {
  const numericFields = collection.fields.filter((field) => field.type === 'number');
  const programColumnIds = new Set((state.program?.computedColumns ?? []).map((column) => column.id));
  const programColumns = (state.program?.computedColumns ?? []).filter((column) => column.collection === collection.id);
  const legacyColumns = (state.computedColumns ?? []).filter((column) => !programColumnIds.has(column.id));
  const existing = legacyColumns.filter((column) => column.collection === collection.id);
  const otherCollectionColumns = legacyColumns.filter((column) => column.collection !== collection.id);
  const availableColumns = Math.max(0, MAX_COMPUTED_COLUMNS - programColumnIds.size - otherCollectionColumns.length);
  const [open, setOpen] = useState(false);
  const [drafts, setDrafts] = useState<ComputedDraft[]>([]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const sectionRef = useRef<HTMLElement>(null);
  // The editor sits near the bottom of a long card; bring it into view when it opens.
  useEffect(() => { if (open) sectionRef.current?.scrollIntoView({ block: 'nearest' }); }, [open]);
  const defaultFormula = numericFields[0] ? `${numericFields[0].id} + 0` : '0';
  const start = () => {
    setDrafts(existing.map((column) => ({ id: column.id, label: column.label, formula: formatComputedExpression(column.expression) })));
    setMessage(''); setOpen(true);
  };
  const update = (index: number, patch: Partial<ComputedDraft>) => setDrafts((current) => current.map((item, at) => at === index ? { ...item, ...patch } : item));
  const save = async () => {
    if (drafts.length > availableColumns) {
      setMessage(`This table has room for ${availableColumns} computed column${availableColumns === 1 ? '' : 's'} you can edit here.`);
      return;
    }
    const columns: ComputedColumn[] = [...otherCollectionColumns];
    const usedIds = new Set([
      ...programColumnIds,
      ...otherCollectionColumns.map((column) => column.id),
      ...drafts.flatMap((draft) => draft.id ? [draft.id] : []),
    ]);
    for (const [index, draft] of drafts.entries()) {
      const parsed = parseComputedFormula(draft.formula, collection.fields.map((field) => ({ id: field.id, type: field.type })));
      if (!parsed.ok) { setMessage(`Formula ${index + 1}: ${parsed.error}`); return; }
      let id = draft.id;
      if (!id) {
        let suffix = 1;
        while (usedIds.has(`calc${suffix}`)) suffix += 1;
        id = `calc${suffix}`;
      }
      usedIds.add(id);
      columns.push({ id, collection: collection.id, label: draft.label.trim() || `Calculated ${index + 1}`, expression: parsed.expression });
    }
    setPending(true); setMessage('');
    try {
      const result = await onCommand('table.setComputedColumns', { columns });
      if (result) { setMessage(`Saved ${drafts.length} computed column${drafts.length === 1 ? '' : 's'} for ${collection.title}.`); setOpen(false); }
      else setMessage('The computed columns were rejected. Check the formula and its fields.');
    } finally { setPending(false); }
  };
  if (collection.fields.length === 0) return null;
  const visibleColumnCount = programColumns.length + existing.length;
  return <section ref={sectionRef} className="tt-table-computed" aria-label={`Computed columns for ${collection.title}`}>
    {!open ? <button type="button" className="tt-button tt-button--quiet" disabled={busy !== null} onClick={start}>{visibleColumnCount ? `Computed columns (${visibleColumnCount})` : 'Add computed column'}</button> : <>
      <div className="tt-table-computed__head"><strong>Computed columns</strong><button type="button" className="tt-button tt-button--quiet" onClick={() => setOpen(false)}>Close</button></div>
      {programColumns.length > 0 && <section className="tt-table-readonly-inline" aria-label="Rule-owned formulas">
        <p className="tt-table-inline-hint"><strong>These formulas are part of your rules.</strong> Open the Rules card, then Calculated fields → Change this rule to edit them.</p>
        {programColumns.map((column) => <div className="tt-table-computed__row" key={column.id}>
          <strong>{column.label}</strong><code>{formatComputedExpression(column.expression)}</code>
        </div>)}
      </section>}
      {drafts.length === 0 && <p className="tt-table-inline-hint">You have not added any extra computed columns here.</p>}
      {drafts.map((draft, index) => <div className="tt-table-computed__row" key={draft.id ?? `new-${index}`}>
        <label>Label<input value={draft.label} maxLength={40} placeholder={`Calculated ${index + 1}`} onChange={(event) => update(index, { label: event.target.value })} /></label>
        <label>Formula<input value={draft.formula} placeholder={defaultFormula} spellCheck={false} autoComplete="off" onChange={(event) => update(index, { formula: event.target.value })} /></label>
        <button type="button" className="tt-button tt-button--quiet" disabled={pending} onClick={() => setDrafts((current) => current.filter((_, at) => at !== index))}>Remove</button>
      </div>)}
      <p className="tt-table-inline-hint">Fields: {collection.fields.map((field) => `${field.id} (${field.type})`).join(' · ')}<br />Functions: IF, CEIL, FLOOR, ABS, ROUND, MIN, MAX, AND, OR. Example: IF(goods_total &gt;= 5000, 0, IF(zone = &quot;BKK&quot;, 35, 45) + IF(weight_kg &gt; 3, CEIL(weight_kg - 3) * 10, 0))</p>
      <div className="tt-table-computed__actions">
        <button type="button" className="tt-button tt-button--quiet" disabled={pending || drafts.length >= availableColumns} onClick={() => setDrafts((current) => [...current, { label: '', formula: defaultFormula }])}>Add row</button>
        <button type="button" className="tt-button tt-button--primary" disabled={pending || busy !== null || drafts.length > availableColumns} onClick={() => void save()}>{pending ? 'Saving…' : 'Save computed columns'}</button>
      </div>
      {message && <p className="tt-table-inline-hint" role="status">{message}</p>}
    </>}
  </section>;
}

function TableRowImport({ collection, existingRecords, fixedRecordIds, busy, onCommand }: {
  collection: TableCollection;
  existingRecords: TableRecord[];
  fixedRecordIds: string[];
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
}) {
  const existingRows = existingRecords.length;
  const [open, setOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [worksheet, setWorksheet] = useState<ReturnType<typeof worksheetToCsvTable> | null>(null);
  const [fileName, setFileName] = useState('');
  const parsed = useMemo(() => worksheet ?? parseCsv(csv), [worksheet, csv]);
  const [mapping, setMapping] = useState<Record<number, string>>({});
  const [identityField, setIdentityField] = useState('');
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append');
  const [replaceConfirmed, setReplaceConfirmed] = useState(false);
  const [readingFile, setReadingFile] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const detailId = `${useId().replace(/:/g, '')}-tt-import`;
  useEffect(() => { setMapping(autoMapping(parsed.headers, collection.fields)); setIdentityField(''); setReplaceConfirmed(false); }, [parsed, collection]);
  const preview = useMemo(() => buildImportRows(parsed, mapping, collection.fields), [parsed, mapping, collection]);
  const identityCandidates = useMemo(() => requiredTextIdentityCandidates(
    collection.fields,
    existingRecords,
    preview.rows,
    new Set(Object.values(mapping)),
  ), [collection.fields, existingRecords, preview.rows, mapping]);
  useEffect(() => {
    if (fixedRecordIds.length > 0 && !identityField && identityCandidates.length === 1) setIdentityField(identityCandidates[0]!.id);
  }, [fixedRecordIds.length, identityField, identityCandidates]);
  const identityMatch = identityField ? matchRowsByIdentity(existingRecords, preview.rows, identityField) : undefined;
  const missingFixedRecords = identityMatch?.ok
    ? fixedRecordIds.filter(recordId => !identityMatch.matchedRecordIds.includes(recordId))
    : [];
  const identityReady = identityMatch?.ok === true && missingFixedRecords.length === 0;
  const hasHeaders = parsed.headers.some((header) => header.length > 0);
  const enoughRows = importMode === 'replace' ? hasHeaders : preview.rows.length > 0;
  const linkedRowsReady = importMode !== 'replace' || fixedRecordIds.length === 0 || (identityField.length > 0 && identityReady);
  const canImport = enoughRows && preview.rows.length <= 100 && preview.invalid.length === 0 && linkedRowsReady && (importMode !== 'replace' || replaceConfirmed) && busy === null && !pending && !readingFile;
  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const fileInput = event.currentTarget;
    setMessage(''); setCsv(''); setWorksheet(null); setFileName(''); setReplaceConfirmed(false); setOpen(true);
    if (file.size > TABLE_FILE_BYTES) { setMessage('Files must be 32 KiB or smaller.'); fileInput.value = ''; return; }
    setReadingFile(true);
    try {
      if (/\.xlsx$/iu.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        const firstWorksheet = await readSheet(file, 0);
        const table = worksheetToCsvTable(firstWorksheet);
        if (!table.headers.some((header) => header.length > 0)) throw new Error('The first worksheet needs a header row.');
        setWorksheet(table);
      } else if (/\.csv$/iu.test(file.name) || file.type === 'text/csv' || file.type === 'text/plain') {
        setCsv(await file.text());
      } else {
        throw new Error('Choose a .csv or .xlsx file.');
      }
      setFileName(file.name);
    } catch (error) {
      setMessage(error instanceof Error && error.message === 'The first worksheet needs a header row.'
        ? error.message
        : 'This file could not be read. Use a valid .csv or .xlsx file.');
    } finally {
      setReadingFile(false);
      fileInput.value = '';
    }
  };
  const runImport = async () => {
    setPending(true); setMessage('');
    try {
      const result = await onCommand('table.importRows', {
        collection: collection.id,
        rows: preview.rows,
        mode: importMode,
        ...(importMode === 'replace' && identityField ? { identityField } : {}),
      });
      if (result) {
        setMessage(importMode === 'replace'
          ? preview.rows.length === 0 ? `Removed all rows from ${collection.title}.` : `Replaced ${existingRows} rows with ${preview.rows.length} rows in ${collection.title}.`
          : `Added ${preview.rows.length} rows to ${collection.title}.`);
        setCsv(''); setWorksheet(null); setFileName(''); setReplaceConfirmed(false);
      }
      else setMessage('Import failed. Fix the invalid rows and try again.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Import failed. Fix the invalid rows and try again.');
    } finally { setPending(false); }
  };
  return <section className="tt-table-import" aria-label={`Import rows into ${collection.title}`}>
    {!open ? <button type="button" className="tt-button tt-button--quiet" disabled={busy !== null} onClick={() => setOpen(true)}>Import rows</button> : <>
      <div className="tt-table-import__head"><strong>Import rows into {collection.title}</strong><button type="button" className="tt-button tt-button--quiet" onClick={() => { setOpen(false); setCsv(''); setWorksheet(null); setFileName(''); setMessage(''); setReplaceConfirmed(false); }}>Close</button></div>
      <label className="tt-table-import__file">Choose a CSV or Excel file<input type="file" accept=".csv,.xlsx,text/csv,text/plain,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={(event) => void chooseFile(event)} /></label>
      {fileName && <p className="tt-table-import__file-name">{fileName}{worksheet ? ' · first worksheet' : ' · CSV rows'}</p>}
      {readingFile && <p className="tt-table-import__summary" role="status">Reading file…</p>}
      <label htmlFor={detailId}>Or paste CSV<textarea id={detailId} rows={5} value={csv} placeholder={'sku,qty\nCAM-1,4'} onChange={(event) => { setWorksheet(null); setFileName(''); setCsv(event.target.value); setMessage(''); setReplaceConfirmed(false); }} aria-describedby={`${detailId}-summary`} /></label>
      {parsed.headers.length > 0 && <div className="tt-table-import__mapping">{parsed.headers.map((header, index) => <label key={`${index}-${header}`}>{header || `Column ${index + 1}`}<select value={mapping[index] ?? ''} onChange={(event) => { const value = event.target.value; setMapping((current) => ({ ...current, [index]: value })); setReplaceConfirmed(false); }}><option value="">Ignore</option>{collection.fields.map((field) => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>)}</div>}
      {hasHeaders && <fieldset className="tt-table-import__mode"><legend>What should happen to these rows?</legend>
        <label><input type="radio" name={`${detailId}-mode`} value="append" checked={importMode === 'append'} onChange={() => { setImportMode('append'); setReplaceConfirmed(false); }} /><span>Add rows · keep the current {existingRows} rows</span></label>
        <label><input type="radio" name={`${detailId}-mode`} value="replace" checked={importMode === 'replace'} onChange={() => { setImportMode('replace'); setReplaceConfirmed(false); }} /><span>Replace all {existingRows} current rows with {preview.rows.length} prepared rows</span></label>
      </fieldset>}
      <p id={`${detailId}-summary`} className="tt-table-import__summary" role="status">{preview.rows.length} {preview.rows.length === 1 ? 'row' : 'rows'} ready · {preview.invalid.length} invalid{preview.ignoredHeaders.length > 0 ? ` · ignored: ${preview.ignoredHeaders.join(', ')}` : ''}</p>
      {preview.invalid.length > 0 && <ul className="tt-table-error">{preview.invalid.slice(0, 3).map((item) => <li key={item.row}>Row {item.row}: {item.message}</li>)}</ul>}
      {preview.rows.length > 100 && <p className="tt-table-error" role="alert">Import at most 100 rows per command.</p>}
      {importMode === 'replace' && hasHeaders && <>
        {fixedRecordIds.length > 0 && <div className="tt-table-import__identity">
          <label htmlFor={`${detailId}-identity`}>Keep linked rows matched by<select id={`${detailId}-identity`} value={identityField} onChange={(event) => { setIdentityField(event.target.value); setReplaceConfirmed(false); }}>
            <option value="">Choose a text identity field…</option>
            {collection.fields.filter((field) => field.type === 'text').map((field) => <option key={field.id} value={field.id}>{field.label}{field.required ? ' · required' : ''}</option>)}
          </select></label>
          {identityCandidates.length === 1 && identityCandidates[0]?.id === identityField && <p className="tt-table-inline-hint" role="status">Suggested: {identityCandidates[0].label} has unique, nonempty values in the current and prepared rows.</p>}
          {identityField && identityMatch?.ok && identityReady && <p className="tt-table-inline-hint" role="status">Matching by {collection.fields.find((field) => field.id === identityField)?.label} keeps the IDs of {identityMatch.matchedRecordIds.length} matching rows so rules and controls keep targeting the same records. Unmatched imported rows get new IDs; unmatched current rows are removed.</p>}
          {identityField && identityMatch && !identityMatch.ok && <p className="tt-table-error" role="alert">{identityMatch.message}</p>}
          {identityField && identityMatch?.ok && missingFixedRecords.length > 0 && <p className="tt-table-error" role="alert">This replacement is missing the identity value for a row referenced by the rules. Include each referenced row or change the rules first.</p>}
          {!identityField && <p className="tt-table-inline-hint" role="status">Choose a text field with unique, nonempty values to preserve rows used by the rules.</p>}
        </div>}
        <p className="tt-table-import__replace-warning" role="status">This will replace {existingRows} existing rows in {collection.title} with {preview.rows.length} prepared rows. The import runs only after you confirm.</p>
        <label className="tt-table-import__confirm"><input type="checkbox" checked={replaceConfirmed} onChange={(event) => setReplaceConfirmed(event.target.checked)} /><span>Yes, replace all {existingRows} existing rows with these {preview.rows.length} rows{identityField && fixedRecordIds.length > 0 ? `, matching by ${collection.fields.find((field) => field.id === identityField)?.label}` : ''}.</span></label>
      </>}
      <button type="button" className="tt-button tt-button--primary" disabled={!canImport} onClick={() => void runImport()}>{pending || readingFile ? 'Preparing…' : importMode === 'replace' ? `Replace ${existingRows} rows with ${preview.rows.length}` : `Add ${preview.rows.length} rows`}</button>
      {message && <p className="tt-table-inline-hint" role="status">{message}</p>}
    </>}
  </section>;
}

function TableActions({ view, state, busy, onCommand, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const actionController = useTableActionController(view, onCommand);
  const actionSelectId = `${useId().replace(/:/g, '')}-tt-table-action-choice`;
  const [selectedActionId, setSelectedActionId] = useState('');
  const actions = state.program?.actions ?? [];
  const currentSeat = view.actor.seat ?? 'host';
  const turnLabel = state.turn === 'host' ? 'Owner' : state.turn?.replace('member-', 'Member ') ?? 'No turn order';
  const currentActorRole = view.actor.role === 'owner' ? 'owner' : 'participant';
  const readOnly = busy === 'table.readOnly';
  const eligibleActions = actions.filter((action) => action.roles.includes(currentActorRole));
  const selectedAction = eligibleActions.find((action) => action.id === selectedActionId);

  useEffect(() => { setSelectedActionId(''); }, [view.id, view.epoch, view.actor.actorId]);

  return <div className="tt-canvas-inline tt-table-actions">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">TABLE ACTIONS</span><strong>{state.program?.title ?? 'Available actions'}</strong>{state.turn && <small>Turn: {turnLabel}</small>}</div>
    {expanded && readOnly && <p className="tt-table-readonly-inline" role="status">Table actions are temporarily paused. Shared records remain available above.</p>}
    {!expanded ? <p className="tt-canvas-inline__note">Choose an action for this table.</p> : !state.program ? <p className="tt-canvas-inline__empty">Activate a reviewed table rule set before participants can make changes.</p> : eligibleActions.length === 0 ? <p className="tt-canvas-inline__empty">No actions are available to your role.{actions.length > 0 ? ` These actions are limited to ${formatActionRoles(actions)}.` : ''}</p> : <>
      <p className="tt-table-turn-indicator">Acting as {view.actor.role === 'owner' ? 'Owner' : `${view.actor.name} · member`}{view.actor.seat ? ` · ${view.actor.seat.replace('member-', 'Member ')}` : ''}{state.turn ? ` · current turn: ${turnLabel}` : ''}</p>
      {eligibleActions.length < actions.length && <p className="tt-table-action-restriction">Some actions are limited to {formatActionRoles(actions.filter((action) => !action.roles.includes(currentActorRole)))}.</p>}
      <label className="tt-table-action-picker" htmlFor={actionSelectId}>Choose an action<select id={actionSelectId} value={selectedActionId} onChange={(event) => setSelectedActionId(event.target.value)}><option value="">Choose an action…</option>{eligibleActions.map((action) => <option value={action.id} key={action.id}>{action.title}</option>)}</select></label>
      {selectedAction && <ActionForm view={view} action={selectedAction} state={state} currentSeat={currentSeat} members={view.members} busy={busy} values={actionController.values[selectedAction.id] ?? {}} onUpdate={actionController.update} onSubmit={actionController.submit} onRoll={actionController.roll} />}
    </>}
    {actionController.message && <p className="tt-table-error" role="alert">{actionController.message}</p>}
  </div>;
}

function ActionForm({ view, action, state, currentSeat, members, busy, values, onUpdate, onSubmit, onRoll }: { view: WorkspaceView; action: TableAction; state: TableState; currentSeat: string; members?: WorkspaceView['members']; busy: string | null; values: Record<string, string | number | boolean>; onUpdate: (actionId: string, paramId: string, value: string | number | boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>, action: TableAction) => Promise<void>; onRoll: (actionId: string, parameterId: string) => Promise<void> }) {
  const formId = useId().replace(/:/g, '');
  useServerRollsTick();
  const turnBlocked = action.requireTurn && state.turn !== currentSeat;
  const readOnly = busy === 'table.readOnly';
  const emptyRecordCollections = [...new Set(action.parameters.filter((parameter) => parameter.type === 'record' && !(state.records[parameter.collection ?? '']?.length)).map((parameter) => state.program?.collections.find((collection) => collection.id === parameter.collection)?.title ?? parameter.collection ?? 'records'))];
  const missingRoll = action.parameters.some((parameter) => parameter.type === 'roll' && !serverRollFor(view, action.id, parameter.id));
  const submit = (event: FormEvent<HTMLFormElement>) => { void onSubmit(event, action); };
  return <form className="tt-table-action" onSubmit={submit}>
    <header><span className="tt-table-action__glyph"><Play size={14} /></span><span><strong>{action.title}</strong><small>{action.description}</small></span></header>
    {action.parameters.length > 0 && <div className="tt-table-action__inputs">{action.parameters.map((parameter) => {
      const id = `${formId}-tt-table-${action.id}-${parameter.id}`;
      if (parameter.type === 'roll') return <RollParameterControl key={parameter.id} id={id} view={view} actionId={action.id} parameter={parameter} disabled={busy !== null || turnBlocked} onRoll={() => { void onRoll(action.id, parameter.id); }} />;
      const value = values[parameter.id] ?? (parameter.type === 'boolean' ? false : '');
      const recordChoices = parameter.type === 'record' ? state.records[parameter.collection ?? ''] ?? [] : [];
      const choices = parameter.choices ?? [];
      return <label key={parameter.id} htmlFor={id}>{parameter.label}
        {parameter.type === 'boolean' ? <span className="tt-table-action__boolean"><input id={id} type="checkbox" checked={Boolean(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.checked)} /> Yes</span>
          : parameter.type === 'record' ? <select id={id} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose a record</option>{(() => {
            const labels = recordChoiceLabels(recordChoices, state.program?.collections.find((collection) => collection.id === parameter.collection), members);
            return recordChoices.map((record) => <option value={record.id} key={record.id}>{labels.get(record.id) ?? record.id}</option>);
          })()}</select>
            : parameter.type === 'text' && choices.length > 0 ? <select id={id} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose…</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
              : <input id={id} type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.type === 'number' ? parameter.min : undefined} max={parameter.type === 'number' ? parameter.max : undefined} step={parameter.type === 'number' ? 'any' : undefined} maxLength={parameter.type === 'text' ? 500 : undefined} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required />}
      </label>;
    })}</div>}
    {action.conditions.length > 0 && <details className="tt-table-action__requirements"><summary>Requirements · {action.conditions.length}</summary><ul className="tt-table-rule-list">{action.conditions.map((condition, index) => <li key={index}><strong>{operandLabel(condition.left, action, state.program ?? undefined, members)} {conditionOperator(condition.op)} {operandLabel(condition.right, action, state.program ?? undefined, members)}</strong><span>{condition.message}</span></li>)}</ul></details>}
    {readOnly && <p className="tt-table-action__disabled-reason" role="status">This table is read-only. Actions are paused while you review it.</p>}
    {busy && !readOnly && <p className="tt-table-action__disabled-reason" role="status">{busy === 'table.act' ? 'Applying action…' : busy === 'table.roll' ? 'Rolling…' : 'A table update is in progress. Actions are paused.'}</p>}
    {turnBlocked && <p className="tt-table-turn-blocked" role="status">Waiting for {state.turn === 'host' ? 'the owner' : state.turn?.replace('member-', 'Member ')} to act.</p>}
    {missingRoll && !turnBlocked && <p className="tt-table-action__disabled-reason" role="status">กด “ทอย” ให้ server ทอยค่าของแอ็กชันนี้ก่อน</p>}
    {emptyRecordCollections.length > 0 && <p className="tt-table-action__disabled-reason" role="status">No records are available in {emptyRecordCollections.join(', ')} yet.</p>}
    <button type="submit" className="tt-button tt-button--primary" disabled={busy !== null || turnBlocked || emptyRecordCollections.length > 0 || missingRoll}><Play size={13} /> {busy === 'table.act' ? 'Applying…' : action.title}</button>
  </form>;
}

function useTableActionController(view: WorkspaceView, onCommand: WorkbenchProps['onCommand']) {
  const [values, setValues] = useState<Record<string, Record<string, string | number | boolean>>>({});
  const [message, setMessage] = useState('');

  useEffect(() => { setValues({}); setMessage(''); }, [view.id, view.epoch, view.actor.actorId]);

  const update = (actionId: string, paramId: string, value: string | number | boolean) => setValues((current) => ({ ...current, [actionId]: { ...(current[actionId] ?? {}), [paramId]: value } }));
  const setRecordSelection = (actionId: string, recordParameterIds: string[], selectedParameterId: string, recordId: string) => {
    setValues((current) => {
      const previous = current[actionId] ?? {};
      const changedRecord = selectedParameterId && previous[selectedParameterId] !== recordId;
      const actionValues: Record<string, string | number | boolean> = changedRecord ? {} : { ...previous };
      for (const parameterId of recordParameterIds) actionValues[parameterId] = '';
      if (selectedParameterId) actionValues[selectedParameterId] = recordId;
      return { ...current, [actionId]: actionValues };
    });
  };
  const roll = async (actionId: string, parameterId: string) => {
    setMessage('');
    try { await onCommand('table.roll', { actionId, parameterId }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The roll could not be made.'); }
  };
  const submit = async (event: FormEvent<HTMLFormElement>, action: TableAction) => {
    event.preventDefault();
    const raw = values[action.id] ?? {};
    const inputs: Record<string, TableValue> = {};
    for (const parameter of action.parameters) {
      const value = raw[parameter.id];
      if (parameter.type === 'roll') {
        // F048: the server fills this input from the pending roll; the client never sends a value.
        if (!serverRollFor(view, action.id, parameter.id)) { setMessage(`กด “ทอย” ให้ server ทอย ${parameter.label} ก่อนส่ง`); return; }
        continue;
      }
      if (parameter.type === 'number') {
        if (value === undefined || value === '') { setMessage(`Enter ${parameter.label}.`); return; }
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || parameter.min !== undefined && numeric < parameter.min || parameter.max !== undefined && numeric > parameter.max) { setMessage(`${parameter.label} is outside its allowed range.`); return; }
        inputs[parameter.id] = numeric;
      } else if (parameter.type === 'boolean') inputs[parameter.id] = Boolean(value);
      else {
        if (value === undefined || String(value).trim() === '') { setMessage(`${parameter.type === 'record' ? 'Choose' : 'Enter'} ${parameter.label}.`); return; }
        inputs[parameter.id] = String(value);
      }
    }
    setMessage('');
    try { await onCommand('table.act', { actionId: action.id, inputs }); }
    catch (error) { setMessage(error instanceof Error ? error.message : 'The action could not be applied.'); }
  };

  return { values, message, update, setRecordSelection, submit, roll };
}

function formatActionRoles(actions: TableAction[]): string {
  const roles = new Set(actions.flatMap((action) => action.roles));
  const labels = [...roles].map((role) => role === 'owner' ? 'the owner' : 'members');
  if (labels.length < 2) return labels[0] ?? 'another role';
  return labels.join(' and ');
}

function recordLabel(record: TableRecord, collection?: TableCollection, members?: WorkspaceView['members']): string {
  const titleField = collection?.fields.find((field) => field.id === 'name' || field.id === 'title' || field.id === 'id') ?? collection?.fields[0];
  const recordId = displayValue(record.id, members);
  const title = titleField ? displayValue(record.values[titleField.id], members) : recordId;
  if (!title || title === '—' || title === recordId) return recordId;
  return `${title} · ${recordId}`;
}

function formatComputed(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 10_000) / 10_000);
}

function displayValue(value: TableValue | undefined, members?: WorkspaceView['members']): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.map((item) => displayValue(item, members)).join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return typeof value === 'string' ? members?.find((member) => member.actorId === value)?.name ?? value : String(value);
}

function fieldTypeLabel(field: TableField): string {
  return field.type === 'number' ? 'Number' : field.type === 'boolean' ? 'Yes / no' : field.type === 'list' ? 'List' : 'Text';
}

function fieldLabel(program: TableProgram, collectionId: string, fieldId: string): string {
  return program.collections.find((collection) => collection.id === collectionId)?.fields.find((field) => field.id === fieldId)?.label ?? fieldId;
}

function operandLabel(value: TableOperand, action: TableAction, program?: TableProgram, members?: WorkspaceView['members']): string {
  if ('literal' in value) return displayValue(value.literal, members);
  if ('input' in value) return action.parameters.find((parameter) => parameter.id === value.input)?.label ?? 'provided value';
  if ('record' in value) {
    const parameter = action.parameters.find((item) => item.id === value.record);
    return `${parameter?.label ?? 'selected record'} · ${program ? fieldLabel(program, parameter?.collection ?? '', value.field) : value.field}`;
  }
  if ('expression' in value) return 'a generated expression';
  return value.system === 'actor' ? 'the acting member' : value.system === 'seat' ? 'the current seat' : 'the current turn';
}

function conditionOperator(op: TableAction['conditions'][number]['op']): string {
  return ({ eq: 'equals', neq: 'does not equal', lt: 'is less than', lte: 'is at most', gt: 'is greater than', gte: 'is at least', contains: 'contains' })[op];
}
