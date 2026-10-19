// Explicit staging-only provisioning helper. It has no production mutation route.
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
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
async function currentStagingVersionId() {
  const deployed = await api(`/workers/scripts/${worker}/deployments`);
  const versions = deployed.deployments?.[0]?.versions;
  ensure(versions?.length === 1 && versions[0].percentage === 100 && typeof versions[0].version_id === 'string',
    'STAGING_REMOTE_VERSION_CHANGED');
  return versions[0].version_id;
}
async function inventory({ allowRecoveryPending = false } = {}) {
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
  let currentVersionId = null;
  if (foundWorker) {
    ensure(receipt.workerCreated === true && receipt.versionId, 'EXISTING_STAGING_WORKER_REQUIRES_REVIEW');
    const deployed = await api(`/workers/scripts/${worker}/deployments`);
    const versions = deployed.deployments?.[0]?.versions;
    ensure(versions?.length === 1 && typeof versions[0].version_id === 'string' && versions[0].percentage === 100,
      'STAGING_REMOTE_VERSION_CHANGED');
    currentVersionId = versions[0].version_id;
    if (currentVersionId !== receipt.versionId) {
      ensure(allowRecoveryPending && receipt.recoveryPending?.previousVersionId === receipt.versionId,
        'STAGING_REMOTE_VERSION_CHANGED');
    }
    ensure(foundWorker.bindings?.find(b => b.name === 'DB')?.id === receipt.databaseId
      && foundWorker.bindings?.find(b => b.name === 'PUBLIC_ORIGIN')?.text === origin, 'STAGING_REMOTE_IDENTITY_CHANGED');
  }
  return { foundDatabase, foundWorker, production, currentVersionId };
}
function writeConfig(tableReadOnly = null) {
  ensure(receipt.databaseId && receipt.databaseId !== original.databaseId, 'ISOLATED_DATABASE_REQUIRED');
  const config = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
  config.name = worker; config.main = resolve(config.main); config.assets.directory = resolve(config.assets.directory);
  config.d1_databases = [{ binding: 'DB', database_name: databaseName, database_id: receipt.databaseId, migrations_dir: resolve('cloudflare/migrations') }];
  config.vars = { PUBLIC_ORIGIN: origin, AI_DAILY_BUDGET_MICRO_USD: '200000', AI_MONTHLY_BUDGET_MICRO_USD: '200000' };
  if (tableReadOnly !== null) config.vars.TABLE_READ_ONLY = tableReadOnly;
  config.workers_dev = true; config.preview_urls = false; delete config.limits;
  ensure(config.durable_objects.bindings.every(b => ['Room', 'Billing'].includes(b.class_name) && !b.script_name), 'ISOLATED_DO_REQUIRED');
  const configPath = resolve(output, 'wrangler.json'); writeFileSync(configPath, JSON.stringify(config, null, 2)); return configPath;
}
function stagingConfigFingerprint(configPath) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  delete config.vars.TABLE_READ_ONLY;
  return sha(JSON.stringify(config));
}
const stagingVarValues = {
  PUBLIC_ORIGIN: origin,
  AI_DAILY_BUDGET_MICRO_USD: '200000',
  AI_MONTHLY_BUDGET_MICRO_USD: '200000',
};
const expectedBindingNames = new Set([
  'DB', 'ROOMS', 'BILLING', 'ASSETS', ...Object.keys(stagingVarValues), ...secretNames,
]);
function tableReadOnlyValue(bindings) {
  ensure(Array.isArray(bindings), 'STAGING_BINDINGS_INVALID');
  const matches = bindings.filter(binding => binding?.name === 'TABLE_READ_ONLY');
  ensure(matches.length <= 1, 'STAGING_BINDINGS_INVALID');
  if (matches.length === 0) return null;
  ensure(matches[0].text === 'true' || matches[0].text === 'false', 'STAGING_READ_ONLY_FLAG_INVALID');
  return matches[0].text;
}
function stagingBindingsFingerprint(bindings) {
  ensure(Array.isArray(bindings), 'STAGING_BINDINGS_INVALID');
  const names = bindings.map(binding => binding?.name);
  ensure(names.every(name => typeof name === 'string') && new Set(names).size === names.length,
    'STAGING_BINDINGS_INVALID');
  const tableReadOnly = tableReadOnlyValue(bindings);
  const expected = new Set(expectedBindingNames);
  if (tableReadOnly !== null) expected.add('TABLE_READ_ONLY');
  ensure(names.length === expected.size && names.every(name => expected.has(name)), 'STAGING_BINDINGS_CHANGED');
  for (const [name, value] of Object.entries(stagingVarValues)) {
    ensure(bindings.find(binding => binding.name === name)?.text === value, 'STAGING_BINDINGS_CHANGED');
  }
  const stableBindings = [...bindings].filter(binding => binding.name !== 'TABLE_READ_ONLY')
    .sort((left, right) => left.name.localeCompare(right.name));
  return sha(JSON.stringify(stableBindings));
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
function gitOutput(args) {
  const safeDirectory = root.replaceAll('\\', '/');
  const result = spawnSync('git', ['-c', `safe.directory=${safeDirectory}`, ...args], {
    cwd: root, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024,
  });
  ensure(result.status === 0, 'STAGING_RECOVERY_SOURCE_IDENTITY_UNAVAILABLE');
  return result.stdout.trim();
}
function changedSourcePaths(commit) {
  return [
    ...gitOutput(['diff', '--name-only', commit, '--']).split(/\r?\n/),
    ...gitOutput(['ls-files', '--others', '--exclude-standard']).split(/\r?\n/),
  ].filter(Boolean);
}
function assertOnlyTestOrHelperChanges(paths, errorCode) {
  const isTestOnly = path => path.startsWith('tests/') || path.includes('/__tests__/')
    || /(?:^|\/)[^/]+\.(?:test|spec)\.[cm]?[jt]sx?$/.test(path)
    || /^vitest[^/]*\.config\.[cm]?[jt]s$/.test(path);
  const unexpected = paths.filter(path => path !== 'scripts/generic-staging.mjs' && !isTestOnly(path));
  ensure(unexpected.length === 0, errorCode);
}
function assertDeploySource() {
  const sourceCommit = gitOutput(['rev-parse', 'HEAD']);
  ensure(/^[0-9a-f]{40}$/i.test(sourceCommit), 'STAGING_DEPLOY_SOURCE_COMMIT_UNAVAILABLE');
  assertOnlyTestOrHelperChanges(changedSourcePaths('HEAD'), 'STAGING_DEPLOY_SOURCE_TREE_DRIFT');
  return sourceCommit;
}
function assertRecoverySource() {
  const sourceCommit = receipt.sourceCommit;
  ensure(typeof sourceCommit === 'string' && /^[0-9a-f]{40}$/i.test(sourceCommit),
    'STAGING_RECOVERY_SOURCE_COMMIT_UNRECORDED');
  ensure(receipt.buildManifest && /^[0-9a-f]{64}$/i.test(receipt.buildManifest.sha256)
    && Number.isSafeInteger(receipt.buildManifest.fileCount) && receipt.buildManifest.fileCount > 0,
  'STAGING_RECOVERY_BUILD_UNRECORDED');
  const safeDirectory = root.replaceAll('\\', '/');
  const ancestry = spawnSync('git', ['-c', `safe.directory=${safeDirectory}`, 'merge-base', '--is-ancestor', sourceCommit, 'HEAD'], {
    cwd: root, encoding: 'utf8', timeout: 30000,
  });
  ensure(ancestry.status === 0, 'STAGING_RECOVERY_SOURCE_COMMIT_UNREVIEWED');
  assertOnlyTestOrHelperChanges(changedSourcePaths(sourceCommit), 'STAGING_RECOVERY_SOURCE_TREE_DRIFT');
  return sourceCommit;
}
function filesUnder(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = resolve(directory, entry.name);
    ensure(!entry.isSymbolicLink(), 'STAGING_RECOVERY_BUILD_UNSAFE');
    if (entry.isDirectory()) return filesUnder(fullPath, relativePath);
    ensure(entry.isFile(), 'STAGING_RECOVERY_BUILD_UNSAFE');
    return [relativePath];
  });
}
function runLocalBuild(args) {
  const environment = { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' };
  for (const name of required) delete environment[name];
  const result = spawnSync(process.execPath, args, {
    cwd: root, env: environment, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024,
  });
  const outputText = scrub((result.stdout ?? '') + (result.stderr ?? ''));
  writeFileSync(resolve(output, 'last-command.log'), outputText);
  if (result.status !== 0) print({ error: 'STAGING_RECOVERY_BUILD_FAILED', detail: outputText.slice(-1200) });
  ensure(result.status === 0, 'STAGING_RECOVERY_BUILD_FAILED');
}
function buildApprovedAssets() {
  runLocalBuild(['scripts/generate-public-demo.mjs', '--check']);
  runLocalBuild(['node_modules/typescript/bin/tsc', '-b']);
  runLocalBuild(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.server.json']);
  runLocalBuild(['node_modules/typescript/bin/tsc', '-p', 'tsconfig.cloudflare.json']);
  runLocalBuild(['node_modules/vite/bin/vite.js', 'build']);
}
function localBuildManifest() {
  const dist = resolve(root, 'dist');
  ensure(existsSync(resolve(dist, 'index.html')), 'BUILD_REQUIRED');
  const paths = filesUnder(dist).sort();
  const pathSet = new Set(paths);
  const publicRoot = resolve(root, 'public');
  const publicPaths = filesUnder(publicRoot);
  for (const path of publicPaths) {
    ensure(pathSet.has(path) && sha(readFileSync(resolve(publicRoot, path))) === sha(readFileSync(resolve(dist, path))),
      'STAGING_RECOVERY_PUBLIC_ASSET_DRIFT');
  }
  const entries = paths.map(path => ({
    path,
    sha256: sha(readFileSync(resolve(dist, path))),
  }));
  const manifest = {
    sha256: sha(JSON.stringify(entries)),
    fileCount: entries.length,
  };
  return { manifest, entries };
}

async function verifyServedAssets(entries) {
  const servedFiles = entries.filter(entry => entry.path !== '_headers');
  const checks = [];
  for (let offset = 0; offset < servedFiles.length; offset += 6) {
    const batch = servedFiles.slice(offset, offset + 6);
    const results = await Promise.all(batch.map(async entry => {
      const urlPath = entry.path.split('/').map(encodeURIComponent).join('/');
      const url = entry.path === 'index.html' ? `${origin}/` : `${origin}/${urlPath}`;
      try {
        const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (response.status !== 200) return { file: entry.path, status: response.status, equal: false, sha256: entry.sha256 };
        const content = Buffer.from(await response.arrayBuffer());
        return { file: entry.path, status: response.status, equal: sha(content) === entry.sha256, sha256: entry.sha256 };
      } catch {
        return { file: entry.path, status: 0, equal: false, sha256: entry.sha256 };
      }
    }));
    checks.push(...results);
  }
  ensure(checks.length === servedFiles.length && checks.every(check => check.status === 200 && check.equal),
    'STAGING_ASSET_PARITY_FAILED');
  return checks;
}
async function verifyRecoveryBuild() {
  const sourceCommit = assertRecoverySource();
  buildApprovedAssets();
  ensure(assertRecoverySource() === sourceCommit, 'STAGING_RECOVERY_SOURCE_TREE_DRIFT');
  const { manifest, entries } = localBuildManifest();
  ensure(receipt.buildManifest.sha256 === manifest.sha256 && receipt.buildManifest.fileCount === manifest.fileCount,
    'STAGING_RECOVERY_BUILD_CHANGED');

  const approvedAssets = JSON.parse(readFileSync(resolve(output, 'asset-parity.json'), 'utf8'));
  const expectedPaths = entries.filter(entry => entry.path !== '_headers').map(entry => entry.path).sort();
  const recordedChecks = approvedAssets.checks;
  ensure(approvedAssets.sourceCommit === sourceCommit && approvedAssets.origin === origin
    && approvedAssets.passed === true && approvedAssets.buildManifest?.sha256 === manifest.sha256
    && approvedAssets.buildManifest?.fileCount === manifest.fileCount
    && Array.isArray(recordedChecks) && recordedChecks.length === expectedPaths.length
    && recordedChecks.every(check => check.status === 200 && check.equal === true && typeof check.sha256 === 'string')
    && recordedChecks.map(check => check.file).sort().every((path, index) => path === expectedPaths[index]),
  'STAGING_RECOVERY_ASSET_BASELINE_UNREVIEWED');
  const currentChecks = await verifyServedAssets(entries);
  ensure(currentChecks.every(check => check.sha256 === recordedChecks.find(saved => saved.file === check.file)?.sha256),
    'STAGING_RECOVERY_ASSET_BASELINE_CHANGED');
  const configFingerprint = stagingConfigFingerprint(writeConfig());
  ensure(receipt.configFingerprint === configFingerprint, 'STAGING_RECOVERY_CONFIG_CHANGED');
  return { sourceCommit, manifest, configFingerprint };
}
function assertRecoveryApproval() {
  const approval = JSON.parse(readFileSync(resolve(output, 'approval.json'), 'utf8'));
  ensure(approval.worker === worker && approval.databaseName === databaseName && approval.origin === origin
    && approval.schema === '0001+0002' && approval.aiMonthlyUsd === .2 && approval.approved === true,
  'EXACT_STAGING_APPROVAL_REQUIRED');
}
function finishRecovery(pending, versionId) {
  receipt.versionId = versionId;
  receipt.recovery = {
    priorTableReadOnly: pending.priorTableReadOnly,
    baseBindingsFingerprint: pending.baseBindingsFingerprint,
    productionSignature: pending.productionSignature,
    sourceCommit: pending.sourceCommit,
    buildManifest: pending.buildManifest,
    configFingerprint: pending.configFingerprint,
    state: pending.nextState,
    lastVersionId: versionId,
    updatedAt: new Date().toISOString(),
  };
  delete receipt.recoveryPending;
  save();
}
async function recoverTableReadOnly(mode, before) {
  const nextState = mode === 'recovery-on' ? 'on' : 'off';
  assertRecoveryApproval();
  ensure(receipt.workerCreated === true && receipt.migrated === true && receipt.secretsInstalled === true
    && receipt.databaseId && receipt.versionId && before.foundDatabase?.uuid === receipt.databaseId && before.foundWorker,
  'STAGING_RECOVERY_BASELINE_REQUIRED');
  ensure(before.production === receipt.productionBefore, 'PRODUCTION_CHANGED_SINCE_PREFLIGHT');
  const { sourceCommit, manifest: buildManifest, configFingerprint } = await verifyRecoveryBuild();

  const bindings = before.foundWorker.bindings;
  const currentReadOnly = tableReadOnlyValue(bindings);
  const baseBindingsFingerprint = stagingBindingsFingerprint(bindings);
  ensure(before.foundWorker.bindings.find(binding => binding.name === 'DB')?.id === receipt.databaseId,
    'STAGING_DATABASE_BINDING_MISMATCH');

  let pending = receipt.recoveryPending;
  if (pending) {
    ensure(pending.mode === mode && pending.previousVersionId === receipt.versionId,
      'STAGING_RECOVERY_MODE_MISMATCH');
    const recovery = receipt.recovery;
    const expectedTarget = nextState === 'on' ? 'true' : recovery?.priorTableReadOnly;
    const expectedPrevious = recovery?.state === 'on' ? 'true' : recovery?.priorTableReadOnly;
    ensure(pending.nextState === nextState && pending.targetReadOnly === expectedTarget
      && pending.previousReadOnly === expectedPrevious && (pending.targetReadOnly === null
      || pending.targetReadOnly === 'true' || pending.targetReadOnly === 'false')
      && recovery && pending.priorTableReadOnly === recovery.priorTableReadOnly
      && pending.baseBindingsFingerprint === recovery.baseBindingsFingerprint
      && pending.sourceCommit === sourceCommit && pending.buildManifest === buildManifest.sha256
      && recovery.sourceCommit === sourceCommit && recovery.buildManifest === buildManifest.sha256
      && pending.configFingerprint === configFingerprint && recovery.configFingerprint === configFingerprint,
    'STAGING_RECOVERY_RECEIPT_INVALID');
    ensure(pending.productionSignature === before.production
      && pending.baseBindingsFingerprint === baseBindingsFingerprint,
    'STAGING_RECOVERY_BASELINE_CHANGED');
    if (before.currentVersionId !== pending.previousVersionId) {
      ensure(currentReadOnly === pending.targetReadOnly, 'STAGING_RECOVERY_OUTCOME_UNCONFIRMED');
      finishRecovery(pending, before.currentVersionId);
      ensure(await productionSignature() === before.production, 'PRODUCTION_CHANGED_DURING_RECOVERY');
      print({ recovered: true, mode, versionId: before.currentVersionId, sourceCommit: pending.sourceCommit,
        buildManifest: pending.buildManifest, configFingerprint: pending.configFingerprint, productionChanged: false });
      return;
    }
    ensure(currentReadOnly === pending.previousReadOnly, 'STAGING_RECOVERY_SOURCE_CHANGED');
  } else {
    ensure(before.currentVersionId === receipt.versionId, 'STAGING_REMOTE_VERSION_CHANGED');
    let recovery = receipt.recovery;
    if (!recovery) {
      recovery = {
        priorTableReadOnly: currentReadOnly,
        baseBindingsFingerprint,
        productionSignature: before.production,
        sourceCommit,
        buildManifest: buildManifest.sha256,
        configFingerprint,
        state: currentReadOnly === 'true' ? 'on' : 'off',
        lastVersionId: before.currentVersionId,
      };
      receipt.recovery = recovery;
      save();
    }
    ensure(recovery.baseBindingsFingerprint === baseBindingsFingerprint
      && recovery.productionSignature === before.production
      && recovery.sourceCommit === sourceCommit && recovery.buildManifest === buildManifest.sha256
      && recovery.configFingerprint === configFingerprint,
    'STAGING_RECOVERY_BASELINE_CHANGED');
    const expectedCurrent = recovery.state === 'on' ? 'true' : recovery.priorTableReadOnly;
    ensure(currentReadOnly === expectedCurrent, 'STAGING_RECOVERY_STATE_CHANGED');

    const targetReadOnly = nextState === 'on' ? 'true' : recovery.priorTableReadOnly;
    ensure(nextState !== 'off' || recovery.state === 'on' || currentReadOnly === targetReadOnly,
      'STAGING_RECOVERY_NOT_ACTIVE');
    if (currentReadOnly === targetReadOnly) {
      recovery.state = nextState;
      recovery.lastVersionId = before.currentVersionId;
      recovery.updatedAt = new Date().toISOString();
      save();
      ensure(await productionSignature() === before.production, 'PRODUCTION_CHANGED_DURING_RECOVERY');
      print({ alreadyInRequestedState: true, mode, versionId: before.currentVersionId,
        sourceCommit: recovery.sourceCommit, buildManifest: recovery.buildManifest,
        configFingerprint: recovery.configFingerprint, productionChanged: false });
      return;
    }
    pending = {
      mode,
      nextState,
      sourceCommit,
      buildManifest: buildManifest.sha256,
      configFingerprint,
      targetReadOnly,
      previousReadOnly: currentReadOnly,
      previousVersionId: before.currentVersionId,
      priorTableReadOnly: recovery.priorTableReadOnly,
      baseBindingsFingerprint,
      productionSignature: before.production,
      startedAt: new Date().toISOString(),
    };
    receipt.recoveryPending = pending;
    save();
  }

  const configPath = writeConfig(pending.targetReadOnly);
  command(['deploy', '--config', configPath]);
  const [deployed, settings] = await Promise.all([
    api(`/workers/scripts/${worker}/deployments`),
    api(`/workers/scripts/${worker}/settings`),
  ]);
  const versions = deployed.deployments?.[0]?.versions;
  ensure(versions?.length === 1 && versions[0].percentage === 100
    && typeof versions[0].version_id === 'string' && versions[0].version_id !== pending.previousVersionId,
  'STAGING_RECOVERY_DEPLOYMENT_UNCONFIRMED');
  ensure(tableReadOnlyValue(settings.bindings) === pending.targetReadOnly
    && stagingBindingsFingerprint(settings.bindings) === pending.baseBindingsFingerprint
    && settings.bindings.find(binding => binding.name === 'DB')?.id === receipt.databaseId,
  'STAGING_RECOVERY_BINDINGS_CHANGED');
  finishRecovery(pending, versions[0].version_id);
  ensure(await productionSignature() === before.production, 'PRODUCTION_CHANGED_DURING_RECOVERY');
  print({ deployed: true, mode, versionId: versions[0].version_id, tableReadOnly: pending.targetReadOnly,
    sourceCommit: pending.sourceCommit, buildManifest: pending.buildManifest,
    configFingerprint: pending.configFingerprint, databasePreserved: true,
    bindingMetadataPreserved: true, secretBindingsPresent: true, secretValuesVerified: false,
    migrationsRun: false, productionChanged: false });
}
const mode = process.argv[2] ?? 'plan';
ensure(['plan', 'provision-and-deploy', 'verify', 'recovery-on', 'recovery-off'].includes(mode), 'UNKNOWN_STAGING_MODE');
const recoveryMode = mode === 'recovery-on' || mode === 'recovery-off';
const before = await inventory({ allowRecoveryPending: recoveryMode });
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
  const sourceCommit = assertDeploySource();
  buildApprovedAssets();
  ensure(assertDeploySource() === sourceCommit, 'STAGING_DEPLOY_SOURCE_TREE_DRIFT');
  const { manifest: buildManifest, entries: buildEntries } = localBuildManifest();
  if (!before.foundDatabase) {
    const database = await api('/d1/database', 'POST', { name: databaseName }); receipt.databaseId = database.uuid; save();
  }
  const configPath = writeConfig();
  const configFingerprint = stagingConfigFingerprint(configPath);
  receipt.deployPending = { sourceCommit, buildManifest, configFingerprint, startedAt: new Date().toISOString() };
  save();
  if (!receipt.migrated) { command(['d1', 'migrations', 'apply', 'DB', '--remote', '--config', configPath]); receipt.migrated = true; save(); }
  receipt.deployAttempted = true; save();
  command(['deploy', '--config', configPath]); receipt.workerCreated = true; save();
  receipt.versionId = await currentStagingVersionId(); save();
  if (!receipt.secretsInstalled) {
    command(['secret', 'bulk', '--config', configPath], JSON.stringify(Object.fromEntries(secretNames.map(name => [name, cfg[name]]))));
    receipt.secretsInstalled = true; save();
    receipt.versionId = await currentStagingVersionId(); save();
  }
  ensure(await productionSignature() === before.production, 'PRODUCTION_CHANGED_DURING_STAGING');
  const settings = await api(`/workers/scripts/${worker}/settings`);
  ensure(settings.bindings.find(b => b.name === 'DB')?.id === receipt.databaseId, 'STAGING_DATABASE_BINDING_MISMATCH');
  const assetChecks = await verifyServedAssets(buildEntries);
  ensure(assertDeploySource() === sourceCommit, 'STAGING_DEPLOY_SOURCE_TREE_DRIFT');
  const assetReport = {
    origin,
    sourceCommit,
    buildManifest,
    checkedAt: new Date().toISOString(),
    checks: assetChecks,
    passed: assetChecks.every(check => check.status === 200 && check.equal),
  };
  writeFileSync(resolve(output, 'asset-parity.json'), JSON.stringify(assetReport, null, 2));
  receipt.sourceCommit = sourceCommit;
  receipt.buildManifest = buildManifest;
  receipt.configFingerprint = configFingerprint;
  delete receipt.deployPending;
  receipt.deployedAt = new Date().toISOString(); save();
  print({ deployed: true, origin, isolatedDatabase: true, isolatedRoomAndBilling: true, secretNames, productionChanged: false });
} else if (mode === 'verify') {
  const [health, ready, auth] = await Promise.all(['/healthz','/readyz','/api/auth/status'].map(async path => { const r = await fetch(origin + path); return { status: r.status, body: await r.json() }; }));
  ensure(health.status === 200 && ready.status === 200, 'STAGING_READINESS_FAILED');
  ensure(before.production === receipt.productionBefore, 'PRODUCTION_CHANGED');
  const baseline = JSON.parse(readFileSync(resolve(output, 'asset-parity.json'), 'utf8'));
  const { manifest, entries } = localBuildManifest();
  const servedEntries = entries.filter(entry => entry.path !== '_headers');
  const expectedHashes = new Map(servedEntries.map(entry => [entry.path, entry.sha256]));
  ensure(baseline.passed === true && baseline.sourceCommit === receipt.sourceCommit
    && baseline.origin === origin && baseline.buildManifest?.sha256 === receipt.buildManifest?.sha256
    && manifest.sha256 === receipt.buildManifest?.sha256 && manifest.fileCount === receipt.buildManifest?.fileCount
    && baseline.buildManifest?.fileCount === manifest.fileCount
    && Array.isArray(baseline.checks) && baseline.checks.length === servedEntries.length
    && new Set(baseline.checks.map(check => check.file)).size === servedEntries.length
    && baseline.checks.every(check => check.status === 200 && check.equal === true
      && typeof check.sha256 === 'string' && expectedHashes.get(check.file) === check.sha256),
  'STAGING_ASSET_BASELINE_REQUIRED');
  const assets = await verifyServedAssets(servedEntries);
  const verification = { origin, versionId: before.currentVersionId, sourceCommit: receipt.sourceCommit,
    checkedAt: new Date().toISOString(), health: health.status, ready: ready.status,
    assetCount: assets.length, hostedAssetParity: true, productionChanged: false };
  writeFileSync(resolve(output, 'verification.json'), JSON.stringify(verification, null, 2));
  print({ ...verification, auth: auth.body });
} else if (recoveryMode) {
  await recoverTableReadOnly(mode, before);
}
