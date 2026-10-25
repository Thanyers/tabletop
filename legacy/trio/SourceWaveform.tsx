import { useEffect, useState } from 'react';

export function SourceWaveform({ src }: { src: string }) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    let context: AudioContext | null = null;
    setPeaks(null);
    const decode = async () => {
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error('audio unavailable');
        const bytes = await response.arrayBuffer();
        context = new AudioContext();
        const decoded = await context.decodeAudioData(bytes.slice(0));
        const channel = decoded.getChannelData(0);
        const count = 56;
        const data = Array.from({ length: count }, (_, index) => {
          const start = Math.floor(index * channel.length / count);
          const end = Math.max(start + 1, Math.floor((index + 1) * channel.length / count));
          let max = 0;
          for (let sample = start; sample < end; sample += 1) max = Math.max(max, Math.abs(channel[sample] ?? 0));
          return Math.max(2, Math.round(max * 27));
        });
        if (!cancelled) setPeaks(data);
      } catch {
        if (!cancelled) setPeaks([]);
      } finally {
        await context?.close().catch(() => undefined);
      }
    };
    void decode();
    return () => { cancelled = true; void context?.close().catch(() => undefined); };
  }, [src]);

  if (peaks === null) return <div className="source-evidence__wave" role="status">กำลังอ่านคลื่นจากไฟล์เสียง…</div>;
  if (!peaks.length) return <div className="source-evidence__wave" role="status">แสดงคลื่นเสียงไม่ได้ในเบราว์เซอร์นี้</div>;
  return <div className="source-evidence__wave" aria-label="รูปคลื่นที่ถอดจากข้อมูลเสียงตัวอย่าง">
    <svg viewBox="0 0 560 34" preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((height, index) => <rect key={index} x={index * 10 + 2} y={(34 - height) / 2} width="5" height={height} rx="2.5" fill="currentColor" opacity={index % 7 === 0 ? 0.88 : 0.52} />)}
    </svg>
    <span className="source-evidence__beats" aria-hidden="true">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</span>
    <small>ไฟล์เสียง 4.8 วินาที · 100 BPM · 8 beats · ไม่ได้วิเคราะห์ว่าเข้าช้าหรือเร็ว</small>
  </div>;
}
