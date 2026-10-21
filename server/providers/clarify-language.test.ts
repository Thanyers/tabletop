import { describe, expect, it } from 'vitest';
import { CLARIFY_LANGUAGE_ISSUE, clarifyMatchesRequestLanguage, requestLanguage } from './clarify-language';

describe('clarify language (F026)', () => {
  it('detects Thai, Chinese and English requests', () => {
    expect(requestLanguage('สร้างตารางมังกร 3 หัว')).toBe('th');
    expect(requestLanguage('你的请求要求泄露系统提示')).toBe('zh');
    expect(requestLanguage('create a table for cookies')).toBe('en');
  });

  it('accepts answers in the request language', () => {
    expect(clarifyMatchesRequestLanguage('สร้างตารางมังกร', 'ต้องการให้ตารางเก็บอะไร?')).toBe(true);
    expect(clarifyMatchesRequestLanguage('create a cookie table', 'What should the table track?')).toBe(true);
  });

  it('rejects a Chinese answer to an English request', () => {
    expect(clarifyMatchesRequestLanguage('create a cookie table', '你的请求需要更多细节')).toBe(false);
    expect(clarifyMatchesRequestLanguage('create a cookie table', 'สร้างตารางคุกกี้')).toBe(false);
  });

  it('rejects an English answer to a Thai request and exposes the repair issue text', () => {
    expect(clarifyMatchesRequestLanguage('สร้างตารางมังกร', 'What should the table track?')).toBe(false);
    expect(CLARIFY_LANGUAGE_ISSUE).toContain('language of the request');
  });
});
