import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  PORTABLE_COPY_MAX_AGE_MS,
  PORTABLE_TOOL_SCHEMA_VERSION,
  PORTABLE_FORBIDDEN_KEYS,
  exportPortableTool,
  importPortableTool,
} from './tool-portable';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from './tool-package';

/**
 * F080 / JT-5: a tool moves between rooms as definitions, and access does not move with it.
 *
 * The synthetic markers below are the point of this file: a record value, a grant id and a member
 * name are planted in the "live" objects around the package, and the exported bundle must not
 * contain any of them.
 */

/** Bundles carry a retention window, so fixtures export at "now" rather than at epoch 0. */
const NOW = Date.now();

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function makePackage(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 2,
    title: 'ผังพื้นที่กิจกรรม',
    description: 'ลากห้องลงโซน',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>plan</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return []; }\n' },
    ],
    ports: [{ id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room', 'area'], maxRows: 10 }],
    behaviors: [{ id: 'allocate', label: 'จัดสรร', entry: 'allocate', inputs: [], writes: [{ target: 'self', resource: 'placements', operations: ['create'], maxRows: 5 }] }],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'ai', createdAt: 1 },
    ...overrides,
  };
}

describe('a bundle carries definitions and no access', () => {
  it('exports the package, its reference, the runtime profile and the mapping', () => {
    const result = exportPortableTool({ definition: makePackage(), hash, exportedAt: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.schemaVersion).toBe(PORTABLE_TOOL_SCHEMA_VERSION);
    expect(result.bundle.runtimeProfile).toBe(TOOL_PACKAGE_RUNTIME_PROFILE);
    expect(result.bundle.ref.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.bundle.mapping).toEqual([
      { portId: 'plan', packageField: 'room', localField: 'room' },
      { portId: 'plan', packageField: 'area', localField: 'area' },
    ]);
  });

  it('never carries live data, members or grants — even when they sit next to the package', () => {
    const packageWithNeighbours = {
      ...makePackage(),
      // A packed object could try to smuggle these; the bundle only copies known fields.
      records: { plan: [{ id: 'row-1', values: { room: 'MARKER_RECORD' } }] },
      spaceGrants: [{ grantId: 'MARKER_GRANT' }],
      members: [{ actorId: 'actor-1', name: 'MARKER_MEMBER' }],
    };
    const result = exportPortableTool({ definition: packageWithNeighbours, hash, exportedAt: NOW });
    // Extra keys are refused outright by the strict schema rather than silently copied.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PACKAGE_INVALID');

    const clean = exportPortableTool({ definition: makePackage(), hash, exportedAt: NOW });
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    const text = JSON.stringify(clean.bundle);
    for (const marker of ['MARKER_RECORD', 'MARKER_GRANT', 'MARKER_MEMBER']) expect(text).not.toContain(marker);
    // Check the key position, not the bare word: `"kind":"records"` is a port type, not data.
    for (const key of PORTABLE_FORBIDDEN_KEYS) expect(text).not.toContain(`"${key}":`);
  });

  it('refuses an invalid package instead of exporting something unusable', () => {
    const result = exportPortableTool({ definition: makePackage({ imports: { lodash: '1.0.0' } }), hash, exportedAt: 1 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('PACKAGE_INVALID');
  });

  it('records a local field mapping the receiving table can use', () => {
    const result = exportPortableTool({
      definition: makePackage(),
      hash,
      exportedAt: 1_000,
      localFields: { plan: { room: 'room-name', area: 'room-area' } },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.mapping).toEqual([
      { portId: 'plan', packageField: 'room', localField: 'room-name' },
      { portId: 'plan', packageField: 'area', localField: 'room-area' },
    ]);
  });
});

describe('import re-validates what it is given', () => {
  function bundle() {
    const result = exportPortableTool({ definition: makePackage(), hash, exportedAt: NOW });
    if (!result.ok) throw new Error('export failed');
    return result.bundle;
  }

  it('round-trips a bundle and keeps the content hash', () => {
    const original = bundle();
    const imported = importPortableTool(JSON.parse(JSON.stringify(original)), hash);
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.ref).toEqual(original.ref);
    expect(imported.definition.packageId).toBe('activity-layout');
    expect(imported.mapping).toHaveLength(2);
  });

  it('refuses a bundle whose source was edited after export', () => {
    const tampered = bundle();
    tampered.package = { ...tampered.package, files: [{ path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <b>changed</b>; }\n' }, tampered.package.files[1]!] };
    expect(importPortableTool(tampered, hash)).toMatchObject({ ok: false, code: 'BUNDLE_HASH_MISMATCH' });
  });

  it('refuses a newer bundle version instead of guessing', () => {
    expect(importPortableTool({ ...bundle(), schemaVersion: 99 }, hash)).toMatchObject({ ok: false, code: 'BUNDLE_VERSION' });
  });

  it('refuses a malformed mapping and a non-object bundle', () => {
    expect(importPortableTool({ ...bundle(), mapping: [{ portId: 'plan' }] }, hash)).toMatchObject({ ok: false, code: 'BUNDLE_SCHEMA' });
    expect(importPortableTool('not a bundle', hash)).toMatchObject({ ok: false, code: 'BUNDLE_SCHEMA' });
  });

  it('refuses a copy after its retention window', () => {
    const result = exportPortableTool({ definition: makePackage(), hash, exportedAt: 1_000, retentionMs: 60_000 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.expiresAt).toBe(61_000);
    expect(importPortableTool(result.bundle, hash, 60_999).ok).toBe(true);
    expect(importPortableTool(result.bundle, hash, 61_000)).toMatchObject({ ok: false, code: 'BUNDLE_EXPIRED' });
  });

  it('refuses a retention that is negative, zero or longer than the product allows', () => {
    for (const retentionMs of [-1, 0, PORTABLE_COPY_MAX_AGE_MS + 1]) {
      expect(exportPortableTool({ definition: makePackage(), hash, exportedAt: 1_000, retentionMs }), String(retentionMs))
        .toMatchObject({ ok: false, code: 'RETENTION_OUT_OF_RANGE' });
    }
  });

  it('defaults to the longest window the product allows', () => {
    const result = exportPortableTool({ definition: makePackage(), hash, exportedAt: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bundle.expiresAt).toBe(NOW + PORTABLE_COPY_MAX_AGE_MS);
  });

  it('applies the mapping against a different table schema when used with new data', () => {
    const exported = exportPortableTool({
      definition: makePackage(),
      hash,
      exportedAt: 1_000,
      localFields: { plan: { room: 'room-name', area: 'room-area' } },
    });
    if (!exported.ok) throw new Error('export failed');
    const mapping = exported.bundle.mapping;
    const localFieldFor = (packageField: string): string | undefined => mapping.find(entry => entry.packageField === packageField)?.localField;
    // The receiving table names the same concepts differently; the mapping is what bridges them.
    const incoming = { 'room-name': 'ห้องโถง', 'room-area': 48 };
    expect(localFieldFor('room')).toBeDefined();
    const adapted = Object.fromEntries(mapping.map(entry => [entry.packageField, incoming[entry.localField as keyof typeof incoming]]));
    expect(adapted).toEqual({ room: 'ห้องโถง', area: 48 });
  });
});
