import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { cardsClosedOnFirstLook, createCanvasViewState, isCanvasPosition, type CardSizes, type CanvasStorage, type SavedCanvasLayout } from './canvas-view-state';
import { Background, BackgroundVariant, Controls, Handle, NodeResizer, Position, ReactFlow, ReactFlowProvider, useNodesState, useReactFlow, type Edge, type EdgeTypes, type Node, type NodeChange, type NodeProps, type NodeTypes } from '@xyflow/react';
import { Activity, ArrowLeft, BookOpenCheck, Boxes, ChartLine, Database, GripVertical, ListChecks, Play, Scale, Swords, Table2, Workflow, Maximize2, Minimize2, X, LayoutGrid, Eye, EyeOff, MessageSquareText, Trash2, Undo2, Star, Pencil, Search } from 'lucide-react';
import type { ExecutablePlan, PlanNode } from './types';
import type { Binding } from '../runtime';
import type { WorkspaceView, PhysicsParams } from '../shared/contracts';
import type { CanvasCardMeta } from '../shared/table-contracts';
import type { WorkbenchProps } from './types';
import { resolveCardMeta } from '../domain/table-card-meta';
import { CARD_SORT_OPTIONS, cardMetaDescription, cardMetaLabel, parseCardSortMode, sortCardRows, useCardNow, type CardSortMode } from './canvas-card-meta';
import { CanvasObjectContent } from './CanvasObjectContent';
import { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds } from './CanvasObjectIds';
import { viewerCan } from '../shared/permissions';
import { matchCanvasObjects, referenceCardInChat, registerCanvasObjectFinder, registerCanvasPointFocus } from './canvas-object-finder';
import { isSharedCanvasId } from '../shared/canvas-layout-ids';
import { dedupeVisibleCanvasConnections, followUpConnections, followUpPosition, isCanvasNoteId, type CanvasFollowUpLink, readConnectionsPreference, resolveConnectionsVisible, writeConnectionsPreference } from './canvas-flow';
import { NoteCard } from './NoteCard';
import { canvasLayoutRole, layoutCanvas, unpinnedNodesOverlappingPinnedResizes, type CanvasPoint, type CanvasLayoutNode } from './canvas-layout';
import { canvasLayoutScopeKey, isSharedCanvasNodeForView, missingSharedCanvasNodeIds } from './canvas-layout-scope';
import './canvas-visual-flow.css';
import { LiveCursors, useLiveCursorSender } from './live-cursors';
import { CURSOR_SEND_INTERVAL_MS } from '../shared/cursor-protocol';
import CanvasEdgeView, { type CanvasEdgeData } from './CanvasEdge';
import { routeConnections, type RoutingLink, type RoutingRect } from '../shared/edge-routing';

/** Lines around the cards, drawn by the obstacle-aware router instead of the default curve. */
const canvasEdgeTypes: EdgeTypes = { canvasConnection: CanvasEdgeView };

/** Browser storage can be blocked (private mode, policy); the canvas then runs without persistence. */
function browserStorage(): CanvasStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

const canvasView = createCanvasViewState(browserStorage());
/** The canvas paper shows through the mask under each line. */
const CANVAS_EDGE_HALO = '#eeeee2';

export { DEFAULT_CANVAS_AUXILIARY_IDS, defaultCanvasAuxiliaryObjectIds };

interface CanvasNodeBaseData extends Record<string, unknown> {
  kind: 'plan' | 'auxiliary';
  id: string;
  title: string;
  capability: string;
  selected: boolean;
  opened: boolean;
  /** F054: when this card was created and last changed, resolved from the table, absent when nothing is known. */
  meta?: CanvasCardMeta;
  createdByName?: string;
  updatedByName?: string;
  /** True when the viewer is the person the meta line names, so its tooltip can say "(you)". */
  metaSelf?: boolean;
  onToggleOpen: (id: string) => void;
  /** Take the card off this viewer's canvas; the Objects panel brings it back. */
  onHide: (id: string) => void;
  /** Point the table chat at this card; absent where there is no table chat. */
  onReference?: (id: string, title: string) => void;
  /** Rename this card for everyone; absent when this viewer cannot. A blank title brings back the original. */
  onRename?: (id: string, title: string) => void;
  onSelectNode: (id: string) => void;
  /** Save the size (and moved corner) after this viewer drags a card edge. */
  onResize: (id: string, box: CanvasBox) => void;
}

interface CanvasBox { x: number; y: number; width: number; height: number }

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
  onEditRules?: (prompt?: string) => void;
}

interface AuxiliaryCanvasNodeData extends CanvasNodeBaseData {
  kind: 'auxiliary';
  auxiliary: CanvasAuxiliaryObject;
}

type CanvasNodeData = PlanCanvasNodeData | AuxiliaryCanvasNodeData;
type CanvasNode = Node<CanvasNodeData, 'tabletopObject'>;
type CanvasEdge = Edge<Record<string, unknown>>;

export interface CanvasAuxiliaryObject {
  id: string;
  title: string;
  eyebrow?: string;
  /** A small, muted line under the title, e.g. who asked for an AI chat card. */
  subtitle?: string;
  /** F054: when this card was created, for cards the table state does not date (chat answers). */
  at?: number;
  /** F054: who created it, so the meta line can name the asker. Resolved to a name at render time. */
  actorId?: string;
  position?: { x: number; y: number };
  content?: ReactNode;
  renderContent?: (expanded: boolean) => ReactNode;
  /** Replaces the generic header glyph, e.g. an AI mark on chat cards. */
  glyph?: ReactNode;
  /** True while the object waits on work it cannot show yet; animates the header glyph. */
  busy?: boolean;
  /** F070: the card this one opened from (a picked option); draws a labelled line and seats it beside that card. */
  linkedFrom?: CanvasFollowUpLink;
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

/** F054: the go-to button waits for React Flow to measure the card before it moves the camera. */

/** ~5.8s of frames at 32ms, the same patience the open-and-focus request has. */

/** One row of the Objects panel: a card, its time line, and whether this viewer closed it. */
interface CanvasCardRow {
  id: string;
  title: string;
  hidden: boolean;
  capability: string;
  kind: CanvasNodeData['kind'];
  meta?: CanvasCardMeta;
  createdByName?: string;
  updatedByName?: string;
  metaSelf?: boolean;
}

/** F054: names are never stored in state; they are resolved from the current members, like NoteCard does. */
function memberName(view: WorkspaceView, actorId: string | undefined): string | undefined {
  if (!actorId) return undefined;
  if (actorId === view.actor.actorId) return view.actor.name;
  return view.members.find((member) => member.actorId === actorId)?.name;
}

/** The display names and the "(you)" flag for one card's meta line. */
function cardMetaIdentity(view: WorkspaceView, meta: CanvasCardMeta | undefined): Pick<CanvasCardRow, 'createdByName' | 'updatedByName' | 'metaSelf'> {
  if (!meta) return {};
  const createdByName = memberName(view, meta.createdBy);
  const updatedByName = memberName(view, meta.updatedBy);
  const lastActor = meta.updatedAt > meta.createdAt ? meta.updatedBy : meta.createdBy;
  return {
    ...(createdByName === undefined ? {} : { createdByName }),
    ...(updatedByName === undefined ? {} : { updatedByName }),
    metaSelf: lastActor !== undefined && lastActor === view.actor.actorId,
  };
}

/** The person a meta line names: whoever touched the card last. */
function lastActorName(meta: CanvasCardMeta | undefined, createdByName?: string, updatedByName?: string): string | undefined {
  return meta && meta.updatedAt > meta.createdAt ? updatedByName : createdByName;
}

/** Cards deleted for everyone at this table (soft delete in the shared layout), oldest first. */
function trashedForView(view: WorkspaceView): string[] {
  if (view.domain.kind !== 'table') return [];
  const trashed = (view.domain as unknown as { canvasLayout?: { trashed?: unknown } }).canvasLayout?.trashed;
  return trashed && typeof trashed === 'object' && !Array.isArray(trashed) ? Object.keys(trashed) : [];
}

/** Card names set at this table (shared layout); they replace the card's own title for everyone. */
function titlesForView(view: WorkspaceView): Readonly<Record<string, string>> {
  if (view.domain.kind !== 'table') return {};
  const titles = (view.domain as unknown as { canvasLayout?: { titles?: unknown } }).canvasLayout?.titles;
  if (!titles || typeof titles !== 'object' || Array.isArray(titles)) return {};
  return Object.fromEntries(Object.entries(titles).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].length > 0));
}

/** Mirrors the server rule: anyone renames chat cards; the table's own shared cards are named by the owner. */
function canRename(view: WorkspaceView, id: string): boolean {
  if (view.domain.kind !== 'table' || !isSharedCanvasId(id)) return false;
  if (/^table\.chat\./u.test(id)) return view.actor.role === 'owner' || view.actor.role === 'participant';
  return view.actor.role === 'owner';
}


/** Cards this viewer starred to find quickly; kept per table in this browser and listed first in Objects. */

/** Mirrors the server rule: anyone tidies chat cards; views, data tables and files are the owner's. */
function canTrash(view: WorkspaceView, id: string): boolean {
  if (view.domain.kind !== 'table') return false;
  if (/^table\.chat\.[a-f0-9]{64}$/u.test(id)) return view.actor.role === 'owner' || view.actor.role === 'participant';
  return (/^table\.(view|collection)\./u.test(id) || id === 'table.sources') && view.actor.role === 'owner';
}

function sharedLayoutForView(view: WorkspaceView): SharedCanvasLayout | null {
  if (view.domain.kind !== 'table') return null;
  const raw = (view.domain as unknown as { canvasLayout?: unknown }).canvasLayout;
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as { revision?: unknown; positions?: unknown };
  if (!Number.isSafeInteger(candidate.revision) || !candidate.positions || typeof candidate.positions !== 'object') return null;
  const positions: SharedCanvasLayout['positions'] = {};
  for (const [id, point] of Object.entries(candidate.positions)) {
    if (!isCanvasPosition(point)) continue;
    positions[id] = { ...point, pinned: point.pinned !== false };
  }
  return { revision: Number(candidate.revision), positions };
}


/** Card sizes this viewer set by dragging an edge. Kept per table in this browser, like closed cards. */

/**
 * Cards that start closed on a table that has its own views: the raw rules, actions, data tables, people and
 * history. The generated views, chat and notes stay open. Each card is decided once, when this browser first
 * sees it, so a card the person opened again stays open.
 */
/** F054: the Objects order this viewer picked for this table; an unreadable value falls back to the default. */

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

/** F070: the AI answer accent, so a choice trail reads apart from data lines. */
const FOLLOW_UP_EDGE_COLOR = '#7860bd';
const FOLLOW_UP_SOURCE_HANDLE = 'follow-up-out';
const FOLLOW_UP_TARGET_HANDLE = 'follow-up-in';

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

/** F088: whether the wheel can still move some scroll area between the pointer and the card body. */
function canScrollWithin(target: Element, body: HTMLElement, deltaX: number, deltaY: number): boolean {
  for (let element: Element | null = target; element; element = element === body ? null : element.parentElement) {
    if (!(element instanceof HTMLElement)) continue;
    const style = getComputedStyle(element);
    if (deltaY !== 0 && /auto|scroll/u.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1) {
      if (deltaY < 0 ? element.scrollTop > 0 : element.scrollTop + element.clientHeight < element.scrollHeight - 1) return true;
    }
    if (deltaX !== 0 && /auto|scroll/u.test(style.overflowX) && element.scrollWidth > element.clientWidth + 1) {
      if (deltaX < 0 ? element.scrollLeft > 0 : element.scrollLeft + element.clientWidth < element.scrollWidth - 1) return true;
    }
  }
  return false;
}

/**
 * A card body that scrolls when its content is taller than the card. While it overflows it carries React Flow's
 * `nowheel` class, so the wheel scrolls the card (and reaches buttons below the fold) instead of zooming the canvas.
 */
function CanvasNodeBody({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scrollable, setScrollable] = useState(false);
  // F088: a scroll area inside the card (a table grid, a long list) scrolls under the wheel too. The canvas zooms
  // only when nothing under the pointer can move further that way, or with Ctrl/⌘ (pinch) held.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const keepWheelInCard = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) return;
      if (event.target instanceof Element && canScrollWithin(event.target, element, event.deltaX, event.deltaY)) event.stopPropagation();
    };
    element.addEventListener('wheel', keepWheelInCard, { passive: true });
    return () => element.removeEventListener('wheel', keepWheelInCard);
  }, []);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setScrollable(element.scrollHeight > element.clientHeight + 1);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    for (const child of Array.from(element.children)) observer.observe(child);
    const mutations = typeof MutationObserver === 'undefined' ? null : new MutationObserver(measure);
    mutations?.observe(element, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'class'] });
    return () => { observer.disconnect(); mutations?.disconnect(); };
  }, []);
  return <div ref={ref} className={`tt-canvas-node__body nodrag nopan nokey${scrollable ? ' nowheel' : ''}`}>{children}</div>;
}

/** F054: one muted line under a card title. Only this line follows the shared minute clock. */
function CardMetaLine({ meta, createdByName, updatedByName, self }: { meta?: CanvasCardMeta; createdByName?: string; updatedByName?: string; self?: boolean }) {
  const now = useCardNow();
  if (!meta) return null;
  const options = { now, actorName: lastActorName(meta, createdByName, updatedByName), self };
  return <span className="tt-canvas-node__meta" title={cardMetaDescription(meta, options)}>{cardMetaLabel(meta, options)}</span>;
}

/** F054: the second line of an Objects row, which follows the same clock without re-rendering the panel. */
function CardRowMeta({ row }: { row: CanvasCardRow }) {
  const now = useCardNow();
  const options = { now, actorName: lastActorName(row.meta, row.createdByName, row.updatedByName), self: row.metaSelf };
  return <span className="tt-canvas-objects__meta" data-testid={`canvas-object-meta-${row.id}`} title={cardMetaDescription(row.meta, options)}>{cardMetaLabel(row.meta, options)}</span>;
}

function CanvasObjectHeader({ data }: { data: CanvasNodeData }) {
  const [draft, setDraft] = useState<string | null>(null);
  const startEditing = () => { if (data.onRename) setDraft(data.title); };
  const finish = (save: boolean) => {
    if (draft === null) return;
    const title = draft.replace(/\s+/gu, ' ').trim().slice(0, 120);
    setDraft(null);
    if (save && title !== data.title) data.onRename?.(data.id, title);
  };
  return <header className="tt-canvas-node__head">
    <span className="tt-canvas-node__drag-handle" aria-hidden="true"><GripVertical size={16} /></span>
    <span className={'tt-object-glyph' + (data.kind === 'auxiliary' && data.auxiliary.busy ? ' is-busy' : '')} aria-hidden="true">{(data.kind === 'auxiliary' && data.auxiliary.glyph) || capabilityGlyph(data.capability, data.kind)}</span>
    <span className="tt-canvas-node__identity">
      {draft !== null
        ? <input className="tt-canvas-node__title-input nodrag nopan nokey" data-testid={`card-title-input-${data.id}`} aria-label={`New name for ${data.title}`} maxLength={120} autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={() => finish(true)} onPointerDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') { event.preventDefault(); finish(true); }
          if (event.key === 'Escape') { event.preventDefault(); finish(false); }
        }} />
        : <span className="tt-canvas-node__title" title={data.onRename ? `${data.title} (double-click to rename)` : data.title} onDoubleClick={(event) => { if (!data.onRename) return; event.stopPropagation(); startEditing(); }}>{data.title}</span>}
      {data.kind === 'auxiliary' && data.auxiliary.subtitle && <span className="tt-canvas-node__subtitle">{data.auxiliary.subtitle}</span>}
      {data.meta && <CardMetaLine meta={data.meta} createdByName={data.createdByName} updatedByName={data.updatedByName} self={data.metaSelf} />}
    </span>
    <span className="tt-canvas-node__controls">
      {data.onRename && draft === null && <button className="tt-canvas-node__open tt-canvas-node__icon tt-canvas-node__rename nodrag nopan nokey" type="button" data-testid={`rename-card-${data.id}`} aria-label={`Rename ${data.title}`} title="Rename for everyone (leave blank for the original name)" onClick={(event) => { event.stopPropagation(); startEditing(); }}>
        <Pencil size={14} aria-hidden="true" />
      </button>}
      {data.onReference && <button className="tt-canvas-node__open tt-canvas-node__icon nodrag nopan nokey" type="button" aria-label={`Ask about ${data.title} in chat`} title="Ask about or change this card in the chat" onClick={(event) => { event.stopPropagation(); data.onReference?.(data.id, data.title); }}>
        <MessageSquareText size={15} aria-hidden="true" />
      </button>}
      <button className="tt-canvas-node__open tt-canvas-node__icon nodrag nopan nokey" type="button" aria-expanded={data.opened} aria-label={data.opened ? `Minimize ${data.title}` : `Open ${data.title}`} title={data.opened ? 'Minimize' : 'Expand'} onKeyDown={(event) => {
        if (event.key === 'Escape' && data.opened) {
          event.preventDefault();
          event.stopPropagation();
          data.onToggleOpen(data.id);
        }
      }} onClick={(event) => { event.stopPropagation(); data.onToggleOpen(data.id); }}>
        {data.opened ? <Minimize2 size={15} aria-hidden="true" /> : <Maximize2 size={15} aria-hidden="true" />}
      </button>
      <button className="tt-canvas-node__open tt-canvas-node__icon nodrag nopan nokey" type="button" aria-label={`Close ${data.title}`} title="Close (reopen from Objects)" onClick={(event) => { event.stopPropagation(); data.onHide(data.id); }}>
        <X size={15} aria-hidden="true" />
      </button>
    </span>
  </header>;
}

/** A card with a size from dragging its edge; without one it keeps its role width and grows with content. */
function sizedNode(size: { width: number; height: number } | undefined): Partial<CanvasNode> {
  return size ? { width: size.width, height: size.height, className: 'is-sized' } : { width: undefined, height: undefined, className: undefined };
}

/** Edges and corners appear once the card is selected; drag them to resize. */
function CanvasCardResizer({ data, selected }: { data: CanvasNodeData; selected: boolean }) {
  const start = useRef<CanvasBox | null>(null);
  return <NodeResizer
    isVisible={selected}
    minWidth={260}
    minHeight={140}
    lineClassName="tt-canvas-resize-line"
    handleClassName="tt-canvas-resize-handle"
    onResizeStart={(_event, box) => { start.current = box; }}
    onResizeEnd={(_event, box) => {
      // A click on an edge without dragging keeps the card's natural size.
      const from = start.current;
      start.current = null;
      if (from && Math.abs(from.width - box.width) < 2 && Math.abs(from.height - box.height) < 2) return;
      data.onResize(data.id, box);
    }}
  />;
}

/** Cards picked with Shift+click, so right-click can hide (or ask about, or delete) them together. */
const MultiSelectionContext = createContext<ReadonlySet<string>>(new Set());

function CanvasObjectNode({ data, selected }: NodeProps<CanvasNode>) {
  const multiSelected = useContext(MultiSelectionContext).has(data.id);
  if (data.kind === 'plan' && isCanvasNoteId(data.id)) {
    const note = data.view.domain.kind === 'table'
      ? data.view.domain.notes?.find((item) => `table.note.${item.id}` === data.id)
      : undefined;
    if (!note) return null;
    // F037: a note is the paper itself, not a card that contains paper.
    return (
      <div
        className={'tt-note-node' + (selected ? ' is-selected' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-canvas-role="note"
        aria-label={`Note by ${data.view.members.find((member) => member.actorId === note.createdBy)?.name ?? 'Member'}`}
      >
        <NoteCard view={data.view} note={note} busy={data.busy} onCommand={data.onCommand} />
      </div>
    );
  }

  if (data.kind === 'auxiliary') {
    return (<>
      <article
        className={'tt-canvas-node tt-canvas-node--auxiliary tt-canvas-node--role-auxiliary' + (selected ? ' is-selected' : '') + (multiSelected ? ' is-multi-selected' : '') + (data.opened ? ' is-expanded' : '')}
        data-canvas-object={data.id}
        data-canvas-editor
        data-testid={data.opened ? 'canvas-object-editor' : undefined}
        data-object-id={data.opened ? data.id : undefined}
        data-canvas-role="auxiliary"
        aria-label={data.title}
        aria-busy={data.auxiliary.busy || undefined}
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
        {/* F070: hidden anchors so a choice trail can attach to chat cards; the router draws the visible path. */}
        <Handle type="target" position={Position.Left} id={FOLLOW_UP_TARGET_HANDLE} className="tt-follow-up-handle" />
        <Handle type="source" position={Position.Right} id={FOLLOW_UP_SOURCE_HANDLE} className="tt-follow-up-handle" />
        <CanvasObjectHeader data={data} />
        <CanvasNodeBody>{data.auxiliary.renderContent?.(data.opened) ?? data.auxiliary.content}</CanvasNodeBody>
      </article>
      <CanvasCardResizer data={data} selected={selected && data.selected} />
    </>);
  }

  const inputPorts = Object.keys(data.spec.inputs);
  const outputPorts = Object.keys(data.outputs);
  const role = canvasRole(data.capability, data.kind);

  return (<>
    <article
      className={'tt-canvas-node tt-canvas-node--' + data.spec.id.replaceAll('.', '-') + ' tt-canvas-node--role-' + role + (selected ? ' is-selected' : '') + (multiSelected ? ' is-multi-selected' : '') + (data.opened ? ' is-expanded' : '')}
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
      <CanvasNodeBody>
        <CanvasObjectContent view={data.view} node={data.spec} outputs={data.outputs} busy={data.busy} onCommand={data.onCommand} onUpload={data.onUpload} onTableImport={data.onTableImport} onExport={data.onExport} onFocusEvidence={data.onFocusEvidence} focusSourceIds={data.focusSourceIds} localPhysics={data.localPhysics} onLocalPhysicsChange={data.onLocalPhysicsChange} onResetLocalPhysics={data.onResetLocalPhysics} onEditRules={data.onEditRules} preparedDemoArt={data.preparedDemoArt} expanded={data.opened} />
      </CanvasNodeBody>
    </article>
    {/* After the card so the edges sit on top of it. */}
    <CanvasCardResizer data={data} selected={selected && data.selected} />
  </>);
}

const nodeTypes: NodeTypes = { tabletopObject: CanvasObjectNode };

function connectionsStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

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
  onEditRules?: (prompt?: string) => void;
}

function CanvasInner({ view, plan, selectedNodeId, onSelectNode, onCommand, busy, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, persistLayout = true, preparedDemoArt = false, visibleNodeIds, focusNodeId, focusRequestKey, auxiliaryObjects = [], emptyContent, openedObjectId, onOpenObject, onEditRules }: CanvasWorkspaceProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const flow = useReactFlow<CanvasNode, CanvasEdge>();
  const flowWrapRef = useRef<HTMLDivElement>(null);
  // F009: share this pointer in canvas coordinates (~12 Hz, under the server's limit).
  const sendCursor = useLiveCursorSender();
  const cursorSentAtRef = useRef(0);
  const shareCursor = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!sendCursor || event.pointerType === 'touch') return;
    const now = performance.now();
    if (now - cursorSentAtRef.current < CURSOR_SEND_INTERVAL_MS) return;
    cursorSentAtRef.current = now;
    sendCursor(flow.screenToFlowPosition({ x: event.clientX, y: event.clientY }));
  }, [flow, sendCursor]);
  const hideCursor = useCallback(() => { cursorSentAtRef.current = 0; sendCursor?.(null); }, [sendCursor]);
  const workspaceKey = canvasLayoutScopeKey(view);
  const viewRef = useRef(view);
  viewRef.current = view;
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
  const layoutScopeRef = useRef({ key: workspaceKey, generation: 0 });
  const pendingSeedNodeIdsRef = useRef(new Set<string>());
  const seedAttemptCountsRef = useRef(new Map<string, number>());
  const layoutMoveSequenceRef = useRef(0);
  const layoutBlockedThroughRef = useRef(0);
  const appliedSharedLayoutRevisionRef = useRef<number | null>(null);
  const layoutSnapshotRef = useRef<{ workspaceKey: string; ids: Set<string>; sizes: Map<string, { width: number; height: number }>; edges: Set<string>; signature: string } | null>(null);
  const pendingOpenObjectFocusRef = useRef<OpenObjectFocusRequest | null>(null);
  const openObjectFocusSequenceRef = useRef(0);
  const canvasInteractionRevisionRef = useRef(0);
  const [openObjectFocusSequence, setOpenObjectFocusSequence] = useState(0);
  if (layoutScopeRef.current.key !== workspaceKey) {
    layoutScopeRef.current = { key: workspaceKey, generation: layoutScopeRef.current.generation + 1 };
    layoutCommandQueueRef.current = Promise.resolve();
    pendingSeedNodeIdsRef.current.clear();
    seedAttemptCountsRef.current.clear();
    draggingNodeIdsRef.current.clear();
    dragStartPositionsRef.current.clear();
    layoutMoveSequenceRef.current = 0;
    layoutBlockedThroughRef.current = 0;
  }
  useEffect(() => {
    if (layoutScopeRef.current.key !== workspaceKey) {
      layoutScopeRef.current = { key: workspaceKey, generation: layoutScopeRef.current.generation + 1 };
    }
    const mountedScope = layoutScopeRef.current;
    const pendingSeedNodeIds = pendingSeedNodeIdsRef.current;
    const seedAttemptCounts = seedAttemptCountsRef.current;
    return () => {
      if (layoutScopeRef.current !== mountedScope) return;
      layoutScopeRef.current = { key: '', generation: mountedScope.generation + 1 };
      layoutCommandQueueRef.current = Promise.resolve();
      pendingSeedNodeIds.clear();
      seedAttemptCounts.clear();
    };
  }, [workspaceKey]);
  const cancelPendingOpenObjectFocus = useCallback(() => {
    // Any pointer or key interaction that cancels the open-and-focus request stops its camera move too.
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
  // Cards this viewer closed. Kept per table in this browser; the Objects panel lists them to bring them back.
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => canvasView.hidden(workspaceKey));
  const [cardSizes, setCardSizes] = useState<CardSizes>(() => canvasView.cardSizes(workspaceKey));
  // A group of cards picked with Shift+click or a Shift+drag box; they move, hide and go to chat together.
  const [multiIds, setMultiIds] = useState<ReadonlySet<string>>(new Set());
  // F054: the Objects order, remembered per table in this browser like closed cards and sizes.
  const [cardSort, setCardSort] = useState<CardSortMode>(() => canvasView.sortMode(workspaceKey));
  const hiddenScopeRef = useRef(workspaceKey);
  if (hiddenScopeRef.current !== workspaceKey) {
    hiddenScopeRef.current = workspaceKey;
    setHiddenIds(canvasView.hidden(workspaceKey));
    setCardSizes(canvasView.cardSizes(workspaceKey));
    setCardSort(canvasView.sortMode(workspaceKey));
  }
  const trashedList = useMemo(() => trashedForView(view), [view]);
  const trashedIds = useMemo(() => new Set(trashedList), [trashedList]);
  const customTitles = useMemo(() => titlesForView(view), [view]);
  const listedPlanNodes = useMemo(() => plan.nodes
    .filter((spec) => spec.visible !== false && !trashedIds.has(spec.id) && (!allowedNodeIds || allowedNodeIds.has(spec.id)))
    .map((spec) => customTitles[spec.id] ? { ...spec, title: customTitles[spec.id] } : spec), [plan.nodes, allowedNodeIds, trashedIds, customTitles]);
  const visiblePlanNodes = useMemo(() => listedPlanNodes.filter((spec) => !hiddenIds.has(spec.id)), [listedPlanNodes, hiddenIds]);
  const planIds = useMemo(() => new Set(plan.nodes.map((spec) => spec.id)), [plan.nodes]);
  const planNodesById = useMemo(() => new Map(plan.nodes.map((spec) => [spec.id, spec])), [plan.nodes]);
  const listedAuxiliaryObjects = useMemo(() => auxiliaryObjects
    .filter((object) => !planIds.has(object.id) && !trashedIds.has(object.id) && (!allowedNodeIds || allowedNodeIds.has(object.id)))
    .map((object) => customTitles[object.id] ? { ...object, title: customTitles[object.id] } : object), [auxiliaryObjects, planIds, allowedNodeIds, trashedIds, customTitles]);
  // Deleted cards that still exist, newest first, for the Deleted section of Objects.
  const deletedObjects = useMemo(() => {
    const titles = new Map<string, string>([
      ...plan.nodes.map((spec) => [spec.id, spec.title] as [string, string]),
      ...auxiliaryObjects.map((object) => [object.id, object.title] as [string, string]),
    ]);
    return [...trashedList].reverse().filter((id) => titles.has(id)).map((id) => ({ id, title: customTitles[id] ?? titles.get(id) ?? id }));
  }, [trashedList, plan.nodes, auxiliaryObjects, customTitles]);
  const visibleAuxiliaryObjects = useMemo(() => listedAuxiliaryObjects.filter((object) => !hiddenIds.has(object.id)), [listedAuxiliaryObjects, hiddenIds]);
  // F054: read-only per-card time. Table cards resolve from stored meta or retained revisions; chat cards
  // carry their own creation time because no command ever stamps them. Hidden cards keep their meta.
  const cardMetaById = useMemo(() => {
    const table = view.domain.kind === 'table' ? view.domain : null;
    const resolved = new Map<string, CanvasCardMeta>();
    const record = (id: string, meta: CanvasCardMeta | undefined) => { if (meta) resolved.set(id, meta); };
    for (const spec of listedPlanNodes) record(spec.id, table ? resolveCardMeta(table, view, spec.id) : undefined);
    for (const object of listedAuxiliaryObjects) {
      if (object.at !== undefined) {
        record(object.id, {
          createdAt: object.at,
          updatedAt: object.at,
          ...(object.actorId ? { createdBy: object.actorId, updatedBy: object.actorId } : {}),
          origin: 'ai',
          source: 'recorded',
        });
        continue;
      }
      record(object.id, table ? resolveCardMeta(table, view, object.id) : undefined);
    }
    return resolved;
  }, [listedAuxiliaryObjects, listedPlanNodes, view]);
  /** Every card the panel lists, hidden ones included, in canvas order; the panel sorts a copy. */
  const cardRows = useMemo<CanvasCardRow[]>(() => [
    ...listedPlanNodes.map((spec) => {
      const meta = cardMetaById.get(spec.id);
      return {
        id: spec.id, title: spec.title, hidden: hiddenIds.has(spec.id), capability: spec.capability, kind: 'plan' as const,
        ...(meta ? { meta } : {}), ...cardMetaIdentity(view, meta),
      };
    }),
    ...listedAuxiliaryObjects.map((object) => {
      const meta = cardMetaById.get(object.id);
      return {
        id: object.id, title: object.title, hidden: hiddenIds.has(object.id), capability: object.eyebrow ?? 'table tool', kind: 'auxiliary' as const,
        ...(meta ? { meta } : {}), ...cardMetaIdentity(view, meta),
      };
    }),
  ], [cardMetaById, hiddenIds, listedAuxiliaryObjects, listedPlanNodes, view]);
  // F083: table cards this viewer has closed, named on the canvas so a closed card never reads as lost data.
  const closedTableCards = useMemo(() => cardRows.filter((object) => object.hidden && !object.id.startsWith('workspace.')), [cardRows]);
  // First sight of a card decides whether it starts closed (see cardsClosedOnFirstLook).
  useEffect(() => {
    if (view.kind !== 'table') return;
    const ids = [...listedPlanNodes.map((spec) => spec.id), ...listedAuxiliaryObjects.map((object) => object.id)];
    // Until the table has its own views nothing starts closed, so decide nothing yet.
    if (!ids.some((id) => id.startsWith('table.view.'))) return;
    const seen = canvasView.seen(workspaceKey);
    const fresh = ids.filter((id) => !seen.has(id));
    if (fresh.length === 0) return;
    const closing = cardsClosedOnFirstLook(ids, fresh, seen);
    for (const id of fresh) seen.add(id);
    canvasView.saveSeen(workspaceKey, seen);
    if (closing.length === 0) return;
    setHiddenIds(canvasView.changeHidden(workspaceKey, { hide: closing }));
  }, [listedAuxiliaryObjects, listedPlanNodes, view.kind, workspaceKey]);
  const visibleIds = useMemo(() => new Set([...visiblePlanNodes.map((spec) => spec.id), ...visibleAuxiliaryObjects.map((object) => object.id)]), [visiblePlanNodes, visibleAuxiliaryObjects]);
  const [internalOpenedId, setInternalOpenedId] = useState<string | null>(null);
  const activeOpenedId = openedObjectId === undefined ? internalOpenedId : openedObjectId;
  const activeOpenedIdRef = useRef(activeOpenedId);
  activeOpenedIdRef.current = activeOpenedId;
  const [objectsMenuOpen, setObjectsMenuOpen] = useState(false);
  const [previousView, setPreviousView] = useState<{ x: number; y: number; zoom: number } | null>(null);
  useEffect(() => { setPreviousView(null); }, [view.id, view.epoch]);
  const [connectionsPreference, setConnectionsPreference] = useState<boolean | null>(() => readConnectionsPreference(connectionsStorage()));
  const objectsMenuRef = useRef<HTMLDivElement>(null);
  const objectsButtonRef = useRef<HTMLButtonElement>(null);
  const lastFocusRequestRef = useRef<string | null>(null);
  const lastDomainRevisionRef = useRef<{ workspaceKey: string; data: number; rules: number } | null>(null);
  const [revisionNotice, setRevisionNotice] = useState<{ key: string; message: string } | null>(null);

  useEffect(() => {
    if (localPhysicsWorkspace.current !== workspaceKey || !localPhysicsDirty.current) {
      localPhysicsWorkspace.current = workspaceKey;
      localPhysicsDirty.current = false;
      if (teachingParams) setLocalPhysics(teachingParams);
    }
  }, [workspaceKey, teachingParams?.force, teachingParams?.mass, teachingParams?.time]);
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
    const layout = canvasView.layout(workspaceKey);
    layout.positions[id] = saved;
    canvasView.saveLayout(workspaceKey, layout);
  }, [persistLayout, workspaceKey]);

  // The newest local move per card; an older server answer must not pull that card back (no flicker while
  // arrow keys repeat or a group moves).
  const latestMoveSequenceRef = useRef(new Map<string, number>());
  type CanvasMove = { id: string; position: CanvasPoint; before?: CanvasPoint };
  /** Saves moved cards in one shared-layout change, so a group never answers itself card by card. */
  const commitUserPositions = useCallback((moves: readonly CanvasMove[]) => {
    const scope = layoutScopeRef.current;
    if (scope.key !== workspaceKey) return;
    const shared: CanvasMove[] = [];
    for (const move of moves) {
      rememberPosition(move.id, move.position);
      // F037: notes carry their own coordinates, so dragging one is a note move, not a shared layout change.
      if (move.id.startsWith('table.note.')) {
        void onCommand('table.moveNote', { noteId: move.id.slice('table.note.'.length), x: Math.round(move.position.x), y: Math.round(move.position.y) });
      } else if (remoteLayoutEnabled && isSharedCanvasNodeForView(move.id, view)) {
        shared.push(move);
      }
    }
    if (shared.length === 0) return;
    const sequence = ++layoutMoveSequenceRef.current;
    for (const move of shared) latestMoveSequenceRef.current.set(move.id, sequence);
    const isCurrentScope = () => layoutScopeRef.current === scope;
    // A card moved again locally after this request keeps its newer place.
    const isNewer = (id: string) => (latestMoveSequenceRef.current.get(id) ?? 0) > sequence;
    const revertToCanonical = () => {
      if (!isCurrentScope()) return;
      const reverted = new Map<string, CanvasPoint>();
      for (const move of shared) {
        if (isNewer(move.id)) continue;
        const canonical = sharedLayoutRef.current?.positions[move.id] ?? move.before;
        if (!canonical) continue;
        workspacePositionsRef.current = { ...workspacePositionsRef.current, [move.id]: canonical };
        reverted.set(move.id, canonical);
      }
      if (reverted.size === 0) return;
      setNodes((current) => current.map((node) => {
        const point = reverted.get(node.id);
        return point ? { ...node, position: { x: point.x, y: point.y } } : node;
      }));
    };
    const applyCanonicalLayout = (canonicalLayout: SharedCanvasLayout, canonicalView: WorkspaceView) => {
      if (!isCurrentScope()) return;
      sharedLayoutRef.current = canonicalLayout;
      appliedSharedLayoutRevisionRef.current = canonicalLayout.revision;
      const visibleCanonicalPositions = new Map<string, CanvasPoint>();
      for (const [nodeId, point] of Object.entries(canonicalLayout.positions)) {
        if (!isSharedCanvasNodeForView(nodeId, canonicalView) || isNewer(nodeId)) continue;
        workspacePositionsRef.current = { ...workspacePositionsRef.current, [nodeId]: { ...point, pinned: true } };
        pinnedNodeIdsRef.current.add(nodeId);
        visibleCanonicalPositions.set(nodeId, point);
      }
      for (const move of shared) {
        if (isNewer(move.id) || visibleCanonicalPositions.has(move.id)) continue;
        workspacePositionsRef.current = { ...workspacePositionsRef.current, [move.id]: { ...move.position, pinned: true } };
        visibleCanonicalPositions.set(move.id, move.position);
      }
      setNodes((current) => current.map((node) => {
        const point = visibleCanonicalPositions.get(node.id);
        return point && (node.position.x !== point.x || node.position.y !== point.y) ? { ...node, position: { x: point.x, y: point.y } } : node;
      }));
    };
    const positions = Object.fromEntries(shared.slice(0, 24).map((move) => [move.id, { ...move.position, pinned: true }]));
    const send = async () => {
      if (!isCurrentScope()) return;
      if (sequence <= layoutBlockedThroughRef.current) {
        revertToCanonical();
        return;
      }
      const attempt = async (expectedLayoutRevision: number) => {
        if (!isCurrentScope()) return null;
        try {
          const updated = await onCommand('canvas.layout', { expectedLayoutRevision, positions });
          return isCurrentScope() && updated && canvasLayoutScopeKey(updated) === workspaceKey ? updated : null;
        } catch {
          return null;
        }
      };
      const expectedLayoutRevision = sharedLayoutRef.current?.revision ?? 0;
      let updated = await attempt(expectedLayoutRevision);
      if (!updated) {
        if (!isCurrentScope()) return;
        // Someone else may have moved a different card at the same moment. Retry once on
        // the newer layout, but only if nobody moved these cards in between (F007).
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (!isCurrentScope()) return;
        const latest = sharedLayoutRef.current;
        const untouched = shared.every((move) => {
          const latestPoint = latest?.positions[move.id];
          return !latestPoint || (move.before !== undefined && Math.abs(latestPoint.x - move.before.x) < 0.5 && Math.abs(latestPoint.y - move.before.y) < 0.5);
        });
        if (latest && latest.revision !== expectedLayoutRevision && untouched && sequence > layoutBlockedThroughRef.current) {
          updated = await attempt(latest.revision);
        }
      }
      if (!isCurrentScope()) return;
      if (!updated) {
        layoutBlockedThroughRef.current = Math.max(layoutBlockedThroughRef.current, layoutMoveSequenceRef.current);
        revertToCanonical();
        return;
      }
      const canonicalLayout = sharedLayoutForView(updated);
      if (canonicalLayout) applyCanonicalLayout(canonicalLayout, updated);
    };
    layoutCommandQueueRef.current = layoutCommandQueueRef.current.then(send, send);
  }, [onCommand, remoteLayoutEnabled, rememberPosition, setNodes, view, workspaceKey]);
  const commitUserPosition = useCallback((id: string, position: CanvasPoint, before?: CanvasPoint) => {
    commitUserPositions([{ id, position, before }]);
  }, [commitUserPositions]);

  // Arrow-key moves collect while keys repeat and save once the keys rest, so the server sees one move
  // per burst instead of a queue of moves that answer each other and pull the cards back.
  const keyMoveBurstRef = useRef<{ moves: Map<string, CanvasMove>; timer: number } | null>(null);
  const flushKeyMoves = useCallback(() => {
    const burst = keyMoveBurstRef.current;
    if (!burst) return;
    window.clearTimeout(burst.timer);
    keyMoveBurstRef.current = null;
    for (const id of burst.moves.keys()) draggingNodeIdsRef.current.delete(id);
    commitUserPositions([...burst.moves.values()]);
  }, [commitUserPositions]);
  useEffect(() => () => flushKeyMoves(), [flushKeyMoves]);
  /** Arrow-key move of one card or a whole group: moves on screen at once, saves after the burst. */
  const moveCanvasObjects = useCallback((ids: readonly string[], dx: number, dy: number) => {
    cancelPendingOpenObjectFocus();
    const burst = keyMoveBurstRef.current ?? { moves: new Map<string, CanvasMove>(), timer: 0 };
    const moved = new Map<string, CanvasPoint>();
    for (const id of ids) {
      const node = flow.getNode(id);
      if (!node) continue;
      const base = burst.moves.get(id)?.position ?? node.position;
      const position = { x: base.x + dx * 48, y: base.y + dy * 48 };
      moved.set(id, position);
      // Like a drag: the shared layout does not pull a card back while its keys are still moving it.
      draggingNodeIdsRef.current.add(id);
      burst.moves.set(id, { id, position, before: burst.moves.get(id)?.before ?? node.position });
    }
    if (moved.size === 0) return;
    setNodes((current) => current.map((candidate) => moved.has(candidate.id) ? { ...candidate, position: moved.get(candidate.id)! } : candidate));
    window.clearTimeout(burst.timer);
    burst.timer = window.setTimeout(flushKeyMoves, 300);
    keyMoveBurstRef.current = burst;
  }, [cancelPendingOpenObjectFocus, flow, flushKeyMoves, setNodes]);
  const moveCanvasObject = useCallback((id: string, dx: number, dy: number) => moveCanvasObjects([id], dx, dy), [moveCanvasObjects]);

  // Arrow keys: move the selected card, or pan the view when no card is selected (Shift = bigger steps).
  // Captured on window so React Flow's own node arrow handling (which would not save the position) never runs.
  const [moveAnnouncement, setMoveAnnouncement] = useState('');
  const announcementTimerRef = useRef<number | undefined>(undefined);
  /** F054: one live region for camera moves and sorts, cleared so the next message is announced again. */
  const announce = useCallback((message: string) => {
    setMoveAnnouncement(message);
    if (announcementTimerRef.current !== undefined) window.clearTimeout(announcementTimerRef.current);
    announcementTimerRef.current = window.setTimeout(() => {
      announcementTimerRef.current = undefined;
      setMoveAnnouncement('');
    }, 2000);
  }, []);
  useEffect(() => () => {
    if (announcementTimerRef.current !== undefined) window.clearTimeout(announcementTimerRef.current);
  }, []);
  useEffect(() => {
    const directions: Record<string, [number, number, string]> = { ArrowUp: [0, -1, 'up'], ArrowDown: [0, 1, 'down'], ArrowLeft: [-1, 0, 'left'], ArrowRight: [1, 0, 'right'] };
    const onKeyDown = (event: KeyboardEvent) => {
      const direction = directions[event.key];
      if (!direction || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], .tt-canvas-node__body, .tt-canvas-objects')) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const [dx, dy, label] = direction;
      const step = event.shiftKey ? 4 : 1;
      event.preventDefault();
      event.stopPropagation();
      if (multiIds.size > 1) {
        moveCanvasObjects([...multiIds], dx * step, dy * step);
        setMoveAnnouncement(`${multiIds.size} cards moved ${label}.`);
        return;
      }
      const selected = selectedNodeId ? flow.getNode(selectedNodeId) : undefined;
      if (selected) {
        moveCanvasObject(selected.id, dx * step, dy * step);
        setMoveAnnouncement(`${selected.data.title} moved ${label}.`);
        return;
      }
      cancelPendingOpenObjectFocus();
      const viewport = flow.getViewport();
      void flow.setViewport({ x: viewport.x - dx * 80 * step, y: viewport.y - dy * 80 * step, zoom: viewport.zoom });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [cancelPendingOpenObjectFocus, flow, moveCanvasObject, moveCanvasObjects, selectedNodeId, multiIds]);


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
  // The eye in the Objects panel: show a closed card again without moving the view to it.
  const showObject = useCallback((id: string) => {
    setHiddenIds(canvasView.changeHidden(workspaceKey, { show: [id] }));
  }, [workspaceKey]);
  // F083: the canvas notice brings back every closed table card at once (people and history stay closed).
  const showObjects = useCallback((ids: readonly string[]) => {
    setHiddenIds(canvasView.changeHidden(workspaceKey, { show: ids }));
  }, [workspaceKey]);
  // F083: another tab of this table opened or closed a card; follow it so this tab never writes back an old copy.
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (canvasView.isHiddenKey(workspaceKey, event.key)) setHiddenIds(canvasView.hidden(workspaceKey));
    };
    window.addEventListener('storage', follow);
    return () => window.removeEventListener('storage', follow);
  }, [workspaceKey]);
  // Header button: the table chat's next message is about this card (e.g. "make it harder").
  const referenceInChat = useMemo(() => view.kind !== 'table' || view.domain.kind !== 'table' ? undefined : (id: string, title: string) => {
    referenceCardInChat({ id, title, detail: describeCardForChat(id, title, view) });
  }, [view]);
  const [trashError, setTrashError] = useState<string | null>(null);
  /** Saves a card's name for everyone (shared layout); a blank name brings back the card's own title. */
  const renameCanvasObject = useCallback(async (id: string, title: string): Promise<boolean> => {
    setTrashError(null);
    const updated = await onCommand('canvas.layout', { expectedLayoutRevision: sharedLayoutRef.current?.revision ?? 0, titles: { [id]: title || null } });
    if (!updated) setTrashError('Could not rename this card. Try again.');
    return Boolean(updated);
  }, [onCommand]);
  const renameFromHeader = useCallback((id: string, title: string) => { void renameCanvasObject(id, title); }, [renameCanvasObject]);
  const resizeObject = useCallback((id: string, box: CanvasBox) => {
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    setCardSizes((current) => {
      const next = { ...current, [id]: { width, height } };
      canvasView.saveCardSizes(workspaceKey, next);
      return next;
    });
    // Dragging the left or top edge also moves the card.
    commitUserPosition(id, { x: box.x, y: box.y });
  }, [workspaceKey, commitUserPosition]);

  const hideObject = useCallback((id: string) => {
    setHiddenIds(canvasView.changeHidden(workspaceKey, { hide: [id] }));
    if (activeOpenedId === id) {
      if (openedObjectId === undefined) setInternalOpenedId(null);
      onOpenObject?.(null);
    }
    if (selectedNodeId === id) onSelectNode(null);
  }, [activeOpenedId, onOpenObject, onSelectNode, openedObjectId, selectedNodeId, workspaceKey]);
  const navigateToObject = useCallback((id: string) => {
    const reopening = hiddenIds.has(id);
    if (reopening) {
      // Bring a closed card back; the open-and-focus request below waits for it to be laid out.
      setHiddenIds(canvasView.changeHidden(workspaceKey, { show: [id] }));
    } else if (!nodes.some((node) => node.id === id)) return;
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
  }, [cancelPendingOpenObjectFocus, flow, focusNodeId, focusRequestKey, hiddenIds, nodes, onOpenObject, openedObjectId, onSelectNode, requestOpenObjectFocus, view.kind, workspaceKey]);

  const changeCardSort = useCallback((mode: CardSortMode) => {
    canvasView.saveSortMode(workspaceKey, mode);
    setCardSort(mode);
    announce(CARD_SORT_OPTIONS.find((option) => option.mode === mode)?.announcement ?? '');
  }, [announce, workspaceKey]);

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
    const visibleSharedIds = new Set([...visiblePlanNodes.map((spec) => spec.id), ...visibleAuxiliaryObjects.map((object) => object.id)].filter((id) => isSharedCanvasNodeForView(id, view)));
    const storedLayout = isNewWorkspace && persistLayout ? canvasView.layout(workspaceKey) : null;
    const remoteLayoutChanged = remoteLayoutEnabled && sharedLayout !== null
      && (isNewWorkspace || (sharedLayout.revision >= (appliedSharedLayoutRevisionRef.current ?? -1)
        && appliedSharedLayoutRevisionRef.current !== sharedLayout.revision));
    if (isNewWorkspace) {
      layoutWorkspaceRef.current = workspaceKey;
      workspacePositionsRef.current = { ...(storedLayout?.positions ?? {}) };
      pinnedNodeIdsRef.current.clear();
      for (const [id, point] of Object.entries(workspacePositionsRef.current)) {
        if (remoteLayoutEnabled && isSharedCanvasNodeForView(id, view)) {
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
        if (isSharedCanvasNodeForView(id, view)) delete workspacePositionsRef.current[id];
      }
      for (const [id, point] of Object.entries(sharedLayout.positions)) {
        if (!isSharedCanvasNodeForView(id, view) || !visibleSharedIds.has(id)) continue;
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
      // F085: React Flow hides a node (visibility: hidden) until it has a measured size, and it only keeps the size that
      // comes on the node object. Rebuilding every card without it made each card vanish for a frame on every table
      // update (a click in that frame fell through to the canvas) and re-measured every card each time.
      const previousMeasured = new Map(existing.flatMap((node) => node.measured ? [[node.id, node.measured] as const] : []));
      const keepMeasured = (id: string) => { const measured = previousMeasured.get(id); return measured ? { measured } : {}; };
      const planNodes = visiblePlanNodes.map((spec): CanvasNode => ({
        id: spec.id,
        type: 'tabletopObject',
        ariaLabel: spec.title,
        dragHandle: isCanvasNoteId(spec.id) ? undefined : '.tt-canvas-node__head',
        position: (() => {
          const isShared = remoteLayoutEnabled && isSharedCanvasNodeForView(spec.id, view);
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
        selected: spec.id === selectedNodeId || multiIds.has(spec.id),
        ...sizedNode(cardSizes[spec.id]),
        ...keepMeasured(spec.id),
        zIndex: activeOpenedId === spec.id ? 20 : spec.id === selectedNodeId ? 10 : 0,
        data: {
          kind: 'plan',
          id: spec.id,
          title: spec.title,
          capability: spec.capability,
          meta: cardMetaById.get(spec.id),
          ...cardMetaIdentity(view, cardMetaById.get(spec.id)),
          opened: activeOpenedId === spec.id,
          onToggleOpen: toggleOpenObject,
          onHide: hideObject,
          onReference: referenceInChat,
          onRename: canRename(view, spec.id) && busy !== 'table.readOnly' ? renameFromHeader : undefined,
          onSelectNode,
          onResize: resizeObject,
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
      // F070: seat a follow-up beside its source card, under the follow-ups of that card already placed.
      const placedRect = (id: string) => {
        const point = previousPositions.get(id) ?? workspacePositionsRef.current[id];
        if (!point) return undefined;
        return { x: point.x, y: point.y, width: cardSizes[id]?.width ?? 400, height: cardSizes[id]?.height ?? 640 };
      };
      const placeFollowUp = (id: string, parentId: string) => followUpPosition(placedRect(parentId), visibleAuxiliaryObjects
        .filter((other) => other.id !== id && other.linkedFrom?.id === parentId)
        .flatMap((other) => placedRect(other.id) ?? []));
      const auxiliaryNodes = visibleAuxiliaryObjects.map((object, index): CanvasNode => ({
        id: object.id,
        type: 'tabletopObject',
        ariaLabel: object.title,
        dragHandle: '.tt-canvas-node__head',
        position: (() => {
          // Table-wide cards (people, history) follow the shared layout like plan cards (F007).
          const isShared = remoteLayoutEnabled && isSharedCanvasNodeForView(object.id, view);
          const remotePosition = isShared ? sharedLayout?.positions[object.id] : undefined;
          const isNewNode = !previousPositions.has(object.id);
          if ((isNewWorkspace || remoteLayoutChanged || isNewNode) && remotePosition && !draggingNodeIdsRef.current.has(object.id)) return { x: remotePosition.x, y: remotePosition.y };
          return (isNewWorkspace && !isShared ? storedLayout?.positions[object.id] : undefined)
            ?? previousPositions.get(object.id)
            ?? (!isShared ? workspacePositionsRef.current[object.id] : undefined)
            ?? (object.linkedFrom ? placeFollowUp(object.id, object.linkedFrom.id) : undefined)
            ?? object.position ?? { x: 40, y: maxY + 340 + index * 360 };
        })(),
        selected: object.id === selectedNodeId || multiIds.has(object.id),
        ...sizedNode(cardSizes[object.id]),
        ...keepMeasured(object.id),
        zIndex: activeOpenedId === object.id ? 20 : object.id === selectedNodeId ? 10 : 0,
        data: {
          kind: 'auxiliary',
          id: object.id,
          title: object.title,
          capability: object.eyebrow ?? 'table tool',
          meta: cardMetaById.get(object.id),
          ...cardMetaIdentity(view, cardMetaById.get(object.id)),
          opened: activeOpenedId === object.id,
          onToggleOpen: toggleOpenObject,
          onHide: hideObject,
          onReference: referenceInChat,
          onRename: canRename(view, object.id) && busy !== 'table.readOnly' ? renameFromHeader : undefined,
          onSelectNode,
          onResize: resizeObject,
          selected: object.id === selectedNodeId,
          auxiliary: object,
        },
      }));
      return [...planNodes, ...auxiliaryNodes];
    });
  }, [workspaceKey, persistLayout, remoteLayoutEnabled, sharedLayout, preparedDemoArt, visiblePlanNodes, visibleAuxiliaryObjects, plan.outputs, selectedNodeId, activeOpenedId, setNodes, view, busy, onCommand, onUpload, onTableImport, onExport, onFocusEvidence, focusSourceIds, localPhysics, changeLocalPhysics, resetLocalPhysics, toggleOpenObject, onSelectNode, moveCanvasObject, onEditRules, cardSizes, resizeObject, cardMetaById, renameFromHeader, multiIds]);

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
    const current = canvasView.layout(workspaceKey);
    current.viewport = {
      centerX: (bounds.width / 2 - viewport.x) / viewport.zoom,
      centerY: (bounds.height / 2 - viewport.y) / viewport.zoom,
      zoom: viewport.zoom,
    };
    canvasView.saveLayout(workspaceKey, current);
  }, [workspaceKey, persistLayout]);

  // A drag moves the card under the pointer and, when it belongs to the group, every other selected card.
  const handleNodeDragStart = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode, dragged: CanvasNode[] = [node]) => {
    cancelPendingOpenObjectFocus();
    for (const item of dragged.length ? dragged : [node]) {
      draggingNodeIdsRef.current.add(item.id);
      dragStartPositionsRef.current.set(item.id, item.position);
    }
  }, [cancelPendingOpenObjectFocus]);

  const persistPosition = useCallback((_event: MouseEvent | TouchEvent, node: CanvasNode, dragged: CanvasNode[] = [node]) => {
    const moves: { id: string; position: CanvasPoint; before?: CanvasPoint }[] = [];
    for (const item of dragged.length ? dragged : [node]) {
      draggingNodeIdsRef.current.delete(item.id);
      const before = dragStartPositionsRef.current.get(item.id);
      dragStartPositionsRef.current.delete(item.id);
      moves.push({ id: item.id, position: { x: item.position.x, y: item.position.y }, before });
    }
    commitUserPositions(moves);
  }, [commitUserPositions]);

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

  // A card asked for from elsewhere (e.g. View rules) is shown again if this viewer had closed it.
  useEffect(() => {
    if (focusNodeId && hiddenIds.has(focusNodeId)) showObject(focusNodeId);
  }, [focusNodeId, focusRequestKey, hiddenIds, showObject]);

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

  const connections = useMemo(() => {
    const projected: Array<{
      id: string;
      source: string;
      sourcePort: string;
      target: string;
      targetHandle: string;
      valueType: string;
      depth: number;
    }> = [];
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
    return dedupeVisibleCanvasConnections(projected);
  }, [plan.bindings, visibleIds]);
  const followUps = useMemo(() => followUpConnections(visibleAuxiliaryObjects, visibleIds), [visibleAuxiliaryObjects, visibleIds]);

  // Lines keep clear of every card on the canvas except paper notes, which sit on
  // top of them. The router also spreads shared ports and bridges crossings so a
  // busy table stays readable.
  const edges = useMemo(() => {
    const isRevisionPulse = revisionNotice !== null;
    const rects: RoutingRect[] = [];
    const crossable: string[] = [];
    for (const node of nodes) {
      rects.push({
        id: node.id,
        x: Math.round(node.position.x),
        y: Math.round(node.position.y),
        width: node.measured?.width ?? node.width ?? cardSizes[node.id]?.width ?? 360,
        height: node.measured?.height ?? node.height ?? cardSizes[node.id]?.height ?? 260,
      });
      if (isCanvasNoteId(node.id)) crossable.push(node.id);
    }
    const links: RoutingLink[] = [
      ...connections.map((connection) => ({ id: connection.id, source: connection.source, target: connection.target })),
      ...followUps.map((link) => ({ id: link.id, source: link.source, target: link.target, label: link.label })),
    ];
    const routes = new Map(routeConnections(rects, links, {
      clearance: 18,
      cornerRadius: 12,
      crossableIds: crossable,
      portSpacing: 12,
      laneSpacing: 16,
    }).map((route) => [route.id, route]));

    const auxiliaryTitles = new Map(visibleAuxiliaryObjects.map((object) => [object.id, object.title]));
    // F070: a picked option's line; it has no ports, so it is drawn only when the router finds a clear path.
    const followUpEdges = followUps.flatMap((link): CanvasEdge[] => {
      const route = routes.get(link.id);
      if (!route || route.hidden || !route.path) return [];
      const data: CanvasEdgeData = { route, color: FOLLOW_UP_EDGE_COLOR, haloColor: CANVAS_EDGE_HALO, strokeWidth: 2, moving: false };
      return [{
        id: link.id, source: link.source, sourceHandle: FOLLOW_UP_SOURCE_HANDLE, target: link.target, targetHandle: FOLLOW_UP_TARGET_HANDLE, type: 'canvasConnection', zIndex: 1,
        ariaLabel: `${auxiliaryTitles.get(link.source) ?? 'Answer'} led to ${auxiliaryTitles.get(link.target) ?? 'a follow-up'} after choosing “${link.label}”.`,
        data,
      }];
    });
    return [...followUpEdges, ...connections.map((connection): CanvasEdge => {
      const targetRole = canvasRole(planNodesById.get(connection.target)?.capability ?? '', 'plan');
      const markerColor = roleColor(targetRole);
      const sourceTitle = planNodesById.get(connection.source)?.title ?? connection.source;
      const targetTitle = planNodesById.get(connection.target)?.title ?? connection.target;
      const label = relationshipLabel(connection.valueType);
      const ariaLabel = `${sourceTitle} feeds ${targetTitle} with ${label}${connection.depth > 0 ? ` through ${connection.depth} intermediate plan step${connection.depth === 1 ? '' : 's'}` : ''}. Type: ${connection.valueType}.`;
      const route = routes.get(connection.id);
      if (route && !route.hidden && route.path) {
        const data: CanvasEdgeData = {
          route,
          relationshipLabel: label,
          color: markerColor,
          haloColor: CANVAS_EDGE_HALO,
          strokeWidth: 2.2,
          moving: isRevisionPulse,
        };
        return {
          id: connection.id,
          source: connection.source,
          target: connection.target,
          type: 'canvasConnection',
          zIndex: route.bridges ? 0 : 1,
          ariaLabel,
          data,
        };
      }
      // Never drop a connection: if no clear route exists, fall back to the default curve.
      return {
        id: connection.id,
        source: connection.source,
        sourceHandle: connection.sourcePort,
        target: connection.target,
        targetHandle: connection.targetHandle,
        type: 'smoothstep',
        animated: isRevisionPulse,
        ariaLabel,
        data: { relationshipLabel: label },
        style: { stroke: markerColor, strokeWidth: 2.2 },
      };
    })];
  }, [cardSizes, connections, followUps, nodes, planNodesById, revisionNotice, visibleAuxiliaryObjects]);

  // Right-click on the empty canvas: arrange every card again from scratch, as on first load.
  // targets: the cards a right-click on a card acts on; absent for a right-click on the empty canvas.
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; targets?: string[] } | null>(null);
  const arrangeObjects = useCallback(async () => {
    setContextMenu(null);
    cancelPendingOpenObjectFocus();
    const current = flow.getNodes();
    if (current.length === 0) return;
    const layoutNodes: CanvasLayoutNode[] = current.map((node) => ({
      id: node.id,
      role: node.data.kind === 'plan' ? canvasLayoutRole(node.data.spec.capability, node.id) : 'reference',
      width: node.measured?.width ?? node.width ?? 360,
      height: node.measured?.height ?? node.height ?? 260,
      position: node.position,
      pinned: isCanvasNoteId(node.id),
    }));
    const notes = new Set(layoutNodes.filter((node) => isCanvasNoteId(node.id)).map((node) => node.id));
    const result = layoutCanvas(layoutNodes, edges.map((edge) => ({ source: edge.source, target: edge.target })), { fixedIds: notes });
    const arranged = new Map(Object.entries(result.positions).filter(([id]) => !notes.has(id)));
    if (arranged.size === 0) return;
    setNodes((nodesNow) => nodesNow.map((node) => {
      const position = arranged.get(node.id);
      return position ? { ...node, position } : node;
    }));
    for (const [id, position] of arranged) rememberPosition(id, position);
    const shared = [...arranged].filter(([id]) => remoteLayoutEnabled && isSharedCanvasNodeForView(id, view));
    for (let index = 0; index < shared.length; index += 24) {
      const positions = Object.fromEntries(shared.slice(index, index + 24).map(([id, point]) => [id, { x: point.x, y: point.y, pinned: true }]));
      try {
        const updated = await onCommand('canvas.layout', { expectedLayoutRevision: sharedLayoutRef.current?.revision ?? 0, positions });
        const layout = updated && updated.domain.kind === 'table' ? updated.domain.canvasLayout : undefined;
        if (layout) sharedLayoutRef.current = layout;
      } catch { /* the table notice explains a refused arrangement; local positions stay */ }
    }
    window.requestAnimationFrame(() => { void flow.fitView({ padding: 0.12, duration: canvasMotionDuration(240) }); });
  }, [cancelPendingOpenObjectFocus, edges, flow, onCommand, remoteLayoutEnabled, rememberPosition, setNodes, view]);
  const revealAllObjects = useCallback(() => {
    setContextMenu(null);
    setHiddenIds(new Set());
    canvasView.saveHidden(workspaceKey, new Set());
  }, [workspaceKey]);
  // Header people: centre the view on another member's live cursor, keeping the zoom.
  useEffect(() => registerCanvasPointFocus((x, y) => {
    cancelPendingOpenObjectFocus();
    void flow.setCenter(x, y, { zoom: Math.max(flow.getViewport().zoom, 0.8), duration: canvasMotionDuration(260) });
  }), [cancelPendingOpenObjectFocus, flow]);
  // Chat commands ("เปิดการ์ด …", "open rules", "ซ่อนการ์ด …") find a card by name.
  const finderStateRef = useRef({ objectTitles: [] as { id: string; title: string; hidden: boolean }[], navigateToObject: (_id: string) => {}, hideObject: (_id: string) => {} });
  useEffect(() => registerCanvasObjectFinder((verb, query) => {
    const { objectTitles: objects, navigateToObject: open, hideObject: hide } = finderStateRef.current;
    // Chat cards are named after past questions, so they would match the question itself; search the table's own cards.
    const matches = matchCanvasObjects(objects.filter((object) => !object.id.startsWith('table.chat.') && !object.id.startsWith('chat.')), query);
    if (matches.length === 0) return { handled: false };
    const [first, ...others] = matches;
    if (verb === 'hide') {
      hide(first.id);
      return { handled: true, message: `Closed “${first.title}”. Open it again from Objects or by typing “open ${first.title}”.` };
    }
    open(first.id);
    return { handled: true, message: `Opened “${first.title}”.${others.length ? ` Also matching: ${others.slice(0, 3).map((item) => item.title).join(', ')}.` : ''}` };
  }), []);
  useEffect(() => {
    if (multiIds.size === 0) return;
    const clearGroup = (event: KeyboardEvent) => { if (event.key === 'Escape') setMultiIds(new Set()); };
    document.addEventListener('keydown', clearGroup);
    return () => document.removeEventListener('keydown', clearGroup);
  }, [multiIds]);
  useEffect(() => {
    if (!contextMenu) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== 'Escape') return;
      if (event instanceof PointerEvent && event.target instanceof Element && event.target.closest('.tt-canvas-context-menu')) return;
      setContextMenu(null);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, [contextMenu]);

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
      pinned: pinnedNodeIdsRef.current.has(node.id) || isCanvasNoteId(node.id),
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
        if (pinnedNodeIdsRef.current.has(node.id) || explicitAuxiliaryPositions.has(node.id) || isCanvasNoteId(node.id)) fixedIds.add(node.id);
      }
    } else {
      // F070: a follow-up card keeps the seat beside its source card instead of being re-flowed.
      const followUpIds = new Set(visibleAuxiliaryObjects.filter((object) => object.linkedFrom).map((object) => object.id));
      for (const node of layoutNodes) {
        if (addedIds.has(node.id)) {
          if (followUpIds.has(node.id)) fixedIds.add(node.id);
          continue;
        }
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

  // Share positions only after newly rendered nodes have measured and settled. Keep
  // the in-flight IDs private to this actor/epoch scope and seed late arrivals too.
  useEffect(() => {
    if (!remoteLayoutEnabled || layoutReadyKey !== workspaceKey || nodes.length === 0) return;
    if (view.actor.role !== 'owner' && view.actor.role !== 'participant') return;
    const scope = layoutScopeRef.current;
    const known = sharedLayoutRef.current?.positions ?? {};
    const revision = sharedLayoutRef.current?.revision ?? 0;
    const seedIds = missingSharedCanvasNodeIds(nodes, view, known, pendingSeedNodeIdsRef.current, draggingNodeIdsRef.current, activeOpenedId, 24)
      .filter((id) => (seedAttemptCountsRef.current.get(`${revision}:${id}`) ?? 0) < 2);
    if (seedIds.length === 0) return;
    for (const id of seedIds) {
      pendingSeedNodeIdsRef.current.add(id);
      const attemptKey = `${revision}:${id}`;
      seedAttemptCountsRef.current.set(attemptKey, (seedAttemptCountsRef.current.get(attemptKey) ?? 0) + 1);
    }

    const isCurrentScope = () => layoutScopeRef.current === scope;
    const pause = () => new Promise<void>((resolve) => window.setTimeout(resolve, 32));
    const settledPositions = async (ids: readonly string[]): Promise<Map<string, CanvasPoint> | null> => {
      let previousGeometry = '';
      let stableSince = 0;
      let stableSamples = 0;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        await pause();
        if (!isCurrentScope()) return null;
        // A card that left the canvas while this batch settled (hidden, or a chat card that became a
        // notice) can never measure; waiting for it would drop the whole batch and nothing re-seeds it.
        const eligibleIds = ids.filter((id) => activeOpenedIdRef.current !== id && !draggingNodeIdsRef.current.has(id) && flow.getNode(id) !== undefined);
        if (eligibleIds.length === 0) return new Map();
        const measured = eligibleIds.map((id) => flow.getNode(id));
        if (measured.some((node) => !node || !Number.isFinite(node.measured?.width) || !Number.isFinite(node.measured?.height))) {
          previousGeometry = '';
          stableSince = 0;
          stableSamples = 0;
          continue;
        }
        const geometry = measured.map((node) => {
          if (!node) return '';
          const width = node.measured?.width;
          const height = node.measured?.height;
          if (typeof width !== 'number' || typeof height !== 'number') return '';
          return [node.position.x, node.position.y, width, height]
            .map((value) => String(Math.round(value * 2) / 2)).join(',');
        }).join('|');
        const now = performance.now();
        if (geometry === previousGeometry) stableSamples += 1;
        else {
          previousGeometry = geometry;
          stableSince = now;
          stableSamples = 0;
        }
        if (stableSamples >= 2 && now - stableSince >= 90) {
          const positions = new Map<string, CanvasPoint>();
          for (let index = 0; index < eligibleIds.length; index += 1) {
            const nodeId = eligibleIds[index];
            const node = measured[index];
            if (nodeId === undefined || !node) return null;
            positions.set(nodeId, { x: node.position.x, y: node.position.y });
          }
          return positions;
        }
      }
      return null;
    };
    const currentSeedPositions = (ids: readonly string[]) => {
      const currentView = viewRef.current;
      const currentKnown = sharedLayoutRef.current?.positions ?? {};
      const otherPendingIds = new Set(pendingSeedNodeIdsRef.current);
      for (const id of seedIds) otherPendingIds.delete(id);
      const eligible = missingSharedCanvasNodeIds(
        ids.map((id) => ({ id })), currentView, currentKnown, otherPendingIds,
        draggingNodeIdsRef.current, activeOpenedIdRef.current, 24,
      );
      const positions: Record<string, CanvasPoint & { pinned: boolean }> = {};
      for (const id of eligible) {
        const node = flow.getNode(id);
        if (!node || !Number.isFinite(node.position.x) || !Number.isFinite(node.position.y)) continue;
        positions[id] = { x: Math.round(node.position.x), y: Math.round(node.position.y), pinned: true };
      }
      return positions;
    };
    const send = async () => {
      try {
        if (!isCurrentScope()) return;
        const settled = await settledPositions(seedIds);
        if (!isCurrentScope()) return;
        if (!settled || settled.size === 0) return;
        const settledIds = [...settled.keys()];
        let positions = currentSeedPositions(settledIds);
        if (Object.keys(positions).length === 0) return;
        const expectedLayoutRevision = sharedLayoutRef.current?.revision ?? 0;
        const attempt = async (revision: number, currentPositions: Record<string, CanvasPoint & { pinned: boolean }>) => {
          if (!isCurrentScope()) return null;
          try {
            const updated = await onCommand('canvas.layout', { expectedLayoutRevision: revision, positions: currentPositions });
            return isCurrentScope() && updated && canvasLayoutScopeKey(updated) === workspaceKey ? updated : null;
          } catch {
            return null;
          }
        };
        let updated = await attempt(expectedLayoutRevision, positions);
        if (!updated) {
          if (!isCurrentScope()) return;
          await new Promise<void>((resolve) => window.setTimeout(resolve, 350));
          if (!isCurrentScope()) return;
          const latest = sharedLayoutRef.current;
          if (latest && latest.revision !== expectedLayoutRevision) {
            const latestAttemptIds = settledIds.filter((id) => (seedAttemptCountsRef.current.get(`${latest.revision}:${id}`) ?? 0) < 2);
            for (const id of latestAttemptIds) {
              const attemptKey = `${latest.revision}:${id}`;
              seedAttemptCountsRef.current.set(attemptKey, (seedAttemptCountsRef.current.get(attemptKey) ?? 0) + 1);
            }
            positions = currentSeedPositions(latestAttemptIds);
            if (Object.keys(positions).length > 0) updated = await attempt(latest.revision, positions);
          }
        }
        if (!isCurrentScope() || !updated) return;
        const canonical = sharedLayoutForView(updated);
        if (!canonical) return;
        if (!sharedLayoutRef.current || canonical.revision >= sharedLayoutRef.current.revision) sharedLayoutRef.current = canonical;
      } finally {
        if (isCurrentScope()) for (const id of seedIds) pendingSeedNodeIdsRef.current.delete(id);
      }
    };
    const queued = layoutCommandQueueRef.current.then(send, send);
    layoutCommandQueueRef.current = queued;
    void queued.catch(() => undefined);
  }, [remoteLayoutEnabled, layoutReadyKey, workspaceKey, nodes, edges, sharedLayout?.revision, onCommand, view, activeOpenedId, flow]);

  const choose = useCallback((event: React.MouseEvent, node: CanvasNode) => {
    // A content control may have navigated to another object. Do not select its
    // old container again while that same click bubbles through React Flow.
    if (event.target instanceof Element && event.target.closest('.tt-canvas-node__body')) return;
    if (event.shiftKey) {
      // Shift+click adds or removes a card from the group; the card selected before joins the group too.
      setMultiIds((current) => {
        const next = new Set(current);
        if (next.size === 0 && selectedNodeId && selectedNodeId !== node.id) next.add(selectedNodeId);
        if (next.has(node.id)) next.delete(node.id);
        else next.add(node.id);
        return next;
      });
      return;
    }
    setMultiIds(new Set());
    onSelectNode(node.id);
  }, [onSelectNode, selectedNodeId]);
  const clear = useCallback(() => { setMultiIds(new Set()); onSelectNode(null); }, [onSelectNode]);
  const openCardMenu = useCallback((event: React.MouseEvent, node: CanvasNode) => {
    // Keep the browser's own menu for typing and for copying selected text.
    if (event.target instanceof Element && event.target.closest('input, textarea, select, [contenteditable="true"]')) return;
    if ((window.getSelection()?.toString() ?? '').trim()) return;
    event.preventDefault();
    // A right-click on a card in the Shift group acts on the whole group; otherwise on that card alone.
    const targets = multiIds.has(node.id) ? [...multiIds] : [node.id];
    setContextMenu({ ...contextMenuPosition(event.clientX, event.clientY), targets });
  }, [multiIds]);

  useEffect(() => {
    // React Flow drags every selected card together, so the group is selected there too.
    setNodes((current) => current.map((node) => ({
      ...node,
      selected: node.id === selectedNodeId || multiIds.has(node.id),
      data: { ...node.data, selected: node.id === selectedNodeId },
    })));
  }, [selectedNodeId, multiIds, setNodes]);
  const syncBoxSelection = useCallback(({ nodes: picked }: { nodes: CanvasNode[] }) => {
    // A Shift+drag box that catches two or more cards becomes the group.
    if (picked.length < 2) return;
    setMultiIds((current) => current.size === picked.length && picked.every((node) => current.has(node.id)) ? current : new Set(picked.map((node) => node.id)));
  }, []);

  // Chat commands ("open rules") still match on the canvas order of every listed card, hidden ones included.
  const objectTitles = useMemo(() => cardRows, [cardRows]);
  finderStateRef.current = { objectTitles, navigateToObject, hideObject };
  const [starredIds, setStarredIds] = useState<ReadonlySet<string>>(() => canvasView.starred(workspaceKey));
  const starScopeRef = useRef(workspaceKey);
  if (starScopeRef.current !== workspaceKey) {
    starScopeRef.current = workspaceKey;
    setStarredIds(canvasView.starred(workspaceKey));
  }
  const toggleStar = (id: string) => setStarredIds((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    canvasView.saveStarred(workspaceKey, next);
    return next;
  });
  const [objectQuery, setObjectQuery] = useState('');
  const listedObjects = useMemo(() => {
    const query = objectQuery.trim();
    const matched = query ? new Set(matchCanvasObjects(objectTitles, query).map((object) => object.id)) : null;
    const shown = matched ? objectTitles.filter((object) => matched.has(object.id)) : objectTitles;
    // An explicit time sort wins over starred-first; Canvas order keeps the familiar starred grouping.
    if (cardSort !== 'canvas') return sortCardRows(shown, cardSort);
    return [...shown.filter((object) => starredIds.has(object.id)), ...shown.filter((object) => !starredIds.has(object.id))];
  }, [cardSort, objectTitles, objectQuery, starredIds]);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const startRename = (id: string, title: string) => { setRenamingId(id); setRenameDraft(title); };
  /** Saves the name for everyone; a blank name brings back the card's own title. */
  const commitRename = async () => {
    const id = renamingId;
    if (!id) return;
    setRenamingId(null);
    const title = renameDraft.replace(/\s+/gu, ' ').trim().slice(0, 120);
    const current = objectTitles.find((object) => object.id === id)?.title ?? '';
    if (title === current) return;
    await renameCanvasObject(id, title);
  };
  const [deletedOpen, setDeletedOpen] = useState(false);
  const tableReadOnly = busy === 'table.readOnly';
  /** Soft delete for everyone (or restore): the card stays stored and comes back from Deleted. */
  const hideGroup = (ids: readonly string[]) => {
    for (const id of ids) hideObject(id);
    setMultiIds(new Set());
  };
  /** Points the chat at every card in the group (the chat takes up to five). */
  const askAboutGroup = (ids: readonly string[]) => {
    if (!referenceInChat) return;
    for (const id of ids.slice(0, 5)) referenceInChat(id, nodes.find((node) => node.id === id)?.data.title ?? id);
  };
  /** Soft delete several cards in one shared-layout change (the server takes up to 24 at a time). */
  const trashObjects = async (ids: readonly string[]) => {
    setTrashError(null);
    const updated = await onCommand('canvas.layout', { expectedLayoutRevision: sharedLayoutRef.current?.revision ?? 0, trash: Object.fromEntries(ids.slice(0, 24).map((id) => [id, true])) });
    if (!updated) setTrashError('Could not delete these cards. Try again.');
  };
  const trashObject = async (id: string, toTrash: boolean) => {
    setTrashError(null);
    const updated = await onCommand('canvas.layout', { expectedLayoutRevision: sharedLayoutRef.current?.revision ?? 0, trash: { [id]: toTrash } });
    if (!updated) setTrashError(toTrash ? 'Could not delete this card. Try again.' : 'Could not restore this card. Try again.');
  };
  // A table-wide display setting wins; without one, the viewer's own choice, then the default.
  const tableConnections = view.domain.display?.connections;
  const canSetDisplay = viewerCan(view, 'table.rename') && busy !== 'table.readOnly';
  const showConnections = tableConnections ?? resolveConnectionsVisible(connectionsPreference, edges.length);
  const visibleEdges = showConnections ? edges : [];
  const toggleConnections = () => {
    const next = !showConnections;
    if (tableConnections !== undefined || canSetDisplay) {
      if (canSetDisplay) void onCommand('display.set', { connections: next });
      return;
    }
    writeConnectionsPreference(connectionsStorage(), next);
    setConnectionsPreference(next);
  };
  const connectionsLocked = tableConnections !== undefined && !canSetDisplay;
  const hasVisibleObjects = objectTitles.length > 0;

  return (
    <div
      className="tt-flow-wrap"
      ref={flowWrapRef}
      data-canvas-editor
      data-testid="canvas-object-workspace"
      onPointerDownCapture={cancelPendingOpenObjectFocus}
      onKeyDownCapture={cancelPendingOpenObjectFocus}
      onPointerMove={shareCursor}
      onPointerLeave={hideCursor}
    >
      {!hasVisibleObjects ? (
        <div className="tt-canvas-empty">
          <span><Workflow size={19} /></span>
          {emptyContent ?? <><strong>This table is ready for its first object</strong><p>Add a source or start the sample workflow from the table panel.</p></>}
        </div>
      ) : (
        <MultiSelectionContext.Provider value={multiIds}><ReactFlow<CanvasNode, CanvasEdge>
          nodes={nodes}
          edges={visibleEdges}
          nodeTypes={nodeTypes}
          edgeTypes={canvasEdgeTypes}
          onNodesChange={handleNodesChange}
          onMoveStart={handleCanvasMoveStart}
          onNodeDragStart={handleNodeDragStart}
          onNodeDragStop={persistPosition}
          onNodeClick={choose}
          onPaneClick={clear}
          onPaneContextMenu={(event) => { event.preventDefault(); setContextMenu(contextMenuPosition(event.clientX, event.clientY)); }}
          onNodeContextMenu={openCardMenu}
          onSelectionChange={syncBoxSelection}
          deleteKeyCode={null}
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
          <LiveCursors members={view.members} selfId={view.actor.actorId} />
          <Controls
            position="bottom-right"
            showInteractive={false}
            showFitView={false}
            onZoomIn={cancelPendingOpenObjectFocus}
            onZoomOut={cancelPendingOpenObjectFocus}
          />
        </ReactFlow></MultiSelectionContext.Provider>
      )}
      <div className="tt-canvas-tools">
        <span className="tt-canvas-visually-hidden" role="status" aria-live="polite" aria-atomic="true">{moveAnnouncement}</span>
        {contextMenu?.targets && (() => {
          const targets = contextMenu.targets.filter((id) => nodes.some((node) => node.id === id));
          const single = targets.length === 1 ? nodes.find((node) => node.id === targets[0]) : undefined;
          const label = single ? 'card' : `${targets.length} cards`;
          const deletable = targets.length > 0 && targets.every((id) => canTrash(view, id));
          const close = () => setContextMenu(null);
          return <div className="tt-canvas-context-menu" role="menu" aria-label={single ? single.data.title : `${targets.length} cards`} style={{ left: contextMenu.x, top: contextMenu.y }}>
            {targets.length > 1 && <p className="tt-canvas-context-menu__note">{targets.length} cards selected (Shift+click)</p>}
            <button type="button" role="menuitem" data-testid="card-menu-hide" autoFocus onClick={() => { hideGroup(targets); close(); }}><EyeOff size={15} aria-hidden="true" />Hide {label}</button>
            {referenceInChat && <button type="button" role="menuitem" data-testid="card-menu-ask" onClick={() => { askAboutGroup(targets); close(); }}><MessageSquareText size={15} aria-hidden="true" />Ask about {targets.length > 1 ? `these ${Math.min(targets.length, 5)} cards` : 'this card'} in chat</button>}
            {deletable && <button type="button" role="menuitem" data-testid="card-menu-delete" disabled={busy === 'table.readOnly'} onClick={() => { void trashObjects(targets); setMultiIds(new Set()); close(); }}><Trash2 size={15} aria-hidden="true" />Delete {label} for everyone</button>}
          </div>;
        })()}
        {multiIds.size > 1 && (() => {
          const ids = [...multiIds].filter((id) => nodes.some((node) => node.id === id));
          const deletable = ids.length > 0 && ids.every((id) => canTrash(view, id));
          return <div className="tt-canvas-selection-bar" role="toolbar" aria-label={`${ids.length} cards selected`} data-testid="canvas-selection-bar">
            <span><b>{ids.length}</b> cards selected · drag one to move them all</span>
            {referenceInChat && <button type="button" data-testid="selection-ask" onClick={() => askAboutGroup(ids)} title={ids.length > 5 ? 'The chat takes the first 5 cards' : undefined}><MessageSquareText size={15} aria-hidden="true" />Ask in chat</button>}
            <button type="button" data-testid="selection-hide" onClick={() => hideGroup(ids)}><EyeOff size={15} aria-hidden="true" />Hide</button>
            {deletable && <button type="button" data-testid="selection-delete" disabled={busy === 'table.readOnly'} onClick={() => { void trashObjects(ids); setMultiIds(new Set()); }}><Trash2 size={15} aria-hidden="true" />Delete</button>}
            <button type="button" className="tt-canvas-selection-bar__clear" data-testid="selection-clear" aria-label="Clear selection" title="Clear selection (Esc)" onClick={() => setMultiIds(new Set())}><X size={15} aria-hidden="true" /></button>
          </div>;
        })()}
        {contextMenu && !contextMenu.targets && <div className="tt-canvas-context-menu" role="menu" aria-label="Canvas" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <button type="button" role="menuitem" autoFocus onClick={() => void arrangeObjects()}><LayoutGrid size={15} aria-hidden="true" />Arrange objects</button>
          {hiddenIds.size > 0 && <button type="button" role="menuitem" onClick={revealAllObjects}><Eye size={15} aria-hidden="true" />Show closed cards ({hiddenIds.size})</button>}
        </div>}
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
            <button className="tt-canvas-connections" type="button" data-testid="canvas-connections-toggle" aria-pressed={showConnections} aria-label={`Connections, ${edges.length}`} disabled={connectionsLocked} title={connectionsLocked ? 'Set for everyone at this table' : canSetDisplay ? 'Changes this table for everyone' : undefined} onClick={(event) => { event.stopPropagation(); toggleConnections(); }}>
              <Workflow size={16} aria-hidden="true" /><span>Connections</span><small>{edges.length}</small><i aria-hidden="true">{showConnections ? 'On' : 'Off'}</i>
            </button>
            <label className="tt-canvas-objects__sort">
              <span>Sort</span>
              <select data-testid="canvas-object-sort" aria-label="Sort objects" value={cardSort} onChange={(event) => changeCardSort(parseCardSortMode(event.currentTarget.value))}>
                {CARD_SORT_OPTIONS.map((option) => <option key={option.mode} value={option.mode}>{option.label}</option>)}
              </select>
            </label>
            {objectTitles.length > 5 && <label className="tt-canvas-objects__search">
              <Search size={15} aria-hidden="true" />
              <input type="search" data-testid="canvas-object-search" placeholder="Search cards" aria-label="Search cards" value={objectQuery} onChange={(event) => setObjectQuery(event.target.value)} onKeyDown={(event) => { event.stopPropagation(); if (event.key === 'Escape' && objectQuery) { event.preventDefault(); setObjectQuery(''); } if (event.key === 'Enter' && listedObjects[0]) navigateToObject(listedObjects[0].id); }} />
            </label>}
            {objectQuery.trim() && listedObjects.length === 0 && <p className="tt-canvas-objects__empty" role="status">No card matches “{objectQuery.trim()}”.</p>}
            <ul className="tt-canvas-objects__list">
              {listedObjects.map((object) => <li key={object.id} className={'tt-canvas-objects__row' + (selectedNodeId === object.id ? ' is-current' : '')} data-starred={starredIds.has(object.id) || undefined} data-hidden={object.hidden || undefined}>
                {renamingId === object.id ? <input className="tt-canvas-objects__rename" data-testid={`rename-input-${object.id}`} aria-label={`New name for ${object.title}`} maxLength={120} autoFocus value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} onBlur={() => void commitRename()} onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === 'Enter') { event.preventDefault(); void commitRename(); }
                  if (event.key === 'Escape') { event.preventDefault(); setRenamingId(null); }
                }} /> : <button type="button" className="tt-canvas-objects__main" data-testid={`open-canvas-${object.id}`} data-hidden={object.hidden || undefined} aria-label={object.hidden ? `Reopen and go to ${object.title}` : `Open and go to ${object.title}`} aria-current={selectedNodeId === object.id ? 'location' : undefined} aria-expanded={activeOpenedId === object.id} onClick={(event) => { event.stopPropagation(); navigateToObject(object.id); }}>
                  <span className="tt-canvas-objects__glyph" data-role={canvasRole(object.capability, object.kind)} aria-hidden="true">{capabilityGlyph(object.capability, object.kind)}</span>
                  <span className="tt-canvas-objects__title" title={object.title}>{object.title}</span>
                </button>}
                <span className="tt-canvas-objects__actions">
                  <button type="button" className="tt-canvas-objects__eye tt-canvas-objects__star" data-testid={`star-canvas-${object.id}`} aria-pressed={starredIds.has(object.id)} aria-label={starredIds.has(object.id) ? `Unstar ${object.title}` : `Star ${object.title}`} title={starredIds.has(object.id) ? 'Starred: listed first' : 'Star to list it first'} onClick={(event) => { event.stopPropagation(); toggleStar(object.id); }}>
                    <Star size={15} aria-hidden="true" fill={starredIds.has(object.id) ? 'currentColor' : 'none'} />
                  </button>
                  {canRename(view, object.id) && renamingId !== object.id ? <button type="button" className="tt-canvas-objects__eye tt-canvas-objects__more" data-testid={`rename-canvas-${object.id}`} disabled={tableReadOnly} aria-label={`Rename ${object.title}`} title="Rename for everyone (leave blank for the original name)" onClick={(event) => { event.stopPropagation(); startRename(object.id, object.title); }}>
                    <Pencil size={14} aria-hidden="true" />
                  </button> : <span className="tt-canvas-objects__slot" aria-hidden="true" />}
                  <button type="button" className="tt-canvas-objects__eye" data-testid={`toggle-canvas-${object.id}`} aria-pressed={!object.hidden} aria-label={object.hidden ? `Show ${object.title}` : `Hide ${object.title}`} title={object.hidden ? 'Show on canvas' : 'Hide from canvas'} onClick={(event) => { event.stopPropagation(); if (object.hidden) showObject(object.id); else hideObject(object.id); }}>
                    {object.hidden ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
                  </button>
                  {canTrash(view, object.id) ? <button type="button" className="tt-canvas-objects__eye tt-canvas-objects__delete tt-canvas-objects__more" data-testid={`delete-canvas-${object.id}`} disabled={tableReadOnly} aria-label={`Delete ${object.title}`} title="Delete for everyone (restore from Deleted)" onClick={(event) => { event.stopPropagation(); void trashObject(object.id, true); }}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button> : <span className="tt-canvas-objects__slot" aria-hidden="true" />}
                </span>
                <CardRowMeta row={object} />
              </li>)}
            </ul>
            {trashError && <p className="tt-canvas-objects__error" role="alert">{trashError}</p>}
            {deletedObjects.length > 0 && <div className="tt-canvas-objects__deleted">
              <button type="button" className="tt-canvas-objects__deleted-toggle" data-testid="canvas-deleted-toggle" aria-expanded={deletedOpen} onClick={(event) => { event.stopPropagation(); setDeletedOpen((open) => !open); }}>
                <Trash2 size={15} aria-hidden="true" /><span>Deleted</span><small>{deletedObjects.length}</small>
              </button>
              {deletedOpen && <ul className="tt-canvas-objects__list">
                {deletedObjects.map((object) => <li key={object.id}>
                  <span className="tt-canvas-objects__deleted-title" title={object.title}>{object.title}</span>
                  {canTrash(view, object.id) && <button type="button" className="tt-canvas-objects__eye" data-testid={`restore-canvas-${object.id}`} disabled={tableReadOnly} aria-label={`Restore ${object.title}`} title="Restore for everyone" onClick={(event) => { event.stopPropagation(); void trashObject(object.id, false); }}>
                    <Undo2 size={15} aria-hidden="true" />
                  </button>}
                </li>)}
              </ul>}
            </div>}
          </nav>
        </div>
        {closedTableCards.length > 0 && !objectsMenuOpen && <button type="button" className="tt-canvas-closed-notice" data-testid="canvas-closed-notice" title={closedTableCards.map((object) => object.title).join(' · ')} onClick={() => showObjects(closedTableCards.map((object) => object.id))}>
          <EyeOff size={15} aria-hidden="true" /><span>{closedTableCards.length} closed {closedTableCards.length === 1 ? 'card' : 'cards'}</span><b>Show all</b>
        </button>}
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

/** What the AI should understand a referenced card to be: its kind, and for data its fields. */
function describeCardForChat(id: string, title: string, view: WorkspaceView): string {
  const program = view.domain.kind === 'table' ? view.domain.program : null;
  if (id.startsWith('table.collection.')) {
    const collection = program?.collections.find((item) => `table.collection.${item.id}` === id);
    return collection ? `data table “${collection.title}” (id ${collection.id}) with fields ${collection.fields.map((field) => `${field.label} [${field.id}, ${field.type}]`).join(', ')}` : `data table “${title}”`;
  }
  if (id.startsWith('table.view.')) {
    const descriptor = program?.canvas?.views.find((item) => `table.view.${item.id}` === id);
    return descriptor ? `${descriptor.kind} view “${descriptor.title}” (id ${descriptor.id})` : `view “${title}”`;
  }
  if (id === 'table.rules') return 'the table rules (collections, actions and checks)';
  if (id === 'table.actions') return `the table actions${program ? `: ${program.actions.map((action) => action.title).join(', ')}` : ''}`;
  if (id.startsWith('table.chat.')) return `an earlier chat answer titled “${title}”`;
  return `card “${title}”`;
}

/** Keep the right-click menu on screen when opened near the right or bottom edge. */
function contextMenuPosition(x: number, y: number): { x: number; y: number } {
  const width = 220;
  const height = 110;
  return {
    x: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    y: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  };
}
