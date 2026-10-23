import type { Member } from '../shared/contracts';
import type { TableCollection, TableRecord, TableValue } from '../shared/table-contracts';

const MAX_PARTS = 5;
const MAX_PART_CHARS = 28;
const MAX_LABEL_CHARS = 110;

function cut(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function part(value: TableValue | undefined, label: string, members?: readonly Member[]): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (Array.isArray(value)) return value.length ? cut(value.join(', '), MAX_PART_CHARS) : null;
  if (typeof value === 'boolean') return `${label}: ${value ? 'Yes' : 'No'}`;
  if (typeof value === 'number') return new Intl.NumberFormat('en', { maximumFractionDigits: 2 }).format(value);
  return cut(members?.find((member) => member.actorId === value)?.name ?? value, MAX_PART_CHARS);
}

/**
 * F075: a record as people read it, built from its own values in field order (never the internal row id),
 * e.g. "ฟ้า · แพร · 1,751.8 · Settled: No · เดิม".
 */
export function recordSummary(record: TableRecord, collection?: TableCollection, members?: readonly Member[], options: { omitYesNo?: boolean } = {}): string {
  const fields = (collection?.fields ?? []).filter((field) => !(options.omitYesNo && field.type === 'boolean'));
  const parts = fields.flatMap((field) => part(record.values[field.id], field.label, members) ?? []).slice(0, MAX_PARTS);
  return parts.length ? cut(parts.join(' · '), MAX_LABEL_CHARS) : record.id;
}

/** True when the row has a text value (usually its name) among the parts a summary shows. */
function hasName(record: TableRecord, collection?: TableCollection): boolean {
  return (collection?.fields ?? []).slice(0, MAX_PARTS + 2).some((field) => field.type === 'text' && typeof record.values[field.id] === 'string' && record.values[field.id] !== '');
}

/**
 * F075: summaries for a picker. The row id is kept as a tie-breaker when rows read the same, and when a row has no
 * text value at all (a bare "0" says nothing about which row it is); ids are often readable names like team-south.
 */
export function recordChoiceLabels(records: readonly TableRecord[], collection?: TableCollection, members?: readonly Member[]): Map<string, string> {
  const summaries = records.map((record) => [record, recordSummary(record, collection, members)] as const);
  const totals = new Map<string, number>();
  for (const [, summary] of summaries) totals.set(summary, (totals.get(summary) ?? 0) + 1);
  return new Map(summaries.map(([record, summary]) => {
    const needsId = summary !== record.id && ((totals.get(summary) ?? 0) > 1 || !hasName(record, collection));
    return [record.id, needsId ? `${summary} · ${record.id}` : summary];
  }));
}
