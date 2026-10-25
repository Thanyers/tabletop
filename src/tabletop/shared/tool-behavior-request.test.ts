import { describe, expect, it } from 'vitest';
import { TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION, type ToolPackageDefinition } from './tool-package';
import { buildToolBehaviorRequest, checkToolBehaviorFreshness } from './tool-behavior-request';

const HASH = 'c'.repeat(64);

function makePackage(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 3,
    title: 'Activity layout',
    description: 'Places rooms.',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return null; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return []; }\n' },
    ],
    ports: [
      { id: 'plan', label: 'Plan', direction: 'in', kind: 'records', fields: ['room'], maxRows: 10 },
      { id: 'budget', label: 'Budget', direction: 'in', kind: 'records', fields: ['price'], maxRows: 10 },
    ],
    behaviors: [
      {
        id: 'allocate',
        label: 'Allocate',
        entry: 'allocate',
        inputs: [
          { id: 'room', label: 'Room', kind: 'text', required: true },
          { id: 'seats', label: 'Seats', kind: 'number', required: false },
        ],
        writes: [{ target: 'plan', resource: 'placements', operations: ['create'], maxRows: 5 }],
      },
      {
        id: 'reprice',
        label: 'Reprice',
        entry: 'reprice',
        inputs: [],
        writes: [{ target: 'budget', resource: 'prices', operations: ['update'], maxRows: 2 }],
      },
    ],
    imports: { react: '19.3.0' },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'human', createdAt: 1 },
    ...overrides,
  };
}

const compiled = {
  behaviorModule: 'export function allocate(){ return []; }',
  behaviorExports: { allocate: 'allocate', reprice: 'reprice' },
  contentHash: HASH,
};

const resourceSchema = {
  placements: { fields: [{ id: 'room', type: 'text' as const }] },
  prices: { fields: [{ id: 'price', type: 'number' as const }] },
};

const expected = { instanceRevision: 4, grantVersion: 2 };

describe('behaviour request derives its scope from the package', () => {
  it('takes the write declarations from the requested behaviour, not from the caller', () => {
    const built = buildToolBehaviorRequest({ package: makePackage(), compiled, behaviorId: 'allocate', inputs: { room: 'ห้องประชุม' }, resourceSchema, expected });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.declaredWrites).toEqual([{ target: 'plan', resource: 'placements', operations: ['create'], maxRows: 5 }]);
    expect(built.request.entry).toBe('allocate');
    expect(built.request.packageVersion).toBe(3);
    expect(built.request.contentHash).toBe(HASH);
  });

  it('gives a different behaviour its own narrower scope', () => {
    const built = buildToolBehaviorRequest({ package: makePackage(), compiled, behaviorId: 'reprice', inputs: {}, resourceSchema, expected });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.declaredWrites).toEqual([{ target: 'budget', resource: 'prices', operations: ['update'], maxRows: 2 }]);
  });

  it('refuses a behaviour the package does not declare', () => {
    const built = buildToolBehaviorRequest({ package: makePackage(), compiled, behaviorId: 'delete-everything', inputs: {}, resourceSchema, expected });
    expect(built).toMatchObject({ ok: false, code: 'TOOL_UNKNOWN_BEHAVIOR' });
  });

  it('refuses when the package version was never compiled', () => {
    const built = buildToolBehaviorRequest({ package: makePackage(), compiled: { ...compiled, behaviorModule: undefined }, behaviorId: 'allocate', inputs: { room: 'x' }, resourceSchema, expected });
    expect(built).toMatchObject({ ok: false, code: 'TOOL_NOT_ACTIVATED' });
  });

  it('refuses a missing required input, a wrong type and an undeclared input', () => {
    const base = { package: makePackage(), compiled, behaviorId: 'allocate', resourceSchema, expected };
    expect(buildToolBehaviorRequest({ ...base, inputs: {} })).toMatchObject({ ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID' });
    expect(buildToolBehaviorRequest({ ...base, inputs: { room: 42 } })).toMatchObject({ ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID' });
    expect(buildToolBehaviorRequest({ ...base, inputs: { room: 'x', extra: 'sneaky' } })).toMatchObject({ ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID' });
    expect(buildToolBehaviorRequest({ ...base, inputs: { room: 'x', seats: Number.NaN } })).toMatchObject({ ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID' });
  });

  it('accepts an optional input and drops an absent one', () => {
    const built = buildToolBehaviorRequest({ package: makePackage(), compiled, behaviorId: 'allocate', inputs: { room: 'x', seats: 40 }, resourceSchema, expected });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.request.inputs).toEqual({ room: 'x', seats: 40 });
    const withoutOptional = buildToolBehaviorRequest({ package: makePackage(), compiled, behaviorId: 'allocate', inputs: { room: 'x' }, resourceSchema, expected });
    expect(withoutOptional.ok).toBe(true);
    if (!withoutOptional.ok) return;
    expect(withoutOptional.request.inputs).toEqual({ room: 'x' });
  });
});

describe('freshness refuses a decision the authority no longer holds', () => {
  const live = { instanceRevision: 4, grantVersion: 2, sources: [{ portId: 'plan', status: 'live' as const }, { portId: 'budget', status: 'live' as const }] };

  it('passes when every revision and source is unchanged', () => {
    expect(checkToolBehaviorFreshness({ expected }, live)).toEqual({ ok: true });
  });

  it('reports a moved instance revision as stale', () => {
    expect(checkToolBehaviorFreshness({ expected }, { ...live, instanceRevision: 5 })).toMatchObject({ ok: false, code: 'TOOL_STALE_REVISION' });
  });

  it('reports a moved grant version as stale', () => {
    expect(checkToolBehaviorFreshness({ expected }, { ...live, grantVersion: 3 })).toMatchObject({ ok: false, code: 'TOOL_STALE_REVISION' });
  });

  it('reports a revoked or missing source as revoked', () => {
    expect(checkToolBehaviorFreshness({ expected }, { ...live, sources: [{ portId: 'plan', status: 'revoked' }] })).toMatchObject({ ok: false, code: 'TOOL_SOURCE_REVOKED' });
    expect(checkToolBehaviorFreshness({ expected }, { ...live, sources: [{ portId: 'plan', status: 'missing' }] })).toMatchObject({ ok: false, code: 'TOOL_SOURCE_REVOKED' });
  });

  it('reports a stale source as a stale revision, not as success', () => {
    expect(checkToolBehaviorFreshness({ expected }, { ...live, sources: [{ portId: 'budget', status: 'stale' }] })).toMatchObject({ ok: false, code: 'TOOL_STALE_REVISION' });
  });
});
