import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { ActorContext } from '../shared/contracts';
import type { Permission } from '../shared/permissions';
import { ROLL_LIMITS, rollSpecProblems, type TablePendingRoll } from '../shared/roll';
import type { TableChange, TableState } from '../shared/table-contracts';
import { rollCombatChange } from '../testing/table-scenarios';
import { projectDomain } from './projections';
import { drawDice, createRoll, rollTotal } from './roll';
import { applyTableChange, checkProgram, createTableState, handleTableCommand, parseBoundedTableChange } from './table';

const NOW = 1_800_000_000_000;

function actorContext(options: {
  actorId?: string;
  role?: ActorContext['role'];
  seat?: ActorContext['seat'];
  now?: number;
  permissions?: ReadonlySet<Permission>;
} = {}): ActorContext {
  return {
    actorId: options.actorId ?? 'actor-1',
    name: options.role === 'participant' ? 'Member' : 'Room owner',
    role: options.role ?? 'owner',
    ...(options.seat ? { seat: options.seat } : {}),
    ...(options.permissions ? { permissions: options.permissions } : {}),
    workspaceId: 'workspace-1', epoch: 1, now: options.now ?? NOW,
    hash: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
  };
}

function owner(now = NOW): ActorContext { return actorContext({ now }); }
function member(now = NOW): ActorContext { return actorContext({ role: 'participant', seat: 'member-1', now }); }

function active(change: TableChange = rollCombatChange()): TableState {
  return applyTableChange(createTableState(), parseBoundedTableChange(structuredClone(change)));
}

function broken(edit: (change: TableChange) => void): TableChange {
  const change = structuredClone(rollCombatChange());
  edit(change);
  return change;
}

function codeOf(run: () => unknown): string {
  try { run(); return 'NO_ERROR'; } catch (error) { return (error as { code?: string }).code ?? 'UNKNOWN'; }
}

function rolled(now = NOW): TableState {
  const decision = handleTableCommand(active(), 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner(now));
  if (!decision) throw new Error('Expected a roll decision.');
  return decision.state;
}

function act(state: TableState, context = owner()): { state: TableState; damage: number } {
  const decision = handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, context);
  if (!decision) throw new Error('Expected an action decision.');
  const created = decision.state.records.hits?.at(-1);
  if (!created) throw new Error('Expected a created hit.');
  return { state: decision.state, damage: Number(created.values.damage) };
}

describe('F048 server roll parameter', () => {
  it('accepts a valid attack program with one roll parameter and passes checkProgram', () => {
    const change = parseBoundedTableChange(rollCombatChange());
    expect(() => checkProgram(structuredClone(change.program))).not.toThrow();
    const state = active();
    const parameter = state.program?.actions[0]?.parameters.find(item => item.id === 'damage');
    expect(parameter).toMatchObject({ type: 'roll', roll: { groups: [{ count: 2, faces: 6 }], modifier: 3 } });
    expect(rollSpecProblems({ groups: [{ count: 2, faces: 6 }], modifier: 3 })).toEqual([]);
  });

  it('rejects out-of-bounds roll specs and roll spec misuse', () => {
    const cases: TableChange[] = [
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 1, faces: 6 }, { count: 1, faces: 6 }, { count: 1, faces: 6 }, { count: 1, faces: 6 }, { count: 1, faces: 6 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 0, faces: 6 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 11, faces: 6 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 1, faces: 1 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 1, faces: 101 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 7, faces: 6 }, { count: 7, faces: 6 }, { count: 7, faces: 6 }] }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 2, faces: 6 }], modifier: 1.5 }; }),
      broken(change => { change.program.actions[0].parameters[1].roll = { groups: [{ count: 2, faces: 6 }], modifier: 1_001 }; }),
      broken(change => { change.program.actions[0].parameters[0].roll = { groups: [{ count: 2, faces: 6 }] }; }),
      broken(change => { delete change.program.actions[0].parameters[1].roll; }),
      broken(change => { change.program.actions[0].parameters[1].collection = 'fighters'; }),
      broken(change => { change.program.actions[0].parameters.push({ id: 'bonus', label: 'Bonus roll', type: 'roll', roll: { groups: [{ count: 1, faces: 4 }] } }); }),
    ];
    for (const change of cases) expect(() => applyTableChange(createTableState(), structuredClone(change)), JSON.stringify(change.program.actions[0].parameters[1])).toThrow();
  });

  it('reports roll bounds problems directly for callers that already hold a program', () => {
    expect(rollSpecProblems({ groups: [] })[0]).toContain('1 to');
    expect(rollSpecProblems({ groups: [{ count: 21, faces: 6 }] })).not.toEqual([]);
    expect(rollSpecProblems({ groups: [{ count: 2, faces: 6 }], modifier: 2_000 })).toHaveLength(1);
    const overDice = structuredClone(rollCombatChange()).program;
    overDice.actions[0].parameters[1].roll = { groups: [{ count: 10, faces: 6 }, { count: 10, faces: 6 }, { count: 1, faces: 6 }] };
    expect(() => checkProgram(overDice)).toThrow('at most 20 dice');
  });

  it('rolls every die on the server and stores a revision-bound pending roll that stays out of projections', () => {
    const state = active();
    const decision = handleTableCommand(state, 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner())!;
    const roll = decision.roll!;
    expect(roll.groups).toEqual([{ count: 2, faces: 6 }]);
    expect(roll.values).toHaveLength(2);
    for (const value of roll.values) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(6);
    }
    expect(roll.total).toBe(roll.values[0]! + roll.values[1]! + 3);
    const [pending] = decision.state.pendingRolls ?? [];
    expect(pending).toBeTruthy();
    expect(pending).toMatchObject({
      actorId: 'actor-1', actionId: 'attack', parameterId: 'damage', modifier: 3,
      dataRevision: state.dataRevision, createdAt: NOW, expiresAt: NOW + ROLL_LIMITS.pendingTtlMs,
      groups: [{ count: 2, faces: 6 }], values: roll.values, total: roll.total,
    });
    expect(projectDomain(decision.state, owner())).not.toHaveProperty('pendingRolls');
    expect(projectDomain(decision.state, member())).not.toHaveProperty('pendingRolls');
    expect(state).not.toBe(decision.state);
  });

  it('rejects rolls from the wrong role, wrong turn, wrong parameter, or without table.act', () => {
    const state = active();
    const run = (context: ActorContext, payload: unknown = { actionId: 'attack', parameterId: 'damage' }) => codeOf(() => handleTableCommand(state, 'table.roll', payload, context));
    expect(run(actorContext({ role: 'participant', seat: 'member-1' }))).toBe('TABLE_TURN');
    expect(run(actorContext({ permissions: new Set<Permission>([]) }))).toBe('FORBIDDEN');
    expect(run(owner(), { actionId: 'attack', parameterId: 'target' })).toBe('TABLE_INPUT');
    expect(run(owner(), { actionId: 'missing', parameterId: 'damage' })).toBe('FORBIDDEN');
    expect(run(owner(), { actionId: 'attack', parameterId: 'damage', inputs: {} })).toBe('INVALID_COMMAND');
    // The owner follow-up roll still works for the same table.
    expect(run(owner())).toBe('NO_ERROR');
    const limited = structuredClone(rollCombatChange());
    limited.program.actions[0].roles = ['owner'];
    expect(codeOf(() => handleTableCommand(active(limited), 'table.roll', { actionId: 'attack', parameterId: 'damage' }, member()))).toBe('FORBIDDEN');
  });

  it('refuses an action send without a roll and rejects a client-sent roll value', () => {
    const state = active();
    expect(codeOf(() => handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('TABLE_ROLL_REQUIRED');
    expect(codeOf(() => handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero', damage: 99 } }, owner()))).toBe('TABLE_ROLL_CLIENT_VALUE');
    // A roll belongs to the actor who asked for it, so another member on the same table still has none.
    const other = handleTableCommand(state, 'table.roll', { actionId: 'attack', parameterId: 'damage' }, actorContext({ actorId: 'actor-2' }))!;
    expect(other.state.pendingRolls?.[0]?.actorId).toBe('actor-2');
    expect(codeOf(() => handleTableCommand(other.state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('TABLE_ROLL_REQUIRED');
  });

  it('consumes the pending roll once, adds the total to the record, and returns the dice to the caller', () => {
    const state = rolled();
    const pending = state.pendingRolls![0]!;
    const decision = handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner())!;
    expect(decision.roll).toMatchObject({ groups: pending.groups, values: pending.values, total: pending.total });
    expect(decision.rollParameterId).toBe('damage');
    expect(decision.state.records.fighters?.[0]?.values.damage_taken).toBe(pending.total);
    expect(decision.state.records.hits?.at(-1)?.values).toEqual({ target: 'hero', damage: pending.total });
    expect(decision.state.pendingRolls).toBeUndefined();
    expect(decision.state.dataRevision).toBe(state.dataRevision + 1);
    // The same submit again is a reuse: the pending roll is gone.
    expect(codeOf(() => handleTableCommand(decision.state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('TABLE_ROLL_REQUIRED');
  });

  it('rejects expired, stale, forged, and other-actor pending rolls with structured errors', () => {
    const state = rolled();
    expect(codeOf(() => handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner(NOW + ROLL_LIMITS.pendingTtlMs + 1)))).toBe('TABLE_ROLL_EXPIRED');
    const stale = structuredClone(state);
    stale.dataRevision += 1;
    expect(codeOf(() => handleTableCommand(stale, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('TABLE_ROLL_STALE');
    const forgedFace = structuredClone(state);
    forgedFace.pendingRolls![0]!.values[0] = 99;
    expect(codeOf(() => handleTableCommand(forgedFace, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('INVALID_AUTHORITY_STATE');
    const forgedTotal = structuredClone(state);
    forgedTotal.pendingRolls![0]!.total += 1;
    expect(codeOf(() => handleTableCommand(forgedTotal, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner()))).toBe('INVALID_AUTHORITY_STATE');
    expect(codeOf(() => handleTableCommand(state, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, actorContext({ actorId: 'actor-2' })))).toBe('TABLE_ROLL_REQUIRED');
  });

  it('replaces an earlier pending roll on a re-roll and caps unused rolls per table', () => {
    const first = handleTableCommand(active(), 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner())!;
    const second = handleTableCommand(first.state, 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner())!;
    expect(second.state.pendingRolls).toHaveLength(1);
    expect(second.state.pendingRolls?.[0]?.createdAt).toBe(NOW);
    const full = structuredClone(second.state);
    const template = full.pendingRolls![0]!;
    full.pendingRolls = Array.from({ length: ROLL_LIMITS.pendingPerTable }, (_, index): TablePendingRoll => ({
      ...structuredClone(template), parameterId: `param-${index}`, expiresAt: NOW + ROLL_LIMITS.pendingTtlMs,
    }));
    expect(codeOf(() => handleTableCommand(full, 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner()))).toBe('TABLE_LIMIT');
  });

  it('replays the same recorded roll into the same row', () => {
    const state = rolled();
    const pending = structuredClone(state.pendingRolls![0]!);
    const first = act(structuredClone(state));
    const replay = act(structuredClone(state));
    expect(replay).toEqual(first);
    expect(first.damage).toBe(pending.total);
    // The recorded roll itself is enough to recompute the total deterministically.
    expect(rollTotal(pending.values, pending.modifier)).toBe(pending.total);
  });

  it('draws bounded dice from an injected source and refuses a stuck source', () => {
    expect(drawDice({ groups: [{ count: 3, faces: 6 }, { count: 1, faces: 20 }] }, () => 0)).toEqual([1, 1, 1, 1]);
    // 0xFFFFFF9F is the largest uint32 below the 100-face rejection limit, so it is face 100.
    expect(drawDice({ groups: [{ count: 1, faces: 100 }] }, () => 4_294_967_199)).toEqual([100]);
    expect(drawDice({ groups: [{ count: 1, faces: 6 }] }, (() => { const draws = [4_294_967_295, 5]; return () => draws.shift() ?? 0; })())).toEqual([6]);
    expect(() => drawDice({ groups: [{ count: 1, faces: 3 }] }, () => 4_294_967_295)).toThrow('random source');
    const cryptoRoll = createRoll({ groups: [{ count: 3, faces: 8 }, { count: 2, faces: 20 }], modifier: -4 });
    expect(cryptoRoll.values).toHaveLength(5);
    for (const [index, value] of cryptoRoll.values.entries()) {
      expect(value).toBeGreaterThanOrEqual(1);
      expect(value).toBeLessThanOrEqual(index < 3 ? 8 : 20);
    }
    expect(cryptoRoll.total).toBe(cryptoRoll.values.reduce((sum, value) => sum + value, 0) - 4);
  });

  it('does not touch old parameter types or programs without a roll', () => {
    const change = parseBoundedTableChange(rollCombatChange());
    change.program.actions[0].parameters = change.program.actions[0].parameters.filter(parameter => parameter.type !== 'roll');
    change.program.actions[0].creates = [{ collection: 'hits', values: { target: { input: 'target' }, damage: { literal: 1 } } }];
    change.program.actions[0].effects = [{ record: 'target', field: 'damage_taken', op: 'add', value: { literal: 1 } }];
    change.program.canvas = undefined;
    const applied = applyTableChange(createTableState(), change);
    expect(codeOf(() => handleTableCommand(applied, 'table.roll', { actionId: 'attack', parameterId: 'damage' }, owner()))).toBe('TABLE_INPUT');
    const decision = handleTableCommand(applied, 'table.act', { actionId: 'attack', inputs: { target: 'hero' } }, owner())!;
    expect(decision.roll).toBeUndefined();
    expect(decision.state.records.fighters?.[0]?.values.damage_taken).toBe(1);
  });
});
