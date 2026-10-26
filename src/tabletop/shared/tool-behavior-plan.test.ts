import { describe, expect, it } from 'vitest';
import { planToolBehaviorWrites, type DeclaredWrite, type ProposedChange } from './tool-behavior-plan';

/**
 * F080 / EXEC-01: the plan is where "outside the declared scope equals zero write" becomes checkable.
 *
 * Every refusal below happens before a write is produced, so a caller that commits only `ok: true`
 * writes cannot be talked into writing something the package never declared.
 */

const declared: DeclaredWrite[] = [
  { target: 'self', resource: 'placements', operations: ['create'], maxRows: 2 },
  { target: 'self', resource: 'rooms', operations: ['update'], maxRows: 5 },
];

const schema = {
  placements: { fields: [{ id: 'room', type: 'text' as const }, { id: 'area', type: 'number' as const }] },
  rooms: { fields: [{ id: 'name', type: 'text' as const }, { id: 'open', type: 'boolean' as const }] },
};

const create = (values: Record<string, unknown>): ProposedChange => ({ resource: 'placements', operation: 'create', values });

function plan(changes: ProposedChange[], extra: Partial<Parameters<typeof planToolBehaviorWrites>[0]> = {}) {
  return planToolBehaviorWrites({ declaredWrites: declared, resourceSchema: schema, changes, ...extra });
}

describe('planning the writes of one behaviour run', () => {
  it('plans a create that the package declared and the schema allows', () => {
    expect(plan([create({ room: 'Atrium', area: 30 })])).toEqual({
      ok: true,
      writes: [{ resource: 'placements', operation: 'create', values: { room: 'Atrium', area: 30 } }],
    });
  });

  it('refuses a resource the package never declared, and produces no writes', () => {
    const result = plan([{ resource: 'secrets', operation: 'create', values: {} }]);
    expect(result).toMatchObject({ ok: false, code: 'RESOURCE_NOT_DECLARED' });
    expect(result).not.toHaveProperty('writes');
  });

  it('refuses an operation the package did not declare', () => {
    expect(plan([{ resource: 'placements', operation: 'update', rowId: 'p1', values: { room: 'x' } }]))
      .toMatchObject({ ok: false, code: 'OPERATION_NOT_DECLARED' });
  });

  it('refuses a write aimed at another table', () => {
    expect(plan([{ ...create({ room: 'A', area: 1 }), target: 'other' as never }]))
      .toMatchObject({ ok: false, code: 'NOT_SELF_TARGET' });
  });

  it('refuses a field outside the schema, and a value of the wrong type', () => {
    expect(plan([create({ room: 'A', area: 1, secret: 'x' })])).toMatchObject({ ok: false, code: 'FIELD_NOT_IN_SCHEMA' });
    expect(plan([create({ room: 'A', area: 'not a number' })])).toMatchObject({ ok: false, code: 'FIELD_NOT_IN_SCHEMA' });
  });

  it('honours the declared row ceiling', () => {
    expect(plan([create({ room: 'A', area: 1 }), create({ room: 'B', area: 2 })])).toMatchObject({ ok: true });
    expect(plan([create({ room: 'A', area: 1 }), create({ room: 'B', area: 2 }), create({ room: 'C', area: 3 })]))
      .toMatchObject({ ok: false, code: 'ROW_LIMIT' });
  });

  it('requires an update to name a row that exists, and refuses changing it twice', () => {
    const update: ProposedChange = { resource: 'rooms', operation: 'update', rowId: 'r1', values: { open: false } };
    expect(plan([update], { existingRowIds: { rooms: ['r1'] } })).toMatchObject({ ok: true });
    expect(plan([update], { existingRowIds: { rooms: ['r2'] } })).toMatchObject({ ok: false, code: 'ROW_NOT_FOUND' });
    expect(plan([{ ...update, rowId: undefined }])).toMatchObject({ ok: false, code: 'UPDATE_WITHOUT_ROW' });
    expect(plan([update, update], { existingRowIds: { rooms: ['r1'] } })).toMatchObject({ ok: false, code: 'DUPLICATE_ROW' });
  });

  it('plans nothing for a behaviour that proposes nothing', () => {
    expect(plan([])).toEqual({ ok: true, writes: [] });
  });
});
