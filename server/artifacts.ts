import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, type ActorContext, type Artifact, type InvoiceLine, type Shipment, type SourcePage } from '../src/tabletop/shared/contracts.js';
import type { PrivateObjectStore } from './storage.js';
const uploadSchema = z.strictObject({ filename: z.string().min(1).max(200), mime: z.string().max(100), kind: z.enum(['shipments','invoice','rate-card','excerpt']), dataBase64: z.string().max(14_000_000) });
export interface ProcessedUpload { artifact: Artifact; shipments?: Shipment[]; invoiceLines?: InvoiceLine[] }
export function csvRows(text: string): string[][] {
  if (text.length > 5 * 1024 * 1024 || text.includes('\0')) throw new DomainError('CSV_SIZE', 'CSV ต้องไม่เกิน 5 MiB และต้องเป็นข้อความ UTF-8');
  const rows: string[][] = []; let row: string[] = [], value = '', quoted = false, endedQuote = false;
  const field = () => { if (value.length > 10000 || row.length >= 64) throw new DomainError('CSV_LIMIT', 'CSV มีช่องข้อมูลยาวหรือจำนวนคอลัมน์เกินขอบเขต'); row.push(value); value = ''; endedQuote = false };
  const line = () => { field(); if (row.some(v => v !== '')) rows.push(row); row = []; if (rows.length > 10001) throw new DomainError('ROW_LIMIT', 'รองรับไม่เกิน 10,000 รายการ') };
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { if (c === '"') { if (text[i+1] === '"') { value += '"'; i++ } else { quoted = false; endedQuote = true } } else value += c; continue }
    if (c === ',' ) { field(); continue }
    if (c === '\n' || c === '\r') { if (c === '\r' && text[i+1] === '\n') i++; line(); continue }
    if (c === '"' && !value && !endedQuote) { quoted = true; continue }
    if (c === '"' || endedQuote) throw new DomainError('CSV_QUOTES', 'รูปแบบเครื่องหมายคำพูดใน CSV ไม่ถูกต้อง');
    value += c;
  }
  if (quoted) throw new DomainError('CSV_QUOTES', 'CSV มีเครื่องหมายคำพูดที่ยังไม่ปิด');
  if (value || row.length) line();
  if (rows.length < 2) throw new DomainError('CSV_EMPTY', 'CSV ต้องมีหัวคอลัมน์และรายการอย่างน้อยหนึ่งแถว');
  return rows;
}
function records(text: string, required: string[]) {
  const [header, ...rows] = csvRows(text); const normalized = header.map(h => h.trim().toLowerCase());
  if (new Set(normalized).size !== normalized.length || required.some(h => !normalized.includes(h))) throw new DomainError('CSV_COLUMNS', `ต้องมีคอลัมน์ ${required.join(', ')} และห้ามซ้ำ`);
  return rows.map((row, index) => { if (row.length !== normalized.length) throw new DomainError('CSV_COLUMNS', `จำนวนช่องไม่ตรงหัวคอลัมน์ที่แถว ${index+2}`); return { values: Object.fromEntries(normalized.map((key, n) => [key, row[n].trim()])), row: index+2 } });
}
function amount(value: string): number | null { if (!value) return null; if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(value)) throw new DomainError('AMOUNT_FORMAT', 'ยอดเงินต้องเป็นจำนวนไม่ติดลบและทศนิยมไม่เกินสองตำแหน่ง'); const [whole, decimals=''] = value.split('.'); const result = Number(whole)*100 + Number(decimals.padEnd(2,'0')); if (!Number.isSafeInteger(result)) throw new DomainError('AMOUNT_RANGE','ยอดเงินเกินขอบเขต'); return result }
function date(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10)!==value) throw new DomainError('DATE_FORMAT','วันที่ต้องเป็น YYYY-MM-DD ที่มีอยู่จริง'); return value }
function identifier(value: string) { const normalized = value.normalize('NFC').trim(); if (!normalized || normalized.length > 100 || /[\x00-\x1f]/.test(normalized)) throw new DomainError('SHIPMENT_ID','shipment_id ต้องไม่ว่างและไม่เกิน 100 ตัวอักษร'); return normalized }
export function shipmentsFromCsv(text: string, sourceId: string): Shipment[] {
  return records(text, ['shipment_id','zone','service_date','weight_gram','remote']).map(({values:v,row}) => {
    if (v.weight_gram && !/^\d{1,8}$/.test(v.weight_gram)) throw new DomainError('WEIGHT_FORMAT',`น้ำหนักแถว ${row} ต้องเป็นจำนวนกรัมเต็มที่ไม่ติดลบ`);
    if (!['true','false','1','0',''].includes(v.remote.toLowerCase())) throw new DomainError('REMOTE_FORMAT',`remote แถว ${row} ต้องเป็น true หรือ false`);
    return { id:identifier(v.shipment_id),zone:v.zone==='bangkok'||v.zone==='regional'?v.zone:null,date:date(v.service_date),weightGram:v.weight_gram?Number(v.weight_gram):null,remote:['true','1'].includes(v.remote.toLowerCase()),sourceId,row };
  });
}
export function invoiceFromCsv(text: string, sourceId: string): InvoiceLine[] {
  return records(text, ['shipment_id','billed_thb','currency']).map(({values:v,row}) => ({id:identifier(v.shipment_id),billedSatang:amount(v.billed_thb),currency:v.currency.toUpperCase(),sourceId,row}));
}
function parsePdf(data: Uint8Array): Promise<SourcePage[]> {
  return new Promise((resolve,reject) => {
    const child = fork(fileURLToPath(new URL('./pdf-worker.mjs',import.meta.url)), { execArgv:['--max-old-space-size=128'], stdio:['ignore','ignore','ignore','ipc'], windowsHide:true });
    let finished=false;
    const finish = (error?: Error, pages?: SourcePage[]) => { if(finished)return; finished=true;clearTimeout(timer);child.kill();if(error)reject(error);else resolve(pages!) };
    const timer=setTimeout(()=>finish(new DomainError('PDF_TIMEOUT','อ่าน PDF ไม่สำเร็จภายใน 10 วินาที กรุณาใช้ template หรือ excerpt')),10_000);
    child.once('error',()=>finish(new DomainError('PDF_PARSER','เปิดตัวอ่าน PDF ไม่สำเร็จ')));
    child.once('exit',()=>{if(!finished)finish(new DomainError('PDF_PARSER','ตัวอ่าน PDF หยุดทำงาน กรุณาตรวจรูปแบบไฟล์'))});
    child.on('message',(result:unknown)=>{const schema=z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),pages:z.array(z.strictObject({number:z.number().int().min(1).max(20),text:z.string().max(250000)})).min(1).max(20)}),z.strictObject({ok:z.literal(false),code:z.string()})]); const parsed=schema.safeParse(result);if(!parsed.success)finish(new DomainError('PDF_PARSER','ผลการอ่าน PDF ไม่ถูกต้อง'));else if(parsed.data.ok)finish(undefined,parsed.data.pages);else finish(new DomainError(parsed.data.code,'รองรับ text PDF ไม่เข้ารหัส ไม่เกิน 20 หน้า และไม่มี script/attachment; ใช้ template หรือข้อความที่ตรวจแล้ว'))});
    child.send({data:Buffer.from(data).toString('base64')});
  });
}
export async function processUpload(raw: unknown, context: ActorContext, store: PrivateObjectStore): Promise<ProcessedUpload> {
  const parsed=uploadSchema.safeParse(raw); if(!parsed.success)throw new DomainError('UPLOAD_INPUT','ข้อมูลไฟล์ไม่ครบหรือเกินขอบเขต');
  const input=parsed.data;
  if(!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.dataBase64))throw new DomainError('UPLOAD_ENCODING','ข้อมูลไฟล์ไม่ใช่ base64 ที่ถูกต้อง');
  const data=Buffer.from(input.dataBase64,'base64'), ext=path.extname(input.filename).toLowerCase();
  if(!data.length)throw new DomainError('UPLOAD_EMPTY','ไฟล์ไม่มีข้อมูล');
  const pdf=ext==='.pdf'; const csv=ext==='.csv'; const txt=ext==='.txt';
  if((!pdf&&!csv&&!txt)||(pdf&&input.mime!=='application/pdf')||(csv&&!['text/csv','application/vnd.ms-excel','text/plain',''].includes(input.mime))||(txt&&!['text/plain',''].includes(input.mime)))throw new DomainError('UPLOAD_TYPE','รองรับ CSV, text PDF และข้อความ .txt ตาม template เท่านั้น');
  if(data.length>(pdf?10:csv?5:.25)*1024*1024)throw new DomainError('UPLOAD_SIZE','ไฟล์ใหญ่เกินขอบเขต CSV 5 MiB, PDF 10 MiB, excerpt 256 KiB');
  if(input.kind==='shipments'&&!csv)throw new DomainError('UPLOAD_TYPE','รายการขนส่งต้องเป็น CSV');
  if(pdf&&!data.subarray(0,8).toString('ascii').startsWith('%PDF-'))throw new DomainError('PDF_MAGIC','เนื้อหาไฟล์ไม่ใช่ PDF');
  if(!pdf&&(data.includes(0)||data.subarray(0,8).toString('ascii').startsWith('%PDF-')))throw new DomainError('UPLOAD_TYPE','ชนิดไฟล์ไม่ตรงกับเนื้อหา');
  const stored=await store.put(data);
  try {
    const text=pdf?'':new TextDecoder('utf-8',{fatal:true}).decode(data);
    const pages=pdf?await parsePdf(data):[{number:1,text:text.slice(0,100_000)}];
    const artifact:Artifact={id:stored.key,filename:path.basename(input.filename).replace(/[\x00-\x1f]/g,'').slice(0,120),kind:input.kind,status:'provided',sha256:stored.sha256,pages,excerpt:pages.map(p=>p.text).join('\n').slice(0,20000),createdAt:context.now};
    if(input.kind==='shipments')return{artifact,shipments:shipmentsFromCsv(text,artifact.id)};
    if(input.kind==='invoice'){
      const content=pages.map(p=>p.text).join('\n');
      if(pdf&&!content.includes('TABLETOP INVOICE V1'))throw new DomainError('PDF_TEMPLATE','Invoice PDF ต้องใช้ TABLETOP INVOICE V1 template; ดูตัวอย่างหรือใช้ CSV');
      const start=content.toLowerCase().indexOf('shipment_id,');if(start<0)throw new DomainError('INVOICE_TEMPLATE','ไม่พบตาราง shipment_id,billed_thb,currency');
      return{artifact,invoiceLines:invoiceFromCsv(content.slice(start).trim(),artifact.id)};
    }
    if(artifact.excerpt.trim().length<10)throw new DomainError('EVIDENCE_EMPTY','หลักฐานต้องมีข้อความที่อ่านและตรวจได้');
    return{artifact};
  }catch(error){await store.remove(stored.key);if(error instanceof DomainError)throw error;throw new DomainError('UPLOAD_PARSE','อ่านไฟล์ไม่ได้ กรุณาตรวจ UTF-8 หรือใช้ template ที่รองรับ')}
}
export function excerptUpload(text:string){return{filename:'reviewed-excerpt.txt',mime:'text/plain',kind:'excerpt' as const,dataBase64:Buffer.from(text).toString('base64')}}
export function artifactFingerprint(data:Uint8Array){return createHash('sha256').update(data).digest('hex')}
