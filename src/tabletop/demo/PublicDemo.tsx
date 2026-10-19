import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ArrowRight, Pause, Play, RotateCcw } from 'lucide-react';
import { publicDemo } from './data';
import type { DemoCheckpoint, PublicDemoScenario } from './types';
import './public-demo.css';

type DomainFilter = 'all' | PublicDemoScenario['domain'];

const domainLabels: Record<PublicDemoScenario['domain'], string> = {
  invoice: 'ใบแจ้งหนี้',
  teaching: 'บทเรียน',
  encounter: 'การผจญภัย',
};

const domainGlyphs: Record<PublicDemoScenario['domain'], string> = {
  invoice: '฿',
  teaching: '∑',
  encounter: '✦',
};

function money(satang: number): string {
  return new Intl.NumberFormat('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(satang / 100);
}

function signedMoney(satang: number): string {
  return `${satang > 0 ? '+' : satang < 0 ? '−' : ''}฿${money(Math.abs(satang))}`;
}

function phaseLabel(phase: string): string {
  const labels: Record<string, string> = {
    setup: 'เตรียมฉาก',
    player_turn: 'ตาผู้เล่น',
    reaction: 'รอการตอบสนอง',
    resolved: 'จบการกระทำ',
    complete: 'จบฉาก',
    paused: 'พักเกม',
    'turn.start': 'เริ่มตา',
    'reaction.open': 'เปิดช่วงตอบสนอง',
    'action.resolved': 'จัดการการกระทำแล้ว',
    'turn.end': 'จบตา',
  };
  return labels[phase] ?? 'มีสถานะบันทึกไว้';
}

export default function PublicDemo() {
  const scenarios = useMemo(() => publicDemo?.schemaVersion === 1 && Array.isArray(publicDemo.scenarios) ? publicDemo.scenarios : [], []);
  const [domain, setDomain] = useState<DomainFilter>('all');
  const [scenarioId, setScenarioId] = useState(() => scenarios[0]?.id ?? '');
  const [stepIndex, setStepIndex] = useState(0);
  const [playing, setPlaying] = useState(false);

  const visibleScenarios = useMemo(() => domain === 'all' ? scenarios : scenarios.filter((scenario) => scenario.domain === domain), [domain, scenarios]);
  const scenario = visibleScenarios.find((item) => item.id === scenarioId) ?? visibleScenarios[0] ?? null;
  const currentStep = scenario?.steps[stepIndex] ?? null;

  useEffect(() => {
    if (!scenario) return;
    if (scenarioId !== scenario.id) {
      setScenarioId(scenario.id);
      setStepIndex(0);
    }
  }, [scenario, scenarioId]);

  useEffect(() => {
    if (!playing || !scenario) return;
    if (stepIndex >= scenario.steps.length - 1) {
      setPlaying(false);
      return;
    }
    const timer = window.setTimeout(() => setStepIndex((index) => Math.min(index + 1, scenario.steps.length - 1)), 2400);
    return () => window.clearTimeout(timer);
  }, [playing, scenario, stepIndex]);

  const changeDomain = (next: DomainFilter) => {
    setPlaying(false);
    setDomain(next);
    const nextScenario = next === 'all' ? scenarios[0] : scenarios.find((item) => item.domain === next);
    setScenarioId(nextScenario?.id ?? '');
    setStepIndex(0);
  };

  const chooseScenario = (next: PublicDemoScenario) => {
    setPlaying(false);
    setScenarioId(next.id);
    setStepIndex(0);
  };

  const goToStep = (index: number) => {
    if (!scenario) return;
    setPlaying(false);
    setStepIndex(Math.max(0, Math.min(index, scenario.steps.length - 1)));
  };

  const togglePlayback = () => {
    if (!scenario || scenario.steps.length < 2) return;
    if (playing) {
      setPlaying(false);
      return;
    }
    if (stepIndex >= scenario.steps.length - 1) setStepIndex(0);
    setPlaying(true);
  };

  const restart = () => {
    setPlaying(false);
    setStepIndex(0);
  };

  return <main className="tt-public-demo" data-testid="public-auto-demo">
    <header className="tt-public-demo__topbar">
      <a className="tt-public-demo__brand" href="/" aria-label="กลับไปหน้า Tabletop">
        <span className="tt-public-demo__mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>tabletop<span>.</span></span>
      </a>
      <span className="tt-public-demo__top-note">ข้อมูลจำลอง · เล่นย้อนหลัง · ไม่ต้องล็อกอิน</span>
      <a className="tt-public-demo__home" href="/"><ArrowLeft size={15} /><span>กลับหน้าหลัก</span></a>
    </header>

    <section className="tt-public-demo__intro" aria-labelledby="tt-public-demo-title">
      <div className="tt-public-demo__intro-mark" aria-hidden="true"><span>✦</span><i /><i /></div>
      <div>
        <p className="tt-public-demo__eyebrow">TABLETOP · AUTO DEMO</p>
        <h1 id="tt-public-demo-title">ดูการทำงานผ่านเรื่องราวที่บันทึกไว้</h1>
        <p>เลือกหนึ่งในสามโต๊ะ แล้วเล่นทีละจังหวะเพื่อดูข้อมูลที่เปลี่ยนไปตามการบันทึก</p>
      </div>
      <span className="tt-public-demo__recorded"><i aria-hidden="true" /> บันทึกแล้ว</span>
    </section>

    <div className="tt-public-demo__filters" role="group" aria-label="เลือกประเภทโต๊ะ">
      <button type="button" aria-label="ทุกโต๊ะ" aria-pressed={domain === 'all'} className={domain === 'all' ? 'is-active' : ''} onClick={() => changeDomain('all')}>ทุกโต๊ะ<span>{scenarios.length}</span></button>
      {(['invoice', 'teaching', 'encounter'] as const).map((kind) => <button key={kind} type="button" aria-label={domainLabels[kind]} aria-pressed={domain === kind} className={`${domain === kind ? 'is-active' : ''} tt-public-demo__filter--${kind}`} onClick={() => changeDomain(kind)}><span aria-hidden="true">{domainGlyphs[kind]}</span>{domainLabels[kind]}<small>{scenarios.filter((item) => item.domain === kind).length}</small></button>)}
    </div>

    {scenarios.length === 0 ? <section className="tt-public-demo__empty" role="status"><span aria-hidden="true">○</span><h2>ยังไม่มีเรื่องราวให้เล่น</h2><p>ข้อมูลตัวอย่างยังไม่พร้อม ลองกลับมาใหม่อีกครั้ง</p><a href="/">กลับหน้าหลัก</a></section> : <div className="tt-public-demo__layout">
      <aside className="tt-public-demo__catalog" aria-label="เลือกเรื่องราว">
        <div className="tt-public-demo__catalog-head"><div><span className="tt-public-demo__eyebrow">เลือกเรื่อง</span><h2>โต๊ะตัวอย่าง</h2></div><span>{visibleScenarios.length} เรื่อง</span></div>
        <div className="tt-public-demo__scenario-list">
          {visibleScenarios.map((item, index) => <button key={item.id} type="button" aria-label={item.title} aria-pressed={scenario?.id === item.id} className={`tt-public-demo__scenario ${scenario?.id === item.id ? 'is-selected' : ''} tt-public-demo__scenario--${item.domain}`} onClick={() => chooseScenario(item)}>
            <span className="tt-public-demo__scenario-icon" aria-hidden="true">{domainGlyphs[item.domain]}</span>
            <span className="tt-public-demo__scenario-copy"><small>{domainLabels[item.domain]} · {String(index + 1).padStart(2, '0')}</small><strong>{item.title}</strong><span>{item.persona.name} · {item.persona.role}</span></span>
            <ArrowRight size={15} aria-hidden="true" />
          </button>)}
        </div>
      </aside>

      {scenario && <section className={`tt-public-demo__stage tt-public-demo__stage--${scenario.domain}`} aria-label={`เรื่องราว: ${scenario.title}`}>
        <div className="tt-public-demo__stage-heading">
          <div className="tt-public-demo__stage-title"><span className="tt-public-demo__domain-mark" aria-hidden="true">{domainGlyphs[scenario.domain]}</span><div><span className="tt-public-demo__eyebrow">{domainLabels[scenario.domain]} · บันทึกการเล่น</span><h2>{scenario.title}</h2></div></div>
          <span className="tt-public-demo__state-tag"><i aria-hidden="true" /> สถานะจำลอง</span>
        </div>

        <div className="tt-public-demo__story">
          <div className="tt-public-demo__persona"><span className="tt-public-demo__avatar" aria-hidden="true">{scenario.persona.name.slice(0, 1)}</span><div><strong>{scenario.persona.name}</strong><span>{scenario.persona.role}</span></div></div>
          <div className="tt-public-demo__story-copy"><span>เป้าหมาย</span><p>{scenario.persona.goal}</p></div>
          <div className="tt-public-demo__prompt"><span>โจทย์ของเรื่องนี้</span><p>{scenario.prompt}</p></div>
        </div>

        <div className="tt-public-demo__record">
          <div className="tt-public-demo__record-head" aria-live="polite"><div><span className="tt-public-demo__eyebrow">จังหวะที่เลือก</span><h3>{currentStep?.title ?? 'ยังไม่มีขั้นตอน'}</h3></div>{currentStep && <span className={`tt-public-demo__outcome tt-public-demo__outcome--${currentStep.outcome}`}>{currentStep.outcome === 'expected-rejection' ? 'คาดว่าจะถูกปฏิเสธ' : 'มีบันทึกผลแล้ว'}</span>}</div>
          {currentStep && <div className="tt-public-demo__actor-line"><span className="tt-public-demo__actor-dot" aria-hidden="true" />{currentStep.actor}<span>{currentStep.description}</span></div>}
          <RecordedState scenario={scenario} stepIndex={stepIndex} />
          <div className="tt-public-demo__expected"><span>ผลที่คาดไว้</span><p>{scenario.outcome}</p></div>
        </div>

        <div className="tt-public-demo__playback">
          <div className="tt-public-demo__play-row">
            <button type="button" className="tt-public-demo__play" onClick={togglePlayback} disabled={scenario.steps.length < 2} aria-label={playing ? 'หยุดเล่นชั่วคราว' : stepIndex === scenario.steps.length - 1 ? 'เล่นเรื่องนี้อีกครั้ง' : 'เล่นเรื่องนี้'}>{playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}<span>{playing ? 'พัก' : 'เล่น'}</span></button>
            <button type="button" className="tt-public-demo__transport" onClick={() => goToStep(stepIndex - 1)} disabled={stepIndex === 0} aria-label="ย้อนหนึ่งจังหวะ"><ArrowLeft size={16} /></button>
            <button type="button" className="tt-public-demo__transport" onClick={() => goToStep(stepIndex + 1)} disabled={stepIndex >= scenario.steps.length - 1} aria-label="ไปจังหวะถัดไป"><ArrowRight size={16} /></button>
            <button type="button" className="tt-public-demo__restart" onClick={restart}><RotateCcw size={14} /><span>เริ่มใหม่</span></button>
            <span className="tt-public-demo__step-counter" data-testid="demo-step-counter" aria-live="polite">{scenario.steps.length ? String(stepIndex + 1).padStart(2, '0') : '00'} <i>/</i> {String(scenario.steps.length).padStart(2, '0')}</span>
          </div>
          <ol className="tt-public-demo__timeline" aria-label="ลำดับการเล่น">
            {scenario.steps.map((step, index) => <li key={step.id} className={index === stepIndex ? 'is-current' : index < stepIndex ? 'is-past' : ''}><button type="button" onClick={() => goToStep(index)} aria-current={index === stepIndex ? 'step' : undefined} aria-label={`จังหวะที่ ${index + 1}: ${step.title}`} title={step.title}><span>{String(index + 1).padStart(2, '0')}</span><small>{step.title}</small></button></li>)}
          </ol>
          <div className="tt-public-demo__playback-foot"><span>เล่นย้อนหลังจากข้อมูลที่บันทึกไว้</span><span>ไม่เปลี่ยนแปลงโต๊ะจริง</span></div>
        </div>
      </section>}
    </div>}
    <footer className="tt-public-demo__footer"><span>Tabletop · เรื่องราวจำลองสำหรับทดลองใช้งาน</span><a href="/">เปิดโต๊ะทำงานของคุณ <ArrowRight size={13} /></a></footer>
  </main>;
}

function RecordedState({ scenario, stepIndex }: { scenario: PublicDemoScenario; stepIndex: number }) {
  let checkpoint: DemoCheckpoint | undefined;
  let checkpointStep = -1;
  for (let index = stepIndex; index >= 0; index -= 1) {
    if (scenario.steps[index]?.checkpoint) {
      checkpoint = scenario.steps[index].checkpoint;
      checkpointStep = index;
      break;
    }
  }
  return <div className="tt-public-demo__snapshot" data-testid="demo-checkpoint">
    <div className="tt-public-demo__snapshot-head"><span>สถานะล่าสุดที่บันทึก</span><small>{checkpoint ? `จังหวะ ${checkpointStep + 1}` : 'ยังไม่มีข้อมูล'}</small></div>
    {!checkpoint ? <p className="tt-public-demo__no-state">จังหวะนี้ยังไม่มีสถานะที่บันทึกไว้</p> : <>
      {checkpoint.phase && <div className="tt-public-demo__revision-line"><span>สถานะ <strong>{phaseLabel(checkpoint.phase)}</strong></span></div>}
      {scenario.domain === 'invoice' && checkpoint.totals && <div className="tt-public-demo__invoice-state" aria-label="ยอดในบันทึก">
        {checkpoint.totals.expectedSatang !== undefined && <div className="tt-public-demo__invoice-total"><span>ยอดที่คาดไว้</span><strong>฿{money(checkpoint.totals.expectedSatang)}</strong></div>}
        {checkpoint.totals.deltaSatang !== undefined && <div><span>ผลต่าง</span><strong className={checkpoint.totals.deltaSatang === 0 ? 'is-zero' : 'is-delta'}>{signedMoney(checkpoint.totals.deltaSatang)}</strong></div>}
        {checkpoint.totals.unknownCount !== undefined && <div><span>รายการที่ยังไม่ทราบ</span><strong>{checkpoint.totals.unknownCount}</strong></div>}
        <div className="tt-public-demo__invoice-rule"><span>แสดงเฉพาะค่าจากบันทึกตัวอย่าง</span><i aria-hidden="true" /></div>
      </div>}
      {scenario.domain === 'teaching' && checkpoint.physics && <div className="tt-public-demo__physics-state" aria-label="ค่าฟิสิกส์ที่บันทึก">
        {([['แรง', checkpoint.physics.force, 'N'], ['มวล', checkpoint.physics.mass, 'kg'], ['เวลา', checkpoint.physics.time, 's'], ['ความเร่ง', checkpoint.physics.acceleration, 'm/s²'], ['ความเร็ว', checkpoint.physics.velocity, 'm/s'], ['ระยะทาง', checkpoint.physics.position, 'm']] as const).filter(([, value]) => value !== undefined).map(([label, value, unit]) => <div key={label}><span>{label}</span><strong>{value}<small>{unit}</small></strong></div>)}
        <div className="tt-public-demo__physics-line" aria-hidden="true"><i /><span /><i /></div>
      </div>}
      {scenario.domain === 'encounter' && checkpoint.characters && <div className="tt-public-demo__characters" aria-label="สถานะตัวละครที่บันทึก">
        {checkpoint.characters.map((character, index) => <div className="tt-public-demo__character" key={`${character.name}-${index}`}><span className="tt-public-demo__character-token" aria-hidden="true">{character.name.slice(0, 1)}</span><div><strong>{character.name}</strong><span><b>HP</b> {character.hp} <i>·</i> <b>AP</b> {character.ap}</span></div></div>)}
      </div>}
      {checkpoint.privateFieldsHidden && <p className="tt-public-demo__privacy-mark"><span aria-hidden="true">◆</span> ซ่อนคำตอบและบันทึกส่วนตัวแล้ว</p>}
    </>}
  </div>;
}
