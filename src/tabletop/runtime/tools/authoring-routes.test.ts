import { describe, expect, it } from 'vitest';
import { authorToolPackage } from './authoring';
import {
  TOOL_PACKAGE_PINNED_IMPORTS,
  TOOL_PACKAGE_RUNTIME_PROFILE,
  TOOL_PACKAGE_SCHEMA_VERSION,
  type ToolPackageDefinition,
} from '../../shared/tool-package';

/**
 * F080 / G1-02: an AI-written source and a hand-written source take the same pipeline.
 *
 * Both routes run validation, compile, the isolated trial and the activation record; only the origin
 * of the definition differs. The AI route additionally fails closed without a budget, which is the
 * guard the owner approved.
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

function definition(): ToolPackageDefinition {
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
    provenance: { origin: 'human', createdAt: 1_760_000_000_000 },
  } as unknown as ToolPackageDefinition;
}

const budget = { maxCalls: 6, maxUsd: 0.2, usedCalls: 0, usedUsd: 0 };

describe('one pipeline, two origins', () => {
  it('activates a hand-written package and records a human generator', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition: definition() }, reviewer: { kind: 'manual', actorId: 'actor-reviewer' } },
      { trial, hash, now: 1_000, maxRepairAttempts: 1 },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.generator).toEqual({ kind: 'human' });
    expect(result.record.status).toBe('activated');
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('activates an AI-written package through the same steps and records the generator usage', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-editor', prompt: 'a room planner' }, reviewer: { kind: 'manual', actorId: 'actor-reviewer' }, budget },
      {
        trial,
        hash,
        now: 2_000,
        maxRepairAttempts: 1,
        generator: {
          id: 'fake-generator',
          estimate: () => ({ calls: 1, usd: 0.01 }),
          generate: async () => ({ definition: definition(), usage: { calls: 1, usd: 0.01 } }),
        } as never,
      },
    );
    expect(result.ok, JSON.stringify(result.record.problems)).toBe(true);
    if (!result.ok) return;
    expect(result.record.status).toBe('activated');
    expect(result.record.generator).toMatchObject({ kind: 'ai', generatorId: 'fake-generator', calls: 1 });
    // The same compiled artefacts come out as the human route.
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(Object.keys(result.compiled.modules).length).toBeGreaterThan(0);
  });

  it('refuses the AI route without a budget, before any generator call', async () => {
    let called = false;
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-editor', prompt: 'a room planner' }, reviewer: { kind: 'auto' } },
      {
        trial,
        hash,
        now: 3_000,
        maxRepairAttempts: 1,
        generator: {
          id: 'fake-generator',
          estimate: () => ({ calls: 1, usd: 0.01 }),
          generate: async () => { called = true; return { definition: definition(), usage: { calls: 1, usd: 0.01 } }; },
        } as never,
      },
    );
    expect(result.ok).toBe(false);
    expect(result.record.reason).toBe('TOOL_AI_BUDGET_REQUIRED');
    expect(called).toBe(false);
  });
});
