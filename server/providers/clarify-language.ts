/**
 * F026: the clarifying question must be written in the language of the request.
 * The prompt already asks for it, but a model occasionally drifts (seen: an English
 * request answered in Chinese), so the provider verifies it and lets the repair loop retry.
 */
const THAI = /[\u0e00-\u0e7f]/u;
const CJK = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uac00-\ud7af]/u;

export type RequestLanguage = 'th' | 'en' | 'zh';

export function requestLanguage(text: string): RequestLanguage {
  if (THAI.test(text)) return 'th';
  if (CJK.test(text)) return 'zh';
  return 'en';
}

/** True when the answer uses the same script family as the request. */
export function clarifyMatchesRequestLanguage(request: string, answer: string): boolean {
  const language = requestLanguage(request);
  if (language === 'th') return THAI.test(answer);
  if (language === 'zh') return CJK.test(answer);
  return !THAI.test(answer) && !CJK.test(answer);
}

export const CLARIFY_LANGUAGE_ISSUE = 'Ask the clarifying question and options in the language of the request.';
