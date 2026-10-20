import { useCallback, useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { AlertCircle, Database, FilePlus2, Pencil, Play, Trash2, Users } from 'lucide-react';
import type { TableAction, TableChange, TableCollection, TableField, TableProgram, TableRecord, TableSource, TableState, TableValue } from '../shared/table-contracts';
import type { ActorContext, WorkspaceView } from '../shared/contracts';
import type { PlanNode } from '../runtime';
import { applyTableChange, handleTableCommand } from '../domain/table';
import type { GenerativeViewDescriptor } from '../shared/generative-contracts';
import { CandidateLifecycle } from './WorkbenchShared';
import type { Command, WorkbenchProps } from './types';
import { clearGeneratedCanvasPreview, GeneratedCanvasObject } from './GeneratedCanvasObjects';
import './record-actions.css';

interface TableCanvasObjectProps {
  view: WorkspaceView;
  node: PlanNode;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onTableImport?: WorkbenchProps['onTableImport'];
  outputs: Record<string, unknown>;
  expanded?: boolean;
  onEditRules?: () => void;
}

const MAX_SOURCE_FILES = 4;
const MAX_SOURCE_BYTES = 64 * 1024;

export function TableCanvasObject(props: TableCanvasObjectProps) {
  if (props.view.domain.kind !== 'table') return null;
  if (props.node.id === 'table.sources') return <TableSources {...props} state={props.view.domain} />;
  if (props.node.id === 'table.rules') return <TableRules {...props} state={props.view.domain} />;
  if (props.node.id.startsWith('table.collection.')) return <TableCollectionView {...props} state={props.view.domain} />;
  if (props.node.id === 'table.actions') return <TableActions {...props} state={props.view.domain} />;
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
  const canAdd = !readOnly && view.actor.role === 'owner' && !!onTableImport && state.sources.length < MAX_SOURCE_FILES && totalBytes < MAX_SOURCE_BYTES;

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    if (!onTableImport || view.actor.role !== 'owner') {
      setError('Only the table owner can add source files.');
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
    <p className="tt-canvas-inline__note"><Users size={13} aria-hidden="true" /> Everyone at this table can read these files. Only the owner adds or removes them.</p>
    {expanded && readOnly && <p className="tt-table-readonly-inline" role="status">This table is temporarily read-only. You can still inspect the files and shared records.</p>}
    {expanded && <>
      {readOnly ? null : canAdd ? <div className="tt-table-dropzone" onDrop={onDrop} onDragOver={onDragOver}>
        <FilePlus2 size={19} aria-hidden="true" />
        <strong>Drop files here</strong>
        <small>CSV, JSON, TXT or Markdown · 32 KiB each</small>
        <button type="button" className="tt-button tt-button--quiet" onClick={() => inputRef.current?.click()} disabled={busy !== null || importing}>Choose files</button>
        <input ref={inputRef} type="file" accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown" multiple hidden onChange={onInput} aria-label="Choose table source files" />
        <details><summary>File limits</summary><small>UTF-8 text · four files, 64 KiB total. PDF and images are not supported. AI requests have a separate 48 KiB input limit including your prompt and current rules.</small></details>
      </div> : view.actor.role === 'owner' ? <p className="tt-table-limit-note">{state.sources.length >= MAX_SOURCE_FILES ? 'All four source file slots are in use.' : totalBytes >= MAX_SOURCE_BYTES ? 'The 64 KiB source limit has been reached.' : 'Only the table owner can add source files.'}</p> : <p className="tt-table-limit-note">Only the table owner can add files.</p>}
    </>}
    {error && <p className="tt-table-error" role="alert"><AlertCircle size={14} />{error}</p>}
    {state.sources.length === 0 ? !expanded && <p className="tt-canvas-inline__empty">{readOnly ? 'No files yet.' : 'Add a file or describe the table you want.'}</p> : <ul className="tt-table-source-list" aria-label="Table source files">{state.sources.map((source) => <SourceCard key={source.id} source={source} expanded={expanded} canRemove={view.actor.role === 'owner' && !readOnly && !referencedSourceIds.has(source.id)} readOnly={readOnly} referenced={referencedSourceIds.has(source.id)} busy={busy !== null} onRemove={() => void onCommand('table.removeSource', { sourceId: source.id })} />)}</ul>}
  </div>;
}

function SourceCard({ source, expanded, canRemove, readOnly, referenced, busy, onRemove }: { source: TableSource; expanded: boolean; canRemove: boolean; readOnly: boolean; referenced: boolean; busy: boolean; onRemove: () => void }) {
  return <li className="tt-table-source-card">
    <div className="tt-table-source-card__head"><Database size={15} aria-hidden="true" /><span><strong>{source.filename}</strong><small>{(new TextEncoder().encode(source.text).byteLength / 1024).toFixed(1)} KiB · added {new Date(source.createdAt).toLocaleString()}</small></span>{canRemove && <button type="button" className="tt-icon-button" aria-label={`Remove ${source.filename}`} disabled={busy} onClick={onRemove}><Trash2 size={14} /></button>}</div>
    {expanded && <details><summary>Review source text</summary><pre>{source.text}</pre></details>}
    {!canRemove && <small className="tt-table-source-card__citation">{referenced ? 'Used by an active or retained rule set · keep with this table' : readOnly ? 'Source editing is temporarily paused.' : 'Only the table owner can remove this file.'}</small>}
  </li>;
}

function TableRules({ view, state, onCommand, busy, expanded = false, onEditRules }: TableCanvasObjectProps & { state: TableState }) {
  const [manualChange, setManualChange] = useState('');
  const [manualError, setManualError] = useState('');
  const isOwner = view.actor.role === 'owner';
  const readOnly = busy === 'table.readOnly';
  const program = state.program;
  const candidateChange = state.candidate?.change.kind === 'table' ? state.candidate.change : null;
  const candidateState = useMemo(() => {
    if (!candidateChange) return null;
    try { return applyTableChange(structuredClone(state), structuredClone(candidateChange)); }
    catch { return null; }
  }, [candidateChange, state]);

  const proposeManual = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    let parsed: unknown;
    try { parsed = JSON.parse(manualChange); }
    catch { setManualError('Enter a valid table change.'); return; }
    if (!parsed || typeof parsed !== 'object' || (parsed as { kind?: unknown }).kind !== 'table') { setManualError('The change must include a table program and initial records.'); return; }
    setManualError('');
    void onCommand('evolve.propose', { change: parsed });
  };

  return <div className="tt-canvas-inline tt-table-rules">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">{isOwner ? 'OWNER REVIEW · SHARED ACTIVE RULES' : 'SHARED ACTIVE RULES'}</span><strong>{program?.title ?? 'Rules and proposal'}</strong><small>{program ? `Active r${state.ruleRevision}` : 'No active program'}</small></div>
    {isOwner && program && onEditRules && <div className="tt-inline-action-row"><button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || readOnly || Boolean(state.candidate && state.candidate.status !== 'active')} onClick={onEditRules}><Pencil size={13} />Edit rules</button></div>}
    {!expanded ? <p className="tt-canvas-inline__note">{program ? `${program.collections.length} collections · ${program.actions.length} actions · open to inspect rules, evidence and changes.` : 'Add source files, then describe the table you want. No active rules yet.'}</p> : <>
      {program ? <ProgramOverview program={program} state={state} label="Current active rules" members={view.members} /> : !candidateChange && <div className="tt-canvas-inline__empty"><Database size={15} /> Describe the table you want, or add a source file.</div>}
      {candidateChange && state.candidate?.status !== 'active' && <section className="tt-table-proposal" aria-labelledby="tt-table-proposal-title"><span className="tt-kicker">NOT ACTIVE YET</span><h3 id="tt-table-proposal-title">{candidateChange.program.title}</h3><ProgramOverview program={candidateChange.program} state={state} label="Proposed rules" change={candidateChange} members={view.members} />
        {isOwner && candidateState?.program?.canvas?.views.length ? <DraftCanvasPreview key={`${state.candidate?.id ?? 'candidate'}:${state.candidate?.hash ?? 'draft'}`} candidateKey={`${state.candidate?.id ?? 'candidate'}:${state.candidate?.hash ?? 'draft'}`} view={view} initialState={candidateState} busy={busy} /> : null}
      </section>}
      {isOwner && <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} readOnly={readOnly} />}
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

function ProgramOverview({ program, state, label, change, members }: { program: TableProgram; state: TableState; label: string; change?: TableChange; members?: WorkspaceView['members'] }) {
  const sources = new Map(state.sources.map((source) => [source.id, source.filename]));
  const evidence = program.evidence ?? [];
  return <section className="tt-table-program" aria-label={label}>
    <div className="tt-table-program__summary"><span><small>Collections</small><strong>{program.collections.length}</strong></span><span><small>Actions</small><strong>{program.actions.length}</strong></span><span><small>Unique rules</small><strong>{program.invariants.length}</strong></span></div>
    {program.description && <p className="tt-table-program__description">{program.description}</p>}
    <details className="tt-table-rule-details"><summary>Data fields · {program.collections.length} {program.collections.length === 1 ? 'collection' : 'collections'}</summary>{program.collections.map((collection) => <CollectionDefinition key={collection.id} collection={collection} />)}</details>
    <details className="tt-table-rule-details"><summary>Actions · {program.actions.length}</summary>{program.actions.map((action) => <ActionDefinition key={action.id} action={action} program={program} members={members} />)}</details>
    {change && program.collections.map((collection) => <ProposedRecords key={`proposed-${collection.id}`} collection={collection} records={change.initialRecords[collection.id] ?? []} members={members} />)}
    {program.invariants.length > 0 && <details className="tt-table-rule-details"><summary>Data checks · {program.invariants.length}</summary><ul>{program.invariants.map((invariant) => <li key={invariant.id}>{invariant.message} <small>({invariant.fields.map((fieldId) => fieldLabel(program, invariant.collection, fieldId)).join(' + ')})</small></li>)}</ul></details>}
    {program.turnOrder.length > 0 && <p className="tt-table-turn-order">Turn order: {program.turnOrder.map((seat) => seat === 'host' ? 'Owner' : seat.replace('member-', 'Member ')).join(' → ')}</p>}
    {evidence.length > 0 && <details className="tt-table-rule-details"><summary>Source evidence · {evidence.length}</summary><ul>{evidence.map((item, index) => <li key={`${item.sourceId}-${index}`}><strong>{sources.get(item.sourceId) ?? 'Source file'}</strong><blockquote>{item.quote}</blockquote></li>)}</ul></details>}
      {program.assumptions.length > 0 && <section className="tt-table-assumptions"><h4>Assumptions to review</h4><ul>{program.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul><p>Structural checks do not confirm these assumptions match your policy. The owner should review them and the cited evidence before approval.</p></section>}
      {program.assumptions.length === 0 && label === 'Proposed rules' && <p className="tt-table-owner-review">Structural checks do not confirm source-policy fit. The owner should review the cited evidence before approval.</p>}
    {change && <p className="tt-canvas-inline__note">{Object.values(change.initialRecords).reduce((sum, rows) => sum + rows.length, 0)} starting rows in this proposal. Active records remain unchanged until activation.</p>}
  </section>;
}

function CollectionDefinition({ collection }: { collection: TableCollection }) {
  return <section className="tt-table-program__group"><h4>{collection.title}</h4><ul className="tt-table-field-list">{collection.fields.map((field) => <li key={field.id}><strong>{field.label}</strong><span>{fieldTypeLabel(field)}{field.required ? ' · required' : ' · optional'}{field.min !== undefined ? ` · min ${field.min}` : ''}{field.max !== undefined ? ` · max ${field.max}` : ''}{field.choices?.length ? ` · ${field.choices.join(', ')}` : ''}</span></li>)}</ul></section>;
}

function ActionDefinition({ action, program, members }: { action: TableAction; program: TableProgram; members?: WorkspaceView['members'] }) {
  const effects = action.effects.map((effect) => {
    const param = action.parameters.find((item) => item.id === effect.record);
    return `${param?.label ?? 'Selected record'} → ${fieldLabel(program, param?.collection ?? '', effect.field)} ${effect.op === 'add' ? 'adds' : 'sets'} ${operandLabel(effect.value, action, program, members)}`;
  });
  return <section className="tt-table-program__group"><h4>{action.title}</h4><p>{action.description}</p><small>Available to {action.roles.map((role) => role === 'owner' ? 'owner' : 'members').join(' and ')}{action.requireTurn ? ' · follows turn order' : ''}{action.advanceTurn ? ' · advances turn' : ''}</small>
    {action.conditions.length > 0 && <ul className="tt-table-rule-list">{action.conditions.map((condition, index) => <li key={index}><strong>{operandLabel(condition.left, action, program, members)} {conditionOperator(condition.op)} {operandLabel(condition.right, action, program, members)}</strong><span>{condition.message}</span></li>)}</ul>}
    {effects.length > 0 && <ul className="tt-table-effect-list">{effects.map((effect, index) => <li key={index}>{effect}</li>)}</ul>}
  </section>;
}

function ProposedRecords({ collection, records, members }: { collection: TableCollection; records: TableRecord[]; members?: WorkspaceView['members'] }) {
  return <details className="tt-table-proposed-records"><summary>Proposed starting rows · {collection.title} · {records.length}</summary>
    {records.length === 0 ? <p>No new rows in this proposal. Existing records stay unchanged.</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid"><caption>New {collection.title} rows in this proposal</caption><thead><tr>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead><tbody>{records.map((row) => <tr key={row.id}>{collection.fields.map((field) => <td key={field.id}>{displayValue(row.values[field.id], members)}</td>)}</tr>)}</tbody></table></div>}
  </details>;
}

function TableCollectionView({ view, state, node, busy, onCommand, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const collectionId = node.id.slice('table.collection.'.length);
  const collection = state.program?.collections.find((item) => item.id === collectionId);
  const rows = (node.inputs.rows as TableRecord[] | undefined) ?? state.records[collectionId] ?? [];
  const actionController = useTableActionController(view, onCommand);
  const contextId = useId().replace(/:/g, '');
  const actionSelectId = `${contextId}-tt-table-record-action`;
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
    {!expanded ? <div className="tt-table-collection__preview">{rows.slice(0, 2).map((row) => <span key={row.id}>{collection?.fields.slice(0, 2).map((field) => `${field.label}: ${displayValue(row.values[field.id], view.members)}`).join(' · ') || displayValue(row.id, view.members)}</span>)}{rows.length === 0 && <p className="tt-canvas-inline__note">No records yet.</p>}</div> : !collection ? <p className="tt-canvas-inline__empty">This collection is not in the active table rules.</p> : rows.length === 0 ? <p className="tt-canvas-inline__empty">No records are available in this collection.</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid tt-table-record-grid"><caption>{collection.title} · shared records</caption><thead><tr><th scope="col"><span className="tt-visually-hidden">Select a record</span></th>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id} className={row.id === selectedRecordId ? 'is-selected' : undefined}><td><button type="button" className="tt-table-record-select" aria-label={`${row.id === selectedRecordId ? 'Deselect' : 'Select'} ${recordLabel(row, collection, view.members)}`} aria-pressed={row.id === selectedRecordId} disabled={busy !== null} onClick={() => chooseRecord(row.id)}>{row.id === selectedRecordId ? 'Selected' : 'Select'}</button></td>{collection.fields.map((field) => <td key={field.id}>{displayValue(row.values[field.id], view.members)}</td>)}</tr>)}</tbody></table></div>}
    {expanded && selectedRecord && <section className="tt-table-record-actions" aria-label={`Actions for ${recordLabel(selectedRecord, collection, view.members)}`}>
      <div><strong>{recordLabel(selectedRecord, collection, view.members)}</strong></div>
      {eligibleActions.length === 0 ? <p className="tt-canvas-inline__note">{collectionActions.length === 0 ? 'No table actions use this collection.' : `Actions for this collection are limited to ${formatActionRoles(collectionActions)}.`}</p> : <>
        <label htmlFor={actionSelectId}>Action<select id={actionSelectId} value={selectedActionId} disabled={busy !== null} onChange={(event) => chooseAction(event.target.value)}><option value="">Choose an action…</option>{eligibleActions.map((action) => <option value={action.id} key={action.id}>{action.title}</option>)}</select></label>
        {selectedAction && selectedActionRecordParameters.length > 1 && <label htmlFor={parameterSelectId}>Use this record as<select id={parameterSelectId} value={selectedParameterId} disabled={busy !== null} onChange={(event) => chooseRecordParameter(event.target.value)}><option value="">Choose a record field…</option>{selectedActionRecordParameters.map((parameter) => <option key={parameter.id} value={parameter.id}>{parameter.label}</option>)}</select></label>}
        {selectedAction && (selectedActionRecordParameters.length === 1 || selectedParameterId) && <ActionForm action={selectedAction} state={state} currentSeat={view.actor.seat ?? 'host'} members={view.members} busy={busy} values={actionController.values[selectedAction.id] ?? {}} onUpdate={actionController.update} onSubmit={actionController.submit} />}
        {selectedAction && selectedActionRecordParameters.length > 1 && !selectedParameterId && <p className="tt-table-inline-hint">This action uses multiple records from this collection. Choose which record field should use the selected row.</p>}
      </>}
      {actionController.message && <p className="tt-table-error" role="alert">{actionController.message}</p>}
    </section>}
    <p className="tt-table-turn-indicator">{view.actor.role === 'owner' ? 'Owner' : view.actor.name} · shared active data</p>
  </div>;
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
      {selectedAction && <ActionForm action={selectedAction} state={state} currentSeat={currentSeat} members={view.members} busy={busy} values={actionController.values[selectedAction.id] ?? {}} onUpdate={actionController.update} onSubmit={actionController.submit} />}
    </>}
    {actionController.message && <p className="tt-table-error" role="alert">{actionController.message}</p>}
  </div>;
}

function ActionForm({ action, state, currentSeat, members, busy, values, onUpdate, onSubmit }: { action: TableAction; state: TableState; currentSeat: string; members?: WorkspaceView['members']; busy: string | null; values: Record<string, string | number | boolean>; onUpdate: (actionId: string, paramId: string, value: string | number | boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>, action: TableAction) => Promise<void> }) {
  const formId = useId().replace(/:/g, '');
  const turnBlocked = action.requireTurn && state.turn !== currentSeat;
  const readOnly = busy === 'table.readOnly';
  const emptyRecordCollections = [...new Set(action.parameters.filter((parameter) => parameter.type === 'record' && !(state.records[parameter.collection ?? '']?.length)).map((parameter) => state.program?.collections.find((collection) => collection.id === parameter.collection)?.title ?? parameter.collection ?? 'records'))];
  const submit = (event: FormEvent<HTMLFormElement>) => { void onSubmit(event, action); };
  return <form className="tt-table-action" onSubmit={submit}>
    <header><span className="tt-table-action__glyph"><Play size={14} /></span><span><strong>{action.title}</strong><small>{action.description}</small></span></header>
    {action.parameters.length > 0 && <div className="tt-table-action__inputs">{action.parameters.map((parameter) => {
      const id = `${formId}-tt-table-${action.id}-${parameter.id}`;
      const value = values[parameter.id] ?? (parameter.type === 'boolean' ? false : '');
      const recordChoices = parameter.type === 'record' ? state.records[parameter.collection ?? ''] ?? [] : [];
      const choices = parameter.choices ?? [];
      return <label key={parameter.id} htmlFor={id}>{parameter.label}
        {parameter.type === 'boolean' ? <span className="tt-table-action__boolean"><input id={id} type="checkbox" checked={Boolean(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.checked)} /> Yes</span>
          : parameter.type === 'record' ? <select id={id} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose a record</option>{recordChoices.map((record) => <option value={record.id} key={record.id}>{recordLabel(record, state.program?.collections.find((collection) => collection.id === parameter.collection), members)}</option>)}</select>
            : parameter.type === 'text' && choices.length > 0 ? <select id={id} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose…</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
              : <input id={id} type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.type === 'number' ? parameter.min : undefined} max={parameter.type === 'number' ? parameter.max : undefined} step={parameter.type === 'number' ? 'any' : undefined} maxLength={parameter.type === 'text' ? 500 : undefined} value={String(value)} disabled={busy !== null} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required />}
      </label>;
    })}</div>}
    {action.conditions.length > 0 && <details className="tt-table-action__requirements"><summary>Requirements · {action.conditions.length}</summary><ul className="tt-table-rule-list">{action.conditions.map((condition, index) => <li key={index}><strong>{operandLabel(condition.left, action, state.program ?? undefined, members)} {conditionOperator(condition.op)} {operandLabel(condition.right, action, state.program ?? undefined, members)}</strong><span>{condition.message}</span></li>)}</ul></details>}
    {readOnly && <p className="tt-table-action__disabled-reason" role="status">This table is read-only. Actions are paused while you review it.</p>}
    {busy && !readOnly && <p className="tt-table-action__disabled-reason" role="status">{busy === 'table.act' ? 'Applying action…' : 'A table update is in progress. Actions are paused.'}</p>}
    {turnBlocked && <p className="tt-table-turn-blocked" role="status">Waiting for {state.turn === 'host' ? 'the owner' : state.turn?.replace('member-', 'Member ')} to act.</p>}
    {emptyRecordCollections.length > 0 && <p className="tt-table-action__disabled-reason" role="status">No records are available in {emptyRecordCollections.join(', ')} yet.</p>}
    <button type="submit" className="tt-button tt-button--primary" disabled={busy !== null || turnBlocked || emptyRecordCollections.length > 0}><Play size={13} /> {busy === 'table.act' ? 'Applying…' : action.title}</button>
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
  const submit = async (event: FormEvent<HTMLFormElement>, action: TableAction) => {
    event.preventDefault();
    const raw = values[action.id] ?? {};
    const inputs: Record<string, TableValue> = {};
    for (const parameter of action.parameters) {
      const value = raw[parameter.id];
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

  return { values, message, update, setRecordSelection, submit };
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

function operandLabel(value: TableAction['effects'][number]['value'], action: TableAction, program?: TableProgram, members?: WorkspaceView['members']): string {
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
