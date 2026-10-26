import { spaceProjectionUrl } from '../shared/space-projection-url';
import type { JoinedReadDeps, ProjectionResponse } from './joined-projection-client';

/**
 * F080 / C6: the browser binding between the joined panel and the Worker route.
 *
 * This is deliberately tiny — one `fetch` with credentials — because it is the only part of the
 * joined read that cannot be covered by a pure test. What *is* tested is that it asks the exact URL
 * the Worker route is proven to answer (`spaceProjectionUrl`), that it sends cookies, and that it
 * surfaces the status and body to the mapping layer instead of swallowing them.
 */

export interface JoinedProjectionFetcherOptions {
  /** API origin; empty string means "same origin" (the normal deployment). */
  origin?: string;
  /** Injected for tests; defaults to the platform fetch. */
  fetchImpl?: typeof fetch;
}

export function createJoinedProjectionFetcher(options: JoinedProjectionFetcherOptions = {}): JoinedReadDeps['fetchProjection'] {
  const origin = options.origin ?? '';
  const doFetch = options.fetchImpl ?? fetch;
  return async (input): Promise<ProjectionResponse> => {
    const url = `${origin}${spaceProjectionUrl(input.spaceWorkspaceId, { source: input.source, grant: input.grant, port: input.port })}`;
    const response = await doFetch(url, {
      method: 'GET',
      // The session cookie is what authorizes the read; without it the Worker answers 401.
      credentials: 'include',
      headers: { accept: 'application/json' },
      ...(input.signal ? { signal: input.signal } : {}),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A non-JSON body (an error page, an empty 204) is still reported by its status.
      body = null;
    }
    return { status: response.status, body };
  };
}
