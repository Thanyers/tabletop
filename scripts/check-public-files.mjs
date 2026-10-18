import { spawnSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve } from 'node:path';

// A small publication gate for high-confidence mistakes. This is not a complete
// secret detector; the delivery process also compares the authorized credential
// in memory without logging it or writing it into this repository.
const root = resolve(process.cwd());
const listed = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' });
if (listed.status !== 0) throw Error('Cannot enumerate repository files.');
const files = [...new Set(listed.stdout.split('\0').filter(Boolean))];
const findings = [];
const credentialPatterns = [
  ['GitHub credential', /(?:github_pat_[A-Za-z0-9_]{20,}|gh[pousr]_[A-Za-z0-9_]{20,})/],
  ['Provider secret', /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}/],
  ['Private key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['AWS access key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
];
for (const file of files) {
  const path = resolve(root, file);
  if (lstatSync(path).isSymbolicLink()) { findings.push({ file, reason: 'Symlink requires explicit review' }); continue; }
  if (/(?:^|\/)(?:node_modules|dist|test-results|playwright-report|\.data|\.npm-cache|\.codex|\.agents|\.aws|\.opencode)(?:\/|$)/.test(file)
      || (/(?:^|\/)\.env(?:\.|$)/.test(file) && !file.endsWith('/.env.example') && file !== '.env.example')
      || /(?:^|\/)(?:\.npmrc|\.pypirc|id_rsa|id_ed25519)$/.test(file)
      || /\.(?:pem|key|p12|pfx)$/i.test(file)) {
    findings.push({ file, reason: 'Private or generated path' });
  }
  const text = readFileSync(path).toString('utf8');
  for (const [reason, pattern] of credentialPatterns) if (pattern.test(text)) findings.push({ file, reason });
}
console.log(JSON.stringify({ scannedFiles: files.length, findings, scope: 'Current Git index and non-ignored worktree; high-confidence patterns only' }, null, 2));
if (findings.length) process.exitCode = 1;
