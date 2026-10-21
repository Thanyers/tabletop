import { describe, expect, it } from 'vitest';
import { MAX_WRITTEN_ANSWER_CHARS, composeClarificationAnswer, uniqueChoices } from './clarification-answer';

const options = ['Both people', 'Only the owner', 'Nobody'];

describe('clarification answers (F022)', () => {
  it('sends one choice exactly as before', () => {
    expect(composeClarificationAnswer(options, new Set(['Only the owner']), '')).toBe('Only the owner');
  });
  it('joins several choices in display order, then the written answer', () => {
    expect(composeClarificationAnswer(options, new Set(['Nobody', 'Both people']), '  only on   weekends ')).toBe('Both people; Nobody; only on weekends');
    expect(composeClarificationAnswer(options, new Set(), 'Team leads approve')).toBe('Team leads approve');
  });
  it('shows and sends a repeated AI choice only once', () => {
    expect(uniqueChoices(['A', 'B', 'A'])).toEqual(['A', 'B']);
    expect(composeClarificationAnswer(['A', 'A', 'B'], new Set(['A']), '')).toBe('A');
  });
  it('ignores unknown selections and empty or oversized writing', () => {
    expect(composeClarificationAnswer(options, new Set(['injected']), '   ')).toBe('');
    expect(composeClarificationAnswer(options, new Set(), 'x'.repeat(MAX_WRITTEN_ANSWER_CHARS + 50))).toHaveLength(MAX_WRITTEN_ANSWER_CHARS);
  });
});
