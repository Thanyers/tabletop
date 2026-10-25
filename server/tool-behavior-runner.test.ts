import { describe, expect, it } from 'vitest';
import { runLocalToolBehavior } from './local-tool-behavior-runner.js';
import { validateToolBehaviorOutput, type ToolBehaviorRequest } from '../src/tabletop/shared/tool-behavior.js';
import { TOOL_PACKAGE_RUNTIME_PROFILE } from '../src/tabletop/shared/tool-package.js';

const request: ToolBehaviorRequest = {
  packageId: 'activity-layout',
  packageVersion: 1,
  contentHash: 'd'.repeat(64),
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  moduleSource: 'export function allocate(inputs) { return [{target:"self",resource:"allocations",operation:"create",values:{room:inputs.room,area:12}}]; }',
  entry: 'allocate',
  inputs: { room: 'Studio' },
  declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 20 }],
  resourceSchema: { allocations: { fields: [{ id: 'room', type: 'text' }, { id: 'area', type: 'number' }] } },
  expected: { instanceRevision: 1, grantVersion: 1 },
};

const expected = [{ target: 'self', resource: 'allocations', operation: 'create', values: { room: 'Studio', area: 12 } }];

describe('local isolated tool behaviour', () => {
  it('runs generated behaviour with the same protocol as the Cloudflare adapter', async () => {
    const result = await runLocalToolBehavior(request);
    expect(result.output).toEqual(expected);
    expect(validateToolBehaviorOutput(result, request)).toEqual({ ok: true, changes: expected });
  });

  it('reports a thrown behaviour as TOOL_BEHAVIOR_FAILED', async () => {
    const failing: ToolBehaviorRequest = { ...request, moduleSource: 'export function allocate() { throw new Error("boom"); }' };
    await expect(runLocalToolBehavior(failing)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_FAILED' });
  });

  it('rejects a behaviour that proposes a write outside its declared set', async () => {
    const overreach: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export function allocate() { return [{target:"self",resource:"invoices",operation:"create",values:{room:"x"}}]; }',
    };
    const result = await runLocalToolBehavior(overreach);
    const validated = validateToolBehaviorOutput(result, request);
    expect(validated.ok).toBe(false);
    if (validated.ok) throw new Error('the out-of-scope write was accepted');
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
  });

  it('refuses fetch() inside the local isolate', async () => {
    const network: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export async function allocate() { await fetch("https://example.test/steal"); return [{target:"self",resource:"allocations",operation:"create",values:{room:"reached",area:1}}]; }',
    };
    await expect(runLocalToolBehavior(network)).rejects.toMatchObject({ code: 'TOOL_BEHAVIOR_FAILED' });
  });

  it('gives the local isolate no env binding or secret-looking global', async () => {
    const probe: ToolBehaviorRequest = {
      ...request,
      moduleSource: `export function allocate() {
        const names = ["env", "DB", "DEEPSEEK_KEY", "PUBLIC_ORIGIN", "COMPUTE_LOADER"];
        return [{target:"self",resource:"probe",operation:"create",values:{seen:names.map(name => name + "=" + typeof globalThis[name]).join(";")}}];
      }`,
      declaredWrites: [{ target: 'self', resource: 'probe', operations: ['create'], maxRows: 1 }],
      resourceSchema: { probe: { fields: [{ id: 'seen', type: 'text' }] } },
    };
    const result = await runLocalToolBehavior(probe);
    expect(result.output[0]?.values?.seen).toBe('env=undefined;DB=undefined;DEEPSEEK_KEY=undefined;PUBLIC_ORIGIN=undefined;COMPUTE_LOADER=undefined');
  });

  it('refuses an output above the byte cap', async () => {
    const oversized: ToolBehaviorRequest = {
      ...request,
      moduleSource: 'export function allocate() { return [{target:"self",resource:"allocations",operation:"create",values:{room:"x".repeat(70000),area:1}}]; }',
    };
    await expect(runLocalToolBehavior(oversized)).rejects.toMatchObject({ code: 'TOOL_OUTPUT_INVALID' });
  });
});
