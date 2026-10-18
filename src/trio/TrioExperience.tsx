import { sourceEvidence, type SourceCue } from './sourceEvidence';
import { STORY_DURATIONS } from './demoTiming';
import { narrativeAnchor } from './narrativeFocus';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowRight, AudioLines, Box, Check, CirclePause, CirclePlay, ClipboardCheck, Clock3, Map, RotateCcw, Save, Sparkles } from 'lucide-react';
import TrioStage from './TrioStage';
import TrioKnowledge from './TrioKnowledge';
import type { EncounterOutcome } from './creative/encounterModel';
import {HANDOFF_ITEMS} from './handoff';
import { typingFrames } from './typing';
import { canApprove, initialRules, rulesFingerprint, taughtRules, verifyRules } from './domain';
import type { BuildPhase, CanvasLayout, CaseId, EvidenceEvent, RuleBook, StoryStep, TrioSnapshot, TrioStageProps, Verification } from './types';
import './trio-experience.css';

type Story = {
  id: CaseId;
  title: string;
  shortTitle: string;
  description: string;
  prompt: string;
  sourceSummary: string;
  agreement: string;
  correction: string;
  requests: Record<StoryStep, string>;
  statuses: Record<StoryStep, { thinking: string; building: string; reading: string }>;
  preview: 'shipping' | 'quest' | 'music';
};

export interface TrioStoryChoice {
  id: CaseId;
  title: string;
  shortTitle: string;
  description: string;
  prompt: string;
}

export interface TrioPlayer {
  sourceCue?: SourceCue;
  started: boolean;
  step: StoryStep;
  phase: BuildPhase;
  request: string;
  status: string;
  guided: boolean;
  paused: boolean;
  speed: number;
}

export interface TrioController {
  snapshot: TrioSnapshot | null;
  stageProps: TrioExperienceStageProps | null;
  story: TrioStoryChoice | null;
  stories: readonly TrioStoryChoice[];
  surfaceSession: number;
  player: TrioPlayer;
  savedCases: readonly CaseId[];
  messages: { save: string | null; storage: string | null };
  beginStory: (caseId: CaseId) => void;
  startPlayback: () => void;
  openSaved: (caseId: CaseId) => void;
  backToStories: () => void;
  takeOver: () => void;
  replay: () => void;
  previousStep: () => void;
  togglePause: () => void;
  nextStep: () => void;
  setSpeed: (speed: number) => void;
  saveWorkspace: () => void;
  onCanvasLayoutChange: (layout:CanvasLayout) => void;
}

export interface TrioExperienceProps {
  renderWorkspace?: (controller: TrioController) => ReactNode;
}

type EncounterPlaybackContext = 'baseline' | 'draft' | 'verify' | 'active' | 'simulation' | 'history';

export interface TrioExperienceStageProps extends TrioStageProps {
  onEncounterRoundComplete?: (outcome: EncounterOutcome, context: EncounterPlaybackContext) => void;
}

const STORIES: Story[] = [
  {
    id: 'shipping',
    title: 'ค่าส่งตามสัญญาใหม่',
    shortTitle: 'ค่าจัดส่ง',
    description: 'เริ่มจากรายการพัสดุกับสัญญา PDF แล้วปรับกติกาค่าส่ง',
    prompt: 'มีชีตออเดอร์กับสัญญา PDF ช่วยเช็กค่าส่งวันนี้หน่อย',
    sourceSummary: 'ชีตรายการพัสดุ + สัญญา PDF/JSON · อัตราเดิม 40/50 บาท · สัญญาใหม่ 35/45 บาท เริ่ม 15 ต.ค. 2026',
    agreement: 'Bangkok 35 บาท · ต่างจังหวัด 45 บาท ตั้งแต่ 15 ตุลาคม 2026 · น้ำหนักส่วนเกินคิดเพิ่มทุกกิโลกรัมละ 10 บาท',
    correction: 'พัสดุคุณเมย์ยังคิด 40 บาท สัญญาใหม่ลดแล้วไม่ใช่เหรอ?',
    requests: {
      sources: 'มีชีตออเดอร์กับสัญญา PDF ช่วยเช็กค่าส่งวันนี้หน่อย',
      minimal: 'ขอดูปลายทาง น้ำหนัก กับยอดที่ถูกคิดก่อน',
      notice: 'เอ๊ะ พัสดุคุณเมย์ยังคิด 40 บาทอยู่ สัญญาใหม่ลดแล้วนี่?',
      teach: 'อ๋อ กรุงเทพฯ 35 ต่างจังหวัด 45 เริ่ม 15 ต.ค. 2026 ส่วนเกินยังโลละ 10 นะ',
      verify: 'ลองพัสดุเบา หนัก แล้วก็วันก่อนเริ่มสัญญาให้ดูหน่อย',
      approve: 'โอเค ตรงแล้ว ใช้อัตราใหม่นี้ได้เลย',
      simulate: 'แล้วถ้าต่อรองกรุงเทพฯเหลือ 30 ล่ะ ลองเทียบให้หน่อย',
      handoff: 'ขอไฟล์สรุปด้วยนะ ส่วนรายการที่ไม่มีน้ำหนัก ฝากทีมเช็กต่อ',
    },
    statuses: {
      sources: { thinking: 'ขอดูชีตรายการส่งคู่กับสัญญา PDF ก่อนนะ', building: 'กำลังเปิดชีต สัญญา PDF และข้อมูล JSON', reading: 'ตอนนี้ใช้ราคาเดิม กรุงเทพฯ 40 · ต่างจังหวัด 50' },
      minimal: { thinking: 'เริ่มจากตารางเล็ก ๆ แค่ข้อมูลที่ใช้คิดค่าส่งก่อน', building: 'กำลังวางปลายทาง น้ำหนัก และยอด', reading: 'แนะนำตารางก่อนนะ · กดเลือกรูปแบบเพื่อเทียบการ์ดหรือกราฟได้' },
      notice: { thinking: 'อ๋อ ขอดูวันเริ่มสัญญาใหม่ก่อนนะ', building: 'กำลังแยกสิ่งที่เปลี่ยนออกจากอัตราส่วนเกิน', reading: 'ขอบเขตสัญญาใหม่ชัดเจนแล้ว' },
      teach: { thinking: 'จะร่างให้ดูก่อน ยังไม่เปลี่ยนอัตราที่ใช้อยู่', building: 'กำลังเติมค่าพื้นฐานและวันที่เริ่ม', reading: 'ร่างอัตราใหม่ครบสามช่อง' },
      verify: { thinking: 'ลองตัวอย่างที่คำตอบต่างกัน จะได้เห็นว่ากติกาถูกจริงไหม', building: 'กำลังคำนวณทุกกรณีด้วยกฎจริง', reading: 'ดูผลแต่ละพัสดุและวันที่ได้' },
      approve: { thinking: 'ขอเช็กอีกทีว่าร่างนี้ตรงกับที่เพิ่งทดสอบ', building: 'กำลังบันทึกเวอร์ชันสัญญาในเดโม', reading: 'เวอร์ชันตัวอย่างถูกลองใช้งานแล้ว' },
      simulate: { thinking: 'ได้ ลองอีกชุดให้เทียบ โดยคงสัญญาที่ใช้อยู่ไว้', building: 'กำลังตั้ง Bangkok 30 บาทในชุดทดลอง', reading: 'ดูผลทดลองแยกจากค่า active' },
      handoff: { thinking: 'จะสรุปเป็นไฟล์ พร้อมระบุรายการที่ยังคิดยอดไม่ได้', building: 'กำลังแนบผลและที่มาสำหรับส่งต่อ', reading: 'ตารางค่าส่งและรายงานพร้อมแล้ว · SH006 ยังต้องเติมน้ำหนัก' },
    },
    preview: 'shipping',
  },
  {
    id: 'quest',
    title: 'หนึ่งตากับก๊อบลิน',
    shortTitle: 'โต๊ะผจญภัย',
    description: 'เพื่อนใหม่หัดเล่นเกมแฟนตาซี แล้วช่วยกันรับมือก๊อบลินตัวเดียว',
    prompt: 'เพื่อนเพิ่งเริ่มเล่น D&D อยากได้เกมง่าย ๆ ที่ช่วยกันได้ · ใช้ภาพฉากนี้ให้ฮีโร่สองคนสู้ก๊อบลินตัวเดียว',
    sourceSummary: 'ภาพฉาก + บันทึกกติกา JSON · เพื่อนใหม่หัดเล่นด้วยกัน · Mira ถือโล่, Pip ถือธนู · ศัตรู 1 ตัว',
    agreement: 'โล่ช่วยเพื่อนที่ถูกโจมตี ลดความเสียหาย 2 HP · ทอยชุดเดิมเพื่อเทียบ · ใช้รอบใหม่หลังยืนยัน',
    correction: 'Mira ยกโล่ แต่ Pip ยังโดนเต็ม ๆ อยากให้ช่วยเพื่อนได้ด้วย',
    requests: {
      sources: 'เพื่อนเพิ่งเริ่มเล่น D&D อยากได้เกมง่าย ๆ ที่ช่วยกันได้ · ฮีโร่สองคนสู้ก๊อบลินตัวเดียว',
      minimal: 'มาเล่นด้วยกันหนึ่งตาเลย ให้ Mira ยกโล่ แล้ว Pip ยิงธนู',
      notice: 'เดี๋ยวนะ Mira ยกโล่แล้ว แต่ Pip ยังโดนเต็ม ๆ เลย',
      teach: 'เพื่อนใหม่อยากช่วยกัน เลือกเป้าหมายโล่ได้ไหม · ให้ลดความเสียหาย 2 HP',
      verify: 'เล่นตาเดิมซ้ำ ใช้แต้มเต๋าเดิม จะได้เห็นว่ากฎเปลี่ยนอะไร',
      approve: 'เห็นแล้ว Pip เจ็บน้อยลง ใช้กฎนี้กับรอบใหม่ได้เลย',
      simulate: 'ถ้าโล่ลดแค่ 1 HP ล่ะ ลองเล่นเทียบให้หน่อย',
      handoff: 'ขอไฟล์เกมไปเล่นต่อด้วย ส่วนความยากให้เพื่อนลองแล้วค่อยปรับ',
    },
    statuses: {
      sources: { thinking: 'ดูตำแหน่งตัวละครและกติกาเริ่มต้นก่อนนะ', building: 'กำลังวางฉากจากภาพและอ่านบันทึกกติกา', reading: 'Mira กับ Pip · ก๊อบลินหนึ่งตัว · กติกาย่อของเดโม' },
      minimal: { thinking: 'จะลองเล่นหนึ่งตาให้เห็นเลย', building: 'กำลังสร้างกระดาน ลูกเต๋า และแถบ HP', reading: 'ดู Mira ยกโล่ → ก๊อบลินโจมตี → Pip ยิงกลับ' },
      notice: { thinking: 'ใช่ โล่เดิมกันให้คนถือเท่านั้น', building: 'ชี้เหตุการณ์ที่ Pip โดนโจมตี', reading: 'กติกาเดิมยังช่วยเพื่อนไม่ได้' },
      teach: { thinking: 'ร่างกฎให้โล่ช่วย Pip แล้วลองเล่นให้ดู', building: 'กำลังเชื่อมโล่กับเป้าหมายที่ถูกโจมตี', reading: 'ร่างทดลอง · โล่ช่วยเพื่อนลด 2 HP' },
      verify: { thinking: 'ใช้การกระทำและแต้มเต๋าชุดเดิมทั้งสองกฎ', building: 'กำลังตรวจผลด้วยเกมตัวเดียวกัน', reading: 'ดู HP หลังเล่นตาเดิม · เปิดรายละเอียดการตรวจได้' },
      approve: { thinking: 'ตรวจว่าร่างตรงกับผลที่เพิ่งลอง', building: 'กำลังบันทึกกฎสำหรับรอบใหม่', reading: 'ยืนยันกฎใหม่แล้ว · ประวัติรอบเดิมไม่ถูกเขียนทับ' },
      simulate: { thinking: 'แยกชุดทดลองลด 1 HP ให้ลองก่อน', building: 'กำลังเตรียมรอบทดลองแยก', reading: 'ดูผลบนกระดาน · กฎที่ใช้อยู่ยังลด 2 HP' },
      handoff: { thinking: 'เก็บเกม กติกา และผลเล่นซ้ำให้', building: 'กำลังเตรียมไฟล์เกมออฟไลน์และรายงาน', reading: 'เกมพร้อมเล่นต่อ · ความยากยังรอคนลองจริง' },
    },
    preview: 'quest',
  },
  {
    id: 'music',
    title: 'ซ้อมวงให้เข้าจังหวะ',
    shortTitle: 'ซ้อมดนตรี',
    description: 'สร้างเครื่องซ้อม มีคลื่นเสียง ไฟจังหวะ และลูปท่อนฮุก',
    prompt: 'มีคลิปซ้อมนี้ ท่อนฮุกเข้าไม่พร้อมกัน ช่วยจัดรอบซ้อมหน่อย',
    sourceSummary: 'คลิปเสียง WAV + วิดีโอ WebM + บันทึก JSON 7 ท่อน · ตัวอย่างสังเคราะห์ 100 BPM พร้อมบันทึกจากผู้ซ้อม ไม่ใช่ผลวิเคราะห์เสียง',
    agreement: 'Chorus 80 BPM × 3 รอบ · ท่อนอื่น 100 BPM · การทดลองจังหวะเก็บแยกจากค่าที่ใช้งาน',
    correction: 'ฮุกเข้าช้าบ่อย ท่อนอื่นยังเล่นได้',
    requests: {
      sources: 'มีคลิปซ้อมนี้ ท่อนฮุกเข้าไม่พร้อมกัน ช่วยจัดรอบซ้อมหน่อย',
      minimal: 'ขอคลื่นเสียงกับไฟนับจังหวะ เริ่ม 100 BPM ก่อน',
      notice: 'อืม ฮุกยังเร็วไป ขอช้าลงแค่ท่อนนี้ได้ไหม',
      teach: 'เอาฮุก 80 BPM วน 3 รอบ ที่เหลือยัง 100 เหมือนเดิมนะ',
      verify: 'ลองเทียบแต่ละท่อนให้หน่อย แล้วซ้อมจบใช้เวลากี่วินาที?',
      approve: 'โอเค ใช้จังหวะนี้ซ้อมรอบหน้าเลย',
      simulate: 'แล้วถ้าฮุกเหลือ 60 BPM ล่ะ ลองเทียบแบบยังไม่เปลี่ยนของเดิม',
      handoff: 'ขอชีตซ้อมไว้แชร์ด้วย มือกลองยังไม่อยู่ เดี๋ยวให้วงยืนยันอีกที',
    },
    statuses: {
      sources: { thinking: 'ขอเปิดคลิปกับบันทึกท่อนฮุกที่วงแนบมาก่อนนะ', building: 'กำลังวางเสียง วิดีโอ และบันทึกท่อนเพลง', reading: 'คลิปตัวอย่างพร้อมฟัง · บันทึกของวงระบุฮุก 100 BPM' },
      minimal: { thinking: 'จะสร้างเครื่องซ้อมจากเสียงตัวอย่างให้ลอง', building: 'กำลังวาดคลื่นเสียง เชื่อมนาฬิกา และไฟจังหวะ', reading: 'เส้นวิ่งกับไฟใช้จังหวะเดียวกัน · รับช่วงแล้วกดฟังเสียงได้' },
      notice: { thinking: 'ได้ ช้าลงแค่ฮุก ท่อนอื่นยังใช้จังหวะเดิม', building: 'กำลังตั้งขอบเขตเฉพาะ Chorus', reading: 'ท่อนอื่นยังคงจังหวะเดิม' },
      teach: { thinking: 'จะร่างฮุก 80 BPM สามรอบไว้ให้ตรวจดูก่อน', building: 'กำลังเติม 80 BPM และสามรอบ', reading: 'ร่างซ้อม Chorus ครบแล้ว' },
      verify: { thinking: 'ลองทั้งฮุกและท่อนอื่น จะได้เห็นว่าที่เหลือไม่เปลี่ยน', building: 'กำลังคำนวณเวลาซ้อมแต่ละส่วน', reading: 'ดูผลตามท่อนและจำนวนรอบได้' },
      approve: { thinking: 'ขอเช็กว่ากติกาที่จะใช้ตรงกับที่เพิ่งลอง', building: 'กำลังตั้งเวอร์ชันชีตซ้อมตัวอย่าง', reading: 'เวอร์ชันตัวอย่างถูกลองแล้ว' },
      simulate: { thinking: 'ได้ ลอง 60 BPM อีกชุดให้เทียบ', building: 'กำลังตั้ง Chorus 60 BPM ในชุดทดลอง', reading: 'ฮุก 60 BPM ใช้เวลา 24 วินาที · ชุดใช้งานยัง 80 BPM' },
      handoff: { thinking: 'จะทำชีตซ้อมให้แชร์ต่อ พร้อมบันทึกสิ่งที่ยังต้องถามวง', building: 'กำลังส่งต่อจังหวะให้สมาชิกตรวจ', reading: 'ชีตซ้อมและรายงานพร้อมแล้ว · ยังรอวงยืนยันฮุก 80 BPM' },
    },
    preview: 'music',
  },
];

export const TRIO_STORIES: readonly TrioStoryChoice[] = STORIES.map(({ id, title, shortTitle, description, prompt }) => ({
  id,
  title,
  shortTitle,
  description,
  prompt,
}));

const STEPS: readonly StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];
const STEP_TITLES: Record<StoryStep, string> = {
  sources: 'ดูข้อมูลตั้งต้น',
  minimal: 'ทำพื้นที่ใช้งาน',
  notice: 'ตกลงสิ่งที่ต้องเปลี่ยน',
  teach: 'ร่างกติกา',
  verify: 'ลองกับตัวอย่าง',
  approve: 'ยืนยันเวอร์ชัน',
  simulate: 'ทดลองแยกชุด',
  handoff: 'สรุปผลและส่งต่อ',
};
const STEP_REQUESTS: Record<StoryStep, (story: Story) => string> = {
  sources: (story) => story.prompt,
  minimal: (story) => story.requests.minimal,
  notice: (story) => story.requests.notice,
  teach: (story) => story.requests.teach,
  verify: (story) => story.requests.verify,
  approve: (story) => story.requests.approve,
  simulate: (story) => story.requests.simulate,
  handoff: (story) => story.requests.handoff,
};
const STAGE_LABEL: Record<BuildPhase, string> = {
  typing: 'พิมพ์',
  thinking: 'คิด',
  building: 'สร้าง',
  reading: 'ดูผล',
  complete: 'ดูผล',
};
const STORAGE_PREFIX = 'procedural.trio.manual.v1.';
const DRAFT_GROUP_KEYS: Record<CaseId, readonly string[][]> = {
  shipping: [['bangkok', 'regional'], ['extraKg'], ['effectiveDate']],
  quest: [['firstHint'], ['secondHint'], ['autoReveal']],
  music: [['chorusBpm'], ['otherBpm'], ['repetitions']],
};

type SavedSlot = { schemaVersion: 1; mode: 'manual'; savedAt: string; snapshot: TrioSnapshot };
type SavedSlots = Partial<Record<CaseId, SavedSlot>>;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function makeId(prefix: string): string {
  const randomId = globalThis.crypto?.randomUUID?.();
  return `${prefix}_${randomId ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`}`;
}

function isCaseId(value: unknown): value is CaseId {
  return value === 'shipping' || value === 'quest' || value === 'music';
}

function isRuleBook(value: unknown): value is RuleBook {
  if (!value || typeof value !== 'object') return false;
  const book = value as Record<string, unknown>;
  const shipping = book.shipping as Record<string, unknown> | undefined;
  const quest = book.quest as Record<string, unknown> | undefined;
  const music = book.music as Record<string, unknown> | undefined;
  return Boolean(
    shipping && typeof shipping === 'object' && Number.isFinite(shipping.bangkok) && Number.isFinite(shipping.regional) && Number.isFinite(shipping.extraKg) && typeof shipping.effectiveDate === 'string' &&
    quest && typeof quest === 'object' && (quest.encounter === undefined || (typeof quest.encounter === 'object' && quest.encounter !== null && typeof (quest.encounter as Record<string, unknown>).allyShield === 'boolean' && Number.isInteger((quest.encounter as Record<string, unknown>).shieldReduction) && Number((quest.encounter as Record<string, unknown>).shieldReduction) >= 0 && Number((quest.encounter as Record<string, unknown>).shieldReduction) <= 6)) && Number.isFinite(quest.firstHint) && Number.isFinite(quest.secondHint) && typeof quest.autoReveal === 'boolean' &&
    music && typeof music === 'object' && Number.isFinite(music.chorusBpm) && Number.isFinite(music.otherBpm) && Number.isFinite(music.repetitions),
  );
}

function isVerification(value: unknown): value is Verification {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return isCaseId(item.caseId) && typeof item.fingerprint === 'string' && Number.isInteger(item.passed) && Number(item.passed) >= 0 && Number.isInteger(item.failed) && Number(item.failed) >= 0 && Array.isArray(item.cases) && Number(item.passed) + Number(item.failed) === item.cases.length && item.cases.every((sample) => {
    if (!sample || typeof sample !== 'object') return false;
    const row = sample as Record<string, unknown>;
    return typeof row.id === 'string' && typeof row.label === 'string' && typeof row.input === 'string' && typeof row.expected === 'string' && typeof row.actual === 'string' && typeof row.passed === 'boolean' && typeof row.reason === 'string';
  });
}

function isEvidenceEvent(value: unknown): value is EvidenceEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Record<string, unknown>;
  return typeof event.id === 'string' && event.id.length > 0 && ['source', 'instruction', 'test', 'approval', 'run', 'simulation', 'handoff'].includes(String(event.kind)) && typeof event.title === 'string' && typeof event.detail === 'string' && Number.isInteger(event.version) && Number(event.version) >= 0 && typeof event.at === 'string' && !Number.isNaN(Date.parse(event.at)) && Array.isArray(event.references) && event.references.every((reference) => typeof reference === 'string');
}

function isCanvasLayout(value:unknown):value is CanvasLayout {
  return Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.entries(value).every(([key,position])=>STEPS.includes(key as StoryStep)&&position&&typeof position==='object'&&Number.isFinite(position.x)&&Number.isFinite(position.y)&&Math.abs(position.x)<100000&&Math.abs(position.y)<100000));
}

function isTrioSnapshot(value: unknown): value is TrioSnapshot {
  if (!value || typeof value !== 'object') return false;
  const snapshot = value as Record<string, unknown>;
  return isCaseId(snapshot.caseId) && Number.isInteger(snapshot.level) && Number(snapshot.level) >= 0 && Number(snapshot.level) <= 8 &&
    isRuleBook(snapshot.active) && isRuleBook(snapshot.draft) && isRuleBook(snapshot.simulation) &&
    (snapshot.evaluation === null || isVerification(snapshot.evaluation)) && Number.isInteger(snapshot.version) && Number(snapshot.version) >= 0 &&
    typeof snapshot.approved === 'boolean' && Array.isArray(snapshot.events) && snapshot.events.every(isEvidenceEvent) && new Set((snapshot.events as EvidenceEvent[]).map((event) => event.id)).size === snapshot.events.length &&
    (snapshot.events as EvidenceEvent[]).every((event) => event.references.every((reference) => (snapshot.events as EvidenceEvent[]).some((item) => item.id === reference))) &&
    (snapshot.handoff === 'waiting' || snapshot.handoff === 'in-progress') &&
    (snapshot.layout===undefined||isCanvasLayout(snapshot.layout)) &&
    (!snapshot.evaluation || (snapshot.evaluation as Verification).caseId === snapshot.caseId);
}

function readSavedSlots(): { slots: SavedSlots; error: string | null } {
  if (typeof window === 'undefined') return { slots: {}, error: null };
  const slots: SavedSlots = {};
  let invalidFound = false;
  try {
    for (const story of STORIES) {
      const raw = window.localStorage.getItem(`${STORAGE_PREFIX}${story.id}`);
      if (!raw) continue;
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { invalidFound = true; continue; }
      if (!parsed || typeof parsed !== 'object') { invalidFound = true; continue; }
      const item = parsed as Record<string, unknown>;
      if (item.schemaVersion !== 1 || item.mode !== 'manual' || typeof item.savedAt !== 'string' || Number.isNaN(Date.parse(item.savedAt)) || !isTrioSnapshot(item.snapshot) || item.snapshot.caseId !== story.id) { invalidFound = true; continue; }
      slots[story.id] = item as SavedSlot;
    }
    return { slots, error: invalidFound ? 'พบ snapshot ที่อ่านรูปแบบไม่ได้ จึงไม่เปิดไฟล์นั้น' : null };
  } catch {
    return { slots, error: 'อ่านงานที่บันทึกไว้ไม่ได้ในเบราว์เซอร์นี้' };
  }
}

function initialSnapshot(caseId: CaseId): TrioSnapshot {
  const active = initialRules();
  if (caseId === 'quest') active.quest.encounter = { allyShield: false, shieldReduction: 2 };
  return {
    caseId,
    level: 0,
    active: clone(active),
    draft: clone(active),
    simulation: clone(active),
    evaluation: null,
    version: 1,
    approved: true,
    events: [],
    handoff: 'waiting',
  };
}

function createEvent(
  kind: EvidenceEvent['kind'],
  title: string,
  detail: string,
  version: number,
  references: string[] = [],
): EvidenceEvent {
  return { id: makeId(kind), kind, title, detail, version, at: new Date().toISOString(), references };
}

function revealedDraft(base: RuleBook, complete: RuleBook, caseId: CaseId, fieldCount: number): RuleBook {
  const result = clone(base);
  if (caseId === 'quest' && base.quest.encounter) {
    result.quest.encounter = { allyShield: fieldCount >= 1, shieldReduction: 2 };
    return result;
  }
  const target = complete[caseId] as unknown as Record<string, unknown>;
  const destination = result[caseId] as unknown as Record<string, unknown>;
  DRAFT_GROUP_KEYS[caseId].slice(0, fieldCount).flat().forEach((key) => { destination[key] = target[key]; });
  return result;
}

function simulatedRules(active: RuleBook, caseId: CaseId): RuleBook {
  const next = clone(active);
  if (caseId === 'shipping') next.shipping.bangkok = 30;
  if (caseId === 'quest') {
    if (next.quest.encounter) next.quest.encounter.shieldReduction = 1;
    else next.quest.firstHint = 120;
  }
  if (caseId === 'music') next.music.chorusBpm = 60;
  return next;
}

function getLastEventId(snapshot: TrioSnapshot, kind: EvidenceEvent['kind']): string | undefined {
  return [...snapshot.events].reverse().find((event) => event.kind === kind)?.id;
}

function sameCaseRules(caseId: CaseId, a: RuleBook, b: RuleBook): boolean {
  return rulesFingerprint(caseId, a) === rulesFingerprint(caseId, b);
}
function scopedRules(base:RuleBook, next:RuleBook, caseId:CaseId):RuleBook {
  return {...clone(base),[caseId]:clone(next[caseId])};
}

function Preview({ kind }: { kind: Story['preview'] }) {
  if (kind === 'shipping') {
    return <div className="trio-preview trio-preview--shipping" aria-hidden="true"><span className="trio-preview__tag">RATE CARD</span><div className="trio-rate-row"><span>Bangkok</span><strong>฿ 40</strong></div><div className="trio-rate-row"><span>Regional</span><strong>฿ 50</strong></div><div className="trio-preview__foot"><Box size={13} /> ส่วนเกิน +฿10 / kg</div></div>;
  }
  if (kind === 'quest') {
    return <div className="trio-preview trio-preview--quest" aria-hidden="true"><span className="trio-preview__tag">QUEST ROUTE</span><div className="trio-route"><i/><i/><i/><i/></div><div className="trio-hint-row"><span>01 · HINT</span><strong>05:00</strong><span>02 · HINT</span><strong>08:00</strong></div><div className="trio-preview__foot"><Map size={13} /> ค่อย ๆ ชี้ทางให้ผู้เล่น</div></div>;
  }
  return <div className="trio-preview trio-preview--music" aria-hidden="true"><span className="trio-preview__tag">REHEARSAL</span><div className="trio-wave">{[12, 22, 16, 29, 19, 34, 23, 14, 25, 18, 30, 13, 24, 17, 28, 15, 22, 11].map((height, index) => <i key={index} style={{ height }} />)}</div><div className="trio-beat-row"><span>VERSE <strong>100</strong></span><span>CHORUS <strong>80</strong><b>×3</b></span></div><div className="trio-preview__foot"><AudioLines size={13} /> ซ้อมตามท่อน ไม่วิเคราะห์เสียง</div></div>;
}

export default function TrioExperience({ renderWorkspace }: TrioExperienceProps = {}) {
  const savedInit = useRef(readSavedSlots());
  const [savedSlots, setSavedSlots] = useState<SavedSlots>(savedInit.current.slots);
  const [storageMessage, setStorageMessage] = useState<string | null>(savedInit.current.error);
  const [snapshot, setSnapshot] = useState<TrioSnapshot | null>(null);
  const [surfaceSession, setSurfaceSession] = useState(0);
  const snapshotRef = useRef<TrioSnapshot | null>(null);
  const [player, setPlayer] = useState<TrioPlayer>({ started: false, step: 'sources', phase: 'typing', request: '', status: '', guided: true, paused: true, speed: 1 });
  const playerRef = useRef(player);
  const [draftFields, setDraftFields] = useState(0);
  const [reduceMotion, setReduceMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const historyRef = useRef<Record<number, TrioSnapshot>>({});
  const epochRef = useRef(0);
  const pausedRef = useRef(false);
  const speedRef = useRef(1);
  const guidedRef = useRef(true);
  const advanceRef = useRef(false);

  const updatePlayer = useCallback((patch: Partial<typeof player>) => {
    const next = { ...playerRef.current, ...patch };
    playerRef.current = next;
    pausedRef.current = next.paused;
    speedRef.current = next.speed;
    guidedRef.current = next.guided;
    setPlayer(next);
  }, []);

  const commitSnapshot = useCallback((next: TrioSnapshot, saveToHistory = true) => {
    const copy = clone(next);
    snapshotRef.current = copy;
    setSnapshot(copy);
    if (saveToHistory) historyRef.current[copy.level] = clone(copy);
    return copy;
  }, []);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && playerRef.current.started && playerRef.current.guided && !playerRef.current.paused) {
        updatePlayer({ paused: true, status: 'พักเดโมไว้ให้ · กดเล่นต่อเมื่อกลับมาดู' });
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [updatePlayer]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduceMotion(media.matches);
    media.addEventListener?.('change', update);
    return () => media.removeEventListener?.('change', update);
  }, []);

  useEffect(() => () => { epochRef.current += 1; }, []);

  const delay = useCallback(async (milliseconds: number, epoch: number, skippable: boolean | 'cue' = false) => {
    let elapsed = 0;
    let last = Date.now();
    while (elapsed < milliseconds) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
      if (epoch !== epochRef.current || !guidedRef.current) return false;
      const now = Date.now();
      const delta = Math.min(80, Math.max(0, now - last));
      last = now;
      if (!pausedRef.current) elapsed += delta * speedRef.current;
      if (skippable && !pausedRef.current && advanceRef.current) {
        if (skippable === true) advanceRef.current = false;
        return true;
      }
    }
    return epoch === epochRef.current && guidedRef.current;
  }, []);

  const setPhase = useCallback((step: StoryStep, phase: BuildPhase, status: string) => {
    updatePlayer({ step, phase, status, sourceCue: undefined });
  }, [updatePlayer]);

  const runStory = useCallback(async (epoch: number, fromLevel: number) => {
    const story = STORIES.find((item) => item.id === snapshotRef.current?.caseId);
    if (!story) return;
    const fullTeaching = taughtRules();
    const waitForEncounterRound = async (step: 'minimal' | 'verify', fromEventCount: number) => {
      const expectedTitle = step === 'minimal' ? 'รอบตั้งต้นที่เล่นจริง' : 'เล่นซ้ำจริงหลัง Draft · verify';
      while (epoch === epochRef.current && guidedRef.current) {
        const current = snapshotRef.current;
        if (current?.events.slice(fromEventCount).some((event) => event.kind === 'run' && event.title === expectedTitle)) return true;
        if (!pausedRef.current && advanceRef.current) {
          advanceRef.current = false;
          return true;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 24));
      }
      return false;
    };

    try {
      while (pausedRef.current) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 20));
        if (epoch !== epochRef.current || !guidedRef.current) return;
      }
      for (let level = fromLevel; level <= STEPS.length; level += 1) {
        if (epoch !== epochRef.current || !guidedRef.current) return;
        const step = STEPS[level - 1];
        const request = STEP_REQUESTS[step](story);
        setPhase(step, 'typing', 'กำลังพิมพ์…');
        updatePlayer({ request: reduceMotion ? request : '' });
        if (!reduceMotion) {
          for (const frame of typingFrames(request, story.id, step)) {
            if (!await delay(frame.wait, epoch)) return;
            updatePlayer({ request: frame.text, status: frame.editing ? 'ขอคิดคำพูดนิดนึง…' : 'กำลังพิมพ์…' });
          }
        }
        setPhase(step, 'thinking', story.statuses[step].thinking);
        if (step === 'notice') {
          // Hold the existing problem first, then inspect its exact source before drafting.
          if (!await delay(1400, epoch)) return;
          const evidence = sourceEvidence(story.id, 'revise');
          for (const beat of ['locate', 'understand', 'connect'] as const) {
            updatePlayer({ sourceCue: { purpose: 'revise', beat }, status: beat === 'locate' ? evidence.observation : beat === 'understand' ? evidence.meaning : evidence.effect });
            if (!await delay(2800, epoch, 'cue')) return;
            if (advanceRef.current) break;
          }
        } else if (!await delay(1000, epoch)) return;
        setPhase(step, 'building', story.statuses[step].building);

        if (level === 4) {
          for (let field = 1; field <= 3; field += 1) {
            if (!await delay([0, 420, 500, 560][field], epoch)) return;
            const current = snapshotRef.current;
            if (!current) return;
            commitSnapshot({ ...current, level: 4, draft: revealedDraft(current.draft, fullTeaching, story.id, field), evaluation: null, approved: false }, field === 3);
            setDraftFields(field);
            if (epoch !== epochRef.current || !guidedRef.current) return;
          }
        } else if (level === 7) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          const simulation = simulatedRules(current.active, story.id);
          const approvalId = getLastEventId(current, 'approval');
          const runId = getLastEventId(current, 'run');
          const event = createEvent('simulation', 'สร้างชุดทดลองแยก', `ทดลอง ${story.id === 'shipping' ? 'Bangkok 30 บาท' : story.id === 'quest' ? 'โล่ลด 1 HP' : 'Chorus 60 BPM'} ใน Simulation; ไม่เปลี่ยนค่าที่ active`, current.version, [approvalId, runId].filter((id): id is string => Boolean(id)));
          commitSnapshot({ ...current, simulation, events: [...current.events, event] }, false);
        } else if (level === 8) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          const runId = getLastEventId(current, 'run');
          const simulationId = getLastEventId(current, 'simulation');
          const item = HANDOFF_ITEMS[story.id];
          const event = createEvent('handoff', `ส่งต่อ ${item.id}`, `${item.label}: ${item.detail} · ยังรอหลักฐานจากคนรับช่วง`, current.version, [runId, simulationId].filter((id): id is string => Boolean(id)));
          commitSnapshot({ ...current, handoff: 'in-progress', events: [...current.events, event] }, false);
        } else if (level === 1) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          const requestEvent = createEvent('source', 'คำขอตั้งต้นของเดโม', story.prompt, current.version);
          const evidence = sourceEvidence(story.id, 'create');
          const sampleEvent = createEvent('source', 'ข้อมูลตัวอย่างในเรื่องนี้', `${story.sourceSummary} · ${evidence.location}: ${evidence.observation} → ${evidence.effect}`,  current.version);
          commitSnapshot({ ...current, events: [...current.events, requestEvent, sampleEvent] }, false);
        } else if (level === 3) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          const sourceIds = current.events.filter((event) => event.kind === 'source').map((event) => event.id);
          const evidence = sourceEvidence(story.id, 'revise');
          const event = createEvent('instruction', 'ข้อตกลงของร่าง', `${story.agreement} · ที่มา: ${evidence.location} · ${evidence.meaning}`,  current.version + 1, sourceIds);
          commitSnapshot({ ...current, events: [...current.events, event] }, false);
        } else if (level === 5) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          const evaluation = verifyRules(story.id, current.draft);
          const instructionIds = current.events.filter((event) => event.kind === 'instruction').map((event) => event.id);
          const event = createEvent('test', 'ผลตรวจชุดตัวอย่าง', `ผ่าน ${evaluation.passed} กรณี · ไม่ผ่าน ${evaluation.failed} กรณี · Fingerprint ${evaluation.fingerprint}`, current.version + 1, [...current.events.filter((item) => item.kind === 'source').map((item) => item.id), ...instructionIds]);
          commitSnapshot({ ...current, evaluation, events: [...current.events, event] }, false);
        } else if (level === 6) {
          if (!await delay(600, epoch)) return;
          const current = snapshotRef.current;
          if (!current) return;
          if (!canApprove(story.id, current.draft, current.evaluation)) {
            updatePlayer({ phase: 'complete', status: 'หยุดไว้ก่อน · ร่างนี้ยังไม่มีผลตรวจที่ผ่านและตรงกัน' });
            return;
          }
          const nextVersion = current.version + 1;
          const testId = getLastEventId(current, 'test');
          const approval = createEvent('approval', 'อนุมัติในบทบาทตัวอย่างของเดโม', 'สคริปต์จำลองการอนุมัติโดยผู้รับบทในเดโม; ไม่ใช่บุคคลที่ยืนยันตัวตน', nextVersion, testId ? [testId] : []);
          const active = scopedRules(current.active,current.draft,story.id);
          const run = verifyRules(story.id, active);
          const runEvent = createEvent('run', 'ลองเวอร์ชันที่ active', `ผ่าน ${run.passed} กรณี · ไม่ผ่าน ${run.failed} กรณี`, nextVersion, [approval.id]);
          commitSnapshot({ ...current, active, version: nextVersion, approved: true, events: [...current.events, approval, runEvent] }, false);
        } else {
          if (!await delay(step === 'minimal' ? 1500 : 600, epoch)) return;
        }

        if (epoch !== epochRef.current || !guidedRef.current) return;
        const afterBuild = snapshotRef.current;
        if (!afterBuild) return;
        commitSnapshot({ ...afterBuild, level }, true);
        if (level !== 4) setDraftFields(level >= 4 ? 3 : 0);
        setPhase(step, 'reading', story.statuses[step].reading);
        if (step === 'sources') {
          // Let the skeleton settle before starting the reading cues.
          if (!await delay(900, epoch)) return;
          const evidence = sourceEvidence(story.id, 'create');
          for (const beat of ['locate', 'understand', 'connect'] as const) {
            updatePlayer({ sourceCue: { purpose: 'create', beat }, status: beat === 'locate' ? evidence.observation : beat === 'understand' ? evidence.meaning : evidence.effect });
            if (!await delay(2800, epoch, 'cue')) return;
            if (advanceRef.current) { advanceRef.current = false; break; }
          }
        } else if (story.id === 'quest' && (step === 'minimal' || step === 'verify')) {
          const fromEventCount = snapshotRef.current?.events.length ?? 0;
          if (!await waitForEncounterRound(step, fromEventCount)) return;
        } else if (!await delay(STORY_DURATIONS[step], epoch, true)) return;
      }
      if (epoch === epochRef.current && guidedRef.current) {
        updatePlayer({ phase: 'complete', status: 'ไฟล์ผลลัพธ์พร้อมแล้ว · ดาวน์โหลดหรือรับช่วงแก้ต่อได้เลย', paused: true });
      }
    } catch (error) {
      if (epoch !== epochRef.current) return;
      updatePlayer({ phase: 'complete', paused: true, status: error instanceof Error ? `เดโมหยุด: ${error.message}` : 'เดโมหยุดระหว่างทำงาน' });
    }
  }, [commitSnapshot, delay, reduceMotion, setPhase, updatePlayer]);

  const beginStory = useCallback((caseId: CaseId) => {
    setSurfaceSession(value=>value+1);
    epochRef.current += 1;
    advanceRef.current = false;
    const fresh = initialSnapshot(caseId);
    snapshotRef.current = fresh;
    setSnapshot(fresh);
    historyRef.current = { 0: clone(fresh) };
    setDraftFields(0);
    setSaveStatus(null);
    guidedRef.current = true;
    pausedRef.current = true;
    speedRef.current = 1;
    const ready: TrioPlayer = { started: false, step: 'sources', phase: 'typing', request: '', status: 'พร้อมแล้ว · กดเริ่มเดโมเมื่อคุณพร้อม', guided: true, paused: true, speed: 1 };
    playerRef.current = ready;
    setPlayer(ready);
  }, []);

  const startPlayback = useCallback(() => {
    if (!snapshotRef.current || !playerRef.current.guided || playerRef.current.started) return;
    updatePlayer({ started: true, paused: false, status: 'กำลังพิมพ์…' });
    void runStory(epochRef.current, 1);
  }, [runStory, updatePlayer]);

  const openSaved = useCallback((caseId: CaseId) => {
    const saved = savedSlots[caseId];
    if (!saved || !isTrioSnapshot(saved.snapshot)) {
      setStorageMessage('งานที่บันทึกไว้มีรูปแบบที่อ่านไม่ได้');
      return;
    }
    epochRef.current += 1;
    setSurfaceSession(value=>value+1);
    const restored = clone(saved.snapshot);
    snapshotRef.current = restored;
    setSnapshot(restored);
    historyRef.current = { [restored.level]: clone(restored) };
    setDraftFields(restored.level >= 4 ? 3 : 0);
    setSaveStatus('เปิดงานที่บันทึกไว้');
    guidedRef.current = false;
    pausedRef.current = false;
    setPlayer({ started: true, step: STEPS[Math.max(0, restored.level - 1)], phase: 'complete', request: STORIES.find((story) => story.id === caseId)?.prompt ?? '', status: 'โหมดทำงานปกติ · เปิด snapshot ที่บันทึกไว้', guided: false, paused: false, speed: 1 });
    playerRef.current = { started: true, step: STEPS[Math.max(0, restored.level - 1)], phase: 'complete', request: STORIES.find((story) => story.id === caseId)?.prompt ?? '', status: 'โหมดทำงานปกติ · เปิด snapshot ที่บันทึกไว้', guided: false, paused: false, speed: 1 };
  }, [savedSlots]);

  const backToStories = useCallback(() => {
    epochRef.current += 1;
    guidedRef.current = false;
    pausedRef.current = false;
    advanceRef.current = false;
    snapshotRef.current = null;
    setSnapshot(null);
    setSaveStatus(null);
    setDraftFields(0);
  }, []);

  const takeOver = useCallback(() => {
    epochRef.current += 1;
    guidedRef.current = false;
    pausedRef.current = false;
    advanceRef.current = false;
    updatePlayer({ sourceCue: undefined, started: true, guided: false, paused: false, phase: 'complete', status: 'โหมดทำงานปกติ · แก้ไขชุดเดียวกันต่อได้' });
  }, [updatePlayer]);

  const replay = useCallback(() => {
    const caseId = snapshotRef.current?.caseId;
    if (!caseId) return;
    beginStory(caseId);
  }, [beginStory]);

  const previousStep = useCallback(() => {
    const current = snapshotRef.current;
    if (!current || current.level <= 0) return;
    epochRef.current += 1;
    advanceRef.current = false;
    const previous = historyRef.current[current.level - 1];
    if (!previous) return;
    const restored = clone(previous);
    commitSnapshot(restored, false);
    setDraftFields(restored.level >= 4 ? 3 : 0);
    const story = STORIES.find((item) => item.id === restored.caseId)!;
    updatePlayer({ started: true, step: STEPS[Math.max(0, restored.level - 1)], phase: 'reading', request: STEP_REQUESTS[STEPS[Math.max(0, restored.level - 1)]](story), status: 'ย้อนกลับแล้ว · กดเล่นต่อเมื่อพร้อม', guided: true, paused: true });
    guidedRef.current = true;
    pausedRef.current = true;
    void runStory(epochRef.current, restored.level + 1);
  }, [commitSnapshot, runStory, updatePlayer]);

  const togglePause = useCallback(() => {
    if (!playerRef.current.guided || !playerRef.current.started) return;
    updatePlayer({ paused: !playerRef.current.paused, status: playerRef.current.paused ? 'เรื่องกำลังดำเนินต่อ' : 'หยุดเรื่องไว้ชั่วคราว' });
  }, [updatePlayer]);

  const nextStep = useCallback(() => {
    if (!playerRef.current.guided || !playerRef.current.started || playerRef.current.phase === 'building' || playerRef.current.phase === 'complete') return;
    advanceRef.current = true;
    if (pausedRef.current) updatePlayer({ paused: false, status: 'กำลังไปยังขั้นถัดไป' });
  }, [updatePlayer]);

  const setSpeed = useCallback((speed: number) => updatePlayer({ speed }), [updatePlayer]);

  const inspectSurface = useCallback(() => {
    if (playerRef.current.guided && playerRef.current.started && !playerRef.current.paused && playerRef.current.phase !== 'complete') {
      updatePlayer({ paused: true, status: 'พักเดโมไว้ให้เลือกดู · กดเล่นต่อเมื่อพร้อม' });
    }
  }, [updatePlayer]);

  const onDraftChange = useCallback((book: RuleBook) => {
    const current = snapshotRef.current;
    if (!current || !isRuleBook(book) || sameCaseRules(current.caseId, current.draft, book)) return;
    const sourceIds = current.events.filter((event) => event.kind === 'source').map((event) => event.id);
    const event = createEvent('instruction', 'แก้ Draft ในหน้าตั้งค่า', `ปรับ candidate ใน workspace · Fingerprint ${rulesFingerprint(current.caseId, book)}`, current.version + 1, sourceIds);
    commitSnapshot({ ...current, draft: clone(book), evaluation: null, approved: sameCaseRules(current.caseId, current.active, book), events: [...current.events, event] });
    setDraftFields(3);
    updatePlayer({ step: 'teach', phase: 'complete', status: 'Draft เปลี่ยนแล้ว · ต้องตรวจร่างปัจจุบันใหม่ก่อนอนุมัติ' });
    setSaveStatus(null);
  }, [commitSnapshot, updatePlayer]);

  const onFeedback = useCallback((detail: string) => {
    const current = snapshotRef.current;
    const note = detail.trim().slice(0, 280);
    if (!current || playerRef.current.guided || current.caseId !== 'music' || !note) return;
    const runId = getLastEventId(current, 'run');
    const event = createEvent('source', 'บันทึกจากคนซ้อม', note, current.version, runId ? [runId] : []);
    commitSnapshot({ ...current, events: [...current.events, event] });
    setSaveStatus('มีบันทึกจากคนซ้อมเพิ่ม · กดบันทึกงานเพื่อเก็บไว้');
  }, [commitSnapshot]);

  const onEncounterRoundComplete = useCallback((outcome: EncounterOutcome, context: EncounterPlaybackContext) => {
    const current = snapshotRef.current;
    if (!current || current.caseId !== 'quest' || !current.active.quest.encounter) return;
    const currentPlayer = playerRef.current;
    const actualShield = outcome.events.find((event) => event.actorId === 'mira');
    const actualAttack = outcome.events.find((event) => event.actorId === 'goblin');
    const detail = `ผลจากรอบที่เล่นจริง · Mira ${outcome.hp.mira}/10 HP · Pip ${outcome.hp.pip}/10 HP · Goblin ${outcome.hp.goblin}/6 HP · ${actualShield?.label ?? 'ไม่พบแอ็กชันโล่'} · ${actualAttack?.label ?? 'ไม่พบแอ็กชันโจมตี'} · d20 [${outcome.rolls.join(', ')}]`;

    if (currentPlayer.guided && context === 'baseline' && current.level === 2 && currentPlayer.step === 'minimal') {
      if (current.events.some((event) => event.kind === 'run' && event.title === 'รอบตั้งต้นที่เล่นจริง')) return;
      const sources = current.events.filter((event) => event.kind === 'source').map((event) => event.id);
      const event = createEvent('run', 'รอบตั้งต้นที่เล่นจริง', `${detail} · กฎเดิม: โล่คุ้มกันผู้ถือเท่านั้น`, current.version, sources);
      commitSnapshot({ ...current, events: [...current.events, event] }, true);
      return;
    }

    if (currentPlayer.guided && context === 'verify' && current.level === 5 && currentPlayer.step === 'verify') {
      const baselineId = current.events.find((event) => event.kind === 'run' && event.title === 'รอบตั้งต้นที่เล่นจริง')?.id;
      const testId = getLastEventId(current, 'test');
      const references = [baselineId, testId].filter((id): id is string => Boolean(id));
      const event = createEvent('run', 'เล่นซ้ำจริงหลัง Draft · verify', `${detail} · Draft fingerprint ${rulesFingerprint('quest', current.draft)}`, current.version + 1, references);
      commitSnapshot({ ...current, events: [...current.events, event] }, true);
      return;
    }

    if (currentPlayer.guided) return;

    const references = context === 'simulation'
      ? [getLastEventId(current, 'simulation'), getLastEventId(current, 'approval'), getLastEventId(current, 'run')]
      : context === 'draft'
        ? [getLastEventId(current, 'instruction'), ...current.events.filter((event) => event.kind === 'source').map((event) => event.id)]
        : context === 'history'
          ? [current.events.find((event) => event.kind === 'run' && event.title === 'รอบตั้งต้นที่เล่นจริง')?.id]
          : [getLastEventId(current, 'approval'), getLastEventId(current, 'test')];
    const kind = context === 'simulation' ? 'simulation' : 'run';
    const title = context === 'draft' ? 'ทดลอง Draft ที่เล่นจริง'
      : context === 'simulation' ? 'ทดลอง Simulation ที่เล่นจริง'
        : context === 'history' ? 'เล่นประวัติ Baseline ซ้ำจริง'
          : context === 'active' ? 'เล่นรอบ Active จริง' : 'เล่นรอบจริง';
    const fingerprint = context === 'history' || context === 'baseline'
      ? rulesFingerprint('quest', { ...current.active, quest: { ...current.active.quest, encounter: outcome.rule } })
      : rulesFingerprint('quest', context === 'draft' ? current.draft : context === 'simulation' ? current.simulation : current.active);
    const event = createEvent(kind, title, `${detail} · มุมมอง ${context} · กฎ ${fingerprint}`, current.version, [...new Set(references.filter((id): id is string => Boolean(id)))]);
    commitSnapshot({ ...current, events: [...current.events, event] }, true);
    setSaveStatus('บันทึกผลรอบที่เล่นจริงไว้ในประวัติงานแล้ว');
  }, [commitSnapshot]);

  const onSimulationChange = useCallback((book: RuleBook) => {
    const current = snapshotRef.current;
    if (!current || !isRuleBook(book) || sameCaseRules(current.caseId, current.simulation, book)) return;
    const activeEvent = getLastEventId(current, 'run') ?? getLastEventId(current, 'approval');
    const event = createEvent('simulation', 'ปรับชุดทดลองแยก', `แก้ Simulation เท่านั้น · Fingerprint ${rulesFingerprint(current.caseId, book)}`, current.version, activeEvent ? [activeEvent] : []);
    commitSnapshot({ ...current, simulation: clone(book), events: [...current.events, event] });
    setSaveStatus(null);
  }, [commitSnapshot]);

  const onVerify = useCallback(() => {
    const current = snapshotRef.current;
    if (!current) return;
    const evaluation = verifyRules(current.caseId, current.draft);
    const refs = current.events.filter((event) => event.kind === 'source' || event.kind === 'instruction').map((event) => event.id);
    const event = createEvent('test', 'ผลตรวจชุดตัวอย่าง', `ผ่าน ${evaluation.passed} กรณี · ไม่ผ่าน ${evaluation.failed} กรณี · Fingerprint ${evaluation.fingerprint}`, current.version + 1, refs);
    commitSnapshot({ ...current, level: Math.max(current.level, 5), evaluation, events: [...current.events, event] });
    updatePlayer({ step: 'verify', phase: 'complete', status: evaluation.failed === 0 ? 'ตัวอย่างผ่านสำหรับ Draft ปัจจุบัน' : `พบ ${evaluation.failed} กรณีที่ยังไม่ผ่าน` });
    setSaveStatus(evaluation.failed === 0 ? 'ตรวจผ่านสำหรับ Draft นี้' : `ตรวจแล้ว · ไม่ผ่าน ${evaluation.failed} กรณี`);
  }, [commitSnapshot, updatePlayer]);

  const onApprove = useCallback(() => {
    const current = snapshotRef.current;
    if (!current || !canApprove(current.caseId, current.draft, current.evaluation)) {
      setSaveStatus('อนุมัติไม่ได้ · ตรวจ Draft ปัจจุบันให้ผ่านก่อน');
      return;
    }
    const version = current.version + 1;
    const testId = getLastEventId(current, 'test');
    const approval = createEvent('approval', 'ผู้ใช้กดอนุมัติในเดโม', 'เป็นการกดใน workspace ตัวอย่าง; ระบบไม่ได้เก็บหรือยืนยันตัวตน', version, testId ? [testId] : []);
    const active = scopedRules(current.active,current.draft,current.caseId);
    const run = verifyRules(current.caseId, active);
    const runEvent = createEvent('run', 'ลองเวอร์ชันที่ active', `ผ่าน ${run.passed} กรณี · ไม่ผ่าน ${run.failed} กรณี`, version, [approval.id]);
    commitSnapshot({ ...current, level: Math.max(current.level, 6), active, version, approved: true, events: [...current.events, approval, runEvent] });
    updatePlayer({ step: 'approve', phase: 'complete', status: `เวอร์ชัน ${version} ผ่านการกดอนุมัติในเดโมแล้ว` });
    setSaveStatus(`เวอร์ชัน ${version} active แล้ว`);
  }, [commitSnapshot, updatePlayer]);

  const onHandoff = useCallback(() => {
    const current = snapshotRef.current;
    if (!current) return;
    if (current.handoff === 'in-progress') {
      setSaveStatus('รายการส่งต่องานนี้เปิดอยู่แล้ว');
      return;
    }
    const references = [getLastEventId(current, 'run'), getLastEventId(current, 'simulation')].filter((id): id is string => Boolean(id));
    const item = HANDOFF_ITEMS[current.caseId];
    const event = createEvent('handoff', `รับช่วง ${item.id}`, `${item.label}: ${item.detail} · รับช่วงแล้วแต่ข้อมูลที่ขาดยังไม่ถูกยืนยัน`, current.version, references);
    commitSnapshot({ ...current, level: Math.max(current.level, 8), handoff: 'in-progress', events: [...current.events, event] });
    updatePlayer({ step: 'handoff', phase: 'complete', status: 'บันทึก handoff ที่เริ่มโดยผู้ใช้แล้ว' });
    setSaveStatus('บันทึกการส่งต่องานใน workspace นี้แล้ว');
  }, [commitSnapshot, updatePlayer]);

  const onContinue = useCallback(() => {
    const current = snapshotRef.current;
    if (!current || playerRef.current.guided) return;
    const story = STORIES.find((item) => item.id === current.caseId)!;
    if (current.level === 0) {
      const source = createEvent('source', 'คำขอตั้งต้นของเดโม', story.prompt, current.version);
      const sample = createEvent('source', 'ข้อมูลตัวอย่างในเรื่องนี้', story.sourceSummary, current.version);
      commitSnapshot({ ...current, level: 1, events: [...current.events, source, sample] });
      updatePlayer({ step: 'sources', phase: 'complete', status: story.statuses.sources.reading });
      return;
    }
    if (current.level === 1) {
      commitSnapshot({ ...current, level: 2 });
      updatePlayer({ step: 'minimal', phase: 'complete', status: story.statuses.minimal.reading });
      return;
    }
    if (current.level === 2) {
      const sources = current.events.filter((event) => event.kind === 'source').map((event) => event.id);
      const instruction = createEvent('instruction', 'ข้อตกลงของร่าง', story.agreement, current.version + 1, sources);
      commitSnapshot({ ...current, level: 3, events: [...current.events, instruction] });
      updatePlayer({ step: 'notice', phase: 'complete', status: story.statuses.notice.reading });
      return;
    }
    if (current.level === 3) {
      commitSnapshot({ ...current, level: 4, draft: current.caseId === 'quest' && current.draft.quest.encounter ? { ...current.draft, quest: { ...current.draft.quest, encounter: { allyShield: true, shieldReduction: 2 } } } : scopedRules(current.draft,taughtRules(),current.caseId), evaluation: null, approved: false });
      setDraftFields(3);
      updatePlayer({ step: 'teach', phase: 'complete', status: story.statuses.teach.reading });
      return;
    }
    if (current.level === 4) {
      onVerify();
      return;
    }
    if (current.level === 5) {
      onApprove();
      return;
    }
    if (current.level === 6) {
      const simulation = simulatedRules(current.active, current.caseId);
      const approvalId = getLastEventId(current, 'approval');
      const runId = getLastEventId(current, 'run');
      const event = createEvent('simulation', 'สร้างชุดทดลองแยก', `ทดลอง ${current.caseId === 'shipping' ? 'Bangkok 30 บาท' : current.caseId === 'quest' ? current.active.quest.encounter ? 'โล่ลด 1 HP' : 'คำใบ้แรก 120 วินาที' : 'Chorus 60 BPM'} ใน Simulation; ไม่เปลี่ยนค่าที่ active`, current.version, [approvalId, runId].filter((id): id is string => Boolean(id)));
      commitSnapshot({ ...current, level: 7, simulation, events: [...current.events, event] });
      updatePlayer({ step: 'simulate', phase: 'complete', status: story.statuses.simulate.reading });
      return;
    }
    if (current.level === 7) {
      const item=HANDOFF_ITEMS[current.caseId];
      const runId=getLastEventId(current,'run');
      const event=createEvent('handoff',`รอส่งต่อ ${item.id}`,`${item.label}: ${item.detail}`,current.version,runId?[runId]:[]);
      commitSnapshot({ ...current, level: 8, handoff: 'waiting',events:[...current.events,event] });
      updatePlayer({ step: 'handoff', phase: 'complete', status: 'มีหนึ่งประเด็นรอให้คุณเริ่มส่งต่องาน' });
    }
  }, [commitSnapshot, onApprove, onVerify, updatePlayer]);

  const onCanvasLayoutChange=useCallback((layout:CanvasLayout)=>{
    const current=snapshotRef.current;if(!current||guidedRef.current||!isCanvasLayout(layout))return;
    commitSnapshot({...current,layout:{...current.layout,...clone(layout)}});setSaveStatus(null);
  },[commitSnapshot]);

  const saveWorkspace = useCallback(() => {
    const current = snapshotRef.current;
    if (!current) return;
    const slot: SavedSlot = { schemaVersion: 1, mode: 'manual', savedAt: new Date().toISOString(), snapshot: clone(current) };
    try {
      window.localStorage.setItem(`${STORAGE_PREFIX}${current.caseId}`, JSON.stringify(slot));
      setSavedSlots((previous) => ({ ...previous, [current.caseId]: slot }));
      setStorageMessage(null);
      setSaveStatus('บันทึกไว้ในเบราว์เซอร์นี้แล้ว');
    } catch {
      setSaveStatus('บันทึกไม่สำเร็จ · เบราว์เซอร์ปฏิเสธพื้นที่จัดเก็บ');
    }
  }, []);

  const selectedStory = snapshot ? STORIES.find((story) => story.id === snapshot.caseId) : null;
  const currentStep = player.step;
  const selectedChoice = selectedStory ? TRIO_STORIES.find((story) => story.id === selectedStory.id) ?? null : null;
  const stageProps: TrioExperienceStageProps | null = snapshot ? {
    sourceCue: player.sourceCue,
    onSourceInspect: (purpose) => updatePlayer({ sourceCue: { purpose, beat: 'understand' }, paused: true, status: 'ดูหลักฐานที่ใช้สร้างส่วนนี้ · กดเล่นต่อเมื่อพร้อม' }),
    narrativeAnchor: narrativeAnchor(snapshot.caseId, player.step, player.request),
    onInspect: inspectSurface,
    snapshot,
    step: currentStep,
    phase: player.phase,
    draftFields,
    guided: player.guided,
    paused: player.paused,
    speed: player.speed,
    onDraftChange,
    onSimulationChange,
    onVerify,
    onApprove,
    onHandoff,
    onContinue,
    onFeedback,
    onEncounterRoundComplete,
  } : null;
  const controller: TrioController = {
    snapshot,
    stageProps,
    story: selectedChoice,
    stories: TRIO_STORIES,
    surfaceSession,
    player,
    savedCases: TRIO_STORIES.filter((story) => Boolean(savedSlots[story.id])).map((story) => story.id),
    messages: { save: saveStatus, storage: storageMessage },
    beginStory,
    startPlayback,
    openSaved,
    backToStories,
    takeOver,
    replay,
    previousStep,
    togglePause,
    nextStep,
    setSpeed,
    saveWorkspace,
    onCanvasLayoutChange,
  };

  if (renderWorkspace) return <>{renderWorkspace(controller)}</>;

  if (!snapshot || !selectedStory) {
    return <main className="trio-app trio-hub" data-testid="trio-hub">
      <header className="trio-hub__header">
        <div className="trio-brand"><span className="trio-brand__mark"><i/><i/><i/><i/></span><span>procedural<span className="trio-brand__dot">.</span></span></div>
        <span className="trio-hub__edition">THREE WORKSPACES <i/> DEMO</span>
      </header>
      <section className="trio-hub__intro">
        <span className="trio-eyebrow"><Sparkles size={14}/> เริ่มจากเรื่องที่อยากจัดการ</span>
        <h1>อยากให้อะไรดีขึ้น?</h1>
        <p>เลือกหนึ่งเรื่อง แล้วดูพื้นที่ทำงานค่อย ๆ ก่อตัวจากคำขอของคุณ<br className="trio-desktop-break"/> รับช่วงแก้ต่อใน workspace เดิมได้ทุกเมื่อ</p>
        <span className="trio-hub__truth"><i/> ข้อมูลตัวอย่าง · ยังไม่เชื่อม AI</span>
      </section>
      {storageMessage && <p className="trio-storage-message" role="status">{storageMessage}</p>}
      <section className="trio-cases" aria-label="เลือกเรื่องตัวอย่าง">
        {STORIES.map((story, index) => (
          <article className={`trio-case trio-case--${story.id}`} key={story.id} data-testid={`case-${story.id}`}>
            <div className="trio-case__topline"><span>0{index + 1} <i/> {story.shortTitle}</span><span className="trio-case__icon">{story.preview === 'shipping' ? <Box size={17}/> : story.preview === 'quest' ? <Map size={17}/> : <AudioLines size={17}/>}</span></div>
            <Preview kind={story.preview}/>
            <div className="trio-case__copy"><h2>{story.title}</h2><p>{story.description}</p></div>
            <div className="trio-case__actions">
              <button className="trio-button trio-button--start" onClick={() => beginStory(story.id)} aria-label="เริ่มจากพื้นที่ว่าง">เริ่มจากพื้นที่ว่าง <ArrowRight size={15}/></button>
              {savedSlots[story.id] && <button className="trio-case__resume" onClick={() => openSaved(story.id)} aria-label={`เปิดงานที่บันทึกไว้ของ${story.shortTitle}`}><Clock3 size={13}/> เปิดงานที่บันทึกไว้</button>}
            </div>
          </article>
        ))}
      </section>
      <footer className="trio-hub__footer"><span><ClipboardCheck size={13}/> ตัวอย่างกติกา · ผลตรวจอ่านได้ · ทดลองแยกจากค่าที่ใช้งาน</span><span>Procedural <i/> Workspace stories</span></footer>
    </main>;
  }

  const completed = snapshot.level;
  const storyStepNumber = STEPS.indexOf(currentStep) + 1;

  return <main className={`trio-app trio-workspace trio-workspace--${snapshot.caseId}`} data-case={snapshot.caseId} data-guided={String(player.guided)} data-version={snapshot.version}>
    <header className="trio-workspace__header">
      <button className="trio-back" aria-label="Back to stories" onClick={backToStories}><ArrowLeft size={15}/> <span>กลับไปยังเรื่องอื่น</span></button>
      <div className="trio-workspace__title"><div className="trio-brand trio-brand--small"><span className="trio-brand__mark"><i/><i/><i/><i/></span><span>procedural<span className="trio-brand__dot">.</span></span></div><i className="trio-workspace__divider"/><div><strong>{selectedStory.shortTitle}</strong><small>ข้อมูลตัวอย่าง · ยังไม่เชื่อม AI</small></div></div>
      <div className="trio-workspace__actions">
        <TrioKnowledge snapshot={snapshot}/>
        {!player.guided && <button className="trio-button trio-button--save" aria-label="Save workspace" onClick={saveWorkspace}><Save size={14}/> บันทึกงาน</button>}
        {player.guided && <button className="trio-button trio-button--takeover" aria-label="Take over workspace" onClick={takeOver}>ใช้ workspace ต่อ <ArrowRight size={14}/></button>}
      </div>
    </header>

    <section className="trio-player" data-testid="trio-player" data-case={snapshot.caseId} data-step={currentStep} data-phase={!player.started ? 'ready' : player.phase} aria-label="ตัวควบคุมเรื่องตัวอย่าง">
      <div className="trio-player__top">
        <div className="trio-player__heading"><span className="trio-player__step">{String(storyStepNumber).padStart(2, '0')} <i/> {STEP_TITLES[currentStep]}</span><strong>{player.guided ? selectedStory.shortTitle : 'พื้นที่ทำงานพร้อมใช้'}</strong></div>
        <div className="trio-player__controls">
          {player.guided && <>
            <button aria-label="Previous story step" title="ย้อนหนึ่งขั้น" disabled={completed === 0} onClick={previousStep}><ArrowLeft size={15}/></button>
            <button aria-label={!player.started ? 'Start demo' : player.paused ? 'Resume story' : 'Pause story'} title={player.paused ? 'เล่นเรื่องต่อ' : 'พักเรื่อง'} disabled={player.phase === 'complete'} onClick={player.started ? togglePause : startPlayback}>{!player.started ? <>เริ่มเดโม <CirclePlay size={17}/></> : player.paused ? <CirclePlay size={17}/> : <CirclePause size={17}/>}</button>
            <button aria-label="Next story step" title="ไปขั้นถัดไป" disabled={!player.started || player.phase === 'building' || player.phase === 'complete'} onClick={nextStep}><ArrowRight size={15}/></button>
            <label className="trio-speed"><span className="trio-visually-hidden">ความเร็ว</span><select aria-label="Story playback speed" value={player.speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
          </>}
          <button aria-label="Replay story" title="เริ่มเดโมใหม่" onClick={replay}><RotateCcw size={15}/></button>
        </div>
      </div>
      <div className="trio-player__rail" aria-label="พิมพ์ คิด สร้าง ดูผล">
        {(['typing', 'thinking', 'building', 'reading'] as const).map((phase, index) => <span key={phase} className={player.phase === phase || (player.phase === 'complete' && phase === 'reading') ? 'is-current' : 'is-idle'}><i>{player.phase === 'complete' && phase === 'reading' ? <Check size={10}/> : `0${index + 1}`}</i>{STAGE_LABEL[phase]}</span>)}
      </div>
      <div className="trio-player__request" data-testid="trio-request"><span>คำขอในเดโม</span><p>{player.request || (player.phase === 'typing' ? 'กำลังเริ่มจากคำขอสั้น ๆ…' : 'คำขอของเรื่องนี้')}</p></div>
      <div className="trio-player__status" data-testid="trio-status" role="status" aria-live="polite"><span className={`trio-status-mark trio-status-mark--${player.phase}`}><i/><i/><i/></span><span>{player.status || 'กำลังทำงานตามลำดับ'}</span>{player.guided && <small>{player.paused ? 'พักอยู่' : `ขั้น ${completed}/8`}</small>}{!player.guided && <small>โหมดทำงานปกติ</small>}</div>
    </section>

    <section className="trio-stage-shell" data-version={snapshot.version} data-guided={String(player.guided)} aria-label={`workspace ${selectedStory.shortTitle}`}>
      <TrioStage
        onInspect={inspectSurface}
        key={surfaceSession}
        snapshot={snapshot}
        step={currentStep}
        phase={player.phase}
        draftFields={draftFields}
        guided={player.guided}
        paused={player.paused}
        onDraftChange={onDraftChange}
        onSimulationChange={onSimulationChange}
        onVerify={onVerify}
        onApprove={onApprove}
        onHandoff={onHandoff}
        onContinue={onContinue}
        onFeedback={onFeedback}
      />
    </section>

    <footer className="trio-workspace__footer">
      <span><i className="trio-footer-dot"/> ข้อมูลตัวอย่าง · เก็บแต่ละเรื่องแยกกันในเบราว์เซอร์นี้</span>
      <span>{saveStatus ?? storageMessage ?? (player.guided ? 'คุณรับช่วงต่อได้ทุกเมื่อ' : 'พื้นที่นี้แก้ไขและทดลองได้จริง')}</span>
    </footer>
  </main>;
}
