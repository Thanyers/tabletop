import { parseRoute } from '../src/tabletop/shared/route-paths.js';
import type { Env } from './contracts.js';

// F051: the asset server answers real files (and `/` with index.html) itself. Every other
// GET reaches the Worker, which decides whether the path is a page the app owns.

/** Pages a search engine may list. Everything else the app owns is signed-in only. */
const publicPages = new Set(['/', '/demo', '/demo/replay']);

export type PageKind = 'public' | 'app' | 'missing';

export function pageKind(pathname: string): PageKind {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (publicPages.has(path || '/')) return 'public';
  return parseRoute(path) ? 'app' : 'missing';
}

/** Paths the Worker answers with the app shell instead of an API or health response. */
export function isPagePath(pathname: string): boolean {
  return !pathname.startsWith('/api/') && !pathname.startsWith('/internal/')
    && !['/healthz', '/readyz', '/version'].includes(pathname);
}

export async function servePage(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const kind = pageKind(pathname);
  const noindex: Record<string, string> = kind === 'public' ? {} : { 'X-Robots-Tag': 'noindex, nofollow' };
  // A missing file (an old hashed chunk, /favicon.ico) gets a short 404, not HTML a script tag would choke on.
  if (kind === 'missing' && /\.[a-z0-9]+$/iu.test(pathname)) {
    return new Response('Not found.', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', ...noindex } });
  }
  const shell = await env.ASSETS.fetch(new Request(new URL('/', request.url)));
  if (!shell.ok) return shell;
  const headers = new Headers(shell.headers);
  for (const [name, value] of Object.entries(noindex)) headers.set(name, value);
  return new Response(request.method === 'HEAD' ? null : shell.body, { status: kind === 'missing' ? 404 : 200, headers });
}
