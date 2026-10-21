/**
 * Who sees what inside a table (F015).
 * - 'open': every member sees the whole table state and every member's AI chat. Current product rule (2026-10-21).
 * - 'private': role projections (owner-only drafts, DM/teacher notes, hidden rolls, own answers) and
 *   actor-private AI chats. Kept intact so the rule can be switched back or extended later.
 * Membership is required under both policies.
 */
export type VisibilityPolicy = 'open' | 'private';

export const VISIBILITY_POLICY: VisibilityPolicy = 'open';

/**
 * Who may manage a shared data table (F015).
 * - 'equal': every member may do what the owner does (draft/approve/activate rules, invite, remove other
 *   members, remove files, rename), except resetting the table and removing the owner. Current rule (2026-10-22).
 * - 'roles': the previous owner-only management, kept for later use.
 * Only `table` workspaces have owner/participant roles; teaching, encounter and invoice keep their roles.
 */
export type PermissionPolicy = 'equal' | 'roles';

export const PERMISSION_POLICY: PermissionPolicy = 'equal';

/** Roles that may manage a `table` workspace under the current permission policy. */
export function tableManagerRoles(policy: PermissionPolicy = PERMISSION_POLICY): Array<'owner' | 'participant'> {
  return policy === 'equal' ? ['owner', 'participant'] : ['owner'];
}

/** True when this viewer may manage a `table` workspace (owner, or any member under 'equal'). */
export function managesTable(view: { kind: string; actor: { role: string } }, policy: PermissionPolicy = PERMISSION_POLICY): boolean {
  return view.kind === 'table' && (tableManagerRoles(policy) as string[]).includes(view.actor.role);
}
