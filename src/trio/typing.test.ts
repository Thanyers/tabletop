import { describe, expect, it } from 'vitest';
import { typingFrames } from './typing';

describe('authored conversation pacing', () => {
  it.each([
    ['shipping', 'เอ๊ะ พัสดุคุณเมย์ยังคิด 40 บาทอยู่ สัญญาใหม่ลดแล้วนี่?'],
    ['quest', 'เดี๋ยวนะ ด่านห้องสมุดติดนานไป อยากช่วยทีละนิด แต่ไม่เฉลยนะ'],
    ['music', 'อืม ฮุกยังเร็วไป ขอช้าลงแค่ท่อนนี้ได้ไหม'],
  ] as const)('corrects a thought before sending the %s request', (caseId, request) => {
    const frames = typingFrames(request, caseId, 'notice');
    expect(frames.at(-1)?.text).toBe(request);
    expect(frames.some((frame, index) => index > 0 && frame.text.length < frames[index - 1].text.length)).toBe(true);
    expect(frames.some(frame => frame.wait >= 400)).toBe(true);
    expect(frames.reduce((sum, frame) => sum + frame.wait, 0)).toBeLessThan(5000);
  });
  it('types other requests once without introducing a correction', () => {
    const request = 'ขอดูรายการค่าส่งก่อน';
    const frames = typingFrames(request, 'shipping', 'minimal');
    expect(frames.at(-1)?.text).toBe(request);
    expect(frames.every(frame => !frame.editing)).toBe(true);
    expect(new Set(frames.map(frame => frame.wait)).size).toBeGreaterThan(2);
  });
});
