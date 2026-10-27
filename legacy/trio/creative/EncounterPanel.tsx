import { useContext, useEffect, useRef, useState } from 'react';
import { EncounterGame } from './EncounterGame';
import {
  BASELINE_ENCOUNTER_RULE,
  ENCOUNTER_TRACE,
  runEncounter,
  type EncounterOutcome,
  type EncounterRule,
} from './encounterModel';
import { canApprove, rulesFingerprint } from '../domain';
import { SurfaceVisibility } from '../SurfaceVisibility';
import TrioDeliverables from '../TrioDeliverables';
import type { StoryStep, TrioStageProps } from '../types';
import './encounter-panel.css';

type EncounterView = 'active' | 'draft' | 'simulation' | 'history';
type PlaybackContext = 'baseline' | 'draft' | 'verify' | 'active' | 'simulation' | 'history';

type EncounterPanelProps = TrioStageProps & {
  objectId: StoryStep;
  onEncounterRoundComplete?: (outcome: EncounterOutcome, context: PlaybackContext) => void;
};

function viewAtLevel(level: number): EncounterView {
  if (level <= 3) return 'history';
  if (level === 4 || level === 5) return 'draft';
  if (level === 6) return 'active';
  return 'simulation';
}

function resultSummary(outcome: ReturnType<typeof runEncounter>) {
  const shield = outcome.events.find((event) => event.actorId === 'mira');
  const attack = outcome.events.find((event) => event.actorId === 'goblin');
  return {
    pip: outcome.hp.pip,
    shield: shield?.label ?? 'ยังไม่ตั้งโล่',
    attack: attack?.label ?? 'ยังไม่มีการโจมตี',
  };
}

function RuleEditor({
  rule,
  disabled,
  onChange,
  onOpen,
}: {
  rule: EncounterRule;
  disabled: boolean;
  onChange: (next: Partial<EncounterRule>) => void;
  onOpen?: () => void;
}) {
  return (
    <details className="encounter-panel__details" onToggle={(event) => { if (event.currentTarget.open) onOpen?.(); }}>
      <summary>แก้กติกาชุดนี้</summary>
      <label>
        <input
          type="checkbox"
          aria-label="โล่ช่วยเพื่อน"
          disabled={disabled}
          checked={rule.allyShield}
          onChange={(event) => onChange({ allyShield: event.currentTarget.checked })}
        />
        โล่ช่วยเพื่อนที่ถูกโจมตี
      </label>
      <label>
        ลดความเสียหาย
        <input
          aria-label="ลดความเสียหาย HP"
          disabled={disabled}
          type="number"
          min="0"
          max="6"
          value={rule.shieldReduction}
          onChange={(event) => {
            const value = event.currentTarget.valueAsNumber;
            if (Number.isInteger(value) && value >= 0 && value <= 6) onChange({ shieldReduction: value });
          }}
        />
        HP
      </label>
    </details>
  );
}

function StableQuestEncounter(props: EncounterPanelProps) {
  const { snapshot, guided, step, phase, paused, speed = 1 } = props;
  const root = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  const [manualView, setManualView] = useState<EncounterView>(() => viewAtLevel(snapshot.level));
  const [manualReplayKeys, setManualReplayKeys] = useState<Partial<Record<EncounterView, string>>>({});
  const wasGuided = useRef(guided);
  const lastGuidedReplayKey = useRef<string | null>(null);

  const visible = useContext(SurfaceVisibility) && props.surfaceVisible !== false;
  const activeRule = snapshot.active.quest.encounter ?? BASELINE_ENCOUNTER_RULE;
  const draftRule = snapshot.draft.quest.encounter ?? activeRule;
  const simulationRule = snapshot.simulation.quest.encounter ?? activeRule;
  const guidedStage: EncounterView | 'notice' | 'teach' | 'verify' | 'approval' =
    snapshot.level <= 2 ? 'history'
      : snapshot.level === 3 ? 'notice'
        : snapshot.level === 4 ? 'teach'
          : snapshot.level === 5 ? 'verify'
            : snapshot.level === 6 ? 'approval'
              : 'simulation';
  const guidedReplayKey = guidedStage === 'verify' ? 'guided:verify'
    : guidedStage === 'approval' ? 'guided:approved-round'
      : guidedStage === 'simulation' ? 'guided:simulation'
        : guidedStage === 'teach' ? 'guided:draft' : 'guided:baseline';
  const switchingToManual = wasGuided.current && !guided;
  const takeoverView = switchingToManual ? viewAtLevel(snapshot.level) : manualView;

  useEffect(() => {
    if (wasGuided.current && !guided) {
      const nextView = viewAtLevel(snapshot.level);
      setManualView(nextView);
      const replayKey = lastGuidedReplayKey.current;
      if (replayKey) setManualReplayKeys((current) => ({ ...current, [nextView]: replayKey }));
    } else if (guided) {
      lastGuidedReplayKey.current = guidedReplayKey;
    }
    wasGuided.current = guided;
  }, [guided, snapshot.level, guidedReplayKey]);

  useEffect(() => {
    const shell = root.current?.closest('[data-testid=materialize-surface]');
    const update = () => setReady(!shell || shell.getAttribute('data-state') === 'ready');
    update();
    if (!shell) return undefined;
    const observer = new MutationObserver(update);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-state'] });
    return () => observer.disconnect();
  }, []);

  const view = guided ? guidedStage === 'notice' ? 'history'
    : guidedStage === 'teach' || guidedStage === 'verify' ? 'draft'
      : guidedStage === 'approval' ? 'active'
        : guidedStage === 'simulation' ? 'simulation' : 'history'
    : takeoverView;
  const rule = view === 'draft' ? draftRule
    : view === 'simulation' ? simulationRule
      : view === 'history' ? BASELINE_ENCOUNTER_RULE : activeRule;
  const mode = guided
    ? guidedStage === 'verify' ? 'verify'
      : guidedStage === 'teach' ? 'draft'
        : guidedStage === 'simulation' ? 'simulate'
          : guidedStage === 'approval' ? 'active' : 'before'
    : view === 'history' ? 'before' : view === 'draft' ? 'draft' : view === 'simulation' ? 'simulate' : 'active';
  const autoPlay = ready && guided && visible && !paused && phase === 'reading'
    && ((guidedStage === 'history' && snapshot.level === 2 && step === 'minimal') || guidedStage === 'verify');
  const gamePaused = !ready || !visible || (guided && (paused || phase !== 'reading'));
  const replayKey = guided
    ? guidedReplayKey
    : switchingToManual
      ? lastGuidedReplayKey.current ?? `manual:${view}`
      : manualReplayKeys[view] ?? `manual:${view}`;
  const valid = canApprove('quest', snapshot.draft, snapshot.evaluation);
  const freshEvaluation = snapshot.evaluation?.fingerprint === rulesFingerprint('quest', snapshot.draft);
  const canApproveDraft = valid && freshEvaluation && !snapshot.approved;
  const baselineRecord = snapshot.events.find((event) => event.kind === 'run' && event.title === 'รอบตั้งต้นที่เล่นจริง');
  const latestTest = [...snapshot.events].reverse().find((event) => event.kind === 'test');
  const activeOutcome = resultSummary(runEncounter(activeRule, [...ENCOUNTER_TRACE], activeRule.allyShield ? 'pip' : 'mira'));
  const simulationOutcome = resultSummary(runEncounter(simulationRule, [...ENCOUNTER_TRACE], simulationRule.allyShield ? 'pip' : 'mira'));
  const simulationFingerprint = rulesFingerprint('quest', { ...snapshot.active, quest: { ...snapshot.active.quest, encounter: simulationRule } });
  const simulationPlayed = snapshot.events.some((event) => event.kind === 'simulation' && event.title === 'ทดลอง Simulation ที่เล่นจริง' && event.detail.includes(simulationFingerprint));

  const setView = (next: EncounterView) => {
    props.onInspect?.('minimal');
    setManualView(next);
  };
  const changeRule = (next: Partial<EncounterRule>) => {
    if (guided) return;
    props.onInspect?.('minimal');
    const book = view === 'simulation' ? snapshot.simulation : snapshot.draft;
    const updated = { ...book, quest: { ...book.quest, encounter: { ...rule, ...next } } };
    if (view === 'simulation') props.onSimulationChange(updated);
    else props.onDraftChange(updated);
  };
  const approveDraft = () => {
    if (!canApproveDraft) return;
    setManualView('active');
    props.onApprove();
  };

  const historyEvent = baselineRecord;
  const historyLine = historyEvent
    ? historyEvent.detail
    : 'ยังไม่มีรอบตั้งต้นที่เล่นจบและบันทึกไว้';
  const contextLabel = guided
    ? guidedStage === 'notice' ? 'รอบตั้งต้น · กติกาเดิม'
      : guidedStage === 'teach' ? 'ร่างกติกา · ยังไม่ใช้งานจริง'
        : guidedStage === 'verify' ? 'เล่นซ้ำจริง · เปลี่ยนเฉพาะกฎโล่'
          : guidedStage === 'approval' ? `กฎ Active · v${snapshot.version}`
            : guidedStage === 'simulation' ? 'Simulation แยก · ยังไม่เปลี่ยน Active'
              : 'รอบตั้งต้น · กติกาเดิม'
    : ({ active: `Active · v${snapshot.version}`, draft: 'Draft · ยังไม่ใช้งานจริง', simulation: 'Simulation · แยกจาก Active', history: 'Baseline history · หลักฐานเดิม' } as const)[view];
  const contextCopy = guided
    ? guidedStage === 'notice' ? 'รอบเดิม: โล่คุ้มกัน Mira · Pip เสียเต็ม'
      : guidedStage === 'teach' ? 'เปิดเป้าหมายให้โล่ช่วย Pip แล้ว · ลด 2 HP · เลือกก่อนเริ่ม'
        : guidedStage === 'verify' ? 'เล่นซ้ำ d20 [14, 12, 16] · HP และผลบนกระดานมาจากรอบจริง'
          : guidedStage === 'approval' ? `v${snapshot.version} เริ่มใช้กับรอบใหม่ · รอบตั้งต้นยังเก็บไว้`
            : guidedStage === 'simulation' ? simulationPlayed ? 'ตัวเลขด้านบนคำนวณแยกไว้ · กระดานแสดงผล Simulation ที่เล่นจริง' : 'ตัวเลขคำนวณแยกไว้ · กระดานเริ่มต้นจนกดเล่น'
              : snapshot.level === 2 ? 'เล่นกับเพื่อนใหม่หนึ่งรอบ · เลือกเป้าหมายโล่ก่อนเริ่ม'
                : 'รอบตั้งต้นเดิม · ประวัติอ่านได้แต่แก้ไม่ได้'
    : view === 'active' ? 'HP บนกระดานเป็นผลจริงของรอบ Active'
      : view === 'draft' ? 'แก้ Draft แล้วตรวจและอนุมัติได้เมื่อผลตรงกับร่างปัจจุบัน'
        : view === 'simulation' ? simulationPlayed ? 'ค่าด้านบนคำนวณแยก · กระดานแสดงรอบ Simulation ที่เล่นจริง' : 'ค่าคาดการณ์แยกจาก Active · กดเล่นเพื่อเริ่มรอบ Simulation จริง'
          : 'ผลตั้งต้นเป็นหลักฐานเดิม · กระดานด้านล่างคือรอบเล่นซ้ำใหม่';

  if (props.objectId !== 'minimal') {
    return <section className="encounter-panel" data-testid={`encounter-panel-${props.objectId}`}>
      <TrioDeliverables snapshot={snapshot} />
      <p>เพื่อนต้องลองความยากจริงก่อน · บอทช่วยตรวจผลกติกา ยังตัดสินความสนุกแทนคนไม่ได้</p>
      <button className="trio-button" disabled={guided} onClick={props.onHandoff}>ส่งต่อให้คนลองเล่น</button>
    </section>;
  }

  return (
    <section ref={root} className="encounter-panel encounter-panel--stable" data-testid="encounter-panel-stable" data-story-stage={guided ? guidedStage : view}>
      <header className="encounter-panel__context">
        <span className="encounter-panel__eyebrow">{contextLabel}</span>
        <p>{contextCopy}</p>
      </header>

      {!guided && (
        <nav className="encounter-panel__views" aria-label="เลือกสถานะเกมที่ต้องการดู">
          <span className="encounter-panel__views-label">มุมมอง</span>
          {([
            ['active', 'Active'], ['draft', 'Draft'], ['simulation', 'Simulation'], ['history', 'ประวัติเดิม'],
          ] as const).map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id} onClick={() => setView(id)}>{label}</button>
          ))}
        </nav>
      )}

      {guidedStage === 'approval' && guided && (
        <span className="encounter-panel__approved-pill" data-testid="encounter-approval">
          {snapshot.approved ? `✓ v${snapshot.version} Active` : 'รอยืนยันกฎที่ตรวจแล้ว'}
        </span>
      )}

      {view === 'history' && !guided && (
        <aside className="encounter-panel__history" data-testid="encounter-history">
          <span className="encounter-panel__history-lock">บันทึกเดิม · อ่านอย่างเดียว</span>
          <strong>{historyEvent?.title ?? 'รอบตั้งต้น'}</strong>
          <p>{historyLine}</p>
          {!historyEvent && <small>ไม่มีผลที่เล่นจบแล้ว · การเล่นด้านล่างจะเป็นรอบใหม่ ไม่เขียนทับประวัติ</small>}
        </aside>
      )}

      {view === 'simulation' && (
        <div className="encounter-panel__estimate" aria-label="ผลคาดการณ์จากการคำนวณ แยกจากผลเล่นจริง">
          <span className="encounter-panel__estimate-note">ค่าคำนวณจาก d20 [{ENCOUNTER_TRACE.join(', ')}] · แยกจากผลที่เล่นจริง</span>
          <div className="encounter-panel__estimate-grid">
            <article><span>Active · กฎที่ยืนยันแล้ว</span><strong>Pip {activeOutcome.pip}/10 HP</strong><small>{activeOutcome.shield} · {activeOutcome.attack}</small></article>
            <article><span>Simulation · กฎแยก</span><strong>Pip {simulationOutcome.pip}/10 HP</strong><small>{simulationOutcome.shield} · {simulationOutcome.attack}</small></article>
          </div>
        </div>
      )}

      <div className={`encounter-panel__board encounter-panel__board--${view}`} onClick={(event) => {
        if (guided || !(event.target instanceof Element) || !event.target.closest('button')) return;
        // Keep the actors and current result together after pressing a control
        // near the bottom of a tall manual panel.
        const scroller = root.current?.closest<HTMLElement>('.trio-stage__object');
        const field = root.current?.querySelector<HTMLElement>('.encounter-game__field');
        if (!scroller || !field) return;
        const box = scroller.getBoundingClientRect();
        const scale = box.width / scroller.clientWidth || 1;
        scroller.scrollTo({ top: Math.max(0, scroller.scrollTop + (field.getBoundingClientRect().top - box.top) / scale - 8), behavior: 'auto' });
      }}>
        <EncounterGame
          rule={rule}
          mode={mode}
          autoPlay={autoPlay}
          paused={gamePaused}
          visible={visible}
          speed={speed}
          sessionKey="quest:stable-encounter"
          replayKey={replayKey}
          onFeedback={props.onFeedback}
          onRoundComplete={(outcome) => props.onEncounterRoundComplete?.(outcome, guided
            ? guidedStage === 'verify' ? 'verify'
              : guidedStage === 'teach' ? 'draft'
                : guidedStage === 'simulation' ? 'simulation'
                  : guidedStage === 'approval' ? 'active' : 'baseline'
            : view)}
        />
      </div>

      {!guided && (view === 'draft' || view === 'simulation') && (
        <>
          <RuleEditor rule={rule} disabled={false} onChange={changeRule} onOpen={() => props.onInspect?.('minimal')} />
          {view === 'draft' && (
            <div className="encounter-panel__review-actions">
              <div className="encounter-panel__review-status" role="status">
                {freshEvaluation
                  ? valid ? 'ผลตรวจนี้ตรงกับ Draft ปัจจุบันและผ่านครบ' : 'Draft ปัจจุบันมีกรณีที่ยังไม่ผ่าน'
                  : 'ยังไม่มีผลตรวจที่ตรงกับ Draft ปัจจุบัน'}
              </div>
              <button type="button" className="trio-button" onClick={props.onVerify}>ตรวจ Draft ปัจจุบัน</button>
              <button type="button" className="trio-button trio-button--primary" disabled={!canApproveDraft} onClick={approveDraft}>อนุมัติ Draft ที่ผ่าน</button>
              {latestTest && <small>ผลล่าสุด: {latestTest.detail}</small>}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function LegacyQuestEncounter(props: EncounterPanelProps) {
  const { snapshot, objectId, guided, step, phase, paused, speed = 1 } = props;
  const root = useRef<HTMLElement>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const shell = root.current?.closest('[data-testid=materialize-surface]');
    const update = () => setReady(!shell || shell.getAttribute('data-state') === 'ready');
    update();
    if (!shell) return undefined;
    const observer = new MutationObserver(update);
    observer.observe(shell, { attributes: true, attributeFilter: ['data-state'] });
    return () => observer.disconnect();
  }, []);

  const visible = useContext(SurfaceVisibility) && props.surfaceVisible !== false;
  const live = snapshot.active.quest.encounter ?? BASELINE_ENCOUNTER_RULE;
  const draft = snapshot.draft.quest.encounter ?? live;
  const simulation = snapshot.simulation.quest.encounter ?? live;
  const focused = step === objectId;
  const rule = objectId === 'minimal' ? BASELINE_ENCOUNTER_RULE : objectId === 'teach' || objectId === 'verify' ? draft : objectId === 'simulate' ? simulation : live;
  const mode = objectId === 'minimal' ? 'before' : objectId === 'teach' ? 'draft' : objectId === 'verify' ? 'verify' : objectId === 'simulate' ? 'simulate' : 'active';
  const valid = canApprove('quest', snapshot.draft, snapshot.evaluation);
  const stale = snapshot.evaluation?.fingerprint !== rulesFingerprint('quest', snapshot.draft);
  const change = (next: Partial<EncounterRule>) => {
    if (guided) return;
    props.onInspect?.(objectId);
    const book = objectId === 'simulate' ? snapshot.simulation : snapshot.draft;
    const updated = { ...book, quest: { ...book.quest, encounter: { ...rule, ...next } } };
    if (objectId === 'simulate') props.onSimulationChange(updated);
    else props.onDraftChange(updated);
  };

  if (objectId === 'handoff') return <section className="encounter-panel"><TrioDeliverables snapshot={snapshot}/><p>เพื่อนต้องลองความยากจริงก่อน · บอทช่วยตรวจผลกติกา ยังตัดสินความสนุกแทนคนไม่ได้</p><button className="trio-button" disabled={guided} onClick={props.onHandoff}>ส่งต่อให้คนลองเล่น</button></section>;
  if (objectId === 'notice') return <section className="encounter-panel encounter-panel--notice"><span className="encounter-panel__eyebrow">หลังจบตาแรก</span><h3>ยกโล่แล้ว ทำไม Pip ยังเจ็บ?</h3><p>โล่เดิมป้องกันเฉพาะ Mira ผู้ถือโล่ ก๊อบลินโจมตี Pip จึงยังโดนเต็มจำนวน</p><div className="encounter-panel__change"><span>กันให้ตัวเอง</span><span aria-hidden="true">→</span><strong>ช่วยเพื่อนด้วย −2 HP</strong></div><button className="trio-button" onClick={() => props.onInspect?.('minimal')}>ย้อนดูตาที่เพิ่งเล่น</button></section>;
  if (objectId === 'approve') return <section className="encounter-panel" data-testid="encounter-approval"><span className="encounter-panel__eyebrow">กฎสำหรับรอบใหม่ · v{snapshot.version}</span><h3>{snapshot.approved ? 'โล่ช่วยเพื่อนได้แล้ว' : 'รอยืนยันกฎที่ลองแล้ว'}</h3><p>ลดความเสียหาย {live.shieldReduction} HP · {live.allyShield ? 'ช่วยเพื่อน' : 'เฉพาะคนถือ'} · ผลของรอบเดิมยังคงเดิม</p>{!guided && <button className="trio-button trio-button--primary" disabled={!valid} onClick={props.onApprove}>ยืนยันกฎที่ผ่านการลอง</button>}</section>;

  const stageView = objectId === 'minimal' ? 'baseline' : objectId;
  return <section ref={root} className="encounter-panel" data-testid={`encounter-panel-${objectId}`}>
    <div className="encounter-panel__intro"><span className="encounter-panel__eyebrow">{objectId === 'minimal' ? 'ลองเล่นตาแรก' : objectId === 'teach' ? 'ร่างทดลอง · ยังไม่ใช้จริง' : objectId === 'verify' ? 'เล่นซ้ำเพื่อตรวจผล' : 'ชุดทดลองแยกจากกฎที่ใช้อยู่'}</span><p>{objectId === 'verify' ? 'แต้มเดิม การกระทำเดิม เปลี่ยนเฉพาะกฎโล่' : objectId === 'simulate' ? 'ลองลด 1 HP แล้วดูผล · กฎที่ใช้อยู่ไม่เปลี่ยน' : objectId === 'teach' ? 'ดูโล่ช่วย Pip บนกระดาน แล้วค่อยเปิดปรับรายละเอียด' : 'คุณเล่น Mira · Nina บอทเล่น Pip · ก๊อบลินตอบโต้'}</p></div>
    <EncounterGame rule={rule} mode={mode} autoPlay={ready && guided && focused && phase === 'reading'} paused={!ready || (guided && (paused || !focused || phase !== 'reading'))} visible={visible} speed={speed} replayKey={`${objectId}:${objectId === 'minimal' ? 1 : snapshot.version}`} onFeedback={props.onFeedback} onRoundComplete={(outcome) => props.onEncounterRoundComplete?.(outcome, stageView === 'baseline' ? 'baseline' : stageView === 'verify' ? 'verify' : stageView === 'simulate' ? 'simulation' : stageView === 'teach' ? 'draft' : 'active')}/>
    {(objectId === 'teach' || objectId === 'simulate') && <RuleEditor rule={rule} disabled={guided} onChange={change} onOpen={() => props.onInspect?.(objectId)}/>}
    {objectId === 'verify' && <details className="encounter-panel__details" onToggle={(event) => { if (event.currentTarget.open) props.onInspect?.(objectId); }}><summary>{stale ? 'กฎเปลี่ยนแล้ว · ต้องตรวจใหม่' : 'ดูกรณีทดสอบเพิ่มเติม'}</summary><button className="trio-button" disabled={guided} onClick={props.onVerify}>ลองตรวจร่างนี้</button><ul>{snapshot.evaluation?.cases.map((test) => <li key={test.id}><strong>{test.passed ? '✓' : '×'} {test.label}</strong><span>{test.input}</span><span>คาด: {test.expected}</span><span>ได้: {test.actual}</span></li>)}</ul></details>}
  </section>;
}

export default function EncounterPanel(props: EncounterPanelProps) {
  if (props.objectId === 'minimal' && props.snapshot.active.quest.encounter) return <StableQuestEncounter {...props} />;
  return <LegacyQuestEncounter {...props} />;
}
