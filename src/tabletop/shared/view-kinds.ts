import type { GenerativeViewDescriptor } from './generative-contracts';

/**
 * The built-in Canvas view kinds. `GenerativeViewDescriptor` in
 * `generative-contracts.ts` stays the source of truth: this module only reads it
 * with `import type`, so it stays a leaf with no runtime imports and no zod.
 */
export type GenerativeViewKind = GenerativeViewDescriptor['kind'];

/** Layout roles the Canvas already places (a subset of `CanvasLayoutRole` in `ui/canvas-layout.ts`). */
export type GenerativeViewLayoutRole = 'scene' | 'control' | 'result';

export interface GenerativeViewKindMetadata {
  /** How the Canvas places the plan node for this kind. */
  readonly layoutRole: GenerativeViewLayoutRole;
  /** The plan node cannot be evaluated until its collection rows are resolved. */
  readonly needsRows: boolean;
  /** The plan node cannot be evaluated until the program's actions are resolved. */
  readonly needsActions: boolean;
}

/**
 * One entry per kind. `satisfies` a mapped type over the union, so adding a kind
 * to `GenerativeViewDescriptor` without an entry here fails to compile, and an
 * entry that is not a kind is rejected as an excess property.
 */
export const GENERATIVE_VIEW_KIND_METADATA = {
  scene: { layoutRole: 'scene', needsRows: false, needsActions: false },
  chart: { layoutRole: 'result', needsRows: true, needsActions: false },
  metric: { layoutRole: 'result', needsRows: false, needsActions: false },
  controls: { layoutRole: 'control', needsRows: false, needsActions: true },
} as const satisfies { readonly [K in GenerativeViewKind]: GenerativeViewKindMetadata };

/** Capability-id prefix of the plan node for a built-in view kind: `table.generated-view.<kind>`. */
export const GENERATIVE_VIEW_CAPABILITY_PREFIX = 'table.generated-view.';

function isGenerativeViewKind(value: string): value is GenerativeViewKind {
  return Object.hasOwn(GENERATIVE_VIEW_KIND_METADATA, value);
}

/** The registered kind behind a capability id, or `undefined` for any other capability. */
export function generativeViewKindForCapability(capability: string): GenerativeViewKind | undefined {
  if (!capability.startsWith(GENERATIVE_VIEW_CAPABILITY_PREFIX)) return undefined;
  const kind = capability.slice(GENERATIVE_VIEW_CAPABILITY_PREFIX.length);
  return isGenerativeViewKind(kind) ? kind : undefined;
}

/** Every registered kind in declaration order; derived from the metadata, never duplicated. */
export const GENERATIVE_VIEW_KINDS: readonly GenerativeViewKind[] = Object.keys(GENERATIVE_VIEW_KIND_METADATA).filter(isGenerativeViewKind);

export function generativeViewKindMetadata(kind: GenerativeViewKind): GenerativeViewKindMetadata {
  return GENERATIVE_VIEW_KIND_METADATA[kind];
}

/** "Scene, chart, metric and controls" — shared prose for capability/summary layers. */
export function generativeViewKindListSentence(): string {
  const names: string[] = [...GENERATIVE_VIEW_KINDS];
  if (names.length === 0) return '';
  const list = names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return list.charAt(0).toUpperCase() + list.slice(1);
}

/**
 * Compile-time exhaustiveness guard. A dispatch that misses a kind passes the
 * unhandled value here and fails to compile instead of falling through.
 */
export function assertNeverViewKind(value: never): never {
  throw new Error(`Unregistered canvas view kind: ${String(value)}`);
}
