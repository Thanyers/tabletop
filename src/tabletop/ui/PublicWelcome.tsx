import { ArrowUpRight, BookOpen, FileText, Languages, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { LandingLanguageContext, landingCopy, readLandingLanguage, saveLandingLanguage, type LandingLanguage } from './landing-copy';
import storyGif from '../../../docs/showcase/tabletop-story.gif';
import storyPoster from '../../../docs/showcase/tabletop-story-poster.png';
import physicsImage from '../../../docs/showcase/physics.png';
import encounterImage from '../../../docs/showcase/encounter.png';
import './public-welcome.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';

/**
 * The public story page. `children` is the panel in the hero (sign-in or welcome back);
 * `headerAction` and `closingAction` are the page's calls to action. All three render
 * inside the language context, so they read their copy with `useLandingCopy()`.
 */
export function PublicWelcome({ children, headerAction, closingAction }: { children: ReactNode; headerAction?: ReactNode; closingAction?: ReactNode }) {
  const [language, setLanguage] = useState<LandingLanguage>(readLandingLanguage);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches);
  const [playStory, setPlayStory] = useState(() => !(typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches));
  const [replay, setReplay] = useState(0);

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const updatePreference = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
      setPlayStory(!event.matches);
    };
    setReducedMotion(media.matches);
    setPlayStory(!media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  const showStory = () => {
    if (!playStory) {
      setReplay((current) => current + 1);
      setPlayStory(true);
    } else {
      setPlayStory(false);
    }
  };

  const storySource = playStory && replay > 0 ? `${storyGif}?replay=${replay}` : playStory ? storyGif : storyPoster;

  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { root.lang = previous; };
  }, [language]);

  const switchLanguage = () => {
    const next = language === 'th' ? 'en' : 'th';
    setLanguage(next);
    saveLandingLanguage(next);
  };

  const copy = landingCopy[language];

  return <LandingLanguageContext.Provider value={language}><main className="tt-account-gate tt-public-welcome" lang={language}>
    <header className="tt-public-welcome__header">
      <a className="tt-brand tt-public-welcome__brand" href="/" aria-label="Tabletop home">
        <span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>tabletop<span>.</span></span>
      </a>
      <span className="tt-public-welcome__header-note">{copy.header.note}</span>
      <button type="button" className="tt-public-welcome__language" onClick={switchLanguage} aria-label={copy.header.switchLabel} lang={language === 'th' ? 'en' : 'th'}><Languages size={14} aria-hidden="true" />{copy.header.switchTo}</button>
      {headerAction ?? <a className="tt-public-welcome__signin" href="#sign-in">{copy.header.signIn} <ArrowUpRight size={14} aria-hidden="true" /></a>}
    </header>

    <div className="tt-public-welcome__content">
      <section className="tt-public-welcome__hero" aria-labelledby="tt-public-welcome-title">
        <div className="tt-public-welcome__hero-copy">
          <p className="tt-public-welcome__eyebrow">{copy.hero.eyebrow}</p>
          <h1 id="tt-public-welcome-title">{copy.hero.title}</h1>
          <p className="tt-public-welcome__promise">{copy.hero.promise}</p>
          <p className="tt-public-welcome__bridge">{copy.hero.bridge}</p>
          {children}
        </div>

        <figure className="tt-public-welcome__story">
          <div className="tt-public-welcome__story-frame">
            <img key={playStory ? `story-${replay}` : 'poster'} src={storySource} width={960} height={540} alt={copy.story.alt} />
          </div>
          <figcaption>
            <span>{copy.story.caption}</span>
            <button type="button" onClick={showStory} aria-label={playStory ? copy.story.showStillLabel : copy.story.replayLabel}>
              {playStory ? copy.story.showStill : reducedMotion ? copy.story.replay : copy.story.replayIdea}
            </button>
          </figcaption>
          <p className="tt-public-welcome__story-note">{copy.story.note}</p>
        </figure>
      </section>

      <section className="tt-public-welcome__why" aria-labelledby="tt-public-welcome-why-title">
        <div className="tt-public-welcome__section-mark">
          <span className="tt-public-welcome__eyebrow">{copy.why.eyebrow}</span>
          <span className="tt-public-welcome__rule" aria-hidden="true" />
        </div>
        <div className="tt-public-welcome__why-copy">
          <h2 id="tt-public-welcome-why-title">{copy.why.title}</h2>
          <p>{copy.why.body}</p>
        </div>
        <div className="tt-public-welcome__thesis">
          <span>{copy.why.thesisLabel}</span>
          <p>{copy.why.thesis}</p>
        </div>
      </section>

      <section className="tt-public-welcome__today" id="today" aria-labelledby="tt-public-welcome-today-title">
        <div className="tt-public-welcome__today-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">{copy.today.eyebrow}</p>
            <h2 id="tt-public-welcome-today-title">{copy.today.title}</h2>
          </div>
          <p>{copy.today.summary}</p>
        </div>
        <div className="tt-public-welcome__capabilities">
          {copy.today.capabilities.map((item) => <article key={item.label}>
            <span className="tt-public-welcome__capability-label">{item.label}</span>
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>)}
        </div>

        <div className="tt-public-welcome__demos">
          <div className="tt-public-welcome__demos-heading">
            <div>
              <p className="tt-public-welcome__eyebrow">{copy.demos.eyebrow}</p>
              <h3>{copy.demos.title}</h3>
            </div>
            <p>{copy.demos.body}</p>
          </div>
          <div className="tt-public-welcome__demo-figures">
            {([[copy.demos.physics, physicsImage], [copy.demos.encounter, encounterImage]] as const).map(([demo, image]) => <figure key={demo.name}>
              <img src={image} width={1652} height={928} loading="lazy" decoding="async" alt={demo.alt} />
              <figcaption><span><strong>{demo.name}</strong><small>{demo.hint}</small></span><a href="/demo" target="_blank" rel="noopener" aria-label={demo.openLabel}>{demo.open} <ArrowUpRight size={14} /></a></figcaption>
            </figure>)}
          </div>
          <p className="tt-public-welcome__demo-note">{copy.demos.note}</p>
        </div>
      </section>

      <section className="tt-public-welcome__lenses" aria-labelledby="tt-public-welcome-lenses-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">{copy.lenses.eyebrow}</p>
            <h2 id="tt-public-welcome-lenses-title">{copy.lenses.title}</h2>
          </div>
          <p>{copy.lenses.disclaimer}</p>
        </div>
        <div className="tt-public-welcome__lens-list">
          {copy.lenses.items.map((lens, index) => {
            const Icon = [FileText, BookOpen, UsersRound][index];
            return <article className="tt-public-welcome__lens" key={lens.title}>
              <Icon aria-hidden="true" size={20} />
              <h3>{lens.title}</h3>
              <p>{lens.body}</p>
            </article>;
          })}
        </div>
      </section>

      {closingAction && <section className="tt-public-welcome__closing" aria-labelledby="tt-public-welcome-closing-title">
        <div>
          <p className="tt-public-welcome__eyebrow">{copy.closing.eyebrow}</p>
          <h2 id="tt-public-welcome-closing-title">{copy.closing.title}</h2>
        </div>
        {closingAction}
      </section>}

      <footer className="tt-public-welcome__footer">
        <span className="tt-brand tt-public-welcome__brand"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></span>
        <span>{copy.footer}</span>
      </footer>
    </div>
  </main></LandingLanguageContext.Provider>;
}
