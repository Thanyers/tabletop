import type { TableField, TableRecord } from './table-contracts';

export type ImportIdentityMatch =
  | { ok: true; recordIds: (string | undefined)[]; matchedRecordIds: string[] }
  | { ok: false; message: string };

function identityKeys(
  rows: readonly Readonly<Record<string, unknown>>[],
  fieldId: string,
  label: string,
): { ok: true; keys: string[] } | { ok: false; message: string } {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const [index, row] of rows.entries()) {
    const value = row[fieldId];
    if (typeof value !== 'string' || value.trim().length === 0) {
      return { ok: false, message: `${label} rows need a nonempty text value in the selected identity field (row ${index + 1}).` };
    }
    const key = value.trim();
    if (seen.has(key)) {
      return { ok: false, message: `${label} rows have duplicate values in the selected identity field (${key}).` };
    }
    seen.add(key);
    keys.push(key);
  }
  return { ok: true, keys };
}

/** Matches imported rows to existing records by one explicitly selected scalar text field. */
export function matchRowsByIdentity(
  existingRows: readonly Pick<TableRecord, 'id' | 'values'>[],
  importedRows: readonly Readonly<Record<string, unknown>>[],
  fieldId: string,
): ImportIdentityMatch {
  const existingKeys = identityKeys(existingRows.map(row => row.values), fieldId, 'Current');
  if (!existingKeys.ok) return existingKeys;
  const importedKeys = identityKeys(importedRows, fieldId, 'Imported');
  if (!importedKeys.ok) return importedKeys;

  const existingByKey = new Map(existingKeys.keys.map((key, index) => [key, existingRows[index]!.id]));
  const recordIds = importedKeys.keys.map(key => existingByKey.get(key));
  return {
    ok: true,
    recordIds,
    matchedRecordIds: recordIds.filter((recordId): recordId is string => recordId !== undefined),
  };
}

/** Suggest only a required text field that is mapped and unique in both row sets. */
export function requiredTextIdentityCandidates(
  fields: readonly TableField[],
  existingRows: readonly Pick<TableRecord, 'id' | 'values'>[],
  importedRows: readonly Readonly<Record<string, unknown>>[],
  mappedFieldIds: ReadonlySet<string>,
): TableField[] {
  return fields.filter(field => field.type === 'text'
    && field.required
    && mappedFieldIds.has(field.id)
    && matchRowsByIdentity(existingRows, importedRows, field.id).ok);
}

/** Finds fixed references in actions and canvas views to rows in a collection (control bindings and recordField expressions). */
export function fixedProgramRecordIds(program: unknown, collectionId: string): string[] {
  if (!program || typeof program !== 'object') return [];
  const ids = new Set<string>();
  const visited = new WeakSet<object>();
  const pending: unknown[] = [program];
  while (pending.length > 0) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (visited.has(value)) continue;
    visited.add(value);
    if (Array.isArray(value)) {
      pending.push(...value);
      continue;
    }
    const item = value as Record<string, unknown>;
    const isFixedRecordBinding = item.kind === 'record';
    const isRecordFieldExpression = item.op === 'recordField';
    if ((isFixedRecordBinding || isRecordFieldExpression)
      && item.collection === collectionId
      && typeof item.recordId === 'string') {
      ids.add(item.recordId);
    }
    pending.push(...Object.values(item));
  }
  return [...ids];
}
