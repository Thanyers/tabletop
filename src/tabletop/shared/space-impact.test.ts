import { describe, expect, it } from 'vitest';
import type { GrantedConnection } from './space-grants';
import { impactOfSourceChange, drillDownRow } from './space-impact';

/** F080 / JT-4A: impact is derived from what the source granted, not from what a tool claims. */

const A = '22222222-2222-4222-8222-222222222222';
const B = '33333333-3333-4333-8333-333333333333';

function connection(overrides: Partial<GrantedConnection> = {}): GrantedConnection {
  return {
    grantId: 'grant-a',
    sourceWorkspaceId: A,
    grantedRevision: 4,
    status: 'granted',
    grantVersion: 1,
    exportAllowed: false,
    actions: [],
    ports: ['plan', 'budget'],
    ...overrides,
  };
}

describe('impact of a changed source', () => {
  it('names every port the changed grant exposes', () => {
    const impact = impactOfSourceChange([connection()], {
      changed: [{ workspaceId: A, grantId: 'grant-a', from: 4, to: 9 }],
      withdrawn: [],
    }, A);
    expect(impact.ports.map(port => port.portId).sort()).toEqual(['budget', 'plan']);
    expect(impact.ports[0]).toMatchObject({ kind: 'changed', from: 4, to: 9 });
    expect(impact.blocked).toEqual([]);
    expect(impact.summary).toContain('ข้อมูลใหม่');
  });

  it('treats a withdrawal as blocked, and says so first', () => {
    const impact = impactOfSourceChange([connection({ grantId: 'grant-a', ports: ['plan'] })], {
      changed: [{ workspaceId: A, grantId: 'grant-a', from: 4, to: 9 }],
      withdrawn: [{ workspaceId: A, grantId: 'grant-a' }],
    }, A);
    expect(impact.blocked.map(port => port.portId)).toEqual(['plan']);
    expect(impact.summary).toContain('ถูกถอน');
  });

  it('ignores other sources in the same recap', () => {
    const impact = impactOfSourceChange([connection()], {
      changed: [{ workspaceId: B, grantId: 'grant-b', from: 1, to: 2 }],
      withdrawn: [],
    }, A);
    expect(impact.ports).toEqual([]);
    expect(impact.summary).toBe('แหล่งนี้ไม่กระทบช่องทางใดในห้อง');
  });

  it('does not invent a port the grant never exposed', () => {
    const impact = impactOfSourceChange([connection({ ports: [] })], {
      changed: [{ workspaceId: A, grantId: 'grant-a', from: 4, to: 9 }],
      withdrawn: [],
    }, A);
    expect(impact.ports).toEqual([]);
    expect(impact.summary).toContain('ไม่กระทบ');
  });

  it('says nothing about which tool is at fault', () => {
    const impact = impactOfSourceChange([connection()], {
      changed: [{ workspaceId: A, grantId: 'grant-a', from: 4, to: 9 }],
      withdrawn: [],
    }, A);
    expect(impact.summary).not.toContain('tool');
    expect(JSON.stringify(impact)).not.toContain('rows');
  });
});

describe('drill down to one row', () => {
  const rows = [
    { id: 'row-1', values: { room: 'room-a', price: 1250, secret: 'hidden' } },
    { id: 'row-2', values: { room: 'room-b', price: 4200 } },
  ];

  it('returns only the granted fields of the row', () => {
    const result = drillDownRow(rows, { rowId: 'row-1', fields: ['room', 'price'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.values).sort()).toEqual(['price', 'room']);
  });

  it('answers an unknown row the same way as one it may not see', () => {
    expect(drillDownRow(rows, { rowId: 'nope', fields: ['room'] })).toMatchObject({ ok: false, code: 'ROW_NOT_FOUND' });
  });

  it('never returns a field that was not granted, even when the row has it', () => {
    const result = drillDownRow(rows, { rowId: 'row-1', fields: ['room'] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.values).not.toHaveProperty('secret');
    expect(result.values).not.toHaveProperty('price');
  });
});
