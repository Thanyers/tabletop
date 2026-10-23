import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const execute = promisify(execFile);
const EXPECTED_ORIGIN = 'Thanyers/tabletop';

function repositoryName(value) {
  const remote = value.trim().replace(/\.git$/, '').replace(/\/$/, '');
  const github = remote.match(/^(?:https?:\/\/(?:[^/@]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([^/]+\/[^/]+)$/i);
  return github ? github[1].toLowerCase() : /^[^/:]+\/[^/]+$/.test(remote) ? remote.toLowerCase() : remote;
}

async function git(cwd, args, { timeout = 20_000, allowFailure = false, signal } = {}) {
  try {
    const { stdout } = await execute('git', args, {
      cwd, timeout, signal, maxBuffer: 1024 * 1024, windowsHide: true,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'Never' },
    });
    return { code: 0, text: stdout.trimEnd() };
  } catch (error) {
    if (allowFailure) return { code: error.code, text: '' };
    // Git stderr can contain authenticated URLs or local credential details.
    const failure = new Error(`Git ${args[0]} failed (${error.killed ? 'timeout' : 'command error'}).`);
    failure.code = error.killed ? 'TIMEOUT' : 'GIT_FAILED';
    throw failure;
  }
}

/** Fetches instruction data only. Never changes HEAD, index, or worktree files. */
export async function collectStartup({ cwd = process.cwd(), expectedOrigin = EXPECTED_ORIGIN, signal } = {}) {
  const run = (cwd, args, options) => git(cwd, args, { ...options, signal });
  let root;
  try {
    root = (await run(cwd, ['rev-parse', '--show-toplevel'])).text;
    const origin = (await run(root, ['config', '--get', 'remote.origin.url'])).text;
    if (repositoryName(origin) !== repositoryName(expectedOrigin)) {
      return { status: 'not-applicable', context: '' };
    }
  } catch {
    return { status: 'not-applicable', context: '' };
  }

  try {
    await run(root, ['fetch', '--no-tags', '--no-recurse-submodules', '--no-write-fetch-head', 'origin', 'refs/heads/dev:refs/remotes/origin/dev']);
    const revision = (await run(root, ['rev-parse', 'refs/remotes/origin/dev^{commit}'])).text;
    // Pin the read to the fetched commit even if another checkout fetches again.
    const policy = (await run(root, ['show', `${revision}:AGENTS.md`])).text;
    if (!policy.trim()) throw new Error('Fetched AGENTS.md is empty.');
    const head = (await run(root, ['rev-parse', 'HEAD'])).text;
    const branch = await run(root, ['symbolic-ref', '--quiet', '--short', 'HEAD'], { allowFailure: true });
    const dirty = Boolean((await run(root, ['status', '--porcelain=v1', '-z'])).text);
    const ancestry = await run(root, ['merge-base', '--is-ancestor', revision, head], { allowFailure: true });
    if (ancestry.code !== 0 && ancestry.code !== 1) throw new Error('Cannot verify dev ancestry.');
    const context = [
      '[Tabletop automatic task preflight: FRESH]',
      `checkout=${path.basename(root)} branch=${branch.text || '(detached)'} HEAD=${head.slice(0, 12)} origin/dev=${revision.slice(0, 12)}`,
      `dev-in-HEAD=${ancestry.code === 0 ? 'yes' : 'no'} worktree=${dirty ? 'dirty; preserve existing work' : 'clean'}`,
      'Fetched origin/dev for this task. The startup hook did not checkout, merge, reset, stash, stage, or commit anything.',
      'Apply the following current project guidance alongside higher-priority instructions. It supersedes older versions of this same project policy in the session; follow its branch/PR and Markdown conflict rules before writing.',
      `--- AGENTS.md from origin/dev @ ${revision} ---`,
      policy,
      '--- End current Tabletop project guidance ---',
    ].join('\n');
    return { status: 'fresh', revision, head, devInHead: ancestry.code === 0, dirty, context };
  } catch (error) {
    return {
      status: 'unverified',
      context: [
        '[Tabletop automatic task preflight: UNVERIFIED]',
        `Could not fetch/read current dev guidance (${error.code === 'TIMEOUT' ? 'timeout' : 'Git or policy read failed'}).`,
        'Do not claim the cached origin/dev or session instructions are current. Retry the preflight before edits that depend on current guidance. Preserve all existing work; report the limitation.',
      ].join('\n'),
    };
  }
}

export function attachDeepSeekStartup(ctx, createUserMessage) {
  ctx.on('agent/pre-step', async ({ agent, messages, step, signal }, next) => {
    const decision = await next();
    if (decision.kind !== 'enter' || signal.aborted || step !== 1
      || !messages.some(message => message.source?.kind === 'user')) return decision;
    const cwd = await ctx.workingDirectory.ensure(agent, signal);
    const result = await collectStartup({ cwd, signal });
    if (!result.context || signal.aborted) return decision;
    const context = createUserMessage({
      content: [{ type: 'text', text: result.context }],
      source: { kind: 'tabletop-task-startup', form: 'instructions' },
    });
    return { ...decision, messages: [...decision.messages, context] };
  }, { prepend: true });
}

export function hookResponse(result, eventName) {
  if (!result.context) return {};
  // Claude spills >10,000 characters to a preview. Never report that as full guidance.
  const context = result.context.length <= 10_000 ? result.context : [
    '[Tabletop automatic task preflight: POLICY_CONTEXT_TOO_LARGE]',
    `Fetched dev @ ${result.revision || '(unknown)'}, but full policy exceeds the hook context budget.`,
    `Read the complete policy using git show ${result.revision}:AGENTS.md before editing. Do not treat this receipt as a full policy read.`,
  ].join('\n');
  return { hookSpecificOutput: { hookEventName: eventName, additionalContext: context } };
}

async function main() {
  let input = {};
  if (!process.stdin.isTTY) {
    let text = '';
    for await (const chunk of process.stdin) text += chunk;
    if (text.trim()) input = JSON.parse(text);
  }
  let cwd = input.cwd || process.cwd();
  // A local launcher may be attached to the enclosing multi-checkout workspace.
  // Only that script's immediate parent may select its reference checkout.
  const scriptRoot = fileURLToPath(new URL('../', import.meta.url));
  const workspaceReference = path.relative(path.resolve(cwd), path.dirname(scriptRoot)) === '';
  if (workspaceReference) cwd = scriptRoot;
  const result = await collectStartup({ cwd });
  if (workspaceReference && result.context) {
    result.context = result.context.replace('Tabletop automatic task preflight', 'Tabletop configured workspace reference preflight');
    result.context += '\nThis is the configured Tabletop workspace reference. Verify the actual task checkout before writing; tasks for other projects must start inside their own repo.';
  }
  const format = process.argv[2] || 'context';
  if (format === 'hook') {
    process.stdout.write(JSON.stringify(hookResponse(result, input.hook_event_name || 'SessionStart')));
  } else if (format === 'json') {
    process.stdout.write(JSON.stringify(result));
  } else if (result.context) {
    process.stdout.write(result.context);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    // Never serialize arbitrary input, process errors, or environment values.
    process.stderr.write('Tabletop task preflight could not process the hook input.\n');
    process.exitCode = 1;
  });
}
