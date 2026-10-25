import { exportEncounterHtml } from './creative/encounterModel';
import { exportPlayableQuestHtml } from './creative/questGameModel';
import { createMusicPcmSample, encodeMusicWav } from './creative/musicAudio';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, FileText, Sparkles } from 'lucide-react';
import { rulesFingerprint } from './domain';
import type { TrioSnapshot } from './types';
import { buildTrioDeliverables, type TrioDeliverableFile } from './deliverables';
import { buildVisualArtifact, type VisualArtifact } from './visualArtifacts';
import './trio-deliverables.css';

function download(file: TrioDeliverableFile) {
  const url = URL.createObjectURL(new Blob([file.contents], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function TrioDeliverables({ snapshot }: { snapshot: TrioSnapshot }) {
  const bundle = useMemo(() => buildTrioDeliverables(snapshot), [snapshot]);
  const [message, setMessage] = useState('');
  const [visualMessage, setVisualMessage] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generated, setGenerated] = useState<{ key: string; artifact: VisualArtifact } | null>(null);
  const generationFrame = useRef<number | null>(null);
  const generationToken = useRef(0);
  const activeKey = `${snapshot.caseId}:${snapshot.version}:${rulesFingerprint(snapshot.caseId, snapshot.active)}`;
  const activeKeyRef = useRef(activeKey);
  activeKeyRef.current = activeKey;
  const { summary } = bundle;
  const outputStatus = summary.reviewCount > 0
    ? `${summary.resolvedCount} คำนวณได้ · ${summary.reviewCount} ต้องตรวจ`
    : `${summary.resultCount} รายการพร้อมอ่าน`;

  const save = (file: TrioDeliverableFile) => {
    try {
      download(file);
      setMessage(`เตรียมไฟล์ ${file.filename} แล้ว`);
    } catch {
      setMessage('ดาวน์โหลดไม่สำเร็จ · ลองอีกครั้งจากเบราว์เซอร์นี้');
    }
  };

  useEffect(() => {
    generationToken.current += 1;
    if (generationFrame.current !== null) window.cancelAnimationFrame(generationFrame.current);
    generationFrame.current = null;
    setGenerating(false);
    setGenerated(null);
    setVisualMessage('');
    return () => {
      generationToken.current += 1;
      if (generationFrame.current !== null) window.cancelAnimationFrame(generationFrame.current);
      generationFrame.current = null;
    };
  }, [activeKey]);

  const generateVisual = () => {
    if (generationFrame.current !== null) window.cancelAnimationFrame(generationFrame.current);
    const token = ++generationToken.current;
    const key = activeKey;
    const caseId = snapshot.caseId;
    const version = snapshot.version;
    const active = {
      shipping: { ...snapshot.active.shipping },
      quest: { ...snapshot.active.quest },
      music: { ...snapshot.active.music },
    };
    setGenerating(true);
    setGenerated(null);
    setVisualMessage(caseId === 'shipping'
      ? 'กำลังจัดวางบัตรค่าส่งจากอัตราที่ใช้อยู่…'
      : caseId === 'quest'
        ? snapshot.active.quest.encounter ? 'กำลังวาดฉากและผลของโล่…' : 'กำลังวาดเส้นทางตามเวลาคำใบ้…'
        : 'กำลังเรียงจังหวะตามแผนซ้อม…');

    const compose = () => {
      generationFrame.current = null;
      if (generationToken.current !== token || activeKeyRef.current !== key) return;
      try {
        const artifact = buildVisualArtifact(caseId, active, version);
        setGenerated({ key, artifact });
        setVisualMessage('ชิ้นงานพร้อมดาวน์โหลด · คำนวณจาก Active ปัจจุบัน');
      } catch {
        setVisualMessage('สร้างชิ้นงานไม่สำเร็จ · ตรวจค่ากติกา Active แล้วลองอีกครั้ง');
      } finally {
        setGenerating(false);
      }
    };
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    generationFrame.current = window.requestAnimationFrame(() => {
      if (generationToken.current !== token || activeKeyRef.current !== key) return;
      if (reducedMotion) {
        compose();
        return;
      }
      setVisualMessage('กำลังประกอบองค์ประกอบและเตรียมไฟล์…');
      generationFrame.current = window.requestAnimationFrame(compose);
    });
  };

  const currentGenerated = generated?.key === activeKey ? generated.artifact : null;

  return (
    <section className="trio-deliverables" data-testid="trio-deliverables" aria-labelledby="trio-deliverables-title">
      <div className="trio-deliverables__heading">
        <span className="trio-deliverables__eyebrow">ไฟล์จากกติกาที่ใช้อยู่ · Active v{summary.activeVersion}</span>
        <h3 id="trio-deliverables-title">ผลลัพธ์ที่ได้</h3>
        <p>{outputStatus} · Simulation แยกจากไฟล์นี้ · handoff ค้าง 1 รายการ</p>
      </div>
      <div className="trio-deliverables__actions">
        <button type="button" onClick={() => save(bundle.csv)} aria-label={`ดาวน์โหลด CSV ${bundle.csv.filename}`}>
          <Download size={15} aria-hidden="true" />
          <span><strong>ข้อมูล CSV</strong><small>{bundle.csv.filename}</small></span>
        </button>
        <button type="button" onClick={() => save(bundle.report)} aria-label={`ดาวน์โหลดรายงาน HTML ${bundle.report.filename}`}>
          <FileText size={15} aria-hidden="true" />
          <span><strong>รายงานอ่านได้</strong><small>{bundle.report.filename}</small></span>
        </button>
        {snapshot.caseId === 'quest' && <button type="button" onClick={() => save({filename: `quest-playable-v${snapshot.version}.html`, mimeType:'text/html;charset=utf-8',contents:snapshot.active.quest.encounter ? exportEncounterHtml(snapshot.active.quest.encounter) : exportPlayableQuestHtml(snapshot.active.quest)})}><Download size={15} /><span><strong>เกมที่เล่นได้</strong><small>HTML · เปิดออฟไลน์ได้</small></span></button>}
        {snapshot.caseId === 'music' && <button type="button" onClick={() => { try { const buffer=encodeMusicWav(createMusicPcmSample(snapshot.active.music.chorusBpm)); const url=URL.createObjectURL(new Blob([buffer],{type:'audio/wav'})); const a=document.createElement('a'); a.href=url; a.download=`chorus-${snapshot.active.music.chorusBpm}bpm-4-beats.wav`; a.click(); window.setTimeout(()=>URL.revokeObjectURL(url),1000); setMessage('เตรียมเสียงตัวอย่าง 4 จังหวะตาม BPM ที่ใช้อยู่แล้ว'); } catch { setMessage('สร้างเสียงไม่ได้สำหรับ BPM นี้ · ลองจังหวะตั้งแต่ 30 BPM'); } }}><Download size={15} /><span><strong>เสียงซ้อมตัวอย่าง</strong><small>WAV · 4 จังหวะที่ BPM ใช้งาน</small></span></button>}
      </div>
      <p className="trio-deliverables__note">รายงานแยกผล Active, ผลตรวจ Draft ปัจจุบัน, รายการค้าง และหลักฐานที่บันทึกจริง</p>
      <div className="trio-deliverables__visual" data-testid="trio-visual-artifact">
        <div className="trio-deliverables__visual-heading">
          <strong>ชิ้นงานภาพจากกติกา</strong>
          <span>{currentGenerated?.caption ?? 'ตัวอย่างไฟล์ SVG หรือไกด์จังหวะภาพเคลื่อนไหว'}</span>
        </div>
        {currentGenerated ? (
          currentGenerated.file.mimeType.startsWith('text/html') ? (
            <iframe
              className="trio-deliverables__motion-preview"
              srcDoc={currentGenerated.file.contents}
              sandbox="allow-scripts"
              title="ไกด์จังหวะภาพเคลื่อนไหว · กดเริ่มหรือพักได้"
              loading="lazy"
            />
          ) : (
            <img
              className="trio-deliverables__preview"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(currentGenerated.previewSvg)}`}
              alt={snapshot.caseId === 'shipping' ? 'ตัวอย่างบัตรอัตราค่าส่งจาก Active rules' : snapshot.caseId === 'quest' ? snapshot.active.quest.encounter ? 'ฉากต่อสู้และผลกฎโล่' : 'ตัวอย่างเส้นทางคำใบ้จาก Active rules' : 'ตัวอย่างแผนซ้อมและกราฟจังหวะจาก Active rules'}
            />
          )
        ) : (
          <div className="trio-deliverables__placeholder" aria-label="พื้นที่ว่างสำหรับชิ้นงานที่จะสร้าง">
            <Sparkles size={20} aria-hidden="true" />
            <strong>ชิ้นงานจะแสดงตรงนี้</strong>
            <span>{snapshot.caseId === 'shipping' ? 'บัตรค่าส่ง SVG' : snapshot.caseId === 'quest' ? snapshot.active.quest.encounter ? 'ภาพฉากและผลกติกา SVG' : 'แผนที่คำใบ้ SVG' : 'ไกด์ซ้อมแบบ motion HTML'}</span>
          </div>
        )}
        <div className="trio-deliverables__visual-actions">
          <button type="button" onClick={generateVisual} disabled={generating}>
            <Sparkles size={15} aria-hidden="true" />
            {generating ? 'กำลังสร้างชิ้นงาน…' : currentGenerated ? 'สร้างชิ้นงานภาพอีกครั้ง' : 'สร้างชิ้นงานภาพ'}
          </button>
          {currentGenerated && (
            <button type="button" onClick={() => save(currentGenerated.file)} aria-label={`ดาวน์โหลดชิ้นงาน ${currentGenerated.file.filename}`}>
              <Download size={15} aria-hidden="true" />
              <span>ดาวน์โหลด {currentGenerated.file.filename}</span>
            </button>
          )}
        </div>
        {visualMessage && <p className="trio-deliverables__visual-message" role="status" aria-live="polite">{visualMessage}</p>}
        {snapshot.caseId === 'music' && <p className="trio-deliverables__note">ไกด์จังหวะเป็นภาพเคลื่อนไหวแบบกดเริ่มเอง ไม่มีเสียงอัตโนมัติ</p>}
      </div>
      {message && <p className="trio-deliverables__message" role="status" aria-live="polite">{message}</p>}
    </section>
  );
}
