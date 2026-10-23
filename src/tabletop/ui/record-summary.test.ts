import { describe, expect, it } from 'vitest';
import type { TableCollection, TableRecord } from '../shared/table-contracts';
import { recordChoiceLabels, recordSummary } from './record-summary';

const transfers: TableCollection = { id: 'transfers', title: 'Transfers', fields: [
  { id: 'from', label: 'From', type: 'text', required: true },
  { id: 'to', label: 'To', type: 'text', required: true },
  { id: 'amount', label: 'Amount', type: 'number', required: true },
  { id: 'settled', label: 'Settled', type: 'boolean', required: true },
  { id: 'round', label: 'Round', type: 'text', required: false },
] };
const row = (id: string, values: TableRecord['values']): TableRecord => ({ id, values });

describe('F075 readable record picker', () => {
  it('reads a row from its own values instead of its internal id', () => {
    const label = recordSummary(row('record_2_01_482350b39073', { from: 'A', to: 'B', amount: 2579.8, settled: false, round: 'new' }), transfers);
    expect(label).toBe('A · B · 2,579.8 · Settled: No · new');
    expect(label).not.toContain('record_2');
  });

  it('can leave out yes/no fields for a message about a change that just happened', () => {
    expect(recordSummary(row('s2', { from: 'A', to: 'B', amount: 1751.8, settled: false, round: 'old' }), transfers, undefined, { omitYesNo: true })).toBe('A · B · 1,751.8 · old');
  });

  it('keeps the id only for rows that read the same', () => {
    const labels = recordChoiceLabels([
      row('s1', { from: 'A', to: 'B', amount: 10, settled: false }),
      row('s2', { from: 'A', to: 'B', amount: 10, settled: false }),
      row('s3', { from: 'C', to: 'B', amount: 10, settled: false }),
    ], transfers);
    expect([...labels.values()]).toEqual(['A · B · 10 · Settled: No · s1', 'A · B · 10 · Settled: No · s2', 'C · B · 10 · Settled: No']);
    const teams: TableCollection = { id: 'teams', title: 'Teams', fields: [{ id: 'delivered', label: 'Delivered', type: 'number', required: true }] };
    expect(recordChoiceLabels([row('team-north', { delivered: 0 }), row('team-south', { delivered: 0 })], teams).get('team-south')).toBe('0 · team-south');
    // Unique but nameless: a bare number still keeps its id.
    expect(recordChoiceLabels([row('team-north', { delivered: 7 }), row('team-south', { delivered: 0 })], teams).get('team-south')).toBe('0 · team-south');
  });

  it('names members, skips empty values and falls back to the id when nothing is readable', () => {
    const people: TableCollection = { id: 'p', title: 'P', fields: [{ id: 'who', label: 'Who', type: 'text', required: false }, { id: 'note', label: 'Note', type: 'text', required: false }] };
    expect(recordSummary(row('r1', { who: 'actor-1', note: '' }), people, [{ actorId: 'actor-1', name: 'Pat', role: 'owner' }])).toBe('Pat');
    expect(recordSummary(row('r2', { who: null, note: '' }), people)).toBe('r2');
    expect(recordSummary(row('r3', { who: 'x'.repeat(60) }), people).length).toBeLessThanOrEqual(28);
  });
});
