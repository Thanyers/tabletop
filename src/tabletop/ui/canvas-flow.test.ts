import { describe, expect, it } from 'vitest';
import {
  CANVAS_CONNECTIONS_PREFERENCE_KEY,
  dedupeVisibleCanvasConnections,
  isCanvasNoteId,
  readConnectionsPreference,
  resolveConnectionsVisible,
  writeConnectionsPreference,
} from './canvas-flow';

describe('dedupeVisibleCanvasConnections', () => {
  it('collapses duplicate hidden paths but keeps distinct visible ports and value types', () => {
    const connections = [
      { id: 'exceptions-path', source: 'invoice.source', sourcePort: 'rows', target: 'invoice.review', targetHandle: 'items', valueType: 'ReviewItemV1[]' },
      { id: 'surcharge-exceptions-path', source: 'invoice.source', sourcePort: 'rows', target: 'invoice.review', targetHandle: 'items', valueType: 'ReviewItemV1[]' },
      { id: 'adjustments', source: 'invoice.source', sourcePort: 'adjustments', target: 'invoice.review', targetHandle: 'items', valueType: 'ReviewItemV1[]' },
      { id: 'totals', source: 'invoice.source', sourcePort: 'rows', target: 'invoice.review', targetHandle: 'totals', valueType: 'InvoiceResultV1' },
      { id: 'typed-items', source: 'invoice.source', sourcePort: 'rows', target: 'invoice.review', targetHandle: 'items', valueType: 'InvoiceResultV1' },
    ];

    expect(dedupeVisibleCanvasConnections(connections)).toEqual([
      connections[0],
      connections[2],
      connections[3],
      connections[4],
    ]);
  });
});

describe('resolveConnectionsVisible', () => {
  it('shows a connected table instead of leaving only orphan ports', () => {
    expect(resolveConnectionsVisible(null, 3)).toBe(true);
  });

  it('keeps an empty table quiet when nothing is connected', () => {
    expect(resolveConnectionsVisible(null, 0)).toBe(false);
  });

  it('lets a stored choice win over the default in both directions', () => {
    expect(resolveConnectionsVisible(false, 3)).toBe(false);
    expect(resolveConnectionsVisible(true, 0)).toBe(true);
  });
});

describe('connections preference storage', () => {
  const memoryStorage = (initial: Record<string, string> = {}) => {
    const values = { ...initial };
    return {
      getItem: (key: string) => values[key] ?? null,
      setItem: (key: string, value: string) => { values[key] = value; },
      values,
    };
  };

  it('round-trips an explicit choice', () => {
    const storage = memoryStorage();
    writeConnectionsPreference(storage, true);
    expect(storage.values[CANVAS_CONNECTIONS_PREFERENCE_KEY]).toBe('shown');
    expect(readConnectionsPreference(storage)).toBe(true);
    writeConnectionsPreference(storage, false);
    expect(readConnectionsPreference(storage)).toBe(false);
  });

  it('ignores unknown values and missing storage', () => {
    expect(readConnectionsPreference(null)).toBeNull();
    expect(readConnectionsPreference(memoryStorage({ [CANVAS_CONNECTIONS_PREFERENCE_KEY]: 'maybe' }))).toBeNull();
  });

  it('survives storage that throws', () => {
    const blocked = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    expect(readConnectionsPreference(blocked)).toBeNull();
    expect(() => writeConnectionsPreference(blocked, true)).not.toThrow();
  });
});

describe('isCanvasNoteId', () => {
  it('recognises note nodes and leaves plan cards alone', () => {
    expect(isCanvasNoteId('table.note.note_ab12cd34')).toBe(true);
    expect(isCanvasNoteId('table.collection.equipment')).toBe(false);
    expect(isCanvasNoteId('workspace.people')).toBe(false);
  });
});
