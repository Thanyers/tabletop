import type {CaseId} from './types';
export const HANDOFF_ITEMS:Record<CaseId,{id:string;label:string;detail:string}>={
 shipping:{id:'SH-006',label:'พัสดุรอชั่งน้ำหนัก',detail:'ขอน้ำหนักของพัสดุ SH-006 ก่อนตรวจค่าส่ง ยอดที่ถูกคิดเดิม 50 บาทยังเก็บไว้'},
 quest:{id:'Q-ENCOUNTER-BALANCE',label:'รอเพื่อนลองความยากของฉาก',detail:'ผลเต๋าชุดเดิมยืนยันผลของโล่ได้ แต่ความสนุกและความยากต้องให้คนลองเล่นจริงก่อนแชร์วงกว้าง'},
 music:{id:'M-CHORUS-PLAYER',label:'รอคนเล่นท่อนฮุกยืนยันรอบซ้อม',detail:'ฝากท่อนฮุก 80 BPM จำนวน 3 รอบ ให้คนเล่นท่อนนี้ลองและยืนยันก่อนซ้อมร่วมกัน'},
};
