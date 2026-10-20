export type TableChatMode = 'draft' | 'ask';

/** One AI consent covers both request modes for one actor on one table epoch (F010). */
export interface TableChatConsentScope {
  workspaceId: string;
  epoch: number;
  actorId: string;
}

const STORAGE_KEY = 'tabletop.aiConsent.v1';
const MAX_STORED_GRANTS = 50;

/** A grant is bound to the exact table, epoch, and actor. A reset starts a new epoch and asks again. */
export function consentKey(scope: TableChatConsentScope): string {
  return JSON.stringify({ workspaceId: scope.workspaceId, epoch: scope.epoch, actorId: scope.actorId });
}

export function needsConsent(grantedKey: string | null, scope: TableChatConsentScope): boolean {
  return grantedKey !== consentKey(scope);
}

function readGrants(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
  } catch { return []; }
}

/** Returns the remembered grant for this scope, or null when this browser has not consented. */
export function storedConsent(scope: TableChatConsentScope): string | null {
  const key = consentKey(scope);
  return readGrants().includes(key) ? key : null;
}

export function rememberConsent(scope: TableChatConsentScope): string {
  const key = consentKey(scope);
  if (typeof window !== 'undefined') {
    try {
      const grants = [...readGrants().filter((item) => item !== key), key].slice(-MAX_STORED_GRANTS);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(grants));
    } catch { /* Without storage the grant lasts for this page only; the dialog asks again after reload. */ }
  }
  return key;
}

export function consentQuestion(mode: TableChatMode): string {
  const current = mode === 'draft'
    ? 'This sends your message, current active rules, records, and turn, plus the table files listed below. Chat history is not included.'
    : 'This sends your message, current active rules, records, and turn, plus up to six of your private chat exchanges, including relevant older ones when available. Table files are not sent.';
  return `${current} You will not be asked again on this table: later rule requests also send the table files at that time, and questions send recent chat.`;
}
