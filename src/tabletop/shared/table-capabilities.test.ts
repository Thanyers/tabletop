import { describe, expect, it } from 'vitest';
import { TABLE_CAPABILITIES, TABLE_CAPABILITY_LIMITS, tableCapabilitySummary } from './table-capabilities';

describe('table capabilities', () => {
  it('lists unique, non-empty capability and gap entries', () => {
    const ids = [...TABLE_CAPABILITIES.supported, ...TABLE_CAPABILITIES.gaps].map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const item of [...TABLE_CAPABILITIES.supported, ...TABLE_CAPABILITIES.gaps]) {
      expect(item.title.trim().length).toBeGreaterThan(0);
      expect(item.detail.trim().length).toBeGreaterThan(0);
    }
    expect(TABLE_CAPABILITIES.supported.length).toBeGreaterThanOrEqual(8);
    expect(TABLE_CAPABILITIES.gaps.length).toBeGreaterThanOrEqual(5);
  });

  it('keeps limits positive and aligned with the server caps', () => {
    for (const value of Object.values(TABLE_CAPABILITY_LIMITS)) expect(value).toBeGreaterThan(0);
    expect(TABLE_CAPABILITY_LIMITS.computedColumns).toBe(6);
    expect(TABLE_CAPABILITY_LIMITS.canvasViews).toBe(12);
    expect(TABLE_CAPABILITY_LIMITS.rowsPerTable).toBeGreaterThanOrEqual(TABLE_CAPABILITY_LIMITS.rowsPerCollection);
  });

  it('summarises ids and limits for the capabilities endpoint', () => {
    const summary = tableCapabilitySummary();
    expect(summary.supported).toEqual(TABLE_CAPABILITIES.supported.map((item) => item.id));
    expect(summary.gaps).toEqual(TABLE_CAPABILITIES.gaps.map((item) => item.id));
    expect(summary.limits).toEqual(TABLE_CAPABILITY_LIMITS);
    expect(summary.supported).toContain('computed');
    expect(summary.supported).toContain('import');
    expect(summary.gaps).toContain('joins');
  });
});
