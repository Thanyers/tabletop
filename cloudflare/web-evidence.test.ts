import { describe, expect, it } from 'vitest';
import { prepareWebEvidenceCommand } from './web-evidence.js';
import type { Env } from './contracts.js';
import type { WorkspaceView } from '../src/tabletop/shared/contracts.js';
import { createTableState } from '../src/tabletop/domain/table.js';
import { MAX_JOB_RESEARCH_SUMMARY_CHARS, MAX_JOB_RESEARCH_TITLE_CHARS } from '../src/tabletop/shared/model-job-progress.js';

const workspace: WorkspaceView = {
  id: 'fixture',
  title: 'Table',
  kind: 'table',
  epoch: 1,
  revision: 'one',
  actor: { actorId: 'account-a', name: 'Owner Name', role: 'owner', seat: 'host' },
  members: [
    { actorId: 'account-a', name: 'Owner Name', role: 'owner', seat: 'host' },
    { actorId: 'account-b', name: 'Second Member', role: 'participant', seat: 'member-1' },
  ],
  domain: createTableState(),
  createdAt: 0,
  expiresAt: 1,
};

const env = {} as Env;
const offEnv = { TABLE_WEB_EVIDENCE: 'off' } as Env;

function envelope(sources: unknown[], type = 'table.addWebSources') {
  return { commandId: 'c', type, payload: { sources } };
}

describe('web evidence command preparation (F064 C)', () => {
  it('leaves every other command untouched', () => {
    const other = { commandId: 'c', type: 'table.act', payload: { actionId: 'a' } };
    expect(prepareWebEvidenceCommand(env, workspace, other)).toEqual({ ok: true, envelope: other });
  });

  it('refuses both review commands when the switch is off', () => {
    expect(prepareWebEvidenceCommand(offEnv, workspace, envelope([], 'table.reviewWebSource')))
      .toEqual({ ok: false, code: 'WEB_EVIDENCE_DISABLED' });
    expect(prepareWebEvidenceCommand(offEnv, workspace, envelope([])))
      .toEqual({ ok: false, code: 'WEB_EVIDENCE_DISABLED' });
  });

  it('passes a review command through when the switch is on', () => {
    const review = { commandId: 'c', type: 'table.reviewWebSource', payload: { sourceId: 's', status: 'verified' } };
    expect(prepareWebEvidenceCommand(env, workspace, review)).toEqual({ ok: true, envelope: review });
  });

  it('redacts member names and ids from each source, and drops unsafe links', () => {
    const result = prepareWebEvidenceCommand(env, workspace, envelope([
      {
        title: `ประกาศโดย Owner Name (account-a) ${'t'.repeat(400)}`,
        url: 'https://example.go.th/report?who=account-a',
        summary: `Owner Name said ${'s'.repeat(1200)}`,
        date: '2026-07-26T16:00:00+00:00',
        authority: 9,
      },
      { title: 'unsafe', url: 'javascript:alert(1)', summary: 'x', date: null, authority: 1 },
    ]));
    if (!result.ok) throw new Error('expected the command to pass');
    const command = result.envelope as { payload: { sources: Array<Record<string, unknown>> } };
    expect(command.payload.sources).toHaveLength(1);
    const [source] = command.payload.sources;
    expect(JSON.stringify(source)).not.toContain('Owner Name');
    expect(JSON.stringify(source)).not.toContain('account-a');
    expect(String(source.url)).toMatch(/^https:\/\/example\.go\.th\//u);
    expect(String(source.title).length).toBeLessThanOrEqual(MAX_JOB_RESEARCH_TITLE_CHARS);
    expect(String(source.summary).length).toBeLessThanOrEqual(MAX_JOB_RESEARCH_SUMMARY_CHARS);
    expect(source.authority).toBe(4);
  });
});
