import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// Explicit, bounded provider probe. It never imports every deployment credential
// into process.env, prints provider bodies, or writes a proposal into a workspace.
const args = process.argv.slice(2);
const envArg = args.find(arg => arg.startsWith('--env-file='));
const smoke = args.includes('--smoke');
if (args.some(arg => arg !== '--smoke' && !arg.startsWith('--env-file='))
  || args.filter(arg => arg.startsWith('--env-file=')).length > 1) {
  console.error('Use --env-file=<ignored-local-file> and optional --smoke.');
  process.exit(2);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const report = { checkedAt: new Date().toISOString(), provider: 'deepseek', model: 'deepseek-flash', credential: 'DEEPSEEK_KEY', auth: 'unverified', samples: [] };
function save() {
  const directory = resolve(root, 'test-results', 'deepseek');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'probe.json'), JSON.stringify(report, null, 2) + '\n');
}
function output(value) { console.log(JSON.stringify(value)); }
function peakCost(usage) {
  return (usage.cacheHitTokens * 0.006 + usage.cacheMissTokens * 0.30 + usage.completionTokens * 1.20) / 1_000_000;
}
const cases = [
  {
    id: 'english-surcharge',
    input: {
      prompt: 'Propose exactly one remote surcharge rule with id probe-remote, using this reviewed source.',
      sourceId: 'synthetic-rates-01',
      excerpt: 'Synthetic test rate card. Remote surcharge applies to all zones: THB 7.50, effective 2026-10-20, no end date.',
      rules: [],
    },
    expected: { op: 'setSurcharge', id: 'probe-remote', zone: '*', amountSatang: 750, from: '2026-10-20', to: null, sourceId: 'synthetic-rates-01' },
  },
  {
    id: 'thai-regional-base',
    input: {
      prompt: 'เสนอค่าขนส่งพื้นฐานสำหรับ regional เพียงข้อเดียว ใช้ id probe-regional และหลักฐานนี้',
      sourceId: 'synthetic-rates-02',
      excerpt: 'ข้อมูลทดสอบสังเคราะห์: ค่าส่งพื้นฐานต่างจังหวัด (regional) 42.50 บาท เริ่ม 2026-11-01 ถึงก่อนวันที่ 2027-01-01',
      rules: [],
    },
    expected: { op: 'setZoneBase', id: 'probe-regional', zone: 'regional', amountSatang: 4250, from: '2026-11-01', to: '2027-01-01', sourceId: 'synthetic-rates-02' },
  },
  {
    id: 'weight-step',
    input: {
      prompt: 'Propose exactly one weight-step rule with id probe-weight. Use integer satang and the reviewed source.',
      sourceId: 'synthetic-rates-03',
      excerpt: 'Synthetic test rate card. Each started kilogram above the first kilogram costs THB 10.50 for all zones, from 2026-10-21, no end date.',
      rules: [],
    },
    expected: { op: 'setWeightStep', id: 'probe-weight', zone: '*', amountSatang: 1050, from: '2026-10-21', to: null, sourceId: 'synthetic-rates-03' },
  },
];

try {
  const key = envArg
    ? parseEnv(readFileSync(resolve(envArg.slice('--env-file='.length)), 'utf8')).DEEPSEEK_KEY?.trim()
    : process.env.DEEPSEEK_KEY?.trim();
  if (!key) throw new Error('CREDENTIAL_MISSING');
  const response = await fetch('https://api.deepseek.com/models', {
    headers: { Authorization: `Bearer ${key}` },
    redirect: 'error', signal: AbortSignal.timeout(20_000),
  });
  report.httpStatus = response.status;
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error('AUTH_CHECK_FAILED');
  }
  const catalogue = await response.json();
  if (!Array.isArray(catalogue.data) || !catalogue.data.some(item => item.id === 'deepseek-flash')) {
    throw new Error('MODEL_UNAVAILABLE');
  }
  report.auth = 'pass';
  output({ credential: report.credential, auth: report.auth, httpStatus: response.status, modelAvailable: true });
  if (smoke) {
    const { DeepSeekProvider } = await import('../server/providers/deepseek.ts');
    const provider = new DeepSeekProvider({ apiKey: key, maxTokens: 512, timeoutMs: 30_000 });
    for (const sample of cases) {
      const start = performance.now();
      const result = await provider.proposeWithUsage(sample.input, new AbortController().signal);
      const operation = result.change.operations?.[0];
      const semanticPass = result.change.kind === 'invoice' && result.change.operations.length === 1
        && Object.entries(sample.expected).every(([name, value]) => operation?.[name] === value);
      const sampleReport = {
        case: sample.id, semanticPass, elapsedMs: Math.round(performance.now() - start),
        model: result.model, usage: result.usage,
        estimatedPeakUsd: peakCost(result.usage), estimatedOffPeakUsd: peakCost(result.usage) / 2,
      };
      report.samples.push(sampleReport);
      output(sampleReport);
      if (!semanticPass) { report.failure = 'SYNTHETIC_SEMANTIC_CHECK_FAILED'; process.exitCode = 1; break; }
    }
    report.scope = 'Up to three synthetic invoice proposals; no workspace writes, live documents, DnD/OCR evaluation or latency SLO.';
    report.estimatedPeakUsd = report.samples.reduce((sum, sample) => sum + sample.estimatedPeakUsd, 0);
    report.estimatedOffPeakUsd = report.estimatedPeakUsd / 2;
  }
  save();
} catch (error) {
  const safeCode = typeof error?.code === 'string' && /^MODEL_PROVIDER_[A-Z_]+$/.test(error.code)
    ? error.code
    : ['CREDENTIAL_MISSING', 'AUTH_CHECK_FAILED', 'MODEL_UNAVAILABLE'].includes(error?.message)
      ? error.message : 'PROBE_FAILED';
  report.failure = safeCode;
  output({ errorCode: safeCode });
  save();
  process.exitCode = 1;
}
