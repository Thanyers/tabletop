import { z } from 'zod';
import {
  type ActorContext,
  type PhysicsParams,
  type RevisionRecord,
  type TeachingState,
} from '../shared/contracts';
import { calculatePhysics, physicsParamsSchema } from './physics';
import { assert, hash, hasRole, ID_SCHEMA, makeId, parsePayload } from './helpers';

const representationSchema = z.object({
  actorId: ID_SCHEMA,
  representation: z.enum(['text', 'scene', 'graph']),
  difficulty: z.enum(['beginner', 'advanced']),
}).strict();
const answerSchema = z.object({
  questionId: ID_SCHEMA,
  lessonRevision: z.number().int().nonnegative(),
  value: z.number().finite().min(-1_000_000).max(1_000_000),
}).strict();
const noteSchema = z.object({ text: z.string().max(2_000) }).strict();
const answerTolerance = 1e-6;

export function makeTeachingQuestionId(ctx: ActorContext, params: PhysicsParams, revision: number): string {
  return makeId(ctx, 'question', { workspaceId: ctx.workspaceId, params, revision });
}

function revisionSnapshot(ctx: ActorContext, params: PhysicsParams, revision: number, change: { kind: 'teaching'; parameters: PhysicsParams }): RevisionRecord {
  return {
    revision,
    change,
    activatedAt: ctx.now,
    actorId: ctx.actorId,
    candidateHash: hash(ctx, { workspaceId: ctx.workspaceId, revision, change, actorId: ctx.actorId, time: ctx.now }),
    snapshot: { kind: 'teaching', parameters: structuredClone(params) },
  };
}

export function createTeachingState(ctx: ActorContext): TeachingState {
  const parameters: PhysicsParams = { force: 10, mass: 2, time: 2 };
  const initialChange = { kind: 'teaching' as const, parameters: structuredClone(parameters) };
  const initialRevision = revisionSnapshot(ctx, parameters, 0, initialChange);
  return {
    kind: 'teaching', dataRevision: 1, ruleRevision: 0, candidate: null, revisions: [initialRevision],
    parameters, representations: {}, difficulties: {}, questionId: makeTeachingQuestionId(ctx, parameters, 0), answers: [],
  };
}

export function handleTeachingCommand(state: TeachingState, type: string, payload: unknown, ctx: ActorContext): { state: TeachingState; label: string } | null {
  if (type === 'teaching.setParameters') {
    hasRole(ctx, ['teacher']);
    const nextParams = parsePayload(physicsParamsSchema, payload);
    if (nextParams.force === state.parameters.force && nextParams.mass === state.parameters.mass && nextParams.time === state.parameters.time) {
      return { state: structuredClone(state), label: 'Lesson parameters are unchanged.' };
    }
    const next = structuredClone(state);
    next.ruleRevision += 1;
    next.dataRevision += 1;
    next.parameters = nextParams;
    next.questionId = makeTeachingQuestionId(ctx, nextParams, next.ruleRevision);
    const change = { kind: 'teaching' as const, parameters: structuredClone(nextParams) };
    next.revisions.push(revisionSnapshot(ctx, nextParams, next.ruleRevision, change));
    return { state: next, label: `Shared lesson updated to revision ${next.ruleRevision}.` };
  }
  if (type === 'teaching.setRepresentation') {
    hasRole(ctx, ['teacher']);
    const input = parsePayload(representationSchema, payload);
    const next = structuredClone(state);
    next.representations[input.actorId] = input.representation;
    next.difficulties[input.actorId] = input.difficulty;
    return { state: next, label: `Saved the lesson view for ${input.actorId}.` };
  }
  if (type === 'teaching.answer') {
    hasRole(ctx, ['learner']);
    assert(ctx.seat === 'learner-1' || ctx.seat === 'learner-2', 'FORBIDDEN', 'A learner answer requires a server-assigned learner seat.');
    const input = parsePayload(answerSchema, payload);
    assert(input.questionId === state.questionId && input.lessonRevision === state.ruleRevision, 'STALE_LESSON', 'The lesson changed before this answer arrived. Refresh the current question and answer again.');
    const expected = calculatePhysics(state.parameters).position;
    const correct = Math.abs(input.value - expected) <= answerTolerance;
    const next = structuredClone(state);
    next.answers.push({
      actorId: ctx.actorId,
      name: ctx.name,
      questionId: input.questionId,
      lessonRevision: input.lessonRevision,
      value: input.value,
      correct,
      feedback: correct ? 'Correct: the cart position matches the shared model.' : `Check the shared model again; its position is ${expected} m.`,
      submittedAt: ctx.now,
    });
    next.dataRevision += 1;
    return { state: next, label: correct ? 'Answer saved as correct.' : 'Answer saved with a worked hint.' };
  }
  if (type === 'teaching.saveNote') {
    hasRole(ctx, ['teacher']);
    const input = parsePayload(noteSchema, payload);
    const next = structuredClone(state);
    next.teacherNote = input.text;
    return { state: next, label: 'Teacher note saved privately.' };
  }
  if (type === 'evolve.propose' && typeof payload === 'object' && payload !== null && 'change' in payload) {
    // The generic evolution reducer handles teaching proposals.
    return null;
  }
  return null;
}
