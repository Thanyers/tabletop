import type { ActorContext } from '../shared/contracts';
import type { TableState } from '../shared/table-contracts';
import type { TableDataProvenance, TableInputWrite } from '../shared/table-data-provenance';

/** Record real writes only. Reads, layout changes and computation progress do not invent input authors. */
export function stampTableDataProvenance(before: TableState, after: TableState, command: string, actor: ActorContext): TableState {
  const provenance: TableDataProvenance = structuredClone(before.dataProvenance ?? { sources: {}, collections: {} });
  const write: TableInputWrite = { actorId: actor.actorId, at: actor.now, origin: command.startsWith('evolve.') ? 'ai' : 'human' };
  let changed = false;
  for (const source of after.sources) {
    if (!before.sources.some(existing => existing.id === source.id)) { provenance.sources[source.id] = write; changed = true; }
  }
  for (const collection of after.program?.collections ?? []) {
    if (JSON.stringify(before.records[collection.id] ?? []) !== JSON.stringify(after.records[collection.id] ?? [])) {
      provenance.collections[collection.id] = write;
      changed = true;
    }
  }
  for (const id of Object.keys(provenance.sources)) if (!after.sources.some(source => source.id === id)) { delete provenance.sources[id]; changed = true; }
  for (const id of Object.keys(provenance.collections)) if (!after.program?.collections.some(collection => collection.id === id)) { delete provenance.collections[id]; changed = true; }
  return changed ? { ...after, dataProvenance: provenance } : after;
}
