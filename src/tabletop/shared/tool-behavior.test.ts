import { describe, expect, it } from 'vitest';
import { TOOL_PACKAGE_RUNTIME_PROFILE } from './tool-package';
import {
  TOOL_BEHAVIOR_LIMITS,
  ToolBehaviorRunError,
  readToolBehaviorResult,
  toolBehaviorRequestSchema,
  validateToolBehaviorOutput,
  type ToolBehaviorOutputProblemCode,
  type ToolBehaviorProposedChange,
  type ToolBehaviorRequest,
} from './tool-behavior';

const makeRequest = (overrides: Partial<ToolBehaviorRequest> = {}): ToolBehaviorRequest => ({
  packageId: 'activity-layout',
  packageVersion: 2,
  contentHash: 'b'.repeat(64),
  runtimeProfile: TOOL_PACKAGE_RUNTIME_PROFILE,
  moduleSource: 'export function allocate(inputs) { return []; }\n',
  entry: 'allocate',
  inputs: { room: 'Studio' },
  declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create', 'update', 'delete'], maxRows: 3 }],
  resourceSchema: {
    allocations: {
      fields: [
        { id: 'room', type: 'text' },
        { id: 'area', type: 'number' },
        { id: 'confirmed', type: 'boolean' },
        { id: 'tags', type: 'list' },
      ],
    },
  },
  expected: { instanceRevision: 4, grantVersion: 1 },
  ...overrides,
});

const createChange = (values: Record<string, string | number | boolean | null> = { room: 'Studio' }): ToolBehaviorProposedChange =>
  ({ target: 'self', resource: 'allocations', operation: 'create', values });

const result = (...changes: unknown[]): unknown => ({ output: changes });

function rejected(output: unknown, request: ToolBehaviorRequest = makeRequest()): { code: ToolBehaviorOutputProblemCode; problems: string[] } {
  const validated = validateToolBehaviorOutput(output, request);
  expect(validated.ok).toBe(false);
  if (validated.ok) throw new Error('unreachable: the output was accepted');
  return validated;
}

describe('tool behaviour limits', () => {
  it('pins the documented run limits', () => {
    expect(TOOL_BEHAVIOR_LIMITS).toEqual({ maxOutputBytes: 64 * 1024, maxChanges: 200, timeoutMs: 5_000, maxModuleChars: 120_000 });
  });
});

describe('tool behaviour output validation', () => {
  it('accepts a declared create with matching field types', () => {
    const validated = validateToolBehaviorOutput(result(createChange({ room: 'Studio', area: 12, confirmed: true })), makeRequest());
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;
    expect(validated.changes).toEqual([createChange({ room: 'Studio', area: 12, confirmed: true })]);
  });

  it('accepts a declared delete that names a row and writes nothing', () => {
    const validated = validateToolBehaviorOutput(result({ target: 'self', resource: 'allocations', operation: 'delete', rowId: 'row-1' }), makeRequest());
    expect(validated.ok).toBe(true);
  });

  it('refuses a run that proposes a write it never declared and hands back no changes', () => {
    // The zero-write guarantee: one valid change must not ride along with an undeclared one.
    const validated = validateToolBehaviorOutput(
      result(createChange({ room: 'Studio' }), { target: 'billing', resource: 'invoices', operation: 'create', values: { room: 'x' } }),
      makeRequest(),
    );
    expect(validated.ok).toBe(false);
    if (validated.ok) throw new Error('unreachable: the out-of-scope write was accepted');
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('billing/invoices');
    expect('changes' in validated).toBe(false);
  });

  it('rejects an undeclared target, including a connection-shaped id', () => {
    for (const target of ['billing', 'supplier-01']) {
      const validated = rejected(result({ target, resource: 'allocations', operation: 'create', values: { room: 'x' } }));
      expect(validated.code, target).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    }
  });

  it('rejects an undeclared resource on a declared target', () => {
    const validated = rejected(result({ target: 'self', resource: 'invoices', operation: 'create', values: { room: 'x' } }));
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('self/invoices');
  });

  it('rejects an operation the declaration does not allow', () => {
    const request = makeRequest({ declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 3 }] });
    const validated = rejected(result({ target: 'self', resource: 'allocations', operation: 'update', rowId: 'row-1', values: { room: 'x' } }), request);
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('does not allow update');
  });

  it('rejects more rows than the declaration allows', () => {
    const validated = rejected(result(
      ...Array.from({ length: 4 }, () => createChange({ room: 'Studio' })),
    ));
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('allows 3 rows');
  });

  it('rejects a value for a field outside the resource schema', () => {
    const validated = rejected(result(createChange({ room: 'Studio', budget: 10 })));
    expect(validated.code).toBe('TOOL_WRITE_OUT_OF_SCOPE');
    expect(validated.problems.join(' ')).toContain('"budget"');
  });

  it('rejects a value whose type contradicts the field type', () => {
    const cases: Record<string, string | number | boolean | null>[] = [{ area: 'twelve' }, { room: 12 }, { confirmed: 'yes' }, { confirmed: 1 }];
    for (const values of cases) {
      const validated = rejected(result(createChange(values)));
      expect(validated.code, JSON.stringify(values)).toBe('TOOL_OUTPUT_INVALID');
    }
  });

  it('allows clearing a list field with null but rejects a scalar for it', () => {
    const cleared = validateToolBehaviorOutput(result(createChange({ tags: null })), makeRequest());
    expect(cleared.ok).toBe(true);
    const scalar = rejected(result(createChange({ tags: 'one' })));
    expect(scalar.code).toBe('TOOL_OUTPUT_INVALID');
  });

  it('rejects a create that names a row id and a delete that carries values', () => {
    const withRowId = rejected(result({ target: 'self', resource: 'allocations', operation: 'create', rowId: 'row-1', values: { room: 'x' } }));
    expect(withRowId.code).toBe('TOOL_OUTPUT_INVALID');
    const deleteValues = rejected(result({ target: 'self', resource: 'allocations', operation: 'delete', rowId: 'row-1', values: { room: 'x' } }));
    expect(deleteValues.code).toBe('TOOL_OUTPUT_INVALID');
  });

  it('rejects a create or update without values and an update or delete without a row id', () => {
    for (const change of [
      { target: 'self', resource: 'allocations', operation: 'create' },
      { target: 'self', resource: 'allocations', operation: 'create', values: {} },
      { target: 'self', resource: 'allocations', operation: 'update', values: { room: 'x' } },
      { target: 'self', resource: 'allocations', operation: 'update', rowId: 'row-1' },
      { target: 'self', resource: 'allocations', operation: 'delete' },
    ]) {
      const validated = rejected(result(change));
      expect(validated.code, JSON.stringify(change)).toBe('TOOL_OUTPUT_INVALID');
    }
  });

  it('rejects non-finite numbers instead of letting JSON turn them into null', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const validated = rejected(result(createChange({ room: 'Studio', area: value })));
      expect(validated.code).toBe('TOOL_OUTPUT_INVALID');
    }
  });

  it('rejects unknown extra keys on the result and on a change', () => {
    expect(rejected({ output: [], extra: true }).code).toBe('TOOL_OUTPUT_INVALID');
    const extraKey = rejected(result({ ...createChange(), privileged: true }));
    expect(extraKey.code).toBe('TOOL_OUTPUT_INVALID');
    expect(extraKey.problems.join(' ')).toContain('privileged');
  });

  it('rejects a result that is not an object with an output array', () => {
    for (const output of [null, 'changes', [], { output: {} }, { changes: [] }]) {
      expect(rejected(output).code, JSON.stringify(output)).toBe('TOOL_OUTPUT_INVALID');
    }
  });

  it('rejects a sparse change array instead of accepting a shorter list', () => {
    const sparse: unknown[] = [];
    sparse.length = 2;
    const validated = rejected({ output: sparse });
    expect(validated.code).toBe('TOOL_OUTPUT_INVALID');
  });

  it('rejects more changes than the limit allows', () => {
    const request = makeRequest({ declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 200 }] });
    const validated = rejected(result(...Array.from({ length: TOOL_BEHAVIOR_LIMITS.maxChanges + 1 }, () => createChange())), request);
    expect(validated.code).toBe('TOOL_OUTPUT_INVALID');
    expect(validated.problems.join(' ')).toContain('exceeds the limit');
  });

  it('rejects changes that fit the row budget but exceed the output byte cap', () => {
    const request = makeRequest({ declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 200 }] });
    const room = 'x'.repeat(1_900);
    const changes = Array.from({ length: 40 }, () => createChange({ room }));
    const validated = rejected(result(...changes), request);
    expect(validated.code).toBe('TOOL_OUTPUT_INVALID');
    expect(validated.problems.join(' ')).toContain('bytes');
  });

  it('rejects a value for a resource the request declares no schema for', () => {
    const request = makeRequest({
      declaredWrites: [{ target: 'self', resource: 'allocations', operations: ['create'], maxRows: 3 }, { target: 'self', resource: 'marks', operations: ['create'], maxRows: 3 }],
    });
    const validated = rejected(result({ target: 'self', resource: 'marks', operation: 'create', values: { room: 'x' } }), request);
    expect(validated.code).toBe('TOOL_OUTPUT_INVALID');
    expect(validated.problems.join(' ')).toContain('no schema');
  });
});

describe('tool behaviour request schema', () => {
  it('accepts the request a host builds and rejects an unknown key', () => {
    expect(toolBehaviorRequestSchema.safeParse(makeRequest()).success).toBe(true);
    expect(toolBehaviorRequestSchema.safeParse({ ...makeRequest(), secret: 'x' }).success).toBe(false);
  });

  it('rejects a module over the character cap', () => {
    const oversized = makeRequest({ moduleSource: 'x'.repeat(TOOL_BEHAVIOR_LIMITS.maxModuleChars + 1) });
    expect(toolBehaviorRequestSchema.safeParse(oversized).success).toBe(false);
  });

  it('rejects a non-finite input and more inputs than a behaviour may declare', () => {
    expect(toolBehaviorRequestSchema.safeParse(makeRequest({ inputs: { room: Number.POSITIVE_INFINITY } })).success).toBe(false);
    const many = Object.fromEntries(Array.from({ length: 9 }, (_unused, index) => [`input-${index}`, index]));
    expect(toolBehaviorRequestSchema.safeParse(makeRequest({ inputs: many })).success).toBe(false);
  });

  it('rejects two write declarations for the same target and resource', () => {
    const write = { target: 'self' as const, resource: 'allocations', operations: ['create' as const], maxRows: 3 };
    expect(toolBehaviorRequestSchema.safeParse(makeRequest({ declaredWrites: [write, write] })).success).toBe(false);
  });

  it('rejects duplicate field ids in one resource schema', () => {
    const duplicated = makeRequest({
      resourceSchema: { allocations: { fields: [{ id: 'room', type: 'text' }, { id: 'room', type: 'number' }] } },
    });
    expect(toolBehaviorRequestSchema.safeParse(duplicated).success).toBe(false);
  });
});

describe('behaviour wire result', () => {
  it('reads the { changes } envelope the sandbox returns', () => {
    expect(readToolBehaviorResult(JSON.stringify({ changes: [createChange()] }))).toEqual({ output: [createChange()] });
  });

  it('refuses invalid JSON, an extra envelope key and a change with an unknown key', () => {
    for (const body of [
      '{',
      JSON.stringify({ changes: [], extra: 1 }),
      JSON.stringify({ changes: [{ ...createChange(), privileged: true }] }),
      JSON.stringify({ output: [] }),
    ]) {
      expect(() => readToolBehaviorResult(body), body).toThrow(ToolBehaviorRunError);
    }
  });

  it('refuses a body above the byte cap', () => {
    const body = JSON.stringify({ changes: [] }) + ' '.repeat(TOOL_BEHAVIOR_LIMITS.maxOutputBytes);
    expect(() => readToolBehaviorResult(body)).toThrow(ToolBehaviorRunError);
  });
});
