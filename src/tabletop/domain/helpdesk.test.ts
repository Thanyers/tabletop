import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decideDomain, projectDomain } from './index';
import { applyTableChange, createTableState, handleTableCommand } from './table';
import { helpdeskChange, helpdeskSource } from '../testing/helpdesk-scenario';
import type { ActorContext } from '../shared/contracts';
import type { TableState, TableValue } from '../shared/table-contracts';

const owner: ActorContext = { actorId: 'dispatcher', name: 'Dispatcher', role: 'owner', workspaceId: 'helpdesk-unit', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const technician: ActorContext = { ...owner, actorId: 'tech-a', name: 'Technician A', role: 'participant', seat: 'member-1' };
const colleague: ActorContext = { ...technician, actorId: 'tech-b', name: 'Technician B', seat: 'member-2' };
function command(state: TableState, type: string, payload: unknown = {}, actor = owner): TableState {
  const next = decideDomain(state, { type, payload }, actor).state;
  if (next.kind !== 'table') throw new Error('Wrong domain');
  return next;
}
function imported() { return handleTableCommand(createTableState(), 'table.import', helpdeskSource, owner)!.state; }
function active() {
  let state = imported();
  state = command(state, 'evolve.propose', { change: helpdeskChange(state.sources[0].id) });
  for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) state = command(state, type);
  return state;
}
const act = (state: TableState, actionId: string, inputs: Record<string, TableValue>, actor = technician) => command(state, 'table.act', { actionId, inputs }, actor);
const values = (state: TableState, id = 'printer') => state.records.tickets.find(row => row.id === id)!.values;

describe('new Office Helpdesk workflow — isolated real interpreter, authored rules', () => {
  it('requires review activation, then completes claim, submit, approval and reopening', () => {
    const source = imported();
    expect(() => act(source, 'claim', { ticket: 'printer' })).toThrow('activate');
    let state = active();
    expect(state.ruleRevision).toBe(1);
    state = act(state, 'claim', { ticket: 'printer' });
    expect(values(state)).toMatchObject({ status: 'in_progress', assignee: 'tech-a' });
    state = act(state, 'submit', { ticket: 'printer', note: 'Replaced the test cartridge; print test passed.' });
    state = act(state, 'approve', { ticket: 'printer' }, owner);
    expect(values(state)).toMatchObject({ status: 'done', completion_note: 'Replaced the test cartridge; print test passed.' });
    state = act(state, 'reopen', { ticket: 'printer' }, owner);
    expect(values(state)).toMatchObject({ status: 'open', assignee: null, completion_note: null });
    expect(state.actionRevision).toBe(4);
  });
  it('rejects duplicate claim and another technician submitting; failures leave state unchanged', () => {
    const state = act(active(), 'claim', { ticket: 'printer' }), before = structuredClone(state);
    expect(() => act(state, 'claim', { ticket: 'printer' }, colleague)).toThrow('must be open');
    expect(() => act(state, 'submit', { ticket: 'printer', note: 'Not my work' }, colleague)).toThrow('Only the assignee');
    expect(state).toEqual(before);
  });
  it('rejects a blank required record title while allowing unassigned optional fields', () => {
    const state = imported(), change = helpdeskChange(state.sources[0].id);
    expect(applyTableChange(state, change).records.tickets[0].values.assignee).toBeNull();
    change.initialRecords.tickets[0].values.title = '  ';
    expect(() => applyTableChange(state, change)).toThrow('Work has an invalid value');
  });
  it.each(['', '   ', '\n\t'])('rejects a blank completion note %j before applying effects', note => {
    const state = act(active(), 'claim', { ticket: 'printer' });
    expect(() => act(state, 'submit', { ticket: 'printer', note })).toThrow('Completion note is invalid');
    expect(values(state)).toMatchObject({ status: 'in_progress', completion_note: null });
    expect(state.actionRevision).toBe(1);
  });
  it('enforces owner-only approval, reopening and blocked-ticket authorization', () => {
    let state = active();
    expect(() => act(state, 'claim', { ticket: 'access' })).toThrow('must be open');
    expect(() => act(state, 'authorize', { ticket: 'access' })).toThrow('role cannot');
    state = act(state, 'authorize', { ticket: 'access' }, owner);
    expect(values(state, 'access')).toMatchObject({ status: 'open', requires_approval: false });
    state = act(state, 'claim', { ticket: 'access' });
    expect(() => act(state, 'approve', { ticket: 'access' }, owner)).toThrow('must be review');
    state = act(state, 'submit', { ticket: 'access', note: 'Prepared a synthetic request, no real access granted.' });
    expect(() => act(state, 'approve', { ticket: 'access' })).toThrow('role cannot');
    state = act(state, 'approve', { ticket: 'access' }, owner);
    expect(() => act(state, 'reopen', { ticket: 'access' })).toThrow('role cannot');
    expect(values(state, 'access').status).toBe('done');
  });
  it('resumes serialized state and lets a different technician work a different ticket', () => {
    let state = act(active(), 'claim', { ticket: 'printer' });
    state = structuredClone(JSON.parse(JSON.stringify(state)));
    state = act(state, 'claim', { ticket: 'wifi' }, colleague);
    state = act(state, 'submit', { ticket: 'wifi', note: 'Synthetic meeting-room signal check passed.' }, colleague);
    state = act(state, 'approve', { ticket: 'wifi' }, owner);
    expect(values(state, 'printer').status).toBe('in_progress');
    expect(values(state, 'wifi')).toMatchObject({ status: 'done', assignee: 'tech-b' });
    expect(state.activity.map(a => a.actorId)).toEqual(['tech-a', 'tech-b', 'tech-b', 'dispatcher']);
  });
  it('invalidates approved rules after work changes, and keeps owner drafts private', () => {
    let state = active();
    const edit = helpdeskChange(state.sources[0].id); edit.initialRecords = {};
    state = command(state, 'evolve.propose', { change: edit });
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve']) state = command(state, type);
    const projected = projectDomain(state, technician);
    if (projected.kind !== 'table') throw new Error('Wrong domain');
    expect(projected.sources).toEqual(state.sources); expect(projected.candidate).toBeNull(); expect(projected.revisions).toEqual([]); expect(projected.program?.evidence).toEqual([]);
    state = act(state, 'claim', { ticket: 'printer' });
    expect(() => command(state, 'evolve.activate')).toThrow();
    expect(values(state).assignee).toBe('tech-a');
  });
});
