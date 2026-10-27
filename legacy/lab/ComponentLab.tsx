import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Code2,
  FlaskConical,
  History,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import GeneratedFrame, { type GeneratedFrameHandle } from './GeneratedFrame';
import MaterializeSurface from '../components/MaterializeSurface';
import { initialLabState, LAB_START_PROMPT } from './types';
import type { GeneratedComponent, LabRevision, LabState } from './types';
import { validateArtifact, validState } from './frameProtocol';
import { checkAppendedHistory } from './historyCheck';
import './component-lab.css';

type Props = { visible: boolean; onClose: () => void; seedBpm?: number };
type ApiStatus = { available: boolean; reason?: string };
type JobResult = GeneratedComponent & { modelMs: number; modelId: string };
type JobResponse = { jobId: string; status: 'running' | 'complete' | 'failed' | 'cancelled'; result?: JobResult; error?: string };
type CheckRow = { label: string; expected: string; actual: string; passed: boolean };
type Candidate = {
  artifact: GeneratedComponent;
  prompt: string;
  modelMs: number;
  modelId: string;
  checks: CheckRow[] | null;
  previewMs: number | null;
  testedAgainst: string | null;
  requestedAt: number;
  firstReadyMs: number | null;
};
type Revision = LabRevision & { modelId: string; checkRows: CheckRow[]; firstReadyMs: number | null };
type View = 'working' | 'candidate';

const SUGGESTIONS = [
  'มือใหม่ให้คลาดเคลื่อนได้ 150ms',
  'แยกแผ่นซ้ายขวาแยกผล',
  'เปลี่ยนเป็นโทนส้มครีมเก็บผลเดิม',
];
const API = '/api/component-lab';

function cloneState(state: LabState): LabState {
  return { settings: { ...state.settings }, history: state.history.map(record => ({ ...record })) };
}

function formatSeconds(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function asText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value == null) return 'ไม่มีผลลัพธ์';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function classificationMatches(value: unknown, expected: 'early' | 'on-time' | 'late') {
  let label = value;
  if (label && typeof label === 'object') {
    const result = label as Record<string, unknown>;
    label = result.classification ?? result.status ?? result.label ?? result.result;
  }
  if (typeof label !== 'string') return false;
  const normalized = label.trim().toLocaleLowerCase().replaceAll('_', '-');
  const aliases: Record<typeof expected, string[]> = {
    early: ['early', 'เร็วเกิน'],
    'on-time': ['on-time', 'on time', 'ontime', 'ตรงจังหวะ'],
    late: ['late', 'ช้าเกิน'],
  };
  return aliases[expected].includes(normalized);
}

async function responseJson<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload && typeof payload.error === 'string' ? payload.error : `คำขอไม่สำเร็จ (${response.status})`;
    throw new Error(message);
  }
  return payload as T;
}

const elapsed = (startedAt: number) => Math.max(0, Math.round(performance.now() - startedAt));

export default function ComponentLab({ visible, onClose, seedBpm = 100 }: Props) {
  const seedRef = useRef(Math.max(30, Math.min(240, Math.round(seedBpm))));
  const [workingState, setWorkingState] = useState<LabState>(() => {
    const base = initialLabState();
    return { ...base, settings: { ...base.settings, bpm: seedRef.current } };
  });
  const [workingArtifact, setWorkingArtifact] = useState<GeneratedComponent | null>(null);
  const [prompt, setPrompt] = useState(() => LAB_START_PROMPT.replaceAll('100 BPM', `${seedRef.current} BPM`));
  const [availability, setAvailability] = useState<ApiStatus | null>(null);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [view, setView] = useState<View>('working');
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [candidateState, setCandidateState] = useState<LabState>(() => initialLabState());
  const [candidateReady, setCandidateReady] = useState(false);
  const [workingReady, setWorkingReady] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [testing, setTesting] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [workingError, setWorkingError] = useState<string | null>(null);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [activeRevisionId, setActiveRevisionId] = useState<string | null>(null);
  const [rollbackId, setRollbackId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const candidateFrame = useRef<GeneratedFrameHandle>(null);
  const workingStateRef = useRef(workingState);
  const candidateStateRef = useRef(candidateState);
  const jobIdRef = useRef<string | null>(null);
  const cancelRequestedRef = useRef(false);
  const runTokenRef = useRef(0);
  const importFileRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [attempt,setAttempt] = useState(0);

  useEffect(()=>{bodyRef.current?.scrollTo({top:0,behavior:'instant'});},[view,attempt]);

  useEffect(() => () => {
    ++runTokenRef.current;
    cancelRequestedRef.current = true;
    const id = jobIdRef.current;
    if (id) void fetch(`${API}/jobs/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' }, keepalive: true }).catch(() => undefined);
  }, []);

  const updateWorkingState = useCallback((next: LabState) => {
    workingStateRef.current = next;
    setWorkingState(next);
  }, []);
  const updateCandidateState = useCallback((next: LabState) => {
    candidateStateRef.current = next;
    setCandidateState(next);
  }, []);

  useEffect(() => {
    if (!visible) return;
    const controller = new AbortController();
    setCheckingAvailability(true);
    fetch(`${API}/status`, { cache: 'no-store', credentials: 'same-origin', signal: controller.signal })
      .then(response => responseJson<ApiStatus>(response))
      .then(setAvailability)
      .catch(error => {
        if (!controller.signal.aborted) setAvailability({ available: false, reason: error instanceof Error ? error.message : 'เปิดบริการไม่ได้' });
      })
      .finally(() => { if (!controller.signal.aborted) setCheckingAvailability(false); });
    return () => controller.abort();
  }, [visible]);

  useEffect(() => {
    if (!generating || startedAt == null) return;
    const timer = window.setInterval(() => setElapsedMs(elapsed(startedAt)), 100);
    return () => window.clearInterval(timer);
  }, [generating, startedAt]);

  const generate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || generating || !availability?.available) return;
    const token = ++runTokenRef.current;
    setAttempt(previous => previous + 1);
    const began = performance.now();
    const snapshot = cloneState(workingStateRef.current);
    const priorArtifact = workingArtifact ?? undefined;
    cancelRequestedRef.current = false;
    jobIdRef.current = null;
    setCancelling(false);
    setGenerationError(null);
    setCandidateError(null);
    setCandidate(null);
    setCandidateReady(false);
    setView('candidate');
    setGenerating(true);
    setStartedAt(began);
    setElapsedMs(0);

    let hasCandidate = false;
    try {
      const post = await fetch(`${API}/generate`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'X-Component-Lab': '1' },
        body: JSON.stringify({
          request: text,
          snapshot,
          ...(priorArtifact ? { prior: priorArtifact, editInstruction: text } : {}),
        }),
      });
      const accepted = await responseJson<{ jobId: string }>(post);
      if (token !== runTokenRef.current) {
        void fetch(`${API}/jobs/${encodeURIComponent(accepted.jobId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' }, keepalive: true }).catch(() => undefined);
        return;
      }
      jobIdRef.current = accepted.jobId;
      if (cancelRequestedRef.current) {
        await fetch(`${API}/jobs/${encodeURIComponent(accepted.jobId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' } }).catch(() => undefined);
        setGenerationError('ยกเลิกรอบทดลองแล้ว');
        return;
      }

      while (token === runTokenRef.current) {
        const response = await fetch(`${API}/jobs/${encodeURIComponent(accepted.jobId)}`, { cache: 'no-store', credentials: 'same-origin' });
        const job = await responseJson<JobResponse>(response);
        if (token !== runTokenRef.current) return;
        if (cancelRequestedRef.current && job.status !== 'running') {
          setGenerationError('ยกเลิกรอบทดลองแล้ว');
          break;
        }
        if (job.status === 'running') {
          if (cancelRequestedRef.current) {
            await fetch(`${API}/jobs/${encodeURIComponent(accepted.jobId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' } }).catch(() => undefined);
          }
          await new Promise(resolve => window.setTimeout(resolve, 500));
          continue;
        }
        if (job.status === 'cancelled') {
          setGenerationError('ยกเลิกรอบทดลองแล้ว');
          break;
        }
        if (job.status === 'failed' || !job.result) {
          setGenerationError(job.error || 'สร้างรุ่นทดลองไม่สำเร็จ ลองปรับคำขอแล้วเริ่มใหม่');
          break;
        }
        const { modelMs, modelId, ...artifact } = job.result;
        const invalid = validateArtifact(artifact);
        if (invalid) {
          setCandidateError(invalid);
          setGenerationError(`ผลที่สร้างยังไม่ผ่านข้อตกลง: ${invalid}`);
          break;
        }
        const fresh = cloneState(workingStateRef.current);
        const nextState: LabState = { settings: { ...artifact.settings }, history: fresh.history };
        updateCandidateState(nextState);
        setCandidate({
          artifact,
          prompt: text,
          modelMs: Number.isFinite(modelMs) ? modelMs : elapsed(began),
          modelId: modelId || 'ไม่ระบุรุ่น',
          checks: null,
          previewMs: null,
          testedAgainst: null,
          requestedAt: began,
          firstReadyMs: null,
        });
        setCandidateReady(false);
        hasCandidate = true;
        setView('candidate');
        bodyRef.current?.scrollTo({top:0,behavior:'instant'});
        break;
      }
    } catch (error) {
      if (token === runTokenRef.current) setGenerationError(error instanceof Error ? error.message : 'เชื่อมตัวสร้างไม่สำเร็จ');
    } finally {
      if (token === runTokenRef.current) {
        if (!hasCandidate) setView('working');
        setGenerating(false);
        setCancelling(false);
        setElapsedMs(elapsed(began));
        setStartedAt(null);
        jobIdRef.current = null;
      }
    }
  };

  const cancelGeneration = async () => {
    if (!generating) return;
    cancelRequestedRef.current = true;
    setCancelling(true);
    const jobId = jobIdRef.current;
    if (jobId) {
      try { await fetch(`${API}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' } }); }
      catch { setGenerationError('ส่งคำขอยกเลิกไม่ได้ รอให้รอบนี้จบก่อน'); }
    }
  };

  const runTests = async () => {
    if (!candidate || !candidateReady || !candidateFrame.current || testing) return;
    const started = performance.now();
    const candidateHandle = candidateFrame.current;
    const rows: CheckRow[] = [];
    setTesting(true);
    setCandidateError(null);
    setView('candidate');
    try {
      const tolerance = candidate.artifact.settings.toleranceMs;
      const cases = [
        { offset: -tolerance - 1, expected: 'early' as const },
        { offset: -tolerance, expected: 'on-time' as const },
        { offset: 0, expected: 'on-time' as const },
        { offset: tolerance, expected: 'on-time' as const },
        { offset: tolerance + 1, expected: 'late' as const },
      ];
      for (const test of cases) {
        const actualValue = await candidateHandle.invoke('classify', [test.offset, tolerance]);
        const passed = classificationMatches(actualValue, test.expected);
        rows.push({ label: `classify(${test.offset}, ${tolerance})`, expected: test.expected, actual: asText(actualValue), passed });
      }
      const beforeHistory = cloneState(candidateStateRef.current).history;
      await candidateHandle.invoke('start', []);
      await candidateHandle.invoke('tap', ['left']);
      if (candidate.artifact.settings.splitHands) await candidateHandle.invoke('tap', ['right']);
      await candidateHandle.invoke('stop', []);
      const {added,preserved:historyPreserved} = checkAppendedHistory(beforeHistory,candidateStateRef.current.history,candidate.artifact.settings.splitHands?['left','right']:['left']);
      const bothHandsRecorded = !candidate.artifact.settings.splitHands || (added.some(record => record.hand === 'left') && added.some(record => record.hand === 'right'));
      rows.push({
        label: candidate.artifact.settings.splitHands ? "start → tap('left') + tap('right') → stop" : "start → tap('left') → stop",
        expected: candidate.artifact.settings.splitHands ? 'บันทึกผลมือซ้ายและขวา โดยคงประวัติเดิม' : 'บันทึกผลใหม่ โดยคงประวัติเดิม',
        actual: `${added.length ? `เพิ่ม ${added.length} ครั้ง` : 'ไม่พบผลใหม่'} · ${historyPreserved ? 'ประวัติเดิมอยู่ครบ' : 'ประวัติเดิมเปลี่ยนไป'}${candidate.artifact.settings.splitHands ? (bothHandsRecorded ? ' · ครบสองมือ' : ' · ขาดหนึ่งมือ') : ''}`,
        passed: added.length > 0 && bothHandsRecorded && historyPreserved,
      });
    } catch (error) {
      rows.push({ label: 'การทำงานของรุ่นทดลอง', expected: 'ตอบกลับครบทุกคำสั่ง', actual: error instanceof Error ? error.message : 'เครื่องมือไม่ตอบกลับ', passed: false });
    } finally {
      try { await candidateHandle.invoke('stop', []); } catch { /* stop is best-effort after a failed check */ }
      const latest = cloneState(workingStateRef.current);
      updateCandidateState({ settings: { ...candidate.artifact.settings }, history: latest.history });
      setCandidate(current => current ? { ...current, checks: rows, previewMs: elapsed(started), testedAgainst: activeRevisionId } : current);
      setTesting(false);
    }
  };

  const activateCandidate = () => {
    if (!candidate || !candidate.checks?.length || candidate.checks.some(test => !test.passed) || candidate.testedAgainst !== activeRevisionId || candidateError) return;
    const id = crypto.randomUUID();
    const revision: Revision = {
      id,
      artifact: candidate.artifact,
      prompt: candidate.prompt,
      modelId: candidate.modelId,
      modelMs: candidate.modelMs,
      previewMs: candidate.previewMs ?? 0,
      firstReadyMs: candidate.firstReadyMs,
      checks: candidate.checks.map(check => check.label),
      checkRows: candidate.checks,
      createdAt: new Date().toISOString(),
    };
    setRevisions(previous => [revision, ...previous]);
    setActiveRevisionId(id);
    setWorkingArtifact(candidate.artifact);
    updateWorkingState({ ...workingStateRef.current, settings: { ...candidate.artifact.settings } });
    setCandidate(null);
    setCandidateReady(false);
    setWorkingReady(false);
    setView('working');
    setRollbackId(null);
  };

  const rollback = (revision: Revision) => {
    setWorkingArtifact(revision.artifact);
    updateWorkingState({ ...workingStateRef.current, settings: { ...revision.artifact.settings } });
    setActiveRevisionId(revision.id);
    setWorkingReady(false);
    setRollbackId(null);
    setView('working');
  };

  const canActivate = !!candidate && !!candidate.checks?.length && candidate.checks.every(check => check.passed) && candidate.testedAgainst === activeRevisionId && !candidateError;
  const canTest = !!candidate && candidateReady && !testing && !generating;

  const closeLab = () => {
    if (generating) {
      cancelRequestedRef.current = true;
      const jobId = jobIdRef.current;
      if (jobId) void fetch(`${API}/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE', credentials: 'same-origin', headers: { 'X-Component-Lab': '1' } }).catch(() => undefined);
    }
    onClose();
  };

  const importExperiment = async (file: File) => {
    if (workingArtifact || generating) return;
    try {
      if (file.size > 1_000_000) throw Error('ไฟล์ผลทดลองใหญ่เกินขอบเขต');
      const saved = JSON.parse(await file.text());
      if (saved.format !== 'procedural-component-lab-v1' || !validState(saved.state) || !Array.isArray(saved.revisions)) throw Error('ไม่ใช่ไฟล์ผลทดลองที่รองรับ');
      const revision = saved.revisions.find((item: Revision) => item.id === saved.activeRevisionId);
      if (!revision || !revision.artifact || !Number.isFinite(revision.modelMs) || typeof revision.modelId !== 'string') throw Error('ไม่พบรุ่นที่บันทึกไว้');
      const invalid = validateArtifact(revision.artifact);
      if (invalid) throw Error(invalid);
      const restored = cloneState(saved.state);
      updateWorkingState(restored);
      updateCandidateState({...restored,settings:{...revision.artifact.settings}});
      setCandidate({artifact:revision.artifact,prompt:`เปิดผลจากไฟล์ · ${file.name}`,modelMs:revision.modelMs,modelId:`ผลที่บันทึก · ${revision.modelId}`,checks:null,previewMs:null,testedAgainst:null,requestedAt:performance.now(),firstReadyMs:null});
      setAttempt(previous=>previous+1);
      setCandidateReady(false);setCandidateError(null);setGenerationError(null);setView('candidate');
    } catch (error) { setGenerationError(error instanceof Error ? error.message : 'เปิดไฟล์ผลทดลองไม่ได้'); }
  };

  return (
    <section className="component-lab" data-testid="component-lab" aria-label="Component Lab">
      <header className="component-lab__header component-lab__drag">
        <div className="component-lab__mark"><FlaskConical size={18} /></div>
        <div className="component-lab__title">
          <span>COMPONENT LAB · ทดลองในพื้นที่แยก</span>
          <h2>สอนปรับเครื่องมือนี้</h2>
        </div>
        <div className={`component-lab__availability ${availability?.available ? 'is-ready' : availability ? 'is-unavailable' : ''}`} title={availability?.reason}>
          <i />{checkingAvailability ? 'กำลังตรวจ' : availability?.available ? 'พร้อมทดลอง' : 'ยังไม่พร้อม'}
        </div>
        <button className="component-lab__icon-button nodrag nowheel nopan" type="button" aria-label="ปิดและล้างการทดลองในหน่วยความจำ" title="ปิดและล้างการทดลองในหน่วยความจำ" onClick={closeLab}><X size={16}/></button>
      </header>

      <div ref={bodyRef} className="component-lab__body nowheel nopan">
        <div className="component-lab__topline">
          <div className="component-lab__working-label"><span className="component-lab__live-dot" />{workingArtifact ? `กำลังใช้งาน · ${workingArtifact.title}` : 'พื้นที่ทำงานยังว่าง'}</div>
          <span className="component-lab__seed">จังหวะเริ่มต้น {seedRef.current} BPM</span>
        </div>

        <div className="component-lab__tabs" role="tablist" aria-label="พื้นที่ทดลอง">
          <button type="button" role="tab" aria-selected={view === 'working'} onClick={() => setView('working')}>
            <Activity size={14}/>ใช้งานอยู่{generating && <span className="component-lab__tab-state">คงเดิม</span>}
          </button>
          <button type="button" role="tab" aria-selected={view === 'candidate'} disabled={!candidate && !generating} onClick={() => { if (view !== 'candidate') setCandidateReady(false); setView('candidate'); }}>
            <FlaskConical size={14}/>รุ่นทดลอง{candidate && <span className={`component-lab__tab-state ${canActivate ? 'is-good' : ''}`}>{candidate.checks?.length ? `${candidate.checks.filter(item => item.passed).length}/${candidate.checks.length}` : 'รอตรวจ'}</span>}
          </button>
        </div>

        <div className="component-lab__stage" aria-live="polite">
          {view === 'working' ? (
            workingArtifact ? <>
              <div className="component-lab__frame-wrap">
                <GeneratedFrame
                  artifact={workingArtifact}
                  state={workingState}
                  visible={visible}
                  onState={updateWorkingState}
                  onReady={() => setWorkingReady(true)}
                  onError={setWorkingError}
                  title={`เครื่องมือที่ใช้อยู่: ${workingArtifact.title}`}
                />
                {!workingReady && <div className="component-lab__frame-loading"><LoaderCircle size={16}/>กำลังเปิดเครื่องมือที่ใช้อยู่</div>}
              </div>
              {workingError && <p className="component-lab__error"><CircleAlert size={14}/>{workingError}</p>}
            </> : <div className="component-lab__empty-work">
              <div className="component-lab__empty-mark"><Activity size={20}/></div>
              <strong>สร้างรุ่นแรกเพื่อเริ่มใช้บน canvas</strong>
              <span>รุ่นที่กำลังใช้อยู่จะแสดงตรงนี้เสมอ ขณะสร้างรุ่นใหม่ งานเดิมยังทำงานต่อ</span>
            </div>
          ) : (candidate || generating) ? <>
            {generating && <div className="component-lab__building-caption"><strong>{workingArtifact?'กำลังสร้างรุ่นใหม่':'กำลังสร้างเครื่องมือของคุณ'}</strong><p>{prompt}</p><small>จะเปิดตัวอย่างเมื่อสร้างเสร็จ แล้วให้ตรวจดูก่อนใช้</small></div>}
            {candidate && <><div className="component-lab__candidate-heading">
              <div><span className="component-lab__candidate-kicker"><FlaskConical size={12}/>แยกจากรุ่นที่ใช้อยู่</span><h3>{candidate.artifact.title}</h3></div>
              <span className="component-lab__not-live">ทดลองยังไม่ใช้จริง</span>
            </div>
            <p className="component-lab__explanation">{candidate.artifact.explanation}</p></>}
            {!candidateError && <MaterializeSurface identity={`lab-${attempt}`} pending={generating || (!!candidate && !candidateReady)} variant="music" label={generating?'กำลังสร้างจากคำขอของคุณ':'กำลังเปิดเครื่องมือ'} renderWhilePending paused={!visible}>
            {candidate && <div className="component-lab__frame-wrap component-lab__frame-wrap--candidate">
              <GeneratedFrame
                ref={candidateFrame}
                artifact={candidate.artifact}
                state={candidateState}
                visible={visible && view === 'candidate'}
                onState={updateCandidateState}
                onReady={() => { setCandidateReady(true); setCandidate(current => current && current.firstReadyMs == null ? {...current, firstReadyMs: elapsed(current.requestedAt)} : current); }}
                onError={setCandidateError}
                title={`รุ่นทดลอง: ${candidate.artifact.title}`}
              />
            </div>}
            </MaterializeSurface>}
            {candidate && <>
            {candidateError && <p className="component-lab__error"><CircleAlert size={14}/>{candidateError}</p>}
            <div className="component-lab__measurement" aria-label="ผลการวัดรุ่นทดลอง">
              <span><Clock3 size={13}/><small>สร้างจริง</small><strong>{candidate.modelMs} ms</strong></span>
              {candidate.firstReadyMs != null && <span><Clock3 size={13}/><small>กดจนเปิดได้</small><strong>{candidate.firstReadyMs} ms</strong></span>}
              {candidate.previewMs != null && <span><CheckCircle2 size={13}/><small>ตรวจจริง</small><strong>{candidate.previewMs} ms</strong></span>}
              <span><Code2 size={13}/><small>ตัวสร้าง</small><strong>{candidate.modelId}</strong></span>
            </div>
            {candidate.checks && <div className="component-lab__checks" data-testid="component-lab-checks">
              <div className="component-lab__checks-title"><strong>ผลตรวจของรุ่นนี้</strong><span>{candidate.checks.filter(test => test.passed).length}/{candidate.checks.length} ผ่าน</span></div>
              {candidate.checks.map(check => <div className={`component-lab__check ${check.passed ? 'is-pass' : 'is-fail'}`} key={check.label}>
                {check.passed ? <Check size={13}/> : <XCircle size={13}/>}<div><strong>{check.label}</strong><small>คาดหวัง: {check.expected} · ได้จริง: {check.actual}</small></div>
              </div>)}
            </div>}
            <div className="component-lab__candidate-actions">
              <button type="button" className="component-lab__button component-lab__button--secondary" onClick={runTests} disabled={!canTest} data-testid="component-lab-run-tests">
                {testing ? <><LoaderCircle className="is-spinning" size={15}/>กำลังตรวจ</> : <><CheckCircle2 size={15}/>{candidate.checks ? 'ตรวจอีกครั้ง' : 'ตรวจการทำงาน'}</>}
              </button>
              <button type="button" className="component-lab__button component-lab__button--primary" onClick={activateCandidate} disabled={!canActivate || testing} data-testid="component-lab-activate">
                <Check size={15}/>ใช้รุ่นนี้
              </button>
            </div>
            {!canActivate && <p className="component-lab__activation-note">ใช้ได้เมื่อการตรวจทุกข้อผ่าน และยังเป็นกฎตั้งต้นชุดเดิม</p>}
            </>}
          </> : <div className="component-lab__empty-work"><div className="component-lab__empty-mark"><FlaskConical size={20}/></div><strong>ยังไม่มีรุ่นทดลอง</strong><span>พิมพ์สิ่งที่อยากเปลี่ยน แล้วสร้างรุ่นแยกมาตรวจดูก่อน</span></div>}
        </div>

        <form className={`component-lab__composer nodrag nowheel nopan${generating?' is-generating':''}`} onSubmit={generate}>
          <label htmlFor="component-lab-prompt"><span><Sparkles size={14}/>สิ่งที่อยากให้เปลี่ยน</span><small>ส่งคำสั่งเมื่อพร้อม ตัวสร้างจะเริ่มทำงานตอนกดปุ่มเท่านั้น</small></label>
          <textarea id="component-lab-prompt" value={prompt} onChange={event => setPrompt(event.target.value)} maxLength={2400} rows={3} placeholder="อธิบายผลลัพธ์ที่อยากได้…" disabled={generating} />
          <div className="component-lab__suggestions" aria-label="ตัวอย่างคำสั่ง">
            {SUGGESTIONS.map(suggestion => <button type="button" key={suggestion} disabled={generating} onClick={() => setPrompt(suggestion)}>{suggestion}</button>)}
          </div>
          <div className="component-lab__composer-actions">
            {generating ? <>
              <span className="component-lab__elapsed"><LoaderCircle size={14} className="is-spinning"/>{cancelling ? 'กำลังยกเลิก' : 'กำลังสร้าง'} · {formatSeconds(elapsedMs)}</span>
              <button type="button" className="component-lab__button component-lab__button--cancel" onClick={cancelGeneration} disabled={cancelling}><X size={14}/>{cancelling ? 'กำลังยกเลิก' : 'ยกเลิก'}</button>
            </> : <>
              <span className="component-lab__local-note">ข้อมูลอยู่ในพื้นที่ทดลองนี้</span>
              <button type="submit" className="component-lab__button component-lab__button--primary" disabled={!availability?.available || !prompt.trim()} data-testid="component-lab-generate">
                <Sparkles size={15}/>{workingArtifact || candidate ? 'สร้างรุ่นทดลอง' : 'สร้างเครื่องมือ'}
              </button>
            </>}
          </div>
          {!generating && !availability?.available && <p className="component-lab__availability-note">{checkingAvailability ? 'กำลังตรวจบริการตัวสร้าง…' : availability?.reason || 'เปิดตัวสร้างในเครื่องก่อน แล้วกลับมาสร้างรุ่นทดลองได้'}</p>}
          {generationError && <p className={`component-lab__error ${generationError.includes('ยกเลิก') ? 'is-muted' : ''}`}><CircleAlert size={14}/>{generationError}</p>}
          {!candidate && candidateError && <p className="component-lab__error">{candidateError}</p>}
        </form>

        {!workingArtifact && !generating && <>
          <input ref={importFileRef} type="file" accept="application/json,.json" hidden onChange={event=>{const file=event.target.files?.[0];if(file)void importExperiment(file);event.target.value='';}}/>
          <button type="button" className="component-lab__button component-lab__button--secondary" onClick={()=>importFileRef.current?.click()}>เปิดชิ้นงานจากไฟล์</button>
          <p className="component-lab__local-note">นำเข้าเฉพาะรุ่นที่ใช้อยู่และผลเคาะ แล้วตรวจซ้ำก่อนใช้ · ไม่สร้างใหม่</p>
        </>}

        {revisions.length > 0 && <button type="button" className="component-lab__button component-lab__button--secondary" onClick={()=>{
          const blob=new Blob([JSON.stringify({format:'procedural-component-lab-v1',activeRevisionId,state:workingStateRef.current,revisions},null,2)],{type:'application/json'});
          const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='procedural-component-experiment.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
        }}>เก็บผลการทดลองเป็นไฟล์</button>}
        {revisions.length > 0 && <details className="component-lab__history">
          <summary><History size={14}/>รุ่นที่เคยใช้ <span>{revisions.length}</span><ChevronDown size={14}/></summary>
          <div className="component-lab__history-list">
            {revisions.map((revision, index) => <article className="component-lab__revision" key={revision.id}>
              <div className="component-lab__revision-top"><div><strong>รุ่น {revisions.length - index} · {revision.artifact.title}</strong><small>{new Date(revision.createdAt).toLocaleString('th-TH')} · {revision.modelId}</small></div>{revision.id === activeRevisionId && <span className="component-lab__active-tag">กำลังใช้</span>}</div>
              <div className="component-lab__revision-metrics"><span>สร้าง {revision.modelMs} ms</span><span>ตรวจ {revision.previewMs} ms</span><span>{revision.checkRows.filter(test => test.passed).length}/{revision.checkRows.length} ผ่าน</span></div>
              <details className="component-lab__revision-detail"><summary>ดูคำสั่งและผลตรวจ</summary><p>{revision.prompt}</p>{revision.checkRows.map(row => <span className={row.passed ? 'is-pass' : 'is-fail'} key={row.label}>{row.passed ? '✓' : '×'} {row.label}: {row.actual}</span>)}</details>
              {revision.id !== activeRevisionId && <button type="button" className="component-lab__rollback" onClick={() => setRollbackId(revision.id)}><RotateCcw size={13}/>สลับกลับรุ่นนี้</button>}
            </article>)}
          </div>
        </details>}

        {rollbackId && revisions.find(revision => revision.id === rollbackId) && <div className="component-lab__confirm" role="alertdialog" aria-labelledby="component-lab-confirm-title">
          <div><strong id="component-lab-confirm-title">สลับกลับรุ่นก่อนหน้า?</strong><span>รุ่นที่ใหม่กว่าจะยังอยู่ในประวัติ และผลการเคาะที่ผ่านมาไม่ถูกลบ</span></div>
          <button type="button" className="component-lab__button component-lab__button--secondary" onClick={() => setRollbackId(null)}>ยกเลิก</button>
          <button type="button" className="component-lab__button component-lab__button--primary" onClick={() => { const revision = revisions.find(item => item.id === rollbackId); if (revision) rollback(revision); }}>สลับรุ่น</button>
        </div>}
      </div>
      <footer className="component-lab__footer nowheel nopan"><span><span className="component-lab__footer-dot"/>รุ่นทดลองแยกจากเครื่องมือที่ใช้อยู่</span><span>เริ่มจาก {seedRef.current} BPM <ChevronRight size={12}/></span></footer>
    </section>
  );
}
