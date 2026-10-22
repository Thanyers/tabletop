import type { TableValue } from './table-contracts';

export const GENERATIVE_LIMITS = {
  expressionDepth: 32,
  expressionNodes: 512,
  validationNodes: 32_768,
  evaluationFuel: 10_000,
  arrayItems: 200,
  outputBytes: 16 * 1024,
  numberMagnitude: 1_000_000_000,
  canvasViews: 12,
  sceneElements: 128,
  scenePoints: 64,
  controlsPerView: 24,
  chartPoints: 200,
  manifestNodes: 24,
} as const;
export const GENERATIVE_FORBIDDEN_IDENTIFIERS = [
  'constructor', 'prototype', '__proto__', 'toString', 'toLocaleString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__',
  '__defineSetter__', '__lookupGetter__', '__lookupSetter__',
] as const;

export type GenerativeScalar = string | number | boolean | null;
export type GenerativeOutput = GenerativeScalar | readonly GenerativeScalar[];

export type GenerativeExpression =
  | { op: 'literal'; value: TableValue }
  | { op: 'input'; id: string }
  | { op: 'selectedField'; parameter: string; field: string }
  | { op: 'recordField'; collection: string; recordId: string; field: string }
  | { op: 'system'; value: 'actor' | 'seat' | 'turn' }
  | { op: 'variable'; name: string }
  | { op: 'field'; record: string; field: string }
  | { op: 'collection'; id: string }
  | { op: 'if'; test: GenerativeExpression; then: GenerativeExpression; otherwise: GenerativeExpression }
  | { op: 'math'; fn: 'add' | 'subtract' | 'multiply' | 'divide' | 'remainder' | 'power' | 'min' | 'max' | 'abs' | 'sqrt' | 'sin' | 'cos' | 'tan' | 'asin' | 'acos' | 'atan' | 'floor' | 'ceil' | 'round'; args: GenerativeExpression[] }
  | { op: 'compare'; fn: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains'; left: GenerativeExpression; right: GenerativeExpression }
  | { op: 'logic'; fn: 'and' | 'or'; values: GenerativeExpression[] }
  | { op: 'not'; value: GenerativeExpression }
  | { op: 'map'; source: GenerativeExpression; as: string; value: GenerativeExpression }
  | { op: 'filter'; source: GenerativeExpression; as: string; where: GenerativeExpression }
  | { op: 'reduce'; source: GenerativeExpression; as: string; accumulator: string; initial: GenerativeExpression; value: GenerativeExpression }
  | { op: 'aggregate'; source: GenerativeExpression; fn: 'count' | 'sum' | 'mean' | 'min' | 'max'; as?: string; where?: GenerativeExpression; value?: GenerativeExpression };

export type SceneValue = number | GenerativeExpression;
export interface ScenePoint { x: SceneValue; y: SceneValue }
interface ScenePaint { fill?: string; stroke?: string; strokeWidth?: SceneValue }
export interface SceneDragBinding { actionId: string; xParameter: string; yParameter?: string; inputs: Record<string, ControlInputBinding> }
/** F040: the host animates this axis from `from` to `to` at `speed` scene units per second. */
export interface SceneMotion {
  axis: 'x' | 'y';
  from: SceneValue;
  to: SceneValue;
  /** Scene units per second; must evaluate to a positive number to move. */
  speed: SceneValue;
  /** Defaults to true; false stops at `to`. */
  loop?: boolean;
}
interface SceneInteraction { drag?: SceneDragBinding }
interface MovableSceneInteraction extends SceneInteraction { motion?: SceneMotion }
interface ViewRelations { relatedTo?: { views?: string[]; collections?: string[] } }
export type ScenePrimitive =
  | ({ id: string; shape: 'rect'; x: SceneValue; y: SceneValue; width: SceneValue; height: SceneValue; rx?: SceneValue } & ScenePaint & MovableSceneInteraction)
  | ({ id: string; shape: 'circle'; cx: SceneValue; cy: SceneValue; r: SceneValue } & ScenePaint & MovableSceneInteraction)
  | ({ id: string; shape: 'line'; x1: SceneValue; y1: SceneValue; x2: SceneValue; y2: SceneValue } & Pick<ScenePaint, 'stroke' | 'strokeWidth'> & SceneInteraction)
  | ({ id: string; shape: 'polygon'; points: ScenePoint[] } & ScenePaint & SceneInteraction)
  | ({ id: string; shape: 'text'; x: SceneValue; y: SceneValue; text: string | GenerativeExpression; fontSize?: SceneValue } & Pick<ScenePaint, 'fill' | 'stroke'> & MovableSceneInteraction);

export interface SceneViewDescriptor extends ViewRelations { id: string; kind: 'scene'; title: string; width: number; height: number; elements: ScenePrimitive[] }
export interface ChartViewDescriptor extends ViewRelations { id: string; kind: 'chart'; title: string; chart: 'bar' | 'line' | 'scatter'; collection: string; categoryField: string; value: GenerativeExpression; color?: string }
export interface MetricViewDescriptor extends ViewRelations { id: string; kind: 'metric'; title: string; value: GenerativeExpression; format?: 'number' | 'percent' | 'text' }

export type ControlInputBinding =
  | { kind: 'control' }
  | { kind: 'literal'; value: TableValue }
  | { kind: 'expression'; value: GenerativeExpression }
  | { kind: 'record'; collection: string; recordId: string };
interface BoundTableAction { actionId: string; inputs: Record<string, ControlInputBinding> }
export type ControlDescriptor =
  | ({ id: string; kind: 'button'; label: string } & BoundTableAction)
  | ({ id: string; kind: 'form'; label: string } & BoundTableAction)
  | ({ id: string; kind: 'slider'; label: string; parameter: string; min: number; max: number; step?: number; value?: GenerativeExpression } & BoundTableAction)
  | ({ id: string; kind: 'toggle'; label: string; parameter: string; value?: GenerativeExpression } & BoundTableAction)
  | ({ id: string; kind: 'select'; label: string; parameter: string; options: { label: string; value: string | number | boolean }[]; value?: GenerativeExpression } & BoundTableAction)
  /**
   * F049/F050: visual dice. Bound to a `number` parameter it rolls {count}d{faces}+modifier on the
   * client and is visual-only. Bound to a `roll` parameter it shows the program's roll spec and the
   * server roll; the control's own faces/count must stay valid but are never authoritative.
   */
  | ({ id: string; kind: 'dice'; label: string; parameter: string; faces: number; count: number; modifier?: number } & BoundTableAction);
export interface ControlsViewDescriptor extends ViewRelations { id: string; kind: 'controls'; title: string; controls: ControlDescriptor[] }
export type GenerativeViewDescriptor = SceneViewDescriptor | ChartViewDescriptor | MetricViewDescriptor | ControlsViewDescriptor;
export interface GenerativeCanvas { version: 1; views: GenerativeViewDescriptor[] }
