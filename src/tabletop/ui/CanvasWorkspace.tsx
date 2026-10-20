import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpenCheck, Boxes, ChartLine, Database, GripVertical, ListChecks, Move, Play, Scale, Swords, Table2, Workflow } from 'lucide-react';
import type { ExecutablePlan, PlanNode } from './types';
import type { Binding } from '../runtime';
import type { WorkspaceView, PhysicsParams } from '../shared/contracts';
import type { WorkbenchProps } from './types';
import { CanvasObjectContent } from './CanvasObjectContent';
import { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds } from './CanvasObjectIds';
import { isSharedCanvasId } from '../shared/canvas-layout-ids';
import { dedupeVisibleCanvasConnections } from './canvas-flow';
import { canvasLayoutRole, layoutCanvas, unpinnedNodesOverlappingPinnedResizes, type CanvasPoint, type CanvasLayoutNode } from './canvas-layout';
import './canvas-visual-flow.css';

export { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds };

interface CanvasNodeBaseData extends Record<string, unknown> {
  kind: 'plan' | 'auxiliary';
  id: string;
  title: string;
  capability: string;
  selected: boolean;
  opened: boolean;
  onToggleOpen: (id: string) => void;
  onSelectNode: (id: string) => void;
  onMove: (id: string, dx: number, dy: number) => void;
}

interface PlanCanvasNodeData extends CanvasNodeBaseData {
  kind: 'plan';
  spec: PlanNode;
  outputs: Record<string, unknown>;
  view: WorkspaceView;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onUpload: WorkbenchProps['onUpload'];
  onTableImport: WorkbenchProps['onTableImport'];
  onExport: WorkbenchProps['onExport'];
  onFocusEvidence: WorkbenchProps['onFocusEvidence'];
  focusSourceIds: string[];
  preparedDemoArt: boolean;
  localPhysics: PhysicsParams;
  onLocalPhysicsChange: (value: PhysicsParams) => void;
  onResetLocalPhysics: () => void;
  onEditRules?: () => void;
}

interface AuxiliaryCanvasNodeData extends CanvasNodeBaseData {
  kind: 'auxiliary';
  auxiliary: CanvasAuxiliaryObject;
}

type CanvasNodeData = PlanCanvasNodeData | AuxiliaryCanvasNodeData;
type CanvasNode = Node<CanvasNodeData, 'tabletopObject'>;
type CanvasEdge = Edge<{ relationshipLabel: string }>;

export interface CanvasAuxiliaryObject {
  id: string;
  title: string;
  eyebrow?: string;
  position?: { x: number; y: number };
  content?: ReactNode;
  renderContent?: (expanded: boolean) => ReactNode;
}

interface SavedCanvasLayout {
  positions: Record<string, CanvasPoint & { pinned?: boolean }>;
  viewport?: { centerX: number; centerY: number; zoom: number };
}

interface SharedCanvasLayout {
  revision: number;
  positions: Record<string, CanvasPoint & { pinned?: boolean }>;
}

interface OpenObjectFocusRequest {
  id: string;
  sequence: number;
  interactionRevision: number;
  requireOpened: boolean;
  returnFocusToObjects: boolean;
  started: boolean;
  attempts: number;
  frame?: number;
  timer?: number;
}

function sharedLayoutForView(view: WorkspaceView): SharedCanvasLayout | null {
  if (view.domain.kind !== 'table') return null;
  const raw = (view.domain as unknown as { canvasLayout?: unknown }).canvasLayout;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { revision?: unknown; positions?: unknown };
  if (!Number.isSafeInteger(candidate.revision) || !candidate.positions || typeof candidate.positions !== 'object') return null;
  const positions: SharedCanvasLayout['positions'] = {};
  for (const [id, point] of Object.entries(candidate.positions)) {
    if (!isPosition(point)) continue;
    positions[id] = { ...point, pinned: point.pinned !== false };
  }
  return { revision: Number(candidate.revision), positions };
}

function isPosition(value: unknown): value is CanvasPoint & { pinned?: boolean } {
  if (!value || typeof value !== 'object') return false;
  const point = value as { x?: unknown; y?: unknown; pinned?: unknown };
  return Number.isFinite(point.x) && Number.isFinite(point.y)
    && Math.abs(Number(point.x)) < 100_000 && Math.abs(Number(point.y)) < 100_000
    && (point.pinned === undefined || typeof point.pinned === 'boolean');
}

const isSharedCanvasNode = isSharedCanvasId;

const layoutStorageKey = (workspaceKey: string) => `tabletop:r1:canvas-layout:${workspaceKey}`;

function readCanvasLayout(workspaceKey: string): SavedCanvasLayout {
  try {
    const stored = window.localStorage.getItem(layoutStorageKey(workspaceKey));
    if (!stored) return { positions: {} };
    const parsed: unknown = JSON.parse(stored);
    if (!parsed || typeof parsed !== 'object') return { positions: {} };
    const candidate = parsed as Partial<SavedCanvasLayout>;
    const positions: SavedCanvasLayout['positions'] = {};
    if (candidate.positions && typeof candidate.positions === 'object') {
      for (const [id, point] of Object.entries(candidate.positions)) {
        if (isPosition(point)) {
          positions[id] = { x: point.x, y: point.y, pinned: point.pinned ?? true };
        }
      }
    }
    const viewport = candidate.viewport;
    if (viewport && Number.isFinite(viewport.centerX) && Number.isFinite(viewport.centerY) && Number.isFinite(viewport.zoom)) {
      return { positions, viewport: { centerX: viewport.centerX, centerY: viewport.centerY, zoom: Math.min(1.7, Math.max(0.25, viewport.zoom)) } };
    }
    return { positions };
  } catch {
    return { positions: {} };
  }
}

function writeCanvasLayout(workspaceKey: string, layout: SavedCanvasLayout) {
  try {
    window.localStorage.setItem(layoutStorageKey(workspaceKey), JSON.stringify(layout));
  } catch {
    // The canvas remains usable when browser storage is unavailable or full.
  }
}

function portStyle(index: number, length: number): React.CSSProperties {
  const top = `${((index + 1) / (length + 1)) * 100}%`;
  return { top };
}

function canvasMotionDuration(duration: number) {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
}

type CanvasRole = 'source' | 'rules' | 'compute' | 'result' | 'actions' | 'auxiliary';

function capabilityLeaf(capability: string) {
  return capability.split('.').at(-1)?.toLowerCase() ?? capability.toLowerCase();
}

function canvasRole(capability: string, kind: CanvasNodeData['kind']): CanvasRole {
  if (kind === 'auxiliary') return 'auxiliary';
  const leaf = capabilityLeaf(capability);
  if (leaf === 'source' || leaf === 'sources') return 'source';
  if (leaf === 'rules') return 'rules';
  if (leaf === 'reconcile' || leaf === 'model' || leaf === 'merge') return 'compute';
  if (leaf === 'actions' || leaf === 'question') return 'actions';
  if (leaf === 'table' || leaf === 'collection' || leaf === 'scene' || leaf === 'graph' || leaf === 'board' || leaf === 'review') return 'result';
  return 'compute';
}

function capabilityGlyph(capability: string, kind: CanvasNodeData['kind']) {
  if (kind === 'auxiliary') return <Workflow size={16} />;
  const leaf = capabilityLeaf(capability);
  if (leaf === 'source' || leaf === 'sources') return <Database size={16} />;
  if (leaf === 'rules') return <Scale size={16} />;
  if (leaf === 'reconcile' || leaf === 'model' || leaf === 'merge') return <Workflow size={16} />;
  if (leaf === 'table' || leaf === 'collection') return <Table2 size={16} />;
  if (leaf === 'scene') return <Activity size={16} />;
  if (leaf === 'graph') return <ChartLine size={16} />;
  if (leaf === 'board') return <Swords size={16} />;
  if (leaf === 'review') return <ListChecks size={16} />;
  if (leaf === 'question') return <BookOpenCheck size={16} />;
  if (leaf === 'actions') return <Play size={16} />;
  return <Workflow size={16} />;
}

const valueTypeLabels: Record<string, string> = {
  'InvoiceStateV1': 'Invoice data',
  'InvoiceResultV1': 'Calculated result',
  'ReviewItemV1[]': 'Review items',
  'PhysicsParametersV1': 'Motion settings',
  'PhysicsResultV1': 'Motion result',
  'EncounterBoardV1': 'Encounter state',
  'TableRowsV1': 'Table rows',
  'RuleRevisionV1': 'Active rule revision',
};

function relationshipLabel(valueType: string) {
  return valueTypeLabels[valueType]
    ?? valueType.replace(/\[\]$/, '').replace(/V\d+$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
}

function roleColor(role: CanvasRole) {
  if (role === 'source') return '#315eb0';
  if (role === 'rules') return '#946626';
  if (role === 'result') return '#24796b';
  if (role === 'actions') return '#426179';
  return '#738681';
}

function defaultCanvasPosition(kind: WorkspaceView['kind'], spec: PlanNode) {
  if (kind === 'invoice') {
    if (spec.id === 'invoice.table' || spec.id === 'invoice.review') return { x: 540, y: spec.id === 'invoice.table' ? 40 : 760 };
  }
  if (kind === 'teaching') {
    if (spec.id === 'lesson.scene' || spec.id === 'lesson.graph') return { x: 580, y: spec.id === 'lesson.scene' ? 40 : 550 };
  }
  if (kind === 'encounter' && spec.id === 'encounter.board') return { x: 580, y: 40 };
  return spec.position;
}

function CanvasObjectHeader({ data }: { data: CanvasNodeData }) {
  const moveButtonRef = useRef<HTMLButtonElement>(null);
  const [moveMenuOpen, setMoveMenuOpen] = useState(false);
  const [moveAnnouncement, setMoveAnnouncement] = useState('');
  const moveMenuId = `canvas-move-${data.id}`;

  const move = (dx: number, dy: number, direction: string) => {
    data.onMove(data.id, dx, dy);
    setMoveAnnouncement(`${data.title} moved ${direction}.`);
    setMoveMenuOpen(false);
    window.requestAnimationFrame(() => moveButtonRef.current?.focus());
  };

  return <>
    <header className="tt-canvas-node__head">
      <span className="tt-canvas-node__drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
      <span className="tt-object-glyph" aria-hidden="true">{capabilityGlyph(data.capability, data.kind)}</span>
      <span className="tt-canvas-node__identity"><span className="tt-canvas-node__title">{data.title}</span></span>
      <button className="tt-canvas-node__open nodrag nopan nokey" type="button" aria-expanded={data.opened} aria-label={data.opened ? 'Close object' : `Open ${data.title}`} onKeyDown={(event) => {
        if (event.key === 'Escape' && data.opened) {
          event.preventDefault();
          event.stopPropagation();
          data.onToggleOpen(data.id);
        }
      }} onClick={(event) => { event.stopPropagation(); data.onToggleOpen(data.id); }}>
        {data.opened ? 'Close' : 'Open'}
      </button>
      <button ref={moveButtonRef} className="tt-canvas-node__move-toggle nodrag nopan nokey" type="button" aria-expanded={moveMenuOpen} aria-controls={moveMenuId} aria-label={`Move ${data.title} without dragging`} title="Move without dragging" onKeyDown={(event) => {
        if (event.key === 'Escape' && moveMenuOpen) {
          event.preventDefault();
          event.stopPropagation();
          setMoveMenuOpen(false);
        }
      }} onClick={(event) => { event.stopPropagation(); data.onSelectNode(data.id); setMoveMenuOpen((open) => !open); }}>
        <Move size={16} aria-hidden="true" />
      </button>
    </header>
    {moveMenuOpen && <div id={moveMenuId} className="tt-canvas-move-tools nodrag nopan nokey" role="group" aria-label={`Move ${data.title} without dragging`} onKeyDown={(event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        setMoveMenuOpen(false);
        window.requestAnimationFrame(() => moveButtonRef.current?.focus());
      }
    }}>
      <span>Move object</span>
      <div className="tt-canvas-move-tools__directions">
        <button type="button" aria-label={`Move ${data.title} up`} onClick={(event) => { event.stopPropagation(); move(0, -1, 'up'); }}><ArrowUp size={16} aria-hidden="true" /></button>
        <button type="button" aria-label={`Move ${data.title} left`} onClick={(event) => { event.stopPropagation(); move(-1, 0, 'left'); }}><ArrowLeft size={16} aria-hidden="true" /></button>
        <button type="button" aria-label={`Move ${data.title} down`} onClick={(event) => { event.stopPropagation(); move(0, 1, 'down'); }}><ArrowDown size={16} aria-hidden="true" /></button>
        <button type="button" aria-label={`Move ${data.title} right`} onClick={(event) => { event.stopPropagation(); move(1, 0, 'right'); }}><ArrowRight size={16} aria-hidden="true" /></button>
      </div>
    </div>}
    <span className="tt-canvas-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{moveAnnouncement}</span>
  </>;
}

function CanvasObjectNode({ data, selected }: NodeProps<CanvasNode>) {
  if (data.kind === 'auxiliary') {
    return (
      <article
        className={'tt-canvas-node tt-canvas-node--auxiliary tt-canvas-node--role-auxiliary' + (selected ? ' is-selected' : '') + (data.opened ? ' is-expanded' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-testid={data.opened ? 'canvas-object-editor' : undefined}
        data-object-id={data.opened ? data.id : undefined}
        data-canvas-role="auxiliary"
        aria-label={data.title}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && data.opened) {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) return;
            event.preventDefault();
            event.stopPropagation();
            data.onToggleOpen(data.id);
            const node = event.currentTarget;
            window.requestAnimationFrame(() => node.querySelector<HTMLButtonElement>('.tt-canvas-node__open')?.focus());
          }
        }}
      >
        <CanvasObjectHeader data={data} />
        <div className="tt-canvas-node__body nodrag nopan nokey">{data.auxiliary.renderContent?.(data.opened) ?? data.auxiliary.content}</div>
      </article>
    );
  }

  const inputPorts = Object.keys(data.spec.inputs);
  const outputPorts = Object.keys(data.outputs);
  const role = canvasRole(data.capability, data.kind);

  return (
    <article
      className={'tt-canvas-node tt-canvas-node--' + data.spec.id.replaceAll('.', '-') + ' tt-canvas-node--role-' + role + (selected ? ' is-selected' : '') + (data.opened ? ' is-expanded' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-testid={data.opened ? 'canvas-object-editor' : undefined}
        data-object-id={data.opened ? data.id : undefined}
        data-canvas-role={role}
      aria-label={data.spec.title}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && data.opened) {
          const target = event.target instanceof Element ? event.target : null;
          if (target?.closest('button, input, textarea, select, [contenteditable="true"]')) return;
          event.preventDefault();
          event.stopPropagation();
          data.onToggleOpen(data.id);
          const node = event.currentTarget;
          window.requestAnimationFrame(() => node.querySelector<HTMLButtonElement>('.tt-canvas-node__open')?.focus());
        }
      }}
    >
      {inputPorts.map((port, index) => <Handle key={`in-${port}`} type="target" position={Position.Left} id={port} style={portStyle(index, inputPorts.length)} />)}
      {outputPorts.map((port, index) => <Handle key={`out-${port}`} type="source" position={Position.Right} id={port} style={portStyle(index, outputPorts.length)} />)}
      <CanvasObjectHeader data={data} />
      <div className="tt-canvas-node__body nodrag nopan nokey">
        <CanvasObjectContent view={data.view} node={data.spec} outputs={data.outputs} busy={data.busy} onCommand={data.onCommand} onUpload={data.onUpload} onTableImport={data.onTableImport} onExport={data.onExport} onFocusEvidence={data.onFocusEvidence} focusSourceIds={data.focusSourceIds} localPhysics={data.localPhysics} onLocalPhysicsChange={data.onLocalPhysicsChange} onResetLocalPhysics={data.onResetLocalPhysics} onEditRules={data.onEditRules} preparedDemoArt={data.preparedDemoArt} expanded={data.opened} />
      </div>
    </article>
  );
}

const nodeTypes: NodeTypes = { tabletopObject: CanvasObjectNode };

interface CanvasWorkspaceProps {
  view: WorkspaceView;
  plan: ExecutablePlan;
  /** @deprecated Canvas objects are always draggable from their headers. */
  mode?: 'use' | 'arrange';
  selectedNodeId: string | null;
  onSelectNode: (nodeId: string | null) => void;
  onCommand: WorkbenchProps['onCommand'];
  busy: string | null;
  onUpload: WorkbenchProps['onUpload'];
  onTableImport: WorkbenchProps['onTableImport'];
  onExport: WorkbenchProps['onExport'];
  onFocusEvidence: WorkbenchProps['onFocusEvidence'];
  focusSourceIds: string[];
  persistLayout?: boolean;
  preparedDemoArt?: boolean;
  visibleNodeIds?: readonly string[];
  focusNodeId?: string | null;
  focusRequestKey?: string | number;
  auxiliaryObjects?: readonly CanvasAuxiliaryObject[];
  emptyContent?: ReactNode;
  openedObjectId?: string | null;
  onOpenObject?: (id: string | null) => void;
  onEditRules?: () => void;
}

function CanvasInner({ view, plan, selectedNodeId, onSelectNode, onCommand, busy, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, persistLayout = true, preparedDemoArt = false, visibleNodeIds, focusNodeId, focusRequestKey, auxiliaryObjects = [], emptyContent, openedObjectId, onOpenObject, onEditRules }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const flowWrapRef = useRef<HTMLDivElement>(null);
  const workspaceKey = view.id + ':' + view.epoch;
  const sharedLayout = useMemo(() => sharedLayoutForView(view), [view]);
  const remoteLayoutEnabled = persistLayout && view.kind === 'table';
  const sharedLayoutRef = useRef<SharedCanvasLayout | null>(sharedLayout);
  const sharedLayoutWorkspaceRef = useRef(workspaceKey);
  if (sharedLayoutWorkspaceRef.current !== workspaceKey) {
    sharedLayoutWorkspaceRef.current = workspaceKey;
    sharedLayoutRef.current = sharedLayout;
  } else if (sharedLayout && (!sharedLayoutRef.current || sharedLayout.revision >= sharedLayoutRef.current.revision)) {
    sharedLayoutRef.current = sharedLayout;
  }
  const layoutWorkspaceRef = useRef('');
  const workspacePositionsRef = useRef<SavedCanvasLayout['positions']>({});
  const pendingViewportRef = useRef<SavedCanvasLayout['viewport'] | undefined>(undefined);
  const initialViewPendingRef = useRef(false);
  const pinnedNodeIdsRef = useRef(new Set<string>());
  const draggingNodeIdsRef = useRef(new Set<string>());
  const dragStartPositionsRef = useRef(new Map<string, CanvasPoint>());
  const layoutCommandQueueRef = useRef(Promise.resolve());
  const layoutMoveSequenceRef = useRef(0);
  const layoutBlockedThroughRef = useRef(0);
  const appliedSharedLayoutRevisionRef = useRef<number | null>(null);
  const layoutSnapshotRef = useRef<{ workspaceKey: string; ids: Set<string>; sizes: Map<string, { width: number; height: number }>; edges: Set<string>; signature: string } | null>(null);
  const pendingOpenObjectFocusRef = useRef<OpenObjectFocusRequest | null>(null);
  const openObjectFocusSequenceRef = useRef(0);
  const canvasInteractionRevisionRef = useRef(0);
  const [openObjectFocusSequence, setOpenObjectFocusSequence] = useState(0);
  const cancelPendingOpenObjectFocus = useCallback(() => {
    const request = pendingOpenObjectFocusRef.current;
    if (!request) return;
    if (request.frame !== undefined) window.cancelAnimationFrame(request.frame);
    if (request.timer !== undefined) window.clearTimeout(request.timer);
    pendingOpenObjectFocusRef.current = null;
    canvasInteractionRevisionRef.current += 1;
  }, []);
  const requestOpenObjectFocus = useCallback((id: string, requireOpened: boolean, returnFocusToObjects: boolean) => {
    cancelPendingOpenObjectFocus();
    const sequence = ++openObjectFocusSequenceRef.current;
    pendingOpenObjectFocusRef.current = {
      id,
      sequence,
      interactionRevision: canvasInteractionRevisionRef.current,
      requireOpened,
      returnFocusToObjects,
      started: false,
      attempts: 0,
    };
    setOpenObjectFocusSequence(sequence);
  }, [cancelPendingOpenObjectFocus]);
  const [layoutReadyKey, setLayoutReadyKey] = useState('');
  useEffect(() => { cancelPendingOpenObjectFocus(); }, [workspaceKey, cancelPendingOpenObjectFocus]);
  const [localPhysics, setLocalPhysics] = useState<PhysicsParams>(() => view.domain.kind === 'teaching' ? view.domain.parameters : { force: 10, mass: 2, time: 2 });
  const localPhysicsDirty = useRef(false);
  const localPhysicsWorkspace = useRef('');
  const teachingParams = view.domain.kind === 'teaching' ? view.domain.parameters : null;
  const allowedNodeIds = useMemo(() => visibleNodeIds ? new Set(visibleNodeIds) : null, [visibleNodeIds]);
  const visiblePlanNodes = useMemo(() => plan.nodes.filter((spec) => spec.visible !== false && (!allowedNodeIds || allowedNodeIds.has(spec.id))), [plan.nodes, allowedNodeIds]);
  const planIds = useMemo(() => new Set(plan.nodes.map((spec) => spec.id)), [plan.nodes]);
  const planNodesById = useMemo(() => new Map(plan.nodes.map((spec) => [spec.id, spec])), [plan.nodes]);
  const visibleAuxiliaryObjects = useMemo(() => auxiliaryObjects.filter((object) => !planIds.has(object.id) && (!allowedNodeIds || allowedNodeIds.has(object.id))), [auxiliaryObjects, planIds, allowedNodeIds]);
  const visibleIds = useMemo(() => new Set([...visiblePlanNodes.map((spec) => spec.id), ...visibleAuxiliaryObjects.map((object) => object.id)]), [visiblePlanNodes, visibleAuxiliaryObjects]);
  const [internalOpenedId, setInternalOpenedId] = useState<string | null>(null);
  const activeOpenedId = openedObjectId === undefined ? internalOpenedId : openedObjectId;
  const [objectsMenuOpen, setObjectsMenuOpen] = useState(false);
  const [previousView, setPreviousView] = useState<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => { setPreviousView(null); }, [view.id, view.epoch]);
  const [showConnections, setShowConnections] = useState(false);
  const objectsMenuRef = useRef<HTMLDivElement>(null);
  const objectsButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusRequestRef = useRef<string | null>(null);
  const lastDomainRevisionRef = useRef<{ workspaceKey: string; data: number; rules: number } | null>(null);
  const [revisionNotice, setRevisionNotice] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    const workspaceKey = view.id + ':' + view.epoch;
    if (localPhysicsWorkspace.current !== workspaceKey || !localPhysicsDirty.current) {
      localPhysicsWorkspace.current = workspaceKey;
      localPhysicsDirty.current = false;
      if (teachingParams) setLocalPhysics(teachingParams);
    }
  }, [view.id, view.epoch, teachingParams?.force, teachingParams?.mass, teachingParams?.time]);
  const changeLocalPhysics = useCallback((next: PhysicsParams) => {
    localPhysicsDirty.current = true;
    setLocalPhysics(next);
  }, []);
  const resetLocalPhysics = useCallback(() => {
    localPhysicsDirty.current = false;
    if (view.domain.kind === 'teaching') setLocalPhysics(view.domain.parameters);
  }, [view]);

  const rememberPosition = useCallback((id: string, position: CanvasPoint) => {
    const saved = { ...position, pinned: true };
    pinnedNodeIdsRef.current.add(id);
    workspacePositionsRef.current = { ...workspacePositionsRef.current, [id]: saved };
    if (!persistLayout) return;
    const layout = readCanvasLayout(workspaceKey);
    layout.positions[id] = saved;
    writeCanvasLayout(workspaceKey, layout);
  }, [persistLayout, workspaceKey]);

  const commitUserPosition = useCallback((id: string, position: CanvasPoint, before?: CanvasPoint) => {
    rememberPosition(id, position);
    if (!remoteLayoutEnabled || !isSharedCanvasNode(id)) return;
    const sequence = ++layoutMoveSequenceRef.current;
    const revertToCanonical = () => {
      const canonical = sharedLayoutRef.current?.positions[id] ?? before;
      if (!canonical) return;
      workspacePositionsRef.current = { ...workspacePositionsRef.current, [id]: canonical };
      setNodes((current) => current.map((node) => node.id === id ? { ...node, position: { x: canonical.x, y: canonical.y } } : node));
    };
    const applyCanonicalLayout = (canonicalLayout: SharedCanvasLayout) => {
      sharedLayoutRef.current = canonicalLayout;
      appliedSharedLayoutRevisionRef.current = canonicalLayout.revision;
      const canonical = canonicalLayout.positions[id] ?? position;
      const visibleCanonicalPositions = new Map<string, CanvasPoint>();
      for (const [nodeId, point] of Object.entries(canonicalLayout.positions)) {
        if (!isSharedCanvasNode(nodeId)) continue;
        workspacePositionsRef.current = { ...workspacePositionsRef.current, [nodeId]: { ...point, pinned: true } };
        pinnedNodeIdsRef.current.add(nodeId);
        visibleCanonicalPositions.set(nodeId, point);
      }
      workspacePositionsRef.current = { ...workspacePositionsRef.current, [id]: { ...canonical, pinned: true } };
      setNodes((current) => current.map((node) => {
        const point = visibleCanonicalPositions.get(node.id) ?? (node.id === id ? canonical : undefined);
        return point ? { ...node, position: { x: point.x, y: point.y } } : node;
      }));
    };
    const send = async () => {
      if (sequence <= layoutBlockedThroughRef.current) {
        revertToCanonical();
        return;
      }
      const attempt = async (expectedLayoutRevision: number) => {
        try {
          return await onCommand('canvas.layout', { expectedLayoutRevision, positions: { [id]: { ...position, pinned: true } } });
        } catch {
          return null;
        }
      };
      const expectedLayoutRevision = sharedLayoutRef.current?.revision ?? 0;
      let updated = await attempt(expectedLayoutRevision);
      if (!updated) {
        // Someone else may have moved a different card at the same moment. Retry once on
        // the newer layout, but only if nobody moved this card in between (F007).
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        const latest = sharedLayoutRef.current;
        const latestPoint = latest?.positions[id];
        const untouched = !latestPoint || (before !== undefined && Math.abs(latestPoint.x - before.x) < 0.5 && Math.abs(latestPoint.y - before.y) < 0.5);
        if (latest && latest.revision !== expectedLayoutRevision && untouched && sequence > layoutBlockedThroughRef.current) {
          updated = await attempt(latest.revision);
        }
      }
      if (!updated) {
        layoutBlockedThroughRef.current = Math.max(layoutBlockedThroughRef.current, layoutMoveSequenceRef.current);
        revertToCanonical();
        return;
      }
      const canonicalLayout = sharedLayoutForView(updated);
      if (canonicalLayout) applyCanonicalLayout(canonicalLayout);
    };
    layoutCommandQueueRef.current = layoutCommandQueueRef.current.then(send, send);
  }, [onCommand, remoteLayoutEnabled, rememberPosition, setNodes]);

  const moveCanvasObject = useCallback((id: string, dx: number, dy: number) => {
    cancelPendingOpenObjectFocus();
    const node = flow.getNode(id);
    if (!node) return;
    const position = { x: node.position.x + dx * 48, y: node.position.y + dy * 48 };
    setNodes((current) => current.map((candidate) => candidate.id === id ? { ...candidate, position } : candidate));
    commitUserPosition(id, position, node.position);
  }, [cancelPendingOpenObjectFocus, commitUserPosition, flow, setNodes]);

  useEffect(() => {
    if (!objectsMenuOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Element && !objectsMenuRef.current?.contains(event.target)) setObjectsMenuOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, [objectsMenuOpen]);

  useEffect(() => {
    const current = { workspaceKey, data: view.domain.dataRevision, rules: view.domain.ruleRevision };
    const previous = lastDomainRevisionRef.current;
    lastDomainRevisionRef.current = current;
    if (!previous || previous.workspaceKey !== workspaceKey) {
      setRevisionNotice(null);
      return;
    }

    const changed = [
      previous.data !== current.data ? 'Data updated' : '',
      previous.rules !== current.rules ? 'Rules updated' : '',
    ].filter(Boolean);
    if (changed.length === 0) return;

    setRevisionNotice({ key: `${workspaceKey}:${current.data}:${current.rules}`, message: changed.join(' · ') });
    const timeout = window.setTimeout(() => setRevisionNotice(null), 2100);
    return () => window.clearTimeout(timeout);
  }, [workspaceKey, view.domain.dataRevision, view.domain.ruleRevision]);
  const toggleOpenObject = useCallback((id: string) => {
    const nextId = activeOpenedId === id ? null : id;
    if (openedObjectId === undefined) setInternalOpenedId(nextId);
    onOpenObject?.(nextId);
    onSelectNode(id);
  }, [activeOpenedId, openedObjectId, onOpenObject, onSelectNode]);
  const navigateToObject = useCallback((id: string) => {
    if (!nodes.some((node) => node.id === id)) return;
    cancelPendingOpenObjectFocus();
    setPreviousView(flow.getViewport());
    if (openedObjectId === undefined) setInternalOpenedId(id);
    onOpenObject?.(id);
    onSelectNode(id);
    setObjectsMenuOpen(false);
    if (view.kind === 'table') {
      lastFocusRequestRef.current = `${focusNodeId ?? ''}:${String(focusRequestKey ?? '')}`;
      requestOpenObjectFocus(id, true, true);
      return;
    }
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      flow.fitView({ nodes: [{ id }], padding: 0.1, minZoom: 0.62, maxZoom: 1.15, duration: canvasMotionDuration(200) });
      objectsButtonRef.current?.focus();
    }));
  }, [cancelPendingOpenObjectFocus, flow, focusNodeId, focusRequestKey, nodes, onOpenObject, openedObjectId, onSelectNode, requestOpenObjectFocus, view.kind]);

  useEffect(() => {
    const request = pendingOpenObjectFocusRef.current;
    if (!request || request.sequence !== openObjectFocusSequence) return;
    if (request.requireOpened && activeOpenedId !== request.id) {
      if (request.started) cancelPendingOpenObjectFocus();
      return;
    }
    if (view.kind !== 'table') return;

    request.started = true;
    let disposed = false;
    let previousGeometry = '';
    let stableSince = 0;
    let stableSamples = 0;
    const cleanupRequest = () => {
      if (request.frame !== undefined) window.cancelAnimationFrame(request.frame);
      if (request.timer !== undefined) window.clearTimeout(request.timer);
      request.frame = undefined;
      request.timer = undefined;
    };
    const sampleGeometry = () => {
      if (disposed || pendingOpenObjectFocusRef.current !== request) return;
      if (request.interactionRevision !== canvasInteractionRevisionRef.current) {
        cancelPendingOpenObjectFocus();
        return;
      }
      if (request.requireOpened && activeOpenedId !== request.id) {
        cancelPendingOpenObjectFocus();
        return;
      }

      const node = flow.getNode(request.id);
      const target = Array.from(flowWrapRef.current?.querySelectorAll<HTMLElement>('[data-canvas-object]') ?? [])
        .find((element) => element.dataset.canvasObject === request.id);
      const measuredWidth = node?.measured?.width;
      const measuredHeight = node?.measured?.height;
      const bounds = target?.getBoundingClientRect();
      if (
        node &&
        typeof measuredWidth === 'number' && measuredWidth > 0 &&
        typeof measuredHeight === 'number' && measuredHeight > 0 &&
        bounds && bounds.width > 0 && bounds.height > 0
      ) {
        const geometry = [node.position.x, node.position.y, measuredWidth, measuredHeight, bounds.left, bounds.top, bounds.width, bounds.height]
          .map((value) => String(Math.round(value * 2) / 2))
          .join('|');
        const now = performance.now();
        if (geometry === previousGeometry) stableSamples += 1;
        else {
          previousGeometry = geometry;
          stableSince = now;
          stableSamples = 0;
        }
        if (stableSamples >= 3 && now - stableSince >= 90) {
          cleanupRequest();
          pendingOpenObjectFocusRef.current = null;
          flow.fitView({ nodes: [{ id: request.id }], padding: 0.1, minZoom: 0.62, maxZoom: 1.15, duration: 0 });
          if (request.returnFocusToObjects) objectsButtonRef.current?.focus();
          return;
        }
      } else {
        previousGeometry = '';
        stableSince = 0;
        stableSamples = 0;
      }

      request.attempts += 1;
      if (request.attempts >= 180) {
        cancelPendingOpenObjectFocus();
        return;
      }
      request.timer = window.setTimeout(() => {
        request.frame = window.requestAnimationFrame(sampleGeometry);
      }, 32);
    };

    request.frame = window.requestAnimationFrame(sampleGeometry);
    return () => {
      disposed = true;
      cleanupRequest();
    };
  }, [activeOpenedId, cancelPendingOpenObjectFocus, flow, openObjectFocusSequence, view.kind, workspaceKey]);

  useEffect(() => {
    const isNewWorkspace = layoutWorkspaceRef.current !== workspaceKey;
    const visibleSharedIds = new Set([...visiblePlanNodes.map((spec) => spec.id), ...visibleAuxiliaryObjects.map((object) => object.id)].filter(isSharedCanvasNode));
    const storedLayout = isNewWorkspace && persistLayout ? readCanvasLayout(workspaceKey) : null;
    const remoteLayoutChanged = remoteLayoutEnabled && sharedLayout !== null
      && (isNewWorkspace || (sharedLayout.revision >= (appliedSharedLayoutRevisionRef.current ?? -1)
        && appliedSharedLayoutRevisionRef.current !== sharedLayout.revision));
    if (isNewWorkspace) {
      layoutWorkspaceRef.current = workspaceKey;
      workspacePositionsRef.current = { ...(storedLayout?.positions ?? {}) };
      pinnedNodeIdsRef.current.clear();
      for (const [id, point] of Object.entries(workspacePositionsRef.current)) {
        if (remoteLayoutEnabled && isSharedCanvasNode(id)) {
          delete workspacePositionsRef.current[id];
          continue;
        }
        if (point.pinned !== false) pinnedNodeIdsRef.current.add(id);
      }
      pendingViewportRef.current = storedLayout?.viewport;
      initialViewPendingRef.current = true;
    }
    if (remoteLayoutChanged && sharedLayout) {
      for (const id of Object.keys(workspacePositionsRef.current)) {
        if (isSharedCanvasNode(id)) delete workspacePositionsRef.current[id];
      }
      for (const [id, point] of Object.entries(sharedLayout.positions)) {
        if (!isSharedCanvasNode(id) || !visibleSharedIds.has(id)) continue;
        workspacePositionsRef.current[id] = point;
        if (point.pinned !== false) pinnedNodeIdsRef.current.add(id);
      }
      appliedSharedLayoutRevisionRef.current = sharedLayout.revision;
    }
    if (remoteLayoutEnabled && sharedLayout) {
      for (const id of visibleSharedIds) {
        const point = sharedLayout.positions[id];
        if (!point) continue;
        workspacePositionsRef.current[id] = point;
        if (point.pinned !== false) pinnedNodeIdsRef.current.add(id);
      }
    }
    setNodes((existing) => {
      const previousPositions = new Map(existing.map((node) => [node.id, node.position]));
      const planNodes = visiblePlanNodes.map((spec): CanvasNode => ({
        id: spec.id,
        type: 'tabletopObject',
        ariaLabel: spec.title,
        dragHandle: '.tt-canvas-node__head',
        position: (() => {
          const isShared = remoteLayoutEnabled && isSharedCanvasNode(spec.id);
          const remotePosition = isShared ? sharedLayout?.positions[spec.id] : undefined;
          const isNewNode = !previousPositions.has(spec.id);
          if ((isNewWorkspace || remoteLayoutChanged || isNewNode) && remotePosition && !draggingNodeIdsRef.current.has(spec.id)) return { x: remotePosition.x, y: remotePosition.y };
          if (isNewWorkspace && !isShared) {
            const localPosition = storedLayout?.positions[spec.id];
            if (localPosition) return { x: localPosition.x, y: localPosition.y };
          }
          return previousPositions.get(spec.id)
            ?? (!isShared ? workspacePositionsRef.current[spec.id] : undefined)
            ?? defaultCanvasPosition(view.kind, spec);
        })(),
        selected: spec.id === selectedNodeId,
        zIndex: activeOpenedId === spec.id ? 20 : spec.id === selectedNodeId ? 10 : 0,
        data: {
          kind: 'plan',
          id: spec.id,
          title: spec.title,
          capability: spec.capability,
          opened: activeOpenedId === spec.id,
          onToggleOpen: toggleOpenObject,
          onSelectNode,
          onMove: moveCanvasObject,
          spec,
          outputs: plan.outputs?.[spec.id] ?? {},
          selected: spec.id === selectedNodeId,
          view,
          busy,
          onCommand,
          onUpload,
          onTableImport,
          onExport,
          onFocusEvidence,
          focusSourceIds,
          preparedDemoArt,
          localPhysics,
          onLocalPhysicsChange: changeLocalPhysics,
          onResetLocalPhysics: resetLocalPhysics,
          onEditRules,
        },
      }));
      const maxY = visiblePlanNodes.reduce((maximum, spec) => Math.max(maximum, (previousPositions.get(spec.id) ?? workspacePositionsRef.current[spec.id] ?? defaultCanvasPosition(view.kind, spec)).y), 0);
      const auxiliaryNodes = visibleAuxiliaryObjects.map((object, index): CanvasNode => ({
        id: object.id,
        type: 'tabletopObject',
        ariaLabel: object.title,
        dragHandle: '.tt-canvas-node__head',
        position: (() => {
          // Table-wide cards (people, history) follow the shared layout like plan cards (F007).
          const isShared = remoteLayoutEnabled && isSharedCanvasNode(object.id);
          const remotePosition = isShared ? sharedLayout?.positions[object.id] : undefined;
          const isNewNode = !previousPositions.has(object.id);
          if ((isNewWorkspace || remoteLayoutChanged || isNewNode) && remotePosition && !draggingNodeIdsRef.current.has(object.id)) return { x: remotePosition.x, y: remotePosition.y };
          return (isNewWorkspace && !isShared ? storedLayout?.positions[object.id] : undefined)
            ?? previousPositions.get(object.id)
            ?? (!isShared ? workspacePositionsRef.current[object.id] : undefined)
            ?? object.position ?? { x: 40, y: maxY + 340 + index * 360 };
        })(),
        selected: object.id === selectedNodeId,
        zIndex: activeOpenedId === object.id ? 20 : object.id === selectedNodeId ? 10 : 0,
        data: {
          kind: 'auxiliary',
          id: object.id,
          title: object.title,
          capability: object.eyebrow ?? 'table tool',
          opened: activeOpenedId === object.id,
          onToggleOpen: toggleOpenObject,
          onSelectNode,
          onMove: moveCanvasObject,
          selected: object.id === selectedNodeId,
          auxiliary: object,
        },
      }));
      return [...planNodes, ...auxiliaryNodes];
    });
  }, [workspaceKey, persistLayout, remoteLayoutEnabled, sharedLayout, preparedDemoArt, visiblePlanNodes, visibleAuxiliaryObjects, plan.outputs, selectedNodeId, activeOpenedId, setNodes, view, busy, onCommand, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, localPhysics, changeLocalPhysics, resetLocalPhysics, toggleOpenObject, onSelectNode, moveCanvasObject, onEditRules]);

  useEffect(() => {
    if (!initialViewPendingRef.current || nodes.length === 0 || !nodes.every((node) => node.data.kind === 'auxiliary' || node.data.view.id === view.id && node.data.view.epoch === view.epoch)) return;
    if (view.kind === 'table' && layoutReadyKey !== workspaceKey) return;
    initialViewPendingRef.current = false;
    const savedViewport = pendingViewportRef.current;
    pendingViewportRef.current = undefined;
    const preferredId = view.kind === 'invoice' ? 'invoice.source' : view.kind === 'teaching' ? nodes.find((node) => node.id === 'lesson.scene' || node.id === 'lesson.graph')?.id : 'encounter.board';
    const targetId = preferredId && nodes.some((node) => node.id === preferredId) ? preferredId : nodes[0]?.id;
    requestAnimationFrame(() => {
      if (focusNodeId && nodes.some((node) => node.id === focusNodeId)) {
        flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.12, minZoom: 0.92, maxZoom: 1.15, duration: 0 });
      } else if (savedViewport) {
        flow.setCenter(savedViewport.centerX, savedViewport.centerY, { zoom: savedViewport.zoom, duration: 0 });
      } else if (targetId) {
        flow.fitView({ nodes: [{ id: targetId }], padding: 0.12, minZoom: 0.92, maxZoom: 1.1, duration: 0 });
      }
    });
  }, [workspaceKey, nodes, view.id, view.kind, flow, focusNodeId, layoutReadyKey]);

  const persistViewport = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    if (!persistLayout) return;
    const bounds = flowWrapRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.zoom <= 0) return;
    const current = readCanvasLayout(workspaceKey);
    current.viewport = {
      centerX: (bounds.width / 2 - viewport.x) / viewport.zoom,
      centerY: (bounds.height / 2 - viewport.y) / viewport.zoom,
      zoom: viewport.zoom,
    };
    writeCanvasLayout(workspaceKey, current);
  }, [workspaceKey, persistLayout]);

  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    cancelPendingOpenObjectFocus();
    draggingNodeIdsRef.current.add(node.id);
    dragStartPositionsRef.current.set(node.id, node.position);
  }, [cancelPendingOpenObjectFocus]);

  const persistPosition = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    draggingNodeIdsRef.current.delete(node.id);
    const before = dragStartPositionsRef.current.get(node.id);
    dragStartPositionsRef.current.delete(node.id);
    commitUserPosition(node.id, { x: node.position.x, y: node.position.y }, before);
  }, [commitUserPosition]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes);
    for (const change of changes) {
      if (change.type === 'position' && change.dragging === true) {
        cancelPendingOpenObjectFocus();
        draggingNodeIdsRef.current.add(change.id);
      } else if (change.type === 'position' && change.dragging === false) {
        draggingNodeIdsRef.current.delete(change.id);
      }
    }
  }, [cancelPendingOpenObjectFocus, onNodesChange]);

  const handleCanvasMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (event) cancelPendingOpenObjectFocus();
  }, [cancelPendingOpenObjectFocus]);

  useEffect(() => {
    if (!focusNodeId || !nodes.some((node) => node.id === focusNodeId)) return;
    const requestKey = `${focusNodeId}:${String(focusRequestKey ?? '')}`;
    if (lastFocusRequestRef.current === requestKey) return;
    if (view.kind !== 'table') {
      if (draggingNodeIdsRef.current.size > 0) return;
      lastFocusRequestRef.current = requestKey;
      flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.12, minZoom: 0.92, maxZoom: 1.15, duration: canvasMotionDuration(180) });
      return;
    }
    if (layoutReadyKey !== workspaceKey) return;
    lastFocusRequestRef.current = requestKey;
    requestOpenObjectFocus(focusNodeId, false, false);
  }, [focusNodeId, focusRequestKey, nodes, flow, view.kind, layoutReadyKey, workspaceKey, requestOpenObjectFocus]);

  const edges = useMemo(() => {
    const projected: Array<{
      id: string;
      source: string;
      sourcePort: string;
      target: string;
      targetHandle: string;
      valueType: string;
      depth: number;
    }> = [];
    const isRevisionPulse = revisionNotice !== null;
    const walk = (binding: Binding, source: string, sourcePort: string, depth: number, path: Set<string>) => {
      if (path.has(binding.id)) return;
      const nextPath = new Set(path).add(binding.id);
      if (visibleIds.has(binding.to.node)) {
        projected.push({
          id: `${source}.${sourcePort}-${binding.to.node}.${binding.to.port}-${[...nextPath].join('.')}`,
          source,
          sourcePort,
          target: binding.to.node,
          targetHandle: binding.to.port,
          valueType: binding.valueType,
          depth,
        });
        return;
      }
      for (const child of plan.bindings.filter((candidate) => candidate.from.node === binding.to.node)) {
        walk(child, source, sourcePort, depth + 1, nextPath);
      }
    };
    for (const binding of plan.bindings) {
      if (visibleIds.has(binding.from.node)) walk(binding, binding.from.node, binding.from.port, 0, new Set());
    }
    return dedupeVisibleCanvasConnections(projected).map((connection): CanvasEdge => {
      const targetRole = canvasRole(planNodesById.get(connection.target)?.capability ?? '', 'plan');
      const markerColor = roleColor(targetRole);
      const sourceTitle = planNodesById.get(connection.source)?.title ?? connection.source;
      const targetTitle = planNodesById.get(connection.target)?.title ?? connection.target;
      const label = relationshipLabel(connection.valueType);
      return {
        id: connection.id,
        source: connection.source,
        sourceHandle: connection.sourcePort,
        target: connection.target,
        targetHandle: connection.targetHandle,
        type: 'smoothstep',
        animated: isRevisionPulse,
        ariaLabel: `${sourceTitle} feeds ${targetTitle} with ${label}${connection.depth > 0 ? ` through ${connection.depth} intermediate plan step${connection.depth === 1 ? '' : 's'}` : ''}. Type: ${connection.valueType}.`,
        data: { relationshipLabel: label },
        markerEnd: { type: MarkerType.ArrowClosed, color: markerColor },
        style: { stroke: markerColor, strokeWidth: 2.2 },
      };
    });
  }, [plan.bindings, planNodesById, revisionNotice, visibleIds]);

  useEffect(() => {
    if (view.kind !== 'table' || nodes.length === 0) return;
    if (!nodes.every((node) => Number.isFinite(node.measured?.width) && Number.isFinite(node.measured?.height))) return;
    if (draggingNodeIdsRef.current.size > 0 || nodes.some((node) => node.dragging)) return;

    const layoutNodes: CanvasLayoutNode[] = nodes.map((node) => ({
      id: node.id,
      role: node.data.kind === 'plan' ? canvasLayoutRole(node.data.spec.capability, node.id) : 'reference',
      width: node.measured?.width ?? node.width ?? 360,
      height: node.measured?.height ?? node.height ?? 260,
      position: node.position,
      pinned: pinnedNodeIdsRef.current.has(node.id),
    }));
    const layoutEdges = edges.map((edge) => ({ source: edge.source, target: edge.target }));
    const ids = new Set(layoutNodes.map((node) => node.id));
    const sizes = new Map(layoutNodes.map((node) => [node.id, { width: node.width, height: node.height }]));
    const edgeKeys = new Set(layoutEdges.map((edge) => `${edge.source}\u0000${edge.target}`));
    const signature = JSON.stringify({
      nodes: layoutNodes.map((node) => [node.id, node.width, node.height, node.role]),
      edges: [...edgeKeys].sort(),
    });
    const previous = layoutSnapshotRef.current;
    if (previous?.workspaceKey === workspaceKey && previous.signature === signature) return;
    const initial = previous?.workspaceKey !== workspaceKey;
    const addedIds = initial ? ids : new Set([...ids].filter((id) => !previous?.ids.has(id)));
    const changedSizes = new Set(initial ? [] : layoutNodes.filter((node) => {
      const oldSize = previous?.sizes.get(node.id);
      return !!oldSize && (oldSize.width !== node.width || oldSize.height !== node.height);
    }).map((node) => node.id));
    const resizeDisplacedIds = unpinnedNodesOverlappingPinnedResizes(layoutNodes, changedSizes);
    const fixedIds = new Set<string>();
    const preferredPositions: Record<string, CanvasPoint> = {};
    const explicitAuxiliaryPositions = new Set(visibleAuxiliaryObjects.filter((object) => object.position).map((object) => object.id));

    if (initial) {
      for (const node of layoutNodes) {
        if (pinnedNodeIdsRef.current.has(node.id) || explicitAuxiliaryPositions.has(node.id)) fixedIds.add(node.id);
      }
    } else {
      for (const node of layoutNodes) {
        if (addedIds.has(node.id)) continue;
        if ((changedSizes.has(node.id) && !pinnedNodeIdsRef.current.has(node.id)) || resizeDisplacedIds.has(node.id)) {
          preferredPositions[node.id] = node.position!;
          continue;
        }
        fixedIds.add(node.id);
      }
    }

    const shouldLayout = initial || addedIds.size > 0 || changedSizes.size > 0;
    if (shouldLayout) {
      const result = layoutCanvas(layoutNodes, layoutEdges, {
        fixedIds,
        relationshipFirst: !initial,
        preferredPositions,
      });
      const changed = new Map<string, CanvasPoint>();
      for (const node of layoutNodes) {
        const next = result.positions[node.id];
        if (next && (Math.abs(next.x - node.position!.x) > 0.25 || Math.abs(next.y - node.position!.y) > 0.25)) changed.set(node.id, next);
      }
      if (changed.size > 0) {
        setNodes((current) => current.map((node) => {
          const position = changed.get(node.id);
          return position ? { ...node, position } : node;
        }));
      }
    }

    layoutSnapshotRef.current = { workspaceKey, ids, sizes, edges: edgeKeys, signature };
    if (initial) setLayoutReadyKey(workspaceKey);
  }, [view.kind, nodes, edges, workspaceKey, visibleAuxiliaryObjects, setNodes]);

  // Cards nobody has placed yet are laid out on each screen. Once that first layout is
  // ready, write it to the table so everyone starts from the same arrangement (F007).
  const seededLayoutRef = useRef('');
  useEffect(() => {
    if (!remoteLayoutEnabled || layoutReadyKey !== workspaceKey || seededLayoutRef.current === workspaceKey) return;
    if (view.actor.role !== 'owner' && view.actor.role !== 'participant') return;
    const known = sharedLayoutRef.current?.positions ?? {};
    const missing = nodes.filter((node) => isSharedCanvasNode(node.id) && !known[node.id] && !draggingNodeIdsRef.current.has(node.id)).slice(0, 24);
    seededLayoutRef.current = workspaceKey;
    if (missing.length === 0) return;
    const positions = Object.fromEntries(missing.map((node) => [node.id, { x: Math.round(node.position.x), y: Math.round(node.position.y), pinned: true }]));
    void onCommand('canvas.layout', { expectedLayoutRevision: sharedLayoutRef.current?.revision ?? 0, positions }).catch(() => null);
  }, [remoteLayoutEnabled, layoutReadyKey, workspaceKey, nodes, onCommand, view.actor.role]);

  const choose = useCallback((event: React.MouseEvent, node: CanvasNode) => {
    // A content control may have navigated to another object. Do not select its
    // old container again while that same click bubbles through React Flow.
    if (event.target instanceof Element && event.target.closest('.tt-canvas-node__body')) return;
    onSelectNode(node.id);
  }, [onSelectNode]);
  const clear = useCallback(() => onSelectNode(null), [onSelectNode]);

  useEffect(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: { ...node.data, selected: node.id === selectedNodeId },
    })));
  }, [selectedNodeId, setNodes]);

  const objectTitles = useMemo(() => [
    ...visiblePlanNodes.map((spec) => ({ id: spec.id, title: spec.title })),
    ...visibleAuxiliaryObjects.map((object) => ({ id: object.id, title: object.title })),
  ], [visiblePlanNodes, visibleAuxiliaryObjects]);
  const visibleEdges = showConnections ? edges : [];
  const hasVisibleObjects = objectTitles.length > 0;

  return (
    <div
      className="tt-flow-wrap"
      ref={flowWrapRef}
      data-canvas-editor
      data-testid="canvas-object-workspace"
      onPointerDownCapture={cancelPendingOpenObjectFocus}
      onKeyDownCapture={cancelPendingOpenObjectFocus}
    >
      {!hasVisibleObjects ? (
        <div className="tt-canvas-empty">
          <span><Workflow size={19} /></span>
          {emptyContent ?? <><strong>This table is ready for its first object</strong><p>Add a source or start the sample workflow from the table panel.</p></>}
        </div>
      ) : (
        <ReactFlow<CanvasNode, CanvasEdge>
          nodes={nodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          onNodesChange={handleNodesChange}
          onMoveStart={handleCanvasMoveStart}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={persistPosition}
          onNodeClick={choose}
          onPaneClick={clear}
          onMoveEnd={persistViewport}
          nodesDraggable
          nodesConnectable={false}
          elementsSelectable
          elevateNodesOnSelect={false}
          minZoom={0.25}
          maxZoom={1.7}
          panOnDrag
          panOnScroll={false}
          zoomOnDoubleClick={false}
          aria-label="Table objects and connected data"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={21} size={1} color="#ccd5d7" />
          <Controls
            position="bottom-right"
            showInteractive={false}
            showFitView={false}
            onZoomIn={cancelPendingOpenObjectFocus}
            onZoomOut={cancelPendingOpenObjectFocus}
          />
        </ReactFlow>
      )}
      <div className="tt-canvas-tools">
        <div className="tt-canvas-objects" ref={objectsMenuRef} onKeyDown={(event) => {
          if (event.key === 'Escape' && objectsMenuOpen) {
            event.preventDefault();
            event.stopPropagation();
            setObjectsMenuOpen(false);
            window.requestAnimationFrame(() => objectsButtonRef.current?.focus());
          }
        }}>
          <button ref={objectsButtonRef} className="tt-canvas-objects__trigger" type="button" data-testid="canvas-object-menu-trigger" aria-expanded={objectsMenuOpen} aria-controls="tt-canvas-objects-list" aria-label={`Objects, ${objectTitles.length}`} onClick={(event) => { event.stopPropagation(); setObjectsMenuOpen((open) => !open); }}>
            <Boxes size={17} aria-hidden="true" /><span>Objects</span><small>{objectTitles.length}</small>
          </button>
          <nav id="tt-canvas-objects-list" className="tt-canvas-objects__panel" aria-label="Canvas objects" data-testid="canvas-object-dock" hidden={!objectsMenuOpen}>
            {previousView && <button type="button" onClick={() => { cancelPendingOpenObjectFocus(); void flow.setViewport(previousView, { duration: canvasMotionDuration(180) }); setPreviousView(null); setObjectsMenuOpen(false); objectsButtonRef.current?.focus(); }}><ArrowLeft size={16} aria-hidden="true" />Previous view</button>}
            <button className="tt-canvas-connections" type="button" data-testid="canvas-connections-toggle" aria-pressed={showConnections} aria-label={`Connections, ${edges.length}`} onClick={(event) => { event.stopPropagation(); setShowConnections((shown) => !shown); }}>
              <Workflow size={16} aria-hidden="true" /><span>Connections</span><small>{edges.length}</small><i aria-hidden="true">{showConnections ? 'On' : 'Off'}</i>
            </button>
            <ul className="tt-canvas-objects__list">
              {objectTitles.map((object) => <li key={object.id}>
                <button type="button" data-testid={`open-canvas-${object.id}`} aria-label={`Open ${object.title}`} aria-current={selectedNodeId === object.id ? 'location' : undefined} aria-expanded={activeOpenedId === object.id} onClick={(event) => { event.stopPropagation(); navigateToObject(object.id); }}>{object.title}</button>
              </li>)}
            </ul>
          </nav>
        </div>
        {revisionNotice && <div key={revisionNotice.key} className="tt-canvas-revision-change" role="status" aria-live="polite" aria-atomic="true">
          <Activity size={14} aria-hidden="true" /><b>{revisionNotice.message}</b>
        </div>}
      </div>
    </div>
  );
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
