import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';

// Run after a build with a harmless canary, never a production credential.
// This checks the published files, including source maps, without logging values.
const root = resolve('dist');
const canary = 'tabletop-ci-secret-canary-for-build';
const values = [canary, process.env.DEEPSEEK_KEY].filter(value => value && value.length >= 8);
const needles = [...new Set(values.flatMap(value => [
  value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value),
  Buffer.from(value).toString('base64'),
]))].map(value => Buffer.from(value));
const findings = [];
let scannedFiles = 0;

function visit(directory) {
  for (const name of readdirSync(directory)) {
    const path = join(directory, name);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error('BUILD_SYMLINK_REQUIRES_REVIEW');
    if (stat.isDirectory()) { visit(path); continue; }
    if (!stat.isFile()) continue;
    scannedFiles += 1;
    const bytes = readFileSync(path);
    if (needles.some(needle => bytes.includes(needle))) {
      findings.push({ file: relative(root, path), reason: 'Server-only secret or build canary in browser asset' });
    }
  }
}

try {
  visit(root);
  if (!scannedFiles) throw new Error('BUILD_MISSING');
  console.log(JSON.stringify({ check: 'browser-secret-boundary', scannedFiles, findings }));
  if (findings.length) process.exitCode = 1;
} catch {
  console.error(JSON.stringify({ check: 'browser-secret-boundary', error: 'BUILD_UNAVAILABLE_OR_UNSAFE' }));
  process.exitCode = 1;
}
