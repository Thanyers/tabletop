import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import './materialize-surface.css';

export type MaterializeVariant = 'shipping' | 'quest' | 'music' | 'generic';

export interface MaterializeSurfaceProps {
  pending: boolean;
  identity: string;
  variant?: MaterializeVariant;
  label?: string;
  paused?: boolean;
  children: ReactNode;
  renderWhilePending?: boolean;
}

type SurfaceState = 'pending' | 'revealing' | 'ready';
type PartStyle = CSSProperties & { '--part-delay'?: string; '--bar-size'?: string };

const MIN_SURFACE_HEIGHT = 240;
const MAX_ANIMATED_HEIGHT = 2400;
const REVEAL_MS = 760;

function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

function boundedHeight(value: number) {
  if (!Number.isFinite(value)) return MIN_SURFACE_HEIGHT;
  return Math.max(MIN_SURFACE_HEIGHT, Math.min(MAX_ANIMATED_HEIGHT, Math.ceil(value)));
}

function partStyle(index: number, extra?: string): PartStyle {
  return {
    '--part-delay': `${index * 72}ms`,
    ...(extra ? { '--bar-size': extra } : {}),
  };
}

function SkeletonTable() {
  return <div className="materialize-surface__table">
    <div className="materialize-surface__table-head materialize-surface__part" style={partStyle(2)}><i/><i/><i/></div>
    {Array.from({ length: 4 }, (_, row) => <div className="materialize-surface__table-row materialize-surface__part" key={row} style={partStyle(row + 3)}>
      <i/><i/><i/>
    </div>)}
  </div>;
}

function SurfaceSkeleton({ variant }: { variant: MaterializeVariant }) {
  return <div className={`materialize-surface__skeleton materialize-surface__skeleton--${variant}`} data-testid="materialize-skeleton" aria-hidden="true">
    <header className="materialize-surface__skeleton-header materialize-surface__part" style={partStyle(0)}>
      <i className="materialize-surface__skeleton-mark"/>
      <span className="materialize-surface__skeleton-heading">
        <i className="materialize-surface__skeleton-title"/>
        <i className="materialize-surface__skeleton-subtitle"/>
      </span>
    </header>

    <div className="materialize-surface__skeleton-body">
      {variant === 'shipping' && <>
        <div className="materialize-surface__route materialize-surface__part" style={partStyle(1)}>
          <i/><span/><i/><span/><i/>
        </div>
        <SkeletonTable/>
      </>}

      {variant === 'quest' && <>
        <div className="materialize-surface__quest-route materialize-surface__part" style={partStyle(1)}>
          <i/><span/><i/><span/><i/>
        </div>
        <div className="materialize-surface__quest-cards">
          {Array.from({ length: 3 }, (_, index) => <div className="materialize-surface__quest-card materialize-surface__part" key={index} style={partStyle(index + 2)}><i/><i/><i/></div>)}
        </div>
      </>}

      {variant === 'music' && <>
        <div className="materialize-surface__wave materialize-surface__part" style={partStyle(1)}>
          {[22, 38, 54, 32, 70, 44, 80, 57, 35, 65, 46, 74, 30, 56, 82, 42, 62, 34, 70, 49, 77, 38, 59, 28].map((height, index) => <i key={index} style={partStyle(index + 2, `${height}%`)}/>) }
        </div>
        <div className="materialize-surface__music-pads">
          {Array.from({ length: 2 }, (_, index) => <div className="materialize-surface__music-pad materialize-surface__part" key={index} style={partStyle(index + 4)}><i/><i/><i/></div>)}
        </div>
        <div className="materialize-surface__music-track materialize-surface__part" style={partStyle(6)}><i/><i/><i/></div>
      </>}

      {variant === 'generic' && <>
        <div className="materialize-surface__metrics">
          {Array.from({ length: 3 }, (_, index) => <div className="materialize-surface__metric materialize-surface__part" key={index} style={partStyle(index + 1)}><i/><i/></div>)}
        </div>
        <SkeletonTable/>
      </>}
    </div>
  </div>;
}

/**
 * Keeps a stable canvas shell while an authored surface is prepared, then
 * reveals the actual child UI. `identity` names the artifact generation; a
 * repeated render with the same identity never restarts the reveal.
 */
export default function MaterializeSurface({
  pending,
  identity,
  variant = 'generic',
  label,
  paused = false,
  children,
  renderWhilePending = false,
}: MaterializeSurfaceProps) {
  const shellRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const identityRef = useRef(identity);
  const wasPendingRef = useRef(pending);
  const previousHeightRef = useRef(MIN_SURFACE_HEIGHT);
  const measuredContentHeightRef = useRef(MIN_SURFACE_HEIGHT);
  const revealRef = useRef<{ identity: string; animations: Animation[] } | null>(null);
  const [state, setState] = useState<SurfaceState>(() => pending ? 'pending' : 'ready');
  const [childrenMounted, setChildrenMounted] = useState(() => !pending || renderWhilePending);
  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);

  const identityChanged = identityRef.current !== identity;
  const visibleState: SurfaceState = identityChanged ? (pending ? 'pending' : 'ready') : pending ? 'pending' : state;
  const shouldMountChildren = identityChanged ? (!pending || renderWhilePending) : childrenMounted;
  const contentInteractive = visibleState === 'ready' && !pending;
  const showSkeleton = visibleState !== 'ready';

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!media) return;
    const update = () => setReducedMotion(media.matches);
    update();
    if (media.addEventListener) media.addEventListener('change', update);
    else media.addListener?.(update);
    return () => {
      if (media.removeEventListener) media.removeEventListener('change', update);
      else media.removeListener?.(update);
    };
  }, []);

  useEffect(() => {
    if (identityRef.current !== identity) {
      identityRef.current = identity;
      wasPendingRef.current = pending;
      setState(pending ? 'pending' : 'ready');
      setChildrenMounted(!pending || renderWhilePending);
      previousHeightRef.current = MIN_SURFACE_HEIGHT;
      measuredContentHeightRef.current = MIN_SURFACE_HEIGHT;
      return;
    }

    if (pending) {
      wasPendingRef.current = true;
      if (renderWhilePending) setChildrenMounted(true);
      setState('pending');
      return;
    }

    setChildrenMounted(true);
    if (wasPendingRef.current) {
      wasPendingRef.current = false;
      setState(reducedMotion ? 'ready' : 'revealing');
    } else {
      setState('ready');
    }
  }, [identity, pending, renderWhilePending, reducedMotion]);

  // Observe only the child's natural box. The observer never writes layout
  // styles, so measuring a child cannot feed back into its own size.
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!content || !childrenMounted) return;
    if (typeof ResizeObserver === 'undefined') {
      measuredContentHeightRef.current = boundedHeight(content.scrollHeight);
      return;
    }
    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (!entry) return;
      measuredContentHeightRef.current = boundedHeight(Math.max(entry.contentRect.height, content.scrollHeight));
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [childrenMounted, identity]);

  useLayoutEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    if (visibleState === 'pending') {
      shell.style.height = 'auto';
      shell.style.overflow = '';
      previousHeightRef.current = boundedHeight(shell.offsetHeight);
      return;
    }

    if (visibleState === 'ready') {
      shell.style.height = 'auto';
      shell.style.overflow = '';
      return;
    }

    if (reducedMotion || typeof shell.animate !== 'function') {
      shell.style.height = 'auto';
      shell.style.overflow = '';
      setState('ready');
      return;
    }

    // The shell still reflects the pending skeleton's size here. Size the
    // destination from the real child only so the placeholder cannot set the
    // final canvas height.
    const naturalHeight = Math.max(MIN_SURFACE_HEIGHT, contentRef.current?.scrollHeight ?? 0, measuredContentHeightRef.current);
    const canAnimateHeight = naturalHeight <= MAX_ANIMATED_HEIGHT;
    const from = previousHeightRef.current;
    const to = boundedHeight(naturalHeight);
    const duration = reducedMotion ? 0 : REVEAL_MS;
    if (canAnimateHeight) {
      shell.style.height = `${from}px`;
      shell.style.overflow = 'hidden';
    } else {
      shell.style.height = 'auto';
      shell.style.overflow = '';
    }

    const animations: Animation[] = [];
    if (canAnimateHeight && Math.abs(to - from) > 1) {
      animations.push(shell.animate(
        [{ height: `${from}px` }, { height: `${to}px` }],
        { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
      ));
    }
    const content = contentRef.current;
    if (content) animations.push(content.animate(
      [
        { opacity: 0.24, clipPath: 'inset(0 0 88% 0 round 12px)' },
        { opacity: 1, clipPath: 'inset(0 0 0 0 round 12px)' },
      ],
      { duration, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'forwards' },
    ));
    const skeleton = shell.querySelector<HTMLElement>('.materialize-surface__skeleton');
    if (skeleton) animations.push(skeleton.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: duration * 0.82, easing: 'ease-out', fill: 'forwards' },
    ));

    const reveal = { identity, animations };
    revealRef.current = reveal;
    if (paused) animations.forEach(animation => animation.pause());
    const finish = () => {
      if (revealRef.current !== reveal) return;
      shell.style.height = 'auto';
      shell.style.overflow = '';
      animations.forEach(animation => animation.cancel());
      revealRef.current = null;
      setState('ready');
    };
    const mainAnimation = animations.find(animation => animation.effect?.getTiming().duration === duration) ?? animations[0];
    if (mainAnimation) mainAnimation.onfinish = finish;
    else finish();

    return () => {
      if (revealRef.current === reveal) {
        animations.forEach(animation => animation.cancel());
        revealRef.current = null;
      }
    };
  }, [identity, visibleState, reducedMotion]);

  useEffect(() => {
    revealRef.current?.animations.forEach(animation => paused ? animation.pause() : animation.play());
  }, [paused]);

  const accessibleLabel = label ? `${label}${contentInteractive ? '' : ' · กำลังจัดวาง'}` : undefined;
  return <div
    ref={shellRef}
    className={`materialize-surface materialize-surface--${variant}`}
    data-testid="materialize-surface"
    data-state={visibleState}
    data-variant={variant}
    data-paused={paused ? 'true' : undefined}
    role={label ? 'region' : undefined}
    aria-label={accessibleLabel}
    aria-busy={showSkeleton || undefined}
  >
    <div
      ref={contentRef}
      className="materialize-surface__content"
      key={`content-${identity}`}
      aria-hidden={contentInteractive ? undefined : true}
      inert={contentInteractive ? undefined : true}
    >
      {shouldMountChildren ? children : null}
    </div>
    {showSkeleton && <SurfaceSkeleton key={`skeleton-${identity}`} variant={variant}/>}
  </div>;
}
