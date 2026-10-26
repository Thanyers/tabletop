import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { compileToolPackage } from '../runtime/tools/compile';
import { validateToolPackage } from '../shared/tool-package';
import { HELD_OUT_LEARNING, HELD_OUT_MARKERS, HELD_OUT_PLAY } from './heldout-tools';

/**
 * F080 / JT-5: the host accepts packages it was not written for.
 *
 * Two properties are checked here. The learning and play packages must go through the same
 * validation and compile steps as any other package. And the host code must not mention them: a
 * package that only works because the host learned its name is not a general host, and that is the
 * gap this feature exists to close.
 */

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

const HOST_FILES = [
  'src/tabletop/ui/GeneratedToolHost.tsx',
  'src/tabletop/ui/tool-sandbox/bootstrap.ts',
  'src/tabletop/ui/tool-sandbox/document.ts',
  'src/tabletop/ui/tool-sandbox/sdk.ts',
  'src/tabletop/ui/tool-sandbox/runtime-entry.ts',
  'src/tabletop/runtime/tools/compile.ts',
  'src/tabletop/runtime/tools/authoring.ts',
  'src/tabletop/runtime/tools/behavior-entry.ts',
];

describe('held-out packages run on the same host', () => {
  it.each([
    ['learning', HELD_OUT_LEARNING],
    ['play', HELD_OUT_PLAY],
  ])('validates and compiles the %s package', (_label, definition) => {
    const validation = validateToolPackage(definition);
    expect(validation.ok).toBe(true);
    const compiled = compileToolPackage(definition, hash);
    expect(compiled.ok).toBe(true);
    if (!compiled.ok) return;
    expect(compiled.compiled.modules[definition.uiEntry]).toBeDefined();
    expect(compiled.compiled.behaviorModule).toContain('export function');
    expect(compiled.compiled.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('uses two genuinely different shapes, not the built-in canvas kinds', () => {
    expect(HELD_OUT_LEARNING.behaviors[0]?.id).toBe('submit');
    expect(HELD_OUT_PLAY.behaviors[0]?.id).toBe('advance');
    expect(HELD_OUT_LEARNING.ports.map(port => port.id)).toEqual(['questions']);
    expect(HELD_OUT_PLAY.ports.map(port => port.id)).toEqual(['boats']);
  });

  it('does not need a host file to mention either package', () => {
    const offenders: string[] = [];
    for (const path of HOST_FILES) {
      const text = readFileSync(path, 'utf8').toLowerCase();
      for (const marker of HELD_OUT_MARKERS) {
        if (text.includes(marker)) offenders.push(`${path} mentions "${marker}"`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the host general: no per-use-case branch in the sandbox or the compiler', () => {
    for (const path of HOST_FILES) {
      const text = readFileSync(path, 'utf8');
      // A scenario switch would look like an if/switch on a package id or a use-case name.
      expect(/switch\s*\(\s*(?:definition|package)?\.?(?:packageId|title)\s*\)/u.test(text), path).toBe(false);
    }
  });
});
