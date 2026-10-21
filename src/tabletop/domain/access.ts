import { z } from 'zod';
import type { ActorContext, DomainState } from '../shared/contracts';
import {
  CUSTOM_ROLE_PREFIX, MAX_CUSTOM_ROLES, MAX_ROLE_NAME_CHARS, availableRoles, isPermission, permissionsFor,
  type AccessConfig, type AccessRole, type Permission,
} from '../shared/permissions';
import { assert, parsePayload, requirePermission } from './helpers';

/** Commands that edit who may do what at this table (F035). The authority checks targets are members, not the owner. */
export const ACCESS_COMMANDS = ['access.saveRole', 'access.deleteRole', 'access.assign'] as const;

const roleIdSchema = z.string().min(1).max(64).regex(/^[a-z0-9-]+$/u);
const saveRoleSchema = z.strictObject({
  id: roleIdSchema.optional(),
  name: z.string().trim().min(1).max(MAX_ROLE_NAME_CHARS),
  permissions: z.array(z.string().min(1).max(64)).max(64),
});
const deleteRoleSchema = z.strictObject({ id: roleIdSchema });
const assignSchema = z.strictObject({ actorId: z.string().min(1).max(200), roleId: roleIdSchema });

function creatorRole(state: DomainState): ActorContext['role'] {
  return state.kind === 'teaching' ? 'teacher' : state.kind === 'encounter' ? 'dm' : 'owner';
}

function currentAccess(state: DomainState): AccessConfig {
  return { roles: [...(state.access?.roles ?? [])], assignments: { ...(state.access?.assignments ?? {}) } };
}

/** Nobody can hand out a permission they do not hold themselves. */
function assertWithinOwn(ctx: ActorContext, permissions: readonly Permission[]): void {
  if (!ctx.permissions) return;
  const missing = permissions.filter((permission) => !ctx.permissions?.has(permission));
  assert(missing.length === 0, 'FORBIDDEN', 'You cannot grant permissions you do not have.');
}

function withAccess(state: DomainState, access: AccessConfig): DomainState {
  const next = structuredClone(state);
  next.access = access;
  next.dataRevision += 1;
  return next;
}

export function handleAccessCommand(state: DomainState, type: string, payload: unknown, ctx: ActorContext): { state: DomainState; label: string } | null {
  if (!(ACCESS_COMMANDS as readonly string[]).includes(type)) return null;
  requirePermission(ctx, 'roles.manage', [creatorRole(state)]);
  const access = currentAccess(state);

  if (type === 'access.saveRole') {
    const input = parsePayload(saveRoleSchema, payload);
    const permissions = [...new Set(input.permissions)];
    assert(permissions.every((permission) => isPermission(state.kind, permission)), 'INVALID_PAYLOAD', 'A permission does not apply to this table.');
    const granted = permissions as Permission[];
    assertWithinOwn(ctx, granted);
    const ordered = permissionsFor(state.kind).filter((permission) => granted.includes(permission));
    if (input.id) {
      const index = access.roles.findIndex((role) => role.id === input.id);
      assert(index >= 0, 'ROLE_NOT_FOUND', 'Only roles created at this table can be edited.');
      access.roles[index] = { id: input.id, name: input.name, permissions: ordered };
      return { state: withAccess(state, access), label: `Role ${input.name} updated.` };
    }
    assert(access.roles.length < MAX_CUSTOM_ROLES, 'ROLE_LIMIT', `A table can have at most ${MAX_CUSTOM_ROLES} custom roles.`);
    const id = `${CUSTOM_ROLE_PREFIX}${ctx.hash({ name: input.name, at: ctx.now, by: ctx.actorId }).slice(0, 12)}`;
    const role: AccessRole = { id, name: input.name, permissions: ordered };
    access.roles.push(role);
    return { state: withAccess(state, access), label: `Role ${input.name} created.` };
  }

  if (type === 'access.deleteRole') {
    const input = parsePayload(deleteRoleSchema, payload);
    const role = access.roles.find((item) => item.id === input.id);
    assert(role, 'ROLE_NOT_FOUND', 'Only roles created at this table can be deleted.');
    assert(!Object.values(access.assignments).includes(input.id), 'ROLE_IN_USE', 'Move everyone off this role before deleting it.');
    access.roles = access.roles.filter((item) => item.id !== input.id);
    return { state: withAccess(state, access), label: `Role ${role.name} deleted.` };
  }

  const input = parsePayload(assignSchema, payload);
  const role = availableRoles(state.kind, access).find((item) => item.id === input.roleId);
  assert(role, 'ROLE_NOT_FOUND', 'That role does not exist at this table.');
  assertWithinOwn(ctx, role.permissions);
  if (role.id === 'default') delete access.assignments[input.actorId];
  else access.assignments[input.actorId] = role.id;
  return { state: withAccess(state, access), label: `Role set to ${role.name}.` };
}
