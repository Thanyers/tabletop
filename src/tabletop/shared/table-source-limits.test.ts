import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MAX_TABLE_SOURCES, TABLE_FILE_BYTES, TABLE_TOTAL_SOURCE_BYTES } from './table-source-limits';
import { TABLE_CAPABILITY_LIMITS } from './table-capabilities';
import { MAX_TABLE_SOURCES as DOMAIN_MAX_SOURCES, TABLE_FILE_BYTES as DOMAIN_FILE_BYTES } from '../domain/table';

/**
 * F078-T13: the shared-source limits were declared three times — the domain, the
 * capability summary shown to users, and the client (64 KiB / 32 KiB / four
 * slots typed by hand). One leaf module now owns them, and a UI that stops
 * importing it fails this test.
 */

const root = fileURLToPath(new URL('../../../', import.meta.url));
const uiFiles = [
  'src/tabletop/ui/TableCanvasObjects.tsx',
  'src/tabletop/ui/AIProposal.tsx',
  'src/tabletop/workspace/command-session.ts',
];

function source(relativePath: string): string {
  return readFileSync(`${root}${relativePath}`, 'utf8');
}

describe('shared source limits', () => {
  it('states the limits once for the domain, the capability summary and the client', () => {
    expect(TABLE_FILE_BYTES).toBe(32 * 1024);
    expect(TABLE_TOTAL_SOURCE_BYTES).toBe(64 * 1024);
    expect(MAX_TABLE_SOURCES).toBe(4);

    expect(DOMAIN_FILE_BYTES).toBe(TABLE_FILE_BYTES);
    expect(DOMAIN_MAX_SOURCES).toBe(MAX_TABLE_SOURCES);
    expect(TABLE_CAPABILITY_LIMITS.fileBytes).toBe(TABLE_FILE_BYTES);
    expect(TABLE_CAPABILITY_LIMITS.sourceBytes).toBe(TABLE_TOTAL_SOURCE_BYTES);
    expect(TABLE_CAPABILITY_LIMITS.files).toBe(MAX_TABLE_SOURCES);
  });

  it('has no hand-typed source limit left in the client', () => {
    const patterns = [
      /32 \* 1024/u,
      /64 \* 1024/u,
      /MAX_SOURCE_FILES\s*=\s*4\b/u,
      /sources\.length\s*>=\s*4\b/u,
      /sourceBytes\s*>=\s*64\b/u,
    ];
    const offenders = uiFiles.filter((file) => {
      const text = source(file);
      return patterns.some((pattern) => pattern.test(text));
    });
    expect(offenders).toEqual([]);
  });
});
