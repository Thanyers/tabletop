// Detects that the server now serves a different build than the one running in
// this tab. The running identity is baked in at build time (vite `define`), the
// served one comes from GET /version, so staging and production each compare
// against their own deploy without any push channel.

export interface BuildIdentity {
  version: string;
  sha: string;
}

export const VERSION_CHECK_INTERVAL_MS = 5 * 60_000;

/** The identity this bundle was built with, or null in the Vite dev server and tests. */
export function runningBuild(): BuildIdentity | null {
  return typeof __TABLETOP_BUILD__ === 'undefined' ? null : parseIdentity(__TABLETOP_BUILD__);
}

/** Reads only the fields we compare; an SPA fallback (HTML) or error body yields null. */
export function parseIdentity(value: unknown): BuildIdentity | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { version, sha } = value as Record<string, unknown>;
  if (typeof version !== 'string' || typeof sha !== 'string' || !version || !sha) return null;
  return { version, sha };
}

/** A different served build means the tab is stale; an unknown sha on either side is not evidence. */
export function isDifferentBuild(running: BuildIdentity, served: BuildIdentity): boolean {
  if (running.sha === 'unknown' || served.sha === 'unknown') return running.version !== served.version;
  return running.sha !== served.sha || running.version !== served.version;
}

export async function fetchServedBuild(fetcher: typeof fetch = fetch): Promise<BuildIdentity | null> {
  try {
    const response = await fetcher('/version', { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) return null;
    return parseIdentity(await response.json());
  } catch {
    return null;
  }
}

/** "v4.4.0" for a release, nothing for an untagged build. */
export function versionLabel(build: BuildIdentity): string {
  return /^\d+\.\d+\.\d+/u.test(build.version) && !build.version.startsWith('0.0.0-dev') ? `v${build.version}` : '';
}
