export interface RoutingRect {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutingLink {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface RoutingPoint {
  x: number;
  y: number;
}

export type RoutingSide = 'top' | 'right' | 'bottom' | 'left';

export interface RoutingBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RoutedConnection extends RoutingLink {
  points: RoutingPoint[];
  path: string;
  sourceSide: RoutingSide | null;
  targetSide: RoutingSide | null;
  sourceHandleId: string | null;
  targetHandleId: string | null;
  labelX: number | null;
  labelY: number | null;
  labelBounds: RoutingBounds | null;
  hidden: boolean;
  /** Breaks this route opens so a line crossing over it stays readable. */
  bridges?: number;
  /** True when this route runs on the upper layer, where two lines cross. */
  crossesOver?: boolean;
  reason?: 'missing-endpoint' | 'invalid-geometry' | 'overlapping-endpoints' | 'no-route';
}

export interface EdgeRoutingOptions {
  /** Minimum card-to-line clearance in canvas units. Defaults to 22. */
  clearance?: number;
  /** Corner radius for the SVG path. Defaults to 8. */
  cornerRadius?: number;
  /** Additional path cost for each turn. Defaults to 28. */
  bendPenalty?: number;
  /** Extra gap around labels when checking card/label collisions. Defaults to 8. */
  labelGap?: number;
  /** Optional conservative card bounds, such as the union of current and target animation bounds. */
  obstacleBounds?: readonly RoutingRect[];
  /**
   * Cards a line may pass under, such as a paper note lying on the canvas.
   * They stay valid endpoints but stop blocking routes.
   */
  crossableIds?: readonly string[];
  /**
   * Half-width of the break left in the lower line at a crossing, in canvas units.
   * The break is what makes an over/under crossing readable. 0 disables bridges.
   * Defaults to 7.
   */
  crossingGap?: number;
  /**
   * Extra cost per canvas unit where a route would run along a line already
   * routed in this batch. Keeps parallel connections in separate lanes instead
   * of drawing one on top of the other. Defaults to 0.6.
   */
  separationCost?: number;
  /**
   * Distance between the anchor points of two lines that share a card face, in
   * canvas units. Keeps a fan-out readable instead of stacking every line on the
   * face midpoint. 0 disables the offsets. Defaults to 9.
   */
  portSpacing?: number;
  /**
   * Distance between the routing lanes offered in the free space between cards,
   * in canvas units. Lanes are what let several lines run side by side instead of
   * on top of each other. Defaults to 14.
   */
  laneSpacing?: number;
}

const SIDES: readonly RoutingSide[] = ['right', 'bottom', 'left', 'top'];
const EAST = 1;
const SOUTH = 2;
const WEST = 3;
const NORTH = 4;
const DIRECTIONS = [EAST, SOUTH, WEST, NORTH] as const;
const EPSILON = 1e-7;
const MAX_GRID_NODES = 160_000;

interface PreparedRect extends RoutingRect {
  right: number;
  bottom: number;
}

interface Obstacle extends PreparedRect {
  left: number;
  top: number;
  /** A crossable card is drawn on top of the lines: routes may pass beneath it. */
  crossable: boolean;
}

interface SideEndpoint {
  anchor: RoutingPoint;
  lead: RoutingPoint;
  outwardDirection: number;
}

interface SearchGrid {
  xs: number[];
  ys: number[];
  xIndexes: Map<number, number>;
  yIndexes: Map<number, number>;
  pointX: Float64Array;
  pointY: Float64Array;
  neighbors: Int32Array;
  neighborLengths: Float64Array;
  nodeCount: number;
  obstacleForCard: Map<string, Obstacle>;
  obstacles: Obstacle[];
}

interface SearchResult {
  distance: Float64Array;
  previous: Int32Array;
}

interface CandidateRoute {
  points: RoutingPoint[];
  sourceSide: RoutingSide;
  targetSide: RoutingSide;
  cost: number;
}

/** Straight runs already taken in this batch, keyed by their lane coordinate. */
interface LaneOccupancy {
  horizontal: Map<number, Array<[number, number]>>;
  vertical: Map<number, Array<[number, number]>>;
}

interface ResolvedRoute {
  index: number;
  source: string;
  target: string;
  points: RoutingPoint[];
  sourceSide: RoutingSide;
  targetSide: RoutingSide;
  labelPlacement: { x: number; y: number; bounds: RoutingBounds } | null;
  cuts: RouteCut[];
  bridges: number;
  crossesOver: boolean;
}

/** A bridge break on one segment of a route: the middle of the crossing plus its half-width. */
interface RouteCut {
  segment: number;
  position: number;
  halfWidth: number;
}

const DEFAULTS = {
  clearance: 22,
  cornerRadius: 8,
  bendPenalty: 28,
  labelGap: 8,
  crossingGap: 7,
  separationCost: 0.6,
  portSpacing: 9,
  laneSpacing: 14,
} as const;

type RoutingSettings = {
  clearance: number;
  cornerRadius: number;
  bendPenalty: number;
  labelGap: number;
  crossingGap: number;
  separationCost: number;
  portSpacing: number;
  laneSpacing: number;
};

/**
 * Route each directed connection around padded card bounds on a sparse
 * rectilinear visibility grid. The grid is built once for the whole batch;
 * endpoints leave and enter their cards along a selected cardinal port.
 *
 * Routes with missing/invalid endpoints or no safe path are returned hidden
 * with an empty path so callers never have to display a guessed crossing.
 */
export function routeConnections(
  rects: readonly RoutingRect[],
  links: readonly RoutingLink[],
  options: EdgeRoutingOptions = {},
): RoutedConnection[] {
  const settings: RoutingSettings = {
    clearance: finiteNonNegative(options.clearance, DEFAULTS.clearance),
    cornerRadius: finiteNonNegative(options.cornerRadius, DEFAULTS.cornerRadius),
    bendPenalty: finiteNonNegative(options.bendPenalty, DEFAULTS.bendPenalty),
    labelGap: finiteNonNegative(options.labelGap, DEFAULTS.labelGap),
    crossingGap: finiteNonNegative(options.crossingGap, DEFAULTS.crossingGap),
    separationCost: finiteNonNegative(options.separationCost, DEFAULTS.separationCost),
    portSpacing: finiteNonNegative(options.portSpacing, DEFAULTS.portSpacing),
    laneSpacing: finiteNonNegative(options.laneSpacing, DEFAULTS.laneSpacing),
  };
  const crossableIds = new Set(options.crossableIds ?? []);
  const rectMap = new Map<string, PreparedRect>();
  let invalidGeometry = false;
  for (const rect of rects) {
    if (!isValidRect(rect) || rectMap.has(rect.id)) {
      invalidGeometry = true;
      continue;
    }
    rectMap.set(rect.id, { ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height });
  }
  const suppliedBounds = new Map<string, PreparedRect>();
  for (const rect of options.obstacleBounds ?? []) {
    if (!isValidRect(rect) || suppliedBounds.has(rect.id)) {
      invalidGeometry = true;
      continue;
    }
    suppliedBounds.set(rect.id, { ...rect, right: rect.x + rect.width, bottom: rect.y + rect.height });
  }
  if (invalidGeometry) return links.map((link) => hiddenRoute(link, 'invalid-geometry'));

  const routes = new Map<number, RoutedConnection>();
  const routable: Array<{ index: number; link: RoutingLink; source: PreparedRect; target: PreparedRect }> = [];
  links.forEach((link, index) => {
    const source = rectMap.get(link.source);
    const target = rectMap.get(link.target);
    if (!source || !target) {
      routes.set(index, hiddenRoute(link, 'missing-endpoint'));
      return;
    }
    if (!isValidRect(source) || !isValidRect(target)) {
      routes.set(index, hiddenRoute(link, 'invalid-geometry'));
      return;
    }
    if (source.id === target.id) {
      routes.set(index, hiddenRoute(link, 'overlapping-endpoints'));
      return;
    }
    routable.push({ index, link, source, target });
  });

  if (routable.length === 0) return links.map((_, index) => routes.get(index)!);

  // Envelopes are unioned with current DOM bounds so a stale or undersized
  // prediction can never make the router forget the card that is visible now.
  const routingBounds = new Map<string, PreparedRect>();
  for (const rect of rectMap.values()) {
    const envelope = suppliedBounds.get(rect.id);
    routingBounds.set(rect.id, envelope ? unionRects(rect, envelope) : rect);
  }
  for (const [id, envelope] of suppliedBounds) {
    if (!routingBounds.has(id)) routingBounds.set(id, envelope);
  }

  const obstacles = [...routingBounds.values()].map((rect) => expandRect(rect, settings.clearance, crossableIds.has(rect.id)));
  const labelBounds: RoutingBounds[] = [];
  // Labels stay clear of every card, including the notes a line may pass under:
  // paper may cover a line, but never the words printed on it.
  const labelObstacles = [...routingBounds.values()].map((rect) => expandRect(rect, settings.labelGap, false));

  // Stable ordering makes label placement repeatable if a caller changes its
  // edge array order while retaining the same IDs.
  routable.sort((left, right) => left.link.id.localeCompare(right.link.id) || left.index - right.index);

  // Lines that share a card leave it from different points instead of stacking on
  // one anchor; the offsets are part of the grid, so the router keeps clearance.
  const sourceOffsets = portOffsets(routable.map((item) => ({ key: item.link.source, index: item.index })), settings.portSpacing, rectMap);
  const targetOffsets = portOffsets(routable.map((item) => ({ key: item.link.target, index: item.index })), settings.portSpacing, rectMap);
  const grid = buildGrid([...rectMap.values()], obstacles, [...sourceOffsets.values(), ...targetOffsets.values()], settings.laneSpacing);

  // Routes are placed one after another, and each remembers its straight runs.
  // Later routes pay a small cost for reusing a lane, so parallel connections
  // settle into separate lanes instead of drawing one line on top of another.
  const occupancy: LaneOccupancy = { horizontal: new Map(), vertical: new Map() };
  const resolved: ResolvedRoute[] = [];

  for (const item of routable) {
    const result = routeOne(
      item.source,
      item.target,
      grid,
      settings,
      occupancy,
      sourceOffsets.get(item.index) ?? 0,
      targetOffsets.get(item.index) ?? 0,
    );
    if (!result) {
      routes.set(item.index, hiddenRoute(item.link, invalidGeometry ? 'invalid-geometry' : 'no-route'));
      continue;
    }
    const label = item.link.label?.trim();
    const labelPlacement = label
      ? placeLabel(label, result.points, labelObstacles, labelBounds, settings.labelGap)
      : null;
    if (labelPlacement) labelBounds.push(labelPlacement.bounds);
    rememberLanes(occupancy, result.points);
    resolved.push({
      index: item.index,
      source: item.link.source,
      target: item.link.target,
      points: result.points,
      sourceSide: result.sourceSide,
      targetSide: result.targetSide,
      labelPlacement,
      cuts: [],
      bridges: 0,
      crossesOver: false,
    });
  }

  if (settings.crossingGap > 0) markCrossings(resolved, settings.crossingGap);

  for (const route of resolved) {
    const path = bridgedPath(route.points, route.cuts, settings.cornerRadius);
    if (!path) {
      routes.set(route.index, hiddenRoute(links[route.index]!, 'no-route'));
      continue;
    }
    routes.set(route.index, {
      ...links[route.index]!,
      points: route.points,
      path,
      bridges: route.bridges,
      crossesOver: route.crossesOver,
      sourceSide: route.sourceSide,
      targetSide: route.targetSide,
      sourceHandleId: `source-${route.sourceSide}`,
      targetHandleId: `target-${route.targetSide}`,
      labelX: route.labelPlacement?.x ?? null,
      labelY: route.labelPlacement?.y ?? null,
      labelBounds: route.labelPlacement?.bounds ?? null,
      hidden: false,
    });
  }

  return links.map((_, index) => routes.get(index)!);
}

/**
 * Add evenly spaced lanes inside the free gaps between card boundaries. Without
 * them the only lines a route can use run along card edges, so several parallel
 * connections end up drawing on the same line.
 */
function withLanes(values: readonly number[], spacing: number): number[] {
  const sorted = [...new Set(values)].filter(Number.isFinite).sort((left, right) => left - right);
  if (!(spacing > 0)) return sorted;
  const result = new Set(sorted);
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const low = sorted[index]!;
    const high = sorted[index + 1]!;
    const gap = high - low;
    if (gap < spacing * 2.5) continue;
    const count = Math.min(4, Math.floor(gap / spacing) - 1);
    for (let lane = 1; lane <= count; lane += 1) result.add(low + (gap * lane) / (count + 1));
  }
  return [...result].sort((left, right) => left - right);
}

function routeOne(
  source: PreparedRect,
  target: PreparedRect,
  grid: SearchGrid,
  settings: RoutingSettings,
  occupancy: LaneOccupancy,
  sourceOffset: number,
  targetOffset: number,
): CandidateRoute | null {
  const paddedSource = grid.obstacleForCard.get(source.id);
  const paddedTarget = grid.obstacleForCard.get(target.id);
  if (!paddedSource || !paddedTarget) return null;

  let best: CandidateRoute | null = null;
  for (const sourceSide of SIDES) {
    const from = endpoint(source, sourceSide, paddedSource, sourceOffset);
    const start = gridNode(grid, from.lead);
    if (start === null || blockedStub(from.anchor, from.lead, grid.obstacles, source.id)) continue;

    const targetEndpoints = SIDES.map((targetSide) => {
      const to = endpoint(target, targetSide, paddedTarget, targetOffset);
      return { side: targetSide, endpoint: to, node: gridNode(grid, to.lead) };
    });
    const usableTargets = targetEndpoints.filter(({ node, endpoint: to }) =>
      node !== null && !blockedStub(to.anchor, to.lead, grid.obstacles, target.id));
    if (usableTargets.length === 0) continue;

    const search = shortestPaths(grid, start, from.outwardDirection, usableTargets, settings, occupancy);
    for (const candidate of usableTargets) {
      const arrivalDirection = opposite(candidate.endpoint.outwardDirection);
      const targetState = candidate.node! * 5 + arrivalDirection;
      const routeCost = search.distance[targetState];
      if (!Number.isFinite(routeCost)) continue;
      const totalCost = routeCost + manhattan(from.anchor, from.lead) + manhattan(candidate.endpoint.lead, candidate.endpoint.anchor);
      if (best && totalCost >= best.cost - EPSILON) continue;

      const gridPoints = reconstructPoints(grid, search.previous, start * 5, targetState);
      if (!gridPoints) continue;
      const points = compressPoints([
        from.anchor,
        ...gridPoints,
        candidate.endpoint.anchor,
      ]);
      if (points.length < 2) continue;
      best = { points, sourceSide, targetSide: candidate.side, cost: totalCost };
    }
  }
  return best;
}

function buildGrid(
  rects: readonly PreparedRect[],
  obstacles: readonly Obstacle[],
  portOffsets: readonly number[] = [],
  laneSpacing = 0,
): SearchGrid {
  const xValues = new Set<number>();
  const yValues = new Set<number>();
  for (const obstacle of obstacles) {
    xValues.add(obstacle.left);
    xValues.add(obstacle.right);
    yValues.add(obstacle.top);
    yValues.add(obstacle.bottom);
  }
  for (const rect of rects) {
    // Every named port lead is an intersection of one padded face and the
    // centerline of a card. Including centers lets every edge share this grid.
    xValues.add(rect.x + rect.width / 2);
    yValues.add(rect.y + rect.height / 2);
    // A spread port sits beside the centerline; its lead must be a grid node too.
    for (const offset of portOffsets) {
      if (!Number.isFinite(offset) || Math.abs(offset) <= EPSILON) continue;
      xValues.add(rect.x + rect.width / 2 + offset);
      yValues.add(rect.y + rect.height / 2 + offset);
    }
  }
  const xs = withLanes([...xValues], laneSpacing);
  const ys = withLanes([...yValues], laneSpacing);
  const xIndexes = new Map(xs.map((value, index) => [value, index]));
  const yIndexes = new Map(ys.map((value, index) => [value, index]));
  const nodeCount = xs.length * ys.length;
  const obstacleForCard = new Map(obstacles.map((obstacle) => [obstacle.id, obstacle]));
  if (nodeCount <= 0 || nodeCount > MAX_GRID_NODES) {
    return {
      xs, ys, xIndexes, yIndexes, pointX: new Float64Array(), pointY: new Float64Array(),
      neighbors: new Int32Array(), neighborLengths: new Float64Array(), nodeCount: 0,
      obstacleForCard, obstacles: [...obstacles],
    };
  }

  const pointX = new Float64Array(nodeCount);
  const pointY = new Float64Array(nodeCount);
  const valid = new Uint8Array(nodeCount);
  for (let yi = 0; yi < ys.length; yi += 1) {
    for (let xi = 0; xi < xs.length; xi += 1) {
      const node = yi * xs.length + xi;
      pointX[node] = xs[xi]!;
      pointY[node] = ys[yi]!;
      valid[node] = pointBlocked({ x: pointX[node]!, y: pointY[node]! }, obstacles) ? 0 : 1;
    }
  }

  const neighbors = new Int32Array(nodeCount * 4).fill(-1);
  const neighborLengths = new Float64Array(nodeCount * 4);
  for (let yi = 0; yi < ys.length; yi += 1) {
    for (let xi = 0; xi < xs.length; xi += 1) {
      const node = yi * xs.length + xi;
      if (!valid[node]) continue;
      const point = { x: pointX[node]!, y: pointY[node]! };
      const candidates = [
        xi + 1 < xs.length ? node + 1 : -1,
        yi + 1 < ys.length ? node + xs.length : -1,
        xi > 0 ? node - 1 : -1,
        yi > 0 ? node - xs.length : -1,
      ];
      for (let direction = 0; direction < candidates.length; direction += 1) {
        const neighbor = candidates[direction]!;
        if (neighbor < 0 || !valid[neighbor]) continue;
        const next = { x: pointX[neighbor]!, y: pointY[neighbor]! };
        if (segmentBlocked(point, next, obstacles)) continue;
        neighbors[node * 4 + direction] = neighbor;
        neighborLengths[node * 4 + direction] = manhattan(point, next);
      }
    }
  }
  return {
    xs, ys, xIndexes, yIndexes, pointX, pointY, neighbors, neighborLengths,
    nodeCount, obstacleForCard, obstacles: [...obstacles],
  };
}

function shortestPaths(
  grid: SearchGrid,
  start: number,
  initialDirection: number,
  targets: readonly { node: number | null; endpoint: SideEndpoint }[],
  settings: RoutingSettings,
  occupancy: LaneOccupancy,
): SearchResult {
  const bendPenalty = settings.bendPenalty;
  const stateCount = grid.nodeCount * 5;
  const distance = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount).fill(-1);
  const startState = start * 5;
  distance[startState] = 0;
  const heap = new MinHeap();
  heap.push(startState, 0);
  const unfinished = new Set<number>();
  for (const target of targets) {
    if (target.node === null) continue;
    unfinished.add(target.node * 5 + opposite(target.endpoint.outwardDirection));
  }

  while (heap.size > 0) {
    const entry = heap.pop()!;
    if (entry.priority > distance[entry.state]! + EPSILON) continue;
    if (unfinished.delete(entry.state) && unfinished.size === 0) break;
    const node = Math.floor(entry.state / 5);
    const priorDirection = entry.state % 5;
    const from = { x: grid.pointX[node]!, y: grid.pointY[node]! };
    for (let slot = 0; slot < 4; slot += 1) {
      const neighbor = grid.neighbors[node * 4 + slot]!;
      if (neighbor < 0) continue;
      const direction = DIRECTIONS[slot]!;
      if (priorDirection === 0 && direction !== initialDirection) continue;
      const bendCost = priorDirection !== 0 && direction !== priorDirection ? bendPenalty : 0;
      const to = { x: grid.pointX[neighbor]!, y: grid.pointY[neighbor]! };
      const nextState = neighbor * 5 + direction;
      const candidate = entry.priority
        + grid.neighborLengths[node * 4 + slot]!
        + bendCost
        + laneCost(from, to, occupancy, settings.separationCost);
      if (candidate + EPSILON >= distance[nextState]!) continue;
      distance[nextState] = candidate;
      previous[nextState] = entry.state;
      heap.push(nextState, candidate);
    }
  }
  return { distance, previous };
}

function endpoint(rect: PreparedRect, side: RoutingSide, paddedEnvelope: Obstacle, offset = 0): SideEndpoint {
  const centerX = rect.x + rect.width / 2 + offset;
  const centerY = rect.y + rect.height / 2 + offset;
  switch (side) {
    case 'top': return {
      anchor: { x: centerX, y: rect.y },
      lead: { x: centerX, y: paddedEnvelope.top },
      outwardDirection: NORTH,
    };
    case 'right': return {
      anchor: { x: rect.right, y: centerY },
      lead: { x: paddedEnvelope.right, y: centerY },
      outwardDirection: EAST,
    };
    case 'bottom': return {
      anchor: { x: centerX, y: rect.bottom },
      lead: { x: centerX, y: paddedEnvelope.bottom },
      outwardDirection: SOUTH,
    };
    case 'left': return {
      anchor: { x: rect.x, y: centerY },
      lead: { x: paddedEnvelope.left, y: centerY },
      outwardDirection: WEST,
    };
  }
}

function gridNode(grid: SearchGrid, point: RoutingPoint): number | null {
  const xi = grid.xIndexes.get(point.x);
  const yi = grid.yIndexes.get(point.y);
  if (xi === undefined || yi === undefined || grid.nodeCount === 0) return null;
  const node = yi * grid.xs.length + xi;
  if (node >= grid.nodeCount || pointBlocked(point, grid.obstacles)) return null;
  return node;
}

function reconstructPoints(
  grid: SearchGrid,
  previous: Int32Array,
  startState: number,
  targetState: number,
): RoutingPoint[] | null {
  const reversed: RoutingPoint[] = [];
  let state = targetState;
  while (state !== startState) {
    if (state < 0 || state >= previous.length) return null;
    const node = Math.floor(state / 5);
    reversed.push({ x: grid.pointX[node]!, y: grid.pointY[node]! });
    state = previous[state]!;
    if (state < 0) return null;
  }
  const startNode = Math.floor(startState / 5);
  reversed.push({ x: grid.pointX[startNode]!, y: grid.pointY[startNode]! });
  reversed.reverse();
  return reversed;
}

function placeLabel(
  label: string,
  points: readonly RoutingPoint[],
  obstacles: readonly Obstacle[],
  occupied: readonly RoutingBounds[],
  gap: number,
): { x: number; y: number; bounds: RoutingBounds } | null {
  const size = estimateLabelSize(label);
  const segments: Array<{ index: number; length: number; horizontal: boolean; minimumLength: number }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const horizontal = Math.abs(to.y - from.y) <= EPSILON;
    const vertical = Math.abs(to.x - from.x) <= EPSILON;
    if (!horizontal && !vertical) continue;
    const length = manhattan(from, to);
    const minimumLength = (horizontal ? size.width : size.height) + gap * 2;
    if (length >= minimumLength) segments.push({ index, length, horizontal, minimumLength });
  }
  segments.sort((left, right) => right.length - left.length || left.index - right.index);

  for (const segment of segments) {
    const from = points[segment.index]!;
    const to = points[segment.index + 1]!;
    const low = segment.horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const high = segment.horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    const half = (segment.horizontal ? size.width : size.height) / 2 + gap;
    const center = (low + high) / 2;
    const positions = [center, low + half, high - half, low + (high - low) * 0.35, low + (high - low) * 0.65];
    for (const axisPosition of positions) {
      if (axisPosition - half < low - EPSILON || axisPosition + half > high + EPSILON) continue;
      const x = segment.horizontal ? axisPosition : from.x;
      const y = segment.horizontal ? from.y : axisPosition;
      const bounds = { x: x - size.width / 2, y: y - size.height / 2, width: size.width, height: size.height };
      if (obstacles.some((obstacle) => overlaps(bounds, obstacle))) continue;
      if (occupied.some((prior) => overlapsBounds(bounds, prior))) continue;
      return { x, y, bounds };
    }
  }
  return null;
}

function estimateLabelSize(label: string): { width: number; height: number } {
  let textWidth = 0;
  for (const character of label) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 32) textWidth += 3.5;
    else if (code >= 0x0e00 && code <= 0x0e7f) {
      // Thai combining marks sit above/below a consonant and add no width.
      if (!((code >= 0x0e31 && code <= 0x0e3a) || (code >= 0x0e47 && code <= 0x0e4e))) textWidth += 10.2;
    } else if ('ilI.,:;!|'.includes(character)) textWidth += 3.5;
    else if ('MW@%'.includes(character)) textWidth += 8.8;
    else textWidth += 6.1;
  }
  const naturalWidth = Math.max(48, textWidth + 18);
  const width = Math.min(190, naturalWidth);
  const lines = Math.max(1, Math.ceil(naturalWidth / width));
  return { width, height: 14 + lines * 12 };
}

function roundedPath(points: readonly RoutingPoint[], requestedRadius: number): string {
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return '';
  let path = `M ${formatNumber(points[0]!.x)} ${formatNumber(points[0]!.y)}`;
  if (points.length === 2) return `${path} L ${formatNumber(points[1]!.x)} ${formatNumber(points[1]!.y)}`;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1]!;
    const corner = points[index]!;
    const next = points[index + 1]!;
    const previousLength = manhattan(previous, corner);
    const nextLength = manhattan(corner, next);
    const collinear = Math.abs((corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x)) <= EPSILON;
    if (collinear || previousLength <= EPSILON || nextLength <= EPSILON || requestedRadius <= EPSILON) {
      path += ` L ${formatNumber(corner.x)} ${formatNumber(corner.y)}`;
      continue;
    }
    const radius = Math.min(requestedRadius, previousLength / 2, nextLength / 2);
    const before = {
      x: corner.x + (previous.x - corner.x) * radius / previousLength,
      y: corner.y + (previous.y - corner.y) * radius / previousLength,
    };
    const after = {
      x: corner.x + (next.x - corner.x) * radius / nextLength,
      y: corner.y + (next.y - corner.y) * radius / nextLength,
    };
    path += ` L ${formatNumber(before.x)} ${formatNumber(before.y)} Q ${formatNumber(corner.x)} ${formatNumber(corner.y)} ${formatNumber(after.x)} ${formatNumber(after.y)}`;
  }
  const last = points.at(-1)!;
  path += ` L ${formatNumber(last.x)} ${formatNumber(last.y)}`;
  return path;
}

/**
 * Draw a route with readable over/under crossings: each cut opens a short break
 * in the line, so the line that stays continuous visibly passes over it.
 * A break also splits the path into separate subpaths, which keeps corner
 * rounding out of the gaps.
 */
function bridgedPath(points: readonly RoutingPoint[], cuts: readonly RouteCut[], radius: number): string {
  if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) return '';
  if (cuts.length === 0) return roundedPath(points, radius);

  const spans: Array<{ from: RoutingPoint; to: RoutingPoint }> = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    const length = manhattan(from, to);
    if (length <= EPSILON) continue;
    const unit = { x: (to.x - from.x) / length, y: (to.y - from.y) / length };
    const at = (position: number): RoutingPoint => ({ x: from.x + unit.x * position, y: from.y + unit.y * position });
    const merged = mergeCuts(cuts.filter((cut) => cut.segment === index), length);
    let cursor = 0;
    for (const [start, end] of merged) {
      if (start > cursor + 0.5) spans.push({ from: at(cursor), to: at(start) });
      cursor = Math.max(cursor, end);
    }
    if (length > cursor + 0.5) spans.push({ from: at(cursor), to: at(length) });
  }
  if (spans.length === 0) return '';

  const runs: RoutingPoint[][] = [];
  for (const span of spans) {
    const current = runs.at(-1);
    if (current && samePoint(current.at(-1)!, span.from)) current.push(span.to);
    else runs.push([span.from, span.to]);
  }
  return runs.map((run) => roundedPath(run, radius)).filter((path) => path !== '').join(' ');
}

/** Resolve overlapping cuts on one segment into clamped, merged visible intervals. */
function mergeCuts(cuts: readonly RouteCut[], length: number): Array<[number, number]> {
  const intervals = cuts
    .map((cut) => {
      const position = Math.min(Math.max(cut.position, 0), length);
      return [Math.max(0, position - cut.halfWidth), Math.min(length, position + cut.halfWidth)] as [number, number];
    })
    .filter(([start, end]) => end - start > 0.5)
    .sort((left, right) => left[0] - right[0]);
  const merged: Array<[number, number]> = [];
  for (const [start, end] of intervals) {
    const last = merged.at(-1);
    if (last && start <= last[1] + 0.5) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
}

/**
 * Spread the anchors of lines that share one card. Without this, every
 * connection leaving the same side of a card starts from the same pixel and the
 * fan-out reads as one thick line.
 */
function portOffsets(
  entries: ReadonlyArray<{ key: string; index: number }>,
  spacing: number,
  rects: ReadonlyMap<string, PreparedRect>,
): Map<number, number> {
  const offsets = new Map<number, number>();
  if (spacing <= 0) return offsets;
  const groups = new Map<string, number[]>();
  for (const entry of entries) {
    const group = groups.get(entry.key);
    if (group) group.push(entry.index);
    else groups.set(entry.key, [entry.index]);
  }
  for (const [cardId, indexes] of groups) {
    if (indexes.length < 2) continue;
    const rect = rects.get(cardId);
    if (!rect) continue;
    const total = (indexes.length - 1) * spacing;
    const room = Math.max(0, Math.min(rect.width, rect.height) / 2 - 24);
    const scale = total <= 0 ? 1 : Math.min(1, room / (total / 2));
    if (scale <= EPSILON) continue;
    indexes.forEach((index, position) => offsets.set(index, (position * spacing - total / 2) * scale));
  }
  return offsets;
}

/**
 * Mark every place where two routes cross. The horizontal line stays continuous
 * and the vertical line opens a bridge, so "which one is on top" is never a guess.
 */
function markCrossings(routes: readonly ResolvedRoute[], gap: number): void {
  if (routes.length < 2) return;
  const participating = new Set<number>();
  for (let left = 0; left < routes.length; left += 1) {
    for (let right = left + 1; right < routes.length; right += 1) {
      const a = routes[left]!;
      const b = routes[right]!;
      const aSegments = segmentInfos(a.points);
      const bSegments = segmentInfos(b.points);
      for (const segmentA of aSegments) {
        for (const segmentB of bSegments) {
          if (segmentA.horizontal === segmentB.horizontal) continue;
          const horizontal = segmentA.horizontal ? segmentA : segmentB;
          const vertical = segmentA.horizontal ? segmentB : segmentA;
          const crossingX = vertical.fixed;
          const crossingY = horizontal.fixed;
          if (!(crossingX > horizontal.low + gap * 2 && crossingX < horizontal.high - gap * 2)) continue;
          if (!(crossingY > vertical.low + gap * 2 && crossingY < vertical.high - gap * 2)) continue;
          const under = segmentA.horizontal ? b : a;
          const underSegment = segmentA.horizontal ? segmentB : segmentA;
          const crossingAlong = underSegment.horizontal ? crossingX : crossingY;
          under.cuts.push({ segment: underSegment.index, position: crossingAlong - underSegment.low, halfWidth: gap });
          participating.add(left);
          participating.add(right);
        }
      }
    }
  }
  for (let index = 0; index < routes.length; index += 1) {
    const route = routes[index]!;
    route.bridges = route.cuts.length;
    route.crossesOver = participating.has(index) && route.bridges === 0;
  }
}

interface SegmentInfo {
  index: number;
  horizontal: boolean;
  fixed: number;
  low: number;
  high: number;
}

function segmentInfos(points: readonly RoutingPoint[]): SegmentInfo[] {
  const segments: SegmentInfo[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const from = points[index]!;
    const to = points[index + 1]!;
    if (Math.abs(from.y - to.y) <= EPSILON) {
      segments.push({ index, horizontal: true, fixed: from.y, low: Math.min(from.x, to.x), high: Math.max(from.x, to.x) });
    } else if (Math.abs(from.x - to.x) <= EPSILON) {
      segments.push({ index, horizontal: false, fixed: from.x, low: Math.min(from.y, to.y), high: Math.max(from.y, to.y) });
    }
  }
  return segments;
}

/** Straight runs taken by already placed routes, so later routes can keep their own lane. */
function rememberLanes(occupancy: LaneOccupancy, points: readonly RoutingPoint[]): void {
  for (const segment of segmentInfos(points)) {
    if (segment.high - segment.low <= EPSILON) continue;
    const table = segment.horizontal ? occupancy.horizontal : occupancy.vertical;
    const lane = laneKey(segment.fixed);
    const interval: [number, number] = [segment.low, segment.high];
    const existing = table.get(lane);
    if (existing) existing.push(interval);
    else table.set(lane, [interval]);
  }
}

/** Cost of drawing along a lane another route already uses. 0 when the lane is free. */
function laneCost(
  from: RoutingPoint,
  to: RoutingPoint,
  occupancy: LaneOccupancy,
  costPerUnit: number,
): number {
  if (costPerUnit <= 0) return 0;
  const horizontal = Math.abs(from.y - to.y) <= EPSILON;
  if (!horizontal && Math.abs(from.x - to.x) > EPSILON) return 0;
  const table = horizontal ? occupancy.horizontal : occupancy.vertical;
  const intervals = table.get(laneKey(horizontal ? from.y : from.x));
  if (!intervals || intervals.length === 0) return 0;
  const low = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
  const high = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
  let shared = 0;
  for (const [start, end] of intervals) shared += Math.max(0, Math.min(high, end) - Math.max(low, start));
  return shared * costPerUnit;
}

function laneKey(value: number): number {
  return Math.round(value * 4) / 4;
}

function samePoint(left: RoutingPoint, right: RoutingPoint): boolean {
  return Math.abs(left.x - right.x) <= EPSILON && Math.abs(left.y - right.y) <= EPSILON;
}

function compressPoints(points: readonly RoutingPoint[]): RoutingPoint[] {
  const result: RoutingPoint[] = [];
  for (const point of points) {
    if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return [];
    const last = result.at(-1);
    if (last && manhattan(last, point) <= EPSILON) continue;
    while (result.length >= 2) {
      const first = result[result.length - 2]!;
      const middle = result[result.length - 1]!;
      const cross = (middle.x - first.x) * (point.y - middle.y) - (middle.y - first.y) * (point.x - middle.x);
      const dot = (middle.x - first.x) * (point.x - middle.x) + (middle.y - first.y) * (point.y - middle.y);
      if (Math.abs(cross) > EPSILON || dot < -EPSILON) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function pointBlocked(point: RoutingPoint, obstacles: readonly Obstacle[]): boolean {
  return obstacles.some((obstacle) => !obstacle.crossable
    && point.x > obstacle.left + EPSILON
    && point.x < obstacle.right - EPSILON
    && point.y > obstacle.top + EPSILON
    && point.y < obstacle.bottom - EPSILON);
}

function segmentBlocked(from: RoutingPoint, to: RoutingPoint, obstacles: readonly Obstacle[]): boolean {
  if (Math.abs(from.y - to.y) <= EPSILON) {
    const low = Math.min(from.x, to.x);
    const high = Math.max(from.x, to.x);
    return obstacles.some((obstacle) => !obstacle.crossable
      && from.y > obstacle.top + EPSILON
      && from.y < obstacle.bottom - EPSILON
      && high > obstacle.left + EPSILON
      && low < obstacle.right - EPSILON);
  }
  if (Math.abs(from.x - to.x) <= EPSILON) {
    const low = Math.min(from.y, to.y);
    const high = Math.max(from.y, to.y);
    return obstacles.some((obstacle) => !obstacle.crossable
      && from.x > obstacle.left + EPSILON
      && from.x < obstacle.right - EPSILON
      && high > obstacle.top + EPSILON
      && low < obstacle.bottom - EPSILON);
  }
  return true;
}

function blockedStub(
  anchor: RoutingPoint,
  lead: RoutingPoint,
  obstacles: readonly Obstacle[],
  endpointId: string,
): boolean {
  return obstacles.some((obstacle) => obstacle.id !== endpointId && segmentBlocked(anchor, lead, [obstacle]));
}

function expandRect(rect: PreparedRect, margin: number, crossable: boolean): Obstacle {
  return {
    ...rect,
    left: rect.x - margin,
    top: rect.y - margin,
    right: rect.right + margin,
    bottom: rect.bottom + margin,
    crossable,
  };
}

function unionRects(left: PreparedRect, right: PreparedRect): PreparedRect {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const farRight = Math.max(left.right, right.right);
  const farBottom = Math.max(left.bottom, right.bottom);
  return { id: left.id, x, y, width: farRight - x, height: farBottom - y, right: farRight, bottom: farBottom };
}

function isValidRect(rect: RoutingRect): boolean {
  return rect.id.trim() !== ''
    && Number.isFinite(rect.x)
    && Number.isFinite(rect.y)
    && Number.isFinite(rect.width)
    && Number.isFinite(rect.height)
    && rect.width > 0
    && rect.height > 0
    && Number.isFinite(rect.x + rect.width)
    && Number.isFinite(rect.y + rect.height);
}

function finiteNonNegative(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function hiddenRoute(link: RoutingLink, reason: RoutedConnection['reason']): RoutedConnection {
  return {
    ...link,
    points: [],
    path: '',
    sourceSide: null,
    targetSide: null,
    sourceHandleId: null,
    targetHandleId: null,
    labelX: null,
    labelY: null,
    labelBounds: null,
    hidden: true,
    reason,
  };
}

function opposite(direction: number): number {
  switch (direction) {
    case EAST: return WEST;
    case SOUTH: return NORTH;
    case WEST: return EAST;
    default: return SOUTH;
  }
}

function overlaps(bounds: RoutingBounds, rect: Pick<Obstacle, 'left' | 'top' | 'right' | 'bottom'>): boolean {
  return bounds.x < rect.right - EPSILON
    && bounds.x + bounds.width > rect.left + EPSILON
    && bounds.y < rect.bottom - EPSILON
    && bounds.y + bounds.height > rect.top + EPSILON;
}

function overlapsBounds(left: RoutingBounds, right: RoutingBounds): boolean {
  return left.x < right.x + right.width - EPSILON
    && left.x + left.width > right.x + EPSILON
    && left.y < right.y + right.height - EPSILON
    && left.y + left.height > right.y + EPSILON;
}

function manhattan(left: RoutingPoint, right: RoutingPoint): number {
  return Math.abs(left.x - right.x) + Math.abs(left.y - right.y);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(3)).toString();
}

class MinHeap {
  private states: number[] = [];
  private priorities: number[] = [];

  get size(): number { return this.states.length; }

  push(state: number, priority: number): void {
    let index = this.states.length;
    this.states.push(state);
    this.priorities.push(priority);
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (!this.isLess(priority, state, this.priorities[parent]!, this.states[parent]!)) break;
      this.states[index] = this.states[parent]!;
      this.priorities[index] = this.priorities[parent]!;
      index = parent;
    }
    this.states[index] = state;
    this.priorities[index] = priority;
  }

  pop(): { state: number; priority: number } | null {
    if (this.states.length === 0) return null;
    const root = { state: this.states[0]!, priority: this.priorities[0]! };
    const lastState = this.states.pop()!;
    const lastPriority = this.priorities.pop()!;
    if (this.states.length === 0) return root;
    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.states.length) break;
      let child = left;
      if (right < this.states.length && this.isLess(this.priorities[right]!, this.states[right]!, this.priorities[left]!, this.states[left]!)) {
        child = right;
      }
      if (!this.isLess(this.priorities[child]!, this.states[child]!, lastPriority, lastState)) break;
      this.states[index] = this.states[child]!;
      this.priorities[index] = this.priorities[child]!;
      index = child;
    }
    this.states[index] = lastState;
    this.priorities[index] = lastPriority;
    return root;
  }

  private isLess(leftPriority: number, leftState: number, rightPriority: number, rightState: number): boolean {
    return leftPriority < rightPriority - EPSILON
      || (Math.abs(leftPriority - rightPriority) <= EPSILON && leftState < rightState);
  }
}
