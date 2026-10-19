import { useEffect, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from 'react';
import { AlertCircle, Database, FilePlus2, LockKeyhole, Play, Trash2 } from 'lucide-react';
import type { TableAction, TableChange, TableCollection, TableField, TableProgram, TableRecord, TableSource, TableState, TableValue } from '../shared/table-contracts';
import type { WorkspaceView } from '../shared/contracts';
import type { PlanNode } from '../runtime';
import { CandidateLifecycle } from './WorkbenchShared';
import type { WorkbenchProps } from './types';

interface TableCanvasObjectProps {
  view: WorkspaceView;
  node: PlanNode;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onTableImport?: WorkbenchProps['onTableImport'];
  expanded?: boolean;
}

const MAX_SOURCE_FILES = 4;
const MAX_SOURCE_BYTES = 64 * 1024;

export function TableCanvasObject(props: TableCanvasObjectProps) {
  if (props.view.domain.kind !== 'table') return null;
  if (props.node.id === 'table.sources') return <TableSources {...props} state={props.view.domain} />;
  if (props.node.id === 'table.rules') return <TableRules {...props} state={props.view.domain} />;
  if (props.node.id.startsWith('table.collection.')) return <TableCollectionView {...props} state={props.view.domain} />;
  if (props.node.id === 'table.actions') return <TableActions {...props} state={props.view.domain} />;
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
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">PRIVATE SOURCE FILES</span><strong>Files for this table</strong><small>{state.sources.length}/{MAX_SOURCE_FILES} · {Math.ceil(totalBytes / 1024)} KiB</small></div>
    <p className="tt-canvas-inline__note"><LockKeyhole size={13} aria-hidden="true" /> Only the owner sees these original files. Ask AI separately before sending them.</p>
    {expanded && readOnly && <p className="tt-table-readonly-inline" role="status">This table is temporarily read-only. You can still inspect the files and shared records.</p>}
    {expanded && <>
      {readOnly ? null : canAdd ? <div className="tt-table-dropzone" onDrop={onDrop} onDragOver={onDragOver}>
        <FilePlus2 size={19} aria-hidden="true" />
        <strong>Drop a text file here</strong>
        <small>CSV, JSON, TXT or Markdown · UTF-8 · up to 32 KiB each</small>
        <button type="button" className="tt-button tt-button--quiet" onClick={() => inputRef.current?.click()} disabled={busy !== null || importing}>Choose files</button>
        <input ref={inputRef} type="file" accept=".csv,.json,.txt,.md,text/csv,application/json,text/plain,text/markdown" multiple hidden onChange={onInput} aria-label="Choose table source files" />
        <small>Up to four files and 64 KiB total. PDF, images and binary files are not supported.</small>
        <small>AI requests have a separate 48 KiB input limit that also includes your prompt and current rules.</small>
      </div> : view.actor.role === 'owner' ? <p className="tt-table-limit-note">{state.sources.length >= MAX_SOURCE_FILES ? 'All four source file slots are in use.' : totalBytes >= MAX_SOURCE_BYTES ? 'The 64 KiB source limit has been reached.' : 'Only the table owner can add source files.'}</p> : <p className="tt-table-limit-note">Source files are private to the owner.</p>}
    </>}
    {error && <p className="tt-table-error" role="alert"><AlertCircle size={14} />{error}</p>}
    {state.sources.length === 0 ? <p className="tt-canvas-inline__empty">{readOnly ? 'No private source files are available in this table.' : 'Add a CSV, JSON, TXT or Markdown file. Nothing is sent to AI unless the owner asks and agrees.'}</p> : <ul className="tt-table-source-list" aria-label="Table source files">{state.sources.map((source) => <SourceCard key={source.id} source={source} expanded={expanded} canRemove={view.actor.role === 'owner' && !readOnly && !referencedSourceIds.has(source.id)} readOnly={readOnly} referenced={referencedSourceIds.has(source.id)} busy={busy !== null} onRemove={() => void onCommand('table.removeSource', { sourceId: source.id })} />)}</ul>}
  </div>;
}

function SourceCard({ source, expanded, canRemove, readOnly, referenced, busy, onRemove }: { source: TableSource; expanded: boolean; canRemove: boolean; readOnly: boolean; referenced: boolean; busy: boolean; onRemove: () => void }) {
  return <li className="tt-table-source-card">
    <div className="tt-table-source-card__head"><Database size={15} aria-hidden="true" /><span><strong>{source.filename}</strong><small>{(new TextEncoder().encode(source.text).byteLength / 1024).toFixed(1)} KiB · added {new Date(source.createdAt).toLocaleString()}</small></span>{canRemove && <button type="button" className="tt-icon-button" aria-label={`Remove ${source.filename}`} disabled={busy} onClick={onRemove}><Trash2 size={14} /></button>}</div>
    {expanded && <details><summary>Review source text</summary><pre>{source.text}</pre></details>}
    {!canRemove && <small className="tt-table-source-card__citation">{referenced ? 'Used by an active or retained rule set · keep with this table' : readOnly ? 'Source editing is temporarily paused.' : 'Only the table owner can remove this file.'}</small>}
  </li>;
}

function TableRules({ view, state, onCommand, busy, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const [manualChange, setManualChange] = useState('');
  const [manualError, setManualError] = useState('');
  const isOwner = view.actor.role === 'owner';
  const readOnly = busy === 'table.readOnly';
  const program = state.program;
  const candidateChange = state.candidate?.change.kind === 'table' ? state.candidate.change : null;

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
    {!expanded ? <p className="tt-canvas-inline__note">{program ? `${program.collections.length} collections · ${program.actions.length} actions · open to inspect rules, evidence and changes.` : 'Add source files, then describe the table you want. No active rules yet.'}</p> : <>
      {program ? <ProgramOverview program={program} state={state} label="Current active rules" /> : <div className="tt-canvas-inline__empty"><Database size={15} /> Add one or more source files, then ask AI for a draft. You can review and change every rule before activation.</div>}
      {candidateChange && state.candidate && <section className="tt-table-proposal" aria-labelledby="tt-table-proposal-title"><span className="tt-kicker">{state.candidate.status === 'active' ? 'ACTIVE PROPOSAL' : 'NOT ACTIVE YET'}</span><h3 id="tt-table-proposal-title">{candidateChange.program.title}</h3><p>{candidateChange.program.description}</p><ProgramOverview program={candidateChange.program} state={state} label="Proposed rules" change={candidateChange} /></section>}
      {isOwner && <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} readOnly={readOnly} />}
      {isOwner && !readOnly && <details className="tt-table-manual-editor"><summary>Advanced manual rule change</summary><p>Paste a prepared table change only if needed. Normal requests can be written in plain language in the AI draft assistant.</p><form onSubmit={proposeManual}><label htmlFor="tt-table-manual-change">Table change</label><textarea id="tt-table-manual-change" rows={7} value={manualChange} onChange={(event) => { setManualChange(event.target.value); setManualError(''); }} placeholder={'{"kind":"table","program":{...},"initialRecords":{...}}'} spellCheck={false} /><small>New tables include initial records. Changes to an active table must preserve its collections and current records.</small>{manualError && <span role="alert" className="tt-table-error">{manualError}</span>}<button className="tt-button tt-button--quiet" type="submit" disabled={busy !== null || manualChange.trim().length === 0}>Propose manual change</button></form></details>}
      {!isOwner && <p className="tt-canvas-inline__note">Proposals, source files and review controls are private to the owner. Active rules and records are shared with this table.</p>}
    </>}
  </div>;
}

function ProgramOverview({ program, state, label, change }: { program: TableProgram; state: TableState; label: string; change?: TableChange }) {
  const sources = new Map(state.sources.map((source) => [source.id, source.filename]));
  const evidence = program.evidence ?? [];
  return <section className="tt-table-program" aria-label={label}>
    <div className="tt-table-program__summary"><span><small>Collections</small><strong>{program.collections.length}</strong></span><span><small>Actions</small><strong>{program.actions.length}</strong></span><span><small>Unique rules</small><strong>{program.invariants.length}</strong></span></div>
    {program.description && <p className="tt-table-program__description">{program.description}</p>}
    {program.collections.map((collection) => <CollectionDefinition key={collection.id} collection={collection} />)}
    {program.actions.map((action) => <ActionDefinition key={action.id} action={action} program={program} />)}
    {change && program.collections.map((collection) => <ProposedRecords key={`proposed-${collection.id}`} collection={collection} records={change.initialRecords[collection.id] ?? []} />)}
    {program.invariants.length > 0 && <section className="tt-table-program__group"><h4>Data checks</h4><ul>{program.invariants.map((invariant) => <li key={invariant.id}>{invariant.message} <small>({invariant.fields.map((fieldId) => fieldLabel(program, invariant.collection, fieldId)).join(' + ')})</small></li>)}</ul></section>}
    {program.turnOrder.length > 0 && <p className="tt-table-turn-order">Turn order: {program.turnOrder.map((seat) => seat === 'host' ? 'Owner' : seat.replace('member-', 'Member ')).join(' → ')}</p>}
    {evidence.length > 0 && <section className="tt-table-program__group"><h4>Source evidence</h4><ul>{evidence.map((item, index) => <li key={`${item.sourceId}-${index}`}><strong>{sources.get(item.sourceId) ?? 'Source file'}</strong><blockquote>{item.quote}</blockquote></li>)}</ul></section>}
      {program.assumptions.length > 0 && <section className="tt-table-assumptions"><h4>Assumptions to review</h4><ul>{program.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}</ul><p>Structural checks do not confirm these assumptions match your policy. The owner should review them and the cited evidence before approval.</p></section>}
      {program.assumptions.length === 0 && label === 'Proposed rules' && <p className="tt-table-owner-review">Structural checks do not confirm source-policy fit. The owner should review the cited evidence before approval.</p>}
    {change && <p className="tt-canvas-inline__note">{Object.values(change.initialRecords).reduce((sum, rows) => sum + rows.length, 0)} starting rows in this proposal. Active records remain unchanged until activation.</p>}
  </section>;
}

function CollectionDefinition({ collection }: { collection: TableCollection }) {
  return <section className="tt-table-program__group"><h4>{collection.title}</h4><ul className="tt-table-field-list">{collection.fields.map((field) => <li key={field.id}><strong>{field.label}</strong><span>{fieldTypeLabel(field)}{field.required ? ' · required' : ' · optional'}{field.min !== undefined ? ` · min ${field.min}` : ''}{field.max !== undefined ? ` · max ${field.max}` : ''}{field.choices?.length ? ` · ${field.choices.join(', ')}` : ''}</span></li>)}</ul></section>;
}

function ActionDefinition({ action, program }: { action: TableAction; program: TableProgram }) {
  const effects = action.effects.map((effect) => {
    const param = action.parameters.find((item) => item.id === effect.record);
    return `${param?.label ?? 'Selected record'} → ${fieldLabel(program, param?.collection ?? '', effect.field)} ${effect.op === 'add' ? 'adds' : 'sets'} ${operandLabel(effect.value, action, program)}`;
  });
  return <section className="tt-table-program__group"><h4>{action.title}</h4><p>{action.description}</p><small>Available to {action.roles.map((role) => role === 'owner' ? 'owner' : 'members').join(' and ')}{action.requireTurn ? ' · follows turn order' : ''}{action.advanceTurn ? ' · advances turn' : ''}</small>
    {action.conditions.length > 0 && <ul className="tt-table-rule-list">{action.conditions.map((condition, index) => <li key={index}><strong>{operandLabel(condition.left, action, program)} {conditionOperator(condition.op)} {operandLabel(condition.right, action, program)}</strong><span>{condition.message}</span></li>)}</ul>}
    {effects.length > 0 && <ul className="tt-table-effect-list">{effects.map((effect, index) => <li key={index}>{effect}</li>)}</ul>}
  </section>;
}

function ProposedRecords({ collection, records }: { collection: TableCollection; records: TableRecord[] }) {
  return <details className="tt-table-proposed-records"><summary>Proposed starting rows · {collection.title} · {records.length}</summary>
    {records.length === 0 ? <p>No new rows in this proposal. Existing records stay unchanged.</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid"><caption>New {collection.title} rows in this proposal</caption><thead><tr>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead><tbody>{records.map((row) => <tr key={row.id}>{collection.fields.map((field) => <td key={field.id}>{displayValue(row.values[field.id])}</td>)}</tr>)}</tbody></table></div>}
  </details>;
}

function TableCollectionView({ view, state, node, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const collectionId = node.id.slice('table.collection.'.length);
  const collection = state.program?.collections.find((item) => item.id === collectionId);
  const rows = (node.inputs.rows as TableRecord[] | undefined) ?? state.records[collectionId] ?? [];
  return <div className="tt-canvas-inline tt-table-collection">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">SHARED RECORDS</span><strong>{collection?.title ?? node.title}</strong><small>{rows.length} {rows.length === 1 ? 'record' : 'records'} · data r{state.dataRevision}</small></div>
    {!expanded ? <div className="tt-table-collection__preview">{rows.slice(0, 2).map((row) => <span key={row.id}>{collection?.fields.slice(0, 2).map((field) => `${field.label}: ${displayValue(row.values[field.id])}`).join(' · ') || row.id}</span>)}{rows.length === 0 && <p className="tt-canvas-inline__note">No records yet.</p>}</div> : !collection ? <p className="tt-canvas-inline__empty">This collection is not in the active table rules.</p> : rows.length === 0 ? <p className="tt-canvas-inline__empty">No records are available in this collection.</p> : <div className="tt-table-grid-scroll"><table className="tt-table-grid"><caption>{collection.title} · shared records</caption><thead><tr>{collection.fields.map((field) => <th scope="col" key={field.id}>{field.label}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{collection.fields.map((field) => <td key={field.id}>{displayValue(row.values[field.id])}</td>)}</tr>)}</tbody></table></div>}
    <p className="tt-table-turn-indicator">{view.actor.role === 'owner' ? 'Owner' : view.actor.name} · shared active data</p>
  </div>;
}

function TableActions({ view, state, busy, onCommand, expanded = false }: TableCanvasObjectProps & { state: TableState }) {
  const [values, setValues] = useState<Record<string, Record<string, string | number | boolean>>>({});
  const [message, setMessage] = useState('');
  const actions = state.program?.actions ?? [];
  const currentSeat = view.actor.seat ?? 'host';
  const turnLabel = state.turn === 'host' ? 'Owner' : state.turn?.replace('member-', 'Member ') ?? 'No turn order';
  const currentActorRole = view.actor.role === 'owner' ? 'owner' : 'participant';
  const readOnly = busy === 'table.readOnly';

  useEffect(() => { setValues({}); setMessage(''); }, [view.id, view.epoch, view.actor.actorId]);

  const update = (actionId: string, paramId: string, value: string | number | boolean) => setValues((current) => ({ ...current, [actionId]: { ...(current[actionId] ?? {}), [paramId]: value } }));
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
        if (value === undefined || value === '') { setMessage(`Choose ${parameter.label}.`); return; }
        inputs[parameter.id] = String(value);
      }
    }
    setMessage('');
    await onCommand('table.act', { actionId: action.id, inputs });
  };

  return <div className="tt-canvas-inline tt-table-actions">
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">TABLE ACTIONS</span><strong>{state.program?.title ?? 'Available actions'}</strong><small>{state.turn ? `Turn: ${turnLabel}` : 'No turn order'}</small></div>
    {expanded && readOnly && <p className="tt-table-readonly-inline" role="status">Table actions are temporarily paused. Shared records remain available above.</p>}
    {!expanded ? <p className="tt-canvas-inline__note">Open this object to choose an allowed action. The server checks each change before updating shared records.</p> : !state.program ? <p className="tt-canvas-inline__empty">Activate a reviewed table rule set before participants can make changes.</p> : actions.filter((action) => action.roles.includes(currentActorRole)).length === 0 ? <p className="tt-canvas-inline__empty">No actions are available to this seat.</p> : <div className="tt-table-action-list">{actions.filter((action) => action.roles.includes(currentActorRole)).map((action) => <ActionForm key={`${view.id}-${view.epoch}-${view.actor.actorId}-${action.id}`} action={action} state={state} currentSeat={currentSeat} busy={busy !== null} values={values[action.id] ?? {}} onUpdate={update} onSubmit={submit} />)}</div>}
    {message && <p className="tt-table-error" role="alert">{message}</p>}
    <p className="tt-table-turn-indicator">Acting as {view.actor.name}{view.actor.seat ? ` · ${view.actor.seat.replace('member-', 'Member ')}` : ' · Owner'}{state.turn ? ` · current turn: ${turnLabel}` : ''}</p>
  </div>;
}

function ActionForm({ action, state, currentSeat, busy, values, onUpdate, onSubmit }: { action: TableAction; state: TableState; currentSeat: string; busy: boolean; values: Record<string, string | number | boolean>; onUpdate: (actionId: string, paramId: string, value: string | number | boolean) => void; onSubmit: (event: FormEvent<HTMLFormElement>, action: TableAction) => Promise<void> }) {
  const turnBlocked = action.requireTurn && state.turn !== currentSeat;
  const submit = (event: FormEvent<HTMLFormElement>) => { void onSubmit(event, action); };
  return <form className="tt-table-action" onSubmit={submit}>
    <header><span className="tt-table-action__glyph"><Play size={14} /></span><span><strong>{action.title}</strong><small>{action.description}</small></span></header>
    {action.parameters.length > 0 && <div className="tt-table-action__inputs">{action.parameters.map((parameter) => {
      const id = `tt-table-${action.id}-${parameter.id}`;
      const value = values[parameter.id] ?? (parameter.type === 'boolean' ? false : '');
      const recordChoices = parameter.type === 'record' ? state.records[parameter.collection ?? ''] ?? [] : [];
      const choices = parameter.choices ?? [];
      return <label key={parameter.id} htmlFor={id}>{parameter.label}
        {parameter.type === 'boolean' ? <span className="tt-table-action__boolean"><input id={id} type="checkbox" checked={Boolean(value)} disabled={busy} onChange={(event) => onUpdate(action.id, parameter.id, event.target.checked)} /> Yes</span>
          : parameter.type === 'record' ? <select id={id} value={String(value)} disabled={busy} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose a record</option>{recordChoices.map((record) => <option value={record.id} key={record.id}>{recordLabel(record, state.program?.collections.find((collection) => collection.id === parameter.collection))}</option>)}</select>
            : parameter.type === 'text' && choices.length > 0 ? <select id={id} value={String(value)} disabled={busy} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required><option value="">Choose…</option>{choices.map((choice) => <option key={choice} value={choice}>{choice}</option>)}</select>
              : <input id={id} type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.type === 'number' ? parameter.min : undefined} max={parameter.type === 'number' ? parameter.max : undefined} step={parameter.type === 'number' ? 'any' : undefined} maxLength={parameter.type === 'text' ? 500 : undefined} value={String(value)} disabled={busy} onChange={(event) => onUpdate(action.id, parameter.id, event.target.value)} required />}
      </label>;
    })}</div>}
    {action.conditions.length > 0 && <section className="tt-table-program__group" aria-label="Requirements"><h4>Requirements</h4><ul className="tt-table-rule-list">{action.conditions.map((condition, index) => <li key={index}><strong>{operandLabel(condition.left, action, state.program ?? undefined)} {conditionOperator(condition.op)} {operandLabel(condition.right, action, state.program ?? undefined)}</strong></li>)}</ul></section>}
    {turnBlocked && <p className="tt-table-turn-blocked" role="status">Waiting for {state.turn === 'host' ? 'the owner' : state.turn?.replace('member-', 'Member ')} to act.</p>}
    <button type="submit" className="tt-button tt-button--primary" disabled={busy || turnBlocked || action.parameters.some((parameter) => parameter.type === 'record' && !(state.records[parameter.collection ?? '']?.length))}><Play size={13} /> {action.title}</button>
  </form>;
}

function recordLabel(record: TableRecord, collection?: TableCollection): string {
  const titleField = collection?.fields.find((field) => field.id === 'name' || field.id === 'title' || field.id === 'id') ?? collection?.fields[0];
  const title = titleField ? displayValue(record.values[titleField.id]) : record.id;
  return title && title !== '—' ? `${title} · ${record.id}` : record.id;
}

function displayValue(value: TableValue | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function fieldTypeLabel(field: TableField): string {
  return field.type === 'number' ? 'Number' : field.type === 'boolean' ? 'Yes / no' : field.type === 'list' ? 'List' : 'Text';
}

function fieldLabel(program: TableProgram, collectionId: string, fieldId: string): string {
  return program.collections.find((collection) => collection.id === collectionId)?.fields.find((field) => field.id === fieldId)?.label ?? fieldId;
}

function operandLabel(value: TableAction['effects'][number]['value'], action: TableAction, program?: TableProgram): string {
  if ('literal' in value) return displayValue(value.literal);
  if ('input' in value) return action.parameters.find((parameter) => parameter.id === value.input)?.label ?? 'provided value';
  if ('record' in value) {
    const parameter = action.parameters.find((item) => item.id === value.record);
    return `${parameter?.label ?? 'selected record'} · ${program ? fieldLabel(program, parameter?.collection ?? '', value.field) : value.field}`;
  }
  return value.system === 'actor' ? 'the acting member' : value.system === 'seat' ? 'the current seat' : 'the current turn';
}

function conditionOperator(op: TableAction['conditions'][number]['op']): string {
  return ({ eq: 'equals', neq: 'does not equal', lt: 'is less than', lte: 'is at most', gt: 'is greater than', gte: 'is at least', contains: 'contains' })[op];
}
