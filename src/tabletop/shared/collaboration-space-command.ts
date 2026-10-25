import { z } from 'zod';
import { SPACE_LIMITS, SPACE_ROLES } from './collaboration-space';

/**
 * F080: the wire shape of a collaboration-space command.
 *
 * Parsed once, at the boundary, so the domain handler and the route cannot disagree about what a
 * command means. These are the only space commands a client may send: creating a space, adding or
 * removing a member, changing a role, transferring management, linking or unlinking a source.
 */

const actorSchema = z.string().min(1).max(160);
const idSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{2,39}$/u);

export const SPACE_COMMANDS = [
  'space.create',
  'space.rename',
  'space.addMember',
  'space.removeMember',
  'space.setRole',
  'space.transferManager',
  'space.addSource',
  'space.leaveSource',
] as const;
export type SpaceCommandType = typeof SPACE_COMMANDS[number];

export function isSpaceCommand(type: string): type is SpaceCommandType {
  return (SPACE_COMMANDS as readonly string[]).includes(type);
}

const createSchema = z.strictObject({
  spaceId: idSchema,
  title: z.string().min(1).max(SPACE_LIMITS.maxTitleChars),
  sharedToolWorkspaceId: z.string().uuid(),
});

const renameSchema = z.strictObject({ title: z.string().min(1).max(SPACE_LIMITS.maxTitleChars) });

const addMemberSchema = z.strictObject({
  member: z.strictObject({
    actorId: actorSchema,
    name: z.string().min(1).max(SPACE_LIMITS.maxMemberNameChars),
    role: z.enum(SPACE_ROLES),
    joinedAt: z.number().int().nonnegative(),
  }),
});

const removeMemberSchema = z.strictObject({ actorId: actorSchema });
const setRoleSchema = z.strictObject({ actorId: actorSchema, role: z.enum(SPACE_ROLES) });
const transferManagerSchema = z.strictObject({ actorId: actorSchema });

const addSourceSchema = z.strictObject({
  source: z.strictObject({
    workspaceId: z.string().uuid(),
    epoch: z.number().int().nonnegative(),
    addedBy: actorSchema,
    addedAt: z.number().int().nonnegative(),
    status: z.literal('linked'),
  }),
});

const leaveSourceSchema = z.strictObject({ workspaceId: z.string().uuid() });

export type ParsedSpaceCommand =
  | { ok: true; type: 'space.create'; spaceId: string; title: string; sharedToolWorkspaceId: string }
  | { ok: true; type: 'space.rename'; title: string }
  | { ok: true; type: 'space.addMember'; member: { actorId: string; name: string; role: (typeof SPACE_ROLES)[number]; joinedAt: number } }
  | { ok: true; type: 'space.removeMember'; actorId: string }
  | { ok: true; type: 'space.setRole'; actorId: string; role: (typeof SPACE_ROLES)[number] }
  | { ok: true; type: 'space.transferManager'; actorId: string }
  | { ok: true; type: 'space.addSource'; source: { workspaceId: string; epoch: number; addedBy: string; addedAt: number; status: 'linked' } }
  | { ok: true; type: 'space.leaveSource'; workspaceId: string }
  | { ok: false; code: 'SPACE_PAYLOAD'; message: string };

function failure(error: z.ZodError): ParsedSpaceCommand {
  const issue = error.issues[0];
  return {
    ok: false,
    code: 'SPACE_PAYLOAD',
    message: issue ? `${issue.path.join('.') || 'payload'}: ${issue.message}` : 'Invalid space command payload.',
  };
}

export function parseSpaceCommand(type: string, payload: unknown): ParsedSpaceCommand {
  const pick = (schema: z.ZodType) => {
    const parsed = schema.safeParse(payload);
    return parsed.success ? parsed.data : undefined;
  };
  switch (type) {
    case 'space.create': {
      const parsed = createSchema.safeParse(payload);
      return parsed.success
        ? { ok: true, type: 'space.create', spaceId: parsed.data.spaceId, title: parsed.data.title, sharedToolWorkspaceId: parsed.data.sharedToolWorkspaceId }
        : failure(parsed.error);
    }
    case 'space.rename': {
      const parsed = renameSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.rename', title: parsed.data.title } : failure(parsed.error);
    }
    case 'space.addMember': {
      const parsed = addMemberSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.addMember', member: parsed.data.member } : failure(parsed.error);
    }
    case 'space.removeMember': {
      const parsed = removeMemberSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.removeMember', actorId: parsed.data.actorId } : failure(parsed.error);
    }
    case 'space.setRole': {
      const parsed = setRoleSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.setRole', actorId: parsed.data.actorId, role: parsed.data.role } : failure(parsed.error);
    }
    case 'space.transferManager': {
      const parsed = transferManagerSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.transferManager', actorId: parsed.data.actorId } : failure(parsed.error);
    }
    case 'space.addSource': {
      const parsed = addSourceSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.addSource', source: parsed.data.source } : failure(parsed.error);
    }
    case 'space.leaveSource': {
      const parsed = leaveSourceSchema.safeParse(payload);
      return parsed.success ? { ok: true, type: 'space.leaveSource', workspaceId: parsed.data.workspaceId } : failure(parsed.error);
    }
    default: {
      // `pick` keeps the "unused" import honest for schemas that only exist for future commands.
      void pick;
      return { ok: false, code: 'SPACE_PAYLOAD', message: `Unknown space command "${type}".` };
    }
  }
}
