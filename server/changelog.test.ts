import { describe, expect, it } from 'vitest';
import { cutRelease, fragmentProblems, orderFragments, releaseNotes, type Fragment } from './changelog';

const base = `# Changelog

## Unreleased

- legacy line still under Unreleased

## 1.2.0 — 2026-10-01

MINOR: earlier release.

- shipped before
`;

const fragment = (name: string, text: string, addedAt: number): Fragment => ({ name, text, addedAt });

describe('changelog fragments', () => {
  it('accepts bullet fragments with indented continuations', () => {
    expect(fragmentProblems({ name: 'F070-landing.md', text: '- **Landing (F070):** new copy\n  second line\n' })).toEqual([]);
  });

  it('rejects headings, prose, conflict markers, empty files and unsafe names', () => {
    expect(fragmentProblems({ name: 'x.md', text: '## 1.3.0\n- a' }).join()).toContain('no headings');
    expect(fragmentProblems({ name: 'x.md', text: 'plain text' }).join()).toContain('must start with a "- " bullet');
    expect(fragmentProblems({ name: 'x.md', text: '- a\n<<<<<<< HEAD' }).join()).toContain('conflict marker');
    expect(fragmentProblems({ name: 'x.md', text: '\n\n' }).join()).toContain('empty');
    expect(fragmentProblems({ name: '../escape.md', text: '- a' }).join()).toContain('name must be');
  });

  it('orders fragments newest first, then by name', () => {
    const ordered = orderFragments([fragment('b.md', '- b', 1), fragment('a.md', '- a', 1), fragment('c.md', '- c', 2)]);
    expect(ordered.map((item) => item.name)).toEqual(['c.md', 'a.md', 'b.md']);
  });

  it('cuts fragments and legacy Unreleased lines into a new section and leaves cut sections untouched', () => {
    const { changelog, entries } = cutRelease({
      changelog: base,
      fragments: [fragment('old.md', '- older fragment', 1), fragment('new.md', '- newer fragment\n  detail', 2)],
      version: '1.3.0', date: '2026-10-23', summary: 'MINOR: two features; rollback to v1.2.0 is safe.',
    });
    expect(entries).toBe(3);
    expect(changelog).toBe(`# Changelog

## Unreleased

## 1.3.0 — 2026-10-23

MINOR: two features; rollback to v1.2.0 is safe.

- newer fragment
  detail
- older fragment
- legacy line still under Unreleased

## 1.2.0 — 2026-10-01

MINOR: earlier release.

- shipped before
`);
  });

  it('refuses a version that is already cut, a missing summary, bad fragments, or nothing to release', () => {
    const args = { changelog: base, fragments: [fragment('a.md', '- a', 1)], date: '2026-10-23', summary: 'PATCH' };
    expect(() => cutRelease({ ...args, version: '1.2.0' })).toThrow(/already has ## 1\.2\.0/u);
    expect(() => cutRelease({ ...args, version: '1.3.0', summary: '  ' })).toThrow(/summary is required/u);
    expect(() => cutRelease({ ...args, version: '1.3', summary: 'PATCH' })).toThrow(/not X\.Y\.Z/u);
    expect(() => cutRelease({ ...args, version: '1.3.0', fragments: [fragment('a.md', 'prose', 1)] })).toThrow(/Fix these fragments/u);
    expect(() => cutRelease({ ...args, version: '1.3.0', changelog: base.replace('- legacy line still under Unreleased\n', ''), fragments: [] })).toThrow(/Nothing to release/u);
  });

  it('extracts one cut section as release notes, or null when it is missing', () => {
    expect(releaseNotes(base, '1.2.0')).toBe('MINOR: earlier release.\n\n- shipped before');
    expect(releaseNotes(base, '1.3.0')).toBeNull();
    expect(releaseNotes(base, '1.2')).toBeNull();
  });
});
