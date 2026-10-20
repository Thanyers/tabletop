import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-600.css';

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

const ease = (frame, start, end, from, to) => interpolate(frame, [start, end], [from, to], {
  extrapolateLeft: 'clamp',
  extrapolateRight: 'clamp',
  easing: Easing.inOut(Easing.quad),
});

const panel = {
  background: C.white,
  border: `1px solid ${C.edge}`,
  borderRadius: 18,
  boxShadow: '0 3px 0 #d8d4c480, 0 8px 20px #303d3a0d',
};

function Badge({ children, color = C.green, background = C.greenSoft, style = {} }) {
  return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, height: 22, padding: '0 9px', borderRadius: 8, color, background, fontSize: 10, lineHeight: '22px', fontWeight: 700, letterSpacing: 0.15, whiteSpace: 'nowrap', ...style }}>{children}</span>;
}

function StepStrip({ frame, activeStep }) {
  const steps = [
    'นำไฟล์ของคุณเข้ามา',
    'AI ร่างกฎ คุณตรวจและเปิดใช้',
    'เลือกงาน แล้วลงมือเล่นเอง',
    'ชวนคนเข้ามา กลับมาต่อได้',
  ];
  return <div style={{ position: 'absolute', left: 44, top: 111, width: 872, height: 50, display: 'flex', gap: 8 }}>
    {steps.map((label, index) => {
      const selected = index === activeStep;
      return <div key={label} style={{ ...panel, width: 212, height: 50, borderRadius: 12, padding: '0 10px', display: 'flex', alignItems: 'center', gap: 8, borderColor: selected ? C.green : C.edge, background: selected ? C.greenSoft : C.white, boxShadow: selected ? '0 2px 0 #356e5d24' : 'none' }}>
        <span style={{ width: 23, height: 23, borderRadius: 8, display: 'grid', placeItems: 'center', flex: '0 0 auto', color: selected ? C.white : C.muted, background: selected ? C.green : C.canvas, fontSize: 12, fontWeight: 700 }}>{index + 1}</span>
        <span style={{ fontSize: 11.5, lineHeight: 1.35, color: selected ? C.ink : C.muted, fontWeight: selected ? 700 : 600 }}>{label}</span>
      </div>;
    })}
  </div>;
}

function FileCard({ frame, emphasized }) {
  const bob = emphasized ? ease(frame, 12, 22, 3, 0) : 0;
  return <div style={{ ...panel, position: 'absolute', left: 44, top: 180, width: 198, height: 274, padding: 15, borderColor: emphasized ? C.blue : C.edge, boxShadow: emphasized ? '0 4px 0 #3e6c8628, 0 12px 24px #303d3a12' : panel.boxShadow, transform: `translateY(${bob}px)` }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, letterSpacing: 0.7, color: C.muted, fontWeight: 700 }}>ไฟล์ต้นทาง</span>
      <Badge color={C.blue} background={C.blueSoft}>MD</Badge>
    </div>
    <div style={{ marginTop: 16, display: 'flex', gap: 10, alignItems: 'center' }}>
      <div style={{ width: 38, height: 42, borderRadius: 10, display: 'grid', placeItems: 'center', background: C.blueSoft, color: C.blue, border: '1px solid #d6e2e8' }}>
        <svg width="22" height="24" viewBox="0 0 22 24" fill="none" aria-hidden="true"><path d="M4 2.5h9l5 5v14H4z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13 2.5v5h5M7 12h8M7 16h8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></svg>
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: C.ink, fontWeight: 700, lineHeight: 1.35, overflowWrap: 'anywhere' }}>helpdesk-policy.md</div>
        <div style={{ marginTop: 3, fontSize: 10, color: C.muted }}>แนวทางรับแจ้งปัญหา</div>
      </div>
    </div>
    <div style={{ marginTop: 17, height: 1, background: C.edge }} />
    <div style={{ marginTop: 14, fontSize: 10, letterSpacing: 0.45, color: C.blue, fontWeight: 700 }}>ข้อความสำคัญในไฟล์</div>
    <div style={{ marginTop: 9, padding: 10, borderRadius: 11, border: '1px solid #dce6ea', background: '#f6fafb', color: C.ink, fontSize: 11.5, lineHeight: 1.6 }}>
      “ผู้รับผิดชอบอัปเดตงาน<br />เจ้าของโต๊ะตรวจ ก่อนปิดเคส”
    </div>
    <div style={{ position: 'absolute', left: 15, bottom: 14, display: 'flex', alignItems: 'center', gap: 6, color: C.muted, fontSize: 10 }}>
      <span style={{ width: 6, height: 6, borderRadius: 9, background: C.blue }} />ข้อมูลตัวอย่าง · ตรวจได้
    </div>
  </div>;
}

function RulesCard({ frame, active }) {
  const reviewed = frame >= 66;
  const approved = frame >= 74;
  const status = approved ? 'เปิดใช้แล้ว' : reviewed ? 'ตรวจแล้ว' : 'รอเจ้าของตรวจ';
  const statusColor = approved ? C.green : reviewed ? C.ochre : C.clay;
  const statusBg = approved ? C.greenSoft : reviewed ? C.ochreSoft : C.claySoft;
  const borderColor = active ? C.ochre : C.edge;
  const buttonStyle = (done) => ({ width: '100%', height: 29, borderRadius: 9, border: `1px solid ${done ? '#b9d0c4' : C.edge}`, background: done ? C.greenSoft : C.paper, color: done ? C.green : C.ink, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 9px', fontSize: 10.5, fontWeight: 700 });
  return <div style={{ ...panel, position: 'absolute', left: 264, top: 180, width: 206, height: 274, padding: 15, borderColor, boxShadow: active ? '0 4px 0 #89632f22, 0 12px 24px #303d3a12' : panel.boxShadow }}>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <span style={{ fontSize: 10, letterSpacing: 0.7, color: C.muted, fontWeight: 700 }}>กติกาของโต๊ะ</span>
      <Badge color={statusColor} background={statusBg}>{status}</Badge>
    </div>
    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 7 }}>
      <span style={{ width: 27, height: 27, borderRadius: 9, display: 'grid', placeItems: 'center', background: C.ochreSoft, color: C.ochre }}>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m8 1.7 1.3 4 4 .3-3.1 2.5 1 4-3.2-2.2-3.2 2.2 1-4-3.1-2.5 4-.3z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/></svg>
      </span>
      <div style={{ fontSize: 13, color: C.ink, fontWeight: 700 }}>Helpdesk</div>
    </div>
    <div style={{ marginTop: 10, color: C.muted, fontSize: 10.5, lineHeight: 1.35 }}>AI ช่วยร่าง · คนตรวจและอนุมัติ</div>
    <div style={{ marginTop: 11, paddingTop: 10, borderTop: `1px solid ${C.edge}`, display: 'grid', gap: 9 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: C.ink, fontSize: 10.5, lineHeight: 1.4 }}><span style={{ color: C.ochre, fontWeight: 700 }}>01</span><span><b>ผู้รับผิดชอบ</b><br />อัปเดตสถานะงาน</span></div>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 7, color: C.ink, fontSize: 10.5, lineHeight: 1.4 }}><span style={{ color: C.ochre, fontWeight: 700 }}>02</span><span><b>เจ้าของโต๊ะ</b><br />อนุมัติก่อนปิดเคส</span></div>
    </div>
    <div style={{ position: 'absolute', left: 15, right: 15, bottom: 14, display: 'grid', gap: 5 }}>
      <div style={buttonStyle(reviewed)}><span>ตรวจร่าง</span><span>{reviewed ? '✓' : 'ตรวจ'}</span></div>
      <div style={buttonStyle(approved)}><span>อนุมัติและเปิดใช้</span><span>{approved ? '✓' : 'อนุมัติ'}</span></div>
    </div>
  </div>;
}

const laneNames = ['OPEN', 'IN PROGRESS', 'REVIEW', 'DONE'];
const laneKeys = ['open', 'in_progress', 'review', 'done'];

function Kanban({ frame, statusIndex, emphasized }) {
  const boardX = 492;
  const boardY = 174;
  const cardLeft = 15 + statusIndex * 102;
  const activeLane = Math.round(statusIndex);
  const done = activeLane === 3;
  return <div style={{ ...panel, position: 'absolute', left: boardX, top: boardY, width: 424, height: 284, padding: 12, borderColor: emphasized ? C.green : C.edge, boxShadow: emphasized ? '0 4px 0 #356e5d20, 0 12px 24px #303d3a12' : panel.boxShadow }}>
    <div style={{ height: 32, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
      <div>
        <div style={{ color: C.ink, fontSize: 12, fontWeight: 700 }}>Helpdesk · งานร่วมกัน</div>
        <div style={{ color: C.muted, fontSize: 9.5, marginTop: 1 }}>ทุกคนเห็นสถานะเดียวกัน</div>
      </div>
      <Badge color={C.green} background={C.greenSoft} style={{ height: 20, fontSize: 9 }}>● แชร์แล้ว</Badge>
    </div>
    <div style={{ position: 'absolute', left: 12, right: 12, top: 49, bottom: 12, display: 'flex', gap: 8 }}>
      {laneNames.map((name, index) => <div key={name} style={{ position: 'relative', width: 94, height: 220, flex: '0 0 94px', borderRadius: 11, border: `1px solid ${C.edge}`, background: index === activeLane ? '#f4f4e9' : '#fbfaf5', padding: '8px 6px' }}>
        <div style={{ height: 23, borderBottom: `1px solid ${C.edge}`, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 2 }}>
          <span style={{ color: index === activeLane ? C.green : C.muted, fontSize: index === 1 ? 7.2 : 8.1, letterSpacing: 0.15, lineHeight: 1.15, fontWeight: 700 }}>{name}</span>
          <span style={{ color: C.muted, fontSize: 8, fontWeight: 600 }}>{index === activeLane ? '1' : '0'}</span>
        </div>
        {index !== activeLane && <div style={{ position: 'absolute', left: 8, right: 8, bottom: 9, borderTop: `1px dashed ${C.edge}`, paddingTop: 6, color: '#98998d', fontSize: 7.5, letterSpacing: 0.15 }}>{laneKeys[index]}</div>}
      </div>)}
    </div>
    <div style={{ position: 'absolute', left: cardLeft, top: 98, width: 88, height: 78, padding: 7, borderRadius: 10, border: `1px solid ${done ? '#b9d0c4' : C.edge}`, background: C.white, boxShadow: '0 2px 0 #d8d4c460, 0 4px 10px #303d3a0c' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ color: C.blue, fontSize: 8.5, fontWeight: 700 }}>T-204</span>
        {done && <span style={{ color: C.green, fontSize: 9, fontWeight: 700 }}>✓</span>}
      </div>
      <div style={{ marginTop: 3, color: C.ink, fontSize: 9, lineHeight: 1.25, fontWeight: 600 }}>เครื่องพิมพ์<br />ชั้น 2</div>
      <div style={{ position: 'absolute', left: 6, right: 6, bottom: 5, height: 17, display: 'grid', placeItems: 'center', borderRadius: 6, background: done ? C.greenSoft : C.claySoft, color: done ? C.green : C.clay, fontSize: 7.2, fontWeight: 700 }}>{done ? 'ปิดงานแล้ว' : 'เปลี่ยนสถานะ'}</div>
    </div>
  </div>;
}

function MemberBar({ joined }) {
  return <div style={{ ...panel, position: 'absolute', left: 492, top: 467, width: 424, height: 38, borderRadius: 12, padding: '0 10px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 0 #d8d4c440' }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <Avatar label="ค" color={C.green} />
      {joined ? <Avatar label="น" color={C.blue} /> : <span style={{ width: 22, height: 22, borderRadius: 8, border: `1px dashed ${C.edge}`, display: 'grid', placeItems: 'center', color: C.muted, fontSize: 13 }}>+</span>}
      <span style={{ color: C.ink, fontSize: 10, fontWeight: 700 }}>{joined ? 'คุณ + Nok · 2 คน' : 'คุณ · ชวนคนร่วมโต๊ะ'}</span>
    </div>
    <span style={{ color: joined ? C.green : C.muted, fontSize: 9.5, fontWeight: 600 }}>{joined ? 'บันทึกไว้ · กลับมาต่อได้' : 'โต๊ะที่แชร์ร่วมกัน'}</span>
  </div>;
}

function Avatar({ label, color }) {
  return <span style={{ width: 22, height: 22, borderRadius: 8, display: 'grid', placeItems: 'center', color: C.white, background: color, fontSize: 10, fontWeight: 700 }}>{label}</span>;
}

function Cursor({ visible, x, y, click }) {
  if (!visible) return null;
  return <div style={{ position: 'absolute', left: x, top: y, width: 27, height: 31, zIndex: 5, pointerEvents: 'none' }}>
    {click > 0.08 && <span style={{ position: 'absolute', left: -7, top: -7, width: 26, height: 26, borderRadius: 20, border: `2px solid ${C.clay}`, opacity: click * 0.7, transform: `scale(${0.7 + click * 0.4})` }} />}
    <svg width="23" height="29" viewBox="0 0 23 29" fill="none" aria-hidden="true" style={{ filter: 'drop-shadow(0 2px 2px #303d3a40)' }}>
      <path d="M3 2.5 20 16l-7 .6 3.5 7.2-3.5 1.7-3.7-7.5-4.5 5z" fill={C.ink} stroke={C.white} strokeWidth="1.7" strokeLinejoin="round" />
    </svg>
  </div>;
}

export function TabletopStory() {
  const frame = useCurrentFrame();
  const activeStep = frame < 12 ? -1 : frame < 44 ? 0 : frame < 76 ? 1 : frame < 113 ? 2 : 3;
  const rulesActive = activeStep === 1;
  const boardActive = activeStep === 2;
  const joined = frame >= 113;
  const statusIndex = frame < 84 ? 0 : frame < 89 ? ease(frame, 84, 89, 0, 1) : frame < 94 ? 1 : frame < 99 ? ease(frame, 94, 99, 1, 2) : frame < 104 ? 2 : frame < 109 ? ease(frame, 104, 109, 2, 3) : 3;
  const statusPosition = Math.min(3, Math.max(0, statusIndex));
  const cursorX = 492 + 12 + 3 + statusPosition * 102 + 67;
  const cursorY = 174 + 98 + 51;
  const click = Math.max(...[83, 93, 103].map((at) => Math.max(0, 1 - Math.abs(frame - at) / 3)));
  const ruleCursorVisible = rulesActive && frame >= 58 && frame <= 75;
  const ruleCursorX = 264 + 148;
  const ruleCursorY = frame < 67 ? 392 : 426;
  const showCursor = boardActive || ruleCursorVisible;
  const actualCursorX = boardActive ? cursorX : ruleCursorX;
  const actualCursorY = boardActive ? cursorY : ruleCursorY;
  const actualClick = boardActive ? click : Math.max(0, 1 - Math.abs(frame - 66) / 2, 1 - Math.abs(frame - 74) / 2);

  return <AbsoluteFill style={{ background: C.paper, color: C.ink, fontFamily: 'Manrope, Noto Sans Thai, sans-serif', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', inset: 12, border: `1px solid ${C.edge}`, borderRadius: 22, pointerEvents: 'none' }} />
    <div style={{ position: 'absolute', left: 44, top: 26, display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ width: 16, height: 16, border: `4px solid ${C.green}`, borderRadius: 6, display: 'inline-block' }} />
      <span style={{ color: C.green, fontSize: 10, fontWeight: 700, letterSpacing: 1.1 }}>TABLETOP</span>
      <span style={{ color: C.muted, fontSize: 10 }}>·</span>
      <span style={{ color: C.muted, fontSize: 10 }}>โต๊ะทำงานที่ชวนคนมาคิดต่อได้</span>
    </div>
    <div style={{ position: 'absolute', right: 44, top: 24 }}><Badge color={C.ochre} background={C.ochreSoft} style={{ height: 23, fontSize: 9 }}>ตัวอย่าง Helpdesk สมมติ</Badge></div>
    <div style={{ position: 'absolute', left: 44, top: 48, fontSize: 25, lineHeight: 1.25, letterSpacing: -0.3, color: C.ink, fontWeight: 700 }}>จากไฟล์หนึ่งใบ สู่โต๊ะที่ทุกคนทำงานต่อได้</div>
    <div style={{ position: 'absolute', left: 45, top: 83, fontSize: 12, color: C.muted }}>คุณตั้งกติกา ตรวจการเปลี่ยนแปลง แล้วเลือกลงมือเอง</div>

    <StepStrip frame={frame} activeStep={activeStep} />
    <FileCard frame={frame} emphasized={activeStep === 0} />
    <div style={{ position: 'absolute', left: 243, top: 305, width: 20, color: C.blue, textAlign: 'center', fontSize: 21, fontWeight: 600 }}>→</div>
    <RulesCard frame={frame} active={rulesActive} />
    <div style={{ position: 'absolute', left: 470, top: 305, width: 22, color: C.ochre, textAlign: 'center', fontSize: 21, fontWeight: 600 }}>→</div>
    <Kanban frame={frame} statusIndex={statusPosition} emphasized={boardActive} />
    <MemberBar joined={joined} />
    <Cursor visible={showCursor} x={actualCursorX} y={actualCursorY} click={actualClick} />

    <div style={{ position: 'absolute', left: 44, bottom: 17, color: C.muted, fontSize: 9.5, letterSpacing: 0.1 }}>ภาพอธิบายแนวคิด · Remotion · ไม่ใช่ภาพบันทึกการใช้งานจริง</div>
    <div style={{ position: 'absolute', right: 44, bottom: 17, display: 'flex', alignItems: 'center', gap: 7, color: C.muted, fontSize: 9.5 }}>
      <span style={{ width: 6, height: 6, borderRadius: 8, background: C.green }} />ไฟล์ส่วนตัว · งานที่แชร์แล้ว
    </div>
  </AbsoluteFill>;
}
