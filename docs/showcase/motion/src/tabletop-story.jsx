import React from 'react';
import { AbsoluteFill, Easing, interpolate, useCurrentFrame } from 'remotion';
import '@fontsource/manrope/latin-400.css';
import '@fontsource/manrope/latin-600.css';
import '@fontsource/manrope/latin-700.css';
import '@fontsource/noto-sans-thai/thai-400.css';
import '@fontsource/noto-sans-thai/thai-600.css';

const C = {
  paper: '#faf8f0', white: '#fffdf7', edge: '#d9d4c4', ink: '#303d3a', muted: '#667268',
  green: '#356e5d', greenSoft: '#e8f0e4', blue: '#3e6c86', blueSoft: '#eaf0f3',
  ochre: '#89632f', ochreSoft: '#f7edda',
};
const ease = (f, start, end, from = 0, to = 1) => interpolate(f, [start, end], [from, to], {
  extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: Easing.inOut(Easing.cubic),
});
const panel = { background: C.white, border: `1px solid ${C.edge}`, borderRadius: 18, boxShadow: '0 3px 0 #d8d4c460, 0 8px 18px #303d3a0a' };

function Chip({ children, color = C.green, background = C.greenSoft }) {
  return <span style={{ padding: '3px 8px', borderRadius: 7, background, color, fontSize: 10, fontWeight: 700, whiteSpace: 'nowrap' }}>{children}</span>;
}

function Card({ f, at, x, y, width, height, title, tag, children, color = C.green }) {
  if (f < at) return null;
  const grow = ease(f, at, at + 16);
  const ink = ease(f, at + 5, at + 18);
  return <div style={{ ...panel, position: 'absolute', left: x, top: y, width, height, overflow: 'hidden', transformOrigin: '24px 22px', transform: `translateY(${(1 - grow) * 12}px) scale(${0.12 + grow * 0.88})`, opacity: grow, borderTop: `3px solid ${color}` }}>
    <div style={{ opacity: ink }}>
      <div style={{ height: 43, padding: '0 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, borderBottom: `1px solid ${C.edge}` }}>
        <span style={{ color: C.ink, fontSize: 13, fontWeight: 700 }}>{title}</span>
        {tag}
      </div>
      {children}
    </div>
  </div>;
}

function Cursor({ x, y, click = false, label }) {
  return <div style={{ position: 'absolute', left: x, top: y, zIndex: 9, pointerEvents: 'none' }}>
    {click && <div style={{ position: 'absolute', left: -11, top: -11, width: 30, height: 30, borderRadius: 30, border: `2px solid ${C.ochre}`, background: '#f7edda70' }} />}
    <svg width="24" height="30" viewBox="0 0 24 30" style={{ filter: 'drop-shadow(0 2px 2px #303d3a30)' }}><path d="M3 2 21 16l-7 .8 3.6 7.2-3.6 1.8-3.8-7.6L5 24z" fill={C.ink} stroke={C.white} strokeWidth="1.8" strokeLinejoin="round" /></svg>
    {label && <div style={{ position: 'absolute', top: 26, left: 17, padding: '4px 8px', background: C.ink, color: C.white, borderRadius: 7, whiteSpace: 'nowrap', fontSize: 10 }}>{label}</div>}
  </div>;
}

function FileCard({ f }) {
  if (f < 8) return null;
  const x = ease(f, 8, 24, 368, 34);
  const y = ease(f, 8, 24, 174, 114);
  return <>
    <div style={{ ...panel, position: 'absolute', left: x, top: y, width: 198, height: 150, padding: 14, opacity: ease(f, 8, 12), transform: `rotate(${ease(f, 8, 24, -6, 0)}deg)`, borderTop: `3px solid ${C.blue}`, boxShadow: f < 24 ? '0 14px 30px #303d3a25' : panel.boxShadow }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}><span style={{ fontSize: 12, fontWeight: 700 }}>ไฟล์บทเรียน</span><Chip color={C.blue} background={C.blueSoft}>MD</Chip></div>
      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <svg width="26" height="30" viewBox="0 0 26 30" fill="none"><path d="M4 2h12l6 6v20H4zM16 2v7h6M8 15h10M8 20h8" stroke={C.blue} strokeWidth="1.7" strokeLinejoin="round" /></svg>
        <div><div style={{ fontSize: 12, fontWeight: 700 }}>force-and-motion.md</div><div style={{ marginTop: 2, fontSize: 10, color: C.muted }}>แรง มวล และการเคลื่อนที่</div></div>
      </div>
      <div style={{ marginTop: 13, paddingTop: 9, borderTop: `1px solid ${C.edge}`, fontSize: 11, color: C.blue }}>“ลองผลักรถ แล้วดูว่าไปได้ไกลแค่ไหน”</div>
    </div>
    {f < 27 && <Cursor x={x + 128} y={y + 78} label="วางไฟล์ลงบนโต๊ะ" click={f >= 23} />}
  </>;
}

function RulesCard({ f }) {
  const approved = f >= 51;
  return <Card f={f} at={30} x={34} y={284} width={198} height={168} title="กฎของการทดลอง" color={C.ochre} tag={<Chip color={approved ? C.green : C.ochre} background={approved ? C.greenSoft : C.ochreSoft}>{approved ? '✓ เปิดใช้' : 'AI ร่าง'}</Chip>}>
    <div style={{ padding: '12px 14px', fontSize: 12 }}>
      <div style={{ color: C.ochre, fontSize: 19, fontWeight: 700 }}>F = ma</div>
      <div style={{ marginTop: 4, color: C.muted, fontSize: 11 }}>เริ่มจากหยุดนิ่ง · ไม่มีแรงเสียดทาน</div>
      <div style={{ marginTop: 11, height: 29, borderRadius: 9, display: 'grid', placeItems: 'center', color: approved ? C.green : C.white, background: approved ? C.greenSoft : C.green, fontWeight: 700, fontSize: 11 }}>{approved ? 'ตรวจแล้ว · พร้อมทดลอง' : 'ตรวจและเปิดใช้'}</div>
    </div>
  </Card>;
}

function Controls({ f, force, running }) {
  const rows = [ ['แรงผลัก', `${force} N`, (force - 5) / 20], ['มวลรถ', '5 kg', 0.4], ['เวลาที่ผลัก', '2 s', 0.6] ];
  return <Card f={f} at={58} x={252} y={114} width={256} height={338} title="ลองปรับด้วยมือ" tag={<Chip>ทดลอง</Chip>}>
    <div style={{ padding: '16px 18px' }}>
      {rows.map(([label, value, p]) => <div key={label} style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 11 }}><span style={{ fontSize: 12 }}>{label}</span><b style={{ fontSize: 17, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{value}</b></div>
        <div style={{ height: 5, borderRadius: 5, background: '#e4e5d9', position: 'relative' }}><div style={{ height: 5, width: `${p * 100}%`, borderRadius: 5, background: C.green }} /><span style={{ position: 'absolute', left: `calc(${p * 100}% - 7px)`, top: -5, width: 15, height: 15, borderRadius: 15, background: C.white, border: `2px solid ${C.green}`, boxShadow: '0 1px 3px #303d3a20' }} /></div>
      </div>)}
      <div style={{ height: 37, marginTop: 9, borderRadius: 10, display: 'flex', justifyContent: 'center', alignItems: 'center', gap: 8, background: running ? C.greenSoft : C.green, color: running ? C.green : C.white, fontSize: 13, fontWeight: 700 }}><span>{running ? '↻' : '▶'}</span>{running ? 'กำลังทดลอง' : 'ผลักรถ'}</div>
      <div style={{ marginTop: 11, textAlign: 'center', fontSize: 10, color: C.muted }}>เปลี่ยนค่า แล้วลองใหม่ได้</div>
    </div>
  </Card>;
}

function Scene({ f, distance, acceleration, progress }) {
  return <Card f={f} at={82} x={528} y={114} width={398} height={200} title="ฉากการทดลอง" tag={<Chip color={C.blue} background={C.blueSoft}>รถบนราง</Chip>} color={C.blue}>
    <div style={{ height: 155, position: 'relative', background: 'linear-gradient(#f2f7f3, #f9faf2)' }}>
      <div style={{ position: 'absolute', left: 16, top: 12, color: C.muted, fontSize: 11 }}>a = <b style={{ color: C.ink }}>{acceleration} m/s²</b></div>
      <div style={{ position: 'absolute', right: 16, top: 10, color: C.green, fontSize: 18, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{distance.toFixed(1)} <span style={{ fontSize: 11 }}>m</span></div>
      <svg width="396" height="130" viewBox="0 0 396 130" style={{ position: 'absolute', left: 0, bottom: 0 }}>
        <path d="M20 96H378" stroke="#b9c8b6" strokeWidth="2" />
        {[0, 2, 4, 6, 8].map((m) => <g key={m}><path d={`M${38 + m * 39} 96v6`} stroke="#b9c8b6" /><text x={38 + m * 39} y="118" fontSize="10" fill={C.muted} textAnchor="middle">{m} m</text></g>)}
        {progress > 0 && <path d={`M38 95H${38 + distance * 39}`} stroke={C.green} strokeWidth="3" strokeLinecap="round" opacity="0.4" />}
        <g transform={`translate(${20 + distance * 39}, 57)`}>
          <rect x="0" y="7" width="40" height="23" rx="7" fill={C.green} /><rect x="7" y="0" width="25" height="17" rx="5" fill="#b9d3c1" />
          <circle cx="9" cy="32" r="7" fill={C.ink} /><circle cx="32" cy="32" r="7" fill={C.ink} /><circle cx="9" cy="32" r="2.5" fill={C.white} /><circle cx="32" cy="32" r="2.5" fill={C.white} />
          {progress > 0 && progress < 1 && <path d="M-22 19h17m-6-5 6 5-6 5" stroke={C.ochre} strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />}
        </g>
      </svg>
    </div>
  </Card>;
}

function Graph({ f, first, second }) {
  const path = (factor) => Array.from({ length: 31 }, (_, i) => `${i ? 'L' : 'M'}${18 + i * 7.9} ${63 - factor * 48 * (i / 30) ** 2}`).join(' ');
  return <Card f={f} at={106} x={528} y={334} width={398} height={118} title="สิ่งที่เกิดขึ้น" tag={<Chip color={C.blue} background={C.blueSoft}>ระยะทาง / เวลา</Chip>} color={C.blue}>
    <svg width="270" height="69" viewBox="0 0 270 74" style={{ position: 'absolute', left: 6, top: 44 }}>
      <path d="M18 5V63H263M18 39H263M18 15H263" stroke="#e1e3d7" fill="none" />
      <path d={path(0.5)} pathLength="1" stroke={C.blue} fill="none" strokeWidth="2" strokeDasharray={`${first} 1`} opacity={second > 0 ? 0.45 : 1} />
      <path d={path(1)} pathLength="1" stroke={C.green} fill="none" strokeWidth="2.5" strokeDasharray={`${second} 1`} />
      <text x="18" y="73" fontSize="8" fill={C.muted}>0</text><text x="252" y="73" fontSize="8" fill={C.muted}>2 s</text>
      <text x="0" y="17" fontSize="8" fill={C.muted}>8 m</text><text x="0" y="41" fontSize="8" fill={C.muted}>4 m</text>
    </svg>
    <div style={{ position: 'absolute', top: 57, right: 15, color: C.ink, fontSize: 11, lineHeight: 1.65 }}>
      {f >= 180 ? <><b style={{ color: C.green }}>แรงเพิ่ม 2 เท่า</b><br />ระยะทาง 4 → 8 m</> : <><b style={{ color: C.blue }}>ลองผลักรถ</b><br />ดูผลเปลี่ยนตามค่า</>}
    </div>
  </Card>;
}

export function TabletopStory() {
  const f = useCurrentFrame();
  const first = ease(f, 132, 154);
  const second = ease(f, 180, 202);
  const force = Math.round(ease(f, 163, 173, 10, 20));
  const distance = f < 176 ? 4 * first ** 2 : 8 * second ** 2;
  const stage = f < 8 ? 'พื้นที่ว่าง รอไอเดียของคุณ' : f < 30 ? 'วางไฟล์บทเรียนลงบน Canvas' : f < 58 ? 'AI ร่างกฎให้คุณตรวจและเปิดใช้' : f < 82 ? 'งอกเป็นการ์ดสำหรับปรับค่า' : f < 106 ? 'เพิ่มฉากที่เล่นได้บนโต๊ะเดียวกัน' : f < 128 ? 'เพิ่มกราฟเพื่อมองเห็นผล' : f < 160 ? 'ลงมือทดลองด้วยค่าแรก' : f < 204 ? 'เพิ่มแรง แล้วลองดูอีกครั้ง' : 'จากไฟล์ กลายเป็นพื้นที่ที่ได้คิดและลงมือ';
  const count = (f >= 24 ? 1 : 0) + (f >= 46 ? 1 : 0) + (f >= 74 ? 1 : 0) + (f >= 98 ? 1 : 0) + (f >= 122 ? 1 : 0);
  return <AbsoluteFill style={{ background: C.paper, color: C.ink, fontFamily: 'Manrope, Noto Sans Thai, sans-serif', overflow: 'hidden' }}>
    <div style={{ position: 'absolute', left: 30, top: 19, display: 'flex', alignItems: 'center', gap: 8 }}><span style={{ width: 15, height: 15, border: `4px solid ${C.green}`, borderRadius: 6 }} /><span style={{ fontSize: 10, color: C.green, fontWeight: 700, letterSpacing: 1 }}>TABLETOP</span><span style={{ color: C.muted, fontSize: 10 }}>· พื้นที่สำหรับไอเดียที่อยากลอง</span></div>
    <div style={{ position: 'absolute', left: 30, top: 44, fontSize: 25, fontWeight: 700, letterSpacing: -0.3 }}>เริ่มจากโต๊ะว่าง แล้วให้ไอเดียค่อย ๆ งอก</div>
    <div style={{ position: 'absolute', right: 31, top: 23 }}><Chip color={C.blue} background={C.blueSoft}>ลองแรงกับรถ</Chip></div>
    <div style={{ position: 'absolute', left: 18, top: 94, width: 924, height: 378, border: `1px solid ${C.edge}`, borderRadius: 22, backgroundColor: '#f3f3e9', backgroundImage: 'radial-gradient(#bcc7b761 0.8px, transparent 0.8px)', backgroundSize: '16px 16px' }} />
    {f < 8 && <div style={{ position: 'absolute', left: 330, top: 237, width: 300, textAlign: 'center', color: C.muted }}><div style={{ fontSize: 38, fontWeight: 400 }}>+</div><div style={{ fontSize: 15 }}>นำไฟล์ของคุณมาวางตรงนี้</div></div>}
    <svg width="960" height="480" style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}>
      {[[30, 'M132 264V284'], [58, 'M232 368H242V283H252'], [82, 'M508 218H528'], [106, 'M728 314V334']].map(([at, d]) => f >= at && <path key={at} d={d} fill="none" stroke="#9fb8a5" strokeWidth="2" strokeDasharray="4 4" opacity={ease(f, at, at + 8)} />)}
    </svg>
    <FileCard f={f} />
    <RulesCard f={f} />
    <Controls f={f} force={force} running={(f >= 132 && f < 154) || (f >= 180 && f < 202)} />
    <Scene f={f} distance={distance} acceleration={force / 5} progress={f < 176 ? first : second} />
    <Graph f={f} first={first} second={second} />
    {f >= 47 && f <= 53 && <Cursor x={158} y={412} click={f >= 50} label="ตรวจแล้วเปิดใช้" />}
    {((f >= 126 && f <= 133) || (f >= 175 && f <= 181)) && <Cursor x={416} y={390} click={f >= 130 && f <= 133 || f >= 178} />}
    {f >= 160 && f <= 175 && <Cursor x={ease(f, 163, 173, 325, 435)} y={201} label="10 → 20 N" />}
    <div style={{ position: 'absolute', left: 31, top: 484, display: 'flex', alignItems: 'center', gap: 9 }}><span style={{ width: 7, height: 7, borderRadius: 7, background: C.green }} /><span style={{ fontSize: 14, fontWeight: 600 }}>{stage}</span></div>
    <div style={{ position: 'absolute', right: 33, top: 486, fontSize: 11, color: C.muted }}>{count} การ์ดบน Canvas</div>
    <div style={{ position: 'absolute', left: 31, bottom: 10, fontSize: 9, color: C.muted }}>ภาพอธิบายแนวคิด · สร้างด้วย Remotion · ไม่ใช่ภาพบันทึกการใช้งานจริง</div>
    <div style={{ position: 'absolute', right: 33, bottom: 10, fontSize: 9, color: C.muted }}>คุณตรวจ แล้วเป็นคนลงมือทดลอง</div>
  </AbsoluteFill>;
}
