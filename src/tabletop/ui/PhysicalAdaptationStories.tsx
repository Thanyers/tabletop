import type { LandingCopy, LandingLanguage } from './landing-copy';
import './physical-adaptation-stories.css';

type Stories = LandingCopy['why']['stories'];

export function PhysicalAdaptationStories({ language, copy }: { language: LandingLanguage; copy: Stories }) {
  const stage = language === 'en' ? 'BEFORE' : 'ก่อนปรับ';
  const after = language === 'en' ? 'AFTER' : 'หลังปรับ';

  return <div className="tt-adaptation-stories" role="group" aria-label={language === 'en' ? 'Two examples of tools adapted to a person and a workplace' : 'ตัวอย่างเครื่องมือที่ปรับให้เข้ากับคนและหน้างาน'}>
    <article className="tt-adaptation-story tt-adaptation-story--hammer">
      <div className="tt-adaptation-story__sequence">
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--before">
          <div className="tt-adaptation-story__art"><AdaptationPhoto scene="hammer" adapted={false} label={copy.hammer.beforeAlt} /></div>
          <figcaption><span>{stage}</span>{copy.hammer.need}</figcaption>
        </figure>
        <span className="tt-adaptation-story__plus" aria-hidden="true">+</span>
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--after">
          <div className="tt-adaptation-story__art"><AdaptationPhoto scene="hammer" adapted label={copy.hammer.afterAlt} /></div>
          <figcaption><span>{after}</span>{copy.hammer.addition}</figcaption>
        </figure>
      </div>
      <div className="tt-adaptation-story__copy">
        <h3>{copy.hammer.title}</h3>
        <p>{copy.hammer.body}</p>
      </div>
    </article>

    <article className="tt-adaptation-story tt-adaptation-story--chair">
      <div className="tt-adaptation-story__sequence">
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--before">
          <div className="tt-adaptation-story__art"><AdaptationPhoto scene="chair" adapted={false} label={copy.chair.beforeAlt} /></div>
          <figcaption><span>{stage}</span>{copy.chair.need}</figcaption>
        </figure>
        <span className="tt-adaptation-story__plus" aria-hidden="true">+</span>
        <figure className="tt-adaptation-story__stage tt-adaptation-story__stage--after">
          <div className="tt-adaptation-story__art"><AdaptationPhoto scene="chair" adapted label={copy.chair.afterAlt} /></div>
          <figcaption><span>{after}</span>{copy.chair.addition}</figcaption>
        </figure>
      </div>
      <div className="tt-adaptation-story__copy">
        <h3>{copy.chair.title}</h3>
        <p>{copy.chair.body}</p>
      </div>
    </article>
  </div>;
}

function AdaptationPhoto({ scene, adapted, label }: { scene: 'hammer' | 'chair'; adapted: boolean; label: string }) {
  return <img src={`/narrative/adaptations/${scene}-custom-fit.png`} width={2172} height={724} loading="lazy" decoding="async" alt={label} data-scene={scene} data-adapted={adapted} />;
}
