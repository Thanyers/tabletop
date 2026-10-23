import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { after, test } from 'node:test';
import { attachDeepSeekStartup, collectStartup, hookResponse } from './agent-startup.mjs';
import { TabletopStartup } from '../.opencode/plugins/tabletop-startup.js';
import { activateDeepSeek, buildDeepSeekPatch, mergeWorkspaceHooks } from './setup-agent-startup.mjs';

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'tabletop-startup-test-'));
const project = fileURLToPath(new URL('../', import.meta.url));
let fixtureNumber = 0;
const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();

after(() => {
  // Remove only the disposable directory returned by mkdtemp for this test run.
  assert.equal(path.dirname(temporaryRoot), path.resolve(tmpdir()));
  assert.ok(path.basename(temporaryRoot).startsWith('tabletop-startup-test-'));
  rmSync(temporaryRoot, { recursive: true, force: true });
});

function fixture() {
  const suffix = ++fixtureNumber;
  const origin = path.join(temporaryRoot, `origin-${suffix}.git`);
  const seed = path.join(temporaryRoot, `seed-${suffix}`);
  const work = path.join(temporaryRoot, `work with spaces ${suffix}`);
  git(temporaryRoot, 'init', '--bare', origin);
  git(temporaryRoot, 'init', '-b', 'dev', seed);
  git(seed, 'config', 'user.name', 'Fixture');
  git(seed, 'config', 'user.email', 'fixture@example.invalid');
  writeFileSync(path.join(seed, 'AGENTS.md'), '# Fixture policy\nKeep both Markdown additions.\n');
  writeFileSync(path.join(seed, 'tracked.txt'), 'original\n');
  git(seed, 'add', '.');
  git(seed, 'commit', '-m', 'initial fixture');
  git(seed, 'remote', 'add', 'origin', origin);
  git(seed, 'push', 'origin', 'dev');
  git(temporaryRoot, 'clone', '--branch', 'dev', origin, work);
  git(work, 'remote', 'set-url', 'origin', 'https://github.com/Thanyers/tabletop.git');
  // The production adapter sees its intended repo, while all traffic stays local.
  git(work, 'config', `url.${pathToFileURL(origin).href}.insteadOf`, 'https://github.com/Thanyers/tabletop.git');
  git(work, 'switch', '-c', 'feat/fixture');
  return { origin, seed, work };
}

function publish(seed, policy) {
  writeFileSync(path.join(seed, 'AGENTS.md'), policy);
  git(seed, 'add', 'AGENTS.md');
  git(seed, 'commit', '-m', 'update fixture policy');
  git(seed, 'push', 'origin', 'dev');
  return git(seed, 'rev-parse', 'HEAD');
}

test('fetches fresh policy while preserving dirty, staged and untracked work', async () => {
  const { seed, work } = fixture();
  writeFileSync(path.join(work, 'tracked.txt'), 'staged\n');
  git(work, 'add', 'tracked.txt');
  writeFileSync(path.join(work, 'tracked.txt'), 'unstaged\n');
  writeFileSync(path.join(work, 'untracked.txt'), 'keep me\n');
  const before = { head: git(work, 'rev-parse', 'HEAD'), index: git(work, 'diff', '--cached'), status: git(work, 'status', '--porcelain') };
  const revision = publish(seed, '# New policy\nNew instructions from dev.\n');
  const result = await collectStartup({ cwd: work });
  assert.equal(result.status, 'fresh');
  assert.equal(result.revision, revision);
  assert.equal(result.devInHead, false);
  assert.equal(result.dirty, true);
  assert.match(result.context, /New instructions from dev/);
  assert.deepEqual({ head: git(work, 'rev-parse', 'HEAD'), index: git(work, 'diff', '--cached'), status: git(work, 'status', '--porcelain') }, before);
  assert.equal(readFileSync(path.join(work, 'tracked.txt'), 'utf8'), 'unstaged\n');
  assert.equal(readFileSync(path.join(work, 'untracked.txt'), 'utf8'), 'keep me\n');
});

test('another task in the same checkout receives changed dev rules', async () => {
  const { seed, work } = fixture();
  const first = await collectStartup({ cwd: work });
  const revision = publish(seed, '# Next task\nLatest shared rules.\n');
  const second = await collectStartup({ cwd: work });
  assert.equal(first.status, 'fresh');
  assert.equal(first.devInHead, true);
  assert.equal(second.revision, revision);
  assert.notEqual(first.revision, second.revision);
  assert.match(second.context, /Latest shared rules/);
});

test('unavailable remote reports UNVERIFIED without replaying cached rules', async () => {
  const { origin, work } = fixture();
  assert.equal((await collectStartup({ cwd: work })).status, 'fresh');
  renameSync(origin, `${origin}.offline`);
  const result = await collectStartup({ cwd: work });
  assert.equal(result.status, 'unverified');
  assert.match(result.context, /UNVERIFIED/);
  assert.doesNotMatch(result.context, /Keep both Markdown additions/);
  assert.doesNotMatch(result.context, /file:|github\.com|tabletop-startup-test-/);
});

test('missing policy on current dev is not mistaken for a successful policy read', async () => {
  const { seed, work } = fixture();
  git(seed, 'rm', 'AGENTS.md');
  git(seed, 'commit', '-m', 'remove fixture policy');
  git(seed, 'push', 'origin', 'dev');
  const result = await collectStartup({ cwd: work });
  assert.equal(result.status, 'unverified');
  assert.doesNotMatch(result.context, /Keep both Markdown additions/);
});

test('global adapters do not fetch or inject policy into unrelated repositories', async () => {
  const { work } = fixture();
  git(work, 'remote', 'set-url', 'origin', 'https://example.invalid/unrelated.git');
  assert.deepEqual(await collectStartup({ cwd: work }), { status: 'not-applicable', context: '' });
  assert.deepEqual(await collectStartup({ cwd: temporaryRoot }), { status: 'not-applicable', context: '' });
});

test('both command-hook events emit valid JSON with context, not stdout noise', () => {
  const { work } = fixture();
  for (const hook_event_name of ['SessionStart', 'UserPromptSubmit']) {
    const child = spawnSync(process.execPath, [path.join(project, 'scripts/agent-startup.mjs'), 'hook'], {
      cwd: work, input: JSON.stringify({ cwd: work, hook_event_name }), encoding: 'utf8', windowsHide: true,
    });
    assert.equal(child.status, 0, child.stderr);
    const output = JSON.parse(child.stdout);
    assert.equal(output.hookSpecificOutput.hookEventName, hook_event_name);
    assert.match(output.hookSpecificOutput.additionalContext, /FRESH/);
  }
});

test('native Codex shell command and Claude direct argv work from a nested cwd with spaces', () => {
  const { work } = fixture();
  const nested = path.join(work, 'nested folder');
  mkdirSync(nested);
  mkdirSync(path.join(work, 'scripts'));
  writeFileSync(path.join(work, 'scripts/agent-startup.mjs'), readFileSync(path.join(project, 'scripts/agent-startup.mjs')));
  const input = JSON.stringify({ cwd: nested, hook_event_name: 'UserPromptSubmit' });
  const codex = JSON.parse(readFileSync(path.join(project, '.codex/hooks.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
  const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
  const shellArgs = process.platform === 'win32'
    ? ['-NoProfile', '-NonInteractive', '-Command', codex.commandWindows]
    : ['-c', codex.command];
  const codexRun = spawnSync(shell, shellArgs, { cwd: nested, input, encoding: 'utf8', windowsHide: true });
  assert.equal(codexRun.status, 0, codexRun.stderr);
  assert.match(JSON.parse(codexRun.stdout).hookSpecificOutput.additionalContext, /: FRESH/);
  assert.equal(codex.additionalContextLimit, 0);
  const claude = JSON.parse(readFileSync(path.join(project, '.claude/settings.json'), 'utf8')).hooks.UserPromptSubmit[0].hooks[0];
  const args = claude.args.map(arg => arg.replace('${CLAUDE_PROJECT_DIR}', work));
  const claudeRun = spawnSync(claude.command, args, { cwd: nested, input, encoding: 'utf8', windowsHide: true });
  assert.equal(claudeRun.status, 0, claudeRun.stderr);
  assert.match(JSON.parse(claudeRun.stdout).hookSpecificOutput.additionalContext, /: FRESH/);
});

test('OpenCode refreshes on each prompt and injects current policy before model dispatch', async () => {
  const { work, seed } = fixture();
  const hooks = await TabletopStartup({ directory: work });
  await hooks['chat.message']({ sessionID: 'fixture-session' });
  const first = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'fixture-session' }, first);
  assert.match(first.system[0], /Keep both Markdown additions/);
  publish(seed, '# Rules updated\nNew OpenCode task policy.\n');
  await hooks['chat.message']({ sessionID: 'fixture-session' });
  const next = { system: [] };
  await hooks['experimental.chat.system.transform']({ sessionID: 'fixture-session' }, next);
  assert.match(next.system[0], /New OpenCode task policy/);
  assert.doesNotMatch(next.system[0], /Keep both Markdown additions/);
  const compact = { context: [] };
  await hooks['experimental.session.compacting']({ sessionID: 'fixture-session' }, compact);
  assert.match(compact.context[0], /New OpenCode task policy/);
});

test('checked-in policy fits full Claude context and oversize output cannot claim a full read', () => {
  const policy = readFileSync(path.join(project, 'AGENTS.md'), 'utf8').replaceAll('\r\n', '\n');
  // Reserve room for Git evidence, a maximum-length branch name, and delimiters.
  assert.ok(policy.length + 1000 <= 10_000, `AGENTS.md too large: ${policy.length} characters`);
  const output = hookResponse({ context: 'x'.repeat(10_001), revision: 'abc' }, 'SessionStart');
  assert.ok(output.hookSpecificOutput.additionalContext.length <= 10_000);
  assert.match(output.hookSpecificOutput.additionalContext, /POLICY_CONTEXT_TOO_LARGE/);
  assert.doesNotMatch(output.hookSpecificOutput.additionalContext, /: FRESH/);
});

test('DeepSeek awaits fresh rules in the same first human request, preserving other context', async () => {
  const { seed, work } = fixture();
  let listener;
  const ctx = {
    on: (event, callback, options) => {
      assert.equal(event, 'agent/pre-step');
      assert.equal(options.prepend, true);
      listener = callback;
    },
    workingDirectory: { ensure: async () => work },
  };
  attachDeepSeekStartup(ctx, message => message);
  const signal = new AbortController().signal;
  const incoming = [{ source: { kind: 'user' }, content: [] }];
  const base = { kind: 'enter', messages: [...incoming], startsRequestSeries: true };
  const input = { agent: {}, messages: incoming, step: 1, signal };
  const first = await listener(input, async () => base);
  assert.equal(first.messages.length, 2);
  assert.deepEqual(first.messages[0], incoming[0]);
  assert.equal(first.startsRequestSeries, true);
  assert.match(first.messages[1].content[0].text, /Keep both Markdown additions/);
  publish(seed, '# Next DeepSeek task\nNew native plugin policy.\n');
  const next = await listener(input, async () => base);
  assert.match(next.messages[1].content[0].text, /New native plugin policy/);
  assert.equal(await listener({ ...input, step: 2 }, async () => base), base);
  assert.equal(await listener({ ...input, messages: [{ source: { kind: 'tool' } }] }, async () => base), base);
  const rejected = { kind: 'reject' };
  assert.equal(await listener(input, async () => rejected), rejected);
});

test('publication gate allows only named adapters and still scans them for secrets', () => {
  const { work } = fixture();
  mkdirSync(path.join(work, '.codex'), { recursive: true });
  writeFileSync(path.join(work, '.codex/hooks.json'), '{}');
  const scan = () => {
    const child = spawnSync(process.execPath, [path.join(project, 'scripts/check-public-files.mjs')], { cwd: work, encoding: 'utf8', windowsHide: true });
    return { status: child.status, report: JSON.parse(child.stdout) };
  };
  assert.equal(scan().status, 0);
  writeFileSync(path.join(work, '.codex/private-state.json'), '{}');
  mkdirSync(path.join(work, '.claude'));
  writeFileSync(path.join(work, '.claude/settings.local.json'), '{}');
  writeFileSync(path.join(work, '.codex/hooks.json'), `{"example":"${'sk-' + 'x'.repeat(30)}"}`);
  const result = scan();
  assert.equal(result.status, 1);
  assert.ok(result.report.findings.some(f => f.file === '.codex/private-state.json' && f.reason === 'Private or generated path'));
  assert.ok(result.report.findings.some(f => f.file === '.claude/settings.local.json' && f.reason === 'Private or generated path'));
  assert.ok(result.report.findings.some(f => f.file === '.codex/hooks.json' && f.reason === 'Provider secret'));
});

test('DeepSeek home setup is idempotent and preserves unrelated patch rows', () => {
  const before = '# Existing settings\n- id: other-plugin\n  disabled: false\n';
  const first = buildDeepSeekPatch(before, 'C:\\Users\\Fixture\\plugins\\index.js');
  assert.ok(first.startsWith(before));
  assert.equal(first.split('id: tabletop-task-startup').length - 1, 1);
  assert.equal(buildDeepSeekPatch(first, 'C:\\Users\\Fixture\\plugins\\index.js'), first);
  const moved = buildDeepSeekPatch(first, '/new/location/index.js');
  assert.ok(moved.startsWith(before));
  assert.equal(moved.split('id: tabletop-task-startup').length - 1, 1);
  assert.doesNotMatch(moved, /C:\/Users/);
  assert.throws(() => buildDeepSeekPatch('settings: {}\n', '/plugin.js'), /preserved/);
  assert.throws(() => buildDeepSeekPatch('# BEGIN Tabletop automatic task startup\n', '/plugin.js'), /Ambiguous/);
});

test('failed DeepSeek update preserves the live plugin and patch; successful activation is idempotent', async () => {
  const home = path.join(temporaryRoot, 'activation fixture');
  const oldFiles = { 'index.js': 'export const oldValue = true;\n' };
  const first = await activateDeepSeek(home, oldFiles, async () => {});
  const patch = path.join(home, 'cordis.patch.yml');
  const live = readFileSync(patch, 'utf8');
  await assert.rejects(activateDeepSeek(home, { 'index.js': 'invalid candidate' }, async () => {
    assert.equal(readFileSync(patch, 'utf8'), live);
    assert.equal(readFileSync(path.join(first, 'index.js'), 'utf8'), oldFiles['index.js']);
    throw new Error('validation failed');
  }), /validation failed/);
  assert.equal(readFileSync(patch, 'utf8'), live);
  assert.equal(readFileSync(path.join(first, 'index.js'), 'utf8'), oldFiles['index.js']);
  assert.equal(await activateDeepSeek(home, oldFiles, async () => {}), first);
  assert.equal(readFileSync(patch, 'utf8'), live);
  await assert.rejects(activateDeepSeek(home, { 'index.js': 'another candidate' }, async () => {
    writeFileSync(patch, live + '# changed by another actor\n');
  }), /changed during setup/);
  assert.match(readFileSync(patch, 'utf8'), /changed by another actor/);
});

test('workspace setup preserves co-hooks inside a mixed managed group and unrelated events', () => {
  const script = '/workspace/tabletop/scripts/agent-startup.mjs';
  const other = { type: 'command', command: 'echo keep-me' };
  const existing = { hooks: { SessionStart: [{ matcher: 'startup', hooks: [{ command: `node '${script}' hook` }, other] }], Stop: [{ hooks: [other] }] } };
  const template = { hooks: { SessionStart: [{ hooks: [{ type: 'command' }] }] } };
  const merged = mergeWorkspaceHooks(existing, template, script);
  assert.deepEqual(merged.hooks.SessionStart[0], { matcher: 'startup', hooks: [other] });
  assert.deepEqual(merged.hooks.Stop, existing.hooks.Stop);
  assert.deepEqual(mergeWorkspaceHooks(merged, template, script), merged);
  assert.equal(existing.hooks.SessionStart[0].hooks.length, 2);
});

test('DeepSeek activation preserves protected POSIX patch permissions and private backups', { skip: process.platform === 'win32' }, async () => {
  const home = path.join(temporaryRoot, 'protected setup');
  mkdirSync(home);
  const patch = path.join(home, 'cordis.patch.yml');
  writeFileSync(patch, '# private settings\n');
  chmodSync(patch, 0o600);
  const target = await activateDeepSeek(home, { 'index.js': 'export const enabled = true;' }, async () => {});
  assert.equal(statSync(patch).mode & 0o777, 0o600);
  assert.equal(statSync(path.join(target, 'home-patch.before.yml')).mode & 0o777, 0o600);
});

test('setup refuses a symlinked home patch without detaching it or changing its target', { skip: process.platform === 'win32' }, async () => {
  const home = path.join(temporaryRoot, 'linked config setup');
  mkdirSync(home);
  const canonical = path.join(home, 'canonical.patch.yml');
  const patch = path.join(home, 'cordis.patch.yml');
  writeFileSync(canonical, '# managed elsewhere\n');
  symlinkSync(canonical, patch);
  await assert.rejects(activateDeepSeek(home, { 'index.js': 'candidate' }, async () => {}), /symlink/);
  assert.equal(lstatSync(patch).isSymbolicLink(), true);
  assert.equal(readFileSync(canonical, 'utf8'), '# managed elsewhere\n');
});
