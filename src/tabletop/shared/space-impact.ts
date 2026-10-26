import type { GrantedConnection } from './space-grants';
import type { SpaceRecap } from './space-recap';

/**
 * F080 / JT-4A: what a changed source actually affects.
 *
 * A recap says a source moved; this says *which of its ports* a tool was reading, so a person can
 * decide whether to re-read before acting. It is derived from the grants the source issued, not from
 * the tool's own claims, so a tool cannot be told it depends on a port the grant never exposed.
 */

export interface ImpactedPort {
  workspaceId: string;
  grantId: string;
  portId: string;
  /** `changed` keeps reading (a newer revision is available); `withdrawn` stops reading. */
  kind: 'changed' | 'withdrawn';
  from?: number;
  to?: number;
}

export interface SpaceImpact {
  workspaceId: string;
  ports: ImpactedPort[];
  /** Ports that can no longer be read until the source grants the room again. */
  blocked: ImpactedPort[];
  /** A sentence a person can act on; never claims which tool is at fault. */
  summary: string;
}

/**
 * @param connections the grants the source issued to the room
 * @param recap the room's current recap (only `changed` and `withdrawn` matter here)
 */
export function impactOfSourceChange(
  connections: readonly GrantedConnection[],
  recap: Pick<SpaceRecap, 'changed' | 'withdrawn'>,
  workspaceId: string,
): SpaceImpact {
  const portsOf = (grantId: string): string[] => connections.find(entry => entry.grantId === grantId)?.ports ?? [];
  const ports: ImpactedPort[] = [];

  for (const change of recap.changed) {
    if (change.workspaceId !== workspaceId) continue;
    for (const portId of portsOf(change.grantId)) {
      ports.push({ workspaceId, grantId: change.grantId, portId, kind: 'changed', from: change.from, to: change.to });
    }
  }
  for (const withdrawn of recap.withdrawn) {
    if (withdrawn.workspaceId !== workspaceId) continue;
    for (const portId of portsOf(withdrawn.grantId)) {
      ports.push({ workspaceId, grantId: withdrawn.grantId, portId, kind: 'withdrawn' });
    }
  }

  const blocked = ports.filter(port => port.kind === 'withdrawn');
  const changed = ports.filter(port => port.kind === 'changed');
  const summary = blocked.length > 0
    ? `แหล่งนี้ถูกถอน ${blocked.length} ช่องทาง — ต้องเชื่อมต่อใหม่ก่อนใช้งาน`
    : changed.length > 0
      ? `แหล่งนี้มีข้อมูลใหม่ ${changed.length} ช่องทาง — อ่านใหม่ก่อนตัดสินใจ`
      : 'แหล่งนี้ไม่กระทบช่องทางใดในห้อง';

  return { workspaceId, ports, blocked, summary };
}

/**
 * F080 / JT-4A: drill down to one row, with the granted fields only.
 *
 * A missing row and a row that exists but is not visible are answered the same way on purpose: the
 * caller cannot use a drill-down to learn whether some other row exists.
 */
export type DrillDownResult =
  | { ok: true; rowId: string; values: Record<string, unknown> }
  | { ok: false; code: 'ROW_NOT_FOUND'; message: string };

export function drillDownRow(
  records: readonly { id: string; values: Record<string, unknown> }[],
  input: { rowId: string; fields: readonly string[] },
): DrillDownResult {
  const row = records.find(entry => entry.id === input.rowId);
  if (!row) return { ok: false, code: 'ROW_NOT_FOUND', message: 'That row is not part of what this connection exposes.' };
  const values: Record<string, unknown> = {};
  for (const field of input.fields) {
    if (field in row.values) values[field] = row.values[field];
  }
  return { ok: true, rowId: row.id, values };
}
