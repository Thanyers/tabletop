import { describe, expect, it } from 'vitest';
import type { TableAction } from './table-contracts';
import { planToolBehaviorAction } from './tool-action-proposal';

/**
 * F080 / EXEC-01: a behaviour may only propose an action the package declared and the table defines.
 *
 * Every refusal returns no plan, so the host has nothing to commit - that is what keeps "outside the
 * declared scope" equal to "zero write" without a second write path into the domain.
 */

const actions = [
  {
    id: 'reserve',
    title: 'Reserve',
    description: 'reserve a room',
    roles: ['owner', 'participant'],
    parameters: [
      { id: 'room', label: 'Room', type: 'record', collection: 'rooms' },
      { id: 'people', label: 'People', type: 'number' },
    ],
    conditions: [],
    effects: [],
    requireTurn: false,
    advanceTurn: false,
  },
] as unknown as TableAction[];

function plan(proposal: Parameters<typeof planToolBehaviorAction>[0]['proposal'], declared: string[] = ['reserve']) {
  return planToolBehaviorAction({ declaredActions: declared, programActions: actions, proposal });
}

describe('proposing an action from a behaviour', () => {
  it('plans a declared action with inputs that match its parameters', () => {
    expect(plan({ actionId: 'reserve', inputs: { room: 'r1', people: 3 } }))
      .toEqual({ ok: true, actionId: 'reserve', inputs: { room: 'r1', people: 3 } });
  });

  it('refuses an action the package never declared', () => {
    expect(plan({ actionId: 'reserve', inputs: { room: 'r1', people: 3 } }, [])).toMatchObject({ ok: false, code: 'ACTION_NOT_DECLARED' });
  });

  it('refuses an action the table does not define', () => {
    expect(plan({ actionId: 'delete-everything', inputs: {} }, ['delete-everything'])).toMatchObject({ ok: false, code: 'ACTION_NOT_FOUND' });
  });

  it('refuses when the behaviour proposes nothing', () => {
    expect(plan(undefined)).toMatchObject({ ok: false, code: 'NO_PROPOSAL' });
  });

  it('refuses a missing input, a wrong type and an undeclared input', () => {
    expect(plan({ actionId: 'reserve', inputs: { room: 'r1' } })).toMatchObject({ ok: false, code: 'INPUT_MISSING' });
    expect(plan({ actionId: 'reserve', inputs: { room: 'r1', people: 'three' } })).toMatchObject({ ok: false, code: 'INPUT_WRONG_TYPE' });
    expect(plan({ actionId: 'reserve', inputs: { room: 'r1', people: 1, extra: 'x' } })).toMatchObject({ ok: false, code: 'INPUT_NOT_DECLARED' });
  });

  it('copies the inputs so a caller cannot mutate the plan afterwards', () => {
    const inputs = { room: 'r1', people: 2 };
    const result = plan({ actionId: 'reserve', inputs });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.inputs).not.toBe(inputs);
  });
});
