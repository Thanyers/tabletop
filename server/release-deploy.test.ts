import { describe, expect, it } from 'vitest';
import { changelogHasVersion, checkDeployConfig, databaseName, releaseVersionFromMerge, smoke } from './release-deploy';
import { computeRuntimeCapabilities } from '../src/tabletop/shared/compute-runtime-profiles';

const config = (overrides: Record<string, unknown> = {}) => JSON.stringify({
  name: 'tabletop-staging',
  vars: { PUBLIC_ORIGIN: 'https://staging.example' },
  d1_databases: [{ binding: 'DB', database_name: 'tabletop-staging', database_id: '11111111-2222-3333-4444-555555555555' }],
  assets: { run_worker_first: ['/api/*', '/version'] },
  ...overrides,
});

describe('release deploy helpers (CD001)', () => {
  it('reads the version only from release/hotfix merges into main', () => {
    expect(releaseVersionFromMerge('Merge pull request #39 from Thanyers/release/2.1.0')).toBe('2.1.0');
    expect(releaseVersionFromMerge('Merge pull request #50 from Thanyers/hotfix/2.1.1')).toBe('2.1.1');
    for (const subject of [
      'Merge pull request #37 from Thanyers/feat/F009-live-cursors',
      'Merge pull request #36 from Thanyers/main',
      'Merge pull request #9 from Thanyers/release/2.1',
      'Merge pull request #9 from Thanyers/release/02.1.0',
      'R210: prepare release 2.1.0',
    ]) expect(releaseVersionFromMerge(subject)).toBeNull();
  });
  it('requires the released CHANGELOG heading', () => {
    expect(changelogHasVersion('# Changelog\n\n## Unreleased\n\n## 2.1.0 — 2026-10-20\n', '2.1.0')).toBe(true);
    expect(changelogHasVersion('## 2.1.10 — x\n', '2.1.1')).toBe(false);
    expect(changelogHasVersion('## Unreleased\n- 2.1.0 soon\n', '2.1.0')).toBe(false);
  });
  it('rejects a config for the wrong worker, origin or placeholder database', () => {
    expect(checkDeployConfig(config(), { name: 'tabletop-staging', origin: 'https://staging.example' })).toEqual({ ok: true, problems: [] });
    expect(checkDeployConfig(config(), { name: 'tabletop', origin: 'https://staging.example' }).ok).toBe(false);
    expect(checkDeployConfig(config({ vars: { PUBLIC_ORIGIN: 'https://prod.example' } }), { name: 'tabletop-staging', origin: 'https://staging.example' }).ok).toBe(false);
    expect(checkDeployConfig(config({ d1_databases: [{ binding: 'DB', database_name: 'x', database_id: '00000000-0000-0000-0000-000000000000' }] }), { name: 'tabletop-staging', origin: 'https://staging.example' }).ok).toBe(false);
    expect(checkDeployConfig(config({ assets: { run_worker_first: ['/api/*'] } }), { name: 'tabletop-staging', origin: 'https://staging.example' }).ok).toBe(false);
    expect(checkDeployConfig('// jsonc\n{}', { name: 'a', origin: 'b' }).ok).toBe(false);
    expect(checkDeployConfig(config({ limits: { cpu_ms: 50 } }), { name: 'tabletop-staging', origin: 'https://staging.example' }).problems.join()).toContain('Workers Free');
    expect(databaseName(config())).toBe('tabletop-staging');
  });
  it('passes smoke only when every read-only endpoint answers and /version matches the release', async () => {
    const routes: Record<string, () => Response> = {
      '/healthz': () => new Response('ok'),
      '/readyz': () => new Response('ok'),
      '/api/capabilities': () => Response.json({ ai: true }),
      '/version': () => Response.json({ version: '2.1.0', sha: '8eef72c', built_at: 'x' }),
      '/': () => new Response('<div id="root"></div>'),
      '/new': () => new Response('<div id="root"></div>'),
    };
    const fetcher = (async (input: URL | RequestInfo) => (routes[new URL(String(input)).pathname] ?? (() => new Response('', { status: 404 })))()) as typeof fetch;
    const good = await smoke('https://staging.example', '2.1.0', '8eef72c77b9e6b06', fetcher);
    expect(good.every(result => result.ok)).toBe(true);
    const stale = await smoke('https://staging.example', '2.2.0', '1234567', fetcher);
    expect(stale.find(result => result.path === '/version')?.ok).toBe(false);
  });
  it('fails compute smoke on disabled engines or an incomplete Python profile', async () => {
    let compute: unknown = { profile: 'tabletop-compute-1', runtimes: [], pythonLibraries: [] };
    const fetcher = (async (input: URL | RequestInfo) => {
      const path = new URL(String(input)).pathname;
      if (path === '/api/capabilities') return Response.json({ compute });
      if (path === '/version') return Response.json({ version: '9.0.0', sha: 'abcdef0' });
      if (path === '/' || path === '/new') return new Response('<div id="root"></div>');
      return new Response('ok');
    }) as typeof fetch;
    const run = () => smoke('https://staging.example', '9.0.0', 'abcdef012345', fetcher, true);
    expect((await run()).find(result => result.path === '/api/capabilities.compute')?.ok).toBe(false);
    compute = computeRuntimeCapabilities({ javascript: true, python: true });
    expect((await run()).every(result => result.ok)).toBe(true);
    compute = { ...computeRuntimeCapabilities({ javascript: true, python: true }), pythonLibraries: ['pandas 2.3.3'] };
    expect((await run()).find(result => result.path === '/api/capabilities.compute')?.ok).toBe(false);
  });
});
