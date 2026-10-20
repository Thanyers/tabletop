import { describe, expect, it } from 'vitest';
import { createBuildInfo, parseBuildInfo, UNTAGGED_VERSION } from './build-info.js';

const now = new Date('2026-10-20T04:12:00.123Z');
const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

describe('build identity for GET /version', () => {
  it('takes the version from a release tag and shortens the commit', () => {
    expect(createBuildInfo({ tag: 'v1.4.2', sha, now })).toEqual({ version: '1.4.2', sha: 'a1b2c3d', built_at: '2026-10-20T04:12:00Z' });
    expect(createBuildInfo({ tag: 'v1.2.0-rc.1\n', sha, now }).version).toBe('1.2.0-rc.1');
  });

  it('marks untagged or non-release tags as a dev build instead of guessing a number', () => {
    for (const tag of [null, '', 'v1.0', '1.0.0', 'v01.0.0', 'release-1', 'v1.0.0+build.5']) {
      expect(createBuildInfo({ tag, sha, now }).version).toBe(UNTAGGED_VERSION);
    }
  });

  it('reports an unknown commit when git is unavailable or returns something unexpected', () => {
    expect(createBuildInfo({ tag: null, sha: null, now }).sha).toBe('unknown');
    expect(createBuildInfo({ tag: null, sha: 'fatal: not a git repository', now }).sha).toBe('unknown');
  });

  it('round-trips what the build writes and rejects any other shape', () => {
    const info = createBuildInfo({ tag: 'v2.0.0', sha, now });
    expect(parseBuildInfo(JSON.parse(JSON.stringify(info)))).toEqual(info);
    expect(parseBuildInfo(createBuildInfo({ tag: null, sha: null, now }))).toEqual({ version: UNTAGGED_VERSION, sha: 'unknown', built_at: '2026-10-20T04:12:00Z' });
    for (const bad of [null, [], 'x', { ...info, extra: 1 }, { ...info, version: '1.0' }, { ...info, sha: sha }, { ...info, built_at: 'yesterday' }, { version: info.version, sha: info.sha }]) {
      expect(parseBuildInfo(bad)).toBeNull();
    }
  });
});
