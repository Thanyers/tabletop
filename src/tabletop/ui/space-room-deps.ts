import type { WorkspaceView } from '../shared/contracts';
import type { CollaborationSpace } from '../shared/collaboration-space';
import { createJoinedProjectionFetcher } from './joined-projection-fetcher';
import type { SpaceRoomDeps } from './SpaceRoomScreen';

/**
 * F080 / JT-V: the only place that turns the app's real transport into the room screen's deps.
 *
 * Keeping it separate means the screen stays testable and the wiring stays one reviewable function:
 * one call loads the workspace, one loads the recap (which also reports the connections each source
 * holds), and the projection reads reuse the fetcher the joined panel already uses.
 */

export interface SpaceRoomAdapterInput {
  /** The app's existing workspace loader; it already handles auth and notices. */
  loadWorkspace(workspaceId: string): Promise<WorkspaceView>;
  /** The signed-in actor, from the session rather than from the URL. */
  actorId: string;
  /** A display label for the header; never an email or an id. */
  viewerLabel: string;
  /** API origin, empty for same-origin. */
  origin?: string;
  /** Injected for tests. */
  fetchImpl?: typeof fetch;
}

interface RecapPayload {
  recap: {
    headline: string;
    incomplete: boolean;
    changed: { workspaceId: string }[];
    withdrawn: { workspaceId: string }[];
    members?: { actorId: string; unseen: boolean }[];
  };
  connections?: { workspaceId: string; grantId: string; ports: string[] }[];
}

export function createSpaceRoomDeps(input: SpaceRoomAdapterInput): SpaceRoomDeps {
  const origin = input.origin ?? '';
  const doFetch = input.fetchImpl ?? fetch;
  /** One recap request per workspace per load; the screen asks twice in a row. */
  const recapCache = new Map<string, Promise<RecapPayload | undefined>>();

  const loadRecap = (workspaceId: string): Promise<RecapPayload | undefined> => {
    const cached = recapCache.get(workspaceId);
    if (cached) return cached;
    const request = (async (): Promise<RecapPayload | undefined> => {
      const response = await doFetch(`${origin}/api/workspaces/${encodeURIComponent(workspaceId)}/space/recap`, {
        method: 'GET',
        credentials: 'include',
        headers: { accept: 'application/json' },
      });
      if (response.status === 401 || response.status === 403 || response.status === 404) return undefined;
      if (!response.ok) throw new Error(`recap failed: ${response.status}`);
      return await response.json() as RecapPayload;
    })();
    recapCache.set(workspaceId, request);
    return request;
  };

  return {
    actorId: input.actorId,
    viewerLabel: () => input.viewerLabel,
    fetchProjection: createJoinedProjectionFetcher({
      origin,
      ...(input.fetchImpl ? { fetchImpl: input.fetchImpl } : {}),
    }),
    async loadSpace(workspaceId) {
      try {
        const view = await input.loadWorkspace(workspaceId);
        const space = (view.domain as unknown as { collaborationSpace?: CollaborationSpace }).collaborationSpace;
        return space ? { title: view.title, space } : undefined;
      } catch {
        // Not a member, or the table is gone: the screen shows one notice for both.
        return undefined;
      }
    },
    async loadRecap(workspaceId) {
      const payload = await loadRecap(workspaceId);
      return payload ? payload.recap : undefined;
    },
    async loadConnections(workspaceId) {
      const payload = await loadRecap(workspaceId);
      // The destination does not know a grant id on its own; it uses what the source reported.
      return (payload?.connections ?? []).map(connection => ({
        workspaceId: connection.workspaceId,
        grantId: connection.grantId,
        ports: connection.ports,
      }));
    },
  };
}
