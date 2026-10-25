import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createDomain, decideDomain, reconcileInvoice } from '../domain';
import type { ActorContext, InvoiceState } from './contracts';
import { exportInvoice } from './export-invoice';

/**
 * F078-T12: the invoice export was reachable from a client page but lived under
 * `server/`, so a pure formatter depended on the server tree. It is a shared
 * contract now and its tests move with it.
 */
const hash = (value: string): string => createHash('sha256').update(value).digest('hex');
const context: ActorContext = { actorId: 'owner', name: 'Owner', workspaceId: 'test', role: 'owner', epoch: 1, now: 1000, hash };
const invoice = () => createDomain('invoice', context) as InvoiceState;

describe('invoice evidence and export boundaries', () => {
  it('keeps unreviewed rows unresolved and exports exact rate source lineage', () => {
    const state = invoice();
    const source = state.sources.find(s => s.kind === 'shipments')!;
    source.status = 'provided';
    const result = reconcileInvoice(state);
    expect(result.rows.every(r => r.expectedSatang === null && r.deltaSatang === null)).toBe(true);
    expect(result.rows[0].sourceIds).toContain('sample_rate_card');
    expect(result.rows[0].sourceIds).not.toContain('started-kg-step');
    expect(exportInvoice(state, 'csv')).toContain('unverified_shipment_source');
  });

  it('neutralizes CSV formulas and escapes untrusted filenames and HTML text', () => {
    const state = invoice();
    state.shipments[0].id = '=HYPERLINK("https://example.invalid")';
    state.sources[0].filename = '<img src=x onerror=alert(1)>';
    const csv = exportInvoice(state, 'csv');
    expect(csv).toContain('"\'=HYPERLINK');
    const html = exportInvoice(state, 'html');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain("default-src 'none'");
  });

  it('imports the next full dataset while retaining rules, sources and saved runs', () => {
    const original = invoice();
    const saved = decideDomain(original, { type: 'invoice.saveRun', payload: {} }, context).state as InvoiceState;
    const artifact = { ...saved.sources[0], id: 'next-dataset', status: 'provided' as const };
    const shipments = [{ ...saved.shipments[0], id: 'NEW-ONLY', sourceId: artifact.id }];
    const next = decideDomain(saved, { type: 'invoice.import', payload: { artifact, shipments } }, context).state as InvoiceState;
    expect(next.shipments.map(s => s.id)).toEqual(['NEW-ONLY']);
    expect(next.rules).toEqual(saved.rules);
    expect(next.runs).toEqual(saved.runs);
    expect(next.sources).toHaveLength(saved.sources.length + 1);
  });
});
