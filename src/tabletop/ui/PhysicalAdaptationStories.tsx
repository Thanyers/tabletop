import type { LandingCopy, LandingLanguage } from './landing-copy';
import './physical-adaptation-stories.css';

type Stories = LandingCopy['why']['stories'];

export function PhysicalAdaptationStories({ language, copy }: { language: LandingLanguage; copy: Stories }) {
  const stage = language === 'en' ? 'BEFORE' : 'ก่อนปรับ';
  const add = language === 'en' ? 'ADD' : 'เพิ่ม';
  const after = language === 'en' ? 'AFTER' : 'หลังปรับ';

  return <div className="tt-adaptation-stories" role="group" aria-label={language === 'en' ? 'Two examples of tools adapted to a person and a workplace' : 'ตัวอย่างเครื่องมือที่ปรับให้เข้ากับคนและหน้างาน'}>
    <article className="tt-adaptation-story tt-adaptation-story--hammer">
      <div className="tt-adaptation-story__sequence">
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--before">
          <div className="tt-adaptation-story__art"><HammerGripIllustration adapted={false} label={copy.hammer.beforeAlt} /></div>
          <figcaption><span>{stage}</span>{copy.hammer.need}</figcaption>
        </figure>
        <span className="tt-adaptation-story__plus" aria-hidden="true">+</span>
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--after">
          <div className="tt-adaptation-story__art"><HammerGripIllustration adapted label={copy.hammer.afterAlt} /></div>
          <figcaption><span>{after}</span>{copy.hammer.addition}</figcaption>
        </figure>
      </div>
      <div className="tt-adaptation-story__copy">
        <p className="tt-adaptation-story__eyebrow">{copy.hammer.name}<span aria-hidden="true"> · </span>{add} {language === 'en' ? 'a grip' : 'กริป'}</p>
        <h3>{copy.hammer.title}</h3>
        <p>{copy.hammer.body}</p>
        <p className="tt-adaptation-story__result"><span aria-hidden="true">↗</span>{copy.hammer.result}</p>
      </div>
    </article>

    <article className="tt-adaptation-story tt-adaptation-story--chair">
      <div className="tt-adaptation-story__sequence">
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--before">
          <div className="tt-adaptation-story__art"><ChairFitIllustration adapted={false} label={copy.chair.beforeAlt} /></div>
          <figcaption><span>{stage}</span>{copy.chair.need}</figcaption>
        </figure>
        <span className="tt-adaptation-story__plus" aria-hidden="true">+</span>
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--after">
          <div className="tt-adaptation-story__art"><ChairFitIllustration adapted label={copy.chair.afterAlt} /></div>
          <figcaption><span>{after}</span>{copy.chair.addition}</figcaption>
        </figure>
      </div>
      <div className="tt-adaptation-story__copy">
        <p className="tt-adaptation-story__eyebrow">{copy.chair.name}<span aria-hidden="true"> · </span>{add} {language === 'en' ? 'support' : 'ที่รองรับ'}</p>
        <h3>{copy.chair.title}</h3>
        <p>{copy.chair.body}</p>
        <p className="tt-adaptation-story__result"><span aria-hidden="true">↗</span>{copy.chair.result}</p>
      </div>
    </article>
  </div>;
}

function HammerGripIllustration({ adapted, label }: { adapted: boolean; label: string }) {
  return <svg viewBox="0 0 480 270" role="img" aria-label={label} focusable="false" data-scene="hammer" data-adapted={adapted}>
    <rect width="480" height="270" rx="18" fill="var(--tt-paper, #faf8f0)" />
    {/* A short striking face and split claw make the object read as a hammer at a glance. */}
    <path d="M97 59q0-10 10-10h50q9 0 14 9l9 12h41q14 0 27-8l31-17q9-5 17 2l7 8-29 25 29 24-7 9q-8 7-17 2l-31-17q-13-8-27-8h-41l-9 12q-5 9-14 9h-50q-10 0-10-10z" fill="var(--tt-ink, #303d3a)" />
    <path d="M107 57h43q5 0 7 5v39q-2 5-7 5h-43q-3 0-3-4V61q0-4 3-4z" fill="var(--tt-muted, #667268)" />
    <path d="M116 60v43m119-36 25-13m-25 59 25 13" fill="none" stroke="var(--tt-paper, #faf8f0)" strokeWidth="3" strokeLinecap="round" opacity=".68" />
    {/* The wood handle stays in the same place in both views. */}
    <path d="m205 83 24-5 41 127q3 9-5 12l-12 4q-8 2-11-6z" fill="var(--tt-amber, #89632f)" />
    <path d="m214 88 8-2 40 126-8 3z" fill="var(--tt-clay-2, #f6e9e2)" opacity=".42" />
    {adapted && <g aria-hidden="true">
      {/* The padded sleeve follows the handle beneath the same fingers. */}
      <path d="m216 122 30-8 25 77-29 10-25-79z" fill="var(--tt-moss, #356e5d)" />
      <path d="m219 132 31-9m-26 25 31-10m-26 25 31-10m-26 24 30-10" fill="none" stroke="var(--tt-green-2, #e8f0e4)" strokeWidth="5" strokeLinecap="round" />
      <path d="m211 125 39 81m-4-91 32 79" fill="none" stroke="var(--tt-ink, #303d3a)" strokeWidth="2" opacity=".5" />
    </g>}
    {/* A forearm and closed hand visibly meet the handle; finger lines wrap across it. */}
    <path d="m70 233 76-34q12-5 23-15l28-25q8-7 15-1l8 7q6 6 1 13l-6 8 18-12q8-5 14 2 6 8-2 14l-15 13 20-8q9-3 13 5 4 8-4 14l-24 15q-14 8-34 9l-70 3-37 17z" fill="var(--tt-clay-2, #f6e9e2)" />
    <path d="m188 177 49 2m-60 18 56 1m-45 17 45-2" fill="none" stroke="var(--tt-red, #9a5c4e)" strokeWidth="3" strokeLinecap="round" />
    <path d="M16 238h448" stroke="var(--tt-line, #d9d4c4)" strokeWidth="2" />
  </svg>;
}

function ChairFitIllustration({ adapted, label }: { adapted: boolean; label: string }) {
  return <svg viewBox="0 0 480 270" role="img" aria-label={label} focusable="false" data-scene="chair" data-adapted={adapted}>
    <rect width="480" height="270" rx="18" fill="var(--tt-paper, #faf8f0)" />
    <path d="M40 104h190v13H40zM53 117h10v121H53zm150 0h10v121h-10z" fill="var(--tt-amber, #89632f)" />
    <path d="M272 167h87v12h-87zM280 179h9v59h-9zm61 0h9v59h-9z" fill="var(--tt-ink, #303d3a)" />
    <rect x="345" y="101" width="14" height="76" rx="6" fill="var(--tt-muted, #667268)" />
    {adapted && <g aria-hidden="true">
      <rect x="269" y="151" width="77" height="16" rx="6" fill="var(--tt-moss, #356e5d)" />
      <path d="M206 211h72v27h-72z" fill="var(--tt-amber, #89632f)" />
      <path d="M213 219h58m-58 9h58" stroke="var(--tt-paper, #faf8f0)" strokeWidth="2" opacity=".45" />
    </g>}
    {/* One side profile; the cushion raises the same person by its thickness. */}
    <g transform={adapted ? 'translate(0 -16)' : undefined}>
      <circle cx="314" cy="70" r="20" fill="var(--tt-clay-2, #f6e9e2)" />
      <path d="M295 64q4-23 25-15l14 14-8 10-5-9z" fill="var(--tt-ink, #303d3a)" />
      <path d="M305 88h15v18h-15z" fill="var(--tt-clay-2, #f6e9e2)" />
      <path d="M300 101q14-8 29 2l7 50q-14 14-40 6l-3-42z" fill="var(--tt-moss, #356e5d)" />
      <path d="M307 112l-24 20-41-15" fill="none" stroke="var(--tt-clay-2, #f6e9e2)" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M242 117l-17-5" stroke="var(--tt-clay-2, #f6e9e2)" strokeWidth="9" strokeLinecap="round" />
      <path d="M322 157h-67q-12 0-12 14v39" fill="none" stroke="var(--tt-blue, #3e6c86)" strokeWidth="20" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M243 211v10" stroke="var(--tt-clay-2, #f6e9e2)" strokeWidth="12" />
      <path d="M249 219h-15l-16 8h34v-8z" fill="var(--tt-ink, #303d3a)" />
    </g>
    <path d="M26 238h428" stroke="var(--tt-line, #d9d4c4)" strokeWidth="2" />
  </svg>;
}
