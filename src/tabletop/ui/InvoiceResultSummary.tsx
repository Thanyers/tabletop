import type { InvoiceResult } from '../shared/contracts';
import './result-summary.css';

export function InvoiceResultSummary({ result }: { result: InvoiceResult }) {
  if (result.rows.length === 0) return null;
  const unknown = result.rows.filter(row => row.deltaSatang === null).length;
  const matched = result.rows.filter(row => row.expectedSatang !== null && row.billedSatang !== null && row.reasons.length === 0 && row.deltaSatang === 0).length;
  const review = result.rows.length - unknown - matched;
  const parts = [{ id: 'matched', label: 'Matches', count: matched }, { id: 'review', label: 'Review', count: review }, { id: 'unknown', label: 'Needs evidence', count: unknown }];
  return <section className="tt-result-coverage" aria-label="Reconciliation coverage">
    <div className="tt-result-coverage__head"><strong>Evidence coverage</strong><span>{result.rows.length - unknown} of {result.rows.length} rows can be compared</span></div>
    <div className="tt-result-coverage__bar" aria-hidden="true">{parts.filter(part => part.count > 0).map(part => <span key={part.id} className={`is-${part.id}`} style={{ flex: part.count }} />)}</div>
    <ul>{parts.map(part => <li key={part.id} className={`is-${part.id}`}><i aria-hidden="true" /><span>{part.label}</span><b>{part.count}</b></li>)}</ul>
    {unknown > 0 && <p>Totals use the rows with supporting evidence; difference uses comparable rows. Missing evidence stays Unknown.</p>}
  </section>;
}
