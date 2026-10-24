import { ApiFailure } from '../client';

/**
 * Maps any failure raised while talking to the workspace service into the sentence a member sees.
 *
 * F078-T5a moved this out of `TabletopApp` unchanged: the command/readback seam and the
 * composition root both report failures, and two copies of this mapping had already drifted
 * once before. The wording is part of the user-visible contract, so it stays byte-identical.
 */
export function errorText(error: unknown): string {
  if (error instanceof ApiFailure) {
    if (error.status === 401) return 'Your sign-in session has expired. Sign in again to continue.';
    if (error.status === 403 && error.code === 'TABLE_READ_ONLY') return 'Editing this shared table is temporarily paused. You can still inspect its current records and rules.';
    if (error.status === 403) return 'This table is not available to the current session. Open a new invitation or choose another table.';
    if (error.status === 404) return 'This table or invitation is no longer available. Choose another table or ask for a fresh invitation.';
    if (error.status === 413 && error.code === 'TABLE_LIMIT') return 'A table can hold up to four source files and 64 KiB total. Remove an unused source or choose a smaller file.';
    if (error.status === 413 && error.code === 'TABLE_FILE_SIZE') return 'Each table source file must be 32 KiB or smaller.';
    if (error.status === 413) return 'That file is larger than the table limit. Choose a smaller file.';
    if (error.status === 415 && error.code === 'TABLE_FILE') return 'Use a UTF-8 CSV, JSON, TXT or Markdown file. PDF and binary files are not supported.';
    if (error.status === 415) return 'This file type is not supported. Use a shipment CSV or a text PDF.';
    if (error.status === 0) return error.message;
    return error.message;
  }
  return error instanceof Error ? error.message : 'The table could not be updated. Try again.';
}
