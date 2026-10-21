import { DomainError, type ActorContext, type DomainState, type EncounterState, type TeachingState } from '../shared/contracts';
import { clone } from './helpers';
import { projectCanvasLayout } from './canvas-layout';
import { VISIBILITY_POLICY, type VisibilityPolicy } from '../shared/visibility';

/** Membership/role gate shared by both visibility policies. */
function assertCanRead(state: DomainState, ctx: ActorContext): void {
  if (state.kind === 'table') {
    if (ctx.role !== 'owner' && ctx.role !== 'participant') throw new DomainError('FORBIDDEN', 'Only room members may read this table.');
  } else if (state.kind === 'invoice') {
    if (ctx.role !== 'owner') throw new DomainError('FORBIDDEN', 'Only the invoice owner can read invoice evidence and results.');
  } else if (state.kind === 'teaching') {
    if (ctx.role !== 'teacher' && ctx.role !== 'learner') throw new DomainError('FORBIDDEN', 'Only a teacher or learner can read this lesson.');
  } else if (ctx.role !== 'dm' && (ctx.role !== 'player' || (ctx.seat !== 'mira' && ctx.seat !== 'pip'))) {
    throw new DomainError('FORBIDDEN', 'Only a seated player or the DM can read this encounter.');
  }
}

/** What one member receives. Under the 'open' policy (F015) members see the whole state. */
export function projectDomain(state: DomainState, ctx: ActorContext, policy: VisibilityPolicy = VISIBILITY_POLICY): DomainState {
  assertCanRead(state, ctx);
  if (policy === 'open') {
    const full = clone(state);
    // Retired view positions are dropped for everyone, as before.
    if (full.kind === 'table' && state.kind === 'table' && state.canvasLayout) full.canvasLayout = projectCanvasLayout(state);
    return full;
  }
  return projectPrivate(state, ctx);
}

/** The 'private' policy: role projections, kept for later use. */
function projectPrivate(state: DomainState, ctx: ActorContext): DomainState {
  if (state.kind === 'table') {
    if (ctx.role !== 'owner' && ctx.role !== 'participant') throw new DomainError('FORBIDDEN', 'Only room members may read this table.');
    const projected = clone(state);
    if (state.canvasLayout) projected.canvasLayout = projectCanvasLayout(state);
    if (ctx.role === 'participant') {
      // F008: table files are visible to every member; drafts and draft history stay with the owner.
      projected.candidate = null; projected.revisions = [];
      if (projected.program) projected.program.evidence = [];
    }
    return projected;
  }
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
