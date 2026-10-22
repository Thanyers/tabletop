import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import wranglerConfig from '../wrangler.jsonc?raw';
import { GOOGLE_CALLBACK_PATH, type Env } from './contracts.js';
import worker from './index.js';
import { isPagePath, pageKind } from './pages.js';

// F051: which paths a crawler may list, which are app-only, and which are real 404s.

const bindings = env as Env;
const origin = 'https://tabletop.test';
const tableId = '2f1c0e4a-9b7d-4c3e-8a21-5d6f7e8c9b0a';
const shellHtml = '<!doctype html><html><head><title>shell</title></head><body><div id="root"></div></body></html>';

/** Stands in for the asset binding so these checks do not depend on a fresh build. */
function withShell(): { env: Env; requested: string[] } {
  const requested: string[] = [];
  const ASSETS = {
    fetch: async (input: RequestInfo | URL) => {
      requested.push(new URL(input instanceof Request ? input.url : String(input)).pathname);
      return new Response(shellHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"shell"' } });
    },
  } as unknown as Fetcher;
  return { env: { ...bindings, ASSETS }, requested };
}

const fetchPage = (path: string, init?: RequestInit) => {
  const fixture = withShell();
  return worker.fetch(new Request(`${origin}${path}`, init), fixture.env).then((response) => ({ response, requested: fixture.requested }));
};

function expectSecurityHeaders(response: Response): void {
  expect(response.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(response.headers.get('X-Frame-Options')).toBe('DENY');
  expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
  expect(response.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
}

describe('F051 page classification', () => {
  it('lists only the landing page and the demo as public', () => {
    for (const path of ['/', '/demo', '/demo/', '/demo/replay', '/demo/replay/']) expect(pageKind(path)).toBe('public');
    for (const path of ['/new', '/new/', '/join', `/t/${tableId}`, `/t/${tableId}/`]) expect(pageKind(path)).toBe('app');
    for (const path of ['/asdf', '/t/not-a-uuid', `/t/${tableId}/extra`, '/demo/other', '/favicon.ico', '/index.htm']) expect(pageKind(path)).toBe('missing');
  });

  it('leaves API, internal and health paths to their own handlers', () => {
    for (const path of ['/api/session', GOOGLE_CALLBACK_PATH, '/internal/create', '/healthz', '/readyz', '/version']) expect(isPagePath(path)).toBe(false);
    for (const path of ['/', '/new', '/asdf', '/robots.txt']) expect(isPagePath(path)).toBe(true);
  });
});

describe('F051 HTML routes through the Worker', () => {
  it.each(['/demo', '/demo/', '/demo/replay'])('serves public page %s with 200 and no noindex', async (path) => {
    const { response, requested } = await fetchPage(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('X-Robots-Tag')).toBeNull();
    expect(await response.text()).toBe(shellHtml);
    expect(requested).toEqual(['/']);
    expectSecurityHeaders(response);
  });

  it.each(['/new', '/join', `/t/${tableId}`, `/t/${tableId}/`])('serves app page %s with 200 and noindex', async (path) => {
    const { response } = await fetchPage(path);
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await response.text()).toBe(shellHtml);
    expectSecurityHeaders(response);
  });

  it('keeps the invite fragment and a post-login deep link working (fragment never reaches the server)', async () => {
    const invite = await fetchPage('/join#invite=fixture-ticket');
    expect(invite.response.status).toBe(200);
    expect(await invite.response.text()).toBe(shellHtml);
    const deepLink = await fetchPage(`/t/${tableId}?from=login`);
    expect(deepLink.response.status).toBe(200);
    expect(deepLink.response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
  });

  it.each(['/asdf', '/t/not-a-uuid', `/t/${tableId}/extra`, '/demo/other'])('answers unknown page %s with 404, the app shell and noindex', async (path) => {
    const { response } = await fetchPage(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('text/html');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await response.text()).toBe(shellHtml);
    expectSecurityHeaders(response);
  });

  it.each(['/favicon.ico', '/assets/index-old.js'])('answers missing file %s with a short 404, not HTML', async (path) => {
    const { response, requested } = await fetchPage(path);
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(requested).toEqual([]);
  });

  it('answers HEAD with the same status and headers but no body', async () => {
    const { response } = await fetchPage('/new', { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
    expect(await response.text()).toBe('');
  });

  it('serves pages for a host other than PUBLIC_ORIGIN, as the asset server did', async () => {
    const fixture = withShell();
    const response = await worker.fetch(new Request(`https://other.test/t/${tableId}`), fixture.env);
    expect(response.status).toBe(200);
  });

  it('rejects writes to a page path instead of returning HTML', async () => {
    const { response } = await fetchPage('/new', { method: 'POST' });
    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('application/json');
  });

  it('keeps API, health and OAuth callback responses unchanged', async () => {
    const health = await fetchPage('/healthz');
    expect(health.response.status).toBe(200);
    expect(await health.response.json()).toEqual({ ok: true });
    const capabilities = await fetchPage('/api/capabilities');
    expect(capabilities.response.status).toBe(200);
    expect(capabilities.response.headers.get('Cache-Control')).toBe('no-store');
    expect(capabilities.response.headers.get('X-Robots-Tag')).toBeNull();
    // Without the bound cookie the callback fails as before, but inside the auth handler (a redirect), not as a page.
    const callback = await fetchPage(`${GOOGLE_CALLBACK_PATH}?state=x&code=y`);
    expect(callback.response.headers.get('Content-Type') ?? '').not.toContain('text/html');
    expect(callback.requested).toEqual([]);
    const internal = await fetchPage('/internal/metadata');
    expect(internal.response.status).toBe(404);
    expect(internal.requested).toEqual([]);
  });
});

describe('F051 routing config', () => {
  it('lets missing paths reach the Worker instead of the SPA fallback', () => {
    const config = JSON.parse(wranglerConfig.replace(/^\s*\/\/.*$/gmu, '')) as { assets: { not_found_handling: string; run_worker_first: string[] } };
    expect(config.assets.not_found_handling).toBe('none');
    expect(config.assets.run_worker_first).toEqual(['/api/*', '/healthz', '/readyz', '/version', '/internal/*']);
  });
});

// These read the real build through the asset binding (CI builds before this suite). The
// test harness calls the Worker directly, so asset-first routing is checked against `wrangler dev`.
describe('F051 built assets', () => {
  it('ships share-preview tags in the raw index.html', async () => {
    const html = await (await bindings.ASSETS.fetch(new Request(`${origin}/`))).text();
    const production = 'https://tabletop.ptchrr.workers.dev';
    for (const tag of [
      '<meta property="og:type" content="website"/>',
      `<meta property="og:url" content="${production}/"/>`,
      `<meta property="og:image" content="${production}/og-image.png"/>`,
      '<meta property="og:image:width" content="1200"/>',
      '<meta property="og:image:height" content="630"/>',
      '<meta name="twitter:card" content="summary_large_image"/>',
      `<link rel="canonical" href="${production}/"/>`,
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png"/>',
    ]) expect(html).toContain(tag);
    for (const name of ['og:title', 'og:description', 'og:image:alt', 'twitter:title', 'twitter:description', 'twitter:image']) {
      expect(html).toMatch(new RegExp(`(property|name)="${name}" content="[^"]+"`, 'u'));
    }
  });

  it('serves the preview image and touch icon at stable paths with their real sizes', async () => {
    for (const [path, width, height] of [['/og-image.png', 1200, 630], ['/apple-touch-icon.png', 180, 180]] as const) {
      const response = await bindings.ASSETS.fetch(new Request(`${origin}${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('Content-Type')).toBe('image/png');
      const header = new DataView(await response.arrayBuffer());
      expect([header.getUint32(16), header.getUint32(20)]).toEqual([width, height]);
    }
  });

  it('serves robots.txt without blocking app pages, and a sitemap of public pages only', async () => {
    const robots = await bindings.ASSETS.fetch(new Request(`${origin}/robots.txt`));
    expect(robots.headers.get('Content-Type')).toContain('text/plain');
    const rules = await robots.text();
    expect(rules).toContain('Disallow: /api/');
    expect(rules).toContain('Sitemap: https://tabletop.ptchrr.workers.dev/sitemap.xml');
    expect(rules).not.toMatch(/Disallow: \/(t\/|new|join)/u);
    const sitemap = await bindings.ASSETS.fetch(new Request(`${origin}/sitemap.xml`));
    expect(sitemap.headers.get('Content-Type')).toMatch(/xml/u);
    const locs = [...(await sitemap.text()).matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    expect(locs).toEqual(['https://tabletop.ptchrr.workers.dev/', 'https://tabletop.ptchrr.workers.dev/demo']);
  });

});
