import type { ToolExportColumn, ToolExportFormat, ToolExportTable } from './tool-export';
import { buildToolExport } from './tool-export';
import { authorizeProjectionRead, type ToolProjectionGrant } from './tool-connection';
import type { ToolPortRow } from './tool-protocol';
import { projectGrantRows } from './tool-grant-rows';

/**
 * F080 / JT-X: exporting one granted projection.
 *
 * Export is a second permission on top of read: a grant that exposes rows to the tool does not
 * automatically allow taking a file away. The file is built from rows read at one revision, so the
 * manifest and the rows cannot disagree, and the same escaping rules apply as for any export.
 */

export interface SpaceExportInput {
  grant: ToolProjectionGrant;
  portId: string;
  actorId: string;
  spaceWorkspaceId: string;
  sourceEpoch: number;
  /** Live revisions of the source at export time. */
  dataRevision: number;
  ruleRevision: number;
  records: readonly { id: string; values: Record<string, unknown> }[];
  format: ToolExportFormat;
  producedAt: number;
}

export type SpaceExportRefusal =
  | 'SPACE_GRANT_NOT_FOUND'
  | 'SPACE_GRANT_REVOKED'
  | 'SPACE_GRANT_STALE_EPOCH'
  | 'SPACE_GRANT_AUDIENCE'
  | 'SPACE_GRANT_PORT'
  | 'EXPORT_NOT_PERMITTED';

export type SpaceExportResult =
  | {
    ok: true;
    filename: string;
    format: ToolExportFormat;
    content: string;
    bytes: number;
    sourceDataRevision: number;
    grantVersion: number;
  }
  | { ok: false; code: SpaceExportRefusal | string; message: string };

function columnType(rows: readonly ToolPortRow[], field: string): ToolExportColumn['type'] {
  for (const row of rows) {
    const value = row.values[field];
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') return 'number';
    if (typeof value === 'boolean') return 'boolean';
    return 'text';
  }
  return 'text';
}

export function buildSpaceExport(input: SpaceExportInput): SpaceExportResult {
  const verdict = authorizeProjectionRead(input.grant, {
    sourceEpoch: input.sourceEpoch,
    actorId: input.actorId,
    portId: input.portId,
    membershipVerifiedBy: 'destination',
  });
  if (!verdict.ok) {
    const code = verdict.code === 'GRANT_FIELD_NOT_PERMITTED' ? 'SPACE_GRANT_PORT' : `SPACE_GRANT_${verdict.code.replace('GRANT_', '')}`;
    return { ok: false, code, message: verdict.message };
  }
  if (!input.grant.exportAllowed) {
    return { ok: false, code: 'EXPORT_NOT_PERMITTED', message: 'This connection may be read but not exported.' };
  }
  const projection = verdict.projection;
  const projected = projectGrantRows({
    portId: projection.portId,
    fields: projection.fields,
    maxRows: projection.maxRows,
    dataRevision: input.dataRevision,
    ruleRevision: input.ruleRevision,
    grantVersion: input.grant.grantVersion,
    label: projection.resource,
    records: input.records,
    readAt: input.producedAt,
  });
  const table: ToolExportTable = {
    id: projection.portId,
    title: projection.resource,
    columns: projection.fields.map(field => ({ id: field, label: field, type: columnType(projected.rows, field) })),
    rows: projected.rows.map(row => ({ id: row.id, values: row.values })),
  };
  const exported = buildToolExport({
    tables: [table],
    snapshot: {
      dataRevision: input.dataRevision,
      ruleRevision: input.ruleRevision,
      packageVersions: {},
      sources: [{ tableId: projection.resource, label: projection.resource, dataRevision: input.dataRevision }],
      readAt: input.producedAt,
    },
    requested: { dataRevision: input.dataRevision, ruleRevision: input.ruleRevision },
    // The grant's export flag is the permission; the grant version is what it was decided at.
    permission: { granted: true, grantVersion: input.grant.grantVersion, currentGrantVersion: input.grant.grantVersion, fields: projection.fields },
    format: input.format,
    producedAt: input.producedAt,
  });
  if (!exported.ok) return { ok: false, code: exported.code, message: exported.message };
  const file = exported.files[0];
  if (!file) return { ok: false, code: 'EXPORT_EMPTY', message: 'There is nothing to export.' };
  return {
    ok: true,
    filename: file.filename,
    format: file.format,
    content: file.content,
    bytes: file.bytes,
    sourceDataRevision: input.dataRevision,
    grantVersion: input.grant.grantVersion,
  };
}
