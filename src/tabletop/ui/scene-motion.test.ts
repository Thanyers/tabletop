import { describe, expect, it } from 'vitest';
import type { EvaluatedSceneMotion, EvaluatedScenePrimitive } from '../runtime/generative/evaluator';
import { applySceneMotion, motionPosition, sceneHasMotion } from './scene-motion';

const motion: EvaluatedSceneMotion = { axis: 'x', from: 40, to: 760, speed: 100, loop: true };

describe('scene motion clock (F040)', () => {
  it('starts at from and wraps back to from after the full span', () => {
    expect(motionPosition(motion, 0)).toBe(40);
    expect(motionPosition(motion, 1)).toBe(140);
    expect(motionPosition(motion, 7.2)).toBe(40);
    expect(motionPosition(motion, 7.21)).toBeCloseTo(41, 6);
  });

  it('walks backwards when to is before from and stops when loop is false', () => {
    expect(motionPosition({ ...motion, from: 760, to: 40 }, 1)).toBe(660);
    expect(motionPosition({ ...motion, loop: false }, 1)).toBe(140);
    expect(motionPosition({ ...motion, loop: false }, 99)).toBe(760);
  });

  it('stays at from for a non-positive speed or an empty span', () => {
    expect(motionPosition({ ...motion, speed: 0 }, 3)).toBe(40);
    expect(motionPosition({ ...motion, to: 40 }, 3)).toBe(40);
  });

  it('moves the right coordinate of rect, circle and text without mutating the projection', () => {
    const car: EvaluatedScenePrimitive = { id: 'car', shape: 'rect', x: 40, y: 300, width: 80, height: 36, motion };
    expect(applySceneMotion(car, 1)).toMatchObject({ x: 140, y: 300 });
    expect(car).toMatchObject({ x: 40 });
    const wheel: EvaluatedScenePrimitive = { id: 'wheel', shape: 'circle', cx: 50, cy: 330, r: 8, motion: { ...motion, axis: 'y' } };
    expect(applySceneMotion(wheel, 1)).toMatchObject({ cx: 50, cy: 140 });
    const label: EvaluatedScenePrimitive = { id: 'speed', shape: 'text', x: 40, y: 40, text: '10 m/s', motion };
    expect(applySceneMotion(label, 1)).toMatchObject({ x: 140 });
  });

  it('reports whether a projected scene animates at all', () => {
    expect(sceneHasMotion([{ id: 'rail', shape: 'line', x1: 0, y1: 0, x2: 10, y2: 0 }])).toBe(false);
    expect(sceneHasMotion([{ id: 'car', shape: 'rect', x: 0, y: 0, width: 1, height: 1, motion }])).toBe(true);
  });
});
