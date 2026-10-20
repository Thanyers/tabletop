import { afterEach, describe, expect, it, vi } from 'vitest';
import { consentKey, consentQuestion, needsConsent, rememberConsent, storedConsent, type TableChatConsentScope } from './table-chat-consent';

const scope = (patch: Partial<TableChatConsentScope> = {}): TableChatConsentScope => ({
  workspaceId: 'table-1',
  epoch: 3,
  actorId: 'actor-a',
  ...patch,
});

function stubStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('window', {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
    },
  });
  return values;
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('chat consent', () => {
  it('asks once per table epoch and actor, whatever the mode or file set', () => {
    const grant = consentKey(scope());
    expect(needsConsent(null, scope())).toBe(true);
    expect(needsConsent(grant, scope())).toBe(false);
  });

  it('asks again on another table, after a reset, or for another actor', () => {
    const grant = consentKey(scope());
    expect(needsConsent(grant, scope({ workspaceId: 'table-2' }))).toBe(true);
    expect(needsConsent(grant, scope({ epoch: 4 }))).toBe(true);
    expect(needsConsent(grant, scope({ actorId: 'actor-b' }))).toBe(true);
  });

  it('remembers a grant across page loads in this browser', () => {
    stubStorage();
    expect(storedConsent(scope())).toBeNull();
    rememberConsent(scope());
    expect(storedConsent(scope())).toBe(consentKey(scope()));
    expect(storedConsent(scope({ epoch: 4 }))).toBeNull();
  });

  it('keeps a bounded list and survives unreadable storage', () => {
    const values = stubStorage({ 'tabletop.aiConsent.v1': '{broken' });
    expect(storedConsent(scope())).toBeNull();
    for (let index = 0; index < 60; index += 1) rememberConsent(scope({ workspaceId: `table-${index}` }));
    expect(JSON.parse(values.get('tabletop.aiConsent.v1') ?? '[]')).toHaveLength(50);
    expect(storedConsent(scope({ workspaceId: 'table-0' }))).toBeNull();
    expect(storedConsent(scope({ workspaceId: 'table-59' }))).not.toBeNull();
  });

  it('works without storage for the current page only', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => { throw Error('blocked'); }, setItem: () => { throw Error('blocked'); } } });
    expect(storedConsent(scope())).toBeNull();
    expect(rememberConsent(scope())).toBe(consentKey(scope()));
  });

  it('states the distinct table context and history scope for each endpoint and that it will not ask again', () => {
    expect(consentQuestion('draft')).toContain('active rules, records, and turn');
    expect(consentQuestion('draft')).toContain('Chat history is not included');
    expect(consentQuestion('ask')).toContain('up to six of your private chat exchanges');
    expect(consentQuestion('ask')).toContain('including relevant older ones when available');
    expect(consentQuestion('ask')).toContain('Table files are not sent');
    for (const mode of ['draft', 'ask'] as const) {
      expect(consentQuestion(mode)).toContain('You will not be asked again on this table');
      expect(consentQuestion(mode)).toContain('later rule requests also send the table files');
    }
  });
});
