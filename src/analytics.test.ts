import { describe, expect, it } from 'vitest';
import { shouldLoadAnalytics } from './analytics';

const host = 'tabletop.ptchrr.workers.dev';

describe('shouldLoadAnalytics', () => {
  it('loads only on public pages of production when a token is set', () => {
    for (const pathname of ['/', '/demo', '/demo/', '/demo/replay']) expect(shouldLoadAnalytics({ hostname: host, pathname }, 'token')).toBe(true);
  });

  it('never loads on app pages, other hosts, or without a token', () => {
    for (const pathname of ['/tables', '/new', '/join', '/t/0f8fad5b-d9cb-469f-a165-70867728950e', '/asdf']) expect(shouldLoadAnalytics({ hostname: host, pathname }, 'token')).toBe(false);
    expect(shouldLoadAnalytics({ hostname: '127.0.0.1', pathname: '/' }, 'token')).toBe(false);
    expect(shouldLoadAnalytics({ hostname: 'tabletop-staging.ptchrr.workers.dev', pathname: '/' }, 'token')).toBe(false);
    expect(shouldLoadAnalytics({ hostname: host, pathname: '/' }, '')).toBe(false);
  });
});
