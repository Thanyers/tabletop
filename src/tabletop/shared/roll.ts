/**
 * F048: a server-issued dice roll bound to one table action parameter.
 *
 * The client never sends the rolled value. It asks `table.roll`, shows what came back, and the
 * authority consumes the stored pending roll when the action commits. Limits live here so the
 * zod schema, the program check, the prompt guide, and the tests share one source of truth.
 */
export const ROLL_LIMITS = {
  /** One to four groups of identical dice, e.g. 2d6 + 1d8. */
  groups: 4,
  dicePerGroup: 10,
  facesMin: 2,
  facesMax: 100,
  /** Total dice across every group in one roll. */
  dice: 20,
  modifier: 1_000,
  /** Pending rolls expire after ten minutes of server time. */
  pendingTtlMs: 10 * 60 * 1_000,
  /** One actor can keep a handful of unused rolls without growing room state without bound. */
  pendingPerTable: 32,
} as const;

/** Identical dice: `count` dice with `faces` faces. */
export interface RollGroup { count: number; faces: number }

/** The declared shape of a roll parameter. */
export interface RollSpec { groups: RollGroup[]; modifier?: number }

/** What `table.roll` returns to the caller and what a commit records. */
export interface RollResult {
  groups: RollGroup[];
  /** One face per die, in group order. */
  values: number[];
  total: number;
}

/** A roll kept on the authoritative table state until the action consumes it. */
export interface TablePendingRoll extends RollResult {
  actorId: string;
  actionId: string;
  parameterId: string;
  modifier: number;
  /** Table data revision when the roll was issued; a later data change makes it stale. */
  dataRevision: number;
  createdAt: number;
  expiresAt: number;
}

export function rollDiceCount(spec: RollSpec): number {
  return spec.groups.reduce((total, group) => total + group.count, 0);
}

/** Display notation for a declared roll, e.g. `2d6 + 3`. Shared by both roll controls (F048, F051). */
export function rollNotation(spec: RollSpec): string {
  const groups = spec.groups.map(group => `${group.count}d${group.faces}`).join(' + ');
  const modifier = spec.modifier;
  if (modifier === undefined || modifier === 0) return groups;
  return `${groups} ${modifier > 0 ? '+' : '-'} ${Math.abs(modifier)}`;
}

/** Problems with a declared roll spec; empty when it is valid. Mirrors the zod bounds. */
export function rollSpecProblems(spec: RollSpec): string[] {
  const problems: string[] = [];
  if (!Array.isArray(spec.groups) || spec.groups.length < 1 || spec.groups.length > ROLL_LIMITS.groups) {
    problems.push(`A roll needs 1 to ${ROLL_LIMITS.groups} groups of dice.`);
  }
  for (const group of Array.isArray(spec.groups) ? spec.groups : []) {
    if (!Number.isInteger(group.count) || group.count < 1 || group.count > ROLL_LIMITS.dicePerGroup) {
      problems.push(`Each roll group needs 1 to ${ROLL_LIMITS.dicePerGroup} dice.`);
    }
    if (!Number.isInteger(group.faces) || group.faces < ROLL_LIMITS.facesMin || group.faces > ROLL_LIMITS.facesMax) {
      problems.push(`Dice need ${ROLL_LIMITS.facesMin} to ${ROLL_LIMITS.facesMax} faces.`);
    }
  }
  if (Array.isArray(spec.groups) && rollDiceCount(spec) > ROLL_LIMITS.dice) {
    problems.push(`A roll uses at most ${ROLL_LIMITS.dice} dice in total.`);
  }
  if (spec.modifier !== undefined && (!Number.isInteger(spec.modifier) || Math.abs(spec.modifier) > ROLL_LIMITS.modifier)) {
    problems.push(`A roll modifier must be a whole number between -${ROLL_LIMITS.modifier} and ${ROLL_LIMITS.modifier}.`);
  }
  return problems;
}
