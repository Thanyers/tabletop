import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { WorkspaceView } from '../shared/contracts';
import {
  MAX_CUSTOM_ROLES, MAX_ROLE_NAME_CHARS, PERMISSION_LABELS, PRESET_ROLES, assignedRole, availableRoles, permissionsFor, viewerCan,
  type AccessRole, type Permission,
} from '../shared/permissions';
import './role-settings.css';

type AccessCommand = 'access.saveRole' | 'access.deleteRole' | 'access.assign';

/** People-dialog section for roles and permissions (F035). The server re-checks every change. */
export function RoleSettings({ view, busy, onCommand }: {
  view: WorkspaceView;
  busy: boolean;
  onCommand: (type: AccessCommand, payload: unknown) => Promise<unknown>;
}) {
  const access = view.domain.access;
  const canManage = viewerCan(view, 'roles.manage');
  const roles = availableRoles(view.kind, access);
  const creatorRole = view.kind === 'teaching' ? 'teacher' : view.kind === 'encounter' ? 'dm' : 'owner';
  const members = view.members.filter((member) => member.role !== creatorRole);
  // A role is offered only if it grants nothing the viewer lacks; the server enforces the same rule.
  const grantable = (role: AccessRole) => role.permissions.every((permission) => viewerCan(view, permission));

  return <section className="tt-role-settings" aria-label="Roles and permissions">
    <span className="tt-kicker">ROLES</span>
    {members.length === 0 ? <p className="tt-role-settings__empty">Invite someone to give them a role.</p>
      : <ul className="tt-role-settings__members">
        {members.map((member) => {
          const current = assignedRole(view.kind, access, member.actorId);
          // The server refuses changing the role of someone who holds a permission the viewer lacks.
          const stronger = !grantable(current);
          return <li key={member.actorId}>
            <span className="tt-role-settings__name">{member.name}</span>
            {canManage
              ? <select aria-label={`Role for ${member.name}`} value={current.id} disabled={busy || stronger}
                title={stronger ? 'This person has permissions you do not have' : undefined}
                onChange={(event) => void onCommand('access.assign', { actorId: member.actorId, roleId: event.target.value })}>
                {roles.map((role) => <option key={role.id} value={role.id} disabled={!grantable(role) && role.id !== current.id}>{role.name}</option>)}
              </select>
              : <span className="tt-role-settings__role">{current.name}</span>}
          </li>;
        })}
      </ul>}
    <p className="tt-role-settings__note">Only the owner can delete or reset this table. Members without a role can do everything else.</p>
    {canManage && <RoleManager view={view} busy={busy} onCommand={onCommand} />}
  </section>;
}

function RoleManager({ view, busy, onCommand }: {
  view: WorkspaceView;
  busy: boolean;
  onCommand: (type: AccessCommand, payload: unknown) => Promise<unknown>;
}) {
  const custom = view.domain.access?.roles ?? [];
  const assigned = new Set(Object.values(view.domain.access?.assignments ?? {}));
  const [editing, setEditing] = useState<AccessRole | null>(null);
  const [draftName, setDraftName] = useState('');
  const [draftPermissions, setDraftPermissions] = useState<Permission[]>([]);
  const [open, setOpen] = useState(false);
  const catalog = permissionsFor(view.kind);

  const startNew = () => { setEditing(null); setDraftName(''); setDraftPermissions([]); setOpen(true); };
  const startEdit = (role: AccessRole) => { setEditing(role); setDraftName(role.name); setDraftPermissions(role.permissions); setOpen(true); };
  const toggle = (permission: Permission) => setDraftPermissions((current) =>
    current.includes(permission) ? current.filter((item) => item !== permission) : [...current, permission]);
  const save = async () => {
    const name = draftName.trim();
    if (!name) return;
    await onCommand('access.saveRole', { ...(editing ? { id: editing.id } : {}), name, permissions: draftPermissions });
    setOpen(false);
  };

  return <details className="tt-role-manager">
    <summary>Manage roles</summary>
    <p className="tt-role-manager__presets">Ready-made: {PRESET_ROLES[view.kind].map((role) => role.name).join(' · ')}</p>
    {custom.length > 0 && <ul className="tt-role-manager__list" aria-label="Roles created at this table">
      {custom.map((role) => <li key={role.id}>
        <span><strong>{role.name}</strong><small>{role.permissions.length === 0 ? 'No management rights' : role.permissions.map((permission) => PERMISSION_LABELS[permission]).join(', ')}</small></span>
        <button type="button" className="tt-button tt-button--quiet" disabled={busy} aria-label={`Edit ${role.name}`} onClick={() => startEdit(role)}><Pencil size={13} /></button>
        <button type="button" className="tt-button tt-button--quiet" disabled={busy || assigned.has(role.id)}
          title={assigned.has(role.id) ? 'Move everyone off this role first' : undefined}
          aria-label={`Delete ${role.name}`} onClick={() => void onCommand('access.deleteRole', { id: role.id })}><Trash2 size={13} /></button>
      </li>)}
    </ul>}
    {!open && custom.length < MAX_CUSTOM_ROLES && <button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={startNew}><Plus size={13} />New role</button>}
    {open && <form className="tt-role-manager__form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Role name<input value={draftName} maxLength={MAX_ROLE_NAME_CHARS} onChange={(event) => setDraftName(event.target.value)} /></label>
      <fieldset><legend>Can</legend>
        {catalog.map((permission) => {
          const allowed = viewerCan(view, permission);
          return <label key={permission} className={allowed ? undefined : 'is-unavailable'} title={allowed ? undefined : 'You do not have this permission'}>
            <input type="checkbox" checked={draftPermissions.includes(permission)} disabled={busy || !allowed} onChange={() => toggle(permission)} />
            {PERMISSION_LABELS[permission]}
          </label>;
        })}
      </fieldset>
      <div className="tt-role-manager__actions">
        <button type="button" className="tt-button tt-button--quiet" disabled={busy} onClick={() => setOpen(false)}>Cancel</button>
        <button type="submit" className="tt-button tt-button--primary" disabled={busy || draftName.trim().length === 0}>{editing ? 'Save role' : 'Create role'}</button>
      </div>
    </form>}
  </details>;
}
