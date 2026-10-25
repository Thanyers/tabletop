import { compileToolPackage, type CompiledToolPackage } from './compile';
import {
  toolPackageContentHash,
  validateToolPackage,
  type ToolPackageDefinition,
  type ToolPackageProblem,
} from '../../shared/tool-package';

/**
 * F080 / C3: one authoring pipeline for both authors.
 *
 * A person editing source and a model drafting source go through exactly the same steps —
 * validate → compile → isolated trial → activate — and produce the same activation record with
 * the requester, the generator and the reviewer recorded separately. Nothing here calls a model
 * by itself: the generator is injected, so the pipeline is testable with a fixture and the live
 * provider can only be plugged in behind an enforceable budget.
 */

/** A hard cap checked *before* dispatch, so an over-budget request never leaves the process. */
export interface ToolAiBudget {
  maxCalls: number;
  maxUsd: number;
  usedCalls: number;
  usedUsd: number;
}

export interface ToolAiEstimate {
  calls: number;
  usd: number;
}

export type ToolAiBudgetDecision =
  | { ok: true; remaining: ToolAiEstimate }
  | { ok: false; code: 'TOOL_AI_BUDGET_EXCEEDED'; message: string; remaining: ToolAiEstimate };

export function checkToolAiBudget(budget: ToolAiBudget, estimate: ToolAiEstimate): ToolAiBudgetDecision {
  const remaining = { calls: budget.maxCalls - budget.usedCalls, usd: budget.maxUsd - budget.usedUsd };
  if (estimate.calls <= 0 || estimate.usd < 0) {
    return { ok: false, code: 'TOOL_AI_BUDGET_EXCEEDED', message: 'An estimate must ask for at least one call.', remaining };
  }
  if (estimate.calls > remaining.calls || estimate.usd > remaining.usd) {
    return {
      ok: false,
      code: 'TOOL_AI_BUDGET_EXCEEDED',
      message: `This run needs ${estimate.calls} calls / $${estimate.usd.toFixed(2)} but only ${Math.max(0, remaining.calls)} calls / $${Math.max(0, remaining.usd).toFixed(2)} remain.`,
      remaining,
    };
  }
  return { ok: true, remaining };
}

export interface ToolGeneratorRequest {
  prompt: string;
  /** The source the author is improving, when this is an iteration rather than a first draft. */
  base?: ToolPackageDefinition;
  /** Diagnostics from the previous attempt, so a repair has something concrete to fix. */
  problems?: ToolPackageProblem[];
}

export interface ToolGeneratorResult {
  definition: unknown;
  /** What the call actually cost; recorded so the budget reflects reality, not the estimate. */
  usage: ToolAiEstimate;
}

export interface ToolGenerator {
  /** Stable id recorded in the activation record, e.g. `fixture-1` or a provider name. */
  id: string;
  /** The pre-dispatch estimate for one attempt. */
  estimate(request: ToolGeneratorRequest): ToolAiEstimate;
  generate(request: ToolGeneratorRequest): Promise<ToolGeneratorResult>;
}

/** The isolated trial: the artifact must at least load and run once before it can activate. */
export type ToolTrial = (compiled: CompiledToolPackage) => Promise<{ ok: true } | { ok: false; problems: string[] }>;

export type ToolAuthorRoute =
  | { kind: 'human'; actorId: string; definition: unknown; baseContentHash?: string }
  | { kind: 'ai'; actorId: string; prompt: string; base?: ToolPackageDefinition; baseContentHash?: string };

export interface ToolAuthoringInput {
  route: ToolAuthorRoute;
  /** Reviewer attribution; `auto` means the activation policy's guards passed without a person. */
  reviewer: { kind: 'auto' | 'manual'; actorId?: string };
  /** Required for the AI route; the pipeline refuses to call a generator without a budget. */
  budget?: ToolAiBudget;
}

export interface ToolAuthoringDeps {
  /** Absent means this build cannot author with a model; the AI route then fails closed. */
  generator?: ToolGenerator;
  trial: ToolTrial;
  hash: (value: unknown) => string;
  now: number;
  /** Attempts allowed when the model returns something invalid. */
  maxRepairAttempts?: number;
}

export interface ToolActivationRecord {
  status: 'activated' | 'rejected';
  packageId?: string;
  version?: number;
  contentHash?: string;
  requesterActorId: string;
  generator: { kind: 'human' } | { kind: 'ai'; generatorId: string; calls: number; usd: number };
  reviewer: { kind: 'auto' | 'manual'; actorId?: string };
  problems: string[];
  reason?: string;
  recordedAt: number;
}

export type ToolAuthoringResult =
  | { ok: true; definition: ToolPackageDefinition; compiled: CompiledToolPackage; contentHash: string; record: ToolActivationRecord; attempts: number }
  | { ok: false; code: string; message: string; record: ToolActivationRecord; attempts: number };

function rejected(
  input: ToolAuthoringInput,
  deps: ToolAuthoringDeps,
  code: string,
  message: string,
  problems: string[],
  attempts: number,
  generator: ToolActivationRecord['generator'],
  packageInfo: { packageId?: string; version?: number; contentHash?: string } = {},
): ToolAuthoringResult {
  return {
    ok: false,
    code,
    message,
    attempts,
    record: {
      status: 'rejected',
      ...packageInfo,
      requesterActorId: input.route.actorId,
      generator,
      reviewer: input.reviewer,
      problems,
      reason: code,
      recordedAt: deps.now,
    },
  };
}

/**
 * Run the authoring pipeline.
 *
 * The AI route fails closed: with no generator, no budget, or an estimate over the remaining cap
 * it never dispatches. A failed trial or a failed validation never activates a half-package.
 */
export async function authorToolPackage(input: ToolAuthoringInput, deps: ToolAuthoringDeps): Promise<ToolAuthoringResult> {
  const maxAttempts = Math.max(1, deps.maxRepairAttempts ?? 2);
  let definition: unknown;
  let attempts = 0;
  let calls = 0;
  let usd = 0;
  let generatorRecord: ToolActivationRecord['generator'];
  let baseContentHash = input.route.baseContentHash;

  if (input.route.kind === 'human') {
    definition = input.route.definition;
    generatorRecord = { kind: 'human' };
  } else {
    const generator = deps.generator;
    if (!generator) {
      return rejected(input, deps, 'TOOL_AI_UNAVAILABLE', 'This build has no authoring generator configured.', [], 0, { kind: 'ai', generatorId: 'none', calls: 0, usd: 0 });
    }
    generatorRecord = { kind: 'ai', generatorId: generator.id, calls: 0, usd: 0 };
    if (!input.budget) {
      return rejected(input, deps, 'TOOL_AI_BUDGET_REQUIRED', 'An AI authoring run needs an approved call/cost budget.', [], 0, generatorRecord);
    }
    let problems: ToolPackageProblem[] | undefined;
    let base = input.route.base;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const request: ToolGeneratorRequest = { prompt: input.route.prompt, ...(base ? { base } : {}), ...(problems ? { problems } : {}) };
      const budget = checkToolAiBudget({ ...input.budget, usedCalls: input.budget.usedCalls + calls, usedUsd: input.budget.usedUsd + usd }, generator.estimate(request));
      if (!budget.ok) {
        return rejected(input, deps, budget.code, budget.message, [], attempts, { ...generatorRecord, calls, usd } as ToolActivationRecord['generator']);
      }
      attempts += 1;
      let result: ToolGeneratorResult;
      try {
        result = await generator.generate(request);
      } catch (error) {
        return rejected(input, deps, 'TOOL_AI_FAILED', error instanceof Error ? error.message : String(error), [], attempts, { kind: 'ai', generatorId: generator.id, calls, usd });
      }
      calls += result.usage.calls;
      usd += result.usage.usd;
      generatorRecord = { kind: 'ai', generatorId: generator.id, calls, usd };
      definition = result.definition;
      const validation = validateToolPackage(definition);
      if (validation.ok) break;
      problems = validation.problems;
      if (attempt < maxAttempts) base = undefined;
    }
    if (!definition) {
      return rejected(input, deps, 'TOOL_AI_EMPTY', 'The generator returned no package.', [], attempts, generatorRecord);
    }
  }

  const validation = validateToolPackage(definition);
  if (!validation.ok) {
    return rejected(input, deps, 'TOOL_PACKAGE_INVALID', 'The package failed validation.', validation.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`), attempts, generatorRecord);
  }
  const compiled = compileToolPackage(validation.package, deps.hash);
  if (!compiled.ok) {
    return rejected(input, deps, 'TOOL_COMPILE_FAILED', 'The package failed to compile.', compiled.problems.map(problem => `${problem.code} ${problem.path}: ${problem.message}`), attempts, generatorRecord);
  }
  const trial = await deps.trial(compiled.compiled);
  if (!trial.ok) {
    return rejected(input, deps, 'TOOL_TRIAL_FAILED', 'The package failed its isolated trial.', trial.problems, attempts, generatorRecord, {
      packageId: validation.package.packageId,
      version: validation.package.version,
      contentHash: compiled.compiled.contentHash,
    });
  }

  const contentHash = toolPackageContentHash(validation.package, deps.hash);
  if (baseContentHash !== undefined && contentHash === baseContentHash) {
    return rejected(input, deps, 'TOOL_NO_CHANGE', 'The new source is identical to the version it started from.', [], attempts, generatorRecord, {
      packageId: validation.package.packageId,
      version: validation.package.version,
      contentHash,
    });
  }
  return {
    ok: true,
    definition: validation.package,
    compiled: compiled.compiled,
    contentHash,
    attempts,
    record: {
      status: 'activated',
      packageId: validation.package.packageId,
      version: validation.package.version,
      contentHash,
      requesterActorId: input.route.actorId,
      generator: generatorRecord,
      reviewer: input.reviewer,
      problems: [],
      recordedAt: deps.now,
    },
  };
}
