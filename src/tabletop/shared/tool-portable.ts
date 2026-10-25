import {
  toolPackageContentHash,
  toolPackageRef,
  validateToolPackage,
  type ToolPackageDefinition,
  type ToolPackageRef,
  type ToolPackageRuntimeProfile,
} from './tool-package';

/**
 * F080 / JT-5: moving a tool to another room.
 *
 * A portable bundle carries *definitions*: source, ports, behaviours, pinned imports, the runtime
 * profile and the input mapping. It deliberately carries no records, members, chats, credentials,
 * source links or grants — copying a tool never copies access, and the receiving room still has to
 * be given a connection by each source it reads.
 *
 * Import is a trust boundary like any other: the bundle is re-validated and its content hash is
 * checked, so an edited bundle cannot smuggle source past validation or pass itself off as a
 * different version.
 */

export const PORTABLE_TOOL_SCHEMA_VERSION = 1 as const;

export interface PortableInputMapping {
  portId: string;
  /** The field id the package declares. */
  packageField: string;
  /** The field id in the receiving table that should feed it. */
  localField: string;
}

export interface PortableToolBundle {
  schemaVersion: typeof PORTABLE_TOOL_SCHEMA_VERSION;
  exportedAt: number;
  /** Definitions only; contains no records and no access. */
  package: ToolPackageDefinition;
  ref: ToolPackageRef;
  runtimeProfile: ToolPackageRuntimeProfile;
  mapping: PortableInputMapping[];
  config: Record<string, string | number | boolean>;
}

export type PortableExportResult =
  | { ok: true; bundle: PortableToolBundle }
  | { ok: false; code: 'PACKAGE_INVALID' | 'PACKAGE_MAPPING_INVALID'; problems: string[] };

export type PortableImportResult =
  | { ok: true; definition: ToolPackageDefinition; ref: ToolPackageRef; mapping: PortableInputMapping[] }
  | { ok: false; code: 'BUNDLE_SCHEMA' | 'PACKAGE_INVALID' | 'BUNDLE_HASH_MISMATCH' | 'BUNDLE_VERSION'; problems: string[] };

export interface PortableExportInput {
  definition: unknown;
  hash: (value: unknown) => string;
  exportedAt: number;
  /** Local field ids, keyed by package port then package field. */
  localFields?: Record<string, Record<string, string>>;
  config?: Record<string, string | number | boolean>;
}

/** Build a bundle from a package, keeping only what is portable. */
export function exportPortableTool(input: PortableExportInput): PortableExportResult {
  const validation = validateToolPackage(input.definition);
  if (!validation.ok) {
    return { ok: false, code: 'PACKAGE_INVALID', problems: validation.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`) };
  }
  const definition = validation.package;
  const mapping: PortableInputMapping[] = [];
  for (const port of definition.ports) {
    if (port.direction !== 'in') continue;
    for (const field of port.fields) {
      const localField = input.localFields?.[port.id]?.[field];
      if (localField !== undefined && !/^[a-z][a-z0-9-]{1,39}$/u.test(localField)) {
        return { ok: false, code: 'PACKAGE_MAPPING_INVALID', problems: [`The local field "${localField}" for ${port.id}.${field} is not a field id.`] };
      }
      mapping.push({ portId: port.id, packageField: field, localField: localField ?? field });
    }
  }
  return {
    ok: true,
    bundle: {
      schemaVersion: PORTABLE_TOOL_SCHEMA_VERSION,
      exportedAt: input.exportedAt,
      package: definition,
      ref: toolPackageRef(definition, input.hash),
      runtimeProfile: definition.runtimeProfile,
      mapping,
      config: { ...(input.config ?? {}) },
    },
  };
}

/**
 * Read a bundle back.
 *
 * The hash is recomputed from the definition, so a bundle whose source was edited after export is
 * refused instead of importing something the exporter never approved. A newer bundle version is
 * refused rather than guessed at.
 */
export function importPortableTool(bundle: unknown, hash: (value: unknown) => string): PortableImportResult {
  const record = bundle as Partial<Record<'schemaVersion' | 'package' | 'ref' | 'mapping' | 'runtimeProfile' | 'config', unknown>> | null;
  if (!record || typeof record !== 'object') return { ok: false, code: 'BUNDLE_SCHEMA', problems: ['The bundle is not an object.'] };
  if (record.schemaVersion !== PORTABLE_TOOL_SCHEMA_VERSION) {
    return {
      ok: false,
      code: record.schemaVersion === undefined ? 'BUNDLE_SCHEMA' : 'BUNDLE_VERSION',
      problems: [`This bundle uses schema version ${String(record.schemaVersion)}; this build reads ${PORTABLE_TOOL_SCHEMA_VERSION}.`],
    };
  }
  const validation = validateToolPackage(record.package);
  if (!validation.ok) {
    return { ok: false, code: 'PACKAGE_INVALID', problems: validation.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`) };
  }
  const definition = validation.package;
  const ref = record.ref as Partial<ToolPackageRef> | undefined;
  const expected = toolPackageContentHash(definition, hash);
  if (!ref || ref.contentHash !== expected || ref.packageId !== definition.packageId || ref.version !== definition.version) {
    return { ok: false, code: 'BUNDLE_HASH_MISMATCH', problems: ['The bundle does not match its own content hash.'] };
  }
  const mappingRaw = Array.isArray(record.mapping) ? record.mapping : [];
  const mapping: PortableInputMapping[] = [];
  for (const entry of mappingRaw) {
    const item = entry as Partial<PortableInputMapping>;
    if (typeof item.portId !== 'string' || typeof item.packageField !== 'string' || typeof item.localField !== 'string') {
      return { ok: false, code: 'BUNDLE_SCHEMA', problems: ['The input mapping is malformed.'] };
    }
    mapping.push({ portId: item.portId, packageField: item.packageField, localField: item.localField });
  }
  return { ok: true, definition, ref: { packageId: definition.packageId, version: definition.version, contentHash: expected }, mapping };
}

/** Keys a portable bundle must never carry, checked by the export test and by any reviewer. */
export const PORTABLE_FORBIDDEN_KEYS = ['records', 'rows', 'members', 'invites', 'grants', 'spaceGrants', 'credentials', 'token', 'cursor'] as const;
