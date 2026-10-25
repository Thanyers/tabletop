import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { TOOL_PACKAGE_PINNED_IMPORTS, TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION, type ToolPackageDefinition, type ToolSourceFile } from '../../shared/tool-package';
import { TOOL_COMPILE_LIMITS, compileToolPackage } from './compile';

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

const UI_TSX = `import { useState } from 'react';
type Props = { label: string };
export function Tool(props: Props) {
  const [count, setCount] = useState<number>(0);
  return <button onClick={() => setCount(count + 1)}>{props.label}: {count}</button>;
}
`;

const BEHAVIOR_TS = `type Input = { room: string };
export function allocate(inputs: Input) {
  return { changes: [{ target: 'self', resource: 'allocations', operation: 'create', values: { room: inputs.room } }] };
}
`;

function makePackage(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  const files: ToolSourceFile[] = [
    { path: 'ui/main.tsx', language: 'tsx', text: UI_TSX },
    { path: 'behavior/run.ts', language: 'ts', text: BEHAVIOR_TS },
  ];
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 1,
    title: 'Activity layout',
    description: 'Drag rooms onto a floor plan.',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files,
    ports: [],
    behaviors: [{ id: 'allocate', label: 'Allocate', entry: 'allocate', inputs: [], writes: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 20 }] }],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'human', createdAt: 1 },
    ...overrides,
  };
}

describe('compile tool package', () => {
  it('compiles the UI entry to a module the frame registry can load', () => {
    const result = compileToolPackage(makePackage(), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const ui = result.compiled.modules['ui/main.tsx'];
    expect(ui).toBeDefined();
    // The automatic JSX runtime and the named React import both become requires.
    expect(ui).toContain('require("react/jsx-runtime")');
    expect(ui).toContain("require('react')");
    expect(ui).not.toContain('type Props');
    expect(ui).not.toContain('<button');
    expect(result.compiled.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('keeps the behaviour module as ESM for the isolate', () => {
    const result = compileToolPackage(makePackage(), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.behaviorModule).toContain('export function allocate');
    expect(result.compiled.behaviorModule).not.toContain('require(');
    expect(result.compiled.behaviorExports).toEqual({ allocate: 'allocate' });
  });

  it('omits the behaviour module for a UI-only package', () => {
    const uiOnly = makePackage({ behaviorEntry: undefined, behaviors: [], files: [{ path: 'ui/main.tsx', language: 'tsx', text: UI_TSX }] });
    const result = compileToolPackage(uiOnly, hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.behaviorModule).toBeUndefined();
    expect(result.compiled.behaviorExports).toEqual({});
  });

  it('refuses to compile a package that failed validation and never runs the compiler', () => {
    const invalid = makePackage({ imports: { react: '18.2.0' } });
    const result = compileToolPackage(invalid, hash);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.code).toBe('TOOL_COMPILE_SOURCE');
  });

  it('refuses a behaviour module that imports a relative file', () => {
    const files: ToolSourceFile[] = [
      { path: 'ui/main.tsx', language: 'tsx', text: UI_TSX },
      { path: 'behavior/run.ts', language: 'ts', text: "import { helper } from './helper';\nexport function allocate() { return { changes: [] }; }\n" },
      { path: 'behavior/helper.ts', language: 'ts', text: 'export const helper = 1;\n' },
    ];
    const result = compileToolPackage(makePackage({ files }), hash);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems.map(problem => problem.message).join(' ')).toContain('self-contained');
  });

  it('reports a syntax error against the file that contains it', () => {
    const files: ToolSourceFile[] = [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool() { return <div>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: BEHAVIOR_TS },
    ];
    const result = compileToolPackage(makePackage({ files }), hash);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problems[0]?.code).toBe('TOOL_COMPILE_FAILED');
    expect(result.problems[0]?.path).toBe('ui/main.tsx');
    expect(result.problems[0]?.message.length).toBeGreaterThan(0);
  });

  it('does not ship files the UI entry cannot reach', () => {
    const files: ToolSourceFile[] = [
      { path: 'ui/main.tsx', language: 'tsx', text: UI_TSX },
      { path: 'ui/unused.tsx', language: 'tsx', text: 'export function Unused() { return <i />; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: BEHAVIOR_TS },
    ];
    const result = compileToolPackage(makePackage({ files }), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.compiled.modules['ui/unused.tsx']).toBeUndefined();
  });

  it('includes a file the UI entry reaches through a relative import', () => {
    const files: ToolSourceFile[] = [
      { path: 'ui/main.tsx', language: 'tsx', text: "import { helper } from './lib/helper';\nexport function Tool() { return <b>{helper()}</b>; }\n" },
      { path: 'ui/lib/helper.ts', language: 'ts', text: 'export function helper() { return 1; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: BEHAVIOR_TS },
    ];
    const result = compileToolPackage(makePackage({ files }), hash);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.compiled.modules)).toEqual(['ui/main.tsx', 'ui/lib/helper.ts']);
    expect(result.compiled.modules['ui/main.tsx']).toContain("require('./lib/helper')");
  });

  it('declares a bounded compile budget', () => {
    expect(TOOL_COMPILE_LIMITS.maxModuleChars).toBeLessThanOrEqual(TOOL_COMPILE_LIMITS.maxTotalChars);
  });
});
