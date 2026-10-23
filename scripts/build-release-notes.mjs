#!/usr/bin/env node
// Builds the "Tabletop Release Notes" page from CHANGELOG.md plus the unreleased fragments in changelog.d/.
// Run after every release (docs/AGENT_OPERATIONS.md §5), then republish the page to its existing link.
//   node scripts/build-release-notes.mjs [--out test-results/release-notes/tabletop-releases.html]
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outArg = process.argv.indexOf('--out');
const out = resolve(root, outArg > 0 ? process.argv[outArg + 1] : 'test-results/release-notes/tabletop-releases.html');

/** One section per "## …" heading: bullets (with indented continuation lines) and free text notes. */
export function parseChangelog(text) {
  const sections = [];
  let current = null;
  for (const line of text.split(/\r?\n/u)) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) { current = { head: heading[1].trim(), items: [], notes: [] }; sections.push(current); continue; }
    if (!current) continue;
    if (line.startsWith('- ')) current.items.push(line.slice(2));
    else if (line.startsWith('  ') && current.items.length && line.trim()) current.items[current.items.length - 1] += `\n${line.trim()}`;
    else if (line.trim() && !line.startsWith('#')) current.notes.push(line.trim());
  }
  return sections.map(({ head, items, notes }) => {
    if (/^unreleased/i.test(head)) return { kind: 'unreleased', version: 'Unreleased', date: '', title: '', items, notes };
    const release = /^(\d+\.\d+\.\d+)\s+—\s+(\S+)/.exec(head);
    if (release) return { kind: 'release', version: release[1], date: release[2], title: '', items, notes };
    const early = /^(\d{4}-\d{2}-\d{2})\s+—\s+(.+)$/.exec(head);
    return { kind: 'history', version: '', date: early ? early[1] : '', title: early ? early[2] : head, items, notes };
  });
}

/** Bullets waiting in changelog.d/ belong to the next release, so they join the Unreleased section. */
function fragmentItems(dir) {
  let names = [];
  try { names = readdirSync(dir).filter((name) => name.endsWith('.md') && name !== 'README.md').sort(); } catch { return []; }
  return names.flatMap((name) => parseChangelog(`## Unreleased\n${readFileSync(join(dir, name), 'utf8')}`)[0].items);
}

const sections = parseChangelog(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'));
const fragments = fragmentItems(join(root, 'changelog.d'));
if (fragments.length) {
  const unreleased = sections.find((section) => section.kind === 'unreleased');
  if (unreleased) unreleased.items.unshift(...fragments);
  else sections.unshift({ kind: 'unreleased', version: 'Unreleased', date: '', title: '', items: fragments, notes: [] });
}
// "</" inside the JSON would close the <script> element early.
const data = JSON.stringify(sections).replaceAll('</', '<\\/');
const template = readFileSync(join(root, 'scripts/release-notes/template.html'), 'utf8');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, template.replace('__DATA__', () => data));
const releases = sections.filter((section) => section.kind === 'release');
console.log(`Wrote ${out}\n${releases.length} releases (latest ${releases[0]?.version ?? 'none'}), ${fragments.length} unreleased fragments.`);
