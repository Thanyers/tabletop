import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import timeline from '../timeline.json';
import { BrandMark } from './BrandMark.jsx';
import { ThesisIntro } from './ThesisIntro.jsx';
import './ThesisIntro.css';

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
const REQUESTS = timeline.requests;
const QUICK_CLICK = timeline.cues['quick.click'];
const QUICK_UPDATE = timeline.cues['quick.salesUpdated'];
const RULE_SELECT = timeline.cues['discount20.select'];

function Chrome({ frame }) {
  return <header className="chrome">
    <div className="brand-lockup"><BrandMark frame={frame} size={30} /><span>tabletop<span className="brand-period">.</span></span></div>
    <div className="provenance">
      <strong>Concept animation · illustrative data</strong>
    </div>
  </header>;
}

const segmentStart = (id) => timeline.segments.find((segment) => segment.id === id).startFrame;

function Intro({ frame }) {
  const phase = frame < segmentStart('friction')
    ? 'tools'
    : frame < segmentStart('reversal')
      ? 'friction'
      : 'reversal';
  return <ThesisIntro frame={frame} phase={phase} cues={timeline.cues} />;
}

const chapterFor = (frame) => {
  if (frame < segmentStart('quick-request')) return ['START WITH TODAY’S NEED', 'THE CORNER POP-UP'];
  if (frame < segmentStart('chart')) return ['MAKE A BUSY MOMENT EASIER', 'ONE CANVAS · ONE CLICK'];
  if (frame < segmentStart('discount10')) return ['ASK FOR A CLEARER VIEW', 'SALES BY ITEM'];
  if (frame < segmentStart('discount20')) return ['TRY AN AFTERNOON OFFER', 'GROSS STAYS THE SAME'];
  if (frame < segmentStart('close')) return ['CHANGE THE RULE', 'REVIEW → APPLY'];
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
  const cardReveal = (result, duration = 18) => clamp(frame, result, result + duration);
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
      <QuickSale frame={frame} visible={quickVisible} reveal={cardReveal(REQUESTS[1].result, 12)} />
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
  const beforeTyping = frame < request.typeStart;
  const drafting = sent && frame < request.draftEnd;
  const reviewed = frame >= request.reviewed;
  const applying = frame >= request.apply && frame < request.result;
  const applied = frame >= request.result;
  const composerSettle = beforeTyping ? 1 : sent ? clamp(frame, request.send, request.send + 18) : 0;
  const visibleLetters = sent
    ? request.letters.length
    : beforeTyping
      ? 0
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
  const composing = frame >= request.typeStart && frame < request.send;
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
  const logoStart = timeline.cues['close.logoStart'];
  const reveal = clamp(frame, logoStart, logoStart + 14);
  return <AbsoluteFill className="end-scene">
    <div className="end-lockup" style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 10}px)` }}>
      <BrandMark frame={frame - logoStart} size={76} />
      <div className="end-wordmark">tabletop<span>.</span></div>
    </div>
  </AbsoluteFill>;
}

export function NarrativeAnimatic() {
  const frame = useCurrentFrame();
  const boardStart = timeline.cues['board.start'];
  const logoStart = timeline.cues['close.logoStart'];
  return <AbsoluteFill className="film-frame">
    {frame < boardStart && <Intro frame={frame} />}
    {frame >= boardStart && frame < logoStart && <Workspace frame={frame} />}
    {frame >= logoStart && <EndLockup frame={frame} />}
    {frame >= boardStart && frame < logoStart && <Chrome frame={frame} />}
  </AbsoluteFill>;
}
