import { describe, expect, it } from 'vitest';
import { parseRoute, routePath, safeReturnPath } from './route-paths';

/**
 * F080 / JT-V: the room screen needs an address of its own.
 *
 * A space id is a workspace id, so it gets the same UUID shape and the same rule as a table path:
 * the URL is only an address, and the server still authorizes membership on every request.
 */

const ID = '11111111-1111-4111-8111-111111111111';

describe('a room has its own path', () => {
  it('parses and rebuilds the room path', () => {
    expect(parseRoute(`/s/${ID}`)).toEqual({ name: 'space', id: ID });
    expect(routePath({ name: 'space', id: ID })).toBe(`/s/${ID}`);
  });

  it('still parses the paths that already existed', () => {
    expect(parseRoute('/tables')).toEqual({ name: 'tables' });
    expect(parseRoute(`/t/${ID}`)).toEqual({ name: 'table', id: ID });
    expect(parseRoute('/')).toEqual({ name: 'landing' });
  });

  it('refuses a room path with a non-uuid, a suffix or a traversal', () => {
    expect(parseRoute('/s/not-a-uuid')).toBeNull();
    expect(parseRoute(`/s/${ID}/extra`)).toBeNull();
    expect(parseRoute(`/s/${ID}..`)).toBeNull();
  });

  it('accepts the room path as a return path after sign-in, and nothing outside the app', () => {
    expect(safeReturnPath(`/s/${ID}`)).toBe(`/s/${ID}`);
    expect(safeReturnPath('https://example.test/s/1')).toBeNull();
    expect(safeReturnPath(`/s/${ID}?x=1`)).toBeNull();
  });
});
