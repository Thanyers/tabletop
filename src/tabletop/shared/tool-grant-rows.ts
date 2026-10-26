import type { ToolPortRow } from './tool-protocol';
import { projectToolPort, type ProjectionProblem } from './tool-projection';

/**
 * F080 / C6: the rows half of a cross-workspace read.
 *
 * The grant decides *which* fields may be read; this turns those fields into rows at the revision
 * the source is holding right now. It is pure and takes plain records so the Room adapter stays a
 * few lines, and so the "declared ∩ granted, clamped, live revision" rule is testable without a
 * Durable Object.
 */

export interface GrantRowsInput {
  portId: string;
  /** Field allowlist the grant exposes. */
  fields: readonly string[];
  /** Row ceiling the grant allows. */
  maxRows: number;
  /** Live source revision at read time. */
  dataRevision: number;
  ruleRevision: number;
  grantVersion: number;
  /** Display label for the source; never a workspace id. */
  label: string;
  records: readonly { id: string; values: Record<string, unknown> }[];
  readAt: number;
}

export interface GrantRowsResult {
  portId: string;
  rows: ToolPortRow[];
  /** The revision these rows were read at — a caller that caches must quote it back. */
  sourceDataRevision: number;
  problems: ProjectionProblem[];
}

export function projectGrantRows(input: GrantRowsInput): GrantRowsResult {
  const result = projectToolPort(
    {
      id: input.portId,
      label: input.label,
      direction: 'in',
      kind: 'records',
      fields: [...input.fields],
      maxRows: input.maxRows,
    },
    {
      label: input.label,
      dataRevision: input.dataRevision,
      ruleRevision: input.ruleRevision,
      link: 'linked',
      grantedEpoch: 0,
      currentEpoch: 0,
      grantVersion: input.grantVersion,
      grantedFields: input.fields,
      maxRows: input.maxRows,
      rows: input.records,
      readAt: input.readAt,
    },
  );
  return {
    portId: input.portId,
    rows: result.snapshot.rows ?? [],
    sourceDataRevision: input.dataRevision,
    problems: result.problems,
  };
}
