// Disposable loopback-only acceptance fixture for additive table evolution.
// The worker uses synthetic accounts and local D1/SQLite Durable Objects only.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';

const originPort = Number(process.env.CANVAS_EVOLUTION_PORT ?? '4317');
if (!Number.isInteger(originPort) || originPort < 1024 || originPort > 65535) throw Error('Invalid loopback port');
const origin = `http://127.0.0.1:${originPort}`;
const real = process.argv.includes('--real-ai');
const serve = process.argv.includes('--serve');
const automatic = process.argv.includes('--auto');
if (serve === automatic) throw Error('Choose exactly one mode: --serve or --auto.');
const providerRequestCap = Number(process.env.CANVAS_EVOLUTION_AI_REQUEST_CAP ?? '6');
if (!Number.isInteger(providerRequestCap) || providerRequestCap < 1 || providerRequestCap > 6) {
  throw Error('Canvas evolution provider cap must be between one and six calls.');
}
const envFile = resolve(process.env.TABLETOP_CREDENTIAL_FILE ?? '../.env.deploy.local');
const providerEnv = real ? parseEnv(await readFile(envFile, 'utf8')) : {};
if (real && !providerEnv.DEEPSEEK_KEY) throw Error('DEEPSEEK_KEY is not ready in the configured credential file.');

const output = resolve('test-results/canvas-evolution-local');
await mkdir(output, { recursive: true });
const hash = value => createHash('sha256').update(value).digest('hex');
const csrfFor = token => createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
const actors = ['owner', 'member'].map(role => {
  const token = randomBytes(32).toString('base64url');
  return { id: randomUUID(), name: `F010 fixture ${role}`, role, token, csrf: csrfFor(token) };
});
const publicActors = actors.map(({ role, token }) => ({ role, token }));
const workerScript = await readFile('worker-build/index.js', 'utf8');
await readFile('dist/index.html');

function literal(value) { return { literal: value }; }
function initialProgram() {
  const record = { record: 'invoice', field: 'paid' };
  const action = (id, title, from, to) => ({
    id, title, description: `${title} for one invoice.`, roles: ['owner', 'participant'],
    parameters: [{ id: 'invoice', label: 'Invoice', type: 'record', collection: 'invoices' }],
    conditions: [{ left: record, op: 'eq', right: literal(from), message: from ? 'This invoice is already paid.' : 'This invoice is already unpaid.' }],
    effects: [{ record: 'invoice', field: 'paid', op: 'set', value: literal(to) }],
    requireTurn: false, advanceTurn: false,
  });
  return {
    kind: 'table',
    program: {
      version: 1, title: 'F010 Invoice Register', description: 'Track invoices and payment status.',
      collections: [{ id: 'invoices', title: 'Invoices', fields: [
        { id: 'customer', label: 'Customer', type: 'text', required: true },
        { id: 'amount', label: 'Amount', type: 'number', required: true, min: 0.01, max: 1000000 },
        { id: 'paid', label: 'Paid', type: 'boolean', required: true },
      ] }],
      actions: [action('mark_paid', 'Mark paid', false, true), action('mark_unpaid', 'Mark unpaid', true, false)],
      invariants: [], turnOrder: [], evidence: [], assumptions: [],
    },
    initialRecords: { invoices: [] },
  };
}

function invoiceFormChange(current) {
  const program = structuredClone(current);
  const parameters = [
    { id: 'customer', label: 'Customer', type: 'text' },
    { id: 'amount', label: 'Amount', type: 'number', min: 0.01, max: 1000000 },
  ];
  program.actions.push({
    id: 'create_invoice', title: 'Add invoice', description: 'Add one invoice to the shared register.',
    roles: ['owner', 'participant'], parameters, conditions: [], effects: [],
    creates: [{ collection: 'invoices', values: {
      customer: { input: 'customer' }, amount: { input: 'amount' }, paid: literal(false),
    } }], requireTurn: false, advanceTurn: false,
  }, {
    id: 'sample_invoice', title: 'Add sample invoice', description: 'Add a fictional sample invoice.',
    roles: ['owner', 'participant'], parameters: [], conditions: [], effects: [],
    creates: [{ collection: 'invoices', values: {
      customer: literal('Acme sample supplies'), amount: literal(2400), paid: literal(false),
    } }], requireTurn: false, advanceTurn: false,
  });
  program.canvas ??= { version: 1, views: [] };
  program.canvas.views.push({ id: 'invoice-entry', kind: 'controls', title: 'Invoice entry', relatedTo: { collections: ['invoices'] }, controls: [
    { id: 'new-invoice-form', kind: 'form', label: 'Add invoice', actionId: 'create_invoice', inputs: { customer: { kind: 'control' }, amount: { kind: 'control' } } },
    { id: 'sample-invoice-button', kind: 'button', label: 'Add sample', actionId: 'sample_invoice', inputs: {} },
  ] });
  return { kind: 'table', program, initialRecords: {} };
}

function summaryChange(current) {
  const program = structuredClone(current);
  const invoices = program.collections.find(collection => collection.id === 'invoices');
  invoices.fields.push({ id: 'reference', label: 'Reference', type: 'text', required: true, default: 'LOCAL' });
  program.collections.push({ id: 'review_notes', title: 'Review notes', fields: [
    { id: 'label', label: 'Label', type: 'text', required: true, default: 'Pending review' },
  ] });
  program.canvas ??= { version: 1, views: [] };
  program.canvas.views.push({ id: 'unpaid-total', kind: 'metric', title: 'Unpaid invoice total', format: 'number', relatedTo: { collections: ['invoices'] }, value: {
    op: 'aggregate', fn: 'sum', source: { op: 'collection', id: 'invoices' }, as: 'invoice',
    where: { op: 'compare', fn: 'eq', left: { op: 'field', record: 'invoice', field: 'paid' }, right: { op: 'literal', value: false } },
    value: { op: 'field', record: 'invoice', field: 'amount' },
  } });
  return { kind: 'table', program, initialRecords: {} };
}

function providerReply(content) {
  return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 40 } });
}

const fixtureEntry = `import application, { Room as ApplicationRoom } from './application.js'; export { Billing } from './application.js';
const actors=${JSON.stringify(publicActors)};
export class Room extends ApplicationRoom { }
export default {async fetch(request,env,ctx) {
 const url=new URL(request.url);
 if(url.origin!==${JSON.stringify(origin)}) return new Response('Loopback fixture only',{status:403});
 if(url.pathname==='/__fixture') return new Response('<h1>Local test only: synthetic accounts</h1><p>These accounts do not prove Google login.</p><form method="post" action="/__fixture/login"><button name="actor" value="owner">Use fixture owner</button><button name="actor" value="member">Use fixture member</button></form>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(url.pathname==='/__fixture/login' && request.method==='POST') { if(request.headers.get('Origin')!==url.origin)return new Response('Bad origin',{status:403}); const form=await request.formData(); const actor=actors.find(a=>a.role===form.get('actor')); if(!actor)return new Response('Unknown fixture',{status:400}); return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':'tabletop_local_session='+actor.token+'; Path=/; HttpOnly; SameSite=Lax'}}); }
 return application.fetch(request,env,ctx);
}};`;

let providerCalls = 0;
const receipts = [];
const saveReceipts = () => writeFile(resolve(output, 'ai-receipts.json'), JSON.stringify({
  localFixture: true, syntheticAccounts: true, realProvider: real, maximumRequests: providerRequestCap,
  receipts,
}, null, 2));
const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port: originPort, log: new Log(LogLevel.ERROR), workers: [{
    name: 'canvas-evolution-disposable-local',
    modules: [
      { type: 'ESModule', path: resolve(output, 'fixture.js'), contents: fixtureEntry },
      { type: 'ESModule', path: resolve(output, 'application.js'), contents: workerScript },
    ],
    compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, BILLING: { className: 'Billing', useSQLite: true } },
    bindings: {
      PUBLIC_ORIGIN: origin, GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
      DEEPSEEK_KEY: real ? providerEnv.DEEPSEEK_KEY : 'synthetic-provider-key',
      // F064: the synthetic provider answers one scripted draft call, so the research step is off
      // there; a real run keeps it on because that is what it is accepting.
      ...(real ? {} : { TABLE_WEB_SEARCH: 'off' }),
      AI_MONTHLY_BUDGET_MICRO_USD: '200000', AI_DAILY_BUDGET_MICRO_USD: '200000',
    },
    outboundService: async request => {
      if (request.url !== 'https://api.deepseek.com/chat/completions') throw Error('External endpoint blocked by fixture');
      if (++providerCalls > providerRequestCap) {
        receipts.push({ call: providerCalls, status: 429, blockedByLocalCap: true });
        await saveReceipts();
        return Response.json({ error: 'Local acceptance request cap reached' }, { status: 429 });
      }
      const body = await request.clone().json();
      if (real) {
        let response;
        const startedAt = Date.now();
        try {
          response = await fetch(request.url, {
            method: request.method,
            headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json' },
            body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(35_000),
          });
        } catch (error) {
          receipts.push({ call: providerCalls, status: 502, elapsedMs: Date.now() - startedAt, transportFailure: error?.name });
          await saveReceipts();
          return Response.json({ error: 'Local provider transport failed' }, { status: 502 });
        }
        const result = await response.clone().json().catch(() => ({}));
        const userContent = body.messages?.find(message => message.role === 'user')?.content;
        let repairIssues;
        try { repairIssues = JSON.parse(userContent).repair?.issues; } catch { /* No repair context. */ }
        receipts.push({ call: providerCalls, status: response.status, elapsedMs: Date.now() - startedAt,
          usage: result.usage, model: result.model, finishReason: result.choices?.[0]?.finish_reason,
          repairIssues, output: result.choices?.[0]?.message?.content });
        await saveReceipts();
        return response;
      }
      const userContent = body.messages?.find(message => message.role === 'user')?.content;
      let input;
      try { input = JSON.parse(userContent); } catch { throw Error('Fixture could not read the typed model request.'); }
      let reply;
      if (input.kind === 'table-assistant') {
        const participant = input.context?.role === 'participant';
        reply = participant
          ? { kind: 'explanation', text: 'Only the owner can prepare a table change.', references: [] }
          : { kind: 'build-request', text: 'I can prepare that table change for the owner to review.' };
      } else if (input.kind === 'table' && input.program) {
        reply = /summary|collection|card|default/i.test(input.prompt)
          ? summaryChange(input.program)
          : invoiceFormChange(input.program);
      } else {
        throw Error('Fixture received an unsupported provider request.');
      }
      receipts.push({ call: providerCalls, status: 200, model: 'deepseek-flash-fixture', synthetic: true });
      await saveReceipts();
      return providerReply(reply);
    },
    assets: { directory: resolve('dist'), binding: 'ASSETS', run_worker_first: ['/api/*', '/__fixture*', '/healthz', '/readyz', '/internal/*'], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  }],
}));

async function fixtureRequest(actor, path, body) {
  const response = await fetch(origin + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Cookie: `tabletop_local_session=${actor.token}`, Origin: origin,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': actor.csrf }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw Error(`Local fixture setup failed with HTTP ${response.status}.`);
  return value;
}

async function seedTable() {
  const [owner, member] = actors;
  const workspace = await fixtureRequest(owner, '/api/workspaces', { kind: 'table' });
  let current = workspace;
  async function command(type, payload) {
    const acknowledgement = await fixtureRequest(owner, `/api/workspaces/${current.id}/commands`, {
      commandId: randomUUID(), expectedEpoch: current.epoch, expectedRevision: current.revision, type, payload,
    });
    current = acknowledgement.workspace;
  }
  await command('evolve.propose', { change: initialProgram() });
  for (const type of ['evolve.simulate', 'evolve.validate', 'evolve.approve', 'evolve.activate']) await command(type, {});
  const invite = await fixtureRequest(owner, `/api/workspaces/${current.id}/invites`, { seat: 'member-1' });
  await fixtureRequest(member, '/api/invites/redeem', { ticket: invite.ticket });
  for (const actor of actors) {
    let discoverable = false;
    for (let attempt = 0; attempt < 30 && !discoverable; attempt += 1) {
      const session = await fixtureRequest(actor, '/api/session');
      discoverable = session.workspaces.some(item => item.id === current.id);
      if (!discoverable) await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!discoverable) throw Error('The local table did not become available in the synthetic account directory.');
  }
  return { workspaceId: current.id, programTitle: current.domain.program.title };
}

await mf.ready;
const db = await mf.getD1Database('DB');
for (const path of ['cloudflare/migrations/0001_identity.sql', 'cloudflare/migrations/0002_table_kind.sql']) {
  const sql = await readFile(path, 'utf8');
  await db.batch(sql.replace(/^--.*$/gmu, '').split(';').map(part => part.trim()).filter(Boolean).map(part => db.prepare(part)));
}
const now = Date.now();
for (const actor of actors) await db.batch([
  db.prepare('INSERT INTO users(id,provider_sub,email,name,is_admin,created_at) VALUES(?,?,?,?,?,?)')
    .bind(actor.id, `fixture:${actor.id}`, `${actor.role}@example.test`, actor.name, 0, now),
  db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)')
    .bind(hash(actor.token), hash(actor.csrf), actor.id, now, now, now + 86_400_000),
]);

try {
  const seeded = await seedTable();
  const runtime = { ready: true, origin, login: `${origin}/__fixture`, accounts: 'two synthetic contexts', googleOAuth: 'not tested', provider: real ? 'real DeepSeek with local call cap' : 'synthetic provider', workspaceId: seeded.workspaceId };
  if (automatic) {
    const { runCanvasEvolutionBrowser } = await import('../tests/canvas-evolution-browser.mjs');
    const report = await runCanvasEvolutionBrowser({ origin, actors, workspaceId: seeded.workspaceId, programTitle: seeded.programTitle, output, real });
    await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...runtime, ...report }, null, 2));
    console.log(JSON.stringify({ ...runtime, status: report.status, checks: report.checks.length, report: resolve(output, 'report.json') }));
  } else {
    console.log(JSON.stringify(runtime));
    process.on('SIGINT', async () => { await mf.dispose(); process.exit(0); });
    await new Promise(() => {});
  }
} finally {
  if (automatic) await mf.dispose();
}
