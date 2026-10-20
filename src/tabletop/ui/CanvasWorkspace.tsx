import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, BackgroundVariant, Controls, Handle, MarkerType, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node, type NodeChange, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, BookOpenCheck, Boxes, ChartLine, Database, GripVertical, ListChecks, Move, Play, Scale, Swords, Table2, Workflow } from 'lucide-react';
import type { ExecutablePlan, PlanNode } from './types';
import type { Binding } from '../runtime';
import type { WorkspaceView, PhysicsParams } from '../shared/contracts';
import type { WorkbenchProps } from './types';
import { CanvasObjectContent } from './CanvasObjectContent';
import { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds } from './CanvasObjectIds';
import { dedupeVisibleCanvasConnections } from './canvas-flow';
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
  positions: Record<string, { x: number; y: number }>;
  viewport?: { centerX: number; centerY: number; zoom: number };
}

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
        if (point && Number.isFinite(point.x) && Number.isFinite(point.y) && Math.abs(point.x) < 100_000 && Math.abs(point.y) < 100_000) {
          positions[id] = { x: point.x, y: point.y };
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
        <CanvasObjectContent view={data.view} node={data.spec} outputs={data.outputs} busy={data.busy} onCommand={data.onCommand} onUpload={data.onUpload} onTableImport={data.onTableImport} onExport={data.onExport} onFocusEvidence={data.onFocusEvidence} focusSourceIds={data.focusSourceIds} localPhysics={data.localPhysics} onLocalPhysicsChange={data.onLocalPhysicsChange} onResetLocalPhysics={data.onResetLocalPhysics} preparedDemoArt={data.preparedDemoArt} expanded={data.opened} />
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
}

function CanvasInner({ view, plan, selectedNodeId, onSelectNode, onCommand, busy, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, persistLayout = true, preparedDemoArt = false, visibleNodeIds, focusNodeId, focusRequestKey, auxiliaryObjects = [], emptyContent, openedObjectId, onOpenObject }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const flowWrapRef = useRef<HTMLDivElement>(null);
  const workspaceKey = view.id + ':' + view.epoch;
  const layoutWorkspaceRef = useRef('');
  const workspacePositionsRef = useRef<SavedCanvasLayout['positions']>({});
  const pendingViewportRef = useRef<SavedCanvasLayout['viewport'] | undefined>(undefined);
  const initialViewPendingRef = useRef(false);
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

  const rememberPosition = useCallback((id: string, position: { x: number; y: number }) => {
    workspacePositionsRef.current = { ...workspacePositionsRef.current, [id]: position };
    if (!persistLayout) return;
    const layout = readCanvasLayout(workspaceKey);
    layout.positions[id] = position;
    writeCanvasLayout(workspaceKey, layout);
  }, [persistLayout, workspaceKey]);

  const moveCanvasObject = useCallback((id: string, dx: number, dy: number) => {
    const node = flow.getNode(id);
    if (!node) return;
    const position = { x: node.position.x + dx * 48, y: node.position.y + dy * 48 };
    rememberPosition(id, position);
    setNodes((current) => current.map((candidate) => candidate.id === id ? { ...candidate, position } : candidate));
  }, [flow, rememberPosition, setNodes]);

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
    setPreviousView(flow.getViewport());
    if (openedObjectId === undefined) setInternalOpenedId(id);
    onOpenObject?.(id);
    onSelectNode(id);
    setObjectsMenuOpen(false);
    window.requestAnimationFrame(() => {
      flow.fitView({ nodes: [{ id }], padding: 0.12, minZoom: 0.92, maxZoom: 1.15, duration: canvasMotionDuration(200) });
      objectsButtonRef.current?.focus();
    });
  }, [flow, nodes, onOpenObject, openedObjectId, onSelectNode]);

  useEffect(() => {
    const isNewWorkspace = layoutWorkspaceRef.current !== workspaceKey;
    const storedLayout = isNewWorkspace && persistLayout ? readCanvasLayout(workspaceKey) : null;
    if (isNewWorkspace) {
      layoutWorkspaceRef.current = workspaceKey;
      workspacePositionsRef.current = storedLayout?.positions ?? {};
      pendingViewportRef.current = storedLayout?.viewport;
      initialViewPendingRef.current = true;
    }
    setNodes((existing) => {
      const previousPositions = new Map(existing.map((node) => [node.id, node.position]));
      const planNodes = visiblePlanNodes.map((spec): CanvasNode => ({
        id: spec.id,
        type: 'tabletopObject',
        ariaLabel: spec.title,
        dragHandle: '.tt-canvas-node__head',
        position: (isNewWorkspace ? storedLayout?.positions[spec.id] : undefined) ?? previousPositions.get(spec.id) ?? workspacePositionsRef.current[spec.id] ?? defaultCanvasPosition(view.kind, spec),
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
        },
      }));
      const maxY = visiblePlanNodes.reduce((maximum, spec) => Math.max(maximum, (previousPositions.get(spec.id) ?? workspacePositionsRef.current[spec.id] ?? defaultCanvasPosition(view.kind, spec)).y), 0);
      const auxiliaryNodes = visibleAuxiliaryObjects.map((object, index): CanvasNode => ({
        id: object.id,
        type: 'tabletopObject',
        ariaLabel: object.title,
        dragHandle: '.tt-canvas-node__head',
        position: (isNewWorkspace ? storedLayout?.positions[object.id] : undefined) ?? previousPositions.get(object.id) ?? workspacePositionsRef.current[object.id] ?? object.position ?? { x: 40, y: maxY + 340 + index * 360 },
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
  }, [workspaceKey, persistLayout, preparedDemoArt, visiblePlanNodes, visibleAuxiliaryObjects, plan.outputs, selectedNodeId, activeOpenedId, setNodes, view, busy, onCommand, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, localPhysics, changeLocalPhysics, resetLocalPhysics, toggleOpenObject, onSelectNode, moveCanvasObject]);

  useEffect(() => {
    if (!initialViewPendingRef.current || nodes.length === 0 || !nodes.every((node) => node.data.kind === 'auxiliary' || node.data.view.id === view.id && node.data.view.epoch === view.epoch)) return;
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
  }, [workspaceKey, nodes, view.id, view.kind, flow, focusNodeId]);

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

  const persistPosition = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    rememberPosition(node.id, { x: node.position.x, y: node.position.y });
  }, [rememberPosition]);

  const handleNodesChange = useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes);
    for (const change of changes) {
      if (change.type === 'position' && change.position && change.dragging !== true) {
        rememberPosition(change.id, change.position);
      }
    }
  }, [onNodesChange, rememberPosition]);

  useEffect(() => {
    if (!focusNodeId || !nodes.some((node) => node.id === focusNodeId)) return;
    const requestKey = `${focusNodeId}:${String(focusRequestKey ?? '')}`;
    if (lastFocusRequestRef.current === requestKey) return;
    lastFocusRequestRef.current = requestKey;
        flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.12, minZoom: 0.92, maxZoom: 1.15, duration: canvasMotionDuration(180) });
  }, [focusNodeId, focusRequestKey, nodes, flow]);

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
    <div className="tt-flow-wrap" ref={flowWrapRef} data-canvas-editor data-testid="canvas-object-workspace">
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
          <Controls position="bottom-right" showInteractive={false} showFitView={false} />
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
            {previousView && <button type="button" onClick={() => { void flow.setViewport(previousView, { duration: canvasMotionDuration(180) }); setPreviousView(null); setObjectsMenuOpen(false); objectsButtonRef.current?.focus(); }}><ArrowLeft size={16} aria-hidden="true" />Previous view</button>}
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
