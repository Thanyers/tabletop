import { describe, expect, it } from 'vitest';
import { authorToolPackage } from '../../src/tabletop/runtime/tools/authoring';
import { DeepSeekToolPackageGenerator } from './deepseek-tool-package';

/**
 * F080 / G1-01 + EDIT-01 wiring: the real DeepSeek adapter feeds the authoring pipeline.
 *
 * The two halves were proven separately (adapter against the reply shape, pipeline against an injected
 * generator). This test joins them, so a contract mismatch between the adapter's result and what the
 * pipeline reads fails here instead of on the first paid run. Fetch is injected, so nothing is charged.
 */

function packageJson(): string {
  return JSON.stringify({
    schemaVersion: 1,
    packageId: 'room-planner',
    version: 1,
    title: 'Room planner',
    description: 'see which rooms are free',
    uiEntry: 'ui/main.tsx',
    behaviorEntry: 'behavior/run.ts',
    files: [
      { path: 'ui/main.tsx', language: 'tsx', text: 'export function Tool(){ return <p>rooms</p>; }\n' },
      { path: 'behavior/run.ts', language: 'ts', text: 'export function allocate(){ return { ok: true }; }\n' },
    ],
    ports: [{ id: 'rooms', label: 'rooms', direction: 'in', kind: 'records', fields: ['name'], maxRows: 10 }],
    behaviors: [{
      id: 'allocate',
      label: 'allocate',
      entry: 'allocate',
      inputs: [],
      actions: ['reserve'],
      writes: [],
    }],
    imports: { react: '19.3.0' },
    runtimeProfile: 'tabletop-tool-1',
    provenance: { origin: 'ai', createdAt: 1_760_000_000_000 },
  });
}

function deepSeekReply(content: string) {
  return new Response(JSON.stringify({
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 900, completion_tokens: 600 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

const trial = async () => ({ ok: true as const });
const hash = (value: unknown): string => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  let acc = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    acc ^= text.charCodeAt(index);
    acc = Math.imul(acc, 0x01000193) >>> 0;
  }
  return acc.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
};

describe('the DeepSeek adapter drives the authoring pipeline', () => {
  it('activates a generated package and records the generator with its usage', async () => {
    const generator = new DeepSeekToolPackageGenerator({
      apiKey: 'test-key',
      fetch: (async () => deepSeekReply(packageJson())) as typeof fetch,
    });

    const result = await authorToolPackage(
      {
        route: { kind: 'ai', actorId: 'actor-editor', prompt: 'which rooms are free' },
        reviewer: { kind: 'manual', actorId: 'actor-reviewer' },
        budget: { maxCalls: 6, maxUsd: 0.2, usedCalls: 0, usedUsd: 0 },
      },
      {
        trial,
        hash,
        now: 1_000,
        maxRepairAttempts: 1,
        generator: {
          id: generator.id,
          estimate: () => generator.estimate(),
          generate: async (input: { intent: string; base?: string }) => {
            const generated = await generator.generate(input);
            return { definition: generated.definition, usage: { calls: generated.usage.calls, usd: generated.usage.usd } };
          },
        } as never,
      },
    );

    expect(result.ok, JSON.stringify(result.ok ? null : result.record.problems)).toBe(true);
    if (!result.ok) return;
    expect(result.record.status).toBe('activated');
    expect(result.record.generator).toMatchObject({ kind: 'ai', generatorId: 'deepseek-tool-package', calls: 1 });
    expect(result.record.generator.usd).toBeGreaterThan(0);
    expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/u);
  });

  it('does not spend a call when the model reply is not a valid package', async () => {
    const generator = new DeepSeekToolPackageGenerator({
      apiKey: 'test-key',
      fetch: (async () => deepSeekReply('{"packageId":"broken"}')) as typeof fetch,
    });

    const result = await authorToolPackage(
      {
        route: { kind: 'ai', actorId: 'actor-editor', prompt: 'broken' },
        reviewer: { kind: 'manual', actorId: 'actor-reviewer' },
        budget: { maxCalls: 6, maxUsd: 0.2, usedCalls: 0, usedUsd: 0 },
      },
      {
        trial,
        hash,
        now: 2_000,
        maxRepairAttempts: 1,
        generator: {
          id: generator.id,
          estimate: () => generator.estimate(),
          generate: async (input: { intent: string; base?: string }) => {
            const generated = await generator.generate(input);
            return { definition: generated.definition, usage: { calls: generated.usage.calls, usd: generated.usage.usd } };
          },
        } as never,
      },
    );

    expect(result.ok).toBe(false);
    expect(result.record.status).not.toBe('activated');
  });
});
