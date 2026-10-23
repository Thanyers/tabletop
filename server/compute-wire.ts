import { z } from 'zod';
import { computePortValueSchema, type ComputeRunnerRequest, type ComputeRunnerResult } from '../src/tabletop/shared/table-compute.js';
import { COMPUTE_WIRE_BYTES } from '../src/tabletop/shared/compute-runtime-profiles.js';

const resultSchema = z.strictObject({ outputs: z.record(z.string(), computePortValueSchema) });

export function computeInputValues(request: ComputeRunnerRequest): Record<string, unknown> {
  return Object.fromEntries(Object.entries(request.inputs).map(([id, input]) => [id, input.value]));
}

export function computeWireRequest(request: ComputeRunnerRequest): string {
  const body = JSON.stringify({ source: request.source, inputs: computeInputValues(request) });
  if (new TextEncoder().encode(body).byteLength > COMPUTE_WIRE_BYTES) throw new Error('COMPUTE_INPUT_TOO_LARGE');
  return body;
}

export function parseComputeWireResult(body: string): ComputeRunnerResult {
  if (new TextEncoder().encode(body).byteLength > COMPUTE_WIRE_BYTES) throw new Error('COMPUTE_INVALID_OUTPUT');
  const result = resultSchema.safeParse(JSON.parse(body));
  if (!result.success) throw new Error('COMPUTE_INVALID_OUTPUT');
  return result.data;
}
