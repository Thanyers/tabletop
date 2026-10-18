import { DomainError, type ActorContext, type DomainState, type EncounterState, type TeachingState } from '../shared/contracts';
import { clone } from './helpers';

export function projectDomain(state: DomainState, ctx: ActorContext): DomainState {
  if (state.kind === 'invoice') {
    if (ctx.role !== 'owner') throw new DomainError('FORBIDDEN', 'Only the invoice owner can read invoice evidence and results.');
    return clone(state);
  }
  if (state.kind === 'teaching') {
    if (ctx.role === 'teacher') return clone(state);
    if (ctx.role !== 'learner') throw new DomainError('FORBIDDEN', 'Only a teacher or learner can read this lesson.');
    const projected: TeachingState = clone(state);
    projected.candidate = null;
    projected.answers = projected.answers.filter((answer) => answer.actorId === ctx.actorId);
    projected.representations = Object.fromEntries(Object.entries(projected.representations).filter(([actorId]) => actorId === ctx.actorId));
    projected.difficulties = Object.fromEntries(Object.entries(projected.difficulties).filter(([actorId]) => actorId === ctx.actorId));
    projected.dataRevision = projected.ruleRevision + projected.answers.length + 1;
    delete projected.teacherNote;
    return projected;
  }
  if (ctx.role === 'dm') return clone(state);
  if (ctx.role !== 'player' || (ctx.seat !== 'mira' && ctx.seat !== 'pip')) {
    throw new DomainError('FORBIDDEN', 'Only a seated player or the DM can read this encounter.');
  }
  const projected: EncounterState = clone(state);
  projected.characters = projected.characters.filter((character) => character.id !== 'goblin');
  projected.candidate = null;
  projected.seed = 0;
  delete projected.dmNote;
  if (projected.pendingHit) {
    projected.pendingHit.roll = null;
    projected.pendingHit.damage = null;
    projected.pendingHit.shields = projected.pendingHit.shields.filter((intent) => intent.actor === ctx.seat);
  }
  projected.dataRevision = projected.events.length + projected.ruleRevision + (projected.pendingHit?.shields.length ?? 0) + 1;
  return projected;
}
