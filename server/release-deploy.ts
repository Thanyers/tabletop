// CD001: helpers for .github/workflows/release-deploy.yml. Pure functions are unit-tested;
// the CLI at the bottom is what the workflow runs (`npx tsx server/release-deploy.ts …`).
import { computeRuntimeCapabilities } from '../src/tabletop/shared/compute-runtime-profiles.js';

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
const PLACEHOLDER_ID = /^0{8}-0{4}-0{4}-0{4}-0{12}$/u;

/** Version of a release/hotfix merge into main, from its merge commit subject; null for anything else. */
export function releaseVersionFromMerge(subject: string): string | null {
  const match = /^Merge pull request #\d+ from [^/\s]+\/(?:release|hotfix)\/(\S+)$/u.exec(subject.trim());
  return match && SEMVER.test(match[1]) ? match[1] : null;
}

/** The CHANGELOG must already carry the released heading (moved from Unreleased on the release branch). */
export function changelogHasVersion(changelog: string, version: string): boolean {
  return new RegExp(`^## ${version.replaceAll('.', '\\.')}(?: |$)`, 'mu').test(changelog);
}

export interface DeployConfigCheck { ok: boolean; problems: string[] }

/** Guards a real wrangler config held in a GitHub secret before it is used for a deploy. */
export function checkDeployConfig(raw: string, expected: { name: string; origin: string }): DeployConfigCheck {
  const problems: string[] = [];
  let config: Record<string, unknown>;
  try { config = JSON.parse(raw) as Record<string, unknown>; } catch { return { ok: false, problems: ['Config is not valid JSON (store it as plain JSON, no comments).'] }; }
  if (config.name !== expected.name) problems.push(`Worker name is "${String(config.name)}", expected "${expected.name}".`);
  const vars = (config.vars ?? {}) as Record<string, unknown>;
  if (vars.PUBLIC_ORIGIN !== expected.origin) problems.push(`vars.PUBLIC_ORIGIN must be ${expected.origin}.`);
  const databases = Array.isArray(config.d1_databases) ? config.d1_databases as Record<string, unknown>[] : [];
  const db = databases.find(item => item.binding === 'DB');
  if (!db) problems.push('d1_databases must bind DB.');
  else if (typeof db.database_id !== 'string' || PLACEHOLDER_ID.test(db.database_id)) problems.push('DB database_id is missing or still the placeholder.');
  // The account is on Workers Free, which rejects CPU limits at deploy time (code 100328).
  if (config.limits !== undefined) problems.push('Remove "limits": the Workers Free plan rejects CPU limits (Cloudflare error 100328).');
  const assets = (config.assets ?? {}) as Record<string, unknown>;
  if (!Array.isArray(assets.run_worker_first) || !assets.run_worker_first.includes('/version')) problems.push('assets.run_worker_first must include /version.');
  return { ok: problems.length === 0, problems };
}

export function databaseName(raw: string): string {
  const config = JSON.parse(raw) as { d1_databases?: { binding?: string; database_name?: string }[] };
  const name = config.d1_databases?.find(item => item.binding === 'DB')?.database_name;
  if (!name) throw new Error('DB database_name is missing.');
  return name;
}

export interface SmokeResult { path: string; ok: boolean; detail: string }

/** Read-only checks after a deploy. Never creates rooms, sends commands or calls AI. */
export async function smoke(origin: string, version: string, sha: string, fetcher: typeof fetch = fetch, requireCompute = false): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  const get = async (path: string) => fetcher(new URL(path, origin), { redirect: 'manual', headers: { 'cache-control': 'no-cache' } });
  for (const path of ['/healthz', '/readyz']) {
    const response = await get(path);
    results.push({ path, ok: response.status === 200, detail: `HTTP ${response.status}` });
  }
  const capabilities = await get('/api/capabilities');
  let capabilitiesJson = false;
  let compute: { profile?: unknown; runtimes?: unknown; pythonLibraries?: unknown } | undefined;
  try {
    const payload = await capabilities.json() as { compute?: typeof compute } | null;
    capabilitiesJson = typeof payload === 'object' && payload !== null;
    compute = payload?.compute;
  } catch { /* not JSON */ }
  results.push({ path: '/api/capabilities', ok: capabilities.status === 200 && capabilitiesJson, detail: `HTTP ${capabilities.status}${capabilitiesJson ? '' : ', not JSON'}` });
  if (requireCompute) {
    const expected = computeRuntimeCapabilities({ javascript: true, python: true });
    const runtimes = compute?.runtimes;
    const libraries = compute?.pythonLibraries;
    const ok = compute?.profile === expected.profile
      && Array.isArray(runtimes) && expected.runtimes.every(runtime => runtimes.includes(runtime))
      && Array.isArray(libraries) && expected.pythonLibraries.every(library => libraries.includes(library));
    results.push({ path: '/api/capabilities.compute', ok, detail: ok ? `JavaScript/Python profile ${expected.profile} enabled (execution tested separately)` : 'Required JavaScript/Python profile is not fully enabled.' });
  }
  const versionResponse = await get('/version');
  let served: { version?: unknown; sha?: unknown } = {};
  try { served = await versionResponse.json() as typeof served; } catch { /* not JSON */ }
  results.push({ path: '/version', ok: served.version === version && typeof served.sha === 'string' && sha.startsWith(served.sha), detail: `serves ${String(served.version)} / ${String(served.sha)}, expected ${version} / ${sha.slice(0, 7)}` });
  for (const path of ['/', '/new']) {
    const response = await get(path);
    const html = response.status === 200 ? await response.text() : '';
    results.push({ path, ok: response.status === 200 && html.includes('<div id="root"'), detail: `HTTP ${response.status}` });
  }
  return results;
}

async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  if (command === 'version') {
    const version = releaseVersionFromMerge(args.join(' '));
    process.stdout.write(version ?? '');
    return 0;
  }
  if (command === 'changelog') {
    const { readFileSync } = await import('node:fs');
    return changelogHasVersion(readFileSync('CHANGELOG.md', 'utf8'), args[0]) ? 0 : 1;
  }
  if (command === 'check-config') {
    const { readFileSync } = await import('node:fs');
    const [file, name, origin] = args;
    const result = checkDeployConfig(readFileSync(file, 'utf8'), { name, origin });
    for (const problem of result.problems) console.error(`::error::${file}: ${problem}`);
    return result.ok ? 0 : 1;
  }
  if (command === 'db-name') {
    const { readFileSync } = await import('node:fs');
    process.stdout.write(databaseName(readFileSync(args[0], 'utf8')));
    return 0;
  }
  if (command === 'smoke') {
    const [origin, version, sha] = args;
    // Workers propagate within seconds; retry the whole set for up to ~2 minutes.
    let last: SmokeResult[] = [];
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      try { last = await smoke(origin, version, sha, fetch, args.includes('--compute')); } catch (error) { last = [{ path: '*', ok: false, detail: String(error) }]; }
      if (last.every(result => result.ok)) break;
      await new Promise(resolve => setTimeout(resolve, 10_000));
    }
    for (const result of last) console.log(`${result.ok ? 'PASS' : 'FAIL'} ${origin}${result.path} — ${result.detail}`);
    return last.every(result => result.ok) ? 0 : 1;
  }
  console.error('Usage: release-deploy.ts version|changelog|check-config|db-name|smoke …');
  return 2;
}

if (process.argv[1]?.endsWith('release-deploy.ts')) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => { console.error(error); process.exitCode = 1; });
}
