// CHANGELOG fragments: each PR adds its own file under changelog.d/ instead of editing
// CHANGELOG.md, so parallel PRs never conflict on it. Cutting a release folds every fragment
// (plus any legacy lines still under `## Unreleased`) into a new `## X.Y.Z` section.
// Pure functions are unit-tested; the CLI at the bottom is what people and agents run:
//   npx tsx server/changelog.ts check
//   npx tsx server/changelog.ts cut X.Y.Z --summary "MINOR: … rollback to vA.B.C is safe"

const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;
export const FRAGMENT_DIR = 'changelog.d';
const FRAGMENT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}\.md$/u;

export interface Fragment { name: string; text: string; addedAt: number }

/** Problems with one fragment: a file name agents can create safely and bullet-only content. */
export function fragmentProblems(fragment: Pick<Fragment, 'name' | 'text'>): string[] {
  const problems: string[] = [];
  if (!FRAGMENT_NAME.test(fragment.name)) problems.push(`${fragment.name}: name must be letters, digits, ".", "_" or "-" and end in .md`);
  const lines = fragment.text.split('\n').filter((line) => line.trim() !== '');
  if (lines.length === 0) problems.push(`${fragment.name}: empty`);
  if (lines.length > 0 && !lines[0].startsWith('- ')) problems.push(`${fragment.name}: must start with a "- " bullet`);
  for (const line of lines) {
    if (/^#{1,6}\s/u.test(line)) problems.push(`${fragment.name}: no headings ("${line.slice(0, 40)}"); the release cut adds them`);
    if (/^(<<<<<<<|=======|>>>>>>>)/u.test(line)) problems.push(`${fragment.name}: contains a merge conflict marker`);
    if (!line.startsWith('- ') && !/^\s+\S/u.test(line)) problems.push(`${fragment.name}: every line is a "- " bullet or an indented continuation ("${line.slice(0, 40)}")`);
  }
  return problems;
}

/** Newest first, then by name, matching the "new before old" order of Unreleased. */
export function orderFragments(fragments: readonly Fragment[]): Fragment[] {
  return [...fragments].sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name));
}

export interface CutInput { changelog: string; fragments: readonly Fragment[]; version: string; date: string; summary: string }
export interface CutResult { changelog: string; entries: number }

/**
 * Moves fragments (newest first) and any legacy `## Unreleased` lines into `## <version> — <date>`,
 * leaving an empty `## Unreleased` above it. Already cut sections are copied unchanged.
 */
export function cutRelease(input: CutInput): CutResult {
  if (!SEMVER.test(input.version)) throw new Error(`Version "${input.version}" is not X.Y.Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input.date)) throw new Error(`Date "${input.date}" is not YYYY-MM-DD`);
  const summary = input.summary.trim();
  if (!summary) throw new Error('A summary is required: say MAJOR/MINOR/PATCH, why, and which version a rollback can return to.');
  if (new RegExp(`^## ${input.version.replaceAll('.', '\\.')}(?: |$)`, 'mu').test(input.changelog)) {
    throw new Error(`CHANGELOG.md already has ## ${input.version}; a cut section is never edited, use a new version.`);
  }
  const problems = input.fragments.flatMap(fragmentProblems);
  if (problems.length) throw new Error(`Fix these fragments first:\n${problems.join('\n')}`);

  const marker = '## Unreleased\n';
  const start = input.changelog.indexOf(marker);
  if (start < 0) throw new Error('CHANGELOG.md has no "## Unreleased" heading');
  const afterMarker = start + marker.length;
  const nextHeading = input.changelog.slice(afterMarker).search(/^## /mu);
  const end = nextHeading < 0 ? input.changelog.length : afterMarker + nextHeading;
  const legacy = input.changelog.slice(afterMarker, end).split('\n').filter((line) => line.trim() !== '');
  const fromFragments = orderFragments(input.fragments).flatMap((fragment) => fragment.text.split('\n').filter((line) => line.trim() !== ''));
  const lines = [...fromFragments, ...legacy];
  if (lines.length === 0) throw new Error('Nothing to release: no fragments in changelog.d/ and no lines under ## Unreleased');

  const section = `## ${input.version} — ${input.date}\n\n${summary}\n\n${lines.join('\n')}\n\n`;
  const rest = input.changelog.slice(end).replace(/^\n+/u, '');
  return {
    changelog: `${input.changelog.slice(0, start)}${marker}\n${section}${rest}`,
    entries: lines.filter((line) => line.startsWith('- ')).length,
  };
}

/** The body of one cut `## <version>` section (summary + entries), for GitHub Release notes. */
export function releaseNotes(changelog: string, version: string): string | null {
  const heading = new RegExp(`^## ${version.replaceAll('.', '\\.')}(?: |$).*$`, 'mu').exec(changelog);
  if (!heading) return null;
  const start = heading.index + heading[0].length;
  const next = changelog.slice(start).search(/^## /mu);
  const body = (next < 0 ? changelog.slice(start) : changelog.slice(start, start + next)).trim();
  return body || null;
}

// ---- CLI ---------------------------------------------------------------------------------

async function readFragments(root: string): Promise<Fragment[]> {
  const { readdir, readFile, stat } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const { execFileSync } = await import('node:child_process');
  let names: string[] = [];
  try { names = await readdir(join(root, FRAGMENT_DIR)); } catch { return []; }
  const fragments: Fragment[] = [];
  for (const name of names.filter((item) => item.endsWith('.md') && item !== 'README.md')) {
    const path = join(root, FRAGMENT_DIR, name);
    let addedAt = 0;
    try {
      // When the fragment entered git; falls back to the file time for uncommitted ones.
      const out = execFileSync('git', ['log', '--diff-filter=A', '--format=%ct', '-1', '--', path], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      addedAt = out ? Number(out) * 1000 : (await stat(path)).mtimeMs;
    } catch { addedAt = (await stat(path)).mtimeMs; }
    fragments.push({ name, text: await readFile(path, 'utf8'), addedAt });
  }
  return fragments;
}

async function main(argv: string[]): Promise<number> {
  const { readFile, writeFile, unlink } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const root = process.cwd();
  const [command, version] = argv;
  const fragments = await readFragments(root);
  if (command === 'check') {
    const problems = fragments.flatMap(fragmentProblems);
    if (problems.length) { console.error(problems.join('\n')); return 1; }
    console.log(`changelog.d: ${fragments.length} fragment(s) OK`);
    return 0;
  }
  if (command === 'notes' && version) {
    const notes = releaseNotes(await readFile(join(root, 'CHANGELOG.md'), 'utf8'), version);
    if (!notes) { console.error(`CHANGELOG.md has no ## ${version} section`); return 1; }
    process.stdout.write(`${notes}\n`);
    return 0;
  }
  if (command === 'cut' && version) {
    const flag = (name: string) => { const index = argv.indexOf(name); return index >= 0 ? argv[index + 1] ?? '' : ''; };
    const date = flag('--date') || new Date().toISOString().slice(0, 10);
    const changelogPath = join(root, 'CHANGELOG.md');
    const result = cutRelease({ changelog: await readFile(changelogPath, 'utf8'), fragments, version, date, summary: flag('--summary') });
    await writeFile(changelogPath, result.changelog);
    for (const fragment of fragments) await unlink(join(root, FRAGMENT_DIR, fragment.name));
    console.log(`CHANGELOG.md: ## ${version} — ${date} with ${result.entries} entr${result.entries === 1 ? 'y' : 'ies'}; removed ${fragments.length} fragment(s). Review, then commit.`);
    return 0;
  }
  console.error('Usage: npx tsx server/changelog.ts check | notes X.Y.Z | cut X.Y.Z --summary "<bump, why, rollback target>" [--date YYYY-MM-DD]');
  return 2;
}

if (process.argv[1] && /changelog\.ts$/u.test(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
