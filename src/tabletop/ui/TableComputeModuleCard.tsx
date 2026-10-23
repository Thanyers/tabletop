import { useState } from 'react';
import { Code2, Play, Trash2 } from 'lucide-react';
import { viewerCan } from '../shared/permissions';
import { isComputeTableValue, type ComputeModule } from '../shared/table-compute';
import type { WorkspaceView } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import type { TableProgram } from '../shared/table-contracts';
import type { WorkbenchProps } from './types';
import { computeErrorLabel, computeInputSourceLabel, computeLatestRun, computeLatestSuccessfulRun, computePortTypeLabel, computeRunActorName, computeRunMatchesSnapshot, computeRunOutput, computeRunTime, computeRuntimeDetails, computeStatusLabel, computeValueSummary, computeScalarCell } from './table-compute-ui';
import { RuleChatActions } from './RuleChatActions';

export function TableComputeModuleCard({ module, program, state, view, busy, onCommand, onEditRules, onRemove, interactive = true }: {
  module: ComputeModule;
  program: TableProgram;
  state: TableState;
  view: WorkspaceView;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onEditRules?: (prompt?: string) => void;
  onRemove?: (removal: { kind: 'compute'; id: string; title: string }) => void;
  interactive?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState('');
  const [runFailed, setRunFailed] = useState(false);
  const [runtimeChoice, setRuntimeChoice] = useState(module.runtime);
  const canDraft = viewerCan(view, 'rules.draft');
  const canEdit = interactive && canDraft && Boolean(onEditRules);
  const canRun = interactive && viewerCan(view, 'data.compute');
  const currentVersion = state.program?.compute?.modules.some((item) => item.id === module.id && item.version === module.version) ?? false;
  const latest = interactive && currentVersion ? computeLatestRun(module.id, state.computeRuns, module) : undefined;
  const lastSuccessful = interactive && currentVersion ? computeLatestSuccessfulRun(module.id, state.computeRuns, module) : undefined;
  const lastResultIsCurrent = Boolean(lastSuccessful && computeRunMatchesSnapshot(lastSuccessful, module, state));
  const isInFlight = latest?.status === 'queued' || latest?.status === 'running';
  const profile = computeRuntimeDetails(runtimeChoice);
  const currentProfile = computeRuntimeDetails(module.runtime);
  const downstreamCount = (program.compute?.modules ?? []).filter((other) => other.id !== module.id
    && other.inputs.some((input) => input.binding.kind === 'result' && input.binding.moduleId === module.id)).length;
  const moduleOutputCount = module.outputs.length;
  const requestRun = async () => {
    if (!canRun || busy !== null || running || isInFlight) return;
    setRunning(true);
    setRunMessage('');
    setRunFailed(false);
    try {
      const result = await onCommand('table.compute.run', { moduleId: module.id });
      if (result) setRunMessage('Run requested. This card will update when the table reports the result.');
      else { setRunFailed(true); setRunMessage('The table did not accept this run. Review the table status and try again.'); }
    } catch (error) {
      setRunFailed(true);
      setRunMessage(error instanceof Error ? error.message : 'The calculation could not be started.');
    } finally {
      setRunning(false);
    }
  };
  const askForRuntime = () => onEditRules?.(`Change ${module.name} to use ${runtimeChoice === 'javascript' ? 'JavaScript' : 'Python'}. Keep its inputs and outputs the same.`);

  return <section className="tt-table-program__group tt-compute-module" aria-label={`Calculation ${module.name}`}>
    <header className="tt-rule-head">
      <h4>{module.name}</h4>
      <span className="tt-compute-module__kind">Reusable calculation</span>
      {onRemove && <button type="button" className="tt-table-rule-remove" aria-label={`Remove ${module.name}`} title="Remove from the rules" onClick={() => onRemove({ kind: 'compute', id: module.id, title: module.name })}><Trash2 size={13} /></button>}
    </header>
    {module.description && <p className="tt-rule-description">{module.description}</p>}
    {(downstreamCount > 0 || module.outputs.some((output) => output.type === 'table' && output.collectionId)) && <p className="tt-compute-module__reuse">Reusable result {downstreamCount === 1 ? 'feeds 1 other calculation' : downstreamCount > 1 ? `feeds ${downstreamCount} other calculations` : ''}{downstreamCount > 0 && module.outputs.some((output) => output.type === 'table' && output.collectionId) ? ' and ' : ''}{module.outputs.some((output) => output.type === 'table' && output.collectionId) ? 'appears on linked table cards' : ''}.</p>}
    {module.inputs.length > 0 ? <ul className="tt-compute-module__ports" aria-label={`${module.name} inputs`}>
      {module.inputs.map((input) => <li key={input.id}>
        <span><strong>{input.label}</strong><small>From {computeInputSourceLabel(input, state, program.compute?.modules ?? [], program, view.actor, view.members)}</small></span>
        <span className="tt-compute-module__type">{computePortTypeLabel(input.type)}</span>
      </li>)}
    </ul> : <p className="tt-rule-plain">This calculation uses no outside inputs.</p>}
    <p className="tt-compute-module__outputs">Makes {module.outputs.map((output) => `${output.label} (${computePortTypeLabel(output.type)})`).join(', ')}.</p>

    {!interactive ? <p className="tt-rule-meta">Not active yet · this calculation can run after the proposed rules are applied.</p> : latest ? <div className={`tt-compute-run tt-compute-run--${latest.status}`} aria-label={`Latest run: ${computeStatusLabel(latest.status)}`}>
      <div className="tt-compute-run__top"><strong>{computeStatusLabel(latest.status)}</strong><span>Run by {computeRunActorName(latest, view.actor, view.members)}</span></div>
      <small>{computeRunTime(latest)} · {latest.dataRevision === undefined ? 'table data not assigned' : `table data r${latest.dataRevision}`}</small>
      {(latest.sourceIds?.length ?? 0) > 0 && <small>Used {latest.sourceIds?.map((sourceId) => state.sources.find((source) => source.id === sourceId)?.filename ?? 'a source file').join(', ')}</small>}
      {latest.errorCode && <p className="tt-compute-run__error" role="status">{computeErrorLabel(latest.errorCode)}</p>}
    </div> : <p className="tt-rule-meta">No run yet · {moduleOutputCount} {moduleOutputCount === 1 ? 'output' : 'outputs'}</p>}

    {lastSuccessful && <section className="tt-compute-results" aria-label={`Last results from ${module.name}`}>
      <h5>{lastResultIsCurrent ? 'Latest results' : 'Last completed results'}</h5>
      <ul>{module.outputs.map((output) => {
        const value = computeRunOutput(lastSuccessful, output.id);
        return value === undefined ? null : <li key={output.id}>
          <span><strong>{output.label}</strong><small>{computePortTypeLabel(output.type)}</small></span>
          {output.type === 'table'
          ? <span className="tt-compute-results__value">{computeValueSummary(value)}{output.collectionId ? ` · shown on ${program.collections.find((collection) => collection.id === output.collectionId)?.title ?? 'linked table'} card` : ''}</span>
            : <span className="tt-compute-results__value">{computeScalarCell(value)}</span>}
        </li>;
      })}</ul>
      <small>Completed by {computeRunActorName(lastSuccessful, view.actor, view.members)} · {computeRunTime(lastSuccessful)}.</small>
      {!lastResultIsCurrent && <small>This result used table data r{lastSuccessful.dataRevision ?? 'unknown'} and rules r{lastSuccessful.ruleRevision ?? 'unknown'}; current data and rules are r{state.dataRevision} and r{state.ruleRevision}. Run it again to refresh.</small>}
      {latest && latest.runId !== lastSuccessful.runId && <small>Showing the last completed result while the newest run is {computeStatusLabel(latest.status).toLowerCase()}.</small>}
    </section>}

    <div className="tt-compute-module__actions">
      {canRun && <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || running || isInFlight} onClick={() => void requestRun()}><Play size={13} aria-hidden="true" />{running || isInFlight ? 'Running…' : 'Run calculation'}</button>}
      {interactive && !canRun && <small className="tt-rule-meta">Ask a table editor to run this calculation.</small>}
      {interactive && canRun && busy === 'table.readOnly' && <small className="tt-rule-meta">This table is read-only, so calculations are paused.</small>}
      {runMessage && <p className={runFailed ? 'tt-table-error' : 'tt-table-inline-hint'} role={runFailed ? 'alert' : 'status'}>{runMessage}</p>}
      {interactive && <RuleChatActions kind="compute" id={module.id} title={module.name} detail={`reusable calculation; ${module.description}; inputs: ${module.inputs.map((input) => input.label).join(', ') || 'none'}; outputs: ${module.outputs.map((output) => output.label).join(', ')}`} canEdit={canEdit} onEdit={onEditRules} />}
    </div>

    <details className="tt-compute-advanced">
      <summary><Code2 size={14} aria-hidden="true" />Advanced · code and runtime</summary>
      <p>Selected: {profile.name} · Profile tools: {profile.libraries.join(', ')}</p>
      {runtimeChoice !== module.runtime && <p>The active module still uses {currentProfile.name}; this choice only takes effect after its rule change is reviewed and applied.</p>}
      {latest?.runtimeProfile && <p>Latest run used {currentProfile.name} · profile {latest.runtimeProfile}.</p>}
      {interactive && <label className="tt-compute-runtime-choice">Ask to use a different language
        <select value={runtimeChoice} onChange={(event) => setRuntimeChoice(event.target.value as ComputeModule['runtime'])} disabled={!canEdit}>
          <option value="javascript">JavaScript</option><option value="python">Python</option>
        </select>
      </label>}
      {interactive && runtimeChoice !== module.runtime && <button type="button" className="tt-button tt-button--quiet" disabled={!canEdit || busy !== null} onClick={askForRuntime}>Ask to switch to {runtimeChoice === 'javascript' ? 'JavaScript' : 'Python'}</button>}
      {canDraft && <details className="tt-compute-source"><summary>Show source code</summary><pre><code>{module.source}</code></pre></details>}
      {!canDraft && <p className="tt-rule-meta">Only people who can change table rules can inspect or change the module code.</p>}
      <dl className="tt-compute-technical">
        <div><dt>Module</dt><dd>{module.id} · version {module.version}</dd></div>
        <div><dt>Input bindings</dt><dd>{module.inputs.map((input) => `${input.id}: ${input.binding.kind}`).join(' · ') || 'None'}</dd></div>
        <div><dt>Output bindings</dt><dd>{module.outputs.map((output) => `${output.id}${output.collectionId ? ` → ${output.collectionId}` : ''}`).join(' · ')}</dd></div>
      </dl>
    </details>
  </section>;
}

/** Newest successful table output cards are rendered next to the source records they relate to. */
export function LinkedComputeOutputs({ collectionId, state, view, expanded = false }: { collectionId: string; state: TableState; view: WorkspaceView; expanded?: boolean }) {
  const modules = state.program?.compute?.modules ?? [];
  const runs = state.computeRuns ?? [];
  const related = modules.flatMap((module) => module.outputs
    .filter((output) => output.type === 'table' && output.collectionId === collectionId)
    .flatMap((output) => {
      const run = computeLatestSuccessfulRun(module.id, runs, module);
      const value = run ? computeRunOutput(run, output.id) : undefined;
      return run && value && isComputeTableValue(value) ? [{ module, output, run, value, isCurrent: computeRunMatchesSnapshot(run, module, state) }] : [];
    }));
  if (related.length === 0) return null;
  if (!expanded) return <p className="tt-linked-compute__preview">{related.map(({ output, value, isCurrent }) => `${output.label}: ${value.rows.length} calculated ${value.rows.length === 1 ? 'row' : 'rows'}${isCurrent ? '' : ' · needs refresh'}`).join(' · ')}</p>;
  return <section className="tt-linked-compute" aria-label={`Calculated results for ${state.program?.collections.find((collection) => collection.id === collectionId)?.title ?? 'this table'}`}>
    <h4>Calculated results</h4>
    {related.map(({ module, output, run, value, isCurrent }) => <div className="tt-linked-compute__result" key={`${module.id}:${output.id}`}>
      <div className="tt-linked-compute__heading"><strong>{output.label}</strong><span>from {module.name} · {value.rows.length} {value.rows.length === 1 ? 'row' : 'rows'}{isCurrent ? '' : ' · earlier result'}</span></div>
      {!isCurrent && <p className="tt-rule-meta">This result used table data r{run.dataRevision ?? 'unknown'} and rules r{run.ruleRevision ?? 'unknown'}; current data and rules are r{state.dataRevision} and r{state.ruleRevision}. Run it again to refresh.</p>}
      <div className="tt-table-grid-scroll"><table className="tt-table-grid"><caption>{output.label} · calculated result</caption><thead><tr>{value.columns.map((column) => <th scope="col" key={column.id}>{column.label}</th>)}</tr></thead><tbody>{value.rows.length > 0 ? value.rows.map((row, rowIndex) => <tr key={`${run.runId}:${rowIndex}`}>{value.columns.map((column) => <td key={column.id}>{computeScalarCell(row[column.id])}</td>)}</tr>) : <tr><td colSpan={value.columns.length}>No rows matched this calculation.</td></tr>}</tbody></table></div>
      <small>Calculated by {computeRunActorName(run, view.actor, view.members)} · {computeRunTime(run)} · based on table data r{run.dataRevision}. Source records are unchanged.</small>
    </div>)}
  </section>;
}

export function hasLinkedComputeOutput(collectionId: string, state: TableState): boolean {
  const modules = state.program?.compute?.modules ?? [];
  return modules.some((module) => module.outputs.some((output) => {
    if (output.type !== 'table' || output.collectionId !== collectionId) return false;
    const run = computeLatestSuccessfulRun(module.id, state.computeRuns, module);
    const value = run ? computeRunOutput(run, output.id) : undefined;
    return Boolean(run && value !== undefined && isComputeTableValue(value));
  }));
}

