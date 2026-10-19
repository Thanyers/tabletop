import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Workflow } from 'lucide-react';
import type { ExecutablePlan, PlanNode } from './types';
import type { Binding } from '../runtime';
import type { WorkspaceView, PhysicsParams } from '../shared/contracts';
import type { WorkbenchProps } from './types';
import { CanvasObjectContent } from './CanvasObjectContent';
import { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds } from './CanvasObjectIds';

export { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds };

interface CanvasNodeBaseData extends Record<string, unknown> {
  kind: 'plan' | 'auxiliary';
  id: string;
  title: string;
  capability: string;
  selected: boolean;
  opened: boolean;
  onToggleOpen: (id: string) => void;
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

function CanvasObjectNode({ data, selected }: NodeProps<CanvasNode>) {
  const openButtonRef = useRef<HTMLButtonElement>(null);

  if (data.kind === 'auxiliary') {
    return (
      <article
        className={'tt-canvas-node tt-canvas-node--auxiliary' + (selected ? ' is-selected' : '') + (data.opened ? ' is-expanded' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-testid={data.opened ? 'canvas-object-editor' : undefined}
        data-object-id={data.opened ? data.id : undefined}
        aria-label={data.title}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && data.opened) {
            event.preventDefault();
            event.stopPropagation();
            data.onToggleOpen(data.id);
            window.requestAnimationFrame(() => openButtonRef.current?.focus());
          }
        }}
      >
        <header className="tt-canvas-node__head">
          <span className="tt-object-glyph" aria-hidden="true"><Workflow size={15} /></span>
          <span className="tt-canvas-node__title">{data.title}</span>
          <span className="tt-canvas-node__capability">{data.auxiliary.eyebrow ?? 'TABLE TOOL'}</span>
          <button ref={openButtonRef} className="tt-canvas-node__open nodrag nopan" type="button" aria-expanded={data.opened} aria-label={data.opened ? 'Close object' : `Open ${data.title}`} onClick={(event) => { event.stopPropagation(); data.onToggleOpen(data.id); }}>
            {data.opened ? 'Close' : 'Open'}
          </button>
        </header>
        <div className="tt-canvas-node__body nodrag nopan">{data.auxiliary.renderContent?.(data.opened) ?? data.auxiliary.content}</div>
      </article>
    );
  }

  const inputPorts = Object.keys(data.spec.inputs);
  const outputPorts = Object.keys(data.outputs);
  const capability = data.spec.capability.split('.').slice(-1)[0]?.replaceAll('-', ' ') ?? 'component';

  return (
    <article
      className={'tt-canvas-node tt-canvas-node--' + data.spec.id.replaceAll('.', '-') + (selected ? ' is-selected' : '') + (data.opened ? ' is-expanded' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-testid={data.opened ? 'canvas-object-editor' : undefined}
        data-object-id={data.opened ? data.id : undefined}
      aria-label={data.spec.title + ', ' + capability}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && data.opened) {
          event.preventDefault();
          event.stopPropagation();
          data.onToggleOpen(data.id);
          window.requestAnimationFrame(() => openButtonRef.current?.focus());
        }
      }}
    >
      {inputPorts.map((port, index) => <Handle key={`in-${port}`} type="target" position={Position.Left} id={port} style={portStyle(index, inputPorts.length)} />)}
      {outputPorts.map((port, index) => <Handle key={`out-${port}`} type="source" position={Position.Right} id={port} style={portStyle(index, outputPorts.length)} />)}
      <header className="tt-canvas-node__head">
        <span className="tt-object-glyph" aria-hidden="true"><Workflow size={15} /></span>
        <span className="tt-canvas-node__title">{data.spec.title}</span>
        <span className="tt-canvas-node__capability">{capability}</span>
        <button ref={openButtonRef} className="tt-canvas-node__open nodrag nopan" type="button" aria-expanded={data.opened} aria-label={data.opened ? 'Close object' : `Open ${data.spec.title}`} onClick={(event) => { event.stopPropagation(); data.onToggleOpen(data.id); }}>
          {data.opened ? 'Close' : 'Open'}
        </button>
      </header>
      <div className="tt-canvas-node__body nodrag nopan">
        <CanvasObjectContent view={data.view} node={data.spec} outputs={data.outputs} busy={data.busy} onCommand={data.onCommand} onUpload={data.onUpload} onTableImport={data.onTableImport} onExport={data.onExport} onFocusEvidence={data.onFocusEvidence} focusSourceIds={data.focusSourceIds} localPhysics={data.localPhysics} onLocalPhysicsChange={data.onLocalPhysicsChange} onResetLocalPhysics={data.onResetLocalPhysics} expanded={data.opened} />
      </div>
    </article>
  );
}

const nodeTypes: NodeTypes = { tabletopObject: CanvasObjectNode };

interface CanvasWorkspaceProps {
  view: WorkspaceView;
  plan: ExecutablePlan;
  mode: 'use' | 'arrange';
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
  visibleNodeIds?: readonly string[];
  focusNodeId?: string | null;
  focusRequestKey?: string | number;
  auxiliaryObjects?: readonly CanvasAuxiliaryObject[];
  emptyContent?: ReactNode;
  openedObjectId?: string | null;
  onOpenObject?: (id: string | null) => void;
}

function CanvasInner({ view, plan, mode, selectedNodeId, onSelectNode, onCommand, busy, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, persistLayout = true, visibleNodeIds, focusNodeId, focusRequestKey, auxiliaryObjects = [], emptyContent, openedObjectId, onOpenObject }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const flow = useReactFlow<CanvasNode, Edge>();
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
  const visibleAuxiliaryObjects = useMemo(() => auxiliaryObjects.filter((object) => !planIds.has(object.id) && (!allowedNodeIds || allowedNodeIds.has(object.id))), [auxiliaryObjects, planIds, allowedNodeIds]);
  const visibleIds = useMemo(() => new Set([...visiblePlanNodes.map((spec) => spec.id), ...visibleAuxiliaryObjects.map((object) => object.id)]), [visiblePlanNodes, visibleAuxiliaryObjects]);
  const [internalOpenedId, setInternalOpenedId] = useState<string | null>(null);
  const activeOpenedId = openedObjectId === undefined ? internalOpenedId : openedObjectId;
  const lastFocusRequestRef = useRef<string | null>(null);

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
  const toggleOpenObject = useCallback((id: string) => {
    const nextId = activeOpenedId === id ? null : id;
    if (openedObjectId === undefined) setInternalOpenedId(nextId);
    onOpenObject?.(nextId);
    onSelectNode(id);
    window.requestAnimationFrame(() => flow.fitView({ nodes: [{ id }], padding: 0.12, minZoom: 0.62, maxZoom: 1, duration: 160 }));
  }, [activeOpenedId, openedObjectId, onOpenObject, onSelectNode, flow]);
  const openObject = useCallback((id: string) => {
    if (!nodes.some((node) => node.id === id)) return;
    if (openedObjectId === undefined) setInternalOpenedId(id);
    onOpenObject?.(id);
    onSelectNode(id);
    window.requestAnimationFrame(() => flow.fitView({ nodes: [{ id }], padding: 0.12, minZoom: 0.62, maxZoom: 1, duration: 160 }));
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
          localPhysics,
          onLocalPhysicsChange: changeLocalPhysics,
          onResetLocalPhysics: resetLocalPhysics,
        },
      }));
      const maxY = visiblePlanNodes.reduce((maximum, spec) => Math.max(maximum, (previousPositions.get(spec.id) ?? workspacePositionsRef.current[spec.id] ?? defaultCanvasPosition(view.kind, spec)).y), 0);
      const auxiliaryNodes = visibleAuxiliaryObjects.map((object, index): CanvasNode => ({
        id: object.id,
        type: 'tabletopObject',
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
          selected: object.id === selectedNodeId,
          auxiliary: object,
        },
      }));
      return [...planNodes, ...auxiliaryNodes];
    });
  }, [workspaceKey, persistLayout, visiblePlanNodes, visibleAuxiliaryObjects, plan.outputs, selectedNodeId, activeOpenedId, setNodes, view, busy, onCommand, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, localPhysics, changeLocalPhysics, resetLocalPhysics, toggleOpenObject]);

  useEffect(() => {
    if (!initialViewPendingRef.current || nodes.length === 0 || !nodes.every((node) => node.data.kind === 'auxiliary' || node.data.view.id === view.id && node.data.view.epoch === view.epoch)) return;
    initialViewPendingRef.current = false;
    const savedViewport = pendingViewportRef.current;
    pendingViewportRef.current = undefined;
    const preferredId = view.kind === 'invoice' ? 'invoice.source' : view.kind === 'teaching' ? nodes.find((node) => node.id === 'lesson.scene' || node.id === 'lesson.graph')?.id : 'encounter.board';
    const targetId = preferredId && nodes.some((node) => node.id === preferredId) ? preferredId : nodes[0]?.id;
    requestAnimationFrame(() => {
      if (focusNodeId && nodes.some((node) => node.id === focusNodeId)) {
        flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.14, minZoom: 0.62, maxZoom: 1, duration: 0 });
      } else if (savedViewport) {
        flow.setCenter(savedViewport.centerX, savedViewport.centerY, { zoom: savedViewport.zoom, duration: 0 });
      } else if (targetId) {
        flow.fitView({ nodes: [{ id: targetId }], padding: 0.16, minZoom: 0.62, maxZoom: 0.95, duration: 0 });
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
    const position = { x: node.position.x, y: node.position.y };
    workspacePositionsRef.current = { ...workspacePositionsRef.current, [node.id]: position };
    if (!persistLayout) return;
    const current = readCanvasLayout(workspaceKey);
    current.positions[node.id] = position;
    writeCanvasLayout(workspaceKey, current);
  }, [workspaceKey, persistLayout]);

  const focusSelected = useCallback(() => {
    if (!selectedNodeId) return;
    flow.fitView({ nodes: [{ id: selectedNodeId }], padding: 0.14, minZoom: 0.85, maxZoom: 1, duration: 180 });
  }, [flow, selectedNodeId]);

  useEffect(() => {
    if (!focusNodeId || !nodes.some((node) => node.id === focusNodeId)) return;
    const requestKey = `${focusNodeId}:${String(focusRequestKey ?? '')}`;
    if (lastFocusRequestRef.current === requestKey) return;
    lastFocusRequestRef.current = requestKey;
        flow.fitView({ nodes: [{ id: focusNodeId }], padding: 0.14, minZoom: 0.62, maxZoom: 1, duration: 180 });
  }, [focusNodeId, focusRequestKey, nodes, flow]);

  const edges = useMemo(() => {
    const result: Edge[] = [];
    const walk = (binding: Binding, source: string, sourcePort: string, depth: number, path: Set<string>) => {
      if (path.has(binding.id)) return;
      const nextPath = new Set(path).add(binding.id);
      if (visibleIds.has(binding.to.node)) {
        result.push({
          id: `${source}.${sourcePort}-${binding.to.node}.${binding.to.port}-${[...nextPath].join('.')}`,
          source,
          sourceHandle: sourcePort,
          target: binding.to.node,
          targetHandle: binding.to.port,
          label: depth === 0 ? binding.valueType : `Derived · ${depth} step${depth === 1 ? '' : 's'}`,
          type: 'smoothstep',
          style: { stroke: '#78a99d', strokeWidth: 1.8 },
          labelStyle: { fill: '#4f766e', fontSize: 10, fontWeight: 600 },
          labelBgStyle: { fill: '#f4f8f7', fillOpacity: 0.96 },
          labelBgPadding: [5, 3],
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
    return result;
  }, [plan.bindings, visibleIds]);

  const choose = useCallback((event: React.MouseEvent, node: CanvasNode) => {
    // A content control may have navigated to another object. Do not select its
    // old container again while that same click bubbles through React Flow.
    if (event.target instanceof Element && event.target.closest('.tt-canvas-node__body')) return;
    onSelectNode(node.id);
  }, [onSelectNode]);
  const clear = useCallback(() => onSelectNode(null), [onSelectNode]);
  const arrange = mode === 'arrange';

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
  const hasVisibleObjects = objectTitles.length > 0;

  return (
    <div className="tt-flow-wrap" ref={flowWrapRef} data-canvas-editor data-testid="canvas-object-workspace">
      {!hasVisibleObjects ? (
        <div className="tt-canvas-empty">
          <span><Workflow size={19} /></span>
          {emptyContent ?? <><strong>This table is ready for its first object</strong><p>Add a source or start the sample workflow from the table panel.</p></>}
        </div>
      ) : (
        <ReactFlow<CanvasNode, Edge>
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onNodeDragStop={persistPosition}
          onNodeClick={choose}
          onPaneClick={clear}
          onMoveEnd={persistViewport}
          nodesDraggable={arrange}
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
          <Controls position="bottom-right" showInteractive={false} />
        </ReactFlow>
      )}
      {hasVisibleObjects && <nav className="tt-canvas-object-dock" aria-label="Objects on this canvas" data-testid="canvas-object-dock">
        <span className="tt-canvas-object-dock__label">OPEN AN OBJECT</span>
        <div>{objectTitles.map((object) => <button key={object.id} type="button" data-testid={`open-canvas-${object.id}`} aria-label={`Open ${object.title}`} aria-expanded={activeOpenedId === object.id} onClick={() => openObject(object.id)}>{object.title}</button>)}</div>
      </nav>}
      <div className="tt-canvas-stamp" aria-hidden="true">
        <span>WORKSPACE FLOW</span><i />{objectTitles.length} object{objectTitles.length === 1 ? '' : 's'}<i />{edges.length} visible connection{edges.length === 1 ? '' : 's'}
      </div>
      <div className="tt-canvas-actions">
        <button type="button" onClick={focusSelected} disabled={!selectedNodeId || !nodes.some((node) => node.id === selectedNodeId)}>Focus object</button>
        <button type="button" onClick={() => flow.fitView({ padding: 0.28, duration: 0 })}>Fit objects</button>
      </div>
    </div>
  );
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
