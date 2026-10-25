import { useMemo } from 'react';
import KnowledgeConstellation from '../components/KnowledgeConstellation';
import type { KnowledgeCategory, KnowledgeGraph, KnowledgeNode, KnowledgeStatus } from '../domain/knowledge';
import type { EvidenceEvent, StoryStep, TrioSnapshot } from './types';

const STEP_FOR_EVENT: Record<EvidenceEvent['kind'], StoryStep> = {
  source: 'sources',
  instruction: 'teach',
  test: 'verify',
  approval: 'approve',
  run: 'minimal',
  simulation: 'simulate',
  handoff: 'handoff',
};

const CATEGORY_FOR_EVENT: Record<EvidenceEvent['kind'], KnowledgeCategory> = {
  source: 'source',
  instruction: 'rule',
  test: 'test',
  approval: 'rule',
  run: 'outcome',
  simulation: 'outcome',
  handoff: 'exception',
};

const FOCUS_KIND_FOR_LEVEL: Partial<Record<number, EvidenceEvent['kind']>> = {
  1: 'source',
  2: 'source',
  3: 'instruction',
  4: 'instruction',
  5: 'test',
  6: 'approval',
  7: 'simulation',
  8: 'handoff',
};

function statusForEvent(event: EvidenceEvent): KnowledgeStatus {
  if (event.kind === 'approval') return 'approved';
  if (event.kind === 'handoff') return 'pending';
  return 'unknown';
}

export function deriveTrioKnowledge(snapshot: TrioSnapshot): KnowledgeGraph {
  const eventIds = new Set(snapshot.events.map((event) => event.id));
  const categoryIndexes = new Map<KnowledgeCategory, number>();
  const nodes: KnowledgeNode[] = snapshot.events.map((event, index) => {
    const category = CATEGORY_FOR_EVENT[event.kind];
    const categoryIndex = categoryIndexes.get(category) ?? 0;
    categoryIndexes.set(category, categoryIndex + 1);
    const references = [...new Set(event.references)];
    const details = [
      event.detail,
      `Version: ${event.version}`,
      `Recorded at: ${event.at}`,
      ...(references.length > 0 ? [`References: ${references.join(', ')}`] : []),
    ];
    return {
      id: event.id,
      title: event.title,
      category,
      status: statusForEvent(event),
      summary: event.detail,
      detail: details,
      workObjectId: STEP_FOR_EVENT[event.kind],
      evidenceRefs: [...new Set([event.id, ...references])],
      x: 48 + (categoryIndex % 2) * 260 + (index % 3) * 24,
      y: 36 + Math.floor(categoryIndex / 2) * 190 + Math.floor(index / 3) * 16,
    };
  });

  const linkIds = new Set<string>();
  const links = snapshot.events.flatMap((event) => event.references.flatMap((reference) => {
    if (!eventIds.has(reference) || reference === event.id) return [];
    const id = `${event.id}:references:${reference}`;
    if (linkIds.has(id)) return [];
    linkIds.add(id);
    return [{
      id,
      fromId: event.id,
      toId: reference,
      relation: 'references' as const,
      evidenceRefs: [event.id, reference],
    }];
  }));

  return { nodes, links };
}

function initialNode(snapshot: TrioSnapshot): string | undefined {
  const targetKind = FOCUS_KIND_FOR_LEVEL[snapshot.level];
  const relevant = targetKind === undefined
    ? undefined
    : [...snapshot.events].reverse().find((event) => event.kind === targetKind);
  return relevant?.id ?? snapshot.events.at(-1)?.id;
}

const STORY_STEPS: readonly StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];

function isStoryStep(value: string | undefined): value is StoryStep {
  return value !== undefined && STORY_STEPS.includes(value as StoryStep);
}

export default function TrioConstellation({
  snapshot,
  onNavigate,
  onExplain,
}: {
  snapshot: TrioSnapshot;
  onNavigate: (step: StoryStep) => void;
  onExplain: () => void;
}) {
  const graph = useMemo(() => deriveTrioKnowledge(snapshot), [snapshot]);
  const initialNodeId = initialNode(snapshot);

  return (
    <KnowledgeConstellation
      graph={graph}
      initialNodeId={initialNodeId}
      onNavigate={(node) => {
        if (isStoryStep(node.workObjectId)) onNavigate(node.workObjectId);
      }}
      onExplain={onExplain}
    />
  );
}
