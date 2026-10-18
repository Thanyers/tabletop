import { isValidEncounterRule, musicPlan, questStatus, rulesFingerprint, shippingResults } from './domain';
import type { CaseId, RuleBook } from './types';
import type { TrioDeliverableFile } from './deliverables';
import { exportEncounterHtml, runEncounter } from './creative/encounterModel';

export interface VisualMotionMetrics {
  chorusBpm: number;
  repetitions: number;
  beatsPerRepetition: number;
  beatMilliseconds: number;
  chorusSeconds: number;
  fullPlanSeconds: number;
}

export interface VisualArtifact {
  caseId: CaseId;
  version: number;
  activeFingerprint: string;
  file: TrioDeliverableFile;
  previewSvg: string;
  caption: 'สร้างจากกติกาที่ใช้งาน · SVG / motion HTML';
  motionMetrics?: VisualMotionMetrics;
}

const STUDIO = 'PROCEDURAL · WORKSPACE STORY';

export function escapeXml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function escapeInlineJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e')
    .replaceAll('&', '\\u0026')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function svgDocument(label: string, background: string, content: string, viewBox = '0 0 960 600'): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img" aria-labelledby="art-title art-desc">
<title id="art-title">${escapeXml(label)}</title><desc id="art-desc">${escapeXml(label)} · ${STUDIO}</desc>
<defs><linearGradient id="paper" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${background}"/><stop offset="1" stop-color="#ffffff"/></linearGradient><filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#28334a" flood-opacity=".08"/></filter></defs>
<rect width="100%" height="100%" rx="28" fill="url(#paper)"/>${content}</svg>`;
}

function money(value: number | null): string {
  return value === null || !Number.isFinite(value) ? 'รอตรวจสอบ' : `฿${value.toFixed(2)}`;
}

function shippingArtwork(book: RuleBook): string {
  const rule = book.shipping;
  const rows = shippingResults(rule);
  const first = rows.find((row) => row.id === 'SH-001');
  const second = rows.find((row) => row.id === 'SH-002');
  const missing = rows.find((row) => row.id === 'SH-006');
  const content = `
<circle cx="812" cy="107" r="49" fill="#eaf7fb"/><path d="M790 108h44m-22-22v44" stroke="#299bb0" stroke-width="3" stroke-linecap="round" opacity=".72"/>
<text x="62" y="72" fill="#25869b" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2">SHIPPING · ACTIVE RATE CARD</text>
<text x="62" y="132" fill="#26374a" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="40" font-weight="700">ค่าส่งตามกติกาที่ใช้อยู่</text>
<text x="64" y="164" fill="#6e7c8c" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">กติกาที่ใช้อยู่ · เริ่มใช้ ${escapeXml(book.shipping.effectiveDate)}</text>
<g filter="url(#soft-shadow)"><rect x="62" y="201" width="400" height="166" rx="20" fill="#ffffff"/><rect x="482" y="201" width="400" height="166" rx="20" fill="#ffffff"/></g>
<text x="92" y="246" fill="#708091" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">กรุงเทพฯ</text><text x="92" y="315" fill="#176caa" font-family="Arial,sans-serif" font-size="52" font-weight="700">฿${escapeXml(book.shipping.bangkok)}</text><text x="294" y="310" fill="#82909d" font-family="Arial,sans-serif" font-size="15">ราคาฐาน</text>
<text x="512" y="246" fill="#708091" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">ต่างจังหวัด</text><text x="512" y="315" fill="#176caa" font-family="Arial,sans-serif" font-size="52" font-weight="700">฿${escapeXml(book.shipping.regional)}</text><text x="714" y="310" fill="#82909d" font-family="Arial,sans-serif" font-size="15">ราคาฐาน</text>
<rect x="62" y="389" width="820" height="66" rx="15" fill="#edf7fc"/><text x="88" y="430" fill="#526b7d" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">เริ่มใช้ ${escapeXml(book.shipping.effectiveDate)}</text><text x="459" y="430" fill="#176caa" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="18" font-weight="700">ส่วนเกิน ฿${escapeXml(book.shipping.extraKg)} / กก.ที่เริ่มขึ้น</text>
<text x="64" y="500" fill="#26374a" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="16" font-weight="700">ตัวอย่างจากรายการจริงในชุดข้อมูล</text>
<text x="64" y="534" fill="#596a7b" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="15">SH-001 · คำนวณ ${escapeXml(money(first?.amount ?? null))}</text><text x="374" y="534" fill="#596a7b" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="15">SH-002 · คำนวณ ${escapeXml(money(second?.amount ?? null))}</text>
<rect x="690" y="510" width="192" height="42" rx="12" fill="#fff7eb"/><text x="708" y="536" fill="#94652c" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="14" font-weight="700">${escapeXml(missing?.id ?? 'SH-006')} · ${escapeXml(missing?.amount === null ? 'ยังไม่ทราบน้ำหนัก' : money(missing?.amount ?? null))}</text>
<text x="64" y="579" fill="#8994a0" font-family="Arial,sans-serif" font-size="11" letter-spacing="1">${STUDIO} · FICTIONAL SAMPLE DATA · NO EXTERNAL CONNECTION</text>`;
  return svgDocument('ค่าส่งตามกติกาที่ใช้อยู่', '#edf8fb', content);
}

function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'ตรวจค่าเวลา';
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

function questArtwork(book: RuleBook): string {
  const rule = book.quest;
  const firstStatus = questStatus(rule, rule.firstHint);
  const secondStatus = questStatus(rule, rule.secondHint);
  const reveal = rule.autoReveal ? 'เฉลยเปิดตามเวลา' : 'ผู้เล่นเลือกขอเฉลย';
  const content = `
<text x="58" y="70" fill="#ae625b" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2">TREASURE HUNT · CLUE ROUTE</text>
<text x="58" y="130" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="40" font-weight="700">แผนที่คำใบ้สำหรับผู้เล่น</text>
<text x="61" y="163" fill="#777185" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">เส้นทางตัวอย่าง 3 ด่าน · เล่นตามจังหวะของผู้เล่น</text>
<path d="M180 292 C275 230 335 344 452 290 S624 235 753 300" fill="none" stroke="#e4a39a" stroke-width="9" stroke-linecap="round" stroke-dasharray="2 20"/>
<g filter="url(#soft-shadow)"><rect x="55" y="210" width="190" height="174" rx="20" fill="#fff"/><rect x="282" y="210" width="190" height="174" rx="20" fill="#fff"/><rect x="509" y="210" width="190" height="174" rx="20" fill="#fff"/><rect x="736" y="210" width="168" height="174" rx="20" fill="#fff"/></g>
<circle cx="88" cy="242" r="18" fill="#f9e7e2"/><text x="82" y="248" fill="#a84f4b" font-family="Arial,sans-serif" font-size="16" font-weight="700">A</text><text x="80" y="290" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="19" font-weight="700">ด่านสวน</text><text x="80" y="323" fill="#818090" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="14">เริ่มเกม · 00:00</text><text x="80" y="355" fill="#b36b60" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="13">ผ่านได้โดยไม่ใช้คำใบ้</text>
<circle cx="315" cy="242" r="18" fill="#f9e7e2"/><text x="310" y="248" fill="#a84f4b" font-family="Arial,sans-serif" font-size="16" font-weight="700">1</text><text x="307" y="290" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="19" font-weight="700">ด่านห้องสมุด</text><text x="307" y="325" fill="#ae625b" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="16" font-weight="700">คำใบ้ · ${escapeXml(formatClock(rule.firstHint))}</text><text x="307" y="355" fill="#818090" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="13">${escapeXml(firstStatus.summary)}</text>
<circle cx="542" cy="242" r="18" fill="#f9e7e2"/><text x="537" y="248" fill="#a84f4b" font-family="Arial,sans-serif" font-size="16" font-weight="700">2</text><text x="534" y="290" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="19" font-weight="700">ด่านกล่องสมบัติ</text><text x="534" y="325" fill="#ae625b" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="16" font-weight="700">คำใบ้ · ${escapeXml(formatClock(rule.secondHint))}</text><text x="534" y="355" fill="#818090" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="13">${escapeXml(secondStatus.summary)}</text>
<circle cx="769" cy="242" r="18" fill="#fbf0d9"/><path d="M762 241l7 7 12-15" fill="none" stroke="#9d7630" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><text x="761" y="290" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="19" font-weight="700">การเฉลย</text><text x="761" y="325" fill="#ae625b" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="15" font-weight="700">${escapeXml(reveal)}</text><text x="761" y="355" fill="#818090" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="13">${rule.autoReveal ? 'เมื่อครบเวลาที่ตั้งไว้' : 'ไม่มีการเปิดคำตอบเอง'}</text>
<rect x="58" y="426" width="846" height="86" rx="17" fill="#fff3ef"/><text x="86" y="462" fill="#9e5b56" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="15" font-weight="700">กติกาเวลาปัจจุบัน</text><text x="86" y="491" fill="#484458" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">${escapeXml(displayMinutes(rule.firstHint))} นาที · ${escapeXml(displayMinutes(rule.secondHint))} นาที · ${rule.autoReveal ? 'เฉลยอัตโนมัติ' : 'ให้ผู้เล่นเป็นคนขอเฉลย'}</text>
<text x="60" y="564" fill="#918a99" font-family="Arial,sans-serif" font-size="11" letter-spacing="1">${STUDIO} · FICTIONAL SAMPLE DATA · PRINTABLE ROUTE</text>`;
  return svgDocument('แผนที่คำใบ้สำหรับผู้เล่น', '#fff5f1', content);
}

function questEncounterArtwork(book: RuleBook, version: number): string {
  const rule = book.quest.encounter;
  if (rule === undefined || !isValidEncounterRule(rule)) {
    throw new Error('กติกา encounter ไม่ครบสำหรับสร้างชิ้นงาน');
  }
  const outcome = runEncounter(rule);
  const actors = [
    { id: 'mira' as const, name: 'Mira · ผู้พิทักษ์', max: 10, x: 66, color: '#7c65c5' },
    { id: 'pip' as const, name: 'Pip · นักธนู', max: 10, x: 356, color: '#428eaf' },
    { id: 'goblin' as const, name: 'Goblin', max: 6, x: 646, color: '#c96d61' },
  ];
  const cards = actors.map(({ id, name, max, x, color }) => {
    const hp = outcome.hp[id];
    const width = Math.round(210 * (hp / max));
    return `<g filter="url(#soft-shadow)"><rect x="${x}" y="212" width="248" height="142" rx="18" fill="#fff"/></g><text x="${x + 20}" y="251" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="20" font-weight="700">${escapeXml(name)}</text><text x="${x + 20}" y="293" fill="${color}" font-family="Arial,sans-serif" font-size="25" font-weight="700">${escapeXml(hp)} / ${max} HP</text><rect x="${x + 20}" y="315" width="210" height="12" rx="6" fill="#eeeaf4"/><rect x="${x + 20}" y="315" width="${width}" height="12" rx="6" fill="${color}"/>`;
  }).join('');
  const events = outcome.events.map((event, index) => (
    `<text x="86" y="${412 + index * 29}" fill="#514c64" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="15">${index + 1}. ${escapeXml(event.label)} · d20 ${event.roll}</text>`
  )).join('');
  const shield = rule.allyShield
    ? `โล่ของ Mira ช่วย Pip · ลด ${rule.shieldReduction} HP`
    : 'โล่ของ Mira คุ้มกันตัวเอง';
  const content = `
<text x="62" y="70" fill="#6954b7" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2">QUEST · ENCOUNTER LAB</text>
<text x="62" y="130" fill="#302f43" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="38" font-weight="700">การเผชิญหน้าของ Mira และ Pip</text>
<text x="64" y="165" fill="#777185" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="16">Active v${escapeXml(version)} · ลูกเต๋าตัวอย่าง d20 [14, 12, 16] · ${escapeXml(shield)}</text>
${cards}
<rect x="66" y="382" width="828" height="144" rx="18" fill="#f5f2fc"/>${events}
<text x="66" y="562" fill="#6d6681" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="13">${outcome.goblinDefeated ? 'ผลจำลอง: จบด้วยชัยชนะ · Goblin HP 0' : 'ผลจำลอง: จบรอบ · แสดง HP ตาม Active'}</text>
<text x="66" y="584" fill="#918a99" font-family="Arial,sans-serif" font-size="11" letter-spacing="1">${STUDIO} · RUNTIME OUTCOME · NO NETWORK</text>`;
  return svgDocument('ผลเผชิญหน้าตามกติกา Active', '#f7f4ff', content);
}

function displayMinutes(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return 'ตรวจค่าเวลา';
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? String(minutes) : minutes.toFixed(1);
}

function musicPreview(book: RuleBook): { svg: string; metrics: VisualMotionMetrics } {
  const sections = musicPlan(book.music);
  const chorus = sections.find((section) => section.id === 'MU-004');
  if (!chorus || sections.length !== 7) throw new Error('ค่าจังหวะ Active ยังไม่ครบสำหรับสร้างแผนซ้อม');
  const fullPlanSeconds = Number(sections.reduce((total, section) => total + section.seconds, 0).toFixed(2));
  const metrics: VisualMotionMetrics = {
    chorusBpm: book.music.chorusBpm,
    repetitions: book.music.repetitions,
    beatsPerRepetition: chorus.beats,
    beatMilliseconds: 60000 / book.music.chorusBpm,
    chorusSeconds: chorus.seconds,
    fullPlanSeconds,
  };
  const bars = sections.map((section, index) => {
    const x = 72 + index * 116;
    const height = 24 + Math.min(64, section.bpm * 0.45);
    const fill = section.id === 'MU-004' ? '#7058bd' : '#aab4dd';
    return `<rect x="${x}" y="${305 - height}" width="54" height="${height}" rx="14" fill="${fill}"/><text x="${x + 27}" y="330" text-anchor="middle" fill="#716b80" font-family="Arial,sans-serif" font-size="11">${index + 1}</text>`;
  }).join('');
  const content = `
<text x="58" y="70" fill="#6653ae" font-family="Arial,sans-serif" font-size="15" font-weight="700" letter-spacing="2">BAND REHEARSAL · VISUAL PRACTICE</text>
<text x="58" y="130" fill="#302e46" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="40" font-weight="700">ไกด์จังหวะสำหรับซ้อมวง</text>
<text x="62" y="166" fill="#777185" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">${escapeXml(sections.length)} ท่อน · รวม ${escapeXml(metrics.fullPlanSeconds)} วินาทีตาม Active rules</text>
<g>${bars}</g><path d="M94 355H850" stroke="#e9e3f5" stroke-width="2"/>
<rect x="58" y="390" width="844" height="112" rx="20" fill="#f4f0ff"/><text x="88" y="433" fill="#5c4a9a" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="16" font-weight="700">ท่อนฮุก</text><text x="88" y="478" fill="#604eab" font-family="Arial,sans-serif" font-size="36" font-weight="700">${escapeXml(book.music.chorusBpm)} BPM</text><text x="378" y="462" fill="#6f6684" font-family="Arial,'Noto Sans Thai',sans-serif" font-size="17">${escapeXml(book.music.repetitions)} รอบ · ${escapeXml(chorus.beats)} จังหวะต่อรอบ · ${escapeXml(metrics.chorusSeconds.toFixed(2))} วินาที</text>
<text x="60" y="556" fill="#918a99" font-family="Arial,sans-serif" font-size="11" letter-spacing="1">${STUDIO} · VISUAL ONLY · NO AUDIO</text>`;
  return { svg: svgDocument('ไกด์จังหวะสำหรับซ้อมวง', '#f7f4ff', content), metrics };
}

function musicMotionHtml(book: RuleBook, version: number): string {
  const plan = musicPlan(book.music);
  if (plan.length !== 7) throw new Error('ค่าจังหวะ Active ยังไม่ครบสำหรับสร้างแผนซ้อม');
  const json = escapeInlineJson(plan.map(({ id, name, bpm, repetitions, beats, seconds }) => ({ id, name, bpm, repetitions, beats, seconds })));
  const safeVersion = escapeXml(version);
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ไกด์จังหวะซ้อมวง · Active v${safeVersion}</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'; img-src data:; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'">
<style>
:root{color-scheme:light;--ink:#302e46;--muted:#766f85;--line:#e7e1f1;--accent:#6954b7;--tempo:750ms}*{box-sizing:border-box}body{margin:0;padding:24px;background:#f7f5fb;color:var(--ink);font:16px/1.5 Arial,"Noto Sans Thai",sans-serif}.card{max-width:760px;margin:0 auto;padding:28px;background:white;border:1px solid var(--line);border-radius:22px;box-shadow:0 18px 55px #35294c12}.tag{color:var(--accent);font-size:12px;font-weight:700;letter-spacing:.08em}h1{margin:7px 0;font-size:28px}p{color:var(--muted)}.layout{display:grid;grid-template-columns:180px minmax(0,1fr);align-items:center;gap:24px;margin:22px 0;padding:20px;border-radius:18px;background:#f6f3fd}.beat-face{display:grid;place-items:center;aspect-ratio:1;border-radius:50%;background:white;border:1px solid var(--line)}svg{width:142px;height:142px}.orbit{transform-origin:71px 71px;animation:orbit var(--tempo) ease-in-out infinite;animation-play-state:paused}.playing .orbit{animation-play-state:running}.tempo{font-size:30px;font-weight:700;color:var(--accent)}.readout{display:flex;flex-wrap:wrap;gap:8px}.readout span{padding:5px 10px;border-radius:99px;background:#fff;border:1px solid var(--line);font-size:13px}.controls{display:flex;gap:9px;margin:18px 0}.controls button{min-height:42px;padding:8px 15px;border:1px solid var(--line);border-radius:10px;background:white;color:var(--ink);font:inherit;font-weight:700;cursor:pointer}.controls button:first-child{background:var(--accent);border-color:var(--accent);color:white}.controls button:focus-visible{outline:3px solid #c7baf1;outline-offset:2px}.status{min-height:24px;color:var(--accent);font-weight:650}.plan{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}.plan article{padding:10px;border:1px solid var(--line);border-radius:11px}.plan article.current{border-color:var(--accent);background:#f8f5ff}.plan strong,.plan small{display:block}.plan small{color:var(--muted)}@keyframes orbit{0%,100%{transform:scale(.96)}50%{transform:scale(1.08)}}@media(prefers-reduced-motion:reduce){.orbit{animation:none!important}.controls button{scroll-behavior:auto}}@media(max-width:540px){body{padding:10px}.card{padding:17px}.layout{grid-template-columns:1fr;justify-items:center}.plan{grid-template-columns:1fr}}
</style></head><body><main class="card" id="practice">
<div class="tag">BAND REHEARSAL · ACTIVE v${safeVersion}</div><h1>ไกด์จังหวะสำหรับซ้อมวง</h1><p>จังหวะภาพตามกติกาที่ใช้อยู่ · ไม่มีเสียงและไม่เริ่มเอง</p>
<section class="layout"><div class="beat-face"><svg viewBox="0 0 142 142" role="img" aria-labelledby="beat-title beat-desc"><title id="beat-title">ตัวนับจังหวะภาพ</title><desc id="beat-desc">ตัวนับจังหวะตาม BPM ของแต่ละท่อน</desc><circle cx="71" cy="71" r="58" fill="#f5f2fc" stroke="#ded7ef" stroke-width="2"/><circle class="orbit" cx="71" cy="71" r="39" fill="#715abd"/><circle cx="71" cy="71" r="9" fill="white"/><text id="beat-number" x="71" y="78" text-anchor="middle" fill="#fff" font-size="18" font-family="Arial,sans-serif" font-weight="700">1</text></svg></div><div><div class="readout"><span id="section-name"></span><span id="tempo-readout"></span><span id="round-readout"></span><span id="beat-readout"></span></div><div class="controls"><button id="toggle" type="button" aria-pressed="false">เริ่มภาพเคลื่อนไหว</button><button id="reset" type="button">เริ่มใหม่</button></div><div id="status" class="status" role="status" aria-live="polite">พร้อมเริ่ม · กดปุ่มเพื่อดูจังหวะ</div></div></section>
<section id="plan" class="plan" aria-label="แผนซ้อมทุกท่อน"></section><p>การเคลื่อนไหวเป็นภาพประกอบเท่านั้น ไม่มีเสียง ไม่มีการเล่นเสียงอัตโนมัติ และไม่วิเคราะห์ไมโครโฟน</p>
</main><script>
const plan=${json};
const root=document.getElementById('practice');const toggle=document.getElementById('toggle');const reset=document.getElementById('reset');const status=document.getElementById('status');const sectionName=document.getElementById('section-name');const tempoReadout=document.getElementById('tempo-readout');const roundReadout=document.getElementById('round-readout');const beatReadout=document.getElementById('beat-readout');const beatNumber=document.getElementById('beat-number');const planRoot=document.getElementById('plan');
let sectionIndex=0;let repetition=1;let beat=1;let running=false;let timer=null;
function render(){const section=plan[sectionIndex];if(!section)return;root.style.setProperty('--tempo',(60000/section.bpm)+'ms');sectionName.textContent=section.name;tempoReadout.textContent=section.bpm+' BPM';roundReadout.textContent='รอบ '+repetition+'/'+section.repetitions;beatReadout.textContent='จังหวะ '+beat+'/'+section.beats;beatNumber.textContent=String(beat);toggle.textContent=running?'พักภาพเคลื่อนไหว':'เริ่มภาพเคลื่อนไหว';toggle.setAttribute('aria-pressed',String(running));root.classList.toggle('playing',running);}
function drawPlan(){planRoot.replaceChildren(...plan.map((section,index)=>{const item=document.createElement('article');if(index===sectionIndex)item.className='current';const title=document.createElement('strong');title.textContent=section.name;const detail=document.createElement('small');detail.textContent=section.bpm+' BPM · '+section.repetitions+' รอบ · '+section.beats+' จังหวะ · '+section.seconds.toFixed(2)+' วินาที';item.append(title,detail);return item;}));}
function stop(){running=false;if(timer!==null)clearTimeout(timer);timer=null;render();}
function tick(){if(!running)return;const section=plan[sectionIndex];timer=window.setTimeout(()=>{beat+=1;if(beat>section.beats){beat=1;repetition+=1;if(repetition>section.repetitions){sectionIndex+=1;repetition=1;if(sectionIndex>=plan.length){sectionIndex=plan.length-1;const last=plan[sectionIndex];repetition=last.repetitions;beat=last.beats;stop();status.textContent='จบแผนซ้อมภาพแล้ว';drawPlan();return;}}}render();drawPlan();tick();},60000/section.bpm);}
toggle.addEventListener('click',()=>{if(running){stop();status.textContent='พักภาพเคลื่อนไหวแล้ว';return;}if(sectionIndex===plan.length-1&&repetition===plan[sectionIndex].repetitions&&beat===plan[sectionIndex].beats){sectionIndex=0;repetition=1;beat=1;}running=true;status.textContent='กำลังแสดงจังหวะตาม Active rules';render();drawPlan();tick();});
reset.addEventListener('click',()=>{stop();sectionIndex=0;repetition=1;beat=1;status.textContent='เริ่มต้นใหม่ได้ทุกเมื่อ';render();drawPlan();});
render();drawPlan();
</script></body></html>`;
}

export function buildVisualArtifact(caseId: CaseId, active: RuleBook, version: number): VisualArtifact {
  const fingerprint = rulesFingerprint(caseId, active);
  const safeVersion = Math.max(1, Math.trunc(version));
  let previewSvg: string;
  let filename: string;
  let mimeType: string;
  let contents: string;
  let motionMetrics: VisualMotionMetrics | undefined;

  if (caseId === 'shipping') {
    previewSvg = shippingArtwork(active);
    filename = `shipping-rate-card-v${safeVersion}.svg`;
    mimeType = 'image/svg+xml;charset=utf-8';
    contents = previewSvg;
  } else if (caseId === 'quest') {
    if (active.quest.encounter !== undefined) {
      previewSvg = questEncounterArtwork(active, safeVersion);
      filename = `encounter-lab-v${safeVersion}.html`;
      mimeType = 'text/html;charset=utf-8';
      contents = exportEncounterHtml(active.quest.encounter);
    } else {
      previewSvg = questArtwork(active);
      filename = `treasure-route-v${safeVersion}.svg`;
      mimeType = 'image/svg+xml;charset=utf-8';
      contents = previewSvg;
    }
  } else {
    const preview = musicPreview(active);
    previewSvg = preview.svg;
    motionMetrics = preview.metrics;
    filename = `rehearsal-motion-guide-v${safeVersion}.html`;
    mimeType = 'text/html;charset=utf-8';
    contents = musicMotionHtml(active, safeVersion);
  }

  return {
    caseId,
    version: safeVersion,
    activeFingerprint: fingerprint,
    file: { filename, mimeType, contents },
    previewSvg,
    caption: 'สร้างจากกติกาที่ใช้งาน · SVG / motion HTML',
    ...(motionMetrics ? { motionMetrics } : {}),
  };
}
