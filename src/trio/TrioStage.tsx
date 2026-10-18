import EncounterPanel from './creative/EncounterPanel';
import { EvidenceOrigin } from './EvidenceOrigin';
import type { SourceCue } from './sourceEvidence';
import { SurfaceVisibility } from './SurfaceVisibility';
import { SAMPLE_DWELL_MS } from './demoTiming';
import { MusicLab } from './creative/MusicLab';
import QuestGame from './creative/QuestGame';
import SourcePreview from './SourcePreview';
import { useContext, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type CSSProperties, type ReactNode } from 'react';
import {
  Activity,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleAlert,
  CircleCheck,
  Clock3,
  Compass,
  FileText,
  Music2,
  PackageOpen,
  ShieldCheck,
  Sparkles,
  Waypoints,
} from 'lucide-react';
import { HANDOFF_ITEMS } from './handoff';
import TrioDeliverables from './TrioDeliverables';
import { AdaptiveSurface } from './library';
import { narrativeSubjects } from './narrativeFocus';
import type { EncounterOutcome } from './creative/encounterModel';
import {
  canApprove,
  initialRules,
  musicPlan,
  questStatus,
  rulesFingerprint,
  shippingResults,
  taughtRules,
} from './domain';
import type {
  CaseId,
  EvidenceEvent,
  MusicRule,
  QuestRule,
  RuleBook,
  ShippingRule,
  StoryStep,
  TrioStageProps,
} from './types';
import './trio-stage.css';

type StageCardProps = {
  title: string;
  eyebrow: string;
  step: StoryStep;
  icon?: typeof PackageOpen;
  className?: string;
  testId?: string;
  focusRef?: (node: HTMLElement | null) => void;
  active?: boolean;
  children: ReactNode;
};

function StageCard({ title, eyebrow, step, icon: Icon, className = '', testId, focusRef, active = false, children }: StageCardProps) {
  return (
    <section
      ref={focusRef}
      tabIndex={-1}
      className={`trio-card ${active ? 'is-current' : ''} ${className}`.trim()}
      data-step={step}
      data-testid={testId}
      aria-label={title}
    >
      <header className="trio-card__head">
        {Icon && <span className="trio-card__icon"><Icon size={16} aria-hidden="true" /></span>}
        <span className="trio-card__titles">
          <span className="trio-card__eyebrow">{eyebrow}</span>
          <span className="trio-card__title">{title}</span>
        </span>
      </header>
      <div className="trio-card__body">{children}</div>
    </section>
  );
}

type DetailButtonProps = {
  id: string;
  openId: string | null;
  onToggle: (id: string) => void;
  children: ReactNode;
};

function DetailButton({ id, openId, onToggle, children }: DetailButtonProps) {
  const open = openId === id;
  return (
    <button
      className="trio-link-button"
      type="button"
      aria-expanded={open}
      aria-controls={`trio-detail-${id}`}
      onClick={() => onToggle(id)}
    >
      {children}
      <ArrowUpRight size={13} aria-hidden="true" />
    </button>
  );
}

type NumberFieldProps = {
  id: string;
  label: string;
  hint?: string;
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  focusRef?: (node: HTMLElement | null) => void;
};

function NumberField({ id, label, hint, value, disabled, onChange, min = 0, max = 10000, step = 1, focusRef }: NumberFieldProps) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.currentTarget.value;
    setText(next);
    if (next.trim() !== '' && Number.isFinite(Number(next))) onChange(Number(next));
  };
  return (
    <label className="trio-field" htmlFor={id}>
      <span className="trio-field__label">{label}{hint && <small>{hint}</small>}</span>
      <input
        ref={focusRef}
        id={id}
        aria-label={label}
        type="number"
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onBlur={() => { if (text.trim() === '' || !Number.isFinite(Number(text))) setText(String(value)); }}
        onChange={handleChange}
      />
    </label>
  );
}

const CASE_TITLE: Record<CaseId, string> = {
  shipping: 'ค่าส่งตามสัญญาใหม่',
  quest: 'หนึ่งตากับก๊อบลิน',
  music: 'ซ้อมวงให้เข้าจังหวะ',
};

const CASE_PROMPT: Record<CaseId, string> = {
  shipping: 'ช่วยเช็กค่าส่งออเดอร์วันนี้หน่อย',
  quest: 'สร้างฉากฮีโร่สองคนสู้ก๊อบลินหนึ่งตัว แล้วลองเล่นกับบอท',
  music: 'วงเราเข้าท่อนฮุกไม่พร้อมกัน ช่วยจัดรอบซ้อมหน่อย',
};

const CASE_CONTEXT: Record<CaseId, string> = {
  shipping: 'ตารางค่าส่งที่วางกติกาสัญญาคู่กับรายการพัสดุแต่ละชิ้น',
  quest: 'กระดาน ลูกเต๋า และ HP ที่เปลี่ยนตามกติกาจริง',
  music: 'ชีตซ้อมที่แยกจังหวะของแต่ละท่อน พร้อมตัวนับจังหวะที่ไม่ใช้เสียง',
};

const stepLabels: Record<StoryStep, string> = {
  sources: 'ดูข้อมูลต้นทาง',
  minimal: 'พื้นที่ใช้งานแรก',
  notice: 'จุดที่ต้องแก้',
  teach: 'ร่างกติกา',
  verify: 'ตรวจตัวอย่าง',
  approve: 'ใช้กติกาที่ผ่าน',
  simulate: 'ทดลองแยก',
  handoff: 'ส่งต่องาน',
};

const allSteps: StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];
const manualContinueLabels = [
  'เปิดข้อมูลตัวอย่าง',
  'สร้างพื้นที่ใช้งาน',
  'ดูจุดที่อยากปรับ',
  'เพิ่มหน้าร่างกฎ',
  'ลองกับตัวอย่าง',
  'ใช้กฎที่ตรวจแล้ว',
  'เปิดพื้นที่ทดลอง',
  'ส่งต่องานที่ยังค้าง',
];

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.max(0, Math.floor(seconds % 60));
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function useActiveQuestTimer(guided: boolean) {
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [solved, setSolved] = useState(false);
  useEffect(() => {
    if (guided || !running || solved) return;
    const timer = window.setInterval(() => setSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [guided, running, solved]);
  const reset = () => {
    setRunning(false);
    setSolved(false);
    setSeconds(0);
  };
  return { seconds, running, solved, setRunning, setSolved, setSeconds, reset };
}

function BuilderCard({
  caseId,
  level,
  phase,
  active,
  focusRef,
}: {
  caseId: CaseId;
  level: number;
  phase: TrioStageProps['phase'];
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const phaseCopy: Record<TrioStageProps['phase'], { title: string; detail: string }> = {
    typing: { title: 'กำลังอ่านคำขอ', detail: 'วางสิ่งที่อยากเปลี่ยนไว้ข้างกติกาเดิม' },
    thinking: { title: 'กำลังหากติกาจากข้อมูลต้นทาง', detail: 'แยกสิ่งที่ต้องเปลี่ยนออกจากสิ่งที่ควรคงเดิม' },
    building: { title: 'กำลังวางพื้นที่ใช้งานแรก', detail: CASE_CONTEXT[caseId] },
    reading: { title: 'กำลังดูตัวอย่างแรก', detail: 'แสดงข้อมูลนำเข้า ผลที่ตกลงกัน และผลที่คำนวณได้' },
    complete: { title: 'พร้อมสร้างพื้นที่ใช้งานแรก', detail: 'พื้นที่นี้จะค่อย ๆ เพิ่มส่วนที่จำเป็นตามกติกา' },
  };
  const copy = phaseCopy[phase];
  return (
    <StageCard
      title={level === 0 ? 'พื้นที่ทำงานใหม่ยังว่างอยู่' : 'รับคำขอไว้แล้ว'}
      eyebrow={level === 0 ? 'เริ่มจากคำขอ' : 'คำขอตั้งต้น'}
      step={level === 0 ? 'minimal' : 'sources'}
      icon={level === 0 ? Sparkles : FileText}
      className="trio-builder"
      testId="trio-main"
      focusRef={focusRef}
      active={active}
    >
      {(level > 0 || phase !== 'typing') && <blockquote className="trio-request">“{CASE_PROMPT[caseId]}”</blockquote>}
      <div className={`trio-build-status is-${phase}`} role="status" aria-live="polite">
        <span className="trio-build-status__mark"><Activity size={15} aria-hidden="true" /></span>
        <span><strong>{copy.title}</strong><small>{copy.detail}</small></span>
          <span className="trio-build-status__phase">{phase === 'complete' ? 'พร้อม' : 'กำลังทำ'}</span>
      </div>
      <div className={`trio-skeleton trio-skeleton--${caseId}`} aria-hidden="true">
        <span /><span /><span />
      </div>
    </StageCard>
  );
}

function SourceCard({
  caseId,
  original,
  openId,
  onToggle,
  active,
  focusRef,
  onInspect,
  sourceCue,
}: {
  sourceCue?: SourceCue;
  caseId: CaseId;
  original: RuleBook;
  openId: string | null;
  onToggle: (id: string) => void;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
  onInspect?: () => void;
}) {
  const detailId = `source-${caseId}`;
  const sourceVisible = useContext(SurfaceVisibility);
  const rule = original[caseId];
  const sourceLabel = caseId === 'music' ? 'บันทึกจากคนซ้อม (ตัวอย่าง)' : 'ข้อมูลตัวอย่างที่แนบ';
  const sourceLinks = caseId === 'shipping'
    ? [{ label: 'shipping-orders.csv · รายการพัสดุตัวอย่าง', href: '/data/shipping-orders.csv' }, { label: 'shipping-contract.pdf · สัญญาตัวอย่าง', href: '/data/shipping-contract.pdf' }, { label: 'shipping-contract.json · ข้อตกลงตัวอย่าง', href: '/data/shipping-contract.json' }]
    : caseId === 'quest'
      ? [{ label: 'encounter-scene.svg · ภาพฉาก', href: '/data/encounter-scene.svg' }, { label: 'encounter-notes.json · กติกาเดิม', href: '/data/encounter-notes.json' }]
      : [{ label: 'music-rehearsal.wav · คลิปเสียงตัวอย่าง', href: '/data/music-rehearsal.wav' }, { label: 'music-rehearsal.webm · คลิปซ้อมตัวอย่าง', href: '/data/music-rehearsal.webm' }, { label: 'music-notes.json · บันทึกจากวงซ้อม', href: '/data/music-notes.json' }];
  let summary: ReactNode;
  let detail: ReactNode;
  if (caseId === 'shipping') {
    const shipping = rule as ShippingRule;
    summary = <><strong>{shipping.bangkok} / {shipping.regional}</strong><span>ราคาฐาน · บาท / พัสดุ</span></>;
    detail = <dl className="trio-source-facts"><div><dt>กรุงเทพฯ</dt><dd>฿{shipping.bangkok}</dd></div><div><dt>ต่างจังหวัด</dt><dd>฿{shipping.regional}</dd></div><div><dt>น้ำหนักส่วนเกินต่อ กก.</dt><dd>฿{shipping.extraKg}</dd></div><div><dt>วันที่เริ่มใช้อัตรา</dt><dd>{shipping.effectiveDate}</dd></div></dl>;
  } else if (caseId === 'quest') {
    summary = <><strong>2 ฮีโร่ · 1 ก๊อบลิน</strong><span>โล่เดิมช่วยคนถือ · ลองเล่นหนึ่งตา</span></>;
    detail = <p>Mira ถือโล่ · Pip ถือธนู · กฎโล่เดิมลด 2 HP ให้คนถือเท่านั้น · เตรียมแต้ม 14 / 12 / 16 สำหรับเล่นซ้ำเทียบผล</p>;
  } else {
    const music = rule as MusicRule;
    summary = <><strong>{music.chorusBpm} / {music.otherBpm} BPM</strong><span>ท่อนฮุก / ท่อนอื่น</span></>;
    detail = <dl className="trio-source-facts"><div><dt>ท่อนฮุก</dt><dd>{music.chorusBpm} BPM</dd></div><div><dt>ท่อนอื่น</dt><dd>{music.otherBpm} BPM</dd></div><div><dt>จำนวนรอบท่อนฮุก</dt><dd>×{music.repetitions}</dd></div></dl>;
  }
  return (
    <StageCard title="ไฟล์ต้นทาง" eyebrow="ข้อมูลตัวอย่าง · เปิดดูตามชนิดไฟล์" step="sources" icon={FileText} testId="trio-source" focusRef={focusRef} active={active}>
      <SourcePreview sourceCue={sourceCue} caseId={caseId} spotlight={active} visible={sourceVisible} onInteract={onInspect} />
      <div hidden={Boolean(sourceCue)}>
      <p className="trio-muted-copy">กติกาปัจจุบันก่อนเปลี่ยน</p>
      <div className="trio-source-summary">{summary}</div>
      <DetailButton id={detailId} openId={openId} onToggle={onToggle}>เปิดรายละเอียดข้อมูลต้นทาง</DetailButton>
      {openId === detailId && <div className="trio-inline-detail" id={`trio-detail-${detailId}`} role="region" aria-label="รายละเอียดข้อมูลต้นทาง">{detail}{caseId === 'quest' && <p>บันทึก TURN-01: Mira ยกโล่ แต่ Pip ถูกโจมตีเต็มจำนวน จึงขอให้โล่ช่วยเพื่อนได้</p>}{caseId === 'music' && <p>บันทึกจากผู้ซ้อม: ท่อนฮุก 100 BPM · ผู้ซ้อมทำเครื่องหมายว่าเข้าช้า</p>}<p>ไฟล์ตัวอย่างในเครื่อง · ไม่มีการเชื่อมต่อภายนอก</p><div className="trio-source-downloads"><span>{sourceLabel}</span>{sourceLinks.map((source) => <a key={source.href} href={source.href} download>{source.label}<ArrowUpRight size={12} aria-hidden="true" /></a>)}</div></div>}
      </div>
    </StageCard>
  );
}

function ShippingWorkspace({ rule, guided, active, focusRef }: {
  rule: ShippingRule;
  guided: boolean;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const rows = shippingResults(rule).filter((row) => /^SH-00[1-6]$/.test(row.id));
  return (
    <div className="trio-shipping-board">
      <StageCard title="ตารางค่าส่งพัสดุ" eyebrow="พื้นที่ใช้งาน · ราคาและยอดคิด" step="minimal" icon={PackageOpen} testId="trio-main" focusRef={focusRef} active={active}>
        <div className="trio-table-wrap">
          <table className="trio-rate-table">
            <thead><tr><th>พัสดุ</th><th>พื้นที่</th><th>น้ำหนัก</th><th>ยอดคำนวณ</th></tr></thead>
            <tbody>{rows.map((row) => (
              <tr key={row.id} data-narrative-record={row.id}>
                <th scope="row">{row.name}<small>{row.date}</small></th>
                <td data-narrative-field="zone">{row.zone === 'bangkok' ? 'กรุงเทพฯ' : 'ต่างจังหวัด'}</td>
                <td data-narrative-field="weight">{row.weight === null ? <span className="trio-table-missing">รอชั่งน้ำหนัก</span> : `${row.weight} กก.`}</td>
                <td data-narrative-field="amount">{row.amount === null ? <span className="trio-table-missing">รอน้ำหนัก</span> : `฿${row.amount}`}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div className="trio-board-foot"><span><PackageOpen size={14} aria-hidden="true" /> รายการพัสดุยังอยู่คู่กับกติกาค่าส่ง</span><span>{rows.length} รายการตัวอย่าง</span></div>
      </StageCard>
      <StageCard title="ค่าตามกติกาปัจจุบัน" eyebrow="อัตราที่ใช้อยู่" step="minimal" icon={FileText} className="trio-contract-card" active={active}>
        <div className="trio-contract-values">
          <div data-narrative-field="bangkok"><span>กรุงเทพฯ</span><strong>฿{rule.bangkok}</strong></div>
          <div><span>ต่างจังหวัด</span><strong>฿{rule.regional}</strong></div>
          <div><span>ส่วนเกินต่อ กก.</span><strong>฿{rule.extraKg}</strong></div>
        </div>
        <p>หนึ่งกิโลกรัมแรกคิดฐานราคา ส่วนที่เริ่มเกินคิดเพิ่มทุกกิโลกรัม</p>
        <span className="trio-date-chip"><Clock3 size={12} aria-hidden="true" /> เริ่มใช้ {rule.effectiveDate}</span>
      </StageCard>
      {guided && <span className="trio-visually-hidden">Guided mode keeps the rate controls locked.</span>}
    </div>
  );
}

function QuestWorkspace({ rule, guided, paused, demoActive, timer, onFeedback, active, focusRef }: {
  rule: QuestRule; guided: boolean; paused: boolean; demoActive: boolean;
  timer: ReturnType<typeof useActiveQuestTimer>; onFeedback: (detail: string) => void;
  active: boolean; focusRef?: (node: HTMLElement | null) => void;
}) {
  const visible = useContext(SurfaceVisibility);
  useEffect(() => { if (!visible) timer.setRunning(false); }, [visible, timer.setRunning]);
  return <StageCard title="เกมไขปริศนาสามด่าน" eyebrow="เกมที่เล่นได้ · คำใบ้ตามกติกา" step="minimal" icon={Compass} testId="trio-main" focusRef={focusRef} active={active}>
    <QuestGame rule={rule} guided={guided} paused={paused} demoActive={demoActive} timer={timer} onFeedback={onFeedback} />
  </StageCard>;
}

function MusicWorkspace({ rule, guided, paused, demoActive, playing, sectionId, setSectionId, onPlayingChange, feedback, onMarkLate, active, focusRef }: {
  rule: MusicRule; guided: boolean; paused: boolean; demoActive: boolean; playing: boolean;
  sectionId: string; setSectionId: (id: string) => void; onPlayingChange: (playing: boolean) => void;
  feedback: string | null; onMarkLate: (beat: number) => void; active: boolean; focusRef?: (node: HTMLElement | null) => void;
}) {
  return <StageCard title="Loop Studio" eyebrow="คลื่นเสียง · ไฟจังหวะ · ลูปซ้อม" step="minimal" icon={Music2} testId="trio-main" focusRef={focusRef} active={active}>
    <MusicLab rule={rule} guided={guided} paused={paused} demoActive={demoActive} playing={playing} sectionId={sectionId} setSectionId={setSectionId} onPlayingChange={onPlayingChange} feedback={feedback} onMarkLate={onMarkLate} />
  </StageCard>;
}

function DiscrepancyCard({ caseId, original, target, active, focusRef }: {
  caseId: CaseId;
  original: RuleBook;
  target: RuleBook;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const before = original[caseId];
  const after = target[caseId];
  let rows: Array<{ label: string; oldValue: string; nextValue: string; changed: boolean }>;
  let note: string;
  if (caseId === 'shipping') {
    const oldRule = before as ShippingRule;
    const nextRule = after as ShippingRule;
    rows = [
      { label: 'ราคาฐาน · กรุงเทพฯ', oldValue: `฿${oldRule.bangkok}`, nextValue: `฿${nextRule.bangkok}`, changed: oldRule.bangkok !== nextRule.bangkok },
      { label: 'ราคาฐาน · ต่างจังหวัด', oldValue: `฿${oldRule.regional}`, nextValue: `฿${nextRule.regional}`, changed: oldRule.regional !== nextRule.regional },
      { label: 'วันที่เริ่มใช้', oldValue: oldRule.effectiveDate, nextValue: nextRule.effectiveDate, changed: oldRule.effectiveDate !== nextRule.effectiveDate },
    ];
    note = `คงค่าน้ำหนักส่วนเกินไว้ที่ ฿${oldRule.extraKg} ต่อกก.`;
  } else if (caseId === 'quest') {
    const oldRule = before as QuestRule;
    const nextRule = after as QuestRule;
    rows = [
      { label: 'คำใบ้แรก', oldValue: formatTime(oldRule.firstHint), nextValue: formatTime(nextRule.firstHint), changed: oldRule.firstHint !== nextRule.firstHint },
      { label: 'คำใบ้ที่สอง', oldValue: formatTime(oldRule.secondHint), nextValue: formatTime(nextRule.secondHint), changed: oldRule.secondHint !== nextRule.secondHint },
      { label: 'เปิดเฉลยอัตโนมัติ', oldValue: oldRule.autoReveal ? 'เปิด' : 'ปิด', nextValue: nextRule.autoReveal ? 'เปิด' : 'ปิด', changed: oldRule.autoReveal !== nextRule.autoReveal },
    ];
    note = 'ให้ผู้เล่นเลือกขอเฉลยเอง เวลาที่ผ่านไปจะไม่เปิดคำตอบ';
  } else {
    const oldRule = before as MusicRule;
    const nextRule = after as MusicRule;
    rows = [
      { label: 'ท่อนฮุก', oldValue: `${oldRule.chorusBpm} BPM`, nextValue: `${nextRule.chorusBpm} BPM`, changed: oldRule.chorusBpm !== nextRule.chorusBpm },
      { label: 'ท่อนอื่น', oldValue: `${oldRule.otherBpm} BPM`, nextValue: `${nextRule.otherBpm} BPM`, changed: oldRule.otherBpm !== nextRule.otherBpm },
      { label: 'จำนวนรอบท่อนฮุก', oldValue: `×${oldRule.repetitions}`, nextValue: `×${nextRule.repetitions}`, changed: oldRule.repetitions !== nextRule.repetitions },
    ];
    note = 'ปรับเฉพาะจังหวะท่อนฮุก ส่วนท่อนอื่นคงจังหวะตามเดิม';
  }
  return (
    <StageCard title="จุดที่อยากปรับ" eyebrow="อะไรเปลี่ยน · อะไรคงเดิม" step="notice" icon={ArrowDownRight} active={active} focusRef={focusRef}>
      <div className="trio-narrative-context"><strong>{narrativeSubjects[caseId].label}</strong><span>{narrativeSubjects[caseId].context}</span></div>
      <div className="trio-diff-list">{rows.map((row) => <div className={`trio-diff-row ${row.changed ? 'is-changed' : ''}`} key={row.label}><span>{row.label}</span><del>{row.oldValue}</del><ArrowRight size={13} aria-hidden="true" /><strong>{row.nextValue}</strong></div>)}</div>
      <p className="trio-correction-note"><CircleAlert size={14} aria-hidden="true" />{note}</p>
    </StageCard>
  );
}

function DraftCard({
  caseId,
  book,
  onBookChange,
  draftFields,
  guided,
  focusFieldRef,
  active,
  cardRef,
}: {
  caseId: CaseId;
  book: RuleBook;
  onBookChange: (book: RuleBook) => void;
  draftFields: number;
  guided: boolean;
  focusFieldRef: (node: HTMLElement | null) => void;
  active: boolean;
  cardRef: (node: HTMLElement | null) => void;
}) {
  const rule = book[caseId];
  const groupLimit = guided ? Math.max(0, Math.min(3, draftFields)) : 3;
  const changeShipping = (next: Partial<ShippingRule>) => onBookChange({ ...book, shipping: { ...(rule as ShippingRule), ...next } });
  const changeQuest = (next: Partial<QuestRule>) => onBookChange({ ...book, quest: { ...(rule as QuestRule), ...next } });
  const changeMusic = (next: Partial<MusicRule>) => onBookChange({ ...book, music: { ...(rule as MusicRule), ...next } });
  return (
    <StageCard title="ร่างกติกาที่ตกลงกัน" eyebrow="หน้าร่างกฎ · แก้ไขได้เมื่อคุณรับช่วง" step="teach" icon={Sparkles} className="trio-draft-card" testId="trio-draft" focusRef={cardRef} active={active}>
      <p className="trio-muted-copy">ปรับเฉพาะค่าที่ตกลงกัน โดยข้อมูลแต่ละช่องผูกกับงานนี้</p>
      {caseId === 'shipping' && (() => {
        const shipping = rule as ShippingRule;
        return <div className="trio-field-groups">
          {groupLimit >= 1 && <fieldset className="trio-field-group"><legend>01 · ราคาเริ่มต้น</legend><div className="trio-field-grid"><NumberField id="draft-bangkok" label="กรุงเทพฯ · Bangkok base" hint="บาท / พัสดุ" value={shipping.bangkok} disabled={guided} onChange={(bangkok) => changeShipping({ bangkok })} focusRef={groupLimit === 1 ? focusFieldRef : undefined} /><NumberField id="draft-regional" label="ต่างจังหวัด · Regional base" hint="บาท / พัสดุ" value={shipping.regional} disabled={guided} onChange={(regional) => changeShipping({ regional })} /></div></fieldset>}
          {groupLimit >= 2 && <fieldset className="trio-field-group"><legend>02 · น้ำหนักส่วนเกิน</legend><div className="trio-field-grid"><NumberField id="draft-extraKg" label="น้ำหนักเกิน 1 กก. · Extra kg" hint="บาท / กก. ที่เริ่มเกิน" value={shipping.extraKg} disabled={guided} onChange={(extraKg) => changeShipping({ extraKg })} focusRef={groupLimit === 2 ? focusFieldRef : undefined} /></div></fieldset>}
          {groupLimit >= 3 && <fieldset className="trio-field-group"><legend>03 · วันที่เริ่มใช้</legend><label className="trio-field" htmlFor="draft-effectiveDate"><span className="trio-field__label">วันที่เริ่มใช้ · Effective date<small>วันที่ตามข้อตกลง</small></span><input ref={focusFieldRef} id="draft-effectiveDate" aria-label="วันที่เริ่มใช้ Effective date" type="date" value={shipping.effectiveDate} disabled={guided} onChange={(event) => changeShipping({ effectiveDate: event.currentTarget.value })} /></label></fieldset>}
        </div>;
      })()}
      {caseId === 'quest' && (() => {
        const quest = rule as QuestRule;
        return <div className="trio-field-groups">
          {groupLimit >= 1 && <fieldset className="trio-field-group"><legend>01 · เวลาคำใบ้แรก</legend><div className="trio-field-grid"><NumberField id="draft-firstHint" label="คำใบ้แรก · First hint" hint="วินาทีหลังเริ่มเกม" value={quest.firstHint} disabled={guided} min={0} max={3600} onChange={(firstHint) => changeQuest({ firstHint })} focusRef={groupLimit === 1 ? focusFieldRef : undefined} /></div></fieldset>}
          {groupLimit >= 2 && <fieldset className="trio-field-group"><legend>02 · เวลาคำใบ้ที่สอง</legend><div className="trio-field-grid"><NumberField id="draft-secondHint" label="คำใบ้ที่สอง · Second hint" hint="วินาทีหลังเริ่มเกม" value={quest.secondHint} disabled={guided} min={0} max={3600} onChange={(secondHint) => changeQuest({ secondHint })} focusRef={groupLimit === 2 ? focusFieldRef : undefined} /></div></fieldset>}
          {groupLimit >= 3 && <fieldset className="trio-field-group"><legend>03 · การเปิดเฉลย</legend><label className="trio-toggle-field" htmlFor="draft-autoReveal"><span><strong>เปิดเฉลยอัตโนมัติ</strong><small>เมื่อปิด ผู้เล่นเป็นคนเลือกขอเฉลยเอง</small></span><input ref={focusFieldRef} id="draft-autoReveal" aria-label="เฉลยอัตโนมัติ Reveal answer automatically" type="checkbox" checked={quest.autoReveal} disabled={guided} onChange={(event) => changeQuest({ autoReveal: event.currentTarget.checked })} /></label></fieldset>}
        </div>;
      })()}
      {caseId === 'music' && (() => {
        const music = rule as MusicRule;
        return <div className="trio-field-groups">
          {groupLimit >= 1 && <fieldset className="trio-field-group"><legend>01 · จังหวะท่อนฮุก</legend><div className="trio-field-grid"><NumberField id="draft-chorusBpm" label="ท่อน Chorus · Chorus BPM" hint="จังหวะต่อนาที" value={music.chorusBpm} disabled={guided} min={30} max={220} onChange={(chorusBpm) => changeMusic({ chorusBpm })} focusRef={groupLimit === 1 ? focusFieldRef : undefined} /></div></fieldset>}
          {groupLimit >= 2 && <fieldset className="trio-field-group"><legend>02 · จังหวะท่อนอื่น</legend><div className="trio-field-grid"><NumberField id="draft-otherBpm" label="ท่อนอื่น · Other-section BPM" hint="จังหวะต่อนาที" value={music.otherBpm} disabled={guided} min={30} max={220} onChange={(otherBpm) => changeMusic({ otherBpm })} focusRef={groupLimit === 2 ? focusFieldRef : undefined} /></div></fieldset>}
          {groupLimit >= 3 && <fieldset className="trio-field-group"><legend>03 · จำนวนรอบท่อนฮุก</legend><div className="trio-field-grid"><NumberField id="draft-repetitions" label="จำนวนรอบ · Chorus repetitions" hint="รอบ" value={music.repetitions} disabled={guided} min={1} max={16} onChange={(repetitions) => changeMusic({ repetitions })} focusRef={groupLimit === 3 ? focusFieldRef : undefined} /></div></fieldset>}
        </div>;
      })()}
      {groupLimit === 0 && <div className="trio-await-fields"><Sparkles size={15} aria-hidden="true" /><span>กำลังเตรียมช่องกติกาสำหรับรอบนี้</span></div>}
      {guided && <p className="trio-lock-note"><ShieldCheck size={13} aria-hidden="true" />ช่องแก้ไขจะใช้ได้เมื่อคุณรับช่วง</p>}
    </StageCard>
  );
}

function sampleDisplayValue(caseId: CaseId, value: string): string {
  if (caseId === 'shipping') return value.split(' · ')[0];
  if (caseId === 'music') return value.replace(/ · \d+ จังหวะ(?:ต่อรอบ)?/g, '');
  const concise: Record<string, string> = {
    'ยังไม่ถึงเวลาคำใบ้แรก': 'ยังไม่เปิดคำใบ้',
    'แสดงคำใบ้แรกได้ และยังซ่อนเฉลย': 'ใบ้ 1 · ซ่อนเฉลย',
    'แสดงคำใบ้ที่สองได้ แต่ยังซ่อนเฉลยไว้ให้ผู้เล่นเลือกขอเอง': 'ใบ้ 2 · ซ่อนเฉลย',
    'ไขปริศนาแล้ว จึงไม่แสดงคำใบ้เพิ่มเติม': 'ผ่านด่าน · หยุดคำใบ้',
  };
  return concise[value] ?? value;
}

function VerificationCard({
  caseId,
  evaluation,
  stale,
  guided,
  phase,
  paused,
  speed = 1,
  onVerify,
  active,
  focusRef,
  sampleFocusRef,
  scrollToStage,
}: {
  caseId: CaseId;
  evaluation: TrioStageProps['snapshot']['evaluation'];
  stale: boolean;
  guided: boolean;
  phase: TrioStageProps['phase'];
  paused: boolean;
  speed?: number;
  onVerify: () => void;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
  sampleFocusRef: (node: HTMLElement | null) => void;
  scrollToStage: (node: HTMLElement) => void;
}) {
  const [guidedSampleIndex, setGuidedSampleIndex] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const sampleElementRef = useRef<HTMLElement | null>(null);
  const sampleElapsedRef = useRef(0);
  const sampleIndices = caseId === 'shipping' ? [0, 1, 4, 5]
    : caseId === 'quest' ? [0, 1, 5, 6]
      : [3, 0, 1, 6];
  const representativeSamples = evaluation
    ? sampleIndices.map((index) => evaluation.cases[index]).filter((sample) => sample !== undefined).sort((a, b) => Number(a.passed) - Number(b.passed))
    : [];
  const allSamples = evaluation ? [...evaluation.cases].sort((a, b) => Number(a.passed) - Number(b.passed)) : [];
  const guidedReading = Boolean(active && guided && phase === 'reading' && !paused && evaluation && !stale);
  const isShowingAll = (!guided || paused) && showAll;
  const visibleSamples = isShowingAll ? allSamples : representativeSamples.length ? [representativeSamples[guidedSampleIndex % representativeSamples.length]] : [];

  useEffect(() => {
    setGuidedSampleIndex(0);
    sampleElapsedRef.current = 0;
  }, [evaluation?.fingerprint]);

  useEffect(() => {
    if (!guidedReading || representativeSamples.length < 2) return;
    let last = performance.now();
    const interval = window.setInterval(() => {
      const now = performance.now();
      sampleElapsedRef.current += Math.min(80, now - last) * speed;
      last = now;
      setGuidedSampleIndex(Math.min(Math.floor(sampleElapsedRef.current / SAMPLE_DWELL_MS), representativeSamples.length - 1));
    }, 20);
    return () => window.clearInterval(interval);
  }, [guidedReading, speed, representativeSamples.length, evaluation?.fingerprint]);

  useEffect(() => {
    if (!guided || !guidedReading || stale || !evaluation || !sampleElementRef.current) return;
    const element = sampleElementRef.current;
    const frame = window.requestAnimationFrame(() => {
      scrollToStage(element);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [guided, stale, evaluation, guidedSampleIndex, guidedReading, scrollToStage]);

  return (
    <StageCard title="ตรวจร่างกติกากับตัวอย่าง" eyebrow="ข้อมูลเข้า → ผลที่ตกลง → ผลที่ได้จริง" step="verify" icon={CircleCheck} testId="trio-verification" focusRef={focusRef} active={active}>
      {evaluation && !stale ? <>
        <div className="trio-verification-overview"><span>{evaluation.failed ? `มีตัวอย่างที่ต้องตรวจเพิ่ม ${evaluation.failed} รายการ` : 'ตัวอย่างตรงกับกติกา'}</span><span className={evaluation.failed ? 'is-failed' : 'is-passed'}>{evaluation.passed} ผ่าน · {evaluation.failed} ไม่ผ่าน</span></div>
        <div className="trio-sample-list" id="trio-all-samples" aria-label="ผลตรวจตัวอย่าง กดพักเรื่องเพื่ออ่าน หรือดูทั้งหมดขณะพัก">
          {visibleSamples.map((sample, index) => (
            <article className={`trio-sample ${sample.passed ? 'is-passed' : 'is-failed'}`} key={sample.id} data-testid="verification-sample" data-sample-id={sample.id} data-guided-sample={String(guidedReading)} tabIndex={-1} ref={(node) => { if (node) sampleElementRef.current = node; sampleFocusRef(node); }} style={{ '--sample-index': index } as CSSProperties}>
              <div className="trio-sample__head"><span className="trio-sample__label">{sample.label}</span><span className={`trio-sample__status ${sample.passed ? 'is-passed' : 'is-failed'}`}>{sample.passed ? <Check size={12} /> : <CircleAlert size={12} />}{sample.passed ? 'ตรงกัน' : 'ต้องตรวจ'}</span></div>
              <dl className="trio-sample__values"><div className="trio-sample__input"><dt>ข้อมูลเข้า</dt><dd>{sample.input}</dd></div><div className="trio-sample__comparison"><div><dt>ผลที่ตกลง</dt><dd aria-label={sample.expected}>{guided&&!paused?<><span className="trio-sample__full-value">{sample.expected}</span><span className="trio-sample__compact-value" title={sample.expected}>{sampleDisplayValue(caseId, sample.expected)}</span></>:sample.expected}</dd></div><div><dt>ผลที่ได้จริง</dt><dd aria-label={sample.actual}>{guided&&!paused?<><span className="trio-sample__full-value">{sample.actual}</span><span className="trio-sample__compact-value" title={sample.actual}>{sampleDisplayValue(caseId, sample.actual)}</span></>:sample.actual}</dd></div></div></dl>
              {!guided && <p className="trio-sample__reason">{sample.reason}</p>}
            </article>
          ))}
        </div>
        {representativeSamples.length > 0 && <div className="trio-sample-controls"><span>{isShowingAll ? `แสดงทั้งหมด ${allSamples.length} ตัวอย่าง` : `ตัวอย่างที่เลือก ${guidedSampleIndex + 1} จาก ${representativeSamples.length} · ตรวจทั้งหมด ${evaluation.cases.length} รายการ`}</span>{(!guided || paused) && <button type="button" className="trio-link-button" aria-expanded={showAll} aria-controls="trio-all-samples" onClick={() => setShowAll((value) => !value)}>{showAll ? 'ซ่อนตัวอย่างที่เหลือ' : 'ดูทั้งหมด'}</button>}</div>}
        {isShowingAll && <div className="trio-all-samples-note">แสดงผลตรวจครบทุกตัวอย่าง เรียงรายการที่ต้องตรวจไว้ก่อน</div>}
      </> : <div className="trio-verification-empty" role="status">
        <span className="trio-empty-mark"><CircleCheck size={18} /></span>
        <span><strong>{stale ? 'มีการแก้ร่างหลังตรวจครั้งล่าสุด' : 'ยังไม่มีผลตรวจตัวอย่าง'}</strong><small>{stale ? 'ตรวจตัวอย่างอีกครั้ง เพื่อให้ผลตรวจอ้างอิงร่างฉบับนี้' : 'ผลตรวจจะแสดงข้อมูลเข้า ผลที่ตกลง และผลที่คำนวณได้'}</small></span>
      </div>}
      {!guided && <button className="trio-button trio-button--primary trio-verify-button" type="button" aria-label="Run example checks" onClick={onVerify}><CircleCheck size={14} />ตรวจตัวอย่าง<ArrowRight size={14} /></button>}
      {guided && !evaluation && <p className="trio-lock-note"><ShieldCheck size={13} aria-hidden="true" />กำลังตรวจตัวอย่างของเรื่องนี้</p>}
    </StageCard>
  );
}

function ApprovalCard({ approved, version, canApproveRule, guided, onApprove, active, focusRef }: {
  approved: boolean;
  version: number;
  canApproveRule: boolean;
  guided: boolean;
  onApprove: () => void;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  return (
    <StageCard title={approved ? 'อนุมัติแล้ว' : 'พร้อมใช้เมื่อผ่านตรวจ'} eyebrow={approved ? `กติกาที่ใช้อยู่ · V${version}` : 'ขั้นตอนอนุมัติ'} step="approve" icon={approved ? CircleCheck : ShieldCheck} active={active} focusRef={focusRef}>
      <div className={`trio-approval-result ${approved ? 'is-approved' : ''}`}>
        <span className="trio-approval-mark">{approved ? <Check size={17} /> : <ShieldCheck size={17} />}</span>
        <span><strong>{approved ? `เวอร์ชัน ${version} กำลังใช้งาน` : 'อนุมัติได้เมื่อผลตรวจล่าสุดผ่านครบ'}</strong><small>{approved ? 'กติกาชุดนี้เป็นกติกาที่ใช้งานอยู่' : 'หากมีตัวอย่างไม่ผ่านหรือผลตรวจเก่า จะยังอนุมัติไม่ได้'}</small></span>
      </div>
      <button className="trio-button trio-button--primary trio-approve-button" type="button" aria-label="Approve tested rule" disabled={guided || approved || !canApproveRule} onClick={onApprove}>{approved ? <Check size={14} /> : <ShieldCheck size={14} />}{approved ? 'กำลังใช้อยู่' : 'อนุมัติกติกาที่ตรวจแล้ว'}<ArrowRight size={14} /></button>
      {!canApproveRule && !approved && <p className="trio-approval-blocked">ปุ่มอนุมัติจะเปิดเมื่อผลตรวจฉบับปัจจุบันผ่านทุกตัวอย่าง</p>}
    </StageCard>
  );
}

function SimulationCard({
  caseId,
  activeRule,
  simulation,
  onSimulationChange,
  elapsed,
  setElapsed,
  solved,
  active,
  focusRef,
}: {
  caseId: CaseId;
  activeRule: RuleBook;
  simulation: RuleBook;
  onSimulationChange: (book: RuleBook) => void;
  elapsed: number;
  setElapsed: (seconds: number) => void;
  solved: boolean;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const simRule = simulation[caseId];
  let content: ReactNode;
  if (caseId === 'shipping') {
    const values = shippingResults(simRule as ShippingRule).filter((row) => /^SH-00[1-6]$/.test(row.id));
    const baseline = shippingResults(activeRule.shipping).filter((row) => /^SH-00[1-6]$/.test(row.id));
    content = <><label className="trio-sim-slider" htmlFor="trio-shipping-simulation"><span>ลองปรับฐานกรุงเทพฯ</span><strong>฿{(simRule as ShippingRule).bangkok}</strong></label><input data-testid="simulation-control" id="trio-shipping-simulation" aria-label="Experimental Bangkok base rate" type="range" min={0} max={100} step={1} value={(simRule as ShippingRule).bangkok} onChange={(event) => onSimulationChange({ ...simulation, shipping: { ...(simRule as ShippingRule), bangkok: Number(event.currentTarget.value) } })} /><div className="trio-sim-ticks"><span>฿0</span><span>฿100</span></div><div className="trio-simulation-table-wrap"><table className="trio-simulation-table"><thead><tr><th>พัสดุ</th><th>Active</th><th>ชุดทดลอง</th></tr></thead><tbody>{values.map((row, index) => <tr key={row.id}><th scope="row">{row.id}</th><td>{baseline[index]?.amount == null ? 'รอน้ำหนัก' : `฿${baseline[index]?.amount}`}</td><td>{row.amount == null ? 'รอน้ำหนัก' : `฿${row.amount}`}</td></tr>)}</tbody></table></div></>;
  } else if (caseId === 'quest') {
    const result = questStatus(simRule as QuestRule, elapsed, solved);
    content = <>
      <label className="trio-sim-slider" htmlFor="trio-quest-simulation"><span>เลื่อนดูเวลาระหว่างเล่น</span><strong>{formatTime(elapsed)}</strong></label>
      <input data-testid="simulation-control" id="trio-quest-simulation" aria-label="Simulated elapsed time" type="range" min={0} max={600} step={15} value={elapsed} onChange={(event) => setElapsed(Number(event.currentTarget.value))} />
      <div className="trio-sim-ticks"><span>Start</span><span>{formatTime((simRule as QuestRule).firstHint)}</span><span>{formatTime((simRule as QuestRule).secondHint)}</span><span>10:00</span></div>
      <div className="trio-sim-hint-comparison"><div><small>ใช้งานอยู่</small><strong>{questStatus(activeRule.quest, elapsed, solved).hintLevel > 0 ? 'ขอคำใบ้ได้' : 'ยังรอคำใบ้'}</strong></div><span aria-hidden="true">→</span><div><small>ชุดทดลอง</small><strong>{result.hintLevel > 0 ? 'ขอคำใบ้ได้แล้ว' : 'ยังรอคำใบ้'}</strong></div></div><p className="trio-sim-outcome"><Compass size={14} />{result.summary}</p>
    </>;
  } else {
    const music = simRule as MusicRule;
    const plan = musicPlan(music);
    content = <>
      <label className="trio-sim-slider" htmlFor="trio-music-simulation"><span>ลองปรับจังหวะท่อนฮุก</span><strong>{music.chorusBpm} BPM</strong></label>
      <input data-testid="simulation-control" id="trio-music-simulation" aria-label="Experimental chorus tempo" type="range" min={50} max={120} step={1} value={music.chorusBpm} onChange={(event) => onSimulationChange({ ...simulation, music: { ...music, chorusBpm: Number(event.currentTarget.value) } })} />
      <div className="trio-sim-ticks"><span>50 BPM</span><span>120 BPM</span></div>
      <div className="trio-plan-list">{plan.map((section) => <div key={section.id}><span>{section.name}</span><strong>{section.bpm} BPM</strong><small>×{section.repetitions} loops</small></div>)}</div>
    </>;
  }
  return (
    <StageCard title="ทดลองปรับทีละอย่าง" eyebrow="พื้นที่ทดลอง · กติกาที่ใช้อยู่ไม่เปลี่ยน" step="simulate" icon={Activity} testId="trio-simulation" focusRef={focusRef} active={active}>
      <div className="trio-simulation-banner"><span><Activity size={14} /> ทดลองแยก</span><span>กติกาที่ใช้อยู่ยังเดิม</span></div>
      <div className="trio-simulation-active" data-testid="active-rule-summary"><small>ใช้งานอยู่ · เวอร์ชันปัจจุบัน</small><strong>{caseId === 'shipping' ? `฿${activeRule.shipping.bangkok} / ฿${activeRule.shipping.regional} ราคาฐาน` : caseId === 'quest' ? `คำใบ้ที่ ${formatTime(activeRule.quest.firstHint)} / ${formatTime(activeRule.quest.secondHint)}` : `${activeRule.music.chorusBpm} BPM ท่อนฮุก · ${activeRule.music.otherBpm} BPM ท่อนอื่น`}</strong></div>
      <div className="trio-simulation-preview">{content}</div>
      <p className="trio-sim-footnote">การทดลองนี้ใช้สำเนาแยกเท่านั้น ไม่เปลี่ยนกติกาหรือหลักฐานที่ใช้อยู่</p>
    </StageCard>
  );
}

function eventDescription(event: EvidenceEvent) {
  return <div className="trio-event-detail" id={`trio-event-${event.id}`} role="region" aria-label={`รายละเอียดหลักฐาน: ${event.title}`}><p>{event.detail}</p><div><span>อ้างอิง</span>{event.references.length ? event.references.map((reference) => <code key={reference}>{reference}</code>) : <small>ไม่มีรหัสอ้างอิง</small>}</div><small>เวอร์ชัน {event.version} · {event.at}</small></div>;
}

function HandoffCard({ snapshot, onHandoff, guided, openId, onToggle, active, focusRef }: {
  snapshot: TrioStageProps['snapshot'];
  onHandoff: () => void;
  guided: boolean;
  openId: string | null;
  onToggle: (id: string) => void;
  active: boolean;
  focusRef?: (node: HTMLElement | null) => void;
}) {
  const caseId = snapshot.caseId;
  const unresolved = HANDOFF_ITEMS[caseId];
  const events = [...snapshot.events].reverse();
  return (
    <StageCard title="ผลลัพธ์และงานที่ส่งต่อ" eyebrow="ได้อะไรกลับไปบ้าง" step="handoff" icon={Waypoints} testId="trio-handoff" focusRef={focusRef} active={active}>
      <TrioDeliverables snapshot={snapshot}/>
      <div className="trio-handoff-state"><span className={`trio-handoff-dot ${snapshot.handoff === 'in-progress' ? 'is-active' : ''}`} /><span><strong>{snapshot.handoff === 'in-progress' ? 'กำลังดำเนินการ' : 'รอผู้รับช่วง'}</strong><small>{snapshot.handoff === 'in-progress' ? 'เปิดงานส่งต่อแล้ว แต่รายการที่ขาดยังไม่ถูกแก้' : 'ผู้รับช่วงจะเห็นกติกาและหลักฐานที่บันทึกไว้'}</small></span></div>
      <div className="trio-unresolved"><span className="trio-unresolved__icon"><CircleAlert size={16} /></span><span><small>ยังค้าง · {unresolved.id}</small><strong>{unresolved.label}</strong><p>{unresolved.detail}</p></span><span className="trio-unresolved__status">ยังต้องยืนยัน</span></div>
      <div className="trio-evidence-head"><span><FileText size={14} /> ประวัติหลักฐาน</span><small>{events.length} รายการ</small></div>
      {events.length ? <ol className="trio-event-list">{events.map((event) => {
        const id = `event-${event.id}`;
        const open = openId === id;
        return <li key={event.id}>
          <span className={`trio-event-kind is-${event.kind}`} />
          <div className="trio-event-content"><span className="trio-event-meta">{({ source: 'ข้อมูลต้นทาง', instruction: 'กติกา', test: 'ผลตรวจ', approval: 'อนุมัติ', run: 'ใช้งาน', simulation: 'ทดลอง', handoff: 'ส่งต่อ' })[event.kind]} · v{event.version}</span><strong>{event.title}</strong><small>มีรายละเอียดและรหัสอ้างอิงบันทึกไว้</small><button className="trio-link-button" type="button" aria-expanded={open} aria-controls={`trio-event-${event.id}`} onClick={() => onToggle(id)}>{open ? 'ซ่อนรายละเอียด' : 'ดูรายละเอียดหลักฐาน'}<ArrowUpRight size={13} /></button>{open && eventDescription(event)}</div>
        </li>;
      })}</ol> : <div className="trio-no-events">หลักฐานจะปรากฏเมื่อมีการเปิดข้อมูล ตรวจ อนุมัติ หรือส่งต่องาน</div>}
      <button className="trio-button trio-button--primary trio-handoff-button" type="button" aria-label="Start handoff" disabled={guided || snapshot.handoff === 'in-progress'} onClick={onHandoff}>{snapshot.handoff === 'in-progress' ? <Check size={14} /> : <ArrowRight size={14} />}{snapshot.handoff === 'in-progress' ? 'ส่งต่องานแล้ว' : 'เริ่มส่งต่องาน'}</button>
      {guided && <p className="trio-lock-note"><ShieldCheck size={13} aria-hidden="true" />เริ่มส่งต่อได้เมื่อคุณรับช่วง</p>}
    </StageCard>
  );
}

type TrioStageRenderProps = TrioStageProps & {
  objectId?: StoryStep;
  onEncounterRoundComplete?: (outcome: EncounterOutcome, context: 'baseline' | 'draft' | 'verify' | 'active' | 'simulation' | 'history') => void;
};

function TrioStage(props: TrioStageRenderProps) {
  const { snapshot, step, phase, draftFields, guided } = props;
  const { objectId } = props;
  const { caseId, level, active: activeBook, draft, simulation, evaluation, approved, version } = snapshot;
  const storyClass = caseId;
  const demoActive = guided && ((step === 'minimal' && phase === 'reading') || (step === 'notice' && (phase === 'typing' || phase === 'thinking')) || (step === 'simulate' && (phase === 'typing' || phase === 'thinking'))); 
  const [detailId, setDetailId] = useState<string | null>(null);
  const [simulationSeconds, setSimulationSeconds] = useState(0);
  useEffect(() => { if (guided && step === 'simulate' && phase === 'reading') setSimulationSeconds(150); }, [guided, step, phase]);
  const [musicPlaying, setMusicPlaying] = useState(false);
  const [musicSectionId, setMusicSectionId] = useState('MU-004');
  const [musicFeedback, setMusicFeedback] = useState<string | null>(null);
  const questTimer = useActiveQuestTimer(guided);
  const guidedTargetRef = useRef<HTMLElement | null>(null);
  const stageRootRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Partial<Record<StoryStep, HTMLElement | null>>>({});
  const original = useMemo(() => initialRules(), []);
  const target = useMemo(() => taughtRules(), []);
  const ruleFingerprint = rulesFingerprint(caseId, draft);
  const stale = evaluation !== null && evaluation.fingerprint !== ruleFingerprint;
  const approvalReady = Boolean(evaluation && !stale && !approved && canApprove(caseId, draft, evaluation));
  const caseIcon = caseId === 'shipping' ? PackageOpen : caseId === 'quest' ? Compass : Music2;
  const setCardRef = (targetStep: StoryStep) => (node: HTMLElement | null) => { cardRefs.current[targetStep] = node; };
  const toggleDetail = (id: string) => setDetailId((current) => current === id ? null : id);
  const scrollToStage = useCallback((node: HTMLElement) => {
    const stage = stageRootRef.current;
    if (!stage) return;
    const stageBounds = stage.getBoundingClientRect();
    const nodeBounds = node.getBoundingClientRect();
    const margin = 18;
    const top = nodeBounds.top - stageBounds.top;
    const bottom = nodeBounds.bottom - stageBounds.top;
    let nextScrollTop = stage.scrollTop;
    if (nodeBounds.height >= stage.clientHeight - margin * 2) {
      nextScrollTop += top - margin;
    } else if (top < margin) {
      nextScrollTop += top - margin;
    } else if (bottom > stage.clientHeight - margin) {
      nextScrollTop += bottom - stage.clientHeight + margin;
    }
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    stage.scrollTo({ top: Math.max(0, nextScrollTop), behavior: reduceMotion ? 'auto' : 'smooth' });
  }, []);

  useEffect(() => {
    if (!guided) return;
    if (objectId) {
      if (step !== objectId) return;
      const objectTarget = guidedTargetRef.current ?? cardRefs.current[objectId] ?? null;
      if (!objectTarget) return;
      const disabledTarget = 'disabled' in objectTarget && objectTarget.disabled;
      const focusTarget = disabledTarget ? cardRefs.current[objectId] ?? objectTarget : objectTarget;
      focusTarget.focus({ preventScroll: true });
      // The Canvas owns scrolling to its precise narrative target.
      return;
    }
    if (step !== 'teach') guidedTargetRef.current = null;
    let targetNode: HTMLElement | null = null;
    if (step === 'teach') targetNode = guidedTargetRef.current ?? cardRefs.current.teach ?? null;
    else if (step === 'verify') targetNode = cardRefs.current.verify ?? null;
    else targetNode = cardRefs.current[step] ?? null;
    if (!targetNode) return;
    targetNode.focus({ preventScroll: true });
    scrollToStage(targetNode);
  }, [guided, step, level, draftFields, evaluation, scrollToStage, objectId]);

  useEffect(() => {
    setMusicPlaying(false);
    setMusicSectionId('MU-004');
    setMusicFeedback(null);
    setSimulationSeconds(0);
    questTimer.reset();
    // A new story has its own clock and section selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const currentMusicPlan = musicPlan(activeBook.music);
  const metronomeSection = currentMusicPlan.find((section) => section.id === musicSectionId) ?? currentMusicPlan[3] ?? currentMusicPlan[0];


  const changeDraft = (next: RuleBook) => props.onDraftChange(next);
  const changeSimulation = (next: RuleBook) => props.onSimulationChange(next);
  const currentStepIndex = allSteps.indexOf(step);
  const StageIcon = caseIcon;
  const showDraft = level >= 4 || (guided && step === 'teach' && phase === 'building');
  const markMusicLate = (beat: number) => {
    const detail = `ผู้ใช้ทำเครื่องหมายว่าเข้าช้าใน ${metronomeSection?.name ?? 'ท่อนเพลง'} ณ จังหวะ ${beat}`;
    setMusicFeedback(detail);
    props.onFeedback(detail);
  };

  if (objectId) {
    const active = guided && step === objectId;
    const objectRef = setCardRef(objectId);
    let content: ReactNode = null;
    if (objectId === 'sources' && level >= 1) {
      content = <SourceCard sourceCue={props.sourceCue} caseId={caseId} original={original} openId={detailId} onToggle={toggleDetail} active={active} focusRef={objectRef} onInspect={() => props.onInspect?.('sources')} />;
    } else if (caseId === 'quest' && activeBook.quest.encounter && level >= 2) {
      content = <EncounterPanel objectId={objectId} {...props} />;
    } else if (objectId === 'minimal' && level >= 2) {
      if (caseId === 'shipping') content = <ShippingWorkspace rule={activeBook.shipping} guided={guided} active={active} focusRef={objectRef} />;
      if (caseId === 'quest') content = <QuestWorkspace rule={activeBook.quest} guided={guided} paused={props.paused} demoActive={demoActive} onFeedback={props.onFeedback} timer={questTimer} active={active} focusRef={objectRef} />;
      if (caseId === 'music') content = <MusicWorkspace rule={activeBook.music} guided={guided} paused={props.paused} demoActive={demoActive} playing={musicPlaying} sectionId={musicSectionId} setSectionId={setMusicSectionId} onPlayingChange={setMusicPlaying} feedback={musicFeedback} onMarkLate={markMusicLate} active={active} focusRef={objectRef} />;
      content = <AdaptiveSurface snapshot={snapshot} onInteract={() => props.onInspect?.('minimal')}>{content}</AdaptiveSurface>;
    } else if (objectId === 'notice' && level >= 3) {
      content = <DiscrepancyCard caseId={caseId} original={original} target={target} active={active} focusRef={objectRef} />;
    } else if (objectId === 'teach' && (level >= 4 || (guided && step === 'teach' && phase === 'building'))) {
      content = <DraftCard caseId={caseId} book={draft} onBookChange={changeDraft} draftFields={draftFields} guided={guided} focusFieldRef={(node) => { if (guided) guidedTargetRef.current = node; }} active={active} cardRef={objectRef} />;
    } else if (objectId === 'verify' && level >= 5) {
      content = <VerificationCard caseId={caseId} evaluation={evaluation} stale={stale} guided={guided} phase={phase} paused={props.paused} speed={props.speed} onVerify={props.onVerify} active={active} focusRef={objectRef} sampleFocusRef={(node) => { if (guided && node) guidedTargetRef.current = node; }} scrollToStage={scrollToStage} />;
    } else if (objectId === 'approve' && level >= 6) {
      content = <ApprovalCard approved={approved} version={version} canApproveRule={approvalReady} guided={guided} onApprove={props.onApprove} active={active} focusRef={objectRef} />;
    } else if (objectId === 'simulate' && level >= 7) {
      content = <SimulationCard caseId={caseId} activeRule={activeBook} simulation={simulation} onSimulationChange={changeSimulation} elapsed={simulationSeconds} setElapsed={setSimulationSeconds} solved={false} active={active} focusRef={objectRef} />;
    } else if (objectId === 'handoff' && level >= 8) {
      content = <HandoffCard snapshot={snapshot} onHandoff={props.onHandoff} guided={guided} openId={detailId} onToggle={toggleDetail} active={active} focusRef={objectRef} />;
    }

    if (content && (objectId === 'minimal' || objectId === 'teach')) {
      const purpose = objectId === 'minimal' ? 'create' : 'revise';
      content = <><EvidenceOrigin caseId={caseId} purpose={purpose} onInspect={() => {
        props.onSourceInspect?.(purpose);
        props.onInspect?.('sources');
      }} />{content}</>;
    }

    return (
      <div
        ref={stageRootRef}
        className={`trio-stage trio-stage--${storyClass} trio-stage__object`}
        data-case={caseId}
        data-level={level}
        data-step={objectId}
        data-version={version}
        data-guided={String(guided)}
        data-testid={`trio-object-${objectId}`}
        aria-label={`${CASE_TITLE[caseId]} · ${stepLabels[objectId]}`}
      >
        {content}
      </div>
    );
  }

  return (
    <div ref={stageRootRef} className={`trio-stage trio-stage--${storyClass}`} data-case={caseId} data-level={level} data-step={step} data-version={version} data-guided={String(guided)} data-testid="trio-stage" aria-label={`พื้นที่ทำงาน: ${CASE_TITLE[caseId]}`}>
      <div className="trio-stage__frame">
        <header className="trio-stage__header">
          <div className="trio-stage__identity">
            <span className="trio-stage__brand-mark"><StageIcon size={17} aria-hidden="true" /></span>
            <span><span className="trio-stage__overline">PROCEDURAL · พื้นที่ทำงาน</span><h1>{CASE_TITLE[caseId]}</h1></span>
          </div>
          <div className="trio-stage__story-state"><span className="trio-state-dot" />{guided ? 'เรื่องตัวอย่าง' : 'พื้นที่ของคุณ'}<span className="trio-state-separator">·</span>ขั้น {level}</div>
        </header>

        <div className="trio-stage__context"><span>{CASE_CONTEXT[caseId]}</span><span className="trio-stage__step-label"><span>{String(Math.max(0, currentStepIndex + 1)).padStart(2, '0')}</span>{stepLabels[step]}</span></div>

        <div className={`trio-stage__grid ${level < 2 ? 'is-building' : ''}`}>
          <main className="trio-stage__primary" data-testid="trio-primary">
            {level < 2 ? <BuilderCard caseId={caseId} level={level} phase={phase} active={guided && (step === 'minimal' || step === 'sources')} focusRef={setCardRef(level === 0 && step === 'sources' ? 'sources' : level === 0 ? 'minimal' : 'sources')} /> : (
              <>
                <AdaptiveSurface snapshot={snapshot} onInteract={() => props.onInspect?.('minimal')}>
                {caseId === 'shipping' && <ShippingWorkspace rule={activeBook.shipping} guided={guided} active={guided && step === 'minimal'} focusRef={setCardRef('minimal')} />}
                {caseId === 'quest' && <QuestWorkspace rule={activeBook.quest} guided={guided} paused={props.paused} demoActive={demoActive} onFeedback={props.onFeedback} timer={questTimer} active={guided && step === 'minimal'} focusRef={setCardRef('minimal')} />}
                {caseId === 'music' && <MusicWorkspace rule={activeBook.music} guided={guided} paused={props.paused} demoActive={demoActive} playing={musicPlaying} sectionId={musicSectionId} setSectionId={setMusicSectionId} onPlayingChange={setMusicPlaying} feedback={musicFeedback} onMarkLate={markMusicLate} active={guided && step === 'minimal'} focusRef={setCardRef('minimal')} />}
                </AdaptiveSurface>
                {level >= 3 && <DiscrepancyCard caseId={caseId} original={original} target={target} active={guided && step === 'notice'} focusRef={setCardRef('notice')} />}
                {showDraft && <DraftCard caseId={caseId} book={draft} onBookChange={changeDraft} draftFields={draftFields} guided={guided} focusFieldRef={(node) => { if (guided) guidedTargetRef.current = node; }} active={guided && step === 'teach'} cardRef={setCardRef('teach')} />}
                 {level >= 5 && <VerificationCard caseId={caseId} evaluation={evaluation} stale={stale} guided={guided} phase={phase} paused={props.paused} speed={props.speed} onVerify={props.onVerify} active={guided && step === 'verify'} focusRef={setCardRef('verify')} sampleFocusRef={(node) => { if (guided && node) guidedTargetRef.current = node; }} scrollToStage={scrollToStage} />}
                {level >= 6 && <ApprovalCard approved={approved} version={version} canApproveRule={approvalReady} guided={guided} onApprove={props.onApprove} active={guided && step === 'approve'} focusRef={setCardRef('approve')} />}
                {level >= 7 && <SimulationCard caseId={caseId} activeRule={activeBook} simulation={simulation} onSimulationChange={changeSimulation} elapsed={simulationSeconds} setElapsed={setSimulationSeconds} solved={false} active={guided && step === 'simulate'} focusRef={setCardRef('simulate')} />}
                {level >= 8 && <HandoffCard snapshot={snapshot} onHandoff={props.onHandoff} guided={guided} openId={detailId} onToggle={toggleDetail} active={guided && step === 'handoff'} focusRef={setCardRef('handoff')} />}
              </>
            )}
          </main>

          <aside className="trio-stage__rail" aria-label="Source and current rule">
            {level >= 1 && <SourceCard sourceCue={props.sourceCue} caseId={caseId} original={original} openId={detailId} onToggle={toggleDetail} active={guided && step === 'sources'} focusRef={setCardRef('sources')} onInspect={() => props.onInspect?.('sources')} />}
                {level >= 2 && <section className="trio-card trio-rule-rail">
              <div className="trio-card__head"><span className="trio-card__icon"><ShieldCheck size={16} aria-hidden="true" /></span><span className="trio-card__titles"><span className="trio-card__eyebrow">กติกาที่ใช้อยู่ · V{version}</span><span className="trio-card__title">ค่าปัจจุบัน</span></span></div>
              <div className="trio-card__body">
                {caseId === 'shipping' && <p><strong>฿{activeBook.shipping.bangkok}</strong> Bangkok · <strong>฿{activeBook.shipping.regional}</strong> regional <small>+ ฿{activeBook.shipping.extraKg} per started kg</small></p>}
                {caseId === 'quest' && <p>คำใบ้แรก <strong>{formatTime(activeBook.quest.firstHint)}</strong> · คำใบ้ที่สอง <strong>{formatTime(activeBook.quest.secondHint)}</strong> <small>เฉลย: {activeBook.quest.autoReveal ? 'อัตโนมัติ' : 'ผู้เล่นเลือกเอง'}</small></p>}
                {caseId === 'music' && <p>ท่อนฮุก <strong>{activeBook.music.chorusBpm} BPM</strong> · ท่อนอื่น <strong>{activeBook.music.otherBpm} BPM</strong> <small>ท่อนฮุก ×{activeBook.music.repetitions} รอบ</small></p>}
                <span className={`trio-approval-pill ${approved ? 'is-approved' : ''}`}>{approved ? 'อนุมัติและใช้งาน' : 'กติกาฉบับทำงาน'}</span>
              </div>
            </section>}
            {level >= 5 && <div className="trio-rail-note"><CircleCheck size={14} /><span>อนุมัติได้เมื่อผลตรวจกับร่างปัจจุบันผ่านครบ</span></div>}
            {level >= 7 && <div className="trio-rail-note"><Activity size={14} /><span>ค่าทดลองแยกจากกติกาที่ใช้อยู่</span></div>}
            {level >= 8 && <div className="trio-rail-note"><CircleAlert size={14} /><span>รายการที่ค้างจะไม่ถูกปิดจนกว่าจะมีคนยืนยัน</span></div>}
            {level < 1 && <div className="trio-rail-empty"><span className="trio-rail-empty__glyph"><StageIcon size={17} /></span><span><strong>เริ่มจากหน้าว่าง</strong><small>ข้อมูลต้นทางและพื้นที่ใช้งานจะค่อย ๆ ปรากฏตามคำขอ</small></span></div>}
          </aside>
        </div>

        <footer className="trio-stage__footer"><span><span className="trio-footer-mark">●</span> ตัวอย่างในเครื่อง · แต่ละเรื่องมีประวัติหลักฐานของตัวเอง</span>{!guided && level < 8 && <button className="trio-button trio-button--primary trio-continue-button" type="button" data-testid="trio-continue" disabled={level === 5 && !approvalReady} onClick={props.onContinue}>{manualContinueLabels[Math.min(level, 7)]}<ArrowRight size={14} aria-hidden="true" /></button>}</footer>
      </div>
    </div>
  );
}

export function TrioObject(props: TrioStageRenderProps & { objectId: StoryStep }) {
  return <SurfaceVisibility.Provider value={props.surfaceVisible !== false}><TrioStage {...props} objectId={props.objectId} /></SurfaceVisibility.Provider>;
}

export default TrioStage;
