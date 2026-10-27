import { useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { SurfaceVisibility } from '../SurfaceVisibility';
import {
  BASELINE_ENCOUNTER_RULE,
  ENCOUNTER_ACTORS,
  ENCOUNTER_TRACE,
  createEncounterState,
  resolveEncounterAction,
  runEncounter,
  type EncounterShieldTarget,
  type EncounterActorId,
  type EncounterEvent,
  type EncounterOutcome,
  type EncounterRule,
  type EncounterState,
} from './encounterModel';
import './encounter-game.css';

export interface EncounterGameProps {
  rule: EncounterRule;
  mode: 'before' | 'draft' | 'verify' | 'active' | 'simulate';
  autoPlay: boolean;
  paused: boolean;
  visible: boolean;
  speed: number;
  replayKey: string;
  /** Stable encounter identity that namespaces this instance's per-view snapshots. */
  sessionKey?: string;
  onFeedback?: (text: string) => void;
  onRoundComplete?: (outcome: EncounterOutcome) => void;
}

const MAX_HP = { mira: 10, pip: 10, goblin: 6 } as const;

export type EncounterPhase = 'intent' | 'rolling' | 'impact' | 'hpUpdate' | 'hold' | 'complete';

/** At 1x speed, one authored action takes 2.38 seconds from intent to the next intent. */
export const ENCOUNTER_PHASE_DURATIONS_MS = Object.freeze({
  intent: 320,
  rolling: 560,
  impact: 420,
  hpUpdate: 180,
  hold: 900,
} as const);

interface EncounterRuntimeSnapshot {
  state: EncounterState;
  nextIndex: number;
  phase: EncounterPhase;
  shieldTarget: EncounterShieldTarget;
  pendingState: EncounterState | null;
  manualPlaying: boolean;
  singleStepRunning: boolean;
  completedRound: boolean;
  feedbackSent: boolean;
  phaseProgress: { token: string; progress: number };
}

interface CachedEncounterSnapshot extends EncounterRuntimeSnapshot {
  resetKey: string;
}

interface EncounterCacheIdentity {
  cacheKey: string | null;
  resetKey: string;
}

interface PhaseTimerSnapshot {
  token: string;
  deadline: number;
  speed: number;
  duration: number;
}

const MAX_ENCOUNTER_SNAPSHOTS = 24;

function makeEncounterCacheKey(sessionKey: string | undefined, replayKey: string): string | null {
  return sessionKey ? JSON.stringify([sessionKey, replayKey]) : null;
}

function readEncounterSnapshot(
  cache: Map<string, CachedEncounterSnapshot>,
  cacheKey: string | null,
  resetKey: string,
): CachedEncounterSnapshot | null {
  if (!cacheKey) return null;
  const snapshot = cache.get(cacheKey);
  if (!snapshot || snapshot.resetKey !== resetKey) return null;
  cache.delete(cacheKey);
  cache.set(cacheKey, snapshot);
  return snapshot;
}

function writeEncounterSnapshot(
  cache: Map<string, CachedEncounterSnapshot>,
  cacheKey: string | null,
  resetKey: string,
  snapshot: EncounterRuntimeSnapshot,
): void {
  if (!cacheKey) return;
  cache.delete(cacheKey);
  cache.set(cacheKey, {
    ...snapshot,
    resetKey,
    phaseProgress: { ...snapshot.phaseProgress },
  });
  while (cache.size > MAX_ENCOUNTER_SNAPSHOTS) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
}

function snapshotPhaseProgress(
  snapshot: EncounterRuntimeSnapshot,
  timer: PhaseTimerSnapshot | null,
): { token: string; progress: number } {
  const token = `${snapshot.phase}:${snapshot.nextIndex}`;
  if (timer?.token === token) {
    const remaining = ((timer.deadline - performance.now()) * timer.speed) / timer.duration;
    return { token, progress: Math.max(0, Math.min(1, remaining)) };
  }
  return snapshot.phaseProgress.token === token
    ? { ...snapshot.phaseProgress }
    : { token, progress: 1 };
}

function HeroSprite({ actor }: { actor: EncounterActorId }) {
  if (actor === 'goblin') {
    return (
      <svg className="encounter-game__sprite encounter-game__sprite--goblin" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M7 17 2 9l12 2M41 17l5-8-12 2" fill="#7ac7a4" stroke="#356c5b" strokeWidth="2" strokeLinejoin="round" />
        <path d="M10 20c0-8 6-13 14-13s14 5 14 13v9c0 8-6 13-14 13s-14-5-14-13z" fill="#75bb92" stroke="#356c5b" strokeWidth="2" />
        <path d="M15 22h6m6 0h6" stroke="#26364a" strokeWidth="3" strokeLinecap="round" />
        <path d="m20 31 4 2 4-2" fill="none" stroke="#356c5b" strokeWidth="2" strokeLinecap="round" />
        <path d="m14 40 10-4 10 4v7H14z" fill="#f18a73" stroke="#9d554f" strokeWidth="2" />
      </svg>
    );
  }

  if (actor === 'mira') {
    return (
      <svg className="encounter-game__sprite" viewBox="0 0 48 48" aria-hidden="true">
        <path d="M8 21C8 9 14 3 24 3s16 6 16 18v8H8z" fill="#6654bd" />
        <path d="M14 19c0-7 4-11 10-11s10 4 10 11v9c0 7-4 11-10 11s-10-4-10-11z" fill="#f1c6a5" />
        <path d="M12 18c5-2 7-6 9-11 2 5 7 8 15 8v5c-5-2-11-4-16-4-2 2-5 4-8 5z" fill="#483f88" />
        <circle cx="20" cy="25" r="1.4" fill="#26364a" /><circle cx="29" cy="25" r="1.4" fill="#26364a" />
        <path d="M20 31q4 3 8 0" fill="none" stroke="#9b625a" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M13 42q11-7 22 0v5H13z" fill="#8576d5" />
        <path d="m3 27 7-5 8 7-3 13-9-2z" fill="#7fcae4" stroke="#417e9c" strokeWidth="2" />
      </svg>
    );
  }

  return (
    <svg className="encounter-game__sprite" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 21C8 9 14 3 24 3s16 6 16 18v8H8z" fill="#d78752" />
      <path d="M14 19c0-7 4-11 10-11s10 4 10 11v9c0 7-4 11-10 11s-10-4-10-11z" fill="#f2c8aa" />
      <path d="M10 19c2-8 6-13 14-13s12 5 14 13l-5-1-8-6-8 7z" fill="#99563d" />
      <circle cx="20" cy="25" r="1.4" fill="#26364a" /><circle cx="29" cy="25" r="1.4" fill="#26364a" />
      <path d="M20 31q4 3 8 0" fill="none" stroke="#9b625a" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M13 42q11-7 22 0v5H13z" fill="#f29b6e" />
      <path d="M39 20q8 7 0 16m-2-13q5 6 0 11" fill="none" stroke="#85522e" strokeWidth="2" strokeLinecap="round" />
      <path d="M38 18 43 37" stroke="#85522e" strokeWidth="1.5" />
    </svg>
  );
}

function HpBar({ actor, value }: { actor: EncounterActorId; value: number }) {
  const maximum = MAX_HP[actor];
  const percent = Math.max(0, Math.min(100, (value / maximum) * 100));
  return (
    <div className="encounter-game__hp" role="progressbar" aria-label={`${actor} HP`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={value}>
      <span className="encounter-game__hp-track"><i style={{ width: `${percent}%` }} /></span>
      <strong>{value}<small>/{maximum}</small></strong>
    </div>
  );
}

function actorForStep(index: number): EncounterActorId | null {
  return ENCOUNTER_ACTORS[index] ?? null;
}

function nextAvailableActionIndex(state: EncounterState, startIndex: number): number {
  if (state.hp.goblin <= 0) return ENCOUNTER_ACTORS.length;
  for (let index = startIndex; index < ENCOUNTER_ACTORS.length; index += 1) {
    const actor = actorForStep(index);
    if (actor && state.hp[actor] > 0 && !state.acted.includes(actor)) return index;
  }
  return ENCOUNTER_ACTORS.length;
}

function targetForAction(
  actor: EncounterActorId | null,
  state: EncounterState,
  shieldTarget: EncounterShieldTarget,
): EncounterEvent['targetId'] {
  if (actor === 'mira') return shieldTarget;
  if (actor === 'goblin') return state.hp.pip > 0 ? 'pip' : 'mira';
  return 'goblin';
}

function cursorPoint(actor: 'you' | 'bot', target: EncounterActorId): { left: string; top: string } {
  if (actor === 'you') {
    if (target === 'pip') return { left: '47%', top: '34%' };
    return { left: '16%', top: '43%' };
  }
  if (target === 'goblin') return { left: '80%', top: '35%' };
  return { left: '48%', top: '43%' };
}

function cursorStyle(point: { left: string; top: string }): CSSProperties {
  return { '--pointer-x': point.left, '--pointer-y': point.top } as CSSProperties;
}

function actorLabel(actor: EncounterActorId | null): string {
  if (actor === 'mira') return 'คุณ · Mira';
  if (actor === 'pip') return 'Nina · บอท Pip';
  if (actor === 'goblin') return 'Goblin';
  return 'รอเริ่มรอบ';
}

function actionLabel(actor: EncounterActorId | null, target: EncounterEvent['targetId']): string {
  if (actor === 'mira') return `ตั้งโล่ให้${target === 'pip' ? ' Pip' : 'ตัวเอง'}`;
  if (actor === 'goblin') return `โจมตี ${target === 'pip' ? 'Pip' : 'Mira'}`;
  if (actor === 'pip') return 'ยิง Goblin';
  return 'รอเริ่มรอบ';
}

function phaseLabel(phase: EncounterPhase): string {
  if (phase === 'intent') return 'เตรียมแอ็กชัน';
  if (phase === 'rolling') return 'กำลังทอย';
  if (phase === 'impact') return 'กำลังกระทบ';
  if (phase === 'hpUpdate') return 'อัปเดตพลังชีวิต';
  if (phase === 'hold') return 'ดูผลแอ็กชัน';
  return 'จบรอบแล้ว';
}

export function EncounterGame({
  rule,
  mode,
  autoPlay,
  paused,
  visible,
  speed,
  replayKey,
  sessionKey,
  onFeedback,
  onRoundComplete,
}: EncounterGameProps) {
  const resetKey = `${replayKey}|${rule.allyShield ? '1' : '0'}|${rule.shieldReduction}`;
  const sessionCacheKey = makeEncounterCacheKey(sessionKey, replayKey);
  const encounterSnapshotsRef = useRef(new Map<string, CachedEncounterSnapshot>());
  const [initialSnapshot] = useState<CachedEncounterSnapshot | null>(() =>
    readEncounterSnapshot(encounterSnapshotsRef.current, sessionCacheKey, resetKey),
  );
  const surfaceVisible = useContext(SurfaceVisibility);
  const [documentVisible, setDocumentVisible] = useState(() =>
    typeof document === 'undefined' || !document.hidden,
  );
  const effectiveVisible = visible && surfaceVisible && documentVisible;
  const [state, setState] = useState<EncounterState>(() => initialSnapshot?.state ?? createEncounterState());
  const [nextIndex, setNextIndex] = useState(initialSnapshot?.nextIndex ?? 0);
  const [phase, setPhase] = useState<EncounterPhase>(initialSnapshot?.phase ?? 'intent');
  const [shieldTarget, setShieldTarget] = useState<EncounterShieldTarget>(() =>
    initialSnapshot?.shieldTarget ?? (rule.allyShield ? 'pip' : 'mira'),
  );
  const [manualPlaying, setManualPlaying] = useState(initialSnapshot?.manualPlaying ?? false);
  const [singleStepRunning, setSingleStepRunning] = useState(initialSnapshot?.singleStepRunning ?? false);
  const stateRef = useRef(state);
  const indexRef = useRef(nextIndex);
  const pendingStateRef = useRef<EncounterState | null>(initialSnapshot?.pendingState ?? null);
  const completedRoundRef = useRef(initialSnapshot?.completedRound ?? false);
  const feedbackSentRef = useRef(initialSnapshot?.feedbackSent ?? false);
  const onRoundCompleteRef = useRef(onRoundComplete);
  const phaseProgressRef = useRef(initialSnapshot?.phaseProgress ?? { token: 'intent:0', progress: 1 });
  const phaseTimerRef = useRef<PhaseTimerSnapshot | null>(null);
  const cacheIdentityRef = useRef<EncounterCacheIdentity>({ cacheKey: sessionCacheKey, resetKey });
  const latestSnapshotRef = useRef<EncounterRuntimeSnapshot>({
    state,
    nextIndex,
    phase,
    shieldTarget,
    pendingState: pendingStateRef.current,
    manualPlaying,
    singleStepRunning,
    completedRound: completedRoundRef.current,
    feedbackSent: feedbackSentRef.current,
    phaseProgress: phaseProgressRef.current,
  });
  const activeRule = useMemo(() => ({
    allyShield: Boolean(rule.allyShield),
    shieldReduction: Number.isFinite(rule.shieldReduction)
      ? Math.max(0, Math.min(6, Math.round(rule.shieldReduction)))
      : 0,
  }), [rule.allyShield, rule.shieldReduction]);
  const beforeOutcome = useMemo(() => runEncounter(BASELINE_ENCOUNTER_RULE), []);
  const afterOutcome = useMemo(() => runEncounter(activeRule, undefined, shieldTarget), [activeRule, shieldTarget]);
  const isPlayback = autoPlay || manualPlaying || singleStepRunning;
  const latestEvent = state.events[state.events.length - 1] ?? null;
  const displayedActor = phase === 'complete' ? latestEvent?.actorId ?? null : actorForStep(nextIndex);
  const hasResolvedCurrentAction = phase === 'hpUpdate' || phase === 'hold' || phase === 'complete';
  const currentEvent = hasResolvedCurrentAction && latestEvent?.actorId === displayedActor ? latestEvent : null;
  const currentTarget = currentEvent?.targetId ?? targetForAction(displayedActor, state, shieldTarget);
  const miraEvent = state.events.find((event) => event.actorId === 'mira');
  const pipEvent = state.events.find((event) => event.actorId === 'pip');
  const miraPoint = cursorPoint('you', displayedActor === 'mira' ? currentTarget : miraEvent?.targetId ?? 'mira');
  const pipPoint = cursorPoint('bot', displayedActor === 'pip' ? currentTarget : pipEvent?.targetId ?? 'pip');
  const effectPoint = displayedActor === 'mira'
    ? cursorPoint('you', currentTarget)
    : displayedActor === 'pip'
      ? cursorPoint('bot', currentTarget)
      : { left: '80%', top: '43%' };
  const outcomeForTurn = phase === 'complete';
  const canManualPlay = !autoPlay;
  const targetChoiceLocked = isPlayback || phase !== 'intent' || state.acted.includes('mira') || !effectiveVisible;

  onRoundCompleteRef.current = onRoundComplete;

  useEffect(() => {
    const syncDocumentVisibility = () => setDocumentVisible(!document.hidden);
    document.addEventListener('visibilitychange', syncDocumentVisibility);
    syncDocumentVisibility();
    return () => document.removeEventListener('visibilitychange', syncDocumentVisibility);
  }, []);

  const setActionIndex = (index: number) => {
    indexRef.current = index;
    setNextIndex(index);
  };

  const setPhaseAndProgress = (nextPhase: EncounterPhase, nextIndex = indexRef.current) => {
    phaseTimerRef.current = null;
    phaseProgressRef.current = { token: `${nextPhase}:${nextIndex}`, progress: 1 };
    setPhase(nextPhase);
  };

  const commitState = (next: EncounterState) => {
    stateRef.current = next;
    setState(next);
  };

  const resetEncounter = () => {
    const next = createEncounterState();
    stateRef.current = next;
    pendingStateRef.current = null;
    setActionIndex(0);
    setPhaseAndProgress('intent', 0);
    setState(next);
    setShieldTarget(activeRule.allyShield ? 'pip' : 'mira');
    setManualPlaying(false);
    setSingleStepRunning(false);
    completedRoundRef.current = false;
    feedbackSentRef.current = false;
  };

  const getCurrentRuntimeSnapshot = (): EncounterRuntimeSnapshot => ({
    ...latestSnapshotRef.current,
    state: stateRef.current,
    nextIndex: indexRef.current,
    pendingState: pendingStateRef.current,
    completedRound: completedRoundRef.current,
    feedbackSent: feedbackSentRef.current,
    phaseProgress: phaseProgressRef.current,
  });

  const restoreRuntimeSnapshot = (snapshot: EncounterRuntimeSnapshot) => {
    stateRef.current = snapshot.state;
    indexRef.current = snapshot.nextIndex;
    pendingStateRef.current = snapshot.pendingState;
    completedRoundRef.current = snapshot.completedRound;
    feedbackSentRef.current = snapshot.feedbackSent;
    phaseProgressRef.current = { ...snapshot.phaseProgress };
    phaseTimerRef.current = null;
    setState(snapshot.state);
    setNextIndex(snapshot.nextIndex);
    setPhase(snapshot.phase);
    setShieldTarget(snapshot.shieldTarget);
    setManualPlaying(snapshot.manualPlaying);
    setSingleStepRunning(snapshot.singleStepRunning);
  };

  const freshRuntimeSnapshot = (): EncounterRuntimeSnapshot => ({
    state: createEncounterState(),
    nextIndex: 0,
    phase: 'intent',
    shieldTarget: activeRule.allyShield ? 'pip' : 'mira',
    pendingState: null,
    manualPlaying: false,
    singleStepRunning: false,
    completedRound: false,
    feedbackSent: false,
    phaseProgress: { token: 'intent:0', progress: 1 },
  });

  useLayoutEffect(() => {
    latestSnapshotRef.current = {
      state,
      nextIndex,
      phase,
      shieldTarget,
      pendingState: pendingStateRef.current,
      manualPlaying,
      singleStepRunning,
      completedRound: completedRoundRef.current,
      feedbackSent: feedbackSentRef.current,
      phaseProgress: phaseProgressRef.current,
    };
  }, [state, nextIndex, phase, shieldTarget, manualPlaying, singleStepRunning]);

  useLayoutEffect(() => {
    const previous = cacheIdentityRef.current;
    if (previous.cacheKey === sessionCacheKey && previous.resetKey === resetKey) return;

    if (previous.cacheKey) {
      const current = getCurrentRuntimeSnapshot();
      writeEncounterSnapshot(encounterSnapshotsRef.current, previous.cacheKey, previous.resetKey, {
        ...current,
        phaseProgress: snapshotPhaseProgress(current, phaseTimerRef.current),
      });
    }

    cacheIdentityRef.current = { cacheKey: sessionCacheKey, resetKey };
    const restored = readEncounterSnapshot(encounterSnapshotsRef.current, sessionCacheKey, resetKey);
    restoreRuntimeSnapshot(restored ?? freshRuntimeSnapshot());
  }, [sessionCacheKey, resetKey, activeRule]);

  const finishRound = () => {
    if (completedRoundRef.current) return;
    completedRoundRef.current = true;
    setManualPlaying(false);
    setSingleStepRunning(false);
    setPhaseAndProgress('complete');
    const finalState = stateRef.current;
    onRoundCompleteRef.current?.({
      ...finalState,
      rule: activeRule,
      rolls: [...ENCOUNTER_TRACE],
      roundEnded: finalState.hp.goblin <= 0 || ENCOUNTER_ACTORS.every((actor) => finalState.hp[actor] <= 0 || finalState.acted.includes(actor)),
      goblinDefeated: finalState.hp.goblin <= 0,
    });
    if (!autoPlay && !feedbackSentRef.current && stateRef.current.hp.goblin <= 0) {
      onFeedback?.('ทีม Mira และ Pip ชนะ Goblin ในรอบตัวอย่างเดียวกัน');
      feedbackSentRef.current = true;
    }
  };

  const advancePhase = () => {
    if (phase === 'intent') {
      const actor = actorForStep(nextIndex);
      const currentState = stateRef.current;
      if (!actor) {
        finishRound();
        return;
      }
      if (currentState.hp.goblin <= 0 || currentState.hp[actor] <= 0 || currentState.acted.includes(actor)) {
        const nextIndexToPlay = nextAvailableActionIndex(currentState, nextIndex + 1);
        if (nextIndexToPlay >= ENCOUNTER_ACTORS.length) finishRound();
        else {
          setActionIndex(nextIndexToPlay);
          setPhaseAndProgress('intent', nextIndexToPlay);
        }
        return;
      }
      const nextState = resolveEncounterAction(
        currentState,
        actor,
        ENCOUNTER_TRACE[nextIndex],
        activeRule,
        shieldTarget,
      );
      if (nextState === currentState) {
        const nextIndexToPlay = nextAvailableActionIndex(currentState, nextIndex + 1);
        if (nextIndexToPlay >= ENCOUNTER_ACTORS.length) finishRound();
        else {
          setActionIndex(nextIndexToPlay);
          setPhaseAndProgress('intent', nextIndexToPlay);
        }
        return;
      }
      pendingStateRef.current = nextState;
      setPhaseAndProgress('rolling');
      return;
    }

    if (phase === 'rolling') {
      setPhaseAndProgress('impact');
      return;
    }

    if (phase === 'impact') {
      if (pendingStateRef.current) commitState(pendingStateRef.current);
      setPhaseAndProgress('hpUpdate');
      return;
    }

    if (phase === 'hpUpdate') {
      setPhaseAndProgress('hold');
      return;
    }

    if (phase === 'hold') {
      pendingStateRef.current = null;
      const nextIndexToPlay = nextAvailableActionIndex(stateRef.current, nextIndex + 1);
      if (nextIndexToPlay >= ENCOUNTER_ACTORS.length) {
        finishRound();
      } else {
        setActionIndex(nextIndexToPlay);
        setPhaseAndProgress('intent', nextIndexToPlay);
        if (singleStepRunning) setSingleStepRunning(false);
      }
    }
  };

  useEffect(() => {
    if (!isPlayback || paused || !effectiveVisible || phase === 'complete') return undefined;
    const duration = ENCOUNTER_PHASE_DURATIONS_MS[phase];
    const token = `${phase}:${nextIndex}`;
    const safeSpeed = Number.isFinite(speed) ? Math.max(0.25, Math.min(8, speed)) : 1;
    const progress = phaseProgressRef.current.token === token ? phaseProgressRef.current.progress : 1;
    const remaining = (duration * progress) / safeSpeed;
    const startedAt = performance.now();
    phaseTimerRef.current = { token, deadline: startedAt + remaining, speed: safeSpeed, duration };
    const timeout = window.setTimeout(() => {
      phaseProgressRef.current = { token, progress: 0 };
      phaseTimerRef.current = null;
      advancePhase();
    }, remaining);

    return () => {
      window.clearTimeout(timeout);
      if (phaseProgressRef.current.token === token && phaseTimerRef.current?.token === token) {
        const elapsed = performance.now() - startedAt;
        phaseProgressRef.current = {
          token,
          progress: Math.max(0, progress - (elapsed * safeSpeed) / duration),
        };
        phaseTimerRef.current = null;
      }
    };
    // Phase time is preserved on pause/visibility changes and resumed from its remaining fraction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlayback, paused, effectiveVisible, phase, nextIndex, speed, activeRule, autoPlay]);

  const handlePlayTurn = () => {
    if (!canManualPlay || paused || !effectiveVisible || manualPlaying || singleStepRunning) return;
    if (outcomeForTurn) resetEncounter();
    setManualPlaying(true);
  };

  const handleStep = () => {
    if (!canManualPlay || paused || !effectiveVisible || isPlayback || phase !== 'intent') return;
    setSingleStepRunning(true);
  };

  const actionOwner = currentEvent?.actorId ?? displayedActor;
  const turnLabel = currentEvent
    ? `${actorLabel(actionOwner)} · ${currentEvent.label}`
    : `${actorLabel(actionOwner)} · ${actionLabel(actionOwner, currentTarget)}`;
  const simulationStatus = outcomeForTurn
    ? state.hp.goblin <= 0 ? 'ทีมชนะแล้ว' : 'จบรอบแล้ว'
    : (paused || !effectiveVisible) && isPlayback
      ? autoPlay ? 'พักตัวอย่างไว้' : 'รอบนี้พักไว้'
      : autoPlay
        ? `ตัวอย่าง · ${phaseLabel(phase)}`
        : manualPlaying
          ? `กำลังเล่น · ${phaseLabel(phase)}`
          : singleStepRunning
            ? `ทีละแอ็กชัน · ${phaseLabel(phase)}`
            : phase === 'intent'
              ? state.acted.length > 0 ? 'ตาถัดไป · รอคุณเล่นต่อ' : 'พร้อมเล่น'
              : 'รอเล่นต่อ';
  const currentRoll = phase === 'complete' ? latestEvent?.roll : ENCOUNTER_TRACE[nextIndex];
  const showEffect = phase === 'impact' || phase === 'hpUpdate';

  return (
    <section
      className="encounter-game"
      data-testid="encounter-game"
      data-phase={phase}
      data-action-index={Math.min(nextIndex, ENCOUNTER_ACTORS.length - 1)}
      aria-label="เกมจำลองการเผชิญหน้า"
    >
      <header className="encounter-game__header">
        <div>
          <p className="encounter-game__eyebrow">ENCOUNTER · 01</p>
          <h2>ทางผ่านของ Goblin</h2>
        </div>
        <span className={`encounter-game__state${outcomeForTurn ? ' is-done' : ''}`} aria-live="polite">{simulationStatus}</span>
      </header>

      <div className={`encounter-game__field${currentEvent ? ` has-event--${currentEvent.actorId}` : ''}`} aria-label="สนามต่อสู้">
        <div className={`encounter-game__party${displayedActor === 'mira' || displayedActor === 'pip' ? ' is-turn' : ''}`}>
          <article className={`encounter-game__fighter encounter-game__fighter--mira${displayedActor === 'mira' ? ' is-current' : ''}${state.hp.mira <= 0 ? ' is-defeated' : ''}`}>
            <HeroSprite actor="mira" />
            <div className="encounter-game__fighter-copy"><strong>Mira</strong><span>โล่ · ผู้พิทักษ์</span><HpBar actor="mira" value={state.hp.mira} /></div>
          </article>
          <article className={`encounter-game__fighter encounter-game__fighter--pip${displayedActor === 'pip' ? ' is-current' : ''}${state.hp.pip <= 0 ? ' is-defeated' : ''}`} data-narrative-record="pip">
            <HeroSprite actor="pip" />
            <div className="encounter-game__fighter-copy"><strong>Pip</strong><span>ธนู · นักธนู</span><HpBar actor="pip" value={state.hp.pip} /></div>
          </article>
        </div>
        <div className="encounter-game__path" aria-hidden="true">↔</div>
        <article className={`encounter-game__fighter encounter-game__fighter--goblin${displayedActor === 'goblin' ? ' is-current' : ''}${state.hp.goblin <= 0 ? ' is-defeated' : ''}`}>
          <HeroSprite actor="goblin" />
          <div className="encounter-game__fighter-copy"><strong>Goblin</strong><span>ศัตรู · โจมตี</span><HpBar actor="goblin" value={state.hp.goblin} /></div>
        </article>
        <div className="encounter-game__terrain" aria-hidden="true"><i /><i /><i /><i /></div>
        <div
          className={`encounter-game__cursor encounter-game__cursor--you${displayedActor === 'mira' ? ' is-active' : ' is-idle'}`}
          style={cursorStyle(miraPoint)}
          aria-label={`คุณ · Mira ${miraEvent ? `ทำแอ็กชันแล้ว · เป้าหมาย ${miraEvent.targetId === 'pip' ? 'Pip' : 'ตัวเอง'}` : 'กำลังเลือกแอ็กชัน'}`}
          data-cursor="mira"
        >
          <svg viewBox="0 0 24 30" aria-hidden="true"><path d="M2 2 21 18l-8 .7-3.6 8.1z" fill="var(--brand-violet, #6654bd)" stroke="#fff" strokeWidth="2.1" strokeLinejoin="round" /></svg>
          <span>คุณ · Mira</span>
        </div>
        <div
          className={`encounter-game__cursor encounter-game__cursor--bot${displayedActor === 'pip' ? ' is-active' : ' is-idle'}`}
          style={cursorStyle(pipPoint)}
          aria-label={`ผู้ร่วมเล่นจำลอง · Nina · บอท Pip ${pipEvent ? 'เล็ง Goblin' : 'กำลังเล็ง'}`}
          data-cursor="nina"
        >
          <svg viewBox="0 0 24 30" aria-hidden="true"><path d="M2 2 21 18l-8 .7-3.6 8.1z" fill="var(--brand-cyan, #2b829b)" stroke="#fff" strokeWidth="2.1" strokeLinejoin="round" /></svg>
          <span><small>ผู้ร่วมเล่นจำลอง</small><strong>Nina · บอท Pip</strong></span>
        </div>
        {currentEvent && showEffect && (
          <span
            key={`${currentEvent.actorId}-${state.events.length}`}
            className={`encounter-game__effect encounter-game__effect--${currentEvent.actorId}${currentEvent.reducedBy > 0 ? ' is-reduced' : ''}${!currentEvent.hit ? ' is-miss' : ''}`}
            style={effectPoint}
            aria-hidden="true"
          >
            {currentEvent.actorId === 'mira' ? '✧' : currentEvent.actorId === 'goblin' ? '✦' : '➤'}
          </span>
        )}
        {phase === 'impact' && !currentEvent && displayedActor && (
          <span className={`encounter-game__intent encounter-game__intent--${displayedActor}`} style={effectPoint} aria-hidden="true">
            {displayedActor === 'mira' ? '✧' : displayedActor === 'goblin' ? '✦' : '➤'}
          </span>
        )}
      </div>

      <div className="encounter-game__turn" aria-live="polite">
        <span className="encounter-game__turn-label">{turnLabel}</span>
        {phase !== 'intent' && currentRoll !== undefined && <span className={`encounter-game__roll${phase === 'rolling' ? ' is-rolling' : ''}`}>d20 <strong>{currentRoll}</strong></span>}
        {currentEvent && <span className="encounter-game__event">{actorLabel(currentEvent.actorId)} · {currentEvent.label}</span>}
        {!currentEvent && phase === 'intent' && <span className="encounter-game__event">เลือกกันก่อนว่าโล่จะช่วยใคร แล้วเล่นไปด้วยกัน</span>}
      </div>

      {!autoPlay && (
        <fieldset className="encounter-game__shield-choice" aria-describedby="encounter-shield-help">
          <legend>เลือกเป้าหมายโล่ของ Mira</legend>
          <label>
            <input
              type="radio"
              name={`encounter-shield-${replayKey}`}
              value="mira"
              checked={shieldTarget === 'mira'}
              disabled={targetChoiceLocked}
              onChange={(event) => setShieldTarget(event.currentTarget.value === 'pip' ? 'pip' : 'mira')}
            />
            ป้องกันตัวเอง
          </label>
          <label>
            <input
              type="radio"
              name={`encounter-shield-${replayKey}`}
              value="pip"
              checked={shieldTarget === 'pip'}
              disabled={!activeRule.allyShield || targetChoiceLocked}
              onChange={(event) => setShieldTarget(event.currentTarget.value === 'pip' ? 'pip' : 'mira')}
            />
            ช่วย Pip
          </label>
          <small id="encounter-shield-help">
            {activeRule.allyShield
              ? 'เลือกได้ก่อน Mira เริ่มแอ็กชัน · เพื่อนใหม่ช่วยกันเลือกทางได้'
              : 'ต้องเรียนรู้กติกา “โล่ช่วยเพื่อน” ก่อน จึงจะเลือก Pip ได้'}
          </small>
        </fieldset>
      )}

      <div className="encounter-game__controls">
        <button type="button" className="encounter-game__button encounter-game__button--primary" onClick={handlePlayTurn} disabled={!canManualPlay || paused || !effectiveVisible || manualPlaying || singleStepRunning}>
          {outcomeForTurn ? 'เล่นอีกรอบ' : manualPlaying ? 'กำลังเล่น…' : phase !== 'intent' ? 'เล่นต่อ' : 'เล่น 1 รอบ'}
        </button>
        <button type="button" className="encounter-game__button" onClick={handleStep} disabled={!canManualPlay || paused || !effectiveVisible || isPlayback || phase !== 'intent' || outcomeForTurn}>
          ทีละแอ็กชัน
        </button>
        <button type="button" className="encounter-game__button encounter-game__button--quiet" onClick={resetEncounter} disabled={!canManualPlay || !effectiveVisible}>
          เริ่มใหม่
        </button>
      </div>

      {mode === 'verify' && outcomeForTurn && (
        <div className="encounter-game__comparison" aria-label="ค่าอ้างอิงคำนวณจากแต้มเต๋าชุดเดียวกัน หลังจบรอบที่เล่นจริง">
          <p className="encounter-game__comparison-note">ค่าอ้างอิง · คำนวณจากแต้มเต๋าชุดเดียวกัน</p>
          <div><span>กติกาเดิม</span><strong>Pip {beforeOutcome.hp.pip}/10 HP</strong><small>{beforeOutcome.events.find((event) => event.actorId === 'goblin')?.label}</small></div>
          <div><span>กติกาฉบับนี้</span><strong>Pip {afterOutcome.hp.pip}/10 HP</strong><small>{afterOutcome.events.find((event) => event.actorId === 'goblin')?.label}</small></div>
        </div>
      )}

      <details className="encounter-game__details">
        <summary>วิธีเล่นและที่มาของผล</summary>
        <p>แต่ละแอ็กชันเดินเป็นช่วงเดียวกัน: ตั้งใจ → ทอย d20 → เห็นผลกระทบ → อัปเดต HP → อ่านผลก่อนเริ่มตาถัดไป · ชุดทอยจำลองคือ [14, 12, 16]</p>
        <p>โล่ของ Mira ช่วยตัวเองได้เสมอ ส่วนการช่วย Pip จะเลือกได้เมื่อเรียนรู้กติกาโล่ช่วยเพื่อน · แถบพลังชีวิตเป็นผลจริงจากตัวจำลองนี้</p>
        <p>Nina และเคอร์เซอร์เป็นผู้ร่วมเล่นจำลองในหน้าจอ ไม่ใช่ผู้เล่นออนไลน์</p>
      </details>
    </section>
  );
}
