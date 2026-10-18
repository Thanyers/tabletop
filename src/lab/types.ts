export type LabSettings = { bpm: number; toleranceMs: number; splitHands: boolean; appearance: string };
export type TapRecord = { id: string; hand: 'left' | 'right' | 'both'; offsetMs: number; at: number };
export type LabState = { settings: LabSettings; history: TapRecord[] };
export type GeneratedComponent = { title: string; explanation: string; html: string; css: string; js: string; settings: LabSettings };
export type LabRevision = { id: string; artifact: GeneratedComponent; prompt: string; modelMs: number; previewMs: number; checks: string[]; createdAt: string };
export const initialLabState = (): LabState => ({ settings: { bpm: 100, toleranceMs: 80, splitHands: false, appearance: 'light' }, history: [] });
export const LAB_START_PROMPT = 'สร้างแผ่นให้เคาะตามจังหวะ 100 BPM แล้วบอกว่าแต่ละครั้งเร็วหรือช้าไปกี่มิลลิวินาที มีไฟบอกจังหวะ ปุ่มเริ่มและหยุด และผลย้อนหลัง ออกแบบให้น่าเล่น เข้าใจง่าย เบสขาว มีเอกลักษณ์';
