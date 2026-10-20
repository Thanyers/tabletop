import { describe, expect, it } from 'vitest';
import { selectTableConversation } from './table-memory.js';
import type { TableAssistantConversationEntry } from '../src/tabletop/shared/table-assistant-contracts.js';

function entry(prompt: string, text = 'An earlier explanation.'): TableAssistantConversationEntry {
  return { prompt, result: { kind: 'explanation', text }, expectedRevision: 'a'.repeat(64) };
}

describe('bounded private table memory', () => {
  it('recalls related older dialogue while retaining four newest exchanges', () => {
    const history = Array.from({ length: 20 }, (_, index) => entry(`Question ${index}`));
    history[18] = entry('Why reserve water for the orchard?', 'Orchard reserve was an earlier experiment, not a current rule.');
    const selected = selectTableConversation(history, 'What did we discuss about the orchard?');
    expect(selected.conversation).toHaveLength(6);
    expect(selected.conversation[0]?.prompt).toContain('orchard');
    expect(selected.conversation[0]?.contextSource).toBe('recalled');
    expect(selected.conversation.slice(-4).map(item => item.prompt)).toEqual(['Question 3', 'Question 2', 'Question 1', 'Question 0']);
    expect(selected.omittedCount).toBe(14);
  });

  it('recalls Thai terms and falls back to recent history without a match', () => {
    const history = Array.from({ length: 10 }, (_, index) => entry(`Question ${index}`));
    history[9] = entry('ลองเพิ่มหลอดไฟอีกดวง', 'ตำแหน่งหลอดไฟเปลี่ยนเงา');
    expect(selectTableConversation(history, 'เรื่องหลอดไฟที่คุยไว้').conversation[0]?.prompt).toContain('หลอดไฟ');
    expect(selectTableConversation(history, 'unrelated zeppelin').conversation.map(item => item.prompt)).toEqual(
      ['Question 5', 'Question 4', 'Question 3', 'Question 2', 'Question 1', 'Question 0'],
    );
  });

  it('bounds the scan and UTF-8 payload without inventing or mutating memory', () => {
    const history = Array.from({ length: 150 }, (_, index) => entry(`Question ${index}`, 'ก'.repeat(4000)));
    history[149] = entry('Secret outside scan window');
    const before = structuredClone(history);
    const selected = selectTableConversation(history, 'Secret outside scan');
    expect(selected.conversation.length).toBeLessThan(6);
    expect(new TextEncoder().encode(JSON.stringify(selected.conversation)).byteLength).toBeLessThanOrEqual(16_384);
    expect(JSON.stringify(selected.conversation)).not.toContain('Secret');
    expect(history).toEqual(before);
  });
});
