import { readSheet } from 'read-excel-file/web-worker';
import { parseCsv, tableFromRows } from './sourceTable';

// Parse in isolation; only the bounded preview crosses back to the UI thread.
self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data;
    const table = file.name.toLowerCase().endsWith('.xlsx')
      ? tableFromRows(await readSheet(file))
      : parseCsv(await file.text());
    self.postMessage({ table });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'อ่านชีตนี้ไม่ได้' });
  }
};
