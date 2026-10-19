import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tableScenarioSources } from '../src/tabletop/testing/table-scenarios.ts';

/** Exercises real Worker routes and transactions. Identities are explicitly synthetic. */
export async function runGenericApiAcceptance({ origin, actors, output, real }) {
  const report = { startedAt: new Date().toISOString(), provider: real ? 'real-deepseek' : 'synthetic', identities: 'synthetic', googleTwoAccounts: 'NOT_TESTED', checks: [], rooms: [], status: 'RUNNING' };
  const save = () => writeFile(resolve(output, real ? 'live-api-acceptance.json' : 'fixture-api-acceptance.json'), JSON.stringify(report, null, 2));
  const check = (yes, label) => { if (!yes) throw Error(label); report.checks.push(label); console.log('PASS ' + label); };
  const [owner, member] = actors;
  async function api(actor, path, body) {
    const r = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST', headers: { Cookie: `tabletop_local_session=${actor.token}`, Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': actor.csrf }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await r.json(); return { status: r.status, value };
  }
  async function good(actor, path, body) { const r = await api(actor, path, body); if (r.status >= 400) throw Error(`HTTP ${r.status}: ${r.value.errorCode ?? r.value.message}`); return r.value; }
  async function view(actor, id) { return good(actor, `/api/workspaces/${id}`); }
  function envelope(v, type, payload, commandId = randomUUID()) { return { commandId, expectedEpoch: v.epoch, expectedRevision: v.revision, type, payload }; }
  async function command(actor, v, type, payload) { return (await good(actor, `/api/workspaces/${v.id}/commands`, envelope(v, type, payload))).workspace; }
  async function activate(v) {
    for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) {
      v = await command(owner, v, type, {});
      if (type === 'evolve.validate') check(v.domain.candidate?.proof?.passed === true, v.title + ': validated proposal');
    }
    return v;
  }
  async function model(v, prompt) {
    let job = await good(owner, `/api/workspaces/${v.id}/model`, { commandId: randomUUID(), expectedRevision: v.revision, expectedEpoch: v.epoch, prompt, consent: true });
    const deadline = Date.now() + 65_000;
    while (job.status === 'running' && Date.now() < deadline) { await new Promise(r => setTimeout(r, 1000)); job = await good(owner, `/api/workspaces/${v.id}/model/${job.id}`); }
    check(job.status === 'completed', `${v.title}: model completed (${job.message ?? job.status})`);
    v = await view(owner, v.id); check(v.domain.candidate?.status === 'draft', `${v.title}: AI produces draft only`); return activate(v);
  }
  const prompts = {
    equipment: 'Create a usable equipment loan table from this file. For repeatable acceptance use collection equipment; fields name (text), available (boolean), borrower (nullable text). Keep row IDs camera and tripod. Actions borrow and return, each with record parameter item. Both owner and participant may borrow; require available=true, then set available=false and borrower=system actor. Return only when borrower equals system actor; restore available and clear borrower. Ground all records in the file; use exact source evidence.',
    shifts: 'Create a shift-swap table from this file. Use collection people, fields name, seat, slot, available (list); preserve IDs ada, bo, cy. Action swap has record parameters first and second. Owner and participant may swap two different people only starting with their own system seat, and only if both available lists contain their new slot. Swap the slot fields atomically; enforce one person per slot as a unique invariant. Other fields must not change. Ground records/evidence in the source.',
    game: 'Create River Race from this file. Use collection boats with fields seat (text) and score (number, min0 max20). IDs red and blue. Action advance has a record parameter boat and both owner/participant roles. Require own seat and own turn; add exactly 2 points and advance turn. Turn order host, member-1. Start both at zero. Use exact source evidence.',
  };
  try {
    for (const actor of actors) actor.csrf = (await good(actor, '/api/session')).csrfToken;
    for (const name of ['equipment', 'shifts', 'game']) {
      let v = await good(owner, '/api/workspaces', { kind: 'table', title: 'Acceptance ' + name });
      const roomReport = { scenario: name, source: tableScenarioSources[name].filename, history: [] }; report.rooms.push(roomReport);
      v = await command(owner, v, 'table.import', tableScenarioSources[name]);
      v = await model(v, prompts[name]); roomReport.history.push({ event: 'AI rules activated', state: v.domain });
      const invite = await good(owner, `/api/workspaces/${v.id}/invites`, { seat: 'member-1' });
      let participant = await good(member, '/api/invites/redeem', { ticket: invite.ticket });
      check(participant.actor.role === 'participant' && participant.actor.seat === 'member-1', name + ': invitation joined');
      check(participant.domain.sources.length === 0 && participant.domain.revisions.length === 0 && participant.domain.program.evidence.length === 0, name + ': original source and review remain private');
      check((await api(member, `/api/workspaces/${v.id}/commands`, envelope(participant, 'evolve.approve', {}))).status === 403, name + ': participant cannot approve rules');
      v = await view(owner, v.id); participant = await view(member, v.id);
      if (name === 'equipment' || name === 'shifts') {
        const payloads = name === 'equipment'
          ? [{ actionId: 'borrow', inputs: { item: 'camera' } }, { actionId: 'borrow', inputs: { item: 'camera' } }]
          : [{ actionId: 'swap', inputs: { first: 'ada', second: 'bo' } }, { actionId: 'swap', inputs: { first: 'bo', second: 'ada' } }];
        const envelopes = [envelope(v, 'table.act', payloads[0]), envelope(participant, 'table.act', payloads[1])];
        const race = await Promise.all(actors.map((actor, i) => api(actor, `/api/workspaces/${v.id}/commands`, envelopes[i])));
        check(race.filter(r => r.status === 200).length === 1 && race.filter(r => r.status === 409).length === 1, name + ': concurrent writes have exactly one winner');
        const win = race.findIndex(r => r.status === 200), loser = actors[1 - win];
        const duplicate = await good(actors[win], `/api/workspaces/${v.id}/commands`, envelopes[win]); check(duplicate.duplicate === true, name + ': duplicate delivery does not apply twice');
        v = await view(owner, v.id);
        if (name === 'equipment') {
          check(v.domain.records.equipment.find(r => r.id === 'camera').values.available === false, 'equipment: loan persists');
          const loserView = await view(loser, v.id);
          check((await api(loser, `/api/workspaces/${v.id}/commands`, envelope(loserView, 'table.act', { actionId: 'return', inputs: { item: 'camera' } }))).status >= 400, 'equipment: wrong borrower cannot return');
        } else {
          check(v.domain.records.people.find(r => r.id === 'ada').values.slot === 'evening' && v.domain.records.people.find(r => r.id === 'bo').values.slot === 'morning', 'shifts: both assignments changed once');
          check((await api(owner, `/api/workspaces/${v.id}/commands`, envelope(v, 'table.act', { actionId: 'swap', inputs: { first: 'ada', second: 'cy' } }))).status >= 400, 'shifts: unavailable exchange is rejected');
        }
      } else {
        check((await api(member, `/api/workspaces/${v.id}/commands`, envelope(participant, 'table.act', { actionId: 'advance', inputs: { boat: 'blue' } }))).status >= 400, 'game: wrong turn is rejected');
        v = await command(owner, v, 'table.act', { actionId: 'advance', inputs: { boat: 'red' } });
        if (real) v = await model(v, 'Change advance to add exactly 3 points per move instead of 2. Keep collection definitions byte-for-byte, same action and parameter IDs, existing turn order, and all ownership/turn restrictions. initialRecords must be empty. Preserve scores. Record the owner-requested three-point change as an explicit assumption and retain original source evidence.');
        else {
          const change = { kind: 'table', program: structuredClone(v.domain.program), initialRecords: {} }; change.program.actions.find(a => a.id === 'advance').effects[0].value = { literal: 3 };
          v = await command(owner, v, 'evolve.propose', { change }); v = await activate(v);
        }
        check(v.domain.records.boats.find(r => r.id === 'red').values.score === 2 && v.domain.turn === 'member-1', 'game: rule edit preserves score and turn');
        participant = await view(member, v.id); await command(member, participant, 'table.act', { actionId: 'advance', inputs: { boat: 'blue' } });
        v = await view(owner, v.id); check(v.domain.records.boats.find(r => r.id === 'blue').values.score === 3, 'game: participant uses new scoring rule');
      }
      const resumed = await view(member, v.id), directory = await good(member, '/api/session');
      check(JSON.stringify(resumed.domain.records) === JSON.stringify(v.domain.records) && directory.workspaces.some(w => w.id === v.id), name + ': shared state reloads and room remains discoverable');
      roomReport.history.push({ event: 'Actions and reload complete', state: v.domain }); await save();
    }
    report.status = 'PASS';
  } catch (error) { report.status = 'FAIL'; report.error = error instanceof Error ? error.message : 'Acceptance failed'; throw error; }
  finally { report.completedAt = new Date().toISOString(); await save(); }
}
