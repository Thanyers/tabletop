import { describe, expect, it } from 'vitest';
import { FALLBACK_REPAIR_ATTEMPT, FALLBACK_SIMPLIFY_ISSUES, MAX_REPAIR_ISSUES, SIMPLIFY_DIRECTIVE, nextRepairIssues } from './repair';

describe('repair escalation (F024)', () => {
  it('appends the simplification directive when the first issue repeats', () => {
    const first = 'An action refers to an unknown record field.';
    const next = nextRepairIssues([first], [first, 'Other issue']);
    expect(next).toContain(SIMPLIFY_DIRECTIVE);
    expect(next[0]).toBe(first);
  });

  it('leaves different issues unchanged', () => {
    const next = nextRepairIssues(['First issue'], ['Second issue']);
    expect(next).toEqual(['Second issue']);
    expect(next).not.toContain(SIMPLIFY_DIRECTIVE);
  });

  it('handles empty input and caps the issue list', () => {
    expect(nextRepairIssues([], [])).toEqual([]);
    const many = Array.from({ length: 8 }, (_, index) => `issue ${index}`);
    expect(nextRepairIssues([], many)).toHaveLength(MAX_REPAIR_ISSUES);
  });
});

describe('fallback minimal build (F028)', () => {
  it('asks for the smallest valid table on the final attempt', () => {
    expect(FALLBACK_SIMPLIFY_ISSUES).toHaveLength(1);
    expect(FALLBACK_SIMPLIFY_ISSUES[0]).toContain('smallest valid table');
    expect(FALLBACK_SIMPLIFY_ISSUES[0]).toContain('no canvas views');
    expect(FALLBACK_SIMPLIFY_ISSUES[0]).toContain('no cross-collection');
    expect(FALLBACK_REPAIR_ATTEMPT).toBe(3);
  });
});
