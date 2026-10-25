import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from 'react';
import { AlertCircle, Braces, Download, FileImage, FileText, Film, Music2, RotateCcw, Table2, Upload } from 'lucide-react';
import type { CaseId } from './types';
import './source-preview.css';
import { parseCsv, MAX_PREVIEW_ROWS, MAX_PREVIEW_COLUMNS, type CsvTable } from './sourceTable';
import { readLocalSheet } from './readLocalSheet';
import { sourceEvidence, type SourceCue, type SourceEvidence } from './sourceEvidence';
import { SourceEvidenceView } from './SourceEvidenceView';
import { SourceWaveform } from './SourceWaveform';

type SourceKind = 'sheet' | 'pdf' | 'image' | 'audio' | 'video' | 'json';

type SheetSource = {
  fileName: string;
  headers: readonly string[];
  columns: readonly [string, string, string];
  recordId: (row: Record<string, string>) => string;
  narrativeRecord?: (row: Record<string, string>) => string | undefined;
};

type SourceFile = {
  id: string;
  kind: SourceKind;
  fileName: string;
  label: string;
  local?: true;
  url?: string;
};

type LocalSourceFile = SourceFile & {
  local: true;
  url: string;
};

type PreviewState = {
  sourceId: string;
  status: 'loading' | 'error' | 'ready';
  message?: string;
  table?: CsvTable;
  json?: unknown;
};

const SHEET_BY_CASE: Partial<Record<CaseId, SheetSource>> = {
  shipping: {
    fileName: 'shipping-orders.csv',
    headers: ['id', 'name', 'zone', 'date', 'weight', 'billed'],
    columns: [
      'พัสดุ',
      'ปลายทาง · น้ำหนัก',
      'ยอดที่เรียกเก็บ',
    ],
    recordId: (row) => `shipping-orders:${row.id}`,
    narrativeRecord: (row) => row.id,
  },
};

const SOURCE_FILES: Record<CaseId, SourceFile[]> = {
  shipping: [
    { id: 'shipping-sheet', kind: 'sheet', fileName: 'shipping-orders.csv', label: 'รายการจัดส่ง' },
    { id: 'shipping-contract-pdf', kind: 'pdf', fileName: 'shipping-contract.pdf', label: 'สัญญาค่าจัดส่ง' },
    { id: 'shipping-contract-json', kind: 'json', fileName: 'shipping-contract.json', label: 'เงื่อนไขสัญญา' },
  ],
  quest: [
    { id: 'quest-route', kind: 'image', fileName: 'encounter-scene.svg', label: 'ภาพฉากต่อสู้' },
    { id: 'quest-notes', kind: 'json', fileName: 'encounter-notes.json', label: 'กติกาและบันทึกตาแรก' },
  ],
  music: [
    { id: 'music-audio', kind: 'audio', fileName: 'music-rehearsal.wav', label: 'เสียงซ้อม' },
    { id: 'music-video', kind: 'video', fileName: 'music-rehearsal.webm', label: 'วิดีโอซ้อม' },
    { id: 'music-notes', kind: 'json', fileName: 'music-notes.json', label: 'บันทึกจากผู้ซ้อม' },
  ],
};

const KIND_LABEL: Record<SourceKind, string> = {
  sheet: 'ชีต', pdf: 'PDF', image: 'รูปภาพ', audio: 'เสียง', video: 'วิดีโอ', json: 'JSON',
};

const KIND_SHORT_LABEL: Record<SourceKind, string> = {
  sheet: 'CSV', pdf: 'PDF', image: 'IMG', audio: 'AUDIO', video: 'VIDEO', json: 'JSON',
};

function sourceUrl(fileName: string) {
  return `${import.meta.env.BASE_URL}data/${fileName}`;
}

function sourceKindFor(file: File): SourceKind | null {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  const mime = file.type.toLowerCase();
  if (extension === 'csv' || extension === 'xlsx' || mime === 'text/csv' || mime.includes('spreadsheetml')) return 'sheet';
  if (extension === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'webp', 'svg'].includes(extension) || mime.startsWith('image/')) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'flac'].includes(extension) || mime.startsWith('audio/')) return 'audio';
  if (['mp4', 'webm', 'mov', 'ogv'].includes(extension) || mime.startsWith('video/')) return 'video';
  if (extension === 'json' || mime === 'application/json') return 'json';
  return null;
}

async function validatePdfFile(file: File) {
  const mime = file.type.split(';', 1)[0].trim().toLowerCase();
  const allowedMimes = new Set(['application/pdf', 'application/x-pdf', 'application/acrobat']);
  if (mime && !allowedMimes.has(mime)) throw new Error('ชนิด MIME ไม่ใช่ PDF');

  const bytes = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  const signature = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF- must be at byte zero.
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error('ลายเซ็น PDF ไม่ถูกต้อง');
}

function maxBytesFor(kind: SourceKind, file: File) {
  if (kind === 'pdf') return 30 * 1024 * 1024;
  if (kind === 'image') return file.name.toLowerCase().endsWith('.svg') ? 3 * 1024 * 1024 : 15 * 1024 * 1024;
  if (kind === 'audio') return 40 * 1024 * 1024;
  if (kind === 'video') return 60 * 1024 * 1024;
  return 10 * 1024 * 1024;
}

function KindIcon({ kind }: { kind: SourceKind }) {
  if (kind === 'sheet') return <Table2 size={15} aria-hidden="true" />;
  if (kind === 'pdf') return <FileText size={15} aria-hidden="true" />;
  if (kind === 'image') return <FileImage size={15} aria-hidden="true" />;
  if (kind === 'audio') return <Music2 size={15} aria-hidden="true" />;
  if (kind === 'video') return <Film size={15} aria-hidden="true" />;
  return <Braces size={15} aria-hidden="true" />;
}

function rawValue(value: string) {
  return value === ''
    ? <span className="source-preview__empty" aria-label="ช่องว่างในไฟล์ต้นฉบับ" title="ช่องว่างในไฟล์ต้นฉบับ">—</span>
    : value;
}

function PreviewCells({ caseId, row }: { caseId: CaseId; row: Record<string, string> }): ReactNode {
  if (caseId === 'shipping') {
    const destination = row.zone === 'bangkok' ? 'กรุงเทพฯ' : row.zone === 'regional' ? 'ต่างจังหวัด' : row.zone;
    return (
      <>
        <td data-narrative-field="name">
          <span className="source-preview__primary">{rawValue(row.name ?? '')}</span>
          <span className="source-preview__secondary">
            <span data-narrative-field="id">{rawValue(row.id ?? '')}</span>
            <span aria-hidden="true"> · </span>
            <span data-narrative-field="date">{rawValue(row.date ?? '')}</span>
          </span>
        </td>
        <td data-narrative-field="zone">
          <span className="source-preview__primary">{rawValue(destination)}</span>
          <span className="source-preview__secondary">
            <span>{rawValue(row.zone ?? '')}</span>
            <span aria-hidden="true"> · </span>
            <span data-narrative-field="weight">{rawValue(row.weight ?? '')}</span>
            <span> กก.</span>
          </span>
        </td>
        <td className="source-preview__amount" data-narrative-field="billed">
          <strong data-narrative-field="amount">฿{rawValue(row.billed ?? '')}</strong>
          <span className="source-preview__secondary">บาท</span>
        </td>
      </>
    );
  }

  if (caseId === 'quest') {
    return (
      <>
        <td data-narrative-field="station">
          <span className="source-preview__primary">{rawValue(row.station ?? '')}</span>
          <span className="source-preview__secondary" data-narrative-field="round">{rawValue(row.round ?? '')}</span>
        </td>
        <td className="source-preview__elapsed" data-narrative-field="elapsed">
          <strong>{rawValue(row.elapsedSeconds ?? '')}</strong>
          <span className="source-preview__secondary">วินาที</span>
        </td>
        <td data-narrative-field="observation">{rawValue(row.observation ?? '')}</td>
      </>
    );
  }

  const sectionLabels: Record<string, string> = {
    intro: 'ท่อนเปิด',
    'verse-1': 'ท่อนร้อง 1',
    'pre-chorus': 'ท่อนก่อนฮุก',
    chorus: 'ท่อนฮุก',
    'verse-2': 'ท่อนร้อง 2',
    bridge: 'ท่อนเชื่อม',
    outro: 'ท่อนจบ',
  };
  const section = row.section ?? '';
  return (
    <>
      <td data-narrative-field="section">
        <span className="source-preview__primary">{sectionLabels[section] ?? rawValue(section)}</span>
        <span className="source-preview__secondary">
          <span>{rawValue(section)}</span>
          <span aria-hidden="true"> · </span>
          <span data-narrative-field="id">{rawValue(row.id ?? '')}</span>
        </span>
      </td>
      <td className="source-preview__tempo" data-narrative-field="bpm">
        <strong>{rawValue(row.bpm ?? '')} <span>BPM</span></strong>
        <span className="source-preview__secondary"><span data-narrative-field="beats">{rawValue(row.beats ?? '')}</span> จังหวะ</span>
      </td>
      <td data-narrative-field="feedback">{rawValue(row.feedback ?? '')}</td>
    </>
  );
}

function loadErrorMessage(error: unknown, fileName: string) {
  const reason = error instanceof Error ? error.message : '';
  if (reason.includes('ไม่พบไฟล์ตัวอย่าง')) return `ไม่พบไฟล์ตัวอย่าง ${fileName} · ตรวจไฟล์แล้วลองเปิดอีกครั้ง`;
  if (reason.includes('PDF') || reason.includes('MIME')) return `เนื้อหาไฟล์ไม่ตรงกับ PDF · เลือกไฟล์ PDF ที่เปิดได้`;
  if (reason.includes('รูปแบบ JSON')) return `อ่าน ${fileName} ไม่สำเร็จ · ตรวจรูปแบบ JSON แล้วลองอีกครั้ง`;
  if (reason.includes('Unexpected CSV') || reason.includes('Unclosed CSV')) return `อ่านตาราง ${fileName} ไม่สำเร็จ · ตรวจหัวคอลัมน์และรูปแบบไฟล์`;
  return `เปิด ${fileName} ไม่สำเร็จ · ตรวจชนิดไฟล์แล้วลองอีกครั้ง`;
}

function jsonRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function SheetTable({ caseId, source, table }: { caseId: CaseId; source: SourceFile; table: CsvTable }) {
  const definition = !source.local ? SHEET_BY_CASE[caseId] : undefined;
  const columnLabels = definition?.columns ?? table.headers.slice(0, MAX_PREVIEW_COLUMNS);
  const previewRows = table.rows.slice(0, MAX_PREVIEW_ROWS);
  return (
    <div
      className="source-preview__viewport"
      role="region"
      tabIndex={0}
      aria-label={`ตาราง ${source.fileName} เลื่อนดูคอลัมน์เพิ่มเติมได้`}
      data-preview-total-rows={table.totalRows}
      data-preview-rendered-rows={previewRows.length}
      data-preview-total-columns={table.headers.length}
      data-preview-rendered-columns={columnLabels.length}
    >
      <table className="source-preview__table">
        <caption className="source-preview__sr-only">{source.local ? 'ตารางที่อ่านจากไฟล์ในเครื่อง' : 'ข้อมูลตัวอย่างจากไฟล์'} {source.fileName}</caption>
        <thead><tr>{columnLabels.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>
          {previewRows.map((row, index) => {
            const rowId = definition?.recordId(row) ?? `local-row-${index + 1}`;
            return (
              <tr
                key={rowId}
                data-testid={!source.local && row.id === 'SH-001' ? 'highlighted-source' : undefined}
                data-source-record={definition?.recordId(row)}
                data-narrative-record={definition?.narrativeRecord?.(row)}
              >
                {definition
                  ? <PreviewCells caseId={caseId} row={row} />
                  : columnLabels.map((column) => <td key={column}>{rawValue(row[column] ?? '')}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SourceContent({
  caseId,
  source,
  preview,
  onError,
  onRetry,
  onPlay,
  evidence,
  showNativePdf,
}: {
  caseId: CaseId;
  source: SourceFile & { url: string };
  preview: PreviewState;
  onError: (message: string) => void;
  onRetry: () => void;
  onPlay: () => void;
  evidence?: SourceEvidence;
  showNativePdf?: boolean;
}) {
  const [documentLoaded, setDocumentLoaded] = useState(false);
  useEffect(() => {
    if (preview.status === 'loading') setDocumentLoaded(false);
  }, [preview.status]);

  if (preview.status === 'loading') return <div className="source-preview__message" role="status" aria-live="polite">กำลังเปิดไฟล์ตัวอย่าง…</div>;
  if (preview.status === 'error') {
    return (
      <div className="source-preview__message source-preview__message--error" role="alert">
        <AlertCircle size={16} aria-hidden="true" />
        <span>{preview.message ?? `เปิด ${source.fileName} ไม่สำเร็จ`}</span>
        <button type="button" onClick={onRetry}><RotateCcw size={13} aria-hidden="true" />ลองอีกครั้ง</button>
      </div>
    );
  }

  if (source.kind === 'sheet' && preview.table) {
    if (evidence?.target === 'shipping-row') {
      const row = preview.table.rows.find((candidate) => candidate.id === 'SH-001');
      if (!row) return <div className="source-preview__message" role="status">ไม่พบแถว SH-001 ในไฟล์ตัวอย่าง</div>;
      return <div className="source-evidence__shipping-row" data-testid="highlighted-source" data-source-record={`shipping-orders:${row.id}`} data-narrative-record={row.id}>
        <span className="source-evidence__shipping-id">SH-001 <small>· {row.date}</small></span>
        <strong>{row.zone === 'bangkok' ? 'กรุงเทพฯ' : row.zone} · {row.weight} กก.</strong>
        <span>ยอดเดิม <b>฿{row.billed}</b></span>
      </div>;
    }
    const displayedColumns = source.local
      ? Math.min(preview.table.headers.length, MAX_PREVIEW_COLUMNS)
      : (SHEET_BY_CASE[caseId]?.columns.length ?? preview.table.headers.length);
    return <>
      <SheetTable caseId={caseId} source={source} table={preview.table} />
      <footer className="source-preview__footer">
        <span>
          {source.local
            ? `แสดง ${Math.min(preview.table.rows.length, MAX_PREVIEW_ROWS)} จาก ${preview.table.totalRows} รายการ`
            : `${preview.table.totalRows} รายการตัวอย่าง`}
        </span>
        <span>
          {source.local
            ? `แสดง ${displayedColumns} จาก ${preview.table.totalColumns} คอลัมน์ · อ่านในเครื่องนี้`
            : 'ข้อมูลสมมติ · — คือช่องว่างในไฟล์'}
        </span>
      </footer>
    </>;
  }

  if (source.kind === 'pdf') {
    if (evidence?.target === 'shipping-rate-clause' && !showNativePdf) return <>
      <div className="source-evidence__pdf-crop" data-testid="highlighted-source" aria-label="ตารางอัตราและวันที่เริ่มใช้จากหน้าสัญญาจริง">
        <svg viewBox="35 140 525 210" role="img" aria-label="ส่วนจริงของเอกสาร: วันเริ่มใช้ 15 ตุลาคม 2026 และอัตรากรุงเทพฯ 35 บาท ต่างจังหวัด 45 บาท">
          <image href={sourceUrl('shipping-contract-page.png')} x="0" y="0" width="595.276" height="841.89" />
          <rect x="40" y="146" width="515" height="198" rx="5" fill="#7056bd12" stroke="#7056bd" strokeWidth="3" />
        </svg>
      </div>
    </>;
    return <div className="source-preview__document-wrap">
      {!documentLoaded && <div className="source-preview__document-loading" role="status" aria-live="polite">กำลังเปิดเอกสาร PDF…</div>}
      <iframe
        className="source-preview__document"
        src={source.url}
        title={`ตัวอย่างเอกสาร ${source.fileName}`}
        loading="lazy"
        onLoad={() => setDocumentLoaded(true)}
        onError={() => onError(`เปิดเอกสาร PDF ${source.fileName} ไม่สำเร็จ`)}
      />
      {!source.local && <p className="source-preview__caption">เอกสารตัวอย่าง · เปิดอ่านได้ที่นี่ · ไม่เปลี่ยนกติกาที่ใช้อยู่</p>}
    </div>;
  }

  if (source.kind === 'image') {
    if (evidence?.target === 'encounter-scene') return <div data-testid="highlighted-source"><img className="source-preview__image" src={source.url} alt="ภาพฉากจริง: Mira ถือโล่, Pip ถือธนู, ก๊อบลินหนึ่งตัว" /><p className="source-preview__caption">Mira · โล่ → Pip · ธนู → ก๊อบลิน</p></div>;
    if (evidence?.target === 'quest-garden') return <>
      <div className="source-evidence__route-crop" data-testid="highlighted-source" aria-label="บริเวณจุดเริ่ม Garden บนแผนที่จริง">
        <svg viewBox="90 300 350 220" preserveAspectRatio="xMidYMid slice" role="img" aria-label="ภาพครอปของแผนที่จริงบริเวณจุดเริ่มสวน">
          <image href={source.url} x="0" y="0" width="1280" height="760" />
          <circle cx="236" cy="407" r="50" fill="#7056bd18" stroke="#7056bd" strokeWidth="7" />
        </svg>
      </div>
      <ol className="source-preview__stations source-preview__stations--evidence" aria-label="สามด่านในแผนที่ตัวอย่าง">
        <li data-narrative-field="station">ด่านสวน</li>
        <li data-narrative-field="station" data-narrative-record="library">ด่านห้องสมุด</li>
        <li data-narrative-field="station">ด่านกล่องสมบัติ</li>
      </ol>
    </>;
    return <div className="source-preview__image-wrap">
      <img className="source-preview__image" src={source.url} alt={caseId === 'quest' && source.id === 'quest-route' ? 'ฉากฮีโร่สองคนกับก๊อบลินหนึ่งตัว' : `ตัวอย่างรูปภาพ ${source.fileName}`} onError={() => onError(`เปิดรูปภาพ ${source.fileName} ไม่สำเร็จ`)} />
      {caseId === 'quest' && source.fileName === 'quest-route.svg' && <ol className="source-preview__stations" aria-label="สามด่านในแผนที่ตัวอย่าง">
        <li data-narrative-field="station">ด่านสวน</li>
        <li data-narrative-field="station" data-narrative-record="library">ด่านห้องสมุด</li>
        <li data-narrative-field="station">ด่านกล่องสมบัติ</li>
      </ol>}
    </div>;
  }

  if (source.kind === 'audio') {
    if (evidence?.target === 'music-phrase') return <div data-testid="highlighted-source" className="source-evidence__audio-target">
      <SourceWaveform src={source.url} />
    </div>;
    return <div className="source-preview__media-wrap">
      <audio className="source-preview__audio" src={source.url} controls preload="metadata" onPlay={onPlay} onSeeking={onPlay} onError={() => onError(`เล่นไฟล์เสียง ${source.fileName} ไม่สำเร็จ`)}>
        เบราว์เซอร์นี้ไม่รองรับเสียงตัวอย่าง
      </audio>
      {caseId === 'music' && source.id === 'music-audio' && <div className="source-preview__music-cue" data-narrative-record="MU-004">
        <span className="source-preview__music-cue-mark"><Music2 size={15} aria-hidden="true" /></span>
        <span><strong data-narrative-field="bpm">100 BPM · Chorus</strong><small>MU-004 · ผู้ซ้อมทำเครื่องหมายว่าเข้าช้า</small></span>
      </div>}
      <p className="source-preview__caption">เสียงตัวอย่างที่เตรียมไว้ · ไม่มีการวิเคราะห์เสียงอัตโนมัติ</p>
    </div>;
  }

  if (source.kind === 'video') {
    return <div className="source-preview__media-wrap">
      <video className="source-preview__video" src={source.url} controls preload="metadata" playsInline onPlay={onPlay} onSeeking={onPlay} onError={() => onError(`เล่นวิดีโอ ${source.fileName} ไม่สำเร็จ`)}>
        เบราว์เซอร์นี้ไม่รองรับวิดีโอตัวอย่าง
      </video>
      <p className="source-preview__caption">วิดีโอตัวอย่าง · กดเล่นเมื่อพร้อม</p>
    </div>;
  }

  if (source.kind === 'json' && preview.json !== undefined) {
    if (evidence?.target === 'encounter-note') {
      const root = jsonRecord(preview.json), trace = jsonRecord(root?.trace);
      return <><div className="source-evidence__json-excerpt" data-testid="highlighted-source" data-narrative-record="pip"><span className="source-evidence__json-key">TURN-01</span><span className="source-evidence__json-text">{String(trace?.observation ?? 'ไม่มีบันทึก')}</span></div><details className="source-evidence__json-raw" onToggle={event=>{if(event.currentTarget.open)onPlay();}}><summary>ดูแต้มเต๋าและกติกาต้นทาง</summary><pre>{JSON.stringify(preview.json,null,2)}</pre></details></>;
    }
    if (evidence?.target === 'quest-library-note') {
      const stations = jsonRecord(preview.json)?.stations;
      const library = Array.isArray(stations) ? stations.map(jsonRecord).find((station) => station?.id === 'library') : null;
      return <>
        <div className="source-evidence__json-excerpt" data-testid="highlighted-source" data-narrative-record="library">
          <span className="source-evidence__json-key">library</span>
          <span className="source-evidence__json-text">{String(library?.observation ?? 'ไม่พบหมายเหตุในไฟล์')}</span>
          <strong className="source-evidence__json-value">{String(library?.elapsedSeconds ?? '—')}s</strong>
        </div>
        <details className="source-evidence__json-raw" onToggle={(event) => { if (event.currentTarget.open) onPlay(); }}><summary>ดู JSON ต้นฉบับ</summary><pre>{JSON.stringify(preview.json, null, 2)}</pre></details>
      </>;
    }
    if (evidence?.target === 'music-mu004-note') {
      const root = jsonRecord(preview.json);
      const sections = Array.isArray(root?.sections) ? root.sections.map(jsonRecord) : [];
      const section = sections.find((item) => item?.id === 'MU-004');
      const annotations = Array.isArray(root?.annotations) ? root.annotations.map(jsonRecord) : [];
      const annotation = annotations.find((item) => item?.id === 'NOTE-MU-004-LATE');
      return <>
        <div className="source-evidence__json-excerpt" data-testid="highlighted-source" data-narrative-record="MU-004" data-source-annotation={String(annotation?.id ?? '')}>
          <span className="source-evidence__json-key">MU-004</span>
          <span className="source-evidence__json-text">{String(section?.feedback ?? 'ไม่พบหมายเหตุในไฟล์')}</span>
          <strong className="source-evidence__json-value">{String(section?.bpm ?? '—')} BPM</strong>
        </div>
        <details className="source-evidence__json-raw" onToggle={(event) => { if (event.currentTarget.open) onPlay(); }}><summary>ดู JSON ต้นฉบับ</summary><pre>{JSON.stringify(preview.json, null, 2)}</pre></details>
      </>;
    }
    return <div className="source-preview__json-wrap">
      <pre className="source-preview__json" aria-label={`เนื้อหา JSON จาก ${source.fileName}`}>{JSON.stringify(preview.json, null, 2)}</pre>
      <p className="source-preview__caption">{source.local ? 'แสดงโครงสร้าง JSON จากไฟล์ในเครื่อง' : 'ข้อมูลตัวอย่างแบบ JSON · ไม่ได้ตีความเป็นกติกา'}</p>
    </div>;
  }

  return <div className="source-preview__message" role="status">ไม่พบเนื้อหาสำหรับแสดงในไฟล์นี้</div>;
}

export default function SourcePreview({
  caseId,
  sourceCue,
  spotlight = false,
  visible = true,
  onInteract,
}: {
  caseId: CaseId;
  sourceCue?: SourceCue;
  spotlight?: boolean;
  visible?: boolean;
  onInteract?: () => void;
}) {
  const rootRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploadSequenceRef = useRef(0);
  const sheetReadRef = useRef<AbortController | null>(null);
  const localPreviewRef = useRef<Record<string, PreviewState>>({});
  const localIdRef = useRef(0);
  const defaultSourceId = SOURCE_FILES[caseId][0].id;
  const [selection, setSelection] = useState({ caseId, sourceId: defaultSourceId });
  const [localSource, setLocalSource] = useState<LocalSourceFile | null>(null);
  const [preview, setPreview] = useState<PreviewState>({ sourceId: defaultSourceId, status: 'loading' });
  const [uploadError, setUploadError] = useState('');
  const [readingFile, setReadingFile] = useState<{ sequence: number; name: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [cueDismissed, setCueDismissed] = useState(false);
  const [showNativePdf, setShowNativePdf] = useState(false);

  const showingCue = Boolean(sourceCue && !cueDismissed);
  const cueEvidence = showingCue && sourceCue ? sourceEvidence(caseId, sourceCue.purpose) : null;
  const sourceId = selection.caseId === caseId ? selection.sourceId : defaultSourceId;
  const effectiveSourceId = cueEvidence?.fileId ?? sourceId;
  const selectedLocal = selection.caseId === caseId && localSource?.id === effectiveSourceId ? localSource : null;
  const sampleSource = SOURCE_FILES[caseId].find((source) => source.id === effectiveSourceId) ?? SOURCE_FILES[caseId][0];
  const activeSource: SourceFile & { url: string } = selectedLocal ?? { ...sampleSource, url: sourceUrl(sampleSource.fileName) };
  const tabSources = localSource && selection.caseId === caseId ? [...SOURCE_FILES[caseId], localSource] : SOURCE_FILES[caseId];
  const panelId = `source-preview-panel-${caseId}`;
  const activeTabId = `source-preview-tab-${activeSource.id}`;
  const visiblePreview = activeSource.local
    ? localPreviewRef.current[activeSource.id] ?? { sourceId: activeSource.id, status: 'loading' as const }
    : preview.sourceId === activeSource.id ? preview : { sourceId: activeSource.id, status: 'loading' as const };

  useEffect(() => {
    if (!localSource) return;
    const url = localSource.url;
    return () => URL.revokeObjectURL(url);
  }, [localSource?.url]);

  useLayoutEffect(() => {
    uploadSequenceRef.current += 1; sheetReadRef.current?.abort();
    setSelection({ caseId, sourceId: SOURCE_FILES[caseId][0].id });
    setLocalSource(null);
    localPreviewRef.current = {};
    setUploadError('');
    setAttempt(0);
    return () => { uploadSequenceRef.current += 1; sheetReadRef.current?.abort(); };
  }, [caseId]);

  useEffect(() => {
    if (!sourceCue) return;
    const evidence = sourceEvidence(caseId, sourceCue.purpose);
    uploadSequenceRef.current += 1;
    sheetReadRef.current?.abort();
    setCueDismissed(false);
    setShowNativePdf(false);
    setUploadError('');
    setSelection((current) => current.caseId === caseId && current.sourceId === evidence.fileId
      ? current : { caseId, sourceId: evidence.fileId });
  }, [caseId, sourceCue]);

  useEffect(() => {
    if (activeSource.local) return;
    const controller = new AbortController();
    setPreview({ sourceId: activeSource.id, status: 'loading' });
    const read = async () => {
      const response = await fetch(activeSource.url, {
        signal: controller.signal,
        method: activeSource.kind === 'sheet' || activeSource.kind === 'json' ? 'GET' : 'HEAD',
      });
      if (!response.ok) throw new Error(`ไม่พบไฟล์ตัวอย่าง ${activeSource.fileName}`);
      if (activeSource.kind === 'sheet') {
        const text = await response.text();
        return { table: parseCsv(text, SHEET_BY_CASE[caseId]?.headers) };
      }
      if (activeSource.kind === 'json') return { json: await response.json() as unknown };
      return {};
    };
    read().then((payload) => {
      if (!controller.signal.aborted) setPreview({ sourceId: activeSource.id, status: 'ready', ...payload });
    }).catch((error: unknown) => {
      if (controller.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) return;
      setPreview({ sourceId: activeSource.id, status: 'error', message: loadErrorMessage(error, activeSource.fileName) });
    });
    return () => controller.abort();
  }, [activeSource.id, activeSource.url, activeSource.local, activeSource.kind, activeSource.fileName, attempt, caseId]);

  useEffect(() => {
    // Capture this render's media nodes. React can replace the tabpanel before an effect cleanup runs.
    const media = Array.from(rootRef.current?.querySelectorAll<HTMLMediaElement>('audio, video') ?? []);
    const pauseMedia = () => media.forEach((element) => element.pause());
    const onVisibilityChange = () => { if (document.hidden) pauseMedia(); };
    if (!visible || document.hidden) pauseMedia();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      pauseMedia();
    };
  }, [activeSource.id, visible, visiblePreview.status]);

  const selectSource = (nextId: string) => {
    uploadSequenceRef.current += 1; sheetReadRef.current?.abort();
    onInteract?.();
    rootRef.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause());
    setUploadError('');
    setCueDismissed(true);
    setShowNativePdf(false);
    setSelection({ caseId, sourceId: nextId });
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
    if (!tabs.length) return;
    const currentIndex = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (currentIndex + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    tabs[nextIndex].focus();
    tabs[nextIndex].click();
  };

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const sequence = ++uploadSequenceRef.current;
    sheetReadRef.current?.abort();
    onInteract?.();
    const kind = sourceKindFor(file);
    if (!kind) {
      setUploadError('ไฟล์นี้ยังไม่รองรับ · เลือก CSV, XLSX, PDF, รูปภาพ, เสียง, วิดีโอ หรือ JSON');
      return;
    }
    if (file.size === 0 || file.size > maxBytesFor(kind, file)) {
      setUploadError(file.size === 0 ? 'ไฟล์ว่างเปล่า · เลือกไฟล์ที่มีเนื้อหา' : `ไฟล์ใหญ่เกินขนาดที่เปิดได้สำหรับ ${KIND_LABEL[kind]}`);
      return;
    }

    setUploadError('');
    setReadingFile({ sequence, name: file.name });
    try {
      let table: CsvTable | undefined;
      let json: unknown;
      if (kind === 'sheet') {
        const controller = new AbortController();
        sheetReadRef.current = controller;
        table = await readLocalSheet(file, controller.signal);
      } else if (kind === 'json') {
        try {
          json = JSON.parse(await file.text()) as unknown;
        } catch {
          throw new Error('รูปแบบ JSON ไม่ถูกต้อง');
        }
      } else if (kind === 'pdf') {
        await validatePdfFile(file);
      }
      if (sequence !== uploadSequenceRef.current) return;
      const id = `local-${++localIdRef.current}`;
      const previewBlob = kind === 'pdf' ? file.slice(0, file.size, 'application/pdf') : file;
      const url = URL.createObjectURL(previewBlob);
      const uploaded: LocalSourceFile = { id, kind, fileName: file.name, label: 'ไฟล์ในเครื่อง', local: true, url };
      if (localSource) delete localPreviewRef.current[localSource.id];
      const loadedPreview: PreviewState = { sourceId: id, status: 'ready', table, json };
      localPreviewRef.current[id] = loadedPreview;
      setLocalSource(uploaded);
      setSelection({ caseId, sourceId: id });
      setPreview(loadedPreview);
    } catch (error) {
      if (sequence !== uploadSequenceRef.current) return;
      setUploadError(loadErrorMessage(error, file.name));
    } finally {
      setReadingFile((current) => current?.sequence === sequence ? null : current);
    }
  };

  const retryOrChooseAnother = () => {
    onInteract?.();
    if (activeSource.local) {
      setUploadError(`เลือกไฟล์อื่นแทน ${activeSource.fileName} ได้จากปุ่มเปิดไฟล์`);
      return;
    }
    setAttempt((value) => value + 1);
  };

  const markPreviewError = (message: string) => {
    setPreview((current) => {
      if (current.sourceId !== activeSource.id) return current;
      const failed: PreviewState = { sourceId: activeSource.id, status: 'error', message };
      if (activeSource.local) localPreviewRef.current[activeSource.id] = failed;
      return failed;
    });
  };

  const handleMediaPlay = () => {
    if (!visible) {
      rootRef.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach((media) => media.pause());
      return;
    }
    onInteract?.();
  };

  const openFullPreview = () => {
    onInteract?.();
    setCueDismissed(true);
    setShowNativePdf(true);
  };

  const content = (evidence?: SourceEvidence) => <SourceContent
    key={activeSource.id}
    caseId={caseId}
    source={activeSource}
    preview={visiblePreview}
    onError={markPreviewError}
    onRetry={retryOrChooseAnother}
    onPlay={handleMediaPlay}
    evidence={evidence}
    showNativePdf={showNativePdf}
  />;

  return (
    <section
      ref={rootRef}
      className={`source-preview${spotlight ? ' source-preview--spotlight' : ''}${showingCue ? ' source-preview--evidence' : ''}`}
      data-case={caseId}
      data-source-kind={activeSource.kind}
      data-source-local={activeSource.local ? 'true' : undefined}
      data-spotlight={spotlight ? 'true' : undefined}
      data-testid="source-preview"
      aria-label={`ไฟล์ต้นทาง ${activeSource.fileName}`}
    >
      {showingCue && cueEvidence ? <SourceEvidenceView cue={sourceCue!} evidence={cueEvidence} onFull={openFullPreview}>
        {content(cueEvidence)}
      </SourceEvidenceView> : <>
      <header className="source-preview__header">
        <span className="source-preview__icon"><KindIcon kind={activeSource.kind} /></span>
        <span className="source-preview__heading">
          <span className="source-preview__eyebrow">{activeSource.local ? 'LOCAL FILE · เปิดในเครื่องนี้' : 'SOURCE PREVIEW · ไฟล์ตัวอย่าง'}</span>
          <strong>{activeSource.fileName}</strong>
        </span>
        <a className="source-preview__download" href={activeSource.url} download={activeSource.fileName} aria-label={`ดาวน์โหลด ${activeSource.fileName}`}>
          <Download size={14} aria-hidden="true" /><span>บันทึก</span>
        </a>
      </header>

      <div className="source-preview__controls">
        <div className="source-preview__tabs" role="tablist" aria-label="เลือกไฟล์ต้นทาง" onKeyDown={handleTabKeyDown}>
          {tabSources.map((source) => (
            <button
              type="button"
              role="tab"
              id={`source-preview-tab-${source.id}`}
              aria-controls={panelId}
              aria-selected={activeSource.id === source.id}
              tabIndex={activeSource.id === source.id ? 0 : -1}
              className={`source-preview__tab${activeSource.id === source.id ? ' is-active' : ''}`}
              key={source.id}
              onClick={() => selectSource(source.id)}
            >
              <span className="source-preview__tab-kind">{KIND_SHORT_LABEL[source.kind]}</span>
              <span>{source.local ? source.fileName : source.label}</span>
            </button>
          ))}
        </div>
        <button
          className="source-preview__upload"
          type="button"
          aria-label="เปิดไฟล์ CSV, Excel, PDF, รูปภาพ, เสียง, วิดีโอ หรือ JSON"
          title="รองรับ CSV · Excel · PDF · รูปภาพ · เสียง · วิดีโอ · JSON"
          onClick={() => { uploadSequenceRef.current += 1; sheetReadRef.current?.abort(); onInteract?.(); inputRef.current?.click(); }}
        >
          <Upload size={14} aria-hidden="true" /><span>เปิดไฟล์</span>
        </button>
        <input
          ref={inputRef}
          className="source-preview__file-input"
          type="file"
          accept=".csv,.xlsx,.pdf,.png,.jpg,.jpeg,.webp,.svg,.wav,.mp3,.ogg,.m4a,.aac,.flac,.mp4,.webm,.mov,.ogv,.json,text/csv,application/pdf,image/*,audio/*,video/*,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => { void handleFile(event); }}
        />
      </div>

      {uploadError && <p className="source-preview__upload-error" role="alert"><AlertCircle size={13} aria-hidden="true" />{uploadError}</p>}
      {readingFile?.sequence === uploadSequenceRef.current && <p className="source-preview__caption" role="status">กำลังเปิด {readingFile.name}…</p>}

      <div className="source-preview__body" id={panelId} role="tabpanel" aria-labelledby={activeTabId} tabIndex={0}>
        {content()}
      </div>

      <footer className="source-preview__trust-note">
        <span>{activeSource.local ? 'เปิดในเบราว์เซอร์นี้เท่านั้น · ไม่มีการส่งไฟล์ออก' : 'ข้อมูลตัวอย่างสมมติ · ใช้ดูประกอบ ไม่เปลี่ยนกติกาเดโม'}</span>
      </footer>
      </>}
    </section>
  );
}

