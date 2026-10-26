import { describe, expect, it } from 'vitest';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  toolPackageContentHash,
  type ToolPackageDefinition,
} from './tool-package';

/**
 * F080 / ORACLE-01 (UI source and version surface): the content hash must actually describe the
 * source it claims to describe.
 *
 * This is a completeness check rather than an independent recomputation: edit one file's text and the
 * hash must change; put it back and the hash must return. A hash that ignored the UI source, or that
 * drifted between runs, fails here even though every single-run test would still pass.
 */

const hash = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let acc = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    acc ^= text.charCodeAt(index);
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return acc.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
};

function definition(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 3,
    title: 'plan',
    description: 'drag rooms onto zones',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>a</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function go(){ return []; }\n' },
    ],
    ports: [{ id: 'plan', label: 'plan', direction: 'in', kind: 'records', fields: ['room'], maxRows: 10 }],
    behaviors: [{ id: 'go', label: 'go', entry: 'go', inputs: [], writes: [{ target: 'self', resource: 'x', operations: ['create'], maxRows: 5 }] }],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'human', createdAt: 1 },
    ...overrides,
  } as unknown as ToolPackageDefinition;
}

describe('the content hash describes the UI source, not just the shape', () => {
  it('changes when the UI file changes and returns when it is reverted', () => {
    const original = definition();
    const before = toolPackageContentHash(original, hash);

    const edited = definition({
      files: [
        { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>b</p>; }\n' },
        { path: 'behavior/run.ts', language: 'ts', text: 'export function go(){ return []; }\n' },
      ],
    });
    const afterEdit = toolPackageContentHash(edited, hash);
    expect(afterEdit).not.toBe(before);

    // Reverting the text restores the hash exactly: the hash is a function of content only.
    expect(toolPackageContentHash(definition(), hash)).toBe(before);
  });

  it('changes when the server behaviour changes', () => {
    const behaviourEdited = definition({
      files: [
        { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>a</p>; }\n' },
        { path: 'behavior/run.ts', language: 'ts', text: 'export function go(){ return [{ target: "self" }]; }\n' },
      ],
    });
    expect(toolPackageContentHash(behaviourEdited, hash)).not.toBe(toolPackageContentHash(definition(), hash));
  });

  it('does not change when only the version number changes, so content and label stay separable', () => {
    const bumped = definition({ version: 4 });
    expect(toolPackageContentHash(bumped, hash)).toBe(toolPackageContentHash(definition(), hash));
  });
});
