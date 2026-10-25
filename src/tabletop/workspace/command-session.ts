import { ApiFailure, type TabletopCapabilities, type UploadRequest } from '../client';
import type { CommandAck, WorkspaceView } from '../shared/contracts';
import type { RollResult } from '../shared/roll';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';
import { matchesExpectedTableCandidateView, sameTableCandidateScope } from './table-candidate-apply';
import { canApplyWorkspaceRefresh, draftRefreshBackoffMs, sameChatRequestScope, type AddableWebSource } from './table-chat-state';
import { errorText } from './error-text';
import { decodeSourceText, inferredMime } from './source-file';

/**
 * F078-T5a — the client's workspace command/readback seam.
 *
 * `TabletopApp` used to own session boot, navigation, projection state, command submission,
 * acknowledgement readback, file import, AI callbacks and dialog composition in one component.
 * This module is the command half of that: everything that takes an authorized projection, sends
 * one command, waits for the authority's acknowledgement, reads the projection back and decides
 * whether the result still applies to the table the member is looking at.
 *
 * Deliberate properties, because they are the contract the component relied on implicitly:
 *
 * - The projection and capabilities are read through getters on every call. A render-time copy
 *   would let a late acknowledgement overwrite a table the member already switched to.
 * - The projection clock is shared with the composition root: applying a projection bumps it,
 *   and readback compares the value captured before the command with the value after, so an
 *   unchanged clock means "nothing newer arrived, the acknowledgement is current".
 * - Nothing here decides policy. Guards such as epoch, revision, membership, consent, billing and
 *   auto-apply stay on the authority; this module only refuses to draw a result onto the wrong
 *   table.
 * - No React import: the seam is plain async functions over injected deps, so the race and retry
 *   paths are unit-testable without rendering.
 */

/** The narrow client surface this seam needs. `TabletopClient` satisfies it structurally. */
export interface WorkspaceCommandClient {
  command(view: WorkspaceView, type: string, payload: unknown): Promise<CommandAck>;
  workspace(id: string): Promise<WorkspaceView>;
  upload(view: WorkspaceView, input: Omit<UploadRequest, 'expectedRevision' | 'expectedEpoch' | 'commandId'>): Promise<CommandAck>;
  importTableSource(view: WorkspaceView, filename: string, text: string): Promise<CommandAck>;
  confirmTableAssistantAction(workspaceId: string, jobId: string, expectedRevision: string, expectedEpoch: number, commandId: ReturnType<typeof crypto.randomUUID>): Promise<CommandAck>;
}

export type UploadKind = 'shipments' | 'invoice' | 'rate-card';

/**
 * A monotonically increasing marker for applied projections. The composition root bumps `value`
 * inside its projection setter; readback compares it across an await to detect a newer projection.
 */
export interface ProjectionClock {
  value: number;
}

export interface WorkspaceCommandDeps {
  client: WorkspaceCommandClient;
  /** The current authorized projection read fresh on every call, or null before a table is open. */
  readWorkspace(): WorkspaceView | null;
  /** Applies a projection through the app setter, which also resets per-table UI state. */
  applyWorkspace(next: WorkspaceView | null): void;
  /** Writes the projection ref without a render, to keep a pinned candidate stage current. */
  writeWorkspaceRef(next: WorkspaceView): void;
  projectionClock: ProjectionClock;
  capabilities(): TabletopCapabilities;
  setBusy(key: string | null): void;
  notify(text: string, tone?: 'info' | 'error' | 'success', action?: { label: string; run: () => void }): void;
  /** Refreshes the member's table list after a command changed directory-visible metadata. */
  refreshSession(): Promise<unknown>;
  /** Base64 payload for the legacy upload route; injected so tests do not need a FileReader. */
  encodeBase64(file: File): Promise<string>;
  /** F048: keeps the server roll this member just received for the dice control. */
  recordServerRoll?(view: WorkspaceView, actionId: string, parameterId: string, roll: RollResult): void;
  /** Clears invitation panels that a successful reset revoked; the composition root owns that UI state. */
  onWorkspaceReset?(): void;
}

export interface WorkspaceCommandSession {
  /**
   * Reads the projection back after an acknowledgement. Returns the acknowledgement's projection
   * when nothing newer arrived, otherwise the newest read; refuses to return a different table.
   */
  latestAfterAck(ack: CommandAck, workspaceId: string, requestSequence: number): Promise<WorkspaceView>;
  /** Sends one command and applies its projection only if it still belongs to the open table. */
  runCommand(type: string, payload: unknown, expectedView?: WorkspaceView): Promise<WorkspaceView | null>;
  /** Legacy invoice/shipment upload; the table source path is `importTableFile`. */
  upload(kind: UploadKind, file: File): Promise<void>;
  /** Files added after a table exists (F008/F064). Never mutates the domain in the browser. */
  importTableFile(targetView: WorkspaceView, file: File): Promise<WorkspaceView>;
  /** F064 slice C: attach provided web sources; the owner reviews them before use. */
  addWebSources(targetView: WorkspaceView, sources: AddableWebSource[]): Promise<void>;
  /** Confirms a stored assistant action proposal; `busy` is the caller's live foreground marker. */
  confirmTableAssistantAction(targetView: WorkspaceView, job: TableAssistantJob, commandId: ReturnType<typeof crypto.randomUUID>, busy: boolean): Promise<void>;
  /** F025: refresh a projection that changed elsewhere, backing off instead of failing a ready draft. */
  refreshWorkspaceProjection(workspaceId: string): Promise<void>;
}

/**
 * Whether two projections are the same table, epoch and member. Moved here from `TabletopApp`
 * unchanged so the component and the command seam share one definition of "same seat".
 */
export function sameWorkspaceActor(current: WorkspaceView | null, expected: WorkspaceView): boolean {
  return current !== null
    && current.id === expected.id
    && current.epoch === expected.epoch
    && current.actor.actorId === expected.actor.actorId
    && current.kind === expected.kind;
}

export function createWorkspaceCommandSession(deps: WorkspaceCommandDeps): WorkspaceCommandSession {
  const { client, projectionClock } = deps;

  const sameActor = sameWorkspaceActor;

  const latestAfterAck = async (ack: CommandAck, workspaceId: string, requestSequence: number): Promise<WorkspaceView> => {
    let current = deps.readWorkspace();
    if (current?.id && current.id !== workspaceId) return current;
    if (!ack.duplicate && projectionClock.value === requestSequence) return ack.workspace;
    let latest: WorkspaceView | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      current = deps.readWorkspace();
      if (current?.id && current.id !== workspaceId) return current;
      const sequenceBeforeRead = projectionClock.value;
      latest = await client.workspace(workspaceId);
      current = deps.readWorkspace();
      if (current?.id && current.id !== workspaceId) return current;
      if (projectionClock.value === sequenceBeforeRead) return latest;
    }
    const received = deps.readWorkspace();
    if (received?.id === workspaceId) return received;
    if (latest) return latest;
    throw new ApiFailure('The action was accepted, but the latest table could not be refreshed. Refresh before repeating it.', 0);
  };

  const runCommand = async (type: string, payload: unknown, expectedView?: WorkspaceView): Promise<WorkspaceView | null> => {
    const current = deps.readWorkspace();
    if (!current) return null;
    if (expectedView && !matchesExpectedTableCandidateView(current, expectedView)) return null;
    const commandView = expectedView ?? current;
    if (commandView.kind === 'table' && deps.capabilities().tableReadOnly) {
      deps.notify('Editing this table is temporarily paused. You can still inspect its current records and rules.', 'info');
      return null;
    }
    const requestSequence = projectionClock.value;
    // Layout writes have their own queue and revision. Background placement must
    // neither disable the composer nor clear a foreground command's busy state.
    const blocksForeground = type !== 'canvas.layout';
    if (blocksForeground) deps.setBusy(type);
    try {
      const ack = await client.command(commandView, type, payload);
      // F048: keep the dice the authority just rolled for this member, keyed by action/parameter.
      if (type === 'table.roll' && ack.roll) {
        const request = payload as { actionId?: unknown; parameterId?: unknown } | null;
        if (request && typeof request.actionId === 'string' && typeof request.parameterId === 'string') {
          deps.recordServerRoll?.(ack.workspace, request.actionId, request.parameterId, ack.roll);
        }
      }
      if (expectedView && !sameTableCandidateScope(ack.workspace, expectedView)) return null;
      if (type === 'canvas.layout' && (!deps.readWorkspace() || !sameChatRequestScope(commandView, deps.readWorkspace()!))) return null;
      const latest = await latestAfterAck(ack, commandView.id, requestSequence);
      if (expectedView) {
        const live = deps.readWorkspace();
        const liveIsPinned = matchesExpectedTableCandidateView(live, expectedView);
        const liveIsAccepted = sameTableCandidateScope(live, expectedView) && live?.revision === ack.workspace.revision;
        if (!sameTableCandidateScope(latest, expectedView)
          || latest.revision !== ack.workspace.revision
          || (!liveIsPinned && !liveIsAccepted)
          || deps.capabilities().tableReadOnly) return null;
      }
      if (type === 'canvas.layout' && (!deps.readWorkspace()
        || !sameChatRequestScope(commandView, deps.readWorkspace()!)
        || !sameChatRequestScope(commandView, latest))) return null;
      // Keep the pinned next stage current immediately; React state may render later.
      if (expectedView) deps.writeWorkspaceRef(latest);
      deps.applyWorkspace(latest);
      if (type === 'evolve.activate') deps.notify(`The change is active at revision ${latest.domain.ruleRevision}.`, 'success');
      else if (type === 'workspace.reset') {
        deps.onWorkspaceReset?.();
        deps.notify('The table was reset. Previous member access and invitations were revoked.', 'success');
      }
      else if (type === 'teaching.answer') deps.notify('Your answer was checked against the current lesson.', 'success');
      else if (type === 'encounter.endTurn') deps.notify('The server started the next turn and updated its action points.', 'success');

      await deps.refreshSession().catch(() => undefined);
      if (expectedView && (!sameTableCandidateScope(deps.readWorkspace(), expectedView)
        || deps.readWorkspace()?.revision !== latest.revision
        || deps.capabilities().tableReadOnly)) return null;
      return latest;
    } catch (error) {
      if (expectedView && !sameTableCandidateScope(deps.readWorkspace(), expectedView)) return null;
      if (type === 'canvas.layout' && (!deps.readWorkspace() || !sameChatRequestScope(commandView, deps.readWorkspace()!))) return null;
      if (error instanceof ApiFailure && error.conflict) {
        try {
          const sequenceBeforeRead = projectionClock.value;
          const fresh = await client.workspace(commandView.id);
          if (canApplyWorkspaceRefresh(commandView, deps.readWorkspace(), fresh, sequenceBeforeRead, projectionClock.value)) deps.applyWorkspace(fresh);
          await deps.refreshSession().catch(() => undefined);
          // Someone else moved a card; the Canvas retries quietly on the newer layout (F007).
          if (error.code !== 'STALE_LAYOUT') deps.notify('This table changed elsewhere. The latest version is loaded; review and repeat your edit if it still applies.', 'error');
        } catch (refreshError) { deps.notify(errorText(refreshError), 'error'); }
      } else deps.notify(errorText(error), 'error');
      return null;
    } finally { if (blocksForeground) deps.setBusy(null); }
  };

  const upload = async (kind: UploadKind, file: File): Promise<void> => {
    if (!deps.capabilities().uploads) throw new Error('File uploads are disabled for this workspace service. Your existing rows and manual editing remain available.');
    const current = deps.readWorkspace();
    if (!current) throw new Error('Choose an invoice table before adding a source file.');
    deps.setBusy(`upload.${kind}`);
    try {
      const dataBase64 = await deps.encodeBase64(file);
      const requestSequence = projectionClock.value;
      const ack = await client.upload(current, { filename: file.name, mime: file.type || inferredMime(file.name), kind, dataBase64 });
      const latest = await latestAfterAck(ack, current.id, requestSequence);
      deps.applyWorkspace(latest);
      deps.notify(`${file.name} was added to this table. Review its extracted text before using it.`, 'success');
      await deps.refreshSession().catch(() => undefined);
    } catch (error) {
      if (error instanceof ApiFailure && error.conflict) {
        const fresh = await client.workspace(current.id).catch(() => null);
        if (fresh && deps.readWorkspace()?.id === current.id) deps.applyWorkspace(fresh);
        deps.notify('This table changed while the file was being prepared. The latest version is loaded; choose the file again if it still belongs here.', 'error');
      }
      throw new Error(errorText(error));
    } finally { deps.setBusy(null); }
  };

  const importTableFile = async (targetView: WorkspaceView, file: File): Promise<WorkspaceView> => {
    if (deps.capabilities().tableReadOnly) throw new ApiFailure('Editing this table is temporarily paused. Existing records and rules remain available to inspect.', 403, 'TABLE_READ_ONLY');
    const identity = { id: targetView.id, epoch: targetView.epoch, actorId: targetView.actor.actorId };
    const activeTarget = () => {
      const current = deps.readWorkspace();
      return current && current.id === identity.id && current.epoch === identity.epoch && current.actor.actorId === identity.actorId && current.kind === 'table' && current.domain.kind === 'table' ? current : null;
    };
    if (!activeTarget()) throw new ApiFailure('This table changed while the file was being prepared. Open it again and choose the file there.', 409);
    if (!/\.(csv|json|txt|md)$/iu.test(file.name)) throw new ApiFailure('Use a UTF-8 CSV, JSON, TXT or Markdown file. PDF and binary files are not supported.', 415, 'TABLE_FILE');
    if (file.size < 1 || file.size > 32 * 1024) throw new ApiFailure('Each source file must contain between 1 byte and 32 KiB.', 413, 'TABLE_FILE_SIZE');

    let text: string;
    try { text = decodeSourceText(await file.arrayBuffer()); }
    catch { throw new ApiFailure('This file is not valid UTF-8 text. Save it as UTF-8 and try again.', 415, 'TABLE_FILE'); }
    const current = activeTarget();
    if (!current || current.domain.kind !== 'table') throw new ApiFailure('This table changed while the file was being prepared. Open it again and choose the file there.', 409);
    const nextBytes = new TextEncoder().encode(text).byteLength;
    const existingBytes = current.domain.sources.reduce((sum, source) => sum + new TextEncoder().encode(source.text).byteLength, 0);
    if (current.domain.sources.length >= 4 || existingBytes + nextBytes > 64 * 1024) throw new ApiFailure('A table can hold up to four source files and 64 KiB total. Remove an unused source or choose a smaller file.', 413, 'TABLE_LIMIT');

    const requestSequence = projectionClock.value;
    deps.setBusy('table.import');
    try {
      const ack = await client.importTableSource(current, file.name, text);
      if (!activeTarget()) throw new ApiFailure(`${file.name} was added to ${targetView.title}, but the current table changed before it finished. The current view was left alone.`, 0);
      const latest = await latestAfterAck(ack, current.id, requestSequence);
      if (!activeTarget()) throw new ApiFailure(`${file.name} was added to ${targetView.title}, but you switched tables before it finished. The current view was left alone.`, 0);
      deps.applyWorkspace(latest);
      deps.notify(`${file.name} was added to ${targetView.title}. Review the source before using it in a rule change.`, 'success');
      await deps.refreshSession().catch(() => undefined);
      return latest;
    } catch (error) {
      if (error instanceof ApiFailure && error.conflict) {
        const fresh = await client.workspace(current.id).catch(() => null);
        if (fresh && activeTarget()) deps.applyWorkspace(fresh);
        deps.notify('This table changed while the file was being added. The latest version is loaded; choose the file again if it still belongs here.', 'error');
      } else deps.notify(errorText(error), 'error');
      throw new Error(errorText(error));
    } finally { deps.setBusy(null); }
  };

  // F064 slice C: the sources stay `provided` until the owner reviews them; the callback owns the
  // notice, so the chat card only disables its button while the command runs.
  const addWebSources = async (targetView: WorkspaceView, sources: AddableWebSource[]): Promise<void> => {
    if (sources.length === 0) return;
    try {
      const latest = await runCommand('table.addWebSources', { sources });
      if (!latest) return;
      deps.notify(`${sources.length} web source${sources.length === 1 ? '' : 's'} added to ${targetView.title}. Verify each one before asking AI to use it in a rule change.`, 'success');
    } catch (error) {
      deps.notify(errorText(error), 'error');
    }
  };

  const confirmTableAssistantAction = async (targetView: WorkspaceView, job: TableAssistantJob, commandId: ReturnType<typeof crypto.randomUUID>, busy: boolean): Promise<void> => {
    const current = deps.readWorkspace();
    if (!sameActor(current, targetView) || !current || current.kind !== 'table' || current.domain.kind !== 'table' || targetView.domain.kind !== 'table') {
      throw new ApiFailure('This table seat changed. Open the current table before confirming an action.', 409, 'STALE_EPOCH');
    }
    if (deps.capabilities().tableReadOnly) throw new ApiFailure('Actions for this table are temporarily paused.', 403, 'TABLE_READ_ONLY');
    if (!['owner', 'participant'].includes(current.actor.role)) throw new ApiFailure('This seat cannot confirm table actions.', 403);
    if (busy) throw new ApiFailure('Finish the current table update, then review this proposal again.', 409, 'STALE_REVISION');
    const proposal = job.result;
    if (job.status !== 'completed' || proposal?.kind !== 'action-proposal' || !proposal.confirmationRequired) throw new ApiFailure('This assistant response does not contain a confirmable action.', 409, 'STALE_REVISION');
    if (current.revision !== job.expectedRevision || current.epoch !== job.expectedEpoch || proposal.expectedRevision !== current.revision || proposal.expectedRuleRevision !== current.domain.ruleRevision || proposal.expectedActionRevision !== current.domain.actionRevision) {
      const fresh = await client.workspace(current.id).catch(() => null);
      if (fresh && sameActor(deps.readWorkspace(), current)) deps.applyWorkspace(fresh);
      throw new ApiFailure('The table changed after this proposal. Review the latest rules and ask again.', 409, 'STALE_REVISION');
    }

    const requestSequence = projectionClock.value;
    deps.setBusy('assistant.confirm');
    try {
      const ack = await client.confirmTableAssistantAction(current.id, job.id, job.expectedRevision, job.expectedEpoch, commandId);
      if (!sameActor(deps.readWorkspace(), current)) return;
      const latest = await latestAfterAck(ack, current.id, requestSequence);
      if (sameActor(deps.readWorkspace(), current)) deps.applyWorkspace(latest);
      await deps.refreshSession().catch(() => undefined);
      deps.notify('The confirmed action was applied to the shared table.', 'success');
    } catch (error) {
      if (error instanceof ApiFailure && error.conflict) {
        const fresh = await client.workspace(current.id).catch(() => null);
        if (fresh && sameActor(deps.readWorkspace(), current)) deps.applyWorkspace(fresh);
        deps.notify('The table changed before this action could be confirmed. Its latest state is loaded; ask again if the action still applies.', 'error');
      } else deps.notify(errorText(error), 'error');
      throw error;
    } finally { deps.setBusy(null); }
  };

  const refreshWorkspaceProjection = async (workspaceId: string): Promise<void> => {
    const expected = deps.readWorkspace();
    if (!expected || expected.id !== workspaceId) throw new ApiFailure('The current table changed before it could be refreshed.', 409, 'STALE_EPOCH');
    let newest: WorkspaceView | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const requestSequence = projectionClock.value;
      const latest = await client.workspace(workspaceId);
      const current = deps.readWorkspace();
      if (!current || !sameChatRequestScope(expected, current) || !sameChatRequestScope(expected, latest)) {
        throw new ApiFailure('The table or seat changed while refreshing. Open the current table before continuing.', 409, 'STALE_EPOCH');
      }
      if (canApplyWorkspaceRefresh(expected, current, latest, requestSequence, projectionClock.value)) {
        deps.applyWorkspace(latest);
        return;
      }
      // F025: a concurrent projection won the race; keep the freshest response and give it a moment to settle
      // instead of failing a draft that is already ready.
      newest = latest;
      await new Promise((resolve) => setTimeout(resolve, draftRefreshBackoffMs(attempt)));
    }
    if (newest) {
      deps.applyWorkspace(newest);
      return;
    }
    throw new ApiFailure('The table kept changing while refreshing. Try the refresh again.', 409, 'STALE_REVISION');
  };

  return { latestAfterAck, runCommand, upload, importTableFile, addWebSources, confirmTableAssistantAction, refreshWorkspaceProjection };
}
