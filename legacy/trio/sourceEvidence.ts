import type { CaseId } from './types';

export type SourceCue = { purpose: 'create' | 'revise'; beat: 'locate' | 'understand' | 'connect' };
export type SourceEvidence = {
  fileId: string;
  location: string;
  observation: string;
  meaning: string;
  effect: string;
  targetLabel: string;
  target: 'shipping-row' | 'shipping-rate-clause' | 'quest-garden' | 'quest-library-note' | 'encounter-scene' | 'encounter-note' | 'music-phrase' | 'music-mu004-note';
};

const EVIDENCE: Record<CaseId, Record<'create' | 'revise', SourceEvidence>> = {
  shipping: {
    create: {
      fileId: 'shipping-sheet', location: 'shipping-orders.csv · SH-001',
      observation: '15 ต.ค. · กรุงเทพฯ · 1 กก. · ยอดเดิม ฿40',
      meaning: 'แถวนี้เป็นตัวอย่างยอดเดิมสำหรับเทียบกับเงื่อนไขค่าจัดส่ง',
      effect: 'ตารางเทียบยอดค่าส่ง', targetLabel: 'SH-001 · ฿40', target: 'shipping-row',
    },
    revise: {
      fileId: 'shipping-contract-pdf', location: 'shipping-contract.pdf · ตารางอัตรา',
      observation: 'เริ่ม 15 ต.ค. 2026 · กรุงเทพฯ ฿35 · ต่างจังหวัด ฿45',
      meaning: 'ใช้อัตราใหม่นับจาก 15 ต.ค.; วันก่อนหน้ายังคงอัตราเดิม',
      effect: 'ร่างอัตรา ฿35 / ฿45 + วันเริ่ม 15 ต.ค.', targetLabel: '฿35 / ฿45 · 15 ต.ค.', target: 'shipping-rate-clause',
    },
  },
  quest: {
    create: {
      fileId: 'quest-route', location: 'encounter-scene.svg · Mira / Pip / Goblin',
      observation: 'ฮีโร่สองคน · โล่และธนู · ก๊อบลินหนึ่งตัว',
      meaning: 'แยกบทบาทคนถือโล่กับคนยิงธนู แล้วให้ศัตรูตอบโต้ในตาเดียวกัน',
      effect: 'กระดานที่เล่นได้ + ลูกเต๋า + HP', targetLabel: '2 ฮีโร่ · 1 ศัตรู', target: 'encounter-scene',
    },
    revise: {
      fileId: 'quest-notes', location: 'encounter-notes.json · TURN-01',
      observation: 'Mira ยกโล่ แต่ Pip ยังโดนโจมตีเต็มจำนวน',
      meaning: 'กฎเดิมช่วยเฉพาะคนถือโล่ จึงยังกันให้เพื่อนไม่ได้',
      effect: 'ร่างโล่ช่วยเพื่อน ลดความเสียหาย 2 HP', targetLabel: 'TURN-01 · shieldTarget: self', target: 'encounter-note',
    },
  },
  music: {
    create: {
      fileId: 'music-audio', location: 'music-rehearsal.wav · 0.0–4.8 วินาที',
      observation: 'ตัวอย่างเสียง 100 BPM · 8 beats · ยาว 4.8 วินาที',
      meaning: 'แต่ละจังหวะห่าง 0.6 วินาที จึงใช้เวลาเดียวกันกับคลื่นและไฟนับจังหวะ',
      effect: 'คลื่นเสียง + ไฟนับจังหวะ', targetLabel: 'ตัวอย่าง · 8 beats', target: 'music-phrase',
    },
    revise: {
      fileId: 'music-notes', location: 'music-notes.json · MU-004 / NOTE-MU-004-LATE',
      observation: 'Chorus · 100 BPM · 8 beats · มีบันทึกว่า “เข้าช้า”',
      meaning: 'ปัญหาถูกระบุเฉพาะฮุก จึงแยกความเร็วและจำนวนรอบจากท่อนอื่น',
      effect: 'เสนอฮุก 80 BPM ×3 · ท่อนอื่น 100', targetLabel: 'MU-004 · Chorus', target: 'music-mu004-note',
    },
  },
};

export function sourceEvidence(caseId: CaseId, purpose: SourceCue['purpose']): SourceEvidence {
  return EVIDENCE[caseId][purpose];
}
