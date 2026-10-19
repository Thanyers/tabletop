import { describe, expect, it } from 'vitest';
import { dedupeVisibleCanvasConnections } from './canvas-flow';

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
