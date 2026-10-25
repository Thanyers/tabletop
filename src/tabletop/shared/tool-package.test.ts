import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  TOOL_PACKAGE_LIMITS,
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  canonicalJson,
  readToolWorkspace,
  resolveToolImport,
  sameToolPackageRef,
  toolPackageContentHash,
  toolPackageRef,
  toolSourceImports,
  validateToolPackage,
  type ToolPackageDefinition,
  type ToolSourceFile,
} from './tool-package';

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

const uiFile = (text = 'export function Tool(){ return <div>Plan</div>; }\n'): ToolSourceFile => ({ path: 'ui/main.tsx', language: 'tsx', text });
const behaviorFile = (text = 'export function allocate(inputs){ return { rows: [] }; }\n'): ToolSourceFile => ({ path: 'behavior/run.ts', language: 'ts', text });

function makePackage(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 1,
    title: 'Activity layout',
    description: 'Drag rooms onto a floor plan and check the budget.',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [uiFile(), behaviorFile()],
    ports: [
      { id: 'plan', label: 'Plan', direction: 'in', kind: 'records', fields: ['room', 'area'], maxRows: 50 },
      { id: 'cost', label: 'Cost', direction: 'out', kind: 'number', fields: [], maxRows: 0 },
    ],
    behaviors: [
      { id: 'allocate', label: 'Allocate', entry: 'allocate', inputs: [{ id: 'room', label: 'Room', kind: 'text', required: true }], writes: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 20 }] },
    ],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react, 'react/jsx-runtime': TOOL_PACKAGE_PINNED_IMPORTS['react/jsx-runtime'] },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'ai', createdAt: 1_700_000_000_000 },
    ...overrides,
  };
}

function problemCodes(value: unknown): string[] {
  const result = validateToolPackage(value);
  return result.ok ? [] : result.problems.map(problem => problem.code);
}

describe('tool package validation', () => {
  it('accepts a valid package and returns the parsed definition', () => {
    const result = validateToolPackage(makePackage());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.package.packageId).toBe('activity-layout');
  });

  it('rejects an unknown field instead of silently storing it', () => {
    const codes = problemCodes({ ...makePackage(), shadowPolicy: 'ignore' });
    expect(codes).toContain('PACKAGE_SCHEMA');
  });

  it('rejects a records port with no declared fields, and a scalar port with fields', () => {
    const withoutFields = makePackage({
      ports: [{ id: 'plan', label: 'Plan', direction: 'in', kind: 'records', fields: [], maxRows: 10 }],
    });
    expect(problemCodes(withoutFields)).toContain('PACKAGE_SCHEMA');
    const scalarWithFields = makePackage({
      ports: [{ id: 'cost', label: 'Cost', direction: 'out', kind: 'number', fields: ['amount'], maxRows: 1 }],
    });
    expect(problemCodes(scalarWithFields)).toContain('PACKAGE_SCHEMA');
  });

  it('requires the UI entry to be a declared .tsx file', () => {
    expect(problemCodes(makePackage({ uiEntry: 'ui/missing.tsx' }))).toContain('PACKAGE_ENTRY');
    expect(problemCodes(makePackage({
      uiEntry: 'behavior/run.ts',
      files: [uiFile(), behaviorFile()],
    }))).toContain('PACKAGE_ENTRY');
  });

  it('rejects behaviours without a behaviour entry and an entry without behaviours', () => {
    expect(problemCodes(makePackage({ behaviorEntry: undefined }))).toContain('PACKAGE_BEHAVIOR');
    const noBehaviors = makePackage({ behaviors: [] });
    expect(problemCodes(noBehaviors)).toContain('PACKAGE_BEHAVIOR');
  });

  it('rejects an import the sandbox does not provide or pins at another version', () => {
    expect(problemCodes(makePackage({ imports: { ...makePackage().imports, lodash: '4.17.21' } }))).toContain('PACKAGE_IMPORT');
    expect(problemCodes(makePackage({ imports: { react: '18.2.0' } }))).toContain('PACKAGE_IMPORT');
  });

  it('rejects node:, url and absolute imports inside package source', () => {
    for (const specifier of ['node:fs', 'https://evil.example/x.js', '/etc/passwd']) {
      const text = `import x from '${specifier}';\nexport const y = x;\n`;
      const codes = problemCodes(makePackage({ files: [uiFile(text), behaviorFile()] }));
      expect(codes, specifier).toContain('PACKAGE_IMPORT');
    }
  });

  it('rejects a relative import that does not resolve to a package file', () => {
    const text = "import { helper } from './missing';\nexport const y = helper;\n";
    expect(problemCodes(makePackage({ files: [uiFile(text), behaviorFile()] }))).toContain('PACKAGE_IMPORT');
  });

  it('accepts a resolved relative import and rejects a cycle between package files', () => {
    const helper: ToolSourceFile = { path: 'ui/helper.ts', language: 'ts', text: 'export const helper = 1;\n' };
    const good = makePackage({ files: [uiFile("import { helper } from './helper';\nexport const y = helper;\n"), helper, behaviorFile()] });
    expect(validateToolPackage(good).ok).toBe(true);

    const a: ToolSourceFile = { path: 'ui/a.ts', language: 'ts', text: "import { b } from './b';\nexport const a = b;\n" };
    const b: ToolSourceFile = { path: 'ui/b.ts', language: 'ts', text: "import { a } from './a';\nexport const b = a;\n" };
    const cyclic = makePackage({ uiEntry: 'ui/a.ts', behaviorEntry: undefined, behaviors: [], files: [a, b] });
    expect(problemCodes(cyclic)).toContain('PACKAGE_CYCLE');
  });

  it('rejects an import chain deeper than the declared limit', () => {
    const files: ToolSourceFile[] = [];
    const depth = TOOL_PACKAGE_LIMITS.maxImportDepth + 2;
    for (let index = 0; index < depth; index += 1) {
      const next = index + 1;
      files.push({
        path: `ui/h${index}.ts`,
        language: 'ts',
        text: next < depth ? `import { v${next} } from './h${next}';\nexport const v${index} = v${next};\n` : `export const v${index} = 1;\n`,
      });
    }
    const packageWithDeepChain = makePackage({ uiEntry: 'ui/h0.ts', behaviorEntry: undefined, behaviors: [], files });
    expect(problemCodes(packageWithDeepChain)).toContain('PACKAGE_IMPORT');
  });

  it('rejects a write target that is not declared as a port', () => {
    const pkg = makePackage({
      behaviors: [{ id: 'allocate', label: 'Allocate', entry: 'allocate', inputs: [], writes: [{ target: 'budget', resource: 'rows', operations: ['update'], maxRows: 5 }] }],
    });
    expect(problemCodes(pkg)).toContain('PACKAGE_WRITE');
  });

  it('rejects duplicate file paths and a language that contradicts the extension', () => {
    const duplicate = makePackage({ files: [uiFile(), behaviorFile(), behaviorFile('export const x = 1;\n')] });
    expect(problemCodes(duplicate)).toContain('PACKAGE_FILE');
    const wrongLanguage = makePackage({ files: [{ path: 'ui/main.tsx', language: 'ts', text: 'export const a = 1;\n' }, behaviorFile()] });
    expect(problemCodes(wrongLanguage)).toContain('PACKAGE_FILE');
  });

  it('rejects source that exceeds the package character budget', () => {
    const big = 'x'.repeat(TOOL_PACKAGE_LIMITS.maxFileChars);
    const files: ToolSourceFile[] = Array.from({ length: 5 }, (_, index) => ({ path: `ui/f${index}.ts`, language: 'ts' as const, text: big }));
    const pkg = makePackage({ uiEntry: 'ui/f0.ts', behaviorEntry: undefined, behaviors: [], files });
    expect(problemCodes(pkg)).toContain('PACKAGE_BUDGET');
  });

  it('refuses to inspect a value that is nested too deeply', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let index = 0; index < 200; index += 1) deep = { nested: deep };
    expect(problemCodes({ ...makePackage(), imports: deep as unknown as Record<string, string> })).toContain('PACKAGE_BUDGET');
  });
});

describe('tool package hashing and references', () => {  it('hashes deterministically and ignores version and provenance', () => {
    const base = makePackage();
    const first = toolPackageContentHash(base, hash);
    const second = toolPackageContentHash({ ...base, version: 9, provenance: { origin: 'human', createdAt: 5 } }, hash);
    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('changes the hash when the source or a declared port changes', () => {
    const base = makePackage();
    const changedSource = toolPackageContentHash({ ...base, files: [uiFile('export function Tool(){ return <div>Other</div>; }\n'), behaviorFile()] }, hash);
    const changedPort = toolPackageContentHash({ ...base, ports: [...base.ports, { id: 'extra', label: 'Extra', direction: 'in' as const, kind: 'text' as const, fields: [], maxRows: 0 }] }, hash);
    expect(changedSource).not.toBe(toolPackageContentHash(base, hash));
    expect(changedPort).not.toBe(toolPackageContentHash(base, hash));
  });

  it('treats a reference as the same only when id, version and hash all match', () => {
    const ref = toolPackageRef(makePackage(), hash);
    expect(sameToolPackageRef(ref, { ...ref })).toBe(true);
    expect(sameToolPackageRef(ref, { ...ref, version: 2 })).toBe(false);
    expect(sameToolPackageRef(ref, { ...ref, contentHash: 'f'.repeat(64) })).toBe(false);
  });

  it('canonicalises object keys so equal values serialise identically', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 4, c: 3 }] })).toBe('{"a":[2,{"c":3,"d":4}],"b":1}');
  });
});

describe('tool source import parsing', () => {
  it('finds named, default, re-export and side-effect imports', () => {
    const text = [
      "import React from 'react';",
      "import { a } from './a';",
      "export { b } from './b';",
      "import './styles';",
      "const notAnImport = require('fs');",
    ].join('\n');
    const found = toolSourceImports(text);
    expect(found).toEqual([
      { specifier: 'react', kind: 'pinned' },
      { specifier: './a', kind: 'relative' },
      { specifier: './b', kind: 'relative' },
      { specifier: './styles', kind: 'relative' },
    ]);
  });

  it('resolves relative specifiers against declared files', () => {
    const files: ToolSourceFile[] = [
      { path: 'ui/main.tsx', language: 'tsx', text: '' },
      { path: 'ui/lib/helper.ts', language: 'ts', text: '' },
    ];
    expect(resolveToolImport('ui/main.tsx', './lib/helper', files)).toBe('ui/lib/helper.ts');
    expect(resolveToolImport('ui/lib/helper.ts', '../main', files)).toBe('ui/main.tsx');
    expect(resolveToolImport('ui/main.tsx', '../../outside', files)).toBeUndefined();
    expect(resolveToolImport('ui/main.tsx', './nope', files)).toBeUndefined();
  });
});

describe('tool workspace reader compatibility', () => {
  it('reads a workspace that never had tool state as empty', () => {
    expect(readToolWorkspace(undefined)).toEqual({ state: { schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION, packages: [], instances: [], connections: [] }, problems: [] });
  });

  it('drops unknown top-level keys but keeps the known collections', () => {
    const result = readToolWorkspace({ schemaVersion: 1, packages: [makePackage()], instances: [], connections: [], futureField: { a: 1 } });
    expect(result.problems).toEqual([]);
    expect(result.state.packages).toHaveLength(1);
    expect('futureField' in result.state).toBe(false);
  });

  it('refuses a newer schema version instead of guessing', () => {
    const result = readToolWorkspace({ schemaVersion: 2, packages: [] });
    expect(result.state.packages).toEqual([]);
    expect(result.problems.map(problem => problem.code)).toContain('PACKAGE_SCHEMA');
  });

  it('skips one unreadable entry and keeps the readable ones', () => {
    const result = readToolWorkspace({ schemaVersion: 1, packages: [makePackage(), { packageId: 'broken' }], instances: [], connections: [] });
    expect(result.state.packages).toHaveLength(1);
    expect(result.problems).toHaveLength(1);
    expect(result.problems[0]?.path).toBe('packages.1');
  });

  it('reports a non-array collection without discarding the rest', () => {
    const result = readToolWorkspace({ schemaVersion: 1, packages: {}, instances: [], connections: [] });
    expect(result.state.packages).toEqual([]);
    expect(result.problems[0]?.path).toBe('packages');
  });
});

describe('pinned import allowlist', () => {
  it('pins the react versions the app actually installs', () => {
    // Drift here would let the sandbox run a different React than the host ships, so the
    // allowlist is checked against the installed packages rather than trusted as a literal.
    const require = createRequire(import.meta.url);
    const react = (require('react/package.json') as { version: string }).version;
    const reactDom = (require('react-dom/package.json') as { version: string }).version;
    expect(TOOL_PACKAGE_PINNED_IMPORTS.react).toBe(react);
    expect(TOOL_PACKAGE_PINNED_IMPORTS['react/jsx-runtime']).toBe(react);
    expect(TOOL_PACKAGE_PINNED_IMPORTS['react-dom/client']).toBe(reactDom);
  });
});
