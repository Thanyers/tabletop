import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * F079 regression: the client boot used to choose between three dynamic imports
 * inside one `React.lazy(() => { … })`. Rollup then attached a single preload
 * dependency list to that call, and after the legacy branch was removed the list
 * described the last import (TabletopApp), so `/demo` loaded its JS without
 * `InteractiveDemo.css` — the practice canvas collapsed and the footer covered
 * the cards. One `lazy(() => import(…))` per route keeps each chunk's CSS with it.
 */

const main = readFileSync(fileURLToPath(new URL('../main.tsx', import.meta.url)), 'utf8');

describe('client entry', () => {
  it('wraps exactly one dynamic import per route', () => {
    expect(main).not.toContain('lazy(() => {');
    expect(main.match(/lazy\(\(\) => import\('[^']+'\)\)/gu) ?? []).toHaveLength(3);
  });

  it('keeps the public routes and their chunks', () => {
    for (const route of ['/demo', '/demo/replay']) expect(main).toContain(route);
    expect(main).toContain("import('./tabletop/demo/InteractiveDemo')");
    expect(main).toContain("import('./tabletop/demo/PublicDemo')");
    expect(main).toContain("import('./tabletop/TabletopApp')");
    expect(main).not.toContain('LegacyEntry');
  });
});
