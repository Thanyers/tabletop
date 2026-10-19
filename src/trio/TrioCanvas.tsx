import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject } from 'react';
import MaterializeSurface from '../components/MaterializeSurface';
import {
  Activity,
  ArrowDownRight,
  CircleAlert,
  CircleCheck,
  Compass,
  FileText,
  Grip,
  Music2,
  PackageOpen,
  ShieldCheck,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from 'lucide-react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Handle,
  Panel,
  Position,
  ReactFlow,
  useNodesInitialized,
  useReactFlow,
  type Edge,
  type EdgeTypes,
  type Node,
  type NodeChange,
  type NodeTypes,
  type NodeProps,
  type Position as FlowPosition,
  type ReactFlowProps,
  type Viewport,
} from '@xyflow/react';
import { routeConnections, type RoutedConnection, type RoutingLink, type RoutingRect } from '../state/edge-routing';
import CanvasEdge, { type CanvasEdgeData } from '../components/CanvasEdge';
import { TrioObject } from './TrioStage';
import { canvasObjectForEvent, canvasObjectForStep, narrativeFocus, narrativeSelector } from './narrativeFocus';
import { canApprove, rulesFingerprint } from './domain';
import type { EncounterOutcome } from './creative/encounterModel';
import type { CaseId, StoryStep, TrioStageProps } from './types';
import './trio-canvas.css';

export type TrioCanvasProps = TrioStageProps & {
  interactionMode: 'use' | 'arrange';
  hand: boolean;
  snap: boolean;
  dependencies: boolean;
  followCamera: boolean;
  onManualPan: () => void;
  onLayoutChange?: (layout: Partial<Record<StoryStep, { x: number; y: number }>>) => void;
  focusVersion?: number;
  focusStep?: StoryStep | null;
  lens?: 'work' | 'learn' | 'constellation';
  onViewportChange?: (zoom: number) => void;
  onEncounterRoundComplete?: (outcome: EncounterOutcome, context: 'baseline' | 'draft' | 'verify' | 'active' | 'simulation' | 'history') => void;
};

type TrioCanvasStageProps = TrioStageProps & Pick<TrioCanvasProps, 'onEncounterRoundComplete'>;

type TrioNodeData = Record<string, unknown> & {
  objectId: StoryStep;
  stage: TrioCanvasStageProps;
  loading: boolean;
  interactionMode: TrioCanvasProps['interactionMode'];
  showContinue: boolean;
  continueLabel: string;
  continueDisabled: boolean;
  onContinue: () => void;
  spotlight: 'focused' | 'dimmed' | 'off';
  cueLabel: string;
  cueRecord: string | null;
  cueSelector: string;
};
type TrioFlowNode = Node<TrioNodeData, 'trioStory'>;
type TrioFlowEdge = Edge<CanvasEdgeData, 'canvasConnection'>;
export type TrioCanvasNode = TrioFlowNode;
export type TrioCanvasEdge = TrioFlowEdge;
type TrioCanvasLayout = Partial<Record<StoryStep, { x: number; y: number }>>;
type SnapshotWithCanvasLayout = TrioStageProps['snapshot'] & { layout?: TrioCanvasLayout };
type TrioCanvasHostProps = HTMLAttributes<HTMLDivElement> & {
  'data-case': CaseId;
  'data-level': number;
  'data-step': StoryStep;
  'data-version': number;
  'data-guided': string;
  'data-lens': NonNullable<TrioCanvasProps['lens']>;
  'data-testid': 'trio-stage';
};
type TrioFlowProps = ReactFlowProps<TrioFlowNode, TrioFlowEdge>;

export type TrioCanvasBindings = Pick<TrioFlowProps,
  'nodes' | 'edges' | 'onNodesChange' | 'onMoveStart' | 'onMoveEnd'
  | 'onNodeDragStart' | 'onNodeDragStop' | 'panOnDrag' | 'panOnScroll'
  | 'nodesDraggable' | 'nodesConnectable' | 'elementsSelectable' | 'snapToGrid'
  | 'snapGrid' | 'minZoom' | 'maxZoom' | 'proOptions' | 'className'
> & {
  children?: ReactNode;
  canvasProps?: TrioCanvasHostProps;
};

const STEPS: readonly StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];
const REQUIRED_LEVEL: Record<StoryStep, number> = {
  sources: 1,
  minimal: 2,
  notice: 3,
  teach: 4,
  verify: 5,
  approve: 6,
  simulate: 7,
  handoff: 8,
};
const STEP_LABEL: Record<StoryStep, string> = {
  sources: 'ข้อมูลต้นทาง',
  minimal: 'พื้นที่ใช้งาน',
  notice: 'จุดที่ต้องแก้',
  teach: 'ร่างกติกา',
  verify: 'ตรวจตัวอย่าง',
  approve: 'กติกาที่ตรวจแล้ว',
  simulate: 'พื้นที่ทดลอง',
  handoff: 'ส่งต่องาน',
};
const STEP_ICON: Record<StoryStep, LucideIcon> = {
  sources: FileText,
  minimal: PackageOpen,
  notice: CircleAlert,
  teach: Sparkles,
  verify: CircleCheck,
  approve: ShieldCheck,
  simulate: Activity,
  handoff: Waypoints,
};
const STEP_HELP: Record<StoryStep, string> = {
  sources: 'กำลังจัดข้อมูลตัวอย่างไว้ข้างกติกาเดิม',
  minimal: 'กำลังวางส่วนที่จำเป็นสำหรับเริ่มใช้งาน',
  notice: 'กำลังเทียบจุดที่เปลี่ยนกับค่าที่ใช้อยู่',
  teach: 'กำลังเพิ่มช่องกติกาตามสิ่งที่ตกลงกัน',
  verify: 'กำลังเตรียมตัวอย่างและผลที่คำนวณได้',
  approve: 'กำลังเตรียมจุดยืนยันกติกาที่ผ่านตรวจ',
  simulate: 'กำลังเตรียมพื้นที่ทดลองแยกจากกติกาปัจจุบัน',
  handoff: 'กำลังรวบรวมงานค้างและหลักฐานที่เกี่ยวข้อง',
};
const MANUAL_CONTINUE_LABELS = [
  'เปิดข้อมูลตัวอย่าง',
  'สร้างพื้นที่ใช้งาน',
  'ดูจุดที่อยากปรับ',
  'เพิ่มหน้าร่างกฎ',
  'ลองกับตัวอย่าง',
  'ใช้กฎที่ตรวจแล้ว',
  'เปิดพื้นที่ทดลอง',
  'ส่งต่องานที่ยังค้าง',
];
const STEP_TITLES: Record<CaseId, Record<StoryStep, string>> = {
  shipping: {
    sources: 'ข้อตกลงและรายการพัสดุ',
    minimal: 'ตารางค่าส่งและข้อตกลง',
    notice: 'ส่วนต่างจากอัตราเดิม',
    teach: 'ร่างอัตราค่าส่ง',
    verify: 'ตรวจอัตรากับพัสดุตัวอย่าง',
    approve: 'อัตราที่ตรวจแล้ว',
    simulate: 'ทดลองฐานราคา',
    handoff: 'พัสดุที่ยังรอยืนยัน',
  },
  quest: {
    sources: 'ภาพฉากและกติกาเริ่มต้น',
    minimal: 'หนึ่งตากับก๊อบลิน',
    notice: 'ผลของโล่ที่ต้องปรับ',
    teach: 'ลองโล่ช่วยเพื่อน',
    verify: 'เล่นตาเดิม ทดสอบกฎใหม่',
    approve: 'กฎโล่ที่ผ่านการตรวจ',
    simulate: 'ลองลดพลังโล่',
    handoff: 'จุดในเกมที่รอยืนยัน',
  },
  music: {
    sources: 'คลิปซ้อมและบันทึกของวง',
    minimal: 'Loop Studio · คลื่นเสียงและจังหวะ',
    notice: 'จังหวะท่อนฮุกที่ต้องปรับ',
    teach: 'ร่างจังหวะและจำนวนรอบ',
    verify: 'ตรวจจังหวะจากบันทึกซ้อม',
    approve: 'แผนซ้อมที่ตรวจแล้ว',
    simulate: 'ทดลองลดจังหวะ',
    handoff: 'ท่อนที่รอคนเล่นยืนยัน',
  },
};

const POSITIONS: Record<CaseId, Record<StoryStep, { x: number; y: number }>> = {
  shipping: {
    sources: { x: 80, y: 90 }, minimal: { x: 570, y: 10 }, notice: { x: 1370, y: 80 },
    teach: { x: 1240, y: 620 }, verify: { x: 590, y: 720 }, approve: { x: 60, y: 780 },
    simulate: { x: 720, y: 1460 }, handoff: { x: 1390, y: 1390 },
  },
  quest: {
    sources: { x: 80, y: 140 }, minimal: { x: 650, y: 140 }, notice: { x: 1450, y: 140 },
    teach: { x: 80, y: 900 }, verify: { x: 820, y: 900 }, approve: { x: 1570, y: 900 },
    simulate: { x: 820, y: 1700 }, handoff: { x: 1570, y: 1650 },
  },
  music: {
    sources: { x: 80, y: 80 }, minimal: { x: 590, y: 60 }, notice: { x: 1360, y: 120 },
    teach: { x: 1240, y: 700 }, verify: { x: 620, y: 820 }, approve: { x: 50, y: 800 },
    simulate: { x: 710, y: 1510 }, handoff: { x: 1390, y: 1430 },
  },
};

export const trioEdgeTypes: EdgeTypes = { canvasConnection: CanvasEdge };
export const trioNodeTypes: NodeTypes = { trioStory: TrioCanvasNode };

function preferredWidth(caseId: CaseId, step: StoryStep): number {
  if (caseId === 'quest' && ['minimal', 'teach', 'verify', 'simulate'].includes(step)) return 660;
  if (step === 'minimal') return caseId === 'shipping' ? 710 : caseId === 'music' ? 550 : 500;
  if (step === 'verify') return 500;
  if (step === 'simulate') return 475;
  if (step === 'handoff') return 465;
  if (step === 'teach') return 410;
  if (step === 'sources') return 450;
  if (step === 'approve') return 355;
  return 395;
}

function fallbackHeight(caseId: CaseId, step: StoryStep): number {
  if (step === 'minimal') return caseId === 'shipping' ? 390 : caseId === 'quest' ? 620 : 480;
  if (step === 'verify') return 445;
  if (step === 'simulate') return 380;
  if (step === 'handoff') return 610;
  if (step === 'teach') return 370;
  if (step === 'sources') return 300;
  if (step === 'notice') return 260;
  return 235;
}

function nodeId(caseId: CaseId, step: StoryStep): string {
  return `trio-${caseId}-${step}`;
}

function TrioCanvasNode({ data, selected }: NodeProps<TrioFlowNode>) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface || data.spotlight !== 'focused') return;
    let frame = 0;
    let targets: HTMLElement[] = [], details: HTMLElement[] = [];
    const clear = () => { targets.forEach(el => el.classList.remove('is-narrative-record')); details.forEach(el => el.classList.remove('is-narrative-detail')); };
    const apply = () => {
    clear();
    cancelAnimationFrame(frame);
    targets = data.cueRecord ? Array.from(surface.querySelectorAll<HTMLElement>('[data-narrative-record]'))
      .filter((element) => element.dataset.narrativeRecord === data.cueRecord && element.getClientRects().length > 0) : [];
    targets.forEach((element) => element.classList.add('is-narrative-record'));
    details = Array.from(surface.querySelectorAll<HTMLElement>(data.cueSelector || '.trio-card__body'))
      .filter((element) => element.getClientRects().length > 0);
    details.forEach((element) => element.classList.add('is-narrative-detail'));
    frame = requestAnimationFrame(() => {
      const scroller = surface.querySelector<HTMLElement>('.trio-stage__object') ?? surface;
      const target = details[0] ?? targets[0];
      if (!target) { scroller.scrollTo({ top: 0, behavior: 'auto' }); return; }
      const box = scroller.getBoundingClientRect();
      const targetBox = target.getBoundingClientRect();
      const scale = box.width / scroller.clientWidth || 1;
      // Reveal only clipped content. Always aligning a visible target cut the
      // presentation header in half and competed with the card's own scroller.
      const margin = 12;
      let top = scroller.scrollTop;
      if (targetBox.height > box.height - margin * 2 || targetBox.top < box.top + margin)
        top += (targetBox.top - box.top) / scale - margin;
      else if (targetBox.bottom > box.bottom - margin)
        top += (targetBox.bottom - box.bottom) / scale + margin;
      if (Math.abs(top - scroller.scrollTop) > 1) scroller.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
      // Horizontal lanes (music sections, narrow tables) need their own scroll;
      // moving the Canvas alone cannot reveal a clipped cell.
      for (let parent = target.parentElement; parent && parent !== surface; parent = parent.parentElement) {
        if (parent.scrollWidth <= parent.clientWidth + 1 || !/auto|scroll/.test(getComputedStyle(parent).overflowX)) continue;
        const parentBox = parent.getBoundingClientRect();
        const itemBox = target.getBoundingClientRect();
        const ratio = parentBox.width / parent.clientWidth || 1;
        if (itemBox.left < parentBox.left + 8 || itemBox.right > parentBox.right - 8)
          parent.scrollLeft += (itemBox.left - parentBox.left) / ratio - Math.max(8, (parent.clientWidth - itemBox.width / ratio) / 2);
      }
    });
    };
    apply();
    const observer = new MutationObserver(apply);
    observer.observe(surface, { childList: true, subtree: true });
    return () => { observer.disconnect(); cancelAnimationFrame(frame); clear(); }; 
  }, [data.spotlight, data.cueRecord, data.cueSelector, data.loading, data.stage.phase, data.stage.draftFields]);
  const { caseId } = data.stage.snapshot;
  const Icon = data.objectId === 'minimal'
    ? caseId === 'quest' ? Compass : caseId === 'music' ? Music2 : PackageOpen
    : data.objectId === 'notice' ? ArrowDownRight : STEP_ICON[data.objectId];
  const coalesceQuest = Boolean(caseId === 'quest' && data.stage.snapshot.active.quest.encounter);
  const current = data.stage.guided && canvasObjectForStep(caseId, data.stage.step, coalesceQuest) === data.objectId;

  return (
    <article
      className={`trio-canvas-node trio-canvas-node--${caseId}${selected ? ' is-selected' : ''}${current ? ' is-current' : ''}`}
      data-case={caseId}
      data-step={data.objectId}
      data-trio-object={data.objectId}
      data-current={String(current)}
      data-spotlight={data.spotlight}
      data-cue-record={data.cueRecord ?? undefined}
      data-arrange={String(data.interactionMode === 'arrange')}
      data-testid={`canvas-object-${data.objectId}`}
      aria-label={STEP_TITLES[caseId][data.objectId]}
    >
      {(['top', 'right', 'bottom', 'left'] as const).map((side) => {
        const position: Record<typeof side, FlowPosition> = {
          top: Position.Top,
          right: Position.Right,
          bottom: Position.Bottom,
          left: Position.Left,
        };
        return (
          <span key={`handles-${side}`}>
            <Handle id={`target-${side}`} type="target" position={position[side]} isConnectable={false} />
            <Handle id={`source-${side}`} type="source" position={position[side]} isConnectable={false} />
          </span>
        );
      })}
      <header className="trio-canvas-node__chrome">
        <span className="trio-canvas-node__icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="trio-canvas-node__heading">
          <small>{STEP_LABEL[data.objectId]}</small>
          <strong>{STEP_TITLES[caseId][data.objectId]}</strong>
        </span>
        <Grip className="trio-canvas-node__grip" size={15} aria-hidden="true" />
      </header>
      {data.spotlight === 'focused' && <div className="trio-narrative-caption"><span aria-hidden="true">↳</span><span><small>กำลังพูดถึง</small>{data.cueLabel}</span></div>}
      <div ref={surfaceRef} className="trio-canvas-node__surface nodrag nopan nowheel">
        <MaterializeSurface
          identity={nodeId(caseId,data.objectId)}
          pending={data.loading || (data.objectId === 'teach' && data.stage.guided && data.stage.step === 'teach' && data.stage.phase === 'building')}
          variant={data.objectId === 'minimal' || data.objectId === 'sources' ? caseId : 'generic'}
          label={STEP_HELP[data.objectId]}
            paused={data.stage.paused && data.stage.phase !== 'complete'}
        >
          <TrioObject {...data.stage} objectId={data.objectId}/>
        </MaterializeSurface>
      </div>
      {data.showContinue && <footer className="trio-canvas-node__action nodrag nopan nowheel">
        <button type="button" data-testid="trio-continue" disabled={data.continueDisabled} onClick={data.onContinue}>
          {data.continueLabel}<span aria-hidden="true">→</span>
        </button>
      </footer>}
    </article>
  );
}

export function useTrioCanvas(
  props: TrioCanvasProps | null,
  hostRef: RefObject<HTMLDivElement | null>,
): TrioCanvasBindings {
  const activePropsRef = useRef(props);
  activePropsRef.current = props;
  const [canvasWidth, setCanvasWidth] = useState(() => typeof window === 'undefined' ? 1024 : window.innerWidth);
  const [canvasHeight, setCanvasHeight] = useState(() => typeof window === 'undefined' ? 700 : window.innerHeight);
  const [nodes, setNodes] = useState<TrioFlowNode[]>([]);
  const nodesInitialized = useNodesInitialized();
  const flow = useReactFlow<TrioFlowNode, TrioFlowEdge>();
  const prefersReducedMotion = useMemo(
    () => typeof window !== 'undefined' && (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false),
    [],
  );
  const stageProps = useMemo<TrioCanvasStageProps | null>(() => props ? ({
    snapshot: props.snapshot,
    narrativeAnchor: props.narrativeAnchor,
    sourceCue: props.sourceCue,
    onSourceInspect: props.onSourceInspect,
    step: props.step,
    phase: props.phase,
    draftFields: props.draftFields,
    guided: props.guided,
    paused: props.paused,
    speed: props.speed,
    surfaceVisible: (props.lens ?? 'work') !== 'constellation',
    onDraftChange: props.onDraftChange,
    onSimulationChange: props.onSimulationChange,
    onVerify: props.onVerify,
    onApprove: props.onApprove,
    onHandoff: props.onHandoff,
    onContinue: props.onContinue,
    onFeedback: props.onFeedback,
    onInspect: props.onInspect,
    onEncounterRoundComplete: props.onEncounterRoundComplete,
  }) : null, [
    props?.snapshot, props?.sourceCue, props?.onSourceInspect, props?.narrativeAnchor, props?.step, props?.phase, props?.draftFields, props?.guided, props?.paused, props?.speed, props?.lens,
    props?.onDraftChange, props?.onSimulationChange, props?.onVerify, props?.onApprove,
    props?.onHandoff, props?.onContinue, props?.onFeedback, props?.onInspect, props?.onEncounterRoundComplete,
  ]);
  const visibleItems = useMemo(() => {
    if (!props) return [];
    const coalesceQuest = Boolean(props.snapshot.caseId === 'quest' && props.snapshot.active.quest.encounter);
    const objectSteps = coalesceQuest
      ? (['sources', 'minimal', 'handoff'] as const)
      : STEPS;
    return objectSteps.flatMap((objectId) => {
      const threshold = REQUIRED_LEVEL[objectId];
      const isBuildingCurrent = props.guided && props.phase === 'building'
        && canvasObjectForStep(props.snapshot.caseId, props.step, coalesceQuest) === objectId
        && props.snapshot.level < threshold;
      const isProgressiveDraft = objectId === 'teach' && props.guided && props.phase === 'building' && props.step === 'teach';
      if (props.snapshot.level >= threshold || isBuildingCurrent || isProgressiveDraft) {
        return [{ objectId, loading: isBuildingCurrent && !isProgressiveDraft }];
      }
      return [];
    });
  }, [props?.guided, props?.phase, props?.step, props?.snapshot.caseId, props?.snapshot.level, props?.snapshot.active.quest.encounter]);
  const visibleSignature = visibleItems.map(({ objectId, loading }) => `${objectId}:${loading}`).join('|');
  const savedLayout = props ? (props.snapshot as SnapshotWithCanvasLayout).layout : undefined;
  const coalesceQuest = Boolean(props?.snapshot.caseId === 'quest' && props.snapshot.active.quest.encounter);
  const cue = props ? narrativeFocus(props.snapshot.caseId, props.step, props.phase, props.snapshot.level, coalesceQuest) : null;
  const spotlightOn = Boolean(props?.guided && props.followCamera && props.interactionMode === 'use' && (props.lens ?? 'work') === 'work' && props.phase !== 'complete');
  const requestedStep = props ? props.focusStep ?? (props.sourceCue ? 'sources' : spotlightOn ? cue?.target : props.step) ?? props.step : 'sources';
  const preferredStep = props ? canvasObjectForStep(props.snapshot.caseId, requestedStep, coalesceQuest) : 'sources';
  const currentObjectStep = props ? canvasObjectForStep(props.snapshot.caseId, props.step, coalesceQuest) : 'sources';
  const targetStep: StoryStep = visibleItems.some(({ objectId }) => objectId === preferredStep)
    ? preferredStep
    : visibleItems.some(({ objectId }) => objectId === currentObjectStep)
      ? currentObjectStep
      : visibleItems[0]?.objectId ?? 'sources';
  const approvalReady = Boolean(props?.snapshot.evaluation
    && props.snapshot.evaluation.fingerprint === rulesFingerprint(props.snapshot.caseId, props.snapshot.draft)
    && !props.snapshot.approved
    && canApprove(props.snapshot.caseId, props.snapshot.draft, props.snapshot.evaluation));

  useEffect(() => {
    if (!props) return undefined;
    const element = hostRef.current;
    if (!element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setCanvasWidth(Math.max(1, Math.round(entry.contentRect.width)));
        setCanvasHeight(Math.max(1, Math.round(entry.contentRect.height)));
      }
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [Boolean(props), hostRef]);

  useEffect(() => {
    if (!props || !stageProps) return;
    const nextIds = new Set(visibleItems.map(({ objectId }) => nodeId(props.snapshot.caseId, objectId)));
    setNodes((previous) => {
      const previousById = new Map(previous.map((node) => [node.id, node]));
      const next = visibleItems.map(({ objectId, loading }) => {
        const id = nodeId(props.snapshot.caseId, objectId);
        const oldNode = previousById.get(id);
        const width = Math.max(260, Math.min(preferredWidth(props.snapshot.caseId, objectId), canvasWidth - 34));
        const data: TrioNodeData = {
          objectId,
          stage: stageProps,
          loading,
          interactionMode: props.interactionMode,
          showContinue: !props.guided && props.snapshot.level < 8 && objectId === targetStep,
          continueLabel: MANUAL_CONTINUE_LABELS[Math.min(props.snapshot.level, 7)],
          continueDisabled: props.snapshot.level === 5 && !approvalReady,
          onContinue: props.onContinue,
          spotlight: spotlightOn ? objectId === targetStep ? 'focused' : 'dimmed' : 'off',
          cueLabel: props.sourceCue && targetStep === 'sources' ? ({locate:'อ่านหลักฐานที่จุดนี้',understand:'สิ่งที่เข้าใจจากหลักฐาน',connect:'นำไปสร้างอะไรต่อ'}[props.sourceCue.beat]) : props.focusStep ? STEP_TITLES[props.snapshot.caseId][targetStep]
            : targetStep === 'sources' && props.step === 'minimal' && props.narrativeAnchor
              ? `ข้อมูลต้นทาง · ${props.narrativeAnchor}` : cue?.label ?? '',
          cueRecord: spotlightOn && !props.focusStep && objectId === targetStep ? cue?.record ?? null : null,
          cueSelector: props.sourceCue && objectId === 'sources' ? '[data-testid=source-evidence]' : props.focusStep ? '' : narrativeSelector(props.snapshot.caseId, props.step, targetStep, props.narrativeAnchor ?? '', coalesceQuest),
        };
        return {
          id,
          type: 'trioStory',
          data,
          position: oldNode?.position ?? savedLayout?.[objectId] ?? POSITIONS[props.snapshot.caseId][objectId],
          measured: oldNode?.measured,
          draggable: props.interactionMode === 'arrange',
          connectable: false,
          selectable: props.interactionMode === 'arrange',
          dragHandle: '.trio-canvas-node__chrome',
          style: { width, height: 'auto', pointerEvents: 'all' },
          zIndex: objectId === targetStep ? 2 : 1,
        } satisfies TrioFlowNode;
      });
      return next.filter((node) => nextIds.has(node.id));
    });
  }, [
    props?.snapshot, props?.interactionMode, props?.guided, props?.snapshot.level, props?.onContinue,
    stageProps, visibleItems, savedLayout, canvasWidth, targetStep, approvalReady, spotlightOn, cue?.label, cue?.record, props?.focusStep,
  ]);

  const targetId = props && visibleItems.some(({ objectId }) => objectId === targetStep)
    ? nodeId(props.snapshot.caseId, targetStep)
    : null;
  const hasVisibleTarget = targetId !== null;
  const targetNodeState = targetId ? nodes.find((node) => node.id === targetId) : undefined;
  const targetMeasurement = targetNodeState?.measured;
  const targetMeasuredWidth = targetMeasurement?.width ?? 0;
  const targetMeasuredHeight = targetMeasurement?.height ?? 0;
  const targetMeasureKey = `${targetMeasuredWidth}x${targetMeasuredHeight}`;

  const edges = useMemo<TrioFlowEdge[]>(() => {
    if (!props || !props.dependencies || nodes.length < 2) return [];
    const eventById = new Map(props.snapshot.events.map((event) => [event.id, event]));
    const nodeIds = new Set(nodes.map((node) => node.id));
    const seen = new Set<string>();
    const links: RoutingLink[] = [];
    const sourceNode = nodeId(props.snapshot.caseId, 'sources');
    const createdNode = nodeId(props.snapshot.caseId, 'minimal');
    if (nodeIds.has(sourceNode) && nodeIds.has(createdNode)) {
      const id = `${sourceNode}->${createdNode}`;
      seen.add(id);
      links.push({ id, source: sourceNode, target: createdNode, label: 'ใช้สร้าง' });
    }
    for (const citingEvent of props.snapshot.events) {
      const targetStep = canvasObjectForEvent(props.snapshot.caseId, citingEvent.kind, coalesceQuest);
      const target = nodeId(props.snapshot.caseId, targetStep);
      if (!nodeIds.has(target)) continue;
      for (const referenceId of citingEvent.references) {
        const referencedEvent = eventById.get(referenceId);
        if (!referencedEvent) continue;
        const sourceStep = canvasObjectForEvent(props.snapshot.caseId, referencedEvent.kind, coalesceQuest);
        if (sourceStep === targetStep) continue;
        const source = nodeId(props.snapshot.caseId, sourceStep);
        if (!nodeIds.has(source)) continue;
        const pairKey = `${source}->${target}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);
        links.push({ id: pairKey, source, target, label: 'อ้างอิง' });
      }
    }
    if (links.length === 0) return [];

    const rects: RoutingRect[] = nodes.map((node) => ({
      id: node.id,
      x: node.position.x,
      y: node.position.y,
      width: node.measured?.width ?? preferredWidth(props.snapshot.caseId, node.data.objectId),
      height: node.measured?.height ?? fallbackHeight(props.snapshot.caseId, node.data.objectId),
    }));
    return routeConnections(rects, links, { clearance: 30, cornerRadius: 10 }).map((route: RoutedConnection) => ({
      id: `${props.snapshot.caseId}-${route.id}`,
      source: route.source,
      target: route.target,
      sourceHandle: route.sourceHandleId ?? undefined,
      targetHandle: route.targetHandleId ?? undefined,
      type: 'canvasConnection',
      data: {
        route,
        active: route.source === targetId || route.target === targetId,
        dimmed: (spotlightOn || props.lens === 'learn') && route.source !== targetId && route.target !== targetId,
        moving: false,
      },
    }));
  }, [props?.dependencies, props?.snapshot.caseId, props?.snapshot.events, props?.lens, nodes, targetId, spotlightOn]);

  useEffect(() => {
    if (!props || !props.followCamera || !nodesInitialized || !targetId || targetMeasuredWidth <= 0 || targetMeasuredHeight <= 0) return undefined;
    let frame = 0;
    frame = window.requestAnimationFrame(() => {
      const targetNode = flow.getNode(targetId);
      if (!targetNode) return;
      const targetWidth = targetNode.measured?.width ?? targetMeasuredWidth;
      const targetHeight = targetNode.measured?.height ?? targetMeasuredHeight;

      // On narrow screens, keep the active object at readable scale and let its
      // own content region scroll. Waiting for measured dimensions avoids
      // fitting the fallback height before the real card has settled.
      if (canvasWidth <= 760) {
        const zoom = Math.max(0.84, Math.min(0.98, (canvasWidth - 28) / targetWidth, (canvasHeight - 24) / targetHeight));
        const centerX = targetNode.position.x + targetWidth / 2 - Math.min(22, canvasWidth * 0.06) / zoom;
        const centerY = targetNode.position.y + targetHeight / 2;
        void flow.setCenter(centerX, centerY, { zoom, duration: prefersReducedMotion ? 0 : 260 });
        return;
      }

      const targetIndex = STEPS.indexOf(targetStep);
      const neighborCandidates = [STEPS[targetIndex - 1], STEPS[targetIndex + 1]]
        .filter((candidate): candidate is StoryStep => candidate !== undefined)
        .map((candidate) => flow.getNode(nodeId(props.snapshot.caseId, candidate)))
        .filter((candidate): candidate is TrioFlowNode => Boolean(candidate?.measured?.width && candidate.measured.height));
      let focusNodes = [targetId];
      if (neighborCandidates.length > 0) {
        const targetCenter = { x: targetNode.position.x + targetWidth / 2, y: targetNode.position.y + targetHeight / 2 };
        const nearest = neighborCandidates.sort((left, right) => {
          const leftWidth = left.measured?.width ?? preferredWidth(props.snapshot.caseId, left.data.objectId);
          const leftHeight = left.measured?.height ?? fallbackHeight(props.snapshot.caseId, left.data.objectId);
          const rightWidth = right.measured?.width ?? preferredWidth(props.snapshot.caseId, right.data.objectId);
          const rightHeight = right.measured?.height ?? fallbackHeight(props.snapshot.caseId, right.data.objectId);
          const leftDistance = Math.hypot(left.position.x + leftWidth / 2 - targetCenter.x, left.position.y + leftHeight / 2 - targetCenter.y);
          const rightDistance = Math.hypot(right.position.x + rightWidth / 2 - targetCenter.x, right.position.y + rightHeight / 2 - targetCenter.y);
          return leftDistance - rightDistance;
        })[0];
        if (nearest?.measured) {
          const neighborWidth = nearest.measured.width ?? preferredWidth(props.snapshot.caseId, nearest.data.objectId);
          const neighborHeight = nearest.measured.height ?? fallbackHeight(props.snapshot.caseId, nearest.data.objectId);
          const left = Math.min(targetNode.position.x, nearest.position.x);
          const top = Math.min(targetNode.position.y, nearest.position.y);
          const right = Math.max(targetNode.position.x + targetWidth, nearest.position.x + neighborWidth);
          const bottom = Math.max(targetNode.position.y + targetHeight, nearest.position.y + neighborHeight);
          if (right - left <= canvasWidth * 0.72 && bottom - top <= canvasHeight * 0.7) {
            focusNodes = [targetId, nearest.id];
          }
        }
      }
      if (focusNodes.length > 1) {
        void flow.fitView({
          nodes: focusNodes.map((id) => ({ id })),
          duration: prefersReducedMotion ? 0 : 260,
          maxZoom: 0.98,
          minZoom: 0.62,
          padding: 0.1,
        });
      } else {
        const zoom = Math.max(0.84, Math.min(0.98, (canvasWidth - 32) / targetWidth, (canvasHeight - 28) / targetHeight));
        void flow.setCenter(targetNode.position.x + targetWidth / 2, targetNode.position.y + targetHeight / 2, {
          zoom,
          duration: prefersReducedMotion ? 0 : 260,
        });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    props?.followCamera, props?.snapshot.caseId, props?.snapshot.level, props?.phase, props?.draftFields,
    nodesInitialized, targetId, targetStep, canvasWidth, canvasHeight, visibleSignature,
    targetMeasuredWidth, targetMeasuredHeight, targetMeasureKey, focusVersionKey(props), flow, prefersReducedMotion,
  ]);

  const onNodesChange = useCallback<NonNullable<TrioFlowProps['onNodesChange']>>((changes: NodeChange<TrioFlowNode>[]) => {
    if (!activePropsRef.current) return;
    setNodes((current) => applyNodeChanges(changes, current) as TrioFlowNode[]);
  }, []);
  const onMoveStart = useCallback((event: MouseEvent | TouchEvent | null) => {
    const active = activePropsRef.current;
    if (active && event !== null) active.onManualPan();
  }, []);
  const onMoveEnd = useCallback((_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
    activePropsRef.current?.onViewportChange?.(viewport.zoom);
  }, []);
  const onNodeDragStart = useCallback(() => activePropsRef.current?.onManualPan(), []);
  const onNodeDragStop = useCallback((
    _event: MouseEvent | TouchEvent,
    _node: TrioFlowNode,
    nextNodes: TrioFlowNode[],
  ) => {
    const active = activePropsRef.current;
    if (!active || active.interactionMode !== 'arrange' || !active.onLayoutChange) return;
    const layout = nextNodes.reduce<TrioCanvasLayout>((current, node) => {
      current[node.data.objectId] = { x: node.position.x, y: node.position.y };
      return current;
    }, {});
    active.onLayoutChange(layout);
  }, []);

  if (!props) return {};

  const panel = !props.guided && props.snapshot.level < 8 && !hasVisibleTarget ? (
    <Panel position="bottom-center" className="trio-canvas__manual-step nodrag nopan nowheel">
      <button
        type="button"
        data-testid="trio-continue"
        disabled={props.snapshot.level === 5 && !approvalReady}
        onClick={props.onContinue}
      >
        {MANUAL_CONTINUE_LABELS[Math.min(props.snapshot.level, 7)]}
        <span aria-hidden="true">→</span>
      </button>
    </Panel>
  ) : null;

  return {
    nodes,
    edges,
    onNodesChange,
    onMoveStart,
    onMoveEnd,
    onNodeDragStart,
    onNodeDragStop,
    nodesDraggable: props.interactionMode === 'arrange',
    nodesConnectable: false,
    elementsSelectable: props.interactionMode === 'arrange',
    panOnDrag: props.hand || props.interactionMode === 'use',
    panOnScroll: false,
    snapToGrid: props.snap,
    snapGrid: [24, 24],
    minZoom: 0.24,
    maxZoom: 1.8,
    proOptions: { hideAttribution: true },
    className: `trio-canvas__flow trio-canvas__flow--${props.snapshot.caseId}${props.hand || props.interactionMode === 'use' ? ' is-pan-enabled' : ''}`,
    children: panel,
    canvasProps: {
      className: 'trio-canvas',
      'data-case': props.snapshot.caseId,
      'data-level': props.snapshot.level,
      'data-step': props.step,
      'data-version': props.snapshot.version,
      'data-guided': String(props.guided),
      'data-lens': props.lens ?? 'work',
      'data-testid': 'trio-stage',
      'aria-label': `พื้นที่ทำงาน · ${STEP_TITLES[props.snapshot.caseId][props.step]}`,
      style: { '--trio-canvas-height': `${canvasHeight}px` } as CSSProperties,
    },
  };
}

function focusVersionKey(props: TrioCanvasProps | null): number {
  if (!props) return 0;
  return (props.focusVersion ?? 0) + props.snapshot.level * 1000 + props.draftFields * 10 + props.snapshot.version;
}

export default function TrioCanvas(props: TrioCanvasProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const bindings = useTrioCanvas(props, hostRef);
  const { canvasProps, children, ...flowProps } = bindings;
  return (
    <div ref={hostRef} {...canvasProps}>
      <ReactFlow {...flowProps} nodeTypes={trioNodeTypes} edgeTypes={trioEdgeTypes}>
        <Background variant={BackgroundVariant.Dots} color="#dfe2e6" gap={24} size={1} />
        {children}
      </ReactFlow>
    </div>
  );
}
