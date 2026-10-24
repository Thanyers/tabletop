import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Log, LogLevel, Miniflare, convertV4MiniflareOptions } from 'miniflare';

const SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIRECTORY, '..');
const INTEGRATION_ORIGIN = 'https://tabletop.integration.test';

async function applySyntheticMigrations(database, migrationDirectory) {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort((left, right) => left.localeCompare(right));
  assert.ok(files.length > 0, 'No D1 migrations were found for the synthetic Worker database.');
  for (const file of files) {
    const sql = (await readFile(path.join(migrationDirectory, file), 'utf8')).replace(/^--.*$/gmu, '');
    const statements = sql.split(';').map((statement) => statement.trim()).filter(Boolean);
    await database.batch(statements.map((statement) => database.prepare(statement)));
  }
}

async function readJsonResponse(miniflare, route) {
  const response = await miniflare.dispatchFetch(`${INTEGRATION_ORIGIN}${route}`);
  const text = await response.text();
  assert.equal(response.status, 200, `${route} did not return HTTP 200: ${text.slice(0, 500)}`);
  const body = await Promise.resolve().then(() => JSON.parse(text)).catch(() => null);
  assert.ok(body && typeof body === 'object', `${route} did not return a JSON object.`);
  return body;
}

/** Boot a built Worker with synthetic-only bindings, then check its unauthenticated probes. */
export async function runWorkerStartupGate({
  projectRoot = PROJECT_ROOT,
  workerScriptPath = path.join(projectRoot, 'worker-build', 'index.js'),
} = {}) {
  const root = path.resolve(projectRoot);
  const scriptPath = path.isAbsolute(workerScriptPath) ? workerScriptPath : path.resolve(root, workerScriptPath);
  const configPath = path.join(root, 'wrangler.jsonc');
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  await access(scriptPath);

  const databaseBindings = (config.d1_databases ?? []).map(({ binding }) => binding);
  assert.ok(databaseBindings.includes('DB'), 'The Worker config must expose its D1 binding as DB.');
  const durableObjects = Object.fromEntries((config.durable_objects?.bindings ?? []).map(({ name, class_name }) => [name, {
    className: class_name,
    useSQLite: true,
  }]));
  const variables = config.vars ?? {};
  const miniflare = new Miniflare(convertV4MiniflareOptions({
    log: new Log(LogLevel.ERROR),
    workers: [{
      name: 'tabletop-integration-gate',
      modules: true,
      scriptPath,
      compatibilityDate: config.compatibility_date,
      compatibilityFlags: config.compatibility_flags ?? [],
      d1Databases: databaseBindings,
      durableObjects,
      bindings: {
        ...variables,
        PUBLIC_ORIGIN: INTEGRATION_ORIGIN,
        TABLE_WEB_SEARCH: 'off',
        // Deliberately omit DEEPSEEK_KEY, OAuth values, tokens, and account identifiers.
      },
      outboundService: async (request) => {
        throw new Error(`Unexpected outbound request to ${new URL(request.url).origin}.`);
      },
    }],
  }));

  let result;
  let failure;
  try {
    await miniflare.ready;
    const database = await miniflare.getD1Database('DB');
    await applySyntheticMigrations(database, path.join(root, 'cloudflare', 'migrations'));

    const health = await readJsonResponse(miniflare, '/healthz');
    assert.equal(health.ok, true, '/healthz did not report a healthy Worker.');

    const ready = await readJsonResponse(miniflare, '/readyz');
    assert.equal(ready.ok, true, '/readyz did not report a ready Worker after local migrations.');

    const capabilities = await readJsonResponse(miniflare, '/api/capabilities');
    assert.equal(typeof capabilities.model?.enabled, 'boolean', 'Capabilities omitted model availability.');
    assert.equal(capabilities.model.enabled, false, 'The smoke Worker unexpectedly enabled a model provider.');
    assert.equal(typeof capabilities.tableAssistant?.available, 'boolean', 'Capabilities omitted table assistant availability.');
    assert.equal(typeof capabilities.compute?.profile, 'string', 'Capabilities omitted the compute profile.');

    result = {
      endpoints: ['/healthz', '/readyz', '/api/capabilities'],
      modelEnabled: capabilities.model.enabled,
      computeProfile: capabilities.compute.profile,
      migrationsApplied: true,
    };
  } catch (error) {
    failure = error;
  }
  try {
    await miniflare.dispose();
  } catch (error) {
    if (!failure) failure = new Error('Could not dispose the synthetic Worker runtime.', { cause: error });
  }
  if (failure) throw new Error('Built Worker startup or health checks failed.', { cause: failure });
  return result;
}

function conciseError(error) {
  let current = error;
  while (current?.cause) current = current.cause;
  return current?.message ?? 'Unknown startup failure.';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runWorkerStartupGate().then((result) => {
    process.stdout.write(`PASS built Worker startup: ${result.endpoints.join(', ')}; model disabled; compute ${result.computeProfile}; synthetic D1 migrations applied.\n`);
  }).catch((error) => {
    process.stderr.write(`FAIL built Worker startup: ${conciseError(error)}\n`);
    process.exitCode = 1;
  });
}
