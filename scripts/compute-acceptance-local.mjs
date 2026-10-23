// Controlled post-deploy pack cases run through real HTTP authority + disposable local storage.
// Faults never reach hosted rooms. Generated code executes in isolates/Docker, never this host.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startServer } from '../server/start.ts';
import { createPGliteDatabase } from '../server/database.ts';
import { createNodeComputeRunner } from '../server/compute-runner.ts';
import { evaluateGenerativeCanvas } from '../src/tabletop/runtime/generative/evaluator.ts';

const output = resolve('test-results/post-deploy/compute-controlled-local');
await mkdir(output, { recursive: true });
const faults = JSON.parse(await readFile('docs/testing/f066-post-deploy/controlled-faults.json', 'utf8'));
const realRunner = createNodeComputeRunner();
let gate;
let started;
let release;
const executions = [];
const runner = { async run(request, signal) {
  executions.push({ module: request.moduleId, runtime: request.runtime, version: request.moduleVersion });
  if (gate) { started?.(); await gate; }
  return realRunner.run(request, signal);
} };
const database = await createPGliteDatabase(':memory:');
const server = await startServer({ environment: 'local', host: '127.0.0.1', port: 0, database, computeRunner: runner });
const origin = `http://${server.host}:${server.port}`;
let cookie = '';
let csrf = '';
let workspace;
const cases = [];
async function api(path, body) {
  const response = await fetch(origin + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { origin, cookie, 'x-csrf-token': csrf, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, body: await response.json() };
}
async function current() {
  const response = await api(`/api/workspaces/${workspace.id}`);
  assert.equal(response.status, 200);
  workspace = response.body;
  return workspace;
}
async function command(type, payload, accepted = true) {
  await current();
  const response = await api(`/api/workspaces/${workspace.id}/commands`, { commandId: randomUUID(), expectedRevision: workspace.revision, expectedEpoch: workspace.epoch, type, payload });
  if (accepted) assert.equal(response.status, 200, `${type}: ${JSON.stringify(response.body)}`);
  if (response.body.workspace) workspace = response.body.workspace;
  return response;
}
async function until(predicate) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await current();
    if (predicate(workspace.domain)) return;
    await new Promise(resolveWait => setTimeout(resolveWait, 750));
  }
  throw new Error('Controlled calculation did not reach the expected state.');
}
function latest(state) {
  return [...(state.computeRuns ?? [])].sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0))[0];
}
function value(run, id = 'total') { return run?.outputs?.find(port => port.outputId === id)?.value; }
function metric() {
  const state = workspace.domain;
  return evaluateGenerativeCanvas(state.program.canvas, {
    program: state.program, records: state.records, computeRuns: state.computeRuns,
    dataRevision: state.dataRevision, ruleRevision: state.ruleRevision,
    actor: workspace.actor.actorId, turn: state.turn,
  })[0].value;
}
const rows = (price = 25, quantity = 5) => [{ quantity: 3, unit_price: price }, { quantity, unit_price: 30 }];
function module(source, runtime = 'javascript', outputId = 'total') {
  return { id: 'totals', name: 'Controlled total', description: 'Synthetic acceptance calculation.', runtime,
    runtimeProfile: 'tabletop-compute-1', version: 1, source,
    inputs: [{ id: 'sales', label: 'Sales', type: 'table', binding: { kind: 'collection', collectionId: 'sales' } }],
    outputs: [{ id: outputId, label: outputId, type: 'number' }] };
}
const totalSource = 'export default inputs => ({total:inputs.sales.rows.reduce((n,row)=>n+row.quantity*row.unit_price,0)});';
function change(computeModule) {
  return { kind: 'table', program: {
    version: 1, title: 'Controlled compute QA', description: 'Disposable synthetic data only.',
    collections: [{ id: 'sales', title: 'Sales', fields: [
      { id: 'quantity', label: 'Quantity', type: 'number', required: true }, { id: 'unit_price', label: 'Price', type: 'number', required: true },
    ] }], actions: [], invariants: [], turnOrder: ['host'], evidence: [], assumptions: [],
    compute: { version: 1, modules: [computeModule] },
    canvas: { version: 1, views: [{ id: 'metric', title: 'Result', kind: 'metric', value: { op: 'computeResult', moduleId: computeModule.id, outputId: computeModule.outputs[0].id } }] },
  }, initialRecords: { sales: rows().map((values, index) => ({ id: `sale_${index}`, values })) } };
}
async function room(computeModule = module(totalSource)) {
  const response = await api('/api/workspaces', { kind: 'table' });
  assert.equal(response.status, 201);
  workspace = response.body;
  await command('evolve.propose', { change: change(computeModule) });
  await command('evolve.autoApply', {});
}
async function holdNext() {
  let notify;
  const beginning = new Promise(resolveStarted => { notify = resolveStarted; });
  gate = new Promise(resolveGate => { release = resolveGate; });
  started = notify;
  return { beginning, finish() { const done = release; gate = undefined; started = undefined; release = undefined; done?.(); } };
}
function passed(id, evidence) { cases.push({ id: `F066-PD-${id}`, status: 'PASS', layer: 'local HTTP authority + real isolate/Docker', evidence }); console.log(`PASS F066-PD-${id}`); }
try {
  // Retain only this disposable local guest session's own cookie.
  const response = await fetch(origin + '/api/session', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Controlled QA owner' }) });
  assert.equal(response.status, 200);
  cookie = response.headers.get('set-cookie').split(';')[0];
  csrf = (await response.json()).csrfToken;

  await room();
  await until(state => latest(state)?.status === 'succeeded' && value(latest(state)) === 225);
  const hold = await holdNext();
  await command('table.importRows', { collection: 'sales', rows: rows(35, 10), mode: 'replace' });
  await hold.beginning;
  await current();
  const pendingId = latest(workspace.domain).runId;
  await command('table.importRows', { collection: 'sales', rows: rows(35, 11), mode: 'replace' });
  assert.equal(metric(), null, 'A stale total must not appear as the current metric.');
  hold.finish();
  await until(state => latest(state)?.status === 'succeeded' && value(latest(state)) === 435);
  assert.equal(workspace.domain.computeRuns.find(run => run.runId === pendingId).status, 'stale');
  assert.equal(metric(), 435);
  passed('022', { previousRun: 'stale', pendingMetric: null, currentTotal: 435, raw: workspace.domain.records.sales.map(row => row.values) });

  const repeated = await holdNext();
  await command('table.compute.run', { moduleId: 'totals' });
  await repeated.beginning;
  await current();
  const count = workspace.domain.computeRuns.length;
  const rejected = await command('table.compute.run', { moduleId: 'totals' }, false);
  assert.notEqual(rejected.status, 200);
  assert.equal(rejected.body.errorCode, 'TABLE_COMPUTE_BUSY');
  await current();
  assert.equal(workspace.domain.computeRuns.length, count);
  repeated.finish();
  await until(state => latest(state)?.status === 'succeeded');
  passed('024', { rejected: rejected.body.errorCode, onePendingRun: true });

  for (const [id, fault] of [['023', 'throw-error'], ['033', 'wrong-output-type'], ['034', 'non-finite-number']]) {
    await room();
    await until(state => latest(state)?.status === 'succeeded' && value(latest(state)) === 225);
    const raw = structuredClone(workspace.domain.records);
    const revised = change({ ...module(faults.javascript[fault]), version: 2 });
    revised.initialRecords = {};
    await command('evolve.propose', { change: revised });
    await command('evolve.autoApply', {});
    await until(state => latest(state)?.status === 'failed');
    assert.deepEqual(workspace.domain.records, raw);
    assert.equal(latest(workspace.domain).outputs, undefined);
    assert.equal(metric(), null, 'A prior module version must not supply the current metric after failure.');
    passed(id, { status: latest(workspace.domain).status, errorCode: latest(workspace.domain).errorCode, sourceRowsUnchanged: true, currentOutputsAbsent: true, metric: null });
  }

  await room();
  await until(state => latest(state)?.status === 'succeeded');
  const before = structuredClone(workspace.domain.program);
  const cycle = change(module(totalSource));
  cycle.initialRecords = {};
  cycle.program.compute.modules = [
    { ...module('export default inputs => ({total:inputs.value});'), id: 'first', inputs: [{ id: 'value', label: 'Value', type: 'number', binding: { kind: 'result', moduleId: 'second', outputId: 'total' } }] },
    { ...module('export default inputs => ({total:inputs.value});'), id: 'second', inputs: [{ id: 'value', label: 'Value', type: 'number', binding: { kind: 'result', moduleId: 'first', outputId: 'total' } }] },
  ];
  cycle.program.canvas.views[0].value.moduleId = 'first';
  const beforeCycleExecutions = executions.length;
  const invalid = await command('evolve.propose', { change: cycle }, false);
  assert.notEqual(invalid.status, 200);
  assert.match(JSON.stringify(invalid.body), /cycle|cyclic|circular/iu);
  assert.equal(executions.length, beforeCycleExecutions);
  await current();
  assert.deepEqual(workspace.domain.program, before);
  passed('036', { cycleRejected: true, rejection: invalid.body.errorCode, message: invalid.body.message, activeProgramUnchanged: true, executionsAdded: 0 });

  for (const runtime of ['javascript', 'python']) {
    await room(module(faults[runtime]['fresh-counter'], runtime, 'counter'));
    await until(state => latest(state)?.status === 'succeeded');
    const results = [value(latest(workspace.domain), 'counter')];
    for (let index = 0; index < 2; index += 1) {
      await command('table.compute.run', { moduleId: 'totals' });
      await until(state => latest(state)?.status === 'succeeded');
      results.push(value(latest(workspace.domain), 'counter'));
    }
    assert.deepEqual(results, [1, 1, 1]);
    assert.equal(new Set(workspace.domain.computeRuns.map(run => run.runId)).size, 3);
    cases.push({ id: 'F066-PD-042', runtime, status: 'PASS', layer: 'local HTTP authority + real isolate/Docker', evidence: { results, distinctRunIds: new Set(workspace.domain.computeRuns.map(run => run.runId)).size === 3 } });
    console.log(`PASS F066-PD-042 ${runtime}`);
  }
  await writeFile(resolve(output, 'results.json'), JSON.stringify({ syntheticOnly: true, hosted: false, cases, executions }, null, 2));
} catch (error) {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ message: String(error), cases, runs: workspace?.domain?.computeRuns, executions }, null, 2));
  throw error;
} finally {
  release?.();
  await server.close();
  await database.close();
}
