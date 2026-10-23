/** F073: limits and checks shared by the image upload route, the domain and the client. */
export const MAX_TABLE_IMAGES = 20;
/** The client resizes first, so a real photo lands far below this; the server still refuses anything larger. */
export const MAX_IMAGE_BYTES = 1_572_864;
export const MAX_IMAGE_EDGE = 1600;
export const IMAGE_ID_PATTERN = /^img_[0-9a-f]{32}$/u;
export type CanvasImageType = 'image/jpeg' | 'image/png' | 'image/webp';
export const CANVAS_IMAGE_TYPES: readonly CanvasImageType[] = ['image/jpeg', 'image/png', 'image/webp'];

/** The type the bytes really are; a declared Content-Type or file name is never trusted. */
export function sniffImageType(bytes: Uint8Array): CanvasImageType | null {
  const at = (index: number) => bytes[index] ?? -1;
  if (bytes.length >= 3 && at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'image/jpeg';
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((byte, index) => at(index) === byte)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function canvasImagePath(workspaceId: string, imageId: string): string {
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/images/${encodeURIComponent(imageId)}`;
}
