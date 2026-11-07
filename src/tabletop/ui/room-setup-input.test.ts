import { describe, expect, it } from 'vitest';
import { parseSpaceCommand } from '../shared/collaboration-space-command';
import { buildRoomCreatePayload } from './room-setup-input';

const HOST = '11111111-1111-4111-8111-111111111111';

describe('buildRoomCreatePayload', () => {
  it('passes the schema the authority parses, which the old two-field payload did not', () => {
    const payload = buildRoomCreatePayload({ hostWorkspaceId: HOST, spaceId: 'activity-room', title: 'ห้องกิจกรรม' });
    expect(parseSpaceCommand('space.create', payload)).toEqual({
      ok: true,
      type: 'space.create',
      spaceId: 'activity-room',
      title: 'ห้องกิจกรรม',
      sharedToolWorkspaceId: HOST,
    });
  });

  it('pins the regression: a payload without the shared-tool workspace is refused', () => {
    expect(parseSpaceCommand('space.create', { spaceId: 'activity-room', title: 'ห้องกิจกรรม' }))
      .toMatchObject({ ok: false, code: 'SPACE_PAYLOAD' });
  });

  it('names the room workspace as the shared-tool workspace', () => {
    expect(buildRoomCreatePayload({ hostWorkspaceId: HOST, spaceId: 'studio', title: 'Studio' }).sharedToolWorkspaceId).toBe(HOST);
  });
});
