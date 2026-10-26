/**
 * F080 / EXEC-01 (first layer): turn a validated behaviour output into the writes it may perform.
 *
 * Nothing here commits; it decides, purely, whether the proposed changes are inside what the package
 * declared and the table's schema allows. Returning `ok: false` with no writes is what makes "out of
 * scope equals zero write" checkable before any route or trusted operation exists.
 */

export type ToolWriteOperation = 'create' | 'update';

export interface DeclaredWrite {
  target: 'self';
  resource: string;
  operations: ToolWriteOperation[];
  maxRows: number;
}

export interface ProposedChange {
  target?: 'self';
  resource: string;
  operation: ToolWriteOperation;
  rowId?: string;
  values: Record<string, unknown>;
}

export interface ResourceSchemaEntry {
  fields: { id: string; type: 'text' | 'number' | 'boolean' | 'list' }[];
}

export interface PlannedWrite {
  resource: string;
  operation: ToolWriteOperation;
  rowId?: string;
  values: Record<string, unknown>;
}

export type PlanResult =
  | { ok: true; writes: PlannedWrite[] }
  | { ok: false; code: 'NOT_SELF_TARGET' | 'RESOURCE_NOT_DECLARED' | 'OPERATION_NOT_DECLARED' | 'ROW_LIMIT' | 'FIELD_NOT_IN_SCHEMA' | 'UPDATE_WITHOUT_ROW' | 'ROW_NOT_FOUND' | 'DUPLICATE_ROW'; message: string };

function valueFits(type: ResourceSchemaEntry['fields'][number]['type'], value: unknown): boolean {
  if (value === null) return true;
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'list') return Array.isArray(value);
  return typeof value === 'string';
}

export function planToolBehaviorWrites(input: {
  declaredWrites: readonly DeclaredWrite[];
  resourceSchema: Record<string, ResourceSchemaEntry>;
  changes: readonly ProposedChange[];
  /** Row ids the table already holds for each resource, when the caller knows them. */
  existingRowIds?: Record<string, readonly string[]>;
}): PlanResult {
  const writes: PlannedWrite[] = [];
  const createsByResource = new Map<string, number>();
  const updateIds = new Set<string>();

  for (const change of input.changes) {
    if (change.target !== undefined && change.target !== 'self') {
      return { ok: false, code: 'NOT_SELF_TARGET', message: 'A behaviour may only write to its own table.' };
    }
    const declared = input.declaredWrites.find(entry => entry.resource === change.resource);
    if (!declared) {
      return { ok: false, code: 'RESOURCE_NOT_DECLARED', message: `The package never declared writes to ${change.resource}.` };
    }
    if (!declared.operations.includes(change.operation)) {
      return { ok: false, code: 'OPERATION_NOT_DECLARED', message: `The package did not declare ${change.operation} on ${change.resource}.` };
    }

    const schema = input.resourceSchema[change.resource];
    if (!schema) {
      return { ok: false, code: 'FIELD_NOT_IN_SCHEMA', message: `No schema is known for ${change.resource}.` };
    }
    for (const [field, value] of Object.entries(change.values)) {
      const definition = schema.fields.find(entry => entry.id === field);
      if (!definition) {
        return { ok: false, code: 'FIELD_NOT_IN_SCHEMA', message: `${field} is not a field of ${change.resource}.` };
      }
      if (!valueFits(definition.type, value)) {
        return { ok: false, code: 'FIELD_NOT_IN_SCHEMA', message: `${field} does not hold a ${definition.type}.` };
      }
    }

    if (change.operation === 'create') {
      const created = (createsByResource.get(change.resource) ?? 0) + 1;
      if (created > declared.maxRows) {
        return { ok: false, code: 'ROW_LIMIT', message: `A run may create at most ${declared.maxRows} rows in ${change.resource}.` };
      }
      createsByResource.set(change.resource, created);
      writes.push({ resource: change.resource, operation: 'create', values: change.values });
      continue;
    }

    if (!change.rowId) {
      return { ok: false, code: 'UPDATE_WITHOUT_ROW', message: 'An update must name the row it changes.' };
    }
    const known = input.existingRowIds?.[change.resource];
    if (known && !known.includes(change.rowId)) {
      return { ok: false, code: 'ROW_NOT_FOUND', message: 'That row is not part of this table.' };
    }
    const key = `${change.resource}:${change.rowId}`;
    if (updateIds.has(key)) {
      return { ok: false, code: 'DUPLICATE_ROW', message: 'The same row was changed twice in one run.' };
    }
    updateIds.add(key);
    writes.push({ resource: change.resource, operation: 'update', rowId: change.rowId, values: change.values });
  }

  return { ok: true, writes };
}
