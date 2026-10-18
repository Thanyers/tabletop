import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Background, BackgroundVariant, Controls, Handle, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type Node, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Workflow } from 'lucide-react';
import type { ExecutablePlan, PlanNode } from './types';
import type { Binding } from '../runtime';
import type { WorkspaceView, PhysicsParams } from '../shared/contracts';
import type { WorkbenchProps } from './types';
import { CanvasObjectContent } from './CanvasObjectContent';

interface CanvasNodeData extends Record<string, unknown> {
  spec: PlanNode;
  outputs: Record<string, unknown>;
  selected: boolean;
  view: WorkspaceView;
  busy: string | null;
  onCommand: WorkbenchProps['onCommand'];
  onUpload: WorkbenchProps['onUpload'];
  onFocusEvidence: WorkbenchProps['onFocusEvidence'];
  focusSourceIds: string[];
  localPhysics: PhysicsParams;
  onLocalPhysicsChange: (value: PhysicsParams) => void;
  onResetLocalPhysics: () => void;
}

type CanvasNode = Node<CanvasNodeData, 'tabletopObject'>;

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
  const inputPorts = Object.keys(data.spec.inputs);
  const outputPorts = Object.keys(data.outputs);
  const capability = data.spec.capability.split('.').slice(-1)[0]?.replaceAll('-', ' ') ?? 'component';

  return (
    <article className={'tt-canvas-node tt-canvas-node--' + data.spec.id.replaceAll('.', '-') + (selected ? ' is-selected' : '')} aria-label={data.spec.title + ', ' + capability}>
      {inputPorts.map((port, index) => <Handle key={`in-${port}`} type="target" position={Position.Left} id={port} style={portStyle(index, inputPorts.length)} />)}
      {outputPorts.map((port, index) => <Handle key={`out-${port}`} type="source" position={Position.Right} id={port} style={portStyle(index, outputPorts.length)} />)}
      <header className="tt-canvas-node__head">
        <span className="tt-object-glyph" aria-hidden="true"><Workflow size={15} /></span>
        <span className="tt-canvas-node__title">{data.spec.title}</span>
        <span className="tt-canvas-node__capability">{capability}</span>
      </header>
      <div className="tt-canvas-node__body nodrag nopan">
        <CanvasObjectContent view={data.view} node={data.spec} outputs={data.outputs} busy={data.busy} onCommand={data.onCommand} onUpload={data.onUpload} onFocusEvidence={data.onFocusEvidence} focusSourceIds={data.focusSourceIds} localPhysics={data.localPhysics} onLocalPhysicsChange={data.onLocalPhysicsChange} onResetLocalPhysics={data.onResetLocalPhysics} />
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
  onFocusEvidence: WorkbenchProps['onFocusEvidence'];
  focusSourceIds: string[];
}

function CanvasInner({ view, plan, mode, selectedNodeId, onSelectNode, onCommand, busy, onUpload, onFocusEvidence, focusSourceIds }: CanvasWorkspaceProps) {
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
  const visiblePlanNodes = useMemo(() => plan.nodes.filter((spec) => spec.visible !== false), [plan.nodes]);
  const visibleIds = useMemo(() => new Set(visiblePlanNodes.map((spec) => spec.id)), [visiblePlanNodes]);

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

  useEffect(() => {
    const isNewWorkspace = layoutWorkspaceRef.current !== workspaceKey;
    const storedLayout = isNewWorkspace ? readCanvasLayout(workspaceKey) : null;
    if (isNewWorkspace) {
      layoutWorkspaceRef.current = workspaceKey;
      workspacePositionsRef.current = storedLayout?.positions ?? {};
      pendingViewportRef.current = storedLayout?.viewport;
      initialViewPendingRef.current = true;
    }
    setNodes((existing) => {
      const previousPositions = new Map(existing.map((node) => [node.id, node.position]));
      return visiblePlanNodes.map((spec): CanvasNode => ({
        id: spec.id,
        type: 'tabletopObject',
        position: (isNewWorkspace ? storedLayout?.positions[spec.id] : undefined) ?? previousPositions.get(spec.id) ?? workspacePositionsRef.current[spec.id] ?? defaultCanvasPosition(view.kind, spec),
        selected: spec.id === selectedNodeId,
        data: {
          spec,
          outputs: plan.outputs?.[spec.id] ?? {},
          selected: spec.id === selectedNodeId,
          view,
          busy,
          onCommand,
          onUpload,
          onFocusEvidence,
          focusSourceIds,
          localPhysics,
          onLocalPhysicsChange: changeLocalPhysics,
          onResetLocalPhysics: resetLocalPhysics,
        },
      }));
    });
  }, [workspaceKey, visiblePlanNodes, plan.outputs, selectedNodeId, setNodes, view, busy, onCommand, onUpload, onFocusEvidence, focusSourceIds, localPhysics, changeLocalPhysics, resetLocalPhysics]);

  useEffect(() => {
    if (!initialViewPendingRef.current || nodes.length === 0 || !nodes.every((node) => node.data.view.id === view.id && node.data.view.epoch === view.epoch)) return;
    initialViewPendingRef.current = false;
    const savedViewport = pendingViewportRef.current;
    pendingViewportRef.current = undefined;
    const preferredId = view.kind === 'invoice' ? 'invoice.table' : view.kind === 'teaching' ? nodes.find((node) => node.id === 'lesson.scene' || node.id === 'lesson.graph')?.id : 'encounter.board';
    const targetId = preferredId && nodes.some((node) => node.id === preferredId) ? preferredId : nodes[0]?.id;
    requestAnimationFrame(() => {
      if (savedViewport) {
        flow.setCenter(savedViewport.centerX, savedViewport.centerY, { zoom: savedViewport.zoom, duration: 0 });
      } else if (targetId) {
        flow.fitView({ nodes: [{ id: targetId }], padding: 0.16, minZoom: 0.85, maxZoom: 0.95, duration: 0 });
      }
    });
  }, [workspaceKey, nodes, view.id, view.kind, flow]);

  const persistViewport = useCallback((_event: MouseEvent | TouchEvent | null, viewport: { x: number; y: number; zoom: number }) => {
    const bounds = flowWrapRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0 || viewport.zoom <= 0) return;
    const current = readCanvasLayout(workspaceKey);
    current.viewport = {
      centerX: (bounds.width / 2 - viewport.x) / viewport.zoom,
      centerY: (bounds.height / 2 - viewport.y) / viewport.zoom,
      zoom: viewport.zoom,
    };
    writeCanvasLayout(workspaceKey, current);
  }, [workspaceKey]);

  const persistPosition = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode) => {
    const current = readCanvasLayout(workspaceKey);
    current.positions[node.id] = { x: node.position.x, y: node.position.y };
    workspacePositionsRef.current = { ...workspacePositionsRef.current, [node.id]: current.positions[node.id] };
    writeCanvasLayout(workspaceKey, current);
  }, [workspaceKey]);

  const focusSelected = useCallback(() => {
    if (!selectedNodeId) return;
    flow.fitView({ nodes: [{ id: selectedNodeId }], padding: 0.14, minZoom: 0.85, maxZoom: 1, duration: 180 });
  }, [flow, selectedNodeId]);

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

  const choose = useCallback((_event: React.MouseEvent, node: CanvasNode) => onSelectNode(node.id), [onSelectNode]);
  const clear = useCallback(() => onSelectNode(null), [onSelectNode]);
  const arrange = mode === 'arrange';

  useEffect(() => {
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId,
      data: { ...node.data, selected: node.id === selectedNodeId },
    })));
  }, [selectedNodeId, setNodes]);

  return (
    <div className="tt-flow-wrap" ref={flowWrapRef}>
      {plan.nodes.length === 0 ? (
        <div className="tt-canvas-empty">
          <span><Workflow size={19} /></span>
        <strong>This table is ready for its first object</strong>
          <p>Add a source or start the sample workflow from the table panel.</p>
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
      <div className="tt-canvas-stamp" aria-hidden="true">
        <span>WORKSPACE FLOW</span><i />{visiblePlanNodes.length} object{visiblePlanNodes.length === 1 ? '' : 's'}<i />{edges.length} visible connection{edges.length === 1 ? '' : 's'}
      </div>
      <div className="tt-canvas-actions">
        <button type="button" onClick={focusSelected} disabled={!selectedNodeId}>Focus object</button>
        <button type="button" onClick={() => flow.fitView({ padding: 0.28, duration: 0 })}>Fit objects</button>
      </div>
    </div>
  );
}

export function CanvasWorkspace(props: CanvasWorkspaceProps) {
  return <ReactFlowProvider><CanvasInner {...props} /></ReactFlowProvider>;
}
