import { describe, expect, it } from 'vitest';
import { fetchServedBuild, isDifferentBuild, parseIdentity, versionLabel } from './version-check';

const running = { version: '4.3.0', sha: 'a1b2c3d' };

describe('update notice version check', () => {
  it('flags a new release or a new commit as a different build', () => {
    expect(isDifferentBuild(running, { version: '4.4.0', sha: 'b2c3d4e' })).toBe(true);
    expect(isDifferentBuild(running, { version: '4.3.0', sha: 'b2c3d4e' })).toBe(true);
    expect(isDifferentBuild(running, { ...running })).toBe(false);
  });

  it('does not treat an unknown sha as a change unless the version moved', () => {
    expect(isDifferentBuild({ version: '4.3.0', sha: 'unknown' }, running)).toBe(false);
    expect(isDifferentBuild(running, { version: '4.4.0', sha: 'unknown' })).toBe(true);
  });

  it('ignores bodies that are not build info', () => {
    for (const bad of [null, [], '<!doctype html>', { version: '4.3.0' }, { version: 1, sha: 'a' }, { version: '', sha: '' }]) {
      expect(parseIdentity(bad)).toBeNull();
    }
    expect(parseIdentity({ version: '4.3.0', sha: 'a1b2c3d', built_at: 'x' })).toEqual(running);
  });

  it('fetches /version without cache and survives failures', async () => {
    const calls: [unknown, RequestInit | undefined][] = [];
    const ok = (async (url: unknown, init?: RequestInit) => { calls.push([url, init]); return Response.json({ version: '4.4.0', sha: 'b2c3d4e', built_at: 'x' }); }) as typeof fetch;
    expect(await fetchServedBuild(ok)).toEqual({ version: '4.4.0', sha: 'b2c3d4e' });
    expect(calls[0]).toEqual(['/version', { cache: 'no-store', credentials: 'omit' }]);
    expect(await fetchServedBuild((async () => new Response('nope', { status: 404 })) as typeof fetch)).toBeNull();
    expect(await fetchServedBuild((async () => new Response('<html>', { status: 200 })) as typeof fetch)).toBeNull();
    expect(await fetchServedBuild((async () => { throw new TypeError('offline'); }) as typeof fetch)).toBeNull();
  });

  it('labels only tagged releases', () => {
    expect(versionLabel({ version: '4.4.0', sha: 'x' })).toBe('v4.4.0');
    expect(versionLabel({ version: '4.4.0-rc.1', sha: 'x' })).toBe('v4.4.0-rc.1');
    expect(versionLabel({ version: '0.0.0-dev', sha: 'x' })).toBe('');
  });
});
