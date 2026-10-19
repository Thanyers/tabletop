import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type DragEvent, type SyntheticEvent } from 'react';
import { ArrowDownToLine, ArrowRight, Check, FileText, FolderOpen, Hand, MousePointer2, Pause, Play, Plus, RotateCcw, X } from 'lucide-react';
import { planForWorkspace } from '../runtime';
import { PracticeRuntime } from './practice';
import { PRACTICE_SCENARIOS } from './scenarios';
import { PRACTICE_SAMPLE_FILES } from './sample-files';
import { exportInvoice } from '../../../server/exports';
import { ConfirmDialog, UploadCapabilityProvider } from '../ui/WorkbenchShared';
import { PracticeClockProvider } from '../ui/PracticeClock';
import { TableSurface } from '../ui/TableSurface';
import type { CanvasAuxiliaryObject } from '../ui/CanvasWorkspace';
import '../ui/tabletop.css';
import './interactive-demo.css';

const modeLabels: Record<string, string> = { ready: 'เริ่มจากโต๊ะว่าง', playing: 'เดโมกำลังทำให้ดู', paused: 'หยุดชั่วคราว', manual: 'คุณกำลังเล่นเอง', complete: 'พร้อมให้คุณเล่นต่อ', blocked: 'ขั้นตอนนี้ยังไม่สำเร็จ' };
const objectTitles: Record<string, string> = {
  'invoice.source': 'เอกสารและหลักฐาน', 'invoice.table': 'ตารางตรวจบิล', 'invoice.rules': 'กฎค่าขนส่ง', 'invoice.review': 'รายการที่ต้องตรวจ',
  'lesson.source': 'แรง มวล และเวลา', 'lesson.scene': 'รางทดลอง', 'lesson.graph': 'กราฟการเคลื่อนที่', 'lesson.question': 'โจทย์และคำตอบ', 'lesson.rules': 'กฎของบทเรียน',
  'encounter.source': 'กฎและบันทึกเกม', 'encounter.board': 'กระดานเกม', 'encounter.actions': 'การกระทำ', 'workspace.history': 'ประวัติบนโต๊ะ', 'workspace.people': 'ผู้ร่วมโต๊ะ',
};
const caseObjects = {
  invoice: ['invoice.source', 'invoice.rules', 'invoice.table', 'invoice.review', 'workspace.history', 'workspace.people'],
  teaching: ['lesson.source', 'lesson.rules', 'lesson.scene', 'lesson.graph', 'lesson.question', 'workspace.history', 'workspace.people'],
  encounter: ['encounter.source', 'encounter.board', 'encounter.actions', 'workspace.history', 'workspace.people'],
};
const SAMPLE_DRAG_TYPE = 'application/x-tabletop-sample';
function downloadText(filename: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function InteractiveDemo() {
  const [runtime] = useState(() => new PracticeRuntime('invoice-rules'));
  const subscribe = useCallback((listener: () => void) => runtime.subscribe(listener), [runtime]);
  const read = useCallback(() => runtime.getSnapshot(), [runtime]);
  const snapshot = useSyncExternalStore(subscribe, read, read);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [openedObjectId, setOpenedObjectId] = useState<string | null>(null);
  const [focusSourceIds, setFocusSourceIds] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [restartTarget, setRestartTarget] = useState<string | null | undefined>(undefined);
  const [isDragOver, setIsDragOver] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const disposeTimer = useRef<number | undefined>(undefined);
  const importRequest = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const lastAutoEvent = useRef<string | null>(null);
  const scenario = snapshot.scenario, lastEvent = snapshot.history.at(-1), nextStep = scenario.steps[snapshot.stepIndex];
  const canPlay = snapshot.mode === 'ready' || snapshot.mode === 'paused';
  const samples = PRACTICE_SAMPLE_FILES.filter(file => file.kind === scenario.kind);

  useEffect(() => {
    if (disposeTimer.current !== undefined) window.clearTimeout(disposeTimer.current);
    return () => { disposeTimer.current = window.setTimeout(() => runtime.dispose(), 0); };
  }, [runtime]);
  const compiled = useMemo(() => {
    try { return { plan: planForWorkspace(snapshot.view), error: null as string | null }; }
    catch (error) { return { plan: null, error: error instanceof Error ? error.message : 'ยังเปิดโต๊ะนี้ไม่ได้' }; }
  }, [snapshot.view]);
  const takeOver = useCallback(() => { runtime.takeOver(); setNotice('รับช่วงต่อแล้ว เพิ่มของหรือแก้กฎบนโต๊ะได้เลย'); }, [runtime]);
  const onCommand = useCallback(async (type: string, payload: unknown) => {
    setBusy(type); setNotice(null);
    try { return await runtime.command(type, payload); }
    catch (error) { setNotice(error instanceof Error ? error.message : 'ยังทำคำสั่งนี้ไม่สำเร็จ'); return null; }
    finally { setBusy(null); }
  }, [runtime]);
  const importSample = useCallback(async (id: string) => {
    const request = ++importRequest.current, epoch = runtime.getSnapshot().view.epoch;
    setNotice(null); setBusy('import');
    try {
      const result = await runtime.importSample(id);
      if (request !== importRequest.current || epoch !== runtime.getSnapshot().view.epoch) return;
      if (!result) setNotice(runtime.getSnapshot().notice ?? 'ยังนำเข้าไฟล์นี้ไม่ได้');
      else { setSelectedNodeId('practice.files'); setOpenedObjectId(null); }
    } catch (error) { if (request === importRequest.current) setNotice(error instanceof Error ? error.message : 'ยังนำเข้าไฟล์นี้ไม่ได้'); }
    finally { if (request === importRequest.current) setBusy(null); }
  }, [runtime]);
  const importFile = useCallback(async (file: File) => {
    runtime.takeOver(); const request = ++importRequest.current, epoch = runtime.getSnapshot().view.epoch;
    setBusy('import'); setNotice(null);
    try {
      if (file.size > 128 * 1024) throw new Error('ไฟล์ทดลองต้องมีขนาดไม่เกิน 128 KB');
      const text = await file.text();
      if (request !== importRequest.current || epoch !== runtime.getSnapshot().view.epoch) return;
      const result = await runtime.ingestFile(file.name, text);
      if (request !== importRequest.current || epoch !== runtime.getSnapshot().view.epoch) return;
      if (!result) setNotice(runtime.getSnapshot().notice ?? 'รูปแบบไฟล์ไม่ตรงกับโต๊ะนี้ ลองใช้ไฟล์ตัวอย่าง');
      else { setSelectedNodeId('practice.files'); setOpenedObjectId(null); }
    } catch (error) { if (request === importRequest.current) setNotice(error instanceof Error ? error.message : 'อ่านไฟล์นี้ไม่ได้'); }
    finally { if (request === importRequest.current) setBusy(null); }
  }, [runtime]);
  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault(); setIsDragOver(false); if (busy !== null) return;
    const id = event.dataTransfer.getData(SAMPLE_DRAG_TYPE);
    if (id) { void importSample(id); return; }
    if (event.dataTransfer.files.length !== 1) { setNotice('วางทีละหนึ่งไฟล์ เพื่อให้เห็นสิ่งที่เพิ่มบนโต๊ะ'); return; }
    void importFile(event.dataTransfer.files[0]);
  };
  const selectObject = useCallback((id: string | null) => { runtime.pause(); setSelectedNodeId(id); }, [runtime]);
  const openObject = useCallback((id: string | null) => { runtime.pause(); setOpenedObjectId(id); if (id) setSelectedNodeId(id); }, [runtime]);
  const focusObject = useCallback((id: string) => {
    runtime.pause();
    if (!runtime.getSnapshot().visibleNodeIds.includes(id)) runtime.addObject(id);
    setSelectedNodeId(id); setOpenedObjectId(id);
  }, [runtime]);
  const focusEvidence = useCallback((ids: string[]) => { runtime.pause(); setFocusSourceIds(ids); setSelectedNodeId('invoice.source'); setOpenedObjectId('invoice.source'); }, [runtime]);
  const exportResult = useCallback(async (format: 'csv' | 'html') => {
    const state = runtime.getSnapshot().view.domain;
    if (state.kind !== 'invoice') return;
    downloadText(`tabletop-practice-invoice.${format}`, exportInvoice(state, format), format === 'csv' ? 'text/csv;charset=utf-8' : 'text/html;charset=utf-8');
  }, [runtime]);
  const addObject = (id: string) => {
    if (runtime.addObject(id)) { setSelectedNodeId(id); setOpenedObjectId(null); setToolsOpen(false); }
    else setNotice(runtime.getSnapshot().notice);
  };
  // Bubble input/change, then defer publication until the child saves its value.
  // Capture publication can restore a stale controlled input before onChange runs.
  const interact = useCallback((event: SyntheticEvent<HTMLElement>) => {
    if (!(event.target instanceof Element) || !event.target.closest('.tt-canvas-node__body')) return;
    const control = event.target.closest('input, select, textarea, button, [contenteditable="true"]');
    if (!control && event.type !== 'submit') return;
    if (event.type === 'keydown') {
      const key = (event.nativeEvent as KeyboardEvent).key;
      if (['Tab', 'Shift', 'Control', 'Alt', 'Meta', 'Escape'].includes(key)) return;
      if (control?.matches('button') && !['Enter', ' '].includes(key)) return;
    }
    if (event.type === 'input' || event.type === 'change') queueMicrotask(() => { if (runtime.getSnapshot().mode !== 'manual') runtime.takeOver(); });
    else if (runtime.getSnapshot().mode !== 'manual') runtime.takeOver();
  }, [runtime]);
  const restart = (id?: string) => {
    importRequest.current += 1; runtime.restart(id); setBusy(null); setNotice(null);
    setSelectedNodeId(null); setOpenedObjectId(null); setFocusSourceIds([]); setRestartTarget(undefined); lastAutoEvent.current = null;
  };
  const advance = async () => { setBusy('step'); try { await runtime.next(); } finally { setBusy(null); } };
  useEffect(() => {
    if (!lastEvent?.step || lastAutoEvent.current === lastEvent.id || snapshot.mode === 'manual') return;
    lastAutoEvent.current = lastEvent.id; setSelectedNodeId(snapshot.focusNodeId); setOpenedObjectId(null);
  }, [lastEvent, snapshot.focusNodeId, snapshot.mode]);

  const auxiliaryObjects: CanvasAuxiliaryObject[] = [{ id: 'practice.files', title: 'ไฟล์บนโต๊ะ', eyebrow: 'FILES · IN THIS TAB', position: { x: 40, y: -470 }, content: <div className="tt-practice-files" data-testid="practice-imported-files">
    <p>อ่านไฟล์ในแท็บนี้โดยตรง · แสดงข้อความต้นไฟล์สูงสุด 2,000 ตัวอักษร</p>
    {snapshot.files.map(file => <details key={file.id}><summary><FileText size={14} /> {file.filename}</summary><pre>{file.text}</pre></details>)}
    <button className="tt-button tt-button--quiet" onClick={() => fileInput.current?.click()}><Plus size={14} /> เพิ่มไฟล์</button>
  </div> }];
  const empty = <div className="tt-practice-empty" data-testid="practice-empty-canvas"><span className="tt-practice-empty__icon"><FolderOpen size={30} /></span><h1>โต๊ะว่างนี้เริ่มจากไฟล์ของคุณ</h1><p>ลากไฟล์ตัวอย่างมาวางที่นี่ แล้วค่อยเพิ่มกฎและเครื่องมือบน Canvas</p><button className="tt-practice-button tt-practice-button--primary" onClick={() => runtime.play()} disabled={!canPlay || busy !== null}><Play size={14} fill="currentColor" /> ดูเดโมสร้างโต๊ะ</button><span>หรือเลือกไฟล์ทางซ้ายเพื่อเริ่มเอง</span></div>;
  const dragFile = snapshot.mode === 'playing' && nextStep?.command.type === 'practice.importSample' ? samples.find(file => file.id === (nextStep.command.payload as { sampleId?: string }).sampleId) : null;

  return <UploadCapabilityProvider enabled={false} reason="โต๊ะทดลองอ่านไฟล์ CSV / JSON จากปุ่มเพิ่มไฟล์บน Canvas; การอัปโหลด PDF ยังไม่เปิด">
    <div className="tt-app tt-practice-app tt-practice-canvas-first" data-testid="interactive-auto-demo">
      <header className="tt-practice-header">
        <a className="tt-brand" href="/" aria-label="กลับไปหน้า Tabletop"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></a><span className="tt-practice-header__rule" />
        <label className="tt-practice-scenario-select"><span>โต๊ะทดลอง</span><select aria-label="เลือกโจทย์" value={scenario.id} onChange={event => { if (snapshot.mode === 'manual') setRestartTarget(event.target.value); else restart(event.target.value); }}>{PRACTICE_SCENARIOS.map(item => <option value={item.id} key={item.id}>{item.title}</option>)}</select></label>
        <span className="tt-practice-header__spacer" /><span className="tt-practice-local-label">อ่านไฟล์ในเครื่อง · เดโมไม่เรียก AI</span><a className="tt-practice-header__real" href="/">โต๊ะทำงานจริง <ArrowRight size={13} /></a>
      </header>
      <div className="tt-practice-canvas-toolbar" aria-label="การเล่นโต๊ะทดลอง">
        <div className="tt-practice-toolbar__transport" role="group" aria-label="ควบคุมเดโม">
          {snapshot.mode === 'playing' ? <button className="tt-practice-button tt-practice-button--primary" onClick={() => runtime.pause()}><Pause size={14} /> หยุดเดโม</button> : <button className="tt-practice-button tt-practice-button--primary" disabled={!canPlay || busy !== null} onClick={() => runtime.play()}><Play size={14} fill="currentColor" /> เล่นเดโม</button>}
          <button className="tt-practice-button tt-practice-button--quiet" disabled={!canPlay || busy !== null} onClick={() => void advance()}><ArrowRight size={14} /> ทำขั้นถัดไป</button><button className="tt-practice-button tt-practice-button--quiet" disabled={snapshot.mode === 'manual'} onClick={takeOver}><Hand size={14} /> หยุดแล้วลองเอง</button><button className="tt-practice-icon-button" aria-label="เริ่มโต๊ะทดลองใหม่" title="เริ่มโต๊ะทดลองใหม่" onClick={() => snapshot.mode === 'manual' ? setRestartTarget(null) : restart()}><RotateCcw size={14} /></button>
        </div>
        <span data-testid="practice-mode" data-mode={snapshot.mode} className={`tt-practice-mode tt-practice-mode--${snapshot.mode}`} role="status"><i />{modeLabels[snapshot.mode]}</span><span data-testid="practice-step-counter" className="tt-practice-progress">ทำแล้ว {snapshot.stepIndex} / {scenario.steps.length}</span>
        <label className="tt-practice-actor-select">ลองเป็น <select aria-label="ลองเป็น" value={snapshot.view.actor.actorId} onChange={event => { importRequest.current += 1; setBusy(null); setNotice(null); runtime.selectActor(event.target.value); setOpenedObjectId(null); }}>{snapshot.view.members.map(member => <option key={member.actorId} value={member.actorId}>{member.name} · {member.role}</option>)}</select></label>
      </div>
      {notice && <div className="tt-practice-notice" role="status"><span>{notice}</span><button aria-label="ปิดข้อความ" onClick={() => setNotice(null)}><X size={14} /></button></div>}
      <div className="tt-practice-desktop">
        <aside className="tt-practice-file-tray" aria-label="ไฟล์สำหรับเริ่มโต๊ะ"><div><span className="tt-kicker">เริ่มที่นี่</span><h2>ลากไฟล์ลงโต๊ะ</h2><p>ไฟล์ตัวอย่างสำหรับ {scenario.persona}</p></div>
          {samples.map(file => <div className="tt-practice-file-chip" key={file.id} draggable={busy === null} onDragStart={event => { runtime.pause(); event.dataTransfer.setData(SAMPLE_DRAG_TYPE, file.id); event.dataTransfer.effectAllowed = 'copy'; }} data-sample-id={file.id}><FileText size={22} /><strong>{file.filename}</strong><span>{file.description}</span><button disabled={busy !== null} onClick={() => void importSample(file.id)} aria-label={`วาง ${file.filename} บนโต๊ะ`}><Plus size={13} /> วางบนโต๊ะ</button><button className="tt-practice-file-download" onClick={() => downloadText(file.filename, file.text)} aria-label={`ดาวน์โหลด ${file.filename}`}><ArrowDownToLine size={13} /></button></div>)}
          <button className="tt-practice-file-pick" onClick={() => fileInput.current?.click()} disabled={busy !== null}><FolderOpen size={15} /> เลือกไฟล์จากเครื่อง</button><input ref={fileInput} type="file" className="tt-visually-hidden" accept=".csv,.json,.txt" aria-label="เลือกไฟล์เข้า Canvas" onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importFile(file); }} /><small>CSV / JSON ตามตัวอย่าง · สูงสุด 128 KB<br />ข้อมูลอยู่ในแท็บนี้ รีเฟรชเริ่มใหม่</small>
        </aside>
        <section className={`tt-practice-workarea${isDragOver ? ' is-drop-target' : ''}`} aria-label="พื้นที่ Canvas ทดลอง" onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; setIsDragOver(true); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false); }} onDrop={drop}>
          <div className="tt-practice-build-bar"><span><MousePointer2 size={13} /> เปิดทุกอย่างจาก container บนโต๊ะ</span><button aria-expanded={toolsOpen} onClick={() => setToolsOpen(value => !value)}><Plus size={14} /> เพิ่ม container</button></div>
          {toolsOpen && <nav className="tt-practice-object-library" aria-label="เพิ่ม container บนโต๊ะ">{caseObjects[scenario.kind].map(id => {
            const present = snapshot.visibleNodeIds.includes(id);
            const available = id.startsWith('workspace.') || id === 'lesson.rules' || compiled.plan?.nodes.some(node => node.id === id && node.visible !== false);
            return <button key={id} disabled={present || !available} title={!available ? 'จะเปิดได้เมื่อมีข้อมูลหรือเลือกมุมมองที่เกี่ยวข้อง' : undefined} onClick={() => addObject(id)}>{present ? <Check size={14} /> : <Plus size={14} />}{objectTitles[id]}{!available && ' · รอข้อมูล'}</button>;
          })}</nav>}
          <div className="tt-practice-surface-wrap" onPointerDownCapture={interact} onKeyDownCapture={interact} onInput={interact} onChange={interact} onSubmitCapture={interact}>
            <PracticeClockProvider now={snapshot.now}><TableSurface key={`${scenario.id}:${snapshot.view.epoch}:${snapshot.view.actor.actorId}`} view={snapshot.view} plan={compiled.plan} planError={compiled.error} surface="canvas" editMode="arrange" persistLayout={false} selectedNodeId={selectedNodeId} onSelectNode={selectObject} onCommand={onCommand} busy={busy} onUpload={async (_kind, file) => importFile(file)} onExport={exportResult} onFocusEvidence={focusEvidence} onBackFromEvidence={() => setFocusSourceIds([])} focusSourceIds={focusSourceIds} visibleNodeIds={snapshot.visibleNodeIds} focusNodeId={selectedNodeId} focusRequestKey={lastEvent?.id} openedObjectId={openedObjectId} onOpenObject={openObject} onFocusObject={focusObject} auxiliaryObjects={auxiliaryObjects} emptyContent={empty} /></PracticeClockProvider>
          </div>
          {isDragOver && <div className="tt-practice-drop-message"><FileText size={24} />ปล่อยไฟล์เพื่อเพิ่มลง Canvas</div>}{dragFile && <div key={`${snapshot.view.epoch}:${snapshot.stepIndex}`} className="tt-practice-demo-drag" aria-hidden="true"><FileText size={24} /><span>{dragFile.filename}</span><MousePointer2 size={21} /></div>}
          <div className="tt-practice-step-note" aria-live="polite"><span className="tt-practice-step-note__number">{snapshot.mode === 'complete' ? <Check size={17} /> : String(snapshot.stepIndex + 1).padStart(2, '0')}</span><div><strong>{snapshot.mode === 'manual' ? 'โต๊ะอยู่ในมือคุณแล้ว' : nextStep?.title ?? 'โต๊ะพร้อมเล่นต่อ'}</strong><p>{snapshot.mode === 'manual' ? 'เปิด container เพื่อแก้ไข หรือเพิ่มสิ่งที่ต้องใช้จากปุ่มด้านบน' : nextStep?.detail ?? scenario.challenge}</p>{lastEvent && <small className="tt-practice-last-event" data-outcome={lastEvent.outcome}>{lastEvent.step ? lastEvent.title : lastEvent.outcome === 'rejected' ? 'ยังทำรายการนี้ไม่ได้' : 'บันทึกการกระทำแล้ว'} · {lastEvent.type === 'practice.addObject' ? 'เพิ่ม container ลงบนโต๊ะแล้ว' : lastEvent.message}</small>}</div></div>
        </section>
      </div>
      <footer className="tt-practice-footer"><span>ข้อมูลตัวอย่าง · ฝึกในแท็บนี้ · หยุดแล้วแก้ต่อได้ทุกขั้น</span><button onClick={() => downloadText('tabletop-practice-history.json', runtime.exportHistory(), 'application/json')} aria-label="ดาวน์โหลดบันทึก"><ArrowDownToLine size={13} /> บันทึกการเล่นและค่าที่กรอก</button><a href="/demo/replay">คลังบันทึกทดสอบเดิม</a></footer>
      {restartTarget !== undefined && <ConfirmDialog title="เริ่มโต๊ะทดลองใหม่?" confirmLabel="เริ่มโต๊ะใหม่" onClose={() => setRestartTarget(undefined)} onConfirm={() => restart(restartTarget ?? undefined)}><p>การเริ่มใหม่จะล้างไฟล์และการแก้ไขในแท็บนี้ ดาวน์โหลดบันทึกก่อนเริ่มใหม่ได้</p></ConfirmDialog>}
    </div>
  </UploadCapabilityProvider>;
}
