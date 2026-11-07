import { describe, expect, it } from 'vitest';
import { MAX_NOTE_TEXT } from '../domain/table';
import { imageCaption } from './NoteCard';

// F092: a picture pinned from a link keeps its source on the card.
describe('imageCaption', () => {
  it('adds the source under the caption, or alone when there is no caption', () => {
    expect(imageCaption('Cover, Jan 2026', 'https://shop.example.com/book/42')).toBe('Cover, Jan 2026\nSource: https://shop.example.com/book/42');
    expect(imageCaption('  ', 'https://shop.example.com/book/42')).toBe('Source: https://shop.example.com/book/42');
    expect(imageCaption('Just a caption')).toBe('Just a caption');
  });

  it('keeps the whole source when the caption is too long for the card', () => {
    const text = imageCaption('x'.repeat(MAX_NOTE_TEXT), 'https://shop.example.com/book/42');
    expect(text.length).toBeLessThanOrEqual(MAX_NOTE_TEXT);
    expect(text.endsWith('Source: https://shop.example.com/book/42')).toBe(true);
  });
});
