import { describe, expect, it } from 'vitest';
import { TOOL_BRIDGE_LIMITS } from './tool-protocol';
import { projectToolPort, projectToolPorts, type ProjectionSourceInput } from './tool-projection';
import type { ToolDataPort } from './tool-package';

const recordsPort: ToolDataPort = { id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room', 'area'], maxRows: 50 };
const scalarPort: ToolDataPort = { id: 'cost', label: 'ต้นทุน', direction: 'in', kind: 'number', fields: [], maxRows: 0 };

function source(overrides: Partial<ProjectionSourceInput> = {}): ProjectionSourceInput {
  return {
    label: 'งบประมาณ',
    dataRevision: 7,
    ruleRevision: 2,
    link: 'linked',
    grantedEpoch: 1,
    currentEpoch: 1,
    grantVersion: 3,
    grantedFields: ['room', 'area', 'secret'],
    maxRows: 50,
    rows: [
      { id: 'row-1', values: { room: 'ห้องประชุม', area: 24, secret: 'do-not-leak' } },
      { id: 'row-2', values: { room: 'ห้องโถง', area: 60, secret: 'also-hidden' } },
    ],
    readAt: 1_760_000_000_000,
    ...overrides,
  };
}

describe('projection narrows to declared and granted fields', () => {
  it('emits only the intersection of declared and granted fields', () => {
    const result = projectToolPort(recordsPort, source({ grantedFields: ['room'] }));
    expect(result.snapshot.rows).toEqual([
      { id: 'row-1', values: { room: 'ห้องประชุม' } },
      { id: 'row-2', values: { room: 'ห้องโถง' } },
    ]);
    expect(result.withheldFields).toEqual(['area']);
  });

  it('never emits a field the package did not declare, even if the grant allows it', () => {
    const result = projectToolPort(recordsPort, source());
    expect(result.snapshot.rows?.[0]?.values).not.toHaveProperty('secret');
    expect(result.withheldFields).toEqual([]);
  });

  it('clamps rows by the port, the grant and the bridge cap', () => {
    const many = Array.from({ length: TOOL_BRIDGE_LIMITS.maxRowsPerPort + 20 }, (_, index) => ({ id: `row-${index}`, values: { room: `r${index}`, area: index } }));
    const result = projectToolPort({ ...recordsPort, maxRows: 500 }, source({ rows: many, maxRows: 500 }));
    expect(result.snapshot.rows).toHaveLength(TOOL_BRIDGE_LIMITS.maxRowsPerPort);
    const narrowed = projectToolPort({ ...recordsPort, maxRows: 3 }, source({ rows: many, maxRows: 500 }));
    expect(narrowed.snapshot.rows).toHaveLength(3);
    const grantCap = projectToolPort({ ...recordsPort, maxRows: 3 }, source({ rows: many, maxRows: 2 }));
    expect(grantCap.snapshot.rows).toHaveLength(2);
  });

  it('does not emit the workspace id, only the label', () => {
    const result = projectToolPort(recordsPort, source());
    expect(JSON.stringify(result.snapshot)).not.toContain('workspace');
    expect(result.snapshot.sourceLabel).toBe('งบประมาณ');
  });
});

describe('projection status follows the connection state', () => {
  it('is live only on the granted epoch', () => {
    expect(projectToolPort(recordsPort, source()).snapshot.status).toBe('live');
    expect(projectToolPort(recordsPort, source({ currentEpoch: 2 })).snapshot.status).toBe('stale');
  });

  it('is revoked or missing when the link is gone, and carries no rows', () => {
    for (const link of ['revoked', 'left', 'missing'] as const) {
      const result = projectToolPort(recordsPort, source({ link }));
      expect(result.snapshot.status).toBe(link === 'missing' ? 'missing' : 'revoked');
      expect(result.snapshot.rows).toEqual([]);
    }
  });

  it('still returns a snapshot for a revoked source so the tool can show why it is empty', () => {
    const result = projectToolPort(recordsPort, source({ link: 'revoked' }));
    expect(result.snapshot.portId).toBe('plan');
    expect(result.snapshot.status).toBe('revoked');
    expect(result.snapshot.revision.grantVersion).toBe(3);
  });
});

describe('projection values', () => {
  it('turns a list value into display text and keeps scalars as they are', () => {
    const result = projectToolPort(recordsPort, source({
      rows: [{ id: 'row-1', values: { room: 'ห้องประชุม', area: ['24', 'seats'] } }],
    }));
    expect(result.snapshot.rows?.[0]?.values.area).toBe('24, seats');
  });

  it('drops a value it cannot represent instead of guessing', () => {
    const result = projectToolPort(recordsPort, source({
      rows: [{ id: 'row-1', values: { room: { nested: true }, area: 24 } }],
    }));
    expect(result.problems).toContain('PROJECTION_DROPPED_NON_SCALAR');
    expect(result.snapshot.rows?.[0]?.values).toEqual({ area: 24 });
  });

  it('drops a row whose id is unusable', () => {
    const result = projectToolPort(recordsPort, source({ rows: [{ id: '', values: { room: 'x' } }, { id: 'ok', values: { room: 'y' } }] }));
    expect(result.problems).toContain('PROJECTION_ROW_ID_UNSAFE');
    expect(result.snapshot.rows?.map(row => row.id)).toEqual(['ok']);
  });

  it('reports an empty intersection instead of silently sending nothing', () => {
    const result = projectToolPort(recordsPort, source({ grantedFields: [] }));
    expect(result.problems).toContain('PROJECTION_NO_PORT_FIELDS');
    expect(result.withheldFields).toEqual(['room', 'area']);
  });
});

describe('whole-instance projection', () => {
  it('builds every inbound port and marks an unbound one as missing', () => {
    const result = projectToolPorts([recordsPort, scalarPort], port => (port.id === 'plan' ? source() : undefined));
    expect(result.snapshots.map(snapshot => snapshot.portId)).toEqual(['plan', 'cost']);
    expect(result.snapshots[1]?.status).toBe('missing');
    expect(result.snapshots[1]?.sourceLabel).toBe('ไม่พบต้นทาง');
  });

  it('ignores ports declared for output only', () => {
    const outPort: ToolDataPort = { id: 'total', label: 'รวม', direction: 'out', kind: 'number', fields: [], maxRows: 0 };
    const result = projectToolPorts([recordsPort, outPort], () => source());
    expect(result.snapshots.map(snapshot => snapshot.portId)).toEqual(['plan']);
  });
});
