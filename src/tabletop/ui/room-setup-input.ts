/**
 * F093: what the table page sends to create a room.
 *
 * `space.create` has always required three fields — `spaceId`, `title` and `sharedToolWorkspaceId`
 * (`createSchema` in `collaboration-space-command.ts`) — but the table page sent only the first two
 * since D-050, so every attempt was refused with `SPACE_PAYLOAD` and no room was ever created from
 * the UI. The helper exists so the payload cannot lose that third field again without a test failing.
 *
 * The shared-tool workspace is the room's own workspace. A space never references itself as a source
 * (`space.addSource` and the room's picker both exclude it), so this can never collide with the
 * "the shared-tool workspace cannot also be a source" rule.
 */

export interface RoomCreateInput {
  /** The workspace that will host the space; the command is sent to it. */
  hostWorkspaceId: string;
  spaceId: string;
  title: string;
}

export interface RoomCreatePayload {
  spaceId: string;
  title: string;
  sharedToolWorkspaceId: string;
}

export function buildRoomCreatePayload(input: RoomCreateInput): RoomCreatePayload {
  return {
    spaceId: input.spaceId,
    title: input.title,
    sharedToolWorkspaceId: input.hostWorkspaceId,
  };
}
