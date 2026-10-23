import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_EDGE } from '../shared/canvas-images';
import { acceptedImageFile, fitWithin, imageCardSize } from './canvas-image-prepare';

describe('fitWithin (F073)', () => {
  it('never enlarges a picture that already fits', () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(MAX_IMAGE_EDGE, MAX_IMAGE_EDGE)).toEqual({ width: 1600, height: 1600 });
    expect(fitWithin(1, 1)).toEqual({ width: 1, height: 1 });
  });

  it('brings the longest edge of a landscape or portrait picture down to 1600', () => {
    expect(MAX_IMAGE_EDGE).toBe(1600);
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(6000, 6000)).toEqual({ width: 1600, height: 1600 });
  });

  it('honours a custom edge and never rounds a side to zero', () => {
    expect(fitWithin(1000, 500, 100)).toEqual({ width: 100, height: 50 });
    expect(fitWithin(20_000, 2, 1600)).toEqual({ width: 1600, height: 1 });
  });
});

describe('imageCardSize (F073)', () => {
  const within = ({ width, height }: { width: number; height: number }) => {
    expect(width).toBeGreaterThanOrEqual(160);
    expect(width).toBeLessThanOrEqual(480);
    expect(height).toBeGreaterThanOrEqual(110);
    expect(height).toBeLessThanOrEqual(560);
    expect(Number.isInteger(width) && Number.isInteger(height)).toBe(true);
  };
  const CHROME = 92;

  it('keeps a typical photo at the default width and its aspect ratio', () => {
    const landscape = imageCardSize(1600, 1200);
    within(landscape);
    expect(landscape.width).toBe(320);
    expect((landscape.height - CHROME) / landscape.width).toBeCloseTo(1200 / 1600, 2);

    const square = imageCardSize(1000, 1000);
    within(square);
    expect(square.height - CHROME).toBe(square.width);
  });

  it('narrows a tall picture so the card stays under the height cap and keeps the aspect', () => {
    const portrait = imageCardSize(1200, 1600);
    within(portrait);
    expect(portrait.height).toBeLessThanOrEqual(560);
    expect((portrait.height - CHROME) / portrait.width).toBeCloseTo(1600 / 1200, 1);
  });

  it('stays within bounds for a very tall or very wide picture', () => {
    within(imageCardSize(100, 5000));
    within(imageCardSize(5000, 100));
    within(imageCardSize(1, 1600));
    within(imageCardSize(1600, 1));
    within(imageCardSize(0, 0));
  });
});

describe('acceptedImageFile (F073)', () => {
  it('accepts only JPEG, PNG and WebP by declared type', () => {
    expect(acceptedImageFile({ type: 'image/jpeg' })).toBe(true);
    expect(acceptedImageFile({ type: 'image/png' })).toBe(true);
    expect(acceptedImageFile({ type: 'image/webp' })).toBe(true);
    for (const type of ['image/gif', 'image/svg+xml', 'image/heic', 'text/html', 'application/pdf', '', 'IMAGE/PNG']) {
      expect(acceptedImageFile({ type }), type).toBe(false);
    }
  });
});
