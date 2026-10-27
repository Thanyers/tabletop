import { describe, expect, it } from 'vitest';
import { authorToolPackage } from './authoring';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../../shared/tool-package';

/**
 * F080 / PROV-01: activation evidence separates who asked, who wrote and who approved.
 *
 * The fixture must be a genuinely valid package, or every case is refused before the reviewer is
 * ever looked at (that mistake was made once already, so the first test asserts the package itself).
 */

function hash(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let acc = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    acc ^= text.charCodeAt(index);
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return acc.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
}

const trial = async (): Promise<{ ok: true }> => ({ ok: true });

function definition(origin: 'ai' | 'human'): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 1,
    title: 'plan',
    description: 'drag rooms onto zones',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>ok</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return []; }\n' },
    ],
    ports: [{ id: 'plan', label: 'plan', direction: 'in', kind: 'records', fields: ['room'], maxRows: 10 }],
    behaviors: [{
      id: 'allocate',
      label: 'allocate',
      entry: 'allocate',
      inputs: [],
      writes: [{ target: 'self', resource: 'placements', operations: ['create'], maxRows: 5 }],
    }],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin, createdAt: 1_760_000_000_000 },
  } as unknown as ToolPackageDefinition;
}

function author(reviewer: { kind: 'auto' | 'manual'; actorId?: string } = { kind: 'auto' }, origin: 'ai' | 'human' = 'human') {
  return authorToolPackage(
    { route: { kind: 'human', actorId: 'actor-editor', definition: definition(origin) }, reviewer },
    { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
  );
}

describe('activation evidence keeps the roles apart', () => {
  it('has a valid fixture, so a refusal later means the reviewer and not the package', async () => {
    const result = await author();
    expect(result.ok, JSON.stringify(result.record.problems)).toBe(true);
  });

  it('records the requester and a manual reviewer as two separate facts', async () => {
    const result = await author({ kind: 'manual', actorId: 'actor-reviewer' });
    expect(result.ok).toBe(true);
    expect(result.record.requesterActorId).toBe('actor-editor');
    expect(result.record.reviewer).toEqual({ kind: 'manual', actorId: 'actor-reviewer' });
    expect(result.record.generator).toEqual({ kind: 'human' });
  });

  it('never attributes an auto-apply to a person', async () => {
    const result = await author({ kind: 'auto' });
    expect(result.ok).toBe(true);
    expect(result.record.reviewer.kind).toBe('auto');
    expect(result.record.reviewer).not.toHaveProperty('actorId');
  });

  it('records a refusal with the same evidence, so a rejection is auditable', async () => {
    const result = await authorToolPackage(
      {
        route: { kind: 'human', actorId: 'actor-editor', definition: { ...definition('human'), title: '' } as unknown as ToolPackageDefinition },
        reviewer: { kind: 'manual', actorId: 'actor-reviewer' },
      },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('rejected');
    expect(result.record.reason).toBeTruthy();
    expect(result.record.requesterActorId).toBe('actor-editor');
    expect(result.record.reviewer).toEqual({ kind: 'manual', actorId: 'actor-reviewer' });
    expect(result.record.problems.length).toBeGreaterThan(0);
  });

  it('stamps every record with a time', async () => {
    const result = await author({ kind: 'auto' });
    expect(result.record.recordedAt).toBe(1_760_000_100_000);
  });
});
