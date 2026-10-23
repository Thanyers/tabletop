import { describe, expect, it } from 'vitest';
import { IMAGE_ID_PATTERN, MAX_IMAGE_BYTES, MAX_TABLE_IMAGES, canvasImagePath, sniffImageType } from './canvas-images';

const bytes = (...values: number[]) => new Uint8Array(values);
const ascii = (text: string) => new TextEncoder().encode(text);
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out;
};

const PNG_SIGNATURE = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const PNG_HEADER = concat(PNG_SIGNATURE, bytes(0x00, 0x00, 0x00, 0x0d), ascii('IHDR'), bytes(0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0));
const JPEG_HEADER = concat(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10), ascii('JFIF'), bytes(0x00));
const WEBP_HEADER = concat(ascii('RIFF'), bytes(0x24, 0x00, 0x00, 0x00), ascii('WEBPVP8 '));

describe('canvas image limits (F073)', () => {
  it('exposes the agreed limits and id shape', () => {
    expect(MAX_TABLE_IMAGES).toBe(20);
    expect(MAX_IMAGE_BYTES).toBe(1_572_864);
    expect(IMAGE_ID_PATTERN.test(`img_${'a1'.repeat(16)}`)).toBe(true);
    expect(IMAGE_ID_PATTERN.test(`img_${'A1'.repeat(16)}`)).toBe(false);
    expect(IMAGE_ID_PATTERN.test(`img_${'a'.repeat(31)}`)).toBe(false);
    expect(IMAGE_ID_PATTERN.test(`img_${'a'.repeat(33)}`)).toBe(false);
    expect(IMAGE_ID_PATTERN.test(`note_${'a'.repeat(32)}`)).toBe(false);
  });
});

describe('sniffImageType (F073)', () => {
  it('recognises JPEG, PNG and WebP by their magic bytes', () => {
    expect(sniffImageType(JPEG_HEADER)).toBe('image/jpeg');
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff))).toBe('image/jpeg');
    expect(sniffImageType(PNG_HEADER)).toBe('image/png');
    expect(sniffImageType(PNG_SIGNATURE)).toBe('image/png');
    expect(sniffImageType(WEBP_HEADER)).toBe('image/webp');
  });

  it('rejects GIF, SVG, HTML, text, PDF and empty or truncated buffers', () => {
    expect(sniffImageType(ascii('GIF89a\x01\x00\x01\x00'))).toBeNull();
    expect(sniffImageType(ascii('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImageType(ascii('<!doctype html><script>alert(1)</script>'))).toBeNull();
    expect(sniffImageType(ascii('just some plain text'))).toBeNull();
    expect(sniffImageType(ascii('%PDF-1.7'))).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
    expect(sniffImageType(bytes(0xff, 0xd8))).toBeNull();
    expect(sniffImageType(PNG_SIGNATURE.subarray(0, 7))).toBeNull();
    expect(sniffImageType(WEBP_HEADER.subarray(0, 11))).toBeNull();
    // A RIFF container that is not WebP (e.g. WAV or AVI) is not an image we accept.
    expect(sniffImageType(concat(ascii('RIFF'), bytes(0, 0, 0, 0), ascii('WAVEfmt ')))).toBeNull();
  });

  it('ignores what the bytes claim to be after the header and only trusts the start', () => {
    // An HTML payload with a PNG signature in the middle is still not an image.
    expect(sniffImageType(concat(ascii('<html>'), PNG_SIGNATURE))).toBeNull();
  });
});

describe('canvasImagePath (F073)', () => {
  it('builds the image route and encodes both segments', () => {
    const id = `img_${'0f'.repeat(16)}`;
    expect(canvasImagePath('3f1c0a7e-0000-4000-8000-000000000000', id))
      .toBe(`/api/workspaces/3f1c0a7e-0000-4000-8000-000000000000/images/${id}`);
    expect(canvasImagePath('a/b?c', 'x y#z')).toBe('/api/workspaces/a%2Fb%3Fc/images/x%20y%23z');
  });
});
