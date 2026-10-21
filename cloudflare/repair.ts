/**
 * F024: when a repair attempt repeats the same validation issue, add a simplification directive
 * so the next attempt removes the offending action/view instead of inventing new references.
 */
export const MAX_REPAIR_ISSUES = 4;
export const SIMPLIFY_DIRECTIVE =
  'The same validation issue repeated. Simplify the design: remove the action or view that causes it instead of adding new fields or references.';

export function nextRepairIssues(previous: readonly string[], issues: readonly string[]): string[] {
  const base = issues.slice(0, MAX_REPAIR_ISSUES);
  const repeated = base.length > 0 && previous.length > 0 && base[0] === previous[0];
  return repeated ? [...base, SIMPLIFY_DIRECTIVE] : base;
}
