import { musicPlan, questStatus, shippingResults } from '../domain';
import type { CaseId, TrioSnapshot } from '../types';
import type { PresentationOption, SurfaceColumn, SurfaceField, SurfaceMetric, SurfaceRecord, SurfaceResolution } from './types';

const SHIPPING_COLUMNS: readonly SurfaceColumn[] = [
  { id: 'zone', label: 'พื้นที่' },
  { id: 'weight', label: 'น้ำหนัก' },
  { id: 'amount', label: 'คำนวณได้' },
  { id: 'billed', label: 'เรียกเก็บเดิม' },
  { id: 'result', label: 'สถานะ' },
];

const QUEST_COLUMNS: readonly SurfaceColumn[] = [
  { id: 'elapsed', label: 'เวลาที่ผ่านไป' },
  { id: 'hints', label: 'คำใบ้' },
  { id: 'answer', label: 'เฉลย' },
  { id: 'result', label: 'ผลตามกติกา' },
];

const MUSIC_COLUMNS: readonly SurfaceColumn[] = [
  { id: 'tempo', label: 'ความเร็ว' },
  { id: 'repetitions', label: 'รอบ' },
  { id: 'beats', label: 'จังหวะ' },
  { id: 'duration', label: 'เวลาโดยประมาณ' },
];

export const PRESENTATION_OPTIONS: Readonly<Record<CaseId, readonly PresentationOption[]>> = {
  shipping: [
    {
      id: 'original', label: 'ตารางค่าส่ง', description: 'ตารางและข้อตกลง',
      tradeoff: 'เห็นยอดรายพัสดุและรายการรอตรวจ', recommended: true, libraryComponent: 'form',
    },
    {
      id: 'cards', label: 'การ์ดสรุป', description: 'แยกผลทีละรายการ',
      tradeoff: 'อ่านง่ายบนจอแคบ แต่ใช้พื้นที่แนวตั้งมากขึ้น', recommended: false, libraryComponent: 'cards',
    },
    {
      id: 'chart', label: 'กราฟยอด', description: 'เทียบยอดคำนวณ',
      tradeoff: 'เห็นยอดต่างกันเร็ว; รายการรอชั่งไม่มีแท่ง', recommended: false, libraryComponent: 'chart',
    },
  ],
  quest: [
    {
      id: 'original', label: 'เกมที่เล่นได้', description: 'แผนที่ ปริศนา และคำใบ้',
      tradeoff: 'กดตอบปริศนา ขอคำใบ้ และปลดล็อกด่านได้', recommended: true, libraryComponent: 'form',
    },
    {
      id: 'table', label: 'ตารางเวลา', description: 'เทียบจุดเวลา',
      tradeoff: 'ดูขอบเขตคำใบ้ชัด; ใช้เล่นเส้นทางไม่ได้', recommended: false, libraryComponent: 'table',
    },
    {
      id: 'cards', label: 'การ์ดสถานะ', description: 'ดูผลแต่ละช่วง',
      tradeoff: 'แยกสถานะอ่านง่าย; รายการเรียงยาวกว่า', recommended: false, libraryComponent: 'cards',
    },
  ],
  music: [
    {
      id: 'original', label: 'Loop Studio', description: 'คลื่นเสียงและลูปซ้อม',
      tradeoff: 'ฟังเสียงตัวอย่าง ดูไฟจังหวะ และวนท่อนที่เลือก', recommended: true, libraryComponent: 'form',
    },
    {
      id: 'table', label: 'ตารางท่อนเพลง', description: 'เทียบตัวเลขทุกท่อน',
      tradeoff: 'ดู BPM รอบ และเวลาในแถวเดียว', recommended: false, libraryComponent: 'table',
    },
    {
      id: 'chart', label: 'กราฟความเร็ว', description: 'เทียบความเร็วแต่ละท่อน',
      tradeoff: 'เห็นท่อนฮุกที่ช้าลง; ใช้เล่นเมโทรนอมไม่ได้', recommended: false, libraryComponent: 'chart',
    },
  ],
};

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'รอตรวจ' : `฿${value.toFixed(2)}`;
}

function field(text: string, numericValue?: number | null, tone?: SurfaceField['tone']): SurfaceField {
  return { text, numericValue, tone };
}

function versionOf(snapshot: TrioSnapshot): number {
  return Number.isSafeInteger(snapshot.version) && snapshot.version > 0 ? snapshot.version : 1;
}

function activeSurfaceBase(snapshot: TrioSnapshot, values: Omit<SurfaceResolution, 'caseId' | 'activeVersion'>): SurfaceResolution {
  return { caseId: snapshot.caseId, activeVersion: versionOf(snapshot), ...values };
}

function validDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const [year, month, day] = match.slice(1).map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function shippingResolution(snapshot: TrioSnapshot): SurfaceResolution {
  const rule = snapshot.active.shipping;
  if (!rule || typeof rule !== 'object') {
    return activeSurfaceBase(snapshot, {
      title: 'ค่าส่งตามสัญญา', sourceLabel: 'รายการพัสดุตัวอย่าง', derivedLabel: 'ยอดใหม่และสถานะตรวจ',
      ruleSummary: '', state: 'error', stateMessage: 'ไม่พบกติกาค่าส่งที่ใช้อยู่', columns: SHIPPING_COLUMNS, records: [], metrics: [],
    });
  }
  const results = shippingResults(rule);
  const validRule = Number.isFinite(rule.bangkok) && rule.bangkok >= 0
    && Number.isFinite(rule.regional) && rule.regional >= 0
    && Number.isFinite(rule.extraKg) && rule.extraKg >= 0
    && validDate(rule.effectiveDate);
  const records: SurfaceRecord[] = results.map((result) => {
    const zone = result.zone === 'bangkok' ? 'กรุงเทพฯ' : 'ต่างจังหวัด';
    const weight = result.weight === null ? 'รอชั่งน้ำหนัก' : Number.isFinite(result.weight) ? `${result.weight.toFixed(2)} กก.` : 'น้ำหนักไม่ถูกต้อง';
    const pending = result.amount === null;
    return {
      id: result.id,
      label: result.name,
      detail: `${result.id} · ${result.date}`,
      fields: {
        zone: field(zone),
        weight: field(weight, result.weight, result.weight === null ? 'pending' : 'normal'),
        amount: field(money(result.amount), result.amount, pending ? 'pending' : 'normal'),
        billed: field(money(result.billed), result.billed),
        result: field(result.reason, null, pending ? 'pending' : 'normal'),
      },
      measure: result.amount,
      measureText: money(result.amount),
      status: pending ? 'รอตรวจ' : 'คำนวณแล้ว',
      statusTone: pending ? 'pending' : 'normal',
    };
  });
  const state = validRule ? records.length === 0 ? 'empty' : 'ready' : 'error';
  const metrics: SurfaceMetric[] = [
    { label: 'กรุงเทพฯ', value: money(rule.bangkok), note: 'ต่อพัสดุ' },
    { label: 'ต่างจังหวัด', value: money(rule.regional), note: 'ต่อพัสดุ' },
    { label: 'ส่วนเกิน', value: money(rule.extraKg), note: 'ต่อ กก. ที่เริ่มเกิน' },
  ];
  return activeSurfaceBase(snapshot, {
    title: 'ค่าส่งตามสัญญา', sourceLabel: 'รายการพัสดุตัวอย่าง', derivedLabel: 'ยอดใหม่และสถานะตรวจ',
    ruleSummary: `${money(rule.bangkok)} กรุงเทพฯ · ${money(rule.regional)} ต่างจังหวัด · เริ่ม ${rule.effectiveDate}`,
    state, stateMessage: validRule ? undefined : 'กติกาที่ใช้อยู่มีค่าที่ใช้คำนวณไม่ได้',
    columns: SHIPPING_COLUMNS, records, metrics,
  });
}

function duration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function questResolution(snapshot: TrioSnapshot): SurfaceResolution {
  const rule = snapshot.active.quest;
  if (!rule || typeof rule !== 'object') {
    return activeSurfaceBase(snapshot, {
      title: 'เส้นทางคำใบ้', sourceLabel: 'จุดเวลาของเกมตัวอย่าง', derivedLabel: 'ระดับคำใบ้ตามเวลา',
      ruleSummary: '', state: 'error', stateMessage: 'ไม่พบกติกาคำใบ้ที่ใช้อยู่', columns: QUEST_COLUMNS, records: [], metrics: [],
    });
  }
  const validRule = Number.isSafeInteger(rule.firstHint) && rule.firstHint > 0
    && Number.isSafeInteger(rule.secondHint) && rule.secondHint > rule.firstHint
    && typeof rule.autoReveal === 'boolean';
  const checkpoints = [
    { id: 'before-first', label: 'ก่อนคำใบ้แรก', elapsed: Math.max(0, rule.firstHint - 1) },
    { id: 'first-hint', label: 'คำใบ้แรก', elapsed: rule.firstHint },
    { id: 'second-hint', label: 'คำใบ้ที่สอง', elapsed: rule.secondHint },
    { id: 'solved', label: 'ผู้เล่นแก้ปริศนาแล้ว', elapsed: rule.secondHint, solved: true },
  ];
  const records: SurfaceRecord[] = checkpoints.map((checkpoint) => {
    const status = questStatus(rule, checkpoint.elapsed, checkpoint.solved);
    const answer = status.answerRevealed ? 'แสดงเฉลย' : 'ยังซ่อนเฉลย';
    const solved = checkpoint.solved === true;
    return {
      id: checkpoint.id,
      label: checkpoint.label,
      detail: `Q-${String(checkpoints.indexOf(checkpoint) + 1).padStart(3, '0')}`,
      fields: {
        elapsed: field(duration(checkpoint.elapsed), checkpoint.elapsed),
        hints: field(`ระดับ ${status.hintLevel}`, status.hintLevel),
        answer: field(answer, status.answerRevealed ? 1 : 0, status.answerRevealed ? 'attention' : 'normal'),
        result: field(status.summary, null, solved ? 'pending' : 'normal'),
      },
      measure: status.hintLevel,
      measureText: `ระดับ ${status.hintLevel}`,
      status: solved ? 'แก้แล้ว' : answer,
      statusTone: solved ? 'pending' : 'normal',
    };
  });
  const state = validRule ? records.length === 0 ? 'empty' : 'ready' : 'error';
  const metrics: SurfaceMetric[] = [
    { label: 'คำใบ้แรก', value: `${rule.firstHint} วิ` },
    { label: 'คำใบ้ที่สอง', value: `${rule.secondHint} วิ` },
    { label: 'เฉลย', value: rule.autoReveal ? 'เปิดอัตโนมัติ' : 'ผู้เล่นเลือกเอง' },
  ];
  return activeSurfaceBase(snapshot, {
    title: 'เส้นทางคำใบ้', sourceLabel: 'จุดเวลาของเกมตัวอย่าง', derivedLabel: 'ระดับคำใบ้ตามเวลา',
    ruleSummary: `คำใบ้ ${rule.firstHint}/${rule.secondHint} วินาที · ${rule.autoReveal ? 'เปิดเฉลยอัตโนมัติ' : 'ไม่เปิดเฉลยเอง'}`,
    state, stateMessage: validRule ? undefined : 'เวลาคำใบ้ที่ใช้อยู่ไม่ถูกต้อง',
    columns: QUEST_COLUMNS, records, metrics,
  });
}

function seconds(value: number): string {
  return Number.isInteger(value) ? `${value} วิ` : `${value.toFixed(1)} วิ`;
}

function musicResolution(snapshot: TrioSnapshot): SurfaceResolution {
  const rule = snapshot.active.music;
  if (!rule || typeof rule !== 'object') {
    return activeSurfaceBase(snapshot, {
      title: 'แผนซ้อมรายท่อน', sourceLabel: 'รายการท่อนซ้อมตัวอย่าง', derivedLabel: 'ความเร็ว จำนวนจังหวะ และเวลา',
      ruleSummary: '', state: 'error', stateMessage: 'ไม่พบกติกาซ้อมที่ใช้อยู่', columns: MUSIC_COLUMNS, records: [], metrics: [],
    });
  }
  const plan = musicPlan(rule);
  const validRule = plan.length > 0;
  const records: SurfaceRecord[] = plan.map((section) => {
    const chorus = section.id === 'MU-004';
    return {
      id: section.id,
      label: section.name,
      detail: section.id,
      fields: {
        tempo: field(`${section.bpm} BPM`, section.bpm),
        repetitions: field(`${section.repetitions} รอบ`, section.repetitions),
        beats: field(`${section.beats} จังหวะ`, section.beats),
        duration: field(seconds(section.seconds), section.seconds),
      },
      measure: section.bpm,
      measureText: `${section.bpm} BPM`,
      status: chorus ? 'ท่อนฮุก' : 'ท่อนอื่น',
      statusTone: chorus ? 'attention' : 'normal',
    };
  });
  const metrics: SurfaceMetric[] = [
    { label: 'ท่อนฮุก', value: `${rule.chorusBpm} BPM` },
    { label: 'ท่อนอื่น', value: `${rule.otherBpm} BPM` },
    { label: 'รอบฮุก', value: `${rule.repetitions} รอบ` },
  ];
  return activeSurfaceBase(snapshot, {
    title: 'แผนซ้อมรายท่อน', sourceLabel: 'รายการท่อนซ้อมตัวอย่าง', derivedLabel: 'ความเร็ว จำนวนจังหวะ และเวลา',
    ruleSummary: `ฮุก ${rule.chorusBpm} BPM × ${rule.repetitions} รอบ · ท่อนอื่น ${rule.otherBpm} BPM`,
    state: validRule ? 'ready' : 'error', stateMessage: validRule ? undefined : 'กติกาซ้อมที่ใช้อยู่ยังสร้างแผนไม่ได้',
    columns: MUSIC_COLUMNS, records, metrics,
  });
}

/** Resolve only the currently active case rules; Draft and Simulation are deliberately ignored. */
export function resolveSurface(snapshot: TrioSnapshot): SurfaceResolution {
  if (!snapshot?.active) {
    return {
      caseId: snapshot?.caseId ?? 'shipping', activeVersion: 1, title: 'พื้นที่กำลังโหลด',
      sourceLabel: 'ข้อมูลตัวอย่าง', derivedLabel: 'กำลังเตรียมข้อมูล', ruleSummary: '', state: 'loading',
      columns: [], records: [], metrics: [],
    };
  }
  if (snapshot.caseId === 'shipping') return shippingResolution(snapshot);
  if (snapshot.caseId === 'quest') return questResolution(snapshot);
  return musicResolution(snapshot);
}

