import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { toolPackageContentCanonical } from '../src/tabletop/shared/tool-package.js';
import { verifyToolInstall } from './tool-install-verify.js';

/**
 * F080 / D-037: a room may only record a tool installation the definition actually supports.
 *
 * The digest here is computed independently of the Worker helper, so a change to either side of the
 * hash contract shows up as a failing test rather than as a room that quietly stores the wrong package.
 */

function definition(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    packageId: 'room-planner',
    version: 3,
    title: 'Room planner',
    description: 'see which rooms are free',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>rooms</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return { ok: true }; }\n' },
    ],
    ports: [{ id: 'rooms', label: 'rooms', direction: 'in', kind: 'records', fields: ['name'], maxRows: 10 }],
    behaviors: [{ id: 'allocate', label: 'allocate', entry: 'allocate', inputs: [], writes: [] }],
    imports: { react: '19.3.0' },
    runtimeProfile: 'tabletop-tool-1',
    provenance: { origin: 'ai', createdAt: 1_760_000_000_000 },
  };
}

function hashOf(value: Record<string, unknown>): string {
  return createHash('sha256').update(toolPackageContentCanonical(value as never)).digest('hex');
}

function envelope(payload: unknown, type = 'space.installTool'): unknown {
  return { commandId: '11111111-1111-4111-8111-111111111111', expectedRevision: 'r', expectedEpoch: 1, type, payload };
}

function install(overrides: Record<string, unknown> = {}): unknown {
  const base = definition();
  return envelope({
    tool: {
      packageId: base.packageId,
      version: base.version,
      contentHash: hashOf(base),
      route: 'ai',
      title: 'Room planner',
      definition: base,
      ...overrides,
    },
  });
}

describe('verifying an installed tool package', () => {
  it('accepts a definition that hashes to the reference', () => {
    expect(verifyToolInstall(install())).toBe('space.installTool');
  });

  it('leaves other commands alone', () => {
    expect(verifyToolInstall(envelope({ tool: { packageId: 'room-planner' } }, 'space.rename'))).toBeNull();
    expect(verifyToolInstall(null)).toBeNull();
    expect(verifyToolInstall({ type: 'space.installTool' })).toBe('space.installTool');
  });

  it('accepts a reference without a definition, which the client cannot render yet', () => {
    expect(verifyToolInstall(envelope({ tool: { packageId: 'room-planner', version: 3, contentHash: 'a'.repeat(64), route: 'ai', title: 'x' } })))
      .toBe('space.installTool');
  });

  it('refuses a hash that does not match the definition', () => {
    expect(() => verifyToolInstall(install({ contentHash: 'b'.repeat(64) })))
      .toThrow(/does not match the hash/u);
  });

  it('refuses a definition that names a different package or version', () => {
    expect(() => verifyToolInstall(install({ packageId: 'other-tool' }))).toThrow(/id and version/u);
    expect(() => verifyToolInstall(install({ version: 4 }))).toThrow(/id and version/u);
  });

  it('refuses a definition that is not a valid package', () => {
    expect(() => verifyToolInstall(install({ definition: { packageId: 'broken' } }))).toThrow(/does not validate/u);
  });
});
