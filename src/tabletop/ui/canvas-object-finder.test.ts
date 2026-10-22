import { describe, expect, it } from 'vitest';
import { matchCanvasObjects, parseCanvasObjectCommand } from './canvas-object-finder';

const cards = [
  { id: 'table.rules', title: 'Rules' },
  { id: 'table.collection.submissions', title: 'คำตอบที่ส่ง' },
  { id: 'table.view.controls', title: 'ทำแบบฝึกหัดและเพิ่มโจทย์' },
  { id: 'table.view.board', title: 'โจทย์แบบฝึกหัด' },
  { id: 'workspace.history', title: 'Table history' },
];

describe('canvas object commands in chat', () => {
  it('recognises Thai and English open, find and hide commands', () => {
    expect(parseCanvasObjectCommand('เปิดการ์ด คำตอบที่ส่ง')).toEqual({ verb: 'open', query: 'คำตอบที่ส่ง' });
    expect(parseCanvasObjectCommand('หาโจทย์แบบฝึกหัด')).toEqual({ verb: 'open', query: 'โจทย์แบบฝึกหัด' });
    expect(parseCanvasObjectCommand('open rules')).toEqual({ verb: 'open', query: 'rules' });
    expect(parseCanvasObjectCommand('ซ่อนการ์ด Table history')).toEqual({ verb: 'hide', query: 'Table history' });
    expect(parseCanvasObjectCommand('ทำไมข้อ 2 ผิด')).toBeNull();
  });

  it('ranks an exact title first and understands aliases', () => {
    expect(matchCanvasObjects(cards, 'คำตอบที่ส่ง')[0].id).toBe('table.collection.submissions');
    expect(matchCanvasObjects(cards, 'โจทย์')[0].id).toBe('table.view.board');
    expect(matchCanvasObjects(cards, 'กฎ')[0].id).toBe('table.rules');
    expect(matchCanvasObjects(cards, 'ประวัติ')[0].id).toBe('workspace.history');
    expect(matchCanvasObjects(cards, 'ไม่มีการ์ดนี้')).toEqual([]);
  });
});

describe('chat card references', () => {
  it('treats a change asked about a referenced card as a rule edit, and a question as a question', async () => {
    const { tableChatMode } = await import('./table-chat-state');
    const ask = (prompt: string, referencedCard: boolean) => tableChatMode('owner', true, false, { prompt, hasCreateAction: false, referencedCard });
    expect(ask('เพิ่มระดับความยาก', true)).toBe('draft');
    expect(ask('make it harder', true)).toBe('draft');
    expect(ask('ทำไมข้อ 2 ผิด', true)).toBe('ask');
    expect(ask('เพิ่มระดับความยาก', false)).toBe('ask');
  });
});
