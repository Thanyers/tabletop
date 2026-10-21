import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain, projectDomain } from './index';
import { applyTableChange, createTableState, handleTableCommand, tableChangeSchema } from './table';
import { equipmentChange, gameChange, shiftsChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext, DomainState, WorkspaceView } from '../shared/contracts';
import type { TableChange, TableState } from '../shared/table-contracts';
import { planForWorkspace } from '../runtime';
import { evaluateGenerativeCanvas } from '../runtime/generative/evaluator';
import { loanAmortizationChange } from '../testing/generative-scenarios';

const owner: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'account-b', name: 'Participant', role: 'participant', seat: 'member-1' };
function source(name: keyof typeof tableScenarioSources) { return handleTableCommand(createTableState(), 'table.import', tableScenarioSources[name], owner)!.state; }
function activate(state: TableState, change: TableChange): TableState {
  let current: DomainState = decideDomain(state, { type: 'evolve.propose', payload: { change } }, owner).state;
  for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) current = decideDomain(current, { type, payload: {} }, owner).state;
  if (current.kind !== 'table') throw new Error('wrong kind'); return current;
}
function act(state: TableState, actionId: string, inputs: Record<string, string>, ctx = owner) { return handleTableCommand(state, 'table.act', { actionId, inputs }, ctx)!.state; }

describe('file-driven generic table authority', () => {
  it('imports actual source text and activates a table through the full review lifecycle', () => {
    expect(createDomain('table', owner)).toEqual(createTableState());
    const initial = source('equipment'), change = equipmentChange(initial.sources[0].id);
    const state = activate(initial, change);
    expect(state.ruleRevision).toBe(1); expect(state.records.equipment).toHaveLength(2);
    const view: WorkspaceView = { id: 'fixture', title: 'Equipment', kind: 'table', epoch: 1, revision: 'one', actor: { actorId: owner.actorId, name: 'Owner', role: 'owner' }, members: [], domain: state, createdAt: 0, expiresAt: 999999 };
    expect(planForWorkspace(view).nodes.map(n => n.id)).toEqual(['table.sources', 'table.rules', 'table.collection.equipment', 'table.actions']);
  });
  it('equipment: prevents double reservation and another actor returning a loan', () => {
    const initial = source('equipment'), state = activate(initial, equipmentChange(initial.sources[0].id));
    const borrowed = act(state, 'borrow', { item: 'camera' }, member);
    expect(borrowed.records.equipment[0].values).toMatchObject({ available: false, borrower: member.actorId });
    expect(() => act(borrowed, 'borrow', { item: 'camera' })).toThrow('already reserved');
    expect(() => act(borrowed, 'return', { item: 'camera' })).toThrow('Only the borrower');
    expect(act(borrowed, 'return', { item: 'camera' }, member).records.equipment[0].values.available).toBe(true);
  });
  it('shifts: swaps two fields atomically using before-values and enforces both availability lists', () => {
    const initial = source('shifts'), state = activate(initial, shiftsChange(initial.sources[0].id));
    const after = act(state, 'swap', { first: 'ada', second: 'bo' });
    expect(after.records.people.map(r => r.values.slot)).toEqual(['evening', 'morning', 'night']);
    expect(() => act(after, 'swap', { first: 'ada', second: 'cy' })).toThrow('unavailable');
    expect(() => act(after, 'swap', { first: 'ada', second: 'bo' }, member)).toThrow('your own shift');
    expect(state.records.people.map(r => r.values.slot)).toEqual(['morning', 'evening', 'night']);
  });
  it('board game: enforces turn/ownership, edits scoring during play and resumes serializable state', () => {
    const initial = source('game'); let state = activate(initial, gameChange(initial.sources[0].id));
    expect(() => act(state, 'advance', { boat: 'blue' }, member)).toThrow('your turn');
    expect(() => act(state, 'advance', { boat: 'blue' })).toThrow('your own boat');
    state = act(state, 'advance', { boat: 'red' });
    const edit = gameChange(initial.sources[0].id); edit.initialRecords = {}; edit.program.actions[0].effects[0].value = { literal: 3 };
    edit.program.assumptions = ['Owner proposes three points per move.'];
    state = activate(state, edit); expect(state.records.boats[0].values.score).toBe(2); expect(state.turn).toBe('member-1');
    state = act(JSON.parse(JSON.stringify(state)), 'advance', { boat: 'blue' }, member);
    expect(state.records.boats.map(r => r.values.score)).toEqual([2, 3]); expect(state.turn).toBe('host');
  });
  it('keeps canvas optional for existing v1 programs and preserves records when adding a view during a rule edit', () => {
    const initial = activate(createTableState(), loanAmortizationChange);
    expect(initial.program?.canvas).toBeUndefined();
    const calculated = act(initial, 'recalculate', { loan: 'loan-1' });
    const edit = structuredClone(loanAmortizationChange);
    edit.initialRecords = {};
    edit.program.canvas = { version: 1, views: [
      { id: 'current-payment', kind: 'metric', title: 'Monthly payment', value: { op: 'recordField', collection: 'loans', recordId: 'loan-1', field: 'payment' }, format: 'number' },
    ] };
    const revised = activate(calculated, edit);
    expect(revised.ruleRevision).toBe(initial.ruleRevision + 1);
    expect(revised.records).toEqual(calculated.records);
    expect(revised.program?.canvas).toEqual(edit.program.canvas);
    if (!revised.program?.canvas) throw new Error('Expected the added view.');
    const evaluated = evaluateGenerativeCanvas(revised.program.canvas, { program: revised.program, records: revised.records, actor: owner.actorId, turn: revised.turn });
    expect(evaluated).toMatchObject([{ id: 'current-payment', kind: 'metric', value: calculated.records.loans[0].values.payment }]);
  });
  it('rejects stale approval after data changes; participant can import but not propose or remove (F008)', () => {
    const initial = source('equipment'); let state: DomainState = activate(initial, equipmentChange(initial.sources[0].id));
    const edit = equipmentChange(initial.sources[0].id); edit.initialRecords = {};
    for (const [type, payload] of [['evolve.propose', { change: edit }], ['evolve.simulate', {}], ['evolve.validate', {}], ['evolve.approve', {}]] as const) state = decideDomain(state, { type, payload }, owner).state;
    state = decideDomain(state, { type: 'table.act', payload: { actionId: 'borrow', inputs: { item: 'camera' } } }, member).state;
    expect(() => decideDomain(state, { type: 'evolve.activate', payload: {} }, owner)).toThrow();
    const memberImport = decideDomain(state, { type: 'table.import', payload: tableScenarioSources.game }, member).state;
    if (memberImport.kind !== 'table' || state.kind !== 'table') throw new Error();
    expect(memberImport.sources).toHaveLength(2);
    expect(memberImport.candidate).toEqual(state.candidate); // a member's file never discards the owner's draft
    expect(() => decideDomain(memberImport, { type: 'table.removeSource', payload: { sourceId: memberImport.sources[1].id } }, member)).toThrow('cannot perform');
    expect(() => decideDomain(initial, { type: 'evolve.propose', payload: { change: edit } }, member)).toThrow('cannot perform');
  });
  it('shares source files with participants but keeps quotations and owner draft history private', () => {
    const initial = source('game'), state = activate(initial, gameChange(initial.sources[0].id));
    const participant = projectDomain(state, member);
    expect(participant.kind).toBe('table');
    if (participant.kind !== 'table') throw new Error();
    expect(participant.sources).toEqual(state.sources); expect(participant.revisions).toEqual([]); expect(participant.candidate).toBeNull(); expect(participant.program?.evidence).toEqual([]);
    const view: WorkspaceView = { id: 'fixture', title: 'Game', kind: 'table', epoch: 1, revision: 'two', actor: { actorId: member.actorId, name: 'Player', role: 'participant', seat: 'member-1' }, members: [], domain: participant, createdAt: 0, expiresAt: 999999 };
    expect(planForWorkspace(view).nodes.some(n => n.id === 'table.sources')).toBe(true);
  });
  it('rejects code-shaped output, forged citations, destructive rule edits, oversized text and unsafe keys', () => {
    const initial = source('equipment'), valid = equipmentChange(initial.sources[0].id);
    expect(tableChangeSchema.safeParse({ ...valid, script: 'fetch(secret)' }).success).toBe(false);
    const forged = structuredClone(valid); forged.program.evidence[0].quote = 'not in source'; expect(() => applyTableChange(initial, forged)).toThrow('quotation');
    const unsafe = structuredClone(valid); unsafe.program.collections[0].id = 'constructor'; expect(tableChangeSchema.safeParse(unsafe).success).toBe(false);
    const active = activate(initial, valid); expect(() => applyTableChange(active, valid)).toThrow('preserve current records');
    expect(() => handleTableCommand(initial, 'table.import', { filename: 'big.txt', text: 'ก'.repeat(12000) }, owner)).toThrow('32 KiB');
    expect(() => handleTableCommand(initial, 'table.import', { filename: 'image.png', text: 'image' }, owner)).toThrow();
    expect(() => handleTableCommand(initial, 'table.import', { filename: 'bad.json', text: '{bad' }, owner)).toThrow('not valid');
  });
  it('validates effect types, record bounds and composite uniqueness at every atomic commit', () => {
    const initial = source('shifts'), change = shiftsChange(initial.sources[0].id);
    change.program.actions[0].effects[0].value = { literal: 'night' };
    const active = activate(initial, change);
    expect(() => act(active, 'swap', { first: 'ada', second: 'bo' })).toThrow('One person per shift');
    expect(active.records.people[0].values.slot).toBe('morning');
    const wrong = structuredClone(change); wrong.program.actions[0].effects[0].value = { literal: 3 };
    expect(() => applyTableChange(initial, wrong)).toThrow('does not match');
  });
  it('does not depend on known scenario or collection names', () => {
    const initial = source('equipment'), change = equipmentChange(initial.sources[0].id);
    change.program.title = 'Reserve seed samples'; change.program.collections[0].id = 'seed_samples';
    change.initialRecords.seed_samples = change.initialRecords.equipment; delete change.initialRecords.equipment;
    for (const action of change.program.actions) action.parameters[0].collection = 'seed_samples';
    expect(act(activate(initial, change), 'borrow', { item: 'camera' }, member).records.seed_samples[0].values.available).toBe(false);
  });
  it('keeps participant revisions increasing when the visible activity history is full', () => {
    const initial = source('equipment'); let state = activate(initial, equipmentChange(initial.sources[0].id));
    for (let n = 0; n < 100; n++) state = act(state, n % 2 ? 'return' : 'borrow', { item: 'camera' }, member);
    const before = projectDomain(state, member).dataRevision;
    const after = act(state, 'borrow', { item: 'camera' }, member);
    expect(after.activity).toHaveLength(100);
    expect(projectDomain(after, member).dataRevision).toBe(before + 1);
    expect(after.actionRevision).toBe(101);
  });
  it('retains sources needed to restore an older rule revision', () => {
    const initial = source('equipment'); let state = activate(initial, equipmentChange(initial.sources[0].id));
    state = handleTableCommand(state, 'table.import', tableScenarioSources.game, owner)!.state;
    const edit = equipmentChange(initial.sources[0].id); edit.initialRecords = {};
    edit.program.evidence = [{ sourceId: state.sources[1].id, quote: state.sources[1].text.slice(0, 40) }];
    state = activate(state, edit);
    expect(() => handleTableCommand(state, 'table.removeSource', { sourceId: initial.sources[0].id }, owner)).toThrow('retained rule revision');
    let restored = decideDomain(state, { type: 'evolve.rollback', payload: { revision: 1 } }, owner).state;
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) restored = decideDomain(restored, { type, payload: {} }, owner).state;
    if (restored.kind !== 'table') throw new Error('wrong kind');
    expect(restored.program?.evidence[0].sourceId).toBe(initial.sources[0].id);
    expect(restored.records).toEqual(state.records);
  });
  it('rejects cumulative record growth atomically before a room exceeds its storage budget', () => {
    const initial = source('equipment'), change = equipmentChange(initial.sources[0].id);
    change.program.collections = [{ id: 'notes', title: 'Notes', fields: [{ id: 'tags', label: 'Tags', type: 'list', required: true }] }];
    change.initialRecords = { notes: Array.from({ length: 100 }, (_, n) => ({ id: `note_${n}`, values: { tags: [] } })) };
    change.program.actions = [{ id: 'fill', title: 'Fill note', description: 'Add bounded tags', roles: ['owner'], parameters: [{ id: 'note', label: 'Note', type: 'record', collection: 'notes' }], conditions: [], effects: [{ record: 'note', field: 'tags', op: 'set', value: { literal: Array(32).fill('x'.repeat(100)) } }], requireTurn: false, advanceTurn: false }];
    let state = activate(initial, change), rejected = false;
    for (let n = 0; n < 100; n++) {
      const before = JSON.stringify(state);
      try { state = act(state, 'fill', { note: `note_${n}` }); }
      catch (e) {
        expect((e as Error).message).toContain('128 KiB'); expect(JSON.stringify(state)).toBe(before);
        expect(state.records.notes[n].values.tags).toEqual([]); rejected = true; break;
      }
    }
    expect(rejected).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(state.records))).toBeLessThanOrEqual(128 * 1024);
  });
  it('bounds retained rule history and stores compact simulation evidence without duplicating initial rows', () => {
    const initial = source('equipment'), change = equipmentChange(initial.sources[0].id);
    change.program.actions = Array.from({ length: 8 }, (_, n) => ({ ...structuredClone(change.program.actions[0]), id: `borrow_${n}`, title: '字'.repeat(500), description: '字'.repeat(500) }));
    let state = activate(initial, change);
    expect(state.revisions[0].change).toMatchObject({ initialRecords: {} });
    expect(state.candidate?.simulation?.after).toMatchObject({ rowCount: 2 });
    expect(state.candidate?.simulation?.after).not.toHaveProperty('records');
    change.initialRecords = {};
    for (let n = 0; n < 21; n++) { change.program.title = `Revision ${n + 2}`; state = activate(state, change); }
    expect(state.ruleRevision).toBe(22);
    expect(state.revisions.length).toBeGreaterThan(1); expect(state.revisions.length).toBeLessThan(20);
    expect(Buffer.byteLength(JSON.stringify(state.revisions))).toBeLessThanOrEqual(256 * 1024);
    expect(state.revisions.at(-1)?.revision).toBe(22);
    expect(state.records.equipment).toHaveLength(2);
  });
  it('names the field and the problem when bounds or choices do not fit its type (F018)', () => {
    const initial = source('equipment');
    const withField = (patch: Record<string, unknown>) => {
      const change = equipmentChange(initial.sources[0].id);
      Object.assign(change.program.collections[0].fields[0], patch);
      return () => applyTableChange(structuredClone(initial), change);
    };
    expect(withField({ min: 1, max: 40 })).toThrow('Equipment: name is a text field; only number fields can have min or max.');
    expect(withField({ type: 'list', choices: ['a'] })).toThrow('only text fields can have choices.');
    const bounded = equipmentChange(initial.sources[0].id);
    bounded.program.collections[0].fields.push({ id: 'count', label: 'Count', type: 'number', required: false, min: 5, max: 1 });
    expect(() => applyTableChange(structuredClone(initial), bounded)).toThrow('Equipment: Count has min greater than max.');
  });
});
