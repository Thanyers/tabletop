import { describe, expect, it } from 'vitest';
import type { GenerativeCanvas, GenerativeViewDescriptor } from '../../shared/generative-contracts';
import type { TableProgram } from '../../shared/table-contracts';
import { preserveCanvasViews } from './preserve';

function program(canvas?: GenerativeCanvas): TableProgram {
  return {
    version: 1, title: 'Inventory', description: 'Items.',
    collections: [{ id: 'items', title: 'Items', fields: [{ id: 'sku', label: 'SKU', type: 'text', required: true }] }],
    actions: [], invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
    ...(canvas ? { canvas } : {}),
  };
}

const metric: GenerativeViewDescriptor = { id: 'total_view', kind: 'metric', title: 'Total items', value: { op: 'literal', value: 1 } };
const chart: GenerativeViewDescriptor = { id: 'sku_chart', kind: 'chart', title: 'By SKU', chart: 'bar', collection: 'items', categoryField: 'sku', value: { op: 'literal', value: 1 } };

describe('preserveCanvasViews', () => {
  it('carries views the next program dropped', () => {
    const previous: GenerativeCanvas = { version: 1, views: [metric, chart] };
    const result = preserveCanvasViews(previous, undefined, program());
    expect(result?.views.map((view) => view.id)).toEqual(['total_view', 'sku_chart']);
  });

  it('lets the new program win and does not duplicate ids', () => {
    const previous: GenerativeCanvas = { version: 1, views: [metric, chart] };
    const replacement: GenerativeViewDescriptor = { ...metric, title: 'New title' };
    const result = preserveCanvasViews(previous, { version: 1, views: [replacement] }, program());
    expect(result?.views).toHaveLength(2);
    expect(result?.views[0]).toEqual(replacement);
    expect(result?.views.map((view) => view.id)).toEqual(['total_view', 'sku_chart']);
  });

  it('drops carried views that no longer bind to the program', () => {
    const orphan: GenerativeViewDescriptor = { id: 'gone_chart', kind: 'chart', title: 'Gone', chart: 'bar', collection: 'removed', categoryField: 'sku', value: { op: 'literal', value: 1 } };
    const previous: GenerativeCanvas = { version: 1, views: [orphan, metric] };
    const result = preserveCanvasViews(previous, undefined, program());
    expect(result?.views.map((view) => view.id)).toEqual(['total_view']);
  });

  it('respects the canvas view cap', () => {
    const views = Array.from({ length: 12 }, (_, index): GenerativeViewDescriptor => ({ ...metric, id: `metric_${index}`, title: `Metric ${index}` }));
    const previous: GenerativeCanvas = { version: 1, views };
    const result = preserveCanvasViews(previous, { version: 1, views: [chart] }, program());
    expect(result?.views).toHaveLength(12);
  });

  it('leaves things untouched when there is nothing to carry', () => {
    expect(preserveCanvasViews(undefined, undefined, program())).toBeUndefined();
    const next: GenerativeCanvas = { version: 1, views: [metric] };
    expect(preserveCanvasViews({ version: 1, views: [] }, next, program())).toBe(next);
  });
});
