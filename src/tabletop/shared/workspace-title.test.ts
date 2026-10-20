import { describe, expect, it } from 'vitest';
import { DEFAULT_WORKSPACE_TITLES, displayWorkspaceTitle, normalizeWorkspaceTitle, WORKSPACE_TITLE_MAX_CHARS } from './workspace-title';

describe('workspace titles', () => {
  it('accepts trimmed names up to the limit and rejects empty, control and oversized names', () => {
    expect(normalizeWorkspaceTitle('  Camera loans  ')).toBe('Camera loans');
    expect(normalizeWorkspaceTitle('ยืมกล้องทีม 📷')).toBe('ยืมกล้องทีม 📷');
    expect(normalizeWorkspaceTitle('x'.repeat(WORKSPACE_TITLE_MAX_CHARS))).toHaveLength(WORKSPACE_TITLE_MAX_CHARS);
    expect(normalizeWorkspaceTitle('😀'.repeat(WORKSPACE_TITLE_MAX_CHARS))).not.toBeNull();
    for (const bad of ['', '   ', 'a\nb', 'tab\there', '\u0000', 'x'.repeat(WORKSPACE_TITLE_MAX_CHARS + 1), 42, null, undefined]) {
      expect(normalizeWorkspaceTitle(bad)).toBeNull();
    }
  });

  it('lets a chosen name win over the rules title, and falls back to the rules title for default-named tables', () => {
    expect(displayWorkspaceTitle('table', DEFAULT_WORKSPACE_TITLES.table, 'Equipment loans')).toBe('Equipment loans');
    expect(displayWorkspaceTitle('table', 'Camera desk', 'Equipment loans')).toBe('Camera desk');
    expect(displayWorkspaceTitle('table', DEFAULT_WORKSPACE_TITLES.table, '   ')).toBe(DEFAULT_WORKSPACE_TITLES.table);
    expect(displayWorkspaceTitle('table', DEFAULT_WORKSPACE_TITLES.table, null)).toBe(DEFAULT_WORKSPACE_TITLES.table);
    expect(displayWorkspaceTitle('encounter', DEFAULT_WORKSPACE_TITLES.encounter, 'ignored')).toBe(DEFAULT_WORKSPACE_TITLES.encounter);
  });
});
