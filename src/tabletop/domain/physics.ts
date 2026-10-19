import { z } from 'zod';
import type { PhysicsParams } from '../shared/contracts';
import { parsePayload } from './helpers';

export const physicsParamsSchema: z.ZodType<PhysicsParams> = z.object({
  force: z.number().finite().min(0).max(20),
  mass: z.number().finite().min(0.5).max(10),
  time: z.number().finite().min(0).max(5),
}).strict();

export interface PhysicsResult {
  acceleration: number;
  velocity: number;
  position: number;
}

export function calculatePhysics(input: PhysicsParams): PhysicsResult {
  const params = parsePayload(physicsParamsSchema, input);
  const acceleration = params.force / params.mass;
  const velocity = acceleration * params.time;
  const position = 0.5 * acceleration * params.time * params.time;
  return { acceleration, velocity, position };
}
