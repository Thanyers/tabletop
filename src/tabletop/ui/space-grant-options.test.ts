import { describe, expect, it } from 'vitest';
import type { TableState } from '../shared/table-contracts';
import { grantResources, grantableRooms, keepKnownFields, tableStateOf } from './space-grant-options';

const space = {
  schemaVersion: 1,
  workspaceId: 'ws-table',
  spaceId: 'planning',
  title: 'Planning room',
  sharedToolWorkspaceId: 'ws-tool',
  members: [],
  sources: [],
} as unknown as TableState['collaborationSpace'];

function tableWith(overrides: Partial<TableState>): TableState {
  return { kind: 'table', dataRevision: 1, ruleRevision: 1, candidate: null, revisions: [], sources: [], program: null, records: {}, turn: null, ...overrides } as TableState;
}

describe('grantableRooms', () => {
  it('offers the space this table hosts first', () => {
    const rooms = grantableRooms(tableWith({ collaborationSpace: space }), 'ws-table', () => undefined);
    expect(rooms).toEqual([{ workspaceId: 'ws-table', spaceId: 'planning', title: 'Planning room' }]);
  });

  it('offers a space this table already granted, named from the session list', () => {
    const table = tableWith({
      spaceGrants: [{ grantId: 'grant-1', spaceId: 'studio', spaceWorkspaceId: 'ws-studio', sourceWorkspaceId: 'ws-table' }] as TableState['spaceGrants'],
    });
    const rooms = grantableRooms(table, 'ws-table', id => (id === 'ws-studio' ? 'Studio' : undefined));
    expect(rooms).toEqual([{ workspaceId: 'ws-studio', spaceId: 'studio', title: 'Studio' }]);
  });

  it('falls back to the slug when the session list does not know the room', () => {
    const table = tableWith({
      spaceGrants: [{ grantId: 'grant-1', spaceId: 'studio', spaceWorkspaceId: 'ws-studio', sourceWorkspaceId: 'ws-table' }] as TableState['spaceGrants'],
    });
    expect(grantableRooms(table, 'ws-table', () => undefined)[0].title).toBe('studio');
  });

  it('lists a room once even when it holds several grants', () => {
    const grant = { grantId: 'grant-1', spaceId: 'studio', spaceWorkspaceId: 'ws-studio', sourceWorkspaceId: 'ws-table' };
    const table = tableWith({ spaceGrants: [grant, { ...grant, grantId: 'grant-2' }] as TableState['spaceGrants'] });
    expect(grantableRooms(table, 'ws-table', () => 'Studio')).toHaveLength(1);
  });

  it('offers nothing when the table hosts no space and granted none', () => {
    expect(grantableRooms(tableWith({}), 'ws-table', () => 'Anything')).toEqual([]);
  });
});

describe('grantResources', () => {
  const program = {
    version: 1, title: 'Rooms', description: '', actions: [], invariants: [], turnOrder: [], evidence: [], assumptions: [],
    collections: [
      { id: 'rooms', title: 'Rooms', fields: [{ id: 'name', label: 'Name', type: 'text', required: true }, { id: 'price', label: '', type: 'number', required: false }] },
    ],
  } as unknown as Parameters<typeof grantResources>[0];

  it('reads the collections and their fields', () => {
    expect(grantResources(program)).toEqual([
      { id: 'rooms', label: 'Rooms', fields: [{ id: 'name', label: 'Name' }, { id: 'price', label: 'price' }] },
    ]);
  });

  it('has nothing to offer before the table has rules', () => {
    expect(grantResources(null)).toEqual([]);
  });
});

describe('keepKnownFields', () => {
  const resources = [
    { id: 'rooms', label: 'Rooms', fields: [{ id: 'name', label: 'Name' }, { id: 'price', label: 'Price' }] },
    { id: 'guests', label: 'Guests', fields: [{ id: 'name', label: 'Name' }] },
  ];

  it('keeps the resource order, not the order they were ticked', () => {
    expect(keepKnownFields(resources, 'rooms', ['price', 'name'])).toEqual(['name', 'price']);
  });

  it('drops a field that belongs to another resource', () => {
    expect(keepKnownFields(resources, 'guests', ['name', 'price'])).toEqual(['name']);
  });

  it('drops everything when the resource is unknown', () => {
    expect(keepKnownFields(resources, 'missing', ['name'])).toEqual([]);
  });
});

describe('tableStateOf', () => {
  it('passes a table through and refuses another domain', () => {
    const table = tableWith({});
    expect(tableStateOf(table)).toBe(table);
    expect(tableStateOf({ kind: 'invoice' })).toBeUndefined();
    expect(tableStateOf(undefined)).toBeUndefined();
  });
});
