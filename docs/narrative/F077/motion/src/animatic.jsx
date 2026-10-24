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
const segmenter = new Intl.Segmenter('th', { granularity: 'grapheme' });
const graphemes = (text) => Array.from(segmenter.segment(text), ({ segment }) => segment);

const REQUESTS = [
  {
    id: 'table',
    title: 'โต๊ะจดขายกาแฟและเค้ก',
    label: 'ตารางขาย',
    detail: 'กาแฟและเค้ก พร้อมจำนวน ราคา และยอดรวมต่อรายการ',
    message: 'ช่วยทำโต๊ะจดขายกาแฟกับเค้ก',
    typeStart: 168,
    send: 234,
    draftEnd: 258,
    reviewed: 276,
    applyStart: 284,
    apply: 300,
    result: 312,
  },
  {
    id: 'quick',
    title: 'เพิ่มปุ่มขาย +1',
    label: 'ปุ่มขาย +1',
    detail: 'ปุ่มกาแฟ +1 และเค้ก +1',
    message: 'ช่วงลูกค้าเยอะ กรอกไม่ทัน\nเพิ่มปุ่มขาย กดครั้งเดียวเพิ่มจำนวน',
    typeStart: 428,
    send: 552,
    draftEnd: 576,
    reviewed: 600,
    applyStart: 608,
    apply: 628,
    result: 640,
  },
  {
    id: 'chart',
    title: 'เพิ่มกราฟแยกตามสินค้า',
    label: 'กราฟสินค้า',
    detail: 'กาแฟ ฿100 · เค้ก ฿150 จากตารางเดียวกัน',
    message: 'อยากรู้ว่าอะไรขายดี\nเพิ่มกราฟยอดขายแยกตามสินค้า',
    typeStart: 850,
    send: 954,
    draftEnd: 978,
    reviewed: 1002,
    applyStart: 1010,
    apply: 1028,
    result: 1040,
  },
  {
    id: 'discount10',
    title: 'เพิ่มกฎส่วนลด 10%',
    label: 'ส่วนลด 10%',
    detail: '฿250 × 90% = ฿225 สุทธิ',
    message: 'เพิ่มส่วนลด 10%',
    typeStart: 1152,
    send: 1200,
    draftEnd: 1224,
    reviewed: 1248,
    applyStart: 1256,
    apply: 1274,
    result: 1286,
  },
  {
    id: 'discount20',
    title: 'เปลี่ยนกฎที่เลือกเป็น 20%',
    label: 'แก้กฎ 20%',
    detail: '฿250 × 80% = ฿200 · ยอดรวมคงเดิม',
    message: 'เปลี่ยนกฎนี้เป็น 20%',
    typeStart: 1392,
    send: 1446,
    draftEnd: 1470,
    reviewed: 1494,
    applyStart: 1502,
    apply: 1520,
    result: 1532,
  },
].map((request) => ({ ...request, letters: graphemes(request.message) }));

const QUICK_CLICK = 692;

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
  const dark = frame >= 1740;
  return <header className={`chrome${dark ? ' chrome--dark' : ''}`}>
    <div className="brand-lockup"><Mark frame={frame} size={30} /><span>tabletop<span className="brand-period">.</span></span></div>
    <div className="provenance">
      <strong>Concept animation · illustrative data</strong>
      <span>ภาพอธิบาย · ข้อมูลตัวอย่าง</span>
    </div>
  </header>;
}

function Chair({ frame }) {
  const enter = clamp(frame, 3, 20);
  return <svg className="chair-object" viewBox="0 0 340 410" style={{
    opacity: enter,
    transform: `translate(${(1 - enter) * 48}px, ${(1 - enter) * 16}px)`,
  }} aria-label="A wooden chair">
    <ellipse cx="177" cy="380" rx="111" ry="13" fill={C.ink} opacity=".1" />
    <path d="M98 74 Q98 62 111 62 H232 Q245 62 245 75 V229 H98Z" fill="#b9c8b6" stroke={C.green} strokeWidth="5" />
    <path d="M117 84 H225 V210 H117Z" fill={C.paper} opacity=".62" />
    <path d="M75 236 L268 236 Q279 236 279 249 V269 Q279 280 266 280 H78 Q66 280 66 269 V248 Q66 236 75 236Z" fill={C.ochre} />
    <path d="M88 278 L102 375 M257 278 L245 375 M83 270 L53 367 M264 270 L294 367" fill="none" stroke={C.ochre} strokeWidth="14" strokeLinecap="round" />
    <path d="M72 346 Q169 364 276 345" fill="none" stroke={C.ochre} strokeWidth="8" strokeLinecap="round" />
  </svg>;
}

function Cushion({ frame }) {
  const enter = clamp(frame, 95, 117);
  return <svg className="cushion-object" viewBox="0 0 210 56" style={{
    opacity: enter,
    transform: `translateY(${(1 - enter) * 24}px) scale(${0.9 + enter * 0.1})`,
  }} aria-hidden="true">
    <path d="M16 14 Q18 6 29 7 H181 Q192 8 194 18 L188 42 Q186 50 175 49 H31 Q19 48 17 39Z" fill={C.greenSoft} stroke={C.green} strokeWidth="3" />
    <path d="M37 17 Q105 12 174 18 M35 39 Q105 44 174 38" fill="none" stroke="#b9d3c1" strokeWidth="2" />
  </svg>;
}

function Book({ frame }) {
  const enter = clamp(frame, 103, 125);
  return <svg className="book-object" viewBox="0 0 106 66" style={{
    opacity: enter,
    transform: `translate(${(1 - enter) * 26}px, ${(1 - enter) * 12}px) rotate(-8deg)`,
  }} aria-hidden="true">
    <path d="M12 10 Q32 4 52 15 V56 Q32 46 12 53Z" fill={C.white} stroke={C.blue} strokeWidth="3" />
    <path d="M52 15 Q73 4 94 10 V53 Q74 46 52 56Z" fill={C.blueSoft} stroke={C.blue} strokeWidth="3" />
    <path d="M20 21 Q34 17 45 23 M20 30 Q34 26 45 32 M60 23 Q75 17 86 21 M60 32 Q75 26 86 30" stroke="#9ab3c1" strokeWidth="2" />
    <path d="M52 15V56" stroke={C.blue} strokeWidth="3" />
  </svg>;
}

function Pen({ frame }) {
  const enter = clamp(frame, 22, 38);
  const draw = clamp(frame, 38, 70);
  return <>
    <svg className="pen-mark" viewBox="0 0 260 116" aria-hidden="true">
      <path d="M16 72 C56 20 84 94 128 48 S202 40 245 64" fill="none" stroke={C.green} strokeWidth="4" strokeLinecap="round" pathLength="1" strokeDasharray={`${draw} 1`} />
      <circle cx="245" cy="64" r="5" fill={C.green} opacity={draw} />
    </svg>
    <svg className="pen-object" viewBox="0 0 170 42" style={{
      opacity: enter,
      transform: `translate(${mix(frame, 22, 38, -58, 0)}px, ${mix(frame, 22, 38, -25, 0)}px) rotate(-36deg)`,
    }} aria-label="A pen drawing a line">
      <rect x="10" y="13" width="136" height="16" rx="8" fill={C.green} />
      <rect x="18" y="16" width="90" height="3" rx="2" fill="#d7e8d6" opacity=".8" />
      <path d="M145 13 L164 21 L145 29Z" fill={C.ochre} />
      <path d="M13 13 Q6 21 13 29" fill="none" stroke="#243548" strokeWidth="3" />
      <path d="M46 13V6 Q46 1 52 1 H105" fill="none" stroke="#243548" strokeWidth="3" strokeLinecap="round" />
    </svg>
  </>;
}

function Hammer({ frame }) {
  const enter = clamp(frame, 58, 75);
  const strike = clamp(frame, 80, 91);
  const settle = clamp(frame, 92, 106);
  const rotation = frame < 80 ? -26 : frame < 93 ? mix(frame, 80, 93, -26, 24) : mix(frame, 93, 106, 24, 0);
  return <>
    <div className="nail-board" style={{ opacity: clamp(frame, 69, 82) }}>
      <div className="wood-grain wood-grain--one" /><div className="wood-grain wood-grain--two" />
      <svg viewBox="0 0 72 82" className="nail-svg" aria-hidden="true">
        <path d={`M36 ${strike ? 13 + strike * 12 : 13}V69`} stroke="#6f8190" strokeWidth="6" strokeLinecap="round" />
        <path d={`M23 ${strike ? 12 + strike * 12 : 12}H49`} stroke={C.ink} strokeWidth="7" strokeLinecap="round" />
        <path d="M30 70H42" stroke={C.ochre} strokeWidth="4" strokeLinecap="round" opacity={settle} />
      </svg>
      <span>NAIL</span>
    </div>
    <svg className="hammer-object" viewBox="0 0 170 130" style={{
      opacity: enter,
      transform: `translate(${mix(frame, 58, 75, 34, 0)}px, ${mix(frame, 58, 75, -28, 0)}px) rotate(${rotation}deg)`,
    }} aria-label="A hammer adding a nail">
      <path d="M88 48 L132 96 Q138 103 131 111 Q124 118 117 110 L72 62Z" fill={C.ochre} />
      <path d="M42 22 Q51 12 63 21 L88 44 Q96 52 87 61 L79 69 Q70 77 62 69 L37 46 Q29 37 42 22Z" fill={C.blue} stroke="#243548" strokeWidth="4" />
      <path d="M41 28 L25 14 Q17 8 11 16 Q5 24 13 30 L29 44Z" fill="#243548" />
      <path d="M54 28 L78 50" stroke="#a9c2cb" strokeWidth="4" strokeLinecap="round" />
    </svg>
  </>;
}

function Intro({ frame }) {
  const title = clamp(frame, 7, 28);
  return <AbsoluteFill className="intro-scene">
    <div className="intro-copy" style={{ opacity: title, transform: `translateY(${(1 - title) * 14}px)` }}>
      <div className="intro-eyebrow">TOOLS THAT FIT THE WORK</div>
      <h1>เครื่องมือปรับตาม<br /><em>งานของคุณ</em></h1>
      <p>เริ่มจากความต้องการ แล้วค่อยต่อเติม</p>
    </div>
    <div className="writing-sheet" style={{ opacity: clamp(frame, 20, 38) }}>
      <div className="sheet-overline">IDEA / NOTE</div>
      <div className="sheet-rule" />
      <Pen frame={frame} />
    </div>
    <div className="nail-scene"><Hammer frame={frame} /></div>
    <div className="chair-scene">
      <Chair frame={frame} />
      <Cushion frame={frame} />
      <Book frame={frame} />
    </div>
    <div className="intro-footer" style={{ opacity: clamp(frame, 105, 123) }}>
      A coffee seller · one changing workday
    </div>
  </AbsoluteFill>;
}

const chapterFor = (frame) => {
  if (frame < 420) return ['เริ่มจากสิ่งที่ต้องใช้', 'START WITH TODAY’S NEED'];
  if (frame < 840) return ['ช่วงลูกค้าเยอะ อยากจดให้น้อยลง', 'A QUICKER WAY TO COUNT SALES'];
  if (frame < 1140) return ['อยากรู้ว่าอะไรขายดี', 'ASK FOR THE VIEW YOU NEED'];
  if (frame < 1380) return ['ลองส่วนลดแบบเห็นยอดสุทธิ', 'ADD A 10% DISCOUNT RULE'];
  if (frame < 1650) return ['เปลี่ยนกฎนี้ แล้วเลือกนำไปใช้', 'REVIEW A CHANGE TO THIS RULE'];
  return ['โต๊ะเดียว ปรับไปตามงาน', 'ONE CANVAS · SHAPED BY THE SELLER'];
};

function Chapter({ frame }) {
  const [thai, english] = chapterFor(frame);
  return <div className="chapter-caption">
    <span>{thai}</span>
    <small>{english}</small>
  </div>;
}

function Pointer({ className = '', style = {} }) {
  return <svg className={`pointer ${className}`} style={style} width="26" height="32" viewBox="0 0 26 32" aria-hidden="true">
    <path d="M3 2 22 17l-7 1 4 8-4 2-4-9-6 5Z" fill={C.ink} stroke={C.white} strokeWidth="2" strokeLinejoin="round" />
  </svg>;
}

function SalesTable({ frame, visible, coffeeQty, coffeeTotal, gross, reveal }) {
  if (!visible) return null;
  const coffeeFlash = frame >= QUICK_CLICK && frame < QUICK_CLICK + 28 ? 1 - clamp(frame, QUICK_CLICK + 12, QUICK_CLICK + 28) : 0;
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
    <div className="chart-foot">Same source rows · gross ฿250</div>
  </div>;
}

function DiscountCard({ visible, reveal, rate, gross, net, selected }) {
  if (!visible) return null;
  return <div className={`discount-card paper-card${selected ? ' discount-card--selected' : ''}`} style={{ opacity: reveal, transform: `translateY(${(1 - reveal) * 14}px)` }}>
    <div className="discount-head">
      <span><i className="kind-dot kind-dot--clay" />กฎส่วนลด</span>
      <div className="discount-head-meta"><span className="saved-chip saved-chip--applied">ใช้แล้ว</span>{selected && <span className="selection-chip">เลือกอยู่</span>}</div>
    </div>
    <div className="discount-content">
      <div className="discount-rate"><strong>{rate}%</strong><small>ปัจจุบัน</small></div>
      <div className="discount-math"><span>ก่อนลด {money(gross)}</span><i>→</i><b>สุทธิ {money(net)}</b></div>
    </div>
    <div className="discount-foot">ยอดรวม {money(gross)} · คิดจากรายการเดิม</div>
  </div>;
}

function CanvasBoard({ frame }) {
  const [coffeeQty, gross, coffeeTotal] = (() => {
    const qty = frame >= QUICK_CLICK + 8 ? 4 : 3;
    const coffee = qty * 25;
    return [qty, coffee + 3 * 50, coffee];
  })();
  const tableVisible = frame >= REQUESTS[0].result;
  const quickVisible = frame >= REQUESTS[1].result;
  const chartVisible = frame >= REQUESTS[2].result;
  const discount10Visible = frame >= REQUESTS[3].result;
  const discount20Visible = frame >= REQUESTS[4].result;
  const discountSelected = frame >= REQUESTS[4].typeStart - 12;
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
          <b>Start with the work in front of you.</b>
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
    : Math.max(0, Math.min(request.letters.length, Math.floor((frame - request.typeStart) / 2) + 1));
  const typed = sent ? '' : request.letters.slice(0, visibleLetters).join('');
  const reviewPointer = frame >= request.reviewed - 10 && frame < request.reviewed;
  const applyPointerStart = request.reviewed + 6;
  const applyPointer = frame >= applyPointerStart && frame < request.apply;
  const sendPointer = frame >= request.send - 10 && frame < request.send + 4;
  const status = !sent ? 'กำลังพิมพ์' : drafting ? 'กำลังเตรียมร่าง' : applying ? 'กำลังใช้' : applied ? 'ใช้บนโต๊ะนี้แล้ว' : reviewed ? 'คุณตรวจแล้ว' : 'พร้อมให้ตรวจ';
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
      <div className="bubble-author">คนขาย</div>
      <div className="bubble-text">{request.message}</div>
    </div>}
    {sent && <div className={`assistant-card${applied ? ' assistant-card--done' : ''}`}>
      <div className="assistant-status"><i className={applied ? 'status-dot status-dot--done' : 'status-dot'} />TABLETOP <span>{status}</span></div>
      {drafting
        ? <div className="drafting-copy"><b>กำลังร่างการปรับโต๊ะนี้</b><div className="draft-progress"><i style={{ width: `${clamp(frame, request.send, request.draftEnd) * 100}%` }} /></div></div>
        : applied
          ? <div className="applied-copy"><strong>✓ {request.title}</strong><span>เพิ่มหลังจากคุณตรวจแล้ว</span></div>
          : <>
            <div className="proposal-copy"><b>{request.title}</b><span>{request.detail}</span></div>
            {request.id === 'discount20' && <div className="proposal-preview"><span>ใช้ 10% · ฿225</span><i>→</i><b>เสนอ 20% · ฿200</b></div>}
            <div className="proposal-actions">
              <div className={`review-action${reviewed ? ' review-action--done' : reviewPointer ? ' review-action--focus' : ''}`}><i>{reviewed ? '✓' : '1'}</i>{reviewed ? 'ตรวจแล้ว' : 'ตรวจ'}</div>
              <div className={`apply-action${frame >= request.applyStart && frame < request.apply ? ' apply-action--focus' : ''}`}>{applying ? 'กำลังใช้…' : 'ใช้'}</div>
              {reviewPointer && <Pointer className="review-pointer" style={{ left: 28, opacity: 1 }} />}
              {applyPointer && <Pointer className="apply-pointer" style={{
                left: mix(frame, applyPointerStart, request.apply, 155, 302),
                opacity: 1,
              }} />}
            </div>
          </>}
    </div>}
    <div className={`composer${sent ? ' composer--sent' : ' composer--composing'}`} style={composerStyle}>
      <div className="composer-label" style={composerLabelStyle}><span>คำขอของคุณ</span><small>กดส่งเมื่อพร้อม</small></div>
      <div className="composer-row" style={{ height: composerInputStyle.height }}>
        <div className="composer-input" style={composerInputStyle}>
          {typed.length ? <span className="typed-text" style={{ fontSize: composerFontSize }}>{typed}<i className="typing-caret" /></span> : (!sent || composerSettle === 1) && <span className="placeholder-text" style={{ fontSize: composerFontSize }}>บอกสิ่งที่อยากให้โต๊ะนี้ช่วย…</span>}
        </div>
        <div className={`send-button${frame >= request.typeStart + request.letters.length * 2 ? ' send-button--ready' : ''}${sendPointer ? ' send-button--focus' : ''}`} style={{ fontSize: mix(composerSettle, 0, 1, 16, 11) }}>ส่ง <span>↗</span></div>
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
      <div><b>ร้านกาแฟตัวอย่าง</b><small>โต๊ะเดียว · ปรับตามคนขาย</small></div>
      <span className="conversation-live"><i />ร่างสด</span>
    </div>
    <div className="accepted-label">สิ่งที่เพิ่มแล้ว</div>
    <div className="accepted-trail">
      {accepted.length === 0
        ? <span className="accepted-empty">ยังไม่มี</span>
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
  const reveal = clamp(frame, 1740, 1752);
  return <AbsoluteFill className="end-scene" style={{ opacity: reveal }}>
    <div className="end-band" />
    <div className="end-orbit end-orbit--one" /><div className="end-orbit end-orbit--two" />
    <div className="end-lockup" style={{ transform: `translateY(${(1 - reveal) * 14}px)` }}>
      <Mark frame={frame} size={90} staticMark />
      <div className="end-wordmark">tabletop<span>.</span></div>
      <div className="end-url">tabletop.ptchrr.workers.dev</div>
      <div className="end-tagline">เครื่องมือที่ค่อย ๆ ปรับให้เข้ากับคุณ</div>
    </div>
    <div className="end-draft">CONCEPT FILM · DRAFT 03</div>
  </AbsoluteFill>;
}

export function NarrativeAnimatic() {
  const frame = useCurrentFrame();
  const introOpacity = frame < 138 ? 1 : 1 - clamp(frame, 138, 150);
  const workspaceOpacity = frame < 150 ? clamp(frame, 138, 150) : frame < 1740 ? 1 : 1 - clamp(frame, 1740, 1752);
  return <AbsoluteFill className="film-frame">
    {frame < 151 && <AbsoluteFill style={{ opacity: introOpacity }}><Intro frame={frame} /></AbsoluteFill>}
    {frame >= 138 && frame < 1752 && <AbsoluteFill style={{ opacity: workspaceOpacity }}><Workspace frame={frame} /></AbsoluteFill>}
    {frame >= 1740 && <EndLockup frame={frame} />}
    <Chrome frame={frame} />
  </AbsoluteFill>;
}
