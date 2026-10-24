/**
 * Reading a member's file before it becomes table source text, or a legacy upload payload.
 *
 * F078-T5a moved these out of `TabletopApp` unchanged. Only `fileToBase64` needs a browser
 * `FileReader`; the decode path uses plain `TextDecoder` and `File.arrayBuffer`, so the
 * command seam can be unit-tested with a real `File` in Node.
 */

/** The MIME hint used only when the browser does not supply one for the legacy upload route. */
export function inferredMime(filename: string): string {
  return filename.toLowerCase().endsWith('.csv') ? 'text/csv' : filename.toLowerCase().endsWith('.pdf') ? 'application/pdf' : filename.toLowerCase().endsWith('.txt') ? 'text/plain' : 'application/octet-stream';
}

/**
 * Decodes table source bytes strictly. Throws on anything that is not valid UTF-8 so the caller
 * can keep reporting the exact `TABLE_FILE` message instead of importing replacement characters.
 */
export function decodeSourceText(buffer: ArrayBuffer): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
}

/** Base64 body for the legacy invoice/shipment upload route (no table source path uses this). */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('The file could not be read from this device.'));
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      const comma = value.indexOf(',');
      if (comma < 0) reject(new Error('The file could not be prepared for upload.'));
      else resolve(value.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}
