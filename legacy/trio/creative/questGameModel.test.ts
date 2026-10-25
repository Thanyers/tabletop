import { describe, expect, it } from 'vitest';
import {
  answerQuestStation,
  createQuestGameState,
  exportPlayableQuestHtml,
  getActiveQuestHint,
  isQuestAnswerRevealed,
  isQuestStationUnlocked,
  requestQuestAnswer,
  requestQuestHint,
  selectQuestStation,
} from './questGameModel';
import type { QuestRule } from '../types';

const oldRule: QuestRule = { firstHint: 300, secondHint: 480, autoReveal: true };
const taughtRule: QuestRule = { firstHint: 180, secondHint: 300, autoReveal: false };

describe('playable quest model', () => {
  it('keeps wrong answers in the current station and unlocks the next station on a correct answer', () => {
    const initial = createQuestGameState();
    const wrong = answerQuestStation(initial, 'garden', 'moonlight');
    expect(wrong.result).toBe('wrong');
    expect(wrong.state.solvedStationIds).toEqual([]);

    const solved = answerQuestStation(initial, 'garden', 'sunlight');
    expect(solved.result).toBe('correct');
    expect(solved.state.activeStationId).toBe('library');
    expect(isQuestStationUnlocked(solved.state, 'library')).toBe(true);
    expect(isQuestStationUnlocked(solved.state, 'treasure')).toBe(false);
  });

  it('does not allow a locked station to be selected or answered', () => {
    const initial = createQuestGameState();
    expect(selectQuestStation(initial, 'treasure')).toBe(initial);
    expect(answerQuestStation(initial, 'treasure', 'key')).toMatchObject({ result: 'locked' });
    expect(initial.activeStationId).toBe('garden');
  });

  it('shows each requested hint only after its current rule threshold', () => {
    const initial = createQuestGameState();
    expect(requestQuestHint(initial, taughtRule, 179)).toMatchObject({ result: 'waiting' });
    const first = requestQuestHint(initial, taughtRule, 180);
    expect(first).toMatchObject({ result: 'shown', hint: expect.any(String) });
    expect(requestQuestHint(first.state, taughtRule, 299)).toMatchObject({ result: 'waiting' });
    expect(requestQuestHint(first.state, taughtRule, 300).result).toBe('shown');
  });

  it('shows the selected station hint and clears it when the player moves or solves the station', () => {
    const gardenWithHint = requestQuestHint(createQuestGameState(), taughtRule, 180).state;
    expect(getActiveQuestHint(gardenWithHint)).toMatchObject({ level: 1, hint: 'ลองมองขึ้นไปบนท้องฟ้าในตอนเช้า' });

    const solvedGarden = answerQuestStation(gardenWithHint, 'garden', 'sunlight').state;
    expect(getActiveQuestHint(solvedGarden)).toBeUndefined();
    const libraryWithoutHint = selectQuestStation(solvedGarden, 'library');
    expect(getActiveQuestHint(libraryWithoutHint)).toBeUndefined();
    expect(requestQuestHint(libraryWithoutHint, taughtRule, 180).result).toBe('shown');
    const revisitGarden = selectQuestStation(libraryWithoutHint, 'garden');
    expect(getActiveQuestHint(revisitGarden)).toBeUndefined();

    const html = exportPlayableQuestHtml(taughtRule);
    expect(html).toContain('const hintLevel=solved.has(active)?0:(hints.get(active)||0)');
    expect(html).toContain('hintOutput.textContent=hintLevel?');
  });

  it('keeps the answer hidden after the revised threshold and reveals it on request', () => {
    const initial = createQuestGameState();
    expect(isQuestAnswerRevealed(initial, taughtRule, 480)).toBe(false);
    expect(requestQuestAnswer(initial, taughtRule, 299).revealed).toBe(false);
    const requested = requestQuestAnswer(initial, taughtRule, 300);
    expect(requested).toMatchObject({ revealed: true, automatic: false });
    expect(isQuestAnswerRevealed(requested.state, taughtRule, 300)).toBe(true);
  });

  it('hides requested or automatic reveals after a station is solved in the app and exported game', () => {
    const requested = requestQuestAnswer(createQuestGameState(), taughtRule, 300).state;
    const solved = answerQuestStation(requested, 'garden', 'sunlight').state;
    const revisitSolvedStation = selectQuestStation(solved, 'garden');

    expect(isQuestAnswerRevealed(revisitSolvedStation, oldRule, 480)).toBe(false);
    expect(requestQuestAnswer(revisitSolvedStation, taughtRule, 300)).toMatchObject({
      revealed: false,
      automatic: false,
    });

    const html = exportPlayableQuestHtml(taughtRule);
    expect(html).toContain("const status=()=>solved.has(active)?{level:0,reveal:false}");
    expect(html).toContain("if(solved.has(active)){puzzle.querySelector('[data-feedback]')");
    expect(html).toContain('!solved.has(active)&&!automatic&&status().level>=2');
  });

  it('automatically reveals the answer when the original rule says to do so', () => {
    expect(isQuestAnswerRevealed(createQuestGameState(), oldRule, 479)).toBe(false);
    expect(isQuestAnswerRevealed(createQuestGameState(), oldRule, 480)).toBe(true);
    expect(requestQuestAnswer(createQuestGameState(), oldRule, 480)).toMatchObject({
      revealed: true,
      automatic: true,
    });
  });

  it('escapes untrusted rule values in the offline HTML and makes no network or eval calls', () => {
    const unsafeRule = { ...taughtRule, firstHint: '1\"><img src=x onerror=alert(1)>' } as unknown as QuestRule;
    const html = exportPlayableQuestHtml(unsafeRule);
    expect(html).toContain('data-first-hint="1&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"');
    expect(html).not.toContain('<img src=x');
    expect(html).not.toMatch(/\beval\s*\(|\bfetch\s*\(|https?:\/\//i);
  });
});
