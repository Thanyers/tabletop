import { ArrowDownRight, ArrowUpRight, BookOpen, FileText, UsersRound } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { landingCopy, landingLanguages, languageOptionLabel, readLandingLanguage, saveLandingLanguage, type LandingCopy, type LandingLanguage } from './landing-copy';
import { NarrativeSalesDemo } from './NarrativeSalesDemo';
import { PhysicalAdaptationStories } from './PhysicalAdaptationStories';
import { HeroCaseRotation } from './HeroCaseRotation';
import physicsImage from '../../../docs/showcase/physics.png';
import encounterImage from '../../../docs/showcase/encounter.png';
import './public-welcome.css';

const reducedMotionQuery = '(prefers-reduced-motion: reduce)';
const useCaseIcons = [FileText, BookOpen, UsersRound];

/**
 * Shared public landing for signed-out and signed-in visitors. Account and invitation actions
 * remain owned by account.tsx; the page gives both states the same language-aware product story.
 */
export function PublicWelcome({ children, headerAction, notice, primaryHref = '#sign-in' }: {
  children?: (copy: LandingCopy) => ReactNode;
  headerAction?: (copy: LandingCopy) => ReactNode;
  notice?: (copy: LandingCopy) => ReactNode;
  primaryHref?: string;
}) {
  const [language, setLanguage] = useState<LandingLanguage>(readLandingLanguage);
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia(reducedMotionQuery).matches);

  useEffect(() => {
    const media = window.matchMedia(reducedMotionQuery);
    const updatePreference = (event: MediaQueryListEvent) => {
      setReducedMotion(event.matches);
    };
    setReducedMotion(media.matches);
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

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

  return <div className="tt-account-gate tt-public-welcome" lang={language}>
    <a className="tt-public-welcome__skip" href="#main-content">{language === 'en' ? 'Skip to content' : 'ข้ามไปยังเนื้อหา'}</a>
    <header className="tt-public-welcome__header">
      <a className="tt-brand tt-public-welcome__brand" href="/" aria-label={copy.header.home} onClick={(event) => {
        if (window.location.pathname !== '/') return;
        event.preventDefault();
        window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' });
      }}>
        <span className="tt-brand__mark tt-public-welcome__mark-motion" aria-hidden="true"><i /><i /><i /><i /></span>
        <span>tabletop<span>.</span></span>
      </a>
      <nav className="tt-public-welcome__nav" aria-label={copy.header.navigation}>
        <a href="#why">{copy.header.why}</a>
        <a href="#board">{copy.header.board}</a>
        <a href="#examples">{copy.header.examples}</a>
      </nav>
      <div className="tt-public-welcome__language" role="group" aria-label={copy.header.languageGroup}>
        {landingLanguages.map((option) => <button key={option} type="button" lang={option} aria-pressed={option === language} onClick={() => chooseLanguage(option)}>{languageOptionLabel[option]}</button>)}
      </div>
      {headerAction?.(copy) ?? <a className="tt-public-welcome__signin" href="#sign-in">{copy.header.signIn} <ArrowUpRight size={14} aria-hidden="true" /></a>}
    </header>
    <main id="main-content" tabIndex={-1}>
      {notice?.(copy)}
      <div className="tt-public-welcome__content">
      <section className="tt-public-welcome__hero" id="top" aria-labelledby="tt-public-welcome-title">
        <div className="tt-public-welcome__hero-copy">
          <h1 id="tt-public-welcome-title">{copy.hero.title}</h1>
          <p className="tt-public-welcome__promise">{copy.hero.promise}</p>
          <div className="tt-public-welcome__hero-actions">
            <a className="tt-public-welcome__primary-link" href={primaryHref}>{copy.hero.primary} <ArrowUpRight size={16} aria-hidden="true" /></a>
            <a className="tt-public-welcome__secondary-link" href="#film">{copy.hero.secondary} <ArrowDownRight size={15} aria-hidden="true" /></a>
          </div>
        </div>
        <HeroCaseRotation language={language} />
      </section>

      <section className="tt-public-welcome__why" id="why" aria-labelledby="tt-public-welcome-why-title">
        <div className="tt-public-welcome__why-heading">
          <h2 id="tt-public-welcome-why-title">{copy.why.title}</h2>
        </div>
        <div className="tt-public-welcome__why-copy">
          <p>{copy.why.body}</p>
        </div>
        <PhysicalAdaptationStories language={language} copy={copy.why.stories} />
        <div className="tt-public-welcome__bridge">
          <h3>{copy.why.bridgeTitle}</h3>
          <div><p>{copy.why.problem}</p><p>{copy.why.solution}</p></div>
        </div>
      </section>

      <NarrativeSalesDemo language={language} />

      <section className="tt-public-welcome__use-cases" id="examples" aria-labelledby="tt-public-welcome-use-cases-title">
        <div className="tt-public-welcome__section-heading">
          <div>
            <h2 id="tt-public-welcome-use-cases-title">{copy.useCases.title}</h2>
          </div>
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
            <figcaption><span><strong>Physics</strong><small>{copy.useCases.physics.hint}</small></span><a href="/demo" target="_blank" rel="noopener noreferrer">{copy.useCases.physics.open} <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
          <figure>
            <img src={encounterImage} width={1652} height={928} loading="lazy" decoding="async" alt={copy.useCases.encounter.alt} />
            <figcaption><span><strong>Encounter</strong><small>{copy.useCases.encounter.hint}</small></span><a href="/demo" target="_blank" rel="noopener noreferrer">{copy.useCases.encounter.open} <ArrowUpRight size={14} aria-hidden="true" /></a></figcaption>
          </figure>
        </div>
        <p className="tt-public-welcome__demo-note">{copy.useCases.demoNote}</p>
      </section>

      <section className="tt-public-welcome__film" id="film" aria-labelledby="tt-public-welcome-film-title">
        <div className="tt-public-welcome__film-heading">
          <div>
            <h2 id="tt-public-welcome-film-title">{copy.film.title}</h2>
          </div>
        </div>
        <figure className="tt-public-welcome__film-frame">
          <video controls playsInline preload="metadata" poster="/narrative/tabletop-story-poster.png" aria-label={copy.film.alt}>
            <source src="/narrative/tabletop-story.mp4" type="video/mp4" />
            <track kind="captions" src="/narrative/tabletop-story-en.vtt" srcLang="en" label="English captions" default />
            {copy.film.unavailable}
          </video>
          <figcaption>{copy.film.caption}</figcaption>
        </figure>
      </section>

      <section className={'tt-public-welcome__start' + (children ? '' : ' tt-public-welcome__start--solo')} aria-labelledby="tt-public-welcome-start-title">
        <div className="tt-public-welcome__start-copy">
          <h2 id="tt-public-welcome-start-title">{copy.start.title}</h2>
          <p>{copy.start.body}</p>
        </div>
        {children && <div className="tt-public-welcome__start-slot">{children(copy)}</div>}
      </section>
      </div>
    </main>

    <div className="tt-public-welcome__content">
      <footer className="tt-public-welcome__footer">
        <a className="tt-brand tt-public-welcome__brand" href="#top" aria-label={copy.header.home}>
          <span className="tt-brand__mark" aria-hidden="true"><i /><i /><i /><i /></span>
          <span>tabletop<span>.</span></span>
        </a>
        <nav className="tt-public-welcome__footer-links" aria-label={language === 'en' ? 'Photo credits' : 'เครดิตภาพ'}>
          <a href="/narrative/SOURCES.md" target="_blank" rel="noopener noreferrer">{copy.header.photoCredits} <ArrowUpRight size={12} aria-hidden="true" /></a>
        </nav>
      </footer>
    </div>
  </div>;
}
