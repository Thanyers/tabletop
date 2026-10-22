import { describe, expect, it, vi } from 'vitest';
import { DICE_LIMITS, diceTotalFitsParameter, diceTotalRange, diePips, rollDice, secureDiceRandom, validateDiceSpec } from './dice';

describe('dice maths', () => {
  it('rolls the requested number of dice and adds the modifier', () => {
    const roll = rollDice({ faces: 6, count: 3, modifier: 2 }, () => 0);

    expect(roll.faces).toEqual([1, 1, 1]);
    expect(roll.total).toBe(5);
    expect(roll.modifier).toBe(2);
  });

  it('uses the highest face when the source returns faces - 1', () => {
    const roll = rollDice({ faces: 20, count: 2 }, () => 19);

    expect(roll.faces).toEqual([20, 20]);
    expect(roll.total).toBe(40);
    expect(roll.modifier).toBe(0);
  });

  it('asks the random source once per die and only within the face count', () => {
    const values = [0, 2, 5];
    const random = vi.fn((maxExclusive: number) => {
      expect(maxExclusive).toBe(6);
      return values.shift() ?? 0;
    });

    const roll = rollDice({ faces: 6, count: 3 }, random);

    expect(random).toHaveBeenCalledTimes(3);
    expect(roll.faces).toEqual([1, 3, 6]);
    expect(roll.total).toBe(10);
  });

  it('rejects specs outside the hard limits instead of clamping them', () => {
    expect(() => rollDice({ faces: DICE_LIMITS.minFaces - 1, count: 1 }, () => 0)).toThrow(RangeError);
    expect(() => rollDice({ faces: DICE_LIMITS.maxFaces + 1, count: 1 }, () => 0)).toThrow(RangeError);
    expect(() => rollDice({ faces: 6, count: DICE_LIMITS.minCount - 1 }, () => 0)).toThrow(RangeError);
    expect(() => rollDice({ faces: 6, count: DICE_LIMITS.maxCount + 1 }, () => 0)).toThrow(RangeError);
    expect(() => rollDice({ faces: 6, count: 1, modifier: DICE_LIMITS.maxModifier + 1 }, () => 0)).toThrow(RangeError);
  });

  it('rejects a random source that leaves the face range', () => {
    expect(() => rollDice({ faces: 6, count: 1 }, () => 6)).toThrow(RangeError);
    expect(() => rollDice({ faces: 6, count: 1 }, () => -1)).toThrow(RangeError);
    expect(() => rollDice({ faces: 6, count: 1 }, () => 1.5)).toThrow(RangeError);
  });

  it('orders the total range from all ones to every die on its highest face', () => {
    expect(diceTotalRange({ faces: 20, count: 2, modifier: -3 })).toEqual({ minimum: -1, maximum: 37 });
    expect(diceTotalRange({ faces: 6, count: 1 })).toEqual({ minimum: 1, maximum: 6 });
  });

  it('checks a rolled total against the bound action parameter bounds', () => {
    expect(diceTotalFitsParameter(7, { min: 1, max: 20 })).toBe(true);
    expect(diceTotalFitsParameter(0, { min: 1 })).toBe(false);
    expect(diceTotalFitsParameter(21, { max: 20 })).toBe(false);
    expect(diceTotalFitsParameter(1000, {})).toBe(true);
  });

  it('validates whole-number faces, count, and modifier', () => {
    expect(validateDiceSpec({ faces: 2, count: 1 })).toEqual([]);
    expect(validateDiceSpec({ faces: 100, count: 10, modifier: -1000 })).toEqual([]);
    expect(validateDiceSpec({ faces: 1, count: 1 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 101, count: 1 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6.5, count: 1 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 0 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 11 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 1.5 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 1, modifier: 1001 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 1, modifier: -1001 })).toHaveLength(1);
    expect(validateDiceSpec({ faces: 6, count: 1, modifier: 0.5 })).toHaveLength(1);
  });

  it('draws whole crypto integers inside the requested range', () => {
    const seen = new Set<number>();
    for (let index = 0; index < 200; index += 1) {
      const value = secureDiceRandom(6);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(6);
      seen.add(value);
    }
    expect(seen.size).toBeGreaterThan(1);
    expect(() => secureDiceRandom(0)).toThrow(RangeError);
    expect(() => secureDiceRandom(6.5)).toThrow(RangeError);
  });

  it('maps classic d6 faces to pips and leaves larger faces numeric', () => {
    expect(diePips(1)).toEqual([4]);
    expect(diePips(6)).toHaveLength(6);
    expect(diePips(20)).toEqual([]);
  });
});
