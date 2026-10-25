import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-600.css';
import '@fontsource/noto-sans-thai/thai-700.css';

const COLOR = {
  paper: '#faf8f0',
  surface: '#fffdf7',
  ink: '#303d3a',
  muted: '#667268',
  line: '#d9d4c4',
  moss: '#356e5d',
  mossSoft: '#e8f0e4',
  blue: '#3e6c86',
  blueSoft: '#eaf0f3',
  amber: '#89632f',
};

const TIMING = {
  firstRequest: { start: 10, send: 44, clear: 64 },
  controlsRequest: { start: 68, send: 96, clear: 142 },
  chartRequest: { start: 146, send: 174, clear: 198 },
  firstCard: { start: 48, settled: 64 },
  controlsCard: { start: 100, settled: 116 },
  chartCard: { start: 178, settled: 194 },
  forceChange: { start: 120, end: 134 },
  reset: { start: 206, end: 215 },
};

const REQUESTS = [
  { ...TIMING.firstRequest, text: { en: 'Help me explore force and motion.', th: 'ช่วยพาฉันสำรวจแรงและการเคลื่อนที่' } },
  { ...TIMING.controlsRequest, text: { en: 'Let me change the force.', th: 'ขอเปลี่ยนแรงได้เอง' } },
  { ...TIMING.chartRequest, text: { en: 'Show how far it travels.', th: 'แสดงระยะทางที่รถเคลื่อนที่' } },
];

const copy = {
  en: {
    forceMotion: 'Force & motion', distance: 'Distance', force: 'Force', mass: 'Mass', time: 'Time',
    currentForce: 'Current force', massNote: 'mass', pushNote: 'push', distanceOverTime: 'Distance over time',
    ask: 'Ask for a change…',
  },
  th: {
    forceMotion: 'แรงและการเคลื่อนที่', distance: 'ระยะทาง', force: 'แรง', mass: 'มวล', time: 'เวลา',
    currentForce: 'แรงปัจจุบัน', massNote: 'มวล', pushNote: 'ผลัก', distanceOverTime: 'ระยะทางตามเวลา',
    ask: 'บอกสิ่งที่อยากลอง…',
  },
};

const ease = (frame, start, end, from = 0, to = 1) => interpolate(frame, [start, end], [from, to], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.inOut(Easing.cubic),
});

const enter = (frame, start, settled) => ease(frame, start, settled);

function Card({ frame, timing, children, style = {} }) {
  if (frame < timing.start) return null;
  const progress = enter(frame, timing.start, timing.settled);
  const opacity = progress * (1 - ease(frame, TIMING.reset.start, TIMING.reset.end));
  return <div style={{
    position: 'absolute',
    top: 82,
    width: 280,
    height: 306,
    overflow: 'hidden',
    border: `1px solid ${COLOR.line}`,
    borderRadius: 16,
    background: COLOR.surface,
    boxShadow: '0 12px 30px #2435480d, 0 2px 3px #24354808',
    opacity,
    transform: `translateY(${(1 - progress) * 13}px) scale(${0.975 + progress * 0.025})`,
    ...style,
  }}>
    <div style={{ opacity: ease(frame, timing.start + 4, timing.settled) }}>
      {children}
    </div>
  </div>;
}

function CardHeader({ children, accent = COLOR.moss }) {
  return <div style={{
    height: 48,
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '0 17px',
    borderBottom: `1px solid ${COLOR.line}`,
    borderTop: `3px solid ${accent}`,
    color: COLOR.ink,
    fontSize: 16,
    fontWeight: 700,
    letterSpacing: '-0.025em',
  }}>{children}</div>;
}

function Cursor({ x, y, click = false }) {
  const pulse = click ? 1 : 0;
  return <div style={{ position: 'absolute', left: x, top: y, zIndex: 8, pointerEvents: 'none' }}>
    {pulse > 0 && <span style={{
      position: 'absolute',
      top: -8,
      left: -8,
      width: 26,
      height: 26,
      border: `2px solid ${COLOR.amber}`,
      borderRadius: 20,
      background: '#f5e9d266',
      transform: `scale(${1 + 0.15 * pulse})`,
    }} />}
    <svg width="23" height="28" viewBox="0 0 23 28" style={{ filter: 'drop-shadow(0 2px 2px #24354840)' }}>
      <path d="M2 1.8 20.5 15l-7.1 1-3.2 7.7-3.8-1.6 3.2-7.6z" fill={COLOR.ink} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  </div>;
}

function Cart({ distance }) {
  const x = 12 + (distance / 8) * 183;
  return <svg width="248" height="106" viewBox="0 0 232 100" aria-hidden="true">
    <line x1="12" y1="57" x2="220" y2="57" stroke="#b9c8c2" strokeWidth="3" strokeLinecap="round" />
    <line x1="12" y1="62" x2="220" y2="62" stroke="#e3e9e5" strokeWidth="2" />
    {[12, 116, 220].map((tick) => <line key={tick} x1={tick} y1="55" x2={tick} y2="68" stroke="#9aaba4" strokeWidth="1.5" />)}
    <g transform={`translate(${x - 20} 38)`}>
      <rect x="0" y="9" width="42" height="19" rx="6" fill={COLOR.moss} />
      <rect x="8" y="1" width="23" height="12" rx="5" fill="#8fbeaa" />
      <circle cx="10" cy="31" r="5.5" fill={COLOR.ink} />
      <circle cx="33" cy="31" r="5.5" fill={COLOR.ink} />
      <circle cx="10" cy="31" r="2" fill="#fff" />
      <circle cx="33" cy="31" r="2" fill="#fff" />
    </g>
    <text x="12" y="88" fill={COLOR.muted} fontSize="10" textAnchor="middle">0 m</text>
    <text x="116" y="88" fill={COLOR.muted} fontSize="10" textAnchor="middle">4 m</text>
    <text x="220" y="88" fill={COLOR.muted} fontSize="10" textAnchor="middle">8 m</text>
  </svg>;
}

function ExperimentCard({ frame, force, locale }) {
  const text = copy[locale] ?? copy.en;
  const distance = 2 * (force / 5);
  const acceleration = force / 5;
  return <Card frame={frame} timing={TIMING.firstCard} style={{ left: 40 }}>
    <CardHeader>{text.forceMotion}</CardHeader>
    <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', padding: '13px 17px 0' }}>
      <div style={{ color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>{text.distance}</div>
      <div style={{ color: COLOR.muted, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>a = {acceleration.toFixed(1)} m/s²</div>
    </div>
    <div style={{ margin: '0 16px', color: COLOR.ink, fontSize: 34, fontWeight: 700, letterSpacing: '-.06em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
      {distance.toFixed(1)}<span style={{ marginLeft: 4, color: COLOR.moss, fontSize: 20 }}>m</span>
    </div>
    <div style={{ margin: '-2px 14px 0' }}><Cart distance={distance} /></div>
    <div style={{ height: 1, margin: '1px 16px 0', background: COLOR.line }} />
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', padding: '13px 16px 0' }}>
      {[
        [text.force, `${force} N`],
        [text.mass, '5 kg'],
        [text.time, '2 s'],
      ].map(([label, value], index) => <div key={label} style={{ paddingLeft: index === 0 ? 0 : 11, borderLeft: index === 0 ? 0 : `1px solid ${COLOR.line}` }}>
        <div style={{ color: COLOR.muted, fontSize: 11 }}>{label}</div>
        <div style={{ marginTop: 3, color: COLOR.ink, fontSize: 17, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      </div>)}
    </div>
    <div style={{ position: 'absolute', right: 16, bottom: 14, color: COLOR.muted, fontSize: 10 }}>x = ½at²</div>
  </Card>;
}

function ControlsCard({ frame, force, locale }) {
  const text = copy[locale] ?? copy.en;
  const x = 340;
  const railLeft = x + 28;
  const railWidth = 224;
  const sliderX = railLeft + railWidth * (force / 20);
  return <>
    <Card frame={frame} timing={TIMING.controlsCard} style={{ left: x }}>
      <CardHeader>{locale === 'th' ? 'แรงผลัก' : 'Push force'}</CardHeader>
      <div style={{ padding: '21px 19px 0' }}>
        <div style={{ color: COLOR.muted, fontSize: 10, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase' }}>{text.currentForce}</div>
        <div style={{ marginTop: 4, color: COLOR.ink, fontSize: 37, lineHeight: 1.15, fontWeight: 700, letterSpacing: '-.06em', fontVariantNumeric: 'tabular-nums' }}>
          {force}<span style={{ marginLeft: 6, color: COLOR.moss, fontSize: 21 }}>N</span>
        </div>
        <div style={{ position: 'relative', height: 7, marginTop: 24, borderRadius: 10, background: '#e7ece8' }}>
          <div style={{ width: `${force / 20 * 100}%`, height: '100%', borderRadius: 10, background: COLOR.moss }} />
          <div style={{ position: 'absolute', top: -7, left: `calc(${force / 20 * 100}% - 9px)`, width: 17, height: 17, border: `2px solid ${COLOR.moss}`, borderRadius: 20, background: COLOR.surface, boxShadow: '0 1px 4px #24354822' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, color: COLOR.muted, fontSize: 11 }}><span>0 N</span><span>20 N</span></div>
      </div>
      <div style={{ position: 'absolute', left: 19, right: 19, bottom: 19, paddingTop: 13, borderTop: `1px solid ${COLOR.line}`, color: COLOR.muted, fontSize: 12 }}>
        <span style={{ color: COLOR.ink, fontWeight: 600 }}>5 kg</span> {text.massNote} <span style={{ margin: '0 7px', color: '#b2beba' }}>·</span> <span style={{ color: COLOR.ink, fontWeight: 600 }}>2 s</span> {text.pushNote}
      </div>
    </Card>
    {frame >= TIMING.forceChange.start - 3 && frame <= TIMING.forceChange.end + 3 && <Cursor
      x={sliderX - 2}
      y={234}
      click={frame >= TIMING.forceChange.start && frame <= TIMING.forceChange.end}
    />}
  </>;
}

function makeCurve(force) {
  const points = Array.from({ length: 25 }, (_, index) => {
    const time = index / 12;
    const distance = 0.5 * (force / 5) * time ** 2;
    const x = 34 + (time / 2) * 205;
    const y = 174 - (distance / 8) * 136;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`;
  });
  return points.join(' ');
}

function DistanceCard({ frame, locale }) {
  const progress = enter(frame, TIMING.chartCard.start + 5, TIMING.chartCard.settled + 5);
  const oldCurve = makeCurve(10);
  const newCurve = makeCurve(20);
  return <Card frame={frame} timing={TIMING.chartCard} style={{ left: 640 }}>
    <CardHeader accent={COLOR.blue}>{(copy[locale] ?? copy.en).distanceOverTime}</CardHeader>
    <svg width="256" height="205" viewBox="0 0 256 205" style={{ display: 'block', margin: '15px auto 0', overflow: 'visible' }}>
      <path d="M34 38V174H240" fill="none" stroke="#cfd8d4" strokeWidth="1.5" />
      {[34, 136.5, 239].map((x) => <line key={x} x1={x} y1="38" x2={x} y2="174" stroke="#edf1ee" strokeWidth="1" />)}
      {[38, 106, 174].map((y) => <line key={y} x1="34" y1={y} x2="240" y2={y} stroke="#edf1ee" strokeWidth="1" />)}
      <text x="27" y="41" fill={COLOR.muted} fontSize="10" textAnchor="end">8 m</text>
      <text x="27" y="109" fill={COLOR.muted} fontSize="10" textAnchor="end">4</text>
      <text x="27" y="177" fill={COLOR.muted} fontSize="10" textAnchor="end">0</text>
      <text x="34" y="191" fill={COLOR.muted} fontSize="10" textAnchor="middle">0 s</text>
      <text x="240" y="191" fill={COLOR.muted} fontSize="10" textAnchor="middle">2 s</text>
      <path d={oldCurve} pathLength="1" fill="none" stroke={COLOR.blue} strokeWidth="3" strokeLinecap="round" strokeDasharray={`${progress} 1`} />
      <path d={newCurve} pathLength="1" fill="none" stroke={COLOR.moss} strokeWidth="3.5" strokeLinecap="round" strokeDasharray={`${progress} 1`} />
      <text x="222" y="106" fill={COLOR.blue} fontSize="11" fontWeight="700">4 m</text>
      <text x="222" y="47" fill={COLOR.moss} fontSize="11" fontWeight="700">8 m</text>
    </svg>
    <div style={{ position: 'absolute', left: 20, right: 20, bottom: 15, display: 'flex', justifyContent: 'center', gap: 17, color: COLOR.muted, fontSize: 11 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 8, background: COLOR.blue }} />10 N</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><i style={{ width: 8, height: 8, borderRadius: 8, background: COLOR.moss }} />20 N</span>
    </div>
  </Card>;
}

function activeRequest(frame, locale) {
  const request = [...REQUESTS].reverse().find((item) => frame >= item.start && frame < item.clear);
  if (!request) return null;
  const text = request.text[locale] ?? request.text.en;
  const characters = Array.from(new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(text), (segment) => segment.segment);
  const typingFrames = request.send - request.start - 8;
  const visible = frame < request.send
    ? Math.min(characters.length, Math.floor((frame - request.start) * characters.length / typingFrames))
    : characters.length;
  return { ...request, visibleText: characters.slice(0, visible).join(''), complete: visible === characters.length };
}

function SendPointer({ frame, send }) {
  if (frame < send - 3 || frame > send + 2) return null;
  return <Cursor x={875} y={464} click={frame >= send && frame <= send + 1} />;
}

function Composer({ frame, locale }) {
  const request = activeRequest(frame, locale);
  const text = request?.visibleText ?? '';
  const sent = request && frame >= request.send && frame <= request.send + 9;
  const ready = request?.complete && frame < request.send;
  const placeholder = text.length === 0;
  return <>
    <div style={{ position: 'absolute', left: 38, top: 458, width: 884, height: 56, display: 'flex', alignItems: 'center', padding: '0 10px 0 18px', border: `1px solid ${COLOR.line}`, borderRadius: 15, background: '#fff', boxShadow: '0 4px 14px #24354808' }}>
      <div style={{ flex: 1, overflow: 'hidden', color: placeholder ? '#8a9792' : COLOR.ink, fontSize: placeholder ? 15 : 26, fontWeight: placeholder ? 400 : 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {placeholder ? (copy[locale] ?? copy.en).ask : text}<span style={{ display: placeholder || sent ? 'none' : 'inline-block', width: 2, height: 25, marginLeft: 3, verticalAlign: 'middle', background: COLOR.moss }} />
      </div>
      <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 11, background: sent ? COLOR.mossSoft : ready ? COLOR.moss : '#eef2ef', color: sent ? COLOR.moss : ready ? '#fff' : '#98a49e', fontSize: 20, fontWeight: 600, lineHeight: 1 }}>
        {sent ? '✓' : '↑'}
      </div>
    </div>
    {request && <SendPointer frame={frame} send={request.send} />}
  </>;
}

export function HeroEvolution({ locale = 'en' }) {
  const frame = useCurrentFrame();
  const sliderProgress = ease(frame, TIMING.forceChange.start, TIMING.forceChange.end);
  const force = Math.round(10 + sliderProgress * 10);
  return <AbsoluteFill style={{
    overflow: 'hidden',
    color: COLOR.ink,
    fontFamily: locale === 'th' ? 'Manrope, Noto Sans Thai, system-ui, sans-serif' : 'Manrope, system-ui, sans-serif',
    backgroundColor: COLOR.paper,
    backgroundImage: 'radial-gradient(#9fb0a72b 0.8px, transparent 0.8px)',
    backgroundSize: '24px 24px',
  }}>
    <div style={{ position: 'absolute', inset: 0, opacity: 0.7, pointerEvents: 'none', background: 'radial-gradient(ellipse at 52% 34%, #eaf2ed66, transparent 59%)' }} />
    <ExperimentCard frame={frame} force={force} locale={locale} />
    <ControlsCard frame={frame} force={force} locale={locale} />
    <DistanceCard frame={frame} locale={locale} />
    <Composer frame={frame} locale={locale} />
  </AbsoluteFill>;
}
