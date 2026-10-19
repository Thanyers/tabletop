import { SurfaceVisibility } from '../SurfaceVisibility';
import { useContext, useId, useMemo, useState, type ReactNode } from 'react';
import { ArrowRight, BarChart3, Check, ChevronDown, CircleHelp, LayoutGrid, PanelsTopLeft, Table2 } from 'lucide-react';
import type { CaseId, TrioSnapshot } from '../types';
import { PRESENTATION_OPTIONS, resolveSurface } from './resolveSurface';
import { STANDARD_RENDERERS, PresentationPreview } from './StandardComponents';
import type { PresentationId, PresentationOption } from './types';
import './adaptive-surface.css';

export interface AdaptiveSurfaceProps {
  snapshot: TrioSnapshot;
  children: ReactNode;
  onInteract?: () => void;
}

const PRESENTATION_ICON = {
  original: PanelsTopLeft,
  table: Table2,
  cards: LayoutGrid,
  chart: BarChart3,
} satisfies Record<PresentationId, typeof PanelsTopLeft>;

const CHOICE_TITLE: Readonly<Record<CaseId, string>> = {
  shipping: 'เปรียบเทียบวิธีดูค่าส่ง',
  quest: 'เปรียบเทียบวิธีดูเส้นทาง',
  music: 'เปรียบเทียบวิธีดูแผนซ้อม',
};

function ConnectionDetails({
  caseId,
  sourceLabel,
  ruleSummary,
  activeVersion,
  derivedLabel,
  outputLabel,
  onInteract,
}: {
  caseId: CaseId;
  sourceLabel: string;
  ruleSummary: string;
  activeVersion: number;
  derivedLabel: string;
  outputLabel: string;
  onInteract?: () => void;
}) {
  const copy = caseId === 'shipping'
    ? 'ตัวอย่างพัสดุถูกคำนวณด้วยราคาฐานและวันเริ่มสัญญาที่ใช้อยู่ ยอดที่เรียกเก็บเดิมยังแยกให้ดู'
    : caseId === 'quest'
      ? 'คำตอบ → ตรวจปริศนา → ปลดล็อกด่านถัดไป นาฬิกา → กติกาคำใบ้ → ปุ่มขอคำใบ้ เมื่อผ่านครบเกมจะหยุดเวลาเอง'
      : 'ท่อนเพลง + กติกา → เสียงตัวอย่าง PCM → คลื่นเสียงและลำโพง นาฬิกาเสียงเดียวกันขับเส้นวิ่ง ไฟจังหวะ และจำนวนรอบ';

  return <details className="trio-adaptive-surface__connections" onToggle={(event) => { if (event.currentTarget.open) onInteract?.(); }}>
    <summary><CircleHelp size={14} aria-hidden="true" />ดูว่าทำงานอย่างไร<ChevronDown size={14} aria-hidden="true" /></summary>
    <div className="trio-adaptive-surface__connection-flow">
      <div><small>ข้อมูลตัวอย่าง</small><strong>{sourceLabel}</strong></div>
      <ArrowRight aria-hidden="true" />
      <div><small>กติกาที่ใช้อยู่ · V{activeVersion}</small><strong>{ruleSummary}</strong></div>
      <ArrowRight aria-hidden="true" />
      <div><small>คำนวณ</small><strong>{derivedLabel}</strong></div>
      <ArrowRight aria-hidden="true" />
      <div><small>รูปแบบผลลัพธ์</small><strong>{outputLabel}</strong></div>
    </div>
    <p>{copy}</p>
    <p className="trio-adaptive-surface__local-note">คอมโพเนนต์เฉพาะงานเชื่อมการกด การคำนวณ และผลลัพธ์ไว้ด้วยกัน ตาราง/กราฟเป็นอีกมุมมองของข้อมูลเดียวกัน เดโมใช้ไฟล์ตัวอย่างในแอป ยังไม่เชื่อมบริการภายนอก</p>
  </details>;
}

function SurfaceStatusNotice({ state, message }: { state: 'loading' | 'empty' | 'error'; message?: string }) {
  const title = state === 'loading' ? 'กำลังเตรียมข้อมูล' : state === 'empty' ? 'ยังไม่มีรายการให้แสดง' : 'ตรวจข้อมูลกติกา';
  const detail = state === 'loading'
    ? 'กำลังอ่านกติกาที่ใช้อยู่'
    : state === 'empty'
      ? 'เพิ่มข้อมูลในเรื่องนี้แล้วลองดูอีกครั้ง'
      : message ?? 'กติกาที่ใช้อยู่สร้างผลลัพธ์ไม่ได้';
  return <div className={`trio-adaptive-surface__state${state === 'error' ? ' is-error' : ''}`} role={state === 'error' ? 'alert' : 'status'}>
    <span className="trio-adaptive-surface__state-mark" aria-hidden="true">{state === 'loading' ? '···' : state === 'empty' ? '—' : '!'}</span>
    <span><strong>{title}</strong><small>{detail}</small></span>
  </div>;
}

function OptionChoice({
  option,
  surface,
  inputName,
  inputId,
  selected,
  onSelect,
}: {
  option: PresentationOption;
  surface: ReturnType<typeof resolveSurface>;
  inputName: string;
  inputId: string;
  selected: boolean;
  onSelect: (id: PresentationId) => void;
}) {
  const Icon = PRESENTATION_ICON[option.id];
  return <label className={`trio-adaptive-surface__option${selected ? ' is-selected' : ''}`} data-testid={`adaptive-surface-choice-${option.id}`}>
    <input
      className="trio-adaptive-surface__radio"
      type="radio"
      name={inputName}
      id={inputId}
      value={option.id}
      checked={selected}
      onChange={() => onSelect(option.id)}
    />
    <span className="trio-adaptive-surface__option-inner">
      <span className="trio-adaptive-surface__option-heading">
        <span className="trio-adaptive-surface__option-icon"><Icon size={15} aria-hidden="true" /></span>
        <span className="trio-adaptive-surface__option-title"><strong>{option.label}</strong><small>{option.description}</small></span>
        {option.recommended && <span className="trio-adaptive-surface__recommended"><Check size={11} aria-hidden="true" />แนะนำ</span>}
        <span className="trio-adaptive-surface__radio-mark" aria-hidden="true" />
      </span>
      <PresentationPreview surface={surface} presentation={option.id} />
      <span className="trio-adaptive-surface__tradeoff">{option.tradeoff}</span>
    </span>
  </label>;
}

export function AdaptiveSurface({ snapshot, children, onInteract }: AdaptiveSurfaceProps) {
  const [selection, setSelection] = useState<{ caseId: CaseId; id: PresentationId }>({ caseId: snapshot.caseId, id: 'original' });
  const [choiceOpen, setChoiceOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const groupId = useId();
  const parentVisible = useContext(SurfaceVisibility);
  const surface = useMemo(() => resolveSurface(snapshot), [snapshot]);
  const options = PRESENTATION_OPTIONS[snapshot.caseId];
  const presentation = selection.caseId === snapshot.caseId && options.some((option) => option.id === selection.id)
    ? selection.id
    : 'original';
  const selectedOption = options.find((option) => option.id === presentation) ?? options[0];
  const Renderer = selectedOption.id === 'original' ? null : STANDARD_RENDERERS[selectedOption.id];
  const chooserId = `${groupId}-choices`;
  const inputName = `${groupId}-presentation`;

  const choose = (id: PresentationId) => {
    onInteract?.();
    setSelection({ caseId: snapshot.caseId, id });
    setChoiceOpen(false);
    setToolsOpen(false);
  };

  return <section
    className={`trio-adaptive-surface trio-adaptive-surface--${snapshot.caseId}`}
    data-case={snapshot.caseId}
    data-presentation={presentation}
    data-state={surface.state}
    data-testid="trio-adaptive-surface"
    aria-label={`รูปแบบข้อมูล · ${surface.title}`}
  >
    <header className="trio-adaptive-surface__header">
      <div className="trio-adaptive-surface__heading">
        <span className="trio-adaptive-surface__eyebrow">ข้อมูลที่เชื่อมไว้</span>
        <strong>{surface.title}</strong>
        <span className="trio-adaptive-surface__version">ACTIVE · V{surface.activeVersion}</span>
      </div>
      <button
        className="trio-adaptive-surface__choose-button"
        type="button"
        data-testid="adaptive-surface-options"
        aria-expanded={choiceOpen}
        aria-controls={chooserId}
        onClick={() => {
          if (!choiceOpen) onInteract?.();
          setChoiceOpen((open) => !open);
        }}
      >
        <LayoutGrid size={14} aria-hidden="true" />เลือกรูปแบบ
      </button>
    </header>

    {choiceOpen && <fieldset className="trio-adaptive-surface__chooser" id={chooserId}>
      <legend>{CHOICE_TITLE[snapshot.caseId]}</legend>
      <p>ดูตัวอย่างทั้งสามแบบ แล้วเลือกรูปแบบที่อ่านง่ายสำหรับงานนี้</p>
      <div className="trio-adaptive-surface__options">
        {options.map((option) => <OptionChoice
          key={option.id}
          option={option}
          surface={surface}
          inputName={inputName}
          inputId={`${groupId}-${option.id}`}
          selected={presentation === option.id}
          onSelect={choose}
        />)}
      </div>
    </fieldset>}

    {presentation === 'original' && surface.state !== 'ready' && <SurfaceStatusNotice state={surface.state} message={surface.stateMessage} />}

    <div className="trio-adaptive-surface__binding" aria-label={`ข้อมูล ${surface.sourceLabel} ไปยังกติกาที่ใช้อยู่ แล้วแสดงเป็น ${selectedOption.label}`}>
      <span>{surface.sourceLabel}</span><ArrowRight size={12} aria-hidden="true" />
      <span>กติกา · V{surface.activeVersion}</span><ArrowRight size={12} aria-hidden="true" />
      <strong>{selectedOption.label}</strong>
    </div>

    {presentation !== 'original' && <div className="trio-adaptive-surface__active-rule">
      <div className="trio-adaptive-surface__rule-heading"><span>กติกาที่ใช้อยู่</span><strong>{surface.ruleSummary}</strong></div>
      <div className="trio-adaptive-surface__metrics">
        {surface.metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><strong>{metric.value}</strong>{metric.note && <small>{metric.note}</small>}</div>)}
      </div>
    </div>}

    <div className="trio-adaptive-surface__view" data-testid={`adaptive-surface-view-${presentation}`}>
      <div className="trio-adaptive-surface__renderer" hidden={presentation === 'original'}>
        {presentation !== 'original' && Renderer && <Renderer surface={surface} />}
      </div>
      <div className="trio-adaptive-surface__tools" data-testid="adaptive-surface-original-tools" hidden={presentation !== 'original' && !toolsOpen}>
        <div className="trio-adaptive-surface__tools-heading" hidden={presentation === 'original' || !toolsOpen}>เครื่องมือเดิมยังอยู่ในพื้นที่นี้</div>
        <SurfaceVisibility.Provider value={parentVisible && (presentation === 'original' || toolsOpen)}>{children}</SurfaceVisibility.Provider>
      </div>
    </div>

    {presentation !== 'original' && <>
      <button
        className="trio-adaptive-surface__tools-button"
        type="button"
        data-testid="adaptive-surface-tools"
        aria-expanded={toolsOpen}
        onClick={() => {
          onInteract?.();
          setToolsOpen((open) => !open);
        }}
      >
        <PanelsTopLeft size={14} aria-hidden="true" />{toolsOpen ? 'ซ่อนเครื่องมือใช้งาน' : 'เปิดเครื่องมือใช้งาน'}
      </button>
    </>}

    <ConnectionDetails
      caseId={snapshot.caseId}
      sourceLabel={surface.sourceLabel}
      ruleSummary={surface.ruleSummary}
      activeVersion={surface.activeVersion}
      derivedLabel={surface.derivedLabel}
      outputLabel={selectedOption.label}
      onInteract={onInteract}
    />
  </section>;
}

