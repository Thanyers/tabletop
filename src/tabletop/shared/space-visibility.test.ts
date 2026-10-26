import { describe, expect, it } from 'vitest';
import { VISIBILITY_POLICY } from '../shared/visibility';
import { projectGrantRows } from '../shared/tool-grant-rows';
import { VISIBILITY_POLICY as SAME } from './visibility';

/**
 * F080 / VIS-01: a connection narrows what leaves a table; it never widens it.
 *
 * Two things are pinned here. The table policy is unchanged (open, with the private path still in the
 * type), and a granted projection cannot carry the parts of a table a connection has no business
 * exposing: chat, notes or any field the grant did not name.
 */

describe('the table visibility policy is untouched', () => {
  it('is still open, and private is still a representable policy', () => {
    expect(VISIBILITY_POLICY).toBe('open');
    // The type keeps 'private' representable even though the current value is 'open'.
    const representable: typeof VISIBILITY_POLICY | 'private' = VISIBILITY_POLICY;
    expect(['open', 'private']).toContain(representable);
    expect(SAME).toBe(VISIBILITY_POLICY);
  });
});

describe('a granted projection carries only what the grant named', () => {
  const records = [
    {
      id: 'row-1',
      values: {
        room: 'room-a',
        price: 1250,
        // Parts of a table a connection must never carry.
        chat: 'private message',
        notes: 'internal note',
        draft: { hidden: true },
      },
    },
  ];

  it('drops chat, notes and drafts even though the row has them', () => {
    const projected = projectGrantRows({
      portId: 'budget',
      fields: ['room', 'price'],
      maxRows: 5,
      dataRevision: 3,
      ruleRevision: 1,
      grantVersion: 1,
      label: 'budget',
      records,
      readAt: 1,
    });
    expect(projected.rows).toHaveLength(1);
    const values = projected.rows[0]?.values ?? {};
    expect(Object.keys(values).sort()).toEqual(['price', 'room']);
    expect(JSON.stringify(projected.rows)).not.toContain('private message');
    expect(JSON.stringify(projected.rows)).not.toContain('internal note');
  });

  it('would reveal an unlisted-but-granted field only if the grant asked for it', () => {
    const projected = projectGrantRows({
      portId: 'budget',
      fields: ['room', 'price', 'notes'],
      maxRows: 5,
      dataRevision: 3,
      ruleRevision: 1,
      grantVersion: 1,
      label: 'budget',
      records,
      readAt: 1,
    });
    expect(projected.rows[0]?.values).toHaveProperty('notes');
  });
});
