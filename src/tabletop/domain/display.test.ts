import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain } from './index';
import type { ActorContext } from '../shared/contracts';
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
});
