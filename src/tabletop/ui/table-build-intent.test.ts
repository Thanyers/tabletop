import { describe, expect, it } from 'vitest';
import { tableChatMode } from './table-chat-state';

describe('owner asks to extend an active table', () => {
  it.each([
    'Add mockup records to this table and add a button to test it',
    'Create a form for adding a new record',
    'Add a chart and a card showing the total',
    'เพิ่มฟอร์มกับปุ่มเพิ่มรายการให้ลองกดจริง',
    'สร้างตารางอีกใบไว้เก็บลูกค้า',
    'ขอการ์ดสรุปยอดเพิ่มบนโต๊ะเดิม',
  ])('prepares a change directly from the same composer: %s', (prompt) => {
    expect(tableChatMode('owner', true, false, { prompt, hasCreateAction: false })).toBe('draft');
  });

  it('uses existing create actions for data requests and keeps questions conversational', () => {
    expect(tableChatMode('owner', true, false, { prompt: 'Add a record', hasCreateAction: true })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'Add a record to this table', hasCreateAction: true })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'Change invoice status in this table to paid', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'Edit this row’s status to paid', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'ทำเครื่องหมายว่าจ่ายแล้วในตารางนี้', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'How many records were added?', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'Explain what the Add button does', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'สรุปข้อมูลในตารางนี้', hasCreateAction: false })).toBe('ask');
  });

  it('never promotes participant messages to owner rule editing', () => {
    expect(tableChatMode('participant', true, false, { prompt: 'Create a new form and table', hasCreateAction: false })).toBe('ask');
  });
});
