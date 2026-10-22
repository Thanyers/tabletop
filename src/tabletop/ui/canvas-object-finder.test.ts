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

describe('where-is questions and referenced titles', () => {
  const views = [
    { id: 'table.view.flow_scene', title: 'BPMN 3 Swimlane ของขั้นตอนก่อนเริ่มงานก่อสร้าง' },
    { id: 'table.view.days_chart', title: 'จำนวนวันโดยประมาณต่อขั้นตอน' },
    { id: 'table.collection.steps', title: 'ขั้นตอน' },
  ];

  it('treats "X อยู่ไหน" and "where is X" as a find', () => {
    expect(parseCanvasObjectCommand('bpmn อยู่ไหน')).toEqual({ verb: 'open', query: 'bpmn' });
    expect(parseCanvasObjectCommand('การ์ดจำนวนวันอยู่ตรงไหน?')).toEqual({ verb: 'open', query: 'จำนวนวัน' });
    expect(parseCanvasObjectCommand('where is the BPMN chart?')).toEqual({ verb: 'open', query: 'BPMN chart' });
  });

  it('finds a card despite a one-letter typo', () => {
    expect(matchCanvasObjects(views, 'bpnn')[0]?.id).toBe('table.view.flow_scene');
    expect(matchCanvasObjects(views, 'จำนวนวัน')[0]?.id).toBe('table.view.days_chart');
    expect(matchCanvasObjects(views, 'xyz')).toEqual([]);
  });

  it('shows a referenced message without the wrapping, keeping the innermost card name', async () => {
    const { splitReferencedPrompt } = await import('./canvas-object-finder');
    expect(splitReferencedPrompt('[การ์ด “[การ์ด “bpnn อยู่ไหน”] bpmn อยู่ไหน”] เปิดให้หน่อย\n(Card in question: …)')).toEqual({ reference: 'bpnn อยู่ไหน', message: 'เปิดให้หน่อย' });
    expect(splitReferencedPrompt('ปกติ')).toEqual({ reference: null, message: 'ปกติ' });
  });

  it('a picked follow-up keeps the card the question was about', async () => {
    const { chatReferencePrompt, followUpPrompt, splitReferencedPrompt } = await import('./canvas-object-finder');
    const original = chatReferencePrompt({ id: 'x', title: 'BPMN', detail: 'view flow_scene' }, 'มีนาฬิกาไหม');
    const next = followUpPrompt(original, 'ใส่นาฬิกาข้างชื่อขั้นตอน');
    expect(splitReferencedPrompt(next)).toEqual({ reference: 'BPMN', message: 'ใส่นาฬิกาข้างชื่อขั้นตอน' });
    expect(next).toContain('(Card in question: view flow_scene)');
    expect(followUpPrompt('ปกติ', 'ต่อเลย')).toBe('ต่อเลย');
  });
});
