import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';

const C = {
  paper: '#faf8f0',
  white: '#fffdf7',
  board: '#eeeee2',
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
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.inOut(Easing.cubic),
});

const mix = (value, from, to, a, b) => interpolate(value, [from, to], [a, b], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.inOut(Easing.cubic),
});

const money = (value) => '฿' + value.toLocaleString('en-US');
const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const graphemes = (text) => Array.from(segmenter.segment(text), ({ segment }) => segment);

const REQUESTS = [
  {
    id: 'table',
    title: 'Sales table · coffee + cake',
    label: 'Sales table',
    detail: 'Coffee and cake with quantities, prices, and line totals.',
    message: 'Make me a sales table for coffee and cake.',
    typeStart: 346,
    typingStep: 1.7,
    send: 441,
    draftEnd: 465,
    reviewed: 512,
    applyStart: 524,
    apply: 536,
    result: 555,
  },
  {
    id: 'quick',
    title: 'One-click sale buttons',
    label: 'Quick-sale buttons',
    detail: 'Coffee +1 and Cake +1.',
    message: 'Add buttons so I can record a sale with one click.',
    typeStart: 814,
    typingStep: 1.5,
    send: 911,
    draftEnd: 917,
    reviewed: 924,
    applyStart: 930,
    apply: 936,
    result: 958,
  },
  {
    id: 'chart',
    title: 'Sales by item',
    label: 'Sales chart',
    detail: 'Coffee ฿100 · Cake ฿150 from the same rows.',
    message: 'Add a chart by item.',
    typeStart: 1270,
    typingStep: 1.2,
    send: 1317,
    draftEnd: 1326,
    reviewed: 1339,
    applyStart: 1345,
    apply: 1352,
    result: 1362,
  },
  {
    id: 'discount10',
    title: '10% discount rule',
    label: '10% discount',
    detail: '฿250 × 90% = ฿225 net.',
    message: 'Add a 10% discount.',
    typeStart: 1622,
    typingStep: 1.2,
    send: 1664,
    draftEnd: 1672,
    reviewed: 1679,
    applyStart: 1686,
    apply: 1694,
    result: 1710,
  },
  {
    id: 'discount20',
    title: 'Change the selected rule to 20%',
    label: '20% discount',
    detail: '฿250 × 80% = ฿200 net.',
    message: 'Change this to 20%.',
    typeStart: 1962,
    typingStep: 1.2,
    send: 2010,
    draftEnd: 2018,
    reviewed: 2026,
    applyStart: 2064,
    apply: 2074,
    result: 2091,
  },
].map((request) => ({ ...request, letters: graphemes(request.message) }));

const QUICK_CLICK = 1055;
const QUICK_UPDATE = 1074;
const RULE_SELECT = 1929;

function Mark({ frame, size = 30, staticMark = false }) {
  // Canonical four-tile mark and frame-based port of the existing loader motion.
  const tiltFrame = ((frame % 72) + 72) % 72;
  const animatedTilt = interpolate(tiltFrame, [0, 36, 72], [-5, 85, -5], {
    easing: Easing.bezier(0.65, 0, 0.35, 1),
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const tilt = staticMark ? -5 : animatedTilt;
  const offsets = [0, 4.5, 13.5, 9];
  const colors = ['#243548', '#24796b', '#6f8190', '#d49a47'];

  return <span className="brand-mark" style={{
    width: size,
    height: size,
    gridTemplateColumns: `repeat(2, ${(size - size * 0.28) / 2}px)`,
    gap: size * 0.14,
    transform: `rotate(${tilt}deg)`,
  }} aria-hidden="true">
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
      return <i key={color} style={{
        width: (size - size * 0.28) / 2,
        height: (size - size * 0.28) / 2,
        borderRadius: index === 3 ? '50%' : size * 0.11,
        background: color,
        transform: `scale(${scale})`,
        opacity,
      }} />;
    })}
  </span>;
}

function Chrome({ frame }) {
  const dark = frame >= 2415;
  return <header className={`chrome${dark ? ' chrome--dark' : ''}`}>
    <div className="brand-lockup"><Mark frame={frame} size={30} /><span>tabletop<span className="brand-period">.</span></span></div>
    <div className="provenance">
      <strong>Concept animation · illustrative data</strong>
    </div>
  </header>;
}

function WritingPen({ frame }) {
  const strokes = [
    { start: 26, end: 55, x0: 58, x1: 468, y: 173 },
    { start: 59, end: 88, x0: 58, x1: 468, y: 235 },
    { start: 99, end: 125, x0: 118, x1: 382, y: 306 },
    { start: 128, end: 143, x0: 408, x1: 492, y: 380 },
  ];
  const stroke = strokes.find(({ start, end }) => frame >= start && frame <= end);
  if (!stroke) return null;
  const pointX = mix(frame, stroke.start, stroke.end, stroke.x0, stroke.x1);
  const opacity = clamp(frame, stroke.start, stroke.start + 3)
    * (1 - clamp(frame, stroke.end - 3, stroke.end));
  return <svg className="manual-pen" viewBox="0 0 184 42" aria-hidden="true" style={{
    left: pointX - 184,
    top: stroke.y - 20,
    opacity,
  }}>
    <path d="M13 11 Q8 21 13 31 L150 29 Q159 28 165 21 L150 13Z" fill={C.green} stroke="#234a3f" strokeWidth="2" />
    <path d="M30 14 L136 15" stroke="#a9cbb5" strokeWidth="3" strokeLinecap="round" />
    <path d="M165 15 L183 21 L165 27Z" fill={C.ochre} />
    <path d="M179 20 L184 21 L179 22Z" fill={C.ink} />
    <path d="M31 12 V5 Q31 2 35 2 H85" fill="none" stroke={C.ink} strokeWidth="3" strokeLinecap="round" />
  </svg>;
}

function OrderSlip({ frame }) {
  const enter = clamp(frame, 0, 18);
  const coffee = clamp(frame, 22, 55);
  const cake = clamp(frame, 56, 89);
  const addition = clamp(frame, 99, 125);
  const wrongTotal = clamp(frame, 119, 123);
  const correctionLine = clamp(frame, 127, 138);
  const correctedTotal = clamp(frame, 138, 149);
  const clipWritten = (progress) => ({
    clipPath: `inset(0 ${100 - progress * 100}% 0 0)`,
    opacity: progress > 0 ? 1 : 0,
  });

  return <div className="order-slip" style={{
    opacity: enter,
    transform: `translateY(${(1 - enter) * 44}px) rotate(-1deg)`,
  }}>
    <div className="slip-holes"><i /><i /><i /><i /><i /></div>
    <div className="slip-topline"><b>THE CORNER POP-UP</b><span>DAILY ORDER · 001</span></div>
    <div className="slip-title">Sales note <small>coffee &amp; cake</small></div>
    <div className="slip-rule" />
    <div className="slip-columns"><span>ITEM</span><span>COUNT × PRICE</span><span>LINE TOTAL</span></div>
    <div className="slip-row slip-row--coffee" style={clipWritten(coffee)}>
      <strong><i className="slip-dot slip-dot--green" />Coffee</strong><span>3 × ฿25</span><b>฿75</b>
    </div>
    <div className="slip-row slip-row--cake" style={clipWritten(cake)}>
      <strong><i className="slip-dot slip-dot--ochre" />Cake</strong><span>3 × ฿50</span><b>฿150</b>
    </div>
    <div className="slip-addition" style={clipWritten(addition)}>
      <span>ADD THE LINE TOTALS</span><b>฿75 + ฿150</b><i>=</i>
    </div>
    <div className="slip-total">
      <span className="slip-total-label">DAILY TOTAL</span>
      <div className="slip-total-values">
        <span className="slip-total-old" style={{ opacity: wrongTotal }}>
          ฿275<i style={{ width: `${correctionLine * 72}px` }} />
        </span>
        <b className="slip-total-correct" style={{ opacity: correctedTotal }}>฿225</b>
      </div>
    </div>
    <div className="slip-recheck" style={{ opacity: correctedTotal }}>Checked again</div>
    <div className="slip-footer">PAPER ORDER · ILLUSTRATIVE EXAMPLE</div>
    <WritingPen frame={frame} />
  </div>;
}

function OrderStack({ frame }) {
  const reveal = clamp(frame, 120, 142);
  if (!reveal) return null;
  return <div className="order-stack" style={{ opacity: reveal }} aria-hidden="true">
    <div className="stack-slip stack-slip--back"><b>ORDER 003</b><i /><i /><i /></div>
    <div className="stack-slip stack-slip--front"><b>ORDER 002</b><i /><i /><i /></div>
  </div>;
}

function Intro({ frame }) {
  const transition = clamp(frame, 282, 300);
  const question = clamp(frame, 188, 204);
  const title = clamp(frame, 8, 24);
  return <AbsoluteFill className="intro-scene" style={{ transform: `translateX(${-1280 * transition}px)` }}>
    <div className="intro-rule" style={{ transform: `scaleX(${title})`, transformOrigin: 'left center' }} />
    <div className="intro-copy" style={{ opacity: title, transform: `translateY(${(1 - title) * 12}px)` }}>
      <div className="intro-eyebrow">THE CORNER POP-UP · A BUSY DAY</div>
      <h1>
        <span className="intro-message" style={{ opacity: 1 - question }}>Write it down. <em>Add it up again.</em></span>
        <span className="intro-message" style={{ opacity: question }}>Could the tool <em>fit your work?</em></span>
      </h1>
      <p>Every order starts with a note. Every total needs checking.</p>
    </div>
    <div className="intro-note"><i />A SMALL SHOP · A BUSY AFTERNOON</div>
    <OrderStack frame={frame} />
    <OrderSlip frame={frame} />
  </AbsoluteFill>;
}

const chapterFor = (frame) => {
  if (frame < 297) return ['COULD THIS TOOL FIT YOUR WORK?', 'THE CORNER POP-UP'];
  if (frame < 655) return ['START WITH TODAY’S NEED', 'THE CORNER POP-UP'];
  if (frame < 1205) return ['MAKE A BUSY MOMENT EASIER', 'ONE CANVAS · ONE CLICK'];
  if (frame < 1549) return ['ASK FOR A CLEARER VIEW', 'SALES BY ITEM'];
  if (frame < 1869) return ['TRY AN AFTERNOON OFFER', 'GROSS STAYS THE SAME'];
  if (frame < 2274) return ['CHANGE THE RULE', 'REVIEW → APPLY'];
  return ['SHAPED BY THE WORK', 'THE CORNER POP-UP'];
};

function Chapter({ frame }) {
  const [title, context] = chapterFor(frame);
  return <div className="chapter-caption">
    <span>{title}</span>
    <small>{context}</small>
  </div>;
}

function Pointer({ className = '', style = {} }) {
  return <svg className={`pointer ${className}`} style={style} width="26" height="32" viewBox="0 0 26 32" aria-hidden="true">
    <path d="M3 2 22 17l-7 1 4 8-4 2-4-9-6 5Z" fill={C.ink} stroke={C.white} strokeWidth="2" strokeLinejoin="round" />
  </svg>;
}

function SalesTable({ frame, visible, coffeeQty, coffeeTotal, gross, reveal }) {
  if (!visible) return null;
  const coffeeFlash = frame >= QUICK_UPDATE && frame < QUICK_UPDATE + 24 ? 1 - clamp(frame, QUICK_UPDATE + 8, QUICK_UPDATE + 24) : 0;
  return <div className="sales-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 16}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--green" />TODAY’S SALES</span><span className="sample-chip">EXAMPLE</span></div>
    <div className="sales-column-head"><span>ITEM</span><span>QTY</span><span>UNIT</span><span>LINE TOTAL</span></div>
    <div className="sales-row" style={{ backgroundColor: `rgba(232,240,228,${coffeeFlash * 0.92})` }}>
      <strong><i className="row-mark row-mark--green" />Coffee</strong><b>{coffeeQty}</b><b>฿25</b><b>{money(coffeeTotal)}</b>
    </div>
    <div className="sales-row">
      <strong><i className="row-mark row-mark--ochre" />Cake</strong><b>3</b><b>฿50</b><b>฿150</b>
    </div>
    <div className="table-equation"><span>{coffeeQty} × ฿25 <i>+</i> 3 × ฿50</span><b>{money(gross)}</b></div>
    <div className="table-foot"><span>Illustrative rows</span><span className="table-foot-bullet" />Rows and totals stay together</div>
  </div>;
}

function QuickSale({ frame, visible, reveal }) {
  if (!visible) return null;
  const tapped = frame >= QUICK_CLICK;
  const pointerOpacity = frame >= QUICK_CLICK - 10 && frame <= QUICK_CLICK + 5 ? 1 : 0;
  return <div className="quick-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 14}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--ochre" />QUICK SALE</span><span className="quick-mode">ADD 1</span></div>
    <div className="quick-buttons">
      <div className={`quick-button quick-button--coffee${tapped ? ' quick-button--tapped' : ''}`}>
        <span className="quick-symbol">C</span><strong>Coffee</strong><b>+1</b>
      </div>
      <div className="quick-button quick-button--cake">
        <span className="quick-symbol">K</span><strong>Cake</strong><b>+1</b>
      </div>
    </div>
    <div className="quick-foot">{tapped ? 'Coffee count +1 · now 4' : 'One tap adds one to the count'}</div>
    {pointerOpacity > 0 && <Pointer className="quick-pointer" style={{
      opacity: pointerOpacity,
      left: mix(frame, QUICK_CLICK - 10, QUICK_CLICK, 88, 61),
      top: mix(frame, QUICK_CLICK - 10, QUICK_CLICK, 80, 94),
    }} />}
  </div>;
}

function SalesChart({ visible, reveal, coffeeTotal }) {
  if (!visible) return null;
  const coffeeHeight = Math.max(16, coffeeTotal / 150 * 76);
  const cakeHeight = 150 / 150 * 76;
  return <div className="chart-card paper-card" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 14}px)` }}>
    <div className="card-topline"><span><i className="kind-dot kind-dot--blue" />SALES BY ITEM</span><span className="chart-kind">SAME TABLE</span></div>
    <div className="chart-plot">
      <div className="chart-grid chart-grid--one" /><div className="chart-grid chart-grid--two" /><div className="chart-baseline" />
      <div className="chart-bar-unit chart-bar-unit--coffee" style={{ '--bar-height': `${coffeeHeight}px` }}>
        <b>{money(coffeeTotal)}</b><i style={{ height: coffeeHeight, background: C.green }} /><span>Coffee</span>
      </div>
      <div className="chart-bar-unit chart-bar-unit--cake" style={{ '--bar-height': `${cakeHeight}px` }}>
        <b>{money(150)}</b><i style={{ height: cakeHeight, background: C.ochre }} /><span>Cake</span>
      </div>
    </div>
    <div className="chart-foot">From the same rows · gross ฿250</div>
  </div>;
}

function DiscountCard({ visible, reveal, rate, gross, net, selected }) {
  if (!visible) return null;
  return <div className={`discount-card paper-card${selected ? ' discount-card--selected' : ''}`} style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 14}px)` }}>
    <div className="discount-head">
      <span><i className="kind-dot kind-dot--clay" />DISCOUNT RULE</span>
      <div className="discount-head-meta"><span className="saved-chip saved-chip--applied">APPLIED</span>{selected && <span className="selection-chip">SELECTED</span>}</div>
    </div>
    <div className="discount-content">
      <div className="discount-rate"><strong>{rate}%</strong><small>CURRENT</small></div>
      <div className="discount-math"><span>GROSS {money(gross)}</span><i>→</i><b>NET {money(net)}</b></div>
    </div>
    <div className="discount-foot">Gross stays {money(gross)} · calculated from the same rows</div>
  </div>;
}

function CanvasBoard({ frame }) {
  const [coffeeQty, gross, coffeeTotal] = (() => {
    const qty = frame >= QUICK_UPDATE ? 4 : 3;
    const coffee = qty * 25;
    return [qty, coffee + 3 * 50, coffee];
  })();
  const tableVisible = frame >= REQUESTS[0].result;
  const quickVisible = frame >= REQUESTS[1].result;
  const chartVisible = frame >= REQUESTS[2].result;
  const discount10Visible = frame >= REQUESTS[3].result;
  const discount20Visible = frame >= REQUESTS[4].result;
  const discountSelected = frame >= RULE_SELECT;
  const cardReveal = (result) => clamp(frame, result, result + 18);
  const chartDraw = clamp(frame, REQUESTS[2].result, REQUESTS[2].result + 26);
  const rate = discount20Visible ? 20 : 10;
  const net = Math.round(gross * (1 - rate / 100));

  return <div className="canvas-board">
    <div className="board-topline">
      <div className="board-project"><span className="board-mini-mark"><i /><i /><i /><i /></span><span>THE CORNER POP-UP</span><small>SALES CANVAS · EXAMPLE</small></div>
      <div className="board-status"><i /> ONE CANVAS</div>
    </div>
    <div className="board-content">
    <svg className="board-connectors" viewBox="0 0 760 510" aria-hidden="true">
        <path d="M493 314 C503 314 510 326 520 326" pathLength="1" style={{
          strokeDasharray: `${chartDraw} 1`,
          opacity: frame <= REQUESTS[2].result ? 0 : 1,
        }} />
      </svg>
      {tableVisible
        ? <SalesTable
          frame={frame}
          visible={tableVisible}
          coffeeQty={coffeeQty}
          coffeeTotal={coffeeTotal}
          gross={gross}
          reveal={cardReveal(REQUESTS[0].result)}
        />
        : <div className="empty-canvas" style={{ opacity: 1 - clamp(frame, REQUESTS[0].result - 20, REQUESTS[0].result) }}>
          <span className="empty-mark"><i /><i /><i /><i /></span>
          <b>A canvas begins with a request.</b>
          <small>No file needed to ask.</small>
        </div>}
      <QuickSale frame={frame} visible={quickVisible} reveal={cardReveal(REQUESTS[1].result)} />
      <SalesChart visible={chartVisible} reveal={cardReveal(REQUESTS[2].result)} coffeeTotal={coffeeTotal} />
      <DiscountCard
        visible={discount10Visible}
        reveal={cardReveal(REQUESTS[3].result)}
        rate={rate}
        gross={gross}
        net={net}
        selected={discountSelected}
      />
      {discountSelected && frame < REQUESTS[4].typeStart && <Pointer className="rule-pointer" style={{ left: 429, top: 399, opacity: 1 }} />}
    </div>
  </div>;
}

function RequestState({ frame, request }) {
  const sent = frame >= request.send;
  const drafting = sent && frame < request.draftEnd;
  const reviewed = frame >= request.reviewed;
  const applying = frame >= request.apply && frame < request.result;
  const applied = frame >= request.result;
  const composerSettle = sent ? clamp(frame, request.send, request.send + 18) : 0;
  const visibleLetters = sent
    ? request.letters.length
    : Math.max(0, Math.min(request.letters.length, Math.floor((frame - request.typeStart) / request.typingStep) + 1));
  const typed = sent ? '' : request.letters.slice(0, visibleLetters).join('');
  const reviewPointer = frame >= request.reviewed - 10 && frame < request.reviewed;
  const applyPointerStart = Math.max(request.reviewed + 18, request.applyStart - 8);
  const applyPointer = frame >= applyPointerStart && frame < request.apply;
  const sendPointer = frame >= request.send - 10 && frame < request.send + 4;
  const status = !sent ? 'Typing' : drafting ? 'Drafting your change' : applying ? 'Applying' : applied ? 'Applied to this canvas' : reviewed ? 'Reviewed by you' : 'Ready for review';
  const composerStyle = {
    top: mix(composerSettle, 0, 1, 76, 439),
    height: mix(composerSettle, 0, 1, 430, 67),
    bottom: 'auto',
  };
  const composerInputStyle = {
    height: mix(composerSettle, 0, 1, 362, 40),
  };
  const composerFontSize = mix(composerSettle, 0, 1, 24, 12);
  const composerLabelStyle = {
    height: mix(composerSettle, 0, 1, 25, 0),
    marginBottom: mix(composerSettle, 0, 1, 10, 0),
    opacity: 1 - composerSettle,
  };
  const bubbleReveal = sent ? clamp(frame, request.send, request.send + 12) : 0;

  return <>
    {sent && <div className="request-bubble" style={{ opacity: bubbleReveal, transform: `translateY(${(1 - bubbleReveal) * 12}px)` }}>
      <div className="bubble-author">YOU</div>
      <div className="bubble-text">{request.message}</div>
    </div>}
    {sent && <div className={`assistant-card${applied ? ' assistant-card--done' : ''}`}>
      <div className="assistant-status"><i className={applied ? 'status-dot status-dot--done' : 'status-dot'} />TABLETOP <span>{status}</span></div>
      {drafting
        ? <div className="drafting-copy"><b>Drafting a change to this canvas</b><div className="draft-progress"><i style={{ width: `${clamp(frame, request.send, request.draftEnd) * 100}%` }} /></div></div>
        : applied
          ? <div className="applied-copy"><strong>✓ {request.title}</strong><span>Added after your review</span></div>
          : <>
            <div className="proposal-copy"><b>{request.title}</b><span>{request.detail}</span></div>
            {request.id === 'discount20' && <div className="proposal-preview"><span>Keep 10% · ฿225</span><i>→</i><b>Proposed 20% · ฿200</b></div>}
            <div className="proposal-actions">
              <div className={`review-action${reviewed ? ' review-action--done' : reviewPointer ? ' review-action--focus' : ''}`}><i>{reviewed ? '✓' : '1'}</i>{reviewed ? 'Reviewed' : 'Review'}</div>
              <div className={`apply-action${frame >= request.applyStart && frame < request.apply ? ' apply-action--focus' : ''}`}>{applying ? 'Applying…' : 'Apply'}</div>
              {reviewPointer && <Pointer className="review-pointer" style={{ left: 28, opacity: 1 }} />}
              {applyPointer && <Pointer className="apply-pointer" style={{
                left: mix(frame, applyPointerStart, request.apply, 155, 302),
                opacity: 1,
              }} />}
            </div>
          </>}
    </div>}
    <div className={`composer${sent ? ' composer--sent' : ' composer--composing'}`} style={composerStyle}>
      <div className="composer-label" style={composerLabelStyle}><span>YOUR REQUEST</span><small>Send when ready</small></div>
      <div className="composer-row" style={{ height: composerInputStyle.height }}>
        <div className="composer-input" style={composerInputStyle}>
          {typed.length ? <span className="typed-text" style={{ fontSize: composerFontSize }}>{typed}<i className="typing-caret" /></span> : (!sent || composerSettle === 1) && <span className="placeholder-text" style={{ fontSize: composerFontSize }}>Tell this canvas what would help…</span>}
        </div>
        <div className={`send-button${frame >= request.typeStart + request.letters.length * request.typingStep ? ' send-button--ready' : ''}${sendPointer ? ' send-button--focus' : ''}`} style={{ fontSize: mix(composerSettle, 0, 1, 16, 11) }}>Send <span>↗</span></div>
        {sendPointer && <Pointer className="send-pointer" style={{
          left: mix(frame, request.send - 10, request.send, 195, 334),
          opacity: 1,
        }} />}
      </div>
    </div>
  </>;
}

function ConversationPanel({ frame }) {
  let index = 0;
  for (let i = 1; i < REQUESTS.length; i++) {
    if (frame >= REQUESTS[i].typeStart) index = i;
  }
  const request = REQUESTS[index];
  const accepted = REQUESTS.slice(0, index).filter((item) => frame >= item.result);
  const composing = frame < request.send;
  return <div className={`conversation-panel${composing ? ' conversation-panel--composing' : ''}`}>
    <div className="conversation-header">
      <span className="conversation-avatar">C</span>
      <div><b>The Corner Pop-Up</b><small>One canvas · shaped by the seller</small></div>
      <span className="conversation-live"><i />DRAFT</span>
    </div>
    <div className="accepted-label">ALREADY ADDED</div>
    <div className="accepted-trail">
      {accepted.length === 0
        ? <span className="accepted-empty">Nothing yet</span>
        : accepted.map((item) => <span className="accepted-chip" key={item.id}><i>✓</i>{item.label}</span>)}
    </div>
    <RequestState frame={frame} request={request} />
  </div>;
}

function Workspace({ frame }) {
  return <AbsoluteFill className="workspace-scene">
    <Chapter frame={frame} />
    <CanvasBoard frame={frame} />
    <ConversationPanel frame={frame} />
  </AbsoluteFill>;
}

function EndLockup({ frame }) {
  const reveal = clamp(frame, 2415, 2427);
  return <AbsoluteFill className="end-scene" style={{ opacity: reveal }}>
    <div className="end-band" />
    <div className="end-orbit end-orbit--one" /><div className="end-orbit end-orbit--two" />
    <div className="end-lockup" style={{ transform: `translateY(${(1 - reveal) * 14}px)` }}>
      <Mark frame={frame} size={90} staticMark />
      <div className="end-wordmark">tabletop<span>.</span></div>
      <div className="end-url">tabletop.ptchrr.workers.dev</div>
      <div className="end-tagline">Tools that keep adapting to you.</div>
    </div>
    <div className="end-draft">CONCEPT FILM · DRAFT 04</div>
  </AbsoluteFill>;
}

export function NarrativeAnimatic() {
  const frame = useCurrentFrame();
  const transition = clamp(frame, 282, 300);
  return <AbsoluteFill className="film-frame">
    {frame < 300 && <Intro frame={frame} />}
    {frame >= 282 && frame < 2427 && <AbsoluteFill style={{ transform: `translateX(${1280 * (1 - transition)}px)` }}><Workspace frame={frame} /></AbsoluteFill>}
    {frame >= 2415 && <EndLockup frame={frame} />}
    <Chrome frame={frame} />
  </AbsoluteFill>;
}
