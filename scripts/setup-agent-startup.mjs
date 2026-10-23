import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, access, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const project = fileURLToPath(new URL('../', import.meta.url));
const begin = '# BEGIN Tabletop automatic task startup';
const end = '# END Tabletop automatic task startup';

export function buildDeepSeekPatch(existing, modulePath) {
  const starts = existing.split(begin).length - 1;
  const ends = existing.split(end).length - 1;
  if (starts !== ends || starts > 1) throw new Error('Ambiguous existing Tabletop startup block.');
  let rest = existing;
  if (starts) {
    const from = existing.indexOf(begin);
    const to = existing.indexOf(end);
    if (to < from) throw new Error('Invalid existing Tabletop startup block.');
    rest = existing.slice(0, from) + existing.slice(to + end.length).replace(/^\r?\n/, '');
  }
  const firstContent = rest.split(/\r?\n/).find(line => line.trim() && !line.trim().startsWith('#'));
  if (firstContent && !/^\s*-\s/.test(firstContent) && firstContent.trim() !== '[]') {
    throw new Error('Existing DSH home patch is not a patch list; preserved without changes.');
  }
  if (firstContent?.trim() === '[]') rest = rest.replace(/^\s*\[\]\s*$/m, '');
  const block = [
    begin, '- insert:', '    - id: tabletop-task-startup',
    `      name: ${JSON.stringify(modulePath.replaceAll('\\', '/'))}`, end, '',
  ].join('\n');
  return rest.replace(/\s*$/, '') + (rest.trim() ? '\n\n' : '') + block;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export async function discoverDeepSeek() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Programs', 'DeepSeek Harness');
    const executable = path.join(base, 'DeepSeek Harness.exe');
    if (await exists(executable)) {
      return {
        executable,
        args: ['--expose-internals', path.join(base, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js')],
        sdkBase: path.join(base, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      };
    }
  }
  try {
    await execute('dsh', ['--version'], { timeout: 15_000, windowsHide: true });
    return { executable: 'dsh', args: [], env: process.env };
  } catch { return undefined; }
}

async function nativeSdkUrl(command) {
  if (command.sdkBase) {
    const code = 'const {createRequire}=require("node:module"); const {pathToFileURL}=require("node:url"); process.stdout.write(pathToFileURL(createRequire(process.argv[1]).resolve("@deepseek-ai/dsh-llm")).href)';
    const { stdout } = await execute(command.executable, ['--expose-internals', '-e', code, command.sdkBase], {
      env: command.env, windowsHide: true, timeout: 15_000,
    });
    const url = new URL(stdout.trim());
    if (url.protocol !== 'file:' || !url.pathname.includes('/@deepseek-ai/dsh-llm/')) throw new Error('Unexpected DSH SDK location.');
    return url.href;
  }
  const { stdout } = await execute(process.platform === 'win32' ? 'where' : 'which', ['dsh'], { windowsHide: true });
  const binary = await realpath(stdout.trim().split(/\r?\n/)[0]);
  const resolve = createRequire(binary).resolve;
  return pathToFileURL(resolve('@deepseek-ai/dsh-llm')).href;
}

export async function setupAgentStartup({ workspaceRoot } = {}) {
  let workspaceCodex;
  if (workspaceRoot) {
    const workspace = path.resolve(workspaceRoot);
    if (path.relative(workspace, path.dirname(project.replace(/[\\/]$/, ''))) !== '') {
      throw new Error('Workspace bridge must be the immediate parent of this checkout.');
    }
    const file = path.join(workspace, '.codex', 'hooks.json');
    const existing = await exists(file) ? JSON.parse(await readFile(file, 'utf8')) : {};
    const template = JSON.parse(await readFile(path.join(project, '.codex/hooks.json'), 'utf8'));
    const script = path.join(project, 'scripts', 'agent-startup.mjs').replaceAll('\\', '/');
    const posixPath = "'" + script.replaceAll("'", "'\\''") + "'";
    const powershellPath = "'" + script.replaceAll("'", "''") + "'";
    existing.hooks ||= {};
    for (const [event, groups] of Object.entries(template.hooks)) {
      for (const group of groups) for (const hook of group.hooks) {
        hook.command = `node ${posixPath} hook`;
        hook.commandWindows = `node ${powershellPath} hook`;
      }
      const retained = (existing.hooks[event] || []).filter(group =>
        !group.hooks?.some(hook => hook.command?.includes(script)));
      existing.hooks[event] = [...retained, ...groups];
    }
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(existing, null, 2) + '\n');
    workspaceCodex = 'local parent-workspace hooks ready; reference checkout is named in each receipt';
  }
  const command = await discoverDeepSeek();
  if (!command) {
    return { codex: 'project hooks ready', workspaceCodex, claude: 'project hooks ready', opencode: 'project plugin ready', deepseek: 'NOT_INSTALLED: no runnable DeepSeek Harness found' };
  }
  const home = path.resolve(process.env.DSH_HOME || path.join(homedir(), '.dsh'));
  const target = path.join(home, 'plugins', 'tabletop-task-startup');
  const manifest = path.join(target, 'package.json');
  if (await exists(manifest)) {
    const old = JSON.parse(await readFile(manifest, 'utf8'));
    if (old.name !== '@local/tabletop-task-startup') throw new Error('Plugin destination belongs to another package; preserved.');
  }
  await mkdir(target, { recursive: true });
  for (const name of ['package.json', 'index.js', 'cordis.patch.yml']) {
    await writeFile(path.join(target, name), await readFile(path.join(project, 'tools/deepseek-startup', name)));
  }
  await writeFile(path.join(target, 'agent-startup.mjs'), await readFile(path.join(project, 'scripts/agent-startup.mjs')));
  // Use the installed host's SDK instance; arbitrary home plugins do not join a
  // profile's linked-package peer resolver. No SDK download or duplicate copy.
  await writeFile(path.join(target, 'native-sdk.mjs'), `export { createUserMessage } from ${JSON.stringify(await nativeSdkUrl(command))};\n`);
  const patch = path.join(home, 'cordis.patch.yml');
  const before = await exists(patch) ? await readFile(patch, 'utf8') : '';
  const modulePath = path.join(target, 'index.js');
  const next = buildDeepSeekPatch(before, modulePath);
  const overlay = path.join(target, 'startup-validation.patch.yml');
  await writeFile(overlay, buildDeepSeekPatch('', modulePath));
  // Import the real adapter with the host's actual SDK, without a model/session.
  const probe = 'const {pathToFileURL}=require("node:url"); import(pathToFileURL(process.argv[1]).href).then(m=>{let n=0;m.apply({on:(event,fn)=>{if(event!=="agent/pre-step"||typeof fn!=="function")throw Error("bad hook");n++}});if(n!==1)throw Error("missing hook")}).catch(()=>process.exitCode=1)';
  await execute(command.sdkBase ? command.executable : process.execPath, [
    ...(command.sdkBase ? ['--expose-internals'] : []), '-e', probe, modulePath,
  ], { env: command.env, windowsHide: true, timeout: 15_000 });
  const validationProfile = await exists(path.join(home, 'profiles', 'web', 'package.json')) ? 'web' : 'shared';
  // Check composition using an existing profile. Do not mount a second app or
  // require unrelated third-party plugin schema projections to be error-free.
  await execute(command.executable, [
    ...command.args, '--profile', validationProfile,
    ...(before.includes(begin) ? [] : ['--patch', overlay]), '--dump-config',
  ], {
    env: command.env, windowsHide: true, timeout: 45_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (before !== next) {
    if (before) await writeFile(path.join(target, 'home-patch.before.yml'), before);
    await writeFile(patch, next);
  }
  return {
    codex: 'project hooks ready; native workspace/hook trust required once',
    workspaceCodex,
    claude: 'project hooks ready; native workspace trust required once',
    opencode: 'project plugin ready on next startup',
    deepseek: 'ENABLED: home patch applies to all profiles; existing profile rows preserved',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const workspaceFlag = process.argv.indexOf('--workspace');
  const workspaceRoot = workspaceFlag === -1 ? undefined : process.argv[workspaceFlag + 1];
  setupAgentStartup({ workspaceRoot }).then(result => console.log(JSON.stringify(result, null, 2))).catch(() => {
    console.error('Agent startup setup failed. Existing home patch was preserved; inspect the native harness installation before retrying.');
    process.exitCode = 1;
  });
}
