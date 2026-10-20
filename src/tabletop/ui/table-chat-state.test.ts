import { describe, expect, it } from 'vitest';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';
import { canApplyWorkspaceRefresh, draftRefreshPatch, historyCard, isUncertainRequest, mergeChatHistory, sameChatRequestScope, tableChatMode, type ChatCard } from './table-chat-state';

const job = (patch: Partial<TableAssistantJob> = {}): TableAssistantJob => ({
  id: 'a'.repeat(64),
  createdAt: 1_700_000_000_000,
  prompt: 'How many orders are open?',
  status: 'completed',
  expectedRevision: 'b'.repeat(64),
  expectedEpoch: 1,
  confirmationStatus: 'available',
  result: { kind: 'explanation', text: 'There are three.', references: [] },
  ...patch,
});

describe('private table chat recovery state', () => {
  it('rejects delayed projection reads after reset, seat changes, navigation, or a newer update', () => {
    const original = { id: 'table-1', epoch: 3, kind: 'table', actor: { actorId: 'actor-a', role: 'participant', seat: 'member-1' } };
    expect(canApplyWorkspaceRefresh(original, original, original, 4, 4)).toBe(true);
    expect(canApplyWorkspaceRefresh(original, { ...original, epoch: 4 }, original, 4, 5)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, original, { ...original, epoch: 2 }, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, { ...original, actor: { ...original.actor, actorId: 'actor-b' } }, original, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, original, { ...original, actor: { ...original.actor, role: 'owner' } }, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, original, { ...original, actor: { ...original.actor, seat: 'member-2' } }, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, { ...original, id: 'table-2' }, original, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, null, original, 4, 4)).toBe(false);
    expect(canApplyWorkspaceRefresh(original, original, original, 4, 5)).toBe(false);
  });
  it('keeps owner candidate drafting on the proposal endpoint until a program is active', () => {
    expect(tableChatMode('owner', false, false)).toBe('draft');
    expect(tableChatMode('owner', true, false)).toBe('ask');
    expect(tableChatMode('owner', true, true)).toBe('draft');
    expect(tableChatMode('participant', false, true)).toBe('ask');
  });

  it('returns an active table to assistant mode when explicit rule editing is cancelled', () => {
    expect(tableChatMode('owner', true, true)).toBe('draft');
    expect(tableChatMode('owner', true, false)).toBe('ask');
  });

  it('keeps draft refresh failures visible, clears them only on scoped success, and ignores stale results', () => {
    expect(draftRefreshPatch('table-a:owner', 'table-a:owner', 'Connection lost.')).toEqual({
      checking: false,
      pollError: 'The draft is ready, but the table could not refresh: Connection lost.',
    });
    expect(draftRefreshPatch('table-a:owner', 'table-a:owner')).toEqual({
      checking: false,
      pollError: undefined,
      pollTimedOut: false,
    });
    expect(draftRefreshPatch('table-a:owner', 'table-b:owner')).toBeNull();
  });

  it('allows an original-body retry only for the same actor, table, and epoch', () => {
    const original = { id: 'table-1', epoch: 3, kind: 'table', revision: 'r1', actor: { actorId: 'actor-a', role: 'owner' } };
    const laterRevision = { ...original, revision: 'r2' };

    expect(sameChatRequestScope(original, laterRevision)).toBe(true);
    expect(sameChatRequestScope(original, { ...laterRevision, id: 'table-2' })).toBe(false);
    expect(sameChatRequestScope(original, { ...laterRevision, epoch: 4 })).toBe(false);
    expect(sameChatRequestScope(original, { ...laterRevision, actor: { actorId: 'actor-b', role: 'owner' } })).toBe(false);
    expect(sameChatRequestScope(original, { ...laterRevision, actor: { actorId: 'actor-a', role: 'participant' } })).toBe(false);
  });

  it('does not guess-match an uncertain request to an identical prompt in history', () => {
    const pending: ChatCard = {
      id: 'answer-command-1',
      kind: 'answer',
      prompt: 'How many orders are open?',
      createdAt: 1_700_000_000_100,
      phase: 'failed',
      requestCommandId: '00000000-0000-4000-8000-000000000001',
      requestUncertain: true,
      requestError: 'Connection lost.',
    };

    const earlier = job({ id: 'a'.repeat(64), createdAt: 1_700_000_000_000 });
    const later = job({ id: 'c'.repeat(64), createdAt: 1_700_000_000_200 });
    const reconciled = mergeChatHistory([pending], [historyCard(earlier, 'answer-server-job-1'), historyCard(later, 'answer-server-job-2')]);

    expect(reconciled).toHaveLength(3);
    const unresolved = reconciled.find((card) => card.id === 'answer-command-1');
    expect(unresolved).toMatchObject({
      requestCommandId: '00000000-0000-4000-8000-000000000001',
      phase: 'failed',
      requestUncertain: true,
    });
    expect(unresolved && isUncertainRequest(unresolved)).toBe(true);
    expect(reconciled.find((card) => card.id === 'answer-server-job-1')?.job?.id).toBe('a'.repeat(64));
    expect(reconciled.find((card) => card.id === 'answer-server-job-2')?.job?.id).toBe('c'.repeat(64));
  });

  it('merges only an exact server job ID and keeps the local card identity', () => {
    const acknowledged: ChatCard = { id: 'answer-command-2', kind: 'answer', prompt: 'How many orders are open?', createdAt: 1_700_000_000_000, phase: 'waiting', requestCommandId: '00000000-0000-4000-8000-000000000002', job: job({ status: 'running', result: undefined }) };
    const updated = historyCard(job({ status: 'completed' }), 'answer-history-copy');

    const merged = mergeChatHistory([acknowledged], [updated]);

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ id: 'answer-command-2', requestCommandId: '00000000-0000-4000-8000-000000000002', phase: 'complete', job: { status: 'completed' } });
  });

  it('rehydrates running and failed server states instead of discarding them', () => {
    const running = historyCard(job({ id: 'c'.repeat(64), status: 'running', result: undefined, confirmationStatus: undefined }), 'answer-running');
    const failed = historyCard(job({ id: 'd'.repeat(64), status: 'failed', result: undefined, message: 'Provider unavailable.' }), 'answer-failed');
    const pending: ChatCard = { id: 'answer-pending', kind: 'answer', prompt: 'Another question', createdAt: 1_700_000_000_200, phase: 'waiting' };

    const merged = mergeChatHistory([pending], [running, failed]);

    expect(merged.map((card) => card.id)).toEqual(['answer-pending', 'answer-running', 'answer-failed']);
    expect(merged.find((card) => card.id === 'answer-running')?.phase).toBe('waiting');
    expect(merged.find((card) => card.id === 'answer-failed')).toMatchObject({ phase: 'failed', error: 'Provider unavailable.' });
  });
});
