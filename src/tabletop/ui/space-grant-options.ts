import type { TableProgram, TableState } from '../shared/table-contracts';
import type { GrantableRoom } from './SpaceGrantPanel';

/**
 * F093: what the grant dialog may offer, derived from the table being viewed.
 *
 * Before this the dialog listed *every other workspace* in the session as a possible room and asked
 * the person to type the resource and the fields by hand. Neither was knowledge the person had: the
 * session list says nothing about which workspaces host a room, and a mistyped resource or field is
 * only refused after the command is sent. Both lists exist in the table itself, so they are read from
 * it here, as pure functions the panel and its tests share.
 *
 * A room is only offered when the table can prove it is one: the space this workspace hosts, or a
 * space this table already granted. A workspace that merely appears in the session list is not a room
 * and is not offered any more — it was never a valid target, only a plausible-looking one.
 */

/** The table's own domain, when the open workspace is a table. */
export function tableStateOf(domain: { kind: string } | undefined | null): TableState | undefined {
  return domain?.kind === 'table' ? (domain as TableState) : undefined;
}

/**
 * Rooms this table may grant, most relevant first: the space it hosts, then spaces it already
 * granted. `titleOf` resolves a workspace id to its name from the session list.
 */
export function grantableRooms(
  table: TableState | undefined,
  hostWorkspaceId: string | undefined,
  titleOf: (workspaceId: string) => string | undefined,
): GrantableRoom[] {
  if (!table || hostWorkspaceId === undefined) return [];
  const rooms: GrantableRoom[] = [];
  const seen = new Set<string>();
  const add = (room: GrantableRoom): void => {
    const key = `${room.workspaceId}\u0000${room.spaceId}`;
    if (seen.has(key)) return;
    seen.add(key);
    rooms.push(room);
  };

  const hosted = table.collaborationSpace;
  if (hosted) add({ workspaceId: hostWorkspaceId, spaceId: hosted.spaceId, title: hosted.title });

  for (const grant of table.spaceGrants ?? []) {
    add({
      workspaceId: grant.spaceWorkspaceId,
      spaceId: grant.spaceId,
      title: titleOf(grant.spaceWorkspaceId) ?? grant.spaceId,
    });
  }
  return rooms;
}

export interface GrantResource {
  id: string;
  label: string;
  fields: { id: string; label: string }[];
}

/** The collections a grant may name, with the fields each one can expose. */
export function grantResources(program: TableProgram | null | undefined): GrantResource[] {
  if (!program) return [];
  return program.collections.map(collection => ({
    id: collection.id,
    label: collection.title.trim() === '' ? collection.id : collection.title,
    fields: collection.fields.map(field => ({
      id: field.id,
      label: field.label.trim() === '' ? field.id : field.label,
    })),
  }));
}

/** Keep only the fields that still exist on the chosen resource, in the resource's own order. */
export function keepKnownFields(resources: GrantResource[], resourceId: string, fields: string[]): string[] {
  const resource = resources.find(candidate => candidate.id === resourceId);
  if (!resource) return [];
  const chosen = new Set(fields);
  return resource.fields.filter(field => chosen.has(field.id)).map(field => field.id);
}
