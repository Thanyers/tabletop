import { describe, expect, it } from 'vitest';
import { buildToolInstallInput, readToolPackageJson, toolPackageHashHex } from './tool-install-input';
import { TOOL_PACKAGE_PINNED_IMPORTS, TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION } from '../shared/tool-package';

/**
 * F080 / D-051: nothing is installed unless the pasted package validates and its hash is derived from
 * the package itself, because the Worker refuses anything else.
 */

const valid = {
  schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
  packageId: 'room-planner',
  version: 3,
  title: 'Room planner',
  description: 'see which rooms are free',
  uiEntry: 'ui/main.tsx',
  behaviorEntry: 'behavior/run.ts',
  files: [
    { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return null; }\n' },
    { path: 'behavior/run.ts', language: 'ts', text: 'export function reserve(){ return []; }\n' },
  ],
  ports: [{ id: 'rooms', label: 'rooms', direction: 'in', kind: 'records', fields: ['name'], maxRows: 10 }],
  behaviors: [{ id: 'reserve', label: 'reserve', entry: 'reserve', inputs: [], writes: [], actions: [] }],
  imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  provenance: { origin: 'ai', createdAt: 1_760_000_000_000 },
};

describe('reading the package a person pastes', () => {
  it('accepts a valid package and keeps its id, version and origin', async () => {
    const built = await buildToolInstallInput(JSON.stringify(valid));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.tool).toMatchObject({ packageId: 'room-planner', version: 3, route: 'ai', title: 'Room planner' });
    expect(built.tool.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(built.tool.definition.packageId).toBe('room-planner');
  });

  it('marks a package a person wrote as the human route', async () => {
    const built = await buildToolInstallInput(JSON.stringify({ ...valid, provenance: { origin: 'human', createdAt: 1 } }));
    expect(built.ok && built.tool.route).toBe('human');
  });

  it('refuses empty text, broken JSON and a package that fails validation, with the reason', () => {
    expect(readToolPackageJson('')).toMatchObject({ ok: false });
    expect(readToolPackageJson('{ not json')).toMatchObject({ ok: false, problem: 'ข้อความนี้ไม่ใช่ JSON ที่อ่านได้' });
    const invalid = readToolPackageJson(JSON.stringify({ ...valid, packageId: 'BAD' }));
    expect(invalid.ok).toBe(false);
    if (invalid.ok) return;
    expect(invalid.problem).toContain('package ไม่ผ่านการตรวจ');
  });

  it('derives the same hash for the same package, and a different one when the source changes', async () => {
    const first = await toolPackageHashHex(valid as never);
    const again = await toolPackageHashHex(JSON.parse(JSON.stringify(valid)) as never);
    expect(again).toBe(first);
    const edited = { ...valid, files: [{ ...valid.files[0], text: 'export function Tool(){ return null; } // edited\n' }, valid.files[1]] };
    expect(await toolPackageHashHex(edited as never)).not.toBe(first);
  });

  it('ignores provenance when hashing, so re-installing the same source keeps the same address', async () => {
    const a = await toolPackageHashHex(valid as never);
    const b = await toolPackageHashHex({ ...valid, provenance: { origin: 'human', createdAt: 42 } } as never);
    expect(b).toBe(a);
  });
});
