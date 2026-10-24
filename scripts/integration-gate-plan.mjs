import { appendFile } from 'node:fs/promises';
import { execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';

const execFile = promisify(execFileCallback);
const FAIL_SAFE_GATES = Object.freeze({ worker: true, ui: true, compute: true, compute_container: true });
const NO_GATE_ROOT_FILES = new Set([
  'AGENTS.md',
  'CHANGELOG.md',
  'CONTRIBUTING.md',
  'LICENSE',
  'MEMORY.md',
  'PLAN.md',
  'README.md',
  'spec.md',
]);

const UI_FILES = new Set([
  'src/tabletop/domain/table.ts',
  'src/tabletop/shared/contracts.ts',
  'src/tabletop/shared/table-compute.ts',
  'src/tabletop/shared/table-contracts.ts',
  'src/tabletop/runtime/index.ts',
  'src/tabletop/ui/TableCanvasObjects.tsx',
  'src/tabletop/ui/TableChat.tsx',
  'src/tabletop/ui/TableComputeModuleCard.tsx',
  'src/tabletop/ui/canvas-object-finder.ts',
  'src/tabletop/ui/table-chat-state.ts',
  'src/tabletop/ui/table-compute-ui.ts',
  'src/tabletop/ui/table-chat.css',
  'src/tabletop/ui/tabletop.css',
  'src/tabletop/ui/tabletop-tokens.css',
  'src/tabletop/ui/calm-workspace.css',
  'src/tabletop/ui/record-actions.css',
  'scripts/build-f066-rules-harness.mjs',
  'tests/ui/f066-rules.html',
  'tests/ui/f066-rules-harness.tsx',
  'tests/ui/f066-rules-harness.css',
  'tests/ui/f066-rules-browser.mjs',
]);

const COMPUTE_PATH = /(?:^|\/)(?:compute|computed|table-compute)(?:\/|[-._]|$)/iu;

function normalizePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '').replace(/\/+/gu, '/');
}

function isWorkerPath(file) {
  return file.startsWith('cloudflare/')
    || file.startsWith('server/providers/')
    || file.startsWith('shared/')
    || file.startsWith('src/shared/')
    || file.startsWith('src/tabletop/shared/')
    || file.startsWith('src/tabletop/domain/')
    || file.startsWith('src/tabletop/runtime/')
    || file === 'wrangler.jsonc';
}

function isUiPath(file) {
  return UI_FILES.has(file) || file.startsWith('tests/ui/f066-rules');
}

function isComputePath(file) {
  return file.startsWith('compute/') || COMPUTE_PATH.test(file);
}

/**
 * Select the extra risk-targeted checks for a non-empty, explicitly supplied path list.
 * Missing or malformed input runs every gate so callers cannot accidentally check nothing.
 */
export function selectIntegrationGates(changedPaths) {
  if (!Array.isArray(changedPaths) || changedPaths.length === 0
      || changedPaths.some((file) => typeof file !== 'string' || !file.trim())) {
    return { ...FAIL_SAFE_GATES };
  }

  const files = changedPaths.map(normalizePath);
  const plannerOrWorkflowChanged = files.some((file) => file.startsWith('scripts/integration-gate-')
    || file === '.github/workflows/validate.yml'
    || file === 'package.json'
    || file === 'package-lock.json');
  if (plannerOrWorkflowChanged) return { ...FAIL_SAFE_GATES };

  const gates = {
    worker: files.some(isWorkerPath),
    ui: files.some(isUiPath),
    compute: files.some(isComputePath),
    compute_container: files.some((file) => file.startsWith('compute/')),
  };
  const explicitlyUncovered = files.some((file) => !isWorkerPath(file) && !isUiPath(file) && !isComputePath(file)
    && !file.startsWith('docs/') && !file.startsWith('changelog.d/') && !NO_GATE_ROOT_FILES.has(file));
  if (explicitlyUncovered) return { ...FAIL_SAFE_GATES };

  return gates;
}

/** Parse `git diff --name-status -z`, retaining both names for renames and copies. */
export function parseNameStatusZ(output) {
  if (typeof output !== 'string') throw new TypeError('Git path output must be text.');
  if (output === '') return [];

  const fields = output.split('\0');
  if (fields.at(-1) === '') fields.pop();
  const paths = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^(?:[RC]\d+|[ACDMTUXB])$/u.test(status)) {
      throw new Error('Git returned an unsupported name-status record; refusing to select no gates.');
    }
    const pathCount = /^[RC]/u.test(status) ? 2 : 1;
    if (index + pathCount > fields.length) {
      throw new Error('Git returned an incomplete name-status record; refusing to select no gates.');
    }
    for (const rawPath of fields.slice(index, index + pathCount)) {
      if (!rawPath) throw new Error('Git returned an empty path; refusing to select no gates.');
      paths.push(normalizePath(rawPath));
    }
    index += pathCount;
  }
  return paths;
}

async function runGit(args) {
  const { stdout } = await execFile('git', args, {
    cwd: process.cwd(),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

function isCommitSha(value) {
  return typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/iu.test(value);
}

/** Resolve the exact event commits and compute the same three-dot path diff used for a PR. */
export async function collectChangedPaths({ baseSha, headSha, git = runGit } = {}) {
  if (!isCommitSha(baseSha) || !isCommitSha(headSha)) {
    throw new Error('PR base and head commit SHAs are required; refusing to select no gates.');
  }

  for (const [label, sha] of [['base', baseSha], ['head', headSha]]) {
    try {
      await git(['cat-file', '-e', `${sha}^{commit}`]);
    } catch {
      throw new Error(`PR ${label} commit is unavailable in the checkout; refusing to select no gates.`);
    }
  }

  let diff;
  try {
    diff = await git(['diff', '--name-status', '-z', '--find-renames', `${baseSha}...${headSha}`]);
  } catch {
    throw new Error('Could not compare the PR base and head; refusing to select no gates.');
  }
  return parseNameStatusZ(diff);
}

function parseArguments(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--base' || option === '--head') {
      const value = args[++index];
      if (!value) throw new Error(`${option} requires a commit SHA.`);
      parsed[option.slice(2)] = value;
    } else if (option === '--help') {
      parsed.help = true;
    } else {
      throw new Error(`Unknown argument: ${option}`);
    }
  }
  return parsed;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write('Usage: node scripts/integration-gate-plan.mjs --base <PR-base-SHA> --head <PR-head-SHA>\n');
    return;
  }

  const changedPaths = await collectChangedPaths({ baseSha: args.base, headSha: args.head });
  const gates = selectIntegrationGates(changedPaths);
  const output = `${Object.entries(gates).map(([name, selected]) => `${name}=${selected}`).join('\n')}\n`;
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, output, 'utf8');
  else process.stdout.write(JSON.stringify({ changedPathCount: changedPaths.length, gates }, null, 2) + '\n');

  const selected = Object.entries(gates).filter(([, enabled]) => enabled).map(([name]) => name);
  process.stdout.write(`Integration gates selected: ${selected.length ? selected.join(', ') : 'none'} (${changedPaths.length} changed paths).\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`Integration gate planning failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
