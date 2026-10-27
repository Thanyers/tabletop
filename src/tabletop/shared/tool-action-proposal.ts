import type { TableAction, TableParameter } from './table-contracts';

/**
 * F080 / EXEC-01 (decision D-033): a custom server behaviour commits by proposing a *declared action*.
 *
 * The alternative would have been a second write path into the domain. Instead the proposal names an
 * action of the table and its inputs; the plan below refuses anything the package did not declare or
 * the table does not define, and the commit itself is the ordinary `table.act` command that the
 * authority already validates (revision, invariants, permissions, receipt).
 */

export interface ActionProposal {
  /** The action of this table the behaviour wants to run. */
  actionId: string;
  inputs: Record<string, string | number | boolean>;
}

export type ActionPlanResult =
  | { ok: true; actionId: string; inputs: Record<string, string | number | boolean> }
  | { ok: false; code: 'ACTION_NOT_DECLARED' | 'ACTION_NOT_FOUND' | 'INPUT_NOT_DECLARED' | 'INPUT_MISSING' | 'INPUT_WRONG_TYPE' | 'NO_PROPOSAL'; message: string };

function typeFits(parameter: TableParameter, value: unknown): boolean {
  switch (parameter.type) {
    case 'number':
      return typeof value === 'number' && Number.isFinite(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'text':
    case 'record':
      return typeof value === 'string';
    case 'roll':
      return true;
    default:
      return false;
  }
}

export function planToolBehaviorAction(input: {
  /** Actions the package declared it may propose. */
  declaredActions: readonly string[];
  /** The actions this table actually defines. */
  programActions: readonly TableAction[];
  proposal: ActionProposal | undefined;
}): ActionPlanResult {
  const proposal = input.proposal;
  if (!proposal) return { ok: false, code: 'NO_PROPOSAL', message: 'The behaviour proposed no action.' };

  if (!input.declaredActions.includes(proposal.actionId)) {
    return { ok: false, code: 'ACTION_NOT_DECLARED', message: `The package did not declare ${proposal.actionId}.` };
  }
  const action = input.programActions.find(entry => entry.id === proposal.actionId);
  if (!action) return { ok: false, code: 'ACTION_NOT_FOUND', message: `This table has no action ${proposal.actionId}.` };

  for (const parameter of action.parameters) {
    const value = proposal.inputs[parameter.id];
    if (value === undefined) return { ok: false, code: 'INPUT_MISSING', message: `${parameter.label} is required.` };
    if (!typeFits(parameter, value)) {
      return { ok: false, code: 'INPUT_WRONG_TYPE', message: `${parameter.label} must be a ${parameter.type}.` };
    }
  }
  for (const key of Object.keys(proposal.inputs)) {
    if (!action.parameters.some(parameter => parameter.id === key)) {
      return { ok: false, code: 'INPUT_NOT_DECLARED', message: `${key} is not an input of ${proposal.actionId}.` };
    }
  }

  return { ok: true, actionId: proposal.actionId, inputs: { ...proposal.inputs } };
}
