import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';

const C = {
  paper: '#faf8f0',
  white: '#fffdf7',
  canvas: '#eeeee2',
  edge: '#d9d4c4',
  ink: '#303d3a',
  muted: '#667268',
  green: '#356e5d',
  greenSoft: '#e8f0e4',
  blue: '#3e6c86',
  blueSoft: '#eaf0f3',
  ochre: '#89632f',
  ochreSoft: '#f7edda',
  clay: '#9a5c4e',
};

const clamp = (value, from, to) => interpolate(value, [from, to], [0, 1], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
});
const mix = (value, from, to, a, b) => interpolate(value, [from, to], [a, b], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
});
const money = (value) => '฿' + Math.round(value).toLocaleString('en-US');

function Mark({ frame, size = 30, staticMark = false }) {
  // Port of the canonical 2×2 mark and loading motion: tabletop.css plus
  // loading-screen.css (2.4s tilt, four staggered 1.2s tile pulses).
  const tiltFrame = ((frame % 72) + 72) % 72;
  const animatedTilt = interpolate(tiltFrame, [0, 36, 72], [-5, 85, -5], {
    easing: Easing.bezier(0.65, 0, 0.35, 1), extrapolateLeft: 'clamp', extrapolateRight: 'clamp',
  });
  const tilt = staticMark ? -5 : animatedTilt;
  const offsets = [0, 4.5, 13.5, 9];
  const colors = ['#243548', '#24796b', '#6f8190', '#d49a47'];
  return <span className="brand-mark" style={{ width: size, height: size, gridTemplateColumns: `repeat(2, ${(size - size * 0.28) / 2}px)`, gap: size * 0.14, transform: `rotate(${tilt}deg)` }} aria-hidden="true">
    {colors.map((color, index) => {
      const phase = ((frame - offsets[index]) % 36 + 36) % 36;
      const animatedScale = phase <= 14.4
        ? interpolate(phase, [0, 14.4], [1, 0.62], { easing: Easing.bezier(0.45, 0, 0.55, 1) })
        : interpolate(phase, [14.4, 36], [0.62, 1], { easing: Easing.bezier(0.45, 0, 0.55, 1) });
      const animatedOpacity = phase <= 14.4
        ? interpolate(phase, [0, 14.4], [1, 0.45], { easing: Easing.bezier(0.45, 0, 0.55, 1) })
        : interpolate(phase, [14.4, 36], [0.45, 1], { easing: Easing.bezier(0.45, 0, 0.55, 1) });
      const scale = staticMark ? 1 : animatedScale;
      const opacity = staticMark ? 1 : animatedOpacity;
      return <i key={color} style={{ width: (size - size * 0.28) / 2, height: (size - size * 0.28) / 2, borderRadius: index === 3 ? '50%' : size * 0.11, background: color, transform: `scale(${scale})`, opacity }} />;
    })}
  </span>;
}

function Chrome({ frame }) {
  const dark = frame >= 270 && frame < 420 || frame >= 1740;
  const end = frame >= 1740;
  return <>
    <header className={`chrome${dark ? ' chrome--dark' : ''}${end ? ' chrome--end' : ''}`}>
      <div className="brand-lockup"><Mark frame={frame} size={30} /><span>tabletop<span className="brand-period">.</span></span></div>
      <div className="provenance">ภาพอธิบาย • ข้อมูลตัวอย่าง</div>
    </header>
  </>;
}

function Chair({ frame }) {
  const enter = clamp(frame, 8, 38);
  return <svg className="chair-object" viewBox="0 0 340 410" style={{ opacity: enter, transform: `translate(${(1 - enter) * 60}px, ${(1 - enter) * 22}px)` }} aria-label="A wooden chair">
    <ellipse cx="177" cy="380" rx="111" ry="13" fill={C.ink} opacity=".1" />
    <path d="M98 74 Q98 62 111 62 H232 Q245 62 245 75 V229 H98Z" fill="#b9c8b6" stroke={C.green} strokeWidth="5" />
    <path d="M117 84 H225 V210 H117Z" fill={C.paper} opacity=".62" />
    <path d="M75 236 L268 236 Q279 236 279 249 V269 Q279 280 266 280 H78 Q66 280 66 269 V248 Q66 236 75 236Z" fill="#89632f" />
    <path d="M88 278 L102 375 M257 278 L245 375 M83 270 L53 367 M264 270 L294 367" fill="none" stroke="#89632f" strokeWidth="14" strokeLinecap="round" />
    <path d="M72 346 Q169 364 276 345" fill="none" stroke="#89632f" strokeWidth="8" strokeLinecap="round" />
  </svg>;
}

function Cushion({ frame }) {
  const enter = clamp(frame, 145, 171);
  return <svg className="cushion-object" viewBox="0 0 210 56" style={{ opacity: enter, transform: `translateY(${(1 - enter) * 30}px) scale(${0.88 + enter * 0.12})` }} aria-hidden="true">
    <path d="M16 14 Q18 6 29 7 H181 Q192 8 194 18 L188 42 Q186 50 175 49 H31 Q19 48 17 39Z" fill="#e8f0e4" stroke={C.green} strokeWidth="3" />
    <path d="M37 17 Q105 12 174 18 M35 39 Q105 44 174 38" fill="none" stroke="#b9d3c1" strokeWidth="2" />
  </svg>;
}

function Book({ frame }) {
  const enter = clamp(frame, 177, 202);
  return <svg className="book-object" viewBox="0 0 106 66" style={{ opacity: enter, transform: `translate(${(1 - enter) * 36}px, ${(1 - enter) * 16}px) rotate(-8deg)` }} aria-hidden="true">
    <path d="M12 10 Q32 4 52 15 V56 Q32 46 12 53Z" fill="#fffdf7" stroke="#3e6c86" strokeWidth="3" />
    <path d="M52 15 Q73 4 94 10 V53 Q74 46 52 56Z" fill="#eaf0f3" stroke="#3e6c86" strokeWidth="3" />
    <path d="M20 21 Q34 17 45 23 M20 30 Q34 26 45 32 M60 23 Q75 17 86 21 M60 32 Q75 26 86 30" stroke="#9ab3c1" strokeWidth="2" />
    <path d="M52 15V56" stroke="#3e6c86" strokeWidth="3" />
  </svg>;
}

function Pen({ frame }) {
  const enter = clamp(frame, 32, 56);
  const draw = clamp(frame, 59, 102);
  return <>
    <svg className="pen-mark" viewBox="0 0 260 116" aria-hidden="true">
      <path d="M16 72 C56 20 84 94 128 48 S202 40 245 64" fill="none" stroke={C.green} strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray={`${draw} 1`} />
      <circle cx="245" cy="64" r="5" fill={C.green} opacity={draw} />
    </svg>
    <svg className="pen-object" viewBox="0 0 170 42" style={{ opacity: enter, transform: `translate(${mix(frame, 32, 56, -70, 0)}px, ${mix(frame, 32, 56, -36, 0)}px) rotate(-36deg)` }} aria-label="A pen drawing a line">
      <rect x="10" y="13" width="136" height="16" rx="8" fill="#356e5d" />
      <rect x="18" y="16" width="90" height="3" rx="2" fill="#d7e8d6" opacity=".8" />
      <path d="M145 13 L164 21 L145 29Z" fill="#89632f" />
      <path d="M13 13 Q6 21 13 29" fill="none" stroke="#243548" strokeWidth="3" />
      <path d="M46 13V6 Q46 1 52 1 H105" fill="none" stroke="#243548" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </>;
}

function Hammer({ frame }) {
  const enter = clamp(frame, 98, 121);
  const strike = clamp(frame, 125, 150);
  const settle = clamp(frame, 150, 168);
  const rotation = frame < 125 ? -26 : frame < 151 ? mix(frame, 125, 151, -26, 24) : mix(frame, 151, 168, 24, 0);
  return <>
    <div className="nail-board" style={{ opacity: clamp(frame, 111, 132) }}>
      <div className="wood-grain wood-grain--one" /><div className="wood-grain wood-grain--two" />
      <svg viewBox="0 0 72 82" className="nail-svg" aria-hidden="true">
        <path d={`M36 ${strike ? 13 + strike * 12 : 13}V69`} stroke="#6f8190" strokeWidth="6" strokeLinecap="round" />
        <path d={`M23 ${strike ? 12 + strike * 12 : 12}H49`} stroke="#303d3a" strokeWidth="7" strokeLinecap="round" />
        <path d="M30 70H42" stroke="#89632f" strokeWidth="4" strokeLinecap="round" opacity={settle} />
      </svg>
      <span>NAIL</span>
    </div>
    <svg className="hammer-object" viewBox="0 0 170 130" style={{ opacity: enter, transform: `translate(${mix(frame, 98, 121, 48, 0)}px, ${mix(frame, 98, 121, -35, 0)}px) rotate(${rotation}deg)` }} aria-label="A hammer adding a nail">
      <path d="M88 48 L132 96 Q138 103 131 111 Q124 118 117 110 L72 62Z" fill="#89632f" />
      <path d="M42 22 Q51 12 63 21 L88 44 Q96 52 87 61 L79 69 Q70 77 62 69 L37 46 Q29 37 42 22Z" fill="#3e6c86" stroke="#243548" strokeWidth="4" />
      <path d="M41 28 L25 14 Q17 8 11 16 Q5 24 13 30 L29 44Z" fill="#243548" />
      <path d="M54 28 L78 50" stroke="#a9c2cb" strokeWidth="4" strokeLinecap="round" />
    </svg>
  </>;
}

function Intro({ frame }) {
  const title = clamp(frame, 6, 34);
  return <AbsoluteFill className="intro-scene">
    <div className="intro-eyebrow" style={{ opacity: title }}>A PLACE FOR WORK TO TAKE SHAPE</div>
    <h1 className="intro-title" style={{ opacity: title, transform: `translateY(${(1 - title) * 18}px)` }}>เครื่องมือที่ดี<br /><em>ช่วยให้คุณจดจ่อ</em></h1>
    <div className="intro-subtitle" style={{ opacity: clamp(frame, 48, 72) }}>พื้นที่หนึ่ง · สำหรับงานที่เปลี่ยนไป</div>
    <div className="writing-sheet" style={{ opacity: clamp(frame, 42, 58) }}>
      <div className="sheet-overline">IDEA / NOTE</div>
      <div className="sheet-rule" />
      <Pen frame={frame} />
    </div>
    <div className="nail-scene">
      <Hammer frame={frame} />
    </div>
    <div className="chair-scene">
      <Chair frame={frame} />
      <Cushion frame={frame} />
      <Book frame={frame} />
    </div>
    <div className="intro-hold-note" style={{ opacity: clamp(frame, 214, 236) }}>เริ่มจากสิ่งที่มี แล้วค่อยเพิ่มสิ่งที่ต้องใช้</div>
  </AbsoluteFill>;
}

function Intent({ frame }) {
  const f = frame - 270;
  const card = clamp(f, 12, 36);
  const underline = clamp(f, 60, 82);
  return <AbsoluteFill className="intent-scene">
    <div className="intent-orbit intent-orbit--one" />
    <div className="intent-orbit intent-orbit--two" />
    <div className="intent-left">
      <div className="intent-kicker">START WITH INTENT</div>
      <div className="intent-title">เริ่มจากสิ่งที่<br />คุณอยากทำ</div>
      <div className="intent-desc">ไม่ต้องมีไฟล์ก่อน</div>
    </div>
    <div className="intent-prompt" style={{ opacity: card, transform: `translateY(${(1 - card) * 26}px) scale(${0.96 + card * 0.04})` }}>
      <div className="prompt-meta"><span className="prompt-dot" />YOUR IDEA</div>
      <div className="prompt-thai">ช่วยทำโต๊ะสรุปยอดขายวันนี้</div>
      <div className="prompt-underline" style={{ transform: `scaleX(${underline})` }} />
      <div className="prompt-foot"><span>THE CORNER POP-UP · illustrative</span><span>↗</span></div>
    </div>
    <svg className="intent-arrow" viewBox="0 0 160 84" aria-hidden="true" style={{ opacity: card }}>
      <path d="M8 53 C53 4 103 11 145 47" fill="none" stroke="#b9d3c1" strokeWidth="2" strokeDasharray={`${underline * 180} 180`} />
      <path d="m132 36 15 12-18 5" fill="none" stroke="#b9d3c1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  </AbsoluteFill>;
}

const captionFor = (frame) => {
  if (frame < 660) return ['เริ่มจากสิ่งที่อยากทำ', 'START WITH INTENT'];
  if (frame < 870) return ['ทบทวนกฎ ก่อนนำไปใช้', 'REVIEW → APPLY'];
  if (frame < 1080) return ['ข้อมูลเดียวกัน มองได้หลายแบบ', 'ONE BOARD · CONNECTED VIEWS'];
  if (frame < 1260) return ['ข้อมูลใหม่ กติกาเดิม', 'NEW INPUT · SAME CALCULATION'];
  if (frame < 1500) return ['เสนอการเปลี่ยนกฎ แล้วให้คุณเลือก', 'PROPOSED CHANGE · HUMAN REVIEW'];
  if (frame < 1650) return ['ยอดรวมเดิม · ยอดสุทธิใหม่', 'GROSS STAYS ฿405'];
  return ['ทั้งโต๊ะ พร้อมให้ดูและปรับ', 'A TABLE THAT CAN GROW'];
};

function CanvasCaption({ frame }) {
  const [thai, english] = captionFor(frame);
  return <div className="canvas-caption"><span>{thai}</span><small>{english}</small></div>;
}

function PopUpTable({ frame }) {
  const reveal = clamp(frame, 450, 500);
  const input = clamp(frame, 1080, 1250);
  const coffeeUnit = Math.round(25 + input * 10);
  const cakeQty = Math.round(3 + input * 3);
  const coffeeTotal = 3 * coffeeUnit;
  const cakeTotal = cakeQty * 50;
  const grandTotal = coffeeTotal + cakeTotal;
  const flashCoffee = frame >= 1080 && frame < 1134 ? 1 - clamp(frame, 1080, 1134) : 0;
  const flashCake = frame >= 1130 && frame < 1186 ? 1 - clamp(frame, 1130, 1186) : 0;
  return <div className="sales-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 22}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--green" />TODAY'S SALES</span><span className="sample-chip">EXAMPLE</span></div>
    <div className="sales-column-head"><span>ITEM</span><span>QTY</span><span>UNIT PRICE</span><span>LINE TOTAL</span></div>
    <div className="sales-row" style={{ backgroundColor: `rgba(232,240,228,${flashCoffee * 0.85})` }}>
      <strong><i className="row-mark row-mark--green" />Coffee</strong><b>3</b><b>{money(coffeeUnit)}</b><b>{money(coffeeTotal)}</b>
    </div>
    <div className="sales-row" style={{ backgroundColor: `rgba(247,237,218,${flashCake * 0.85})` }}>
      <strong><i className="row-mark row-mark--ochre" />Cake</strong><b>{cakeQty}</b><b>฿50</b><b>{money(cakeTotal)}</b>
    </div>
    <div className="table-equation"><span>{3} × {money(coffeeUnit)} <i>+</i> {cakeQty} × ฿50</span><b>{money(grandTotal)}</b></div>
    <div className="table-foot"><span>Illustrative rows</span><span className="table-foot-bullet" />Recalculated together</div>
  </div>;
}

function PromptChip({ frame }) {
  const reveal = clamp(frame, 420, 454);
  const compact = clamp(frame, 610, 655);
  const size = mix(compact, 0, 1, 1, 0.94);
  return <div className="workspace-prompt" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 12}px) scale(${size})` }}>
    <span className="prompt-icon"><i /><i /><i /><i /></span>
    <div><small>INTENT</small><b>ช่วยทำโต๊ะสรุปยอดขายวันนี้</b></div>
    <span className="intent-check">✓</span>
  </div>;
}

function RuleCard({ frame }) {
  const reveal = clamp(frame, 660, 700);
  const proposal = clamp(frame, 1260, 1360);
  const proposing = frame >= 1260 && frame < 1474;
  const applied = frame >= 822 && frame < 1260 || frame >= 1474;
  const appliedRate = frame >= 1474 ? 20 : 10;
  const rate = Math.round(10 + proposal * 10);
  const reviewGlow = frame >= 720 && frame < 780 || frame >= 1340 && frame < 1400;
  const applyGlow = frame >= 788 && frame < 832 || frame >= 1400 && frame < 1474;
  const reviewed = frame >= 780 && frame < 1260 || frame >= 1400;
  const sliderProgress = proposing ? proposal : appliedRate === 20 ? 1 : 0;
  return <div className="rule-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 18}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--ochre" />RULE</span><span className={`saved-chip ${applied ? 'saved-chip--applied' : ''}`}>{applied ? 'APPLIED' : proposing ? 'PROPOSED' : 'SAVED'}</span></div>
    <div className="rule-name">รวมยอดแถว แล้วหักส่วนลด</div>
    <div className="rule-state"><span>{proposing ? <>10% <i>→</i> <b>{rate}%</b></> : <b>{appliedRate}%</b>}</span><small>{proposing ? 'PROPOSED' : applied ? 'CURRENT' : 'SAVED'}</small></div>
    <div className="rule-slider"><div className="rule-slider-range" /><div className="rule-slider-fill" style={{ width: `${sliderProgress * 100}%` }} /><div className="rule-slider-thumb" style={{ left: `${sliderProgress * 100}%` }} /><span>10%</span><span>20%</span></div>
    <div className="rule-actions">
      <div className={`rule-review ${reviewGlow ? 'rule-action--focus' : ''} ${reviewed ? 'rule-action--done' : ''}`}><i>{reviewed ? '✓' : '1'}</i><span>Review</span></div>
      <div className={`rule-apply ${applyGlow ? 'rule-action--focus' : ''} ${applied ? 'rule-action--done' : ''}`}>{applied ? 'Applied ✓' : 'Apply'}</div>
    </div>
    {(frame >= 788 && frame <= 812 || frame >= 1418 && frame <= 1465) && <div className="pointer" style={{ left: frame < 1000 ? '82%' : `${74 + clamp(frame, 1418, 1465) * 14}%`, top: frame < 1000 ? '78%' : '82%' }}><svg width="27" height="34" viewBox="0 0 27 34"><path d="M4 2 23 18l-8 1 4 9-4 2-4-10-6 5Z" fill={C.ink} stroke={C.white} strokeWidth="2" strokeLinejoin="round" /></svg></div>}
  </div>;
}

function MetricCard({ frame }) {
  const reveal = clamp(frame, 870, 920);
  const input = clamp(frame, 1080, 1250);
  const total = 3 * Math.round(25 + input * 10) + Math.round(3 + input * 3) * 50;
  return <div className="metric-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 18}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--green" />GROSS TOTAL</span><span className="gross-chip">ROW SUM</span></div>
    <div className="metric-number">{money(total)}</div>
    <div className="metric-foot"><span>Gross = sum of line totals</span></div>
  </div>;
}

function ChartCard({ frame }) {
  const reveal = clamp(frame, 870, 925);
  const input = clamp(frame, 1080, 1250);
  const coffee = 3 * Math.round(25 + input * 10);
  const cake = Math.round(3 + input * 3) * 50;
  const coffeeHeight = Math.max(18, coffee / 300 * 118);
  const cakeHeight = Math.max(18, cake / 300 * 118);
  return <div className="chart-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 16}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--blue" />LINE TOTALS</span><span className="chart-kind">BY ITEM</span></div>
    <div className="chart-plot">
      <div className="chart-grid chart-grid--one" /><div className="chart-grid chart-grid--two" /><div className="chart-baseline" />
      <div className="chart-bar-unit chart-bar-unit--coffee">
        <b style={{ bottom: coffeeHeight + 10 }}>{money(coffee)}</b><i style={{ height: coffeeHeight, background: C.green }} /><span>Coffee</span>
      </div>
      <div className="chart-bar-unit chart-bar-unit--cake">
        <b style={{ bottom: cakeHeight + 10 }}>{money(cake)}</b><i style={{ height: cakeHeight, background: C.ochre }} /><span>Cake</span>
      </div>
    </div>
    <div className="chart-foot">Calculated from each row</div>
  </div>;
}

function NetCard({ frame }) {
  const reveal = clamp(frame, 1260, 1300);
  const applied = frame >= 1474;
  return <div className="net-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 16}px)` }}>
    <div className="net-label"><i className="kind-dot kind-dot--clay" />NET AFTER DISCOUNT <span>GROSS ฿405</span></div>
    <div className="net-content"><div><small>{applied ? '10% BEFORE' : '10% CURRENT'}</small><b>฿364.50</b></div><span className="net-arrow">→</span><div className="net-result"><small>{applied ? '20% APPLIED' : '20% PROPOSED'}</small><b>฿324.00</b></div></div>
    <div className="net-foot">Gross stays ฿405 · same source rows</div>
  </div>;
}

function Workspace({ frame }) {
  const cameraFrames = [420, 435, 660, 675, 870, 885, 1260, 1275, 1500, 1515, 1740];
  const cameraScale = [1, 1.1, 1.1, 1.12, 1.12, 1, 1, 1.08, 1.08, 0.96, 0.96];
  const cameraX = [0, -26, -26, -60, -60, 0, 0, -78, -78, 26, 26];
  const cameraY = [0, -22, -22, -33, -33, 0, 0, -5, -5, 15, 15];
  const scale = interpolate(frame, cameraFrames, cameraScale, { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const translateX = interpolate(frame, cameraFrames, cameraX, { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const translateY = interpolate(frame, cameraFrames, cameraY, { easing: Easing.inOut(Easing.cubic), extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
  const caption = frame >= 420 && frame < 1740 ? <CanvasCaption frame={frame} /> : null;
  const connector = (start, end) => {
    const draw = clamp(frame, start, end);
    return { strokeDasharray: `${draw} 1`, opacity: frame <= start ? 0 : 1 };
  };
  return <AbsoluteFill className="workspace-scene">
    {caption}
    <div className="board-camera" style={{ transform: `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})` }}>
      <div className="canvas-board">
        <div className="board-topline">
          <div className="board-project"><span className="board-mini-mark"><i /><i /><i /><i /></span><span>THE CORNER POP-UP</span><small>SALES CANVAS</small></div>
          <div className="board-status"><i /> ILLUSTRATIVE WORKSPACE</div>
        </div>
        <PromptChip frame={frame} />
        <svg className="board-connectors" viewBox="0 0 1188 548" aria-hidden="true">
          <path d="M544 362 C566 362 569 344 590 344" pathLength="1" style={connector(870, 930)} />
          <path d="M839 326 C858 326 849 190 870 190" pathLength="1" style={connector(870, 940)} />
          <path d="M840 178 C863 190 849 354 870 372" pathLength="1" style={connector(1260, 1310)} />
        </svg>
        <PopUpTable frame={frame} />
        <RuleCard frame={frame} />
        <MetricCard frame={frame} />
        <ChartCard frame={frame} />
        <NetCard frame={frame} />
      </div>
    </div>
  </AbsoluteFill>;
}

function EndLockup({ frame }) {
  const reveal = clamp(frame, 1740, 1752);
  return <AbsoluteFill className="end-scene" style={{ opacity: reveal }}>
    <div className="end-band" />
    <div className="end-orbit end-orbit--one" /><div className="end-orbit end-orbit--two" />
    <div className="end-lockup" style={{ transform: `translateY(${(1 - reveal) * 16}px)` }}>
      <Mark frame={frame} size={92} staticMark />
      <div className="end-wordmark">tabletop<span>.</span></div>
      <div className="end-url">tabletop.ptchrr.workers.dev</div>
      <div className="end-tagline">Work defines what software becomes.</div>
    </div>
    <div className="end-rule" style={{ transform: `scaleX(${reveal})` }} />
    <div className="end-draft">CONCEPT FILM · DRAFT 02</div>
  </AbsoluteFill>;
}

export function NarrativeAnimatic() {
  const frame = useCurrentFrame();
  const introOpacity = frame < 255 ? 1 : 1 - clamp(frame, 255, 270);
  const intentOpacity = frame < 270 ? clamp(frame, 255, 270) : frame < 405 ? 1 : 1 - clamp(frame, 405, 420);
  const workspaceOpacity = frame < 420 ? clamp(frame, 405, 420) : frame < 1740 ? 1 : 1 - clamp(frame, 1740, 1755);
  return <AbsoluteFill className="film-frame">
    {frame < 270 && <AbsoluteFill style={{ opacity: introOpacity }}><Intro frame={frame} /></AbsoluteFill>}
    {frame >= 255 && frame < 420 && <AbsoluteFill style={{ opacity: intentOpacity }}><Intent frame={frame} /></AbsoluteFill>}
    {frame >= 405 && frame < 1755 && <AbsoluteFill style={{ opacity: workspaceOpacity }}><Workspace frame={frame} /></AbsoluteFill>}
    {frame >= 1740 && <EndLockup frame={frame} />}
    <Chrome frame={frame} />
  </AbsoluteFill>;
}
