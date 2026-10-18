import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = resolve(root, 'test-results/auto-demo');
const historyFile = resolve(root, 'docs/auto-demo/hosted-activation-2026-10-19.json');

function inside(parent, target) {
  const path = relative(parent, target);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

const result = spawnSync(process.execPath, ['tests/auto-demo/run.mjs'], {
  cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
});
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);

try {
  const lastLine = (result.stdout ?? '').trim().split(/\r?\n/u).at(-1);
  const receipt = JSON.parse(lastLine ?? '');
  if (!receipt || typeof receipt.runFile !== 'string' || !['passed', 'failed'].includes(receipt.status)) {
    throw new Error('The runner did not return a valid run receipt.');
  }
  const runFile = resolve(root, receipt.runFile);
  if (!inside(outputRoot, runFile) || !runFile.endsWith('/run.json') && !runFile.endsWith('\\run.json')) {
    throw new Error('The runner returned a file outside the auto-demo archive.');
  }
  const reportFile = resolve(dirname(runFile), 'report.html');
  const rendered = spawnSync(process.execPath, [
    'scripts/auto-demo-report.mjs', runFile, '--output', reportFile, '--history', historyFile,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (rendered.stdout) process.stdout.write(rendered.stdout);
  if (rendered.stderr) process.stderr.write(rendered.stderr);
  if (rendered.status !== 0) throw new Error('The replay report could not be generated.');
  await mkdir(outputRoot, { recursive: true });
  await writeFile(resolve(outputRoot, 'latest.json'), JSON.stringify({
    runFile: relative(root, runFile).replaceAll('\\', '/'),
    reportFile: relative(root, reportFile).replaceAll('\\', '/'),
    status: receipt.status,
  }, null, 2) + '\n');
  console.log(JSON.stringify({ report: relative(root, reportFile).replaceAll('\\', '/'), status: receipt.status }));
  process.exitCode = result.status === 0 && receipt.status === 'passed' ? 0 : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Auto-demo orchestration failed.');
  process.exitCode = 1;
}
