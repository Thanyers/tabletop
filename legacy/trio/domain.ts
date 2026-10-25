import type {
  CaseId,
  EncounterRule,
  MusicRule,
  QuestRule,
  RuleBook,
  SampleResult,
  ShippingRule,
  Verification,
} from './types';
import {
  createEncounterState,
  resolveEncounterAction,
  runEncounter,
  type EncounterOutcome,
} from './creative/encounterModel';

const OLD_BANGKOK_RATE = 40;
const OLD_REGIONAL_RATE = 50;
const FIRST_KG_INCLUDED = 1;
const SECONDS_PER_MINUTE = 60;
const CENTS_PER_UNIT = 100;
const SHIPPING_RULE_ERROR = 'กติกาค่าส่งไม่ถูกต้อง กรุณาตรวจสอบก่อนคำนวณ';
const MISSING_WEIGHT_REASON = 'ไม่มีข้อมูลน้ำหนัก ต้องตรวจสอบก่อนคำนวณ';
const INVALID_WEIGHT_REASON = 'น้ำหนักติดลบหรือไม่ใช่ตัวเลขที่ใช้ได้ ต้องตรวจสอบก่อนคำนวณ';
const INVALID_DATE_REASON = 'วันที่ไม่ถูกต้อง ต้องตรวจสอบก่อนคำนวณ';

export type ShippingResult = {
  id: string;
  name: string;
  zone: 'bangkok' | 'regional';
  date: string;
  weight: number | null;
  billed: number;
  amount: number | null;
  reason: string;
};

type ShippingFixture = Omit<ShippingResult, 'amount' | 'reason'> & {
  expectedAmount: number | null;
  expectedReason: string;
  expected: string;
  input: string;
};

const SHIPPING_FIXTURES: readonly ShippingFixture[] = [
  {
    id: 'SH-001', name: 'พัสดุคุณเมย์', zone: 'bangkok', date: '2026-10-15', weight: 1, billed: 40,
    expectedAmount: 35, expectedReason: 'ใช้อัตราใหม่ตั้งแต่วันที่ 2026-10-15',
    input: 'กรุงเทพฯ · 1.00 กก. · 2026-10-15 · เรียกเก็บ 40.00 บาท',
    expected: 'อัตราใหม่ 35.00 บาท · เก็บยอดเดิม 40.00 บาท · เริ่มใช้ 2026-10-15',
  },
  {
    id: 'SH-002', name: 'พัสดุคุณต้น', zone: 'bangkok', date: '2026-10-15', weight: 1.1, billed: 50,
    expectedAmount: 45, expectedReason: 'ใช้อัตราใหม่ตั้งแต่วันที่ 2026-10-15',
    input: 'กรุงเทพฯ · 1.10 กก. · 2026-10-15 · เรียกเก็บ 50.00 บาท',
    expected: 'อัตราใหม่ 45.00 บาท · เกิน 1 กก. เริ่มคิดเพิ่ม 1 กก. · เก็บยอดเดิม 50.00 บาท',
  },
  {
    id: 'SH-003', name: 'พัสดุคุณพลอย', zone: 'regional', date: '2026-10-15', weight: 1, billed: 50,
    expectedAmount: 45, expectedReason: 'ใช้อัตราใหม่ตั้งแต่วันที่ 2026-10-15',
    input: 'ต่างจังหวัด · 1.00 กก. · 2026-10-15 · เรียกเก็บ 50.00 บาท',
    expected: 'อัตราใหม่ 45.00 บาท · เก็บยอดเดิม 50.00 บาท · เริ่มใช้ 2026-10-15',
  },
  {
    id: 'SH-004', name: 'พัสดุคุณนัท', zone: 'regional', date: '2026-10-15', weight: 2, billed: 60,
    expectedAmount: 55, expectedReason: 'ใช้อัตราใหม่ตั้งแต่วันที่ 2026-10-15',
    input: 'ต่างจังหวัด · 2.00 กก. · 2026-10-15 · เรียกเก็บ 60.00 บาท',
    expected: 'อัตราใหม่ 55.00 บาท · เกิน 1 กก. เริ่มคิดเพิ่ม 1 กก. · เก็บยอดเดิม 60.00 บาท',
  },
  {
    id: 'SH-005', name: 'พัสดุก่อนสัญญาใหม่', zone: 'bangkok', date: '2026-10-14', weight: 1, billed: 40,
    expectedAmount: 40, expectedReason: 'คงอัตราเดิมก่อนวันเริ่มสัญญา',
    input: 'กรุงเทพฯ · 1.00 กก. · 2026-10-14 · เรียกเก็บ 40.00 บาท',
    expected: 'คงยอดเดิม 40.00 บาท และเก็บยอดที่เรียกเก็บไว้ 40.00 บาท',
  },
  {
    id: 'SH-006', name: 'พัสดุรอชั่งน้ำหนัก', zone: 'regional', date: '2026-10-15', weight: null, billed: 50,
    expectedAmount: null, expectedReason: MISSING_WEIGHT_REASON,
    input: 'ต่างจังหวัด · รอน้ำหนัก · 2026-10-15 · เรียกเก็บ 50.00 บาท',
    expected: 'รอตรวจสอบน้ำหนัก · ยังไม่คำนวณยอดใหม่ · เก็บยอดเดิม 50.00 บาท',
  },
  {
    id: 'SH-007', name: 'น้ำหนักติดลบ · ตรวจสอบ', zone: 'regional', date: '2026-10-15', weight: -0.5, billed: 0,
    expectedAmount: null, expectedReason: INVALID_WEIGHT_REASON,
    input: 'ต่างจังหวัด · น้ำหนักไม่ถูกต้อง −0.50 กก. · 2026-10-15 · เรียกเก็บ 0.00 บาท',
    expected: 'รอตรวจสอบ · ไม่รับน้ำหนักติดลบและยังไม่คำนวณยอด',
  },
  {
    id: 'SH-008', name: 'น้ำหนักไม่ถูกต้อง · ตรวจสอบ', zone: 'regional', date: '2026-10-15', weight: Number.NaN, billed: 0,
    expectedAmount: null, expectedReason: INVALID_WEIGHT_REASON,
    input: 'ต่างจังหวัด · น้ำหนักไม่ใช่ตัวเลขที่ใช้ได้ · 2026-10-15 · เรียกเก็บ 0.00 บาท',
    expected: 'รอตรวจสอบ · ไม่รับน้ำหนักที่ไม่ถูกต้องและยังไม่คำนวณยอด',
  },
];

type QuestFixture = {
  id: string;
  label: string;
  input: string;
  elapsedSeconds: number;
  solved?: boolean;
  hintLevel: 0 | 1 | 2;
  answerRevealed: boolean;
  expected: string;
};

const QUEST_FIXTURES: readonly QuestFixture[] = [
  {
    id: 'Q-001', label: 'ก่อนคำใบ้แรก', input: 'เวลาผ่านไป 179 วินาที', elapsedSeconds: 179,
    hintLevel: 0, answerRevealed: false, expected: 'ยังไม่มีคำใบ้ และยังซ่อนเฉลย',
  },
  {
    id: 'Q-002', label: 'ถึงเวลาคำใบ้แรก', input: 'เวลาผ่านไป 180 วินาที', elapsedSeconds: 180,
    hintLevel: 1, answerRevealed: false, expected: 'แสดงคำใบ้แรกได้ และยังซ่อนเฉลย',
  },
  {
    id: 'Q-003', label: 'หลังคำใบ้แรก', input: 'เวลาผ่านไป 181 วินาที', elapsedSeconds: 181,
    hintLevel: 1, answerRevealed: false, expected: 'แสดงคำใบ้แรกได้ และยังซ่อนเฉลย',
  },
  {
    id: 'Q-004', label: 'ก่อนคำใบ้ที่สอง', input: 'เวลาผ่านไป 299 วินาที', elapsedSeconds: 299,
    hintLevel: 1, answerRevealed: false, expected: 'แสดงคำใบ้แรกได้ และยังซ่อนเฉลย',
  },
  {
    id: 'Q-005', label: 'ถึงเวลาคำใบ้ที่สอง', input: 'เวลาผ่านไป 300 วินาที', elapsedSeconds: 300,
    hintLevel: 2, answerRevealed: false, expected: 'แสดงคำใบ้ที่สองได้ แต่ยังซ่อนเฉลยไว้ให้ผู้เล่นเลือกขอเอง',
  },
  {
    id: 'Q-006', label: 'ยังไม่เฉลยอัตโนมัติ', input: 'เวลาผ่านไป 480 วินาที', elapsedSeconds: 480,
    hintLevel: 2, answerRevealed: false, expected: 'แสดงคำใบ้ที่สองได้ แต่ยังซ่อนเฉลยไว้ให้ผู้เล่นเลือกขอเอง',
  },
  {
    id: 'Q-007', label: 'ไขปริศนาแล้ว', input: 'เวลาผ่านไป 300 วินาที · ไขปริศนาแล้ว',
    elapsedSeconds: 300, solved: true, hintLevel: 0, answerRevealed: false,
    expected: 'ไขปริศนาแล้ว จึงไม่แสดงคำใบ้เพิ่มเติม',
  },
  {
    id: 'Q-008', label: 'ยังไม่มีเวลาเริ่มจับ', input: 'ยังไม่มีเวลาที่ผ่านไป หรือข้อมูลเวลาไม่ถูกต้อง', elapsedSeconds: Number.NaN,
    hintLevel: 0, answerRevealed: false, expected: 'ยังไม่มีเวลาเริ่มจับ หรือข้อมูลเวลาไม่ถูกต้อง',
  },
];

type EncounterCheck = (rule: EncounterRule) => { actual: string; passed: boolean };

type EncounterFixture = {
  id: string;
  label: string;
  input: string;
  expected: string;
  check: EncounterCheck;
};

const ENCOUNTER_FIXTURES: readonly EncounterFixture[] = [
  {
    id: 'QE-001', label: 'โล่ช่วยเพื่อน', input: 'Mira ทอย 14 แล้ว Goblin ทอย 12',
    expected: 'Mira คุ้มกัน Pip · Goblin โจมตี 4 แต่โล่ลด 2 · Pip เหลือ 8 HP',
    check: (rule) => {
      const outcome = runEncounter(rule);
      const shield = outcome.events[0];
      const goblin = outcome.events[1];
      const passed = shield?.hit === true
        && shield.targetId === 'pip'
        && outcome.wardedAlly
        && goblin?.hit === true
        && goblin.damage === 2
        && goblin.reducedBy === 2
        && outcome.hp.pip === 8;
      return { actual: formatEncounterOutcome(outcome), passed };
    },
  },
  {
    id: 'QE-002', label: 'โล่ลดความเสียหายตามกติกา', input: 'กติกาโล่ลด 2 HP; Goblin โจมตีโดน',
    expected: 'ความเสียหาย 4 ลดลง 2 · Pip เสีย 2 HP',
    check: (rule) => {
      const outcome = runEncounter(rule);
      const event = outcome.events[1];
      const passed = event?.targetId === 'pip' && event.damage === 2 && event.reducedBy === 2;
      return { actual: event === undefined ? formatEncounterOutcome(outcome) : `${event.label} · Pip เหลือ ${outcome.hp.pip}/10 HP`, passed };
    },
  },
  {
    id: 'QE-003', label: 'Pip ปิดรอบด้วยการโจมตี', input: 'Pip ทอย 16 ใส่ Goblin ที่เหลือ 6 HP',
    expected: 'Pip โจมตีโดน · Goblin เสีย 6 HP · เหลือ 0 HP',
    check: (rule) => {
      const outcome = runEncounter(rule);
      const event = outcome.events[2];
      const passed = event?.actorId === 'pip'
        && event.hit
        && event.damage === 6
        && outcome.hp.goblin === 0
        && outcome.goblinDefeated;
      return { actual: formatEncounterOutcome(outcome), passed };
    },
  },
  {
    id: 'QE-004', label: 'โล่ที่พลาดไม่ลดความเสียหาย', input: 'Mira ทอย 9 แล้ว Goblin ทอย 12',
    expected: 'Mira พลาดการคุ้มกัน · Goblin ทำ 4 ความเสียหาย · Pip เหลือ 6 HP',
    check: (rule) => {
      const outcome = runEncounter(rule, [9, 12, 16]);
      const shield = outcome.events[0];
      const goblin = outcome.events[1];
      const passed = shield?.hit === false
        && !outcome.wardedAlly
        && goblin?.hit === true
        && goblin.damage === 4
        && goblin.reducedBy === 0
        && outcome.hp.pip === 6;
      return { actual: formatEncounterOutcome(outcome), passed };
    },
  },
  {
    id: 'QE-005', label: 'การโจมตีที่พลาดไม่ทำความเสียหาย', input: 'Goblin ทอย 9 ใส่ Pip',
    expected: 'Goblin พลาด · Pip ไม่เสีย HP · Pip เหลือ 10 HP',
    check: (rule) => {
      const outcome = runEncounter(rule, [14, 9, 16]);
      const event = outcome.events[1];
      const passed = event?.hit === false && event.damage === 0 && outcome.hp.pip === 10;
      return { actual: formatEncounterOutcome(outcome), passed };
    },
  },
  {
    id: 'QE-006', label: 'ความเสียหายไม่เกิน HP ที่เหลือ', input: 'Goblin เหลือ 2 HP; Pip ทอย 16',
    expected: 'Pip ทำความเสียหาย 2 · Goblin เหลือ 0 HP',
    check: (rule) => {
      const state = resolveEncounterAction(createEncounterState({ goblin: 2 }), 'pip', 16, rule);
      const event = state.events[0];
      const passed = event?.hit === true && event.damage === 2 && state.hp.goblin === 0;
      return { actual: `${event?.label ?? 'ยังไม่มีแอ็กชัน'} · Goblin เหลือ ${state.hp.goblin}/2 HP`, passed };
    },
  },
  {
    id: 'QE-007', label: 'ไม่มีการโจมตีเมื่อทอยต่ำกว่า 10', input: 'Goblin เหลือ 2 HP; Pip ทอย 9',
    expected: 'Pip พลาด · Goblin ยังคงเหลือ 2 HP',
    check: (rule) => {
      const state = resolveEncounterAction(createEncounterState({ goblin: 2 }), 'pip', 9, rule);
      const event = state.events[0];
      const passed = event?.hit === false && event.damage === 0 && state.hp.goblin === 2;
      return { actual: `${event?.label ?? 'ยังไม่มีแอ็กชัน'} · Goblin เหลือ ${state.hp.goblin}/2 HP`, passed };
    },
  },
  {
    id: 'QE-008', label: 'ไม่เริ่มเกมเมื่อไม่มีค่าลดความเสียหาย', input: 'ค่าลดความเสียหาย: ไม่มีข้อมูล หรือ NaN',
    expected: 'หยุดก่อนเล่น · ต้องระบุค่าลดความเสียหายจำนวนเต็ม 0–6',
    check: (rule) => {
      const missing = { allyShield: rule.allyShield };
      const nonFinite = { ...rule, shieldReduction: Number.NaN };
      const passed = !isValidEncounterRule(missing) && !isValidEncounterRule(nonFinite);
      return {
        actual: passed ? 'ข้อมูลโล่ไม่ครบ · ไม่เริ่มรอบ' : 'ข้อมูลไม่ถูกต้องแต่ยังเริ่มรอบได้',
        passed,
      };
    },
  },
];

type MusicSection = {
  id: string;
  name: string;
  beats: number;
  chorus: boolean;
};

const MUSIC_SECTIONS: readonly MusicSection[] = [
  { id: 'MU-001', name: 'Intro (ท่อนเปิด)', beats: 4, chorus: false },
  { id: 'MU-002', name: 'Verse 1 (ท่อนร้อง 1)', beats: 16, chorus: false },
  { id: 'MU-003', name: 'Pre-chorus (ก่อนฮุก)', beats: 8, chorus: false },
  { id: 'MU-004', name: 'Chorus (ท่อนฮุก)', beats: 8, chorus: true },
  { id: 'MU-005', name: 'Verse 2 (ท่อนร้อง 2)', beats: 16, chorus: false },
  { id: 'MU-006', name: 'Bridge (ท่อนเชื่อม)', beats: 8, chorus: false },
  { id: 'MU-007', name: 'Outro (ท่อนจบ)', beats: 4, chorus: false },
];

type MusicExpectation = {
  id: string;
  label: string;
  input: string;
  bpm: number;
  repetitions: number;
  beats: number;
  seconds: number;
  expected: string;
};

type PlannedSection = {
  id: string;
  name: string;
  bpm: number;
  repetitions: number;
  beats: number;
  seconds: number;
};

const MUSIC_EXPECTATIONS: readonly MusicExpectation[] = [
  {
    id: 'MU-001', label: 'Intro · ท่อนเปิด', input: 'ท่อนเปิด · 4 จังหวะ', bpm: 100, repetitions: 1, beats: 4, seconds: 2.4,
    expected: '100 BPM · 1 รอบ · 4 จังหวะ · 2.4 วินาที',
  },
  {
    id: 'MU-002', label: 'Verse 1 · ท่อนร้อง 1', input: 'ท่อนร้อง 1 · 16 จังหวะ', bpm: 100, repetitions: 1, beats: 16, seconds: 9.6,
    expected: '100 BPM · 1 รอบ · 16 จังหวะ · 9.6 วินาที',
  },
  {
    id: 'MU-003', label: 'Pre-chorus · ก่อนฮุก', input: 'ท่อนก่อนฮุก · 8 จังหวะ', bpm: 100, repetitions: 1, beats: 8, seconds: 4.8,
    expected: '100 BPM · 1 รอบ · 8 จังหวะ · 4.8 วินาที',
  },
  {
    id: 'MU-004', label: 'Chorus · ท่อนฮุก', input: 'ท่อนฮุก · 8 จังหวะต่อรอบ', bpm: 80, repetitions: 3, beats: 8, seconds: 18,
    expected: '80 BPM · 3 รอบ · 8 จังหวะต่อรอบ · รวม 18 วินาที',
  },
  {
    id: 'MU-005', label: 'Verse 2 · ท่อนร้อง 2', input: 'ท่อนร้อง 2 · 16 จังหวะ', bpm: 100, repetitions: 1, beats: 16, seconds: 9.6,
    expected: '100 BPM · 1 รอบ · 16 จังหวะ · 9.6 วินาที',
  },
  {
    id: 'MU-006', label: 'Bridge · ท่อนเชื่อม', input: 'ท่อนเชื่อม · 8 จังหวะ', bpm: 100, repetitions: 1, beats: 8, seconds: 4.8,
    expected: '100 BPM · 1 รอบ · 8 จังหวะ · 4.8 วินาที',
  },
  {
    id: 'MU-007', label: 'Outro · ท่อนจบ', input: 'ท่อนจบ · 4 จังหวะ', bpm: 100, repetitions: 1, beats: 4, seconds: 2.4,
    expected: '100 BPM · 1 รอบ · 4 จังหวะ · 2.4 วินาที',
  },
];

export function initialRules(): RuleBook {
  return {
    shipping: { bangkok: 40, regional: 50, extraKg: 10, effectiveDate: '2026-10-01' },
    quest: { firstHint: 300, secondHint: 480, autoReveal: true },
    music: { chorusBpm: 100, otherBpm: 100, repetitions: 1 },
  };
}

export function taughtRules(): RuleBook {
  return {
    shipping: { bangkok: 35, regional: 45, extraKg: 10, effectiveDate: '2026-10-15' },
    quest: { firstHint: 180, secondHint: 300, autoReveal: false },
    music: { chorusBpm: 80, otherBpm: 100, repetitions: 3 },
  };
}

function parseDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() === year
    && date.getUTCMonth() === month - 1
    && date.getUTCDate() === day;
}

function cents(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const result = Math.round((value + Number.EPSILON) * CENTS_PER_UNIT);
  return Number.isSafeInteger(result) ? result : null;
}

function isValidShippingRule(rule: ShippingRule): boolean {
  return rule !== null
    && typeof rule === 'object'
    && cents(rule.bangkok) !== null
    && cents(rule.regional) !== null
    && cents(rule.extraKg) !== null
    && typeof rule.effectiveDate === 'string'
    && parseDate(rule.effectiveDate);
}

function amountFor(
  baseRate: number,
  extraKgRate: number,
  weight: number,
): number | null {
  const baseCents = cents(baseRate);
  const extraCents = cents(extraKgRate);
  if (baseCents === null || extraCents === null || !Number.isFinite(weight) || weight < 0) return null;
  const startedExtraKg = Math.max(0, Math.ceil(weight - FIRST_KG_INCLUDED));
  if (!Number.isSafeInteger(startedExtraKg)) return null;
  const amountCents = baseCents + startedExtraKg * extraCents;
  if (!Number.isSafeInteger(amountCents)) return null;
  return amountCents / CENTS_PER_UNIT;
}

function calculateShipping(fixture: ShippingFixture, rule: ShippingRule): Pick<ShippingResult, 'amount' | 'reason'> {
  if (fixture.weight === null) return { amount: null, reason: MISSING_WEIGHT_REASON };
  if (!Number.isFinite(fixture.weight) || fixture.weight < 0) return { amount: null, reason: INVALID_WEIGHT_REASON };
  if (!parseDate(fixture.date)) return { amount: null, reason: INVALID_DATE_REASON };
  if (!isValidShippingRule(rule)) return { amount: null, reason: SHIPPING_RULE_ERROR };

  const isEffective = fixture.date >= rule.effectiveDate;
  const baseRate = fixture.zone === 'bangkok'
    ? (isEffective ? rule.bangkok : OLD_BANGKOK_RATE)
    : (isEffective ? rule.regional : OLD_REGIONAL_RATE);
  const amount = amountFor(baseRate, rule.extraKg, fixture.weight);
  return amount === null
    ? { amount: null, reason: SHIPPING_RULE_ERROR }
    : {
      amount,
      reason: isEffective ? `ใช้อัตราใหม่ตั้งแต่วันที่ ${rule.effectiveDate}` : 'คงอัตราเดิมก่อนวันเริ่มสัญญา',
    };
}

export function shippingResults(rule: ShippingRule): ShippingResult[] {
  return SHIPPING_FIXTURES.map((fixture) => ({
    id: fixture.id,
    name: fixture.name,
    zone: fixture.zone,
    date: fixture.date,
    weight: fixture.weight,
    billed: fixture.billed,
    ...calculateShipping(fixture, rule),
  }));
}

function isValidQuestRule(rule: QuestRule): boolean {
  return rule !== null
    && typeof rule === 'object'
    && Number.isSafeInteger(rule.firstHint)
    && rule.firstHint > 0
    && Number.isSafeInteger(rule.secondHint)
    && rule.secondHint > rule.firstHint
    && typeof rule.autoReveal === 'boolean';
}

export function isValidEncounterRule(rule: unknown): rule is EncounterRule {
  if (typeof rule !== 'object' || rule === null) return false;
  const candidate = rule as Record<string, unknown>;
  return typeof candidate.allyShield === 'boolean'
    && typeof candidate.shieldReduction === 'number'
    && Number.isSafeInteger(candidate.shieldReduction)
    && candidate.shieldReduction >= 0
    && candidate.shieldReduction <= 6;
}

// Pause behavior belongs to the caller's clock; this function only consumes elapsed time.
export function questStatus(
  rule: QuestRule,
  elapsedSeconds: number,
  solved = false,
): { hintLevel: 0 | 1 | 2; answerRevealed: boolean; summary: string } {
  if (solved) return { hintLevel: 0, answerRevealed: false, summary: 'ไขปริศนาแล้ว จึงไม่แสดงคำใบ้เพิ่มเติม' };
  if (!isValidQuestRule(rule)) {
    return { hintLevel: 0, answerRevealed: false, summary: 'ตั้งค่าเวลาคำใบ้ไม่ถูกต้อง' };
  }
  if (!Number.isFinite(elapsedSeconds) || elapsedSeconds < 0) {
    return { hintLevel: 0, answerRevealed: false, summary: 'ยังไม่มีเวลาเริ่มจับ หรือข้อมูลเวลาไม่ถูกต้อง' };
  }

  const hintLevel: 0 | 1 | 2 = elapsedSeconds >= rule.secondHint
    ? 2
    : elapsedSeconds >= rule.firstHint ? 1 : 0;
  const answerRevealed = rule.autoReveal && hintLevel === 2;
  const summary = hintLevel === 0
    ? 'ยังไม่ถึงเวลาคำใบ้แรก'
    : hintLevel === 1
      ? 'แสดงคำใบ้แรกได้แล้ว'
      : answerRevealed
        ? 'แสดงคำใบ้ที่สองได้แล้ว; เฉลยจะแสดงอัตโนมัติ'
        : 'แสดงคำใบ้ที่สองได้แล้ว; ยังซ่อนเฉลยไว้ให้ผู้เล่นเลือกขอเอง';
  return { hintLevel, answerRevealed, summary };
}

function isValidMusicRule(rule: MusicRule): boolean {
  const validFields = rule !== null
    && typeof rule === 'object'
    && Number.isFinite(rule.chorusBpm)
    && rule.chorusBpm > 0
    && Number.isFinite(rule.otherBpm)
    && rule.otherBpm > 0
    && Number.isSafeInteger(rule.repetitions)
    && rule.repetitions > 0;
  if (!validFields) return false;
  return MUSIC_SECTIONS.every((section) => {
    const bpm = section.chorus ? rule.chorusBpm : rule.otherBpm;
    const repetitions = section.chorus ? rule.repetitions : 1;
    return Number.isFinite((section.beats * repetitions * SECONDS_PER_MINUTE) / bpm);
  });
}

export function musicPlan(rule: MusicRule): PlannedSection[] {
  if (!isValidMusicRule(rule)) return [];
  return MUSIC_SECTIONS.map((section) => {
    const bpm = section.chorus ? rule.chorusBpm : rule.otherBpm;
    const repetitions = section.chorus ? rule.repetitions : 1;
    const seconds = (section.beats * repetitions * SECONDS_PER_MINUTE) / bpm;
    return {
      id: section.id,
      name: section.name,
      bpm,
      repetitions,
      beats: section.beats,
      seconds,
    };
  });
}

function numberToken(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === Number.POSITIVE_INFINITY) return '+Infinity';
  if (value === Number.NEGATIVE_INFINITY) return '-Infinity';
  if (Object.is(value, -0)) return '-0';
  return String(value);
}

function textToken(value: string): string {
  return `${value.length}:${value}`;
}

export function rulesFingerprint(caseId: CaseId, book: RuleBook): string {
  const fields = caseId === 'shipping'
    ? [numberToken(book.shipping.bangkok), numberToken(book.shipping.regional), numberToken(book.shipping.extraKg), textToken(book.shipping.effectiveDate)]
    : caseId === 'quest'
      ? [
        numberToken(book.quest.firstHint),
        numberToken(book.quest.secondHint),
        String(book.quest.autoReveal),
      ]
      : [numberToken(book.music.chorusBpm), numberToken(book.music.otherBpm), numberToken(book.music.repetitions)];
  if (caseId === 'quest' && book.quest.encounter !== undefined) {
    fields.push(typeof book.quest.encounter === 'object' && book.quest.encounter !== null
      ? `encounter:${String(book.quest.encounter.allyShield)}:${numberToken(book.quest.encounter.shieldReduction)}`
      : 'encounter:invalid');
  }
  return `trio-v1:${caseId}:${fields.map(textToken).join(':')}`;
}

function formatMoney(value: number): string {
  return Number.isFinite(value) ? `${value.toFixed(2)} บาท` : 'จำนวนเงินไม่ถูกต้อง';
}

function formatShippingActual(result: ShippingResult): string {
  const amount = result.amount === null ? 'ยังไม่คำนวณยอดใหม่' : `ยอดใหม่ ${formatMoney(result.amount)}`;
  return `${amount} · ยอดที่เรียกเก็บ ${formatMoney(result.billed)} · ${result.reason}`;
}

function shippingVerification(rule: ShippingRule): SampleResult[] {
  const results = new Map(shippingResults(rule).map((result) => [result.id, result]));
  const validRule = isValidShippingRule(rule);
  return SHIPPING_FIXTURES.map((fixture) => {
    const result = results.get(fixture.id);
    const passed = validRule
      && result !== undefined
      && result.amount === fixture.expectedAmount
      && result.billed === fixture.billed
      && result.reason === fixture.expectedReason;
    const actual = result === undefined ? 'ไม่มีผลคำนวณค่าส่ง' : formatShippingActual(result);
    const reason = passed
      ? 'ยอดคำนวณ ยอดที่เรียกเก็บ และสถานะตรวจสอบตรงกับตัวอย่างที่ตกลงไว้'
      : !validRule
        ? 'กติกาค่าส่งมีค่าติดลบ ค่าที่ใช้ไม่ได้ หรือวันที่ไม่ถูกต้อง'
        : 'ผลคำนวณไม่ตรงกับวันที่เริ่มใช้ อัตรา น้ำหนัก หรือสถานะตรวจสอบที่กำหนดไว้';
    return { id: fixture.id, label: fixture.name, input: fixture.input, expected: fixture.expected, actual, passed, reason };
  });
}

function describeQuestStatus(status: ReturnType<typeof questStatus>): string {
  const answer = status.answerRevealed ? 'แสดงเฉลยแล้ว' : 'ยังซ่อนเฉลย';
  return `คำใบ้ระดับ ${status.hintLevel} · ${answer} · ${status.summary}`;
}

function expectedQuestText(fixture: QuestFixture): string {
  const answer = fixture.answerRevealed ? 'แสดงเฉลยแล้ว' : 'ยังซ่อนเฉลย';
  return `คำใบ้ระดับ ${fixture.hintLevel} · ${answer} · ${fixture.expected}`;
}

function formatEncounterOutcome(outcome: EncounterOutcome): string {
  const events = outcome.events.map((event) => event.label).join(' · ');
  return `Mira ${outcome.hp.mira}/10 HP · Pip ${outcome.hp.pip}/10 HP · Goblin ${outcome.hp.goblin}/6 HP · ${events}`;
}

function encounterVerification(rule: EncounterRule): SampleResult[] {
  const validRule = isValidEncounterRule(rule);
  return ENCOUNTER_FIXTURES.map((fixture) => {
    if (!validRule) {
      return {
        id: fixture.id,
        label: fixture.label,
        input: fixture.input,
        expected: fixture.expected,
        actual: 'ข้อมูล encounter ไม่ถูกต้อง · ยังไม่เริ่มจำลอง',
        passed: false,
        reason: 'ระบุ allyShield เป็น true/false และ shieldReduction เป็นจำนวนเต็มตั้งแต่ 0 ถึง 6',
      };
    }
    const result = fixture.check(rule);
    return {
      id: fixture.id,
      label: fixture.label,
      input: fixture.input,
      expected: fixture.expected,
      actual: result.actual,
      passed: result.passed,
      reason: result.passed
        ? 'ผลจาก encounter runtime ตรงกับตัวอย่างการเล่นที่กำหนดไว้'
        : 'ผล encounter ต่างจากผลการเล่นที่กำหนดไว้; ตรวจเป้าหมายโล่, ลูกเต๋า และ HP',
    };
  });
}

function questVerification(rule: QuestRule): SampleResult[] {
  const validRule = isValidQuestRule(rule);
  return QUEST_FIXTURES.map((fixture) => {
    const status = questStatus(rule, fixture.elapsedSeconds, fixture.solved);
    const passed = validRule
      && status.hintLevel === fixture.hintLevel
      && status.answerRevealed === fixture.answerRevealed
      && (fixture.solved !== true || status.summary === fixture.expected)
      && (Number.isFinite(fixture.elapsedSeconds) || status.summary === fixture.expected);
    const actual = describeQuestStatus(status);
    const expected = expectedQuestText(fixture);
    const reason = passed
      ? 'เวลาแสดงคำใบ้และการควบคุมเฉลยตรงกับเรื่องที่ตกลงไว้'
      : !validRule
        ? 'กติกาคำใบ้ต้องมีเวลาบวกที่เพิ่มขึ้น และกำหนดการแสดงเฉลยให้ชัดเจน'
        : 'กติกาเปลี่ยนเวลาแสดงคำใบ้ การจบเกม หรือการจัดการเมื่อไม่มีเวลา';
    return { id: fixture.id, label: fixture.label, input: fixture.input, expected, actual, passed, reason };
  });
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatMusicActual(section: PlannedSection | undefined): string {
  if (section === undefined) return 'ยังจัดแผนซ้อมไม่ได้';
  return `${section.bpm} BPM · ${section.repetitions} รอบ · ${section.beats} จังหวะ · ${formatSeconds(section.seconds)} วินาที`;
}

function musicVerification(rule: MusicRule): SampleResult[] {
  const validRule = isValidMusicRule(rule);
  const planned = new Map(musicPlan(rule).map((section) => [section.id, section]));
  const sections = MUSIC_EXPECTATIONS.map((fixture) => {
    const section = planned.get(fixture.id);
    const passed = validRule
      && section !== undefined
      && section.bpm === fixture.bpm
      && section.repetitions === fixture.repetitions
      && section.beats === fixture.beats
      && Math.abs(section.seconds - fixture.seconds) < Number.EPSILON * fixture.seconds;
    const actual = formatMusicActual(section);
    const reason = passed
      ? 'ความเร็ว จำนวนรอบ จำนวนจังหวะ และเวลาตรงกับแผนซ้อมที่กำหนดไว้'
      : !validRule
        ? 'กติกาซ้อมมีความเร็วหรือจำนวนรอบที่ไม่ถูกต้อง'
        : 'ท่อนเพลงนี้ไม่ตรงกับแผนซ้อมที่กำหนดไว้';
    return { id: fixture.id, label: fixture.label, input: fixture.input, expected: fixture.expected, actual, passed, reason };
  });

  const missingInputRule: MusicRule = { ...rule, repetitions: Number.NaN };
  const missingInputPlan = musicPlan(missingInputRule);
  const missingInputPassed = missingInputPlan.length === 0;
  sections.push({
    id: 'MU-008',
    label: 'ยังไม่มีจำนวนรอบ',
    input: 'จำนวนรอบของท่อนฮุก: ไม่มีข้อมูล',
    expected: 'ยังไม่จัดแผนซ้อมจนกว่าจะระบุจำนวนรอบ',
    actual: missingInputPassed ? 'ยังจัดแผนซ้อมไม่ได้' : 'มีแผนซ้อมทั้งที่ยังไม่มีจำนวนรอบ',
    passed: missingInputPassed,
    reason: missingInputPassed
      ? 'ไม่รับกติกาที่ไม่มีจำนวนรอบ และไม่สร้างแผนซ้อมที่ใช้ค่าผิด'
      : 'ต้องระบุจำนวนรอบของท่อนฮุกก่อนสร้างแผนซ้อม',
  });
  return sections;
}

function caseVerification(caseId: CaseId, book: RuleBook): SampleResult[] {
  if (caseId === 'shipping') return shippingVerification(book.shipping);
  if (caseId === 'quest') {
    return book.quest.encounter === undefined
      ? questVerification(book.quest)
      : encounterVerification(book.quest.encounter);
  }
  return musicVerification(book.music);
}

export function verifyRules(caseId: CaseId, book: RuleBook): Verification {
  const cases = caseVerification(caseId, book);
  const passed = cases.filter((sample) => sample.passed).length;
  return {
    caseId,
    fingerprint: rulesFingerprint(caseId, book),
    cases,
    passed,
    failed: cases.length - passed,
  };
}

function isValidRuleForCase(caseId: CaseId, book: RuleBook): boolean {
  if (book === null || typeof book !== 'object') return false;
  if (caseId === 'shipping') return isValidShippingRule(book.shipping);
  if (caseId === 'quest') {
    if (book.quest === null || typeof book.quest !== 'object') return false;
    return book.quest.encounter === undefined
      ? isValidQuestRule(book.quest)
      : isValidEncounterRule(book.quest.encounter);
  }
  return isValidMusicRule(book.music);
}

function isSampleResult(value: unknown): value is SampleResult {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.label === 'string'
    && typeof record.input === 'string'
    && typeof record.expected === 'string'
    && typeof record.actual === 'string'
    && typeof record.passed === 'boolean'
    && typeof record.reason === 'string';
}

function expectedIds(caseId: CaseId, book: RuleBook): readonly string[] {
  if (caseId === 'shipping') return SHIPPING_FIXTURES.map((fixture) => fixture.id);
  if (caseId === 'quest') {
    return book.quest.encounter === undefined
      ? QUEST_FIXTURES.map((fixture) => fixture.id)
      : ENCOUNTER_FIXTURES.map((fixture) => fixture.id);
  }
  return [...MUSIC_EXPECTATIONS.map((fixture) => fixture.id), 'MU-008'];
}

export function canApprove(caseId: CaseId, book: RuleBook, evaluation: Verification | null): boolean {
  if (!isValidRuleForCase(caseId, book)) return false;
  if (evaluation === null || typeof evaluation !== 'object') return false;
  if (evaluation.caseId !== caseId || evaluation.fingerprint !== rulesFingerprint(caseId, book)) return false;
  const ids = expectedIds(caseId, book);
  if (!Array.isArray(evaluation.cases) || evaluation.cases.length !== ids.length) return false;
  if (!Number.isSafeInteger(evaluation.passed) || !Number.isSafeInteger(evaluation.failed)) return false;
  if (evaluation.failed !== 0 || evaluation.passed !== evaluation.cases.length) return false;

  return evaluation.cases.every((sample: unknown, index: number) => (
    isSampleResult(sample)
    && sample.id === ids[index]
    && sample.passed
  ));
}
