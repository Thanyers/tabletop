// F045 live probe: measure the real draft path at the configured deadline.
// Two cases: the "dragon" corpus prompt, and a big-source (10,000-character) policy request.
// Same measurement method as the F031/F029 corpus probe: call DeepSeekChangeProvider directly,
// allow the same repair loop, and record wall-clock time, attempts, progress samples and outcome.
// Run: node --import tsx scripts/f045-live-probe.mjs --deadline=240000
// Credentials: DEEPSEEK_KEY from TABLETOP_CREDENTIAL_FILE (default ../.env.deploy.local).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';
import { DeepSeekChangeProvider, RejectedChangeReply } from '../server/providers/deepseek-changes.ts';
import { FALLBACK_REPAIR_ATTEMPT, FALLBACK_SIMPLIFY_ISSUES, nextRepairIssues } from '../cloudflare/repair.ts';
import { DomainError } from '../src/tabletop/shared/contracts.ts';
import { createTableState, tableChangeIssues } from '../src/tabletop/domain/table.ts';

const MAX_ATTEMPTS = 4;
const requested = Number((process.argv.find((argument) => argument.startsWith('--deadline=')) ?? '').slice('--deadline='.length) || '240000');
if (!Number.isSafeInteger(requested) || requested < 60_000 || requested > 300_000) {
  throw new Error('Invalid --deadline: use 60000..300000');
}
const deadlineMs = requested;
const credentialFile = process.env.TABLETOP_CREDENTIAL_FILE ?? '../.env.deploy.local';
const env = parseEnv(readFileSync(resolve(credentialFile), 'utf8'));
if (!env.DEEPSEEK_KEY) throw new Error('DEEPSEEK_KEY is not ready');

const dragonPrompt = (JSON.parse(readFileSync(resolve('tests/corpus/table-prompts.json'), 'utf8')).cases ?? [])
  .find((entry) => entry.id === 'dragon')?.prompt;
if (typeof dragonPrompt !== 'string') throw new Error('The dragon prompt is missing from the corpus.');

/** A deterministic ~10,000-character policy document, so every run measures the same input. */
function bigSource() {
  const clauses = [];
  for (let index = 1; clauses.join('\n').length < 10_000; index += 1) {
    clauses.push(`Clause ${index}: The refund deposit is ${(index * 7) % 50 + 10} percent of the box price for tier ${index % 4}, and it is released after ${(index * 3) % 20 + 3} days.`);
  }
  return clauses.join('\n');
}

const sourceText = bigSource();
const cases = [
  { id: 'dragon', prompt: dragonPrompt, sources: [] },
  {
    id: 'big-source',
    prompt: 'สร้างตารางสรุปนโยบายมัดจำจากไฟล์ที่แนบมา ให้มีที่อยู่ของแต่ละข้อ (clause), เปอร์เซ็นต์มัดจำ และจำนวนวันก่อนคืนเงิน',
    sources: [{ id: 'policy_10k', filename: 'deposit-policy.txt', text: sourceText }],
  },
];

/** One case through the same repair loop the Room uses, with bounded progress reporting. */
async function runCase(testCase) {
  const state = createTableState();
  let input = { kind: 'table', prompt: testCase.prompt, sources: testCase.sources, program: null, turn: null };
  let previousIssues = [];
  const startedAt = Date.now();
  let progressSamples = 0;
  let lastProgress = { receivedChars: 0, reasoningChars: 0 };
  let lastDetail = '';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const remaining = deadlineMs - (Date.now() - startedAt);
    if (remaining < 1) return { id: testCase.id, outcome: 'error', attempts: attempt, ms: Date.now() - startedAt, detail: 'our deadline was spent', progressSamples, lastProgress };
    const provider = new DeepSeekChangeProvider({ apiKey: env.DEEPSEEK_KEY, timeoutMs: remaining });
    let issues;
    let previousOutput;
    try {
      const result = await provider.propose(input, new AbortController().signal, (progress) => {
        progressSamples += 1;
        lastProgress = progress;
      });
      if ('clarification' in result) {
        return { id: testCase.id, outcome: 'clarify', attempts: attempt, ms: Date.now() - startedAt, detail: result.clarification.question, progressSamples, lastProgress };
      }
      const change = result.change;
      issues = tableChangeIssues(state, change).slice(0, 4);
      if (!issues.length) {
        const collections = change.kind === 'table' ? change.program.collections.map((collection) => collection.id).join(',') : '';
        return { id: testCase.id, outcome: 'draft', attempts: attempt, ms: Date.now() - startedAt, detail: collections, progressSamples, lastProgress };
      }
      previousOutput = JSON.stringify(change).slice(0, 18_000);
    } catch (error) {
      if (error instanceof DomainError && error.code === 'MODEL_PROVIDER_INPUT_TOO_LARGE' && input.repair?.previousOutput) {
        input = { ...input, repair: { ...input.repair, previousOutput: input.repair.previousOutput.slice(0, Math.floor(input.repair.previousOutput.length / 2)) } };
        attempt -= 1;
        continue;
      }
      if (!(error instanceof RejectedChangeReply)) {
        return {
          id: testCase.id,
          outcome: 'error',
          attempts: attempt,
          ms: Date.now() - startedAt,
          detail: `${error?.code ?? 'UNKNOWN'}: ${error instanceof Error ? error.message : String(error)}`,
          progressSamples,
          lastProgress,
          failureDetails: error?.details ?? null,
        };
      }
      issues = error.issues.slice(0, 4);
      previousOutput = error.previousOutput;
    }
    lastDetail = issues[0] ?? lastDetail;
    if (attempt === MAX_ATTEMPTS) break;
    if (attempt === MAX_ATTEMPTS - 1) {
      input = { ...input, repair: { attempt: FALLBACK_REPAIR_ATTEMPT, issues: [...FALLBACK_SIMPLIFY_ISSUES] } };
    } else {
      input = { ...input, repair: { attempt: attempt + 1, issues: nextRepairIssues(previousIssues, issues), ...(previousOutput ? { previousOutput } : {}) } };
    }
    previousIssues = issues;
  }
  return { id: testCase.id, outcome: 'reject', attempts: MAX_ATTEMPTS, ms: Date.now() - startedAt, detail: lastDetail, progressSamples, lastProgress };
}

const results = [];
for (const testCase of cases) {
  const result = await runCase(testCase);
  results.push(result);
  const withinDeadline = result.ms < deadlineMs;
  console.log(`F045-probe ${result.id}: outcome=${result.outcome} attempts=${result.attempts} ms=${result.ms} deadline=${deadlineMs} within=${withinDeadline} progressSamples=${result.progressSamples} received=${result.lastProgress.receivedChars} reasoning=${result.lastProgress.reasoningChars}`);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(`test-results/f045-live-${stamp}`);
mkdirSync(output, { recursive: true });
const passed = results.every((result) => result.outcome === 'draft' && result.ms < deadlineMs);
const receipt = {
  createdAt: new Date().toISOString(),
  method: 'DeepSeekChangeProvider direct call with the configured job deadline, same repair loop as cloudflare/ai.ts proposeGeneratedTable (F031/F029 probe method)',
  deadlineMs,
  sourceChars: sourceText.length,
  node: process.version,
  passed,
  results,
};
writeFileSync(resolve(output, 'live-probe.json'), `${JSON.stringify(receipt, null, 2)}\n`);
const lines = [
  `# F045 live probe — ${receipt.createdAt}`,
  '',
  `- deadline: ${deadlineMs} ms (max 300000)`,
  `- node: ${process.version}`,
  `- big source: ${sourceText.length} characters`,
  `- verdict: **${passed ? 'PASS' : 'FAIL'}** (each case must be a draft inside the deadline)`,
  '',
  '| case | outcome | attempts | wall ms | within deadline | progress samples | last received | last reasoning |',
  '| --- | --- | ---: | ---: | --- | ---: | ---: | ---: |',
  ...results.map((result) => `| ${result.id} | ${result.outcome} | ${result.attempts} | ${result.ms} | ${result.ms < deadlineMs ? 'yes' : 'no'} | ${result.progressSamples} | ${result.lastProgress.receivedChars} | ${result.lastProgress.reasoningChars} |`),
  '',
  ...results.filter((result) => result.detail).map((result) => `- ${result.id} detail: ${String(result.detail).slice(0, 400)}`),
  '',
];
writeFileSync(resolve(output, 'live-probe.md'), lines.join('\n'));
console.log(`F045-probe written to ${output} verdict=${passed ? 'PASS' : 'FAIL'}`);
if (!passed) process.exitCode = 1;
