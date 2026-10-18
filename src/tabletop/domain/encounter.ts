import { z } from 'zod';
import {
  type ActorContext,
  type Character,
  type EncounterRule,
  type EncounterState,
  type RevisionRecord,
} from '../shared/contracts';
import { assert, hash, hasRole, makeId, parsePayload } from './helpers';

const noPayloadSchema = z.object({}).strict();
const hitSchema = z.object({ target: z.enum(['mira', 'pip']) }).strict();
const shieldSchema = z.object({ target: z.enum(['mira', 'pip']) }).strict();
const noteSchema = z.object({ text: z.string().max(2_000) }).strict();

export const encounterRuleSchema: z.ZodType<EncounterRule> = z.object({
  allyTarget: z.boolean(),
  apCost: z.union([z.literal(0), z.literal(1)]),
  oncePerTurn: z.boolean(),
}).strict();

function initialCharacters(): Character[] {
  return [
    { id: 'mira', name: 'Mira', hp: 10, maxHp: 10, ap: 2, turnGeneration: 0, shieldUsedGeneration: null },
    { id: 'pip', name: 'Pip', hp: 10, maxHp: 10, ap: 2, turnGeneration: 0, shieldUsedGeneration: null },
    { id: 'goblin', name: 'Goblin', hp: 6, maxHp: 6, ap: 2, turnGeneration: 0, shieldUsedGeneration: null },
  ];
}

function initialRevision(ctx: ActorContext, rule: EncounterRule): RevisionRecord {
  const change = { kind: 'encounter' as const, rule: structuredClone(rule) };
  return {
    revision: 0,
    change,
    activatedAt: ctx.now,
    actorId: ctx.actorId,
    candidateHash: hash(ctx, { workspaceId: ctx.workspaceId, revision: 0, change, actorId: ctx.actorId, time: ctx.now }),
    snapshot: { kind: 'encounter', rule: structuredClone(rule) },
  };
}

export function createEncounterState(ctx: ActorContext): EncounterState {
  const rule: EncounterRule = { allyTarget: false, apCost: 0, oncePerTurn: false };
  return {
    kind: 'encounter', dataRevision: 1, ruleRevision: 0, candidate: null,
    revisions: [initialRevision(ctx, rule)], characters: initialCharacters(),
    turn: 'goblin', phase: 'turn.start', pendingHit: null, rule,
    events: [{ id: makeId(ctx, 'event', { workspaceId: ctx.workspaceId, seed: 'opening' }), text: 'The encounter starts. The goblin acts first.', createdAt: ctx.now }],
    seed: 0x6d2b79f5,
  };
}

function character(state: EncounterState, id: Character['id']): Character {
  const found = state.characters.find((item) => item.id === id);
  assert(found, 'CHARACTER_NOT_FOUND', `Character ${id} is not in this encounter.`);
  return found;
}

function appendEvent(state: EncounterState, ctx: ActorContext, key: unknown, text: string): void {
  state.events.push({ id: makeId(ctx, 'event', { workspaceId: ctx.workspaceId, key, time: ctx.now, ordinal: state.events.length }), text, createdAt: ctx.now });
}

export function handleEncounterCommand(state: EncounterState, type: string, payload: unknown, ctx: ActorContext): { state: EncounterState; label: string } | null {
  if (type === 'encounter.declareHit') {
    hasRole(ctx, ['dm']);
    const input = parsePayload(hitSchema, payload);
    assert(state.turn === 'goblin' && state.phase === 'turn.start' && state.pendingHit === null, 'ACTION_NOT_AVAILABLE', 'The goblin can declare one hit only during its own turn.');
    const next = structuredClone(state);
    const randomState = (Math.imul(next.seed, 1_664_525) + 1_013_904_223) >>> 0;
    const roll = (randomState % 20) + 1;
    const hitId = makeId(ctx, 'hit', { workspaceId: ctx.workspaceId, seed: next.seed, target: input.target, time: ctx.now });
    assert(Number.isSafeInteger(ctx.now) && Number.isSafeInteger(ctx.now + 30_000), 'INVALID_CLOCK', 'The server reaction deadline is outside the supported range.');
    next.pendingHit = {
      id: hitId, attacker: 'goblin', target: input.target, damage: 4, roll,
      deadline: ctx.now + 30_000, ruleRevision: next.ruleRevision, shields: [],
    };
    next.seed = randomState;
    next.phase = 'reaction.open';
    next.dataRevision += 1;
    appendEvent(next, ctx, hitId, `The goblin declares a hit against ${input.target === 'mira' ? 'Mira' : 'Pip'}. A reaction window is open.`);
    return { state: next, label: 'Hit declared; the reaction window is open.' };
  }
  if (type === 'encounter.shield') {
    hasRole(ctx, ['player']);
    const input = parsePayload(shieldSchema, payload);
    assert(ctx.seat === 'mira' || ctx.seat === 'pip', 'FORBIDDEN', 'The player has no server-assigned character seat.');
    assert(state.phase === 'reaction.open' && state.pendingHit !== null, 'NO_REACTION_WINDOW', 'There is no unresolved hit to shield.');
    assert(ctx.now < state.pendingHit.deadline, 'REACTION_CLOSED', 'The server reaction deadline has passed.');
    const ownId = ctx.seat;
    const own = character(state, ownId);
    assert(input.target === state.pendingHit.target, 'TARGET_MISMATCH', 'A shield must name the declared hit target.');
    assert(state.rule.allyTarget || input.target === ownId, 'ALLY_TARGET_NOT_ALLOWED', 'The active shield rule only allows self protection.');
    assert(!state.pendingHit.shields.some((intent) => intent.actor === ownId), 'REACTION_ALREADY_USED', 'This character has already declared a reaction to this hit.');
    assert(!state.pendingHit.shields.some((intent) => intent.target === input.target), 'TARGET_ALREADY_SHIELDED', 'This target already has a shield reaction for this hit.');
    assert(own.ap >= state.rule.apCost, 'INSUFFICIENT_AP', 'This character does not have enough action points for the active shield rule.');
    assert(!state.rule.oncePerTurn || own.shieldUsedGeneration !== own.turnGeneration, 'SHIELD_COOLDOWN', 'This character has already used its once-per-turn shield.');
    const next = structuredClone(state);
    next.pendingHit?.shields.push({ actor: ownId, target: input.target, ruleRevision: next.ruleRevision });
    next.dataRevision += 1;
    return { state: next, label: 'Shield reaction recorded for the current hit.' };
  }
  if (type === 'encounter.resolve') {
    hasRole(ctx, ['dm']);
    parsePayload(noPayloadSchema, payload);
    const currentPending = state.pendingHit;
    assert(state.phase === 'reaction.open' && currentPending !== null, 'NO_REACTION_WINDOW', 'There is no declared hit to resolve.');
    const next = structuredClone(state);
    const pending = structuredClone(currentPending);
    const accepted: typeof pending.shields = [];
    let reduction = 0;
    for (const intent of pending.shields) {
      const defender = next.characters.find((item) => item.id === intent.actor);
      const target = next.characters.find((item) => item.id === intent.target);
      const eligible = defender && target && intent.target === pending.target && (next.rule.allyTarget || intent.actor === intent.target)
        && defender.ap >= next.rule.apCost && (!next.rule.oncePerTurn || defender.shieldUsedGeneration !== defender.turnGeneration)
        && !accepted.some((item) => item.actor === intent.actor || item.target === intent.target);
      if (!eligible || !defender) continue;
      defender.ap -= next.rule.apCost;
      if (next.rule.oncePerTurn) defender.shieldUsedGeneration = defender.turnGeneration;
      reduction += 2;
      accepted.push({ actor: intent.actor, target: intent.target, ruleRevision: next.ruleRevision });
    }
    const target = character(next, pending.target);
    assert(pending.damage !== null, 'INVALID_AUTHORITY_STATE', 'The trusted hit has no damage value.');
    const appliedDamage = Math.max(0, pending.damage - reduction);
    target.hp = Math.max(0, target.hp - appliedDamage);
    const shielders = accepted.map((intent) => character(next, intent.actor).name);
    const shieldText = shielders.length ? ` ${shielders.join(' and ')} reduce the hit by ${reduction}.` : '';
    appendEvent(next, ctx, pending.id, `The hit resolves for ${appliedDamage} damage to ${target.name}.${shieldText}`);
    next.pendingHit = null;
    next.phase = 'action.resolved';
    next.dataRevision += 1;
    return { state: next, label: `Hit resolved for ${appliedDamage} damage.` };
  }
  if (type === 'encounter.endTurn') {
    assert(ctx.role === 'dm' || ctx.role === 'player', 'FORBIDDEN', 'Only the DM or an active player can end this turn.');
    parsePayload(noPayloadSchema, payload);
    assert(state.phase === 'turn.start' || state.phase === 'action.resolved', 'TURN_NOT_READY', 'Resolve or close the current action before ending the turn.');
    assert(state.pendingHit === null, 'ACTION_PENDING', 'An unresolved hit blocks ending the turn.');
    if (ctx.role === 'player') {
      assert((state.turn === 'mira' || state.turn === 'pip') && ctx.seat === state.turn, 'FORBIDDEN', 'A player may end only their own active character turn.');
    }
    const order: Character['id'][] = ['goblin', 'mira', 'pip'];
    const currentIndex = order.indexOf(state.turn);
    const nextTurn = order[(currentIndex + 1) % order.length];
    const next = structuredClone(state);
    const started = character(next, nextTurn);
    started.turnGeneration += 1;
    started.ap = 2;
    started.shieldUsedGeneration = null;
    next.turn = nextTurn;
    next.phase = 'turn.start';
    next.dataRevision += 1;
    appendEvent(next, ctx, { from: state.turn, to: nextTurn }, `${state.turn} ends. ${started.name}'s turn starts with 2 AP.`);
    return { state: next, label: `${started.name}'s turn started; AP reset once.` };
  }
  if (type === 'encounter.saveNote') {
    hasRole(ctx, ['dm']);
    const input = parsePayload(noteSchema, payload);
    const next = structuredClone(state);
    next.dmNote = input.text;
    return { state: next, label: 'DM note saved privately.' };
  }
  return null;
}
