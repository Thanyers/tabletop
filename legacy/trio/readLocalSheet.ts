import type { CsvTable } from './sourceTable';

export function readLocalSheet(file: File, signal: AbortSignal): Promise<CsvTable> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    const worker = new Worker(new URL('./sourceSheet.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => { worker.terminate(); signal.removeEventListener('abort', abort); };
    const abort = () => { finish(); reject(new DOMException('Cancelled', 'AbortError')); };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = (event: MessageEvent<{ table?: CsvTable; error?: string }>) => {
      finish();
      if (event.data.table) resolve(event.data.table);
      else reject(new Error(event.data.error ?? 'อ่านชีตนี้ไม่ได้'));
    };
    worker.onerror = () => { finish(); reject(new Error('อ่านชีตนี้ไม่ได้ · ลองเลือกไฟล์อีกครั้ง')); };
    worker.postMessage(file);
  });
}
