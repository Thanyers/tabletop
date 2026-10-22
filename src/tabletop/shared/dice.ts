/**
 * F049: bounded dice maths shared by program validation and the visual dice card.
 *
 * For a `number` parameter randomness is CLIENT-SIDE and visual-only: `secureDiceRandom`
 * uses the Web Crypto CSPRNG and the result only fills a client draft. For a `roll`
 * parameter the card shows the authoritative F048 server roll instead (F051), so this
 * module is never the source of a rolled value there.
 */

/** Hard limits for a dice control; they are enforced by the zod schema and program validation. */
export const DICE_LIMITS = {
  minFaces: 2,
  maxFaces: 100,
  minCount: 1,
  maxCount: 10,
  maxModifier: 1000,
  /** How long the CSS tumble runs; reduced-motion users never see it. */
  tumbleMs: 450,
} as const;

export interface DiceSpec {
  /** Faces per die, 2..100. */
  faces: number;
  /** Number of dice, 1..10. */
  count: number;
  /** Flat modifier added to the sum; integer, |modifier| <= 1000. Defaults to 0. */
  modifier?: number;
}

export interface DiceRoll {
  /** One entry per die, 1..faces. */
  faces: number[];
  /** Sum of `faces` plus the modifier. */
  total: number;
  modifier: number;
}

/** Returns a whole number in [0, maxExclusive). Injected in tests; production uses `secureDiceRandom`. */
export type DiceRandom = (maxExclusive: number) => number;

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/** Validates the whole spec; returns human-readable issues so schema and program validation can share one source of truth. */
export function validateDiceSpec(spec: DiceSpec): string[] {
  const issues: string[] = [];
  if (!isWholeNumber(spec.faces) || spec.faces < DICE_LIMITS.minFaces || spec.faces > DICE_LIMITS.maxFaces) {
    issues.push(`Dice faces must be a whole number from ${DICE_LIMITS.minFaces} to ${DICE_LIMITS.maxFaces}.`);
  }
  if (!isWholeNumber(spec.count) || spec.count < DICE_LIMITS.minCount || spec.count > DICE_LIMITS.maxCount) {
    issues.push(`Dice count must be a whole number from ${DICE_LIMITS.minCount} to ${DICE_LIMITS.maxCount}.`);
  }
  if (spec.modifier !== undefined && (!isWholeNumber(spec.modifier) || Math.abs(spec.modifier) > DICE_LIMITS.maxModifier)) {
    issues.push(`Dice modifier must be a whole number from -${DICE_LIMITS.maxModifier} to ${DICE_LIMITS.maxModifier}.`);
  }
  return issues;
}

/** Lowest and highest totals this spec can produce, used to explain an out-of-range roll. */
export function diceTotalRange(spec: DiceSpec): { minimum: number; maximum: number } {
  const modifier = spec.modifier ?? 0;
  return { minimum: spec.count + modifier, maximum: spec.count * spec.faces + modifier };
}

/**
 * Rolls `count` dice of `faces` with an unbiased random source.
 * Throws `RangeError` for invalid specs instead of silently clamping, so a broken program is visible.
 */
export function rollDice(spec: DiceSpec, random: DiceRandom = secureDiceRandom): DiceRoll {
  const issues = validateDiceSpec(spec);
  if (issues.length > 0) throw new RangeError(issues[0]);
  const modifier = spec.modifier ?? 0;
  const faces: number[] = [];
  for (let index = 0; index < spec.count; index += 1) {
    const offset = random(spec.faces);
    if (!isWholeNumber(offset) || offset < 0 || offset >= spec.faces) {
      throw new RangeError('The dice random source returned a value outside its face range.');
    }
    faces.push(offset + 1);
  }
  return { faces, total: faces.reduce((sum, face) => sum + face, 0) + modifier, modifier };
}

/** True when a rolled total fits the bound action parameter, so the card can explain a rejected value. */
export function diceTotalFitsParameter(total: number, parameter: { min?: number; max?: number }): boolean {
  return (parameter.min === undefined || total >= parameter.min) && (parameter.max === undefined || total <= parameter.max);
}

const UINT32_RANGE = 0x1_0000_0000;

/** The one Web Crypto method dice need; declared locally so this file also typechecks without the DOM lib. */
interface RandomValuesApi {
  getRandomValues(array: Uint32Array): Uint32Array;
}

function randomValuesApi(): RandomValuesApi | undefined {
  const candidate = (globalThis as unknown as { crypto?: Partial<RandomValuesApi> }).crypto;
  return candidate && typeof candidate.getRandomValues === 'function' ? candidate as RandomValuesApi : undefined;
}

/**
 * Unbiased integer in [0, maxExclusive) from the Web Crypto CSPRNG.
 * Rejection sampling keeps every face equally likely; Math.random is never used (F049).
 */
export function secureDiceRandom(maxExclusive: number): number {
  if (!isWholeNumber(maxExclusive) || maxExclusive < 1 || maxExclusive > UINT32_RANGE) {
    throw new RangeError('A dice random source needs a whole range from 1 to 2^32.');
  }
  const cryptoApi = randomValuesApi();
  if (!cryptoApi) throw new Error('This browser cannot provide a secure random source for dice.');
  const limit = Math.floor(UINT32_RANGE / maxExclusive) * maxExclusive;
  const buffer = new Uint32Array(1);
  for (;;) {
    cryptoApi.getRandomValues(buffer);
    const value = buffer[0];
    if (value < limit) return value % maxExclusive;
  }
}

/** Pip positions (0..8 on a 3x3 grid) for a classic d6 face. Higher faces show the number instead. */
export const DIE_PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export function diePips(face: number): readonly number[] {
  return DIE_PIPS[face] ?? [];
}
