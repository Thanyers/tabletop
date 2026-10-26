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
  secondRequest: { start: 68, send: 96, clear: 142 },
  thirdRequest: { start: 146, send: 174, clear: 198 },
  firstCard: { start: 48, settled: 64 },
  secondCard: { start: 100, settled: 116 },
  thirdCard: { start: 178, settled: 194 },
  actionClick: { start: 120, end: 122 },
  actionResult: { start: 124, end: 134 },
  reset: { start: 206, end: 215 },
};

const REQUESTS = {
  sales: [
    { ...TIMING.firstRequest, text: { en: 'Help me track café sales.', th: 'ช่วยจดยอดขายร้านกาแฟ' } },
    { ...TIMING.secondRequest, text: { en: 'Add a quick-sale button.', th: 'เพิ่มปุ่มขายกาแฟด่วน' } },
    { ...TIMING.thirdRequest, text: { en: 'Compare sales by item.', th: 'เทียบยอดขายแต่ละรายการ' } },
  ],
  play: [
    { ...TIMING.firstRequest, text: { en: "Help us run tonight's adventure.", th: 'ช่วยจัดเกมผจญภัยคืนนี้' } },
    { ...TIMING.secondRequest, text: { en: 'Add a roll button.', th: 'เพิ่มปุ่มทอยเต๋า' } },
    { ...TIMING.thirdRequest, text: { en: 'Track health in the fight.', th: 'ติดตามพลังชีวิตในการต่อสู้' } },
  ],
};

const COPY = {
  sales: {
    en: {
      firstTitle: "Today's sales", item: 'Item', quantity: 'Qty', total: 'Total', coffee: 'Coffee', cake: 'Cake',
      quickTitle: 'Quick sale', coffeePrice: 'Coffee · ฿25', coffeeAdd: 'Coffee +1', added: 'Added',
      chartTitle: 'Sales by item', chartTotal: 'Total sales',
    },
    th: {
      firstTitle: 'ยอดขายวันนี้', item: 'รายการ', quantity: 'จำนวน', total: 'รวม', coffee: 'กาแฟ', cake: 'เค้ก',
      quickTitle: 'ขายด่วน', coffeePrice: 'กาแฟ · ฿25', coffeeAdd: 'กาแฟ +1', added: 'เพิ่มแล้ว',
      chartTitle: 'ยอดขายตามรายการ', chartTotal: 'ยอดขายรวม',
    },
  },
  play: {
    en: {
      firstTitle: 'Turn order', character: 'Character', initiative: 'Initiative', mira: 'Mira', theo: 'Theo', goblin: 'Goblin',
      rollTitle: 'Roll initiative', rollTarget: 'Mira · d20', roll: 'Roll d20', result: 'ROLL RESULT',
      healthTitle: 'Goblin · health', hitLabel: 'Recent hit',
    },
    th: {
      firstTitle: 'ลำดับเทิร์น', character: 'ตัวละคร', initiative: 'ลำดับ', mira: 'มีรา', theo: 'ธีโอ', goblin: 'ก็อบลิน',
      rollTitle: 'ทอยเต๋า', rollTarget: 'มีรา · d20', roll: 'ทอย d20', result: 'ผลทอย',
      healthTitle: 'ก็อบลิน · พลังชีวิต', hitLabel: 'ความเสียหายล่าสุด',
    },
  },
};

const ease = (frame, start, end, from = 0, to = 1) => interpolate(frame, [start, end], [from, to], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.inOut(Easing.cubic),
});

function Card({ frame, timing, children, style = {} }) {
  if (frame < timing.start) return null;
  const progress = ease(frame, timing.start, timing.settled);
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
    <div style={{ opacity: ease(frame, timing.start + 4, timing.settled) }}>{children}</div>
  </div>;
}

function CardHeader({ children, accent = COLOR.moss }) {
  return <div style={{
    height: 48,
    display: 'flex',
    alignItems: 'center',
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
  return <div style={{ position: 'absolute', left: x, top: y, zIndex: 8, pointerEvents: 'none' }}>
    {click && <span style={{
      position: 'absolute', top: -8, left: -8, width: 26, height: 26,
      border: `2px solid ${COLOR.amber}`, borderRadius: 20, background: '#f5e9d266',
    }} />}
    <svg width="23" height="28" viewBox="0 0 23 28" style={{ filter: 'drop-shadow(0 2px 2px #24354840)' }}>
      <path d="M2 1.8 20.5 15l-7.1 1-3.2 7.7-3.8-1.6 3.2-7.6z" fill={COLOR.ink} stroke="#fff" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  </div>;
}

function TableRow({ values, header = false, emphasis = false, accent = COLOR.moss }) {
  return <div style={{
    display: 'grid',
    gridTemplateColumns: '1fr 54px 72px',
    alignItems: 'center',
    gap: 6,
    minHeight: header ? 24 : 54,
    borderBottom: header ? `1px solid ${COLOR.line}` : `1px solid #eeeae0`,
    color: header ? COLOR.muted : COLOR.ink,
    fontSize: header ? 10 : 13,
    fontWeight: header ? 700 : emphasis ? 700 : 600,
  }}>
    {values.map((value, index) => <div key={`${value}-${index}`} style={{
      textAlign: index === 0 ? 'left' : index === 1 ? 'center' : 'right',
      color: !header && index === 2 ? accent : undefined,
      fontVariantNumeric: 'tabular-nums',
    }}>{value}</div>)}
  </div>;
}

function SalesTable({ frame, locale, text }) {
  const change = ease(frame, TIMING.actionResult.start, TIMING.actionResult.end);
  const coffeeQuantity = Math.round(3 + change);
  const coffeeTotal = 75 + (coffeeQuantity - 3) * 25;
  const gross = coffeeTotal + 150;
  return <Card frame={frame} timing={TIMING.firstCard} style={{ left: 40 }}>
    <CardHeader>{text.firstTitle}</CardHeader>
    <div style={{ padding: '14px 16px 0' }}>
      <TableRow header values={[text.item, text.quantity, text.total]} />
      <TableRow values={[<>{text.coffee}<small style={{ display: 'block', marginTop: 3, color: COLOR.muted, fontSize: 10 }}>{locale === 'th' ? '฿25 / แก้ว' : '฿25 each'}</small></>, String(coffeeQuantity), `฿${coffeeTotal}`]} />
      <TableRow values={[<>{text.cake}<small style={{ display: 'block', marginTop: 3, color: COLOR.muted, fontSize: 10 }}>{locale === 'th' ? '฿50 / ชิ้น' : '฿50 each'}</small></>, '3', '฿150']} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', paddingTop: 18 }}>
        <span style={{ color: COLOR.muted, fontSize: 13, fontWeight: 600 }}>{text.total}</span>
        <span style={{ color: COLOR.ink, fontSize: 25, lineHeight: 1.1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>฿{gross}</span>
      </div>
      {frame >= TIMING.actionClick.end && <div style={{ marginTop: 12, color: COLOR.moss, fontSize: 11, fontWeight: 600, opacity: change }}>
        {locale === 'th' ? 'กาแฟ 1 แก้ว · ฿25' : '1 coffee added · ฿25'}
      </div>}
    </div>
  </Card>;
}

function QuickSale({ frame, locale, text }) {
  const clicked = frame >= TIMING.actionClick.start && frame <= TIMING.actionClick.end;
  const used = frame > TIMING.actionClick.end;
  return <>
    <Card frame={frame} timing={TIMING.secondCard} style={{ left: 340 }}>
    <CardHeader>{text.quickTitle}</CardHeader>
    <div style={{ padding: '22px 18px 0' }}>
      <div style={{ color: COLOR.muted, fontSize: 12, fontWeight: 600 }}>{text.coffeePrice}</div>
      <div style={{ marginTop: 16, height: 78, display: 'grid', placeItems: 'center', borderRadius: 13, background: clicked || used ? COLOR.mossSoft : '#edf3ee', border: `1px solid ${clicked || used ? '#c7d8c9' : '#dce7de'}`, color: COLOR.moss, transform: clicked ? 'scale(.985)' : 'scale(1)', transition: 'none' }}>
        <span style={{ fontSize: 20, fontWeight: 700 }}>{text.coffeeAdd}</span>
      </div>
      <div style={{ marginTop: 15, textAlign: 'center', color: used ? COLOR.moss : COLOR.muted, fontSize: 13, fontWeight: 600 }}>
        {used ? `✓ ${text.added}` : locale === 'th' ? 'แตะเพื่อบันทึกการขาย' : 'Tap to record a sale'}
      </div>
      <div style={{ marginTop: 19, height: 1, background: COLOR.line }} />
      <div style={{ marginTop: 13, textAlign: 'center', color: COLOR.ink, fontSize: 12, fontWeight: 600 }}>+฿25</div>
    </div>
    </Card>
    {frame >= TIMING.actionClick.start - 3 && frame <= TIMING.actionClick.end + 3 && <Cursor x={474} y={213} click={clicked} />}
  </>;
}

function SalesChart({ frame, text }) {
  const progress = ease(frame, TIMING.thirdCard.start + 5, TIMING.thirdCard.settled + 5);
  const rows = [
    { label: text.coffee, value: 100, color: COLOR.moss },
    { label: text.cake, value: 150, color: COLOR.blue },
  ];
  return <Card frame={frame} timing={TIMING.thirdCard} style={{ left: 640 }}>
    <CardHeader accent={COLOR.blue}>{text.chartTitle}</CardHeader>
    <div style={{ padding: '20px 18px 0' }}>
      <div style={{ color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>{text.chartTotal}</div>
      <div style={{ marginTop: 3, color: COLOR.ink, fontSize: 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>฿250</div>
      <div style={{ marginTop: 18, display: 'grid', gap: 21 }}>
        {rows.map((row) => <div key={row.label}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 7, color: COLOR.ink, fontSize: 13, fontWeight: 600 }}>
            <span>{row.label}</span><span style={{ fontVariantNumeric: 'tabular-nums' }}>฿{row.value}</span>
          </div>
          <div style={{ height: 10, borderRadius: 8, background: '#e9ede9', overflow: 'hidden' }}>
            <div style={{ width: `${(row.value / 150) * 100 * progress}%`, height: '100%', borderRadius: 8, background: row.color }} />
          </div>
        </div>)}
      </div>
    </div>
  </Card>;
}

function InitiativeTable({ frame, locale, text }) {
  const rollResolved = frame >= TIMING.actionResult.end;
  const players = [
    [text.mira, rollResolved ? '17' : '16'],
    [text.theo, '12'],
    [text.goblin, '9'],
  ];
  return <Card frame={frame} timing={TIMING.firstCard} style={{ left: 40 }}>
    <CardHeader>{text.firstTitle}</CardHeader>
    <div style={{ padding: '17px 16px 0' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 86px', alignItems: 'center', minHeight: 27, borderBottom: `1px solid ${COLOR.line}`, color: COLOR.muted, fontSize: 10, fontWeight: 700 }}>
        <span>{text.character}</span><span style={{ textAlign: 'right' }}>{text.initiative}</span>
      </div>
      {players.map(([name, score], index) => <div key={name} style={{ display: 'grid', gridTemplateColumns: '1fr 86px', alignItems: 'center', minHeight: 57, borderBottom: index === players.length - 1 ? 0 : '1px solid #eeeae0' }}>
        <span style={{ color: COLOR.ink, fontSize: 14, fontWeight: 600 }}>{name}</span>
        <span style={{ justifySelf: 'end', minWidth: 36, padding: '5px 10px', textAlign: 'center', borderRadius: 9, background: index === 0 ? COLOR.mossSoft : '#f0eee7', color: index === 0 ? COLOR.moss : COLOR.ink, fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{score}</span>
      </div>)}
      <div style={{ marginTop: 14, paddingTop: 12, borderTop: `1px solid ${COLOR.line}`, color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>
        {locale === 'th' ? 'รอบที่ 1' : 'Round 1'}
      </div>
    </div>
  </Card>;
}

function RollCard({ frame, locale, text }) {
  const clicked = frame >= TIMING.actionClick.start && frame <= TIMING.actionClick.end;
  const result = frame < TIMING.actionResult.start ? null : Math.round(17 * ease(frame, TIMING.actionResult.start, TIMING.actionResult.end));
  const complete = frame >= TIMING.actionResult.end;
  return <>
    <Card frame={frame} timing={TIMING.secondCard} style={{ left: 340 }}>
    <CardHeader>{text.rollTitle}</CardHeader>
    <div style={{ padding: '20px 18px 0' }}>
      <div style={{ color: COLOR.muted, fontSize: 12, fontWeight: 700 }}>{text.rollTarget}</div>
      <div style={{ height: 102, display: 'grid', placeItems: 'center' }}>
        <div style={{ width: 72, height: 72, display: 'grid', placeItems: 'center', borderRadius: 21, transform: `rotate(${result === null ? -8 : 0}deg)`, background: complete ? COLOR.mossSoft : '#f2eee3', color: complete ? COLOR.moss : COLOR.amber, fontSize: complete ? 32 : 24, fontWeight: 700, fontVariantNumeric: 'tabular-nums', boxShadow: '0 3px 10px #2435480c' }}>
          {result === null ? 'd20' : result}
        </div>
      </div>
      <div style={{ display: 'grid', placeItems: 'center', minHeight: 46, borderRadius: 12, background: clicked || complete ? COLOR.mossSoft : COLOR.moss, color: clicked || complete ? COLOR.moss : '#fff', fontSize: 15, fontWeight: 700 }}>
        {complete ? `✓ ${locale === 'th' ? 'ได้' : 'Rolled'}` : text.roll}
      </div>
      <div style={{ marginTop: 12, textAlign: 'center', color: COLOR.muted, fontSize: 11, fontWeight: 700, letterSpacing: '.08em' }}>
        {complete ? text.result : 'D20'}
      </div>
    </div>
    </Card>
    {frame >= TIMING.actionClick.start - 3 && frame <= TIMING.actionClick.end + 3 && <Cursor x={474} y={275} click={clicked} />}
  </>;
}

function HealthCard({ frame, locale, text }) {
  const progress = ease(frame, TIMING.thirdCard.start + 3, TIMING.thirdCard.settled);
  const hp = Math.round(18 - 7 * progress);
  return <Card frame={frame} timing={TIMING.thirdCard} style={{ left: 640 }}>
    <CardHeader accent={COLOR.blue}>{text.healthTitle}</CardHeader>
    <div style={{ padding: '21px 18px 0' }}>
      <div style={{ color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>{text.hitLabel}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 9, marginTop: 7 }}>
        <span style={{ color: '#909992', fontSize: 18, textDecoration: 'line-through', fontVariantNumeric: 'tabular-nums' }}>18</span>
        <span style={{ color: COLOR.muted, fontSize: 16 }}>→</span>
        <span style={{ color: COLOR.ink, fontSize: 38, lineHeight: 1.1, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{hp}</span>
        <span style={{ color: COLOR.moss, fontSize: 15, fontWeight: 700 }}>HP</span>
      </div>
      <div style={{ marginTop: 22, height: 12, borderRadius: 9, background: '#e7ece8', overflow: 'hidden' }}>
        <div style={{ width: `${hp / 18 * 100}%`, height: '100%', borderRadius: 9, background: hp <= 12 ? COLOR.amber : COLOR.moss }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>
        <span>{locale === 'th' ? 'พลังชีวิต' : 'Health'}</span><span>{hp} / 18</span>
      </div>
      <div style={{ marginTop: 24, paddingTop: 13, borderTop: `1px solid ${COLOR.line}`, color: COLOR.muted, fontSize: 11, fontWeight: 600 }}>
        {locale === 'th' ? `ก็อบลิน · ลดลง ${18 - hp} HP` : `Goblin · ${18 - hp} HP lost`}
      </div>
    </div>
  </Card>;
}

function activeRequest(frame, locale, requests) {
  const request = [...requests].reverse().find((item) => frame >= item.start && frame < item.clear);
  if (!request) return null;
  const source = request.text[locale] ?? request.text.en;
  const characters = Array.from(new Intl.Segmenter(locale, { granularity: 'grapheme' }).segment(source), (segment) => segment.segment);
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

function Composer({ frame, locale, requests }) {
  const request = activeRequest(frame, locale, requests);
  const text = request?.visibleText ?? '';
  const sent = request && frame >= request.send && frame <= request.send + 9;
  const ready = request?.complete && frame < request.send;
  const placeholder = text.length === 0;
  return <>
    <div style={{ position: 'absolute', left: 38, top: 458, width: 884, height: 56, display: 'flex', alignItems: 'center', padding: '0 10px 0 18px', border: `1px solid ${COLOR.line}`, borderRadius: 15, background: '#fff', boxShadow: '0 4px 14px #24354808' }}>
      <div style={{ flex: 1, overflow: 'hidden', color: placeholder ? '#8a9792' : COLOR.ink, fontSize: placeholder ? 15 : 26, fontWeight: placeholder ? 400 : 600, whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
        {placeholder ? (locale === 'th' ? 'บอกสิ่งที่อยากลอง…' : 'Ask for a change…') : text}<span style={{ display: placeholder || sent ? 'none' : 'inline-block', width: 2, height: 25, marginLeft: 3, verticalAlign: 'middle', background: COLOR.moss }} />
      </div>
      <div style={{ width: 36, height: 36, display: 'grid', placeItems: 'center', borderRadius: 11, background: sent ? COLOR.mossSoft : ready ? COLOR.moss : '#eef2ef', color: sent ? COLOR.moss : ready ? '#fff' : '#98a49e', fontSize: 20, fontWeight: 600, lineHeight: 1 }}>
        {sent ? '✓' : '↑'}
      </div>
    </div>
    {request && <SendPointer frame={frame} send={request.send} />}
  </>;
}

export function HeroVariant({ locale = 'en', caseName = 'sales' }) {
  const frame = useCurrentFrame();
  const text = (COPY[caseName] ?? COPY.sales)[locale] ?? COPY[caseName].en;
  const requests = REQUESTS[caseName] ?? REQUESTS.sales;
  return <AbsoluteFill style={{
    overflow: 'hidden',
    color: COLOR.ink,
    fontFamily: locale === 'th' ? 'Manrope, Noto Sans Thai, system-ui, sans-serif' : 'Manrope, system-ui, sans-serif',
    backgroundColor: COLOR.paper,
    backgroundImage: 'radial-gradient(#9fb0a72b 0.8px, transparent 0.8px)',
    backgroundSize: '24px 24px',
  }}>
    <div style={{ position: 'absolute', inset: 0, opacity: 0.7, pointerEvents: 'none', background: 'radial-gradient(ellipse at 52% 34%, #eaf2ed66, transparent 59%)' }} />
    {caseName === 'play' ? <>
      <InitiativeTable frame={frame} locale={locale} text={text} />
      <RollCard frame={frame} locale={locale} text={text} />
      <HealthCard frame={frame} locale={locale} text={text} />
    </> : <>
      <SalesTable frame={frame} locale={locale} text={text} />
      <QuickSale frame={frame} locale={locale} text={text} />
      <SalesChart frame={frame} text={text} />
    </>}
    <Composer frame={frame} locale={locale} requests={requests} />
  </AbsoluteFill>;
}
