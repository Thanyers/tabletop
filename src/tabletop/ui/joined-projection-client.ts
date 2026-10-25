import type { JoinedSource, JoinedSourceStatus } from './JoinedProjectionView';

/**
 * F080 / C6: the client half that connects the panel to the cross-workspace endpoint.
 *
 * Two rules matter here. One failing source must not hide the others — a read that throws or is
 * refused becomes a status on that card, never a rejected batch. And a refusal is mapped to the
 * state the panel already understands, so the UI never has to interpret HTTP codes itself.
 */

export interface JoinedSourceRequest {
  /** The source workspace id; also the panel key. */
  workspaceId: string;
  /** Display label; never derived from the workspace id. */
  label: string;
  portId: string;
  grantId: string;
}

export interface ProjectionResponse {
  status: number;
  body: unknown;
}

export interface JoinedReadDeps {
  /** One authorized projection read; the caller owns credentials and origin. */
  fetchProjection(input: { spaceWorkspaceId: string; source: string; grant: string; port: string; signal?: AbortSignal }): Promise<ProjectionResponse>;
  signal?: AbortSignal;
}

interface OkBody {
  ok: true;
  portId: string;
  projection: { portId: string; fields: string[]; maxRows: number };
  rows: { id: string; values: Record<string, string | number | boolean | null> }[];
  sourceDataRevision: number;
}

function isOkBody(value: unknown): value is OkBody {
  return typeof value === 'object' && value !== null
    && (value as { ok?: unknown }).ok === true
    && Array.isArray((value as { rows?: unknown }).rows);
}

/** The status a refusal maps to; anything unrecognised is treated as a missing source. */
function statusFor(body: unknown): JoinedSourceStatus {
  const code = (body as { errorCode?: unknown } | null)?.errorCode;
  if (code === 'SPACE_GRANT_REVOKED') return 'revoked';
  if (code === 'SPACE_GRANT_STALE_EPOCH') return 'stale';
  return 'missing';
}

export async function readJoinedSources(
  spaceWorkspaceId: string,
  requests: readonly JoinedSourceRequest[],
  deps: JoinedReadDeps,
): Promise<JoinedSource[]> {
  return Promise.all(requests.map(async request => {
    const base: JoinedSource = {
      workspaceId: request.workspaceId,
      label: request.label,
      portId: request.portId,
      status: 'missing',
      dataRevision: 0,
      rows: [],
      fields: [],
    };
    try {
      const response = await deps.fetchProjection({
        spaceWorkspaceId,
        source: request.workspaceId,
        grant: request.grantId,
        port: request.portId,
        ...(deps.signal ? { signal: deps.signal } : {}),
      });
      if (response.status === 200 && isOkBody(response.body)) {
        return {
          ...base,
          status: 'live' as const,
          dataRevision: response.body.sourceDataRevision,
          rows: response.body.rows,
          fields: response.body.projection.fields,
        };
      }
      return { ...base, status: statusFor(response.body) };
    } catch {
      // A single failing source becomes a card state; it never rejects the whole read.
      return { ...base, status: 'missing' as const };
    }
  }));
}
