import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain } from './index';
import { MAX_TABLE_MEMBER_SEATS, tableMemberSeatLimit, type ActorContext } from '../shared/contracts';
import type { Permission } from '../shared/permissions';

const owner: ActorContext = { actorId: 'test-owner', name: 'Fixture', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1, hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex') };

describe('display.set', () => {
  it('stores a table-wide connection setting and clears it back to the default', () => {
    const table = createDomain('table', owner);
    const hidden = decideDomain(table, { type: 'display.set', payload: { connections: false } }, owner).state;
    expect(hidden.display).toEqual({ connections: false });
    expect(hidden.dataRevision).toBe(table.dataRevision);
    const auto = decideDomain(hidden, { type: 'display.set', payload: { connections: null } }, owner).state;
    expect(auto.display).toBeUndefined();
  });

  it('needs the table settings permission and a valid payload', () => {
    const table = createDomain('table', owner);
    const viewer = { ...owner, actorId: 'test-viewer', role: 'participant' as const, permissions: new Set<Permission>() };
    expect(() => decideDomain(table, { type: 'display.set', payload: { connections: true } }, viewer)).toThrow();
    expect(() => decideDomain(table, { type: 'display.set', payload: { connections: 'yes' } }, owner)).toThrow();
  });

  it('stores a member limit without touching the connection setting, and clears it back to the maximum', () => {
    const table = createDomain('table', owner);
    const hidden = decideDomain(table, { type: 'display.set', payload: { connections: false } }, owner).state;
    const limited = decideDomain(hidden, { type: 'display.set', payload: { maxMembers: 3 } }, owner);
    expect(limited.state.display).toEqual({ connections: false, maxMembers: 3 });
    expect(limited.label).toBe('Member limit set to 3 members besides the owner.');
    const shown = decideDomain(limited.state, { type: 'display.set', payload: { connections: true } }, owner).state;
    expect(shown.display).toEqual({ connections: true, maxMembers: 3 });
    const maximum = decideDomain(shown, { type: 'display.set', payload: { maxMembers: null } }, owner).state;
    expect(maximum.display).toEqual({ connections: true });
    expect(tableMemberSeatLimit(maximum.display)).toBe(MAX_TABLE_MEMBER_SEATS);
    expect(tableMemberSeatLimit(limited.state.display)).toBe(3);
  });

  it('gates the member limit by the invite permission and bounds it to the seat list', () => {
    const table = createDomain('table', owner);
    const settingsOnly = { ...owner, actorId: 'test-settings', role: 'participant' as const, permissions: new Set<Permission>(['table.rename']) };
    const inviter = { ...owner, actorId: 'test-inviter', role: 'participant' as const, permissions: new Set<Permission>(['members.invite']) };
    expect(() => decideDomain(table, { type: 'display.set', payload: { maxMembers: 4 } }, settingsOnly)).toThrow('cannot do this');
    expect(decideDomain(table, { type: 'display.set', payload: { maxMembers: 4 } }, inviter).state.display).toEqual({ maxMembers: 4 });
    expect(() => decideDomain(table, { type: 'display.set', payload: { connections: true } }, inviter)).toThrow('cannot do this');
    expect(() => decideDomain(table, { type: 'display.set', payload: { connections: true, maxMembers: 4 } }, settingsOnly)).toThrow('cannot do this');
    for (const maxMembers of [0, MAX_TABLE_MEMBER_SEATS + 1, 2.5, '3']) {
      expect(() => decideDomain(table, { type: 'display.set', payload: { maxMembers } }, owner)).toThrow();
    }
    expect(() => decideDomain(table, { type: 'display.set', payload: {} }, owner)).toThrow();
    expect(() => decideDomain(createDomain('teaching', { ...owner, role: 'teacher' }), { type: 'display.set', payload: { maxMembers: 2 } }, { ...owner, role: 'teacher' })).toThrow('Only a table');
  });
});
