import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ChangeEvent, type SyntheticEvent } from 'react';
import { Activity, ArrowDownUp, ArrowLeft, ArrowRight, Download, Focus, Pause, Play, RotateCcw, Table2 } from 'lucide-react';
import { planForWorkspace } from '../runtime';
import { PracticeRuntime } from './practice';
import { PRACTICE_SCENARIOS } from './scenarios';
import { ConfirmDialog, UploadCapabilityProvider } from '../ui/WorkbenchShared';
import { PracticeClockProvider } from '../ui/PracticeClock';
import { TableSurface } from '../ui/TableSurface';
import '../ui/tabletop.css';
import './interactive-demo.css';

const visibleScenarioIds = ['invoice-rules', 'teaching-physics', 'encounter-shield'] as const;
const scenarios = PRACTICE_SCENARIOS.filter((scenario) => visibleScenarioIds.includes(scenario.id as typeof visibleScenarioIds[number]));

const modeLabels: Record<string, string> = {
  ready: 'พร้อมเริ่ม',
  playing: 'กำลังเล่นเดโม',
  paused: 'หยุดชั่วคราว',
  manual: 'ลองแก้เอง',
  complete: 'เล่นครบแล้ว',
  blocked: 'หยุดเพื่อตรวจสอบ',
};

const actorNames: Record<string, string> = {
  'practice-owner': 'คุณอ้อม · เจ้าของ',
  'practice-teacher': 'ครูเมย์ · ครู',
  'practice-learner-1': 'ฟ้า · ผู้เรียน 1',
  'practice-learner-2': 'ต้น · ผู้เรียน 2',
  'practice-dm': 'DM · ผู้ดำเนินเกม',
  'practice-mira': 'Mira · ผู้เล่น',
  'practice-pip': 'Pip · ผู้เล่น',
};

const actorChoices: Record<string, { id: string; label: string }[]> = {
  invoice: [{ id: 'practice-owner', label: actorNames['practice-owner'] }],
  teaching: [
    { id: 'practice-teacher', label: actorNames['practice-teacher'] },
    { id: 'practice-learner-1', label: actorNames['practice-learner-1'] },
    { id: 'practice-learner-2', label: actorNames['practice-learner-2'] },
  ],
  encounter: [
    { id: 'practice-dm', label: actorNames['practice-dm'] },
    { id: 'practice-mira', label: actorNames['practice-mira'] },
    { id: 'practice-pip', label: actorNames['practice-pip'] },
  ],
};

const manualCommandLabels: Record<string, string> = {
  'invoice.saveRun': 'บันทึกผลตรวจ',
  'invoice.reviewSource': 'ตรวจหลักฐาน',
  'evolve.propose': 'เสนอร่างกติกา',
  'evolve.simulate': 'จำลองผล',
  'evolve.validate': 'ตรวจร่างกติกา',
  'evolve.approve': 'อนุมัติร่าง',
  'evolve.activate': 'เปิดใช้กติกา',
  'evolve.rollback': 'ย้อนกลับกติกา',
  'teaching.setParameters': 'เปลี่ยนค่าบทเรียน',
  'teaching.setRepresentation': 'เปลี่ยนมุมมองบทเรียน',
  'teaching.answer': 'ส่งคำตอบ',
  'teaching.saveNote': 'บันทึกหมายเหตุครู',
  'encounter.declareHit': 'ประกาศการโจมตี',
  'encounter.shield': 'ยกโล่ป้องกัน',
  'encounter.resolve': 'ตัดสินผลการโจมตี',
  'encounter.endTurn': 'จบเทิร์น',
  'encounter.pause': 'พักการเผชิญหน้า',
  'encounter.resume': 'เล่นการเผชิญหน้าต่อ',
  'encounter.saveNote': 'บันทึกหมายเหตุ DM',
};

type SurfaceMode = 'canvas' | 'focus';
type EditMode = 'use' | 'arrange';

function focusTargetFor(kind: string, command: string, role: string): string | null {
  if (command.startsWith('evolve.')) {
    if (command === 'evolve.activate') {
      if (kind === 'invoice') return 'tt-invoice-table-heading';
      if (kind === 'encounter') return 'tt-action-title';
    }
    return 'tt-lifecycle-title';
  }

  if (kind === 'invoice') {
    if (command === 'invoice.reviewSource') return 'tt-evidence-section';
    if (command === 'invoice.sample' || command === 'invoice.saveRun') return 'tt-invoice-table-heading';
    return null;
  }

  if (kind === 'teaching') {
    if (command === 'teaching.setParameters') return role === 'learner' ? 'tt-local-title' : 'tt-lesson-controls-title';
    if (command === 'teaching.setRepresentation') return 'tt-view-controls-title';
    if (command === 'teaching.answer') return 'tt-answer-title';
    if (command === 'teaching.saveNote') return 'tt-note-title';
    return null;
  }

  if (kind === 'encounter') return command === 'encounter.saveNote' ? 'tt-dm-note-title' : 'tt-action-title';
  return null;
}

export default function InteractiveDemo() {
  const [runtime] = useState(() => new PracticeRuntime('invoice-rules'));
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const readSnapshot = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, readSnapshot, readSnapshot);
  const currentScenario = snapshot.scenario;
  const [surface, setSurface] = useState<SurfaceMode>(() => window.matchMedia('(max-width: 760px)').matches ? 'focus' : 'canvas');
  const [editMode, setEditMode] = useState<EditMode>('use');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [focusSourceIds, setFocusSourceIds] = useState<string[]>([]);
  const [autoFocusRequest, setAutoFocusRequest] = useState<{ eventId: string; targetId: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [restartTarget, setRestartTarget] = useState<string | null | undefined>(undefined);
  const inspectorScrollRef = useRef<HTMLDivElement>(null);
  const disposeTimerRef = useRef<number | undefined>(undefined);
  const autoFocusFrameRef = useRef<number | undefined>(undefined);
  const autoFocusTimerRef = useRef<number | undefined>(undefined);
  const autoFocusElementRef = useRef<HTMLElement | null>(null);
  const lastAutoEventRef = useRef<string | null>(null);

  useEffect(() => {
    if (disposeTimerRef.current !== undefined) window.clearTimeout(disposeTimerRef.current);
    return () => {
      // StrictMode replays effects immediately; defer disposal so the second setup can cancel it.
      disposeTimerRef.current = window.setTimeout(() => runtime.dispose(), 0);
    };
  }, [runtime]);

  const compiled = useMemo(() => {
    try { return { plan: planForWorkspace(snapshot.view), error: null as string | null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'ตารางทดลองนี้ยังเปิดไม่ได้' }; }
  }, [snapshot.view]);

  const onCommand = useCallback(async (type: string, payload: unknown) => {
    setBusy(type);
    setNotice(null);
    try { return await runtime.command(type, payload); }
    catch (error) {
      setNotice(error instanceof Error ? error.message : 'คำสั่งนี้ยังทำไม่สำเร็จ');
      return null;
    } finally { setBusy(null); }
  }, [runtime]);

  const onUpload = useCallback(async () => {
    throw new Error('โต๊ะทดลองนี้ใช้ไฟล์ตัวอย่างที่เตรียมไว้ และปิดการอัปโหลดไฟล์');
  }, []);

  const onExport = useCallback(async () => {
    setNotice('รายงานจากโต๊ะจริงปิดไว้ในโหมดทดลอง ดาวน์โหลดประวัติการฝึกซ้อมได้จากแถบด้านบน');
  }, []);

  const selectCanvasNode = useCallback((nodeId: string | null) => {
    setSelectedNodeId(nodeId);
    if (nodeId && window.matchMedia('(max-width: 760px)').matches) setSurface('focus');
  }, []);

  const focusEvidence = useCallback((sourceIds: string[]) => {
    if (inspectorScrollRef.current) setSurface('focus');
    setFocusSourceIds(sourceIds);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => document.getElementById('tt-evidence-section')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, []);

  const backFromEvidence = useCallback(() => {
    setFocusSourceIds([]);
    window.requestAnimationFrame(() => inspectorScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  }, []);

  const beginTakeover = useCallback(() => {
    runtime.takeOver();
    setNotice('หยุดเดโมแล้ว โต๊ะนี้เป็นของคุณแก้ไขต่อได้ การเล่นอัตโนมัติจะไม่กลับมาทับการเปลี่ยนแปลง');
  }, [runtime]);

  const captureWorkbenchInput = useCallback((event: SyntheticEvent<HTMLElement>) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    if (!target.closest('.tt-inspector-panel, .tt-canvas-node__body')) return;
    const control = target.closest('input, select, textarea, button, [contenteditable="true"]');
    if (!control && event.type !== 'submit') return;
    if (event.type === 'keydown') {
      const key = (event.nativeEvent as KeyboardEvent).key;
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(key)) return;
      if (control?.matches('button') && key !== 'Enter' && key !== ' ') return;
    }
    if (snapshot.mode !== 'manual') beginTakeover();
  }, [beginTakeover, snapshot.mode]);

  const chooseScenario = (event: ChangeEvent<HTMLSelectElement>) => {
    const scenarioId = event.currentTarget.value;
    if (scenarioId === currentScenario.id) return;
    if (snapshot.mode === 'manual') {
      setRestartTarget(scenarioId);
      return;
    }
    runtime.restart(scenarioId);
    setSelectedNodeId(null);
    setFocusSourceIds([]);
    setNotice(null);
  };

  const confirmRestart = () => {
    if (restartTarget === null) runtime.restart();
    else if (restartTarget !== undefined) runtime.restart(restartTarget);
    setSelectedNodeId(null);
    setFocusSourceIds([]);
    setNotice(null);
    setRestartTarget(undefined);
  };

  const restart = () => {
    if (snapshot.mode === 'manual') setRestartTarget(null);
    else {
      runtime.restart();
      setSelectedNodeId(null);
      setFocusSourceIds([]);
      setNotice(null);
    }
  };

  const selectActor = (event: ChangeEvent<HTMLSelectElement>) => {
    if (snapshot.mode === 'playing') beginTakeover();
    runtime.selectActor(event.currentTarget.value);
  };

  const downloadHistory = () => {
    const blob = new Blob([runtime.exportHistory()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'tabletop-practice-history.json';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const completed = snapshot.stepIndex;
  const nextStep = currentScenario.steps[Math.min(completed, currentScenario.steps.length - 1)];
  const lastEvent = snapshot.history.at(-1);
  const canPlay = snapshot.mode === 'ready' || snapshot.mode === 'paused';
  const canStep = canPlay && busy === null;

  useEffect(() => {
    if (snapshot.history.length === 0) lastAutoEventRef.current = null;
  }, [snapshot.history.length]);

  useEffect(() => {
    if (!lastEvent?.step || lastAutoEventRef.current === lastEvent.id) return;
    lastAutoEventRef.current = lastEvent.id;
    if (runtime.getSnapshot().mode === 'manual') return;
    const targetId = focusTargetFor(currentScenario.kind, lastEvent.type, snapshot.view.actor.role);
    if (!targetId) return;
    setSurface('focus');
    setAutoFocusRequest({ eventId: lastEvent.id, targetId });
  }, [lastEvent?.id, currentScenario.kind, snapshot.view.actor.role, runtime]);

  useEffect(() => {
    if (!autoFocusRequest || surface !== 'focus' || runtime.getSnapshot().mode === 'manual') return;
    autoFocusFrameRef.current = window.requestAnimationFrame(() => {
      autoFocusFrameRef.current = undefined;
      if (runtime.getSnapshot().mode === 'manual') return;
      const container = inspectorScrollRef.current;
      // Canvas and inspector can contain matching control IDs; follow the visible
      // inspector instance rather than the hidden canvas copy.
      const target = container?.querySelector<HTMLElement>(`#${autoFocusRequest.targetId}`);
      if (!container || !target) return;

      const rect = target.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const top = container.scrollTop + rect.top - containerRect.top - 12;
      // Finish the movement immediately so a takeover never inherits a running scroll.
      container.scrollTo({ top: Math.max(0, top), behavior: 'auto' });

      if (autoFocusTimerRef.current !== undefined) window.clearTimeout(autoFocusTimerRef.current);
      autoFocusElementRef.current?.classList.remove('tt-practice-auto-focus');
      const section = target.matches('.tt-section') ? target : target.closest('.tt-section');
      const highlight = section instanceof HTMLElement ? section : target;
      highlight.classList.add('tt-practice-auto-focus');
      autoFocusElementRef.current = highlight;
      autoFocusTimerRef.current = window.setTimeout(() => {
        highlight.classList.remove('tt-practice-auto-focus');
        if (autoFocusElementRef.current === highlight) autoFocusElementRef.current = null;
        autoFocusTimerRef.current = undefined;
      }, 1600);
    });

    return () => {
      if (autoFocusFrameRef.current !== undefined) {
        window.cancelAnimationFrame(autoFocusFrameRef.current);
        autoFocusFrameRef.current = undefined;
      }
      if (autoFocusTimerRef.current !== undefined) {
        window.clearTimeout(autoFocusTimerRef.current);
        autoFocusTimerRef.current = undefined;
      }
      autoFocusElementRef.current?.classList.remove('tt-practice-auto-focus');
      autoFocusElementRef.current = null;
    };
  }, [autoFocusRequest, surface, runtime]);

  useEffect(() => () => {
    if (autoFocusFrameRef.current !== undefined) window.cancelAnimationFrame(autoFocusFrameRef.current);
    if (autoFocusTimerRef.current !== undefined) window.clearTimeout(autoFocusTimerRef.current);
    autoFocusElementRef.current?.classList.remove('tt-practice-auto-focus');
  }, []);

  const startPlayback = () => {
    setSurface('focus');
    runtime.play();
  };

  const advanceOneStep = () => {
    setSurface('focus');
    void runtime.next();
  };

  return (
    <UploadCapabilityProvider enabled={false} reason="ไฟล์ถูกปิดไว้ในโต๊ะทดลองนี้">
      <div className="tt-app tt-practice-app" data-testid="interactive-auto-demo">
        <header className="tt-practice-header">
          <a className="tt-brand" href="/" aria-label="กลับไปหน้า Tabletop"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a>
          <span className="tt-practice-header__rule" aria-hidden="true" />
          <span className="tt-practice-header__title"><small>โต๊ะทดลองที่เล่นและแก้ไขได้</small><strong>{currentScenario.title}</strong></span>
          <span className="tt-practice-header__spacer" />
          <a className="tt-practice-header__real" href="/">เปิดโต๊ะทำงานจริง <ArrowRight size={13} /></a>
        </header>

        <section className="tt-practice-toolbar" aria-label="การเล่นโต๊ะทดลอง">
          <div className="tt-practice-toolbar__selects">
            <label>เลือกโจทย์
              <select aria-label="เลือกโจทย์" value={currentScenario.id} onChange={chooseScenario}>
                {scenarios.map((scenario) => <option key={scenario.id} value={scenario.id}>{scenario.title}</option>)}
              </select>
            </label>
            <label>ลองเป็น
              <select aria-label="ลองเป็น" value={snapshot.view.actor.actorId} onChange={selectActor}>
                {actorChoices[currentScenario.kind].map((actor) => <option key={actor.id} value={actor.id}>{actor.label}</option>)}
              </select>
            </label>
          </div>

          <div className="tt-practice-toolbar__transport" role="group" aria-label="ควบคุมเดโม">
            {snapshot.mode === 'playing' ? (
              <button className="tt-practice-button tt-practice-button--quiet" type="button" onClick={() => runtime.pause()}><Pause size={15} /> หยุดเดโม</button>
            ) : (
              <button className="tt-practice-button tt-practice-button--primary" type="button" disabled={!canPlay || busy !== null} onClick={startPlayback}><Play size={15} fill="currentColor" /> เล่นเดโม</button>
            )}
            <button className="tt-practice-button tt-practice-button--quiet" type="button" disabled={!canStep} onClick={advanceOneStep}><ArrowRight size={15} /> ทำขั้นถัดไป</button>
            <button className={`tt-practice-button ${snapshot.mode === 'manual' ? 'tt-practice-button--manual' : 'tt-practice-button--quiet'}`} type="button" disabled={snapshot.mode === 'manual'} onClick={beginTakeover}><Focus size={15} /> หยุดแล้วลองเอง</button>
            <button className="tt-practice-icon-button" type="button" onClick={restart} aria-label="เริ่มโต๊ะทดลองใหม่" title="เริ่มโต๊ะทดลองใหม่"><RotateCcw size={15} /></button>
          </div>

          <div className="tt-practice-toolbar__status">
            <span data-testid="practice-mode" data-mode={snapshot.mode} className={`tt-practice-mode tt-practice-mode--${snapshot.mode}`} role="status"><i aria-hidden="true" />{modeLabels[snapshot.mode] ?? 'โต๊ะทดลอง'}</span>
            <span data-testid="practice-step-counter" className="tt-practice-progress" aria-live="polite">ทำแล้ว {completed} / {currentScenario.steps.length}</span>
          </div>
        </section>

        <section className="tt-practice-story" aria-label="โจทย์และขั้นตอนปัจจุบัน">
          <div className="tt-practice-story__persona"><span className="tt-practice-story__avatar" aria-hidden="true">{currentScenario.persona.slice(0, 1)}</span><div><small>ผู้ร่วมโต๊ะ</small><strong>{currentScenario.persona}</strong></div></div>
          <div className="tt-practice-story__goal"><small>เป้าหมาย</small><p>{currentScenario.goal}</p></div>
          <div className="tt-practice-story__challenge"><small>ลองหาคำตอบ</small><p>{currentScenario.challenge}</p></div>
          <div className="tt-practice-story__next" aria-live="polite"><span className="tt-practice-story__next-mark"><Activity size={14} /></span><div><small>{snapshot.mode === 'complete' ? 'ลำดับนี้จบแล้ว' : snapshot.mode === 'manual' ? 'แก้ไขด้วยตัวเอง' : 'ขั้นถัดไป'}</small><strong>{snapshot.mode === 'complete' ? 'ดูผลที่โต๊ะ หรือเริ่มใหม่เพื่อเล่นอีกครั้ง' : snapshot.mode === 'manual' ? 'ระบบจะไม่เล่นต่อจนกว่าจะเริ่มโต๊ะใหม่' : nextStep?.title ?? 'พร้อมให้ลอง'}</strong><p>{snapshot.mode === 'complete' ? 'สถานะด้านล่างมาจากโต๊ะทดลองนี้' : snapshot.mode === 'manual' ? 'การแก้ไขของคุณจะไม่ถูกเขียนทับ' : nextStep?.detail ?? ''}</p></div></div>
        </section>

        {notice && <div className="tt-practice-notice" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice(null)} aria-label="ปิดข้อความ">×</button></div>}
        {snapshot.notice && snapshot.mode !== 'manual' && snapshot.notice !== lastEvent?.message && <div className="tt-practice-notice" role={snapshot.mode === 'blocked' ? 'alert' : 'status'}><span>{snapshot.notice}</span></div>}

        {lastEvent && <div className={`tt-practice-last-event tt-practice-last-event--${lastEvent.outcome}`} aria-live="polite"><span className="tt-practice-last-event__mark" aria-hidden="true">{lastEvent.outcome === 'rejected' ? '!' : '✓'}</span><span><small>ผลล่าสุด · {lastEvent.actor}</small><strong>{lastEvent.step === undefined ? manualCommandLabels[lastEvent.type] ?? 'คำสั่งของคุณ' : lastEvent.title}</strong><span>{lastEvent.message}</span></span><b>{lastEvent.outcome === 'rejected' ? 'ไม่ผ่าน' : 'บันทึกแล้ว'}</b></div>}

        <div className="tt-practice-workbench-controls">
          <div className="tt-mode-switch" role="group" aria-label="โหมดจัดวางโต๊ะ"><button type="button" aria-pressed={editMode === 'use'} className={editMode === 'use' ? 'is-active' : ''} onClick={() => setEditMode('use')}><Table2 size={13} /> ใช้งาน</button><button type="button" aria-pressed={editMode === 'arrange'} className={editMode === 'arrange' ? 'is-active' : ''} onClick={() => setEditMode('arrange')}><ArrowDownUp size={13} /> จัดวาง</button></div>
          <div className="tt-mobile-switch" role="group" aria-label="มุมมองโต๊ะ"><button type="button" aria-pressed={surface === 'canvas'} className={surface === 'canvas' ? 'is-active' : ''} onClick={() => setSurface('canvas')}>Canvas</button><button type="button" aria-label="Focus table" aria-pressed={surface === 'focus'} className={surface === 'focus' ? 'is-active' : ''} onClick={() => setSurface('focus')}>โฟกัสโต๊ะ</button></div>
          <span className="tt-practice-boundary">ข้อมูลจำลอง · ไม่ใช้ AI · กติกาและการอนุมัติมีผลเฉพาะแท็บทดลองนี้</span>
          <span className="tt-practice-history-hint">บันทึกทุกบทบาทจำลองและค่าที่คุณกรอก · ล่าสุด 200 รายการ</span>
          <button type="button" className="tt-practice-history" onClick={downloadHistory} aria-label="ดาวน์โหลดบันทึก" title="ดาวน์โหลดบันทึกที่เก็บไว้ในเครื่องนี้"><Download size={13} /> ดาวน์โหลดบันทึก</button>
        </div>

        <div
          className="tt-practice-surface-wrap"
          onPointerDownCapture={captureWorkbenchInput}
          onKeyDownCapture={captureWorkbenchInput}
          onInputCapture={captureWorkbenchInput}
          onChangeCapture={captureWorkbenchInput}
          onSubmitCapture={captureWorkbenchInput}
        >
          <PracticeClockProvider now={snapshot.now}>
            <TableSurface
              key={`${currentScenario.id}:${snapshot.view.epoch}:${snapshot.view.actor.actorId}`}
              view={snapshot.view}
              plan={compiled.plan}
              planError={compiled.error}
              surface={surface}
              editMode={editMode}
              selectedNodeId={selectedNodeId}
              onSelectNode={selectCanvasNode}
              onCommand={onCommand}
              busy={busy}
              onUpload={onUpload}
              onExport={onExport}
              onFocusEvidence={focusEvidence}
              onBackFromEvidence={backFromEvidence}
              focusSourceIds={focusSourceIds}
              inspectorScrollRef={inspectorScrollRef}
            />
          </PracticeClockProvider>
        </div>

        <footer className="tt-practice-footer"><span>พื้นที่ฝึกซ้อมแยกจากโต๊ะทำงานจริง · รีเฟรชเริ่มใหม่</span><a href="/demo/replay">ดูบันทึกการเล่นย้อนหลัง <ArrowLeft size={13} /></a></footer>

        {restartTarget !== undefined && <ConfirmDialog title="เริ่มโต๊ะทดลองใหม่?" confirmLabel="เริ่มโต๊ะใหม่" onClose={() => setRestartTarget(undefined)} onConfirm={confirmRestart}><p>การเริ่มใหม่จะล้างการแก้ไขในโต๊ะทดลองนี้ และเริ่มลำดับที่เลือกจากข้อมูลตัวอย่าง</p></ConfirmDialog>}
      </div>
    </UploadCapabilityProvider>
  );
}
