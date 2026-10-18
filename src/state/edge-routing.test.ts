import { describe, expect, it } from 'vitest';
import { makeObject } from './objects';
import { routeConnections, type RoutedConnection, type RoutingRect } from './edge-routing';

const rect = (id: string, x: number, y: number, width: number, height: number): RoutingRect => ({ id, x, y, width, height });

function assertClearOfUnrelatedCards(route: RoutedConnection, rects: readonly RoutingRect[], clearance = 22): void {
  expect(route.hidden).toBe(false);
  expect(route.points.length).toBeGreaterThanOrEqual(2);
  const blockers = rects
    .filter((item) => item.id !== route.source && item.id !== route.target)
    .map((item) => ({
      left: item.x - clearance,
      top: item.y - clearance,
      right: item.x + item.width + clearance,
      bottom: item.y + item.height + clearance,
    }));
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const from = route.points[index]!;
    const to = route.points[index + 1]!;
    expect(Math.abs(from.x - to.x) <= 1e-7 || Math.abs(from.y - to.y) <= 1e-7).toBe(true);
    for (const obstacle of blockers) {
      const horizontal = Math.abs(from.y - to.y) <= 1e-7;
      const blocked = horizontal
        ? from.y > obstacle.top + 1e-7
          && from.y < obstacle.bottom - 1e-7
          && Math.max(from.x, to.x) > obstacle.left + 1e-7
          && Math.min(from.x, to.x) < obstacle.right - 1e-7
        : from.x > obstacle.left + 1e-7
          && from.x < obstacle.right - 1e-7
          && Math.max(from.y, to.y) > obstacle.top + 1e-7
          && Math.min(from.y, to.y) < obstacle.bottom - 1e-7;
      expect(blocked, `segment ${index} intersects padded card ${route.source} -> ${route.target}`).toBe(false);
    }
  }
  expect(route.path).not.toMatch(/NaN|Infinity|undefined/);
}

function expectLabelOutsideCards(route: RoutedConnection, rects: readonly RoutingRect[]): void {
  if (!route.labelBounds) return;
  for (const item of rects) {
    const label = route.labelBounds;
    const overlapsCard = label.x < item.x + item.width
      && label.x + label.width > item.x
      && label.y < item.y + item.height
      && label.y + label.height > item.y;
    expect(overlapsCard, `label overlaps card ${item.id}`).toBe(false);
  }
}

function asRect(object: ReturnType<typeof makeObject>): RoutingRect {
  return {
    id: object.id,
    x: object.position.x,
    y: object.position.y,
    width: object.width,
    height: object.height,
  };
}

describe('routeConnections', () => {
  it('uses the facing ports for adjacent cards and reserves clear label bounds', () => {
    const rects = [rect('source', 0, 0, 180, 100), rect('worker', 310, 0, 180, 100)];
    const [route] = routeConnections(rects, [{ id: 'source-worker', source: 'source', target: 'worker', label: 'Uses source data' }]);

    expect(route).toMatchObject({
      hidden: false,
      sourceSide: 'right',
      targetSide: 'left',
      sourceHandleId: 'source-right',
      targetHandleId: 'target-left',
    });
    expect(route.points).toHaveLength(2);
    expect(route.labelBounds).not.toBeNull();
    assertClearOfUnrelatedCards(route!, rects);
    expectLabelOutsideCards(route!, rects);
  });

  it('routes around a tall card with rounded corners instead of crossing through it', () => {
    const rects = [
      rect('source', 0, 0, 130, 90),
      rect('target', 520, 0, 130, 90),
      rect('tall-obstacle', 220, -48, 170, 190),
    ];
    const [route] = routeConnections(rects, [{ id: 'through-canvas', source: 'source', target: 'target', label: 'Calculate results' }]);

    expect(route?.hidden).toBe(false);
    expect(route?.points.length).toBeGreaterThan(2);
    expect(route?.path).toContain(' Q ');
    assertClearOfUnrelatedCards(route!, rects);
    expectLabelOutsideCards(route!, rects);
  });

  it('routes backward and vertically upward using the nearest cardinal ports', () => {
    const backwardRects = [rect('later', 430, 140, 150, 90), rect('earlier', 20, 140, 150, 90)];
    const [backward] = routeConnections(backwardRects, [{ id: 'backward', source: 'later', target: 'earlier' }]);
    expect(backward).toMatchObject({ hidden: false, sourceSide: 'left', targetSide: 'right' });
    assertClearOfUnrelatedCards(backward!, backwardRects);

    const verticalRects = [rect('lower', 180, 340, 150, 90), rect('upper', 180, 20, 150, 90)];
    const [upward] = routeConnections(verticalRects, [{ id: 'upward', source: 'lower', target: 'upper' }]);
    expect(upward).toMatchObject({ hidden: false, sourceSide: 'top', targetSide: 'bottom' });
    assertClearOfUnrelatedCards(upward!, verticalRects);
  });

  it('keeps real source, worker, and explanation cards clear in the default canvas layout', () => {
    const objects = [
      makeObject('source', 'accounting'),
      makeObject('worker', 'accounting'),
      makeObject('table', 'accounting'),
      makeObject('learning', 'accounting'),
    ];
    const rects = objects.map(asRect);
    const [route] = routeConnections(rects, [{ id: 'source-worker', source: 'source', target: 'worker', label: 'ใช้ข้อมูลและกฎ' }]);

    expect(route?.hidden).toBe(false);
    assertClearOfUnrelatedCards(route!, rects);
    expectLabelOutsideCards(route!, rects);
  });

  it('routes around overlapping unrelated cards and never treats their overlap as a corridor', () => {
    const rects = [
      rect('source', 0, 110, 120, 90),
      rect('target', 650, 110, 120, 90),
      rect('left-wall', 230, 8, 190, 300),
      rect('right-wall', 400, 8, 190, 300),
    ];
    const [route] = routeConnections(rects, [{ id: 'around-overlap', source: 'source', target: 'target' }]);

    expect(route?.hidden).toBe(false);
    assertClearOfUnrelatedCards(route!, rects);
  });

  it('hides a connection when overlapping endpoint cards leave no safe port escape', () => {
    const rects = [rect('source', 180, 130, 55, 45), rect('target', 100, 60, 260, 190)];
    const [route] = routeConnections(rects, [{ id: 'buried-endpoint', source: 'source', target: 'target' }]);

    expect(route).toMatchObject({ hidden: true, path: '', points: [], reason: 'no-route' });
  });

  it('recomputes a safe path after an obstacle moves or grows into the former route', () => {
    const endpoints = [rect('source', 0, 40, 100, 90), rect('target', 550, 40, 100, 90)];
    const link = [{ id: 'moving-layout', source: 'source', target: 'target' }];
    const initial = routeConnections(endpoints, link)[0]!;
    expect(initial.points).toHaveLength(2);

    const moved = [...endpoints, rect('obstacle', 250, 8, 150, 190)];
    const afterMove = routeConnections(moved, link)[0]!;
    expect(afterMove.hidden).toBe(false);
    expect(afterMove.path).not.toBe(initial.path);
    assertClearOfUnrelatedCards(afterMove, moved);

    const resized = [...endpoints, rect('obstacle', 160, -40, 360, 310)];
    const afterResize = routeConnections(resized, link)[0]!;
    expect(afterResize.hidden).toBe(false);
    expect(afterResize.path).not.toBe(afterMove.path);
    assertClearOfUnrelatedCards(afterResize, resized);
  });

  it('routes around a third card’s conservative animation envelope before it reaches that position', () => {
    const actual = [
      rect('source', 0, 40, 100, 90),
      rect('target', 560, 40, 100, 90),
      rect('growing-table', 230, 220, 150, 110),
    ];
    const future = [
      actual[0]!,
      actual[1]!,
      rect('growing-table', 210, -20, 190, 270),
    ];
    const links = [{ id: 'growing-table-link', source: 'source', target: 'target' }];
    const currentRoute = routeConnections(actual, links)[0]!;
    const protectedRoute = routeConnections(actual, links, { obstacleBounds: future })[0]!;

    expect(currentRoute.points).toHaveLength(2);
    expect(protectedRoute.hidden).toBe(false);
    expect(protectedRoute.path).not.toBe(currentRoute.path);
    assertClearOfUnrelatedCards(protectedRoute, future);
  });

  it('anchors on the current source perimeter and exits beyond its padded growth envelope', () => {
    const source = rect('source', 0, 100, 100, 100);
    const target = rect('target', 540, 100, 100, 100);
    const obstacle = rect('near-source', 80, 120, 160, 180);
    const sourceEnvelope = rect('source', 0, 0, 180, 200);
    const rects = [source, target, obstacle];
    const route = routeConnections(rects, [{ id: 'growing-source', source: 'source', target: 'target' }], {
      obstacleBounds: [sourceEnvelope],
    })[0]!;

    expect(route.hidden).toBe(false);
    const actualAnchor = route.sourceSide === 'top' || route.sourceSide === 'bottom'
      ? { x: source.x + source.width / 2, y: route.sourceSide === 'top' ? source.y : source.y + source.height }
      : { x: route.sourceSide === 'left' ? source.x : source.x + source.width, y: source.y + source.height / 2 };
    expect(route.points[0]).toEqual(actualAnchor);
    const firstTurn = route.points[1]!;
    if (route.sourceSide === 'right') expect(firstTurn.x).toBeGreaterThanOrEqual(sourceEnvelope.x + sourceEnvelope.width + 22 - 1e-7);
    else if (route.sourceSide === 'left') expect(firstTurn.x).toBeLessThanOrEqual(sourceEnvelope.x - 22 + 1e-7);
    else if (route.sourceSide === 'top') expect(firstTurn.y).toBeLessThanOrEqual(sourceEnvelope.y - 22 + 1e-7);
    else expect(firstTurn.y).toBeGreaterThanOrEqual(sourceEnvelope.y + sourceEnvelope.height + 22 - 1e-7);
    assertClearOfUnrelatedCards(route, [sourceEnvelope, target, obstacle]);
  });

  it('returns hidden routes for missing endpoints and invalid geometry', () => {
    expect(routeConnections([rect('source', 0, 0, 100, 80)], [{ id: 'missing', source: 'source', target: 'absent' }])[0])
      .toMatchObject({ hidden: true, reason: 'missing-endpoint' });
    expect(routeConnections([rect('source', 0, 0, 100, 80), rect('target', 200, 0, 100, 80), rect('bad', 10, 10, Number.NaN, 20)], [{ id: 'bad-input', source: 'source', target: 'target' }])[0])
      .toMatchObject({ hidden: true, reason: 'invalid-geometry' });
  });

  it('is deterministic for the same moved and resized canvas state', () => {
    const rects = [
      rect('source', 22, 82, 160, 100),
      rect('target', 580, 240, 175, 110),
      rect('overview', 240, 42, 230, 340),
      rect('knowledge', 285, 390, 200, 130),
    ];
    const links = [{ id: 'data-overview', source: 'source', target: 'target', label: 'Overview' }];
    expect(routeConnections(rects, links)).toEqual(routeConnections(rects, links));
  });
});
