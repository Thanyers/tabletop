import { SurfaceVisibility } from '../SurfaceVisibility';
import { useContext, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import { Download, Music2, Play, Square, Volume2, VolumeX } from 'lucide-react';
import type { MusicRule } from '../types';
import { musicPlan } from '../domain';
import { createMusicPcmSample, encodeMusicWav, getPlaybackPosition, pcmEnvelope } from './musicAudio';
import './music-lab.css';

export interface MusicLabProps {
  rule: MusicRule;
  guided: boolean;
  paused: boolean;
  demoActive: boolean;
  playing: boolean;
  sectionId: string;
  setSectionId: (id: string) => void;
  onPlayingChange: (playing: boolean) => void;
  onMarkLate: (beat: number) => void;
  feedback: string | null;
}

const SHORT_NAMES: Record<string, string> = {
  'MU-001': 'Intro',
  'MU-002': 'Verse 1',
  'MU-003': 'Pre',
  'MU-004': 'Chorus',
  'MU-005': 'Verse 2',
  'MU-006': 'Bridge',
  'MU-007': 'Outro',
};

const VIEW_WIDTH = 520;
const VIEW_HEIGHT = 82;
const WAVE_BINS = 104;

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}

export function MusicLab({
  rule,
  guided,
  paused,
  demoActive,
  playing,
  sectionId,
  setSectionId,
  onPlayingChange,
  onMarkLate,
  feedback,
}: MusicLabProps) {
  const surfaceVisible = useContext(SurfaceVisibility);
  const plan = useMemo(() => musicPlan(rule), [rule]);
  const section = plan.find((item) => item.id === sectionId) ?? plan[0];
  const safeBpm = section && Number.isFinite(section.bpm) && section.bpm > 0 ? section.bpm : 100;
  const sampleResult = useMemo(() => {
    try {
      return { sample: createMusicPcmSample(safeBpm), error: null as string | null };
    } catch {
      return { sample: null, error: 'จังหวะนี้ช้าเกินกว่าจะสร้างเสียงตัวอย่างได้' };
    }
  }, [safeBpm]);
  const sample = sampleResult.sample;
  const sectionBeats = section?.beats ?? 4;
  const repetitions = section?.repetitions ?? 1;
  const duration = section?.seconds ?? 0;
  const phraseCycles = Math.max(1, Math.ceil((sectionBeats * repetitions) / 4));
  const envelope = useMemo(
    () => sample ? pcmEnvelope(sample.samples, WAVE_BINS, phraseCycles) : Array.from({ length: WAVE_BINS }, () => 0),
    [sample, phraseCycles],
  );
  const waveformPath = useMemo(() => envelope.map((amplitude, index) => {
    const x = (index / (envelope.length - 1)) * VIEW_WIDTH;
    const halfHeight = Math.max(1.2, amplitude * 27);
    return `M ${x.toFixed(2)} ${(VIEW_HEIGHT / 2 - halfHeight).toFixed(2)} V ${(VIEW_HEIGHT / 2 + halfHeight).toFixed(2)}`;
  }).join(' '), [envelope]);

  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [volume, setVolume] = useState(0.55);
  const [muted, setMuted] = useState(false);
  const elapsedRef = useRef(0);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioGainRef = useRef<GainNode | null>(null);
  const audioStartedAtRef = useRef(0);
  const audioRequestRef = useRef(0);
  const animationFrameRef = useRef<number | null>(null);
  const demoFinishedRef = useRef(false);
  const previousDemoActiveRef = useRef(false);
  const previousPlanKeyRef = useRef('');
  const onPlayingChangeRef = useRef(onPlayingChange);
  onPlayingChangeRef.current = onPlayingChange;
  const reducedMotion = useReducedMotion();
  const position = getPlaybackPosition(elapsedSeconds, safeBpm, sectionBeats, repetitions);
  const planKey = `${section?.id ?? 'none'}:${section?.bpm ?? safeBpm}:${sectionBeats}:${repetitions}`;
  const envelopePathX = (VIEW_WIDTH * (reducedMotion ? 0 : position.progress)).toFixed(2);
  const waveformClip = reducedMotion
    ? 'inset(0 100% 0 0)'
    : `inset(0 ${Math.max(0, 100 - position.progress * 100)}% 0 0)`;

  const setElapsed = useCallback((seconds: number) => {
    const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    elapsedRef.current = safeSeconds;
    setElapsedSeconds(safeSeconds);
  }, []);

  const closeAudioContext = useCallback(() => {
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }, []);

  const stopAudio = useCallback((reset = true, notify = true) => {
    audioRequestRef.current += 1;
    const source = audioSourceRef.current;
    audioSourceRef.current = null;
    const gainNode = audioGainRef.current;
    audioGainRef.current = null;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // A source that already ended does not need another stop signal.
      }
      source.disconnect();
    }
    gainNode?.disconnect();
    closeAudioContext();
    if (reset) setElapsed(0);
    if (notify) onPlayingChangeRef.current(false);
  }, [closeAudioContext, setElapsed]);

  useEffect(() => { if (!surfaceVisible) stopAudio(false, true); }, [surfaceVisible, stopAudio]);

  useEffect(() => {
    if (previousPlanKeyRef.current === '') {
      previousPlanKeyRef.current = planKey;
      return;
    }
    if (previousPlanKeyRef.current === planKey) return;
    previousPlanKeyRef.current = planKey;
    stopAudio(true, true);
    demoFinishedRef.current = false;
  }, [planKey, stopAudio]);

  useEffect(() => {
    if (demoActive && !previousDemoActiveRef.current) {
      demoFinishedRef.current = false;
      setElapsed(0);
    } else if (!demoActive && previousDemoActiveRef.current) {
      demoFinishedRef.current = false;
      setElapsed(0);
    }
    previousDemoActiveRef.current = demoActive;
  }, [demoActive, setElapsed]);

  useEffect(() => {
    if (!playing && audioSourceRef.current) stopAudio(false, false);
  }, [playing, stopAudio]);

  useEffect(() => {
    const context = audioContextRef.current;
    const gainNode = audioGainRef.current;
    if (context && gainNode) {
      const nextGain = muted ? 0 : volume;
      gainNode.gain.setTargetAtTime(nextGain, context.currentTime, 0.015);
    }
    if (!context || !audioSourceRef.current) return;
    if (paused && context.state === 'running') {
      void context.suspend().catch(() => undefined);
    } else if (!paused && playing && context.state === 'suspended') {
      void context.resume().catch(() => undefined);
    }
  }, [muted, paused, playing, volume]);

  const manualClockRunning = !guided && !paused && playing && audioSourceRef.current !== null;
  const demoClockRunning = surfaceVisible && guided && demoActive && !paused && !demoFinishedRef.current;

  useEffect(() => {
    if (!section || duration <= 0 || (!manualClockRunning && !demoClockRunning)) return undefined;
    let active = true;
    const useAudioClock = manualClockRunning;
    const context = useAudioClock ? audioContextRef.current : null;
    const startedAt = useAudioClock
      ? audioStartedAtRef.current
      : (performance.now() / 1000) - elapsedRef.current;
    if (useAudioClock && !context) return undefined;

    const tick = () => {
      if (!active) return;
      const now = useAudioClock ? (context?.currentTime ?? startedAt) : performance.now() / 1000;
      const elapsed = Math.max(0, now - startedAt);
      if (elapsed >= duration) {
        setElapsed(duration);
        if (!useAudioClock) demoFinishedRef.current = true;
        if (useAudioClock) stopAudio(false, true);
        return;
      }
      setElapsed(elapsed);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };

    animationFrameRef.current = window.requestAnimationFrame(tick);
    return () => {
      active = false;
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    };
  }, [demoClockRunning, duration, manualClockRunning, section, setElapsed, stopAudio]);

  useEffect(() => () => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    stopAudio(false, false);
  }, [stopAudio]);

  const startAudio = async () => {
    if (!section || !sample || guided || paused) return;
    setAudioError(null);
    const requestId = audioRequestRef.current + 1;
    audioRequestRef.current = requestId;
    try {
      const AudioContextConstructor = window.AudioContext;
      const context = audioContextRef.current ?? new AudioContextConstructor();
      audioContextRef.current = context;
      await context.resume();
      if (requestId !== audioRequestRef.current) return;
      if (paused) {
        await context.suspend();
        return;
      }

      const buffer = context.createBuffer(1, sample.samples.length, sample.sampleRate);
      buffer.copyToChannel(sample.samples, 0);
      const source = context.createBufferSource();
      const gainNode = context.createGain();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = sample.durationSeconds;
      gainNode.gain.setValueAtTime(muted ? 0 : volume, context.currentTime);
      source.connect(gainNode);
      gainNode.connect(context.destination);
      const startAt = context.currentTime + 0.035;
      source.onended = () => {
        if (audioSourceRef.current !== source) return;
        audioSourceRef.current = null;
        source.disconnect();
        audioGainRef.current?.disconnect();
        audioGainRef.current = null;
        setElapsed(duration);
        closeAudioContext();
        onPlayingChangeRef.current(false);
      };
      audioSourceRef.current = source;
      audioGainRef.current = gainNode;
      audioStartedAtRef.current = startAt;
      source.start(startAt);
      source.stop(startAt + duration);
      setElapsed(0);
      onPlayingChangeRef.current(true);
    } catch {
      setAudioError('เสียงตัวอย่างเริ่มไม่ได้ในเบราว์เซอร์นี้');
      stopAudio(false, false);
    }
  };

  const handlePlayback = () => {
    if (playing) {
      stopAudio(true, true);
      return;
    }
    void startAudio();
  };

  const handleSectionSelect = (id: string) => {
    if (id === sectionId) return;
    stopAudio(true, true);
    demoFinishedRef.current = false;
    setSectionId(id);
  };

  const handleDownload = () => {
    if (!sample) return;
    const wav = encodeMusicWav(sample);
    const url = URL.createObjectURL(new Blob([wav], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `music-loop-${section?.id.toLowerCase() ?? 'sample'}-4-beat-phrase.wav`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  const handleVolumeChange = (event: ChangeEvent<HTMLInputElement>) => {
    setVolume(Number(event.currentTarget.value) / 100);
  };

  if (!section) {
    return <div className="music-lab" data-testid="music-lab"><p className="music-lab__empty">กติกาจังหวะยังสร้างแผนซ้อมไม่ได้</p></div>;
  }

  const currentBeat = position.beatInBar;
  const sectionTitle = section.name;
  const activeLabel = guided && demoActive
    ? paused ? 'พักภาพจังหวะ' : demoClockRunning ? 'กำลังแสดงตัวนับ' : position.finished ? 'ครบตามแผน' : 'ตัวอย่างพร้อมเริ่ม'
    : playing ? paused ? 'พักเสียง' : 'กำลังเล่นเสียงตัวอย่าง' : 'พร้อมซ้อม';

  return (
    <section className="music-lab" data-testid="music-lab" aria-label="Music Loop Studio">
      <div className="music-lab__topline">
        <div className="music-lab__brand"><span className="music-lab__brand-mark"><Music2 size={13} aria-hidden="true" /></span><span><small>LOOP STUDIO</small><strong>{SHORT_NAMES[section.id] ?? section.name}</strong></span></div>
        <div className="music-lab__tempo" data-narrative-field="tempo"><span>Tempo</span><strong>{section.bpm}<small> BPM</small></strong></div>
        <span className={`music-lab__state ${playing || demoClockRunning ? 'is-active' : ''}`} aria-live="polite"><i />{activeLabel}</span>
      </div>

      <div className="music-lab__sections" role="group" aria-label="เลือกท่อนเพลง">
        {plan.map((item, index) => (
          <button
            key={item.id}
            className={`music-lab__section ${item.id === section.id ? 'is-selected' : ''}`}
            type="button"
            data-music-section={item.id}
            aria-pressed={item.id === section.id}
            aria-label={`${item.name} · ${item.bpm} BPM · ${item.repetitions} รอบ`}
            disabled={guided}
            onClick={() => handleSectionSelect(item.id)}
          >
            <span>{String(index + 1).padStart(2, '0')}</span><strong>{SHORT_NAMES[item.id] ?? item.name}</strong>
          </button>
        ))}
      </div>

      <div className="music-lab__wave-panel" data-narrative-record={section.id}>
        <div className="music-lab__range">
          <span><i /> SELECTED RANGE</span>
          <strong>{sectionTitle}</strong>
          <small>{section.beats * section.repetitions} beats · {section.repetitions} {section.repetitions === 1 ? 'rep' : 'reps'}</small>
        </div>
        <div className="music-lab__wave-wrap">
          <svg
            className={`music-lab__wave ${reducedMotion ? 'is-reduced-motion' : ''}`}
            data-testid="music-waveform"
            viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`Waveform for ${sectionTitle}, ${section.bpm} BPM, ${section.repetitions} repetitions`}
          >
            <rect className="music-lab__selection" x="0" y="3" width={VIEW_WIDTH} height={VIEW_HEIGHT - 6} rx="8" />
            {Array.from({ length: 3 }, (_, index) => <line key={`grid-${index}`} className="music-lab__grid-line" x1="0" x2={VIEW_WIDTH} y1={20 + index * 21} y2={20 + index * 21} />)}
            <path className="music-lab__waveform" d={waveformPath} />
            <path className="music-lab__waveform-progress" d={waveformPath} style={{ clipPath: waveformClip }} />
            <line className="music-lab__playhead" data-testid="music-playhead" x1={envelopePathX} x2={envelopePathX} y1="5" y2={VIEW_HEIGHT - 5} />
          </svg>
          <span className="music-lab__wave-time music-lab__wave-time--start">0:00</span>
          <span className="music-lab__wave-time music-lab__wave-time--end">{duration.toFixed(1)}s</span>
        </div>
      </div>

      <div className="music-lab__controls">
        <div className="music-lab__beats" data-testid="music-beat" aria-label={`จังหวะที่ ${currentBeat + 1} จาก 4`}>
          <span className="music-lab__beat-label">BEAT</span>
          {reducedMotion && <strong className="music-lab__static-beat">{currentBeat + 1}/4</strong>}
          {Array.from({ length: 4 }, (_, index) => (
            <i key={index} className={!reducedMotion && position.progress > 0 && index === currentBeat ? 'is-lit' : ''} aria-hidden="true">{index + 1}</i>
          ))}
        </div>
        <span className="music-lab__loop-count" data-testid="music-loop-count">รอบ {position.repetition}/{section.repetitions}</span>
        <div className="music-lab__volume" aria-label="ตัวควบคุมเสียงตัวอย่าง">
          <button className="music-lab__mute" type="button" aria-label={muted ? 'Unmute preview' : 'Mute preview'} aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
            {muted ? <VolumeX size={13} aria-hidden="true" /> : <Volume2 size={13} aria-hidden="true" />}
          </button>
          <input type="range" min="0" max="100" step="5" value={Math.round(volume * 100)} aria-label="Preview volume" onChange={handleVolumeChange} />
          <span>{muted ? 'Muted' : `${Math.round(volume * 100)}%`}</span>
        </div>
        <div className="music-lab__actions">
          <button className="music-lab__play" type="button" aria-label={playing ? 'Stop metronome' : 'Start metronome'} disabled={guided || paused || !sample} onClick={handlePlayback}>
            {playing ? <Square size={12} fill="currentColor" aria-hidden="true" /> : <Play size={12} fill="currentColor" aria-hidden="true" />}
            {playing ? 'หยุดเสียง' : 'ฟังตัวอย่าง'}
          </button>
          <button className="music-lab__late" type="button" aria-label="Mark late entry" disabled={guided} onClick={() => onMarkLate(position.beatIndex + 1)}>เข้าช้า</button>
          <button className="music-lab__download" type="button" aria-label="ดาวน์โหลดเสียงตัวอย่าง WAV" disabled={!sample} onClick={handleDownload}><Download size={13} aria-hidden="true" /></button>
        </div>
      </div>

      <div className="music-lab__footnote">
        <span className="music-lab__sample-label">เสียงซ้อมตัวอย่างที่สร้างไว้ <small>· 1 ห้อง 4 จังหวะ วนตามแผน</small></span>
        <span className="music-lab__status-note" role="status">{feedback ?? audioError ?? sampleResult.error ?? 'ไม่มีการวิเคราะห์ไมโครโฟน'}</span>
      </div>
    </section>
  );
}
