// Explicit consent for the chat-first table (F006). Consent covers one exact set
// of source files: a new or removed file asks again, a new message does not.

export function consentKey(sourceIds: readonly string[]): string {
  return [...sourceIds].sort().join('|');
}

export function needsConsent(grantedKey: string | null, sourceIds: readonly string[]): boolean {
  return grantedKey !== consentKey(sourceIds);
}

export function consentQuestion(fileCount: number, sharesTable = false): string {
  if (sharesTable) return "Send this message and this table's current data to AI?";
  if (fileCount === 0) return 'Send this message to AI?';
  return `Send this message and ${fileCount} ${fileCount === 1 ? 'file' : 'files'} to AI?`;
}
