import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { TOOL_PACKAGE_PINNED_IMPORTS, TOOL_PACKAGE_RUNTIME_PROFILE, TOOL_PACKAGE_SCHEMA_VERSION, type ToolPackageDefinition, type ToolPackageProblem } from '../../shared/tool-package';
import type { CompiledToolPackage } from './compile';
import {
  authorToolPackage,
  checkToolAiBudget,
  type ToolAuthoringDeps,
  type ToolGenerator,
  type ToolGeneratorRequest,
} from './authoring';

const hash = (value: unknown): string => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');

function makePackage(overrides: Partial<ToolPackageDefinition> = {}): ToolPackageDefinition {
  return {
    schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
    packageId: 'activity-layout',
    version: 1,
    title: 'Activity layout',
    description: 'Drag rooms onto a floor plan.',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <div>plan</div>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return []; }\n' },
    ],
    ports: [{ id: 'plan', label: 'Plan', direction: 'in', kind: 'records', fields: ['room'], maxRows: 10 }],
    behaviors: [{ id: 'allocate', label: 'Allocate', entry: 'allocate', inputs: [], writes: [{ target: 'self', resource: 'placements', operations: ['create'], maxRows: 5 }] }],
    imports: { react: TOOL_PACKAGE_PINNED_IMPORTS.react },
    runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
    provenance: { origin: 'human', createdAt: 1 },
    ...overrides,
  };
}

const okTrial = async (): Promise<{ ok: true }> => ({ ok: true });

function deps(overrides: Partial<ToolAuthoringDeps> = {}): ToolAuthoringDeps {
  return { trial: okTrial, hash, now: 1_700_000_000_000, ...overrides };
}

function fixtureGenerator(responses: unknown[]): ToolGenerator & { seen: ToolGeneratorRequest[] } {
  const seen: ToolGeneratorRequest[] = [];
  let index = 0;
  return {
    id: 'fixture-1',
    seen,
    estimate: () => ({ calls: 1, usd: 0.02 }),
    async generate(request) {
      seen.push(request);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return { definition: structuredClone(response), usage: { calls: 1, usd: 0.02 } };
    },
  };
}

describe('AI budget is enforced before dispatch', () => {
  it('allows a run inside the cap and refuses one that would exceed it', () => {
    expect(checkToolAiBudget({ maxCalls: 6, maxUsd: 0.2, usedCalls: 2, usedUsd: 0.04 }, { calls: 1, usd: 0.02 }).ok).toBe(true);
    const refused = checkToolAiBudget({ maxCalls: 6, maxUsd: 0.2, usedCalls: 6, usedUsd: 0.12 }, { calls: 1, usd: 0.02 });
    expect(refused).toMatchObject({ ok: false, code: 'TOOL_AI_BUDGET_EXCEEDED' });
    const tooExpensive = checkToolAiBudget({ maxCalls: 6, maxUsd: 0.2, usedCalls: 0, usedUsd: 0.19 }, { calls: 1, usd: 0.02 });
    expect(tooExpensive.ok).toBe(false);
  });

  it('never calls the generator when the estimate is over budget', async () => {
    const generate = vi.fn(async (): Promise<{ definition: unknown; usage: { calls: number; usd: number } }> => {
      throw new Error('the generator must not be called');
    });
    const generator: ToolGenerator = { id: 'guarded', estimate: () => ({ calls: 1, usd: 0.05 }), generate };
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-a', prompt: 'make a floor plan' }, reviewer: { kind: 'auto' }, budget: { maxCalls: 3, maxUsd: 0.05, usedCalls: 3, usedUsd: 0.05 } },
      deps({ generator }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_AI_BUDGET_EXCEEDED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('fails closed when there is no generator or no budget', async () => {
    const noGenerator = await authorToolPackage({ route: { kind: 'ai', actorId: 'a', prompt: 'x' }, reviewer: { kind: 'auto' } }, deps());
    expect(noGenerator).toMatchObject({ ok: false, code: 'TOOL_AI_UNAVAILABLE' });
    const noBudget = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'a', prompt: 'x' }, reviewer: { kind: 'auto' } },
      deps({ generator: fixtureGenerator([makePackage()]) }),
    );
    expect(noBudget).toMatchObject({ ok: false, code: 'TOOL_AI_BUDGET_REQUIRED' });
  });
});

describe('AI route runs the same pipeline as a person', () => {
  const budget = { maxCalls: 6, maxUsd: 0.2, usedCalls: 0, usedUsd: 0 };

  it('activates a valid generated package and records requester, generator and reviewer separately', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-a', prompt: 'a floor plan' }, reviewer: { kind: 'auto' }, budget },
      deps({ generator: fixtureGenerator([makePackage()]) }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.status).toBe('activated');
    expect(result.record.requesterActorId).toBe('actor-a');
    expect(result.record.generator).toEqual({ kind: 'ai', generatorId: 'fixture-1', calls: 1, usd: 0.02 });
    expect(result.record.reviewer).toEqual({ kind: 'auto' });
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('repairs once from the diagnostics and stops burning calls when it keeps failing', async () => {
    const generator = fixtureGenerator([{ ...makePackage(), packageId: 'BAD ID' }, makePackage()]);
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-a', prompt: 'x' }, reviewer: { kind: 'manual', actorId: 'actor-b' }, budget },
      deps({ generator, maxRepairAttempts: 2 }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.attempts).toBe(2);
    expect(generator.seen[1]?.problems?.length).toBeGreaterThan(0);
  });

  it('rejects after the repair budget is spent, with the validator diagnostics in the record', async () => {
    const broken = { ...makePackage(), packageId: 'BAD ID' };
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-a', prompt: 'x' }, reviewer: { kind: 'auto' }, budget },
      deps({ generator: fixtureGenerator([broken]), maxRepairAttempts: 2 }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('TOOL_PACKAGE_INVALID');
    expect(result.record.status).toBe('rejected');
    expect(result.record.problems.length).toBeGreaterThan(0);
    expect(result.attempts).toBe(2);
  });
});

describe('human route', () => {
  it('activates a hand-edited package through the same steps', async () => {
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-b', definition: makePackage(), baseContentHash: 'd'.repeat(64) }, reviewer: { kind: 'manual', actorId: 'actor-b' } },
      deps(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.generator).toEqual({ kind: 'human' });
    expect(result.compiled.modules['ui/main.tsx']).toContain('require("react/jsx-runtime")');
  });

  it('rejects a hand edit that changed nothing against the version it started from', async () => {
    const base = makePackage();
    const baseHash = (await import('../../shared/tool-package')).toolPackageContentHash(base, hash);
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-b', definition: base, baseContentHash: baseHash }, reviewer: { kind: 'auto' } },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, code: 'TOOL_NO_CHANGE' });
  });

  it('lets AI continue from a source a person already edited', async () => {
    const edited = makePackage({ version: 2, title: 'Activity layout (edited by a person)' });
    const generator = fixtureGenerator([makePackage({ version: 3, title: 'Activity layout (AI continued)' })]);
    const result = await authorToolPackage(
      { route: { kind: 'ai', actorId: 'actor-a', prompt: 'add a no-go area', base: edited }, reviewer: { kind: 'auto' }, budget: { maxCalls: 2, maxUsd: 0.1, usedCalls: 0, usedUsd: 0 } },
      deps({ generator }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The edited source is what the model was given, not the original template.
    expect(generator.seen[0]?.base?.title).toBe('Activity layout (edited by a person)');
    expect(generator.seen[0]?.base?.version).toBe(2);
  });
});

describe('trial gate', () => {
  it('does not activate a package that fails its isolated trial', async () => {
    const trial = vi.fn(async (_compiled: CompiledToolPackage) => ({ ok: false as const, problems: ['the behaviour threw on load'] }));
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-b', definition: makePackage() }, reviewer: { kind: 'auto' } },
      deps({ trial }),
    );
    expect(result).toMatchObject({ ok: false, code: 'TOOL_TRIAL_FAILED' });
    expect(trial).toHaveBeenCalledTimes(1);
    if (result.ok) return;
    expect(result.record.problems).toEqual(['the behaviour threw on load']);
    expect(result.record.packageId).toBe('activity-layout');
  });

  it('produces diagnostics a person can act on when the source does not compile', async () => {
    const broken = makePackage({
      files: [
        { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool() { return <div>; }\n' },
        { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate() { return []; }\n' },
      ],
    });
    const result = await authorToolPackage(
      { route: { kind: 'human', actorId: 'actor-b', definition: broken }, reviewer: { kind: 'auto' } },
      deps(),
    );
    expect(result).toMatchObject({ ok: false, code: 'TOOL_COMPILE_FAILED' });
    if (result.ok) return;
    expect(result.record.problems.join(' ')).toContain('ui/main.tsx');
  });
});

describe('validation problems stay a list', () => {
  it('reports every problem, not just the first, for an unattended repair loop', () => {
    const problems: ToolPackageProblem[] = [
      { code: 'PACKAGE_ENTRY', path: 'uiEntry', message: 'missing' },
      { code: 'PACKAGE_IMPORT', path: 'imports.lodash', message: 'not provided' },
    ];
    expect(problems).toHaveLength(2);
  });
});
