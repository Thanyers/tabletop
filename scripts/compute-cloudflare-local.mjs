// Real Workers Container API smoke, synthetic inputs only. Never deploys or loads credentials.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

if (process.platform === 'win32') {
  console.error('SKIPPED: Wrangler Container API local development requires Linux/macOS; use the pipeline Linux runner.');
  process.exit(2);
}

const directory = resolve('test-results/compute-cloudflare');
await mkdir(directory, { recursive: true });
await writeFile(resolve(directory, 'worker.ts'), `
import { DurableObject } from 'cloudflare:workers';
import { createCloudflareComputeRunner } from '../../cloudflare/compute-runner.ts';
export class ComputeFixture extends DurableObject {
  async fetch(request) {
    const runner = createCloudflareComputeRunner({ loader: this.env.COMPUTE_LOADER, container: this.ctx.container });
    try { return Response.json(await runner.run(await request.json())); }
    catch (error) { return Response.json({ error: error.message }, { status: 422 }); }
  }
}
export default { async fetch(request, env) {
  if (new URL(request.url).pathname === '/healthz') return new Response('ok');
  return env.FIXTURE.getByName('synthetic-only').fetch(request);
} };
`);
const config = {
  name: 'compute-local-fixture', main: './worker.ts', compatibility_date: '2026-10-18', compatibility_flags: ['nodejs_compat'],
  worker_loaders: [{ binding: 'COMPUTE_LOADER' }],
  durable_objects: { bindings: [{ name: 'FIXTURE', class_name: 'ComputeFixture' }] },
  migrations: [{ tag: 'v1', new_sqlite_classes: ['ComputeFixture'] }],
  containers: [{ class_name: 'ComputeFixture', scheduling_policy: 'durable_object', images: { compute: { dockerfile: '../../compute/Dockerfile' } } }],
};
await writeFile(resolve(directory, 'wrangler.json'), JSON.stringify(config, null, 2));
const port = Number(process.env.TABLETOP_COMPUTE_TEST_PORT ?? 8796);
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--config', resolve(directory, 'wrangler.json'), '--ip', '127.0.0.1', '--port', String(port), '--persist-to', resolve(directory, 'state')], {
  stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
});
let log = '';
child.stdout.on('data', chunk => { log = (log + chunk).slice(-64_000); });
child.stderr.on('data', chunk => { log = (log + chunk).slice(-64_000); });
const checks = [];
const request = {
  moduleId: 'synthetic', moduleVersion: 1, runtimeProfile: 'tabletop-compute-1', runtime: 'javascript',
  inputs: { left: { type: 'number', value: 3 }, right: { type: 'number', value: 7 } },
  outputs: [{ id: 'total', label: 'Total', type: 'number' }],
  source: 'export default inputs => ({total: inputs.left + inputs.right});',
};
async function run(payload) {
  const response = await fetch(origin + '/run', { method: 'POST', body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000) });
  const result = await response.json();
  assert.equal(response.status, 200, JSON.stringify(result));
  return result.outputs;
}
try {
  const deadline = Date.now() + 120_000;
  while (true) {
    try { if ((await fetch(origin + '/healthz')).ok) break; } catch { /* cold start */ }
    if (Date.now() > deadline || child.exitCode !== null) throw new Error('Local Workers fixture did not start.');
    await new Promise(resolveWait => setTimeout(resolveWait, 500));
  }
  assert.equal((await run(request)).total, 10);
  assert.equal((await run({ ...request, inputs: { left: { type: 'number', value: 40 }, right: { type: 'number', value: 2 } } })).total, 42);
  checks.push('Worker Loader runs reusable JavaScript with new inputs: 10 -> 42');
  console.log('PASS ' + checks.at(-1));
  const python = { ...request, runtime: 'python', source: `import io, pandas as pd, numpy as np
from scipy.stats import linregress
import openpyxl
from dateutil.parser import parse
def compute(inputs):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.append([inputs["left"], inputs["right"]])
    memory = io.BytesIO()
    workbook.save(memory)
    memory.seek(0)
    values = next(openpyxl.load_workbook(memory).active.values)
    assert float(np.mean([2,4,6,8])) == 5
    assert float(linregress([1,2,3,4], [3,5,7,9]).slope) == 2
    assert (parse("2026-10-08") - parse("2026-10-01")).days == 7
    return {"total":float(pd.Series(values).sum())}
` };
  assert.equal((await run(python)).total, 10);
  assert.equal((await run({ ...python, inputs: { left: { type: 'number', value: 40 }, right: { type: 'number', value: 2 } } })).total, 42);
  checks.push('Room-managed Container API executes pandas/numpy/scipy/openpyxl/dateutil: 10 -> 42');
  console.log('PASS ' + checks.at(-1));
  await writeFile(resolve(directory, 'result.json'), JSON.stringify({ passed: true, checks, syntheticOnly: true, target: 'local Workers emulator; not hosted acceptance' }, null, 2));
} finally {
  child.kill();
  await writeFile(resolve(directory, 'runtime.log'), log);
}
