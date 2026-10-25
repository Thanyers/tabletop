import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * F079 (option B): the Procedural surface is frozen outside the build.
 *
 * The Trio/accounting/Component-Lab code moved to `legacy/` and left the
 * `src/` graph: no entry selects it, nothing under `src/` imports it, and the
 * compiler, linter and unit runner no longer see it. These guards fail if the
 * surface creeps back into the product tree.
 */

const root = fileURLToPath(new URL('../../', import.meta.url));
const exists = (relativePath: string) => existsSync(`${root}${relativePath}`);

function sourceFiles(directory: string, out: string[] = []): string[] {
  for (const entry of readdirSync(`${root}${directory}`, { withFileTypes: true })) {
    const relative = `${directory}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(relative, out);
    else if (/\.(ts|tsx)$/u.test(entry.name)) out.push(relative);
  }
  return out;
}

describe('frozen Procedural surface', () => {
  it('keeps the legacy trees out of src/ and inside legacy/', () => {
    for (const moved of ['App.tsx', 'LegacyEntry.tsx', 'trio', 'components', 'state', 'domain', 'lab']) {
      expect(exists(`src/${moved}`), `src/${moved} must be frozen`).toBe(false);
      expect(exists(`legacy/${moved}`), `legacy/${moved} must exist`).toBe(true);
    }
  });

  it('no longer selects the legacy entry from the client boot', () => {
    const main = readFileSync(`${root}src/main.tsx`, 'utf8');
    expect(main).not.toContain('legacy-demo');
    expect(main).not.toContain('LegacyEntry');
    expect(main).toContain("import('./tabletop/TabletopApp')");
    expect(main).toContain("import('./tabletop/demo/InteractiveDemo')");
  });

  it('has no import from src/ into the frozen tree', () => {
    const offenders = sourceFiles('src').filter((file) => {
      const text = readFileSync(`${root}${file}`, 'utf8');
      return /from\s+'[^']*legacy\//u.test(text) || /import\(\s*'[^']*legacy\//u.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('is excluded from the product build, typecheck and lint config', () => {
    const tsconfig = readFileSync(`${root}tsconfig.json`, 'utf8');
    expect(JSON.parse(tsconfig).include).toEqual(['src']);
    const eslint = readFileSync(`${root}eslint.config.js`, 'utf8');
    expect(eslint).toContain("'legacy/'");
    const vite = readFileSync(`${root}vite.config.ts`, 'utf8');
    expect(vite).not.toContain('componentLabPlugin');
  });

  it('ships no component-lab middleware with the dev server', () => {
    expect(exists('scripts/component-lab/plugin.ts')).toBe(false);
    expect(exists('legacy/scripts/component-lab/plugin.ts')).toBe(true);
  });
});
