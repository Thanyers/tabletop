// F020: build the answer sent back after an AI clarifying question.
// Several choices and a written answer are joined in the order shown; one choice
// produces exactly the text the single-pick card sent before.

export const MAX_WRITTEN_ANSWER_CHARS = 500;

export function composeClarificationAnswer(options: readonly string[], selected: ReadonlySet<string>, written: string): string {
  const picked = options.filter((option) => selected.has(option));
  const own = written.replace(/\s+/gu, ' ').trim().slice(0, MAX_WRITTEN_ANSWER_CHARS);
  return [...picked, ...(own ? [own] : [])].join('; ');
}
