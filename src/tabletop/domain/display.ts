import { z } from 'zod';
import { MAX_TABLE_MEMBER_SEATS, type ActorContext, type DisplaySettings, type DomainState } from '../shared/contracts';
import { assert, parsePayload, requirePermission } from './helpers';

/** Table-wide display settings: how the canvas looks for everyone at this table, and how many people may join. */
export const DISPLAY_COMMANDS = ['display.set'] as const;

// Each field is optional so one setting can change without touching the other.
// null = follow the default (connection lines show when the table has any; members up to the maximum).
const displaySchema = z.strictObject({
  connections: z.boolean().nullable().optional(),
  maxMembers: z.number().int().min(1).max(MAX_TABLE_MEMBER_SEATS).nullable().optional(),
}).refine((input) => input.connections !== undefined || input.maxMembers !== undefined, { message: 'Choose a display setting to change.' });

function creatorRole(state: DomainState): ActorContext['role'] {
  return state.kind === 'teaching' ? 'teacher' : state.kind === 'encounter' ? 'dm' : 'owner';
}

function setField<K extends keyof DisplaySettings>(display: DisplaySettings, key: K, value: DisplaySettings[K] | null): void {
  if (value === null || value === undefined) delete display[key];
  else display[key] = value;
}

export function handleDisplayCommand(state: DomainState, type: string, payload: unknown, ctx: ActorContext): { state: DomainState; label: string } | null {
  if (type !== 'display.set') return null;
  const input = parsePayload(displaySchema, payload);
  // Display settings sit with the table's name and other table settings.
  if (input.connections !== undefined) requirePermission(ctx, 'table.rename', [creatorRole(state)]);
  // The member limit decides who may join, so it follows the invite permission.
  if (input.maxMembers !== undefined) {
    assert(state.kind === 'table', 'INVALID_COMMAND', 'Only a table has a member limit.');
    requirePermission(ctx, 'members.invite', [creatorRole(state)]);
  }
  const next = structuredClone(state);
  const display: DisplaySettings = { ...(next.display ?? {}) };
  if (input.connections !== undefined) setField(display, 'connections', input.connections);
  if (input.maxMembers !== undefined) setField(display, 'maxMembers', input.maxMembers);
  if (Object.keys(display).length > 0) next.display = display;
  else delete next.display;
  const labels: string[] = [];
  if (input.connections !== undefined) {
    labels.push(input.connections === null ? 'Connection lines follow the default.' : `Connection lines ${input.connections ? 'shown' : 'hidden'} for this table.`);
  }
  if (input.maxMembers !== undefined) {
    labels.push(input.maxMembers === null
      ? 'Member limit follows the maximum.'
      : `Member limit set to ${input.maxMembers} ${input.maxMembers === 1 ? 'member' : 'members'} besides the owner.`);
  }
  return { state: next, label: labels.join(' ') };
}
