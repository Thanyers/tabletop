import { generativeViewKindForCapability, generativeViewKindMetadata } from '../shared/view-kinds';

export type CanvasLayoutRole = 'source' | 'process' | 'scene' | 'result' | 'control' | 'reference' | 'other';
export type CanvasComposition = 'scene' | 'comparison' | 'flow' | 'islands';

export interface CanvasPoint { x: number; y: number }

export interface CanvasLayoutNode {
  id: string;
  width: number;
  height: number;
  role?: CanvasLayoutRole;
  position?: CanvasPoint;
  pinned?: boolean;
}

export interface CanvasLayoutEdge { source: string; target: string }

export interface CanvasLayoutOptions {
  /** Positions in this set are hard anchors and are returned byte-for-byte unchanged. */
  fixedIds?: ReadonlySet<string>;
  /** Incremental placement favors already placed binding neighbors. */
  relationshipFirst?: boolean;
  /** Prefer an existing position for a resized node before testing nearby candidates. */
  preferredPositions?: Readonly<Record<string, CanvasPoint>>;
  horizontalGap?: number;
  verticalGap?: number;
  maxCandidates?: number;
}

export interface CanvasLayoutResult {
  positions: Record<string, CanvasPoint>;
  unresolved: string[];
  composition: CanvasComposition;
}

const DEFAULT_HORIZONTAL_GAP = 144;
const DEFAULT_VERTICAL_GAP = 72;
const MIN_NODE_WIDTH = 240;
const MIN_NODE_HEIGHT = 156;
const MAX_NODE_DIMENSION = 4_000;

const lexical = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const finitePoint = (point: CanvasPoint | undefined): point is CanvasPoint => !!point && Number.isFinite(point.x) && Number.isFinite(point.y);

function normalizedSize(node: CanvasLayoutNode) {
  return {
    width: Math.min(MAX_NODE_DIMENSION, Math.max(MIN_NODE_WIDTH, Number.isFinite(node.width) ? node.width : MIN_NODE_WIDTH)),
    height: Math.min(MAX_NODE_DIMENSION, Math.max(MIN_NODE_HEIGHT, Number.isFinite(node.height) ? node.height : MIN_NODE_HEIGHT)),
  };
}

/** Map allowlisted capability names to the small set of layout roles. */
export function canvasLayoutRole(capability: string, id = ''): CanvasLayoutRole {
  // F078-T8: a generated Canvas view carries its kind in the capability id, so the
  // role comes from the same registry the runtime uses instead of guessing the leaf.
  const generatedViewKind = generativeViewKindForCapability(capability);
  if (generatedViewKind) {
    const role: CanvasLayoutRole = generativeViewKindMetadata(generatedViewKind).layoutRole;
    return role;
  }
  const leaf = capability.split('.').at(-1)?.toLowerCase() ?? '';
  const name = `${leaf} ${id.split('.').at(-1)?.toLowerCase() ?? ''}`;
  if (/^(source|sources|input|upload)$/.test(leaf) || /\b(source|sources|input)\b/.test(name)) return 'source';
  if (/^(scene)$/.test(leaf) || /\bscene\b/.test(name)) return 'scene';
  if (/^(actions|action|controls|control|question)$/.test(leaf) || /\b(controls|control|actions|action)\b/.test(name)) return 'control';
  if (/^(chart|metric|table|collection|board|result|output|review|comparison|compare)$/.test(leaf) || /\b(chart|metric|result|output|collection|comparison|compare)\b/.test(name)) return 'result';
  if (/^(reference|evidence|notes|detail)$/.test(leaf) || /\b(reference|evidence|detail)\b/.test(name)) return 'reference';
  if (/^(rules|reconcile|model|merge|compute|process|transform)$/.test(leaf) || /\b(rules|reconcile|model|merge|compute|process|transform)\b/.test(name)) return 'process';
  return 'other';
}

interface Block {
  id: string;
  members: string[];
  rank: number;
}

interface Island {
  ids: string[];
  bounds: { left: number; top: number; right: number; bottom: number };
  positions: Record<string, CanvasPoint>;
  area: number;
  key: string;
}

/**
 * A deterministic, bounded layout for the Canvas' 5–50 node graphs.
 * It collapses feedback cycles into tight blocks, layers dependencies, packs
 * disconnected islands, and treats supplied positions as immutable anchors.
 */
export function layoutCanvas(
  inputNodes: readonly CanvasLayoutNode[],
  inputEdges: readonly CanvasLayoutEdge[],
  options: CanvasLayoutOptions = {},
): CanvasLayoutResult {
  const nodes = [...inputNodes].sort((a, b) => lexical(a.id, b.id));
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = inputEdges
    .filter((edge) => byId.has(edge.source) && byId.has(edge.target))
    .map((edge) => ({ source: edge.source, target: edge.target }))
    .sort((a, b) => lexical(a.source, b.source) || lexical(a.target, b.target));
  const horizontalGap = Math.max(48, options.horizontalGap ?? DEFAULT_HORIZONTAL_GAP);
  const verticalGap = Math.max(32, options.verticalGap ?? DEFAULT_VERTICAL_GAP);
  const maxCandidates = Math.min(256, Math.max(1, options.maxCandidates ?? 96));
  const graph = makeGraph(nodes, edges);
  const ideal = makeIdealLayout(nodes, graph, horizontalGap, verticalGap);
  const fixedIds = new Set(options.fixedIds ?? []);
  for (const node of nodes) if (node.pinned) fixedIds.add(node.id);

  const positions: Record<string, CanvasPoint> = {};
  const placed: string[] = [];
  for (const node of nodes) {
    if (!fixedIds.has(node.id) || !finitePoint(node.position)) continue;
    positions[node.id] = node.position;
    placed.push(node.id);
  }

  const unresolved: string[] = [];
  const order = [...graph.nodeOrder, ...nodes.map((node) => node.id)].filter((id, index, all) => all.indexOf(id) === index);
  for (const id of order) {
    if (fixedIds.has(id)) continue;
    const node = byId.get(id);
    if (!node) continue;
    const size = normalizedSize(node);
    const preferred = options.preferredPositions?.[id];
    const related = options.relationshipFirst ? relatedPosition(id, size, edges, positions, byId, horizontalGap) : undefined;
    const isolated = options.relationshipFirst && !related ? nextIslandPosition(size, positions, byId, horizontalGap, verticalGap) : undefined;
    const base = finitePoint(preferred) ? preferred : related ?? isolated ?? ideal[id] ?? { x: 48, y: 48 };
    const candidate = findFreePosition(base, size, placed, positions, byId, horizontalGap, verticalGap, maxCandidates);
    if (candidate) positions[id] = candidate;
    else {
      positions[id] = base;
      unresolved.push(id);
    }
    placed.push(id);
  }

  for (const node of nodes) {
    if (!positions[node.id]) positions[node.id] = ideal[node.id] ?? { x: 48, y: 48 };
  }

  return { positions, unresolved, composition: graph.composition };
}

/** Return unpinned nodes whose current measured boxes collide with resized pinned anchors. */
export function unpinnedNodesOverlappingPinnedResizes(
  nodes: readonly CanvasLayoutNode[],
  resizedIds: ReadonlySet<string>,
  horizontalGap = DEFAULT_HORIZONTAL_GAP,
  verticalGap = DEFAULT_VERTICAL_GAP,
): Set<string> {
  const anchors = nodes.filter((node) => resizedIds.has(node.id) && node.pinned && finitePoint(node.position));
  if (anchors.length === 0) return new Set();
  const moved = new Set<string>();
  for (const node of nodes) {
    if (node.pinned || !finitePoint(node.position)) continue;
    if (anchors.some((anchor) => rectanglesOverlap(
      node.position!, normalizedSize(node), anchor.position!, normalizedSize(anchor), horizontalGap, verticalGap,
    ))) moved.add(node.id);
  }
  return moved;
}

function makeGraph(nodes: readonly CanvasLayoutNode[], edges: readonly CanvasLayoutEdge[]) {
  const ids = nodes.map((node) => node.id);
  const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
  const incoming = new Map(ids.map((id) => [id, new Set<string>()]));
  const undirected = new Map(ids.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    outgoing.get(edge.source)?.add(edge.target);
    incoming.get(edge.target)?.add(edge.source);
    undirected.get(edge.source)?.add(edge.target);
    undirected.get(edge.target)?.add(edge.source);
  }

  const islands: string[][] = [];
  const visited = new Set<string>();
  for (const start of ids) {
    if (visited.has(start)) continue;
    const queue = [start];
    visited.add(start);
    const island: string[] = [];
    while (queue.length) {
      const id = queue.shift()!;
      island.push(id);
      for (const next of [...(undirected.get(id) ?? [])].sort(lexical)) {
        if (visited.has(next)) continue;
        visited.add(next);
        queue.push(next);
      }
    }
    islands.push(island.sort(lexical));
  }

  const sccs = stronglyConnectedComponents(ids, outgoing);
  const blockFor = new Map<string, string>();
  const blocks: Block[] = sccs.map((members) => {
    const id = members[0];
    for (const member of members) blockFor.set(member, id);
    return { id, members, rank: 0 };
  });
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const blockParents = new Map(blocks.map((block) => [block.id, new Set<string>()]));
  const blockChildren = new Map(blocks.map((block) => [block.id, new Set<string>()]));
  for (const edge of edges) {
    const source = blockFor.get(edge.source)!;
    const target = blockFor.get(edge.target)!;
    if (source === target) continue;
    blockChildren.get(source)?.add(target);
    blockParents.get(target)?.add(source);
  }

  const remainingParents = new Map(blocks.map((block) => [block.id, blockParents.get(block.id)?.size ?? 0]));
  const pending = blocks.filter((block) => remainingParents.get(block.id) === 0).map((block) => block.id).sort(lexical);
  const topological: string[] = [];
  while (pending.length) {
    const id = pending.shift()!;
    topological.push(id);
    const children = [...(blockChildren.get(id) ?? [])].sort(lexical);
    for (const child of children) {
      const block = blockById.get(child)!;
      block.rank = Math.max(block.rank, blockById.get(id)!.rank + 1);
      const remaining = (remainingParents.get(child) ?? 0) - 1;
      remainingParents.set(child, remaining);
      if (remaining === 0) {
        pending.push(child);
        pending.sort(lexical);
      }
    }
  }

  for (const island of islands) {
    const memberBlocks = [...new Set(island.map((id) => blockFor.get(id)!))].map((id) => blockById.get(id)!);
    const roleRanks = island.map((id) => semanticRank(byIdRole(nodes, id)));
    const minimumRoleRank = Math.min(...roleRanks);
    for (const block of memberBlocks) {
      const desired = Math.max(...block.members.map((id) => semanticRank(byIdRole(nodes, id)))) - minimumRoleRank;
      block.rank = Math.max(block.rank, desired);
    }
  }

  const orderedBlocks = new Map<string, Block[]>();
  const nodeOrder: string[] = [];
  for (const island of islands) {
    const memberBlocks = [...new Set(island.map((id) => blockFor.get(id)!))]
      .map((id) => blockById.get(id)!)
      .sort((a, b) => a.rank - b.rank || lexical(a.id, b.id));
    const ranks = [...new Set(memberBlocks.map((block) => block.rank))].sort((a, b) => a - b);
    let previousOrder = new Map<string, number>();
    for (const rank of ranks) {
      const layer = memberBlocks.filter((block) => block.rank === rank);
      layer.sort((a, b) => {
        const score = (block: Block) => {
          const parents = [...(blockParents.get(block.id) ?? [])]
            .filter((parent) => blockById.get(parent)?.rank === rank - 1)
            .map((parent) => previousOrder.get(parent))
            .filter((value): value is number => value !== undefined);
          return parents.length ? parents.reduce((sum, value) => sum + value, 0) / parents.length : roleSort(block, nodes);
        };
        return score(a) - score(b) || lexical(a.id, b.id);
      });
      layer.forEach((block, index) => {
        orderedBlocks.set(block.id, layer);
        previousOrder.set(block.id, index);
        for (const member of [...block.members].sort((left, right) => roleSortId(left, nodes) - roleSortId(right, nodes) || lexical(left, right))) nodeOrder.push(member);
      });
    }
  }

  const sceneNodes = nodes.filter((node) => node.role === 'scene');
  const controlNodes = nodes.filter((node) => node.role === 'control');
  const resultNodes = nodes.filter((node) => node.role === 'result');
  const hasComparison = resultNodes.length > 1 && hasCommonAncestor(resultNodes.map((node) => node.id), incoming);
  const composition: CanvasComposition = islands.length > 1 ? 'islands' : sceneNodes.length > 0 && controlNodes.length > 0 ? 'scene' : hasComparison ? 'comparison' : 'flow';
  return { outgoing, incoming, islands, blocks, blockFor, blockById, blockParents, blockChildren, nodeOrder, composition, orderedBlocks };
}

function byIdRole(nodes: readonly CanvasLayoutNode[], id: string): CanvasLayoutRole {
  return nodes.find((node) => node.id === id)?.role ?? 'other';
}

function semanticRank(role: CanvasLayoutRole) {
  if (role === 'source' || role === 'reference') return 0;
  if (role === 'process') return 1;
  if (role === 'scene' || role === 'result' || role === 'control') return 2;
  return 1;
}

function roleSortId(id: string, nodes: readonly CanvasLayoutNode[]) {
  const role = byIdRole(nodes, id);
  if (role === 'source') return 0;
  if (role === 'process') return 1;
  if (role === 'scene') return 2;
  if (role === 'result') return 3;
  if (role === 'control') return 4;
  if (role === 'reference') return 5;
  return 6;
}

function roleSort(block: Block, nodes: readonly CanvasLayoutNode[]) {
  return Math.min(...block.members.map((id) => roleSortId(id, nodes)));
}

function hasCommonAncestor(ids: readonly string[], incoming: Map<string, Set<string>>) {
  const ancestorSets = ids.map((id) => {
    const seen = new Set<string>();
    const queue = [...(incoming.get(id) ?? [])];
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current)) continue;
      seen.add(current);
      queue.push(...(incoming.get(current) ?? []));
    }
    return seen;
  });
  return ancestorSets.length > 1 && [...ancestorSets[0]].some((ancestor) => ancestorSets.slice(1).every((set) => set.has(ancestor)));
}

function stronglyConnectedComponents(ids: readonly string[], outgoing: Map<string, Set<string>>) {
  let index = 0;
  const indexes = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const result: string[][] = [];
  const visit = (id: string) => {
    indexes.set(id, index);
    low.set(id, index);
    index += 1;
    stack.push(id);
    onStack.add(id);
    for (const next of [...(outgoing.get(id) ?? [])].sort(lexical)) {
      if (!indexes.has(next)) {
        visit(next);
        low.set(id, Math.min(low.get(id)!, low.get(next)!));
      } else if (onStack.has(next)) low.set(id, Math.min(low.get(id)!, indexes.get(next)!));
    }
    if (low.get(id) !== indexes.get(id)) return;
    const component: string[] = [];
    let member = '';
    do {
      member = stack.pop()!;
      onStack.delete(member);
      component.push(member);
    } while (member !== id);
    result.push(component.sort(lexical));
  };
  for (const id of [...ids].sort(lexical)) if (!indexes.has(id)) visit(id);
  return result.sort((a, b) => lexical(a[0], b[0]));
}

function makeIdealLayout(
  nodes: readonly CanvasLayoutNode[],
  graph: ReturnType<typeof makeGraph>,
  horizontalGap: number,
  verticalGap: number,
) {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: Record<string, CanvasPoint> = {};
  const islands: Island[] = [];

  for (const ids of graph.islands) {
    const islandSet = new Set(ids);
    const islandBlocks = graph.blocks.filter((block) => islandSet.has(block.id) || block.members.some((id) => islandSet.has(id)));
    const ranks = [...new Set(islandBlocks.map((block) => block.rank))].sort((a, b) => a - b);
    let x = 0;
    const local: Record<string, CanvasPoint> = {};
    for (const rank of ranks) {
      const blocks = islandBlocks.filter((block) => block.rank === rank).sort((a, b) => {
        const layer = graph.orderedBlocks.get(a.id) ?? [];
        return layer.indexOf(a) - layer.indexOf(b) || lexical(a.id, b.id);
      });
      const blockGroups = reorderComparisonBlocks(blocks, graph, byId);
      const width = Math.max(MIN_NODE_WIDTH, ...blockGroups.map((block) => Math.max(...block.members.map((id) => normalizedSize(byId.get(id)!).width))));
      let y = 0;
      for (const block of blockGroups) {
        const members = [...block.members].sort((left, right) => roleSortId(left, nodes) - roleSortId(right, nodes) || lexical(left, right));
        const blockHeight = members.reduce((sum, id) => sum + normalizedSize(byId.get(id)!).height, 0) + verticalGap * Math.max(0, members.length - 1);
        let memberY = y;
        for (const id of members) {
          const size = normalizedSize(byId.get(id)!);
          local[id] = { x, y: memberY };
          memberY += size.height + verticalGap;
        }
        y += blockHeight + verticalGap;
      }
      x += width + horizontalGap;
    }
    const bounds = boundsFor(ids, local, byId);
    islands.push({ ids, bounds, positions: local, area: (bounds.right - bounds.left) * (bounds.bottom - bounds.top), key: ids[0] });
  }

  islands.sort((a, b) => b.area - a.area || lexical(a.key, b.key));
  const totalArea = islands.reduce((sum, island) => sum + island.area, 0);
  const shelfWidth = Math.max(1_500, Math.sqrt(totalArea) * 1.7);
  let shelfX = 0;
  let shelfY = 0;
  let shelfHeight = 0;
  const islandGapX = horizontalGap * 2;
  const islandGapY = verticalGap * 2;
  for (const island of islands) {
    const width = island.bounds.right - island.bounds.left;
    const height = island.bounds.bottom - island.bounds.top;
    if (shelfX > 0 && shelfX + width > shelfWidth) {
      shelfX = 0;
      shelfY += shelfHeight + islandGapY;
      shelfHeight = 0;
    }
    const offsetX = 48 + shelfX - island.bounds.left;
    const offsetY = 48 + shelfY - island.bounds.top;
    for (const id of island.ids) result[id] = { x: island.positions[id].x + offsetX, y: island.positions[id].y + offsetY };
    shelfX += width + islandGapX;
    shelfHeight = Math.max(shelfHeight, height);
  }
  return result;
}

function reorderComparisonBlocks(blocks: Block[], graph: ReturnType<typeof makeGraph>, byId: Map<string, CanvasLayoutNode>) {
  const results = blocks.filter((block) => block.members.some((id) => byId.get(id)?.role === 'result'));
  if (results.length < 2) return blocks;
  const comparisonIds = new Set(results.flatMap((block) => block.members));
  const hasSharedAncestor = hasCommonAncestor([...comparisonIds], graph.incoming);
  if (!hasSharedAncestor) return blocks;
  return [...blocks].sort((a, b) => {
    const aResult = a.members.some((id) => byId.get(id)?.role === 'result');
    const bResult = b.members.some((id) => byId.get(id)?.role === 'result');
    return Number(bResult) - Number(aResult) || lexical(a.id, b.id);
  });
}

function boundsFor(ids: readonly string[], positions: Record<string, CanvasPoint>, byId: Map<string, CanvasLayoutNode>) {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const id of ids) {
    const position = positions[id];
    const size = normalizedSize(byId.get(id)!);
    left = Math.min(left, position.x);
    top = Math.min(top, position.y);
    right = Math.max(right, position.x + size.width);
    bottom = Math.max(bottom, position.y + size.height);
  }
  return { left, top, right, bottom };
}

function relatedPosition(
  id: string,
  size: { width: number; height: number },
  edges: readonly CanvasLayoutEdge[],
  positions: Record<string, CanvasPoint>,
  byId: Map<string, CanvasLayoutNode>,
  horizontalGap: number,
): CanvasPoint | undefined {
  const incoming = edges.filter((edge) => edge.target === id && positions[edge.source]).map((edge) => edge.source);
  const outgoing = edges.filter((edge) => edge.source === id && positions[edge.target]).map((edge) => edge.target);
  if (incoming.length === 0 && outgoing.length === 0) return undefined;
  const incomingRight = incoming.length ? Math.max(...incoming.map((nodeId) => positions[nodeId].x + normalizedSize(byId.get(nodeId)!).width)) : undefined;
  const outgoingLeft = outgoing.length ? Math.min(...outgoing.map((nodeId) => positions[nodeId].x)) : undefined;
  let x: number;
  if (incomingRight !== undefined && outgoingLeft !== undefined) {
    const available = outgoingLeft - incomingRight;
    x = available >= size.width ? incomingRight + (available - size.width) / 2 : incomingRight + horizontalGap;
  } else if (incomingRight !== undefined) x = incomingRight + horizontalGap;
  else x = outgoingLeft! - size.width - horizontalGap;
  const neighbors = [...incoming, ...outgoing];
  const centers = neighbors.map((nodeId) => positions[nodeId].y + normalizedSize(byId.get(nodeId)!).height / 2);
  return { x, y: centers.reduce((sum, center) => sum + center, 0) / centers.length - size.height / 2 };
}

function nextIslandPosition(
  size: { width: number; height: number },
  positions: Record<string, CanvasPoint>,
  byId: Map<string, CanvasLayoutNode>,
  horizontalGap: number,
  verticalGap: number,
): CanvasPoint {
  const ids = Object.keys(positions);
  if (ids.length === 0) return { x: 48, y: 48 };
  const bounds = boundsFor(ids, positions, byId);
  return { x: bounds.right + horizontalGap, y: bounds.top + Math.min(size.height, verticalGap) };
}

function findFreePosition(
  base: CanvasPoint,
  size: { width: number; height: number },
  placed: readonly string[],
  positions: Record<string, CanvasPoint>,
  byId: Map<string, CanvasLayoutNode>,
  horizontalGap: number,
  verticalGap: number,
  maxCandidates: number,
): CanvasPoint | undefined {
  let candidateCount = 0;
  const tryCandidate = (x: number, y: number) => {
    if (candidateCount >= maxCandidates) return undefined;
    candidateCount += 1;
    const candidate = { x, y };
    for (const id of placed) {
      const position = positions[id];
      if (!position) continue;
      const other = normalizedSize(byId.get(id)!);
      if (rectanglesOverlap(candidate, size, position, other, horizontalGap, verticalGap)) return undefined;
    }
    return candidate;
  };
  const first = tryCandidate(base.x, base.y);
  if (first) return first;
  const stepX = size.width + horizontalGap;
  const stepY = size.height + verticalGap;
  for (let ring = 1; candidateCount < maxCandidates; ring += 1) {
    for (let x = -ring; x <= ring && candidateCount < maxCandidates; x += 1) {
      const top = tryCandidate(base.x + x * stepX, base.y - ring * stepY);
      if (top) return top;
      const bottom = tryCandidate(base.x + x * stepX, base.y + ring * stepY);
      if (bottom) return bottom;
    }
    for (let y = -ring + 1; y < ring && candidateCount < maxCandidates; y += 1) {
      const left = tryCandidate(base.x - ring * stepX, base.y + y * stepY);
      if (left) return left;
      const right = tryCandidate(base.x + ring * stepX, base.y + y * stepY);
      if (right) return right;
    }
  }
  return undefined;
}

function rectanglesOverlap(
  firstPoint: CanvasPoint,
  firstSize: { width: number; height: number },
  secondPoint: CanvasPoint,
  secondSize: { width: number; height: number },
  horizontalGap: number,
  verticalGap: number,
) {
  return !(
    firstPoint.x + firstSize.width + horizontalGap <= secondPoint.x
    || secondPoint.x + secondSize.width + horizontalGap <= firstPoint.x
    || firstPoint.y + firstSize.height + verticalGap <= secondPoint.y
    || secondPoint.y + secondSize.height + verticalGap <= firstPoint.y
  );
}
