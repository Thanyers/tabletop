// Explicit staging-only provisioning helper. It has no production mutation route.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve('.');
const output = resolve('test-results/generic-staging'); mkdirSync(output, { recursive: true });
const cfg = parseEnv(readFileSync(resolve('..', '.env.deploy.local'), 'utf8'));
const worker = 'tabletop-staging', databaseName = 'tabletop-staging';
const origin = 'https://tabletop-staging.ptchrr.workers.dev';
const sha = x => createHash('sha256').update(x).digest('hex');
const required = ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN', 'DEEPSEEK_KEY', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'TABLETOP_ADMIN_EMAIL'];
const secretNames = required.slice(2);
const ensure = (yes, message) => { if (!yes) throw Error(message); };
for (const key of required) ensure(typeof cfg[key] === 'string' && cfg[key].length > 0, `MISSING_${key}`);
const original = JSON.parse(readFileSync(resolve('test-results/production-release/receipt.json'), 'utf8'));
ensure(original.accountFingerprint === sha(cfg.CLOUDFLARE_ACCOUNT_ID) && original.worker === 'tabletop', 'ACCOUNT_SCOPE_CHANGED');
const markers = Object.values(cfg).filter(x => x.length >= 8);
function scrub(s) { for (const v of markers) s = s.split(v).join('[REDACTED]'); return s; }
function print(value) { console.log(scrub(JSON.stringify(value))); }
const receiptPath = resolve(output, 'receipt.json');
const receipt = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : { worker, databaseName, origin, accountFingerprint: original.accountFingerprint };
ensure(receipt.worker === worker && receipt.databaseName === databaseName && receipt.origin === origin && receipt.accountFingerprint === original.accountFingerprint, 'STAGING_RECEIPT_SCOPE_CHANGED');
const save = () => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
async function api(path, method = 'GET', body, options = {}) {
  if (method !== 'GET') ensure(path === '/d1/database' || path.startsWith(`/workers/scripts/${worker}/`), 'NON_STAGING_MUTATION_BLOCKED');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${cfg.CLOUDFLARE_ACCOUNT_ID}${path}`, {
    method, headers: { Authorization: `Bearer ${cfg.CLOUDFLARE_API_TOKEN}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  const data = await response.json();
  if (method === 'GET' && options.allowMissing && response.status === 404) return null;
  ensure(response.ok && data.success, `CLOUDFLARE_${method}_FAILED_${response.status}`); return options.metadata ? data : data.result;
}
async function productionSignature() {
  const [settings, deployment] = await Promise.all([api('/workers/scripts/tabletop/settings'), api('/workers/scripts/tabletop/deployments')]);
  return sha(JSON.stringify({ bindings: [...settings.bindings].sort((a,b) => a.name.localeCompare(b.name)), deployment: deployment.deployments[0] }));
}
async function inventory() {
  const databases = [];
  for (let page = 1; ; page++) {
    ensure(page <= 100, 'DATABASE_INVENTORY_INCOMPLETE');
    const data = await api(`/d1/database?per_page=100&page=${page}`, 'GET', undefined, { metadata: true });
    ensure(Array.isArray(data.result) && !data.result.some(d => databases.some(old => old.uuid === d.uuid)), 'DATABASE_INVENTORY_PAGINATION_FAILED');
    databases.push(...data.result);
    if (data.result.length < 100 || data.result_info?.total_pages && page >= data.result_info.total_pages) break;
  }
  const [foundWorker, production] = await Promise.all([api(`/workers/scripts/${worker}/settings`, 'GET', undefined, { allowMissing: true }), productionSignature()]);
  const foundDatabase = databases.find(d => d.name === databaseName);
  ensure(!foundDatabase || receipt.databaseId === foundDatabase.uuid, 'EXISTING_STAGING_DATABASE_REQUIRES_REVIEW');
  if (foundWorker) {
    ensure(receipt.workerCreated === true && receipt.versionId, 'EXISTING_STAGING_WORKER_REQUIRES_REVIEW');
    const deployed = await api(`/workers/scripts/${worker}/deployments`);
    const versions = deployed.deployments?.[0]?.versions;
    ensure(versions?.length === 1 && versions[0].version_id === receipt.versionId && versions[0].percentage === 100, 'STAGING_REMOTE_VERSION_CHANGED');
    ensure(foundWorker.bindings?.find(b => b.name === 'DB')?.id === receipt.databaseId
      && foundWorker.bindings?.find(b => b.name === 'PUBLIC_ORIGIN')?.text === origin, 'STAGING_REMOTE_IDENTITY_CHANGED');
  }
  return { foundDatabase, foundWorker, production };
}
function writeConfig() {
  ensure(receipt.databaseId && receipt.databaseId !== original.databaseId, 'ISOLATED_DATABASE_REQUIRED');
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  config.name = worker; config.main = resolve(config.main); config.assets.directory = resolve(config.assets.directory);
  config.d1_databases = [{ binding: 'DB', database_name: databaseName, database_id: receipt.databaseId, migrations_dir: resolve('cloudflare/migrations') }];
  config.vars = { PUBLIC_ORIGIN: origin, AI_DAILY_BUDGET_MICRO_USD: '200000', AI_MONTHLY_BUDGET_MICRO_USD: '200000' };
  config.workers_dev = true; config.preview_urls = false; delete config.limits;
  ensure(config.durable_objects.bindings.every(b => ['Room', 'Billing'].includes(b.class_name) && !b.script_name), 'ISOLATED_DO_REQUIRED');
  const configPath = resolve(output, 'wrangler.json'); writeFileSync(configPath, JSON.stringify(config, null, 2)); return configPath;
}
function command(args, input) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    cwd: root, env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: cfg.CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN: cfg.CLOUDFLARE_API_TOKEN, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
    encoding: 'utf8', input, timeout: 240000, maxBuffer: 16 * 1024 * 1024,
  });
  writeFileSync(resolve(output, 'last-command.log'), scrub((result.stdout ?? '') + (result.stderr ?? '')));
  if (result.status !== 0) print({ error: 'STAGING_COMMAND_FAILED', detail: scrub((result.stderr ?? '')).slice(-1200) });
  ensure(result.status === 0, 'STAGING_COMMAND_FAILED');
}
const mode = process.argv[2] ?? 'plan';
const before = await inventory();
if (mode === 'plan') {
  receipt.productionBefore = before.production; receipt.planPreparedAt = new Date().toISOString(); save();
  print({ prepared: true, worker, databaseName, origin, newWorker: !before.foundWorker, newDatabase: !before.foundDatabase,
    existingBusinessRows: before.foundDatabase ? 'unknown - stop' : 0, secrets: secretNames, aiDailyUsd: .2, aiMonthlyUsd: .2,
    schemaFiles: ['0001_identity.sql', '0002_table_kind.sql'], approvalRequired: true, productionChanged: false });
} else if (mode === 'provision-and-deploy') {
  // The human approval is recorded by the main agent only after scope review.
  const approval = JSON.parse(readFileSync(resolve(output, 'approval.json'), 'utf8'));
  ensure(approval.worker === worker && approval.databaseName === databaseName && approval.origin === origin && approval.schema === '0001+0002' && approval.aiMonthlyUsd === .2 && approval.approved === true, 'EXACT_STAGING_APPROVAL_REQUIRED');
  ensure(receipt.productionBefore === before.production, 'PRODUCTION_CHANGED_SINCE_PREFLIGHT');
  ensure(existsSync('dist/index.html'), 'BUILD_REQUIRED');
  if (!before.foundDatabase) {
    const database = await api('/d1/database', 'POST', { name: databaseName }); receipt.databaseId = database.uuid; save();
  }
  const configPath = writeConfig();
  if (!receipt.migrated) { command(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]); receipt.migrated = true; save(); }
  receipt.deployAttempted = true; save();
  command(['deploy', '--config', configPath]); receipt.workerCreated = true; save();
  receipt.versionId = (await api(`/workers/scripts/${worker}/deployments`)).deployments?.[0]?.versions?.[0]?.version_id; save();
  if (!receipt.secretsInstalled) {
    command(['secret', 'bulk', '--config', configPath], JSON.stringify(Object.fromEntries(secretNames.map(name => [name, cfg[name]]))));
    receipt.secretsInstalled = true; save();
    receipt.versionId = (await api(`/workers/scripts/${worker}/deployments`)).deployments?.[0]?.versions?.[0]?.version_id; save();
  }
  ensure(await productionSignature() === before.production, 'PRODUCTION_CHANGED_DURING_STAGING');
  const settings = await api(`/workers/scripts/${worker}/settings`);
  ensure(settings.bindings.find(b => b.name === 'DB')?.id === receipt.databaseId, 'STAGING_DATABASE_BINDING_MISMATCH');
  receipt.deployedAt = new Date().toISOString(); save();
  print({ deployed: true, origin, isolatedDatabase: true, isolatedRoomAndBilling: true, secretNames, productionChanged: false });
} else if (mode === 'verify') {
  const [health, ready, auth] = await Promise.all(['/healthz','/readyz','/api/auth/status'].map(async path => { const r = await fetch(origin + path); return { status: r.status, body: await r.json() }; }));
  ensure(health.status === 200 && ready.status === 200, 'STAGING_READINESS_FAILED');
  ensure(before.production === receipt.productionBefore, 'PRODUCTION_CHANGED');
  print({ origin, health: health.status, ready: ready.status, auth: auth.body, productionChanged: false });
} else throw Error('UNKNOWN_STAGING_MODE');
