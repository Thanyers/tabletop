import { describe, expect, it } from 'vitest';
import { roomSlugFrom } from './RoomSetupPanel';

/**
 * F080 / D-049: the slug a room lives at must be usable as an address, so the helper is tested on its
 * own — including the titles a person actually types (Thai, spaces, punctuation).
 */
describe('turning a room title into its address', () => {
  it('lowercases and joins words with hyphens', () => {
    expect(roomSlugFrom('Activity Room')).toBe('activity-room');
    expect(roomSlugFrom('  Two  spaces  ')).toBe('two-spaces');
  });

  it('drops punctuation instead of encoding it', () => {
    expect(roomSlugFrom('Room #1: planning!')).toBe('room-1-planning');
    expect(roomSlugFrom('a/b\\c')).toBe('a-b-c');
  });

  it('returns nothing when the title has no usable letters, so the person must type an address', () => {
    // Thai titles are legitimate in the UI, but the address needs Latin letters or digits.
    expect(roomSlugFrom('ห้องวางผัง')).toBe('');
    expect(roomSlugFrom('ab')).toBe('');
    expect(roomSlugFrom('!!!')).toBe('');
  });

  it('never returns a slug the command would refuse', () => {
    for (const title of ['Activity Room', 'Room #1', 'A B C', 'x'.repeat(60)]) {
      const slug = roomSlugFrom(title);
      if (slug === '') continue;
      expect(slug).toMatch(/^[a-z0-9][a-z0-9-]{2,39}$/u);
      expect(slug.endsWith('-')).toBe(false);
    }
  });
});
