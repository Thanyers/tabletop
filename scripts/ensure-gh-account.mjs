#!/usr/bin/env node
/**
 * Keep `gh` on an account that can write to this repository.
 *
 *   node scripts/ensure-gh-account.mjs            # report only
 *   node scripts/ensure-gh-account.mjs --switch   # switch when the active account cannot push
 *
 * Why this exists: this machine keeps two GitHub accounts in the `gh` keyring (personal work and
 * office work). When the office account becomes active, merges and PR creation fail with
 * "does not have the correct permissions" / "must be a collaborator", which looks like a ruleset
 * problem. This script proves the permission and, with `--switch`, moves to an account that has it.
 * It never prints a token and never touches branches or remotes.
 */

import { execFileSync } from 'node:child_process';

const switchRequested = process.argv.includes('--switch');

function run(args) {
  return execFileSync('gh', args, { encoding: 'utf8' }).trim();
}

function repository() {
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim();
  const match = /github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/u.exec(remote);
  if (!match) {
    console.error(`cannot read the GitHub repository from origin: ${remote}`);
    process.exit(2);
  }
  return `${match[1]}/${match[2]}`;
}

function canPush(slug) {
  try {
    return run(['api', `repos/${slug}`, '--jq', '.permissions.push']) === 'true';
  } catch {
    return false;
  }
}

function activeAccount() {
  const status = run(['auth', 'status']);
  for (const line of status.split(/\r?\n/u)) {
    if (/Active account: true/u.test(line)) {
      const match = /account\s+(\S+)/u.exec(line);
      if (match) return match[1];
    }
  }
  return '';
}

function knownAccounts() {
  const status = run(['auth', 'status']);
  const accounts = [];
  for (const line of status.split(/\r?\n/u)) {
    const match = /account\s+(\S+)/u.exec(line);
    if (match && !accounts.includes(match[1])) accounts.push(match[1]);
  }
  return accounts;
}

const slug = repository();
const active = activeAccount();
if (canPush(slug)) {
  console.log(`gh is usable: ${active || 'unknown account'} can push to ${slug}`);
  process.exit(0);
}

console.log(`${active || 'the active account'} cannot push to ${slug}`);
if (!switchRequested) {
  console.log('run again with --switch to move to an account that can');
  process.exit(1);
}

for (const account of knownAccounts()) {
  if (account === active) continue;
  try {
    run(['auth', 'switch', '--user', account]);
  } catch {
    continue;
  }
  if (canPush(slug)) {
    try { run(['auth', 'setup-git']); } catch { /* git may already be configured */ }
    console.log(`switched to ${account}, which can push to ${slug}`);
    process.exit(0);
  }
}

console.log('no stored account can push to this repository; log in with the right account');
process.exit(1);
