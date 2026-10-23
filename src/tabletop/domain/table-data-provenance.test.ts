import { describe, expect, it } from 'vitest';
import { createTableState } from './table';
import { stampTableDataProvenance } from './table-data-provenance';
import { equipmentChange } from '../testing/table-scenarios';
import type { ActorContext } from '../shared/contracts';

const actor: ActorContext = { actorId: 'fixture-owner', name: 'Owner', role: 'owner', workspaceId: 'fixture-room', epoch: 1, now: 123, hash: value => JSON.stringify(value) };
describe('table input write provenance', () => {
  it('records a source uploader and preserves the distinction from its original author', () => {
    const before = createTableState();
    const after = { ...before, sources: [{ id: 'source_one', filename: 'orders.csv', text: 'x', sha256: 'fixture', createdAt: 123 }] };
    expect(stampTableDataProvenance(before, after, 'table.import', actor).dataProvenance?.sources.source_one).toEqual({ actorId: actor.actorId, at: 123, origin: 'human' });
  });
  it('records real collection writes and leaves untouched historical data unknown', () => {
    const change = equipmentChange('fixture');
    const before = { ...createTableState(), program: change.program, records: change.initialRecords };
    expect(stampTableDataProvenance(before, structuredClone(before), 'table.compute.update', actor).dataProvenance).toBeUndefined();
    const after = structuredClone(before);
    after.records.equipment[0].values.available = false;
    expect(stampTableDataProvenance(before, after, 'table.act', actor).dataProvenance?.collections.equipment).toEqual({ actorId: actor.actorId, at: 123, origin: 'human' });
  });
});
