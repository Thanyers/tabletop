import { describe, expect, it } from 'vitest';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';
import { MAX_JOB_PARTIAL_CONTENT_CHARS, MAX_JOB_THINKING_TAIL_CHARS, type ModelFailureDetails } from '../shared/model-job-progress';
import {
  canApplyWorkspaceRefresh, draftFailureSummary, draftInFlight, draftLimitMs, draftLimitSeconds, draftPartialLabel,
  draftPollLimitMs, draftRefreshBackoffMs, draftRefreshPatch, draftStopReason, draftThinkingLabel, historyCard,
  LIVE_THINKING_LINE_CHARS, liveThinkingLine, nextQueuedDraft, isUncertainRequest, mergeChatHistory, sameChatRequestScope, tableChatMode, type ChatCard,
} from './table-chat-state';

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

  it('routes a specific rule change to drafting while keeping a question in ask mode', () => {
    const request = (prompt: string) => ({ prompt, hasCreateAction: false, referencedRule: true });
    expect(tableChatMode('owner', true, false, request('Make this rule easier to understand'))).toBe('draft');
    expect(tableChatMode('owner', true, false, request('What does this rule do?'))).toBe('ask');
    expect(tableChatMode('owner', true, false, { prompt: 'Change this rule', hasCreateAction: false })).toBe('ask');
    expect(tableChatMode('participant', true, true, request('Make this rule easier'))).toBe('ask');
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

describe('draft refresh backoff (F025)', () => {
  it('grows with each attempt so a racing projection can settle', () => {
    expect([0, 1, 2].map(draftRefreshBackoffMs)).toEqual([150, 300, 450]);
  });
});

describe('draft server limit and early stop (F045)', () => {
  const failure = (patch: Partial<ModelFailureDetails> = {}): ModelFailureDetails => ({
    timedOutBy: 'server',
    limitMs: 240_000,
    elapsedMs: 240_010,
    receivedChars: 1_300,
    reasoningChars: 8_200,
    ...patch,
  });

  it('reads the configured limit, falling back to 240s when the server sends none', () => {
    expect(draftLimitMs(undefined)).toBe(240_000);
    expect(draftLimitMs({})).toBe(240_000);
    expect(draftLimitSeconds(undefined)).toBe(240);
    expect(draftLimitSeconds({ limitMs: 240_000 })).toBe(240);
    expect(draftLimitSeconds({ limitMs: 180_000 })).toBe(180);
    expect(draftLimitSeconds({ limitMs: 300_000 })).toBe(300);
    // A missing or unusable limit must not shorten the label or the polling window.
    expect(draftLimitSeconds({ limitMs: 0 })).toBe(240);
    expect(draftLimitSeconds({ limitMs: -5 })).toBe(240);
    expect(draftLimitSeconds({ limitMs: Number.NaN })).toBe(240);
    // Under a second still reads as one second instead of "0s".
    expect(draftLimitSeconds({ limitMs: 400 })).toBe(1);
  });

  it('polls a draft for its configured limit plus 70s, and keeps the old 250s default window', () => {
    expect(draftPollLimitMs(undefined)).toBe(310_000);
    expect(draftPollLimitMs({ limitMs: 240_000 })).toBe(310_000);
    expect(draftPollLimitMs({ limitMs: 180_000 })).toBe(250_000);
    expect(draftPollLimitMs({ limitMs: 300_000 })).toBe(370_000);
  });

  it('summarizes our own 180s limit separately from a 240s one, naming the same seconds as the server', () => {
    const stoppedAt180 = draftFailureSummary(failure({ limitMs: 180_000, receivedChars: 1_300 }));
    expect(stoppedAt180).toMatchObject({ timedOutBy: 'server', limitMs: 180_000, limitLabel: '180s', partialChars: 0, thinkingChars: 0 });
    expect(stoppedAt180 && draftStopReason(stoppedAt180)).toBe('Why it stopped: our own 180s server limit, not the AI provider.');

    const stoppedAt240 = draftFailureSummary(failure({ limitMs: 240_000, receivedChars: 1_300 }));
    expect(stoppedAt240).toMatchObject({ timedOutBy: 'server', limitMs: 240_000, limitLabel: '240s' });
    expect(stoppedAt240 && draftStopReason(stoppedAt240)).toBe('Why it stopped: our own 240s server limit, not the AI provider.');
  });

  it('marks a provider close as the provider, not our limit', () => {
    const closedByProvider = draftFailureSummary(failure({ timedOutBy: 'provider', limitMs: 240_000, receivedChars: 400 }));
    expect(closedByProvider).toMatchObject({ timedOutBy: 'provider', limitLabel: '240s' });
    expect(closedByProvider && draftStopReason(closedByProvider)).toBe('Why it stopped: the AI provider closed the connection before our 240s server limit.');
  });

  it('returns null without failure details, so a plain failure renders no empty block', () => {
    expect(draftFailureSummary(undefined)).toBeNull();
  });

  it('keeps the partial answer and thinking tail bounded and counts only what is shown', () => {
    const oversized = draftFailureSummary(failure({
      partialContent: 'a'.repeat(MAX_JOB_PARTIAL_CONTENT_CHARS + 900),
      thinkingTail: 'b'.repeat(MAX_JOB_THINKING_TAIL_CHARS + 300),
    }));
    expect(oversized).not.toBeNull();
    expect(oversized?.partialChars).toBe(MAX_JOB_PARTIAL_CONTENT_CHARS);
    expect(oversized?.partialText).toHaveLength(MAX_JOB_PARTIAL_CONTENT_CHARS);
    expect(oversized?.thinkingChars).toBe(MAX_JOB_THINKING_TAIL_CHARS);
    expect(oversized?.thinkingText).toHaveLength(MAX_JOB_THINKING_TAIL_CHARS);
    expect(oversized && draftPartialLabel(oversized)).toMatch(/^Show the 4\D?000 characters of the draft that arrived before it stopped$/u);
    expect(oversized && draftThinkingLabel(oversized)).toBe("Show the last 600 characters of the model's thinking");
  });

  it('keeps the received text when no partial answer was kept, and says so instead of showing an empty block', () => {
    const stoppedBeforeText = draftFailureSummary(failure({ partialContent: undefined, thinkingTail: undefined }));
    expect(stoppedBeforeText).toMatchObject({ partialChars: 0, thinkingChars: 0 });
    expect(stoppedBeforeText?.partialText).toBeUndefined();
    expect(stoppedBeforeText?.thinkingText).toBeUndefined();
    expect(stoppedBeforeText && draftPartialLabel(stoppedBeforeText)).toBe('No draft text had arrived before it stopped');
  });

  it('shows a short partial answer as-is instead of padding it to the bound', () => {
    const short = draftFailureSummary(failure({ partialContent: '{\n  "rules": [', thinkingTail: 'checking the columns' }));
    expect(short?.partialText).toBe('{\n  "rules": [');
    expect(short?.partialChars).toBe(14);
    expect(short?.thinkingText).toBe('checking the columns');
    expect(short?.thinkingChars).toBe(20);
  });
});

describe('live thinking line while a draft runs (F050)', () => {
  it('returns null while the job has no thinking text, so the card keeps its old shape', () => {
    expect(liveThinkingLine(undefined)).toBeNull();
    expect(liveThinkingLine('')).toBeNull();
    expect(liveThinkingLine('  \n\t ')).toBeNull();
  });

  it('collapses whitespace and keeps short thinking whole', () => {
    expect(liveThinkingLine('checking  the\ncolumns\tnow')).toBe('checking the columns now');
  });

  it('keeps the newest text and cuts on a word boundary when the tail is long', () => {
    const tail = `${'alpha '.repeat(100)}newest conclusion`;
    const line = liveThinkingLine(tail);
    expect(line).not.toBeNull();
    expect(line?.startsWith('…')).toBe(true);
    expect(line?.slice(1).startsWith('alpha ')).toBe(true);
    expect(line?.endsWith('newest conclusion')).toBe(true);
    expect(line?.length).toBeLessThanOrEqual(LIVE_THINKING_LINE_CHARS + 1);
    expect(line).not.toContain('  ');
  });

  it('is bounded by the job tail, never by an unbounded provider reply', () => {
    const line = liveThinkingLine('x'.repeat(MAX_JOB_THINKING_TAIL_CHARS));
    expect(line).toHaveLength(LIVE_THINKING_LINE_CHARS + 1);
  });
});

describe('parallel questions and queued rule requests (F038)', () => {
  const card = (id: string, kind: ChatCard['kind'], phase: ChatCard['phase'], patch: Partial<ChatCard> = {}): ChatCard =>
    ({ id, kind, phase, prompt: id, createdAt: 0, ...patch });

  it('treats a sending, generating or still-refreshing rule draft as running, but not questions', () => {
    expect(draftInFlight([card('a', 'answer', 'waiting'), card('b', 'answer', 'sending')])).toBe(false);
    expect(draftInFlight([card('d', 'draft', 'sending')])).toBe(true);
    expect(draftInFlight([card('d', 'draft', 'waiting')])).toBe(true);
    expect(draftInFlight([card('d', 'draft', 'complete', { checking: true })])).toBe(true);
    expect(draftInFlight([card('d', 'draft', 'complete'), card('e', 'draft', 'failed'), card('q', 'draft', 'queued')])).toBe(false);
  });

  it('starts the oldest queued rule request only once nothing else is drafting', () => {
    // Cards are kept newest first.
    const queued = [card('newer', 'draft', 'queued'), card('older', 'draft', 'queued'), card('running', 'draft', 'waiting')];
    expect(nextQueuedDraft(queued)).toBeUndefined();
    const finished = queued.map((item) => item.id === 'running' ? { ...item, phase: 'complete' as const } : item);
    expect(nextQueuedDraft(finished)?.id).toBe('older');
    expect(nextQueuedDraft([card('a', 'answer', 'waiting'), card('q', 'draft', 'queued')])?.id).toBe('q');
    expect(nextQueuedDraft([card('a', 'answer', 'waiting')])).toBeUndefined();
  });
});
