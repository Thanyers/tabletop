// Page paths for the signed-in app. A table id in the URL is only an address:
// the server still authorizes membership on every request. Pure, so the Worker
// (F051) and the browser classify paths the same way.

export type AppRoute =
  | { name: 'home' }
  | { name: 'new' }
  | { name: 'join' }
  | { name: 'table'; id: string };

const tableId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** Returns null for any path the app does not own, so callers fall back to home. */
export function parseRoute(pathname: string): AppRoute | null {
  const path = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
  if (path === '/' || path === '') return { name: 'home' };
  if (path === '/new') return { name: 'new' };
  if (path === '/join') return { name: 'join' };
  const match = /^\/t\/([^/]+)$/u.exec(path);
  if (match && tableId.test(match[1])) return { name: 'table', id: match[1] };
  return null;
}

export function routePath(route: AppRoute): string {
  return route.name === 'table' ? `/t/${route.id}` : route.name === 'home' ? '/' : `/${route.name}`;
}

/**
 * Accepts only an internal path this app recognises. Anything with a scheme,
 * host, protocol-relative prefix, query or fragment is rejected, so a stored
 * value can never send the browser to another origin after sign-in.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[?#\\]/u.test(value)) return null;
  const route = parseRoute(value);
  return route ? routePath(route) : null;
}
