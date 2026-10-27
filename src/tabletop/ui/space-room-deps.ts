import type { WorkspaceView } from '../shared/contracts';
import type { CollaborationSpace } from '../shared/collaboration-space';
import { createJoinedProjectionFetcher } from './joined-projection-fetcher';
import type { SpaceRoomDeps, ToolIntentAnswer } from './SpaceRoomScreen';

/**
 * F080 / JT-V: the only place that turns the app's real transport into the room screen's deps.
 *
 * Keeping it separate means the screen stays testable and the wiring stays one reviewable function:
 * one call loads the workspace, one loads the recap (which also reports the connections each source
 * holds), and the projection reads reuse the fetcher the joined panel already uses.
 *
 * The one write this file can trigger is the tool intent route. It is the room's own command path —
 * the Worker forwards the intent and the room commits through `table.act` (D-033) — so nothing here
 * applies a change itself.
 */

export interface SpaceRoomAdapterInput {
  /** The room this adapter serves; the intent route names it in the path. */
  workspaceId: string;
  /** The app's existing workspace loader; it already handles auth and notices. */
  loadWorkspace(workspaceId: string): Promise<WorkspaceView>;
  /** The signed-in actor, from the session rather than from the URL. */
  actorId: string;
  /** A display label for the header; never an email or an id. */
  viewerLabel: string;
  /**
   * F080 / D-044: origin serving the sandbox document, already validated by the capabilities parser.
   * Absent keeps the inline `srcDoc` frame the room had before this field existed.
   */
  toolSandboxOrigin?: string;
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

/** A refusal is the room's own `{ ok: false, code, message }`, whatever status carried it. */
function intentRefusal(body: unknown): Extract<ToolIntentAnswer, { ok: false }> | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const record = body as { ok?: unknown; code?: unknown; message?: unknown };
  if (record.ok !== false || typeof record.code !== 'string') return undefined;
  return {
    ok: false,
    code: record.code,
    message: typeof record.message === 'string' ? record.message : record.code,
  };
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
    ...(input.toolSandboxOrigin ? { toolSandboxOrigin: input.toolSandboxOrigin } : {}),
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
    async runToolIntent(request) {
      let response: Response;
      try {
        response = await doFetch(`${origin}/api/workspaces/${encodeURIComponent(input.workspaceId)}/space/tool/intent`, {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({ behaviorId: request.behaviorId, inputs: request.inputs }),
        });
      } catch (error) {
        // A transport failure is still something the frame must be able to finish its promise with.
        return { ok: false, code: 'TOOL_BEHAVIOR_FAILED', message: error instanceof Error ? error.message : String(error) };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      const refusal = intentRefusal(body);
      if (refusal) return refusal;
      const actionId = typeof body === 'object' && body !== null ? (body as { actionId?: unknown }).actionId : undefined;
      if (!response.ok || typeof actionId !== 'string') {
        return { ok: false, code: 'TOOL_BEHAVIOR_FAILED', message: `intent failed: ${response.status}` };
      }
      return { ok: true, actionId, ack: body };
    },
    /**
     * D-051: install a pasted package in this room.
     *
     * This is an ordinary command, so the authority still checks membership, the declared actions and
     * the package hash; the panel only reports what came back.
     */
    async installTool(tool) {
      // A command needs the revision and epoch the room is at now, so read the room first instead of
      // carrying a stale pair through the adapter's input.
      let current;
      try {
        current = await input.loadWorkspace(input.workspaceId);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      let response: Response;
      try {
        response = await doFetch(`${origin}/api/workspaces/${encodeURIComponent(input.workspaceId)}/commands`, {
          method: 'POST',
          credentials: 'include',
          headers: { accept: 'application/json', 'content-type': 'application/json' },
          body: JSON.stringify({
            commandId: globalThis.crypto.randomUUID(),
            expectedRevision: current.revision,
            expectedEpoch: current.epoch,
            type: 'space.installTool',
            payload: { tool },
          }),
        });
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) };
      }
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      if (response.ok) return { ok: true, message: `ติดตั้งแล้ว: ${tool.title} v${tool.version}` };
      const message = typeof body === 'object' && body !== null && typeof (body as { message?: unknown }).message === 'string'
        ? String((body as { message: string }).message)
        : `ติดตั้งไม่สำเร็จ: ${response.status}`;
      return { ok: false, message };
    },
  };
}
