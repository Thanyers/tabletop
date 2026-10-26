import { z } from 'zod';
import { jsonWithinBudget } from './json-budget';

/**
 * F080: a tool package is the immutable unit that AI and people author together.
 *
 * One package carries the UI source, the optional server-behavior source, typed data
 * ports, declared writes and an exact import set. It never carries live records,
 * grants, credentials or source-table identities: those stay with the workspace that
 * owns them and reach the package only as an authorized projection.
 *
 * This module is deliberately a leaf: it imports `zod` and `json-budget` only, so it can
 * be used by the client, the Node server, the Worker and the behaviour runner without
 * dragging in React, the database or any secret.
 */

/** Bumped when a stored package shape can no longer be read by this code. */
export const TOOL_PACKAGE_SCHEMA_VERSION = 1 as const;

/** The runtime profile a package declares; limits live with the platform, not the package. */
export const TOOL_PACKAGE_RUNTIME_PROFILE = 'tabletop-tool-1' as const;
export type ToolPackageRuntimeProfile = typeof TOOL_PACKAGE_RUNTIME_PROFILE;

/**
 * Bounds every package must satisfy. They are checked before compile and again before a
 * behaviour runs, so a package cannot grow past what the host measured at activation.
 */
export const TOOL_PACKAGE_LIMITS = {
  /** Files in one package (UI + behaviour + local helpers). */
  maxFiles: 12,
  /** Characters of one source file. */
  maxFileChars: 24_000,
  /** Characters across all source files. */
  maxPackageChars: 96_000,
  /** Declared data ports. */
  maxPorts: 8,
  /** Fields one records port may read. */
  maxPortFields: 24,
  /** Declared server behaviours. */
  maxBehaviors: 6,
  /** Inputs one behaviour accepts from the UI bridge. */
  maxBehaviorInputs: 8,
  /** Write declarations one behaviour may carry. */
  maxWritesPerBehavior: 12,
  /** Rows one write declaration may propose. */
  maxWriteRows: 200,
  /** Longest chain of relative imports starting at the entry file. */
  maxImportDepth: 4,
  /** Pinned bare imports one package may declare. */
  maxImports: 8,
  /** Instances one workspace may hold. */
  maxInstancesPerWorkspace: 24,
  /** Connections one collaboration space may hold. */
  maxConnectionsPerSpace: 16,
  /** Projections one connection may expose. */
  maxProjections: 8,
  /** Source actions one connection may expose. */
  maxActions: 8,
  maxTitleChars: 80,
  maxDescriptionChars: 400,
  maxConfigValueChars: 200,
  /** Identifier ceiling shared by ports, behaviours, inputs and files. */
  maxIdChars: 40,
} as const;

/**
 * The only bare specifiers a package may import, with the exact version the sandbox
 * provides. Adding a library is a platform change with a version, not a per-request
 * choice, and this list is a library allowlist — never a list of allowed use cases.
 */
export const TOOL_PACKAGE_PINNED_IMPORTS = {
  react: '19.3.0',
  'react/jsx-runtime': '19.3.0',
  'react-dom/client': '19.3.0',
  '@tabletop/tool-sdk': '1.0.0',
} as const;

export type ToolPinnedImport = keyof typeof TOOL_PACKAGE_PINNED_IMPORTS;

const ID_PATTERN = /^[a-z][a-z0-9-]{1,39}$/u;
const FILE_PATH_PATTERN = /^[a-z0-9][a-z0-9._-]{0,55}(?:\/[a-z0-9][a-z0-9._-]{0,55})*\.(?:tsx|ts|js)$/u;
const SPECIFIER_PATTERN = /^(?:\.\.?\/[a-z0-9._/-]+|@[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*|[a-z][a-z0-9-]*(?:\/[a-z][a-z0-9-]*)*)$/u;
const BLOCKED_IMPORT_PATTERN = /^(?:node:|bun:|cloudflare:|workerd:|https?:|data:|file:|\/)/u;

export interface ToolSourceFile {
  /** Package-relative path such as `ui/main.tsx`; never absolute, never `..`. */
  path: string;
  /** `tsx` for UI, `ts`/`js` for behaviour and helpers. */
  language: 'tsx' | 'ts' | 'js';
  text: string;
}

export type ToolPortKind = 'records' | 'number' | 'text' | 'boolean';

/**
 * A data port is the only way a package reaches data. `fields` is an allowlist of the
 * field ids a source grant may project; a package cannot read a field it did not declare.
 */
export interface ToolDataPort {
  id: string;
  label: string;
  direction: 'in' | 'out';
  kind: ToolPortKind;
  /** Required for `records`; must be empty for scalar ports. */
  fields: string[];
  /** Ceiling the authority clamps a subscription to. */
  maxRows: number;
}

/** A behaviour may only propose changes to what it declared here. */
export interface ToolWriteDeclaration {
  /** `self` = the workspace the instance lives in; otherwise the id of an `in` port bound to a connection. */
  target: 'self' | string;
  /** Collection (or table resource) inside that target. */
  resource: string;
  operations: ('create' | 'update' | 'delete')[];
  maxRows: number;
}

export interface ToolBehaviorInput {
  id: string;
  label: string;
  kind: Exclude<ToolPortKind, 'records'>;
  required: boolean;
}

export interface ToolBehavior {
  id: string;
  label: string;
  /** Exported function name inside the behaviour module. */
  entry: string;
  inputs: ToolBehaviorInput[];
  writes: ToolWriteDeclaration[];
}

/** How the source reached the package; the authority records who activated it separately. */
export interface ToolPackageProvenance {
  origin: 'human' | 'ai' | 'ai-human';
  /** Immediate predecessor version this one was derived from, when there is one. */
  baseContentHash?: string;
  /** Author attribution the workspace may show; never a credential or an email. */
  authorLabel?: string;
  createdAt: number;
}

export interface ToolPackageDefinition {
  schemaVersion: typeof TOOL_PACKAGE_SCHEMA_VERSION;
  /** Stable across versions of the same tool. */
  packageId: string;
  /** Monotonic per package; a downstream instance keeps the version it activated. */
  version: number;
  title: string;
  description: string;
  /** Path of the module the sandbox mounts. */
  uiEntry: string;
  /** Path of the module the behaviour runner loads; absent for a UI-only package. */
  behaviorEntry?: string;
  files: ToolSourceFile[];
  ports: ToolDataPort[];
  behaviors: ToolBehavior[];
  /** Bare specifier -> exact pinned version; must be a subset of the platform allowlist. */
  imports: Record<string, string>;
  runtimeProfile: ToolPackageRuntimeProfile;
  provenance: ToolPackageProvenance;
}

/** The immutable pointer an instance holds. A newer package version never moves an old instance. */
export interface ToolPackageRef {
  packageId: string;
  version: number;
  contentHash: string;
}

export interface ToolInstanceInput {
  /** Must match a declared port with direction `in`. */
  portId: string;
  /** `self` or the connection the port reads through. */
  source: 'self' | string;
  /** Logical source field -> package field. Stable ids only, never labels. */
  mapping: Record<string, string>;
}

/** What a workspace holds; local hover/selection/viewport never lives here. */
export interface ToolInstance {
  instanceId: string;
  /** The collaboration space or workspace that owns this instance. */
  spaceId: string;
  package: ToolPackageRef;
  inputs: ToolInstanceInput[];
  /** Portable configuration the author declared; never live data. */
  config: Record<string, string | number | boolean>;
  /** Monotonic per instance; written only by an authorized command. */
  revision: number;
}

export type ToolConnectionStatus = 'pending' | 'active' | 'revoked' | 'missing' | 'incompatible';

/**
 * A connection is held by the destination space but decided by the source: the source
 * workspace stamps the grant version and epoch, and the destination only keeps a
 * reference plus the projections it was allowed to read.
 */
export interface ToolConnection {
  connectionId: string;
  spaceId: string;
  sourceWorkspaceId: string;
  /** Source epoch the grant was issued under; a reset epoch invalidates the grant. */
  sourceEpoch: number;
  projections: {
    portId: string;
    resource: string;
    fields: string[];
    maxRows: number;
  }[];
  actions: { actionId: string }[];
  /** Default audience is the space members named in the grant; a new member is not added by default. */
  audience: { kind: 'space-members' } | { kind: 'actors'; actorIds: string[] };
  grantVersion: number;
  status: ToolConnectionStatus;
}

/** The aggregate a collaboration space stores for its shared tools. */
export interface ToolWorkspaceState {
  schemaVersion: typeof TOOL_PACKAGE_SCHEMA_VERSION;
  packages: ToolPackageDefinition[];
  instances: ToolInstance[];
  connections: ToolConnection[];
}

/* ------------------------------------------------------------------------------------------------
 * Wire schemas.
 * ---------------------------------------------------------------------------------------------- */

const idSchema = z.string().regex(ID_PATTERN, 'Use lowercase letters, digits and dashes, starting with a letter.');
const labelSchema = z.string().min(1).max(TOOL_PACKAGE_LIMITS.maxDescriptionChars);
const filePathSchema = z.string().min(5).max(64).regex(FILE_PATH_PATTERN, 'Use a package-relative path ending in .tsx, .ts or .js.');
const specifierSchema = z.string().min(1).max(80).regex(SPECIFIER_PATTERN, 'Use a relative path or a pinned bare specifier.');

export const toolSourceFileSchema: z.ZodType<ToolSourceFile> = z.strictObject({
  path: filePathSchema,
  language: z.enum(['tsx', 'ts', 'js']),
  text: z.string().min(1).max(TOOL_PACKAGE_LIMITS.maxFileChars),
});

export const toolDataPortSchema: z.ZodType<ToolDataPort> = z.strictObject({
  id: idSchema,
  label: labelSchema,
  direction: z.enum(['in', 'out']),
  kind: z.enum(['records', 'number', 'text', 'boolean']),
  fields: z.array(idSchema).max(TOOL_PACKAGE_LIMITS.maxPortFields),
  maxRows: z.number().int().nonnegative().max(TOOL_PACKAGE_LIMITS.maxWriteRows),
}).superRefine((port, context) => {
  if (port.kind === 'records' && port.fields.length === 0) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'A records port must declare the fields it reads.' });
  }
  if (port.kind !== 'records' && port.fields.length > 0) {
    context.addIssue({ code: 'custom', path: ['fields'], message: 'Only a records port declares fields.' });
  }
});

export const toolWriteDeclarationSchema: z.ZodType<ToolWriteDeclaration> = z.strictObject({
  target: z.union([z.literal('self'), idSchema]),
  resource: idSchema,
  operations: z.array(z.enum(['create', 'update', 'delete'])).min(1),
  maxRows: z.number().int().positive().max(TOOL_PACKAGE_LIMITS.maxWriteRows),
});

export const toolBehaviorSchema: z.ZodType<ToolBehavior> = z.strictObject({
  id: idSchema,
  label: labelSchema,
  entry: z.string().regex(/^[a-z][A-Za-z0-9]{0,39}$/u, 'Use an exported function name.'),
  inputs: z.array(z.strictObject({
    id: idSchema,
    label: labelSchema,
    kind: z.enum(['number', 'text', 'boolean']),
    required: z.boolean(),
  })).max(TOOL_PACKAGE_LIMITS.maxBehaviorInputs),
  writes: z.array(toolWriteDeclarationSchema).max(TOOL_PACKAGE_LIMITS.maxWritesPerBehavior),
});

export const toolPackageProvenanceSchema: z.ZodType<ToolPackageProvenance> = z.strictObject({
  origin: z.enum(['human', 'ai', 'ai-human']),
  baseContentHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  authorLabel: z.string().min(1).max(80).optional(),
  createdAt: z.number().int().nonnegative(),
});

export const toolPackageDefinitionSchema: z.ZodType<ToolPackageDefinition> = z.strictObject({
  schemaVersion: z.literal(TOOL_PACKAGE_SCHEMA_VERSION),
  packageId: idSchema,
  version: z.number().int().positive().max(10_000),
  title: z.string().min(1).max(TOOL_PACKAGE_LIMITS.maxTitleChars),
  description: z.string().max(TOOL_PACKAGE_LIMITS.maxDescriptionChars),
  uiEntry: filePathSchema,
  behaviorEntry: filePathSchema.optional(),
  files: z.array(toolSourceFileSchema).min(1).max(TOOL_PACKAGE_LIMITS.maxFiles),
  ports: z.array(toolDataPortSchema).max(TOOL_PACKAGE_LIMITS.maxPorts),
  behaviors: z.array(toolBehaviorSchema).max(TOOL_PACKAGE_LIMITS.maxBehaviors),
  imports: z.record(specifierSchema, z.string().min(1).max(20)),
  runtimeProfile: z.literal(TOOL_PACKAGE_RUNTIME_PROFILE),
  provenance: toolPackageProvenanceSchema,
});

export const toolPackageRefSchema: z.ZodType<ToolPackageRef> = z.strictObject({
  packageId: idSchema,
  version: z.number().int().positive(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
});

export const toolInstanceSchema: z.ZodType<ToolInstance> = z.strictObject({
  instanceId: idSchema,
  spaceId: idSchema,
  package: toolPackageRefSchema,
  inputs: z.array(z.strictObject({
    portId: idSchema,
    source: z.union([z.literal('self'), idSchema]),
    mapping: z.record(z.string().min(1).max(TOOL_PACKAGE_LIMITS.maxIdChars), idSchema),
  })).max(TOOL_PACKAGE_LIMITS.maxPorts),
  config: z.record(z.string().min(1).max(TOOL_PACKAGE_LIMITS.maxIdChars), z.union([
    z.string().max(TOOL_PACKAGE_LIMITS.maxConfigValueChars),
    z.number().finite(),
    z.boolean(),
  ])),
  revision: z.number().int().nonnegative(),
});

export const toolConnectionSchema: z.ZodType<ToolConnection> = z.strictObject({
  connectionId: idSchema,
  spaceId: idSchema,
  sourceWorkspaceId: z.string().uuid(),
  sourceEpoch: z.number().int().nonnegative(),
  projections: z.array(z.strictObject({
    portId: idSchema,
    resource: idSchema,
    fields: z.array(idSchema).min(1).max(TOOL_PACKAGE_LIMITS.maxPortFields),
    maxRows: z.number().int().positive().max(TOOL_PACKAGE_LIMITS.maxWriteRows),
  })).max(TOOL_PACKAGE_LIMITS.maxProjections),
  actions: z.array(z.strictObject({ actionId: idSchema })).max(TOOL_PACKAGE_LIMITS.maxActions),
  audience: z.union([
    z.strictObject({ kind: z.literal('space-members') }),
    z.strictObject({ kind: z.literal('actors'), actorIds: z.array(z.string().min(1).max(160)).min(1).max(64) }),
  ]),
  grantVersion: z.number().int().nonnegative(),
  status: z.enum(['pending', 'active', 'revoked', 'missing', 'incompatible']),
});

export const toolWorkspaceStateSchema: z.ZodType<ToolWorkspaceState> = z.strictObject({
  schemaVersion: z.literal(TOOL_PACKAGE_SCHEMA_VERSION),
  packages: z.array(toolPackageDefinitionSchema),
  instances: z.array(toolInstanceSchema).max(TOOL_PACKAGE_LIMITS.maxInstancesPerWorkspace),
  connections: z.array(toolConnectionSchema).max(TOOL_PACKAGE_LIMITS.maxConnectionsPerSpace),
});

/* ------------------------------------------------------------------------------------------------
 * Validation.
 * ---------------------------------------------------------------------------------------------- */

export type ToolPackageProblemCode =
  | 'PACKAGE_SCHEMA'
  | 'PACKAGE_BUDGET'
  | 'PACKAGE_FILE'
  | 'PACKAGE_ENTRY'
  | 'PACKAGE_IMPORT'
  | 'PACKAGE_CYCLE'
  | 'PACKAGE_PORT'
  | 'PACKAGE_BEHAVIOR'
  | 'PACKAGE_WRITE';

export interface ToolPackageProblem {
  code: ToolPackageProblemCode;
  /** Dotted location inside the package, for a diagnosable repair. */
  path: string;
  message: string;
}

export type ToolPackageValidation =
  | { ok: true; package: ToolPackageDefinition }
  | { ok: false; problems: ToolPackageProblem[] };

function zodProblems(error: z.ZodError, code: ToolPackageProblemCode): ToolPackageProblem[] {
  return error.issues.map(issue => ({
    code,
    path: issue.path.length ? issue.path.join('.') : 'package',
    message: issue.message,
  }));
}

/** Relative specifiers a file imports, in source order; used by the graph checks below. */
export function toolSourceImports(text: string): { specifier: string; kind: 'relative' | 'pinned' }[] {
  const found: { specifier: string; kind: 'relative' | 'pinned' }[] = [];
  const pattern = /(?:^|\n)\s*(?:import|export)\s[^;]*?from\s*['"]([^'"]+)['"]/gu;
  const sideEffect = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/gu;
  for (const match of text.matchAll(pattern)) {
    const specifier = match[1]!;
    found.push({ specifier, kind: specifier.startsWith('.') ? 'relative' : 'pinned' });
  }
  for (const match of text.matchAll(sideEffect)) {
    const specifier = match[1]!;
    found.push({ specifier, kind: specifier.startsWith('.') ? 'relative' : 'pinned' });
  }
  return found;
}

/** Resolve `./x` / `../y` from one package file to a declared file path, or `undefined`. */
export function resolveToolImport(fromPath: string, specifier: string, files: readonly ToolSourceFile[]): string | undefined {
  const base = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  const parts = (base ? `${base}/${specifier}` : specifier).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      if (stack.length === 0) return undefined;
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  const joined = stack.join('/');
  const candidates = [joined, `${joined}.ts`, `${joined}.tsx`, `${joined}.js`];
  return candidates.find(candidate => files.some(file => file.path === candidate));
}

/**
 * Budget check input.
 *
 * `jsonWithinBudget` exists to guard untrusted wire values and treats `undefined` as an
 * unusable value. A package definition is a TypeScript object where an omitted optional
 * field is often spelled `undefined`, so the probe runs on the JSON view of the value —
 * which is exactly what the store and the hash will see anyway.
 */
function inspectablePackage(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

/**
 * Full package check: schema, budget, entry points, pinned imports, relative import graph
 * (missing targets, cycles, depth) and cross declarations (ports used by behaviours and
 * write targets). A package that fails here must never reach compile or store.
 */
export function validateToolPackage(value: unknown): ToolPackageValidation {
  const problems: ToolPackageProblem[] = [];
  const inspectable = inspectablePackage(value);
  if (inspectable === undefined || !jsonWithinBudget(inspectable)) {
    return { ok: false, problems: [{ code: 'PACKAGE_BUDGET', path: 'package', message: 'The package is too deep or too large to inspect.' }] };
  }
  const parsed = toolPackageDefinitionSchema.safeParse(value);
  if (!parsed.success) return { ok: false, problems: zodProblems(parsed.error, 'PACKAGE_SCHEMA') };
  const definition = parsed.data;

  const totalChars = definition.files.reduce((sum, file) => sum + file.text.length, 0);
  if (totalChars > TOOL_PACKAGE_LIMITS.maxPackageChars) {
    problems.push({ code: 'PACKAGE_BUDGET', path: 'files', message: `Source exceeds ${TOOL_PACKAGE_LIMITS.maxPackageChars} characters.` });
  }

  const seenPaths = new Set<string>();
  for (const file of definition.files) {
    if (seenPaths.has(file.path)) problems.push({ code: 'PACKAGE_FILE', path: `files.${file.path}`, message: 'Duplicate file path.' });
    seenPaths.add(file.path);
    const expected = file.path.endsWith('.tsx') ? 'tsx' : file.path.endsWith('.ts') ? 'ts' : 'js';
    if (file.language !== expected) {
      problems.push({ code: 'PACKAGE_FILE', path: `files.${file.path}`, message: `Language must be ${expected} for this extension.` });
    }
  }

  const byPath = new Map(definition.files.map(file => [file.path, file]));
  const uiEntry = byPath.get(definition.uiEntry);
  if (!uiEntry) {
    problems.push({ code: 'PACKAGE_ENTRY', path: 'uiEntry', message: 'The UI entry must be one of the package files.' });
  } else if (uiEntry.language !== 'tsx') {
    problems.push({ code: 'PACKAGE_ENTRY', path: 'uiEntry', message: 'The UI entry must be a .tsx module.' });
  }
  if (definition.behaviorEntry) {
    const behaviorFile = byPath.get(definition.behaviorEntry);
    if (!behaviorFile) {
      problems.push({ code: 'PACKAGE_ENTRY', path: 'behaviorEntry', message: 'The behaviour entry must be one of the package files.' });
    } else if (behaviorFile.language === 'tsx') {
      problems.push({ code: 'PACKAGE_ENTRY', path: 'behaviorEntry', message: 'The behaviour entry must not be a .tsx module.' });
    } else {
      // The runner loads the behaviour as a single module inside the isolate, so a relative
      // import would resolve to nothing there. Refuse it here instead of failing at run time.
      const imports = toolSourceImports(behaviorFile.text);
      if (imports.length > 0) {
        problems.push({
          code: 'PACKAGE_BEHAVIOR',
          path: 'behaviorEntry',
          message: `The behaviour module must be self-contained; it imports ${imports.map(entry => entry.specifier).join(', ')}.`,
        });
      }
    }
  }
  if (definition.behaviors.length > 0 && !definition.behaviorEntry) {
    problems.push({ code: 'PACKAGE_BEHAVIOR', path: 'behaviors', message: 'Declared behaviours need a behaviour entry module.' });
  }
  if (definition.behaviorEntry && definition.behaviors.length === 0) {
    problems.push({ code: 'PACKAGE_BEHAVIOR', path: 'behaviorEntry', message: 'A behaviour entry without a declared behaviour is not activatable.' });
  }

  if (Object.keys(definition.imports).length > TOOL_PACKAGE_LIMITS.maxImports) {
    problems.push({ code: 'PACKAGE_IMPORT', path: 'imports', message: `At most ${TOOL_PACKAGE_LIMITS.maxImports} pinned imports.` });
  }
  for (const [specifier, version] of Object.entries(definition.imports)) {
    const pinned = TOOL_PACKAGE_PINNED_IMPORTS[specifier as ToolPinnedImport];
    if (!pinned) {
      problems.push({ code: 'PACKAGE_IMPORT', path: `imports.${specifier}`, message: 'This specifier is not provided by the sandbox.' });
    } else if (pinned !== version) {
      problems.push({ code: 'PACKAGE_IMPORT', path: `imports.${specifier}`, message: `The sandbox provides ${specifier}@${pinned}.` });
    }
  }

  const graph = new Map<string, string[]>();
  for (const file of definition.files) {
    const edges: string[] = [];
    for (const { specifier, kind } of toolSourceImports(file.text)) {
      if (BLOCKED_IMPORT_PATTERN.test(specifier)) {
        problems.push({ code: 'PACKAGE_IMPORT', path: `files.${file.path}`, message: `"${specifier}" cannot be imported by a package.` });
        continue;
      }
      if (kind === 'pinned') {
        if (!(specifier in definition.imports) && !(specifier in TOOL_PACKAGE_PINNED_IMPORTS)) {
          problems.push({ code: 'PACKAGE_IMPORT', path: `files.${file.path}`, message: `"${specifier}" is not declared in imports.` });
        }
        continue;
      }
      const target = resolveToolImport(file.path, specifier, definition.files);
      if (!target) {
        problems.push({ code: 'PACKAGE_IMPORT', path: `files.${file.path}`, message: `"${specifier}" does not resolve to a package file.` });
        continue;
      }
      edges.push(target);
    }
    graph.set(file.path, edges);
  }

  const visited = new Set<string>();
  const inStack = new Set<string>();
  const depth = new Map<string, number>();
  const walk = (path: string, level: number): void => {
    if (inStack.has(path)) {
      problems.push({ code: 'PACKAGE_CYCLE', path: `files.${path}`, message: 'Relative imports form a cycle.' });
      return;
    }
    if (level > TOOL_PACKAGE_LIMITS.maxImportDepth) {
      problems.push({ code: 'PACKAGE_IMPORT', path: `files.${path}`, message: `Import depth exceeds ${TOOL_PACKAGE_LIMITS.maxImportDepth}.` });
      return;
    }
    const known = depth.get(path);
    if (visited.has(path) && known !== undefined && known >= level) return;
    depth.set(path, level);
    inStack.add(path);
    for (const next of graph.get(path) ?? []) walk(next, level + 1);
    inStack.delete(path);
    visited.add(path);
  };
  if (byPath.has(definition.uiEntry)) walk(definition.uiEntry, 0);
  if (definition.behaviorEntry && byPath.has(definition.behaviorEntry)) walk(definition.behaviorEntry, 0);

  const portIds = new Set(definition.ports.map(port => port.id));
  if (portIds.size !== definition.ports.length) {
    problems.push({ code: 'PACKAGE_PORT', path: 'ports', message: 'Port ids must be unique.' });
  }
  const behaviorIds = new Set(definition.behaviors.map(behavior => behavior.id));
  if (behaviorIds.size !== definition.behaviors.length) {
    problems.push({ code: 'PACKAGE_BEHAVIOR', path: 'behaviors', message: 'Behaviour ids must be unique.' });
  }
  for (const behavior of definition.behaviors) {
    const inputIds = new Set(behavior.inputs.map(input => input.id));
    if (inputIds.size !== behavior.inputs.length) {
      problems.push({ code: 'PACKAGE_BEHAVIOR', path: `behaviors.${behavior.id}.inputs`, message: 'Input ids must be unique.' });
    }
    for (const write of behavior.writes) {
      if (write.target === 'self') continue;
      const targetPort = definition.ports.find(port => port.id === write.target);
      if (!targetPort) {
        problems.push({ code: 'PACKAGE_WRITE', path: `behaviors.${behavior.id}.writes`, message: `Write target "${write.target}" is not a declared port.` });
        continue;
      }
      // An `out` port carries results out of the package; writing through it would invert it.
      if (targetPort.direction !== 'in') {
        problems.push({ code: 'PACKAGE_WRITE', path: `behaviors.${behavior.id}.writes`, message: `Write target "${write.target}" must be an inbound port.` });
      }
    }
  }

  return problems.length > 0 ? { ok: false, problems } : { ok: true, package: definition };
}

/* ------------------------------------------------------------------------------------------------
 * Content hashing and references.
 * ---------------------------------------------------------------------------------------------- */

/** Stable JSON with sorted keys, so the same package always hashes the same way. */
export function canonicalJson(value: unknown): string {
  const encode = (current: unknown): string => {
    if (current === null || typeof current === 'number' || typeof current === 'boolean') return JSON.stringify(current);
    if (typeof current === 'string') return JSON.stringify(current);
    if (Array.isArray(current)) return `[${current.map(encode).join(',')}]`;
    if (typeof current === 'object') {
      const record = current as Record<string, unknown>;
      const keys = Object.keys(record).sort();
      return `{${keys.map(key => `${JSON.stringify(key)}:${encode(record[key])}`).join(',')}}`;
    }
    return 'null';
  };
  return encode(value);
}

/**
 * Content hash of the parts that define behaviour. Provenance and version are excluded, so
 * re-activating the same source twice produces the same hash and a diff stays meaningful.
 */
export function toolPackageContentHash(
  definition: ToolPackageDefinition,
  hash: (value: unknown) => string,
): string {
  return hash(canonicalJson({
    schemaVersion: definition.schemaVersion,
    packageId: definition.packageId,
    title: definition.title,
    description: definition.description,
    uiEntry: definition.uiEntry,
    behaviorEntry: definition.behaviorEntry ?? null,
    files: [...definition.files].sort((left, right) => left.path.localeCompare(right.path)),
    ports: definition.ports,
    behaviors: definition.behaviors,
    imports: definition.imports,
    runtimeProfile: definition.runtimeProfile,
  }));
}

export function toolPackageRef(definition: ToolPackageDefinition, hash: (value: unknown) => string): ToolPackageRef {
  return { packageId: definition.packageId, version: definition.version, contentHash: toolPackageContentHash(definition, hash) };
}

/** A reference matches only on all three parts: an old instance never silently follows a new version. */
export function sameToolPackageRef(left: ToolPackageRef, right: ToolPackageRef): boolean {
  return left.packageId === right.packageId && left.version === right.version && left.contentHash === right.contentHash;
}

/* ------------------------------------------------------------------------------------------------
 * Reader compatibility.
 * ---------------------------------------------------------------------------------------------- */

export interface ToolWorkspaceReadResult {
  state: ToolWorkspaceState;
  problems: ToolPackageProblem[];
}

/**
 * Read a stored aggregate without rejecting it for fields a newer version added.
 *
 * A workspace written before this feature has no tool state at all, and one written by a
 * newer build may carry fields this build does not know. Both must load: unknown top-level
 * keys are dropped, missing collections become empty, and a single unreadable entry is
 * reported and skipped instead of making the whole space unreadable.
 */
export function readToolWorkspace(value: unknown): ToolWorkspaceReadResult {
  const problems: ToolPackageProblem[] = [];
  const empty: ToolWorkspaceState = { schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION, packages: [], instances: [], connections: [] };
  if (value === undefined || value === null) return { state: empty, problems };
  if (typeof value !== 'object' || Array.isArray(value)) {
    problems.push({ code: 'PACKAGE_SCHEMA', path: 'state', message: 'Stored tool state is not an object.' });
    return { state: empty, problems };
  }
  const record = value as Record<string, unknown>;
  if (record.schemaVersion !== TOOL_PACKAGE_SCHEMA_VERSION) {
    if (typeof record.schemaVersion === 'number' && record.schemaVersion > TOOL_PACKAGE_SCHEMA_VERSION) {
      problems.push({ code: 'PACKAGE_SCHEMA', path: 'schemaVersion', message: 'This workspace was written by a newer tool schema.' });
    }
    return { state: empty, problems };
  }
  const readList = <T>(
    key: 'packages' | 'instances' | 'connections',
    schema: z.ZodType<T>,
    label: string,
  ): T[] => {
    const raw = record[key];
    if (raw === undefined) return [];
    if (!Array.isArray(raw)) {
      problems.push({ code: 'PACKAGE_SCHEMA', path: key, message: `Stored ${label} list is not an array.` });
      return [];
    }
    const kept: T[] = [];
    raw.forEach((entry, index) => {
      const parsed = schema.safeParse(entry);
      if (parsed.success) kept.push(parsed.data);
      else problems.push({ code: 'PACKAGE_SCHEMA', path: `${key}.${index}`, message: `Skipped an unreadable ${label} entry.` });
    });
    return kept;
  };
  return {
    state: {
      schemaVersion: TOOL_PACKAGE_SCHEMA_VERSION,
      packages: readList('packages', toolPackageDefinitionSchema, 'package'),
      instances: readList('instances', toolInstanceSchema, 'instance'),
      connections: readList('connections', toolConnectionSchema, 'connection'),
    },
    problems,
  };
}
