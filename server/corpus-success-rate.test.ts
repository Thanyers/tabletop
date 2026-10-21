import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DeepSeekChangeProvider, RejectedChangeReply } from '../server/providers/deepseek-changes';
import { FALLBACK_REPAIR_ATTEMPT, FALLBACK_SIMPLIFY_ISSUES, nextRepairIssues } from '../cloudflare/repair';
import { DomainError } from '../src/tabletop/shared/contracts';
import { createTableState, tableChangeIssues } from '../src/tabletop/domain/table';
import type { TableChange } from '../src/tabletop/shared/table-contracts';

type Expectation = 'draft' | 'clarify';
interface CorpusCase { id: string; prompt: string; expect: Expectation }

const KEY = process.env.TABLE_CORPUS_KEY ?? '';
const corpus = JSON.parse(readFileSync(new URL('../tests/corpus/table-prompts.json', import.meta.url), 'utf8')) as { cases: CorpusCase[] };
const MAX_ATTEMPTS = 4;

type Outcome = 'draft' | 'clarify' | 'reject' | 'error';

interface CaseResult { id: string; expect: Expectation; outcome: Outcome; attempts: number; ms: number; detail: string }

async function runCase(testCase: CorpusCase): Promise<CaseResult> {
  const state = createTableState();
  let input: Parameters<DeepSeekChangeProvider['propose']>[0] = { kind: 'table', prompt: testCase.prompt, sources: [], program: null, turn: null };
  let previousIssues: string[] = [];
  const startedAt = Date.now();
  let lastIssue = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const provider = new DeepSeekChangeProvider({ apiKey: KEY, timeoutMs: 55_000 });
    let issues: string[] = [];
    let previousOutput: string | undefined;
    try {
      const result = await provider.propose(input, new AbortController().signal);
      if ('clarification' in result) {
        return { id: testCase.id, expect: testCase.expect, outcome: 'clarify', attempts: attempt, ms: Date.now() - startedAt, detail: result.clarification.question };
      }
      const change = result.change as TableChange;
      issues = tableChangeIssues(state, change).slice(0, 4);
      if (!issues.length) {
        return { id: testCase.id, expect: testCase.expect, outcome: 'draft', attempts: attempt, ms: Date.now() - startedAt, detail: change.program.collections.map((collection) => collection.id).join(',') };
      }
      previousOutput = JSON.stringify(change).slice(0, 18_000);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'MODEL_PROVIDER_INPUT_TOO_LARGE' && input.repair?.previousOutput) {
        input = { ...input, repair: { ...input.repair, previousOutput: input.repair.previousOutput.slice(0, Math.floor(input.repair.previousOutput.length / 2)) } };
        attempt -= 1;
        continue;
      }
      if (!(error instanceof RejectedChangeReply)) {
        return { id: testCase.id, expect: testCase.expect, outcome: 'error', attempts: attempt, ms: Date.now() - startedAt, detail: error instanceof Error ? error.message : String(error) };
      }
      issues = error.issues.slice(0, 4);
      previousOutput = error.previousOutput;
    }
    lastIssue = issues[0] ?? lastIssue;
    if (attempt === MAX_ATTEMPTS) break;
    if (attempt === MAX_ATTEMPTS - 1) {
      input = { ...input, repair: { attempt: FALLBACK_REPAIR_ATTEMPT, issues: [...FALLBACK_SIMPLIFY_ISSUES] } };
    } else {
      const repairIssues = nextRepairIssues(previousIssues, issues);
      previousIssues = issues;
      input = { ...input, repair: { attempt: (attempt + 1) as 2 | 3, issues: repairIssues, ...(previousOutput ? { previousOutput } : {}) } };
    }
  }
  return { id: testCase.id, expect: testCase.expect, outcome: 'reject', attempts: MAX_ATTEMPTS, ms: Date.now() - startedAt, detail: lastIssue };
}

describe.skipIf(!KEY)('golden corpus success rate (F029)', () => {
  it('measures draft/clarify/reject rates over the golden prompts', async () => {
    const results: CaseResult[] = [];
    for (const testCase of corpus.cases) results.push(await runCase(testCase));
    const counts = {
      draft: results.filter((result) => result.outcome === 'draft').length,
      clarify: results.filter((result) => result.outcome === 'clarify').length,
      reject: results.filter((result) => result.outcome === 'reject').length,
      error: results.filter((result) => result.outcome === 'error').length,
    };
    const matched = results.filter((result) => result.outcome === result.expect).length;
    const outDir = 'test-results/corpus';
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const reportPath = `${outDir}/corpus-${stamp}.md`;
    const lines = [
      `# Corpus success rate — ${new Date().toISOString()}`,
      '',
      `- cases: ${results.length} · matched expectation: **${matched}/${results.length}**`,
      `- draft: ${counts.draft} · clarify: ${counts.clarify} · reject: ${counts.reject} · error: ${counts.error}`,
      '',
      '| id | expect | outcome | attempts | ms | detail |',
      '| --- | --- | --- | --- | --- | --- |',
      ...results.map((result) => `| ${result.id} | ${result.expect} | ${result.outcome}${result.outcome === result.expect ? '' : ' ⚠️'} | ${result.attempts} | ${result.ms} | ${result.detail.replaceAll('|', '/').slice(0, 160)} |`),
      '',
    ];
    writeFileSync(reportPath, lines.join('\n'));
    console.log(`CORPUS summary ${JSON.stringify({ ...counts, matched, total: results.length })}`);
    for (const result of results) console.log(`CORPUS ${result.id}: ${result.outcome} (expect ${result.expect}) attempts=${result.attempts} ${result.ms}ms`);
    console.log(`CORPUS report ${reportPath}`);
    expect(results).toHaveLength(corpus.cases.length);
  }, 1_800_000);
});
