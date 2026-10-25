import { narrativeTerms } from './narrativeFocus';
import type { CaseId, StoryStep } from './types';

export interface TypingFrame { text: string; wait: number; editing: boolean }

const revisions: Record<CaseId, { rough: string; keep: string }> = {
  shipping: { rough: 'เอ๊ะ ค่าส่งยังเท่าเดิม', keep: 'เอ๊ะ ' },
  quest: { rough: 'เดี๋ยวนะ อยากให้เกมง่ายขึ้น', keep: 'เดี๋ยวนะ ' },
  music: { rough: 'อืม เพลงยังเร็วไป', keep: 'อืม ' },
};

// An authored conversation, with deterministic pacing so replay and cancellation stay predictable.
export function typingFrames(request: string, caseId: CaseId, step: StoryStep): TypingFrame[] {
  const segments = (text: string) => Array.from(new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(text), item => item.segment);
  const frames: TypingFrame[] = [];
  let text = '';
  const cued = new Set<string>();
  const append = (target: string) => {
    const letters = segments(target);
    for (const [index, letter] of letters.entries()) {
      text += letter;
      frames.push({ text, wait: /[ ,?!ฯ]/.test(letter) ? 90 : [26, 32, 24, 42, 28][index % 5], editing: false });
      const cue = narrativeTerms(caseId, step).find(term => text.endsWith(term) && !cued.has(term));
      if (cue) { cued.add(cue); frames.push({ text, wait: 380, editing: false }); }
    }
  };
  const revision = revisions[caseId];
  if (step === 'notice' && request.startsWith(revision.keep)) {
    append(revision.rough);
    frames.push({ text, wait: 460, editing: true });
    const letters = segments(text);
    const keepLength = segments(revision.keep).length;
    while (letters.length > keepLength) {
      letters.pop();
      text = letters.join('');
      frames.push({ text, wait: 30, editing: true });
    }
    frames.push({ text, wait: 180, editing: true });
    append(request.slice(revision.keep.length));
  } else {
    append(request);
  }
  frames.push({ text: request, wait: 220, editing: false });
  return frames;
}
