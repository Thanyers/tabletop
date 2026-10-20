// Disposable loopback-only UI/AI fixture. Never bundled with the production Worker.
// Accounts here are synthetic. Actual Google two-account acceptance is a separate gate.
import { Miniflare, Log, LogLevel, convertV4MiniflareOptions } from 'miniflare';
import { readFile, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { resolve } from 'node:path';
import { tableScenarioSources, equipmentChange, shiftsChange, gameChange } from '../src/tabletop/testing/table-scenarios.ts';

const port = Number(process.env.GENERIC_FIXTURE_PORT ?? '4313');
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Invalid loopback port');
const origin = `http://127.0.0.1:${port}`;
const real = process.argv.includes('--real-ai');
const env = real ? parseEnv(await readFile(resolve(process.env.TABLETOP_CREDENTIAL_FILE ?? '../.env.deploy.local'), 'utf8')) : {};
if (real && !env.DEEPSEEK_KEY) throw Error('DEEPSEEK_KEY is not ready');
const selectedCase = process.env.GENERATIVE_CASE;
if (selectedCase && !['cafe', 'shadow', 'water'].includes(selectedCase)) throw Error('Unknown generative acceptance case');
const output = resolve(process.argv.includes('--generative-auto') ? `test-results/generative-live${selectedCase ? `-${selectedCase}` : ''}` : 'test-results/generic-table-local');
await mkdir(output, { recursive: true });
// Preserve each previous trial, including rejected live proposals, before a rerun.
const archive = resolve(output, 'runs', new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(archive, { recursive: true });
for (const name of ['live-api-acceptance.json', 'live-ai-receipts.json', 'fixture-api-acceptance.json', 'report.json', 'cafe-generated.json', 'shadow-generated.json', 'water-generated.json']) {
  try { await copyFile(resolve(output, name), resolve(archive, name)); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
for (const source of Object.values(tableScenarioSources)) await writeFile(resolve(output, source.filename), source.text);
const hash = text => createHash('sha256').update(text).digest('hex');
const csrf = token => createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
const actors = ['owner', 'member'].map((role, i) => ({ id: randomUUID(), name: `Fixture ${role}`, role, token: String.fromCharCode(69 + i).repeat(43) }));
const workerScript = await readFile('worker-build/index.js', 'utf8');
const fixtureEntry = `import application, { Room as ApplicationRoom } from './application.js'; export { Billing } from './application.js';
export class Room extends ApplicationRoom {
 async fetch(request) {
  if(new URL(request.url).pathname==='/__fixture/job-status') return Response.json([...this.ctx.storage.sql.exec('SELECT status,data FROM model_jobs')].map(row=>({status:row.status,failure:JSON.parse(row.data).failure??null})));
  return super.fetch(request);
 }
}
const actors=${JSON.stringify(actors.map(a => ({role:a.role,token:a.token})))};
export default {async fetch(request,env,ctx) {
 const url=new URL(request.url);
 if(url.origin!==${JSON.stringify(origin)}) return new Response('Loopback fixture only',{status:403});
 if(url.pathname==='/__fixture') return new Response('<h1>Local test only: synthetic accounts</h1><p>These accounts do not prove Google login.</p><form method="post" action="/__fixture/login"><button name="actor" value="owner">Use fixture owner</button><button name="actor" value="member">Use fixture member</button></form>',{headers:{'Content-Type':'text/html; charset=utf-8'}});
 if(url.pathname==='/__fixture/login' && request.method==='POST') { if(request.headers.get('Origin')!==url.origin)return new Response('Bad origin',{status:403}); const form=await request.formData(); const actor=actors.find(a=>a.role===form.get('actor')); if(!actor)return new Response('Unknown fixture',{status:400}); return new Response(null,{status:303,headers:{Location:'/', 'Set-Cookie':'tabletop_local_session='+actor.token+'; Path=/; HttpOnly; SameSite=Lax'}}); }
 return application.fetch(request,env,ctx);
}};`;
let providerCalls = 0;
const aiReceipts = [];
const mf = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port, log: new Log(LogLevel.ERROR), workers: [{
    name: 'generic-table-disposable-local',
    modules: [{ type: 'ESModule', path: resolve(output, 'fixture.js'), contents: fixtureEntry }, { type: 'ESModule', path: resolve(output, 'application.js'), contents: workerScript }],
    compatibilityDate: '2026-10-18', compatibilityFlags: ['nodejs_compat'],
    d1Databases: ['DB'], durableObjects: { ROOMS: { className: 'Room', useSQLite: true }, BILLING: { className: 'Billing', useSQLite: true } },
    bindings: { PUBLIC_ORIGIN: origin, GOOGLE_OAUTH_CLIENT_ID: 'synthetic-client', GOOGLE_OAUTH_CLIENT_SECRET: 'synthetic-secret',
      DEEPSEEK_KEY: real ? env.DEEPSEEK_KEY : 'synthetic-provider-key', AI_MONTHLY_BUDGET_MICRO_USD: '200000', AI_DAILY_BUDGET_MICRO_USD: '200000' },
    outboundService: async request => {
      if (request.url !== 'https://api.deepseek.com/chat/completions') throw Error('External endpoint blocked by fixture');
      if (++providerCalls > 6) return Response.json({error:'Local acceptance request cap reached'}, {status:429});
      const body = await request.clone().json();
      if (real) {
        // Miniflare's Request class is separate from Node's built-in fetch.
        let response;
        const startedAt = Date.now();
        try {
          response = await fetch(request.url, { method: request.method, headers: { authorization: request.headers.get('authorization'), 'content-type': 'application/json' }, body: JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(35_000) });
        } catch (error) {
          console.log(JSON.stringify({ localTransportFailure: error?.name, causeCode: error?.cause?.code }));
          return Response.json({ error: 'Local provider transport failed' }, { status: 502 });
        }
        const receipt = await response.clone().json().catch(() => ({}));
        aiReceipts.push({ call: providerCalls, status: response.status, elapsedMs: Date.now() - startedAt, usage: receipt.usage, model: receipt.model,
          output: receipt.choices?.[0]?.message?.content, finishReason: receipt.choices?.[0]?.finish_reason });
        await writeFile(resolve(output, 'live-ai-receipts.json'), JSON.stringify({ syntheticAccounts: true, realProvider: true, maximumRequests: 6, receipts: aiReceipts }, null, 2));
        return response;
      }
      const input = JSON.stringify(body);
      const name = input.includes('team-shifts.json') ? 'shifts' : input.includes('river-race.txt') ? 'game' : 'equipment';
      const source = input.match(/source_[a-f0-9]{32}/)?.[0];
      if (!source) throw Error('Fixture expected an imported source identifier');
      const change = ({ equipment: equipmentChange, shifts: shiftsChange, game: gameChange })[name](source);
      return Response.json({ model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(change) } }], usage: { prompt_tokens: 40, completion_tokens: 30, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 40 } });
    },
    assets: { directory: resolve('dist'), binding: 'ASSETS', run_worker_first: ['/api/*', '/__fixture*', '/healthz', '/readyz', '/internal/*'], routerConfig: { has_user_worker: true }, assetConfig: { not_found_handling: 'single-page-application' } },
  }],
}));
await mf.ready;
const db = await mf.getD1Database('DB');
for (const path of ['cloudflare/migrations/0001_identity.sql', 'cloudflare/migrations/0002_table_kind.sql']) {
  const sql = await readFile(path, 'utf8');
  await db.batch(sql.replace(/^--.*$/gmu, '').split(';').map(s => s.trim()).filter(Boolean).map(s => db.prepare(s)));
}
const now = Date.now();
for (const actor of actors) await db.batch([
  db.prepare('INSERT INTO users(id,provider_sub,email,name,is_admin,created_at) VALUES(?,?,?,?,?,?)').bind(actor.id, `fixture:${actor.id}`, `${actor.role}@example.test`, actor.name, actor.role === 'owner' ? 1 : 0, now),
  db.prepare('INSERT INTO web_sessions(token_hash,csrf_hash,user_id,created_at,last_seen_at,expires_at) VALUES(?,?,?,?,?,?)').bind(hash(actor.token), hash(csrf(actor.token)), actor.id, now, now, now + 86_400_000),
]);
console.log(JSON.stringify({ ready: true, origin, login: origin + '/__fixture', accounts: 'synthetic', provider: real ? 'real DeepSeek, maximum 6 calls and $0.20 ledger' : 'synthetic', sourceFiles: output }));
if (process.argv.includes('--auto') || process.argv.includes('--generative-auto')) {
  try {
    if (process.argv.includes('--generative-auto')) {
      const { runGenerativeLiveAcceptance } = await import('./generative-live-acceptance.mjs');
      await runGenerativeLiveAcceptance({ origin, actors, output, real });
    } else {
      const { runGenericApiAcceptance } = await import('./generic-api-acceptance.mjs');
      await runGenericApiAcceptance({ origin, actors, output, real });
    }
  }
  catch (error) {
    const namespace = await mf.getDurableObjectNamespace('ROOMS');
    const rooms = await db.prepare('SELECT id FROM rooms').all();
    for (const room of rooms.results) {
      const result = await namespace.get(namespace.idFromName(room.id)).fetch('http://fixture/__fixture/job-status');
      console.log(JSON.stringify({ localDiagnostic: await result.json(), providerCalls }));
    }
    throw error;
  }
  finally { await mf.dispose(); }
  process.exit(0);
}
process.on('SIGINT', async () => { await mf.dispose(); process.exit(0); });
await new Promise(() => {});
