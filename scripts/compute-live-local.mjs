// Opt-in: synthetic data only, real generation and isolated execution; never deploys.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { DeepSeekChangeProvider } from '../server/providers/deepseek-changes.ts';
import { createNodeComputeRunner } from '../server/compute-runner.ts';
import { computeModuleOrder, resolveComputeInput, validateComputeOutputs } from '../src/tabletop/shared/table-compute.ts';
import { COMPUTE_RUNTIME_PROFILE, COMPUTE_RUNTIME_PROFILES } from '../src/tabletop/shared/compute-runtime-profiles.ts';

if (!process.env.TABLETOP_CREDENTIAL_FILE) throw new Error('Set TABLETOP_CREDENTIAL_FILE to the existing ignored runtime file.');
const credentials = parseEnv(await readFile(process.env.TABLETOP_CREDENTIAL_FILE, 'utf8'));
if (!credentials.DEEPSEEK_KEY) throw new Error('The configured provider key is not ready.');
const output = resolve('test-results/f066-live');
await mkdir(output, { recursive: true });
const text = 'order_id,branch,amount,quantity\na,BKK,100,2\nb,CNX,50,1\n';
const sourceId = 'source_' + createHash('sha256').update(text).digest('hex').slice(0, 32);
const started = Date.now();
let lastProgressAt = started;
const provider = new DeepSeekChangeProvider({ apiKey: credentials.DEEPSEEK_KEY, timeoutMs: 180_000 });
const result = await provider.propose({ kind: 'table',
  prompt: 'Create a reusable sales preparation tool from the attached synthetic CSV. Populate a source-grounded orders table with its two rows. Use one Python/pandas compute module bound to that orders collection and a fixed numeric discount input 0.1. Clean branch whitespace, convert numeric values, deduplicate order_id, discard quantity<=0, multiply amount by quantity, apply discount, round, group by branch and sort. Return a number total and a typed summary table. Link the summary output to a separate empty summary collection; show the total in a metric using computeResult. Initial total must be 225. No actions are needed. Explain what it does in plain English. This custom reusable code path is explicitly requested, not a chat answer or sample constant.',
  sources: [{ id: sourceId, filename: 'synthetic-sales.csv', text }], program: null, turn: null, records: {},
  computeCapabilities: { profile: COMPUTE_RUNTIME_PROFILE, runtimes: ['javascript', 'python'], pythonLibraries: [...COMPUTE_RUNTIME_PROFILES.python.libraries] },
}, new AbortController().signal, progress => {
  if (Date.now() - lastProgressAt >= 10_000) {
    lastProgressAt = Date.now();
    process.stdout.write(JSON.stringify({ stage: 'generation', receivedChars: progress.receivedChars }) + '\n');
  }
}).catch(async error => {
  await writeFile(resolve(output, 'failure.json'), JSON.stringify({ code: error.code ?? error.name, issues: error.issues ?? [], elapsedMs: Date.now() - started }, null, 2));
  if (typeof error.previousOutput === 'string') await writeFile(resolve(output, 'rejected-output.txt'), error.previousOutput);
  throw new Error(`Live generation rejected: ${(error.issues ?? [error.code ?? error.name]).join('; ')}`);
});
if (!('change' in result) || result.change.kind !== 'table' || !result.change.program.compute?.modules.length) throw new Error('The provider did not generate a reusable module.');
const change = result.change;
const context = { collections: change.program.collections, records: change.initialRecords, sources: [{ id: sourceId, text, filename: 'synthetic-sales.csv', sha256: createHash('sha256').update(text).digest('hex'), createdAt: Date.now() }], outputs: new Map(), actor: { role: 'owner', seat: 'host' }, dataRevision: 1 };
const runs = [];
for (const module of computeModuleOrder(change.program.compute)) {
  const inputs = Object.fromEntries(module.inputs.map(port => [port.id, { type: port.type, value: resolveComputeInput(port, context) }]));
  const request = { moduleId: module.id, moduleVersion: module.version, runtime: module.runtime, runtimeProfile: module.runtimeProfile ?? COMPUTE_RUNTIME_PROFILE, source: module.source, inputs, outputs: module.outputs };
  const runner = createNodeComputeRunner();
  const first = validateComputeOutputs(module, await runner.run(request));
  const secondRequest = structuredClone(request);
  for (const input of Object.values(secondRequest.inputs)) if (input.type === 'table') for (const row of input.value.rows) for (const key of Object.keys(row)) if (row[key] === 100) row[key] = 200;
  const second = validateComputeOutputs(module, await runner.run(secondRequest));
  if (!Object.values(first.outputs).includes(225) || !Object.values(second.outputs).includes(405)) throw new Error('The generated code did not recompute the expected totals (225 and 405).');
  runs.push({ moduleId: module.id, runtime: module.runtime, first: first.outputs, second: second.outputs });
  for (const [id, value] of Object.entries(first.outputs)) context.outputs.set(`${module.id}.${id}`, value);
}
const report = { providerCalls: 1, syntheticOnly: true, elapsedMs: Date.now() - started, usage: result.usage, runs };
await writeFile(resolve(output, 'generated.json'), JSON.stringify(change, null, 2));
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify({ passed: true, providerCalls: 1, modules: runs.length, runtimes: runs.map(run => run.runtime), elapsedMs: report.elapsedMs }) + '\n');
