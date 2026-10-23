import type { TableProgram } from '../shared/table-contracts';

/** A rule is "what happens" material: an action, a data check, a table, or a saved view. */
export type RuleKind = 'action' | 'check' | 'table' | 'view';
export type RuleBadge = 'new' | 'changed' | 'removed';

export interface ProgramDiff {
  /** Keyed by `${kind}:${id}` so an action and a table can share an id. */
  badges: ReadonlyMap<string, RuleBadge>;
  /** True when there is no active rule set yet, so every rule is new and needs no badge. */
  firstProposal: boolean;
  newRules: number;
  editedRules: number;
  removedRules: number;
  newTables: number;
  removedTables: number;
  startingRows: number;
}

export interface ProgramDiffOptions {
  /** Starting rows the change carries, so the review line can say how much data comes with it. */
  startingRows?: number;
}

interface RuleEntry {
  kind: RuleKind;
  body: string;
}

function entries(program: TableProgram): Map<string, RuleEntry> {
  const result = new Map<string, RuleEntry>();
  const put = (kind: RuleKind, id: string, value: unknown) => {
    result.set(`${kind}:${id}`, { kind, body: JSON.stringify(value) });
  };
  for (const collection of program.collections) put('table', collection.id, collection);
  for (const action of program.actions) put('action', action.id, action);
  for (const check of program.invariants) put('check', check.id, check);
  for (const view of program.canvas?.views ?? []) put('view', view.id, view);
  return result;
}

/**
 * Compare the rules in use with a proposal so the Rules card can say what really
 * changes: how many rules are new, which ones were edited, and how many are gone.
 */
export function diffProgram(before: TableProgram | null, after: TableProgram, options: ProgramDiffOptions = {}): ProgramDiff {
  const startingRows = Math.max(0, options.startingRows ?? 0);
  const firstProposal = before === null;
  const previous = before ? entries(before) : new Map<string, RuleEntry>();
  const next = entries(after);
  const badges = new Map<string, RuleBadge>();
  let newRules = 0;
  let editedRules = 0;
  let removedRules = 0;
  let newTables = 0;
  let removedTables = 0;

  const isTable = (entry: RuleEntry) => entry.kind === 'table';
  for (const [key, entry] of next) {
    const prior = previous.get(key);
    if (!prior) {
      badges.set(key, 'new');
      if (isTable(entry)) newTables += 1;
      else newRules += 1;
      continue;
    }
    if (prior.body !== entry.body) {
      badges.set(key, 'changed');
      editedRules += 1;
    }
  }
  for (const [key, entry] of previous) {
    if (next.has(key)) continue;
    badges.set(key, 'removed');
    if (isTable(entry)) removedTables += 1;
    else removedRules += 1;
  }
  return { badges, firstProposal, newRules, editedRules, removedRules, newTables, removedTables, startingRows };
}

/** One quiet sentence for the top of a proposal; empty when nothing would change. */
export function describeProgramDiff(diff: ProgramDiff): string {
  const parts: string[] = [];
  if (diff.newRules > 0) parts.push(`${diff.newRules} new ${diff.newRules === 1 ? 'rule' : 'rules'}`);
  if (diff.editedRules > 0) parts.push(`${diff.editedRules} ${diff.editedRules === 1 ? 'rule edited' : 'rules edited'}`);
  if (diff.removedRules > 0) parts.push(`${diff.removedRules} ${diff.removedRules === 1 ? 'rule removed' : 'rules removed'}`);
  if (diff.newTables > 0) parts.push(`${diff.newTables} new ${diff.newTables === 1 ? 'table' : 'tables'}`);
  if (diff.removedTables > 0) parts.push(`${diff.removedTables} ${diff.removedTables === 1 ? 'table removed' : 'tables removed'}`);
  if (diff.startingRows > 0) parts.push(`${diff.startingRows} starting ${diff.startingRows === 1 ? 'row' : 'rows'}`);
  return parts.join(' · ');
}

/** Badge for one rule, or undefined when it is unchanged (or when every rule is new). */
export function ruleBadge(diff: ProgramDiff | null, kind: RuleKind, id: string): RuleBadge | undefined {
  const badge = diff?.badges.get(`${kind}:${id}`);
  if (!badge) return undefined;
  if (badge === 'new' && diff?.firstProposal) return undefined;
  return badge;
}
