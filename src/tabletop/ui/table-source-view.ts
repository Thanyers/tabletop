import type { TableSource, TableSourceStatus } from '../shared/table-contracts';
import { MAX_SOURCE_AUTHORITY, externalHost, safeExternalUrl } from '../shared/model-job-progress';

/** F064 slice C: the badge copy for a web source; a row without a status is still provided. */
export function webSourceStatusLabel(status: TableSourceStatus | undefined): string {
  if (status === 'verified') return 'Verified';
  if (status === 'rejected') return 'Rejected';
  return 'Provided';
}

/** F064 slice C: the provenance line under a web source card, already guarded for display. */
export interface WebSourceMeta {
  /** The safe external link target, or null when the stored URL cannot be linked. */
  href: string | null;
  /** The host people recognise; '' when the stored URL has no usable host. */
  host: string;
  /** The publication date as a date (no time), or '' when it is missing or unusable. */
  dateLabel: string;
  /** `authority 4`, or '' when the stored authority is missing or out of range. */
  authorityLabel: string;
}

/** F064 slice C: a stored web source URL and date are provider data, so both are re-validated here. */
export function webSourceMeta(source: Pick<TableSource, 'url' | 'publishedAt' | 'authority'>, locale = 'en-GB'): WebSourceMeta {
  const rawUrl = typeof source.url === 'string' ? source.url : '';
  const href = safeExternalUrl(rawUrl);
  const authority = source.authority;
  return {
    href,
    host: externalHost(rawUrl),
    dateLabel: formatPublishedDate(source.publishedAt, locale),
    authorityLabel: typeof authority === 'number' && Number.isSafeInteger(authority) && authority >= 0 && authority <= MAX_SOURCE_AUTHORITY
      ? `authority ${authority}`
      : '',
  };
}

function formatPublishedDate(value: string | null | undefined, locale: string): string {
  if (!value) return '';
  const at = Date.parse(value);
  if (!Number.isFinite(at)) return '';
  return new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}
