import type { TableAssistantConversationEntry } from '../src/tabletop/shared/table-assistant-contracts.js';

export const TABLE_MEMORY_SCAN_LIMIT = 100;
const CONTEXT_LIMIT = 6;
const CONTEXT_BYTES = 16_384;
const ignoredWords = new Set(['the', 'this', 'that', 'with', 'from', 'have', 'what', 'when', 'then', 'table', 'please', 'about', 'could', 'would', 'explain']);

function queryTerms(prompt: string): string[] {
  const segmenter = new Intl.Segmenter('th', { granularity: 'word' });
  return [...new Set([...segmenter.segment(prompt.slice(0, 4000).toLocaleLowerCase())]
    .filter(part => part.isWordLike && part.segment.length >= 3 && !ignoredWords.has(part.segment))
    .map(part => part.segment))].slice(0, 12);
}

// The caller must first restrict persisted history to the current room, epoch and
// actor. Dialogue is optional background; active state remains authoritative.
export function selectTableConversation(
  newestFirst: readonly TableAssistantConversationEntry[],
  prompt: string,
): { conversation: TableAssistantConversationEntry[]; omittedCount: number } {
  const entries = newestFirst.slice(0, TABLE_MEMORY_SCAN_LIMIT);
  const terms = queryTerms(prompt);
  const selected = new Set(entries.slice(0, 4).map((_, index) => index));
  const matches = entries.slice(4).map((entry, index) => {
    const text = `${entry.prompt.slice(0, 2000)} ${entry.result.text.slice(0, 4000)}`.toLocaleLowerCase();
    return { index: index + 4, score: terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) };
  }).filter(match => match.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 2);
  const recalled = new Set(matches.map(match => match.index));
  for (const match of matches) selected.add(match.index);
  for (let index = 0; index < entries.length && selected.size < CONTEXT_LIMIT; index += 1) selected.add(index);
  const conversation = [...selected].sort((a, b) => b - a).map(index => ({
    ...entries[index]!,
    ...(recalled.has(index) && index >= CONTEXT_LIMIT ? { contextSource: 'recalled' as const } : {}),
  }));
  while (conversation.length && new TextEncoder().encode(JSON.stringify(conversation)).byteLength > CONTEXT_BYTES) conversation.shift();
  return { conversation, omittedCount: entries.length - conversation.length };
}
