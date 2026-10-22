import type { CaseKind } from './contracts';

/**
 * Role permissions per table (F035). Management rights come from a role chosen per member: a case preset
 * or a custom role. Members without an assignment get every permission of the case. The owner always has
 * every permission, and only the owner may reset (delete) the table, which is not a grantable permission.
 * Seat-bound game moves (a learner's answer, a player's shield) stay with their seat and are not listed here.
 */
export const COMMON_PERMISSIONS = [
  'table.rename', 'members.invite', 'members.remove', 'roles.manage', 'rules.draft', 'rules.approve',
] as const;

export const KIND_PERMISSIONS = {
  table: ['files.add', 'files.remove', 'data.import', 'data.columns', 'table.act', 'ai.ask'],
  teaching: ['lesson.parameters', 'lesson.representation', 'lesson.note'],
  encounter: ['game.direct', 'game.note'],
  invoice: ['invoice.review'],
} as const satisfies Record<CaseKind, readonly string[]>;

export type Permission = typeof COMMON_PERMISSIONS[number] | typeof KIND_PERMISSIONS[CaseKind][number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  'table.rename': 'Rename the table',
  'members.invite': 'Invite people',
  'members.remove': 'Remove members',
  'roles.manage': 'Manage roles',
  'rules.draft': 'Draft rules (incl. AI drafts)',
  'rules.approve': 'Check, approve and activate rules',
  'files.add': 'Add files',
  'files.remove': 'Remove files',
  'data.import': 'Import rows',
  'data.columns': 'Set computed columns',
  'table.act': 'Use table actions',
  'ai.ask': 'Ask the AI',
  'lesson.parameters': 'Change lesson settings',
  'lesson.representation': 'Set learner views',
  'lesson.note': 'Write teacher notes',
  'game.direct': 'Run the encounter (hits, turns, pause)',
  'game.note': 'Write DM notes',
  'invoice.review': 'Review invoice evidence and runs',
};

export function permissionsFor(kind: CaseKind): Permission[] {
  return [...COMMON_PERMISSIONS, ...KIND_PERMISSIONS[kind]];
}

export interface AccessRole {
  id: string;
  name: string;
  permissions: Permission[];
}

/** Stored on the table state. Presets are code constants and are never stored. */
export interface AccessConfig {
  roles: AccessRole[];
  /** actorId → role id (preset or custom). Missing = the default role. */
  assignments: Record<string, string>;
}

export const DEFAULT_ROLE_ID = 'default';
export const MAX_CUSTOM_ROLES = 12;
export const MAX_ROLE_NAME_CHARS = 40;
export const CUSTOM_ROLE_PREFIX = 'custom-';

const all = (kind: CaseKind) => permissionsFor(kind);

/** Case presets (F035). Ids are stable; names are shown in the UI. */
export const PRESET_ROLES: Record<CaseKind, AccessRole[]> = {
  table: [
    { id: 'manager', name: 'Manager', permissions: all('table') },
    { id: 'editor', name: 'Editor', permissions: ['table.rename', 'rules.draft', 'rules.approve', 'files.add', 'files.remove', 'data.import', 'data.columns', 'table.act', 'ai.ask'] },
    { id: 'contributor', name: 'Contributor', permissions: ['rules.draft', 'files.add', 'table.act', 'ai.ask'] },
    { id: 'viewer', name: 'Viewer', permissions: [] },
  ],
  teaching: [
    { id: 'co-teacher', name: 'Co-teacher', permissions: all('teaching') },
    { id: 'learner', name: 'Learner', permissions: [] },
  ],
  encounter: [
    { id: 'co-dm', name: 'Co-DM', permissions: all('encounter') },
    { id: 'player', name: 'Player', permissions: [] },
  ],
  invoice: [
    { id: 'reviewer', name: 'Reviewer', permissions: all('invoice') },
  ],
};

export function defaultRole(kind: CaseKind): AccessRole {
  return { id: DEFAULT_ROLE_ID, name: 'Default (all except delete table)', permissions: all(kind) };
}

/** Every role a member can be given on this table: default, presets, then custom roles. */
export function availableRoles(kind: CaseKind, access: AccessConfig | undefined): AccessRole[] {
  return [defaultRole(kind), ...PRESET_ROLES[kind], ...(access?.roles ?? [])];
}

export function roleById(kind: CaseKind, access: AccessConfig | undefined, roleId: string | undefined): AccessRole {
  if (!roleId) return defaultRole(kind);
  return availableRoles(kind, access).find((role) => role.id === roleId) ?? defaultRole(kind);
}

/** The role in effect for a member. The owner is reported as the default role but always holds everything. */
export function assignedRole(kind: CaseKind, access: AccessConfig | undefined, actorId: string): AccessRole {
  return roleById(kind, access, access?.assignments[actorId]);
}

export function memberPermissions(kind: CaseKind, access: AccessConfig | undefined, actorId: string, isOwner: boolean): Set<Permission> {
  const allowed = new Set(permissionsFor(kind));
  if (isOwner) return allowed;
  return new Set(assignedRole(kind, access, actorId).permissions.filter((permission) => allowed.has(permission)));
}

export function isPermission(kind: CaseKind, value: unknown): value is Permission {
  return typeof value === 'string' && (permissionsFor(kind) as string[]).includes(value);
}

/** The kind's primary role is the table's creator (owner/teacher/DM), who always holds every permission. */
function isCreatorRole(kind: CaseKind, role: string): boolean {
  return role === (kind === 'teaching' ? 'teacher' : kind === 'encounter' ? 'dm' : 'owner');
}

/** Client-side mirror of the server rule, for showing or hiding controls. The server always decides. */
export function viewerCan(
  view: { kind: CaseKind; actor: { actorId: string; role: string }; domain: { access?: AccessConfig } },
  permission: Permission,
): boolean {
  return memberPermissions(view.kind, view.domain.access, view.actor.actorId, isCreatorRole(view.kind, view.actor.role)).has(permission);
}
