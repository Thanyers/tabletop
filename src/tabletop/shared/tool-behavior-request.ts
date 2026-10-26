import type { ToolPackageDefinition, ToolWriteDeclaration } from './tool-package';
import {
  type ToolBehaviorInputValue,
  type ToolBehaviorRequest,
  type ToolBehaviorResourceSchemaMap,
} from './tool-behavior';

/**
 * F080: building a behaviour request from the package, not from the caller.
 *
 * The runner contract already takes `declaredWrites`, which means a caller could hand it a wider
 * scope than the package declares. This module is the only supported way to build a request: it
 * reads the declarations out of the validated package, binds the requested behaviour id to its
 * own export, and refuses inputs the behaviour did not declare.
 */

export type ToolBehaviorRequestRejection =
  | 'TOOL_UNKNOWN_BEHAVIOR'
  | 'TOOL_BEHAVIOR_INPUT_INVALID'
  | 'TOOL_NOT_ACTIVATED';

export type ToolBehaviorRequestBuild =
  | { ok: true; request: ToolBehaviorRequest }
  | { ok: false; code: ToolBehaviorRequestRejection; message: string };

export interface BuildToolBehaviorRequestInput {
  /** The validated package the instance points at. */
  package: ToolPackageDefinition;
  /** The compiled artifact for that exact package version. */
  compiled: { behaviorModule?: string; behaviorExports: Record<string, string>; contentHash: string };
  behaviorId: string;
  /** Untrusted values from the frame; they are checked against the declaration below. */
  inputs: Record<string, unknown>;
  /** Field allowlists the authority resolved for the resources this behaviour may write. */
  resourceSchema: ToolBehaviorResourceSchemaMap;
  /** The revisions the authority authorized at request time. */
  expected: { instanceRevision: number; grantVersion: number };
}

function coerceInput(kind: 'number' | 'text' | 'boolean', value: unknown): ToolBehaviorInputValue | undefined {
  if (kind === 'text') return typeof value === 'string' ? value : undefined;
  if (typeof value === 'number') return kind === 'number' && Number.isFinite(value) ? value : undefined;
  if (typeof value === 'boolean') return kind === 'boolean' ? value : undefined;
  return undefined;
}

export function buildToolBehaviorRequest(input: BuildToolBehaviorRequestInput): ToolBehaviorRequestBuild {
  const behavior = input.package.behaviors.find(entry => entry.id === input.behaviorId);
  if (!behavior) {
    return { ok: false, code: 'TOOL_UNKNOWN_BEHAVIOR', message: `The package does not declare a behaviour "${input.behaviorId}".` };
  }
  const moduleSource = input.compiled.behaviorModule;
  const exportName = input.compiled.behaviorExports[behavior.id] ?? behavior.entry;
  if (!moduleSource || !exportName) {
    return { ok: false, code: 'TOOL_NOT_ACTIVATED', message: 'This package version has no compiled behaviour to run.' };
  }

  const values: Record<string, ToolBehaviorInputValue> = {};
  for (const declared of behavior.inputs) {
    const raw = input.inputs[declared.id];
    if (raw === undefined) {
      if (declared.required) return { ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID', message: `"${declared.id}" is required.` };
      continue;
    }
    const coerced = coerceInput(declared.kind, raw);
    if (coerced === undefined) {
      return { ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID', message: `"${declared.id}" must be a ${declared.kind}.` };
    }
    values[declared.id] = coerced;
  }
  for (const key of Object.keys(input.inputs)) {
    if (!behavior.inputs.some(declared => declared.id === key)) {
      return { ok: false, code: 'TOOL_BEHAVIOR_INPUT_INVALID', message: `"${key}" is not a declared input.` };
    }
  }

  const declaredWrites: ToolWriteDeclaration[] = behavior.writes.map(write => ({ ...write, operations: [...write.operations] }));
  return {
    ok: true,
    request: {
      packageId: input.package.packageId,
      packageVersion: input.package.version,
      contentHash: input.compiled.contentHash,
      runtimeProfile: input.package.runtimeProfile,
      moduleSource,
      entry: exportName,
      inputs: values,
      declaredWrites,
      resourceSchema: input.resourceSchema,
      expected: { ...input.expected },
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Freshness: the revisions and grants the authority authorized must still be the live ones.
 * ---------------------------------------------------------------------------------------------- */

export type ToolBehaviorFreshnessCode = 'TOOL_STALE_REVISION' | 'TOOL_SOURCE_REVOKED';

export interface ToolConnectionEstate {
  /** The port the request reads through, and whether that source is still usable. */
  portId: string;
  status: 'live' | 'stale' | 'missing' | 'revoked';
}

export type ToolBehaviorFreshness =
  | { ok: true }
  | { ok: false; code: ToolBehaviorFreshnessCode; message: string };

/**
 * Compare the authorized revisions with the live ones.
 *
 * This is deliberately not "re-read then write anyway": a moved instance revision, a moved grant
 * version, or a source that became missing or revoked means the operation must be refused before
 * any side effect, so the caller never commits on top of a decision it no longer holds.
 */
export function checkToolBehaviorFreshness(
  request: Pick<ToolBehaviorRequest, 'expected'>,
  live: { instanceRevision: number; grantVersion: number; sources: readonly ToolConnectionEstate[] },
): ToolBehaviorFreshness {
  if (live.instanceRevision !== request.expected.instanceRevision) {
    return { ok: false, code: 'TOOL_STALE_REVISION', message: `The instance moved to revision ${live.instanceRevision}.` };
  }
  if (live.grantVersion !== request.expected.grantVersion) {
    return { ok: false, code: 'TOOL_STALE_REVISION', message: `The connection grant moved to version ${live.grantVersion}.` };
  }
  for (const source of live.sources) {
    if (source.status === 'revoked') {
      return { ok: false, code: 'TOOL_SOURCE_REVOKED', message: `The source for "${source.portId}" was revoked.` };
    }
    if (source.status === 'missing') {
      return { ok: false, code: 'TOOL_SOURCE_REVOKED', message: `The source for "${source.portId}" is no longer connected.` };
    }
    if (source.status === 'stale') {
      return { ok: false, code: 'TOOL_STALE_REVISION', message: `The source for "${source.portId}" moved since it was read.` };
    }
  }
  return { ok: true };
}
