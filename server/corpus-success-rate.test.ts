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

const ROUNDS = Math.min(5, Math.max(1, Number.parseInt(process.env.TABLE_CORPUS_ROUNDS ?? '1', 10) || 1));

interface RoundSummary { draft: number; clarify: number; reject: number; error: number; matched: number; total: number }

function summarize(results: CaseResult[]): RoundSummary {
  return {
    draft: results.filter((result) => result.outcome === 'draft').length,
    clarify: results.filter((result) => result.outcome === 'clarify').length,
    reject: results.filter((result) => result.outcome === 'reject').length,
    error: results.filter((result) => result.outcome === 'error').length,
    matched: results.filter((result) => result.outcome === result.expect).length,
    total: results.length,
  };
}

describe.skipIf(!KEY)('golden corpus success rate (F029/F030)', () => {
  it(`measures ${ROUNDS} round(s) of draft/clarify/reject and per-case stability`, async () => {
    const rounds: CaseResult[][] = [];
    for (let round = 1; round <= ROUNDS; round += 1) {
      const results: CaseResult[] = [];
      for (const testCase of corpus.cases) results.push(await runCase(testCase));
      rounds.push(results);
      console.log(`CORPUS round ${round}/${ROUNDS} ${JSON.stringify(summarize(results))}`);
      for (const result of results) console.log(`CORPUS ${result.id}: ${result.outcome} (expect ${result.expect}) attempts=${result.attempts} ${result.ms}ms`);
    }
    const all = rounds.flat();
    const totals = summarize(all);
    const stability = corpus.cases.map((testCase) => {
      const hits = all.filter((result) => result.id === testCase.id);
      const outcomes = [...new Set(hits.map((result) => result.outcome))];
      const matches = hits.filter((result) => result.outcome === result.expect).length;
      return { id: testCase.id, expect: testCase.expect, outcomes, stable: outcomes.length === 1, matchRate: Math.round(100 * matches / hits.length) };
    });
    const outDir = 'test-results/corpus';
    mkdirSync(outDir, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(':', '-');
    const reportPath = `${outDir}/corpus-${stamp}.md`;
    const lines = [
      `# Corpus success rate — ${new Date().toISOString()} (${ROUNDS} round${ROUNDS === 1 ? '' : 's'})`,
      '',
      `- cases per round: ${corpus.cases.length} · rounds: ${ROUNDS}`,
      `- matched: **${totals.matched}/${totals.total}** (${Math.round(100 * totals.matched / totals.total)}%)`,
      `- draft: ${totals.draft} · clarify: ${totals.clarify} · reject: ${totals.reject} · error: ${totals.error}`,
      '',
      '## Per round',
      '',
      '| round | draft | clarify | reject | error | matched |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rounds.map((results, index) => {
        const summary = summarize(results);
        return `| r${index + 1} | ${summary.draft} | ${summary.clarify} | ${summary.reject} | ${summary.error} | ${summary.matched}/${summary.total} |`;
      }),
      '',
      '## Per case',
      '',
      '| id | expect | outcomes | stable | match rate |',
      '| --- | --- | --- | --- | --- |',
      ...stability.map((row) => `| ${row.id} | ${row.expect} | ${row.outcomes.join(', ')} | ${row.stable ? 'yes' : 'no'} | ${row.matchRate}% |`),
      '',
    ];
    writeFileSync(reportPath, lines.join('\n'));
    console.log(`CORPUS total ${JSON.stringify(totals)}`);
    console.log(`CORPUS unstable ${stability.filter((row) => !row.stable).map((row) => row.id).join(',') || 'none'}`);
    console.log(`CORPUS report ${reportPath}`);
    expect(all).toHaveLength(corpus.cases.length * ROUNDS);
  }, 3_600_000);
});
