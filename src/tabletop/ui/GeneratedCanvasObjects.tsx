import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type PointerEvent as ReactPointerEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Pause, Play } from 'lucide-react';
import type { ActorContext } from '../shared/contracts';
import type { ControlDescriptor, GenerativeCanvas, GenerativeScalar, GenerativeViewDescriptor } from '../shared/generative-contracts';
import type { TableAction, TableParameter, TableRecord, TableState, TableValue } from '../shared/table-contracts';
import { DICE_LIMITS, diceTotalFitsParameter, diePips, rollDice, type DiceRoll } from '../shared/dice';
import { handleTableCommand } from '../domain/table';
import { evaluateGenerativeCanvas, type EvaluatedControl, type EvaluatedGenerativeView, type EvaluatedScenePrimitive } from '../runtime/generative/evaluator';
import type { WorkspaceView } from '../shared/contracts';
import type { Command } from './types';
import { applySceneMotion, MOTION_FRAME_MS, sceneHasMotion } from './scene-motion';
import { controlDraftsRevision, readControlDraft, readControlDraftValue, subscribeControlDrafts, writeControlDraft, type ControlDraftTarget } from './control-drafts';
import { RollParameterControl } from './RollParameterControl';
import { serverRollFor, useServerRollsTick } from './roll-store';
import './generated-canvas.css';

interface LocalActionPreview {
  ownerId: string;
  state: TableState;
  action: TableAction;
  inputs: Record<string, TableValue>;
  committing: boolean;
}

interface GeneratedCanvasObjectProps {
  view: WorkspaceView;
  state: TableState;
  descriptor: GenerativeViewDescriptor;
  busy: string | null;
  onCommand: Command;
  previewOnly?: boolean;
  sandboxCommand?: Command;
  previewScope?: string;
  expanded?: boolean;
}

const previewValues = new Map<string, LocalActionPreview>();
const previewSubscribers = new Map<string, Set<() => void>>();
const projectionCache = new WeakMap<TableState, Map<string, { views?: EvaluatedGenerativeView[]; error?: string }>>();

function previewKey(view: WorkspaceView, scope = 'live'): string {
  return `${scope}:${view.id}:${view.epoch}:${view.actor.actorId}:${view.actor.role}:${view.actor.seat ?? 'host'}`;
}

export function clearGeneratedCanvasPreview(view: WorkspaceView, scope = 'live'): void {
  clearPreview(previewKey(view, scope));
}

function subscribeToPreview(key: string, listener: () => void): () => void {
  let listeners = previewSubscribers.get(key);
  if (!listeners) { listeners = new Set(); previewSubscribers.set(key, listeners); }
  listeners.add(listener);
  return () => { listeners?.delete(listener); if (listeners?.size === 0) previewSubscribers.delete(key); };
}

function publishPreview(key: string, preview: LocalActionPreview): void {
  previewValues.set(key, preview);
  previewSubscribers.get(key)?.forEach(listener => listener());
}

function clearPreview(key: string, ownerId?: string): void {
  const current = previewValues.get(key);
  if (ownerId && current?.ownerId !== ownerId) return;
  previewValues.delete(key);
  previewSubscribers.get(key)?.forEach(listener => listener());
}

function getProjection(state: TableState, view: WorkspaceView, preview?: LocalActionPreview): { views?: EvaluatedGenerativeView[]; error?: string } {
  const program = state.program;
  const canvas = program?.canvas as GenerativeCanvas | undefined;
  if (!program || !canvas) return { error: 'No generated canvas is available for this table.' };
  const action = preview?.action;
  const inputs = preview?.inputs;
  const cacheKey = `${view.actor.actorId}|${view.actor.role}|${view.actor.seat ?? 'host'}|${action?.id ?? ''}|${JSON.stringify(inputs ?? {})}`;
  let entries = projectionCache.get(state);
  if (!entries) { entries = new Map(); projectionCache.set(state, entries); }
  const cached = entries.get(cacheKey);
  if (cached) return cached;
  try {
    const result = { views: evaluateGenerativeCanvas(canvas, {
      program,
      records: state.records,
      ...(action ? { action } : {}),
      ...(inputs ? { inputs } : {}),
      actor: view.actor.actorId,
      ...(view.actor.seat ? { seat: view.actor.seat } : {}),
      turn: state.turn,
    }) };
    entries.set(cacheKey, result);
    return result;
  } catch (error) {
    const result = { error: error instanceof Error ? error.message : 'The generated view could not be evaluated.' };
    entries.set(cacheKey, result);
    return result;
  }
}

export function GeneratedCanvasObject({ view, state, descriptor, busy, onCommand, previewOnly = false, sandboxCommand, previewScope = 'live', expanded = false }: GeneratedCanvasObjectProps) {
  const key = previewKey(view, previewScope);
  const subscribe = useCallback((listener: () => void) => subscribeToPreview(key, listener), [key]);
  const getSnapshot = useCallback(() => previewValues.get(key), [key]);
  const localPreview = useSyncExternalStore(subscribe, getSnapshot, () => undefined);
  const [actionError, setActionError] = useState('');
  const sandboxEnabled = previewOnly && sandboxCommand !== undefined;
  const activePreview = !previewOnly || sandboxEnabled ? localPreview : undefined;
  const renderedState = activePreview?.state ?? state;
  const projection = getProjection(renderedState, view, activePreview);
  const actionProjection = getProjection(state, view);
  const projectedView = projection.views?.find(item => item.id === descriptor.id && item.kind === descriptor.kind);
  const actionProjectedView = actionProjection.views?.find(item => item.id === descriptor.id && item.kind === descriptor.kind);
  const program = renderedState.program;
  const currentDescriptor = program?.canvas?.views.find(item => item.id === descriptor.id && item.kind === descriptor.kind);
  const allBusy = busy !== null || Boolean(activePreview?.committing);

  const simulate = useCallback((action: TableAction, inputs: Record<string, TableValue>, ownerId: string): TableState | null => {
    if (previewOnly && !sandboxCommand) return null;
    const unavailable = actionUnavailableReason(action, state, view, busy);
    if (unavailable) { setActionError(unavailable); clearPreview(key, ownerId); return null; }
    // F048: the pending roll only exists on the server, so a roll action cannot be previewed locally.
    if (action.parameters.some(parameter => parameter.type === 'roll')) return null;
    try {
      const result = handleTableCommand(structuredClone(state), 'table.act', { actionId: action.id, inputs }, localActorContext(view));
      if (!result) throw new Error('This table action is not available.');
      publishPreview(key, { ownerId, state: result.state, action, inputs, committing: false });
      setActionError('');
      return result.state;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The table action could not be previewed.');
      clearPreview(key, ownerId);
      return null;
    }
  }, [state, view, busy, key, previewOnly, sandboxCommand]);

  const commit = useCallback(async (action: TableAction, inputs: Record<string, TableValue>, ownerId: string): Promise<boolean> => {
    if (previewOnly && !sandboxCommand) return false;
    const unavailable = actionUnavailableReason(action, state, view, busy);
    if (unavailable) { setActionError(unavailable); clearPreview(key, ownerId); return false; }
    // F048: a roll action commits straight to the server; there is no local preview to show.
    const serverRolled = action.parameters.some(parameter => parameter.type === 'roll');
    if (!serverRolled) {
      const localState = simulate(action, inputs, ownerId);
      if (!localState) return false;
      publishPreview(key, { ownerId, state: localState, action, inputs, committing: true });
    }
    try {
      const updated = await (sandboxCommand ?? onCommand)('table.act', { actionId: action.id, inputs });
      if (!updated) {
        clearPreview(key, ownerId);
        setActionError('The action was not applied. Refresh the table before trying again.');
        return false;
      }
      clearPreview(key, ownerId);
      setActionError('');
      return true;
    } catch (error) {
      clearPreview(key, ownerId);
      setActionError(error instanceof Error ? error.message : 'The table action could not be applied.');
      return false;
    }
  }, [state, view, busy, key, onCommand, sandboxCommand, simulate, previewOnly]);

  /** F048: ask the authority for the dice. The value is never typed by the client. */
  const roll = useCallback(async (actionId: string, parameterId: string): Promise<boolean> => {
    if (previewOnly) { setActionError('Rolls are available once this table is active.'); return false; }
    const action = state.program?.actions.find(item => item.id === actionId);
    const unavailable = action ? actionUnavailableReason(action, state, view, busy) : 'The action is unavailable.';
    if (unavailable) { setActionError(unavailable); return false; }
    try {
      await onCommand('table.roll', { actionId, parameterId });
      setActionError('');
      return true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'The roll could not be made.');
      return false;
    }
  }, [busy, onCommand, previewOnly, state, view]);

  const content = projectedView && currentDescriptor ? <GeneratedViewContent
    projected={projectedView}
    actionProjected={actionProjectedView}
    descriptor={currentDescriptor}
    actionState={state}
    workspaceView={view}
    previewOnly={previewOnly}
    sandboxEnabled={sandboxEnabled}
    previewStoreKey={key}
    busy={allBusy}
    onSimulate={simulate}
    onCommit={commit}
    onRoll={roll}
  /> : <p className="tt-generated-canvas__error" role="status">{projection.error ?? 'This generated view is no longer part of the active table.'}</p>;

  return <section className={'tt-canvas-inline tt-generated-canvas' + (expanded ? ' tt-generated-canvas--expanded' : '')} aria-label={descriptor.title}>
    <div className="tt-canvas-inline__heading"><span className="tt-kicker">{previewOnly ? 'PROPOSED VIEW' : 'GENERATED VIEW'}</span><strong>{descriptor.title}</strong></div>
    {previewOnly && <p className="tt-canvas-inline__note">{sandboxEnabled ? 'Private trial · actions change this preview only.' : 'Preview only · changes are not sent to the table.'}</p>}
    {content}
    {actionError && <p className="tt-table-error" role="alert">{actionError}</p>}
  </section>;
}

function GeneratedViewContent({ projected, actionProjected, descriptor, actionState, workspaceView, previewOnly, sandboxEnabled, previewStoreKey, busy, onSimulate, onCommit, onRoll }: {
  projected: EvaluatedGenerativeView;
  actionProjected?: EvaluatedGenerativeView;
  descriptor: GenerativeViewDescriptor;
  actionState: TableState;
  workspaceView: WorkspaceView;
  previewOnly: boolean;
  sandboxEnabled: boolean;
  previewStoreKey: string;
  busy: boolean;
  onSimulate: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => TableState | null;
  onCommit: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => Promise<boolean>;
  onRoll: (actionId: string, parameterId: string) => Promise<boolean>;
}) {
  if (projected.kind === 'metric' && descriptor.kind === 'metric') return <MetricView projected={projected} />;
  if (projected.kind === 'chart' && descriptor.kind === 'chart') return <ChartView projected={projected} expanded={previewOnly || false} />;
  if (projected.kind === 'scene' && descriptor.kind === 'scene') return <SceneView projected={projected} actionProjected={actionProjected?.kind === 'scene' ? actionProjected : undefined} descriptor={descriptor} state={actionState} workspaceView={workspaceView} previewOnly={previewOnly} sandboxEnabled={sandboxEnabled} previewStoreKey={previewStoreKey} busy={busy} onSimulate={onSimulate} onCommit={onCommit} />;
  if (projected.kind === 'controls' && descriptor.kind === 'controls') {
    if (actionProjected?.kind !== 'controls') return <p className="tt-generated-canvas__error" role="status">Controls are unavailable until the committed table state can be evaluated.</p>;
    return <ControlsView projected={actionProjected} state={actionState} workspaceView={workspaceView} previewOnly={previewOnly} sandboxEnabled={sandboxEnabled} previewStoreKey={previewStoreKey} busy={busy} onSimulate={onSimulate} onCommit={onCommit} onRoll={onRoll} />;
  }
  return <p className="tt-generated-canvas__error" role="status">The generated view type does not match its descriptor.</p>;
}

function MetricView({ projected }: { projected: Extract<EvaluatedGenerativeView, { kind: 'metric' }> }) {
  const value = projected.value;
  const formatted = projected.format === 'percent' && typeof value === 'number'
    ? new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(value)
    : projected.format === 'number' && typeof value === 'number'
      ? new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value)
      : value === null ? '—' : typeof value === 'boolean' ? value ? 'Yes' : 'No' : String(value);
  return <div className="tt-generated-metric" role="status" aria-live="polite"><strong>{formatted}</strong></div>;
}

function ChartView({ projected, expanded }: { projected: Extract<EvaluatedGenerativeView, { kind: 'chart' }>; expanded: boolean }) {
  const points = projected.points;
  const viewWidth = 480;
  const viewHeight = 220;
  const left = 38;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const plotWidth = viewWidth - left - right;
  const plotHeight = viewHeight - top - bottom;
  const values = points.map(point => point.value);
  const lower = Math.min(0, ...values);
  const upper = Math.max(0, ...values);
  const span = upper - lower || 1;
  const yAt = (value: number) => top + (upper - value) / span * plotHeight;
  const baseline = yAt(0);
  const pointX = (index: number) => left + (points.length <= 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth);
  const lineD = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${pointX(index).toFixed(2)},${yAt(point.value).toFixed(2)}`).join(' ');
  const labelEvery = Math.max(1, Math.ceil(points.length / (expanded ? 12 : 8)));
  const color = projected.color ?? '#24796b';
  const barWidth = Math.max(1, Math.min(32, plotWidth / Math.max(points.length, 1) * 0.68));

  return <div className="tt-generated-chart">
    <svg viewBox={`0 0 ${viewWidth} ${viewHeight}`} role="img" aria-label={`${projected.chart} chart with ${points.length} data points`} preserveAspectRatio="xMidYMid meet">
      <line x1={left} y1={top} x2={left} y2={viewHeight - bottom} className="tt-generated-chart__axis" />
      <line x1={left} y1={baseline} x2={viewWidth - right} y2={baseline} className="tt-generated-chart__axis" />
      <text x={left - 6} y={top + 4} textAnchor="end" className="tt-generated-chart__tick">{formatNumber(upper)}</text>
      <text x={left - 6} y={viewHeight - bottom} textAnchor="end" className="tt-generated-chart__tick">{formatNumber(lower)}</text>
      {projected.chart === 'bar' && points.map((point, index) => {
        const y = yAt(Math.max(0, point.value));
        const height = Math.abs(yAt(point.value) - baseline);
        return <g key={point.id}><rect x={pointX(index) - barWidth / 2} y={Math.min(y, baseline)} width={barWidth} height={Math.max(1, height)} rx="2" fill={color}><title>{`${String(point.category ?? 'Unlabelled')}: ${formatNumber(point.value)}`}</title></rect>{(points.length <= 12 || index % labelEvery === 0) && <text x={pointX(index)} y={viewHeight - 10} textAnchor="middle" className="tt-generated-chart__label">{truncate(String(point.category ?? '—'), 14)}</text>}</g>;
      })}
      {projected.chart === 'line' && <><path d={lineD} fill="none" stroke={color} strokeWidth="2.5" />{points.map((point, index) => <circle key={point.id} cx={pointX(index)} cy={yAt(point.value)} r="3.5" fill={color}><title>{`${String(point.category ?? 'Unlabelled')}: ${formatNumber(point.value)}`}</title></circle>)}</>}
      {projected.chart === 'scatter' && points.map((point, index) => <circle key={point.id} cx={pointX(index)} cy={yAt(point.value)} r="4" fill={color}><title>{`${String(point.category ?? 'Unlabelled')}: ${formatNumber(point.value)}`}</title></circle>)}
    </svg>
    <details className="tt-generated-chart__data"><summary>View data · {points.length} points</summary><div className="tt-table-grid-scroll"><table className="tt-table-grid"><thead><tr><th scope="col">Category</th><th scope="col">Value</th></tr></thead><tbody>{points.map(point => <tr key={point.id}><td>{String(point.category ?? '—')}</td><td>{formatNumber(point.value)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined'
    && typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** F040: seconds since this scene started playing; pauses without losing the position. */
function useSceneClock(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const offset = useRef(0);
  useEffect(() => {
    if (!active || typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return;
    let frame = 0;
    let last = 0;
    const startedAt = performance.now() - offset.current * 1000;
    const sample = (now: number) => {
      if (now - last >= MOTION_FRAME_MS) {
        last = now;
        const next = (now - startedAt) / 1000;
        offset.current = next;
        setElapsed(next);
      }
      frame = window.requestAnimationFrame(sample);
    };
    frame = window.requestAnimationFrame(sample);
    return () => window.cancelAnimationFrame(frame);
  }, [active]);
  return elapsed;
}

function SceneView({ projected, actionProjected, descriptor, state, workspaceView, previewOnly, sandboxEnabled, previewStoreKey, busy, onSimulate, onCommit }: {
  projected: Extract<EvaluatedGenerativeView, { kind: 'scene' }>;
  actionProjected?: Extract<EvaluatedGenerativeView, { kind: 'scene' }>;
  descriptor: Extract<GenerativeViewDescriptor, { kind: 'scene' }>;
  state: TableState;
  workspaceView: WorkspaceView;
  previewOnly: boolean;
  sandboxEnabled: boolean;
  previewStoreKey: string;
  busy: boolean;
  onSimulate: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => TableState | null;
  onCommit: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => Promise<boolean>;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragSession | null>(null);
  const keyboardActions = useRef(new Map<string, { action: TableAction; inputs: Record<string, TableValue> }>());
  const [dragging, setDragging] = useState(false);
  const key = previewStoreKey;
  const width = clamp(projected.width, 1, 4096);
  const height = clamp(projected.height, 1, 4096);
  const actionElements = new Map(actionProjected?.elements.map(element => [element.id, element]) ?? []);
  const actorRole = tableRole(workspaceView);
  const isEnabled = (actionId: string) => {
    if (previewOnly && !sandboxEnabled || busy) return false;
    const action = state.program?.actions.find(item => item.id === actionId);
    return Boolean(action && action.roles.includes(actorRole) && (!action.requireTurn || state.turn === (workspaceView.actor.seat ?? 'host')));
  };
  const beginDrag = (event: ReactPointerEvent<SVGElement>, element: EvaluatedScenePrimitive, actionElement: EvaluatedScenePrimitive) => {
    const binding = actionElement.drag;
    if (!binding || !isEnabled(binding.actionId) || !svgRef.current) return;
    const action = state.program?.actions.find(item => item.id === binding.actionId);
    const startPointer = scenePoint(svgRef.current, event);
    if (!action || !startPointer) return;
    const anchor = sceneAnchor(element);
    event.preventDefault();
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Pointer capture is optional in test renderers. */ }
    dragRef.current = { pointerId: event.pointerId, action, binding, startPointer, startAnchor: anchor, lastInputs: dragInputs(binding, action, anchor), moved: false };
    setDragging(true);
  };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const point = scenePoint(svgRef.current, event);
    if (!point) return;
    const x = clamp(session.startAnchor.x + point.x - session.startPointer.x, 0, width);
    const y = clamp(session.startAnchor.y + point.y - session.startPointer.y, 0, height);
    const inputs = dragInputs(session.binding, session.action, { x, y });
    session.lastInputs = inputs;
    session.moved = true;
    onSimulate(session.action, inputs, `scene:${descriptor.id}:${session.binding.actionId}`);
  };
  const finishDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const point = scenePoint(svgRef.current, event);
    if (point) {
      const x = clamp(session.startAnchor.x + point.x - session.startPointer.x, 0, width);
      const y = clamp(session.startAnchor.y + point.y - session.startPointer.y, 0, height);
      session.lastInputs = dragInputs(session.binding, session.action, { x, y });
      if (x !== session.startAnchor.x || y !== session.startAnchor.y) session.moved = true;
    }
    dragRef.current = null;
    setDragging(false);
    if (session.moved && inputsAreComplete(session.action, session.lastInputs, workspaceView, state)) void onCommit(session.action, session.lastInputs, `scene:${descriptor.id}:${session.binding.actionId}`);
    else clearPreview(key, `scene:${descriptor.id}:${session.binding.actionId}`);
  };
  const cancelDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const session = dragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    clearPreview(key, `scene:${descriptor.id}:${session.binding.actionId}`);
  };
  const moveWithKeyboard = (event: ReactKeyboardEvent<SVGElement>, element: EvaluatedScenePrimitive, actionElement: EvaluatedScenePrimitive) => {
    const binding = actionElement.drag;
    if (!binding || !isEnabled(binding.actionId)) return;
    const action = state.program?.actions.find(item => item.id === binding.actionId);
    if (!action) return;
    const delta = event.shiftKey ? 10 : 1;
    const anchor = sceneAnchor(element);
    const x = clamp(anchor.x + (event.key === 'ArrowRight' ? delta : event.key === 'ArrowLeft' ? -delta : 0), 0, width);
    const y = clamp(anchor.y + (event.key === 'ArrowDown' ? delta : event.key === 'ArrowUp' ? -delta : 0), 0, height);
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    event.preventDefault();
    const inputs = dragInputs(binding, action, { x, y });
    onSimulate(action, inputs, `scene:${descriptor.id}:${binding.actionId}`);
    keyboardActions.current.set(element.id, { action, inputs });
  };
  const finishKeyboardDrag = (event: ReactKeyboardEvent<SVGElement>, element: EvaluatedScenePrimitive) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
    const pending = keyboardActions.current.get(element.id);
    keyboardActions.current.delete(element.id);
    if (pending) void onCommit(pending.action, pending.inputs, `scene:${descriptor.id}:${pending.action.id}`);
  };
  const reducedMotion = useReducedMotion();
  const hasMotion = sceneHasMotion(projected.elements);
  const [playing, setPlaying] = useState(true);
  const seconds = useSceneClock(hasMotion && playing && !reducedMotion);

  return <div className="tt-generated-scene-wrap">
    <svg ref={svgRef} className={'tt-generated-scene' + (dragging ? ' is-dragging' : '')} viewBox={`0 0 ${width} ${height}`} role="group" aria-label={`${descriptor.title} scene`} preserveAspectRatio="xMidYMid meet" onPointerMove={moveDrag} onPointerUp={finishDrag} onPointerCancel={cancelDrag} onLostPointerCapture={cancelDrag}>
      <rect className="tt-generated-scene__background" x="0" y="0" width={width} height={height} rx="6" />
      {projected.elements.map(element => {
        const actionElement = actionElements.get(element.id);
        const draggable = Boolean(actionElement?.drag && (!previewOnly || sandboxEnabled) && isEnabled(actionElement.drag.actionId));
        const shown = seconds > 0 ? applySceneMotion(element, seconds) : element;
        return <ScenePrimitive key={element.id} element={shown} sceneWidth={width} sceneHeight={height} draggable={draggable} animated={Boolean('motion' in element && element.motion)} onPointerDown={event => { if (actionElement) beginDrag(event, element, actionElement); }} onKeyDown={event => { if (actionElement) moveWithKeyboard(event, element, actionElement); }} onKeyUp={event => finishKeyboardDrag(event, element)} />;
      })}
    </svg>
    {actionProjected?.elements.some(element => element.drag) && <p className="tt-canvas-inline__note">Drag a marked shape or focus it and use the arrow keys. The table changes when you release.</p>}
    {hasMotion && (reducedMotion
      ? <p className="tt-canvas-inline__note" role="status">Motion is paused because this device asks for reduced motion. The table values still update normally.</p>
      : <div className="tt-generated-scene__motion"><button type="button" className="tt-button tt-button--quiet" aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? <Pause size={13} /> : <Play size={13} />}{playing ? 'Pause motion' : 'Play motion'}</button><p className="tt-canvas-inline__note">The scene moves on its own and loops. Table values are not changed by the animation.</p></div>)}
  </div>;
}

function ScenePrimitive({ element, sceneWidth, sceneHeight, draggable, animated, onPointerDown, onKeyDown, onKeyUp }: {
  element: EvaluatedScenePrimitive;
  sceneWidth: number;
  sceneHeight: number;
  draggable: boolean;
  animated: boolean;
  onPointerDown: (event: ReactPointerEvent<SVGElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<SVGElement>) => void;
  onKeyUp: (event: ReactKeyboardEvent<SVGElement>) => void;
}) {
  const interactive = draggable && Boolean(element.drag);
  const common = {
    className: 'tt-generated-scene__shape' + (interactive ? ' is-draggable' : '') + (animated ? ' is-animated' : ''),
    fill: 'fill' in element ? element.fill ?? 'none' : undefined,
    stroke: 'stroke' in element ? element.stroke ?? 'none' : undefined,
    strokeWidth: 'strokeWidth' in element ? clamp(element.strokeWidth ?? 1.5, 0, 32) : undefined,
    tabIndex: interactive ? 0 : undefined,
    role: interactive ? 'button' : undefined,
    'aria-label': interactive ? `Move ${element.id}` : undefined,
    'aria-roledescription': interactive ? 'draggable scene element' : undefined,
    onPointerDown: interactive ? onPointerDown : undefined,
    onKeyDown: interactive ? onKeyDown : undefined,
    onKeyUp: interactive ? onKeyUp : undefined,
    'data-drag-enabled': interactive ? 'true' : undefined,
  };
  if (element.shape === 'rect') return <rect {...common} x={clamp(element.x, 0, sceneWidth)} y={clamp(element.y, 0, sceneHeight)} width={clamp(element.width, 0, sceneWidth)} height={clamp(element.height, 0, sceneHeight)} rx={clamp(element.rx ?? 0, 0, 64)} />;
  if (element.shape === 'circle') return <circle {...common} cx={clamp(element.cx, 0, sceneWidth)} cy={clamp(element.cy, 0, sceneHeight)} r={clamp(element.r, 0, Math.max(sceneWidth, sceneHeight))} />;
  if (element.shape === 'line') return <line {...common} x1={clamp(element.x1, 0, sceneWidth)} y1={clamp(element.y1, 0, sceneHeight)} x2={clamp(element.x2, 0, sceneWidth)} y2={clamp(element.y2, 0, sceneHeight)} />;
  if (element.shape === 'polygon') return <polygon {...common} points={element.points.map(point => `${clamp(point.x, 0, sceneWidth)},${clamp(point.y, 0, sceneHeight)}`).join(' ')} />;
  return <text {...common} x={clamp(element.x, 0, sceneWidth)} y={clamp(element.y, 0, sceneHeight)} fontSize={clamp(element.fontSize ?? 14, 8, 48)}>{element.text}</text>;
}

interface DragSession {
  pointerId: number;
  action: TableAction;
  binding: NonNullable<EvaluatedScenePrimitive['drag']>;
  startPointer: { x: number; y: number };
  startAnchor: { x: number; y: number };
  lastInputs: Record<string, TableValue>;
  moved: boolean;
}

const CONTROL_DRAFTS_SERVER_REVISION = (): number => 0;

/** F049: subscribe one canvas card to the shared draft store so a dice value reaches another card. */
function useControlDraftsVersion(): number {
  return useSyncExternalStore(subscribeControlDrafts, controlDraftsRevision, CONTROL_DRAFTS_SERVER_REVISION);
}

function draftTarget(workspaceId: string, actionId: string, parameterId: string): ControlDraftTarget {
  return { workspaceId, actionId, parameterId };
}

function draftSlotKey(actionId: string, parameterId: string): string {
  return `${actionId}\u0000${parameterId}`;
}

/**
 * Reads the shared drafts for one controls view. `revision` comes from `useSyncExternalStore`
 * and only exists so a store change re-renders every card that binds the same parameter.
 */
function collectSharedControlValues(workspaceId: string, controls: EvaluatedControl[], revision: number): Map<string, TableValue> {
  void revision;
  const values = new Map<string, TableValue>();
  for (const control of controls) {
    for (const [parameterId, binding] of Object.entries(control.descriptor.inputs)) {
      if (binding.kind !== 'control') continue;
      const entry = readControlDraft(draftTarget(workspaceId, control.descriptor.actionId, parameterId));
      if (entry) values.set(draftSlotKey(control.descriptor.actionId, parameterId), entry.value);
    }
  }
  return values;
}

export interface ControlSubmissionGate {
  inFlight: Set<string>;
  submitted: Map<string, string>;
}

export function createControlSubmissionGate(): ControlSubmissionGate {
  return { inFlight: new Set(), submitted: new Map() };
}

export function beginControlSubmission(gate: ControlSubmissionGate, controlId: string, signature: string): boolean {
  if (gate.inFlight.has(controlId) || gate.submitted.get(controlId) === signature) return false;
  gate.submitted.delete(controlId);
  gate.inFlight.add(controlId);
  return true;
}

export function finishControlSubmission(gate: ControlSubmissionGate, controlId: string, signature: string, committed: boolean): void {
  gate.inFlight.delete(controlId);
  if (committed) gate.submitted.set(controlId, signature);
  else if (gate.submitted.get(controlId) === signature) gate.submitted.delete(controlId);
}

export function controlSubmissionSignature(view: WorkspaceView, state: TableState, action: TableAction, inputs: Record<string, TableValue>, controlType: EvaluatedControl['descriptor']['kind']): string {
  const orderedInputs = Object.keys(inputs).sort().map(id => [id, inputs[id]]);
  return JSON.stringify([controlType, view.id, view.epoch, view.revision, state.dataRevision, state.ruleRevision, state.actionRevision, action.id, orderedInputs]);
}

export function beginRangeCommit(committedRanges: Set<string>, id: string): boolean {
  if (committedRanges.has(id)) return false;
  committedRanges.add(id);
  return true;
}

function scenePoint(svg: SVGSVGElement | null, event: ReactPointerEvent<SVGElement | SVGSVGElement>): { x: number; y: number } | null {
  const matrix = svg?.getScreenCTM();
  if (!svg || !matrix) return null;
  try {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(matrix.inverse());
    return Number.isFinite(local.x) && Number.isFinite(local.y) ? { x: local.x, y: local.y } : null;
  } catch { return null; }
}

function sceneAnchor(element: EvaluatedScenePrimitive): { x: number; y: number } {
  if (element.shape === 'rect') return { x: element.x, y: element.y };
  if (element.shape === 'circle') return { x: element.cx, y: element.cy };
  if (element.shape === 'line') return { x: (element.x1 + element.x2) / 2, y: (element.y1 + element.y2) / 2 };
  if (element.shape === 'polygon') return { x: element.points.reduce((sum, point) => sum + point.x, 0) / element.points.length, y: element.points.reduce((sum, point) => sum + point.y, 0) / element.points.length };
  return { x: element.x, y: element.y };
}

function dragInputs(binding: NonNullable<EvaluatedScenePrimitive['drag']>, action: TableAction, position: { x: number; y: number }): Record<string, TableValue> {
  const inputs = { ...binding.inputs };
  inputs[binding.xParameter] = position.x;
  if (binding.yParameter) inputs[binding.yParameter] = position.y;
  return Object.fromEntries(action.parameters.map(parameter => [parameter.id, inputs[parameter.id]]).filter(([, value]) => value !== undefined)) as Record<string, TableValue>;
}

function ControlsView({ projected, state, workspaceView, previewOnly, sandboxEnabled, previewStoreKey, busy, onSimulate, onCommit, onRoll }: {
  projected: Extract<EvaluatedGenerativeView, { kind: 'controls' }>;
  state: TableState;
  workspaceView: WorkspaceView;
  previewOnly: boolean;
  sandboxEnabled: boolean;
  previewStoreKey: string;
  busy: boolean;
  onSimulate: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => TableState | null;
  onCommit: (action: TableAction, inputs: Record<string, TableValue>, ownerId: string) => Promise<boolean>;
  onRoll: (actionId: string, parameterId: string) => Promise<boolean>;
}) {
  const [drafts, setDrafts] = useState<Record<string, Record<string, TableValue>>>({});
  // The form whose last submit was missing a value, so it can say so instead of doing nothing.
  const [incomplete, setIncomplete] = useState<string | null>(null);
  const draftRef = useRef(drafts);
  const submissionGate = useRef<ControlSubmissionGate | null>(null);
  if (!submissionGate.current) submissionGate.current = createControlSubmissionGate();
  const committedRanges = useRef(new Set<string>());
  draftRef.current = drafts;
  // F049: the dice card writes into this store; every card that binds the same action parameter reads it.
  const draftsVersion = useControlDraftsVersion();
  const sharedValues = collectSharedControlValues(workspaceView.id, projected.controls, draftsVersion);
  const sharedControlValues = (control: EvaluatedControl, action: TableAction): Record<string, TableValue> => {
    const values: Record<string, TableValue> = {};
    for (const parameter of action.parameters) {
      if (control.descriptor.inputs[parameter.id]?.kind !== 'control') continue;
      const shared = sharedValues.get(draftSlotKey(control.descriptor.actionId, parameter.id));
      if (shared !== undefined) values[parameter.id] = shared;
    }
    return values;
  };
  const controlValuesFor = (control: EvaluatedControl, action: TableAction | undefined): Record<string, TableValue> => ({
    ...initialControlValues(control, action),
    ...(draftRef.current[control.descriptor.id] ?? {}),
    ...(action ? sharedControlValues(control, action) : {}),
  });
  // F048: re-render the completeness check when a server roll lands or the table data moves on.
  useServerRollsTick();
  const disabledReason = (action: TableAction | undefined, control: EvaluatedControl) => previewOnly && !sandboxEnabled ? 'Preview only.'
    : busy ? 'A table action is in progress.'
      : !action ? 'The action is unavailable.'
        : action.parameters.some(parameter => parameter.type === 'roll') && control.descriptor.kind !== 'form'
          ? 'Roll actions need a form control.'
          : actionUnavailableReason(action, state, workspaceView, null);

  const updateDraft = (control: EvaluatedControl, action: TableAction, parameterId: string, value: TableValue) => {
    const ownerId = `control:${control.descriptor.id}`;
    committedRanges.current.delete(control.descriptor.id);
    // Start from the shown defaults and shared values, so fields the person did not touch still count.
    const next = { ...controlValuesFor(control, action), [parameterId]: value };
    draftRef.current = { ...draftRef.current, [control.descriptor.id]: next };
    setDrafts(draftRef.current);
    // Editing a parameter that another card already published keeps both cards on the same value.
    const target = draftTarget(workspaceView.id, action.id, parameterId);
    if (readControlDraft(target)) writeControlDraft(target, value, ownerId);
    const inputs = resolvedActionInputs(control, next, action);
    if (inputsAreComplete(action, inputs, workspaceView, state)) onSimulate(action, inputs, ownerId);
    else clearPreview(previewStoreKey, ownerId);
  };

  const commitControl = async (control: EvaluatedControl, action: TableAction, inputs: Record<string, TableValue>) => {
    const id = control.descriptor.id;
    if (!inputsAreComplete(action, inputs, workspaceView, state)) return;
    const signature = controlSubmissionSignature(workspaceView, state, action, inputs, control.descriptor.kind);
    const gate = submissionGate.current!;
    if (!beginControlSubmission(gate, id, signature)) return;
    let committed = false;
    try {
      committed = await onCommit(action, inputs, `control:${id}`);
      if (committed) {
        const next = { ...draftRef.current };
        delete next[id];
        draftRef.current = next;
        setDrafts(next);
      }
    } finally { finishControlSubmission(gate, id, signature, committed); }
  };

  const submit = (event: FormEvent<HTMLFormElement>, control: EvaluatedControl, action: TableAction) => {
    event.preventDefault();
    const values = controlValuesFor(control, action);
    const inputs = resolvedActionInputs(control, values, action);
    if (!inputsAreComplete(action, inputs, workspaceView, state)) {
      setIncomplete(control.descriptor.id);
      return;
    }
    setIncomplete(null);
    void commitControl(control, action, inputs);
  };

  return <div className="tt-generated-controls">
    {projected.controls.length === 0 && <p className="tt-canvas-inline__empty">No controls are defined for this view.</p>}
    {projected.controls.map(control => {
      const descriptor = control.descriptor;
      const action = state.program?.actions.find(item => item.id === descriptor.actionId);
      const reason = disabledReason(action, control);
      const controlValues = controlValuesFor(control, action);
      const enabled = !reason && !!action;
      const missingRoll = action?.parameters.some(parameter => parameter.type === 'roll' && !serverRollFor(workspaceView, action.id, parameter.id)) ?? false;
      const id = controlId(workspaceView, descriptor.id);
      const commitRange = () => {
        if (!action || !Object.hasOwn(draftRef.current[descriptor.id] ?? {}, descriptor.kind === 'slider' ? descriptor.parameter : '') || !beginRangeCommit(committedRanges.current, descriptor.id)) return;
        const inputs = resolvedActionInputs(control, controlValuesFor(control, action), action);
        void commitControl(control, action, inputs);
      };
      return <div className="tt-generated-control" key={descriptor.id}>
        {descriptor.kind === 'button' && <div className="tt-generated-control__button"><button type="button" className="tt-button tt-button--primary" disabled={!enabled} title={reason || undefined} onClick={() => action && void commitControl(control, action, resolvedActionInputs(control, controlValues, action))}>{descriptor.label}</button>{reason && <small role="status">{reason}</small>}</div>}
        {descriptor.kind === 'form' && action && <form className="tt-table-action tt-generated-control__form" onSubmit={event => submit(event, control, action)}><header><span className="tt-table-action__glyph">⌑</span><span><strong>{descriptor.label}</strong><small>{action.description}</small></span></header><div className="tt-table-action__inputs">{action.parameters.filter(parameter => descriptor.inputs[parameter.id]?.kind === 'control').map(parameter => parameter.type === 'roll'
          ? <RollParameterControl key={parameter.id} id={controlId(workspaceView, `${descriptor.id}-${parameter.id}`)} view={workspaceView} actionId={action.id} parameter={parameter} disabled={!enabled} onRoll={() => { void onRoll(action.id, parameter.id); }} />
          : <ControlParameter key={parameter.id} id={controlId(workspaceView, `${descriptor.id}-${parameter.id}`)} parameter={parameter} state={state} value={controlValues[parameter.id] ?? initialParameterValue(parameter)} disabled={!enabled} onChange={value => updateDraft(control, action, parameter.id, value)} />)}</div>{reason && <p className="tt-table-action__disabled-reason" role="status">{reason}</p>}{!reason && incomplete === descriptor.id && <p className="tt-table-action__disabled-reason" role="alert">{missingRoll ? 'กด “ทอย” ให้ server ทอยค่าของแอ็กชันนี้ก่อน' : 'Fill in every field with a value in range, then send again.'}</p>}<button type="submit" className="tt-button tt-button--primary" disabled={!enabled}>{descriptor.label}</button></form>}
        {descriptor.kind === 'slider' && action && <div className="tt-generated-control__range"><label htmlFor={id}>{descriptor.label}<output>{formatNumber(Number(controlValues[descriptor.parameter] ?? descriptor.min))}</output></label><input id={id} type="range" min={descriptor.min} max={descriptor.max} step={descriptor.step ?? 'any'} value={Number(controlValues[descriptor.parameter] ?? descriptor.min)} disabled={!enabled} onChange={event => updateDraft(control, action, descriptor.parameter, Number(event.currentTarget.value))} onPointerDown={() => committedRanges.current.delete(descriptor.id)} onKeyDown={event => { if (isRangeCommitKey(event.key)) committedRanges.current.delete(descriptor.id); }} onPointerUp={commitRange} onKeyUp={event => { if (isRangeCommitKey(event.key)) commitRange(); }} onBlur={commitRange} aria-valuetext={formatNumber(Number(controlValues[descriptor.parameter] ?? descriptor.min))} />{reason && <small role="status">{reason}</small>}</div>}
        {descriptor.kind === 'toggle' && action && <label className="tt-generated-control__toggle"><span>{descriptor.label}</span><input type="checkbox" checked={Boolean(controlValues[descriptor.parameter])} disabled={!enabled} onChange={event => { const value = event.currentTarget.checked; updateDraft(control, action, descriptor.parameter, value); const inputs = resolvedActionInputs(control, { ...controlValues, [descriptor.parameter]: value }, action); void commitControl(control, action, inputs); }} />{reason && <small role="status">{reason}</small>}</label>}
        {descriptor.kind === 'select' && action && <label className="tt-generated-control__select" htmlFor={id}>{descriptor.label}<select id={id} value={encodeValue(controlScalar(controlValues[descriptor.parameter], descriptor.options[0]?.value ?? ''))} disabled={!enabled} onChange={event => { const value = decodeValue(event.currentTarget.value); updateDraft(control, action, descriptor.parameter, value); const inputs = resolvedActionInputs(control, { ...controlValues, [descriptor.parameter]: value }, action); void commitControl(control, action, inputs); }}>{descriptor.options.map((option, index) => <option value={encodeValue(option.value)} key={`${descriptor.id}-${index}`}>{option.label}</option>)}</select>{reason && <small role="status">{reason}</small>}</label>}
        {descriptor.kind === 'dice' && action && <DiceControl descriptor={descriptor} action={action} enabled={enabled} reason={reason} sharedValue={readControlDraftValue(draftTarget(workspaceView.id, descriptor.actionId, descriptor.parameter))} onDraft={value => writeControlDraft(draftTarget(workspaceView.id, descriptor.actionId, descriptor.parameter), value, `control:${descriptor.id}`)} />}
      </div>;
    })}
  </div>;
}

/** F049: a visual dice card. It rolls on this device and publishes the total to the shared draft store. */
function DiceControl({ descriptor, action, enabled, reason, sharedValue, onDraft }: {
  descriptor: Extract<ControlDescriptor, { kind: 'dice' }>;
  action: TableAction;
  enabled: boolean;
  reason: string | null;
  sharedValue: TableValue | undefined;
  onDraft: (value: number) => void;
}) {
  const reducedMotion = useReducedMotion();
  const [faces, setFaces] = useState(descriptor.faces);
  const [count, setCount] = useState(descriptor.count);
  const [result, setResult] = useState<DiceRoll | null>(null);
  const [rollId, setRollId] = useState(0);
  const [tumbling, setTumbling] = useState(false);
  const [error, setError] = useState('');
  const modifier = descriptor.modifier ?? 0;
  const parameter = action.parameters.find(item => item.id === descriptor.parameter);
  const sharedTotal = typeof sharedValue === 'number' ? sharedValue : null;
  const shownTotal = result?.total ?? sharedTotal;
  const rangeWarning = parameter && shownTotal !== null && !diceTotalFitsParameter(shownTotal, parameter)
    ? `Total ${formatNumber(shownTotal)} is outside “${parameter.label}”${parameterRangeLabel(parameter)}. Adjust the dice, or edit the value on the card that submits this action.`
    : '';

  useEffect(() => {
    if (!tumbling) return;
    const timer = setTimeout(() => setTumbling(false), DICE_LIMITS.tumbleMs);
    return () => clearTimeout(timer);
  }, [tumbling, rollId]);

  const changeCount = (delta: number) => {
    if (!enabled) return;
    setCount(value => Math.min(DICE_LIMITS.maxCount, Math.max(DICE_LIMITS.minCount, value + delta)));
    setResult(null);
    setTumbling(false);
  };
  const changeFaces = (delta: number) => {
    if (!enabled) return;
    setFaces(value => Math.min(DICE_LIMITS.maxFaces, Math.max(DICE_LIMITS.minFaces, value + delta)));
    setResult(null);
    setTumbling(false);
  };
  const roll = () => {
    if (!enabled) return;
    try {
      const next = rollDice({ faces, count, modifier });
      setError('');
      setResult(next);
      setRollId(value => value + 1);
      setTumbling(!reducedMotion);
      onDraft(next.total);
    } catch (rollError) {
      setError(rollError instanceof Error ? rollError.message : 'The dice could not be rolled.');
    }
  };

  return <div className="tt-dice" role="group" aria-label={`${descriptor.label} dice`}>
    <div className="tt-dice__settings">
      <div className="tt-dice__stepper" role="group" aria-label="Number of dice">
        <button type="button" className="tt-dice__step" aria-label="Fewer dice" disabled={!enabled || count <= DICE_LIMITS.minCount} onClick={() => changeCount(-1)}>−</button>
        <span className="tt-dice__step-value"><output aria-live="off">{count}</output><small>dice</small></span>
        <button type="button" className="tt-dice__step" aria-label="More dice" disabled={!enabled || count >= DICE_LIMITS.maxCount} onClick={() => changeCount(1)}>+</button>
      </div>
      <div className="tt-dice__stepper" role="group" aria-label="Faces per die">
        <button type="button" className="tt-dice__step" aria-label="Fewer faces" disabled={!enabled || faces <= DICE_LIMITS.minFaces} onClick={() => changeFaces(-1)}>−</button>
        <span className="tt-dice__step-value"><output aria-live="off">{faces}</output><small>faces</small></span>
        <button type="button" className="tt-dice__step" aria-label="More faces" disabled={!enabled || faces >= DICE_LIMITS.maxFaces} onClick={() => changeFaces(1)}>+</button>
      </div>
    </div>
    <p className="tt-dice__formula">{descriptor.label} · {count}d{faces}{modifier > 0 ? ` + ${modifier}` : modifier < 0 ? ` − ${Math.abs(modifier)}` : ''}</p>
    <div className="tt-dice__actions">
      <button type="button" className="tt-button tt-button--primary tt-dice__roll" disabled={!enabled} title={reason || undefined} onClick={roll}>ทอย</button>
      {reason && <small role="status">{reason}</small>}
    </div>
    {error && <p className="tt-table-error" role="alert">{error}</p>}
    <div className="tt-dice__result" role="status" aria-live="polite">
      {result ? <>
        <ul className="tt-dice__faces" aria-label="Dice results">
          {result.faces.map((face, index) => <li key={`${rollId}-${index}`} className="tt-dice__face">
            <span role="img" aria-label={`Die ${index + 1}: ${face}`} className={'tt-die' + (tumbling ? ' is-tumbling' : '')} data-face={face}>
              {face <= 6
                ? <span className="tt-die__grid" aria-hidden="true">{Array.from({ length: 9 }, (_, cell) => <i key={cell} className={diePips(face).includes(cell) ? 'tt-die__pip is-on' : 'tt-die__pip'} />)}</span>
                : <span className="tt-die__value" aria-hidden="true">{face}</span>}
            </span>
          </li>)}
        </ul>
        <p className="tt-dice__total">Total <strong>{formatNumber(result.total)}</strong>{modifier !== 0 && <small>{formatNumber(result.total - modifier)} {modifier > 0 ? '+' : '−'} {formatNumber(Math.abs(modifier))}</small>}</p>
      </> : <p className="tt-dice__hint">No roll yet. Press ทอย for {count}d{faces}.</p>}
    </div>
    {!result && sharedTotal !== null && <p className="tt-canvas-inline__note">Current value in this table: <strong>{formatNumber(sharedTotal)}</strong>. A card that binds “{parameter?.label ?? descriptor.parameter}” reads it.</p>}
    {rangeWarning && <p className="tt-canvas-inline__note" role="status">{rangeWarning}</p>}
    <p className="tt-canvas-inline__note">Visual-only roll on this device using the browser CSPRNG. Nothing reaches the table until a card submits this action.</p>
  </div>;
}

function parameterRangeLabel(parameter: TableParameter): string {
  if (parameter.min === undefined && parameter.max === undefined) return '';
  return ` (${parameter.min ?? '−∞'}…${parameter.max ?? '∞'})`;
}

function ControlParameter({ id, parameter, state, value, disabled, onChange }: { id: string; parameter: TableParameter; state: TableState; value: TableValue; disabled: boolean; onChange: (value: TableValue) => void }) {
  if (parameter.type === 'boolean') return <label htmlFor={id}>{parameter.label}<span className="tt-table-action__boolean"><input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={event => onChange(event.currentTarget.checked)} /> Yes</span></label>;
  if (parameter.type === 'record') {
    const rows = state.records[parameter.collection ?? ''] ?? [];
    return <label htmlFor={id}>{parameter.label}<select id={id} value={String(value ?? '')} disabled={disabled} required onChange={event => onChange(event.currentTarget.value)}><option value="">Choose a record</option>{rows.map(row => <option value={row.id} key={row.id}>{recordOptionLabel(row, state, parameter.collection ?? '')}</option>)}</select></label>;
  }
  if (parameter.type === 'text' && parameter.choices?.length) return <label htmlFor={id}>{parameter.label}<select id={id} value={String(value ?? '')} disabled={disabled} required onChange={event => onChange(event.currentTarget.value)}><option value="">Choose…</option>{parameter.choices.map(choice => <option key={choice} value={choice}>{choice}</option>)}</select></label>;
  return <label htmlFor={id}>{parameter.label}<input id={id} type={parameter.type === 'number' ? 'number' : 'text'} min={parameter.type === 'number' ? parameter.min : undefined} max={parameter.type === 'number' ? parameter.max : undefined} step={parameter.type === 'number' ? 'any' : undefined} maxLength={parameter.type === 'text' ? 500 : undefined} value={value === null ? '' : String(value)} disabled={disabled} required onChange={event => onChange(parameter.type === 'number' ? event.currentTarget.value === '' ? null : Number(event.currentTarget.value) : event.currentTarget.value)} /></label>;
}

function initialControlValues(control: EvaluatedControl, action: TableAction | undefined): Record<string, TableValue> {
  if (!action) return {};
  const values: Record<string, TableValue> = {};
  const descriptor = control.descriptor;
  if ('parameter' in descriptor && control.value !== undefined && isGenerativeScalar(control.value)) values[descriptor.parameter] = control.value;
  for (const parameter of action.parameters) {
    if (parameter.type === 'roll') continue;
    if (descriptor.inputs[parameter.id]?.kind !== 'control' || Object.hasOwn(values, parameter.id)) continue;
    values[parameter.id] = initialParameterValue(parameter);
  }
  return values;
}

function initialParameterValue(parameter: TableParameter): TableValue {
  if (parameter.type === 'boolean') return false;
  if (parameter.type === 'number') return parameter.min ?? 0;
  if (parameter.type === 'record') return '';
  return parameter.choices?.[0] ?? '';
}

function resolvedActionInputs(control: EvaluatedControl, values: Record<string, TableValue>, action: TableAction): Record<string, TableValue> {
  const resolved: Record<string, TableValue> = { ...control.inputValues };
  for (const parameter of action.parameters) {
    // F048: the rolled total is injected by the server commit, never sent by the client.
    if (parameter.type === 'roll') continue;
    if (control.descriptor.inputs[parameter.id]?.kind === 'control' && Object.hasOwn(values, parameter.id)) resolved[parameter.id] = values[parameter.id];
  }
  return resolved;
}

function actionUnavailableReason(action: TableAction, state: TableState, view: WorkspaceView, busy: string | null): string | null {
  const actorRole = tableRole(view);
  if (!action.roles.includes(actorRole)) return 'This action is not available to your role.';
  if (action.requireTurn && state.turn !== (view.actor.seat ?? 'host')) return `Waiting for ${state.turn === 'host' ? 'the owner' : state.turn?.replace('member-', 'Member ') ?? 'the next seat'} to act.`;
  if (busy !== null) return busy === 'table.readOnly' ? 'This table is read-only.' : 'A table update is in progress.';
  return null;
}

function inputsAreComplete(action: TableAction, inputs: Record<string, TableValue>, view: WorkspaceView, state: TableState): boolean {
  const interactiveParameters = action.parameters.filter(parameter => parameter.type !== 'roll');
  if (Object.keys(inputs).length !== interactiveParameters.length) return false;
  return action.parameters.every(parameter => {
    if (parameter.type === 'roll') return Boolean(serverRollFor(view, action.id, parameter.id));
    const value = inputs[parameter.id];
    if (parameter.type === 'record') return typeof value === 'string' && Boolean(state.records[parameter.collection ?? '']?.some(row => row.id === value));
    if (parameter.type === 'number') return typeof value === 'number' && Number.isFinite(value) && (parameter.min === undefined || value >= parameter.min) && (parameter.max === undefined || value <= parameter.max);
    if (parameter.type === 'boolean') return typeof value === 'boolean';
    return typeof value === 'string' && value.trim().length > 0 && (!parameter.choices || parameter.choices.includes(value));
  });
}

function localActorContext(view: WorkspaceView): ActorContext {
  return { actorId: view.actor.actorId, name: view.actor.name, role: tableRole(view), ...(view.actor.seat ? { seat: view.actor.seat } : {}), workspaceId: view.id, epoch: view.epoch, now: Date.now(), hash: () => 'generated-canvas-local-preview' };
}

function tableRole(view: WorkspaceView): 'owner' | 'participant' { return view.actor.role === 'owner' ? 'owner' : 'participant'; }
function controlId(view: WorkspaceView, id: string): string { return `tt-generated-${view.id}-${view.epoch}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '-'); }
function encodeValue(value: string | number | boolean): string { return JSON.stringify(value); }
function decodeValue(value: string): string | number | boolean { return JSON.parse(value) as string | number | boolean; }
function controlScalar(value: TableValue | undefined, fallback: string | number | boolean): string | number | boolean { return value === null || value === undefined || Array.isArray(value) ? fallback : value; }
function isGenerativeScalar(value: EvaluatedControl['value']): value is GenerativeScalar { return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'; }
function recordOptionLabel(record: TableRecord, state: TableState, collectionId: string): string {
  const field = state.program?.collections.find(collection => collection.id === collectionId)?.fields[0];
  const value = field ? record.values[field.id] : null;
  return value === null || value === undefined || value === '' ? record.id : `${String(value)} · ${record.id}`;
}
function clamp(value: number, minimum: number, maximum: number): number { return Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum; }
function isRangeCommitKey(key: string): boolean { return ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(key); }
function formatNumber(value: number): string { return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(Number.isFinite(value) ? value : 0); }
function truncate(value: string, max: number): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
