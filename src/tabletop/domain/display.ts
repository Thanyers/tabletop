import { z } from 'zod';
import type { ActorContext, DomainState } from '../shared/contracts';
import { parsePayload, requirePermission } from './helpers';

/** Table-wide display settings: how the canvas looks for everyone at this table. */
export const DISPLAY_COMMANDS = ['display.set'] as const;

// null = follow the default (connection lines show when the table has any).
const displaySchema = z.strictObject({ connections: z.boolean().nullable() });

function creatorRole(state: DomainState): ActorContext['role'] {
  return state.kind === 'teaching' ? 'teacher' : state.kind === 'encounter' ? 'dm' : 'owner';
}

export function handleDisplayCommand(state: DomainState, type: string, payload: unknown, ctx: ActorContext): { state: DomainState; label: string } | null {
  if (type !== 'display.set') return null;
  // Display settings sit with the table's name and other table settings.
  requirePermission(ctx, 'table.rename', [creatorRole(state)]);
  const input = parsePayload(displaySchema, payload);
  const next = structuredClone(state);
  const display = { ...(next.display ?? {}) };
  if (input.connections === null) delete display.connections;
  else display.connections = input.connections;
  if (Object.keys(display).length > 0) next.display = display;
  else delete next.display;
  const label = input.connections === null ? 'Connection lines follow the default.' : `Connection lines ${input.connections ? 'shown' : 'hidden'} for this table.`;
  return { state: next, label };
}
