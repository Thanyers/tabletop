import { describe, expect, it } from 'vitest';
import { consentKey, consentQuestion, needsConsent, type TableChatConsentScope } from './table-chat-consent';

const scope = (patch: Partial<TableChatConsentScope> = {}): TableChatConsentScope => ({
  workspaceId: 'table-1',
  epoch: 3,
  actorId: 'actor-a',
  mode: 'draft',
  sourceIds: ['file-b', 'file-a'],
  ...patch,
});

describe('chat consent', () => {
  it('covers one exact source set regardless of order', () => {
    const grant = consentKey(scope());
    expect(needsConsent(null, scope())).toBe(true);
    expect(needsConsent(grant, scope({ sourceIds: ['file-a', 'file-b'] }))).toBe(false);
    expect(needsConsent(grant, scope({ sourceIds: ['file-a'] }))).toBe(true);
    expect(needsConsent(grant, scope({ sourceIds: ['file-a', 'file-b', 'file-c'] }))).toBe(true);
  });

  it('resets consent when the workspace, epoch, actor, or request mode changes', () => {
    const grant = consentKey(scope({ sourceIds: [] }));
    expect(needsConsent(grant, scope({ sourceIds: [], workspaceId: 'table-2' }))).toBe(true);
    expect(needsConsent(grant, scope({ sourceIds: [], epoch: 4 }))).toBe(true);
    expect(needsConsent(grant, scope({ sourceIds: [], actorId: 'actor-b' }))).toBe(true);
    expect(needsConsent(grant, scope({ sourceIds: [], mode: 'ask' }))).toBe(true);
    expect(needsConsent(consentKey(scope({ sourceIds: [], mode: 'ask' })), scope({ sourceIds: [], mode: 'draft' }))).toBe(true);
  });

  it('states the distinct table context and history scope for each endpoint', () => {
    expect(consentQuestion('draft')).toContain('active rules, records, and turn');
    expect(consentQuestion('draft')).toContain('Chat history is not included');
    expect(consentQuestion('ask')).toContain('up to six recent private chat exchanges');
    expect(consentQuestion('ask')).toContain('Private source files are excluded');
  });
});
