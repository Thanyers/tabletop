import { GENERATIVE_FORBIDDEN_IDENTIFIERS, GENERATIVE_LIMITS, type ControlInputBinding, type GenerativeExpression } from '../../shared/generative-contracts';
import type { TableAction, TableField, TableProgram, TableRecord, TableValue } from '../../shared/table-contracts';
import { validateDiceSpec } from '../../shared/dice';

export type GenerativeStaticType = 'number' | 'text' | 'boolean' | 'list' | 'null' | 'rows' | 'unknown';
type ScopeBinding = { kind: 'row'; collection: string } | { kind: 'value'; type: GenerativeStaticType };
type Scope = ReadonlyMap<string, ScopeBinding>;
type Records = Readonly<Record<string, readonly TableRecord[]>>;

const forbiddenNames = new Set<string>(GENERATIVE_FORBIDDEN_IDENTIFIERS);
const expressionOps = new Set(['literal', 'input', 'selectedField', 'recordField', 'system', 'variable', 'field', 'collection', 'computeResult', 'if', 'math', 'compare', 'logic', 'not', 'map', 'filter', 'reduce', 'aggregate']);
const binaryMath = new Set(['add', 'subtract', 'multiply', 'divide', 'remainder', 'power']);
const unaryMath = new Set(['abs', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'floor', 'ceil', 'round']);

function fail(message: string): never { throw new Error(message); }
function assert(condition: unknown, message: string): asserts condition { if (!condition) fail(message); }
function fieldFor(program: TableProgram, collectionId: string, fieldId: string): TableField {
  const collection = program.collections.find(item => item.id === collectionId);
  assert(collection, 'Expression refers to an unknown collection.');
  const field = collection.fields.find(item => item.id === fieldId);
  assert(field, 'Expression refers to an unknown field.');
  return field;
}
function assertRecordReference(records: Records | undefined, collectionId: string, recordId: string): void {
  if (records) assert(records[collectionId]?.some(row => row.id === recordId), 'Expression refers to a missing record.');
}
function assertName(name: string): void { assert(/^[a-z][a-z0-9_-]{0,39}$/u.test(name) && !forbiddenNames.has(name), 'Expression contains an invalid variable name.'); }
function isScalar(type: GenerativeStaticType): boolean { return type !== 'rows' && type !== 'list' && type !== 'unknown'; }
function isCompatible(left: GenerativeStaticType, right: GenerativeStaticType): boolean { return left === right || left === 'null' || right === 'null'; }
function joinedType(left: GenerativeStaticType, right: GenerativeStaticType): GenerativeStaticType {
  assert(isCompatible(left, right), 'Conditional branches must return compatible values.');
  return left === 'null' ? right : left;
}
function valueType(value: TableValue): GenerativeStaticType {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'list';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'text';
}
function parameterType(action: TableAction, id: string): GenerativeStaticType {
  const parameter = action.parameters.find(item => item.id === id);
  assert(parameter, 'Expression refers to an unknown action input.');
  // F048: a server roll fills its parameter with a number.
  return parameter.type === 'record' ? 'text' : parameter.type === 'roll' ? 'number' : parameter.type === 'text' ? 'text' : parameter.type;
}
function recordInputCollection(action: TableAction, parameterId: string): string {
  const parameter = action.parameters.find(item => item.id === parameterId && item.type === 'record');
  assert(parameter?.collection, 'Expression record references must use a record action input.');
  return parameter.collection;
}
function mergeScope(scope: Scope, name: string, binding: ScopeBinding): Map<string, ScopeBinding> {
  assertName(name);
  assert(!scope.has(name), 'Expression variable names cannot shadow an existing binding.');
  const nested = new Map(scope);
  nested.set(name, binding);
  return nested;
}

function infer(expression: GenerativeExpression, program: TableProgram, action: TableAction | undefined, records: Records | undefined, scope: Scope, depth: number): GenerativeStaticType {
  assert(depth <= GENERATIVE_LIMITS.expressionDepth, 'Expression exceeds the maximum depth.');
  switch (expression.op) {
    case 'literal': return valueType(expression.value);
    case 'input': assert(action, 'View expressions cannot refer to action inputs.'); return parameterType(action, expression.id);
    case 'selectedField': {
      assert(action, 'View expressions cannot refer to selected action records.');
      return fieldFor(program, recordInputCollection(action, expression.parameter), expression.field).type;
    }
    case 'recordField':
      fieldFor(program, expression.collection, expression.field);
      assertRecordReference(records, expression.collection, expression.recordId);
      return fieldFor(program, expression.collection, expression.field).type;
    case 'system': return 'text';
    case 'variable': {
      assertName(expression.name);
      const binding = scope.get(expression.name);
      assert(binding?.kind === 'value', 'Expression refers to an unknown scalar variable.');
      return binding.type;
    }
    case 'field': {
      assertName(expression.record);
      const binding = scope.get(expression.record);
      assert(binding?.kind === 'row', 'Expression field access must use a scoped record.');
      return fieldFor(program, binding.collection, expression.field).type;
    }
    case 'collection':
      assert(program.collections.some(item => item.id === expression.id), 'Expression refers to an unknown collection.');
      return 'rows';
    case 'computeResult': {
      const module = program.compute?.modules.find(item => item.id === expression.moduleId);
      const output = module?.outputs.find(item => item.id === expression.outputId);
      assert(output && output.type !== 'table' && output.type !== 'text-list', 'Compute result expressions require a declared scalar output.');
      return output.type;
    }
    case 'if': {
      assert(infer(expression.test, program, action, records, scope, depth + 1) === 'boolean', 'Conditional tests must be boolean.');
      return joinedType(infer(expression.then, program, action, records, scope, depth + 1), infer(expression.otherwise, program, action, records, scope, depth + 1));
    }
    case 'math': {
      const arityValid = binaryMath.has(expression.fn) ? expression.args.length === 2 : unaryMath.has(expression.fn) ? expression.args.length === 1 : expression.fn === 'min' || expression.fn === 'max' ? expression.args.length >= 2 : false;
      const expected = binaryMath.has(expression.fn) ? 'exactly 2' : unaryMath.has(expression.fn) ? 'exactly 1' : 'at least 2';
      assert(arityValid, `Math ${expression.fn} requires ${expected} arguments; received ${expression.args.length}. Nest binary math calls to combine more values.`);
      for (const argument of expression.args) assert(infer(argument, program, action, records, scope, depth + 1) === 'number', 'Math functions accept numbers only.');
      return 'number';
    }
    case 'compare': {
      const left = infer(expression.left, program, action, records, scope, depth + 1);
      const right = infer(expression.right, program, action, records, scope, depth + 1);
      if (expression.fn === 'contains') assert(left === 'list' && right === 'text', 'contains needs a text list and a text value.');
      else if (expression.fn === 'eq' || expression.fn === 'neq') assert((isScalar(left) || left === 'list') && (isScalar(right) || right === 'list') && isCompatible(left, right), 'Comparison operands must have compatible scalar types.');
      else assert(left === 'number' && right === 'number', 'Ordered comparisons accept numbers only.');
      return 'boolean';
    }
    case 'logic':
      for (const value of expression.values) assert(infer(value, program, action, records, scope, depth + 1) === 'boolean', 'Logical operators accept booleans only.');
      return 'boolean';
    case 'not': assert(infer(expression.value, program, action, records, scope, depth + 1) === 'boolean', 'not accepts a boolean only.'); return 'boolean';
    case 'map': {
      const collection = collectionType(expression.source, program, action, records, scope, depth + 1);
      const itemScope = mergeScope(scope, expression.as, { kind: 'row', collection });
      const mappedType = infer(expression.value, program, action, records, itemScope, depth + 1);
      assert(isScalar(mappedType), 'map values must be scalar.');
      return 'list';
    }
    case 'filter': {
      const collection = collectionType(expression.source, program, action, records, scope, depth + 1);
      const itemScope = mergeScope(scope, expression.as, { kind: 'row', collection });
      assert(infer(expression.where, program, action, records, itemScope, depth + 1) === 'boolean', 'filter predicates must be boolean.');
      return 'rows';
    }
    case 'reduce': {
      const collection = collectionType(expression.source, program, action, records, scope, depth + 1);
      const initialType = infer(expression.initial, program, action, records, scope, depth + 1);
      assert(isScalar(initialType), 'reduce initial values must be scalar.');
      const itemScope = mergeScope(scope, expression.as, { kind: 'row', collection });
      const reducedScope = mergeScope(itemScope, expression.accumulator, { kind: 'value', type: initialType });
      const value = infer(expression.value, program, action, records, reducedScope, depth + 1);
      assert(initialType === value, 'reduce values must retain the accumulator type.');
      return initialType;
    }
    case 'aggregate': {
      const collection = collectionType(expression.source, program, action, records, scope, depth + 1);
      assert(!(expression.where || expression.value) || expression.as, 'Aggregate predicates and values need a row variable.');
      const itemScope = expression.as ? mergeScope(scope, expression.as, { kind: 'row', collection }) : scope;
      if (expression.where) assert(infer(expression.where, program, action, records, itemScope, depth + 1) === 'boolean', 'Aggregate predicates must be boolean.');
      if (expression.fn === 'count') assert(!expression.value, 'count counts rows and cannot select a value.');
      else {
        assert(expression.value, 'Numeric aggregates require a value expression.');
        assert(infer(expression.value, program, action, records, itemScope, depth + 1) === 'number', 'Numeric aggregates accept numbers only.');
      }
      return 'number';
    }
  }
}

function collectionType(expression: GenerativeExpression, program: TableProgram, action: TableAction | undefined, records: Records | undefined, scope: Scope, depth: number): string {
  assert(infer(expression, program, action, records, scope, depth) === 'rows', 'Collection operators require a collection or filtered record set.');
  if (expression.op === 'collection') return expression.id;
  if (expression.op === 'filter') return collectionType(expression.source, program, action, records, scope, depth + 1);
  fail('Collection operators require a collection or filtered record set.');
}

export function expressionWithinBounds(value: unknown): boolean {
  const pending: { value: unknown; parentDepth: number; exit?: true }[] = [{ value, parentDepth: 0 }];
  const active = new WeakSet<object>();
  let nodes = 0;
  let inspected = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current) break;
    if (current.exit) {
      if (current.value && typeof current.value === 'object') active.delete(current.value);
      continue;
    }
    if (Array.isArray(current.value)) {
      if (current.value.length > GENERATIVE_LIMITS.arrayItems) return false;
      if (active.has(current.value)) return false;
      if (++inspected > GENERATIVE_LIMITS.validationNodes) return false;
      active.add(current.value);
      pending.push({ value: current.value, parentDepth: current.parentDepth, exit: true });
      for (const item of current.value) pending.push({ value: item, parentDepth: current.parentDepth });
      continue;
    }
    if (!current.value || typeof current.value !== 'object') continue;
    if (active.has(current.value)) return false;
    if (++inspected > GENERATIVE_LIMITS.validationNodes) return false;
    const object = current.value as Record<string, unknown>;
    active.add(object);
    const isExpression = typeof object.op === 'string' && expressionOps.has(object.op);
    const depth = current.parentDepth + (isExpression ? 1 : 0);
    if (isExpression) nodes += 1;
    if (depth > GENERATIVE_LIMITS.expressionDepth || nodes > GENERATIVE_LIMITS.expressionNodes) return false;
    pending.push({ value: object, parentDepth: current.parentDepth, exit: true });
    for (const child of Object.values(object)) pending.push({ value: child, parentDepth: depth });
  }
  return true;
}

export function getGenerativeExpressionType(expression: GenerativeExpression, program: TableProgram, action?: TableAction, records?: Records, scope: Scope = new Map()): GenerativeStaticType {
  return infer(expression, program, action, records, scope, 1);
}

export function validateGenerativeExpression(expression: GenerativeExpression, program: TableProgram, action?: TableAction, records?: Records, scope: Scope = new Map()): string[] {
  if (!expressionWithinBounds(expression)) return ['Expression exceeds deterministic depth, node, or array limits.'];
  try { getGenerativeExpressionType(expression, program, action, records, scope); return []; }
  catch (error) { return [error instanceof Error ? error.message : 'Expression is invalid.']; }
}

function actionInputType(action: TableAction, parameter: string): GenerativeStaticType {
  return parameterType(action, parameter);
}
function compatibleFieldType(field: TableField, result: GenerativeStaticType, add: boolean): boolean {
  if (add) return field.type === 'number' && result === 'number';
  return field.type === result || result === 'null' && !field.required;
}
function assertControlBinding(action: TableAction, program: TableProgram, inputs: Record<string, ControlInputBinding>, records: Records | undefined, controlParameters: Readonly<Record<string, GenerativeStaticType>> = {}): void {
  assert(Object.keys(inputs).length === action.parameters.length && action.parameters.every(parameter => Object.hasOwn(inputs, parameter.id)), 'A control must bind every action input exactly once.');
  let controlCount = 0;
  for (const parameter of action.parameters) {
    const binding = inputs[parameter.id];
    // F048: only a control can collect a roll; a literal would let a program smuggle in a fixed value.
    assert(parameter.type !== 'roll' || binding.kind === 'control', 'A roll input must bind to a control.');
    if (binding.kind === 'control') {
      controlCount += 1;
      const expected = controlParameters[parameter.id];
      // F048: a roll parameter behaves as a number for its interactive control.
      const matches = parameter.type === expected
        || parameter.type === 'record' && expected === 'text'
        || parameter.type === 'roll' && expected === 'number';
      assert(expected && matches, 'A control input does not match its action parameter.');
    } else if (binding.kind === 'literal') {
      const expected = actionInputType(action, parameter.id);
      assert(isCompatible(expected, valueType(binding.value)), 'A literal control binding has the wrong value type.');
    } else if (binding.kind === 'expression') {
      const expressionIssues = validateGenerativeExpression(binding.value, program, undefined, records);
      assert(expressionIssues.length === 0, expressionIssues[0] ?? 'Control expression is invalid.');
      assert(isCompatible(actionInputType(action, parameter.id), getGenerativeExpressionType(binding.value, program, undefined, records)), 'An expression control binding has the wrong value type.');
    } else {
      assertRecordReference(records, binding.collection, binding.recordId);
      assert(parameter.type === 'record' && parameter.collection === binding.collection, 'A record control binding has the wrong collection.');
    }
  }
  assert(controlCount === Object.keys(controlParameters).length, 'A control must bind every interactive input exactly once.');
}

export function validateGenerativeProgram(program: TableProgram, records?: Records): string[] {
  const issues: string[] = [];
  const addIssue = (message: string) => { if (!issues.includes(message)) issues.push(message); };
  try {
    for (const action of program.actions) {
      for (const condition of action.conditions) {
        for (const operand of [condition.left, condition.right]) if ('expression' in operand) {
          const expressionIssues = validateGenerativeExpression(operand.expression, program, action, records);
          for (const issue of expressionIssues) addIssue(issue);
        }
      }
      for (const effect of action.effects) {
        if (!('expression' in effect.value)) continue;
        const expressionIssues = validateGenerativeExpression(effect.value.expression, program, action, records);
        for (const issue of expressionIssues) addIssue(issue);
        if (expressionIssues.length > 0) continue;
        const parameter = action.parameters.find(item => item.id === effect.record && item.type === 'record');
        const target = parameter?.collection && fieldFor(program, parameter.collection, effect.field);
        assert(target, 'An expression effect refers to an unknown target field.');
        const type = getGenerativeExpressionType(effect.value.expression, program, action, records);
        assert(compatibleFieldType(target, type, effect.op === 'add'), 'Expression effect result does not match its target field.');
      }
      for (const create of action.creates ?? []) {
        const collection = program.collections.find(item => item.id === create.collection);
        assert(collection, 'A create action refers to an unknown collection.');
        for (const [fieldId, operand] of Object.entries(create.values)) {
          if (!('expression' in operand)) continue;
          const expressionIssues = validateGenerativeExpression(operand.expression, program, action, records);
          for (const issue of expressionIssues) addIssue(issue);
          if (expressionIssues.length > 0) continue;
          const target = fieldFor(program, collection.id, fieldId);
          const type = getGenerativeExpressionType(operand.expression, program, action, records);
          assert(compatibleFieldType(target, type, false), 'Expression create result does not match its target field.');
        }
      }
    }
    const canvas = program.canvas;
    if (!canvas) return issues;
    assert(canvas.version === 1, 'Unsupported canvas descriptor version.');
    assert(canvas.views.length <= GENERATIVE_LIMITS.canvasViews, 'Canvas has too many views.');
    assert(2 + program.collections.length + program.actions.length + canvas.views.length <= GENERATIVE_LIMITS.manifestNodes, 'The generated canvas exceeds its manifest node limit.');
    const viewIds = canvas.views.map(view => view.id);
    assert(new Set(viewIds).size === viewIds.length, 'Canvas view identifiers must be unique.');
    const collectionIds = new Set(program.collections.map(collection => collection.id));
    const knownViewIds = new Set(viewIds);
    for (const view of canvas.views) {
      for (const relatedId of view.relatedTo?.views ?? []) assert(knownViewIds.has(relatedId), 'A view relates to an unknown view.');
      for (const relatedId of view.relatedTo?.collections ?? []) assert(collectionIds.has(relatedId), 'A view relates to an unknown collection.');
      if (view.kind === 'metric') {
        const expressionIssues = validateGenerativeExpression(view.value, program, undefined, records);
        for (const issue of expressionIssues) addIssue(issue);
        if (expressionIssues.length === 0) assert(isScalar(getGenerativeExpressionType(view.value, program, undefined, records)), 'Metric views must return a scalar.');
      }
      if (view.kind === 'chart') {
        const collection = program.collections.find(item => item.id === view.collection);
        assert(collection, 'Chart refers to an unknown collection.');
        const category = fieldFor(program, view.collection, view.categoryField);
        assert(category.type === 'text' || category.type === 'number', 'Chart categories must be text or numeric fields.');
        const scope = new Map<string, ScopeBinding>([['row', { kind: 'row', collection: view.collection }]]);
        const expressionIssues = validateGenerativeExpression(view.value, program, undefined, records, scope);
        for (const issue of expressionIssues) addIssue(issue);
        if (expressionIssues.length === 0) assert(getGenerativeExpressionType(view.value, program, undefined, records, scope) === 'number', 'Chart values must be numeric.');
      }
      if (view.kind === 'scene') {
        const elementIds = view.elements.map(element => element.id);
        assert(new Set(elementIds).size === elementIds.length, 'Scene element identifiers must be unique.');
        for (const element of view.elements) {
          for (const [key, value] of Object.entries(element)) {
            if (key === 'id' || key === 'shape' || key === 'fill' || key === 'stroke' || key === 'drag' || key === 'motion' || key === 'points' || key === 'text') continue;
            validateSceneValue(value, program, records, addIssue);
          }
          if (element.shape === 'polygon') for (const point of element.points) {
            validateSceneValue(point.x, program, records, addIssue); validateSceneValue(point.y, program, records, addIssue);
          }
          if (element.shape === 'text' && typeof element.text !== 'string') {
            const textIssues = validateGenerativeExpression(element.text, program, undefined, records);
            for (const issue of textIssues) addIssue(issue);
            if (textIssues.length === 0) assert(getGenerativeExpressionType(element.text, program, undefined, records) === 'text', 'Scene text expressions must return text.');
          }
          // F040: motion is an object, not a scene value expression, so it is validated here instead.
          const motion = element.shape === 'rect' || element.shape === 'circle' || element.shape === 'text' ? element.motion : undefined;
          if (motion) {
            assert(!element.drag, 'A scene element cannot both drag and move on its own.');
            validateSceneValue(motion.from, program, records, addIssue);
            validateSceneValue(motion.to, program, records, addIssue);
            validateSceneValue(motion.speed, program, records, addIssue);
            if (typeof motion.from === 'number' && typeof motion.to === 'number') assert(motion.from !== motion.to, 'Scene motion must travel between two different positions.');
            const staticSpeed = typeof motion.speed === 'number' ? motion.speed
              : motion.speed.op === 'literal' && typeof motion.speed.value === 'number' ? motion.speed.value : undefined;
            if (staticSpeed !== undefined) assert(staticSpeed > 0, 'Scene motion speed must be a positive number.');
          }
          if (element.drag) {
            const action = program.actions.find(item => item.id === element.drag?.actionId);
            assert(action, 'Scene drag refers to an unknown action.');
            const xParameter = action.parameters.find(item => item.id === element.drag?.xParameter);
            const yParameter = element.drag.yParameter ? action.parameters.find(item => item.id === element.drag?.yParameter) : undefined;
            assert(xParameter?.type === 'number' && (!element.drag.yParameter || yParameter?.type === 'number'), 'Scene drag coordinates must bind numeric action inputs.');
            const coordinateParameters: Record<string, GenerativeStaticType> = { [element.drag.xParameter]: 'number' };
            if (element.drag.yParameter) {
              assert(element.drag.yParameter !== element.drag.xParameter, 'Scene drag must bind separate coordinate inputs.');
              coordinateParameters[element.drag.yParameter] = 'number';
            }
            assertControlBinding(action, program, element.drag.inputs, records, coordinateParameters);
          }
        }
      }
      if (view.kind === 'controls') {
        const controlIds = view.controls.map(control => control.id);
        assert(new Set(controlIds).size === controlIds.length, 'Control identifiers must be unique within a view.');
        for (const control of view.controls) {
          const action = program.actions.find(item => item.id === control.actionId);
          assert(action, 'A control refers to an unknown action.');
          let interactiveType: GenerativeStaticType | undefined;
          if (control.kind === 'slider') {
            assert(control.min <= control.max && (control.step === undefined || control.step > 0), 'Slider bounds are invalid.');
            const parameter = action.parameters.find(item => item.id === control.parameter && item.type === 'number');
            assert(parameter && (parameter.min === undefined || control.min >= parameter.min) && (parameter.max === undefined || control.max <= parameter.max), 'Slider bounds exceed the action parameter bounds.');
            interactiveType = 'number';
          } else if (control.kind === 'toggle') {
            assert(action.parameters.some(item => item.id === control.parameter && item.type === 'boolean'), 'Toggle must bind a boolean action parameter.');
            interactiveType = 'boolean';
          } else if (control.kind === 'select') {
            const parameter = action.parameters.find(item => item.id === control.parameter);
            assert(parameter && parameter.type !== 'record' && parameter.type !== 'roll', 'Select must bind a scalar action parameter.');
            assert(control.options.every(option => actionInputType(action, control.parameter) === valueType(option.value) && (!parameter.choices || parameter.choices.includes(String(option.value)))), 'Select options do not match the action parameter.');
            interactiveType = actionInputType(action, control.parameter);
          } else if (control.kind === 'dice') {
            // F060: dice may bind a number parameter (client-side, visual-only) or a roll parameter
            // (the server rolls the program's roll spec). The card's own faces/count stay valid but
            // are not authoritative for a roll parameter.
            const parameter = action.parameters.find(item => item.id === control.parameter);
            assert(parameter && (parameter.type === 'number' || parameter.type === 'roll'), 'Dice must bind a number or roll action parameter.');
            const diceIssues = validateDiceSpec(control);
            assert(diceIssues.length === 0, diceIssues[0] ?? 'Dice control limits are invalid.');
            interactiveType = 'number';
          }
          const interactiveParameters: Record<string, GenerativeStaticType> = control.kind === 'form'
            ? Object.fromEntries(Object.entries(control.inputs).filter(([, binding]) => binding.kind === 'control').map(([parameter]) => [parameter, actionInputType(action, parameter)]))
            : interactiveType && 'parameter' in control ? { [control.parameter]: interactiveType } : {};
          assertControlBinding(action, program, control.inputs, records, interactiveParameters);
          if ('value' in control && control.value) {
            const expressionIssues = validateGenerativeExpression(control.value, program, undefined, records);
            for (const issue of expressionIssues) addIssue(issue);
            if (expressionIssues.length === 0 && 'parameter' in control) assert(isCompatible(actionInputType(action, control.parameter), getGenerativeExpressionType(control.value, program, undefined, records)), 'Control value expression has the wrong type.');
          }
        }
      }
    }
  } catch (error) { addIssue(error instanceof Error ? error.message : 'Generated table program is invalid.'); }
  return issues;
}

function validateSceneValue(value: unknown, program: TableProgram, records: Records | undefined, addIssue: (message: string) => void): void {
  if (typeof value === 'number') {
    assert(Number.isFinite(value) && Math.abs(value) <= GENERATIVE_LIMITS.numberMagnitude, 'Scene values must be finite bounded numbers.');
    return;
  }
  assert(value && typeof value === 'object' && 'op' in value, 'Scene geometry values must be numbers or expressions.');
  const expression = value as GenerativeExpression;
  const expressionIssues = validateGenerativeExpression(expression, program, undefined, records);
  for (const issue of expressionIssues) addIssue(issue);
  if (expressionIssues.length === 0) assert(getGenerativeExpressionType(expression, program, undefined, records) === 'number', 'Scene geometry expressions must return numbers.');
}
