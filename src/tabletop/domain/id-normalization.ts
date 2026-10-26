/**
 * F047: normalize identifiers the model invented before the authoritative schema sees them.
 *
 * Measured problem: after the F031 prompt work the largest remaining rejection class is orthography,
 * not meaning — the model writes `totalProfit` / `Sales2026` / `order id` where the schema demands
 * `/^[a-z][a-z0-9_-]{0,39}$/`, and one such id rejects the whole draft. Renaming at the host is
 * deterministic, costs nothing, and asking the model again does not fix it better.
 *
 * Safety rules:
 * - Only the AI draft path calls this. A hand-written change keeps its author's exact ids.
 * - Valid ids are left untouched, so a draft that already passes is not rewritten at all.
 * - If two different ids would collapse into one name, the whole normalization aborts and returns
 *   the input unchanged: a silent merge of two fields would be worse than a rejection.
 * - Every reference is rewritten with the same map — actions, expressions, views and initial records.
 */

import { GENERATIVE_FORBIDDEN_IDENTIFIERS } from '../shared/generative-contracts';

const FORBIDDEN = new Set<string>(GENERATIVE_FORBIDDEN_IDENTIFIERS);
const ID_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/u;
const MAX_ID_CHARS = 40;

type Json = Record<string, unknown>;

export function isValidGeneratedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value) && !FORBIDDEN.has(value);
}

/** A deterministic, schema-valid identifier for one model-invented name. */
export function normalizeGeneratedId(raw: unknown): string {
  let value = typeof raw === 'string' ? raw : '';
  value = value.normalize('NFKD').replace(/[\u0300-\u036f]/gu, '');
  value = value.replace(/([a-z0-9])([A-Z])/gu, '$1_$2');
  value = value.replace(/[^A-Za-z0-9_-]+/gu, '_');
  value = value.replace(/_+/gu, '_').replace(/^[_-]+|[_-]+$/gu, '');
  value = value.toLowerCase();
  if (!/^[a-z]/u.test(value)) value = `x_${value}`;
  value = value.slice(0, MAX_ID_CHARS).replace(/[_-]+$/u, '');
  if (!value) value = 'item';
  if (FORBIDDEN.has(value)) value = `${value}_1`;
  return value.slice(0, MAX_ID_CHARS);
}

export interface RenameContext {
  /** old collection id -> new id */
  collections: Map<string, string>;
  /** old collection id -> (old field id -> new id) */
  fields: Map<string, Map<string, string>>;
  actions: Map<string, string>;
  /** old action id -> (old parameter id -> new id) */
  parameters: Map<string, Map<string, string>>;
  /** old action id -> (old parameter id -> old collection id) */
  parameterCollections: Map<string, Map<string, string>>;
  invariants: Map<string, string>;
  views: Map<string, string>;
  computedColumns: Map<string, string>;
  /** old collection id -> (old row id -> new id) */
  rows: Map<string, Map<string, string>>;
}

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function objects(value: unknown): Json[] {
  return list(value).filter(isObject);
}

/** Build one scope's rename map, or null when two ids would collapse into the same name. */
function renameMap(values: readonly unknown[]): Map<string, string> | null {
  const map = new Map<string, string>();
  const used = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string' || map.has(value)) continue;
    const next = isValidGeneratedId(value) ? value : normalizeGeneratedId(value);
    if (used.has(next)) return null;
    used.add(next);
    map.set(value, next);
  }
  return map;
}

function renameIn(map: Map<string, string> | undefined, value: unknown): unknown {
  return typeof value === 'string' && map?.has(value) ? map.get(value) : value;
}

function rewriteOperand(operand: unknown, action: string | undefined, context: RenameContext): void {
  if (!isObject(operand)) return;
  const parameters = action ? context.parameters.get(action) : undefined;
  if ('input' in operand) operand.input = renameIn(parameters, operand.input);
  if ('record' in operand) operand.record = renameIn(parameters, operand.record);
  if ('field' in operand) {
    const collection = typeof operand.record === 'string' && action
      ? context.parameterCollections.get(action)?.get(operand.record)
      : undefined;
    const fields = collection ? context.fields.get(collection) : undefined;
    if (fields) operand.field = renameIn(fields, operand.field);
  }
  if ('expression' in operand) rewriteExpression(operand.expression, action, undefined, context);
}

function rewriteExpression(
  expression: unknown,
  action: string | undefined,
  scopedCollection: string | undefined,
  context: RenameContext,
): void {
  if (Array.isArray(expression)) {
    for (const item of expression) rewriteExpression(item, action, scopedCollection, context);
    return;
  }
  if (!isObject(expression)) return;
  const parameters = action ? context.parameters.get(action) : undefined;

  if (expression.op === 'input') expression.id = renameIn(parameters, expression.id);
  if (expression.op === 'collection') expression.id = renameIn(context.collections, expression.id);
  if (expression.op === 'selectedField') {
    const oldParameter = typeof expression.parameter === 'string' ? expression.parameter : '';
    const oldCollection = action ? context.parameterCollections.get(action)?.get(oldParameter) : undefined;
    const fields = oldCollection ? context.fields.get(oldCollection) : undefined;
    if (fields) expression.field = renameIn(fields, expression.field);
    expression.parameter = renameIn(parameters, expression.parameter);
  }
  if (expression.op === 'recordField') {
    const oldCollection = typeof expression.collection === 'string' ? expression.collection : '';
    const fields = context.fields.get(oldCollection);
    if (fields) {
      expression.field = renameIn(fields, expression.field);
      expression.recordId = renameIn(context.rows.get(oldCollection), expression.recordId);
    }
    expression.collection = renameIn(context.collections, expression.collection);
  }
  if (expression.op === 'field' && scopedCollection) {
    // A row variable inside a chart/aggregate scope: `record` is a scope name, `field` is a column.
    expression.field = renameIn(context.fields.get(scopedCollection), expression.field);
  }

  for (const [key, value] of Object.entries(expression)) {
    if (key === 'op') continue;
    rewriteExpression(value, action, scopedCollection, context);
  }
}

function rewriteInputs(inputs: Json, actionId: unknown, context: RenameContext): Json {
  const action = typeof actionId === 'string' ? actionId : undefined;
  const parameters = action ? context.parameters.get(action) : undefined;
  const next: Json = {};
  for (const [key, binding] of Object.entries(inputs)) {
    if (isObject(binding)) rewriteExpression(binding.value, action, undefined, context);
    next[parameters?.get(key) ?? key] = binding;
  }
  return next;
}

/**
 * Rename every identifier in a parsed table change. Returns the input unchanged when it is not a
 * table draft, when nothing needs renaming, or when the rename would be ambiguous.
 */
export function normalizeGeneratedTableChange(value: unknown): unknown {
  if (!isObject(value) || value.kind !== 'table' || !isObject(value.program)) return value;
  const program = value.program;
  const collections = objects(program.collections);
  const actions = objects(program.actions);
  const invariants = objects(program.invariants);
  const computedColumns = objects(program.computedColumns);
  const canvas = isObject(program.canvas) ? program.canvas : null;
  const views = canvas ? objects(canvas.views) : [];
  const records = isObject(value.initialRecords) ? value.initialRecords : {};

  const context: RenameContext = {
    collections: new Map(),
    fields: new Map(),
    actions: new Map(),
    parameters: new Map(),
    parameterCollections: new Map(),
    invariants: new Map(),
    views: new Map(),
    computedColumns: new Map(),
    rows: new Map(),
  };

  const collectionMap = renameMap(collections.map(collection => collection.id));
  if (!collectionMap) return value;
  context.collections = collectionMap;
  for (const collection of collections) {
    const oldId = String(collection.id);
    const fieldMap = renameMap(objects(collection.fields).map(field => field.id));
    if (!fieldMap) return value;
    context.fields.set(oldId, fieldMap);
    const rowMap = renameMap(objects(records[oldId]).map(row => row.id));
    if (!rowMap) return value;
    context.rows.set(oldId, rowMap);
  }
  const actionMap = renameMap(actions.map(action => action.id));
  if (!actionMap) return value;
  context.actions = actionMap;
  for (const action of actions) {
    const oldAction = String(action.id);
    const parameters = objects(action.parameters);
    const parameterMap = renameMap(parameters.map(parameter => parameter.id));
    if (!parameterMap) return value;
    context.parameters.set(oldAction, parameterMap);
    const collectionsByParameter = new Map<string, string>();
    for (const parameter of parameters) {
      if (typeof parameter.id === 'string' && typeof parameter.collection === 'string') {
        collectionsByParameter.set(parameter.id, parameter.collection);
      }
    }
    context.parameterCollections.set(oldAction, collectionsByParameter);
  }
  const invariantMap = renameMap(invariants.map(invariant => invariant.id));
  if (!invariantMap) return value;
  context.invariants = invariantMap;
  const computedColumnMap = renameMap(computedColumns.map(column => column.id));
  if (!computedColumnMap) return value;
  context.computedColumns = computedColumnMap;
  const viewMap = renameMap(views.map(view => view.id));
  if (!viewMap) return value;
  context.views = viewMap;

  const result = structuredClone(value) as Json;
  const nextProgram = result.program as Json;

  // Definitions and the references that live beside them ------------------------------------------
  for (const collection of objects(nextProgram.collections)) {
    const oldId = String(collection.id);
    collection.id = context.collections.get(oldId) ?? oldId;
    for (const field of objects(collection.fields)) field.id = renameIn(context.fields.get(oldId), field.id);
  }

  for (const action of objects(nextProgram.actions)) {
    const oldAction = String(action.id);
    action.id = context.actions.get(oldAction) ?? oldAction;
    for (const parameter of objects(action.parameters)) {
      parameter.id = renameIn(context.parameters.get(oldAction), parameter.id);
      if (typeof parameter.collection === 'string') {
        parameter.collection = context.collections.get(parameter.collection) ?? parameter.collection;
      }
    }
    for (const condition of objects(action.conditions)) {
      rewriteOperand(condition.left, oldAction, context);
      rewriteOperand(condition.right, oldAction, context);
    }
    for (const effect of objects(action.effects)) {
      const oldCollection = typeof effect.record === 'string'
        ? context.parameterCollections.get(oldAction)?.get(effect.record)
        : undefined;
      const fields = oldCollection ? context.fields.get(oldCollection) : undefined;
      if (fields) effect.field = renameIn(fields, effect.field);
      effect.record = renameIn(context.parameters.get(oldAction), effect.record);
      if ('value' in effect) rewriteOperand(effect.value, oldAction, context);
    }
    for (const create of objects(action.creates)) {
      const oldCollection = typeof create.collection === 'string' ? create.collection : '';
      const fields = context.fields.get(oldCollection);
      create.collection = context.collections.get(oldCollection) ?? create.collection;
      if (isObject(create.values)) {
        const values: Json = {};
        for (const [key, operand] of Object.entries(create.values)) {
          rewriteOperand(operand, oldAction, context);
          values[fields?.get(key) ?? key] = operand;
        }
        create.values = values;
      }
    }
  }

  for (const invariant of objects(nextProgram.invariants)) {
    const oldCollection = typeof invariant.collection === 'string' ? invariant.collection : '';
    invariant.id = renameIn(context.invariants, invariant.id);
    invariant.collection = context.collections.get(oldCollection) ?? invariant.collection;
    if (Array.isArray(invariant.fields)) {
      invariant.fields = invariant.fields.map(field => renameIn(context.fields.get(oldCollection), field));
    }
  }

  for (const column of objects(nextProgram.computedColumns)) {
    const oldCollection = typeof column.collection === 'string' ? column.collection : '';
    column.id = renameIn(context.computedColumns, column.id);
    column.collection = context.collections.get(oldCollection) ?? column.collection;
    rewriteExpression(column.expression, undefined, oldCollection, context);
  }

  const nextCanvas = isObject(nextProgram.canvas) ? nextProgram.canvas : null;
  if (nextCanvas) {
    for (const view of objects(nextCanvas.views)) {
      const oldCollection = typeof view.collection === 'string' ? view.collection : undefined;
      view.id = renameIn(context.views, view.id);
      if (typeof view.categoryField === 'string' && oldCollection) {
        view.categoryField = renameIn(context.fields.get(oldCollection), view.categoryField);
      }
      if (typeof view.collection === 'string') {
        view.collection = context.collections.get(view.collection) ?? view.collection;
      }
      if (isObject(view.relatedTo)) {
        if (Array.isArray(view.relatedTo.views)) {
          view.relatedTo.views = view.relatedTo.views.map(id => renameIn(context.views, id));
        }
        if (Array.isArray(view.relatedTo.collections)) {
          view.relatedTo.collections = view.relatedTo.collections.map(id => renameIn(context.collections, id));
        }
      }
      for (const control of objects(view.controls)) {
        const oldAction = typeof control.actionId === 'string' ? control.actionId : undefined;
        if (typeof control.actionId === 'string') {
          control.actionId = context.actions.get(control.actionId) ?? control.actionId;
        }
        if (typeof control.parameter === 'string' && oldAction) {
          control.parameter = renameIn(context.parameters.get(oldAction), control.parameter);
        }
        if (isObject(control.inputs)) control.inputs = rewriteInputs(control.inputs, oldAction, context);
      }
      for (const element of objects(view.elements)) {
        if (!isObject(element.drag)) continue;
        const drag = element.drag;
        const oldAction = typeof drag.actionId === 'string' ? drag.actionId : undefined;
        if (typeof drag.actionId === 'string') drag.actionId = context.actions.get(drag.actionId) ?? drag.actionId;
        if (typeof drag.xParameter === 'string' && oldAction) {
          drag.xParameter = renameIn(context.parameters.get(oldAction), drag.xParameter);
        }
        if (typeof drag.yParameter === 'string' && oldAction) {
          drag.yParameter = renameIn(context.parameters.get(oldAction), drag.yParameter);
        }
        if (isObject(drag.inputs)) drag.inputs = rewriteInputs(drag.inputs, oldAction, context);
      }
      rewriteExpression(view.value, undefined, oldCollection, context);
    }
  }

  // Initial records -------------------------------------------------------------------------------
  if (isObject(result.initialRecords)) {
    const nextRecords: Json = {};
    for (const [collection, rows] of Object.entries(result.initialRecords)) {
      const nextCollection = context.collections.get(collection) ?? collection;
      const fields = context.fields.get(collection);
      nextRecords[nextCollection] = list(rows).map(row => {
        if (!isObject(row)) return row;
        const nextRow = structuredClone(row);
        nextRow.id = renameIn(context.rows.get(collection), nextRow.id);
        if (isObject(nextRow.values)) {
          const values: Json = {};
          for (const [key, cell] of Object.entries(nextRow.values)) {
            values[fields?.get(key) ?? context.computedColumns.get(key) ?? key] = cell;
          }
          nextRow.values = values;
        }
        return nextRow;
      });
    }
    result.initialRecords = nextRecords;
  }
  return result;
}
