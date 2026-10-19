import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { BookOpenCheck, CheckCircle2, Gauge, RotateCcw, Save, Send, Shapes, Sigma } from 'lucide-react';
import type { Answer, PhysicsParams, TeachingState, WorkspaceView } from '../shared/contracts';
import type { PhysicsResult } from '../domain/physics';
import { CandidateLifecycle } from './WorkbenchShared';
import type { WorkbenchProps } from './types';
import { actorLabel } from './types';

type Representation = 'text' | 'scene' | 'graph';
type Difficulty = 'beginner' | 'advanced';

function calculate(params: PhysicsParams): PhysicsResult {
  const acceleration = params.force / params.mass;
  return { acceleration, velocity: acceleration * params.time, position: 0.5 * acceleration * params.time * params.time };
}

function getPlanPhysics(outputs: WorkbenchProps['plan']['outputs']): PhysicsResult | null {
  const result = outputs['lesson.scene']?.physics ?? outputs['lesson.graph']?.physics ?? outputs['physics.model']?.physics;
  if (typeof result !== 'object' || result === null) return null;
  const value = result as Partial<PhysicsResult>;
  return Number.isFinite(value.acceleration) && Number.isFinite(value.velocity) && Number.isFinite(value.position)
    ? { acceleration: value.acceleration!, velocity: value.velocity!, position: value.position! }
    : null;
}

export function TeachingWorkbench(props: WorkbenchProps) {
  const { view, plan, onCommand, busy } = props;
  if (view.domain.kind !== 'teaching') return null;
  const state: TeachingState = view.domain;
  const isTeacher = view.actor.role === 'teacher';
  const isLearner = view.actor.role === 'learner';
  const currentPlan = getPlanPhysics(plan.outputs);
  const [form, setForm] = useState<PhysicsParams>(state.parameters);
  const [local, setLocal] = useState<PhysicsParams>(state.parameters);
  const [answer, setAnswer] = useState('');
  const [teacherNote, setTeacherNote] = useState(state.teacherNote ?? '');
  const [savedNote, setSavedNote] = useState(state.teacherNote ?? '');
  const [noteSaved, setNoteSaved] = useState(false);
  const representation = state.representations[view.actor.actorId] ?? 'scene';
  const difficulty = state.difficulties[view.actor.actorId] ?? 'beginner';
  const effectiveParams = isLearner ? local : state.parameters;
  const effectiveResult = isLearner ? calculate(local) : currentPlan;
  const visibleAnswers = state.answers.filter((item) => isTeacher || item.actorId === view.actor.actorId);
  const showScene = !isLearner || representation === 'scene';
  const showGraph = !isLearner || representation === 'graph';
  const graphParams = effectiveParams;
  const graphResult = effectiveResult;
  const graphData = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const time = index * 0.5;
    const acceleration = graphParams.force / graphParams.mass;
    return { time, position: 0.5 * acceleration * time * time };
  }), [graphParams.force, graphParams.mass]);

  useEffect(() => {
    setForm(state.parameters);
    setLocal(state.parameters);
    setAnswer('');
  }, [state.parameters, state.ruleRevision]);
  useEffect(() => {
    setTeacherNote(state.teacherNote ?? '');
    setSavedNote(state.teacherNote ?? '');
  }, [state.teacherNote]);

  const updateForm = (key: keyof PhysicsParams, value: number) => setForm((current) => ({ ...current, [key]: value }));
  const updateLocal = (key: keyof PhysicsParams, value: number) => setLocal((current) => ({ ...current, [key]: value }));
  const saveShared = () => { void onCommand('teaching.setParameters', form); };
  const proposeChange = () => { void onCommand('evolve.propose', { change: { kind: 'teaching', parameters: form } }); };
  const setLearnerView = (member: WorkspaceView['members'][number], nextRepresentation: Representation, nextDifficulty: Difficulty) => {
    void onCommand('teaching.setRepresentation', { actorId: member.actorId, representation: nextRepresentation, difficulty: nextDifficulty });
  };
  const submitAnswer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(answer);
    if (Number.isFinite(value)) void onCommand('teaching.answer', { questionId: state.questionId, lessonRevision: state.ruleRevision, value });
  };
  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onCommand('teaching.saveNote', { text: teacherNote }).then((updated) => {
      if (updated) { setSavedNote(teacherNote); setNoteSaved(true); window.setTimeout(() => setNoteSaved(false), 1800); }
    });
  };

  return (
    <div className="tt-workbench-body tt-teaching">
      <section className="tt-case-heading">
        <div><span className="tt-kicker">TEACHING TABLE · {view.actor.role.toUpperCase()}</span><h1>A cart, a force, and one shared model</h1><p>Every view reads the same lesson revision. Learner experiments stay on this device.</p></div>
        <span className="tt-revision-mark"><BookOpenCheck size={15} /> Lesson r{state.ruleRevision}</span>
      </section>

      {showScene && <section className="tt-lesson-scene" aria-label="Horizontal cart physics scene">
        <div className="tt-scene-toolbar"><span><Shapes size={15} /> HORIZONTAL CART · SI UNITS</span><span className="tt-shared-badge">{isLearner ? 'Teacher’s lesson' : 'Shared lesson'}</span></div>
        <svg className="tt-track-svg" viewBox="0 0 720 185" role="img" aria-label={`Cart position ${formatNumber(effectiveResult?.position ?? 0)} meters, velocity ${formatNumber(effectiveResult?.velocity ?? 0)} meters per second`}>
          <defs><pattern id="tt-track-ticks" width="36" height="18" patternUnits="userSpaceOnUse"><path d="M 0 0 L 0 9" fill="none" stroke="#adbdc0" strokeWidth="1" /></pattern></defs>
          <path d="M48 134H672" stroke="#aebbbc" strokeWidth="2" />
          <path d="M48 136H672V149H48Z" fill="url(#tt-track-ticks)" />
          <path d="M48 153H672" stroke="#cfdbd8" strokeWidth="1" />
          <path d={`M60 66 H${64 + Math.min(480, Math.max(0, (effectiveResult?.position ?? 0) * 12))}`} stroke="#5f9a8a" strokeWidth="2" strokeDasharray="5 5" />
          <g transform={`translate(${Math.min(560, Math.max(0, (effectiveResult?.position ?? 0) * 12))} 0)`}>
            <path d="M69 99 L80 82 H144 L155 99 Z" fill="#dce9e6" stroke="#4f8177" strokeWidth="2" />
            <path d="M80 82 L89 70 H130 L144 82 Z" fill="#f5f8f6" stroke="#4f8177" strokeWidth="2" />
            <circle cx="91" cy="103" r="8" fill="#31515a" /><circle cx="136" cy="103" r="8" fill="#31515a" />
            <path d="M107 78V60" stroke="#315eb0" strokeWidth="2" /><path d="M101 68L107 59L113 68" fill="none" stroke="#315eb0" strokeWidth="2" />
          </g>
          <text x="48" y="29" className="tt-scene-force">F {formatNumber(effectiveParams.force)} N</text>
          <text x="48" y="48" className="tt-scene-mass">m {formatNumber(effectiveParams.mass)} kg</text>
          <text x="580" y="29" className="tt-scene-mass">t {formatNumber(effectiveParams.time)} s</text>
          <text x="48" y="176" className="tt-scene-mass">0 m</text>
          <text x="621" y="176" className="tt-scene-mass">Position</text>
        </svg>
        <div className="tt-physics-readout"><div><span>Acceleration</span><strong>{effectiveResult ? `${formatNumber(effectiveResult.acceleration)} m/s²` : 'Unknown'}</strong></div><div><span>Velocity at t</span><strong>{effectiveResult ? `${formatNumber(effectiveResult.velocity)} m/s` : 'Unknown'}</strong></div><div><span>Position at t</span><strong>{effectiveResult ? `${formatNumber(effectiveResult.position)} m` : 'Unknown'}</strong></div></div>
        {isLearner && <span className="tt-local-label">Local experiment · only you can see these values until you reset</span>}
      </section>}

      {isLearner && <section className="tt-section tt-private-lab" aria-labelledby="tt-local-title"><header className="tt-section__header"><div><span className="tt-kicker">PRIVATE SANDBOX</span><h2 id="tt-local-title">Try your own values</h2></div><button className="tt-text-button" type="button" onClick={() => setLocal(state.parameters)}><RotateCcw size={14} /> Reset to teacher</button></header><ParameterFields value={local} onChange={updateLocal} /><p className="tt-section-intro">This local experiment does not change the shared lesson or other learners’ view.</p></section>}

      {isTeacher && <section className="tt-section" aria-labelledby="tt-lesson-controls-title"><header className="tt-section__header"><div><span className="tt-kicker">SHARED LESSON</span><h2 id="tt-lesson-controls-title">Set force, mass, and time</h2></div><span className="tt-status-pill tt-status-pill--active">Current lesson r{state.ruleRevision}</span></header><ParameterFields value={form} onChange={updateForm} /><div className="tt-lesson-edit-actions"><button className="tt-button tt-button--primary" type="button" disabled={busy !== null || !!state.candidate && state.candidate.status !== 'active' || form.force === state.parameters.force && form.mass === state.parameters.mass && form.time === state.parameters.time} onClick={saveShared}><Save size={14} /> Update shared lesson</button><button className="tt-button tt-button--quiet" type="button" disabled={busy !== null || !!state.candidate && state.candidate.status !== 'active'} onClick={proposeChange}><Sigma size={14} /> Propose through review</button></div><p className="tt-section-intro">Updating the lesson starts a new question revision. A proposal stays in Draft until it passes the review steps.</p></section>}

      {isLearner && <section className="tt-section tt-answer-card" aria-labelledby="tt-answer-title"><header className="tt-section__header"><div><span className="tt-kicker">QUESTION · REVISION {state.ruleRevision}</span><h2 id="tt-answer-title">Where will the cart be?</h2></div><span className="tt-question-mark"><Sigma size={16} /></span></header><p>Use the teacher’s shared values. What position does the cart reach after {formatNumber(state.parameters.time)} seconds?</p><form className="tt-answer-form" onSubmit={submitAnswer}><label htmlFor="tt-answer-value">Position in meters</label><div><input id="tt-answer-value" type="number" step="any" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="For example, 10" required /><button className="tt-button tt-button--primary" type="submit" disabled={busy !== null || !answer}><Send size={14} /> Check answer</button></div><small>Your answer is private to you and your teacher.</small></form>
        {visibleAnswers.filter((item) => item.actorId === view.actor.actorId).slice(-1).map((item) => <AnswerFeedback key={`${item.questionId}-${item.submittedAt}`} answer={item} />)}
      </section>}

      {isTeacher && <section className="tt-section" aria-labelledby="tt-view-controls-title"><header className="tt-section__header"><div><span className="tt-kicker">PER LEARNER</span><h2 id="tt-view-controls-title">Choose how each learner sees the model</h2></div></header><div className="tt-learner-settings">{view.members.filter((member) => member.role === 'learner').map((member) => <LearnerSetting key={member.actorId} member={member} value={state.representations[member.actorId] ?? 'scene'} difficulty={state.difficulties[member.actorId] ?? 'beginner'} disabled={busy !== null} onSave={setLearnerView} />)}{view.members.every((member) => member.role !== 'learner') && <div className="tt-empty-note"><Gauge size={16} /><p>Invite a learner to choose a personal lesson view.</p></div>}</div></section>}

      {isTeacher && <section className="tt-section" aria-labelledby="tt-answers-title"><header className="tt-section__header"><div><span className="tt-kicker">LEARNER ANSWERS</span><h2 id="tt-answers-title">Responses from this lesson</h2></div><span className="tt-count-mark">{visibleAnswers.length}</span></header>{visibleAnswers.length === 0 ? <div className="tt-empty-note"><BookOpenCheck size={16} /><p>Answers appear here after a learner submits one.</p></div> : <div className="tt-answer-list">{visibleAnswers.map((item) => <AnswerFeedback key={`${item.actorId}-${item.questionId}-${item.submittedAt}`} answer={item} learnerName={actorLabel(view, item.actorId)} />)}</div>}</section>}

      {isTeacher && <section className="tt-section" aria-labelledby="tt-note-title"><header className="tt-section__header"><div><span className="tt-kicker">TEACHER NOTE · PRIVATE</span><h2 id="tt-note-title">Keep a note for this lesson</h2></div><span className="tt-private-lock">Teacher only</span></header><form className="tt-note-form" onSubmit={saveNote}><label className="tt-visually-hidden" htmlFor="tt-teacher-note">Private teacher note</label><textarea id="tt-teacher-note" maxLength={2000} rows={3} value={teacherNote} onChange={(event) => setTeacherNote(event.target.value)} placeholder="Write a reminder for your next lesson…" /><div><small>{teacherNote.length}/2000 characters{savedNote !== teacherNote ? ' · Unsaved changes' : ''}</small><button className="tt-button tt-button--quiet" type="submit" disabled={busy !== null || savedNote === teacherNote}><Save size={14} /> {noteSaved ? 'Saved' : 'Save note'}</button></div></form></section>}

      {showGraph && <PhysicsGraph params={graphParams} data={graphData} result={graphResult} local={isLearner} />}
      {representation === 'text' && isLearner && <section className="tt-section tt-model-text"><header className="tt-section__header"><div><span className="tt-kicker">TEXT VIEW · {difficulty.toUpperCase()}</span><h2>One model, three values</h2></div></header><p>Acceleration is force divided by mass. Velocity grows by acceleration over time. Position grows with half the acceleration multiplied by time squared.</p><code>a = F ÷ m</code><code>v = a × t</code><code>x = ½ × a × t²</code></section>}

      {isTeacher && <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />}
      <section className="tt-footer-note"><CheckCircle2 size={14} /><span>Model: a = F/m, v = a×t, x = ½at². These are deterministic results from the shared lesson parameters.</span></section>
    </div>
  );
}

function ParameterFields({ value, onChange }: { value: PhysicsParams; onChange: (key: keyof PhysicsParams, value: number) => void }) {
  return <div className="tt-parameter-fields"><ParameterField label="Force" unit="N" min={0} max={20} step={0.5} value={value.force} onChange={(next) => onChange('force', next)} /><ParameterField label="Mass" unit="kg" min={0.5} max={10} step={0.5} value={value.mass} onChange={(next) => onChange('mass', next)} /><ParameterField label="Time" unit="s" min={0} max={5} step={0.5} value={value.time} onChange={(next) => onChange('time', next)} /></div>;
}

function ParameterField({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void }) {
  return <label className="tt-parameter-field"><span>{label} <small>{unit}</small></span><div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={`${label}, ${unit}`} /><input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={`${label} value in ${unit}`} /></div></label>;
}

function LearnerSetting({ member, value, difficulty, disabled, onSave }: { member: WorkspaceView['members'][number]; value: Representation; difficulty: Difficulty; disabled: boolean; onSave: (member: WorkspaceView['members'][number], representation: Representation, difficulty: Difficulty) => void }) {
  const [representation, setRepresentation] = useState<Representation>(value);
  const [level, setLevel] = useState<Difficulty>(difficulty);
  useEffect(() => { setRepresentation(value); setLevel(difficulty); }, [value, difficulty]);
  return <form className="tt-learner-setting" onSubmit={(event) => { event.preventDefault(); onSave(member, representation, level); }}><div className="tt-learner-setting__member"><i aria-hidden="true">{member.name.slice(0, 1).toUpperCase()}</i><span><strong>{member.name}</strong><small>{member.seat ?? 'Learner'}</small></span></div><label>View<select value={representation} onChange={(event) => setRepresentation(event.target.value as Representation)}><option value="text">Text</option><option value="scene">Scene</option><option value="graph">Graph</option></select></label><label>Level<select value={level} onChange={(event) => setLevel(event.target.value as Difficulty)}><option value="beginner">Beginner</option><option value="advanced">Advanced</option></select></label><button type="submit" className="tt-button tt-button--quiet" disabled={disabled || representation === value && level === difficulty}><Save size={13} /> Save</button></form>;
}

function PhysicsGraph({ params, data, result, local }: { params: PhysicsParams; data: { time: number; position: number }[]; result: PhysicsResult | null; local: boolean }) {
  return <section className="tt-section tt-graph-section" aria-labelledby="tt-graph-title"><header className="tt-section__header"><div><span className="tt-kicker">GRAPH · {local ? 'LOCAL EXPERIMENT' : 'COMPUTED FROM SHARED VALUES'}</span><h2 id="tt-graph-title">Position over time</h2></div><strong className="tt-graph-current">{result ? `${formatNumber(result.position)} m at ${formatNumber(params.time)} s` : 'No current model result'}</strong></header><div className="tt-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 12, right: 12, bottom: 0, left: 0 }}><CartesianGrid stroke="#e4e9e8" vertical={false} /><XAxis dataKey="time" type="number" domain={[0, 5]} tick={{ fill: '#778683', fontSize: 10 }} tickLine={false} axisLine={{ stroke: '#ccd6d3' }} label={{ value: 'Time (s)', position: 'insideBottom', offset: -4, fill: '#778683', fontSize: 10 }} /><YAxis tick={{ fill: '#778683', fontSize: 10 }} tickLine={false} axisLine={false} width={46} label={{ value: 'Position (m)', angle: -90, position: 'insideLeft', fill: '#778683', fontSize: 10 }} /><Tooltip formatter={(value) => [`${formatNumber(Number(value))} m`, 'Position']} labelFormatter={(value) => `${value} s`} contentStyle={{ border: '1px solid #dce4e1', borderRadius: 8, color: '#243548', fontSize: 12 }} /><ReferenceLine x={params.time} stroke="#315eb0" strokeDasharray="4 4" /><Line type="monotone" dataKey="position" stroke="#24796b" strokeWidth={2.3} dot={false} activeDot={{ r: 4, fill: '#315eb0' }} /></LineChart></ResponsiveContainer></div><p className="tt-chart-caption">At force {formatNumber(params.force)} N and mass {formatNumber(params.mass)} kg, the plotted curve follows x = ½(F/m)t². {local && 'These values remain local to this learner.'}</p></section>;
}

function AnswerFeedback({ answer, learnerName }: { answer: Answer; learnerName?: string }) {
  return <article className={`tt-answer-feedback${answer.correct ? ' is-correct' : ' is-hint'}`}><span className="tt-answer-feedback__icon">{answer.correct ? <CheckCircle2 size={15} /> : <Sigma size={15} />}</span><div><strong>{learnerName ? `${learnerName} · ` : ''}{answer.correct ? 'Correct' : 'Worked hint'}</strong><p>{answer.feedback}</p></div><small>{formatNumber(answer.value)} m</small></article>;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value);
}
