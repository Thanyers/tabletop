import type { EvaluatedSceneMotion, EvaluatedScenePrimitive } from '../runtime/generative/evaluator';

/** F040: the host animates a scene element along one axis without touching table state. */
export const MOTION_FRAME_MS = 33;

/** True when any projected element carries motion; the scene only starts a clock then. */
export function sceneHasMotion(elements: readonly EvaluatedScenePrimitive[]): boolean {
  return elements.some((element) => 'motion' in element && element.motion !== undefined);
}

/**
 * Position along the motion axis at `elapsedSeconds`.
 * Loops at `to` (default) or stops there; a non-positive speed leaves the element at `from`.
 */
export function motionPosition(motion: EvaluatedSceneMotion, elapsedSeconds: number): number {
  const span = motion.to - motion.from;
  if (!Number.isFinite(span) || span === 0 || !(motion.speed > 0) || !Number.isFinite(elapsedSeconds)) return motion.from;
  const distance = Math.max(0, elapsedSeconds) * motion.speed;
  if (motion.loop === false) return distance >= Math.abs(span) ? motion.to : motion.from + Math.sign(span) * distance;
  const travelled = distance % Math.abs(span);
  return motion.from + Math.sign(span) * travelled;
}

/** Returns a copy of the projected element at the animated position; table state is unchanged. */
export function applySceneMotion(element: EvaluatedScenePrimitive, elapsedSeconds: number): EvaluatedScenePrimitive {
  if (!('motion' in element) || !element.motion) return element;
  const position = motionPosition(element.motion, elapsedSeconds);
  const axis = element.motion.axis;
  if (element.shape === 'rect') return axis === 'x' ? { ...element, x: position } : { ...element, y: position };
  if (element.shape === 'circle') return axis === 'x' ? { ...element, cx: position } : { ...element, cy: position };
  if (element.shape === 'text') return axis === 'x' ? { ...element, x: position } : { ...element, y: position };
  return element;
}
