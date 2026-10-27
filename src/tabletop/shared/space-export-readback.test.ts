import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildSpaceExport } from './space-export';
import type { ToolProjectionGrant } from './tool-connection';

/**
 * F080 / JT-X: readback of a produced export by a parser that is not ours.
 *
 * The serializer unit tests prove our own rules; this proves the *file* — Python's csv module is an
 * independent implementation, so a quoting or encoding mistake that both our writer and our reader
 * share would still show up here. It is not a spreadsheet application, so it does not by itself
 * satisfy the "open it in the target app" step.
 */

const SPACE = '11111111-1111-4111-8111-111111111111';
const SOURCE = '22222222-2222-4222-8222-222222222222';

function grant(): ToolProjectionGrant {
  return {
    grantId: 'grant-budget',
    spaceId: 'activity-room',
    spaceWorkspaceId: SPACE,
    sourceWorkspaceId: SOURCE,
    sourceEpoch: 3,
    sourceDataRevision: 7,
    grantedBy: 'actor-b',
    issuedAt: 1_000,
    grantVersion: 2,
    status: 'granted',
    audience: { kind: 'space-members' },
    projections: [{ portId: 'budget', resource: 'costs', fields: ['room', 'price', 'note'], maxRows: 10 }],
    actions: [],
    exportAllowed: true,
  };
}

function pythonAvailable(): boolean {
  try {
    execFileSync('python3', ['-c', 'import csv, json, sys'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

const PYTHON_READBACK = `
import csv, json, sys
with open(sys.argv[1], encoding='utf-8-sig', newline='') as handle:
    rows = list(csv.reader(handle))
print(json.dumps({'header': rows[0], 'rows': rows[1:], 'count': len(rows) - 1}, ensure_ascii=False))
`;

describe('an independent parser reads the produced CSV', () => {
  const available = pythonAvailable();

  it.skipIf(!available)('sees the same columns, rows and Thai text we wrote', () => {
    const directory = mkdtempSync(join(tmpdir(), 'f080-export-'));
    try {
      const exported = buildSpaceExport({
        grant: grant(),
        portId: 'budget',
        actorId: 'actor-a',
        spaceWorkspaceId: SPACE,
        sourceEpoch: 3,
        dataRevision: 9,
        ruleRevision: 2,
        records: [
          { id: 'row-1', values: { room: 'ห้องประชุม', price: 1250, note: 'ชั้น 2' } },
          { id: 'row-2', values: { room: 'ห้องโถง, ใหญ่', price: 4200, note: 'มี "อัญประกาศ"' } },
          // A cell a spreadsheet would otherwise evaluate.
          { id: 'row-3', values: { room: '=1+1', price: 0, note: 'สูตรปลอม' } },
        ],
        format: 'csv',
        producedAt: 5_000,
      });
      expect(exported.ok).toBe(true);
      if (!exported.ok) return;

      const file = join(directory, exported.filename);
      writeFileSync(file, exported.content, 'utf8');
      // Python's stdout uses the console code page on Windows, which mangles Thai before it ever
      // reaches this process; forcing UTF-8 for the child keeps the readback faithful.
      const parsed = JSON.parse(execFileSync('python3', ['-X', 'utf8', '-c', PYTHON_READBACK, file], {
        encoding: 'utf8',
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })) as {
        header: string[];
        rows: string[][];
        count: number;
      };

      // The BOM was consumed by utf-8-sig, so the first header cell is the field id itself.
      expect(parsed.header).toEqual(['room', 'price', 'note']);
      expect(parsed.count).toBe(3);
      expect(parsed.rows[0]).toEqual(['ห้องประชุม', '1250', 'ชั้น 2']);
      // A comma inside a value stays one cell, and doubled quotes come back as one quote.
      expect(parsed.rows[1]).toEqual(['ห้องโถง, ใหญ่', '4200', 'มี "อัญประกาศ"']);
      // The formula guard survives: the cell is text, not an expression.
      expect(parsed.rows[2]?.[0]).toBe("'=1+1");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
