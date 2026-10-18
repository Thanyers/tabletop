import { DomainError, type ActorContext, type CaseKind, type DomainCommand, type DomainDecision, type DomainState } from '../shared/contracts';
import { createInvoiceState, handleInvoiceCommand } from './invoice';
import { createTeachingState, handleTeachingCommand } from './teaching';
import { createEncounterState, handleEncounterCommand } from './encounter';
import { handleEvolutionCommand } from './evolution';

export function createDomain(kind: CaseKind, ctx: ActorContext): DomainState {
  if (kind === 'invoice') return createInvoiceState(ctx);
  if (kind === 'teaching') return createTeachingState(ctx);
  if (kind === 'encounter') return createEncounterState(ctx);
  throw new DomainError('UNKNOWN_CASE_KIND', `Case kind ${String(kind)} is not supported.`);
}

export function decideDomain(state: DomainState, command: DomainCommand, ctx: ActorContext): DomainDecision {
  if (typeof command.type !== 'string' || command.type.length === 0 || command.type.length > 100) {
    throw new DomainError('INVALID_COMMAND', 'Command type must be a non-empty bounded string.');
  }
  let decision: { state: DomainState; label: string } | null = null;
  if (state.kind === 'invoice') decision = handleInvoiceCommand(state, command.type, command.payload, ctx);
  if (state.kind === 'teaching') decision = handleTeachingCommand(state, command.type, command.payload, ctx);
  if (state.kind === 'encounter') decision = handleEncounterCommand(state, command.type, command.payload, ctx);
  if (decision) return decision;
  const evolution = handleEvolutionCommand(state, command.type, command.payload, ctx);
  if (evolution) return evolution;
  throw new DomainError('UNKNOWN_COMMAND', `Command ${command.type} is not supported by the ${state.kind} domain.`);
}

export { reconcileInvoice } from './invoice';
export { calculatePhysics } from './physics';
export { projectDomain } from './projections';
export type { PhysicsResult } from './physics';
export { invoiceChangeSchema, invoiceImportSchema, validateRuleSet } from './invoice';
export { physicsParamsSchema } from './physics';
export { encounterRuleSchema } from './encounter';
