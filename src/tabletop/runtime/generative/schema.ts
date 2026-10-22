import { z } from 'zod';
import { GENERATIVE_FORBIDDEN_IDENTIFIERS, GENERATIVE_LIMITS, type ControlDescriptor, type GenerativeCanvas, type GenerativeExpression, type GenerativeViewDescriptor, type ScenePrimitive } from '../../shared/generative-contracts';
import { DICE_LIMITS } from '../../shared/dice';
import type { TableValue } from '../../shared/table-contracts';

const forbiddenIdentifiers = new Set<string>(GENERATIVE_FORBIDDEN_IDENTIFIERS);
export const generativeIdSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,39}$/).refine(value => !forbiddenIdentifiers.has(value));
const safeText = z.string().min(1).max(500);
export const tableValueSchema: z.ZodType<TableValue> = z.union([
  z.string().max(500),
  z.number().finite().min(-GENERATIVE_LIMITS.numberMagnitude).max(GENERATIVE_LIMITS.numberMagnitude),
  z.boolean(),
  z.null(),
  z.array(z.string().max(100)).max(GENERATIVE_LIMITS.arrayItems),
]);

export const generativeExpressionSchema: z.ZodType<GenerativeExpression> = z.lazy(() => z.union([
  z.strictObject({ op: z.literal('literal'), value: tableValueSchema }),
  z.strictObject({ op: z.literal('input'), id: generativeIdSchema }),
  z.strictObject({ op: z.literal('selectedField'), parameter: generativeIdSchema, field: generativeIdSchema }),
  z.strictObject({ op: z.literal('recordField'), collection: generativeIdSchema, recordId: generativeIdSchema, field: generativeIdSchema }),
  z.strictObject({ op: z.literal('system'), value: z.enum(['actor', 'seat', 'turn']) }),
  z.strictObject({ op: z.literal('variable'), name: generativeIdSchema }),
  z.strictObject({ op: z.literal('field'), record: generativeIdSchema, field: generativeIdSchema }),
  z.strictObject({ op: z.literal('collection'), id: generativeIdSchema }),
  z.strictObject({ op: z.literal('if'), test: generativeExpressionSchema, then: generativeExpressionSchema, otherwise: generativeExpressionSchema }),
  z.strictObject({
    op: z.literal('math'),
    fn: z.enum(['add', 'subtract', 'multiply', 'divide', 'remainder', 'power', 'min', 'max', 'abs', 'sqrt', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'floor', 'ceil', 'round']),
    args: z.array(generativeExpressionSchema).min(1).max(GENERATIVE_LIMITS.arrayItems),
  }),
  z.strictObject({ op: z.literal('compare'), fn: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains']), left: generativeExpressionSchema, right: generativeExpressionSchema }),
  z.strictObject({ op: z.literal('logic'), fn: z.enum(['and', 'or']), values: z.array(generativeExpressionSchema).min(1).max(GENERATIVE_LIMITS.arrayItems) }),
  z.strictObject({ op: z.literal('not'), value: generativeExpressionSchema }),
  z.strictObject({ op: z.literal('map'), source: generativeExpressionSchema, as: generativeIdSchema, value: generativeExpressionSchema }),
  z.strictObject({ op: z.literal('filter'), source: generativeExpressionSchema, as: generativeIdSchema, where: generativeExpressionSchema }),
  z.strictObject({ op: z.literal('reduce'), source: generativeExpressionSchema, as: generativeIdSchema, accumulator: generativeIdSchema, initial: generativeExpressionSchema, value: generativeExpressionSchema }),
  z.strictObject({ op: z.literal('aggregate'), source: generativeExpressionSchema, fn: z.enum(['count', 'sum', 'mean', 'min', 'max']), as: generativeIdSchema.optional(), where: generativeExpressionSchema.optional(), value: generativeExpressionSchema.optional() }),
]));

export const generativeSceneValueSchema = z.union([
  z.number().finite().min(-GENERATIVE_LIMITS.numberMagnitude).max(GENERATIVE_LIMITS.numberMagnitude),
  generativeExpressionSchema,
]);
export const generativePaintSchema = z.string().regex(/^(none|#[0-9a-fA-F]{3,8})$/);
const pointSchema = z.strictObject({ x: generativeSceneValueSchema, y: generativeSceneValueSchema });
const bindingSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('control') }),
  z.strictObject({ kind: z.literal('literal'), value: tableValueSchema }),
  z.strictObject({ kind: z.literal('expression'), value: generativeExpressionSchema }),
  z.strictObject({ kind: z.literal('record'), collection: generativeIdSchema, recordId: generativeIdSchema }),
]);
const inputBindingsSchema = z.record(generativeIdSchema, bindingSchema);
const dragSchema = z.strictObject({ actionId: generativeIdSchema, xParameter: generativeIdSchema, yParameter: generativeIdSchema.optional(), inputs: inputBindingsSchema });
const motionSchema = z.strictObject({
  axis: z.enum(['x', 'y']),
  from: generativeSceneValueSchema,
  to: generativeSceneValueSchema,
  speed: generativeSceneValueSchema,
  loop: z.boolean().optional(),
});
const scenePaint = { fill: generativePaintSchema.optional(), stroke: generativePaintSchema.optional(), strokeWidth: generativeSceneValueSchema.optional() };
const sceneInteraction = { drag: dragSchema.optional() };
const movableSceneInteraction = { drag: dragSchema.optional(), motion: motionSchema.optional() };
export const scenePrimitiveSchema: z.ZodType<ScenePrimitive> = z.discriminatedUnion('shape', [
  z.strictObject({ id: generativeIdSchema, shape: z.literal('rect'), x: generativeSceneValueSchema, y: generativeSceneValueSchema, width: generativeSceneValueSchema, height: generativeSceneValueSchema, rx: generativeSceneValueSchema.optional(), ...scenePaint, ...movableSceneInteraction }),
  z.strictObject({ id: generativeIdSchema, shape: z.literal('circle'), cx: generativeSceneValueSchema, cy: generativeSceneValueSchema, r: generativeSceneValueSchema, ...scenePaint, ...movableSceneInteraction }),
  z.strictObject({ id: generativeIdSchema, shape: z.literal('line'), x1: generativeSceneValueSchema, y1: generativeSceneValueSchema, x2: generativeSceneValueSchema, y2: generativeSceneValueSchema, stroke: generativePaintSchema.optional(), strokeWidth: generativeSceneValueSchema.optional(), ...sceneInteraction }),
  z.strictObject({ id: generativeIdSchema, shape: z.literal('polygon'), points: z.array(pointSchema).min(3).max(GENERATIVE_LIMITS.scenePoints), ...scenePaint, ...sceneInteraction }),
  z.strictObject({ id: generativeIdSchema, shape: z.literal('text'), x: generativeSceneValueSchema, y: generativeSceneValueSchema, text: z.union([safeText, generativeExpressionSchema]), fontSize: generativeSceneValueSchema.optional(), fill: generativePaintSchema.optional(), stroke: generativePaintSchema.optional(), ...movableSceneInteraction }),
]);

const relationsSchema = z.strictObject({ views: z.array(generativeIdSchema).max(GENERATIVE_LIMITS.canvasViews).optional(), collections: z.array(generativeIdSchema).max(6).optional() }).optional();
const controlBase = { id: generativeIdSchema, label: safeText, actionId: generativeIdSchema, inputs: inputBindingsSchema };
export const controlDescriptorSchema: z.ZodType<ControlDescriptor> = z.discriminatedUnion('kind', [
  z.strictObject({ ...controlBase, kind: z.literal('button') }),
  z.strictObject({ ...controlBase, kind: z.literal('form') }),
  z.strictObject({ ...controlBase, kind: z.literal('slider'), parameter: generativeIdSchema, min: z.number().finite().min(-GENERATIVE_LIMITS.numberMagnitude).max(GENERATIVE_LIMITS.numberMagnitude), max: z.number().finite().min(-GENERATIVE_LIMITS.numberMagnitude).max(GENERATIVE_LIMITS.numberMagnitude), step: z.number().finite().positive().max(GENERATIVE_LIMITS.numberMagnitude).optional(), value: generativeExpressionSchema.optional() }),
  z.strictObject({ ...controlBase, kind: z.literal('toggle'), parameter: generativeIdSchema, value: generativeExpressionSchema.optional() }),
  z.strictObject({ ...controlBase, kind: z.literal('select'), parameter: generativeIdSchema, options: z.array(z.strictObject({ label: safeText, value: z.union([z.string().max(500), z.number().finite(), z.boolean()]) })).min(1).max(32), value: generativeExpressionSchema.optional() }),
  // F049: dice is additive; programs written before it existed still parse because they never use this branch.
  z.strictObject({ ...controlBase, kind: z.literal('dice'), parameter: generativeIdSchema, faces: z.number().int().min(DICE_LIMITS.minFaces).max(DICE_LIMITS.maxFaces), count: z.number().int().min(DICE_LIMITS.minCount).max(DICE_LIMITS.maxCount), modifier: z.number().int().min(-DICE_LIMITS.maxModifier).max(DICE_LIMITS.maxModifier).optional() }),
]);
export const generativeViewDescriptorSchema: z.ZodType<GenerativeViewDescriptor> = z.discriminatedUnion('kind', [
  z.strictObject({ id: generativeIdSchema, kind: z.literal('scene'), title: safeText, width: z.number().finite().positive().max(4096), height: z.number().finite().positive().max(4096), elements: z.array(scenePrimitiveSchema).max(GENERATIVE_LIMITS.sceneElements), relatedTo: relationsSchema }),
  z.strictObject({ id: generativeIdSchema, kind: z.literal('chart'), title: safeText, chart: z.enum(['bar', 'line', 'scatter']), collection: generativeIdSchema, categoryField: generativeIdSchema, value: generativeExpressionSchema, color: generativePaintSchema.optional(), relatedTo: relationsSchema }),
  z.strictObject({ id: generativeIdSchema, kind: z.literal('metric'), title: safeText, value: generativeExpressionSchema, format: z.enum(['number', 'percent', 'text']).optional(), relatedTo: relationsSchema }),
  z.strictObject({ id: generativeIdSchema, kind: z.literal('controls'), title: safeText, controls: z.array(controlDescriptorSchema).max(GENERATIVE_LIMITS.controlsPerView), relatedTo: relationsSchema }),
]);
export const generativeCanvasSchema: z.ZodType<GenerativeCanvas> = z.strictObject({ version: z.literal(1), views: z.array(generativeViewDescriptorSchema).max(GENERATIVE_LIMITS.canvasViews) });
