import { describe, expect, it } from 'vitest';
import { buildGrant, readFields } from './space-grant-input';

/**
 * F080 / D-054: the authority compares the room's *workspace*, not its slug, so a payload that carries
 * only a slug would silently grant nothing. These cases pin the half that matters.
 */
const base = {
  sourceWorkspaceId: 'table-1',
  spaceWorkspaceId: 'room-1',
  spaceId: 'activity-room',
  portId: 'budget',
  resource: 'costs',
  fields: ['room', 'price'],
  maxRows: 25,
};

describe('the payload that lets a room read one projection', () => {
  it('sends both the room workspace and its slug, to the granting table', () => {
    const built = buildGrant(base, () => 'fixed');
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.workspaceId).toBe('table-1');
    expect(built.payload).toMatchObject({
      grantId: 'grant-fixed',
      spaceId: 'activity-room',
      spaceWorkspaceId: 'room-1',
      audience: { kind: 'space-members' },
      actions: [],
    });
    expect(built.payload.projections).toEqual([{ portId: 'budget', resource: 'costs', fields: ['room', 'price'], maxRows: 25 }]);
  });

  it('refuses an empty room workspace instead of granting to a slug alone', () => {
    expect(buildGrant({ ...base, spaceWorkspaceId: '' })).toMatchObject({ ok: false });
    expect(buildGrant({ ...base, spaceId: '' })).toMatchObject({ ok: false });
  });

  it('refuses a port name the reader could not ask for, a missing resource, and a bad row cap', () => {
    expect(buildGrant({ ...base, portId: 'Budget' })).toMatchObject({ ok: false });
    expect(buildGrant({ ...base, resource: '  ' })).toMatchObject({ ok: false });
    expect(buildGrant({ ...base, maxRows: 0 })).toMatchObject({ ok: false });
    expect(buildGrant({ ...base, fields: ['', ' '] })).toMatchObject({ ok: false });
  });

  it('reads fields from the text a person types, without duplicates', () => {
    expect(readFields('room, price')).toEqual(['room', 'price']);
    expect(readFields('room  price\nroom')).toEqual(['room', 'price']);
    expect(readFields('')).toEqual([]);
  });
});
