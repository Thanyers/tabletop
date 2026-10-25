import type { ReactNode } from 'react';
import type { SourceCue, SourceEvidence } from './sourceEvidence';
import './source-evidence.css';

const BEAT_LABEL: Record<SourceCue['beat'], string> = { locate: 'พบจุดอ้างอิง', understand: 'อ่านความหมาย', connect: 'เชื่อมกับงาน' };

export function SourceEvidenceView({ cue, evidence, children, onFull }: { cue: SourceCue; evidence: SourceEvidence; children: ReactNode; onFull: () => void }) {
  const sentence = cue.beat === 'locate' ? evidence.location
    : cue.beat === 'understand' ? evidence.meaning
      : evidence.effect;
  return (
    <section
      className="source-evidence"
      data-testid="source-evidence"
      data-evidence-beat={cue.beat}
      data-evidence-purpose={cue.purpose}
      aria-label={`การตีความตัวอย่าง · ${evidence.location} · ${BEAT_LABEL[cue.beat]}`}
      data-source-location={evidence.location}
    >
      <header className="source-evidence__head">
        <span className="source-evidence__eyebrow">การตีความตัวอย่าง <small>{evidence.location.split(' · ')[0]}</small></span>
        <div className="source-evidence__rail" aria-label={`ขั้นตอน ${BEAT_LABEL[cue.beat]}`}>
          <i className={cue.beat === 'locate' ? 'is-active' : 'is-done'} />
          <i className={cue.beat === 'understand' ? 'is-active' : cue.beat === 'connect' ? 'is-done' : ''} />
          <i className={cue.beat === 'connect' ? 'is-active' : ''} />
          <b aria-current="step">{BEAT_LABEL[cue.beat]}</b>
        </div>
      </header>
      <p className="source-evidence__sentence" aria-live="polite">{sentence}</p>
      <div className="source-evidence__target" data-evidence-target={evidence.target}>
        {children}
      </div>
      <span className="source-evidence__target-label">{evidence.targetLabel}</span>
      <button className="source-evidence__full" type="button" onClick={onFull}>{evidence.target === 'shipping-rate-clause' ? 'เปิด PDF จริง' : 'ดูไฟล์เต็ม'}</button>
    </section>
  );
}
