import { transform } from 'sucrase';
import {
  TOOL_PACKAGE_LIMITS,
  resolveToolImport,
  toolPackageContentHash,
  toolSourceImports,
  validateToolPackage,
  type ToolPackageDefinition,
  type ToolSourceFile,
} from '../../shared/tool-package';

/**
 * F080: the compile step between authored source and runnable modules.
 *
 * The transform is a pure-JS compiler (Sucrase) rather than a native binary, so the same code
 * runs in the browser, the Node server and a Cloudflare Worker: local, staging and production
 * compile a package identically instead of only the machine that happened to author it.
 *
 * The output is still treated as untrusted. Compiling proves the source parses, not that it is
 * safe: the sandbox, the bridge allowlist and the authority checks are what bound it.
 */

export const TOOL_COMPILE_LIMITS = {
  /** Characters of one compiled module. */
  maxModuleChars: 160_000,
  /** Characters of all compiled modules together. */
  maxTotalChars: 400_000,
} as const;

export type ToolCompileProblemCode =
  | 'TOOL_COMPILE_SOURCE'
  | 'TOOL_COMPILE_FAILED'
  | 'TOOL_COMPILE_ENTRY'
  | 'TOOL_COMPILE_LIMIT';

export interface ToolCompileProblem {
  code: ToolCompileProblemCode;
  path: string;
  message: string;
}

export interface CompiledToolPackage {
  packageId: string;
  version: number;
  contentHash: string;
  /** UI module path -> CommonJS module text the frame registry can load. */
  modules: Record<string, string>;
  /** Package path of the module the frame mounts. */
  uiEntry: string;
  /**
   * The behaviour module as ESM, because the runner loads it through the isolate's own module
   * graph (`import fn from './module.js'`). Absent for a UI-only package.
   */
  behaviorModule?: string;
  /** Behaviour id -> the export the runner calls inside the behaviour module. */
  behaviorExports: Record<string, string>;
  imports: Record<string, string>;
}

export type ToolCompileResult =
  | { ok: true; compiled: CompiledToolPackage }
  | { ok: false; problems: ToolCompileProblem[] };

function compileModule(file: ToolSourceFile, mode: 'ui' | 'behavior'): string {
  const transforms: ('typescript' | 'jsx' | 'imports')[] = [];
  if (file.language !== 'js') transforms.push('typescript');
  if (file.language === 'tsx') transforms.push('jsx');
  // The frame registry loads CommonJS text; the isolate needs real ESM.
  if (mode === 'ui') transforms.push('imports');
  return transform(file.text, {
    transforms,
    jsxRuntime: 'automatic',
    jsxImportSource: 'react',
    production: true,
    disableESTransforms: true,
    filePath: file.path,
  }).code;
}

/** Files the frame can reach from the UI entry through relative imports, in stable order. */
function uiReachableFiles(definition: ToolPackageDefinition): ToolSourceFile[] {
  const byPath = new Map(definition.files.map(file => [file.path, file]));
  const reachable = new Set<string>();
  const pending = [definition.uiEntry];
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (reachable.has(path)) continue;
    const file = byPath.get(path);
    if (!file) continue;
    reachable.add(path);
    for (const { specifier, kind } of toolSourceImports(file.text)) {
      if (kind !== 'relative') continue;
      const target = resolveToolImport(file.path, specifier, definition.files);
      if (target) pending.push(target);
    }
  }
  return definition.files.filter(file => reachable.has(file.path));
}

/**
 * Compile a validated package.
 *
 * A package that fails validation is never compiled, so the compiler is not the first thing
 * that sees an out-of-scope write or an unpinned import.
 */
export function compileToolPackage(
  definition: ToolPackageDefinition,
  hash: (value: unknown) => string,
): ToolCompileResult {
  const validation = validateToolPackage(definition);
  if (!validation.ok) {
    return {
      ok: false,
      problems: validation.problems.map(problem => ({
        code: 'TOOL_COMPILE_SOURCE',
        path: problem.path,
        message: problem.message,
      })),
    };
  }

  const problems: ToolCompileProblem[] = [];
  const modules: Record<string, string> = {};
  let total = 0;

  for (const file of uiReachableFiles(definition)) {
    let output: string;
    try {
      output = compileModule(file, 'ui');
    } catch (error) {
      problems.push({ code: 'TOOL_COMPILE_FAILED', path: file.path, message: describeCompileError(error) });
      continue;
    }
    if (output.length > TOOL_COMPILE_LIMITS.maxModuleChars) {
      problems.push({ code: 'TOOL_COMPILE_LIMIT', path: file.path, message: 'The compiled module exceeds the per-module limit.' });
      continue;
    }
    modules[file.path] = output;
    total += output.length;
  }

  if (!modules[definition.uiEntry]) {
    problems.push({ code: 'TOOL_COMPILE_ENTRY', path: definition.uiEntry, message: 'The UI entry did not produce a module.' });
  }
  if (total > TOOL_COMPILE_LIMITS.maxTotalChars) {
    problems.push({ code: 'TOOL_COMPILE_LIMIT', path: 'modules', message: 'The compiled package exceeds the total limit.' });
  }

  let behaviorModule: string | undefined;
  const behaviorFile = definition.behaviorEntry
    ? definition.files.find(file => file.path === definition.behaviorEntry)
    : undefined;
  if (behaviorFile) {
    try {
      behaviorModule = compileModule(behaviorFile, 'behavior');
      if (behaviorModule.length > TOOL_COMPILE_LIMITS.maxModuleChars) {
        problems.push({ code: 'TOOL_COMPILE_LIMIT', path: behaviorFile.path, message: 'The compiled behaviour module exceeds the per-module limit.' });
      }
    } catch (error) {
      problems.push({ code: 'TOOL_COMPILE_FAILED', path: behaviorFile.path, message: describeCompileError(error) });
    }
  }

  if (problems.length > 0) return { ok: false, problems };

  return {
    ok: true,
    compiled: {
      packageId: definition.packageId,
      version: definition.version,
      contentHash: toolPackageContentHash(definition, hash),
      modules,
      uiEntry: definition.uiEntry,
      behaviorModule,
      behaviorExports: Object.fromEntries(definition.behaviors.map(behavior => [behavior.id, behavior.entry])),
      imports: definition.imports,
    },
  };
}

function describeCompileError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > TOOL_PACKAGE_LIMITS.maxDescriptionChars
    ? `${message.slice(0, TOOL_PACKAGE_LIMITS.maxDescriptionChars)}…`
    : message;
}
