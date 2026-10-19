import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare } from 'miniflare';
import { scenarios as catalog } from './catalog.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'test-results', 'auto-demo');
const ORIGIN = 'https://tabletop.test';
const WORKER_NAME = 'tabletop-r1-auto-demo';
const SQLITE_SCRIPT_NAME = WORKER_NAME;
const RUN_ID = randomUUID();
const STARTED_AT = new Date().toISOString();
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const safeCode = (value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,79}$/u.test(value) ? value : 'UNEXPECTED_RESULT';
const stopScenario = Symbol('stopScenario');
const GIT_SAFE_ROOT = REPO_ROOT.replaceAll('\\', '/');

function sourceCommit() {
  try {
    const value = execFileSync('git', ['-c', `safe.directory=${GIT_SAFE_ROOT}`, 'rev-parse', 'HEAD'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[a-f0-9]{7,40}$/u.test(value) ? value : 'unknown';
  } catch {
    return 'unknown';
  }
}

function sourceIsDirty() {
  try {
    return execFileSync('git', ['-c', `safe.directory=${GIT_SAFE_ROOT}`, 'status', '--porcelain', '--untracked-files=all'], { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().length > 0;
  } catch {
    return true;
  }
}

function safeRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value
    : {};
}

function getErrorCode(body) {
  return safeCode(safeRecord(body).errorCode);
}

function checksFor(entries) {
  return entries.map(([label, passed]) => ({ label, passed: Boolean(passed) }));
}

function addStep(scenario, input) {
  const checks = checksFor(input.checks);
  const passed = checks.every((check) => check.passed);
  const status = passed ? (input.expectedRejection ? 'expected-rejection' : 'passed') : 'failed';
  scenario.steps.push({
    index: scenario.steps.length + 1,
    label: input.label,
    actor: input.actor,
    command: input.command,
    status,
    expected: input.expected,
    observed: input.observed,
    ...(input.checkpoint === undefined ? {} : { checkpoint: input.checkpoint }),
    checks,
  });
  if (!passed) {
    scenario.status = 'failed';
    throw stopScenario;
  }
}

function apiErrorText(body) {
  return getErrorCode(body);
}

async function parseJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function apiClient(miniflare) {
  return async function request(actor, pathname, options = {}) {
    const headers = new Headers({
      Origin: ORIGIN,
      'Sec-Fetch-Site': 'same-origin',
      Cookie: `__Host-tabletop_session=${actor.token}`,
    });
    if (options.body !== undefined) {
      headers.set('Content-Type', 'application/json');
      headers.set('X-CSRF-Token', actor.csrf);
    }
    const response = await miniflare.dispatchFetch(`${ORIGIN}${pathname}`, {
      method: options.method ?? 'GET',
      headers,
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: options.raw ? await response.text() : await parseJson(response),
    };
  };
}

async function createActor(db, name) {
  const actorId = randomUUID();
  const token = randomBytes(32).toString('base64url');
  const csrf = createHash('sha256').update(`tabletop-csrf-v1:${token}`).digest('base64url');
  const now = Date.now();
  await db.prepare(`INSERT INTO users(id, provider_sub, email, name, is_admin, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`).bind(actorId, `auto-demo:${actorId}`, `${actorId}@example.test`, name, now).run();
  await db.prepare(`INSERT INTO web_sessions(token_hash, csrf_hash, user_id, created_at, last_seen_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)`).bind(sha256(token), sha256(csrf), actorId, now, now, now + 7 * 24 * 60 * 60 * 1000).run();
  return { id: actorId, name, token, csrf };
}

async function createWorkspace(request, actor, kind) {
  const result = await request(actor, '/api/workspaces', {
    method: 'POST', body: { kind, title: 'Auto demo local fixture' },
  });
  if (result.status !== 201) throw new Error(`WORKSPACE_CREATE_${result.status}_${apiErrorText(result.body)}`);
  return result.body;
}

async function readWorkspace(request, actor, workspaceId) {
  const result = await request(actor, `/api/workspaces/${workspaceId}`);
  if (result.status !== 200) throw new Error(`WORKSPACE_READ_${result.status}_${apiErrorText(result.body)}`);
  return result.body;
}

async function command(request, actor, workspace, type, payload, commandId = randomUUID()) {
  const envelope = {
    commandId,
    expectedRevision: workspace.revision,
    expectedEpoch: workspace.epoch,
    type,
    payload,
  };
  const result = await request(actor, `/api/workspaces/${workspace.id}/commands`, { method: 'POST', body: envelope });
  return { ...result, envelope };
}

function ackWorkspace(result) {
  const body = safeRecord(result.body);
  const workspace = body.workspace;
  if (result.status !== 200 || !safeRecord(workspace).id) return null;
  return workspace;
}

async function successfulCommandStep(request, scenario, actor, workspace, type, payload, details) {
  const result = await command(request, actor, workspace, type, payload);
  const next = ackWorkspace(result);
  const additionalChecks = (details.checks ?? []).map(([label, check]) => [
    label,
    typeof check === 'function' ? (next === null ? false : check(next)) : check,
  ]);
  addStep(scenario, {
    ...details,
    actor: details.actor ?? actor.name,
    command: type,
    observed: result.status === 200 ? 'Command accepted by the local Worker.' : `Rejected with ${apiErrorText(result.body)}.`,
    checks: [
      ['HTTP command accepted', result.status === 200],
      ['Workspace acknowledgement returned', next !== null],
      ...additionalChecks,
    ],
    checkpoint: typeof details.checkpoint === 'function' && next ? details.checkpoint(next) : details.checkpoint,
  });
  return next;
}

async function expectedRejectionStep(request, scenario, actor, workspace, type, payload, details) {
  const result = await command(request, actor, workspace, type, payload);
  const code = apiErrorText(result.body);
  addStep(scenario, {
    ...details,
    actor: details.actor ?? actor.name,
    command: type,
    status: 'expected-rejection',
    expectedRejection: true,
    observed: `Rejected with ${code} (HTTP ${result.status}).`,
    checks: [
      ['HTTP rejection status matches', result.status === details.status],
      ['Typed error matches', code === details.errorCode],
      ...(details.checks ?? []),
    ],
  });
  return result;
}

async function createAndInvite(request, owner, workspaceId, seat, member) {
  const invitation = await request(owner, `/api/workspaces/${workspaceId}/invites`, {
    method: 'POST', body: { seat },
  });
  if (invitation.status !== 201 || typeof safeRecord(invitation.body).ticket !== 'string') {
    throw new Error(`INVITE_CREATE_${invitation.status}_${apiErrorText(invitation.body)}`);
  }
  const redeemed = await request(member, '/api/invites/redeem', {
    method: 'POST', body: { ticket: invitation.body.ticket },
  });
  if (redeemed.status !== 200 || !safeRecord(redeemed.body).id) {
    throw new Error(`INVITE_REDEEM_${redeemed.status}_${apiErrorText(redeemed.body)}`);
  }
  return redeemed.body;
}

function invoiceCheckpoint(domain) {
  if (safeRecord(domain).kind !== 'invoice') return {};
  const invoice = safeRecord(domain);
  const run = Array.isArray(invoice.runs) ? safeRecord(invoice.runs.at(-1)) : {};
  const result = safeRecord(run.result);
  return {
    ruleRevision: Number.isSafeInteger(invoice.ruleRevision) ? invoice.ruleRevision : undefined,
    ...(Object.keys(result).length === 0 ? {} : {
      totals: {
        expectedSatang: Number.isSafeInteger(result.knownExpectedSatang) ? result.knownExpectedSatang : undefined,
        deltaSatang: Number.isSafeInteger(result.deltaSatang) ? result.deltaSatang : undefined,
        unknownCount: Number.isSafeInteger(result.unknownCount) ? result.unknownCount : undefined,
      },
    }),
  };
}

function teachingPhysicsCheckpoint(domain) {
  if (safeRecord(domain).kind !== 'teaching') return {};
  const params = safeRecord(safeRecord(domain).parameters);
  const force = Number(params.force);
  const mass = Number(params.mass);
  const time = Number(params.time);
  if (![force, mass, time].every(Number.isFinite) || mass <= 0) return {};
  const acceleration = force / mass;
  return { physics: { force, mass, time, acceleration, velocity: acceleration * time, position: 0.5 * acceleration * time * time } };
}

function encounterCheckpoint(domain) {
  if (safeRecord(domain).kind !== 'encounter') return {};
  const encounter = safeRecord(domain);
  const characters = Array.isArray(encounter.characters) ? encounter.characters : [];
  return {
    ruleRevision: Number.isSafeInteger(encounter.ruleRevision) ? encounter.ruleRevision : undefined,
    characters: characters.filter((character) => ['mira', 'pip'].includes(safeRecord(character).id)).map((character) => ({
      name: safeRecord(character).id === 'mira' ? 'Mira' : 'Pip',
      hp: Number(safeRecord(character).hp),
      ap: Number(safeRecord(character).ap),
    })),
  };
}

function scenarioFromManifest(manifest) {
  return { ...structuredClone(manifest), status: 'passed', steps: [] };
}

function addInfrastructureFailure(record, id, label, expected, observed) {
  record.scenarios.push({
    id,
    title: 'Local auto-demo infrastructure check',
    domain: 'teaching',
    persona: { name: 'local runner', role: 'test harness', goal: 'keep the run isolated and report all infrastructure failures' },
    prompt: 'Verify that the local test harness completed safely.',
    expectedOutcome: expected,
    status: 'failed',
    steps: [{
      index: 1,
      label,
      actor: 'local runner',
      command: 'runner infrastructure check',
      status: 'failed',
      expected,
      observed,
      checks: [{ label: 'Infrastructure check passed', passed: false }],
    }],
  });
}

function updateSummary(record) {
  record.summary = {
    scenarios: record.scenarios.length,
    passed: record.scenarios.filter((scenario) => scenario.status === 'passed').length,
    failed: record.scenarios.filter((scenario) => scenario.status === 'failed').length,
    checks: record.scenarios.reduce((total, scenario) => total + scenario.steps.reduce((sum, step) => sum + step.checks.length, 0), 0),
  };
}

function recordReadStep(scenario, result, details) {
  addStep(scenario, {
    ...details,
    observed: result.status === 200 ? 'Authorized projection returned.' : `Request returned ${result.status} ${apiErrorText(result.body)}.`,
    checks: [
      ['Authorized read returned HTTP 200', result.status === 200],
      ...(details.checks ?? []),
    ],
  });
  return result.body;
}

async function runInvoiceEvidence(request, db, scenario) {
  const owner = await createActor(db, 'คุณอ้อม');
  const workspace = await createWorkspace(request, owner, 'invoice');
  const saved = await successfulCommandStep(request, scenario, owner, workspace, 'invoice.saveRun', {}, {
    label: 'บันทึกผลจากหลักฐานตัวอย่างที่ตรวจแล้ว',
    expected: 'ยอดที่คำนวณได้และจำนวนแถวที่ยังไม่ทราบถูกเก็บเป็น run',
    checks: [
      ['Two fixture rows remain unknown', (view) => safeRecord(view.domain).kind === 'invoice'
        && safeRecord(safeRecord(safeRecord(view.domain).runs?.at(-1)).result).unknownCount === 2],
      ['Known fixture expected total is 8500 satang', (view) => safeRecord(safeRecord(safeRecord(view.domain).runs?.at(-1)).result).knownExpectedSatang === 8_500],
      ['Missing remote evidence stays explicit', (view) => Array.isArray(safeRecord(view.domain).runs?.at(-1)?.result?.gaps)
        && view.domain.runs.at(-1).result.gaps.some((gap) => safeRecord(gap).status === 'missing')],
    ],
    checkpoint: (view) => invoiceCheckpoint(view.domain),
  });
  const read = await request(owner, `/api/workspaces/${saved.id}`);
  const view = recordReadStep(scenario, read, {
    label: 'ตรวจยอดและช่องว่างหลักฐานในมุมมองเจ้าของ',
    actor: owner.name,
    command: 'GET workspace projection',
    expected: 'run มี 2 unknown rows และ known expected 8500 satang',
    checks: [
      ['Saved run remains available after a fresh GET', safeRecord(safeRecord(safeRecord(safeRecord(read.body).domain).runs?.at(-1)).result).unknownCount === 2],
      ['Known total remains 8500 satang after a fresh GET', invoiceCheckpoint(safeRecord(read.body).domain).totals?.expectedSatang === 8_500],
      ['Only safe aggregate checkpoint is recorded', invoiceCheckpoint(safeRecord(read.body).domain).totals?.unknownCount === 2],
    ],
    checkpoint: invoiceCheckpoint(safeRecord(read.body).domain),
  });
  assert.equal(safeRecord(view.domain).kind, 'invoice');
}

async function runInvoiceLifecycle(request, db, scenario) {
  const owner = await createActor(db, 'คุณนก');
  let workspace = await createWorkspace(request, owner, 'invoice');
  const boundedChange = {
    kind: 'invoice',
    operations: [{ op: 'setEffectiveWindow', id: 'base-bangkok-before-15', from: '2026-10-14', to: '2026-10-15' }],
  };
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.propose', { change: boundedChange }, {
    label: 'เสนอช่วงวันที่จำกัดตามวันที่ตัวอย่างที่ทราบ',
    expected: 'ผู้ดูแลบิลสร้าง candidate จากกติกาและแหล่งข้อมูลตัวอย่างที่ตรวจแล้ว',
    checks: [['Candidate created without changing the active rule', (view) => safeRecord(view.domain).candidate?.status === 'draft'
      && safeRecord(view.domain).ruleRevision === 0]],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.simulate', {}, {
    label: 'จำลองผลก่อนและหลัง',
    expected: 'จำลองที่คำนวณซ้ำได้โดยยังไม่เปลี่ยนกติกาที่ใช้งาน',
    checks: [['Simulation saved and Active unchanged', (view) => safeRecord(view.domain).candidate?.simulation !== null
      && safeRecord(view.domain).candidate?.status === 'simulated'
      && safeRecord(view.domain).ruleRevision === 0]],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.validate', {}, {
    label: 'ตรวจ candidate ด้วยชุดตรวจโดเมน',
    expected: 'หลักฐานตรวจ candidate ผ่านทุกข้อ',
    checks: [['All candidate validation checks passed', (view) => safeRecord(view.domain).candidate?.proof?.passed === true]],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.approve', {}, {
    label: 'เจ้าของอนุมัติ candidate ที่ตรวจแล้ว',
    expected: 'มี approval ที่ผูกกับ candidate และ proof ปัจจุบัน',
    checks: [['Human approval recorded', (view) => safeRecord(view.domain).candidate?.status === 'approved'
      && safeRecord(view.domain).candidate?.approval?.revoked === false]],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.activate', {}, {
    label: 'เปิดใช้ช่วงวันที่ที่อนุมัติ',
    expected: 'rule revision เพิ่มหนึ่งขั้นและช่วงวันที่มีจุดเริ่มกับจุดสิ้นสุด',
    checks: [
      ['Rule revision incremented once', (view) => safeRecord(view.domain).ruleRevision === 1],
      ['Bounded dates persisted', (view) => safeRecord(view.domain).rules?.some((rule) => safeRecord(rule).id === 'base-bangkok-before-15'
        && safeRecord(rule).from === '2026-10-14' && safeRecord(rule).to === '2026-10-15')],
    ],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'invoice.saveRun', {}, {
    label: 'บันทึกผลหลังเปิดใช้กติกา',
    expected: 'ผลรวมเดิมยังแสดง unknown สองแถว เพราะ fixture ไม่มีอัตราพื้นที่ห่างไกล',
    checks: [
      ['Saved run matches known fixture unknown count', (view) => safeRecord(safeRecord(safeRecord(view.domain).runs?.at(-1)).result).unknownCount === 2],
      ['Rule revision recorded in run', (view) => safeRecord(safeRecord(view.domain).runs?.at(-1)).ruleRevision === 1],
    ],
    checkpoint: (view) => invoiceCheckpoint(view.domain),
  });
  const exported = await request(owner, `/api/workspaces/${workspace.id}/export?format=csv`, { raw: true });
  const exportText = typeof exported.body === 'string' ? exported.body : '';
  addStep(scenario, {
    label: 'ส่งออก CSV ที่ได้รับสิทธิ์',
    actor: owner.name,
    command: 'GET invoice export CSV',
    expected: 'เจ้าของได้รับ CSV ที่มีหัวคอลัมน์ shipment_id',
    observed: exported.status === 200 ? 'CSV export returned with the expected header.' : `Export returned HTTP ${exported.status}.`,
    checks: [
      ['Export returned HTTP 200', exported.status === 200],
      ['Export uses CSV content type', exported.headers.get('content-type')?.includes('text/csv') === true],
      ['CSV header is present', exportText.replace(/^\uFEFF/u, '').startsWith('"shipment_id","date",')],
    ],
  });
}

async function runInvoiceOverlap(request, db, scenario) {
  const owner = await createActor(db, 'คุณก้อง');
  let workspace = await createWorkspace(request, owner, 'invoice');
  const overlap = {
    kind: 'invoice',
    operations: [{ op: 'setZoneBase', id: 'base-bangkok-overlap-check', zone: 'bangkok', amountSatang: 4_200,
      from: '2026-10-14', to: '2026-10-15', sourceId: 'sample_rate_card' }],
  };
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.propose', { change: overlap }, {
    label: 'เสนอช่วงที่ซ้อนกับอัตราฐานเดิม',
    expected: 'ข้อเสนอเก็บเป็น draft เพื่อให้ validator ตรวจข้อขัดแย้ง',
    checks: [['Active rule revision stays unchanged', (view) => safeRecord(view.domain).ruleRevision === 0]],
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.simulate', {}, {
    label: 'จำลองข้อเสนอที่ซ้อน', expected: 'เก็บผลจำลองก่อนการตรวจข้อจำกัด',
    checks: [['Candidate simulation exists', (view) => safeRecord(view.domain).candidate?.simulation !== null]],
  });
  workspace = await successfulCommandStep(request, scenario, owner, workspace, 'evolve.validate', {}, {
    label: 'ปฏิเสธข้อเสนอจากข้อจำกัดของกติกา', expected: 'proof ระบุว่า candidate ไม่ผ่าน และ Active ยัง revision 0',
    checks: [
      ['Trusted proof blocks the overlapping rule', (view) => safeRecord(view.domain).candidate?.proof?.passed === false],
      ['Active rule revision remains zero', (view) => safeRecord(view.domain).ruleRevision === 0],
    ],
  });
  const priorRunCount = Array.isArray(safeRecord(workspace.domain).runs) ? safeRecord(workspace.domain).runs.length : 0;
  const firstId = randomUUID();
  const envelope = { commandId: firstId, expectedRevision: workspace.revision, expectedEpoch: workspace.epoch,
    type: 'invoice.saveRun', payload: {} };
  const first = await request(owner, `/api/workspaces/${workspace.id}/commands`, { method: 'POST', body: envelope });
  const firstWorkspace = ackWorkspace(first);
  addStep(scenario, {
    label: 'บันทึก run ด้วย command receipt', actor: owner.name, command: 'invoice.saveRun',
    expected: 'คำสั่งแรกสำเร็จและบันทึก receipt', observed: firstWorkspace ? 'Command accepted with a new receipt.' : `Rejected with ${apiErrorText(first.body)}.`,
    checkpoint: firstWorkspace ? invoiceCheckpoint(firstWorkspace.domain) : undefined,
    checks: [['First command committed', first.status === 200 && firstWorkspace !== null], ['Command is not marked duplicate', safeRecord(first.body).duplicate === false]],
  });
  const replay = await request(owner, `/api/workspaces/${workspace.id}/commands`, { method: 'POST', body: envelope });
  addStep(scenario, {
    label: 'ลองคำสั่งเดิมซ้ำหลัง response แรก', actor: owner.name, command: 'invoice.saveRun retry',
    expected: 'ได้รับ receipt เดิมโดยไม่มี run ซ้ำ', observed: replay.status === 200 ? 'Existing command receipt returned.' : `Rejected with ${apiErrorText(replay.body)}.`,
    checks: [['Replay is accepted', replay.status === 200], ['Replay is marked duplicate', safeRecord(replay.body).duplicate === true]],
  });
  const afterReplay = await request(owner, `/api/workspaces/${workspace.id}`);
  const afterReplayWorkspace = safeRecord(afterReplay.body);
  addStep(scenario, {
    label: 'ตรวจ run และ revision หลังลองซ้ำ', actor: owner.name, command: 'GET workspace projection',
    expected: 'มี run ใหม่เพียงหนึ่งรายการและ revision ไม่เปลี่ยนจาก receipt แรก',
    observed: afterReplay.status === 200 ? 'Fresh projection confirms the replay did not write again.' : `Read returned HTTP ${afterReplay.status}.`,
    checkpoint: invoiceCheckpoint(afterReplayWorkspace.domain),
    checks: [
      ['Fresh GET returned HTTP 200', afterReplay.status === 200],
      ['Exactly one run was added', safeRecord(afterReplayWorkspace.domain).runs?.length === priorRunCount + 1],
      ['Projected revision is unchanged after replay', afterReplayWorkspace.revision === firstWorkspace?.revision],
      ['Data revision is unchanged after replay', safeRecord(afterReplayWorkspace.domain).dataRevision === safeRecord(firstWorkspace?.domain).dataRevision],
    ],
  });
  const mismatch = await request(owner, `/api/workspaces/${workspace.id}/commands`, { method: 'POST', body: {
    ...envelope, payload: { unexpected: true },
  } });
  addStep(scenario, {
    label: 'ปฏิเสธการใช้ command ID เดิมกับ payload อื่น', actor: owner.name, command: 'invoice.saveRun mismatched retry',
    expected: 'ระบบปฏิเสธการใช้ command ID ซ้ำกับข้อมูลคนละชุด', observed: `Rejected with ${apiErrorText(mismatch.body)}.`,
    status: 'expected-rejection', expectedRejection: true,
    checks: [['Mismatch returns HTTP 409', mismatch.status === 409], ['Mismatch has typed error', apiErrorText(mismatch.body) === 'IDEMPOTENCY_MISMATCH']],
  });
  const afterMismatch = await request(owner, `/api/workspaces/${workspace.id}`);
  const afterMismatchWorkspace = safeRecord(afterMismatch.body);
  addStep(scenario, {
    label: 'ตรวจ run และ revision หลัง payload conflict', actor: owner.name, command: 'GET workspace projection',
    expected: 'payload ที่ขัดกับ receipt ไม่เพิ่ม run หรือเปลี่ยน revision',
    observed: afterMismatch.status === 200 ? 'Fresh projection confirms the conflict left state unchanged.' : `Read returned HTTP ${afterMismatch.status}.`,
    checkpoint: invoiceCheckpoint(afterMismatchWorkspace.domain),
    checks: [
      ['Fresh GET returned HTTP 200', afterMismatch.status === 200],
      ['Run count remains unchanged after conflict', safeRecord(afterMismatchWorkspace.domain).runs?.length === priorRunCount + 1],
      ['Projected revision is unchanged after conflict', afterMismatchWorkspace.revision === firstWorkspace?.revision],
      ['Data revision is unchanged after conflict', safeRecord(afterMismatchWorkspace.domain).dataRevision === safeRecord(firstWorkspace?.domain).dataRevision],
    ],
  });
}

async function runTeachingExperiments(request, db, scenario) {
  const teacher = await createActor(db, 'ครูเมย์');
  const learnerOne = await createActor(db, 'ผู้เรียนฟ้า');
  const learnerTwo = await createActor(db, 'ผู้เรียนต้น');
  let teacherView = await createWorkspace(request, teacher, 'teaching');
  await createAndInvite(request, teacher, teacherView.id, 'learner-1', learnerOne);
  await createAndInvite(request, teacher, teacherView.id, 'learner-2', learnerTwo);
  const oneSession = await request(learnerOne, '/api/session');
  const twoSession = await request(learnerTwo, '/api/session');
  const learnerOneId = safeRecord(oneSession.body).actorId;
  const learnerTwoId = safeRecord(twoSession.body).actorId;
  teacherView = await readWorkspace(request, teacher, teacherView.id);
  teacherView = await successfulCommandStep(request, scenario, teacher, teacherView, 'teaching.setParameters', { force: 10, mass: 5, time: 2 }, {
    label: 'ครูตั้งค่าบทเรียนเดียวกันให้ทั้งห้อง', expected: 'บทเรียน revision 1 ให้ acceleration 2, velocity 4, position 4',
    checks: [
      ['Shared rule revision advances', (view) => safeRecord(view.domain).ruleRevision === 1],
      ['Derived physics matches deterministic equation', (view) => {
        const checkpoint = teachingPhysicsCheckpoint(view.domain).physics;
        return checkpoint?.acceleration === 2 && checkpoint?.velocity === 4 && checkpoint?.position === 4;
      }],
    ],
    checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  teacherView = await successfulCommandStep(request, scenario, teacher, teacherView, 'teaching.setRepresentation', {
    actorId: learnerOneId, representation: 'graph', difficulty: 'advanced',
  }, {
    label: 'ครูกำหนดกราฟระดับสูงให้ผู้เรียนฟ้า', expected: 'มุมมองเฉพาะตัวถูกเก็บโดยไม่เปลี่ยนค่าบทเรียน',
    checks: [['Rule revision remains shared revision 1', (view) => safeRecord(view.domain).ruleRevision === 1]],
    checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  const learnerOnePreferences = await request(learnerOne, `/api/workspaces/${teacherView.id}`);
  const learnerTwoPreferences = await request(learnerTwo, `/api/workspaces/${teacherView.id}`);
  const learnerOnePreferenceDomain = safeRecord(learnerOnePreferences.body).domain;
  const learnerTwoPreferenceDomain = safeRecord(learnerTwoPreferences.body).domain;
  addStep(scenario, {
    label: 'ตรวจกราฟที่ครูกำหนดในมุมมองผู้เรียน', actor: teacher.name, command: 'GET authorized learner projections',
    expected: 'ฟ้าเห็นกราฟระดับสูงที่ครูกำหนด; ต้นยังไม่มีค่ามุมมองส่วนตัวที่ถูกกำหนดให้ฟ้า',
    observed: learnerOnePreferences.status === 200 && learnerTwoPreferences.status === 200
      ? 'Fresh learner projections confirm the targeted setting and peer isolation.' : 'One or more learner projections could not be read.',
    checkpoint: { privateFieldsHidden: true },
    checks: [
      ['Learner one GET returned HTTP 200', learnerOnePreferences.status === 200],
      ['Learner two GET returned HTTP 200', learnerTwoPreferences.status === 200],
      ['Learner one sees its targeted graph and advanced difficulty',
        safeRecord(safeRecord(learnerOnePreferenceDomain).representations)[learnerOneId] === 'graph'
          && safeRecord(safeRecord(learnerOnePreferenceDomain).difficulties)[learnerOneId] === 'advanced'],
      ['Learner two has no setting assigned to learner one',
        !Object.hasOwn(safeRecord(safeRecord(learnerTwoPreferenceDomain).representations), learnerOneId)
          && !Object.hasOwn(safeRecord(safeRecord(learnerTwoPreferenceDomain).difficulties), learnerOneId)],
    ],
  });
  teacherView = await successfulCommandStep(request, scenario, teacher, teacherView, 'teaching.saveNote', {
    text: 'AUTO_DEMO_PRIVATE_TEACHER_NOTE_SENTINEL',
  }, {
    label: 'ครูบันทึกหมายเหตุส่วนตัว', expected: 'หมายเหตุอยู่ในมุมมองครูและซ่อนจากผู้เรียนทั้งสองคน',
    checks: [['Teacher private note written', (view) => safeRecord(view.domain).teacherNote === 'AUTO_DEMO_PRIVATE_TEACHER_NOTE_SENTINEL']],
  });
  let oneView = await readWorkspace(request, learnerOne, teacherView.id);
  const questionId = safeRecord(oneView.domain).questionId;
  const lessonRevision = safeRecord(oneView.domain).ruleRevision;
  oneView = await successfulCommandStep(request, scenario, learnerOne, oneView, 'teaching.answer', {
    questionId, lessonRevision, value: 4,
  }, {
    label: 'ผู้เรียนฟ้าส่งคำตอบของตนเอง', expected: 'มีคำตอบของฟ้าในมุมมองฟ้าเท่านั้น; ข้อมูลครูไม่ปรากฏ',
    checks: [
      ['Learner one answer is visible to its actor', (view) => safeRecord(view.domain).answers?.length === 1
        && safeRecord(view.domain).answers[0]?.correct === true],
      ['Teacher note is hidden from learner one', (view) => !Object.hasOwn(safeRecord(view.domain), 'teacherNote')],
    ],
    checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), privateFieldsHidden: !Object.hasOwn(safeRecord(view.domain), 'teacherNote') }),
  });
  let twoView = await readWorkspace(request, learnerTwo, teacherView.id);
  twoView = await successfulCommandStep(request, scenario, learnerTwo, twoView, 'teaching.answer', {
    questionId: safeRecord(twoView.domain).questionId,
    lessonRevision: safeRecord(twoView.domain).ruleRevision,
    value: 4,
  }, {
    label: 'ผู้เรียนต้นส่งคำตอบแยกจากฟ้า', expected: 'มุมมองของต้นมีเฉพาะคำตอบของต้น',
    checks: [
      ['Learner two answer is visible to its actor', (view) => safeRecord(view.domain).answers?.length === 1
        && safeRecord(view.domain).answers[0]?.correct === true],
      ['Other learner answer is hidden', (view) => safeRecord(view.domain).answers?.every((answer) => safeRecord(answer).actorId !== learnerOneId)],
      ['Teacher note is hidden from learner two', (view) => !Object.hasOwn(safeRecord(view.domain), 'teacherNote')],
    ],
    checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), privateFieldsHidden: !Object.hasOwn(safeRecord(view.domain), 'teacherNote') }),
  });
  const currentTeacher = await readWorkspace(request, teacher, teacherView.id);
  const learnerOneLatest = await request(learnerOne, `/api/workspaces/${teacherView.id}`);
  const learnerTwoLatest = await request(learnerTwo, `/api/workspaces/${teacherView.id}`);
  const learnerOneLatestDomain = safeRecord(learnerOneLatest.body).domain;
  const learnerTwoLatestDomain = safeRecord(learnerTwoLatest.body).domain;
  const learnerOneAnswers = Array.isArray(safeRecord(learnerOneLatestDomain).answers) ? safeRecord(learnerOneLatestDomain).answers : [];
  const learnerTwoAnswers = Array.isArray(safeRecord(learnerTwoLatestDomain).answers) ? safeRecord(learnerTwoLatestDomain).answers : [];
  const privateFieldsHidden = !Object.hasOwn(safeRecord(learnerOneLatestDomain), 'teacherNote')
    && !Object.hasOwn(safeRecord(learnerTwoLatestDomain), 'teacherNote')
    && learnerOneAnswers.every((answer) => safeRecord(answer).actorId !== learnerTwoId)
    && learnerTwoAnswers.every((answer) => safeRecord(answer).actorId !== learnerOneId);
  addStep(scenario, {
    label: 'ตรวจว่าคำตอบของผู้เรียนทั้งสองยังแยกกัน', actor: teacher.name, command: 'GET authorized projections',
    expected: 'ครูเห็นคำตอบ 2 รายการโดยไม่บันทึกเนื้อหาส่วนตัวลงรายงาน',
    observed: learnerOneLatest.status === 200 && learnerTwoLatest.status === 200
      ? 'Fresh learner projections contain only each learner’s own answer; report stores visibility checks.' : 'One or more learner projections could not be read.',
    checks: [
      ['Teacher sees two answers', safeRecord(currentTeacher.domain).answers?.length === 2],
      ['Learner one fresh GET returned HTTP 200', learnerOneLatest.status === 200],
      ['Learner two fresh GET returned HTTP 200', learnerTwoLatest.status === 200],
      ['Learner one sees only its own correct answer', learnerOneAnswers.length === 1
        && safeRecord(learnerOneAnswers[0]).actorId === learnerOneId && safeRecord(learnerOneAnswers[0]).correct === true],
      ['Learner two sees only its own correct answer', learnerTwoAnswers.length === 1
        && safeRecord(learnerTwoAnswers[0]).actorId === learnerTwoId && safeRecord(learnerTwoAnswers[0]).correct === true],
      ['Peer answers and teacher note stay hidden', privateFieldsHidden],
    ],
    checkpoint: { privateFieldsHidden },
  });
  assert.equal(safeRecord(learnerOneAnswers[0]).actorId, learnerOneId);
  assert.equal(safeRecord(learnerTwoAnswers[0]).actorId, learnerTwoId);
}

async function runTeachingStaleAndRoles(request, db, scenario) {
  const teacher = await createActor(db, 'ครูเมย์');
  const learner = await createActor(db, 'ผู้เรียนต้น');
  let teacherView = await createWorkspace(request, teacher, 'teaching');
  await createAndInvite(request, teacher, teacherView.id, 'learner-1', learner);
  teacherView = await readWorkspace(request, teacher, teacherView.id);
  const oldQuestion = safeRecord(safeRecord(teacherView.domain)).questionId;
  const oldRevision = safeRecord(safeRecord(teacherView.domain)).ruleRevision;
  teacherView = await successfulCommandStep(request, scenario, teacher, teacherView, 'teaching.setParameters', {
    force: 10, mass: 5, time: 2,
  }, {
    label: 'ครูเปลี่ยนบทเรียนหลังมีโจทย์เดิม', expected: 'มี question ใหม่และ rule revision เพิ่ม',
    checks: [['Question changes after lesson update', (view) => safeRecord(view.domain).questionId !== oldQuestion],
      ['Lesson rule revision is one', (view) => safeRecord(view.domain).ruleRevision === 1]],
    checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), ruleRevision: safeRecord(view.domain).ruleRevision }),
  });
  const learnerView = await readWorkspace(request, learner, teacherView.id);
  await expectedRejectionStep(request, scenario, learner, learnerView, 'teaching.answer', {
    questionId: oldQuestion, lessonRevision: oldRevision, value: 10,
  }, {
    label: 'ปฏิเสธคำตอบที่ใช้โจทย์เก่า', expected: 'STALE_LESSON พร้อมให้ผู้เรียนโหลดโจทย์ปัจจุบัน',
    errorCode: 'STALE_LESSON', status: 409,
  });
  await expectedRejectionStep(request, scenario, learner, learnerView, 'teaching.setParameters', {
    force: 0, mass: 1, time: 2,
  }, {
    label: 'ปฏิเสธผู้เรียนที่พยายามแก้บทเรียน', expected: 'ROLE_FORBIDDEN ก่อน reducer เปลี่ยน state',
    errorCode: 'ROLE_FORBIDDEN', status: 403,
  });
}

async function runTeachingInvalidPhysics(request, db, scenario) {
  const teacher = await createActor(db, 'ครูเมย์');
  const workspace = await createWorkspace(request, teacher, 'teaching');
  const before = teachingPhysicsCheckpoint(workspace.domain);
  await expectedRejectionStep(request, scenario, teacher, workspace, 'teaching.setParameters', {
    force: 10, mass: 0, time: 2,
  }, {
    label: 'ปฏิเสธค่ามวลศูนย์', expected: 'INVALID_COMMAND และ state เดิมยังคำนวณ position 10',
    errorCode: 'INVALID_COMMAND', status: 422,
  });
  const after = await readWorkspace(request, teacher, workspace.id);
  addStep(scenario, {
    label: 'ยืนยันว่า state ไม่ถูกเขียนทับ', actor: teacher.name, command: 'GET workspace projection',
    expected: 'บทเรียนยังมีค่าเดิม force 10, mass 2, time 2 และ position 10',
    observed: 'The original lesson values and projection were preserved.',
    checkpoint: teachingPhysicsCheckpoint(after.domain),
    checks: [
      ['Original physics output remains unchanged', JSON.stringify(teachingPhysicsCheckpoint(after.domain)) === JSON.stringify(before)],
      ['Rule revision remains zero', safeRecord(after.domain).ruleRevision === 0],
    ],
  });
}

async function activateEncounterRule(request, scenario, owner, workspace, rule) {
  let current = workspace;
  for (const [type, payload, stepLabel, expected] of [
    ['evolve.propose', { change: { kind: 'encounter', rule } }, 'เสนอ encounter rule', 'candidate ถูกสร้างโดยยังไม่เปลี่ยนกติกาใช้งาน'],
    ['evolve.simulate', {}, 'จำลอง encounter rule', 'มีผลจำลองที่ตรวจซ้ำได้'],
    ['evolve.validate', {}, 'ตรวจ encounter rule', 'proof ผ่าน invariant และ simulation'],
    ['evolve.approve', {}, 'เจ้าของอนุมัติ encounter rule', 'approval ผูกกับ proof ล่าสุด'],
    ['evolve.activate', {}, 'เปิดใช้ encounter rule', 'rule revision เพิ่มหนึ่งขั้น'],
  ]) {
    current = await successfulCommandStep(request, scenario, owner, current, type, payload, {
      label: stepLabel,
      expected,
      checks: type === 'evolve.validate'
        ? [['Validation proof passed', (view) => safeRecord(view.domain).candidate?.proof?.passed === true]]
        : type === 'evolve.activate'
          ? [['Rule revision is one', (view) => safeRecord(view.domain).ruleRevision === 1]]
          : [],
      checkpoint: (view) => ({ ruleRevision: safeRecord(view.domain).ruleRevision }),
    });
  }
  return current;
}

async function runEncounterShield(request, db, scenario) {
  const dm = await createActor(db, 'DM วิน');
  const mira = await createActor(db, 'ผู้เล่น Mira');
  const pip = await createActor(db, 'ผู้เล่น Pip');
  let workspace = await createWorkspace(request, dm, 'encounter');
  workspace = await activateEncounterRule(request, scenario, dm, workspace, { allyTarget: true, apCost: 1, oncePerTurn: true });
  await createAndInvite(request, dm, workspace.id, 'mira', mira);
  await createAndInvite(request, dm, workspace.id, 'pip', pip);
  workspace = await readWorkspace(request, dm, workspace.id);
  workspace = await successfulCommandStep(request, scenario, dm, workspace, 'encounter.declareHit', { target: 'pip' }, {
    label: 'Goblin เปิดหน้าต่างโจมตี Pip', expected: 'เปิด reaction window โดยยังไม่มีการลด HP',
    checks: [['Reaction window is open', (view) => safeRecord(view.domain).phase === 'reaction.open']],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  const miraView = await readWorkspace(request, mira, workspace.id);
  const maskedHit = safeRecord(miraView.domain).pendingHit;
  addStep(scenario, {
    label: 'ตรวจ projection ของ Mira ก่อนตอบโต้', actor: mira.name, command: 'GET authorized player projection',
    expected: 'roll และ damage ซ่อนจากผู้เล่น', observed: 'Player projection masks private hit values.',
    checkpoint: { privateFieldsHidden: safeRecord(maskedHit).roll === null && safeRecord(maskedHit).damage === null },
    checks: [
      ['Player roll is hidden', safeRecord(maskedHit).roll === null],
      ['Player damage is hidden', safeRecord(maskedHit).damage === null],
    ],
  });
  const shielded = await successfulCommandStep(request, scenario, mira, miraView, 'encounter.shield', { target: 'pip' }, {
    label: 'Mira ใช้เกราะช่วย Pip', expected: 'บันทึก reaction intent ตามกติกาที่ active',
    checks: [['One shield intent recorded', (view) => safeRecord(view.domain).pendingHit?.shields?.length === 1]],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  workspace = await readWorkspace(request, dm, workspace.id);
  workspace = await successfulCommandStep(request, scenario, dm, workspace, 'encounter.resolve', {}, {
    label: 'DM วิน resolve การโจมตี', expected: 'Pip ลด 2 HP และ Mira ใช้ AP หนึ่งแต้ม',
    checks: [
      ['Pip has 8 HP', (view) => safeRecord(view.domain).characters?.find((character) => safeRecord(character).id === 'pip')?.hp === 8],
      ['Mira has 1 AP', (view) => safeRecord(view.domain).characters?.find((character) => safeRecord(character).id === 'mira')?.ap === 1],
    ],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  assert.equal(safeRecord(shielded.domain).pendingHit?.shields?.length, 1);
}

async function runEncounterPause(request, db, scenario) {
  const dm = await createActor(db, 'DM วิน');
  const mira = await createActor(db, 'ผู้เล่น Mira');
  let workspace = await createWorkspace(request, dm, 'encounter');
  await createAndInvite(request, dm, workspace.id, 'mira', mira);
  workspace = await readWorkspace(request, dm, workspace.id);
  workspace = await successfulCommandStep(request, scenario, dm, workspace, 'encounter.declareHit', { target: 'mira' }, {
    label: 'เปิด reaction window ให้ Mira', expected: 'pending hit มีอยู่ก่อนพัก',
    checks: [['Reaction window is open', (view) => safeRecord(view.domain).pendingHit !== null]],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  workspace = await successfulCommandStep(request, scenario, dm, workspace, 'encounter.pause', {}, {
    label: 'DM พัก encounter', expected: 'paused state บันทึก remaining reaction time',
    checks: [['Encounter is paused', (view) => safeRecord(view.domain).paused !== undefined],
      ['Pending hit is preserved', (view) => safeRecord(view.domain).pendingHit !== null]],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  await expectedRejectionStep(request, scenario, dm, workspace, 'encounter.resolve', {}, {
    label: 'ปฏิเสธ resolve ระหว่างพัก', expected: 'ENCOUNTER_PAUSED; hit ยังไม่ถูก resolve',
    errorCode: 'ENCOUNTER_PAUSED', status: 422,
  });
  const miraView = await readWorkspace(request, mira, workspace.id);
  await expectedRejectionStep(request, scenario, mira, miraView, 'encounter.resume', {}, {
    label: 'ปฏิเสธคำสั่ง resume จากผู้เล่น', expected: 'FORBIDDEN; เฉพาะ DM ควบคุม lifecycle',
    errorCode: 'FORBIDDEN', status: 403,
  });
  workspace = await successfulCommandStep(request, scenario, dm, workspace, 'encounter.resume', {}, {
    label: 'DM กลับมา resume encounter', expected: 'paused marker ถูกลบและ reaction deadline ถูกคืนค่า',
    checks: [['Encounter is resumed', (view) => safeRecord(view.domain).paused === undefined],
      ['Pending hit remains available', (view) => safeRecord(view.domain).pendingHit !== null]],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
  await successfulCommandStep(request, scenario, dm, workspace, 'encounter.resolve', {}, {
    label: 'DM resolve หลัง resume', expected: 'การโจมตีปิดลงและ HP ของ Mira เป็น 6',
    checks: [
      ['Reaction window closes', (view) => safeRecord(view.domain).pendingHit === null],
      ['Mira HP is 6', (view) => safeRecord(view.domain).characters?.find((character) => safeRecord(character).id === 'mira')?.hp === 6],
    ],
    checkpoint: (view) => encounterCheckpoint(view.domain),
  });
}

async function expireLocalApproval(miniflare, roomId) {
  const namespace = await miniflare.getDurableObjectNamespace('ROOMS', WORKER_NAME);
  const id = namespace.idFromName(roomId).toString();
  const storage = await miniflare.unsafeGetDurableObjectStorage(SQLITE_SCRIPT_NAME, 'Room', { id });
  const updated = await storage.exec('UPDATE room_approvals SET expires_at = ? WHERE workspace_id = ? RETURNING approval_id', Date.now() - 1_000, roomId);
  return updated.length > 0;
}

async function runTeachingExpiredApproval(request, db, miniflare, scenario) {
  const teacher = await createActor(db, 'ครูเมย์');
  let workspace = await createWorkspace(request, teacher, 'teaching');
  const change = { kind: 'teaching', parameters: { force: 10, mass: 5, time: 2 } };
  for (const [type, payload, label, expected, extraChecks] of [
    ['evolve.propose', { change }, 'เสนอ candidate', 'candidate ถูกสร้างจากบทเรียนปัจจุบัน', []],
    ['evolve.simulate', {}, 'จำลอง candidate', 'ผลจำลองถูกเก็บ', []],
    ['evolve.validate', {}, 'ตรวจ candidate', 'validation proof ผ่าน', [['Proof passes', (view) => safeRecord(view.domain).candidate?.proof?.passed === true]]],
    ['evolve.approve', {}, 'อนุมัติ candidate', 'approval durable ถูกบันทึก', [['Approval exists', (view) => safeRecord(view.domain).candidate?.approval !== null]]],
  ]) {
    workspace = await successfulCommandStep(request, scenario, teacher, workspace, type, payload, {
      label, expected,
      checks: extraChecks,
      checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), ruleRevision: safeRecord(view.domain).ruleRevision }),
    });
  }
  const expired = await expireLocalApproval(miniflare, workspace.id);
  addStep(scenario, {
    label: 'מתקדםเวลาเฉพาะ approval ในฐานข้อมูลทดสอบแบบ local', actor: 'local test harness', command: 'test-only local DO SQL',
    expected: 'approval persisted expiry อยู่ในอดีต; domain/application source ไม่ถูกแก้',
    observed: expired ? 'Disposable local approval row was marked expired for this scenario.' : 'No local approval row was updated.',
    checks: [['Exactly a local approval row was updated', expired]],
  });
  await expectedRejectionStep(request, scenario, teacher, workspace, 'evolve.activate', {}, {
    label: 'ปฏิเสธ approval ที่หมดอายุ', expected: 'APPROVAL_EXPIRED; Active lesson ยังไม่เปลี่ยน',
    errorCode: 'APPROVAL_EXPIRED', status: 403,
  });
  workspace = await readWorkspace(request, teacher, workspace.id);
  for (const [type, payload, label, expected, extraChecks] of [
    ['evolve.propose', { change }, 'สร้าง candidate ใหม่สำหรับบทเรียนเดิม', 'candidate เดิมถูกแทนด้วย snapshot/proof ใหม่', []],
    ['evolve.simulate', {}, 'จำลอง candidate ใหม่', 'simulation ใหม่ตรงกับ snapshot', []],
    ['evolve.validate', {}, 'ตรวจ candidate ใหม่', 'proof ใหม่ผ่าน', [['New proof passes', (view) => safeRecord(view.domain).candidate?.proof?.passed === true]]],
    ['evolve.approve', {}, 'อนุมัติใหม่', 'approval ใหม่บันทึกหลัง validation', [['Fresh approval exists', (view) => safeRecord(view.domain).candidate?.approval?.revoked === false]]],
    ['evolve.activate', {}, 'เปิดใช้หลังอนุมัติใหม่', 'เปลี่ยน rule revision เป็น 1 ได้หลัง approval ปัจจุบัน', [['Rule revision advances', (view) => safeRecord(view.domain).ruleRevision === 1]]],
  ]) {
    workspace = await successfulCommandStep(request, scenario, teacher, workspace, type, payload, {
      label, expected,
      checks: extraChecks,
      checkpoint: (view) => ({ ...teachingPhysicsCheckpoint(view.domain), ruleRevision: safeRecord(view.domain).ruleRevision }),
    });
  }
}

async function runScenario(request, db, miniflare, manifest) {
  const scenario = scenarioFromManifest(manifest);
  try {
    if (manifest.id === 'invoice-evidence-gaps') await runInvoiceEvidence(request, db, scenario);
    else if (manifest.id === 'invoice-dated-rule-lifecycle') await runInvoiceLifecycle(request, db, scenario);
    else if (manifest.id === 'invoice-overlap-and-retry') await runInvoiceOverlap(request, db, scenario);
    else if (manifest.id === 'teaching-private-experiments') await runTeachingExperiments(request, db, scenario);
    else if (manifest.id === 'teaching-stale-and-role-guards') await runTeachingStaleAndRoles(request, db, scenario);
    else if (manifest.id === 'teaching-invalid-physics') await runTeachingInvalidPhysics(request, db, scenario);
    else if (manifest.id === 'encounter-ally-shield') await runEncounterShield(request, db, scenario);
    else if (manifest.id === 'encounter-pause-and-roles') await runEncounterPause(request, db, scenario);
    else if (manifest.id === 'teaching-expired-approval') await runTeachingExpiredApproval(request, db, miniflare, scenario);
    else throw new Error('SCENARIO_MANIFEST_NOT_SUPPORTED');
  } catch (error) {
    scenario.status = 'failed';
    if (error !== stopScenario) {
      scenario.steps.push({
        index: scenario.steps.length + 1,
        label: 'Scenario runner completed required checks',
        actor: 'local runner',
        command: 'scenario assertion',
        status: 'failed',
        expected: 'All required scenario checks pass.',
        observed: 'A local API or fixture assertion failed; raw error details were withheld.',
        checks: [{ label: 'Scenario assertions passed', passed: false }],
      });
    }
  }
  return scenario;
}

async function createMiniflare(tempRoot, networkState, bundle) {
  return new Miniflare({
    host: '127.0.0.1',
    port: 0,
    verbose: false,
    logRequests: false,
    telemetry: { enabled: false },
    resourcePersistencePath: tempRoot,
    isolatedResourcePersistencePath: tempRoot,
    unsafeEnableSharedStorage: false,
    unsafeInspectDurableObjects: true,
    workers: [{
      config: {
        name: WORKER_NAME,
        compatibilityDate: '2026-10-18',
        compatibilityFlags: ['nodejs_compat'],
        manifest: {
          mainModule: 'index.js',
          modulesRoot: REPO_ROOT,
          modules: { 'index.js': { type: 'esm', contents: bundle } },
        },
        env: {
          PUBLIC_ORIGIN: { type: 'text', value: ORIGIN },
          AI_MONTHLY_BUDGET_MICRO_USD: { type: 'text', value: '0' },
          AI_DAILY_BUDGET_MICRO_USD: { type: 'text', value: '0' },
          DB: { type: 'd1', id: 'tabletop-auto-demo-fresh' },
          ROOMS: { type: 'durable-object', worker: WORKER_NAME, exportName: 'Room' },
          BILLING: { type: 'durable-object', worker: WORKER_NAME, exportName: 'Billing' },
          ASSETS: { type: 'assets' },
        },
        exports: {
          Room: { type: 'durable-object', storage: 'sqlite' },
          Billing: { type: 'durable-object', storage: 'sqlite' },
        },
        assets: {
          directory: path.resolve(REPO_ROOT, 'dist'),
          hasUserWorker: true,
          notFoundHandling: 'single-page-application',
          runWorkerFirst: ['/api/*', '/healthz', '/readyz', '/internal/*'],
        },
      },
      dev: {
        rootPath: REPO_ROOT,
        unsafeRegisterWorker: false,
        unsafeDirectSockets: [],
        outboundService: {
          type: 'fetcher',
          handler: async () => {
            networkState.attempts += 1;
            return new Response('Outbound network is disabled in the auto-demo runner.', { status: 502 });
          },
        },
      },
    }],
  });
}

async function run() {
  const outputDir = path.join(OUTPUT_ROOT, RUN_ID);
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(outputDir, { recursive: false });
  const runFile = path.join(outputDir, 'run.json');
  const catalogBytes = Buffer.from(JSON.stringify(catalog));
  const selfBytes = await readFile(fileURLToPath(import.meta.url));
  const catalogHash = sha256(catalogBytes);
  const record = {
    schemaVersion: 1,
    runId: RUN_ID,
    startedAt: STARTED_AT,
    finishedAt: null,
    sourceCommit: sourceCommit(),
    sourceDirty: sourceIsDirty(),
    scenarioCatalogHash: catalogHash,
    runnerHash: sha256(Buffer.concat([selfBytes, catalogBytes])),
    workerBundleSha256: null,
    runtime: 'local-cloudflare',
    identity: 'synthetic',
    ai: 'not-used',
    productionMutations: 0,
    status: 'failed',
    scenarios: [],
    summary: { scenarios: catalog.length, passed: 0, failed: catalog.length, checks: 0 },
    limitations: [
      'All accounts, workspaces, and commands use synthetic identities in a fresh local Miniflare D1 and Durable Object store.',
      'Invoice evidence comes from the built-in reviewed sample fixture; this run does not test document upload or parsing.',
      'AI is not called. The listed prompts are scenario intent; every command is a deterministic test-script action.',
      'Approval expiry is simulated by changing one expiry value inside the disposable local Durable Object store; it is not evidence about a hosted incident.',
      'The Worker outbound network is intercepted and blocked; no production account or hosted room is contacted.',
      'sourceCommit and sourceDirty describe repository files but do not certify that the ignored Worker bundle is fresh; workerBundleSha256 identifies the exact bundle bytes used.',
    ],
  };
  let miniflare;
  let tempRoot;
  const networkState = { attempts: 0 };
  try {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), 'tabletop-r1-auto-demo-'));
    const bundle = await readFile(path.resolve(REPO_ROOT, 'worker-build/index.js'));
    record.workerBundleSha256 = sha256(bundle);
    miniflare = await createMiniflare(tempRoot, networkState, bundle);
    const db = await miniflare.getD1Database('DB', WORKER_NAME);
    const migration = await readFile(path.join(REPO_ROOT, 'cloudflare', 'migrations', '0001_identity.sql'), 'utf8');
    await db.batch(migration.replace(/^--.*$/gmu, '').split(';').map((statement) => statement.trim()).filter(Boolean).map((statement) => db.prepare(statement)));
    const request = apiClient(miniflare);
    const health = await request({ token: '', csrf: '' }, '/healthz');
    if (health.status !== 200 || safeRecord(health.body).ok !== true) throw new Error('WORKER_HEALTH_CHECK_FAILED');
    const ready = await request({ token: '', csrf: '' }, '/readyz');
    if (ready.status !== 200 || safeRecord(ready.body).ok !== true) throw new Error('WORKER_READINESS_CHECK_FAILED');
    for (const manifest of catalog) record.scenarios.push(await runScenario(request, db, miniflare, manifest));
    if (networkState.attempts !== 0) {
      record.limitations.push('The Worker attempted outbound access; the runner blocked it.');
      addInfrastructureFailure(record, 'runner-outbound-blocked', 'Reject outbound Worker access',
        'No outbound provider or public network request is attempted.', 'The configured local network blocker intercepted an outbound request.');
    }
  } catch {
    record.limitations.push('Runner setup or local Worker initialization failed; raw error details were withheld.');
    addInfrastructureFailure(record, 'runner-initialization', 'Initialize local Worker and disposable fixture store',
      'Fresh local Worker and D1 are ready.', 'Runner setup or local Worker initialization failed; raw details were withheld.');
  } finally {
    if (miniflare) {
      try { await miniflare.dispose(); } catch {
        addInfrastructureFailure(record, 'runner-dispose', 'Stop local Miniflare runtime',
          'Disposable local runtime shuts down cleanly.', 'Local runtime cleanup reported a failure; details were withheld.');
      }
    }
    if (tempRoot) {
      const base = path.resolve(os.tmpdir());
      const resolved = path.resolve(tempRoot);
      const relative = path.relative(base, resolved);
      if (relative.startsWith('tabletop-r1-auto-demo-') && !relative.includes('..')) {
        try { await rm(resolved, { recursive: true, force: true }); } catch {
          addInfrastructureFailure(record, 'runner-cleanup', 'Remove disposable local runtime files',
            'The run-specific temporary directory is removed.', 'Temporary-directory cleanup failed; details were withheld.');
        }
      }
    }
    record.finishedAt = new Date().toISOString();
    updateSummary(record);
    record.status = record.summary.failed === 0 && networkState.attempts === 0 ? 'passed' : 'failed';
    await writeFile(runFile, `${JSON.stringify(record, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
    process.stdout.write(`${JSON.stringify({ runFile: path.relative(REPO_ROOT, runFile).replaceAll(path.sep, '/'), status: record.status })}\n`);
    if (record.status !== 'passed') process.exitCode = 1;
  }
}

await run();
