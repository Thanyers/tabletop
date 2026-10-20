import { describe, expect, it } from 'vitest';
import { consentKey, consentQuestion, needsConsent } from './table-chat-consent';

describe('chat consent', () => {
  it('asks once per exact set of files, regardless of order, and again when files change', () => {
    expect(needsConsent(null, [])).toBe(true);
    const granted = consentKey(['b', 'a']);
    expect(needsConsent(granted, ['a', 'b'])).toBe(false);
    expect(needsConsent(granted, ['a', 'b', 'c'])).toBe(true);
    expect(needsConsent(granted, ['a'])).toBe(true);
    expect(needsConsent(consentKey([]), [])).toBe(false);
  });

  it('names how much is sent', () => {
    expect(consentQuestion(0)).toBe('Send this message to AI?');
    expect(consentQuestion(1)).toBe('Send this message and 1 file to AI?');
    expect(consentQuestion(3)).toBe('Send this message and 3 files to AI?');
    expect(consentQuestion(0, true)).toBe("Send this message and this table's current data to AI?");
  });
});
