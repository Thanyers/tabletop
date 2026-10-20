// Build identity served at GET /version. The build writes it next to the static
// assets so every upload of dist/ carries its own identity; the deploy command
// does not need to pass anything. The pushed git tag is the only version source.

export const BUILD_INFO_FILE = 'version.json';
export const UNTAGGED_VERSION = '0.0.0-dev';

export interface BuildInfo {
  version: string;
  sha: string;
  built_at: string;
}

export interface BuildSource {
  /** Output of `git describe --tags --exact-match`, or null when HEAD has no tag. */
  tag: string | null;
  /** Output of `git rev-parse HEAD`, or null when git is unavailable (e.g. Docker without .git). */
  sha: string | null;
  now: Date;
}

const releaseTag = /^v((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?)$/u;
const commitSha = /^[0-9a-f]{7,40}$/u;
const builtAt = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export function createBuildInfo(source: BuildSource): BuildInfo {
  const tag = source.tag?.trim() ?? '';
  const sha = source.sha?.trim().toLowerCase() ?? '';
  return {
    version: releaseTag.exec(tag)?.[1] ?? UNTAGGED_VERSION,
    sha: commitSha.test(sha) ? sha.slice(0, 7) : 'unknown',
    built_at: source.now.toISOString().replace(/\.\d{3}Z$/u, 'Z'),
  };
}

/** Accepts only the exact shape this build writes; anything else is treated as missing. */
export function parseBuildInfo(value: unknown): BuildInfo | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const { version, sha, built_at: at, ...rest } = value as Record<string, unknown>;
  if (Object.keys(rest).length > 0) return null;
  if (typeof version !== 'string' || (version !== UNTAGGED_VERSION && !releaseTag.test(`v${version}`))) return null;
  if (typeof sha !== 'string' || (sha !== 'unknown' && !/^[0-9a-f]{7}$/u.test(sha))) return null;
  if (typeof at !== 'string' || !builtAt.test(at)) return null;
  return { version, sha, built_at: at };
}
