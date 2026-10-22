// Browser-side helpers for page paths; parsing lives in shared/route-paths.

import { safeReturnPath } from './shared/route-paths';

export { parseRoute, routePath, safeReturnPath, type AppRoute } from './shared/route-paths';

const returnPathKey = 'tabletop.returnPath';

export function saveReturnPath(pathname: string): void {
  const path = safeReturnPath(pathname);
  try {
    if (path && path !== '/') window.sessionStorage.setItem(returnPathKey, path);
  } catch {
    // Without session storage the user lands on the home page after sign-in.
  }
}

export function takeReturnPath(): string | null {
  try {
    const stored = window.sessionStorage.getItem(returnPathKey);
    window.sessionStorage.removeItem(returnPathKey);
    return safeReturnPath(stored);
  } catch {
    return null;
  }
}
