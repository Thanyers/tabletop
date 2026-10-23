import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { applyTableChange, createTableState, handleTableCommand, MAX_TABLE_SOURCES } from './table';
import { equipmentChange, tableScenarioSources } from '../testing/table-scenarios';
import type { ActorContext } from '../shared/contracts';
import type { TableChange, TableState } from '../shared/table-contracts';

const owner: ActorContext = { actorId: 'account-a', name: 'Owner', role: 'owner', workspaceId: 'fixture', epoch: 1, now: 1000, hash: v => createHash('sha256').update(JSON.stringify(v)).digest('hex') };
const member: ActorContext = { ...owner, actorId: 'account-b', name: 'Participant', role: 'participant', seat: 'member-1' };

const webSource = (patch: Partial<{ title: string; url: string; summary: string; date: string | null; authority: number }> = {}) => ({
  title: 'ประกาศอัตรา VAT',
  url: 'https://www.thaigov.go.th/th/news/166956',
  summary: 'อัตรา VAT 7% ถึง 30 ก.ย. 2570',
  date: '2026-07-26T16:00:00+00:00',
  authority: 4,
  ...patch,
});

function addWeb(state: TableState, sources = [webSource()], ctx: ActorContext = owner): TableState {
  return handleTableCommand(state, 'table.addWebSources', { sources }, ctx)!.state;
}

function review(state: TableState, sourceId: string, status: 'verified' | 'rejected', ctx: ActorContext = owner): TableState {
  return handleTableCommand(state, 'table.reviewWebSource', { sourceId, status }, ctx)!.state;
}

/** A valid table program from the equipment fixture, with only its quotation replaced. */
function changeWith(quote: string | null, sourceId: string): TableChange {
  const base = equipmentChange(sourceId);
  return {
    kind: 'table',
    program: { ...base.program, evidence: quote === null ? [] : [{ sourceId, quote }] },
    initialRecords: base.initialRecords,
  };
}

describe('web sources as table evidence (F064 C)', () => {
  it('adds web sources as provided, with only title and summary as citable text', () => {
    const state = addWeb(createTableState());
    expect(state.sources).toHaveLength(1);
    const [source] = state.sources;
    expect(source).toMatchObject({
      origin: 'web',
      status: 'provided',
      url: 'https://www.thaigov.go.th/th/news/166956',
      authority: 4,
      publishedAt: '2026-07-26T16:00:00+00:00',
    });
    expect(source.filename).toBe('web-www.thaigov.go.th-1.md');
    expect(source.text).toBe('ประกาศอัตรา VAT\nอัตรา VAT 7% ถึง 30 ก.ย. 2570');
    // The URL is provenance, never citable text.
    expect(source.text).not.toContain('http');
    expect(source.sha256).toHaveLength(64);
  });

  it('refuses a citation from a provided web source, and accepts it after the owner verifies', () => {
    const base = addWeb(createTableState());
    const sourceId = base.sources[0].id;
    const quote = 'อัตรา VAT 7%';

    expect(() => applyTableChange(base, changeWith(quote, sourceId))).toThrow('Prompt-only tables cannot cite');
    const verified = review(base, sourceId, 'verified');
    expect(verified.sources[0].status).toBe('verified');
    const active = applyTableChange(verified, changeWith(quote, sourceId));
    expect(active.program?.evidence[0]).toEqual({ sourceId, quote });

    // A quote that only exists in the URL is not evidence.
    expect(() => applyTableChange(verified, changeWith('https://www.thaigov.go.th/th/news/166956', sourceId))).toThrow('quotation');
  });

  it('lets only the owner review, and blocks rejecting a source a rule revision already cites', () => {
    const base = addWeb(createTableState());
    const sourceId = base.sources[0].id;
    expect(() => review(base, sourceId, 'verified', member)).toThrow('owner');

    const verified = review(base, sourceId, 'verified');
    expect(() => review(verified, sourceId, 'verified')).toThrow('first review');
    const active = applyTableChange(verified, changeWith('อัตรา VAT', sourceId));
    // First review only (invoice precedent): a cited source is verified and can never be flipped to
    // rejected, so an active revision cannot lose its evidence through the review command.
    expect(() => review(active, sourceId, 'rejected')).toThrow('first review');

    const rejected = review(base, sourceId, 'rejected');
    expect(rejected.sources[0].status).toBe('rejected');
    // A rejected source is not citable, so a table holding only that one cannot carry evidence.
    expect(() => applyTableChange(rejected, changeWith('อัตรา VAT', sourceId))).toThrow('Prompt-only tables cannot cite');
  });

  it('dedupes by URL, ignores unsafe links and respects the four-source ceiling', () => {
    const base = addWeb(createTableState());
    const again = handleTableCommand(base, 'table.addWebSources', { sources: [webSource()] }, owner)!.state;
    expect(again.sources).toHaveLength(1);

    expect(() => addWeb(createTableState(), [webSource({ url: 'javascript:alert(1)' })])).toThrow('plain http(s)');

    // One imported file leaves three slots; the fourth web source is skipped rather than overflowing.
    const withFile = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    const fills = addWeb(withFile, [
      webSource({ title: 'Source A', url: 'https://a.example/1', summary: 'Statement A.' }),
      webSource({ title: 'Source B', url: 'https://b.example/2', summary: 'Statement B.' }),
      webSource({ title: 'Source C', url: 'https://c.example/3', summary: 'Statement C.' }),
      webSource({ title: 'Source D', url: 'https://d.example/4', summary: 'Statement D.' }),
    ]);
    expect(fills.sources).toHaveLength(MAX_TABLE_SOURCES);
    expect(fills.sources.filter((source) => source.origin === 'web')).toHaveLength(3);
    expect(() => addWeb(fills, [webSource({ title: 'Source E', url: 'https://e.example/5', summary: 'Statement E.' })])).toThrow('at most four sources');
  });

  it('keeps the rule that a file-backed table still has to cite something', () => {
    const fileOnly = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    expect(() => applyTableChange(fileOnly, changeWith(null, fileOnly.sources[0].id))).toThrow('Cite at least one');
    // A table with only a provided web source behaves like a prompt-only table: no citation required yet.
    const web = addWeb(createTableState());
    const empty = changeWith(null, web.sources[0].id);
    expect(applyTableChange(web, empty).program?.evidence).toEqual([]);
  });

  it('still activates file-backed drafts unchanged', () => {
    const initial = handleTableCommand(createTableState(), 'table.import', tableScenarioSources.equipment, owner)!.state;
    const change = equipmentChange(initial.sources[0].id);
    const active = applyTableChange(initial, change);
    expect(active.program?.evidence).toHaveLength(1);
    expect(active.sources.every((source) => source.origin === undefined)).toBe(true);
  });
});
