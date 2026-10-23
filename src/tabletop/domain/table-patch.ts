import { z } from 'zod';
import type { TableProgram } from '../shared/table-contracts';

/**
 * F065: an AI edit of an existing table describes only what changes. The host merges it into the
 * current program and the merged program then goes through every check a complete program does,
 * so a patch can never skip validation. Shapes inside upsert are judged after the merge.
 */
const itemId = z.string().min(1).max(80);
const withId = z.looseObject({ id: itemId });
const items = z.array(withId).max(32).optional();
const ids = z.array(itemId).max(32).optional();

export const tablePatchSchema = z.strictObject({
  kind: z.literal('table-patch'),
  set: z.strictObject({
    title: z.string().optional(),
    description: z.string().optional(),
    turnOrder: z.array(z.string()).optional(),
  }).optional(),
  upsert: z.strictObject({ collections: items, actions: items, invariants: items, views: items, computeModules: items }).optional(),
  remove: z.strictObject({ collections: ids, actions: ids, invariants: ids, views: ids, computeModules: ids }).optional(),
  addEvidence: z.array(z.looseObject({})).max(16).optional(),
  addAssumptions: z.array(z.string()).max(16).optional(),
});
export type TablePatch = z.infer<typeof tablePatchSchema>;

type Part = 'collections' | 'actions' | 'invariants' | 'views' | 'computeModules';
const PARTS: readonly Part[] = ['collections', 'actions', 'invariants', 'views', 'computeModules'];

export function isTablePatch(value: unknown): boolean {
  return typeof value === 'object' && value !== null && (value as { kind?: unknown }).kind === 'table-patch';
}

/** Replaces items with the same id in place and appends new ones, keeping the current order. */
function upsertById<T extends { id: string }>(current: readonly T[], incoming: readonly { id: string }[]): T[] {
  const next = [...current];
  for (const item of incoming) {
    const index = next.findIndex((existing) => existing.id === item.id);
    if (index >= 0) next[index] = item as T;
    else next.push(item as T);
  }
  return next;
}

/**
 * Merges a patch into the current program. Returns a complete table change (still unvalidated) or
 * the reasons the patch cannot apply, worded for a repair attempt.
 */
export function applyTablePatch(current: TableProgram, patch: TablePatch): { change: { kind: 'table'; program: unknown; initialRecords: Record<string, never> } } | { issues: string[] } {
  const issues: string[] = [];
  const program = structuredClone(current) as TableProgram;
  const views = () => program.canvas?.views ?? [];
  const listOf = (part: Part): { id: string }[] => part === 'views' ? views() : part === 'computeModules' ? program.compute?.modules ?? [] : program[part];
  const setList = (part: Part, list: { id: string }[]) => {
    if (part === 'views') {
      if (list.length > 0 || program.canvas) program.canvas = { version: 1, ...(program.canvas ?? {}), views: list as NonNullable<TableProgram['canvas']>['views'] };
    } else if (part === 'computeModules') {
      program.compute = { version: 1, modules: list as NonNullable<TableProgram['compute']>['modules'] };
    } else {
      (program as unknown as Record<Part, { id: string }[]>)[part] = list;
    }
  };
  let changed = false;
  for (const part of PARTS) {
    const removals = patch.remove?.[part] ?? [];
    for (const removed of removals) {
      if (!listOf(part).some((item) => item.id === removed)) issues.push(`remove.${part}: "${removed}" is not in the current program; remove only existing ids.`);
    }
    if (removals.length) { setList(part, listOf(part).filter((item) => !removals.includes(item.id))); changed = true; }
    const upserts = patch.upsert?.[part] ?? [];
    const seen = new Set<string>();
    for (const item of upserts) {
      if (seen.has(item.id)) issues.push(`upsert.${part}: "${item.id}" appears twice; send each id once.`);
      seen.add(item.id);
      if (removals.includes(item.id)) issues.push(`upsert.${part}: "${item.id}" is also in remove.${part}; do one or the other.`);
    }
    if (upserts.length) { setList(part, upsertById(listOf(part), upserts)); changed = true; }
  }
  if (patch.set?.title !== undefined) { program.title = patch.set.title; changed = true; }
  if (patch.set?.description !== undefined) { program.description = patch.set.description; changed = true; }
  if (patch.set?.turnOrder !== undefined) { program.turnOrder = patch.set.turnOrder; changed = true; }
  if (patch.addEvidence?.length) { program.evidence = [...program.evidence, ...(patch.addEvidence as TableProgram['evidence'])]; changed = true; }
  if (patch.addAssumptions?.length) { program.assumptions = [...program.assumptions, ...patch.addAssumptions]; changed = true; }
  if (!changed) issues.push('The table-patch changes nothing. Put the requested additions in upsert, removals in remove, or settings in set.');
  if (issues.length) return { issues: issues.slice(0, 4) };
  return { change: { kind: 'table', program, initialRecords: {} } };
}
