import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  GitBranch,
  History,
  List,
  Network,
  Search,
} from 'lucide-react';
import {
  Background,
  BackgroundVariant,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type NodeProps,
  useReactFlow,
} from '@xyflow/react';
import {
  deriveKnowledge,
  type KnowledgeCategory,
  type KnowledgeGraph,
  type KnowledgeLink,
  type KnowledgeNode,
} from '../domain/knowledge';
import { useWorkspace } from '../state/store';
import type { Workspace } from '../state/types';
import {routeConnections} from '../state/edge-routing';
import CanvasEdge from './CanvasEdge';
import './constellation.css';

type ViewMode = 'story' | 'map' | 'list';
type StarData = { star: KnowledgeNode; select: (id: string) => void };
type StarNode = Node<StarData, 'knowledgeStar'>;
type TeachingProofStep = {
  order: number;
  title: string;
  record: string;
  summary: string;
  status: string;
  statusClass: string;
  details: string[];
  evidenceRefs: string[];
};
type TeachingProof = { steps: TeachingProofStep[] };

const categories: Record<KnowledgeCategory, string> = {
  question: 'Questions',
  source: 'Evidence',
  worker: 'Capabilities',
  rule: 'Rules',
  person: 'Contributors',
  exception: 'Exceptions',
  test: 'Tests',
  outcome: 'Outcomes',
};
const EMPTY_GRAPH: KnowledgeGraph = { nodes: [], links: [] };
const MAP_NEIGHBOR_LIMIT = 3;

const relationLabels: Record<KnowledgeLink['relation'], string> = {
  derived_from: 'derived from',
  produced_by: 'produced by',
  corrected_by: 'corrected by',
  approved_by: 'approved by',
  tested_by: 'tested by',
  supersedes: 'supersedes',
  depends_on: 'depends on',
  used_by: 'used by',
  handed_off_to: 'handed off to',
  references: 'references',
};

function nodeTitle(node: KnowledgeNode): string {
  if (!node.id.startsWith('proposal:')) return node.title;
  return `${node.status === 'approved' ? 'Approved' : 'Proposed'} teaching · v${node.ruleVersion}`;
}

function statusLabel(status: KnowledgeNode['status']): string {
  return status.replaceAll('-', ' ');
}

function money(value: number): string {
  return `฿${value.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
}

function uniqueRefs(values: Array<string | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => value !== undefined && value !== '')));
}

function deriveTeachingProof(workspace: Workspace, graph: KnowledgeGraph): TeachingProof | null {
  if (workspace.domain !== 'accounting') return null;

  const proposal = [...workspace.proposals].reverse().find((candidate) => candidate.status === 'approved');
  const evaluation = proposal?.evaluation;
  if (proposal === undefined || evaluation === undefined || proposal.candidate.version !== workspace.policy.version) return null;
  const passedCases = evaluation.cases.filter((testCase) => testCase.passed).length;
  const failedCases = evaluation.cases.length - passedCases;
  if (evaluation.cases.length === 0
    || evaluation.failed !== failedCases
    || evaluation.passed !== passedCases
    || failedCases !== 0
    || passedCases === 0) return null;

  const proposalEvent = [...workspace.events].reverse().find((event) =>
    event.workerType === 'human' && event.humanAction === 'propose' && event.outputs.includes(proposal.id),
  );
  const evaluationEvent = [...workspace.events].reverse().find((event) =>
    event.workerType === 'deterministic'
      && event.workerId === 'policy-evaluator'
      && event.inputs.includes(proposal.id)
      && event.outputs.includes(`evaluation:${proposal.id}`),
  );
  const expectedEvaluationDetail = `${evaluation.passed} passed; ${evaluation.failed} failed;`;
  const approvalEvent = [...workspace.events].reverse().find((event) =>
    event.workerType === 'human'
      && event.humanAction === 'approve'
      && event.outputs.includes(`policy-v${proposal.candidate.version}`)
      && (event.approvalRef === proposal.approvalRef || event.inputs.includes(proposal.id)),
  );
  if (proposalEvent === undefined
    || evaluationEvent === undefined
    || evaluationEvent.status !== 'completed'
    || !evaluationEvent.detail.includes(expectedEvaluationDetail)
    || approvalEvent === undefined) return null;

  const activeRun = [...workspace.runs].reverse().find((run) =>
    run.dataset.id === workspace.dataset.id && run.policy.version === proposal.candidate.version,
  );
  if (activeRun === undefined) return null;
  const matchingAssets = activeRun.dataset.assets.filter((asset) => asset.assetId === 'FA-001');
  if (matchingAssets.length !== 1) return null;
  const asset = matchingAssets[0];
  const matchingRows = activeRun.result.rows.filter((row) =>
    row.asset.rowId === asset.rowId && row.ruleVersion === proposal.candidate.version,
  );
  if (matchingRows.length !== 1) return null;
  const result = matchingRows[0];

  const questionNode = graph.nodes.find((node) => node.id === 'question:workspace');
  const proposalNode = graph.nodes.find((node) => node.id === `proposal:${proposal.id}`);
  const testNode = graph.nodes.find((node) => node.id === `test:${proposal.id}`);
  const policyNode = graph.nodes.find((node) => node.id === `policy:${proposal.candidate.version}`);
  const outcomeNode = graph.nodes.find((node) =>
    node.category === 'outcome'
      && node.datasetId === activeRun.dataset.id
      && node.runId === activeRun.id
      && node.ruleVersion === proposal.candidate.version,
  );
  if (questionNode === undefined
    || proposalNode?.status !== 'approved'
    || testNode?.status !== 'approved'
    || policyNode?.status !== 'approved'
    || outcomeNode === undefined) return null;

  const questionSummary = workspace.prompt.trim() || 'No separate workspace question is recorded.';
  const laptopRule = `Laptop · ${money(proposal.candidate.laptop.threshold)} threshold · ${proposal.candidate.laptop.usefulLifeMonths} months · ${proposal.candidate.laptop.start}`;
  const caseDetails = evaluation.cases.slice(0, 3).map((testCase) =>
    `${testCase.passed ? 'Passed' : 'Failed'} · ${testCase.title}`,
  );
  const rowStatus = result.status === 'matched' ? 'Matched' : 'Needs review';

  return {
    steps: [
      {
        order: 1,
        title: 'คำถามและคำสั่ง',
        record: questionNode.title,
        summary: questionSummary,
        status: 'บันทึกแล้ว',
        statusClass: 'status-active',
        details: [`คำสั่งที่บันทึกไว้: ${proposal.instruction}`],
        evidenceRefs: uniqueRefs(['workspace.prompt', proposal.id, proposalEvent.id]),
      },
      {
        order: 2,
        title: 'กฎที่เสนอ',
        record: proposalNode.title,
        summary: proposalNode.summary,
        status: `Policy v${proposal.candidate.version}`,
        statusClass: 'status-pending',
        details: [laptopRule],
        evidenceRefs: proposalNode.evidenceRefs,
      },
      {
        order: 3,
        title: 'ผลทดสอบจริง',
        record: testNode.title,
        summary: `ผ่าน ${evaluation.passed} · ไม่ผ่าน ${evaluation.failed} · ผลคำนวณที่เปลี่ยน ${evaluation.impacts.length}`,
        status: 'ผ่านทั้งหมด',
        statusClass: 'status-approved',
        details: caseDetails,
        evidenceRefs: uniqueRefs([...testNode.evidenceRefs, evaluationEvent.id]),
      },
      {
        order: 4,
        title: 'กฎที่อนุมัติ',
        record: policyNode.title,
        summary: `Active policy v${workspace.policy.version} is in effect.`,
        status: `Approved · v${proposal.candidate.version}`,
        statusClass: 'status-approved',
        details: [laptopRule, `Recorded approval · ${approvalEvent.title}`],
        evidenceRefs: uniqueRefs([...policyNode.evidenceRefs, approvalEvent.id]),
      },
      {
        order: 5,
        title: 'ผลจริงของ FA-001',
        record: `${asset.assetId} · ${asset.description}`,
        summary: `คำนวณ ${money(result.calculated)} · บันทึกต้นทาง ${money(result.recorded)} · GL ${result.ledgerAmount === null ? 'ไม่มีรายการ' : money(result.ledgerAmount)}`,
        status: rowStatus,
        statusClass: result.status === 'matched' ? 'status-approved' : 'status-pending',
        details: [
          `Dataset ${activeRun.dataset.id} · ${activeRun.dataset.period} · Policy v${result.ruleVersion}`,
          ...result.findings.slice(0, 2).map((finding) => finding.message),
        ],
        evidenceRefs: uniqueRefs([
          ...outcomeNode.evidenceRefs,
          activeRun.id,
          activeRun.dataset.id,
          asset.rowId,
          `policy-v${result.ruleVersion}`,
        ]),
      },
    ],
  };
}

function Star({ data, selected }: NodeProps<StarNode>) {
  const star = data.star;
  return (
    <>
      {(['top','right','bottom','left'] as const).flatMap(side=>{
        const position={top:Position.Top,right:Position.Right,bottom:Position.Bottom,left:Position.Left}[side];
        return [<Handle key={`target-${side}`} id={`target-${side}`} type="target" position={position} isConnectable={false}/>,<Handle key={`source-${side}`} id={`source-${side}`} type="source" position={position} isConnectable={false}/>];
      })}
      <button
        className={`knowledge-star kind-${star.category} state-${star.status} ${selected ? 'selected' : ''}`}
        onClick={() => data.select(star.id)}
        aria-label={`Inspect ${nodeTitle(star)}`}
        data-testid={`star-${star.id}`}
      >
        <span className="knowledge-star__meta">
          <i aria-hidden="true" />
          <span>{categories[star.category]}</span>
          <span className={`star-state state-label-${star.status}`}>{statusLabel(star.status)}</span>
        </span>
        <strong title={nodeTitle(star)}>{nodeTitle(star)}</strong>
        <small>{star.summary}</small>
      </button>
    </>
  );
}

const nodeTypes = { knowledgeStar: Star };
const edgeTypes = {canvasConnection:CanvasEdge};

export default function KnowledgeConstellation(props: {
  workspace?: Workspace;
  graph?: KnowledgeGraph;
  initialWorkObject?: string | null;
  initialNodeId?: string;
  onNavigate: (node: KnowledgeNode) => void;
  onExplain: () => void;
}) {
  return (
    <ReactFlowProvider>
      <Constellation {...props} />
    </ReactFlowProvider>
  );
}

function Constellation({
  workspace,
  graph: suppliedGraph,
  initialWorkObject,
  initialNodeId,
  onNavigate,
  onExplain,
}: {
  workspace?: Workspace;
  graph?: KnowledgeGraph;
  initialWorkObject?: string | null;
  initialNodeId?: string;
  onNavigate: (node: KnowledgeNode) => void;
  onExplain: () => void;
}) {
  const demoActive = useWorkspace((store) => store.demoActive);
  const [history, setHistory] = useState(false);
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<ViewMode>('story');
  const [showAllLinks, setShowAllLinks] = useState(false);
  const [exploreAllGraph, setExploreAllGraph] = useState(false);
  const graph = useMemo(
    () => suppliedGraph ?? (workspace === undefined ? EMPTY_GRAPH : deriveKnowledge(workspace, history)),
    [suppliedGraph, workspace, history],
  );
  const proofGraph = useMemo(
    () => suppliedGraph === undefined && demoActive && workspace?.domain === 'accounting' && workspace !== undefined
      ? deriveKnowledge(workspace, true)
      : null,
    [demoActive, suppliedGraph, workspace],
  );
  const teachingProof = useMemo(
    () => proofGraph === null || workspace === undefined ? null : deriveTeachingProof(workspace, proofGraph),
    [proofGraph, workspace],
  );
  const graphProvided = suppliedGraph !== undefined;
  const showGuidedProof = !graphProvided && demoActive && teachingProof !== null && !exploreAllGraph;
  const currentDatasetOutcome = !graphProvided && workspace !== undefined ? graph.nodes.find((node) =>
    node.category === 'outcome' && node.datasetId === workspace.dataset.id,
  ) : undefined;
  const defaultSelection = graph.nodes.find((node) => node.id === initialNodeId)
    ?? graph.nodes.find((node) => node.workObjectId === initialWorkObject)
    ?? currentDatasetOutcome
    ?? graph.nodes.find((node) => node.category === 'rule' && node.id.startsWith('policy:'))
    ?? graph.nodes[0];
  const [selected, setSelected] = useState<string | null>(() => defaultSelection?.id ?? null);
  const current = graph.nodes.find((node) => node.id === selected) ?? defaultSelection;
  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const flow = useReactFlow();
  const mapFlowRef = useRef<HTMLDivElement | null>(null);
  const prefersReducedMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    [],
  );

  useEffect(() => {
    if (selected === null || graph.nodes.some((node) => node.id === selected)) return;
    setSelected(defaultSelection?.id ?? null);
  }, [defaultSelection?.id, graph.nodes, selected]);

  const matches = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return graph.nodes.filter((node) => normalizedQuery === '' ||
      `${node.title} ${node.summary} ${node.detail.join(' ')} ${node.evidenceRefs.join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery));
  }, [graph.nodes, query]);
  const focusedLinks = useMemo(() => current === undefined ? [] : graph.links.filter((link) =>
    link.fromId === current.id || link.toId === current.id,
  ), [current, graph.links]);
  const displayedLinks = showAllLinks ? graph.links : focusedLinks;
  const relationships = displayedLinks.flatMap((link) => {
    const from = nodeById.get(link.fromId);
    const to = nodeById.get(link.toId);
    return from === undefined || to === undefined ? [] : [{ link, from, to }];
  });
  const connectedNodes = useMemo(() => {
    if (current === undefined) return [];
    const connectedIds = new Set<string>();
    for (const link of focusedLinks) {
      connectedIds.add(link.fromId === current.id ? link.toId : link.fromId);
    }
    return graph.nodes.filter((node) => connectedIds.has(node.id));
  }, [current, focusedLinks, graph.nodes]);
  const mapNodes = useMemo(() => {
    if (current === undefined) return [];
    const cards = [current, ...connectedNodes.slice(0, MAP_NEIGHBOR_LIMIT)];
    return cards.map((star, index): StarNode => {
      const neighborIndex = index - 1;
      const position = index === 0
        ? { x: 230, y: 0 }
        : {
          x: (neighborIndex % 3) * 235,
          y: 190 + Math.floor(neighborIndex / 3) * 190,
        };
      return {
        id: star.id,
        type: 'knowledgeStar',
        position,
        data: { star, select },
        selected: star.id === current.id,
        draggable: false,
        connectable: false,
        style: { width: 215, height: 145 },
      };
    });
  }, [connectedNodes, current]);
  const mapNodeIds = useMemo(() => new Set(mapNodes.map((node) => node.id)), [mapNodes]);
  const mapEdges = useMemo(() => {
    const links=focusedLinks.filter(link=>mapNodeIds.has(link.fromId)&&mapNodeIds.has(link.toId)).map(link=>({id:link.id,source:link.fromId,target:link.toId,label:relationLabels[link.relation]}));
    const rects=mapNodes.map(node=>({id:node.id,x:node.position.x,y:node.position.y,width:215,height:145}));
    return routeConnections(rects,links).map(route=>({...route,type:'canvasConnection',sourceHandle:route.sourceHandleId,targetHandle:route.targetHandleId,data:{route,active:route.source===current.id||route.target===current.id,dimmed:false,moving:false}}));
  }, [focusedLinks, mapNodeIds,mapNodes,current.id]);

  useEffect(() => {
    const container = mapFlowRef.current;
    if (mode !== 'map' || mapNodes.length === 0 || container === null) return undefined;

    let frame = 0;
    const fitNeighborhood = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        void flow.fitView({
          nodes: mapNodes.map((node) => ({ id: node.id })),
          duration: prefersReducedMotion ? 0 : 180,
          maxZoom: 1,
          minZoom: 0.62,
          padding: 0.1,
        });
      });
    };
    const resizeObserver = new ResizeObserver(fitNeighborhood);
    resizeObserver.observe(container);
    fitNeighborhood();
    return () => {
      resizeObserver.disconnect();
      window.cancelAnimationFrame(frame);
    };
  }, [flow, mapNodes, mode, prefersReducedMotion]);

  function select(id: string) {
    setSelected(id);
    setShowAllLinks(false);
  }

  function selectCategory(category: KnowledgeCategory) {
    const node = graph.nodes.find((item) => item.category === category);
    if (node !== undefined) {
      select(node.id);
      setMode('story');
    }
  }

  function showHistory() {
    if (graphProvided) return;
    setHistory((value) => !value);
    setShowAllLinks(false);
  }

  const canSearch = query.trim().length > 0;

  return (
    <section className={`constellation ${showGuidedProof ? 'is-guided-proof' : ''}`} aria-label="Knowledge Constellation" data-testid="knowledge-constellation">
      {showGuidedProof && teachingProof !== null ? (
        <main className="constellation-guided-proof" data-testid="guided-knowledge-path" aria-label="Recorded teaching proof">
          <div className="guided-proof__inner">
            <header className="guided-proof__header">
              <div>
                <span className="constellation-eyebrow">สิ่งที่บันทึกไว้ · เรียงตามเวลา</span>
                <h1>จากคำสั่งสู่ผลจริง</h1>
                <p>ลำดับนี้สรุปหลักฐานตามเหตุการณ์ ไม่ได้หมายความว่าทุกขั้นเป็นเส้นเชื่อมตรงในกราฟ</p>
              </div>
              <button
                className="constellation-world-action"
                data-testid="explore-knowledge-graph"
                onClick={() => setExploreAllGraph(true)}
              >
                <Network size={15} aria-hidden="true" /> สำรวจความสัมพันธ์ทั้งหมด
              </button>
            </header>
            <ol className="guided-proof__steps" aria-label="สิ่งที่บันทึกไว้เรียงตามเวลา">
              {teachingProof.steps.map((step) => (
                <li className="guided-proof__step" key={step.order} data-testid="guided-knowledge-step" data-step={step.order}>
                  <span className="guided-proof__number" aria-hidden="true">{step.order}</span>
                  <div className="guided-proof__content">
                    <div className="guided-proof__meta">
                      <span className="guided-proof__record">{step.record}</span>
                      <span className={`knowledge-status ${step.statusClass}`}>{step.status}</span>
                    </div>
                    <h2>{step.title}</h2>
                    <p className="guided-proof__summary">{step.summary}</p>
                    {step.details.length > 0 && (
                      <ul className="guided-proof__details">
                        {step.details.map((detail, index) => <li key={`${step.order}-${index}`}>{detail}</li>)}
                      </ul>
                    )}
                    <div className="guided-proof__evidence" aria-label={`Evidence references for step ${step.order}`}>
                      <span>หลักฐาน</span>
                      {step.evidenceRefs.map((reference) => <code key={reference}>{reference}</code>)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </main>
      ) : (
        <>
      <aside className="constellation-explore">
        <div className="constellation-explore__heading">
          <div>
            <span className="constellation-eyebrow">SAME WORKSPACE · ANOTHER LENS</span>
            <h1>Knowledge Constellation</h1>
            <p>Follow recorded evidence and relationships in this workspace.</p>
          </div>
          <label className="constellation-search">
            <Search size={16} aria-hidden="true" />
            <input
              aria-label="Search knowledge"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Rules, sources, decisions…"
            />
          </label>
        </div>
        {demoActive && teachingProof !== null && exploreAllGraph && (
          <button className="constellation-back-to-proof" onClick={() => setExploreAllGraph(false)}>
            <BookOpen size={14} aria-hidden="true" /> กลับสู่เส้นทางหลักฐาน
          </button>
        )}
        <div className="constellation-explore__tools">
          <nav className="constellation-categories" aria-label="Browse by category">
            {Object.entries(categories).map(([key, label]) => {
              const category = key as KnowledgeCategory;
              const count = graph.nodes.filter((node) => node.category === category).length;
              return (
                <button
                  key={key}
                  className={`legend-${key}`}
                  onClick={() => selectCategory(category)}
                  disabled={count === 0}
                  aria-label={`${label}, ${count} records`}
                  title={label}
                >
                  <i aria-hidden="true" />
                  <span>{label}</span>
                  <small>{count}</small>
                </button>
              );
            })}
          </nav>
          <div className="constellation-view-controls" aria-label="Knowledge views">
            <button onClick={() => setMode('story')} aria-pressed={mode === 'story'}>
              <GitBranch size={15} aria-hidden="true" /> Relationships
            </button>
            <button onClick={() => setMode('map')} aria-pressed={mode === 'map'}>
              <Network size={15} aria-hidden="true" /> Map view
            </button>
            <button onClick={() => setMode('list')} aria-pressed={mode === 'list'}>
              <List size={15} aria-hidden="true" /> Readable list
            </button>
            {!graphProvided && <button onClick={showHistory} aria-pressed={history}>
              <History size={15} aria-hidden="true" /> {history ? 'Current story' : 'Include history'}
            </button>}
          </div>
        </div>
        <small className="constellation-note">
          ความสัมพันธ์แสดงตามหลักฐานที่บันทึกไว้ ไม่มีการเพิ่มลำดับหรือความเชื่อมั่นเอง
        </small>
      </aside>

      <main className={`constellation-world mode-${mode}`}>
        {mode === 'story' && (
          <div className="knowledge-story" aria-label={showAllLinks ? 'All recorded links view' : 'Recorded relationships'}>
            <header className="knowledge-story__header">
              <div>
                <span className="constellation-eyebrow">{history ? 'CURRENT + SAVED HISTORY' : 'CURRENT WORKSPACE'}</span>
                <h2>{showAllLinks ? 'All recorded links' : 'Evidence relationships'}</h2>
                <p>
                  {showAllLinks
                    ? `${relationships.length} recorded links across the visible workspace records.`
                    : 'Start with one record, then follow only the relationships recorded for it.'}
                </p>
              </div>
              <button
                className="constellation-world-action"
                onClick={() => setShowAllLinks((value) => !value)}
                aria-pressed={showAllLinks}
              >
                <GitBranch size={15} aria-hidden="true" />
                {showAllLinks ? 'Focus relationships' : 'Show all recorded links'}
              </button>
            </header>

            {current !== undefined && (
              <article className={`knowledge-focus kind-${current.category}`}>
                <div className="knowledge-focus__meta">
                  <span className="knowledge-category"><i aria-hidden="true" />{categories[current.category]}</span>
                  <span className={`knowledge-status status-${current.status}`}>{statusLabel(current.status)}</span>
                  {current.ruleVersion !== undefined && <span className="knowledge-version">Policy v{current.ruleVersion}</span>}
                </div>
                <h3>{nodeTitle(current)}</h3>
                <p>{current.summary}</p>
              </article>
            )}

            {canSearch && (
              <section className="knowledge-search-results" aria-label="Matching knowledge records">
                <h3>{matches.length} matching records</h3>
                {matches.map((node) => (
                  <button key={node.id} onClick={() => select(node.id)} className={node.id === current?.id ? 'selected' : ''}>
                    <span>{categories[node.category]} · {statusLabel(node.status)}</span>
                    <strong>{nodeTitle(node)}</strong>
                  </button>
                ))}
              </section>
            )}

            <section className="knowledge-relationships" aria-label={showAllLinks ? 'All recorded links' : 'Relationships for selected record'}>
              <div className="knowledge-relationships__heading">
                <h3>{showAllLinks ? 'All recorded links' : 'Connected records'}</h3>
                <span>{relationships.length}</span>
              </div>
              {relationships.length === 0 ? (
                <p className="knowledge-empty">No recorded relationship is available for this record.</p>
              ) : (
                <div className="knowledge-relations">
                  {relationships.map(({ link, from, to }) => {
                    const isFocusSource = from.id === current?.id;
                    const isFocusTarget = to.id === current?.id;
                    const neighbor = isFocusSource ? to : isFocusTarget ? from : undefined;
                    return (
                      <article className="knowledge-relation" key={link.id} data-testid={`relationship-${link.id}`}>
                        <div className="knowledge-relation__route" aria-label={`${nodeTitle(from)} ${relationLabels[link.relation]} ${nodeTitle(to)}`}>
                          <span className={isFocusSource ? 'is-focused' : ''}>{nodeTitle(from)}</span>
                          <span className="knowledge-relation__connector">
                            <ArrowRight size={15} aria-hidden="true" />
                            <span className="knowledge-relation__label">{relationLabels[link.relation]}</span>
                            <ArrowRight size={15} aria-hidden="true" />
                          </span>
                          <span className={isFocusTarget ? 'is-focused' : ''}>{nodeTitle(to)}</span>
                        </div>
                        {neighbor === undefined ? (
                          <div className="knowledge-relation__endpoints">
                            {[{ node: from, label: 'From' }, { node: to, label: 'To' }].map(({ node, label }) => (
                              <div className="knowledge-relation__endpoint" key={`${link.id}-${label}`}>
                                <span className={`knowledge-category kind-${node.category}`}>
                                  <i aria-hidden="true" />{label} · {categories[node.category]} · {statusLabel(node.status)}
                                </span>
                                <strong>{nodeTitle(node)}</strong>
                                <p>{node.summary}</p>
                                <button onClick={() => select(node.id)} aria-label={`Inspect ${nodeTitle(node)}`}>
                                  Inspect record <ArrowUpRight size={14} aria-hidden="true" />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="knowledge-relation__record">
                            <span className={`knowledge-category kind-${neighbor.category}`}>
                              <i aria-hidden="true" />{categories[neighbor.category]} · {statusLabel(neighbor.status)}
                            </span>
                            <p>{neighbor.summary}</p>
                            <button onClick={() => select(neighbor.id)} aria-label={`Inspect ${nodeTitle(neighbor)}`}>
                              Inspect record <ArrowUpRight size={14} aria-hidden="true" />
                            </button>
                          </div>
                        )}
                        {link.evidenceRefs.length > 0 && (
                          <details className="knowledge-relation__evidence">
                            <summary>Link evidence · {link.evidenceRefs.length}</summary>
                            <div>{link.evidenceRefs.map((ref) => <code key={ref}>{ref}</code>)}</div>
                          </details>
                        )}
                        <span className="sr-only">
                          {neighbor === undefined
                            ? 'Recorded relationship.'
                            : isFocusSource
                              ? 'Selected record is the source of this relationship.'
                              : 'Selected record is the target of this relationship.'}
                        </span>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {mode === 'map' && (
          <div className="knowledge-map" aria-label="Selected record relationship map">
            <div className="knowledge-map__header">
              <div>
                <span className="constellation-eyebrow">FOCUSED MAP · {mapNodes.length} RECORDS</span>
                <h2>{current === undefined ? 'No selected record' : nodeTitle(current)}</h2>
                <p>
                  {connectedNodes.length > MAP_NEIGHBOR_LIMIT
                    ? `Showing ${MAP_NEIGHBOR_LIMIT} connected records at a time; Relationships lists all ${connectedNodes.length}.`
                    : 'Only this record and its directly connected neighbors are shown.'}
                </p>
              </div>
              <button className="constellation-world-action" onClick={() => setMode('story')}>
                <GitBranch size={15} aria-hidden="true" /> Relationship view
              </button>
            </div>
            {mapNodes.length > 0 ? (
              <div className="knowledge-map__flow" ref={mapFlowRef}>
                <ReactFlow
                  nodes={mapNodes}
                  edges={mapEdges}
                  nodeTypes={nodeTypes}
                  edgeTypes={edgeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.12, maxZoom: 1, minZoom: 0.62 }}
                  minZoom={0.5}
                  maxZoom={1.3}
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable={false}
                  panOnScroll
                  zoomOnDoubleClick={false}
                  proOptions={{ hideAttribution: true }}
                >
                  <Background variant={BackgroundVariant.Dots} color="#e4dbee" gap={28} size={1} />
                </ReactFlow>
              </div>
            ) : (
              <p className="knowledge-empty">No record is available for this map.</p>
            )}
          </div>
        )}

        {mode === 'list' && (
          <div className="knowledge-list" aria-label="Knowledge list">
            <header className="knowledge-list__header">
              <div>
                <span className="constellation-eyebrow">{history ? 'CURRENT + SAVED HISTORY' : 'CURRENT KNOWLEDGE'}</span>
                <h2>All records</h2>
                <p>Every matching record stays available here, including records without visible links.</p>
              </div>
              <span className="knowledge-list__count">{matches.length} records</span>
            </header>
            {matches.map((node) => (
              <button
                key={node.id}
                onClick={() => select(node.id)}
                className={`${node.id === current?.id ? 'selected' : ''} kind-${node.category}`}
                aria-current={node.id === current?.id ? 'true' : undefined}
              >
                <span className="knowledge-list__meta"><i aria-hidden="true" />{categories[node.category]} · {statusLabel(node.status)}</span>
                <strong>{nodeTitle(node)}</strong>
                <p>{node.summary}</p>
              </button>
            ))}
            {matches.length === 0 && <p className="knowledge-empty">No records match this search.</p>}
          </div>
        )}

        <div className="constellation-world-actions">
          <button onClick={onExplain}><BookOpen size={15} aria-hidden="true" />Explain this workspace</button>
          {query && <span className="constellation-match-count" role="status">{matches.length} matching objects</span>}
        </div>
      </main>

      {current !== undefined && (
        <aside className="constellation-detail" data-testid="knowledge-detail">
          <div className="constellation-detail__topline">
            <span className={`knowledge-status status-${current.status}`}>{statusLabel(current.status)}</span>
            <span className="constellation-eyebrow">{categories[current.category]}</span>
          </div>
          <h2>{nodeTitle(current)}</h2>
          <p className="constellation-detail__summary">{current.summary}</p>
          <div className="knowledge-questions" aria-label="Explore this knowledge">
            <button onClick={() => selectCategory('rule')}>Why does this rule exist?</button>
            <button onClick={() => selectCategory('person')} disabled={!graph.nodes.some((node) => node.category === 'person')}>Who taught this?</button>
            <button onClick={() => { selectCategory('worker'); setShowAllLinks(true); }}>What uses this capability?</button>
            {!graphProvided && <button onClick={() => { setHistory(true); setShowAllLinks(true); setMode('story'); }}>What changed?</button>}
          </div>
          <section className="knowledge-detail-section">
            <h3>Recorded details</h3>
            <ul>{current.detail.map((line, index) => <li key={`${current.id}-detail-${index}`}>{line}</li>)}</ul>
          </section>
          <section className="knowledge-detail-section">
            <h3>Evidence references</h3>
            <div className="knowledge-evidence">
              {current.evidenceRefs.length > 0
                ? current.evidenceRefs.map((ref) => <code key={ref}>{ref}</code>)
                : <p>No recorded evidence references.</p>}
            </div>
          </section>
          <section className="knowledge-detail-section">
            <h3>Connected knowledge</h3>
            <div className="knowledge-neighbors">
              {focusedLinks.map((link) => {
                const other = nodeById.get(link.fromId === current.id ? link.toId : link.fromId);
                if (other === undefined) return null;
                return (
                  <button key={link.id} onClick={() => select(other.id)}>
                    <span>{relationLabels[link.relation]}</span>{nodeTitle(other)}<ArrowUpRight size={13} aria-hidden="true" />
                  </button>
                );
              })}
              {focusedLinks.length === 0 && <p>No linked records.</p>}
            </div>
          </section>
          <button className="knowledge-open-work" onClick={() => onNavigate(current)} disabled={graphProvided && current.workObjectId === undefined}>
            Open connected work <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </aside>
      )}
        </>
      )}
    </section>
  );
}
