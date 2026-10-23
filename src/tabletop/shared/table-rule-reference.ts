import { DomainError } from './contracts';
import type { TableState } from './table-contracts';

export const TABLE_RULE_REFERENCE_KINDS = ['action', 'check', 'table', 'view', 'formula', 'compute'] as const;
export type TableRuleReferenceKind = typeof TABLE_RULE_REFERENCE_KINDS[number];
const MARKER = /\[\[table-rule:([a-z]+):([a-z][a-z0-9_-]{0,39})\]\]/gu;

/** Resolve stable IDs against the authorized table, never client-supplied labels or descriptions. */
export function resolveTableRuleReferences(prompt: string, state: TableState): string {
  let count = 0;
  const resolved = prompt.replace(MARKER, (_marker, kind: string, id: string) => {
    count += 1;
    if (count > 5) throw new DomainError('TABLE_REFERENCE', 'Refer to at most five rules in one message.');
    const program = state.program;
    let label: string | undefined;
    if (kind === 'action') label = program?.actions.find(item => item.id === id)?.title;
    if (kind === 'check') label = program?.invariants.find(item => item.id === id)?.message;
    if (kind === 'table') label = program?.collections.find(item => item.id === id)?.title;
    if (kind === 'view') label = program?.canvas?.views.find(item => item.id === id)?.title;
    if (kind === 'formula') label = state.computedColumns?.find(item => item.id === id)?.label;
    if (kind === 'compute') label = program?.compute?.modules.find(item => item.id === id)?.name;
    if (!label) throw new DomainError('TABLE_REFERENCE', 'A referenced rule has changed or was removed. Select it again from Rules.');
    // The current program is already sent separately. Identify the exact item without duplicating its code into the prompt.
    return `Selected rule (${kind}, id=${JSON.stringify(id)}, current name=${JSON.stringify(label.slice(0, 160))}).`;
  });
  if (resolved.includes('[[table-rule:')) throw new DomainError('TABLE_REFERENCE', 'Choose a valid rule from Rules before sending this message.');
  if (resolved.length > 4000) throw new DomainError('TABLE_REFERENCE', 'Shorten the message so its selected rules fit in one request.');
  return resolved;
}
