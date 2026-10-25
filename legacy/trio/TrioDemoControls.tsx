import { ArrowLeft, ArrowRight, Check, CirclePause, CirclePlay, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import type { BuildPhase, StoryStep } from './types';
import type { TrioController } from './TrioExperience';
import { narrativeTerms, narrativeAnchor } from './narrativeFocus';
import './trio-demo-controls.css';

const phases: readonly { id: Exclude<BuildPhase, 'complete'>; label: string }[] = [
  { id: 'typing', label: 'พิมพ์' },
  { id: 'thinking', label: 'คิด' },
  { id: 'building', label: 'สร้าง' },
  { id: 'reading', label: 'ดูผล' },
];

const steps: readonly StoryStep[] = ['sources', 'minimal', 'notice', 'teach', 'verify', 'approve', 'simulate', 'handoff'];
const stepLabels: Record<StoryStep, string> = {
  sources: 'ดูข้อมูลตั้งต้น',
  minimal: 'ทำพื้นที่ใช้งาน',
  notice: 'ตกลงสิ่งที่ต้องเปลี่ยน',
  teach: 'ร่างกติกา',
  verify: 'ลองกับตัวอย่าง',
  approve: 'ยืนยันเวอร์ชัน',
  simulate: 'ทดลองแยกชุด',
  handoff: 'สรุปผลและส่งต่อ',
};

const phaseIndex = (phase: BuildPhase) => phase === 'complete' ? phases.length - 1 : phases.findIndex((item) => item.id === phase);

export function TrioDemoPicker({ controller, onSelect }: { controller: TrioController; onSelect?: () => void }) {
  return (
    <section className="trio-demo-picker" data-testid="trio-demo-picker" aria-label="เลือกเดโม">
      <div className="trio-demo-picker__heading">
        <span>เลือกเรื่องที่จะลอง</span>
        <small>ข้อมูลตัวอย่าง · ยังไม่เชื่อม AI</small>
      </div>
      <div className="trio-demo-picker__choices">
        {controller.stories.map((story, index) => (
          <button
            className={`trio-demo-picker__choice trio-demo-picker__choice--${story.id}`}
            type="button"
            key={story.id}
            data-testid={`case-${story.id}`}
            onClick={() => {
              controller.beginStory(story.id);
              onSelect?.();
            }}
            aria-label={`เลือกเดโม ${story.title}`}
          >
            <span className="trio-demo-picker__number">0{index + 1}</span>
            <span className="trio-demo-picker__copy">
              <strong>{story.title}</strong>
              <small>{story.prompt}</small>
            </span>
            <ArrowRight size={16} aria-hidden="true" />
          </button>
        ))}
      </div>
      {controller.messages.storage && <p className="trio-demo-picker__message" role="status">{controller.messages.storage}</p>}
    </section>
  );
}

export function TrioDemoControls({ controller }: { controller: TrioController }) {
  const { snapshot, player, story } = controller;
  if (!snapshot || !story) return null;

  const ready = player.guided && !player.started;
  const activePhase = ready ? -1 : phaseIndex(player.phase);
  const activeStepIndex = Math.max(0, steps.indexOf(player.step));
  const currentStepName = stepLabels[player.step];
  const statusText = player.status || (player.guided ? 'เรื่องกำลังดำเนินตามลำดับ' : 'พื้นที่ทำงานพร้อมให้แก้ไข');
  const requestText = player.request || (ready ? story.prompt : player.phase === 'typing' ? '…' : story.prompt);
  const terms = ready ? [] : narrativeTerms(snapshot.caseId, player.step);
  const activeTerm = narrativeAnchor(snapshot.caseId, player.step, requestText);
  const requestParts: Array<{ text: string; marked: boolean }> = [];
  let offset = 0;
  while (offset < requestText.length) {
    const term = terms.find((candidate) => requestText.startsWith(candidate, offset));
    if (term) { requestParts.push({ text: term, marked: true }); offset += term.length; }
    else { requestParts.push({ text: requestText[offset], marked: false }); offset += 1; }
  }

  return (
    <section
      className="demo-player trio-demo-controls"
      data-testid="trio-player"
      data-case={snapshot.caseId}
      data-step={player.step}
      data-evidence-purpose={player.sourceCue?.purpose}
      data-evidence-beat={player.sourceCue?.beat}
      data-phase={ready ? 'ready' : player.phase}
      data-guided={String(player.guided)}
      aria-label="ตัวควบคุมเดโม"
    >
      <div className="demo-player-label trio-demo-controls__label">
        <span>{ready ? 'พร้อมเริ่ม · Canvas ว่าง' : `${String(activeStepIndex + 1).padStart(2, '0')}/8 · ${currentStepName}`}</span>
        <strong>{story.shortTitle}</strong>
      </div>
      <div className="demo-player-controls trio-demo-controls__buttons">
        <button type="button" aria-label="Back to stories" title="กลับไปเลือกเรื่อง" onClick={controller.backToStories}><ArrowLeft size={15}/></button>
        {player.guided && <>
          <button type="button" aria-label="Previous story step" title="ย้อนหนึ่งขั้น" disabled={snapshot.level === 0} onClick={controller.previousStep}><SkipBack size={15}/></button>
          {ready ? <button type="button" className="trio-start-demo" aria-label="Start demo" onClick={controller.startPlayback}><CirclePlay size={16}/><span>เริ่มเดโม</span></button> : <button type="button" aria-label={player.paused ? 'Resume story' : 'Pause story'} title={player.paused ? 'เล่นต่อ' : 'พักเรื่อง'} disabled={player.phase === 'complete'} onClick={controller.togglePause}>{player.paused ? <CirclePlay size={16}/> : <CirclePause size={16}/>}</button>}
          <button type="button" aria-label="Next story step" title="ไปขั้นถัดไป" disabled={ready || player.phase === 'building' || player.phase === 'complete'} onClick={controller.nextStep}><SkipForward size={15}/></button>
          <label className="trio-demo-controls__speed"><span className="trio-visually-hidden">ความเร็ว</span><select aria-label="Story playback speed" value={player.speed} onChange={(event) => controller.setSpeed(Number(event.target.value))}><option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option></select></label>
        </>}
        <button type="button" aria-label="Replay story" title="เริ่มเรื่องนี้ใหม่" onClick={controller.replay}><RotateCcw size={15}/></button>
        {player.guided && <button type="button" className="demo-take-over" aria-label="Take over workspace" onClick={controller.takeOver}><ArrowRight size={13}/><span>รับช่วงต่อ</span></button>}
      </div>
      <ol className="demo-stage-rail trio-demo-controls__rail" data-testid="trio-demo-stage-rail" aria-label="พิมพ์ คิด สร้าง ดูผล">
        {phases.map((phase, index) => {
          const state = index < activePhase ? 'complete' : index === activePhase ? 'current' : 'next';
          return <li key={phase.id} role="listitem" data-stage-state={state} aria-current={state === 'current' ? 'step' : undefined} aria-label={`${phase.label} · ${state}`}>
            <span className="demo-stage-rail__marker">{state === 'complete' ? <Check size={10}/> : String(index + 1)}</span>
            <span className="demo-stage-rail__label">{phase.label}</span>
          </li>;
        })}
      </ol>
      <div className="demo-request-block trio-demo-controls__request" data-testid="trio-request">
        <span className="demo-message-label">{ready ? 'เรื่องที่จะเริ่ม' : player.phase === 'typing' ? player.paused ? 'คุณ · พักการพิมพ์' : 'คุณ · กำลังพิมพ์' : 'คุณ'}</span>
        <p className={`demo-request ${!ready && !player.paused && player.phase === 'typing' ? 'is-typing' : ''}`}>{requestParts.map((part, index) => part.marked ? <mark key={index} className={part.text === activeTerm ? 'is-current-reference' : ''}>{part.text}</mark> : part.text)}</p>
      </div>
      <div className="demo-beat trio-demo-controls__status" data-testid="trio-status" role="status" aria-live="polite">
        <span className={`demo-beat-dot phase-${player.phase}`}/>
        <strong className="demo-beat__speaker">{!ready && !player.paused && player.phase === 'typing' ? 'คุณ' : 'Procedural'}</strong>
        <span className="demo-beat__message">{statusText}</span>
        <small>{ready ? 'รอคุณเริ่ม' : player.guided ? (player.paused ? 'พักอยู่' : `ขั้น ${snapshot.level}/8`) : 'โหมดทำงานปกติ'}</small>
      </div>
    </section>
  );
}
