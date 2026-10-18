import { HANDOFF_ITEMS } from './handoff';
import { isValidEncounterRule, musicPlan, questStatus, rulesFingerprint, shippingResults, verifyRules } from './domain';
import { BASELINE_ENCOUNTER_RULE, runEncounter } from './creative/encounterModel';
import type { CaseId, EncounterRule, EvidenceEvent, RuleBook, TrioSnapshot } from './types';

export interface TrioDeliverableFile {
  filename: string;
  mimeType: string;
  contents: string;
}

export interface TrioDeliverableSummary {
  activeVersion: number;
  resultCount: number;
  resolvedCount: number;
  reviewCount: number;
  unresolvedHandoffCount: 1;
  draftMatchesActive: boolean;
  draftCheckPassed: number;
  draftCheckFailed: number;
  savedEvaluationState: 'none' | 'current' | 'stale';
  values: Record<string, string | number | boolean>;
}

export interface TrioDeliverableBundle {
  csv: TrioDeliverableFile;
  report: TrioDeliverableFile;
  summary: TrioDeliverableSummary;
}

interface TableData {
  headers: string[];
  rows: Array<Array<string | number | boolean | null>>;
}

const TITLES: Record<CaseId, string> = {
  shipping: 'ผลค่าส่งจากกติกาที่ใช้อยู่',
  quest: 'แผนเวลาคำใบ้จากกติกาที่ใช้อยู่',
  music: 'แผนซ้อมจากกติกาที่ใช้อยู่',
};

const FILE_STEMS: Record<CaseId, string> = {
  shipping: 'shipping-results',
  quest: 'quest-hint-plan',
  music: 'music-rehearsal-plan',
};

function displayNumber(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return Number.isNaN(value) ? 'ไม่ถูกต้อง' : 'เกินขอบเขต';
  return Number.isInteger(value) ? String(value) : value.toFixed(decimals);
}

function displayWeight(value: number | null): string {
  if (value === null) return 'ไม่ระบุน้ำหนัก';
  if (!Number.isFinite(value)) return 'น้ำหนักไม่ถูกต้อง';
  return displayNumber(value, 2);
}

function shippingTable(snapshot: TrioSnapshot): TableData {
  const rule = snapshot.active.shipping;
  const rows = shippingResults(rule);
  return {
    headers: ['shipment_id', 'destination', 'weight_kg', 'date', 'previous_billed_baht', 'calculated_baht', 'difference_baht', 'status'],
    rows: rows.map((result) => [
      result.id,
      result.zone === 'bangkok' ? 'Bangkok' : 'ต่างจังหวัด',
      displayWeight(result.weight),
      result.date,
      displayNumber(result.billed),
      result.amount === null ? 'ยังไม่คำนวณ' : displayNumber(result.amount),
      result.amount === null ? 'ไม่ทราบ' : displayNumber(result.amount - result.billed),
      result.reason,
    ]),
  };
}

function questTable(snapshot: TrioSnapshot): TableData {
  const rule = snapshot.active.quest;
  if (rule.encounter !== undefined) return encounterTable(rule.encounter);
  const hints = [
    { label: 'คำใบ้แรก', thresholdSeconds: rule.firstHint },
    { label: 'คำใบ้ที่สอง', thresholdSeconds: rule.secondHint },
  ];
  return {
    headers: ['hint', 'threshold_seconds', 'threshold_minutes', 'auto_reveal', 'answer_revealed_at_threshold', 'status'],
    rows: hints.map(({ label, thresholdSeconds }) => {
      const status = questStatus(rule, thresholdSeconds);
      return [label, displayNumber(thresholdSeconds), displayNumber(thresholdSeconds / 60), rule.autoReveal, status.answerRevealed, status.summary];
    }),
  };
}

function encounterTable(rule: EncounterRule): TableData {
  const headers = ['รอบ', 'ลูกเต๋า d20', 'กติกาโล่', 'ผลของรอบ', 'Mira HP', 'Pip HP', 'Goblin HP', 'แอ็กชัน'];
  if (!isValidEncounterRule(rule)) {
    return {
      headers,
      rows: [['EN-001', '14 · 12 · 16', 'ข้อมูลไม่ครบ', 'รอตรวจสอบ', null, null, null, 'ยังไม่เริ่มจำลอง']],
    };
  }
  const outcome = runEncounter(rule);
  const actions = outcome.events.map((event) => event.label).join(' / ');
  return {
    headers,
    rows: [[
      'EN-001',
      outcome.rolls.join(' · '),
      rule.allyShield ? `โล่ช่วยเพื่อน · ลด ${rule.shieldReduction} HP` : 'โล่คุ้มกันตัวเอง',
      outcome.goblinDefeated ? 'ชนะ · Goblin หมด HP' : 'จบรอบ',
      outcome.hp.mira,
      outcome.hp.pip,
      outcome.hp.goblin,
      actions,
    ]],
  };
}

function musicTable(snapshot: TrioSnapshot): TableData {
  const plan = musicPlan(snapshot.active.music);
  return {
    headers: ['section_id', 'section', 'bpm', 'repetitions', 'beats_per_repetition', 'total_beats', 'seconds'],
    rows: plan.map((section) => [
      section.id,
      section.name,
      displayNumber(section.bpm),
      displayNumber(section.repetitions),
      displayNumber(section.beats),
      displayNumber(section.beats * section.repetitions),
      displayNumber(section.seconds),
    ]),
  };
}

function activeTable(snapshot: TrioSnapshot): TableData {
  if (snapshot.caseId === 'shipping') return shippingTable(snapshot);
  if (snapshot.caseId === 'quest') return questTable(snapshot);
  return musicTable(snapshot);
}

export function escapeCsvCell(value: string | number | boolean | null): string {
  let text = value === null ? '' : String(value);
  // A leading apostrophe prevents spreadsheet formula execution on open.
  if (/^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function csvFile(table: TableData, filename: string): TrioDeliverableFile {
  const lines = [table.headers, ...table.rows].map((row) => row.map(escapeCsvCell).join(','));
  return { filename, mimeType: 'text/csv;charset=utf-8', contents: `\uFEFF${lines.join('\r\n')}\r\n` };
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function htmlTable(table: TableData): string {
  const header = table.headers.map((value) => `<th scope="col">${escapeHtml(value)}</th>`).join('');
  const rows = table.rows.map((row) => `<tr>${row.map((value) => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows || `<tr><td colspan="${table.headers.length}">ไม่มีรายการที่สร้างได้จากกติกาปัจจุบัน</td></tr>`}</tbody></table></div>`;
}

function savedEvaluationState(snapshot: TrioSnapshot): 'none' | 'current' | 'stale' {
  if (!snapshot.evaluation) return 'none';
  return snapshot.evaluation.fingerprint === rulesFingerprint(snapshot.caseId, snapshot.draft) ? 'current' : 'stale';
}

function ruleText(caseId: CaseId, book: RuleBook): string[] {
  if (caseId === 'shipping') {
    const rule = book.shipping;
    return [`Bangkok ฿${displayNumber(rule.bangkok)} · ต่างจังหวัด ฿${displayNumber(rule.regional)}`, `ส่วนเกิน ฿${displayNumber(rule.extraKg)} ต่อกิโลกรัมที่เริ่มขึ้น`, `เริ่มใช้ ${rule.effectiveDate}`];
  }
  if (caseId === 'quest') {
    const rule = book.quest;
    if (rule.encounter !== undefined) {
      return [
        rule.encounter.allyShield ? 'โล่คุ้มกัน Pip' : 'โล่คุ้มกัน Mira เอง',
        `โล่ลดความเสียหาย ${displayNumber(rule.encounter.shieldReduction)} HP`,
        'รันทดสอบ d20 [14, 12, 16] · Mira → Goblin → Pip',
      ];
    }
    return [`คำใบ้แรก ${displayNumber(rule.firstHint)} วินาที`, `คำใบ้ที่สอง ${displayNumber(rule.secondHint)} วินาที`, `เฉลยอัตโนมัติ: ${rule.autoReveal ? 'เปิด' : 'ปิด'}`];
  }
  const rule = book.music;
  return [`ท่อนฮุก ${displayNumber(rule.chorusBpm)} BPM · ${displayNumber(rule.repetitions)} รอบ`, `ท่อนอื่น ${displayNumber(rule.otherBpm)} BPM`];
}

type EncounterComparisonRow = {
  label: string;
  rule: EncounterRule;
  outcome: ReturnType<typeof runEncounter> | null;
  note: string;
};

function encounterComparison(snapshot: TrioSnapshot): EncounterComparisonRow[] {
  const draftEncounter = snapshot.draft.quest.encounter;
  const activeEncounter = snapshot.active.quest.encounter;
  const rows: Array<{ label: string; rule: EncounterRule; note: string }> = [
    { label: 'ก่อนปรับ · baseline', rule: BASELINE_ENCOUNTER_RULE, note: 'กติกาตั้งต้น: โล่คุ้มกัน Mira' },
    {
      label: 'Draft ปัจจุบัน',
      rule: draftEncounter ?? BASELINE_ENCOUNTER_RULE,
      note: draftEncounter === undefined ? 'ยังเป็น legacy · แสดง baseline เพื่อเทียบ' : 'ใช้ค่า encounter ใน Draft',
    },
    {
      label: `Active v${snapshot.version}`,
      rule: activeEncounter ?? BASELINE_ENCOUNTER_RULE,
      note: activeEncounter === undefined ? 'ยังเป็น legacy · แสดง baseline เพื่อเทียบ' : 'ใช้ค่า encounter ใน Active',
    },
  ];
  return rows.map((row) => ({
    ...row,
    outcome: isValidEncounterRule(row.rule) ? runEncounter(row.rule) : null,
  }));
}

function encounterComparisonTable(snapshot: TrioSnapshot): TableData {
  const rows = encounterComparison(snapshot);
  return {
    headers: ['ชุดกติกา', 'โล่', 'ลดความเสียหาย', 'Mira HP', 'Pip HP', 'Goblin HP', 'ผลรอบ', 'ที่มา'],
    rows: rows.map(({ label, rule, outcome, note }) => [
      label,
      rule.allyShield ? 'ช่วย Pip' : 'คุ้มกัน Mira',
      rule.shieldReduction,
      outcome?.hp.mira ?? 'รอตรวจ',
      outcome?.hp.pip ?? 'รอตรวจ',
      outcome?.hp.goblin ?? 'รอตรวจ',
      outcome === null ? 'ไม่จำลอง' : outcome.goblinDefeated ? 'ชนะ' : 'จบรอบ',
      note,
    ]),
  };
}

function addEncounterSummaryValues(snapshot: TrioSnapshot, values: Record<string, string | number | boolean>): void {
  const comparison = encounterComparison(snapshot);
  const [oldRow, draftRow, activeRow] = comparison;
  if (!oldRow || !draftRow || !activeRow) return;
  for (const [prefix, row] of [['old', oldRow], ['draft', draftRow], ['active', activeRow]] as const) {
    values[`${prefix}MiraHp`] = row.outcome?.hp.mira ?? 'รอตรวจ';
    values[`${prefix}PipHp`] = row.outcome?.hp.pip ?? 'รอตรวจ';
    values[`${prefix}GoblinHp`] = row.outcome?.hp.goblin ?? 'รอตรวจ';
  }
  values.allyShield = snapshot.active.quest.encounter?.allyShield ?? false;
  values.shieldReduction = snapshot.active.quest.encounter?.shieldReduction ?? 0;
}

function titleFor(snapshot: TrioSnapshot): string {
  return snapshot.caseId === 'quest' && snapshot.active.quest.encounter !== undefined
    ? 'ผล encounter จากกติกาที่ใช้อยู่'
    : TITLES[snapshot.caseId];
}

function fileStemFor(snapshot: TrioSnapshot): string {
  return snapshot.caseId === 'quest' && snapshot.active.quest.encounter !== undefined
    ? 'quest-encounter'
    : FILE_STEMS[snapshot.caseId];
}

function summaryFor(snapshot: TrioSnapshot, table: TableData, draftPassed: number, draftFailed: number, draftMatchesActive: boolean): TrioDeliverableSummary {
  let resolvedCount = table.rows.length;
  let reviewCount = 0;
  const values: Record<string, string | number | boolean> = {};
  if (snapshot.caseId === 'shipping') {
    const results = shippingResults(snapshot.active.shipping);
    resolvedCount = results.filter((result) => result.amount !== null).length;
    reviewCount = results.length - resolvedCount;
    values.bangkokRate = snapshot.active.shipping.bangkok;
    values.regionalRate = snapshot.active.shipping.regional;
    values.extraKgRate = snapshot.active.shipping.extraKg;
    values.effectiveDate = snapshot.active.shipping.effectiveDate;
  } else if (snapshot.caseId === 'quest') {
    if (snapshot.active.quest.encounter !== undefined) {
      const valid = isValidEncounterRule(snapshot.active.quest.encounter);
      reviewCount = valid ? 0 : 1;
      resolvedCount = valid ? 1 : 0;
      addEncounterSummaryValues(snapshot, values);
    } else {
      const statuses = [
        questStatus(snapshot.active.quest, snapshot.active.quest.firstHint),
        questStatus(snapshot.active.quest, snapshot.active.quest.secondHint),
      ];
      reviewCount = statuses.filter((status) => status.summary.includes('ไม่ถูกต้อง')).length;
      resolvedCount = table.rows.length - reviewCount;
      values.firstHintSeconds = snapshot.active.quest.firstHint;
      values.secondHintSeconds = snapshot.active.quest.secondHint;
      values.autoReveal = snapshot.active.quest.autoReveal;
    }
  } else {
    const plan = musicPlan(snapshot.active.music);
    reviewCount = plan.length === 7 ? 0 : 1;
    resolvedCount = plan.length;
    values.chorusBpm = snapshot.active.music.chorusBpm;
    values.otherBpm = snapshot.active.music.otherBpm;
    values.repetitions = snapshot.active.music.repetitions;
    values.totalSeconds = Number(plan.reduce((total, section) => total + section.seconds, 0).toFixed(2));
  }
  return {
    activeVersion: snapshot.version,
    resultCount: table.rows.length,
    resolvedCount,
    reviewCount,
    unresolvedHandoffCount: 1,
    draftMatchesActive,
    draftCheckPassed: draftPassed,
    draftCheckFailed: draftFailed,
    savedEvaluationState: savedEvaluationState(snapshot),
    values,
  };
}

function eventTable(events: EvidenceEvent[]): TableData {
  return {
    headers: ['event_id', 'type', 'title', 'detail', 'references', 'version', 'recorded_at'],
    rows: events.map((event) => [event.id, event.kind, event.title, event.detail, event.references.join(' · '), event.version, event.at]),
  };
}

function reportHtml(snapshot: TrioSnapshot, table: TableData, generatedAt: Date): string {
  const currentEvaluation = verifyRules(snapshot.caseId, snapshot.draft);
  const draftMatchesActive = rulesFingerprint(snapshot.caseId, snapshot.draft) === rulesFingerprint(snapshot.caseId, snapshot.active);
  const storedState = savedEvaluationState(snapshot);
  const savedEvaluation = storedState === 'none'
    ? 'ไม่มีผลตรวจที่บันทึกไว้สำหรับ Draft นี้'
    : storedState === 'current'
      ? 'ผลตรวจที่บันทึกไว้ตรงกับ Draft ปัจจุบัน'
      : 'ผลตรวจที่บันทึกไว้ไม่ตรงกับ Draft ปัจจุบัน (stale)';
  const comparison = draftMatchesActive
    ? 'Draft ปัจจุบันตรงกับ Active; ตารางผลลัพธ์ด้านบนยังคำนวณจาก Active เท่านั้น'
    : 'Draft ปัจจุบันต่างจาก Active; ผลตรวจด้านล่างเป็นการคำนวณแยก และไม่เปลี่ยนผล Active';
  const handoff = HANDOFF_ITEMS[snapshot.caseId];
  const handoffState = snapshot.handoff === 'in-progress' ? 'เริ่มส่งต่องานแล้ว; ข้อมูลที่ขาดยังไม่ถูกยืนยัน' : 'รอผู้รับช่วง; รายการยังไม่ถูกยืนยัน';
  const date = generatedAt.toISOString();
  const evaluationTable: TableData = {
    headers: ['case_id', 'ตัวอย่าง', 'ผลที่ตกลง', 'ผลจาก Draft ปัจจุบัน', 'ผ่าน', 'เหตุผล'],
    rows: currentEvaluation.cases.map((sample) => [sample.id, sample.label, sample.expected, sample.actual, sample.passed ? 'ผ่าน' : 'ไม่ผ่าน', sample.reason]),
  };
  const title = titleFor(snapshot);
  const encounterSection = snapshot.caseId === 'quest' && snapshot.active.quest.encounter !== undefined
    ? `<h2>เทียบ HP ก่อนปรับ, Draft และ Active</h2><p class="note">ผลทุกแถวรันจาก encounter runtime ด้วย d20 [14, 12, 16] · ผล Active ไม่อ่านค่าจาก Simulation</p>${htmlTable(encounterComparisonTable(snapshot))}<h2>ที่มาของกติกา encounter</h2><p>ค่าที่ใช้: <code>quest.encounter.allyShield</code> และ <code>quest.encounter.shieldReduction</code> · ผลจำลองจาก <code>src/trio/creative/encounterModel.ts</code> · trace ตัวอย่าง [14, 12, 16]. รายการแหล่งข้อมูลและข้อสังเกตที่บันทึกใน workspace แสดงด้านล่าง</p>`
    : '';
  const events = eventTable(snapshot.events);
  const activeRules = ruleText(snapshot.caseId, snapshot.active).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  const draftRules = ruleText(snapshot.caseId, snapshot.draft).map((line) => `<li>${escapeHtml(line)}</li>`).join('');
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} · v${escapeHtml(snapshot.version)}</title>
<style>
:root{color-scheme:light;--ink:#392f48;--muted:#756c80;--line:#e9e4ef;--accent:#6550c7;--wash:#faf8fd}*{box-sizing:border-box}body{margin:0;padding:32px 18px;background:#f8f7fb;color:var(--ink);font:15px/1.55 Arial,"Noto Sans Thai",sans-serif}main{max-width:1040px;margin:0 auto;padding:30px;background:white;border:1px solid var(--line);border-radius:18px}h1{margin:4px 0 8px;font-size:28px}h2{margin:28px 0 9px;font-size:19px}p,li{color:var(--muted)}.eyebrow{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.04em}.meta{display:flex;flex-wrap:wrap;gap:8px 20px;margin:15px 0;padding:12px;background:var(--wash);border-radius:10px}.meta span{font-size:13px}.meta b{color:var(--ink)}.rule-list{margin:8px 0;padding-left:22px}.table-wrap{width:100%;overflow-x:auto;border:1px solid var(--line);border-radius:10px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{padding:9px 10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}th{background:var(--wash);color:#584d68;white-space:nowrap}td{overflow-wrap:anywhere}tbody tr:last-child td{border-bottom:0}.note{padding:12px 14px;background:#f8f5ff;border-left:3px solid var(--accent);border-radius:4px;color:#514667}.pending{padding:13px 15px;border:1px solid #f0ddc5;background:#fffaf2;border-radius:10px}.pending strong{display:block}.pending small{color:var(--muted)}footer{margin-top:26px;padding-top:12px;border-top:1px solid var(--line);color:var(--muted);font-size:12px}
</style></head><body><main>
<div class="eyebrow">PROCEDURAL · ข้อมูลตัวอย่างในเครื่อง</div><h1>${escapeHtml(title)}</h1><p>รายงานนี้เป็นไฟล์ตัวอย่างที่สร้างในเบราว์เซอร์ ไม่มีการส่งข้อมูลออกไป</p>
<div class="meta"><span><b>เรื่อง:</b> ${escapeHtml(snapshot.caseId)}</span><span><b>Active version:</b> ${escapeHtml(snapshot.version)}</span><span><b>สร้างเมื่อ:</b> ${escapeHtml(date)}</span><span><b>จำนวนผลลัพธ์:</b> ${escapeHtml(table.rows.length)}</span></div>
<h2>กติกาที่ใช้อยู่ · Active</h2><p>ผลลัพธ์ CSV และตารางนี้ใช้ Active version ${escapeHtml(snapshot.version)} เท่านั้น ไม่ใช้ Draft หรือ Simulation</p><ul class="rule-list">${activeRules}</ul>${htmlTable(table)}
<h2>ผลตรวจ Draft ปัจจุบัน</h2><ul class="rule-list">${draftRules}</ul><p class="note">${escapeHtml(comparison)} · คำนวณใหม่ด้วยกติกาตัวอย่าง ณ เวลาส่งออกรายงาน โดยไม่บันทึกผลตรวจกลับเข้า workspace</p><p>${escapeHtml(savedEvaluation)} · ผลตรวจที่คำนวณใหม่นี้ผ่าน ${escapeHtml(currentEvaluation.passed)} จาก ${escapeHtml(currentEvaluation.cases.length)} กรณี และไม่ผ่าน ${escapeHtml(currentEvaluation.failed)} กรณี</p>${htmlTable(evaluationTable)}
${encounterSection}
<h2>รายการที่ยังค้าง</h2><div class="pending"><small>${escapeHtml(handoff.id)} · ${escapeHtml(handoffState)}</small><strong>${escapeHtml(handoff.label)}</strong><p>${escapeHtml(handoff.detail)}</p></div>
<h2>หลักฐานที่บันทึกจริง</h2><p>รายการด้านล่างมาจาก event ใน workspace ข้อสังเกตจากคนซ้อม หากมี จะอยู่ในรายละเอียด event ตามที่บันทึก</p>${htmlTable(events)}
<footer>ข้อมูลและบทบาทผู้อนุมัติเป็นตัวอย่าง · ไม่มี LLM, การเชื่อมต่อ SQL, การวิเคราะห์ไมโครโฟน หรือการยืนยันตัวบุคคล</footer>
</main></body></html>`;
}

export function buildTrioDeliverables(snapshot: TrioSnapshot, generatedAt = new Date()): TrioDeliverableBundle {
  const table = activeTable(snapshot);
  const draftEvaluation = verifyRules(snapshot.caseId, snapshot.draft);
  const draftMatchesActive = rulesFingerprint(snapshot.caseId, snapshot.draft) === rulesFingerprint(snapshot.caseId, snapshot.active);
  const version = `v${snapshot.version}`;
  const filename = `${fileStemFor(snapshot)}-${version}.csv`;
  const reportFilename = `${snapshot.caseId}-report-${version}.html`;
  return {
    csv: csvFile(table, filename),
    report: {
      filename: reportFilename,
      mimeType: 'text/html;charset=utf-8',
      contents: reportHtml(snapshot, table, generatedAt),
    },
    summary: summaryFor(snapshot, table, draftEvaluation.passed, draftEvaluation.failed, draftMatchesActive),
  };
}
