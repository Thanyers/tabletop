import { describe, expect, it } from 'vitest';
import type { CaseKind } from './contracts';
import {
  COMMON_PERMISSIONS, DEFAULT_ROLE_ID, KIND_PERMISSIONS, PERMISSION_LABELS, PRESET_ROLES,
  assignedRole, availableRoles, defaultRole, isPermission, memberPermissions, permissionsFor, roleById, viewerCan,
  type AccessConfig, type Permission,
} from './permissions';

const kinds: CaseKind[] = ['table', 'teaching', 'encounter', 'invoice'];
const sorted = (values: Iterable<string>) => [...values].sort();

describe('F035 permission model', () => {
  it('lists the common permissions plus the kind permissions, with a label for each and no reset permission', () => {
    expect(permissionsFor('table')).toEqual([...COMMON_PERMISSIONS, 'files.add', 'files.remove', 'data.import', 'data.columns', 'table.act', 'ai.ask']);
    expect(permissionsFor('teaching')).toEqual([...COMMON_PERMISSIONS, 'lesson.parameters', 'lesson.representation', 'lesson.note']);
    expect(permissionsFor('encounter')).toEqual([...COMMON_PERMISSIONS, 'game.direct', 'game.note']);
    expect(permissionsFor('invoice')).toEqual([...COMMON_PERMISSIONS, 'invoice.review']);
    for (const kind of kinds) {
      for (const permission of permissionsFor(kind)) expect(PERMISSION_LABELS[permission]).toBeTruthy();
      expect(permissionsFor(kind)).not.toContain('workspace.reset');
    }
    expect(isPermission('table', 'files.remove')).toBe(true);
    expect(isPermission('teaching', 'files.remove')).toBe(false);
    expect(isPermission('table', 'workspace.reset')).toBe(false);
    expect(isPermission('table', 42)).toBe(false);
  });

  it('gives unassigned members every permission of the kind and the owner everything regardless of assignment', () => {
    for (const kind of kinds) {
      expect(sorted(memberPermissions(kind, undefined, 'member', false))).toEqual(sorted(permissionsFor(kind)));
      expect(sorted(memberPermissions(kind, { roles: [], assignments: {} }, 'member', false))).toEqual(sorted(permissionsFor(kind)));
      expect(defaultRole(kind)).toMatchObject({ id: DEFAULT_ROLE_ID, name: 'Default (all except delete table)' });
    }
    const access: AccessConfig = { roles: [], assignments: { owner: 'viewer' } };
    expect(sorted(memberPermissions('table', access, 'owner', true))).toEqual(sorted(permissionsFor('table')));
    expect(memberPermissions('table', access, 'owner', false).size).toBe(0);
  });

  it('resolves case presets, custom roles and unknown role ids', () => {
    expect(PRESET_ROLES.table.map((role) => role.id)).toEqual(['manager', 'editor', 'contributor', 'viewer']);
    expect(PRESET_ROLES.teaching.map((role) => role.id)).toEqual(['co-teacher', 'learner']);
    expect(PRESET_ROLES.encounter.map((role) => role.id)).toEqual(['co-dm', 'player']);
    expect(PRESET_ROLES.invoice.map((role) => role.id)).toEqual(['reviewer']);
    for (const kind of kinds) {
      for (const role of PRESET_ROLES[kind]) for (const permission of role.permissions) expect(isPermission(kind, permission)).toBe(true);
    }
    const access: AccessConfig = {
      roles: [{ id: 'custom-a', name: 'Files only', permissions: ['files.add', 'files.remove'] }],
      assignments: { editor: 'editor', contributor: 'contributor', viewer: 'viewer', custom: 'custom-a', ghost: 'custom-missing' },
    };
    expect(sorted(memberPermissions('table', access, 'contributor', false))).toEqual(sorted(['rules.draft', 'files.add', 'table.act', 'ai.ask']));
    expect(memberPermissions('table', access, 'editor', false).has('roles.manage')).toBe(false);
    expect(memberPermissions('table', access, 'editor', false).has('rules.approve')).toBe(true);
    expect(memberPermissions('table', access, 'viewer', false).size).toBe(0);
    expect(sorted(memberPermissions('table', access, 'custom', false))).toEqual(['files.add', 'files.remove']);
    // A role id that no longer exists falls back to the default role.
    expect(assignedRole('table', access, 'ghost').id).toBe(DEFAULT_ROLE_ID);
    expect(roleById('table', access, undefined).id).toBe(DEFAULT_ROLE_ID);
    expect(roleById('teaching', access, 'viewer').id).toBe(DEFAULT_ROLE_ID);
    expect(availableRoles('table', access).map((role) => role.id)).toEqual([DEFAULT_ROLE_ID, 'manager', 'editor', 'contributor', 'viewer', 'custom-a']);
  });

  it('drops stored permissions that do not belong to the kind', () => {
    const access: AccessConfig = { roles: [{ id: 'custom-x', name: 'Mixed', permissions: ['files.add', 'lesson.note'] as Permission[] }], assignments: { member: 'custom-x' } };
    expect(sorted(memberPermissions('teaching', access, 'member', false))).toEqual(['lesson.note']);
  });

  it('lets viewerCan treat the creator role of each kind as holding every permission', () => {
    const viewer = { roles: [], assignments: { creator: 'viewer', member: 'viewer' } } satisfies AccessConfig;
    const learner = { roles: [], assignments: { creator: 'learner', member: 'learner' } } satisfies AccessConfig;
    const player = { roles: [], assignments: { creator: 'player', member: 'player' } } satisfies AccessConfig;
    const view = (kind: CaseKind, actorId: string, role: string, access: AccessConfig) => ({ kind, actor: { actorId, role }, domain: { access } });
    expect(viewerCan(view('table', 'creator', 'owner', viewer), 'roles.manage')).toBe(true);
    expect(viewerCan(view('teaching', 'creator', 'teacher', learner), 'lesson.parameters')).toBe(true);
    expect(viewerCan(view('encounter', 'creator', 'dm', player), 'game.direct')).toBe(true);
    expect(viewerCan(view('table', 'member', 'participant', viewer), 'rules.approve')).toBe(false);
    expect(viewerCan(view('teaching', 'member', 'learner', learner), 'lesson.parameters')).toBe(false);
    expect(viewerCan(view('encounter', 'member', 'player', player), 'game.direct')).toBe(false);
    expect(viewerCan({ kind: 'table', actor: { actorId: 'member', role: 'participant' }, domain: {} }, 'members.remove')).toBe(true);
    // A permission from another kind is never granted, not even to the creator.
    expect(viewerCan(view('teaching', 'creator', 'teacher', learner), 'files.add' as Permission)).toBe(false);
    expect(KIND_PERMISSIONS.table).not.toContain('lesson.note');
  });
});
