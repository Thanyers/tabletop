import type { CaseKind } from '../shared/contracts';

export type PracticeFileKind = 'shipments' | 'invoice' | 'rate-card' | 'teaching-lesson' | 'encounter-plan';

export interface PracticeSampleFile {
  id: string;
  kind: CaseKind;
  fileKind: PracticeFileKind;
  filename: string;
  description: string;
  text: string;
}

export const PRACTICE_SAMPLE_FILES: readonly PracticeSampleFile[] = [
  {
    id: 'invoice-shipments',
    kind: 'invoice',
    fileKind: 'shipments',
    filename: 'october-shipments.csv',
    description: 'พัสดุตัวอย่าง 4 รายการ พร้อมวันที่ น้ำหนัก และพื้นที่จัดส่ง',
    text: [
      'shipment_id,zone,service_date,weight_gram,remote',
      'S-BKK-1100,bangkok,2026-10-15,1100,false',
      'S-BKK-1000,bangkok,2026-10-14,1000,false',
      'S-BKK-REMOTE-1100,bangkok,2026-10-20,1100,true',
      'S-REMOTE-1100,regional,2026-10-20,1100,true',
      '',
    ].join('\n'),
  },
  {
    id: 'invoice-lines',
    kind: 'invoice',
    fileKind: 'invoice',
    filename: 'october-invoice.csv',
    description: 'ยอดเรียกเก็บตัวอย่าง หน่วยบาท เชื่อมกับรหัสพัสดุ',
    text: [
      'shipment_id,billed_thb,currency',
      'S-BKK-1100,50.00,THB',
      'S-BKK-1000,40.00,THB',
      'S-BKK-REMOTE-1100,60.00,THB',
      'S-REMOTE-1100,70.00,THB',
      '',
    ].join('\n'),
  },
  {
    id: 'invoice-rate-card',
    kind: 'invoice',
    fileKind: 'rate-card',
    filename: 'synthetic-rate-card.csv',
    description: 'อัตราฐานและน้ำหนักส่วนเกิน ยังขาดหลักฐานค่าพื้นที่ห่างไกลให้ลองตรวจ',
    text: [
      'rule_kind,zone,amount_thb,effective_from,effective_to',
      'base,bangkok,40.00,2000-01-01,2026-10-14',
      'base,bangkok,35.00,2026-10-14,',
      'base,regional,50.00,2000-01-01,2026-10-15',
      'base,regional,45.00,2026-10-15,',
      'step,*,10.00,2000-01-01,',
      '',
    ].join('\n'),
  },
  {
    id: 'teaching-physics',
    kind: 'teaching',
    fileKind: 'teaching-lesson',
    filename: 'shared-physics-lesson.json',
    description: 'โจทย์ทดลอง แรง 10 N มวล 5 kg และเวลา 2 วินาที',
    text: JSON.stringify({ kind: 'teaching-lesson', version: 1, parameters: { force: 10, mass: 5, time: 2 } }, null, 2),
  },
  {
    id: 'encounter-shield',
    kind: 'encounter',
    fileKind: 'encounter-plan',
    filename: 'shield-plan.json',
    description: 'ข้อเสนอกฎโล่ป้องกันเพื่อน พร้อมเป้าหมายให้ลองเล่น',
    text: JSON.stringify({
      kind: 'encounter-plan',
      version: 1,
      rule: { allyTarget: true, apCost: 1, oncePerTurn: true },
      target: 'pip',
    }, null, 2),
  },
];

export function sampleFilesForCase(kind: CaseKind): readonly PracticeSampleFile[] {
  return PRACTICE_SAMPLE_FILES.filter((sample) => sample.kind === kind);
}

export function findPracticeSample(sampleId: string, kind: CaseKind): PracticeSampleFile | undefined {
  return PRACTICE_SAMPLE_FILES.find((sample) => sample.id === sampleId && sample.kind === kind);
}
