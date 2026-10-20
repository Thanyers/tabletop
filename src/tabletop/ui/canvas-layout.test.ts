import { describe, expect, it } from 'vitest';
import { canvasLayoutRole, layoutCanvas, unpinnedNodesOverlappingPinnedResizes, type CanvasLayoutEdge, type CanvasLayoutNode, type CanvasPoint } from './canvas-layout';

function graphFixture(count: number) {
  const roles: CanvasLayoutNode['role'][] = ['source', 'process', 'process', 'scene', 'result', 'control', 'result'];
  const nodes: CanvasLayoutNode[] = Array.from({ length: count }, (_, index) => ({
    id: `node.${String(index + 1).padStart(2, '0')}`,
    role: roles[index % roles.length],
    width: index % 9 === 0 ? 520 : 320 + index % 3 * 40,
    height: index % 7 === 0 ? 460 : 200 + index % 4 * 36,
  }));
  const edges: CanvasLayoutEdge[] = [];
  for (let index = 1; index < count; index += 1) {
    edges.push({ source: nodes[index - 1].id, target: nodes[index].id });
    if (index > 2 && index % 3 === 0) edges.push({ source: nodes[Math.floor(index / 2)].id, target: nodes[index].id });
    if (index > 4 && index % 5 === 0) edges.push({ source: nodes[index - 2].id, target: nodes[index].id });
  }
  return { nodes, edges };
}

function assertNoOverlap(nodes: readonly CanvasLayoutNode[], positions: Record<string, CanvasPoint>, gap = 32) {
  for (let left = 0; left < nodes.length; left += 1) {
    for (let right = left + 1; right < nodes.length; right += 1) {
      const a = nodes[left];
      const b = nodes[right];
      const pa = positions[a.id];
      const pb = positions[b.id];
      const separated = pa.x + a.width + gap <= pb.x
        || pb.x + b.width + gap <= pa.x
        || pa.y + a.height + gap <= pb.y
        || pb.y + b.height + gap <= pa.y;
      expect(separated, `${a.id} overlaps ${b.id}`).toBe(true);
    }
  }
}

function p95(samples: number[]) {
  return [...samples].sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1];
}

describe('relationship-aware Canvas layout', () => {
  it('lays out 5, 12, and 24 measured nodes without collisions and remains deterministic', () => {
    for (const count of [5, 12, 24]) {
      const fixture = graphFixture(count);
      const first = layoutCanvas(fixture.nodes, fixture.edges);
      const second = layoutCanvas([...fixture.nodes].reverse(), [...fixture.edges].reverse());
      expect(first.positions).toEqual(second.positions);
      expect(first.unresolved).toEqual([]);
      assertNoOverlap(fixture.nodes, first.positions);
    }
  });

  it('packs 50-node graphs with long Thai labels and disconnected islands', () => {
    const fixture = graphFixture(50);
    // These larger post-measurement sizes represent cards expanded by long Thai labels.
    const edges = fixture.edges.filter((_, index) => index % 4 !== 0);
    for (let index = 10; index < fixture.nodes.length; index += 10) {
      edges.push({ source: fixture.nodes[index - 1].id, target: fixture.nodes[index].id });
    }
    fixture.nodes[7] = { ...fixture.nodes[7], id: 'node.08', width: 688, height: 592 };
    fixture.nodes[17] = { ...fixture.nodes[17], id: 'node.18', width: 572, height: 510 };
    const firstIsland = layoutCanvas(fixture.nodes, edges);
    const secondIsland = layoutCanvas(fixture.nodes, edges);
    expect(firstIsland.composition).toBe('islands');
    expect(firstIsland.unresolved).toEqual([]);
    expect(firstIsland.positions).toEqual(secondIsland.positions);
    assertNoOverlap(fixture.nodes, firstIsland.positions);
  });

  it('treats feedback cycles as one semantic block and keeps disconnected nodes separate', () => {
    const nodes: CanvasLayoutNode[] = [
      { id: 'cycle.a', width: 380, height: 230, role: 'source' },
      { id: 'cycle.b', width: 480, height: 300, role: 'process' },
      { id: 'cycle.c', width: 420, height: 270, role: 'process' },
      { id: 'cycle.result', width: 360, height: 240, role: 'result' },
      { id: 'island.control', width: 340, height: 220, role: 'control' },
    ];
    const edges = [
      { source: 'cycle.a', target: 'cycle.b' },
      { source: 'cycle.b', target: 'cycle.c' },
      { source: 'cycle.c', target: 'cycle.a' },
      { source: 'cycle.c', target: 'cycle.result' },
    ];
    const result = layoutCanvas(nodes, edges);
    expect(result.composition).toBe('islands');
    expect(result.positions['cycle.a'].x).toBe(result.positions['cycle.b'].x);
    expect(result.positions['cycle.b'].x).toBe(result.positions['cycle.c'].x);
    expect(result.unresolved).toEqual([]);
    assertNoOverlap(nodes, result.positions);
  });

  it('keeps every unaffected or pinned node at its exact point when adding a related node', () => {
    const fixture = graphFixture(12);
    const initial = layoutCanvas(fixture.nodes, fixture.edges);
    const added: CanvasLayoutNode = { id: 'node.new-chart', width: 520, height: 392, role: 'result' };
    const nodes = [...fixture.nodes.map((node) => ({ ...node, position: initial.positions[node.id] })), added];
    const edges = [...fixture.edges, { source: 'node.06', target: added.id }];
    const fixed = new Set(fixture.nodes.map((node) => node.id));
    const result = layoutCanvas(nodes, edges, { fixedIds: fixed, relationshipFirst: true });
    for (const node of fixture.nodes) expect(result.positions[node.id]).toEqual(initial.positions[node.id]);
    expect(result.unresolved).toEqual([]);
    const sourceRight = initial.positions['node.06'].x + fixture.nodes[5].width;
    expect(Math.abs(result.positions[added.id].x - sourceRight)).toBeLessThan(1_500);
    assertNoOverlap(nodes, result.positions);
  });

  it('moves only an expanded unpinned card when its measured height collides', () => {
    const nodes: CanvasLayoutNode[] = [
      { id: 'source', width: 340, height: 220, role: 'source' },
      { id: 'scene', width: 380, height: 260, role: 'scene' },
      { id: 'result', width: 380, height: 260, role: 'result' },
      { id: 'control', width: 350, height: 220, role: 'control' },
    ];
    const edges = [
      { source: 'source', target: 'scene' },
      { source: 'source', target: 'result' },
      { source: 'scene', target: 'control' },
    ];
    const initial = layoutCanvas(nodes, edges);
    const expandedNodes = nodes.map((node) => ({ ...node, position: initial.positions[node.id], height: node.id === 'scene' ? 720 : node.height }));
    const fixed = new Set(nodes.filter((node) => node.id !== 'scene').map((node) => node.id));
    const result = layoutCanvas(expandedNodes, edges, { fixedIds: fixed, preferredPositions: { scene: initial.positions.scene }, relationshipFirst: true });
    for (const node of nodes.filter((candidate) => candidate.id !== 'scene')) expect(result.positions[node.id]).toEqual(initial.positions[node.id]);
    expect(result.positions.scene).not.toEqual(initial.positions.scene);
    expect(result.unresolved).toEqual([]);
    assertNoOverlap(expandedNodes, result.positions);
  });

  it('keeps a resized pinned card in place and moves only unpinned cards it newly overlaps', () => {
    const nodes: CanvasLayoutNode[] = [
      { id: 'pinned-scene', width: 760, height: 420, role: 'scene', position: { x: 0, y: 0 }, pinned: true },
      { id: 'nearby-result', width: 360, height: 260, role: 'result', position: { x: 540, y: 48 } },
      { id: 'unrelated-result', width: 360, height: 260, role: 'result', position: { x: 1_300, y: 48 } },
    ];
    const resized = unpinnedNodesOverlappingPinnedResizes(nodes, new Set(['pinned-scene']));
    expect(resized).toEqual(new Set(['nearby-result']));
    const result = layoutCanvas(nodes, [{ source: 'pinned-scene', target: 'nearby-result' }], {
      fixedIds: new Set(['pinned-scene', 'unrelated-result']),
      preferredPositions: { 'nearby-result': nodes[1].position! },
      relationshipFirst: true,
    });
    expect(result.positions['pinned-scene']).toEqual(nodes[0].position);
    expect(result.positions['unrelated-result']).toEqual(nodes[2].position);
    expect(result.positions['nearby-result']).not.toEqual(nodes[1].position);
    expect(result.unresolved).toEqual([]);
    assertNoOverlap(nodes, result.positions);
  });

  it('classifies generated view capabilities by semantic role', () => {
    expect(canvasLayoutRole('table.sources')).toBe('source');
    expect(canvasLayoutRole('table.rules')).toBe('process');
    expect(canvasLayoutRole('table.generated-view.scene', 'table.view.story')).toBe('scene');
    expect(canvasLayoutRole('table.generated-view.controls', 'table.view.controls')).toBe('control');
    expect(canvasLayoutRole('table.generated-view.metric', 'table.view.total')).toBe('result');
  });

  it('meets the initial 24-node and incremental 24-node timing targets', () => {
    const fixture = graphFixture(24);
    for (let index = 0; index < 8; index += 1) layoutCanvas(fixture.nodes, fixture.edges);
    const initialSamples: number[] = [];
    for (let index = 0; index < 80; index += 1) {
      const start = performance.now();
      layoutCanvas(fixture.nodes, fixture.edges);
      initialSamples.push(performance.now() - start);
    }
    expect(p95(initialSamples)).toBeLessThan(500);

    const initial = layoutCanvas(fixture.nodes, fixture.edges);
    const added: CanvasLayoutNode = { id: 'node.incremental', width: 520, height: 400, role: 'result' };
    const incrementalNodes = [...fixture.nodes.map((node) => ({ ...node, position: initial.positions[node.id] })), added];
    const incrementalEdges = [...fixture.edges, { source: 'node.14', target: added.id }];
    const fixed = new Set(fixture.nodes.map((node) => node.id));
    const incrementalSamples: number[] = [];
    for (let index = 0; index < 80; index += 1) {
      const start = performance.now();
      layoutCanvas(incrementalNodes, incrementalEdges, { fixedIds: fixed, relationshipFirst: true });
      incrementalSamples.push(performance.now() - start);
    }
    expect(p95(incrementalSamples)).toBeLessThan(100);
  });
});
