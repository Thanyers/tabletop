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

  it('keeps a specific rule reference through chat serialization and follow-ups', async () => {
    const { chatReferencePrompt, followUpPrompt, parseReferencedPrompt, splitReferencedPrompt } = await import('./canvas-object-finder');
    const reference = {
      id: 'rule:action:approve_order',
      title: 'Rule · Approve order',
      detail: 'action approve_order',
      rule: { kind: 'action' as const, id: 'approve_order' },
    };
    const prompt = chatReferencePrompt(reference, 'Make this easier to understand');

    expect(prompt).toContain('[[table-rule:action:approve_order]]');
    expect(prompt).toContain('[การ์ด “Rule · Approve order”] Make this easier to understand');
    expect(splitReferencedPrompt(prompt)).toEqual({ reference: 'Rule · Approve order', message: 'Make this easier to understand' });
    expect(parseReferencedPrompt(prompt)).toEqual({
      references: [reference],
      message: 'Make this easier to understand',
    });
    const next = followUpPrompt(prompt, 'Use simpler words');
    expect(parseReferencedPrompt(next)).toMatchObject({
      references: [reference],
      message: 'Use simpler words',
    });
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

  it('several referenced cards: one line each, titles joined, follow-ups keep all of them, long details fit the prompt limit', async () => {
    const { chatReferencePrompt, followUpPrompt, splitReferencedPrompt } = await import('./canvas-object-finder');
    const refs = [
      { id: 'a', title: 'BPMN', detail: 'view flow_scene' },
      { id: 'b', title: 'Steps', detail: `data table steps ${'f'.repeat(3000)}` },
      { id: 'c', title: 'Days', detail: 'chart days_chart' },
    ];
    const prompt = chatReferencePrompt(refs, 'เทียบให้หน่อย');
    expect(prompt.startsWith('[การ์ด “BPMN” + “Steps” + “Days”] เทียบให้หน่อย\n(Cards in question:\n1. view flow_scene\n2. data table steps')).toBe(true);
    expect(prompt.length).toBeLessThanOrEqual(4000);
    expect(splitReferencedPrompt(prompt)).toEqual({ reference: 'BPMN, Steps, Days', message: 'เทียบให้หน่อย' });
    const next = followUpPrompt(prompt, 'ต่อเลย');
    expect(splitReferencedPrompt(next)).toEqual({ reference: 'BPMN, Steps, Days', message: 'ต่อเลย' });
    expect(next).toContain('3. chart days_chart');
    expect(chatReferencePrompt([], 'plain')).toBe('plain');
    expect(chatReferencePrompt(refs[0], 'one')).toBe('[การ์ด “BPMN”] one\n(Card in question: view flow_scene)');
  });

  it('"Use this message again" gets the cards and the message back from a sent prompt', async () => {
    const { chatReferencePrompt, parseReferencedPrompt } = await import('./canvas-object-finder');
    const refs = [{ id: 'a', title: 'BPMN', detail: 'view flow_scene' }, { id: 'b', title: 'Steps', detail: 'data table steps' }];
    const many = parseReferencedPrompt(chatReferencePrompt(refs, 'ครบไหม'));
    expect(many.message).toBe('ครบไหม');
    expect(many.references.map(({ title, detail }) => ({ title, detail }))).toEqual(refs.map(({ title, detail }) => ({ title, detail })));
    const one = parseReferencedPrompt(chatReferencePrompt(refs[0], 'ยากขึ้น'));
    expect(one.references.map((item) => item.detail)).toEqual(['view flow_scene']);
    expect(one.message).toBe('ยากขึ้น');
    expect(parseReferencedPrompt('ถามเฉย ๆ\nบรรทัดสอง')).toEqual({ references: [], message: 'ถามเฉย ๆ\nบรรทัดสอง' });
  });
});
