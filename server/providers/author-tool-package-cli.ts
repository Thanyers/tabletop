/**
 * F080 / G1-01 + EDIT-01: one real authoring run against the DeepSeek account.
 *
 *   DEEPSEEK_KEY=... npx tsx server/providers/author-tool-package-cli.ts "a room planner that shows which rooms are free"
 *   ... --base <file.json>   continue from a package a person already edited
 *
 * The key comes from the environment and is never printed. The run reports the calls and the cost it
 * actually used, so the approved cap (3 runs x <=6 calls, <=USD 0.20 per run) can be checked afterwards.
 */

import { readFileSync } from 'node:fs';
import { validateToolPackage } from '../../src/tabletop/shared/tool-package.js';
import { DeepSeekToolPackageGenerator, ToolPackageGenerationFailed } from './deepseek-tool-package.js';

const MAX_CALLS_PER_RUN = 6;
const MAX_USD_PER_RUN = 0.2;

function usage(): string {
  return 'usage: npx tsx server/providers/author-tool-package-cli.ts "<intent>" [--base <package.json>] [--json <out.json>]';
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const intent = argv.find(argument => !argument.startsWith('--') && argv[argv.indexOf(argument) - 1] !== '--base' && argv[argv.indexOf(argument) - 1] !== '--json');
  const baseIndex = argv.indexOf('--base');
  const outIndex = argv.indexOf('--json');
  if (!intent) {
    console.error(usage());
    return 2;
  }

  const apiKey = process.env.DEEPSEEK_KEY ?? '';
  if (!apiKey) {
    console.error('DEEPSEEK_KEY is not set; the run would fail closed. Set it in the environment (never commit it).');
    return 2;
  }

  const generator = new DeepSeekToolPackageGenerator({ apiKey });
  const estimate = generator.estimate();
  if (estimate.calls > MAX_CALLS_PER_RUN || estimate.usd > MAX_USD_PER_RUN) {
    console.error(`estimate exceeds the approved cap: ${JSON.stringify(estimate)}`);
    return 2;
  }

  const base = baseIndex >= 0 ? readFileSync(argv[baseIndex + 1], 'utf8') : undefined;
  try {
    const result = await generator.generate({ intent, base });
    const validation = validateToolPackage(result.definition);
    if (!validation.ok) {
      console.error('the model reply is not a valid tool package:');
      for (const problem of validation.problems ?? []) console.error(`  - ${typeof problem === 'string' ? problem : JSON.stringify(problem)}`);
      console.error(`usage so far: ${JSON.stringify(result.usage)}`);
      return 1;
    }
    if (outIndex >= 0) {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(argv[outIndex + 1], `${JSON.stringify(result.definition, null, 2)}\n`, 'utf8');
    }
    const summary = {
      packageId: validation.definition?.packageId ?? null,
      version: validation.definition?.version ?? null,
      files: validation.definition?.files?.length ?? 0,
      behaviours: validation.definition?.behaviors?.length ?? 0,
      ports: validation.definition?.ports?.length ?? 0,
      calls: result.usage.calls,
      usd: result.usage.usd,
      promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens,
      withinCap: result.usage.calls <= MAX_CALLS_PER_RUN && result.usage.usd <= MAX_USD_PER_RUN,
    };
    console.log(JSON.stringify(summary, null, 2));
    return summary.withinCap ? 0 : 1;
  } catch (error) {
    if (error instanceof ToolPackageGenerationFailed) {
      console.error(`generation failed: ${error.code} - ${error.message}`);
      return 1;
    }
    throw error;
  }
}

process.exitCode = await main();
