import { describe, expect, it } from 'vitest';
import { parseRoute, routePath, safeReturnPath } from './routes';

const id = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('app routes', () => {
  it('maps each page path to a route and back', () => {
    expect(parseRoute('/')).toEqual({ name: 'home' });
    expect(parseRoute('/new')).toEqual({ name: 'new' });
    expect(parseRoute('/join/')).toEqual({ name: 'join' });
    expect(parseRoute(`/t/${id}`)).toEqual({ name: 'table', id });
    expect(parseRoute(`/t/${id}/`)).toEqual({ name: 'table', id });
    for (const path of ['/', '/new', '/join', `/t/${id}`]) expect(routePath(parseRoute(path)!)).toBe(path);
  });

  it('rejects paths the app does not own and malformed table ids', () => {
    for (const path of ['/demo', '/t/', '/t/not-a-uuid', `/t/${id.toUpperCase()}`, `/t/${id}/extra`, '/table/abc', '/api/session', '/t/0f8fad5b-d9cb-169f-a165-70867728950e']) {
      expect(parseRoute(path)).toBeNull();
    }
  });

  it('keeps sign-in return paths on this origin only', () => {
    expect(safeReturnPath(`/t/${id}`)).toBe(`/t/${id}`);
    expect(safeReturnPath('/new/')).toBe('/new');
    for (const value of [null, undefined, '', 'https://evil.example/t/x', '//evil.example', '/\\evil.example', `/t/${id}?next=//evil.example`, `/t/${id}#x`, '/demo', 'javascript:alert(1)']) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });
});
