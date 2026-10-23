import { ArrowUpRight, BookOpen, FileText, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { landingCopy, landingLanguages, languageOptionLabel, productThesis, readLandingLanguage, saveLandingLanguage, type LandingCopy, type LandingLanguage } from './landing-copy';
import storyGif from '../../../docs/showcase/tabletop-story.gif';
import storyPoster from '../../../docs/showcase/tabletop-story-poster.png';
import physicsImage from '../../../docs/showcase/physics.png';
import encounterImage from '../../../docs/showcase/encounter.png';
import heroIllustration from './landing-table.svg';
import './public-welcome.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const useCaseIcons = [FileText, BookOpen, UsersRound];

/**
 * The public landing (F061) in English or Thai (F068). The language lives here, so the
 * sign-in / welcome-back box passed as `children` and the `headerAction` receive the
 * current copy and switch with the rest of the page.
 */
export function PublicWelcome({ children, headerAction }: {
  children: (copy: LandingCopy) => ReactNode;
  headerAction?: (copy: LandingCopy) => ReactNode;
}) {
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

  // The document language follows the landing so screen readers and fonts pick Thai; the
  // app behind sign-in is English, so the previous value comes back when the landing unmounts.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.lang;
    root.lang = language;
    return () => { root.lang = previous; };
  }, [language]);

  const chooseLanguage = (next: LandingLanguage) => {
    setLanguage(next);
    saveLandingLanguage(next);
  };

  const copy = landingCopy[language];
  const storySource = playStory && replay > 0 ? `${storyGif}?replay=${replay}` : playStory ? storyGif : storyPoster;

  return <main className="tt-account-gate tt-public-welcome" lang={language}>
    <header className="tt-public-welcome__header">
      <a className="tt-brand tt-public-welcome__brand" href="/" aria-label={copy.header.home} onClick={(event) => {
        // Already home: a full reload would only replay both loading stages.
        if (window.location.pathname !== '/') return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }}>
        <span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>tabletop<span>.</span></span>
      </a>
      <span className="tt-public-welcome__header-note">{copy.header.note}</span>
      <div className="tt-public-welcome__language" role="group" aria-label={copy.header.languageGroup}>
        {landingLanguages.map((option) => <button key={option} type="button" lang={option} aria-pressed={option === language} onClick={() => chooseLanguage(option)}>{languageOptionLabel[option]}</button>)}
      </div>
      {headerAction?.(copy) ?? <a className="tt-public-welcome__signin" href="#sign-in">{copy.header.signIn} <ArrowUpRight size={14} aria-hidden="true" /></a>}
    </header>

    <div className="tt-public-welcome__content">
      <section className="tt-public-welcome__hero" aria-labelledby="tt-public-welcome-title">
        <div className="tt-public-welcome__hero-copy">
          <p className="tt-public-welcome__eyebrow">{copy.hero.eyebrow}</p>
          <h1 id="tt-public-welcome-title">{copy.hero.title}</h1>
          <p className="tt-public-welcome__promise">{copy.hero.promise}</p>
          <div className="tt-public-welcome__hero-actions">
            <a className="tt-public-welcome__primary-link" href="#sign-in">{copy.hero.primary} <ArrowUpRight size={16} aria-hidden="true" /></a>
            <a className="tt-public-welcome__secondary-link" href="/demo" target="_blank" rel="noopener">{copy.hero.secondary} <ArrowUpRight size={15} aria-hidden="true" /></a>
          </div>
        </div>

        <figure className="tt-public-welcome__hero-art">
          <img src={heroIllustration} width={800} height={650} alt={copy.hero.alt} />
          <figcaption>{copy.hero.caption}</figcaption>
        </figure>
      </section>

      <section className="tt-public-welcome__why" aria-labelledby="tt-public-welcome-why-title">
        <div className="tt-public-welcome__why-heading">
          <p className="tt-public-welcome__eyebrow">{copy.why.eyebrow}</p>
          <h2 id="tt-public-welcome-why-title">{copy.why.title}</h2>
        </div>
        <div className="tt-public-welcome__why-copy">
          <p>{copy.why.body}</p>
          <div className="tt-public-welcome__thesis">
            <span>{copy.why.thesisLabel}</span>
            <p lang="en">{productThesis}</p>
          </div>
        </div>
      </section>

      <section className="tt-public-welcome__process" aria-labelledby="tt-public-welcome-process-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">{copy.process.eyebrow}</p>
            <h2 id="tt-public-welcome-process-title">{copy.process.title}</h2>
          </div>
          <p>{copy.process.aside}</p>
        </div>

        <div className="tt-public-welcome__process-layout">
          <figure className="tt-public-welcome__story">
            <div className="tt-public-welcome__story-frame">
              <img key={playStory ? `story-${replay}` : 'poster'} src={storySource} width={960} height={540} loading="lazy" decoding="async" alt={copy.process.storyAlt} />
            </div>
            <figcaption>
              <span>{copy.process.storyCaption}</span>
              <button type="button" onClick={showStory} aria-label={playStory ? copy.process.showStillLabel : copy.process.replayLabel}>
                {playStory ? copy.process.showStill : reducedMotion ? copy.process.replay : copy.process.replayIdea}
              </button>
            </figcaption>
            <p className="tt-public-welcome__story-note">{copy.process.storyNote}</p>
          </figure>

          <ol className="tt-public-welcome__steps">
            {copy.process.steps.map((step, index) => <li key={index}>
              <span className="tt-public-welcome__step-number">{String(index + 1).padStart(2, '0')}</span>
              <div><h3>{step.title}</h3><p>{step.body}</p></div>
            </li>)}
          </ol>
        </div>
      </section>

      <section className="tt-public-welcome__use-cases" id="today" aria-labelledby="tt-public-welcome-use-cases-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <p className="tt-public-welcome__eyebrow">{copy.useCases.eyebrow}</p>
            <h2 id="tt-public-welcome-use-cases-title">{copy.useCases.title}</h2>
          </div>
          <p>{copy.useCases.aside}</p>
        </div>

        <div className="tt-public-welcome__use-case-list">
          {copy.useCases.items.map((item, index) => {
            const Icon = useCaseIcons[index] ?? FileText;
            return <article className="tt-public-welcome__use-case" key={index}>
              <Icon aria-hidden="true" size={20} />
              <div><h3>{item.title}</h3><p>{item.body}</p></div>
            </article>;
          })}
        </div>

        <div className="tt-public-welcome__demo-figures">
          <figure>
            <img src={physicsImage} width={1652} height={928} loading="lazy" decoding="async" alt={copy.useCases.physics.alt} />
            <figcaption><span><strong>Physics</strong><small>{copy.useCases.physics.hint}</small></span><a href="/demo" target="_blank" rel="noopener">{copy.useCases.physics.open} <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
          <figure>
            <img src={encounterImage} width={1652} height={928} loading="lazy" decoding="async" alt={copy.useCases.encounter.alt} />
            <figcaption><span><strong>Encounter</strong><small>{copy.useCases.encounter.hint}</small></span><a href="/demo" target="_blank" rel="noopener">{copy.useCases.encounter.open} <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
        </div>
        <p className="tt-public-welcome__demo-note">{copy.useCases.demoNote}</p>
      </section>

      <section className="tt-public-welcome__start" aria-labelledby="tt-public-welcome-start-title">
        <div className="tt-public-welcome__start-copy">
          <p className="tt-public-welcome__eyebrow">{copy.start.eyebrow}</p>
          <h2 id="tt-public-welcome-start-title">{copy.start.title}</h2>
          <p>{copy.start.body}</p>
        </div>
        <div className="tt-public-welcome__start-slot">{children(copy)}</div>
      </section>

      <footer className="tt-public-welcome__footer">
        <span className="tt-brand tt-public-welcome__brand"><span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span><span>tabletop<span>.</span></span></span>
        <span>{copy.footer}</span>
      </footer>
    </div>
  </main>;
}
