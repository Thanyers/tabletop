import React from 'react';
import {
  AbsoluteFill,
  Easing,
  interpolate,
  useCurrentFrame,
} from 'remotion';

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
  claySoft: '#f6e9e2',
};

const ramp = (frame, start, end, from = 0, to = 1) =>
  interpolate(frame, [start, end], [from, to], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.cubic),
  });

const money = (value) => '฿' + value.toLocaleString('en-US');

function TableMark({ size = 30, light = false }) {
  const colors = light ? ['#d9efce', '#d9efce', '#d9efce', '#d9efce'] : [C.ink, C.green, C.blue, C.ochre];
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="3" fill={colors[0]} />
      <rect x="18" y="2" width="12" height="12" rx="3" fill={colors[1]} />
      <rect x="2" y="18" width="12" height="12" rx="3" fill={colors[2]} />
      <rect x="18" y="18" width="12" height="12" rx="3" fill={colors[3]} />
    </svg>
  );
}

function Header({ dark = false }) {
  return (
    <div className={'chrome' + (dark ? ' chrome--dark' : '')}>
      <div className="brand-lockup">
        <TableMark size={29} light={dark} />
        <span>TABLETOP</span>
      </div>
      <div className="provenance">Concept animation · illustrative data</div>
    </div>
  );
}

function Shell({ children, dark = false, extraClass = '' }) {
  return (
    <AbsoluteFill className={'scene ' + (dark ? 'scene--forest ' : 'scene--paper ') + extraClass}>
      <div className="scene-grain" />
      {children}
    </AbsoluteFill>
  );
}

function PaperPiece({ children, className = '', style = {} }) {
  return (
    <div className={'paper-piece ' + className} style={style}>
      {children}
    </div>
  );
}

function SceneOne({ frame }) {
  const t = frame;
  const reveal = ramp(t, 4, 20);
  const morph = ramp(t, 28, 102);
  const x = 210 - 155 * morph;
  const width = 150 + 330 * morph;
  const height = 28 + 34 * morph;
  const y = 151;
  const backHeight = 107 * (1 - morph);
  const labelsOpacity = ramp(t, 76, 102);
  const legStarts = [222, 338, 243, 317];
  const legEnds = [86, 495, 159, 423];

  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: reveal }}>MAKE ROOM FOR THE WORK</div>
      <div className="hero-copy hero-copy--chair" style={{ opacity: reveal, transform: 'translateY(' + (1 - reveal) * 18 + 'px)' }}>
        <div>A good tool</div>
        <div className="hero-accent">lets you focus.</div>
      </div>
      <div className="chair-caption" style={{ opacity: labelsOpacity }}>ONE SURFACE · MANY USES</div>
      <svg className="transforming-table" viewBox="0 0 560 360" role="img" aria-label="A chair seat expands into a table surface">
        <ellipse cx={x + width * 0.52} cy="315" rx={122 + 90 * morph} ry="15" fill="#303d3a" opacity="0.08" />
        <rect
          x={x + 9}
          y={y - backHeight}
          width="17"
          height={backHeight + 7}
          rx="8"
          fill={C.green}
          opacity={1 - morph * 0.82}
        />
        {legStarts.map((startX, index) => {
          const p = index < 2 ? morph : ramp(t, 42, 78);
          const endX = legEnds[index];
          const currentX = startX + (endX - startX) * morph;
          const topX = currentX + (index < 2 ? 0 : (index === 2 ? -4 : 4));
          const bottomX = currentX + (index === 0 || index === 2 ? -11 : 11) * (1 - morph);
          const topY = y + height - 2;
          const bottomY = 310;
          return (
            <g key={index} opacity={index < 2 ? 1 : p}>
              <path
                d={'M' + topX + ' ' + topY + ' L' + bottomX + ' ' + bottomY}
                fill="none"
                stroke={C.ochre}
                strokeWidth={12 - 1 * morph}
                strokeLinecap="round"
              />
            </g>
          );
        })}
        <rect x={x + 5} y={y + 8} width={width} height={height} rx={5 + morph * 10} fill="#303d3a" opacity="0.06" />
        <rect x={x} y={y} width={width} height={height} rx={4 + morph * 9} fill={C.white} stroke={C.edge} strokeWidth="2" />
        <path d={'M' + (x + 28) + ' ' + (y + height * 0.52) + 'H' + (x + width - 28)} stroke={C.edge} strokeWidth="1.3" opacity={labelsOpacity} />
        <g opacity={labelsOpacity}>
          <circle cx={x + 35} cy={y + height * 0.52} r="4" fill={C.green} />
          <text x={x + 48} y={y + height * 0.52 + 5} fill={C.muted} fontSize="13" fontFamily="Manrope, sans-serif" letterSpacing="2">CANVAS</text>
        </g>
      </svg>
      <div className="scene-footnote">A starting point should stay open to change.</div>
    </Shell>
  );
}

const fragments = [
  { label: 'NOTES', x: 864, y: 136, tx: 748, ty: 233, w: 142, h: 48, angle: -13, color: C.ochreSoft, ink: C.ochre },
  { label: 'FORM', x: 1108, y: 212, tx: 928, ty: 233, w: 132, h: 48, angle: 12, color: C.blueSoft, ink: C.blue },
  { label: 'TABLE', x: 834, y: 536, tx: 748, ty: 321, w: 142, h: 62, angle: 8, color: C.greenSoft, ink: C.green },
  { label: 'RULE', x: 1096, y: 504, tx: 928, ty: 321, w: 132, h: 62, angle: -9, color: C.claySoft, ink: C.clay },
  { label: '฿225', x: 1008, y: 365, tx: 842, ty: 422, w: 104, h: 48, angle: 15, color: C.white, ink: C.ink },
  { label: 'NEXT', x: 750, y: 371, tx: 1030, ty: 422, w: 98, h: 48, angle: -15, color: C.white, ink: C.green },
];

function SceneTwo({ frame }) {
  const t = frame - 120;
  const align = ramp(t, 12, 76);
  const ring = ramp(t, 0, 38);
  return (
    <Shell dark>
      <div className="forest-ring" style={{ opacity: 0.18 + ring * 0.16, transform: 'scale(' + (0.88 + ring * 0.12) + ')' }} />
      <div className="hero-copy hero-copy--friction" style={{ opacity: ramp(t, 4, 19) }}>
        <div>But work</div>
        <div className="hero-light">changes.</div>
      </div>
      <div className="fragment-stage">
        <svg className="fragment-lines" viewBox="0 0 1280 720" aria-hidden="true">
          {fragments.map((item) => (
            <line
              key={item.label}
              x1={item.x}
              y1={item.y}
              x2={item.tx + item.w / 2}
              y2={item.ty + item.h / 2}
              stroke={item.color}
              strokeWidth="1.5"
              strokeDasharray="4 9"
              opacity={align * 0.5}
            />
          ))}
        </svg>
        {fragments.map((item) => {
          const px = item.x + (item.tx - item.x) * align;
          const py = item.y + (item.ty - item.y) * align;
          const turn = item.angle * (1 - align);
          return (
            <div
              key={item.label}
              className="fragment"
              style={{
                left: px,
                top: py,
                width: item.w,
                height: item.h,
                color: item.ink,
                backgroundColor: item.color,
                transform: 'translate(-50%, -50%) rotate(' + turn + 'deg)',
              }}
            >
              {item.label}
            </div>
          );
        })}
      </div>
      <div className="forest-caption" style={{ opacity: ramp(t, 70, 88) }}>The work changes. The canvas can, too.</div>
    </Shell>
  );
}

function SceneThree({ frame }) {
  const t = frame - 210;
  const textIn = ramp(t, 4, 18);
  const cardIn = ramp(t, 20, 52);
  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: textIn }}>BEGIN WITH INTENT</div>
      <div className="hero-copy hero-copy--intent" style={{ opacity: textIn, transform: 'translateY(' + (1 - textIn) * 14 + 'px)' }}>
        <div>Start with</div>
        <div>what you want</div>
        <div className="hero-accent">to do.</div>
      </div>
      <PaperPiece
        className="intent-prompt"
        style={{ opacity: cardIn, transform: 'translateX(' + (1 - cardIn) * 42 + 'px) rotate(' + (2 - cardIn * 2) + 'deg)' }}
      >
        <div className="piece-overline"><span className="piece-dot" />YOUR IDEA</div>
        <div className="prompt-rule" />
        <div className="prompt-text">Help me track<br />today’s sales.</div>
        <div className="prompt-footer">
          <span>Plain language is a starting place.</span>
          <span className="prompt-arrow">↗</span>
        </div>
      </PaperPiece>
      <div className="intent-scribble" style={{ opacity: cardIn * 0.8 }}>
        <svg width="134" height="50" viewBox="0 0 134 50" aria-hidden="true">
          <path d="M4 25C30 2 78 1 113 22" fill="none" stroke={C.green} strokeWidth="2" strokeDasharray="4 7" />
          <path d="m105 14 11 9-13 4" fill="none" stroke={C.green} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </Shell>
  );
}

function SceneFour({ frame }) {
  const t = frame - 330;
  const headlineIn = ramp(t, 5, 21);
  const formIn = ramp(t, 9, 33);
  const tableIn = ramp(t, 23, 49);
  const totalIn = ramp(t, 35, 60);
  const railIn = ramp(t, 54, 76);
  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: headlineIn }}>FROM IDEA TO WORKING SHAPE</div>
      <div className="hero-copy hero-copy--shape" style={{ opacity: headlineIn }}>
        <div>Shape it.</div>
        <div className="shape-line">Review it.</div>
        <div>Use it.</div>
      </div>
      <div className="canvas-board">
        <div className="board-topline">
          <span>SALES WORKSPACE</span>
          <span className="board-status"><i /> DRAFT</span>
        </div>
        <PaperPiece className="form-piece" style={{ opacity: formIn, transform: 'translateY(' + (1 - formIn) * 20 + 'px)' }}>
          <div className="piece-overline">FORM</div>
          <div className="form-grid">
            <div><span>Product</span><b>Coffee</b></div>
            <div><span>Unit price</span><b>฿25</b></div>
          </div>
          <div className="form-input-line" />
        </PaperPiece>
        <PaperPiece className="table-piece" style={{ opacity: tableIn, transform: 'translateY(' + (1 - tableIn) * 20 + 'px)' }}>
          <div className="piece-overline">TABLE</div>
          <div className="mini-table-header"><span>ITEM</span><span>QTY</span><span>PRICE</span><span>TOTAL</span></div>
          <div className="mini-table-row"><strong>Coffee</strong><b>3</b><b>฿25</b><b>฿75</b></div>
          <div className="mini-table-row"><strong>Cake</strong><b>3</b><b>฿50</b><b>฿150</b></div>
          <div className="table-rule" />
          <div className="table-sum"><span>Illustrative total</span><b>฿225</b></div>
        </PaperPiece>
        <PaperPiece className="total-piece" style={{ opacity: totalIn, transform: 'translateY(' + (1 - totalIn) * 20 + 'px)' }}>
          <div className="piece-overline">TOTAL</div>
          <div className="total-value">฿225</div>
          <div className="total-note">from the same rows</div>
          <svg className="total-spark" viewBox="0 0 120 32" aria-hidden="true">
            <path d="M2 26 23 20 42 23 61 10 82 14 101 4 118 8" fill="none" stroke={C.green} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </PaperPiece>
        <div className="review-rail" style={{ opacity: railIn, transform: 'translateY(' + (1 - railIn) * 12 + 'px)' }}>
          <div className="review-step"><span>1</span><b>Review</b></div>
          <div className="review-arrow">→</div>
          <div className="apply-action">Apply to Canvas <span>↗</span></div>
        </div>
      </div>
      <div className="canvas-caption">You choose what to apply.</div>
    </Shell>
  );
}

const dataTokens = [
  { value: '3', sx: 784, sy: 235, ex: 830, ey: 202, color: C.greenSoft },
  { value: '35', sx: 782, sy: 310, ex: 824, ey: 250, color: C.ochreSoft },
  { value: '105', sx: 778, sy: 382, ex: 826, ey: 310, color: C.blueSoft },
  { value: '6', sx: 782, sy: 452, ex: 832, ey: 372, color: C.claySoft },
  { value: '50', sx: 786, sy: 516, ex: 832, ey: 434, color: C.greenSoft },
];

function SceneFive({ frame }) {
  const t = frame - 480;
  const inFrame = ramp(t, 3, 18);
  const change = ramp(t, 22, 92);
  const qtyA = 3;
  const priceA = Math.round(25 + 10 * change);
  const totalA = qtyA * priceA;
  const qtyB = Math.round(3 + 3 * change);
  const priceB = 50;
  const totalB = qtyB * priceB;
  const grandTotal = totalA + totalB;
  const barScale = 100 / 320;
  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: inFrame }}>THE SAME LOGIC, WITH NEW INPUTS</div>
      <div className="data-headline" style={{ opacity: inFrame }}>
        <span>New data.</span>
        <span className="hero-accent">Same calculation.</span>
      </div>
      <div className="data-table" style={{ opacity: inFrame }}>
        <div className="data-card-heading">
          <span>THE CORNER POP-UP</span>
          <span className="illustrative-tag">ILLUSTRATIVE</span>
        </div>
        <div className="data-table-head"><span>ITEM</span><span>QTY</span><span>UNIT</span><span>LINE TOTAL</span></div>
        <div className="data-row">
          <span className="data-product"><i className="swatch swatch--green" />Coffee</span>
          <b>{qtyA}</b><b>{money(priceA)}</b><b>{money(totalA)}</b>
        </div>
        <div className="data-row">
          <span className="data-product"><i className="swatch swatch--ochre" />Cake</span>
          <b>{qtyB}</b><b>{money(priceB)}</b><b>{money(totalB)}</b>
        </div>
        <div className="data-card-footer">
          <span>{qtyA} × {money(priceA)} &nbsp;+&nbsp; {qtyB} × {money(priceB)}</span>
          <span className="calculated-total">= {money(grandTotal)}</span>
        </div>
      </div>
      <svg className="data-token-path" viewBox="0 0 1280 720" aria-hidden="true">
        <path d="M760 225C820 245 790 316 850 352" fill="none" stroke={C.edge} strokeWidth="2" strokeDasharray="3 8" />
      </svg>
      {dataTokens.map((token, index) => {
        const p = ramp(t, 15 + index * 4, 72 + index * 3);
        return (
          <div
            key={token.value + '-' + index}
            className="data-token"
            style={{
              left: token.sx + (token.ex - token.sx) * p,
              top: token.sy + (token.ey - token.sy) * p,
              opacity: 0.2 + p * 0.55,
              backgroundColor: token.color,
            }}
          >
            {token.value}
          </div>
        );
      })}
      <PaperPiece className="metric-card" style={{ opacity: inFrame, transform: 'translateY(' + (1 - inFrame) * 18 + 'px)' }}>
        <div className="metric-label"><span className="piece-dot" />TOTAL</div>
        <div className="metric-value">{money(grandTotal)}</div>
        <div className="metric-caption">recalculated from the rows</div>
        <div className="bar-chart">
          <div className="bar-unit">
            <div className="bar-top-label">{money(totalA)}</div>
            <div className="bar-track"><div className="bar-fill bar-fill--green" style={{ height: Math.max(22, totalA * barScale) }} /></div>
            <div className="bar-name">Coffee</div>
          </div>
          <div className="bar-unit">
            <div className="bar-top-label">{money(totalB)}</div>
            <div className="bar-track"><div className="bar-fill bar-fill--ochre" style={{ height: Math.max(22, totalB * barScale) }} /></div>
            <div className="bar-name">Cake</div>
          </div>
        </div>
      </PaperPiece>
      <div className="data-caption">3 × ฿25 + 3 × ฿50 = ฿225&nbsp;&nbsp; → &nbsp;&nbsp;3 × ฿35 + 6 × ฿50 = ฿405</div>
    </Shell>
  );
}

function SceneSix({ frame }) {
  const t = frame - 660;
  const enter = ramp(t, 5, 22);
  const shift = ramp(t, 28, 82);
  const knobLeft = 12 + shift * 284;
  const rate = Math.round(10 + 10 * shift);
  const net = 405 * (1 - rate / 100);
  const netText = rate === 20 ? '฿324' : '฿' + net.toFixed(2);
  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: enter }}>RULES CAN CHANGE, TOO</div>
      <div className="rule-headline" style={{ opacity: enter }}>Change one rule.</div>
      <div className="discount-guidance" style={{ opacity: enter }}>Try a 20% discount.</div>
      <div className="rule-track-card" style={{ opacity: enter, transform: 'translateY(' + (1 - enter) * 16 + 'px)' }}>
        <div className="piece-overline">PROPOSED DISCOUNT</div>
        <div className="rule-big-rate">{rate}<span>%</span></div>
        <div className="rule-slider">
          <div className="rule-slider-fill" style={{ width: knobLeft + 'px' }} />
          <div className="rule-knob" style={{ left: knobLeft }} />
          <span className="slider-start">10%</span>
          <span className="slider-end">20%</span>
        </div>
        <div className="rule-range"><span>Current</span><span>Proposed</span></div>
      </div>
      <div className="rule-result" style={{ opacity: enter, transform: 'translateY(' + (1 - enter) * 18 + 'px)' }}>
        <div className="gross-preserved">
          <span>GROSS</span>
          <b>฿405</b>
          <span className="unchanged-label">unchanged</span>
        </div>
        <div className="net-comparison">
          <div className="net-row net-row--old">
            <div><span>10% discount</span><b>฿364.50</b></div>
            <div className="net-arrow">→</div>
          </div>
          <div className="net-row net-row--new">
            <div><span>20% discount</span><b>{netText}</b></div>
            <span className="active-rule-tag">PROPOSED</span>
          </div>
        </div>
      </div>
      <div className="rule-review-rail" style={{ opacity: ramp(t, 66, 82), transform: 'translateY(' + (1 - ramp(t, 66, 82)) * 10 + 'px)' }}>
        <div className="review-step"><span>1</span><b>Review proposed rule</b></div>
        <div className="review-arrow">→</div>
        <div className="apply-action">Apply to Canvas <span>↗</span></div>
      </div>
      <div className="rule-caption">Gross stays ฿405. The source rows stay the same.</div>
    </Shell>
  );
}

function WorkVignette({ style }) {
  return (
    <PaperPiece className="vignette vignette--work" style={style}>
      <div className="vignette-overline"><i className="swatch swatch--green" />WORK</div>
      <div className="vignette-title">Sales</div>
      <div className="vignette-mini-table">
        <div><span>Coffee</span><b>3 × ฿35</b></div>
        <div><span>Cake</span><b>6 × ฿50</b></div>
      </div>
      <div className="vignette-total"><span>TOTAL</span><b>฿405</b></div>
      <div className="vignette-mark">A living worksheet</div>
    </PaperPiece>
  );
}

function LearningVignette({ style }) {
  return (
    <div className="vignette vignette--learning" style={style}>
      <div className="vignette-overline"><i className="swatch swatch--ochre" />LEARNING</div>
      <div className="formula-large">F = m·a</div>
      <div className="formula-flow"><span>mass</span><b>×</b><span>acceleration</span><b>→</b><span>force</span></div>
      <div className="learning-note">A relationship to explore</div>
      <svg className="learning-orbit" width="110" height="96" viewBox="0 0 110 96" aria-hidden="true">
        <ellipse cx="55" cy="48" rx="42" ry="19" fill="none" stroke={C.ochre} strokeWidth="1.5" transform="rotate(-22 55 48)" />
        <circle cx="56" cy="48" r="12" fill={C.ochreSoft} stroke={C.ochre} strokeWidth="2" />
        <circle cx="20" cy="27" r="4" fill={C.ochre} />
      </svg>
    </div>
  );
}

function PlayVignette({ style }) {
  return (
    <div className="vignette vignette--play" style={style}>
      <div className="vignette-overline"><i className="swatch swatch--blue" />PLAY</div>
      <div className="play-board">
        <div /><div /><div />
        <div /><span className="play-piece">●</span><div />
        <div /><div /><div />
      </div>
      <div className="play-status"><b>TURN 04</b><span>Choose an action</span></div>
      <div className="play-caption">A turn-based game</div>
    </div>
  );
}

function SceneSeven({ frame }) {
  const t = frame - 810;
  const titleIn = ramp(t, 4, 20);
  const spread = ramp(t, 12, 55);
  const cards = [ramp(t, 18, 49), ramp(t, 26, 58), ramp(t, 34, 67)];
  return (
    <Shell>
      <div className="scene-kicker" style={{ opacity: titleIn }}>ONE CANVAS, MANY DIRECTIONS</div>
      <div className="vignette-headline" style={{ opacity: titleIn }}>
        <span>For work.</span><span className="hero-accent">Learning.</span><span>Play.</span>
      </div>
      <svg className="branch-lines" viewBox="0 0 1280 720" aria-hidden="true">
        <path d="M640 260C510 290 310 280 242 350M640 260V350M640 260C780 290 970 280 1038 350" fill="none" stroke={C.edge} strokeWidth="2" strokeDasharray="5 8" opacity={spread * 0.85} />
      </svg>
      <div className="source-canvas" style={{ opacity: 1 - spread, transform: 'translate(-50%, -50%) scale(' + (1 - spread * 0.6) + ')' }}>
        <TableMark size={44} />
        <span>ONE CANVAS</span>
      </div>
      <WorkVignette style={{ opacity: cards[0], transform: 'translateY(' + (1 - cards[0]) * 22 + 'px)' }} />
      <LearningVignette style={{ opacity: cards[1], transform: 'translateY(' + (1 - cards[1]) * 22 + 'px)' }} />
      <PlayVignette style={{ opacity: cards[2], transform: 'translateY(' + (1 - cards[2]) * 22 + 'px)' }} />
    </Shell>
  );
}

function SceneEight({ frame }) {
  const t = frame - 930;
  const enter = ramp(t, 3, 25);
  return (
    <Shell dark>
      <div className="closing-band" style={{ opacity: enter * 0.85 }} />
      <div className="closing-orbit" style={{ opacity: enter * 0.27, transform: 'scale(' + (0.84 + enter * 0.16) + ')' }} />
      <div className="closing-copy" style={{ opacity: enter, transform: 'translateY(' + (1 - enter) * 14 + 'px)' }}>
        <div>Work defines</div>
        <div>what software</div>
        <div className="hero-light">becomes.</div>
      </div>
      <div className="closing-brand" style={{ opacity: ramp(t, 15, 35), transform: 'translateY(' + (1 - ramp(t, 15, 35)) * 16 + 'px)' }}>
        <div className="closing-mark"><TableMark size={104} light /></div>
        <div className="closing-wordmark">TABLETOP</div>
        <div className="closing-url">tabletop.ptchrr.workers.dev</div>
      </div>
      <div className="closing-rule" style={{ opacity: enter }} />
      <div className="closing-draft" style={{ opacity: enter }}>DRAFT 01 · CODE-ONLY ANIMATIC</div>
    </Shell>
  );
}

export function NarrativeAnimatic() {
  const frame = useCurrentFrame();
  const dark = (frame >= 120 && frame < 210) || frame >= 930;
  let scene;
  if (frame < 120) scene = <SceneOne frame={frame} />;
  else if (frame < 210) scene = <SceneTwo frame={frame} />;
  else if (frame < 330) scene = <SceneThree frame={frame} />;
  else if (frame < 480) scene = <SceneFour frame={frame} />;
  else if (frame < 660) scene = <SceneFive frame={frame} />;
  else if (frame < 810) scene = <SceneSix frame={frame} />;
  else if (frame < 930) scene = <SceneSeven frame={frame} />;
  else scene = <SceneEight frame={frame} />;
  return (
    <AbsoluteFill className="animatic-root">
      {scene}
      <div className="header-overlay"><Header dark={dark} /></div>
    </AbsoluteFill>
  );
}
