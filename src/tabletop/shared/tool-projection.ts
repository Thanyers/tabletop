import { TOOL_BRIDGE_LIMITS, type ToolPortRow, type ToolPortSnapshot, type ToolScalar } from './tool-protocol';
import type { ToolDataPort } from './tool-package';

/**
 * F080: turning an authorized source table into the projection a tool instance may see.
 *
 * This is the only place where live source data becomes a bridge snapshot, so it is where the
 * narrowest rule lives: a field reaches the frame only when the package declared it *and* the
 * source grant allows it, rows are clamped by all three caps, and the snapshot carries the
 * revision it was read at. The source workspace id stays on the host — the frame gets a label.
 */

export interface ProjectionSourceInput {
  /** Stable source label the frame may show; never the workspace id. */
  label: string;
  /** Source revision counters at read time. */
  dataRevision: number;
  ruleRevision: number;
  /** Live connection state from the source side. */
  link: 'linked' | 'left' | 'revoked' | 'missing';
  /** Epoch the connection was made under; a different current epoch means the link is stale. */
  grantedEpoch: number;
  currentEpoch: number;
  grantVersion: number;
  /** Field ids the source grant exposes to this destination. */
  grantedFields: readonly string[];
  maxRows: number;
  rows: readonly { id: string; values: Readonly<Record<string, unknown>> }[];
  readAt: number;
}

export type ProjectionProblem =
  | 'PROJECTION_NO_PORT_FIELDS'
  | 'PROJECTION_ROW_ID_UNSAFE'
  | 'PROJECTION_DROPPED_NON_SCALAR';

export interface ProjectionResult {
  snapshot: ToolPortSnapshot;
  /** Fields that were declared by the package but are not granted by the source. */
  withheldFields: string[];
  problems: ProjectionProblem[];
}

/** `TableValue` allows a list; the bridge does not, so a list becomes display text. */
function toScalar(value: unknown): ToolScalar | undefined {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) return value.map(entry => String(entry)).join(', ');
  return undefined;
}

function statusOf(source: ProjectionSourceInput): ToolPortSnapshot['status'] {
  if (source.link === 'missing') return 'missing';
  if (source.link !== 'linked') return 'revoked';
  return source.grantedEpoch === source.currentEpoch ? 'live' : 'stale';
}

/**
 * Build one port snapshot.
 *
 * A revoked or missing source still produces a snapshot: the frame must render "unavailable"
 * rather than an empty tool, and an empty list would be indistinguishable from "no rows".
 */
export function projectToolPort(port: ToolDataPort, source: ProjectionSourceInput): ProjectionResult {
  const status = statusOf(source);
  const problems: ProjectionProblem[] = [];
  const declared = port.fields.filter(field => source.grantedFields.includes(field));
  const withheldFields = port.fields.filter(field => !source.grantedFields.includes(field));
  if (port.kind === 'records' && declared.length === 0) problems.push('PROJECTION_NO_PORT_FIELDS');

  const revision = {
    dataRevision: source.dataRevision,
    ruleRevision: source.ruleRevision,
    grantVersion: source.grantVersion,
    readAt: source.readAt,
  };

  if (port.kind !== 'records') {
    return {
      snapshot: {
        portId: port.id,
        kind: port.kind,
        status,
        revision,
        sourceLabel: source.label,
        // A scalar port has no row to read here; the caller binds it from the first row.
        value: null,
      },
      withheldFields,
      problems,
    };
  }

  const cap = Math.max(0, Math.min(port.maxRows, source.maxRows, TOOL_BRIDGE_LIMITS.maxRowsPerPort));
  const rows: ToolPortRow[] = [];
  if (status === 'live' || status === 'stale') {
    for (const row of source.rows.slice(0, cap)) {
      if (row.id.length === 0 || row.id.length > 80) {
        problems.push('PROJECTION_ROW_ID_UNSAFE');
        continue;
      }
      const values: Record<string, ToolScalar> = {};
      for (const field of declared) {
        const scalar = toScalar(row.values[field]);
        if (scalar === undefined) {
          problems.push('PROJECTION_DROPPED_NON_SCALAR');
          continue;
        }
        values[field] = scalar;
      }
      rows.push({ id: row.id, values });
    }
  }

  return {
    snapshot: { portId: port.id, kind: port.kind, status, revision, sourceLabel: source.label, rows },
    withheldFields,
    problems,
  };
}

/** Build every declared `in` port for one instance, in declaration order. */
export function projectToolPorts(
  ports: readonly ToolDataPort[],
  resolve: (port: ToolDataPort) => ProjectionSourceInput | undefined,
): { snapshots: ToolPortSnapshot[]; problems: { portId: string; problems: ProjectionProblem[] }[]; withheld: Record<string, string[]> } {
  const snapshots: ToolPortSnapshot[] = [];
  const problems: { portId: string; problems: ProjectionProblem[] }[] = [];
  const withheld: Record<string, string[]> = {};
  for (const port of ports) {
    if (port.direction !== 'in') continue;
    const source = resolve(port);
    if (!source) {
      snapshots.push({
        portId: port.id,
        kind: port.kind,
        status: 'missing',
        revision: { dataRevision: 0, ruleRevision: 0, grantVersion: 0, readAt: 0 },
        sourceLabel: 'ไม่พบต้นทาง',
        ...(port.kind === 'records' ? { rows: [] } : { value: null }),
      });
      continue;
    }
    const result = projectToolPort(port, source);
    snapshots.push(result.snapshot);
    if (result.problems.length > 0) problems.push({ portId: port.id, problems: result.problems });
    if (result.withheldFields.length > 0) withheld[port.id] = result.withheldFields;
  }
  return { snapshots, problems, withheld };
}
