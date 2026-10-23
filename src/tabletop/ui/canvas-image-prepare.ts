import { CANVAS_IMAGE_TYPES, MAX_IMAGE_BYTES, MAX_IMAGE_EDGE, type CanvasImageType } from '../shared/canvas-images';

/** F073: the scale that brings the longest edge down to `maxEdge`, never enlarging. */
export function fitWithin(width: number, height: number, maxEdge = MAX_IMAGE_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height);
  const scale = longest > maxEdge ? maxEdge / longest : 1;
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

const CARD_WIDTH = 320;
const CARD_CHROME = 92;
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const MIN_HEIGHT = 110;
const MAX_HEIGHT = 560;

/** F073: a card that shows the whole picture at its aspect ratio, inside the note size bounds. */
export function imageCardSize(width: number, height: number): { width: number; height: number } {
  const ratio = height / Math.max(1, width);
  let cardWidth = CARD_WIDTH;
  if (cardWidth * ratio + CARD_CHROME > MAX_HEIGHT) cardWidth = (MAX_HEIGHT - CARD_CHROME) / ratio;
  cardWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.round(cardWidth)));
  const cardHeight = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.round(cardWidth * ratio + CARD_CHROME)));
  return { width: cardWidth, height: cardHeight };
}

export function acceptedImageFile(file: Pick<File, 'type'>): boolean {
  return (CANVAS_IMAGE_TYPES as readonly string[]).includes(file.type);
}

function encode(canvas: HTMLCanvasElement, type: CanvasImageType, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * F073: shrink a picture in the browser before it leaves the device: longest edge at most 1600 px,
 * WebP (JPEG where WebP cannot be encoded), and under the server's byte limit.
 */
export async function prepareCanvasImage(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  if (!acceptedImageFile(file)) throw new Error('Use a JPEG, PNG or WebP image.');
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be read.'); });
  try {
    let size = fitWithin(bitmap.width, bitmap.height);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('This browser cannot prepare images.');
      context.drawImage(bitmap, 0, 0, size.width, size.height);
      for (const quality of [0.86, 0.74, 0.6]) {
        const webp = await encode(canvas, 'image/webp', quality);
        // Some browsers silently fall back to PNG for WebP; use JPEG there instead.
        const blob = webp?.type === 'image/webp' ? webp : await encode(canvas, 'image/jpeg', quality);
        if (blob && blob.size <= MAX_IMAGE_BYTES) return { blob, ...size };
      }
      size = { width: Math.max(1, Math.round(size.width * 0.75)), height: Math.max(1, Math.round(size.height * 0.75)) };
    }
    throw new Error('This image is too large to add.');
  } finally {
    bitmap.close();
  }
}
