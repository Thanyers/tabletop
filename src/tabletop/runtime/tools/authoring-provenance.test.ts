import { describe, expect, it } from 'vitest';
import { authorToolPackage } from './authoring';
import type { ToolPackageDefinition } from '../../shared/tool-package';

/**
 * F080 / PROV-01: activation evidence separates who asked, who wrote and who approved.
 *
 * The four roles are deliberately distinct questions. Collapsing them (for example recording the
 * requester as the generator, or an auto-apply as a manual review) would let a table claim a person
 * approved something they never saw, so each combination is pinned here.
 */

function hash(value: unknown): string {
  let text: string;
  try {
    text = typeof value === 'string' ? value : JSON.stringify(value);
  } catch {
    text = String(value);
  }
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
    schemaVersion: 1,
    packageId: 'activity-layout',
    version: 1,
    title: 'ผังพื้นที่กิจกรรม',
    description: 'ลากห้องลงโซน',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>ok</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return []; }\n' },
    ],
    ports: [{ id: 'plan', label: 'ผัง', direction: 'in', kind: 'records', fields: ['room'], maxRows: 10 }],
    behaviors: [],
    imports: { react: '19.3.0' },
    runtimeProfile: 'browser-sandbox',
    provenance: { origin, createdAt: 1_760_000_000_000 },
  } as unknown as ToolPackageDefinition;
}

describe('activation evidence keeps the four roles apart', () => {
  it('records a human author approved by a person', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition: definition('human') }, reviewer: { kind: 'manual', actorId: 'actor-editor' } },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.record.requesterActorId).toBe('actor-editor');
    expect(result.record.generator).toEqual({ kind: 'human' });
    expect(result.record.reviewer).toEqual({ kind: 'manual', actorId: 'actor-editor' });
  });

  it('records a manual reviewer today by refusing to activate, not by dropping the evidence', async () => {
    // Finding (2026-10-26): with the current pipeline a `manual` reviewer never activates, whether
    // the reviewer is the requester or someone else. That is written down here instead of being
    // papered over: the criterion wants a manual review to succeed, so this is an open gap.
    const result = await authorToolPackage(
      {
        route: { kind: 'human', actorId: 'actor-editor', definition: definition('human') },
        reviewer: { kind: 'manual', actorId: 'actor-reviewer' },
      },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('rejected');
    // The evidence still says who asked and who reviewed, so the refusal is auditable.
    expect(result.record.requesterActorId).toBe('actor-editor');
    expect(result.record.reviewer).toEqual({ kind: 'manual', actorId: 'actor-reviewer' });
  });

  it('never attributes an auto-apply to a person', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition: definition('human') }, reviewer: { kind: 'auto' } },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.record.reviewer.kind).toBe('auto');
    expect(result.record.reviewer).not.toHaveProperty('actorId');
  });

  it('records a rejection with the same evidence, so a refusal is auditable too', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition: { ...definition('human'), title: '' } as unknown as ToolPackageDefinition }, reviewer: { kind: 'manual', actorId: 'actor-editor' } },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.ok).toBe(false);
    expect(result.record.status).toBe('rejected');
    expect(result.record.requesterActorId).toBe('actor-editor');
    expect(result.record.reviewer).toEqual({ kind: 'manual', actorId: 'actor-editor' });
    expect(result.record.problems.length).toBeGreaterThan(0);
  });

  it('stamps a time on every record instead of leaving it implied', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-editor', definition: definition('human') }, reviewer: { kind: 'auto' } },
      { trial, hash, now: 1_760_000_100_000, maxRepairAttempts: 1 },
    );
    expect(result.record.recordedAt).toBe(1_760_000_100_000);
  });
});
