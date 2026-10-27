import type { BuildPhase, CaseId, EvidenceEvent, StoryStep } from './types';

const steps: StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];
const labels: Record<StoryStep, string> = {
  sources: 'ข้อมูลต้นทาง · เปิดดูไฟล์ที่แนบ', minimal: 'พื้นที่ใช้งานจากข้อมูลชุดนี้',
  notice: 'สิ่งที่เปลี่ยน เทียบกับกติกาเดิม', teach: 'ร่างกติกา · ยังไม่เปลี่ยนของที่ใช้อยู่',
  verify: 'ตัวอย่างจริง · เทียบคำตอบที่คาดกับผลคำนวณ', approve: 'เวอร์ชันที่ผ่านการตรวจ',
  simulate: 'ชุดทดลอง · เทียบกับค่าที่ใช้อยู่', handoff: 'ไฟล์ผลลัพธ์และรายการที่ยังรอคนยืนยัน',
};

const QUEST_BOARD_STEPS = ['minimal', 'notice', 'teach', 'verify', 'approve', 'simulate'] as const satisfies readonly StoryStep[];

/** Quest keeps its playable encounter in one canvas object across every rule stage. */
export function canvasObjectForStep(caseId: CaseId, step: StoryStep, coalesceQuest = true): StoryStep {
  return coalesceQuest && caseId === 'quest' && QUEST_BOARD_STEPS.includes(step as typeof QUEST_BOARD_STEPS[number]) ? 'minimal' : step;
}

const EVENT_STEP: Record<EvidenceEvent['kind'], StoryStep> = {
  source: 'sources', instruction: 'teach', test: 'verify', approval: 'approve',
  run: 'minimal', simulation: 'simulate', handoff: 'handoff',
};

export function canvasObjectForEvent(caseId: CaseId, kind: EvidenceEvent['kind'], coalesceQuest = true): StoryStep {
  return canvasObjectForStep(caseId, EVENT_STEP[kind], coalesceQuest);
}

/** Count distinct canvas objects visible at a completed story level. */
export function canvasObjectCount(caseId: CaseId, level: number, coalesceQuest = true): number {
  const completed = steps.slice(0, Math.max(0, Math.min(steps.length, Math.floor(level))));
  return new Set(completed.map((step) => canvasObjectForStep(caseId, step, coalesceQuest))).size;
}
export const narrativeSubjects: Record<CaseId, { record: string; phrase: string; label: string; context: string }> = {
  shipping: { record: 'SH-001', phrase: 'พัสดุคุณเมย์', label: 'พัสดุคุณเมย์ · กรุงเทพฯ · 1 กก. · ยอดเดิม 40 บาท', context: 'SH-001 · ส่ง 15 ต.ค. 2026 · ยอดเดิม 40 บาท → สัญญาใหม่ 35 บาท' },
  quest: { record: 'pip', phrase: 'Pip', label: 'Pip โดนโจมตี · โล่เดิมช่วยเฉพาะคนถือ', context: 'แต้มเต๋าชุดเดิม · เปลี่ยนเฉพาะโล่ช่วยเพื่อนลด 2 HP' },
  music: { record: 'MU-004', phrase: 'ฮุก', label: 'Chorus / ท่อนฮุก · 100 BPM · ผู้ซ้อมบันทึกว่าเข้าช้า', context: 'MU-004 · Chorus 100 BPM → เสนอ 80 BPM วน 3 รอบ · ท่อนอื่นคงเดิม' },
};

/** Resolve narrative references to an existing object before moving to newly built UI. */
export function narrativeFocus(caseId: CaseId, step: StoryStep, phase: BuildPhase, level: number, coalesceQuest = true) {
  const beforeBuild = phase === 'typing' || phase === 'thinking';
  const previous: Partial<Record<StoryStep, StoryStep>> = {
    minimal: 'sources', notice: 'minimal', teach: 'notice', verify: 'teach', approve: 'verify', simulate: 'minimal', handoff: 'minimal',
  };
  let target = beforeBuild ? previous[step] ?? step : step;
  // Building objects are mounted as skeletons. Other phases must point at existing content.
  if (phase !== 'building' && steps.indexOf(target) >= level) target = steps[Math.max(0, level - 1)];
  const subject = narrativeSubjects[caseId];
  const record = beforeBuild && step === 'notice' ? subject.record : null;
  const sourceLabel = caseId === 'shipping' ? 'รายการพัสดุ · สัญญา PDF และข้อมูล JSON'
    : caseId === 'quest' ? 'ภาพฉาก · ฮีโร่สองคนกับก๊อบลินหนึ่งตัว'
      : 'คลิปซ้อม · เสียง วิดีโอ และบันทึกท่อนฮุก';
  target = canvasObjectForStep(caseId, target, coalesceQuest);
  return { target, record, label: record ? subject.label : target === 'sources' ? sourceLabel : labels[target] };
}

export function narrativeTerms(caseId: CaseId, step: StoryStep): string[] {
  const terms: Record<StoryStep, string[]> = {
    sources: ['ชีตออเดอร์', 'สัญญา PDF', 'รูปเส้นทาง', 'สามด่าน', 'คลิปซ้อม', 'ท่อนฮุก'],
    minimal: ['ปลายทาง', 'น้ำหนัก', 'ยอดที่ถูกคิด', 'สามด่าน', 'คลื่นเสียง', 'ไฟนับจังหวะ', '100 BPM'],
    notice: [narrativeSubjects[caseId].phrase, '40 บาท', 'สัญญาใหม่', 'ไม่เฉลย', 'ท่อนนี้'],
    teach: ['35', '45', '15 ต.ค. 2026', '3 นาที', '5 นาที', '80 BPM', '3 รอบ', '100'],
    verify: ['พัสดุเบา', 'หนัก', 'วันก่อนเริ่มสัญญา', 'ก่อนถึงเวลา', 'ตอนพัก', 'ผ่านด่าน', 'แต่ละท่อน', 'กี่วินาที'],
    approve: ['อัตราใหม่', 'เกมรอบนี้', 'ชีตนี้'], simulate: ['30', '2 นาที', '60 BPM'],
    handoff: ['ไฟล์สรุป', 'ไม่มีน้ำหนัก', 'แผนเกม', 'ห้องสมุด', 'ชีตซ้อม', 'มือกลอง'],
  };
  if (caseId === 'quest') return ({ sources: ['ภาพฉาก', 'ฮีโร่สองคน', 'ก๊อบลิน'], minimal: ['Mira', 'ยกโล่', 'Pip', 'ยิงธนู'], notice: ['Mira', 'Pip', 'เต็ม ๆ'], teach: ['ช่วยเพื่อน', '2 HP'], verify: ['ตาเดิม', 'แต้มเต๋าเดิม'], approve: ['Pip', 'รอบใหม่'], simulate: ['1 HP'], handoff: ['ไฟล์เกม', 'ความยาก'] } as Record<StoryStep,string[]>)[step];
  return terms[step];
}

// Authored demo references, resolved at word boundaries rather than on every typed letter.
export function narrativeAnchor(caseId: CaseId, step: StoryStep, request: string): string {
  return narrativeTerms(caseId, step).filter((term) => request.includes(term))
    .sort((a, b) => request.lastIndexOf(b) - request.lastIndexOf(a))[0] ?? '';
}

export function narrativeSelector(caseId: CaseId, step: StoryStep, target: StoryStep, anchor: string, coalesceQuest = true): string {
  if (caseId === 'quest' && target !== 'sources') return target === 'handoff' ? '.trio-deliverables__actions' : coalesceQuest ? '.encounter-game' : '.encounter-game__field';
  if (target === 'sources') {
    if (caseId === 'quest' && anchor === 'รูปเส้นทาง') return '.source-preview img';
    if (caseId === 'music' && anchor === 'คลิปซ้อม') return '.source-preview audio';
    if (caseId === 'music' && anchor === 'ท่อนฮุก') return '[data-narrative-record="MU-004"]';
    if (caseId === 'music' && anchor === '100 BPM') return '[data-narrative-field="bpm"]';
    if (caseId === 'quest' && anchor === 'สามด่าน') return '[data-narrative-field="station"]';
    const field = ({ ปลายทาง: 'zone', น้ำหนัก: 'weight', ยอดที่ถูกคิด: 'billed' } as Record<string, string>)[anchor];
    return field ? `[data-narrative-field="${field}"]` : '.source-preview';
  }
  if (target === 'minimal') {
    if (step === 'notice') {
      if (caseId === 'shipping') return anchor === 'พัสดุคุณเมย์' || !anchor
        ? '[data-narrative-record="SH-001"]' : '[data-narrative-record="SH-001"] [data-narrative-field="amount"]';
      return caseId === 'quest' ? '[data-narrative-record="library"]' : '[data-narrative-record="MU-004"]';
    }
    if (step === 'handoff') return caseId === 'shipping' ? '[data-narrative-record="SH-006"]' : caseId === 'quest' ? '[data-narrative-record="library"]' : '[data-narrative-record="MU-004"]';
    if (step === 'simulate') return caseId === 'shipping' ? '[data-narrative-field="bangkok"]' : caseId === 'quest' ? '[data-narrative-record="library"]' : '[data-narrative-record="MU-004"]';
    return caseId === 'shipping' ? '.trio-rate-table' : caseId === 'quest' ? '.quest-game__preview-feedback' : '[data-testid="music-waveform"]';
  }
  if (target === 'notice') return '.trio-diff-list';
  if (target === 'teach') return '.trio-field-groups';
  if (target === 'verify') return '.trio-sample';
  if (target === 'approve') return '.trio-approval-result';
  if (target === 'simulate') return '.trio-sim-slider';
  return '.trio-deliverables__actions';
}
