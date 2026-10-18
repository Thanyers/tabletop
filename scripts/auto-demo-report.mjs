#!/usr/bin/env node

import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const MAX_JSON_BYTES = 8 * 1024 * 1024;
const MAX_SCENARIOS = 100;
const MAX_STEPS = 500;
const MAX_CHECKS = 2_000;

function fail(message) {
  throw new Error(message);
}

function record(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${path} must be an object.`);
  return value;
}

function text(value, path, max = 4_000) {
  if (typeof value !== 'string' || value.length > max || value.trim().length === 0) {
    fail(`${path} must be a non-empty string of at most ${max} characters.`);
  }
  return value;
}

function optionalText(value, path, max = 4_000) {
  if (value === undefined) return undefined;
  return text(value, path, max);
}

function integer(value, path, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${path} must be an integer from ${min} to ${max}.`);
  return value;
}

function finite(value, path, min = -1_000_000_000_000, max = 1_000_000_000_000) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${path} must be a finite number in range.`);
  return value;
}

function boolean(value, path) {
  if (typeof value !== 'boolean') fail(`${path} must be true or false.`);
  return value;
}

function oneOf(value, path, choices) {
  if (!choices.includes(value)) fail(`${path} has an unsupported value.`);
  return value;
}

function dateTime(value, path) {
  const result = text(value, path, 100);
  if (!Number.isFinite(Date.parse(result))) fail(`${path} must be a valid date and time.`);
  return result;
}

function stringList(value, path, maxItems = 100) {
  if (!Array.isArray(value) || value.length > maxItems) fail(`${path} must be a list with at most ${maxItems} items.`);
  return value.map((item, index) => text(item, `${path}[${index}]`, 1_000));
}

function optionalStringList(value, path, maxItems = 100) {
  return value === undefined ? [] : stringList(value, path, maxItems);
}

function readOptionalNumber(source, key, path, { min, max, integerOnly = false, nullable = false } = {}) {
  if (!Object.hasOwn(source, key)) return undefined;
  if (nullable && source[key] === null) return null;
  return integerOnly ? integer(source[key], `${path}.${key}`, min ?? 0, max ?? Number.MAX_SAFE_INTEGER)
    : finite(source[key], `${path}.${key}`, min ?? -1_000_000_000_000, max ?? 1_000_000_000_000);
}

function sanitizeCheckpoint(value, path) {
  if (value === undefined) return undefined;
  const input = record(value, path);
  const result = {};
  for (const key of ['ruleRevision', 'dataRevision']) {
    const found = readOptionalNumber(input, key, path, { integerOnly: true });
    if (found !== undefined) result[key] = found;
  }
  if (Object.hasOwn(input, 'phase')) {
    result.phase = oneOf(input.phase, `${path}.phase`, ['turn.start', 'reaction.open', 'action.resolved', 'turn.end']);
  }
  if (Object.hasOwn(input, 'totals')) {
    const totals = record(input.totals, `${path}.totals`);
    const allowed = {};
    for (const key of ['expectedSatang', 'deltaSatang']) {
      const found = readOptionalNumber(totals, key, `${path}.totals`, { min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, integerOnly: true, nullable: true });
      if (found !== undefined) allowed[key] = found;
    }
    const unknownCount = readOptionalNumber(totals, 'unknownCount', `${path}.totals`, { integerOnly: true });
    if (unknownCount !== undefined) allowed.unknownCount = unknownCount;
    result.totals = allowed;
  }
  if (Object.hasOwn(input, 'physics')) {
    const physics = record(input.physics, `${path}.physics`);
    const allowed = {};
    for (const key of ['force', 'mass', 'time', 'acceleration', 'velocity', 'position']) {
      const found = readOptionalNumber(physics, key, `${path}.physics`);
      if (found !== undefined) allowed[key] = found;
    }
    result.physics = allowed;
  }
  if (Object.hasOwn(input, 'characters')) {
    if (!Array.isArray(input.characters) || input.characters.length > 20) fail(`${path}.characters must contain at most 20 characters.`);
    result.characters = input.characters.map((item, index) => {
      const character = record(item, `${path}.characters[${index}]`);
      return {
        name: text(character.name, `${path}.characters[${index}].name`, 120),
        hp: finite(character.hp, `${path}.characters[${index}].hp`, 0, 1_000_000),
        ap: finite(character.ap, `${path}.characters[${index}].ap`, 0, 1_000_000),
      };
    });
  }
  if (Object.hasOwn(input, 'privateFieldsHidden')) result.privateFieldsHidden = boolean(input.privateFieldsHidden, `${path}.privateFieldsHidden`);
  return result;
}

function sanitizeStep(value, path) {
  const input = record(value, path);
  if (!Array.isArray(input.checks) || input.checks.length > MAX_CHECKS) fail(`${path}.checks must be a bounded list.`);
  return {
    index: integer(input.index, `${path}.index`, 0, 100_000),
    label: text(input.label, `${path}.label`, 240),
    actor: text(input.actor, `${path}.actor`, 160),
    command: text(input.command, `${path}.command`, 180),
    status: oneOf(input.status, `${path}.status`, ['passed', 'failed', 'expected-rejection']),
    expected: text(input.expected, `${path}.expected`, 4_000),
    observed: text(input.observed, `${path}.observed`, 4_000),
    checkpoint: sanitizeCheckpoint(input.checkpoint, `${path}.checkpoint`),
    checks: input.checks.map((check, index) => {
      const checkPath = `${path}.checks[${index}]`;
      const item = record(check, checkPath);
      return { label: text(item.label, `${checkPath}.label`, 500), passed: boolean(item.passed, `${checkPath}.passed`) };
    }),
  };
}

function sanitizeRun(value) {
  const input = record(value, 'run');
  if (input.schemaVersion !== 1) fail('run.schemaVersion must be 1.');
  oneOf(input.runtime, 'run.runtime', ['local-cloudflare']);
  oneOf(input.identity, 'run.identity', ['synthetic']);
  oneOf(input.ai, 'run.ai', ['mocked', 'not-used']);
  if (integer(input.productionMutations, 'run.productionMutations') !== 0) fail('This renderer only accepts runs with zero production mutations.');
  const scenariosInput = input.scenarios;
  if (!Array.isArray(scenariosInput) || scenariosInput.length === 0 || scenariosInput.length > MAX_SCENARIOS) {
    fail(`run.scenarios must contain between 1 and ${MAX_SCENARIOS} scenarios.`);
  }
  const ids = new Set();
  const scenarios = scenariosInput.map((scenarioValue, scenarioIndex) => {
    const path = `run.scenarios[${scenarioIndex}]`;
    const scenario = record(scenarioValue, path);
    const id = text(scenario.id, `${path}.id`, 180);
    if (ids.has(id)) fail(`${path}.id must be unique.`);
    ids.add(id);
    oneOf(scenario.domain, `${path}.domain`, ['invoice', 'teaching', 'encounter']);
    if (!Array.isArray(scenario.steps) || scenario.steps.length === 0 || scenario.steps.length > MAX_STEPS) {
      fail(`${path}.steps must contain between 1 and ${MAX_STEPS} steps.`);
    }
    const steps = scenario.steps.map((step, index) => sanitizeStep(step, `${path}.steps[${index}]`));
    const stepIds = new Set(steps.map((step) => step.index));
    if (stepIds.size !== steps.length) fail(`${path}.steps indexes must be unique.`);
    const hasFailure = steps.some((step) => step.status === 'failed' || step.checks.some((check) => !check.passed));
    const status = oneOf(scenario.status, `${path}.status`, ['passed', 'failed']);
    if (status === 'failed' !== hasFailure) fail(`${path}.status does not match its step and check results.`);
    const persona = record(scenario.persona, `${path}.persona`);
    return {
      id,
      title: text(scenario.title, `${path}.title`, 300),
      domain: scenario.domain,
      persona: {
        name: text(persona.name, `${path}.persona.name`, 180),
        role: text(persona.role, `${path}.persona.role`, 180),
        goal: text(persona.goal, `${path}.persona.goal`, 1_000),
      },
      prompt: text(scenario.prompt, `${path}.prompt`, 4_000),
      expectedOutcome: text(scenario.expectedOutcome, `${path}.expectedOutcome`, 2_000),
      status,
      steps,
      limitations: optionalStringList(scenario.limitations, `${path}.limitations`),
    };
  });
  const summary = record(input.summary, 'run.summary');
  const totalChecks = scenarios.reduce((total, scenario) => total + scenario.steps.reduce((subtotal, step) => subtotal + step.checks.length, 0), 0);
  const passedScenarios = scenarios.filter((scenario) => scenario.status === 'passed').length;
  const failedScenarios = scenarios.length - passedScenarios;
  if (integer(summary.scenarios, 'run.summary.scenarios') !== scenarios.length
    || integer(summary.passed, 'run.summary.passed') !== passedScenarios
    || integer(summary.failed, 'run.summary.failed') !== failedScenarios
    || integer(summary.checks, 'run.summary.checks') !== totalChecks) {
    fail('run.summary does not match the recorded scenarios and checks.');
  }
  const status = oneOf(input.status, 'run.status', ['passed', 'failed']);
  if (status !== (failedScenarios === 0 ? 'passed' : 'failed')) fail('run.status does not match the scenario results.');
  return {
    schemaVersion: 1,
    runId: text(input.runId, 'run.runId', 180),
    startedAt: dateTime(input.startedAt, 'run.startedAt'),
    finishedAt: dateTime(input.finishedAt, 'run.finishedAt'),
    sourceCommit: text(input.sourceCommit, 'run.sourceCommit', 160),
    sourceDirty: input.sourceDirty === undefined ? undefined : boolean(input.sourceDirty, 'run.sourceDirty'),
    scenarioCatalogHash: input.scenarioCatalogHash === null ? undefined : optionalText(input.scenarioCatalogHash, 'run.scenarioCatalogHash', 180),
    workerBundleSha256: input.workerBundleSha256 === null ? undefined : optionalText(input.workerBundleSha256, 'run.workerBundleSha256', 180),
    runtime: 'local-cloudflare',
    identity: 'synthetic',
    ai: input.ai,
    productionMutations: 0,
    status,
    scenarios,
    summary: { scenarios: scenarios.length, passed: passedScenarios, failed: failedScenarios, checks: totalChecks },
    limitations: stringList(input.limitations, 'run.limitations'),
  };
}

function sanitizeRule(value, path) {
  const rule = record(value, path);
  const apCost = integer(rule.apCost, `${path}.apCost`, 0, 1);
  return {
    allyTarget: boolean(rule.allyTarget, `${path}.allyTarget`),
    apCost,
    oncePerTurn: boolean(rule.oncePerTurn, `${path}.oncePerTurn`),
  };
}

function revisionList(value, path) {
  if (!Array.isArray(value) || value.length > 50) fail(`${path} must be a bounded revision list.`);
  const revisions = value.map((item, index) => integer(item, `${path}[${index}]`));
  if (new Set(revisions).size !== revisions.length) fail(`${path} must not contain duplicate revisions.`);
  return revisions;
}

function sanitizeHistory(value) {
  const input = record(value, 'history');
  if (input.schemaVersion !== 1) fail('history.schemaVersion must be 1.');
  const before = record(input.before, 'history.before');
  const firstAttempt = record(input.firstAttempt, 'history.firstAttempt');
  const recovery = record(input.recovery, 'history.recovery');
  const after = record(input.after, 'history.after');
  const reload = record(input.reload, 'history.reload');
  const privacy = record(input.privacy, 'history.privacy');
  if (oneOf(before.status, 'history.before.status', ['APPROVED']) !== 'APPROVED') fail('Unsupported hosted-history starting status.');
  if (oneOf(firstAttempt.result, 'history.firstAttempt.result', ['rejected']) !== 'rejected') fail('Unsupported hosted-history first attempt result.');
  if (oneOf(after.status, 'history.after.status', ['ACTIVE']) !== 'ACTIVE') fail('Unsupported hosted-history activation status.');
  if (oneOf(reload.candidateStatus, 'history.reload.candidateStatus', ['ACTIVE']) !== 'ACTIVE') fail('Unsupported hosted-history reload status.');
  if (boolean(reload.passed, 'history.reload.passed') !== true || boolean(after.historyKept, 'history.after.historyKept') !== true) {
    fail('Hosted-history reload and history-preservation checks must have passed.');
  }
  for (const key of ['credentialsIncluded', 'accountIdentifiersIncluded', 'invitationTokensIncluded']) {
    if (boolean(privacy[key], `history.privacy.${key}`) !== false) fail('Hosted history must not include credentials, account identifiers, or invitation tokens.');
  }
  return {
    recordedAt: dateTime(input.recordedAt, 'history.recordedAt'),
    runtimeCommit: text(input.runtimeCommit, 'history.runtimeCommit', 160),
    environment: text(before.environment, 'history.before.environment', 160),
    roomAlias: text(before.roomAlias, 'history.before.roomAlias', 180),
    scope: text(before.scope, 'history.before.scope', 1_000),
    before: {
      observedAt: dateTime(before.observedAt, 'history.before.observedAt'),
      status: 'APPROVED',
      ruleRevision: integer(before.ruleRevision, 'history.before.ruleRevision'),
      dataRevision: integer(before.dataRevision, 'history.before.dataRevision'),
      activeRule: sanitizeRule(before.activeRule, 'history.before.activeRule'),
      intendedRule: sanitizeRule(before.intendedRule, 'history.before.intendedRule'),
    },
    firstAttempt: {
      result: 'rejected',
      visibleMessage: text(firstAttempt.visibleMessage, 'history.firstAttempt.visibleMessage', 2_000),
      persistedRuleRevision: integer(firstAttempt.persistedRuleRevision, 'history.firstAttempt.persistedRuleRevision'),
    },
    recovery: {
      method: text(recovery.method, 'history.recovery.method', 2_000),
      additionalAiRequests: integer(recovery.additionalAiRequests, 'history.recovery.additionalAiRequests'),
    },
    after: {
      observedAt: dateTime(after.observedAt, 'history.after.observedAt'),
      status: 'ACTIVE',
      ruleRevision: integer(after.ruleRevision, 'history.after.ruleRevision'),
      dataRevision: integer(after.dataRevision, 'history.after.dataRevision'),
      activeRule: sanitizeRule(after.activeRule, 'history.after.activeRule'),
      revisionOptions: revisionList(after.revisionOptions, 'history.after.revisionOptions'),
    },
    reload: {
      observedAt: dateTime(reload.observedAt, 'history.reload.observedAt'),
      passed: true,
      ruleRevision: integer(reload.ruleRevision, 'history.reload.ruleRevision'),
      candidateStatus: 'ACTIVE',
      rule: sanitizeRule(reload.rule, 'history.reload.rule'),
      revisionOptions: revisionList(reload.revisionOptions, 'history.reload.revisionOptions'),
    },
    limitations: stringList(input.limits, 'history.limits', 100),
  };
}

async function readJson(path) {
  const bytes = await readFile(path);
  if (bytes.byteLength > MAX_JSON_BYTES) fail(`${path} exceeds the ${MAX_JSON_BYTES} byte input limit.`);
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`${path} is not valid JSON: ${error.message}`);
  }
}

function parseArgs(args) {
  const result = { input: null, output: null, history: null, help: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') { result.help = true; continue; }
    if (arg === '--output' || arg === '--history') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) fail(`${arg} requires a file path.`);
      const key = arg === '--output' ? 'output' : 'history';
      if (result[key] !== null) fail(`${arg} may be used only once.`);
      result[key] = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('-')) fail(`Unknown option: ${arg}`);
    if (result.input !== null) fail('Only one run.json input is supported.');
    result.input = arg;
  }
  if (!result.help && (!result.input || !result.output)) fail('Usage: node scripts/auto-demo-report.mjs <run.json> --output <report.html> [--history <sanitized-hosted-history.json>]');
  return result;
}

function safeScriptJson(value) {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (character) => ({
    '<': '\\u003c',
    '>': '\\u003e',
    '&': '\\u0026',
    '\u2028': '\\u2028',
    '\u2029': '\\u2029',
  })[character]);
}

function htmlFor(data) {
  const json = safeScriptJson(data);
  return `<!doctype html>
<html lang="th">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="light">
  <title>Tabletop · บันทึกเล่นย้อนผลทดสอบ</title>
  <style>
    :root{color-scheme:light;--ink:#243548;--muted:#718079;--line:#dbe4df;--paper:#f3f4f1;--card:#fffefa;--teal:#24796b;--blue:#315eb0;--amber:#a9742e;--red:#a35045;--green:#277653;--mono:ui-monospace,"Cascadia Code",Consolas,monospace}
    *{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:15px/1.6 "Noto Sans Thai","Leelawadee UI",Tahoma,system-ui,sans-serif}button,select{font:inherit}button,select{color:inherit}button:focus-visible,select:focus-visible{outline:3px solid #4777cb;outline-offset:3px}button:disabled{cursor:not-allowed;opacity:.45}
    .shell{width:min(1240px,100%);margin:0 auto;padding:clamp(14px,3vw,32px)}.hero{position:relative;overflow:hidden;padding:clamp(22px,4vw,42px);border:1px solid #314756;border-radius:18px;color:#f3f5ee;background:linear-gradient(135deg,#243548,#345254 76%,#3c6459);box-shadow:0 18px 42px #263b391b}.hero:after{position:absolute;right:-48px;bottom:-96px;width:280px;height:280px;border:1px solid #ffffff1b;border-radius:50%;box-shadow:0 0 0 26px #ffffff08,0 0 0 52px #ffffff06;content:""}.eyebrow{color:#b6d8ca;font:700 11px/1.5 var(--mono);letter-spacing:.1em;text-transform:uppercase}.hero h1{max-width:780px;margin:8px 0 8px;font-size:clamp(24px,4vw,38px);line-height:1.2;letter-spacing:-.025em}.hero-copy{max-width:780px;margin:0;color:#d4e0d9;font-size:14px}.hero-note{display:inline-flex;align-items:center;gap:8px;margin-top:18px;padding:7px 11px;border:1px solid #8dbca455;border-radius:99px;color:#ddf2e5;background:#ffffff0d;font-size:12px;font-weight:700}
    .meta-grid,.summary-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}.meta-card,.summary-card,.panel,.hosted-panel{border:1px solid var(--line);border-radius:12px;background:var(--card);box-shadow:0 6px 18px #263b3907}.meta-card,.summary-card{padding:12px 14px}.meta-card span,.summary-card span{display:block;color:var(--muted);font-size:11px}.meta-card strong,.summary-card strong{display:block;overflow-wrap:anywhere;margin-top:3px;font-size:13px}.summary-card strong{font-size:21px;line-height:1.25}.pill{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border:1px solid var(--line);border-radius:99px;color:#5d6c65;background:#f6f8f4;font-size:11px;font-weight:750;white-space:nowrap}.pill:before{width:7px;height:7px;border-radius:50%;background:currentColor;content:""}.pill--passed{border-color:#cbe3d4;color:var(--green);background:#eff8f1}.pill--failed{border-color:#e9cfc9;color:var(--red);background:#fff2ef}.pill--expected-rejection{border-color:#ecdcb9;color:#976a28;background:#fff8e9}.pill--info{border-color:#cbd8ef;color:var(--blue);background:#f0f4fc}.summary-card--failed strong{color:var(--red)}
    .panel,.hosted-panel{margin-top:16px;padding:clamp(16px,2.8vw,24px)}.section-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:15px}.section-head h2{margin:2px 0;color:#2b4444;font-size:21px;line-height:1.35}.section-head p{margin:4px 0 0;color:var(--muted);font-size:12px}.control-grid{display:grid;grid-template-columns:minmax(170px,.7fr) minmax(240px,1.3fr) auto;align-items:end;gap:10px}.field{display:grid;gap:5px;min-width:0}.field label{color:#61756c;font-size:11px;font-weight:750}.field select{width:100%;min-height:42px;padding:8px 34px 8px 10px;border:1px solid #d6e1db;border-radius:7px;background:#fff;font-size:13px}.transport{display:flex;flex-wrap:wrap;gap:6px}.transport button{display:inline-flex;align-items:center;justify-content:center;gap:6px;min-height:42px;padding:0 12px;border:1px solid #d8e2dc;border-radius:7px;background:#fff;font-size:12px;font-weight:750}.transport button:hover:not(:disabled){border-color:#9dc4b5;background:#f0f7f2}.transport .primary{border-color:#276e63;color:white;background:#276e63}.transport .primary:hover:not(:disabled){background:#1c6257}.progress-wrap{display:grid;grid-template-columns:auto minmax(80px,1fr);align-items:center;gap:12px;margin:16px 0 14px}.step-counter{min-width:104px;color:#526961;font:700 11px var(--mono)}.progress{height:7px;overflow:hidden;border-radius:99px;background:#e9eeea}.progress span{display:block;width:0;height:100%;border-radius:inherit;background:linear-gradient(90deg,#24796b,#6da691);transition:width .18s ease}
    .detail-grid{display:grid;grid-template-columns:minmax(250px,.78fr) minmax(0,1.45fr);gap:12px;align-items:start}.scenario-card,.step-card{min-width:0;padding:17px;border:1px solid #e1e8e3;border-radius:10px;background:#fff}.scenario-card{background:linear-gradient(160deg,#fbfcf8,#f6f8f3)}.scenario-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}.scenario-card h3,.step-card h3{margin:8px 0 10px;font-size:18px;line-height:1.35}.domain-label{display:inline-flex;padding:3px 7px;border:1px solid #d3e5dc;border-radius:4px;color:#347666;background:#eff7f1;font-size:10px;font-weight:750}.persona{display:grid;gap:3px;margin:12px 0;padding:10px 11px;border-left:3px solid #72a796;border-radius:0 6px 6px 0;background:#f1f7f3}.persona strong{font-size:13px}.persona span,.persona p{margin:0;color:#66766e;font-size:12px}.copy-block{margin-top:12px}.copy-block h4,.checkpoint h4{margin:0 0 4px;color:#577169;font-size:11px;font-weight:800}.copy-block p{margin:0;color:#42534e;font-size:13px;overflow-wrap:anywhere}.expected-outcome{padding:10px;border:1px solid #d6e3ef;border-radius:7px;background:#f3f7fc}.step-card__top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px}.step-card__top h3{margin:0}.step-meta{display:flex;flex-wrap:wrap;gap:6px 10px;margin:7px 0 14px;color:#73817a;font-size:11px}.step-meta code{color:#53695e;font:10px var(--mono);overflow-wrap:anywhere}.compare-grid{display:grid;grid-template-columns:1fr 1fr;gap:9px}.compare{min-width:0;padding:11px;border:1px solid #e2e9e4;border-radius:7px;background:#fafbf8}.compare--observed{border-color:#d4e7dc;background:#f4f9f4}.compare strong{display:block;margin-bottom:4px;color:#65786f;font-size:11px}.compare p{margin:0;color:#334740;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}.check-list{display:grid;gap:6px;margin:12px 0 0;padding:0;list-style:none}.check-list li{display:flex;align-items:flex-start;gap:7px;padding:7px 9px;border:1px solid #e5ebe6;border-radius:6px;color:#52645c;background:#fff;font-size:11px}.check-list li:before{flex:0 0 auto;color:var(--green);font-weight:900;content:"✓"}.check-list li.is-failed{border-color:#ead6d0;color:#914c41;background:#fff5f1}.check-list li.is-failed:before{color:var(--red);content:"×"}
    .checkpoint{margin-top:13px;padding-top:12px;border-top:1px solid #e5eae6}.checkpoint-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.revision-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.revision-chip{padding:4px 7px;border:1px solid #e1e8e4;border-radius:5px;color:#61716a;background:#f8faf7;font:10px var(--mono)}.visual-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:7px;margin-top:9px}.metric{min-width:0;padding:10px;border:1px solid #dfe8e2;border-radius:7px;background:#fbfcf9}.metric span{display:block;color:#72827a;font-size:10px}.metric strong{display:block;margin-top:3px;color:#2b544b;font-size:17px;line-height:1.3;overflow-wrap:anywhere}.metric small{display:block;margin-top:2px;color:#88958e;font-size:10px}.character-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(132px,1fr));gap:7px;margin-top:9px}.character{padding:10px;border:1px solid #dae6de;border-radius:7px;background:#f6faf5}.character strong{display:block;margin-bottom:7px;font-size:13px}.character-stats{display:flex;flex-wrap:wrap;gap:5px}.stat{padding:4px 6px;border:1px solid #dfe7e1;border-radius:4px;color:#52685d;background:#fff;font:700 10px var(--mono)}.no-checkpoint{margin:0;color:#88958e;font-size:12px}.timeline{display:flex;gap:7px;overflow-x:auto;margin-top:14px;padding:3px 2px 8px}.timeline button{display:grid;flex:0 0 min(190px,54vw);grid-template-columns:24px minmax(0,1fr);align-items:start;gap:7px;min-height:46px;padding:8px;border:1px solid #dfe6e1;border-radius:7px;color:#66776f;background:#fff;text-align:left;font-size:10px;line-height:1.35}.timeline button[aria-current="step"]{border-color:#6da491;color:#315e52;background:#f1f8f3;box-shadow:0 0 0 2px #5a9a7b20}.timeline-index{display:grid;width:22px;height:22px;place-items:center;border-radius:5px;color:#446b5e;background:#eaf3ed;font:700 10px var(--mono)}.timeline-label{overflow-wrap:anywhere}
    .limitations{margin-top:14px;padding:12px 14px;border:1px solid #e7dfc9;border-radius:8px;color:#736746;background:#fffbf1}.limitations h3{margin:0 0 5px;font-size:12px}.limitations ul{margin:0;padding-left:20px;font-size:11px}.hosted-panel{border-color:#d8dce8;background:linear-gradient(145deg,#fafbff,#fffefa)}.hosted-kicker{color:#596ba0}.observed-note{margin:0 0 14px;padding:10px 12px;border-left:3px solid #7185bf;border-radius:0 6px 6px 0;color:#4f5e79;background:#f0f3fa;font-size:12px}.hosted-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-bottom:12px}.hosted-head strong{font-size:14px}.history-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.history-card{min-width:0;padding:14px;border:1px solid #e1e5ec;border-radius:8px;background:#fff}.history-card h3{margin:0 0 8px;color:#4a5878;font-size:13px}.history-card p{margin:5px 0;color:#5d6a71;font-size:12px;overflow-wrap:anywhere}.history-card .rule-copy{padding:8px;border-radius:5px;color:#485b53;background:#f4f7f3;font-size:11px}.history-limit{margin:10px 0 0;padding-left:20px;color:#6a6e78;font-size:11px}.footer-note{margin:18px 4px 0;color:#84918b;font-size:11px;text-align:center}.mono{font-family:var(--mono);font-size:.92em;overflow-wrap:anywhere}
    @media(max-width:920px){.control-grid{grid-template-columns:1fr 1fr}.transport{grid-column:1/-1}.meta-grid,.summary-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.detail-grid{grid-template-columns:1fr 1.3fr}}
    @media(max-width:680px){.shell{padding:12px}.hero{border-radius:12px}.detail-grid,.history-grid{grid-template-columns:1fr}.section-head{display:block}.section-head>.pill{margin-top:8px}.step-card__top{align-items:flex-start}.compare-grid{grid-template-columns:1fr}.transport button{flex:1 1 calc(50% - 6px)}.control-grid{grid-template-columns:1fr}.transport{grid-column:auto}.progress-wrap{grid-template-columns:auto minmax(60px,1fr)}.meta-card,.summary-card{padding:10px}.summary-card strong{font-size:18px}}
    @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation-duration:.01ms!important;animation-iteration-count:1!important;transition-duration:.01ms!important}}
  </style>
</head>
<body>
  <div class="shell">
    <header class="hero">
      <div class="eyebrow">TABLETOP · RUN JOURNAL</div>
      <h1>การเล่นย้อนผลทดสอบที่บันทึกไว้ / ข้อมูลจำลอง</h1>
      <p class="hero-copy">รายงานนี้แสดงลำดับผลที่บันทึกไว้เพื่อสาธิตการทำงานของโต๊ะตรวจยอด บทเรียนฟิสิกส์ และฉากผจญภัย โดยใช้ข้อมูลจำลอง</p>
      <div class="hero-note">REPLAY ONLY · ไม่มีการเรียก API · ไม่สามารถแก้ไขห้องจริงหรือระบบผลิต</div>
    </header>
    <section class="meta-grid" aria-label="ข้อมูลการทดสอบ">
      <div class="meta-card"><span>Run ID</span><strong class="mono" id="run-id"></strong></div>
      <div class="meta-card"><span>Source commit</span><strong class="mono" id="source-commit"></strong></div>
      <div class="meta-card"><span>Source tree · scenario catalog</span><strong id="source-integrity"></strong></div>
      <div class="meta-card"><span>Runtime label · synthetic identity</span><strong id="runtime-label"></strong></div>
      <div class="meta-card"><span>AI และการแก้ไข production</span><strong id="safety-label"></strong></div>
    </section>
    <section class="summary-grid" aria-label="สรุปผลจำลอง">
      <div class="summary-card"><span>Scenarios</span><strong id="summary-scenarios"></strong></div>
      <div class="summary-card"><span>Passed</span><strong id="summary-passed"></strong></div>
      <div class="summary-card summary-card--failed"><span>Failed</span><strong id="summary-failed"></strong></div>
      <div class="summary-card"><span>Recorded checks</span><strong id="summary-checks"></strong></div>
    </section>
    <main>
      <section class="panel" aria-labelledby="replay-heading">
        <div class="section-head">
          <div><div class="eyebrow">RECORDED STEPS</div><h2 id="replay-heading">เล่นดูทีละเหตุการณ์</h2><p>เริ่มหยุดไว้ที่ขั้นแรก คุณเลือกเดินหน้าหรือเล่นอัตโนมัติจนจบได้</p></div>
          <span class="pill" id="run-status"></span>
        </div>
        <div class="control-grid">
          <div class="field"><label for="domain-filter">กรองประเภท</label><select id="domain-filter" aria-label="กรองสถานการณ์ตามประเภท"></select></div>
          <div class="field"><label for="scenario-picker">เลือกสถานการณ์</label><select id="scenario-picker" aria-label="เลือกสถานการณ์ที่บันทึกไว้"></select></div>
          <div class="transport" aria-label="ควบคุมการเล่นย้อน">
            <button class="primary" id="play-toggle" type="button" aria-pressed="false">เล่นต่อ</button>
            <button id="previous-step" type="button" aria-label="ขั้นก่อนหน้า">ก่อนหน้า</button>
            <button id="next-step" type="button" aria-label="ขั้นถัดไป">ถัดไป</button>
            <button id="restart-replay" type="button">เริ่มใหม่</button>
          </div>
        </div>
        <div class="progress-wrap"><div class="step-counter" id="step-counter" role="status" aria-live="polite"></div><div class="progress" aria-hidden="true"><span id="progress-bar"></span></div></div>
        <div class="detail-grid">
          <aside class="scenario-card" id="scenario-detail" aria-label="ข้อมูลผู้เล่นและเป้าหมาย"></aside>
          <article class="step-card" id="step-detail" aria-live="polite"></article>
        </div>
        <nav class="timeline" id="step-timeline" aria-label="เลือกขั้นทดสอบ"></nav>
      </section>
      <section class="limitations" aria-labelledby="limits-heading">
        <h3 id="limits-heading">ข้อจำกัดของชุดเล่นย้อนนี้</h3>
        <ul id="run-limitations"></ul>
      </section>
      <section class="hosted-panel" id="hosted-history" hidden aria-labelledby="hosted-heading">
        <div class="section-head">
          <div><div class="eyebrow hosted-kicker">SEPARATE OBSERVED RECORD</div><h2 id="hosted-heading">ประวัติการเปิดใช้จากห้องบนระบบโฮสต์</h2><p>เป็นหลักฐานจากบันทึกคนละชุดกับข้อมูลจำลองด้านบน</p></div>
          <span class="pill pill--info">OBSERVED · ไม่นับในผลทดสอบ</span>
        </div>
        <p class="observed-note">ส่วนนี้เป็นบันทึกเหตุการณ์ของห้องทดสอบที่มีอยู่เท่านั้น ไม่ใช่การทดสอบผู้เล่นหลายบัญชี และไม่ใช่การทดสอบ AI สด ผลด้านบนยังคงเป็นข้อมูลจำลองแยกต่างหาก</p>
        <div id="hosted-detail"></div>
      </section>
    </main>
    <p class="footer-note">ไฟล์รายงานนี้ทำงานในเบราว์เซอร์แบบออฟไลน์ · ไม่ส่งข้อมูลออกและไม่มีปุ่มที่เรียกใช้บริการ</p>
  </div>
  <script>const REPORT_DATA=${json};</script>
  <script>
    (() => {
      'use strict';
      const run = REPORT_DATA.run;
      const hosted = REPORT_DATA.history;
      const labels = { passed: 'ผ่าน', failed: 'ล้มเหลว', 'expected-rejection': 'ปฏิเสธตามคาด' };
      const domainLabels = { invoice: 'ตรวจยอดใบแจ้งหนี้', teaching: 'บทเรียนฟิสิกส์', encounter: 'ฉากผจญภัย' };
      const fieldNames = { force: ['แรง', 'N'], mass: ['มวล', 'kg'], time: ['เวลา', 's'], acceleration: ['ความเร่ง', 'm/s²'], velocity: ['ความเร็ว', 'm/s'], position: ['ตำแหน่ง', 'm'] };
      const elements = Object.fromEntries(['run-id','source-commit','source-integrity','runtime-label','safety-label','summary-scenarios','summary-passed','summary-failed','summary-checks','run-status','domain-filter','scenario-picker','play-toggle','previous-step','next-step','restart-replay','step-counter','progress-bar','scenario-detail','step-detail','step-timeline','run-limitations','hosted-history','hosted-detail'].map((id) => [id, document.getElementById(id)]));
      let filteredScenarios = run.scenarios.slice();
      let activeScenarioId = filteredScenarios[0].id;
      let stepIndex = 0;
      let timer = null;

      function node(tag, className, value) {
        const item = document.createElement(tag);
        if (className) item.className = className;
        if (value !== undefined) item.textContent = value;
        return item;
      }
      function clear(element) { while (element.firstChild) element.removeChild(element.firstChild); }
      function badge(status) {
        const item = node('span', 'pill pill--' + status, labels[status]);
        return item;
      }
      function dateLabel(value) {
        const parsed = new Date(value);
        return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
      }
      function numberLabel(value) { return new Intl.NumberFormat('th-TH', { maximumFractionDigits: 3 }).format(value); }
      function moneyLabel(satang) {
        if (satang === null || satang === undefined) return 'ไม่ระบุ';
        return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100) + ' THB';
      }
      function metric(parent, label, value, hint = '') {
        const card = node('div', 'metric');
        card.append(node('span', '', label), node('strong', '', value));
        if (hint) card.append(node('small', '', hint));
        parent.append(card);
      }
      function ruleLabel(rule) {
        return (rule.allyTarget ? 'ป้องกันตนเองหรือเพื่อนได้' : 'ป้องกันตนเองเท่านั้น') + ' · ' + rule.apCost + ' AP · ' + (rule.oncePerTurn ? 'ครั้งเดียวต่อเทิร์น' : 'ใช้ซ้ำได้');
      }
      function stopPlaying() {
        if (timer !== null) window.clearInterval(timer);
        timer = null;
        elements['play-toggle'].textContent = 'เล่นต่อ';
        elements['play-toggle'].setAttribute('aria-pressed', 'false');
      }
      function currentScenario() { return filteredScenarios.find((scenario) => scenario.id === activeScenarioId) ?? filteredScenarios[0]; }
      function refreshScenarioOptions() {
        clear(elements['scenario-picker']);
        filteredScenarios.forEach((scenario) => {
          const option = document.createElement('option');
          option.value = scenario.id;
          option.textContent = domainLabels[scenario.domain] + ' · ' + scenario.title;
          elements['scenario-picker'].append(option);
        });
        elements['scenario-picker'].value = activeScenarioId;
      }
      function renderScenario(scenario) {
        const details = elements['scenario-detail'];
        clear(details);
        const titleRow = node('div', 'scenario-title-row');
        titleRow.append(node('span', 'domain-label', domainLabels[scenario.domain]), badge(scenario.status));
        details.append(titleRow, node('h3', '', scenario.title));
        const persona = node('div', 'persona');
        persona.append(node('strong', '', scenario.persona.name), node('span', '', scenario.persona.role), node('p', '', scenario.persona.goal));
        details.append(persona);
        const prompt = node('div', 'copy-block');
        prompt.append(node('h4', '', 'คำขอหรือข้อความตั้งต้น'), node('p', '', scenario.prompt));
        const outcome = node('div', 'copy-block expected-outcome');
        outcome.append(node('h4', '', 'ผลที่คาดหวัง'), node('p', '', scenario.expectedOutcome));
        details.append(prompt, outcome);
        if (scenario.limitations.length) {
          const limited = node('div', 'copy-block');
          limited.append(node('h4', '', 'ข้อจำกัดเฉพาะสถานการณ์'));
          const list = node('ul', 'history-limit');
          scenario.limitations.forEach((item) => list.append(node('li', '', item)));
          limited.append(list);
          details.append(limited);
        }
      }
      function renderCheckpoint(parent, checkpoint) {
        const section = node('section', 'checkpoint');
        const head = node('div', 'checkpoint-head');
        head.append(node('h4', '', 'ภาพสถานะที่บันทึกไว้'));
        section.append(head);
        const revisions = [];
        if (checkpoint.ruleRevision !== undefined) revisions.push(['Rule revision', checkpoint.ruleRevision]);
        if (checkpoint.dataRevision !== undefined) revisions.push(['Data revision', checkpoint.dataRevision]);
        if (checkpoint.phase !== undefined) revisions.push(['Phase', checkpoint.phase]);
        if (revisions.length) {
          const row = node('div', 'revision-row');
          revisions.forEach(([label, value]) => row.append(node('span', 'revision-chip', label + ': ' + value)));
          section.append(row);
        }
        if (checkpoint.totals) {
          const grid = node('div', 'visual-grid');
          if (Object.hasOwn(checkpoint.totals, 'expectedSatang')) metric(grid, 'ยอดคาดหมายที่ทราบ', moneyLabel(checkpoint.totals.expectedSatang), checkpoint.totals.expectedSatang === null ? '' : checkpoint.totals.expectedSatang + ' satang');
          if (Object.hasOwn(checkpoint.totals, 'deltaSatang')) metric(grid, 'ผลต่าง', moneyLabel(checkpoint.totals.deltaSatang), checkpoint.totals.deltaSatang === null ? '' : checkpoint.totals.deltaSatang + ' satang');
          if (checkpoint.totals.unknownCount !== undefined) metric(grid, 'รายการที่ยังไม่ทราบ', numberLabel(checkpoint.totals.unknownCount));
          section.append(grid);
        }
        if (checkpoint.physics) {
          const grid = node('div', 'visual-grid');
          Object.entries(fieldNames).forEach(([key, [label, unit]]) => {
            if (checkpoint.physics[key] !== undefined) metric(grid, label, numberLabel(checkpoint.physics[key]) + ' ' + unit);
          });
          if (grid.childNodes.length) section.append(grid);
        }
        if (checkpoint.characters) {
          const grid = node('div', 'character-grid');
          checkpoint.characters.forEach((character) => {
            const card = node('div', 'character');
            card.append(node('strong', '', character.name));
            const stats = node('div', 'character-stats');
            stats.append(node('span', 'stat', 'HP ' + numberLabel(character.hp)), node('span', 'stat', 'AP ' + numberLabel(character.ap)));
            card.append(stats); grid.append(card);
          });
          section.append(grid);
        }
        if (checkpoint.privateFieldsHidden !== undefined) {
          section.append(node('p', '', checkpoint.privateFieldsHidden ? '✓ ข้อมูลส่วนตัวที่ไม่ควรเปิดเผยยังถูกซ่อนไว้' : '⚠ การตรวจข้อมูลส่วนตัวไม่ผ่าน'));
        }
        if (!revisions.length && !checkpoint.totals && !checkpoint.physics && !checkpoint.characters && checkpoint.privateFieldsHidden === undefined) {
          section.append(node('p', 'no-checkpoint', 'ไม่มีภาพสถานะเชิงข้อมูลสำหรับขั้นนี้'));
        }
        parent.append(section);
      }
      function renderStep(scenario) {
        const detail = elements['step-detail'];
        clear(detail);
        const step = scenario.steps[stepIndex];
        const top = node('div', 'step-card__top');
        top.append(node('h3', '', step.label), badge(step.status));
        detail.append(top);
        const meta = node('div', 'step-meta');
        meta.append(node('span', '', 'ผู้กระทำ: ' + step.actor));
        meta.append(node('code', '', step.command));
        detail.append(meta);
        const comparison = node('div', 'compare-grid');
        const expected = node('div', 'compare');
        expected.append(node('strong', '', 'Expected · คาดหวัง'), node('p', '', step.expected));
        const observed = node('div', 'compare compare--observed');
        observed.append(node('strong', '', 'Observed · ที่บันทึกได้'), node('p', '', step.observed));
        comparison.append(expected, observed);
        detail.append(comparison);
        if (step.checks.length) {
          const list = node('ul', 'check-list');
          step.checks.forEach((check) => {
            const item = node('li', check.passed ? '' : 'is-failed', check.label);
            list.append(item);
          });
          detail.append(list);
        }
        if (step.checkpoint) renderCheckpoint(detail, step.checkpoint);
        const count = scenario.steps.length;
        elements['step-counter'].textContent = 'ขั้น ' + (stepIndex + 1) + ' / ' + count;
        elements['progress-bar'].style.width = (((stepIndex + 1) / count) * 100) + '%';
        elements['previous-step'].disabled = stepIndex === 0;
        elements['next-step'].disabled = stepIndex >= count - 1;
        elements['play-toggle'].disabled = stepIndex >= count - 1;
        renderTimeline(scenario);
      }
      function renderTimeline(scenario) {
        const timeline = elements['step-timeline'];
        clear(timeline);
        scenario.steps.forEach((step, index) => {
          const button = node('button', '');
          button.type = 'button';
          button.setAttribute('aria-label', 'ไปขั้น ' + (index + 1) + ': ' + step.label + ' · ' + labels[step.status]);
          if (index === stepIndex) button.setAttribute('aria-current', 'step');
          button.append(node('span', 'timeline-index', String(index + 1)), node('span', 'timeline-label', step.label));
          button.addEventListener('click', () => { stopPlaying(); stepIndex = index; render(); });
          timeline.append(button);
        });
      }
      function render() {
        const scenario = currentScenario();
        if (!scenario) return;
        if (stepIndex >= scenario.steps.length) stepIndex = scenario.steps.length - 1;
        renderScenario(scenario);
        renderStep(scenario);
      }
      function populateDomainFilter() {
        const domains = [...new Set(run.scenarios.map((scenario) => scenario.domain))];
        const options = [['all', 'ทุกประเภท'], ...domains.map((domain) => [domain, domainLabels[domain]])];
        options.forEach(([value, label]) => {
          const option = document.createElement('option'); option.value = value; option.textContent = label;
          elements['domain-filter'].append(option);
        });
      }
      function renderHistory() {
        if (!hosted) return;
        elements['hosted-history'].hidden = false;
        const root = elements['hosted-detail'];
        const head = node('div', 'hosted-head');
        head.append(node('strong', '', hosted.roomAlias), node('span', 'revision-chip', hosted.environment), node('span', 'revision-chip', 'บันทึก ' + dateLabel(hosted.recordedAt)));
        root.append(head);
        const grid = node('div', 'history-grid');
        const before = node('article', 'history-card');
        before.append(node('h3', '', 'ก่อนดำเนินการ · ' + hosted.before.status + ' · r' + hosted.before.ruleRevision));
        before.append(node('p', '', 'Data revision ' + hosted.before.dataRevision + ' · ' + dateLabel(hosted.before.observedAt)));
        before.append(node('p', 'rule-copy', 'กฎที่ใช้งาน: ' + ruleLabel(hosted.before.activeRule)));
        before.append(node('p', 'rule-copy', 'กฎที่ต้องการ: ' + ruleLabel(hosted.before.intendedRule)));
        before.append(node('p', '', hosted.scope));
        const attempt = node('article', 'history-card');
        attempt.append(node('h3', '', 'ความพยายามครั้งแรก · ปฏิเสธ'));
        attempt.append(node('p', '', hosted.firstAttempt.visibleMessage));
        attempt.append(node('p', '', 'หลังความพยายามนี้ rule revision ยังคงเป็น ' + hosted.firstAttempt.persistedRuleRevision));
        const after = node('article', 'history-card');
        after.append(node('h3', '', 'หลังเปิดใช้ · ' + hosted.after.status + ' · r' + hosted.after.ruleRevision));
        after.append(node('p', '', 'Data revision ' + hosted.after.dataRevision + ' · ' + dateLabel(hosted.after.observedAt)));
        after.append(node('p', 'rule-copy', 'กฎที่ใช้งาน: ' + ruleLabel(hosted.after.activeRule)));
        after.append(node('p', '', 'เก็บ revision ไว้: ' + hosted.after.revisionOptions.join(', ')));
        const reload = node('article', 'history-card');
        reload.append(node('h3', '', 'ตรวจหลังโหลดใหม่ · ผ่าน'));
        reload.append(node('p', '', 'Rule revision ' + hosted.reload.ruleRevision + ' · ' + dateLabel(hosted.reload.observedAt)));
        reload.append(node('p', 'rule-copy', 'กฎหลังโหลดใหม่: ' + ruleLabel(hosted.reload.rule)));
        reload.append(node('p', '', 'ส่งคำขอ AI เพิ่มระหว่างการกู้คืน: ' + hosted.recovery.additionalAiRequests));
        reload.append(node('p', '', 'ขั้นตอนกู้คืน: ' + hosted.recovery.method));
        grid.append(before, attempt, after, reload);
        root.append(grid);
        const limits = node('ul', 'history-limit');
        hosted.limitations.forEach((item) => limits.append(node('li', '', item)));
        root.append(limits);
        root.append(node('p', 'footer-note', 'Runtime commit: ' + hosted.runtimeCommit + ' · ประวัติส่วนนี้ไม่ถูกรวมในจำนวน scenarios หรือ checks ด้านบน'));
      }

      elements['run-id'].textContent = run.runId;
      elements['source-commit'].textContent = run.sourceCommit;
      const sourceState = run.sourceDirty === undefined ? 'sourceDirty: ไม่ได้บันทึก' : 'sourceDirty: ' + (run.sourceDirty ? 'dirty' : 'clean');
      const catalogHash = run.scenarioCatalogHash ? ' · scenarioCatalogHash: ' + run.scenarioCatalogHash : ' · scenarioCatalogHash: ไม่ได้บันทึก';
      const bundleHash = run.workerBundleSha256 ? ' · workerBundleSha256: ' + run.workerBundleSha256 : ' · workerBundleSha256: ไม่ได้บันทึก';
      elements['source-integrity'].textContent = sourceState + catalogHash + bundleHash;
      elements['runtime-label'].textContent = run.runtime + ' · identity: ' + run.identity;
      elements['safety-label'].textContent = (run.ai === 'mocked' ? 'AI จำลอง · ไม่มีการเรียก AI สด' : 'ไม่ได้ใช้ AI') + ' · production mutations: ' + run.productionMutations;
      elements['summary-scenarios'].textContent = String(run.summary.scenarios);
      elements['summary-passed'].textContent = String(run.summary.passed);
      elements['summary-failed'].textContent = String(run.summary.failed);
      elements['summary-checks'].textContent = String(run.summary.checks);
      const runStatus = badge(run.status);
      elements['run-status'].replaceWith(runStatus);
      elements['run-status'] = runStatus;
      elements['run-limitations'].replaceChildren(...run.limitations.map((item) => node('li', '', item)));
      populateDomainFilter();
      refreshScenarioOptions();
      renderHistory();
      render();

      elements['play-toggle'].addEventListener('click', () => {
        if (timer !== null) { stopPlaying(); return; }
        const scenario = currentScenario();
        if (stepIndex >= scenario.steps.length - 1) return;
        elements['play-toggle'].textContent = 'หยุดชั่วคราว';
        elements['play-toggle'].setAttribute('aria-pressed', 'true');
        timer = window.setInterval(() => {
          const current = currentScenario();
          if (stepIndex >= current.steps.length - 1) { stopPlaying(); return; }
          stepIndex += 1;
          render();
          if (stepIndex >= current.steps.length - 1) stopPlaying();
        }, 1_600);
      });
      elements['previous-step'].addEventListener('click', () => { stopPlaying(); stepIndex = Math.max(0, stepIndex - 1); render(); });
      elements['next-step'].addEventListener('click', () => { stopPlaying(); stepIndex = Math.min(currentScenario().steps.length - 1, stepIndex + 1); render(); });
      elements['restart-replay'].addEventListener('click', () => { stopPlaying(); stepIndex = 0; render(); });
      elements['scenario-picker'].addEventListener('change', () => {
        stopPlaying(); activeScenarioId = elements['scenario-picker'].value; stepIndex = 0; render();
      });
      elements['domain-filter'].addEventListener('change', () => {
        stopPlaying();
        const domain = elements['domain-filter'].value;
        filteredScenarios = domain === 'all' ? run.scenarios.slice() : run.scenarios.filter((scenario) => scenario.domain === domain);
        if (!filteredScenarios.some((scenario) => scenario.id === activeScenarioId)) activeScenarioId = filteredScenarios[0].id;
        stepIndex = 0;
        refreshScenarioOptions();
        render();
      });
    })();
  </script>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/auto-demo-report.mjs <run.json> --output <report.html> [--history <sanitized-hosted-history.json>]');
    return;
  }
  const inputPath = resolve(args.input);
  const outputPath = resolve(args.output);
  const historyPath = args.history ? resolve(args.history) : null;
  const normalize = (path) => process.platform === 'win32' ? path.toLowerCase() : path;
  if (normalize(inputPath) === normalize(outputPath) || (historyPath && normalize(historyPath) === normalize(outputPath))) {
    fail('The output path must differ from every input path.');
  }
  const run = sanitizeRun(await readJson(inputPath));
  const history = historyPath ? sanitizeHistory(await readJson(historyPath)) : null;
  const html = htmlFor({ run, history });
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html, { encoding: 'utf8', flag: 'wx' });
  console.log(`Wrote offline replay report to ${outputPath}`);
}

main().catch((error) => {
  console.error(`auto-demo-report: ${error.message}`);
  process.exitCode = 1;
});
