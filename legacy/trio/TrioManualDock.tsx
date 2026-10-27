import { useState, type FormEvent } from 'react';
import { ArrowLeft, BookOpen, Check, RotateCcw, Send, Sparkles } from 'lucide-react';
import type { CaseId, RuleBook, StoryStep } from './types';
import type { TrioController } from './TrioExperience';
import './trio-manual-dock.css';

const NUMBER = String.raw`((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)`;

export function isNegatedManualAction(text:string):boolean {
  return /(?:\b(?:do\s+not|don['’]t|never)\s+(?:yet\s+)?(?:approve|verify|test)\b|(?:ยังไม่|ไม่ต้อง|อย่า|ไม่)\s*(?:เพิ่ง\s*)?(?:อนุมัติ|ตรวจ|ทดสอบ))/i.test(text);
}

function numberAfter(text: string, label: string, suffix = '(?:บาท|baht)?'): number | undefined {
  const match = new RegExp(`(?:${label})\\s*(?:(?:=|is|to|at|เป็น|เหลือ|ตั้งเป็น)\\s*)?(?:฿\\s*)?${NUMBER}\\s*(?:฿\\s*|${suffix})?`, 'i').exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replaceAll(',', ''));
  return Number.isFinite(value) ? value : undefined;
}

function durationAfter(text: string, label: string): number | undefined {
  const match = new RegExp(`(?:${label})\\s*(?:(?:after|in|to|at|หลัง|ที่|เป็น|=)\\s*)?${NUMBER}\\s*(minutes?|mins?|min|m|นาที|seconds?|secs?|sec|s|วินาที)`, 'i').exec(text);
  if (!match) return undefined;
  const value = Number(match[1].replaceAll(',', ''));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  const unit = match[2].toLowerCase();
  return Math.round(value * (unit.startsWith('min') || unit === 'm' || unit === 'นาที' ? 60 : 1));
}

function validIsoDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function structuredDraft(caseId: CaseId, current: RuleBook, text: string): { draft: RuleBook; changed: boolean } | null {
  const draft = structuredClone(current);
  const before = JSON.stringify(draft[caseId]);
  let recognized = false;

  if (caseId === 'shipping') {
    const bangkok = numberAfter(text, String.raw`(?:bangkok|กรุงเทพ(?:ฯ)?|กทม\.?)`);
    const regional = numberAfter(text, String.raw`(?:regional|ต่างจังหวัด|ตจว\.?)`);
    const extra = numberAfter(
      text,
      String.raw`(?:extra\s*(?:weight|\/?\s*kg)?|extraKg|น้ำหนักส่วนเกิน|ส่วนเกิน|กิโล(?:กรัม)?ละ|per\s*kg|/\s*kg)`,
      '(?:บาท|baht|(?:ต่อ|per)\\s*(?:กิโล(?:กรัม)?|kg))?',
    );
    const date = /\b(20\d{2}-\d{2}-\d{2})\b/.exec(text)?.[1];
    if (bangkok !== undefined && bangkok >= 0) { draft.shipping.bangkok = bangkok; recognized = true; }
    if (regional !== undefined && regional >= 0) { draft.shipping.regional = regional; recognized = true; }
    if (extra !== undefined && extra >= 0) { draft.shipping.extraKg = extra; recognized = true; }
    if (date && validIsoDate(date)) { draft.shipping.effectiveDate = date; recognized = true; }
  }

  if (caseId === 'quest' && draft.quest.encounter) {
    const reduce = /(?:ลด(?:ความเสียหาย)?|shield)\s*(\d+)\s*(?:HP)?/i.exec(text);
    const noAlly = /(?:ไม่|อย่า)\s*(?:ให้)?\s*(?:โล่)?\s*ช่วยเพื่อน|self only/i.test(text);
    const ally = /ช่วยเพื่อน|ally shield/i.test(text);
    if (noAlly || ally) {draft.quest.encounter.allyShield = !noAlly;recognized=true;}
    if (reduce && Number(reduce[1])<=6) {draft.quest.encounter.shieldReduction=Number(reduce[1]);recognized=true;}
  }
  if (caseId === 'quest' && !draft.quest.encounter) {
    const firstHint = durationAfter(text, String.raw`(?:คำใบ้แรก|คำใบ้ที่\s*1|first\s*hint|hint\s*1|firstHint)`);
    const secondHint = durationAfter(text, String.raw`(?:คำใบ้ที่\s*(?:สอง|2)|คำใบ้สอง|second\s*hint|hint\s*2|secondHint)`);
    const noAutoReveal = /(?:\b(?:never|no)\s+(?:auto[\s-]?reveal|automatic(?:ally)?\s+reveal)\b|\b(?:do\s+not|don't)\s+(?:auto[\s-]?reveal|reveal\s+automatically)\b|ไม่\s*(?:ต้อง\s*)?(?:เฉลย(?:คำตอบ)?|เปิด(?:เผย)?(?:คำตอบ)?|แสดงคำตอบ)\s*อัตโนมัติ)/i.test(text);
    if (firstHint !== undefined) { draft.quest.firstHint = firstHint; recognized = true; }
    if (secondHint !== undefined) { draft.quest.secondHint = secondHint; recognized = true; }
    if (noAutoReveal) { draft.quest.autoReveal = false; recognized = true; }
  }

  if (caseId === 'music') {
    const bpmSuffix = String.raw`(?:bpm|บีพีเอ็ม)?`;
    const chorusBpm = numberAfter(text, String.raw`(?:chorus|ฮุก|ท่อนฮุก)(?:\s*(?:bpm|บีพีเอ็ม))?`, bpmSuffix);
    const otherBpm = numberAfter(text, String.raw`(?:other(?:\s+(?:section|parts?))?|verse|ท่อนอื่น(?:\s*ๆ)?|ส่วนอื่น)(?:\s*(?:bpm|บีพีเอ็ม))?`, bpmSuffix);
    const repetitions = numberAfter(
      text,
      String.raw`(?:repetitions?|reps?|rounds?|จำนวนรอบ|ซ้อม(?:\s*ซ้ำ)?)`,
      '(?:รอบ|repetitions?|reps?|rounds?|times)?',
    ) ?? (() => {
      const match = new RegExp(`${NUMBER}\\s*(?:repetitions?|reps?|rounds?|times|รอบ)`, 'i').exec(text);
      const value = match ? Number(match[1].replaceAll(',', '')) : NaN;
      return Number.isFinite(value) ? value : undefined;
    })();
    if (chorusBpm !== undefined && chorusBpm > 0) { draft.music.chorusBpm = chorusBpm; recognized = true; }
    if (otherBpm !== undefined && otherBpm > 0) { draft.music.otherBpm = otherBpm; recognized = true; }
    if (repetitions !== undefined && Number.isInteger(repetitions) && repetitions > 0) { draft.music.repetitions = repetitions; recognized = true; }
  }

  return recognized ? { draft, changed: before !== JSON.stringify(draft[caseId]) } : null;
}

function helpFor(caseId: CaseId): string {
  if (caseId === 'shipping') return 'ยังไม่แก้ Draft · ลองระบุ Bangkok 35 บาท, ต่างจังหวัด 45 บาท, ส่วนเกิน 12 บาท/กก. หรือวันที่ 2026-10-15';
  if (caseId === 'quest') return 'ยังไม่แก้ Draft · ลองพิมพ์ โล่ช่วยเพื่อน ลด 2 HP';
  return 'ยังไม่แก้ Draft · ลองระบุ Chorus 80 BPM, ท่อนอื่น 100 BPM หรือซ้อม 3 รอบ';
}

function placeholderFor(caseId: CaseId): string {
  if (caseId === 'shipping') return 'เช่น Bangkok 35 บาท · ต่างจังหวัด 45 บาท · 2026-10-15';
  if (caseId === 'quest') return 'เช่น โล่ช่วยเพื่อน ลด 2 HP · หรือ ไม่ช่วยเพื่อน';
  return 'เช่น Chorus 80 BPM · ท่อนอื่น 100 BPM · ซ้อม 3 รอบ';
}

export default function TrioManualDock({
  controller,
  onFocus,
  onKnowledge,
}: {
  controller: TrioController;
  onFocus: (step: StoryStep) => void;
  onKnowledge: () => void;
}) {
  const { snapshot, stageProps, story, player } = controller;
  const [instruction, setInstruction] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [feedback, setFeedback] = useState('');

  if (!snapshot || !stageProps || !story || player.guided) return null;
  const currentSnapshot = snapshot;
  const currentStageProps = stageProps;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = instruction.trim();
    if (!text) return;
    setSubmitted(text);
    setInstruction('');
    setFeedback('');

    if(isNegatedManualAction(text)) {
      setFeedback('ยังไม่ดำเนินการตรวจหรืออนุมัติตามที่ระบุ · กติกาที่ใช้อยู่ไม่เปลี่ยน');
      return;
    }

    if (/(?:ทดลอง|simulation|simulate|สมมติฐาน)/i.test(text)) {
      onFocus('simulate');
      setFeedback('เปิด Simulation แยกจากค่า Active · แก้ชุดทดลองในพื้นที่ Simulation');
      return;
    }
    if (/(?:ตรวจ|ทดสอบ|\bverify\b|\btest\b)/i.test(text)) {
      currentStageProps.onVerify();
      onFocus('verify');
      return;
    }
    if (/(?:อนุมัติ|\bapprove\b)/i.test(text) && !/(?:ไม่|อย่า)\s*(?:ต้อง\s*)?(?:อนุมัติ|approve)/i.test(text)) {
      currentStageProps.onApprove();
      onFocus('approve');
      return;
    }

    const edit = structuredDraft(currentSnapshot.caseId, currentSnapshot.draft, text);
    if (!edit) {
      setFeedback(helpFor(currentSnapshot.caseId));
      return;
    }
    if (edit.changed) {
      currentStageProps.onDraftChange(edit.draft);
      setFeedback('ปรับ Draft ตามช่องที่ระบุแล้ว · ต้องตรวจ Draft ปัจจุบันก่อนอนุมัติ');
    } else {
      setFeedback('ค่าที่ระบุตรงกับ Draft ปัจจุบันแล้ว · ไม่มีการเปลี่ยนแปลง');
    }
    onFocus('teach');
  }

  const teachStep: StoryStep = snapshot.level < 3 ? 'notice' : 'teach';
  const status = feedback || controller.messages.save || player.status || 'พิมพ์คำสั่งที่รองรับ หรือเลือกการทำงานด้านล่าง';
  const request = submitted || player.request || story.prompt;

  return (
    <section
      className="demo-player trio-manual-dock"
      data-testid="trio-player"
      data-case={snapshot.caseId}
      data-step={player.step}
      data-phase="complete"
      data-guided="false"
      aria-label="ตัวควบคุม workspace"
    >
      <div className="demo-player-label trio-manual-dock__label">
        <span>พื้นที่ทำงาน · {story.shortTitle}</span>
        <strong>{story.title}</strong>
      </div>
      <div className="demo-player-controls trio-manual-dock__controls">
        <button type="button" aria-label="Back to stories" title="กลับไปเลือกเรื่อง" onClick={controller.backToStories}><ArrowLeft size={15}/></button>
        <button type="button" aria-label="Replay story" title="เริ่มเรื่องนี้ใหม่" onClick={controller.replay}><RotateCcw size={15}/></button>
      </div>
      <div className="trio-manual-dock__status" data-testid="trio-status" role="status" aria-live="polite">
        <span className="trio-manual-dock__status-mark"><Check size={11}/></span>
        <span>{status}</span>
      </div>
      <div className="dock-suggestions trio-manual-dock__suggestions">
        <button type="button" onClick={() => onFocus(teachStep)}><Sparkles size={12}/>Teach a rule</button>
        <button type="button" onClick={() => { setFeedback(''); stageProps.onVerify(); onFocus('verify'); }}><Check size={12}/>Run example checks</button>
        <button type="button" onClick={onKnowledge}><BookOpen size={12}/>Follow lineage</button>
      </div>
      <form className="prompt-dock trio-manual-dock__composer" onSubmit={submit}>
        <span className="dock-spark"><Sparkles size={18}/></span>
        <textarea
          rows={1}
          aria-label="Describe a rule change"
          maxLength={280}
          value={instruction}
          onChange={(event) => { setInstruction(event.target.value); setFeedback(''); }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={placeholderFor(snapshot.caseId)}
        />
        <button className="send-button" type="submit" aria-label="Apply rule instruction" disabled={!instruction.trim()}><Send size={17}/></button>
      </form>
      <div className="dock-caption trio-manual-dock__caption">
        <span data-testid="trio-request">{request}</span>
        <span>Enter to apply</span>
      </div>
    </section>
  );
}
