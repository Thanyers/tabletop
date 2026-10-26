import { describe, expect, it } from 'vitest';
import { projectGrantRows } from './tool-grant-rows';

const base = {
  portId: 'budget',
  fields: ['room', 'price'],
  maxRows: 10,
  dataRevision: 7,
  ruleRevision: 2,
  grantVersion: 1,
  label: 'งบประมาณ',
  readAt: 5_000,
};

describe('grant rows come only from the live revision and the allowed fields', () => {
  it('projects the granted fields and reports the revision it read', () => {
    const result = projectGrantRows({
      ...base,
      records: [
        { id: 'row-1', values: { room: 'ห้องประชุม', price: 1250, secret: 'hidden' } },
        { id: 'row-2', values: { room: 'ห้องโถง', price: 4200, secret: 'hidden' } },
      ],
    });
    expect(result.sourceDataRevision).toBe(7);
    expect(result.rows).toEqual([
      { id: 'row-1', values: { room: 'ห้องประชุม', price: 1250 } },
      { id: 'row-2', values: { room: 'ห้องโถง', price: 4200 } },
    ]);
    expect(result.problems).toEqual([]);
  });

  it('never emits a field outside the allowlist, even when the record has it', () => {
    const result = projectGrantRows({ ...base, records: [{ id: 'row-1', values: { room: 'A', price: 1, secret: 'x' } }] });
    expect(result.rows[0]?.values).not.toHaveProperty('secret');
  });

  it('clamps rows to the grant ceiling', () => {
    const records = Array.from({ length: 30 }, (_, index) => ({ id: `row-${index}`, values: { room: `r${index}`, price: index } }));
    expect(projectGrantRows({ ...base, records }).rows).toHaveLength(10);
  });

  it('returns no rows for an empty table but keeps the revision', () => {
    const result = projectGrantRows({ ...base, records: [] });
    expect(result.rows).toEqual([]);
    expect(result.sourceDataRevision).toBe(7);
  });

  it('turns a list value into display text instead of dropping the row', () => {
    const result = projectGrantRows({ ...base, records: [{ id: 'row-1', values: { room: ['ห้อง', 'โถง'], price: 5 } }] });
    expect(result.rows[0]?.values.room).toBe('ห้อง, โถง');
  });
});
