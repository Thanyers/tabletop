import { rollDiceCount, rollSpecProblems, type RollResult, type RollSpec, type TablePendingRoll } from '../shared/roll';
import { assert } from './helpers';

const UINT32_RANGE = 0x1_0000_0000;
/** A biased sample is refused rather than retried forever if a caller supplies a broken source. */
const MAX_DRAWS_PER_DIE = 128;

/** Uniform uint32 from the platform CSPRNG (Node and Workers both expose `crypto.getRandomValues`). */
export function cryptoUint32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0] ?? 0;
}

/**
 * F048: every die comes from the platform CSPRNG. Rejection sampling keeps each face equally likely
 * instead of folding 2^32 with `%` (which would favour the low faces).
 */
export function drawDice(spec: RollSpec, nextUint32: () => number = cryptoUint32): number[] {
  const problems = rollSpecProblems(spec);
  assert(problems.length === 0, 'TABLE_ROLL_LIMIT', problems[0] ?? 'The roll bounds are invalid.');
  const values: number[] = [];
  for (const group of spec.groups) {
    const limit = Math.floor(UINT32_RANGE / group.faces) * group.faces;
    for (let index = 0; index < group.count; index += 1) {
      let draw = nextUint32();
      let attempts = 1;
      while (draw >= limit) {
        assert(attempts < MAX_DRAWS_PER_DIE, 'TABLE_ROLL_LIMIT', 'The random source is not usable for this roll.');
        draw = nextUint32();
        attempts += 1;
      }
      values.push((draw % group.faces) + 1);
    }
  }
  return values;
}

/** Dice plus the declared modifier, refusing a total outside the safe integer range. */
export function rollTotal(values: readonly number[], modifier = 0): number {
  let total = modifier;
  for (const value of values) {
    total += value;
    assert(Number.isSafeInteger(total), 'TABLE_ROLL_LIMIT', 'The roll total exceeds the supported safe integer range.');
  }
  return total;
}

/** Rolls one declared parameter; `nextUint32` is injectable so tests can pin the dice. */
export function createRoll(spec: RollSpec, nextUint32?: () => number): RollResult {
  const values = nextUint32 ? drawDice(spec, nextUint32) : drawDice(spec);
  return {
    groups: spec.groups.map((group) => ({ count: group.count, faces: group.faces })),
    values,
    total: rollTotal(values, spec.modifier ?? 0),
  };
}

/**
 * Re-checks a stored pending roll before it fills an action input. A forged or edited pending roll
 * cannot smuggle in out-of-range faces or a total that its own dice do not add up to.
 */
export function assertPendingRoll(pending: TablePendingRoll, spec: RollSpec): void {
  assert(pending.modifier === (spec.modifier ?? 0), 'INVALID_AUTHORITY_STATE', 'The stored roll modifier no longer matches its parameter.');
  assert(rollDiceCount(spec) === pending.values.length, 'INVALID_AUTHORITY_STATE', 'The stored roll has the wrong number of dice.');
  assert(pending.groups.length === spec.groups.length
    && pending.groups.every((group, index) => group.count === spec.groups[index]?.count && group.faces === spec.groups[index]?.faces),
  'INVALID_AUTHORITY_STATE', 'The stored roll groups no longer match its parameter.');
  for (const [index, value] of pending.values.entries()) {
    let seen = 0;
    for (const group of pending.groups) {
      if (index < seen + group.count) {
        assert(Number.isInteger(value) && value >= 1 && value <= group.faces, 'INVALID_AUTHORITY_STATE', 'A stored die is outside its faces.');
        break;
      }
      seen += group.count;
    }
  }
  assert(pending.total === rollTotal(pending.values, pending.modifier), 'INVALID_AUTHORITY_STATE', 'The stored roll total does not match its dice.');
}

/** Drops expired rolls and any earlier roll for the same actor/action/parameter (a re-roll replaces it). */
export function retainPendingRolls(
  pendingRolls: readonly TablePendingRoll[] | undefined,
  now: number,
  replaced: { actorId: string; actionId: string; parameterId: string },
): TablePendingRoll[] {
  return (pendingRolls ?? []).filter((item) => item.expiresAt > now
    && !(item.actorId === replaced.actorId && item.actionId === replaced.actionId && item.parameterId === replaced.parameterId));
}

export function consumePendingRolls(
  pendingRolls: readonly TablePendingRoll[] | undefined,
  consumed: { actorId: string; actionId: string; parameterId: string },
): TablePendingRoll[] | undefined {
  const remaining = (pendingRolls ?? []).filter((item) => !(item.actorId === consumed.actorId
    && item.actionId === consumed.actionId && item.parameterId === consumed.parameterId));
  return remaining.length === 0 ? undefined : remaining;
}
