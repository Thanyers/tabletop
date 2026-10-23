import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain } from './index';
import { handleTableCommand } from './table';
import type { ActorContext, DomainState } from '../shared/contracts';
import { MAX_CUSTOM_ROLES, PRESET_ROLES, memberPermissions, permissionsFor, type Permission } from '../shared/permissions';
import { tableScenarioSources } from '../testing/table-scenarios';

const base: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const owner: ActorContext = { ...base, permissions: memberPermissions('table', undefined, base.actorId, true) };
const withPermissions = (permissions: Permission[], extra: Partial<ActorContext> = {}): ActorContext => ({
  ...base, actorId: 'account-b', name: 'Member', role: 'participant', seat: 'member-1', permissions: new Set(permissions), ...extra,
});
const run = (state: DomainState, type: string, payload: unknown, ctx: ActorContext) => decideDomain(state, { type, payload }, ctx).state;
const roles = (state: DomainState) => state.access?.roles ?? [];

describe('F035 access commands', () => {
  it('creates and edits a custom role, keeping permissions in catalog order without duplicates', () => {
    const empty = createDomain('table', owner);
    const created = run(empty, 'access.saveRole', { name: '  Helpers  ', permissions: ['ai.ask', 'files.add', 'ai.ask'] }, owner);
    expect(roles(created)).toHaveLength(1);
    const [role] = roles(created);
    expect(role).toMatchObject({ name: 'Helpers', permissions: ['files.add', 'ai.ask'] });
    expect(role.id).toMatch(/^custom-[a-f0-9]{12}$/u);
    expect(created.dataRevision).toBe(empty.dataRevision + 1);

    const edited = run(created, 'access.saveRole', { id: role.id, name: 'Helpers+', permissions: ['rules.draft'] }, owner);
    expect(roles(edited)).toEqual([{ id: role.id, name: 'Helpers+', permissions: ['rules.draft'] }]);
    expect(() => run(created, 'access.saveRole', { id: 'viewer', name: 'Edited preset', permissions: [] }, owner)).toThrow(expect.objectContaining({ code: 'ROLE_NOT_FOUND' }));
  });

  it('validates names, the custom role limit and permissions of the kind', () => {
    const empty = createDomain('table', owner);
    for (const name of ['', '   ', 'x'.repeat(41)]) {
      expect(() => run(empty, 'access.saveRole', { name, permissions: [] }, owner)).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));
    }
    expect(run(empty, 'access.saveRole', { name: 'x'.repeat(40), permissions: [] }, owner).access?.roles).toHaveLength(1);
    expect(() => run(empty, 'access.saveRole', { name: 'Bad', permissions: ['lesson.note'] }, owner)).toThrow(expect.objectContaining({ code: 'INVALID_PAYLOAD' }));
    expect(() => run(empty, 'access.saveRole', { name: 'Bad', permissions: ['workspace.reset'] }, owner)).toThrow(expect.objectContaining({ code: 'INVALID_PAYLOAD' }));
    expect(() => run(empty, 'access.saveRole', { name: 'Bad', permissions: [], extra: true }, owner)).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));

    let state = empty;
    for (let index = 0; index < MAX_CUSTOM_ROLES; index += 1) {
      state = run(state, 'access.saveRole', { name: `Role ${index}` , permissions: [] }, { ...owner, now: 2000 + index });
    }
    expect(roles(state)).toHaveLength(MAX_CUSTOM_ROLES);
    expect(() => run(state, 'access.saveRole', { name: 'One too many', permissions: [] }, { ...owner, now: 9000 })).toThrow(expect.objectContaining({ code: 'ROLE_LIMIT' }));
  });

  it('requires roles.manage and never lets anyone grant permissions they lack', () => {
    const empty = createDomain('table', owner);
    const noManage = withPermissions(permissionsFor('table').filter((permission) => permission !== 'roles.manage'));
    for (const [type, payload] of [
      ['access.saveRole', { name: 'Mine', permissions: [] }],
      ['access.deleteRole', { id: 'custom-a' }],
      ['access.assign', { actorId: 'account-c', roleId: 'viewer' }],
    ] as const) {
      expect(() => run(empty, type, payload, noManage)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    }

    const limitedManager = withPermissions(['roles.manage', 'files.add', 'rules.draft', 'data.compute', 'table.act', 'ai.ask']);
    expect(() => run(empty, 'access.saveRole', { name: 'Bigger', permissions: ['members.remove'] }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => run(empty, 'access.assign', { actorId: 'account-c', roleId: 'manager' }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => run(empty, 'access.assign', { actorId: 'account-c', roleId: 'default' }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    // Within their own permissions they may assign someone who holds no more than they do, and create roles.
    const withViewer = run(empty, 'access.assign', { actorId: 'account-c', roleId: 'viewer' }, owner);
    expect(() => run(withViewer, 'access.assign', { actorId: 'account-c', roleId: 'contributor' }, withPermissions(['roles.manage', 'files.add', 'rules.draft', 'table.act', 'ai.ask'])))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(run(withViewer, 'access.assign', { actorId: 'account-c', roleId: 'contributor' }, limitedManager).access?.assignments).toEqual({ 'account-c': 'contributor' });
    expect(roles(run(empty, 'access.saveRole', { name: 'Smaller', permissions: ['files.add'] }, limitedManager))).toHaveLength(1);
  });

  it('refuses changing the role of someone who holds a permission the caller lacks (no demoting a stronger manager)', () => {
    const limitedManager = withPermissions(['roles.manage', 'files.add', 'rules.draft', 'data.compute', 'table.act', 'ai.ask']);
    const empty = createDomain('table', owner);
    // Unassigned (default) and Manager both hold members.remove, which the caller lacks.
    expect(() => run(empty, 'access.assign', { actorId: 'account-c', roleId: 'viewer' }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    const manager = run(empty, 'access.assign', { actorId: 'account-c', roleId: 'manager' }, owner);
    expect(() => run(manager, 'access.assign', { actorId: 'account-c', roleId: 'viewer' }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    const editor = run(empty, 'access.assign', { actorId: 'account-c', roleId: 'editor' }, owner);
    expect(() => run(editor, 'access.assign', { actorId: 'account-c', roleId: 'contributor' }, limitedManager)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    // A Contributor holds nothing beyond the caller, so they can be moved.
    const contributor = run(empty, 'access.assign', { actorId: 'account-c', roleId: 'contributor' }, owner);
    expect(run(contributor, 'access.assign', { actorId: 'account-c', roleId: 'viewer' }, limitedManager).access?.assignments).toEqual({ 'account-c': 'viewer' });
    // The owner (all permissions) can always demote.
    expect(run(manager, 'access.assign', { actorId: 'account-c', roleId: 'viewer' }, owner).access?.assignments).toEqual({ 'account-c': 'viewer' });
  });

  it('assigns presets, custom roles and the default role, and blocks deleting a role in use', () => {
    let state = run(createDomain('table', owner), 'access.saveRole', { name: 'Files', permissions: ['files.add'] }, owner);
    const customId = roles(state)[0].id;
    state = run(state, 'access.assign', { actorId: 'account-b', roleId: 'viewer' }, owner);
    state = run(state, 'access.assign', { actorId: 'account-c', roleId: customId }, owner);
    expect(state.access?.assignments).toEqual({ 'account-b': 'viewer', 'account-c': customId });
    expect(memberPermissions('table', state.access, 'account-c', false)).toEqual(new Set(['files.add']));
    expect(() => run(state, 'access.assign', { actorId: 'account-b', roleId: 'co-teacher' }, owner)).toThrow(expect.objectContaining({ code: 'ROLE_NOT_FOUND' }));
    expect(() => run(state, 'access.assign', { actorId: 'account-b', roleId: 'Not An Id' }, owner)).toThrow(expect.objectContaining({ code: 'INVALID_COMMAND' }));

    expect(() => run(state, 'access.deleteRole', { id: customId }, owner)).toThrow(expect.objectContaining({ code: 'ROLE_IN_USE' }));
    expect(() => run(state, 'access.deleteRole', { id: 'viewer' }, owner)).toThrow(expect.objectContaining({ code: 'ROLE_NOT_FOUND' }));
    state = run(state, 'access.assign', { actorId: 'account-c', roleId: 'default' }, owner);
    expect(state.access?.assignments).toEqual({ 'account-b': 'viewer' });
    state = run(state, 'access.deleteRole', { id: customId }, owner);
    expect(roles(state)).toEqual([]);
  });

  it('is accepted by every case kind with that kind\'s presets', () => {
    for (const kind of ['teaching', 'encounter', 'invoice'] as const) {
      const creator: ActorContext = { ...base, role: kind === 'teaching' ? 'teacher' : kind === 'encounter' ? 'dm' : 'owner', permissions: memberPermissions(kind, undefined, base.actorId, true) };
      const presetId = PRESET_ROLES[kind][0].id;
      const state = run(createDomain(kind, creator), 'access.assign', { actorId: 'account-b', roleId: presetId }, creator);
      expect(state.access?.assignments).toEqual({ 'account-b': presetId });
    }
  });
});

describe('F035 requirePermission in domain commands', () => {
  it('lets a learner holding lesson.parameters change the lesson, and refuses one without it', () => {
    const teacher: ActorContext = { ...base, role: 'teacher' };
    const lesson = createDomain('teaching', teacher);
    const learner = withPermissions(['lesson.parameters'], { role: 'learner', seat: 'learner-1' });
    const changed = run(lesson, 'teaching.setParameters', { force: 20, mass: 2, time: 2 }, learner);
    expect(changed.kind === 'teaching' && changed.parameters).toEqual({ force: 20, mass: 2, time: 2 });
    expect(() => run(lesson, 'teaching.setParameters', { force: 20, mass: 2, time: 2 }, withPermissions([], { role: 'learner', seat: 'learner-1' })))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    // Legacy rule without server permissions: only the teacher.
    expect(() => run(lesson, 'teaching.setParameters', { force: 20, mass: 2, time: 2 }, { ...base, actorId: 'account-b', role: 'learner', seat: 'learner-1' }))
      .toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(run(lesson, 'teaching.setParameters', { force: 20, mass: 2, time: 2 }, teacher).ruleRevision).toBe(lesson.ruleRevision + 1);
  });

  it('refuses removing a file without files.remove and allows it with the permission; legacy keeps removal with the owner', () => {
    const imported = handleTableCommand(createDomain('table', owner) as Extract<DomainState, { kind: 'table' }>, 'table.import', tableScenarioSources.equipment, owner)!.state;
    const sourceId = imported.sources[0].id;
    const adder = withPermissions(['files.add']);
    expect(() => run(imported, 'table.removeSource', { sourceId }, adder)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(run(imported, 'table.import', { filename: 'more.txt', text: 'more text' }, adder).kind).toBe('table');
    const remover = withPermissions(['files.remove']);
    const removed = run(imported, 'table.removeSource', { sourceId }, remover);
    expect(removed.kind === 'table' && removed.sources).toEqual([]);

    const legacyMember: ActorContext = { ...base, actorId: 'account-b', role: 'participant', seat: 'member-1' };
    expect(() => run(imported, 'table.removeSource', { sourceId }, legacyMember)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(run(imported, 'table.import', { filename: 'more.txt', text: 'more text' }, legacyMember).kind).toBe('table');
    expect(() => run(createDomain('table', owner), 'access.saveRole', { name: 'Legacy', permissions: [] }, legacyMember)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(roles(run(createDomain('table', owner), 'access.saveRole', { name: 'Legacy', permissions: [] }, base))).toHaveLength(1);
  });

  it('gates rule drafting and approval separately', () => {
    const drafter = withPermissions(['rules.draft']);
    const change = { kind: 'table', program: null } as unknown;
    // The permission check runs before the payload is parsed, so an approver-only member is refused first.
    expect(() => run(createDomain('table', owner), 'evolve.propose', { change }, withPermissions(['rules.approve']))).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => run(createDomain('table', owner), 'evolve.simulate', {}, drafter)).toThrow(expect.objectContaining({ code: 'FORBIDDEN' }));
    expect(() => run(createDomain('table', owner), 'evolve.simulate', {}, withPermissions(['rules.approve']))).toThrow(expect.objectContaining({ code: 'CANDIDATE_NOT_FOUND' }));
  });
});
