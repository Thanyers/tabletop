import type { TableAction, TableValue } from '../shared/table-contracts';

export interface CheckboxAction { action: TableAction; parameterId: string }

/**
 * F081: the rule a yes/no checkbox runs for one row. It must take that row as its only input and either toggle the
 * field or set it to the value the click asks for; a toggle wins because it also works the other way.
 */
export function checkboxAction(actions: readonly TableAction[], collectionId: string, fieldId: string, current: TableValue | undefined, role: 'owner' | 'participant'): CheckboxAction | null {
  const wanted = current !== true;
  let fallback: CheckboxAction | null = null;
  for (const action of actions) {
    if (!action.roles.includes(role) || action.requireTurn || action.parameters.length !== 1) continue;
    const parameter = action.parameters[0]!;
    if (parameter.type !== 'record' || parameter.collection !== collectionId) continue;
    for (const effect of action.effects) {
      if (effect.record !== parameter.id || effect.field !== fieldId) continue;
      if (effect.op === 'toggle') return { action, parameterId: parameter.id };
      if (!fallback && effect.op === 'set' && 'literal' in effect.value && effect.value.literal === wanted) fallback = { action, parameterId: parameter.id };
    }
  }
  return fallback;
}

/** F081: why a checkbox cannot be clicked, in words a member can act on. */
export function checkboxUnavailableReason(checked: boolean): string {
  return checked
    ? 'No rule unchecks this yet. Ask the AI to add one, e.g. “add a way to undo done”.'
    : 'No rule checks this yet. Ask the AI to add one, e.g. “add a way to mark done”.';
}
