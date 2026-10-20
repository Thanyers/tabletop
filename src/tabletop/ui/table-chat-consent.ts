export type TableChatMode = 'draft' | 'ask';

export interface TableChatConsentScope {
  workspaceId: string;
  epoch: number;
  actorId: string;
  mode: TableChatMode;
  /** Current private files are part of draft requests and explicitly excluded from asks. */
  sourceIds: readonly string[];
}

/** A grant is bound to the exact table, actor, request mode, and displayed file set. */
export function consentKey(scope: TableChatConsentScope): string {
  return JSON.stringify({
    workspaceId: scope.workspaceId,
    epoch: scope.epoch,
    actorId: scope.actorId,
    mode: scope.mode,
    sourceIds: [...scope.sourceIds].sort(),
  });
}

export function needsConsent(grantedKey: string | null, scope: TableChatConsentScope): boolean {
  return grantedKey !== consentKey(scope);
}

export function consentQuestion(mode: TableChatMode): string {
  return mode === 'draft'
    ? 'This sends your message, current active rules, records, and turn, plus the private source files listed below. Chat history is not included.'
    : 'This sends your message, current active rules, records, and turn, plus up to six recent private chat exchanges. Private source files are excluded.';
}
