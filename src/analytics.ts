// F072: Cloudflare Web Analytics (cookieless, no consent banner needed).
// Only the public story pages of production load the beacon: signed-out `/` and the
// demos. Signed-in pages, table URLs (`/t/<id>`) and invite links never reach it.

/** Site token from Cloudflare dashboard → Web Analytics → tabletop.ptchrr.workers.dev. Empty keeps analytics off. */
export const CF_ANALYTICS_TOKEN = '';

const productionHost = 'tabletop.ptchrr.workers.dev';
const publicPaths = new Set(['/', '/demo', '/demo/replay']);
const beaconSrc = 'https://static.cloudflareinsights.com/beacon.min.js';

export function shouldLoadAnalytics(place: { hostname: string; pathname: string }, token = CF_ANALYTICS_TOKEN): boolean {
  const path = place.pathname.length > 1 && place.pathname.endsWith('/') ? place.pathname.slice(0, -1) : place.pathname;
  return token !== '' && place.hostname === productionHost && publicPaths.has(path);
}

/** Adds the beacon once. `spa: false` so later in-app navigation is never reported. */
export function loadAnalytics(): void {
  if (!shouldLoadAnalytics(window.location) || document.querySelector(`script[src="${beaconSrc}"]`)) return;
  const script = document.createElement('script');
  script.defer = true;
  script.src = beaconSrc;
  script.dataset.cfBeacon = JSON.stringify({ token: CF_ANALYTICS_TOKEN, spa: false });
  document.head.append(script);
}
