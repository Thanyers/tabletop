import { GENERATIVE_LIMITS, type ControlDescriptor, type ControlInputBinding, type GenerativeCanvas, type GenerativeExpression, type GenerativeOutput, type GenerativeScalar, type ScenePrimitive } from '../../shared/generative-contracts';
import type { TableAction, TableProgram, TableRecord, TableValue } from '../../shared/table-contracts';
import { expressionWithinBounds, validateGenerativeProgram } from './validation';

interface RowSet { readonly kind: 'rows'; readonly collection: string; readonly rows: readonly TableRecord[] }
type RuntimeValue = GenerativeScalar | readonly GenerativeScalar[] | RowSet;
export type GenerativeRuntimeBinding = GenerativeScalar | TableRecord;
export interface GenerativeEvaluationContext {
  program: TableProgram;
  records: Readonly<Record<string, readonly TableRecord[]>>;
  inputs?: Readonly<Record<string, TableValue>>;
  action?: TableAction;
  actor: string;
  seat?: string;
  turn: string | null;
  variables?: Readonly<Record<string, GenerativeRuntimeBinding>>;
}
export interface GenerativeEvaluationOptions { fuel?: number }
export type GenerativeExpressionSession = (expression: GenerativeExpression) => GenerativeOutput;
export type EvaluatedScenePrimitive =
  | { id: string; shape: 'rect'; x: number; y: number; width: number; height: number; rx?: number; fill?: string; stroke?: string; strokeWidth?: number; drag?: EvaluatedSceneDragBinding }
  | { id: string; shape: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; strokeWidth?: number; drag?: EvaluatedSceneDragBinding }
  | { id: string; shape: 'line'; x1: number; y1: number; x2: number; y2: number; stroke?: string; strokeWidth?: number; drag?: EvaluatedSceneDragBinding }
  | { id: string; shape: 'polygon'; points: { x: number; y: number }[]; fill?: string; stroke?: string; strokeWidth?: number; drag?: EvaluatedSceneDragBinding }
  | { id: string; shape: 'text'; x: number; y: number; text: string; fontSize?: number; fill?: string; stroke?: string; drag?: EvaluatedSceneDragBinding };
export interface EvaluatedChartPoint { id: string; category: GenerativeScalar; value: number }
export interface EvaluatedSceneDragBinding { actionId: string; xParameter: string; yParameter?: string; inputs: Record<string, TableValue> }
export interface EvaluatedControl { descriptor: ControlDescriptor; inputValues: Record<string, TableValue>; value?: GenerativeOutput }
export type EvaluatedGenerativeView =
  | { id: string; kind: 'scene'; title: string; width: number; height: number; elements: EvaluatedScenePrimitive[] }
  | { id: string; kind: 'chart'; title: string; chart: 'bar' | 'line' | 'scatter'; color?: string; points: EvaluatedChartPoint[] }
  | { id: string; kind: 'metric'; title: string; value: GenerativeScalar; format?: 'number' | 'percent' | 'text' }
  | { id: string; kind: 'controls'; title: string; controls: EvaluatedControl[] };

function fail(message: string): never { throw new Error(message); }
function isRowSet(value: RuntimeValue): value is RowSet { return typeof value === 'object' && value !== null && !Array.isArray(value) && 'kind' in value && value.kind === 'rows'; }
function isRecord(value: GenerativeRuntimeBinding | undefined): value is TableRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && 'id' in value && typeof value.id === 'string' && 'values' in value && typeof value.values === 'object' && value.values !== null;
}
function asScalar(value: RuntimeValue): GenerativeScalar {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  fail('An expression expected a scalar value.');
}
function asNumber(value: RuntimeValue): number {
  const scalar = asScalar(value);
  if (typeof scalar !== 'number' || !Number.isFinite(scalar) || Math.abs(scalar) > GENERATIVE_LIMITS.numberMagnitude) fail('A numeric expression returned an invalid number.');
  return scalar;
}
function asBoolean(value: RuntimeValue): boolean {
  const scalar = asScalar(value);
  if (typeof scalar !== 'boolean') fail('A logical expression returned a non-boolean value.');
  return scalar;
}
function asText(value: RuntimeValue): string {
  const scalar = asScalar(value);
  if (typeof scalar !== 'string') fail('A text expression returned a non-text value.');
  return scalar;
}
function rowSet(value: RuntimeValue): RowSet {
  if (!isRowSet(value)) fail('A collection expression returned an invalid value.');
  if (value.rows.length > GENERATIVE_LIMITS.arrayItems) fail('A collection expression exceeded the row limit.');
  return value;
}
function fieldValue(record: TableRecord, field: string): TableValue { return record.values[field] ?? null; }
function recordSet(context: GenerativeEvaluationContext, collection: string): RowSet {
  const rows = context.records[collection];
  if (!rows) fail('A collection expression refers to missing table records.');
  if (rows.length > GENERATIVE_LIMITS.arrayItems) fail('A collection expression exceeded the row limit.');
  return { kind: 'rows', collection, rows };
}
function selectedRecord(context: GenerativeEvaluationContext, parameter: string): TableRecord {
  if (!context.action) fail('Selected record expressions require an action context.');
  const actionParameter = context.action.parameters.find(item => item.id === parameter && item.type === 'record');
  if (!actionParameter?.collection) fail('Selected record expression refers to an invalid action parameter.');
  const id = context.inputs?.[parameter];
  if (typeof id !== 'string') fail('Selected record input must be an identifier.');
  const record = context.records[actionParameter.collection]?.find(item => item.id === id);
  if (!record) fail('Selected record was not found.');
  return record;
}
function truthyEqual(left: GenerativeScalar | readonly GenerativeScalar[], right: GenerativeScalar | readonly GenerativeScalar[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function outputWithinBounds(value: GenerativeOutput): boolean {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= GENERATIVE_LIMITS.numberMagnitude;
  if (Array.isArray(value)) {
    if (value.length > GENERATIVE_LIMITS.arrayItems) return false;
    return value.every(item => item === null || typeof item === 'string' || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= GENERATIVE_LIMITS.numberMagnitude);
  }
  return value === null || typeof value === 'string' || typeof value === 'boolean';
}
function isGenerativeArray(value: GenerativeOutput): value is readonly GenerativeScalar[] { return Array.isArray(value); }
function evaluate(expression: GenerativeExpression, context: GenerativeEvaluationContext, scope: ReadonlyMap<string, GenerativeRuntimeBinding>, spend: () => void, depth: number): RuntimeValue {
  spend();
  if (depth > GENERATIVE_LIMITS.expressionDepth) fail('Expression exceeds the maximum evaluation depth.');
  switch (expression.op) {
    case 'literal': return expression.value;
    case 'input': {
      if (!context.action || !context.action.parameters.some(parameter => parameter.id === expression.id)) fail('Expression input is unavailable.');
      const value = context.inputs?.[expression.id];
      if (value === undefined) fail('Expression input is missing.');
      return value;
    }
    case 'selectedField': return fieldValue(selectedRecord(context, expression.parameter), expression.field);
    case 'recordField': {
      const record = context.records[expression.collection]?.find(item => item.id === expression.recordId);
      if (!record) fail('Expression record was not found.');
      return fieldValue(record, expression.field);
    }
    case 'system': return expression.value === 'actor' ? context.actor : expression.value === 'seat' ? context.seat ?? 'host' : context.turn;
    case 'variable': {
      const value = scope.get(expression.name) ?? context.variables?.[expression.name];
      if (value === undefined || isRecord(value)) fail('Expression scalar variable is unavailable.');
      return value;
    }
    case 'field': {
      const record = scope.get(expression.record) ?? context.variables?.[expression.record];
      if (!isRecord(record)) fail('Expression record variable is unavailable.');
      return fieldValue(record, expression.field);
    }
    case 'collection': return recordSet(context, expression.id);
    case 'if': return asBoolean(evaluate(expression.test, context, scope, spend, depth + 1))
      ? evaluate(expression.then, context, scope, spend, depth + 1)
      : evaluate(expression.otherwise, context, scope, spend, depth + 1);
    case 'math': {
      const args = expression.args.map(argument => asNumber(evaluate(argument, context, scope, spend, depth + 1)));
      let result: number;
      switch (expression.fn) {
        case 'add': result = args[0] + args[1]; break;
        case 'subtract': result = args[0] - args[1]; break;
        case 'multiply': result = args[0] * args[1]; break;
        case 'divide': if (args[1] === 0) fail('Division by zero is not allowed.'); result = args[0] / args[1]; break;
        case 'remainder': if (args[1] === 0) fail('Remainder by zero is not allowed.'); result = args[0] % args[1]; break;
        case 'power': result = Math.pow(args[0], args[1]); break;
        case 'min': result = Math.min(...args); break;
        case 'max': result = Math.max(...args); break;
        case 'abs': result = Math.abs(args[0]); break;
        case 'sqrt': result = Math.sqrt(args[0]); break;
        case 'sin': result = Math.sin(args[0]); break;
        case 'cos': result = Math.cos(args[0]); break;
        case 'tan': result = Math.tan(args[0]); break;
        case 'asin': result = Math.asin(args[0]); break;
        case 'acos': result = Math.acos(args[0]); break;
        case 'atan': result = Math.atan(args[0]); break;
        case 'floor': result = Math.floor(args[0]); break;
        case 'ceil': result = Math.ceil(args[0]); break;
        case 'round': result = Math.round(args[0]); break;
      }
      if (!Number.isFinite(result) || Math.abs(result) > GENERATIVE_LIMITS.numberMagnitude) fail('Math result is outside the finite number limit.');
      return result;
    }
    case 'compare': {
      const left = evaluate(expression.left, context, scope, spend, depth + 1);
      const right = evaluate(expression.right, context, scope, spend, depth + 1);
      if (expression.fn === 'eq') return truthyEqual(asOutput(left), asOutput(right));
      if (expression.fn === 'neq') return !truthyEqual(asOutput(left), asOutput(right));
      if (expression.fn === 'contains') {
        if (!Array.isArray(left) || typeof right !== 'string') fail('contains received invalid values.');
        return left.includes(right);
      }
      const l = asNumber(left); const r = asNumber(right);
      return expression.fn === 'lt' ? l < r : expression.fn === 'lte' ? l <= r : expression.fn === 'gt' ? l > r : l >= r;
    }
    case 'logic': {
      if (expression.fn === 'and') {
        for (const value of expression.values) if (!asBoolean(evaluate(value, context, scope, spend, depth + 1))) return false;
        return true;
      }
      for (const value of expression.values) if (asBoolean(evaluate(value, context, scope, spend, depth + 1))) return true;
      return false;
    }
    case 'not': return !asBoolean(evaluate(expression.value, context, scope, spend, depth + 1));
    case 'map': {
      const source = rowSet(evaluate(expression.source, context, scope, spend, depth + 1));
      const values: GenerativeScalar[] = [];
      for (const row of source.rows) {
        spend();
        const nested = new Map(scope); nested.set(expression.as, row);
        values.push(asScalar(evaluate(expression.value, context, nested, spend, depth + 1)));
      }
      return values;
    }
    case 'filter': {
      const source = rowSet(evaluate(expression.source, context, scope, spend, depth + 1));
      const rows: TableRecord[] = [];
      for (const row of source.rows) {
        spend();
        const nested = new Map(scope); nested.set(expression.as, row);
        if (asBoolean(evaluate(expression.where, context, nested, spend, depth + 1))) rows.push(row);
      }
      return { kind: 'rows', collection: source.collection, rows };
    }
    case 'reduce': {
      const source = rowSet(evaluate(expression.source, context, scope, spend, depth + 1));
      let accumulator = asScalar(evaluate(expression.initial, context, scope, spend, depth + 1));
      for (const row of source.rows) {
        spend();
        const nested = new Map(scope); nested.set(expression.as, row); nested.set(expression.accumulator, accumulator);
        accumulator = asScalar(evaluate(expression.value, context, nested, spend, depth + 1));
      }
      return accumulator;
    }
    case 'aggregate': {
      const source = rowSet(evaluate(expression.source, context, scope, spend, depth + 1));
      const values: number[] = [];
      let count = 0;
      for (const row of source.rows) {
        spend();
        const nested = new Map(scope);
        if (expression.as) nested.set(expression.as, row);
        if (expression.where && !asBoolean(evaluate(expression.where, context, nested, spend, depth + 1))) continue;
        count += 1;
        if (expression.fn !== 'count') values.push(asNumber(evaluate(expression.value!, context, nested, spend, depth + 1)));
      }
      if (expression.fn === 'count') return count;
      if (expression.fn === 'sum') return values.reduce((total, value) => boundedNumber(total + value), 0);
      if (values.length === 0) fail('Numeric aggregates require at least one matching row.');
      if (expression.fn === 'mean') return boundedNumber(values.reduce((total, value) => boundedNumber(total + value), 0) / values.length);
      return expression.fn === 'min' ? Math.min(...values) : Math.max(...values);
    }
  }
}

function boundedNumber(value: number): number {
  if (!Number.isFinite(value) || Math.abs(value) > GENERATIVE_LIMITS.numberMagnitude) fail('Math result is outside the finite number limit.');
  return value;
}
function asOutput(value: RuntimeValue): GenerativeOutput {
  if (isRowSet(value)) fail('A collection cannot be returned directly.');
  return value;
}
function outputBytes(value: GenerativeOutput): number {
  const serialized = JSON.stringify(value) ?? '';
  return new TextEncoder().encode(serialized).byteLength;
}

function makeSpend(fuel: number): () => void {
  if (!Number.isSafeInteger(fuel) || fuel < 1 || fuel > GENERATIVE_LIMITS.evaluationFuel) fail('Evaluation fuel must be a positive bounded integer.');
  let remainingFuel = fuel;
  return () => { remainingFuel -= 1; if (remainingFuel < 0) fail('Expression exhausted its deterministic evaluation fuel.'); };
}
function evaluateWithSpend(expression: GenerativeExpression, context: GenerativeEvaluationContext, spend: () => void, variables: Readonly<Record<string, GenerativeRuntimeBinding>> = {}): RuntimeValue {
  const scope = new Map<string, GenerativeRuntimeBinding>();
  for (const [name, value] of Object.entries(context.variables ?? {})) scope.set(name, value);
  for (const [name, value] of Object.entries(variables)) scope.set(name, value);
  return evaluate(expression, context, scope, spend, 1);
}

function toTableValue(value: GenerativeOutput): TableValue {
  if (!isGenerativeArray(value)) return value;
  const strings: string[] = [];
  if (value.length > 32) fail('A table action cannot accept more than 32 list values.');
  for (const item of value) {
    if (typeof item !== 'string' || item.length > 100) fail('Action list inputs must contain bounded text values.');
    strings.push(item);
  }
  return strings;
}
function actionParameterValue(context: GenerativeEvaluationContext, actionId: string, parameterId: string, value: TableValue): void {
  const action = context.program.actions.find(item => item.id === actionId);
  const parameter = action?.parameters.find(item => item.id === parameterId);
  if (!parameter) fail('Control input refers to an unknown action parameter.');
  if (parameter.type === 'record') {
    if (typeof value !== 'string' || !context.records[parameter.collection ?? '']?.some(row => row.id === value)) fail('Control record input is unavailable.');
    return;
  }
  if (parameter.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > GENERATIVE_LIMITS.numberMagnitude || parameter.min !== undefined && value < parameter.min || parameter.max !== undefined && value > parameter.max) fail('Control number input is outside its action bounds.');
    return;
  }
  if (parameter.type === 'boolean') {
    if (typeof value !== 'boolean') fail('Control boolean input has the wrong type.');
    return;
  }
  if (typeof value !== 'string' || parameter.choices && !parameter.choices.includes(value)) fail('Control text input has the wrong type or choice.');
}
function resolveBindings(actionId: string, inputs: Record<string, ControlInputBinding>, context: GenerativeEvaluationContext, spend: () => void): Record<string, TableValue> {
  const values: Record<string, TableValue> = {};
  for (const [parameter, binding] of Object.entries(inputs)) {
    if (binding.kind === 'control') continue;
    const value = binding.kind === 'literal' ? binding.value : binding.kind === 'record' ? binding.recordId : toTableValue(asOutput(evaluateWithSpend(binding.value, context, spend)));
    actionParameterValue(context, actionId, parameter, value);
    values[parameter] = value;
  }
  return values;
}
function evaluatedDrag(binding: ScenePrimitive['drag'], context: GenerativeEvaluationContext, spend: () => void): EvaluatedSceneDragBinding | undefined {
  if (!binding) return undefined;
  return { actionId: binding.actionId, xParameter: binding.xParameter, ...(binding.yParameter ? { yParameter: binding.yParameter } : {}), inputs: resolveBindings(binding.actionId, binding.inputs, context, spend) };
}

export function createGenerativeExpressionSession(context: GenerativeEvaluationContext, options: GenerativeEvaluationOptions = {}): GenerativeExpressionSession {
  const spend = makeSpend(options.fuel ?? GENERATIVE_LIMITS.evaluationFuel);
  let usedOutputBytes = 0;
  return expression => {
    if (!expressionWithinBounds(expression)) fail('Expression exceeds deterministic depth, node, or array limits.');
    const output = asOutput(evaluateWithSpend(expression, context, spend));
    const size = outputBytes(output);
    if (!outputWithinBounds(output) || size > GENERATIVE_LIMITS.outputBytes || usedOutputBytes + size > GENERATIVE_LIMITS.outputBytes) fail('Expression output exceeds deterministic bounds.');
    usedOutputBytes += size;
    return output;
  };
}
export function evaluateGenerativeExpression(expression: GenerativeExpression, context: GenerativeEvaluationContext, options: GenerativeEvaluationOptions = {}): GenerativeOutput {
  return createGenerativeExpressionSession(context, options)(expression);
}

function numericSceneValue(value: number | GenerativeExpression, context: GenerativeEvaluationContext, spend: () => void, variables: Readonly<Record<string, GenerativeRuntimeBinding>> = {}): number {
  return typeof value === 'number' ? value : asNumber(evaluateWithSpend(value, context, spend, variables));
}
function scenePrimitive(element: ScenePrimitive, context: GenerativeEvaluationContext, spend: () => void): EvaluatedScenePrimitive {
  const drag = evaluatedDrag(element.drag, context, spend);
  const strokeWidth = element.shape !== 'text' && 'strokeWidth' in element && element.strokeWidth !== undefined ? numericSceneValue(element.strokeWidth, context, spend) : undefined;
  if (element.shape === 'rect') return { id: element.id, shape: 'rect', x: numericSceneValue(element.x, context, spend), y: numericSceneValue(element.y, context, spend), width: numericSceneValue(element.width, context, spend), height: numericSceneValue(element.height, context, spend), ...(element.rx === undefined ? {} : { rx: numericSceneValue(element.rx, context, spend) }), ...(element.fill === undefined ? {} : { fill: element.fill }), ...(element.stroke === undefined ? {} : { stroke: element.stroke }), ...(strokeWidth === undefined ? {} : { strokeWidth }), ...(drag ? { drag } : {}) };
  if (element.shape === 'circle') return { id: element.id, shape: 'circle', cx: numericSceneValue(element.cx, context, spend), cy: numericSceneValue(element.cy, context, spend), r: numericSceneValue(element.r, context, spend), ...(element.fill === undefined ? {} : { fill: element.fill }), ...(element.stroke === undefined ? {} : { stroke: element.stroke }), ...(strokeWidth === undefined ? {} : { strokeWidth }), ...(drag ? { drag } : {}) };
  if (element.shape === 'line') return { id: element.id, shape: 'line', x1: numericSceneValue(element.x1, context, spend), y1: numericSceneValue(element.y1, context, spend), x2: numericSceneValue(element.x2, context, spend), y2: numericSceneValue(element.y2, context, spend), ...(element.stroke === undefined ? {} : { stroke: element.stroke }), ...(strokeWidth === undefined ? {} : { strokeWidth }), ...(drag ? { drag } : {}) };
  if (element.shape === 'polygon') return { id: element.id, shape: 'polygon', points: element.points.map(point => ({ x: numericSceneValue(point.x, context, spend), y: numericSceneValue(point.y, context, spend) })), ...(element.fill === undefined ? {} : { fill: element.fill }), ...(element.stroke === undefined ? {} : { stroke: element.stroke }), ...(strokeWidth === undefined ? {} : { strokeWidth }), ...(drag ? { drag } : {}) };
  return { id: element.id, shape: 'text', x: numericSceneValue(element.x, context, spend), y: numericSceneValue(element.y, context, spend), text: typeof element.text === 'string' ? element.text : asText(evaluateWithSpend(element.text, context, spend)), ...(element.fontSize === undefined ? {} : { fontSize: numericSceneValue(element.fontSize, context, spend) }), ...(element.fill === undefined ? {} : { fill: element.fill }), ...(element.stroke === undefined ? {} : { stroke: element.stroke }), ...(drag ? { drag } : {}) };
}

export function evaluateGenerativeCanvas(canvas: GenerativeCanvas, context: GenerativeEvaluationContext, options: GenerativeEvaluationOptions = {}): EvaluatedGenerativeView[] {
  if (!context.program.canvas || JSON.stringify(canvas) !== JSON.stringify(context.program.canvas)) fail('Canvas descriptors must come from the active table program.');
  if (!expressionWithinBounds({ program: context.program, canvas })) fail('Canvas expressions exceed deterministic depth, node, or array limits.');
  const issues = validateGenerativeProgram(context.program, context.records);
  if (issues.length > 0) fail(issues[0]);
  const spend = makeSpend(options.fuel ?? GENERATIVE_LIMITS.evaluationFuel);
  const evaluated: EvaluatedGenerativeView[] = [];
  let totalSceneElements = 0;
  let totalChartPoints = 0;
  for (const view of canvas.views) {
    if (view.kind === 'metric') {
      const value = asOutput(evaluateWithSpend(view.value, context, spend));
      if (!outputWithinBounds(value)) fail('Metric output exceeds deterministic bounds.');
      if (isGenerativeArray(value)) fail('Metric views must return a scalar.');
      evaluated.push({ id: view.id, kind: 'metric', title: view.title, value, ...(view.format ? { format: view.format } : {}) });
    } else if (view.kind === 'chart') {
      const rows = recordSet(context, view.collection).rows;
      const points = rows.map(row => {
        spend();
        const category = fieldValue(row, view.categoryField);
        if (category !== null && typeof category !== 'string' && typeof category !== 'number') fail('Chart categories must be text or numeric values.');
        const value = asNumber(evaluateWithSpend(view.value, context, spend, { row }));
        return { id: row.id, category, value };
      });
      totalChartPoints += points.length;
      if (totalChartPoints > GENERATIVE_LIMITS.chartPoints) fail('Chart output exceeds the point limit.');
      evaluated.push({ id: view.id, kind: 'chart', title: view.title, chart: view.chart, ...(view.color ? { color: view.color } : {}), points });
    } else if (view.kind === 'scene') {
      totalSceneElements += view.elements.length;
      if (totalSceneElements > GENERATIVE_LIMITS.sceneElements) fail('Scene output exceeds the element limit.');
      const elements = view.elements.map(element => scenePrimitive(element, context, spend));
      evaluated.push({ id: view.id, kind: 'scene', title: view.title, width: view.width, height: view.height, elements });
    } else {
      const controls = view.controls.map(descriptor => {
        const inputValues = resolveBindings(descriptor.actionId, descriptor.inputs, context, spend);
        const value = 'value' in descriptor && descriptor.value ? asOutput(evaluateWithSpend(descriptor.value, context, spend)) : undefined;
        if (value !== undefined && 'parameter' in descriptor) actionParameterValue(context, descriptor.actionId, descriptor.parameter, toTableValue(value));
        return { descriptor, inputValues, ...(value === undefined ? {} : { value }) };
      });
      evaluated.push({ id: view.id, kind: 'controls', title: view.title, controls });
    }
  }
  const serialized = JSON.stringify(evaluated) ?? '';
  if (new TextEncoder().encode(serialized).byteLength > GENERATIVE_LIMITS.outputBytes) fail('Canvas output exceeds deterministic bounds.');
  return evaluated;
}
