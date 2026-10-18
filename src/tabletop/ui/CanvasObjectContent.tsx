import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Activity, BookOpenCheck, Check, CheckCircle2, Clock3, FileText, Heart, Plus, RotateCcw, Save, Send, Shield, ShieldCheck, Sigma, Target } from 'lucide-react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { EncounterRule, EncounterState, InvoiceResult, InvoiceState, PhysicsParams, TeachingState, WorkspaceView, Zone } from '../shared/contracts';
import type { PhysicsResult } from '../domain/physics';
import { calculatePhysics } from '../domain/physics';
import type { PlanNode, ReviewItem } from '../runtime';
import { CandidateLifecycle, EvidenceList, UploadCard } from './WorkbenchShared';
import type { Command, WorkbenchProps } from './types';
import { formatMoney } from './types';

interface CanvasObjectContentProps {
  view: WorkspaceView;
  node: PlanNode;
  outputs: Record<string, unknown>;
  busy: string | null;
  onCommand: Command;
  onUpload: WorkbenchProps['onUpload'];
  onFocusEvidence: (sourceIds: string[]) => void;
  focusSourceIds: string[];
  localPhysics: PhysicsParams;
  onLocalPhysicsChange: (value: PhysicsParams) => void;
  onResetLocalPhysics: () => void;
}

export function CanvasObjectContent(props: CanvasObjectContentProps) {
  switch (props.node.id) {
    case 'invoice.source': return <InvoiceSources {...props} />;
    case 'invoice.table': return <InvoiceTable {...props} />;
    case 'invoice.review': return <InvoiceReview {...props} />;
    case 'invoice.rules': return <InvoiceRules {...props} />;
    case 'lesson.source': return <LessonSource {...props} />;
    case 'lesson.scene': return <LessonScene {...props} />;
    case 'lesson.graph': return <LessonGraph {...props} />;
    case 'lesson.question': return <LessonQuestion {...props} />;
    case 'encounter.source': return <EncounterSource {...props} />;
    case 'encounter.board': return <EncounterBoardObject {...props} />;
    case 'encounter.actions': return <EncounterActions {...props} />;
    default: return <div className="tt-canvas-inline__empty">This connected object is ready for input.</div>;
  }
}

function InlineHeading({ eyebrow, title, status }: { eyebrow: string; title: string; status?: string }) {
  return <div className="tt-canvas-inline__heading"><span className="tt-kicker">{eyebrow}</span><strong>{title}</strong>{status && <small>{status}</small>}</div>;
}

function InvoiceSources(props: CanvasObjectContentProps) {
  if (props.view.domain.kind !== 'invoice') return null;
  const { view, onUpload, busy, focusSourceIds, onCommand, onFocusEvidence } = props;
  const state = view.domain as InvoiceState;
  return <div className="tt-canvas-inline tt-canvas-inline--invoice">
    <InlineHeading eyebrow="SOURCE FILES" title="Documents and evidence" status={state.sources.length + ' files'} />
    {view.actor.role === 'owner' && state.shipments.length === 0 && state.invoiceLines.length === 0 && <div className="tt-inline-empty-actions"><span>No invoice rows yet</span><button type="button" className="tt-button tt-button--primary" disabled={busy !== null} onClick={() => void onCommand('invoice.sample', {})}><FileText size={13} /> Load included example</button></div>}
    {view.actor.role === 'owner' ? <div className="tt-inline-upload-grid">
      <UploadCard kind="shipments" title="Shipment CSV" description="Dates, zone, and weight." onUpload={onUpload} busy={busy !== null} />
      <UploadCard kind="invoice" title="Invoice PDF" description="Text PDF in the supported layout." onUpload={onUpload} busy={busy !== null} />
      <UploadCard kind="rate-card" title="Rate card PDF" description="Dated rates for review." onUpload={onUpload} busy={busy !== null} />
    </div> : <p className="tt-canvas-inline__note">The table owner can add files. Open a source below to inspect its extracted text.</p>}
    {view.actor.role === 'owner' && <><p className="tt-canvas-inline__note">A new import replaces the current shipment or invoice rows; saved runs, source documents, and approved rates stay available for the next period.</p><nav className="tt-inline-samples" aria-label="Download sample files"><a href="/samples/r1/shipments.csv" download>Shipment CSV sample</a><a href="/samples/r1/invoice.pdf" download>Invoice PDF sample</a><a href="/samples/r1/rate-card.pdf" download>Rate card PDF sample</a></nav></>}
    <EvidenceList view={view} focusSourceIds={focusSourceIds} onFocusEvidence={onFocusEvidence} onCommand={onCommand} busy={busy} />
  </div>;
}

function InvoiceTable({ node, onFocusEvidence }: CanvasObjectContentProps) {
  const result = node.inputs.result as InvoiceResult | undefined;
  const rows = result?.rows ?? [];
  const hasSurcharge = rows.some((row) => row.surchargeSatang !== null && row.surchargeSatang > 0);
  return <div className="tt-canvas-inline tt-canvas-inline--wide">
    <InlineHeading eyebrow="ACTIVE RESULT" title="Shipment reconciliation" status={(result?.unknownCount ?? 0) + ' unknown'} />
    {!result ? <div className="tt-canvas-inline__empty">Add shipment and invoice sources or load the example to calculate this table.</div> : rows.length === 0 ? <div className="tt-canvas-inline__empty">No shipment rows yet. Add a shipment CSV and invoice PDF.</div> : <>
      <div className="tt-inline-kpis"><span>Expected <strong>{formatMoney(result.knownExpectedSatang)}</strong></span><span>Billed <strong>{formatMoney(result.knownBilledSatang)}</strong></span><span>Difference <strong>{formatSignedMoney(result.deltaSatang)}</strong></span></div>
      <div className="tt-inline-table-scroll"><table className="tt-inline-table"><caption className="tt-visually-hidden">Select a shipment to open its exact source evidence</caption><thead><tr><th scope="col">Shipment</th><th scope="col">Billed</th><th scope="col">Expected</th>{hasSurcharge && <th scope="col">Extra</th>}<th scope="col">Check</th></tr></thead><tbody>
        {rows.slice(0, 6).map((row) => {
          const needsReview = row.expectedSatang === null || row.billedSatang === null || row.reasons.length > 0 || row.deltaSatang !== 0;
          return <tr key={row.key} tabIndex={0} onClick={() => onFocusEvidence(row.sourceIds)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onFocusEvidence(row.sourceIds); } }} aria-label={row.shipmentId + ', ' + (needsReview ? 'needs review' : 'matches') + ', open evidence'}>
            <th scope="row"><strong>{row.shipmentId}</strong><small>{row.zone ?? 'Zone unknown'} · {row.date || 'Date unknown'}</small></th>
            <td>{row.billedSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.billedSatang)}</td>
            <td>{row.expectedSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.expectedSatang)}</td>
            {hasSurcharge && <td>{row.surchargeSatang === null ? <span className="tt-unknown">Unknown</span> : formatMoney(row.surchargeSatang)}</td>}
            <td><span className={'tt-row-status' + (needsReview ? ' is-review' : ' is-clear')}>{row.expectedSatang === null || row.billedSatang === null ? 'Unknown' : needsReview ? 'Review' : 'Matches'}</span></td>
          </tr>;
        })}
      </tbody></table></div>
      {rows.length > 6 && <p className="tt-canvas-inline__note">Showing 6 of {rows.length} rows. Open the focused table for the full result.</p>}
      {result.gaps.length > 0 && <div className="tt-inline-gaps"><strong>{result.gaps.length} evidence request{result.gaps.length === 1 ? '' : 's'}</strong>{result.gaps.slice(0, 3).map((gap) => <span key={gap.id}>{gap.documentType}: {gap.whyNeeded}</span>)}</div>}
    </>}
  </div>;
}

function InvoiceReview({ node, onFocusEvidence }: CanvasObjectContentProps) {
  const items = (node.inputs.items as ReviewItem[] | undefined) ?? [];
  return <div className="tt-canvas-inline">
    <InlineHeading eyebrow="DERIVED REVIEW" title="Rows needing evidence" status={items.length + ' items'} />
    {items.length === 0 ? <div className="tt-canvas-inline__empty"><CheckCircle2 size={15} /> No linked review items in this result.</div> : <div className="tt-inline-review-list">{items.slice(0, 8).map((item) => <button type="button" key={item.id} onClick={() => onFocusEvidence(item.sourceIds)}><span><strong>{item.shipmentId}</strong><small>{item.reason}</small></span><FileText size={14} aria-hidden="true" /></button>)}</div>}
    {items.length > 8 && <p className="tt-canvas-inline__note">Showing 8 of {items.length} linked review items.</p>}
  </div>;
}

function InvoiceRules({ view, onCommand, busy }: CanvasObjectContentProps) {
  const state = view.domain as InvoiceState;
  const verifiedRates = state.sources.filter((source) => source.status === 'verified' && (source.kind === 'rate-card' || source.kind === 'excerpt'));
  const [family, setFamily] = useState<'base' | 'step' | 'surcharge'>('base');
  const [zone, setZone] = useState<Zone | '*'>('bangkok');
  const [amount, setAmount] = useState('3500');
  const [from, setFrom] = useState(todayBangkok());
  const [to, setTo] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [error, setError] = useState('');
  const [existingId, setExistingId] = useState('');
  const canEdit = view.actor.role === 'owner';
  const propose = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    const satang = Number(amount);
    if (!Number.isSafeInteger(satang) || satang < 0) { setError('Enter a whole amount in satang.'); return; }
    if (!from || (to && to <= from)) { setError('The end date must follow the start date.'); return; }
    if (!sourceId) { setError('Choose a verified rate card or excerpt.'); return; }
    void onCommand('evolve.propose', { change: { kind: 'invoice', operations: [{ op: family === 'base' ? 'setZoneBase' : family === 'step' ? 'setWeightStep' : 'setSurcharge', id: existingId || 'rule-' + crypto.randomUUID(), zone, amountSatang: satang, from, to: to || null, sourceId }] } });
  };
  return <div className="tt-canvas-inline">
    <InlineHeading eyebrow="ACTIVE RATE RULES" title="Dated rate rules" status={'Active r' + state.ruleRevision} />
    <span className="tt-inline-ai-status">Manual rules · live AI not configured</span>
    {state.rules.length === 0 ? <div className="tt-canvas-inline__empty">No rate rules are active. Load the example or draft a rule from verified evidence.</div> : <div className="tt-inline-rule-list">{state.rules.filter((rule) => rule.enabled).slice(0, 4).map((rule) => <div key={rule.id}><span><strong>{rule.kind === 'base' ? 'Zone base' : rule.kind === 'step' ? 'Extra kg' : 'Remote surcharge'} · {rule.zone}</strong><small>{rule.from} to {rule.to ?? 'open end'}</small></span><b>{formatMoney(rule.amountSatang)}</b></div>)}</div>}
    {!canEdit ? <p className="tt-canvas-inline__note">Only the table owner can change these rules.</p> : <form className="tt-inline-rule-form" onSubmit={propose}>
      <label>Rate family<select value={family} onChange={(event) => setFamily(event.target.value as typeof family)}><option value="base">Zone base</option><option value="step">Each started extra kg</option><option value="surcharge">Remote surcharge</option></select></label>
      <label>Existing rule<select value={existingId} onChange={(event) => { const id = event.target.value; setExistingId(id); const rule = state.rules.find((item) => item.id === id); if (rule) { setFamily(rule.kind); setZone(rule.zone); setAmount(String(rule.amountSatang)); setFrom(rule.from); setTo(rule.to ?? ''); setSourceId(rule.sourceId); } }}><option value="">Add a new dated rule</option>{state.rules.map((rule) => <option key={rule.id} value={rule.id}>{rule.kind} · {rule.zone} · {rule.from}</option>)}</select></label>
      <div className="tt-inline-rule-row"><label>Zone<select value={zone} onChange={(event) => setZone(event.target.value as Zone | '*')}><option value="bangkok">Bangkok</option><option value="regional">Regional</option><option value="*">All zones</option></select></label><label>Amount (satang)<input type="number" inputMode="numeric" min="0" step="1" value={amount} onChange={(event) => setAmount(event.target.value)} required /></label></div>
      <div className="tt-inline-rule-row"><label>Start · inclusive<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} required /></label><label>End · exclusive<input type="date" min={from} value={to} onChange={(event) => setTo(event.target.value)} /></label></div>
      <label>Verified rate evidence<select value={sourceId} onChange={(event) => setSourceId(event.target.value)}><option value="">Choose source</option>{verifiedRates.map((source) => <option key={source.id} value={source.id}>{source.filename}</option>)}</select></label>
      {error && <span className="tt-field-error" role="alert">{error}</span>}
      {verifiedRates.length === 0 && <p className="tt-canvas-inline__note">Verify a rate card or excerpt in the source object before drafting a rule.</p>}
      <button type="submit" className="tt-button tt-button--primary" disabled={busy !== null || verifiedRates.length === 0}><Plus size={13} /> Propose dated rule</button>
    </form>}
    {canEdit && <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />}
  </div>;
}

function LessonSource({ view, busy, onCommand, localPhysics, onLocalPhysicsChange, onResetLocalPhysics }: CanvasObjectContentProps) {
  const state = view.domain as TeachingState;
  const isLearner = view.actor.role === 'learner';
  const [draft, setDraft] = useState<PhysicsParams>(state.parameters);
  useEffect(() => { setDraft(state.parameters); }, [state.parameters.force, state.parameters.mass, state.parameters.time]);
  const value = isLearner ? localPhysics : draft;
  const change = (key: keyof PhysicsParams, next: number) => isLearner
    ? onLocalPhysicsChange({ ...localPhysics, [key]: next })
    : setDraft((current) => ({ ...current, [key]: next }));
  return <div className={'tt-canvas-inline' + (isLearner ? ' tt-canvas-inline--private' : '')}>
    <InlineHeading eyebrow={isLearner ? 'LOCAL EXPERIMENT' : 'SHARED LESSON'} title="Force, mass, and time" status={isLearner ? 'Private' : 'Lesson r' + state.ruleRevision} />
    <ParameterFields value={value} onChange={change} />
    {isLearner ? <><p className="tt-canvas-inline__note">These values stay on this device. Your teacher’s lesson is unchanged.</p><button className="tt-text-button" type="button" onClick={onResetLocalPhysics}><RotateCcw size={13} /> Reset to teacher values</button></> : <div className="tt-inline-action-row">
      <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || sameParams(draft, state.parameters) || (!!state.candidate && state.candidate.status !== 'active')} onClick={() => void onCommand('teaching.setParameters', draft)}><Save size={13} /> Update lesson</button>
      <button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || sameParams(draft, state.parameters) || (!!state.candidate && state.candidate.status !== 'active')} onClick={() => void onCommand('evolve.propose', { change: { kind: 'teaching', parameters: draft } })}><Sigma size={13} /> Propose review</button>
    </div>}
  </div>;
}

function ParameterFields({ value, onChange }: { value: PhysicsParams; onChange: (key: keyof PhysicsParams, next: number) => void }) {
  return <div className="tt-parameter-fields tt-inline-parameters">
    <ParameterField label="Force" unit="N" min={0} max={20} step={0.5} value={value.force} onChange={(next) => onChange('force', next)} />
    <ParameterField label="Mass" unit="kg" min={0.5} max={10} step={0.5} value={value.mass} onChange={(next) => onChange('mass', next)} />
    <ParameterField label="Time" unit="s" min={0} max={5} step={0.5} value={value.time} onChange={(next) => onChange('time', next)} />
  </div>;
}

function ParameterField({ label, unit, min, max, step, value, onChange }: { label: string; unit: string; min: number; max: number; step: number; value: number; onChange: (next: number) => void }) {
  return <label className="tt-parameter-field"><span>{label}<small>{unit}</small></span><div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label + ', ' + unit} /><input type="number" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} aria-label={label + ' value in ' + unit} /></div></label>;
}

function LessonScene({ view, node, localPhysics }: CanvasObjectContentProps) {
  if (view.domain.kind !== 'teaching') return null;
  const state: TeachingState = view.domain;
  const learner = view.actor.role === 'learner';
  const representation = state.representations[view.actor.actorId] ?? 'scene';
  const difficulty = state.difficulties[view.actor.actorId] ?? 'beginner';
  const params = learner ? localPhysics : state.parameters;
  const typed = node.inputs.physics as PhysicsResult | undefined;
  const result = learner ? calculatePhysics(params) : typed ?? calculatePhysics(params);
  const cartX = Math.min(430, Math.max(0, result.position * 14));
  return <div className="tt-canvas-inline tt-canvas-inline--scene">
    <InlineHeading eyebrow="SCENE · SI UNITS" title="Horizontal cart" status={learner ? 'Teacher’s lesson' : 'Shared'} />
    {learner && representation === 'text' ? <div className="tt-model-text"><span className="tt-kicker">TEXT VIEW · {difficulty.toUpperCase()}</span><p>Acceleration equals force divided by mass. Velocity grows with time; position follows half the acceleration multiplied by time squared.</p><code>a = F ÷ m</code><code>v = a × t</code><code>x = ½at²</code></div> : <>
      <svg className="tt-track-svg tt-inline-track" viewBox="0 0 560 140" role="img" aria-label={'Cart travels ' + number(result.position) + ' meters in ' + number(params.time) + ' seconds'}>
        <path d="M28 103H532" stroke="#aebbbc" strokeWidth="2" /><path d="M28 105H532V117H28Z" fill="#e6eeeb" />
        {Array.from({ length: 15 }, (_, index) => <path key={index} d={'M' + (28 + index * 36) + ' 105v8'} stroke="#aebbbc" strokeWidth="1" />)}
        <path d={'M35 51H' + Math.max(35, 78 + cartX)} stroke="#5f9a8a" strokeWidth="2" strokeDasharray="5 5" />
        <g transform={'translate(' + cartX + ' 0)'}><path d="M79 79 90 60h55l14 19Z" fill="#dce9e6" stroke="#4f8177" strokeWidth="2" /><path d="M91 60 101 49h34l10 11Z" fill="#f5f8f6" stroke="#4f8177" strokeWidth="2" /><circle cx="97" cy="83" r="7" fill="#31515a" /><circle cx="143" cy="83" r="7" fill="#31515a" /><path d="M117 45V28m-6 8 6-8 6 8" fill="none" stroke="#315eb0" strokeWidth="2" /></g>
        <text x="28" y="22" className="tt-scene-force">F {number(params.force)} N</text><text x="28" y="39" className="tt-scene-mass">m {number(params.mass)} kg</text><text x="450" y="22" className="tt-scene-mass">t {number(params.time)} s</text><text x="475" y="133" className="tt-scene-mass">Position</text>
      </svg>
      <div className="tt-physics-readout"><div><span>a</span><strong>{number(result.acceleration)} m/s²</strong></div><div><span>v at t</span><strong>{number(result.velocity)} m/s</strong></div><div><span>x at t</span><strong>{number(result.position)} m</strong></div></div>
      {learner && <span className="tt-local-label">Local experiment · only you can see these values</span>}
    </>}
  </div>;
}

function LessonGraph({ view, node, localPhysics }: CanvasObjectContentProps) {
  const state = view.domain as TeachingState;
  const learner = view.actor.role === 'learner';
  const params = learner ? localPhysics : state.parameters;
  const typed = node.inputs.physics as PhysicsResult | undefined;
  const current = learner ? calculatePhysics(params) : typed ?? calculatePhysics(params);
  const data = useMemo(() => Array.from({ length: 11 }, (_, index) => {
    const time = index * 0.5;
    const acceleration = params.force / params.mass;
    return { time, position: 0.5 * acceleration * time * time };
  }), [params.force, params.mass]);
  return <div className="tt-canvas-inline tt-canvas-inline--graph">
    <InlineHeading eyebrow="TYPED MODEL OUTPUT" title="Position over time" status={number(current.position) + ' m at ' + number(params.time) + ' s'} />
    <div className="tt-inline-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 5, bottom: 2, left: -18 }}><CartesianGrid stroke="#e4e9e8" vertical={false} /><XAxis dataKey="time" type="number" domain={[0, 5]} tick={{ fill: '#778683', fontSize: 8 }} tickLine={false} axisLine={{ stroke: '#ccd6d3' }} /><YAxis tick={{ fill: '#778683', fontSize: 8 }} tickLine={false} axisLine={false} width={40} /><Tooltip formatter={(value) => [number(Number(value)) + ' m', 'Position']} labelFormatter={(value) => value + ' s'} contentStyle={{ border: '1px solid #dce4e1', borderRadius: 6, color: '#243548', fontSize: 10 }} /><ReferenceLine x={params.time} stroke="#315eb0" strokeDasharray="3 3" /><Line type="monotone" dataKey="position" stroke="#24796b" strokeWidth={2.2} dot={false} activeDot={{ r: 3, fill: '#315eb0' }} /></LineChart></ResponsiveContainer></div>
    <p className="tt-canvas-inline__note">x = ½(F/m)t² · {number(params.force)} N · {number(params.mass)} kg {learner ? '· local to this learner' : '· shared lesson'}</p>
  </div>;
}

function LessonQuestion({ view, busy, onCommand }: CanvasObjectContentProps) {
  const state = view.domain as TeachingState;
  const isTeacher = view.actor.role === 'teacher';
  const isLearner = view.actor.role === 'learner';
  const [answer, setAnswer] = useState('');
  const [note, setNote] = useState(state.teacherNote ?? '');
  useEffect(() => { setNote(state.teacherNote ?? ''); }, [state.teacherNote]);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = Number(answer);
    if (Number.isFinite(value)) void onCommand('teaching.answer', { questionId: state.questionId, lessonRevision: state.ruleRevision, value });
  };
  const saveNote = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onCommand('teaching.saveNote', { text: note });
  };
  const visibleAnswers = state.answers.filter((item) => isTeacher || item.actorId === view.actor.actorId);
  return <div className="tt-canvas-inline">
    <InlineHeading eyebrow={isTeacher ? 'TEACHER PANEL' : 'PRIVATE QUESTION'} title={isLearner ? 'Check your understanding' : 'Learner views and responses'} status={'Revision ' + state.ruleRevision} />
    {isLearner && <section className="tt-inline-question"><p>Where will the cart be after {number(state.parameters.time)} seconds? Use the teacher’s shared values.</p><form className="tt-answer-form" onSubmit={submit}><label htmlFor="tt-canvas-answer">Position in meters</label><div><input id="tt-canvas-answer" type="number" step="any" value={answer} onChange={(event) => setAnswer(event.target.value)} placeholder="For example, 10" required /><button className="tt-button tt-button--primary" type="submit" disabled={busy !== null || !answer}><Send size={13} /> Check answer</button></div><small>Your response is private to you and your teacher.</small></form>{visibleAnswers.slice(-1).map((item) => <AnswerCard key={item.questionId + '-' + item.submittedAt} item={item} name="Your response" />)}</section>}
    {isTeacher && <>
      <div className="tt-inline-learners">{view.members.filter((member) => member.role === 'learner').map((member) => <LearnerViewRow key={member.actorId} member={member} representation={state.representations[member.actorId] ?? 'scene'} difficulty={state.difficulties[member.actorId] ?? 'beginner'} disabled={busy !== null} onSave={(representation, difficulty) => void onCommand('teaching.setRepresentation', { actorId: member.actorId, representation, difficulty })} />)}</div>
      <div className="tt-inline-answers"><strong>{visibleAnswers.length} learner response{visibleAnswers.length === 1 ? '' : 's'}</strong>{visibleAnswers.length === 0 ? <span>Responses appear here after learners submit.</span> : visibleAnswers.slice(-3).map((item) => <AnswerCard key={item.actorId + '-' + item.questionId + '-' + item.submittedAt} item={item} name={view.members.find((member) => member.actorId === item.actorId)?.name ?? 'Learner'} />)}</div>
      <form className="tt-note-form tt-inline-note-form" onSubmit={saveNote}><label htmlFor="tt-canvas-teacher-note">Private teacher note</label><textarea id="tt-canvas-teacher-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="A note only you can see…" /><div><small>Teacher only · {note.length}/2000</small><button className="tt-button tt-button--quiet" type="submit" disabled={busy !== null || note === (state.teacherNote ?? '')}><Save size={13} /> Save note</button></div></form>
      <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />
    </>}
    {!isTeacher && !isLearner && <div className="tt-canvas-inline__empty"><BookOpenCheck size={15} /> This table view does not have question controls.</div>}
  </div>;
}

function LearnerViewRow({ member, representation: initialRepresentation, difficulty: initialDifficulty, disabled, onSave }: { member: WorkspaceView['members'][number]; representation: 'text' | 'scene' | 'graph'; difficulty: 'beginner' | 'advanced'; disabled: boolean; onSave: (representation: 'text' | 'scene' | 'graph', difficulty: 'beginner' | 'advanced') => void }) {
  const [representation, setRepresentation] = useState(initialRepresentation);
  const [difficulty, setDifficulty] = useState(initialDifficulty);
  useEffect(() => { setRepresentation(initialRepresentation); setDifficulty(initialDifficulty); }, [initialRepresentation, initialDifficulty]);
  return <div className="tt-inline-learner"><span><strong>{member.name}</strong><small>{member.seat ?? 'Learner'}</small></span><label>View<select value={representation} onChange={(event) => setRepresentation(event.target.value as typeof representation)}><option value="text">Text</option><option value="scene">Scene</option><option value="graph">Graph</option></select></label><label>Level<select value={difficulty} onChange={(event) => setDifficulty(event.target.value as typeof difficulty)}><option value="beginner">Beginner</option><option value="advanced">Advanced</option></select></label><button className="tt-icon-button" type="button" aria-label={'Save ' + member.name + ' lesson view'} disabled={disabled || (representation === initialRepresentation && difficulty === initialDifficulty)} onClick={() => onSave(representation, difficulty)}><Save size={13} /></button></div>;
}

function AnswerCard({ item, name }: { item: TeachingState['answers'][number]; name: string }) {
  return <div className={'tt-answer-feedback' + (item.correct ? ' is-correct' : ' is-hint')}><span className="tt-answer-feedback__icon">{item.correct ? <CheckCircle2 size={13} /> : <Sigma size={13} />}</span><div><strong>{name} · {item.correct ? 'Correct' : 'Hint'}</strong><p>{item.feedback}</p></div><small>{number(item.value)} m</small></div>;
}

interface EncounterBoard {
  characters: EncounterState['characters'];
  phase: EncounterState['phase'];
  pendingHit: EncounterState['pendingHit'];
  turn: EncounterState['turn'];
  events: EncounterState['events'];
  rule: EncounterState['rule'];
  paused?: EncounterState['paused'];
}

function EncounterBoardObject({ view, node }: CanvasObjectContentProps) {
  if (view.domain.kind !== 'encounter') return null;
  const board = node.inputs.board as EncounterBoard | undefined;
  if (!board) return <div className="tt-canvas-inline"><InlineHeading eyebrow="SHARED TABLE" title="Encounter board" /><div className="tt-canvas-inline__empty">The current board is not available. Refresh this table.</div></div>;
  const nameFor = (id: string) => board.characters.find((character) => character.id === id)?.name ?? 'Character';
  const target = board.pendingHit?.target;
  const paused = board.paused ?? (view.domain.kind === 'encounter' ? view.domain.paused : undefined);
  return <div className="tt-canvas-inline tt-canvas-inline--encounter">
    <InlineHeading eyebrow="SHARED TABLE" title="Encounter board" status={paused ? 'Paused by DM' : nameFor(board.turn) + '’s turn'} />
    {paused && <p className="tt-encounter-paused" role="status"><ShieldCheck size={14} /> The Dungeon Master paused turns and reactions for everyone.</p>}
    <div className="tt-inline-board">
      <svg viewBox="0 0 480 155" role="img" aria-label={'Encounter scene. ' + nameFor(board.turn) + ' has the turn.'}>
        <defs><pattern id="tt-inline-grid" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="#dce4dc" strokeWidth="1" /></pattern></defs><rect width="480" height="155" fill="url(#tt-inline-grid)" /><path d="M24 113 C104 78 142 91 193 108 S286 130 326 91 410 64 456 90" fill="none" stroke="#b8c9b8" strokeWidth="17" strokeLinecap="round" opacity=".48" /><path d="M216 48l11-12 11 12-6 21h-10Z" fill="#e4cf9f" stroke="#9d8451" strokeWidth="1.5" />
        {board.characters.map((character) => {
          const x = character.id === 'mira' ? 108 : character.id === 'pip' ? 370 : 241;
          const y = character.id === 'goblin' ? 98 : 88;
          const color = character.id === 'mira' ? '#315eb0' : character.id === 'pip' ? '#24796b' : '#b36f50';
          return <g key={character.id} transform={'translate(' + x + ' ' + y + ')'}><circle r="26" fill="#fff" stroke={target === character.id ? '#c58c3d' : board.turn === character.id ? '#24796b' : '#d4ded9'} strokeWidth={target === character.id || board.turn === character.id ? 3 : 1.5} /><circle cy="-3" r="8" fill={character.id === 'goblin' ? '#b36f50' : '#d9b49b'} /><path d="M-14 15q1-19 14-19t14 19Z" fill={color} /><text y="43" textAnchor="middle" className="tt-map-name">{character.name}</text>{target === character.id && <text y="-32" textAnchor="middle" className="tt-map-target">HIT</text>}</g>;
        })}
      </svg>
    </div>
    <div className="tt-inline-character-list">{board.characters.map((character) => <div className={board.turn === character.id ? 'is-active' : ''} key={character.id}><span><strong>{character.name}</strong><small>{character.id === board.turn ? 'Current turn' : character.id === 'goblin' ? 'Encounter' : character.id === target ? 'Pending target' : character.id}</small></span><span><Heart size={12} /> {character.hp}/{character.maxHp} HP</span><span><Activity size={12} /> {character.ap} AP</span></div>)}</div>
    <div className="tt-rule-summary"><span>ACTIVE SHIELD RULE</span><strong>{board.rule.allyTarget ? 'Self or ally' : 'Self only'} · {board.rule.apCost} AP{board.rule.oncePerTurn ? ' · once per turn' : ''}</strong></div>
  </div>;
}

function EncounterActions({ view, node, onCommand, busy }: CanvasObjectContentProps) {
  const state = view.domain as EncounterState;
  const board = node.inputs.board as EncounterBoard | undefined;
  const [tick, setTick] = useState(Date.now());
  const pending = board?.pendingHit ?? null;
  const phase = board?.phase ?? state.phase;
  const chars = board?.characters ?? state.characters;
  const active = board?.turn ?? state.turn;
  const rule = board?.rule ?? state.rule;
  const pauseState = board?.paused ?? state.paused;
  const actorId = view.actor.seat === 'mira' || view.actor.seat === 'pip' ? view.actor.seat : null;
  const actor = chars.find((character) => character.id === actorId);
  const ownTurn = actorId === active;
  const deadline = pending ? Math.max(0, pauseState ? pauseState.remainingReactionMs ?? 0 : pending.deadline - tick) : 0;
  useEffect(() => {
    if (!pending || pauseState) return;
    const timer = window.setInterval(() => setTick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [pending?.deadline, Boolean(pauseState)]);
  const canReact = view.actor.role === 'player' && !!actor && !!pending && phase === 'reaction.open'
    && (pending.target === actorId || rule.allyTarget)
    && actor.ap >= rule.apCost
    && (!rule.oncePerTurn || actor.shieldUsedGeneration !== actor.turnGeneration)
    && !pending.shields.some((intent) => intent.actor === actorId || intent.target === pending.target)
    && !pauseState;
  const canEnd = (view.actor.role === 'dm' || ownTurn) && (phase === 'turn.start' || phase === 'action.resolved') && !pending && !pauseState;
  const nameFor = (id: string) => chars.find((character) => character.id === id)?.name ?? 'Character';
  const reactReason = pauseState ? 'The Dungeon Master paused all encounter actions.' : !actor ? 'This seat does not control a character.' : actor.ap < rule.apCost ? 'You need ' + rule.apCost + ' AP to shield; you have ' + actor.ap + '.' : rule.oncePerTurn && actor.shieldUsedGeneration === actor.turnGeneration ? 'You already used a shield this turn.' : pending?.target !== actorId && !rule.allyTarget ? 'The current rule allows self protection only.' : pending?.shields.some((intent) => intent.target === pending.target) ? 'This character is already covered by a shield.' : 'Your character has already submitted a reaction.';
  return <div className="tt-canvas-inline">
    <InlineHeading eyebrow="SERVER-TIMED ACTION" title="Current action" status={pauseState ? 'Paused' : phase.replaceAll('.', ' · ')} />
    {pauseState && <p className="tt-encounter-paused" role="status"><ShieldCheck size={14} /> The Dungeon Master paused this encounter. Actions and timers are on hold.</p>}
    {pending && phase === 'reaction.open' && pauseState ? <div className="tt-inline-reaction tt-reaction-window--paused"><span className="tt-reaction-window__icon"><Shield size={17} /></span><div><strong>Reaction window paused</strong><small>{nameFor(pending.attacker)} targeted {nameFor(pending.target)}. Remaining time is held until the Dungeon Master resumes.</small></div><span className="tt-countdown" aria-label={`${Math.ceil(deadline / 1000)} seconds held`}><Clock3 size={13} /><strong>{Math.ceil(deadline / 1000)}s</strong></span></div> : pending && phase === 'reaction.open' ? <div className="tt-inline-reaction"><span className="tt-reaction-window__icon"><Shield size={17} /></span><div><strong>{nameFor(pending.attacker)} declared a hit against {nameFor(pending.target)}</strong><small>{pending.damage === null ? 'Damage stays with the DM until resolution; you may react now.' : `${pending.damage} damage is pending; eligible players may react before it is resolved.`}</small></div><span className={'tt-countdown' + (deadline <= 5000 ? ' is-ending' : '')} aria-live="polite"><Clock3 size={13} /><strong>{Math.ceil(deadline / 1000)}s</strong></span></div> : <div className="tt-inline-action-summary"><Activity size={14} /><span>{phase === 'action.resolved' ? 'The action is resolved. End the current turn when ready.' : nameFor(active) + ' is ready to act.'}</span></div>}
    {view.actor.role === 'dm' && <button type="button" className={pauseState ? 'tt-button tt-button--primary' : 'tt-button tt-button--quiet'} disabled={busy !== null} onClick={() => void onCommand(pauseState ? 'encounter.resume' : 'encounter.pause', {})}><ShieldCheck size={13} /> {pauseState ? 'Resume encounter' : 'Pause encounter'}</button>}
    {view.actor.role === 'dm' && phase === 'turn.start' && active === 'goblin' && <div className="tt-inline-action-block"><span><Target size={13} /> Choose a target</span><div><button type="button" className="tt-button tt-button--primary" disabled={busy !== null || Boolean(pauseState)} onClick={() => void onCommand('encounter.declareHit', { target: 'mira' })}>Hit Mira</button><button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || Boolean(pauseState)} onClick={() => void onCommand('encounter.declareHit', { target: 'pip' })}>Hit Pip</button></div></div>}
    {view.actor.role === 'player' && phase === 'reaction.open' && pending && <div className="tt-inline-action-block"><span><ShieldCheck size={13} /> Shield reaction</span>{canReact ? <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || deadline === 0} onClick={() => void onCommand('encounter.shield', { target: pending.target })}>{pending.target === actorId ? 'Shield ' + nameFor(actorId!) : 'Shield ' + nameFor(pending.target) + ' as ally'}</button> : <p className="tt-canvas-inline__note">{reactReason}</p>}</div>}
    {view.actor.role === 'dm' && pending && phase === 'reaction.open' && <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || Boolean(pauseState)} onClick={() => void onCommand('encounter.resolve', {})}><Check size={13} /> Resolve hit</button>}
    {(view.actor.role === 'dm' || ownTurn) && <button type="button" className="tt-button tt-button--quiet" disabled={busy !== null || !canEnd} onClick={() => void onCommand('encounter.endTurn', {})}><RotateCcw size={13} /> End {nameFor(active)}’s turn</button>}
    {view.actor.role === 'player' && !ownTurn && phase !== 'reaction.open' && <p className="tt-canvas-inline__note">You can act when your character’s turn begins.</p>}
    {pauseState && <p className="tt-canvas-inline__note" role="status">Actions are disabled for everyone until the Dungeon Master resumes.</p>}
    {!pauseState && pending && <p className="tt-canvas-inline__note">The deadline is server-set. The DM can resolve the reaction window at any time.</p>}
  </div>;
}

function EncounterSource({ view, onCommand, busy }: CanvasObjectContentProps) {
  const state = view.domain as EncounterState;
  const isDm = view.actor.role === 'dm';
  const [rule, setRule] = useState<EncounterRule>(state.rule);
  const [note, setNote] = useState(state.dmNote ?? '');
  useEffect(() => setRule(state.rule), [state.rule]);
  useEffect(() => setNote(state.dmNote ?? ''), [state.dmNote]);
  const propose = () => void onCommand('evolve.propose', { change: { kind: 'encounter', rule } });
  const saveNote = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void onCommand('encounter.saveNote', { text: note }); };
  return <div className="tt-canvas-inline">
    <InlineHeading eyebrow={isDm ? 'DM ONLY · PRIVATE NOTE' : 'TABLE RULES'} title="Shield rules and table notes" status={'Active r' + state.ruleRevision} />
    <div className="tt-rule-summary"><span>SHIELD RULE</span><strong>{state.rule.allyTarget ? 'Self or ally' : 'Self only'} · {state.rule.apCost} AP{state.rule.oncePerTurn ? ' · once per turn' : ''}</strong></div>
    {isDm ? <>
      <div className="tt-encounter-rule-editor">
        <label className="tt-toggle-row"><span><strong>Allow shielding an ally</strong><small>When off, only self protection is allowed.</small></span><input type="checkbox" checked={rule.allyTarget} onChange={(event) => setRule((current) => ({ ...current, allyTarget: event.target.checked }))} /></label>
        <label className="tt-toggle-row"><span><strong>Shield cost</strong><small>Spent by the reacting character.</small></span><select value={rule.apCost} onChange={(event) => setRule((current) => ({ ...current, apCost: Number(event.target.value) as 0 | 1 }))}><option value={0}>No AP</option><option value={1}>1 AP</option></select></label>
        <label className="tt-toggle-row"><span><strong>Once per character turn</strong><small>Refreshes when that character’s turn begins.</small></span><input type="checkbox" checked={rule.oncePerTurn} onChange={(event) => setRule((current) => ({ ...current, oncePerTurn: event.target.checked }))} /></label>
        <button type="button" className="tt-button tt-button--primary" disabled={busy !== null || sameRule(rule, state.rule)} onClick={propose}><ShieldCheck size={13} /> Propose rule</button>
      </div>
      <p className="tt-canvas-inline__note">The current shield rule stays active until the proposal is reviewed and activated.</p>
      <form className="tt-note-form tt-inline-note-form" onSubmit={saveNote}><label htmlFor="tt-canvas-dm-note">Private DM note</label><textarea id="tt-canvas-dm-note" maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Only the DM can see this note…" /><div><small>Hidden from players · {note.length}/2000</small><button type="submit" className="tt-button tt-button--quiet" disabled={busy !== null || note === (state.dmNote ?? '')}><Save size={13} /> Save note</button></div></form>
      <CandidateLifecycle view={view} onCommand={onCommand} busy={busy} />
    </> : <p className="tt-canvas-inline__note">The Dungeon Master controls rule changes and private notes. Your character actions are available at the encounter object.</p>}
  </div>;
}

function sameParams(left: PhysicsParams, right: PhysicsParams): boolean {
  return left.force === right.force && left.mass === right.mass && left.time === right.time;
}

function sameRule(left: EncounterRule, right: EncounterRule): boolean {
  return left.allyTarget === right.allyTarget && left.apCost === right.apCost && left.oncePerTurn === right.oncePerTurn;
}

function number(value: number): string {
  return new Intl.NumberFormat('en', { maximumFractionDigits: 3 }).format(value);
}

function formatSignedMoney(satang: number | null): string {
  if (satang === null || !Number.isSafeInteger(satang)) return 'Unknown';
  const formatted = formatMoney(Math.abs(satang));
  return satang > 0 ? '+' + formatted : satang < 0 ? '−' + formatted : formatted;
}

function todayBangkok(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
