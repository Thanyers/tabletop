import { handleAccessCommand } from './access';
import { DomainError, type ActorContext, type CaseKind, type DomainCommand, type DomainDecision, type DomainState } from '../shared/contracts';
import { createInvoiceState, handleInvoiceCommand } from './invoice';
import { createTeachingState, handleTeachingCommand } from './teaching';
import { createEncounterState, handleEncounterCommand } from './encounter';
import { handleEvolutionCommand } from './evolution';
import { handleDisplayCommand } from './display';
import { createTableState, handleTableCommand } from './table';
import { handleCanvasLayout } from './canvas-layout';

export function createDomain(kind: CaseKind, ctx: ActorContext): DomainState {
  if (kind === 'table') return createTableState();
  if (kind === 'invoice') return createInvoiceState(ctx);
  if (kind === 'teaching') return createTeachingState(ctx);
  if (kind === 'encounter') return createEncounterState(ctx);
  throw new DomainError('UNKNOWN_CASE_KIND', `Case kind ${String(kind)} is not supported.`);
}

export function decideDomain(state: DomainState, command: DomainCommand, ctx: ActorContext): DomainDecision {
  if (typeof command.type !== 'string' || command.type.length === 0 || command.type.length > 100) {
    throw new DomainError('INVALID_COMMAND', 'Command type must be a non-empty bounded string.');
  }
  if (state.kind === 'encounter' && state.paused !== undefined && command.type === 'evolve.activate') {
    if (ctx.role !== 'dm') throw new DomainError('FORBIDDEN', 'Only the DM may activate encounter rules.');
    throw new DomainError('ENCOUNTER_PAUSED', 'Resume the encounter before activating an encounter rule.');
  }
  let decision: { state: DomainState; label: string } | null = null;
  if (state.kind === 'table' && command.type === 'canvas.layout') return handleCanvasLayout(state, command.payload, ctx);
  const access = handleAccessCommand(state, command.type, command.payload, ctx);
  if (access) return access;
  const display = handleDisplayCommand(state, command.type, command.payload, ctx);
  if (display) return display;
  if (state.kind === 'table') decision = handleTableCommand(state, command.type, command.payload, ctx);
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
