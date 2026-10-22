import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearControlDraft, clearWorkspaceControlDrafts, controlDraftKey, controlDraftsRevision, readControlDraft, readControlDraftValue, resetControlDrafts, subscribeControlDrafts, writeControlDraft, type ControlDraftTarget } from './control-drafts';

const target: ControlDraftTarget = { workspaceId: 'ws-1', actionId: 'apply_damage', parameterId: 'damage' };

describe('shared control draft store', () => {
  beforeEach(() => resetControlDrafts());

  it('keys drafts by workspace, action, and parameter', () => {
    writeControlDraft(target, 9, 'dice:damage-dice', 1_000);

    expect(readControlDraftValue(target)).toBe(9);
    expect(readControlDraftValue({ ...target, workspaceId: 'ws-2' })).toBeUndefined();
    expect(readControlDraftValue({ ...target, actionId: 'heal' })).toBeUndefined();
    expect(readControlDraftValue({ ...target, parameterId: 'modifier' })).toBeUndefined();
  });

  it('cannot confuse keys whose parts contain the separator', () => {
    expect(controlDraftKey({ workspaceId: 'a|b', actionId: 'c', parameterId: 'd' }))
      .not.toBe(controlDraftKey({ workspaceId: 'a', actionId: 'b|c', parameterId: 'd' }));
  });

  it('notifies subscribers once per real change and stops after unsubscribe', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeControlDrafts(listener);
    const revision = controlDraftsRevision();

    writeControlDraft(target, 9, 'dice:damage-dice');
    writeControlDraft(target, 9, 'dice:damage-dice');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(controlDraftsRevision()).toBe(revision + 1);

    writeControlDraft(target, 7, 'control:damage-form');
    expect(listener).toHaveBeenCalledTimes(2);
    expect(readControlDraft(target)).toMatchObject({ value: 7, source: 'control:damage-form' });

    unsubscribe();
    writeControlDraft(target, 11, 'dice:damage-dice');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('records the writer and timestamp of the last write', () => {
    writeControlDraft(target, 4, 'dice:damage-dice', 1_234);

    expect(readControlDraft(target)).toEqual({ ...target, value: 4, source: 'dice:damage-dice', updatedAt: 1_234 });
  });

  it('clears one target and every draft of a workspace', () => {
    const otherParameter = { ...target, parameterId: 'modifier' };
    const otherWorkspace = { ...target, workspaceId: 'ws-2' };
    writeControlDraft(target, 1, 'dice:a');
    writeControlDraft(otherParameter, 2, 'dice:a');
    writeControlDraft(otherWorkspace, 3, 'dice:a');

    clearControlDraft(target);
    expect(readControlDraftValue(target)).toBeUndefined();
    expect(readControlDraftValue(otherParameter)).toBe(2);

    clearWorkspaceControlDrafts('ws-1');
    expect(readControlDraftValue(otherParameter)).toBeUndefined();
    expect(readControlDraftValue(otherWorkspace)).toBe(3);
  });

  it('notifies on clear and resets the revision for tests', () => {
    const listener = vi.fn();
    subscribeControlDrafts(listener);
    writeControlDraft(target, 1, 'dice:a');
    clearControlDraft(target);

    expect(listener).toHaveBeenCalledTimes(2);
    resetControlDrafts();
    expect(controlDraftsRevision()).toBe(0);
    expect(readControlDraftValue(target)).toBeUndefined();
  });
});
