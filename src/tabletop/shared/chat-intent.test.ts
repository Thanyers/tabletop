import { describe, expect, it } from 'vitest';
import { classifyChatIntent } from './chat-intent';

const withTable = { hasActiveProgram: true, hasCreateAction: false };
const emptyTable = { hasActiveProgram: false, hasCreateAction: false };

function intent(prompt: string, options: { hasActiveProgram?: boolean; hasCreateAction?: boolean } = {}) {
  return classifyChatIntent({
    prompt,
    hasActiveProgram: options.hasActiveProgram ?? withTable.hasActiveProgram,
    hasCreateAction: options.hasCreateAction ?? withTable.hasCreateAction,
  });
}

describe('classifyChatIntent', () => {
  it('builds a table when there is none', () => {
    expect(intent('สร้างตารางนับคะแนนบาสเก็ตบอล', emptyTable)).toBe('build');
    expect(intent('Build a cookie order tracker', emptyTable)).toBe('build');
  });

  it('edits the current table', () => {
    expect(intent('เพิ่มปุ่มรีเซ็ตคิว')).toBe('edit');
    expect(intent('Add a chart and a card showing the total')).toBe('edit');
    expect(intent('Create a form for adding a new record')).toBe('edit');
  });

  it('keeps questions as questions', () => {
    expect(intent('How many records were added?')).toBe('ask');
    expect(intent('Explain what the Add button does')).toBe('ask');
    expect(intent('สรุปข้อมูลในตารางนี้')).toBe('ask');
    expect(intent('มีอะไรในตารางนี้บ้าง')).toBe('ask');
  });

  it('treats a record change as an action, not a rule draft', () => {
    expect(intent('Change this row’s status to paid')).toBe('act');
    expect(intent('ทำเครื่องหมายว่าจ่ายแล้วในตารางนี้')).toBe('act');
    expect(intent('Mark this record as done')).toBe('act');
  });

  it('uses an existing create action for plain data requests', () => {
    expect(intent('Add a record', { hasCreateAction: true })).toBe('act');
    expect(intent('Add a record to this table', { hasCreateAction: true })).toBe('act');
  });

  it('drafts when a data request has no action that could create the row', () => {
    expect(intent('Add mockup records to this table and add a button to test it')).toBe('edit');
    expect(intent('เพิ่มข้อมูลตัวอย่าง 10 แถว')).toBe('edit');
  });

  it('resolves ambiguity towards doing something, not towards a dead end', () => {
    expect(intent('อยากได้ตารางเก็บลูกค้า')).toBe('edit');
    expect(intent('ขอการ์ดสรุปยอดเพิ่มบนโต๊ะเดิม')).toBe('edit');
  });

  it('stays conversational for greetings and too-short messages', () => {
    expect(intent('ขอบคุณ')).toBe('ask');
    expect(intent('ok')).toBe('ask');
    expect(intent('hi')).toBe('ask');
    expect(intent('า')).toBe('ask');
  });
});
