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

/**
 * F028: the last attempt asks for the smallest table that can still satisfy the request.
 * A minimal draft that activates beats a rich draft that never leaves validation.
 */
export const FALLBACK_SIMPLIFY_ISSUES = [
  'Return the smallest valid table that still satisfies the request: one collection with at most four fields, at most one action, no canvas views, no cross-collection field lookups.',
] as const;
/** F065: an edit keeps the current table, so its last attempt shrinks only what it adds. */
export const EDIT_FALLBACK_SIMPLIFY_ISSUES = [
  'Return the smallest table-patch that still does the core of the request: change or add as little as possible, leave out any new canvas view that failed, and never remove existing parts to make the patch pass.',
] as const;
export const FALLBACK_REPAIR_ATTEMPT = 3;

