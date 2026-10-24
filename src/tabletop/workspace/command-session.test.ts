import { describe, expect, it, vi } from 'vitest';
import { ApiFailure, type TabletopCapabilities } from '../client';
import type { CommandAck, WorkspaceView } from '../shared/contracts';
import type { TableAssistantJob } from '../shared/table-assistant-contracts';
import { createTableState } from '../domain/table';
import { createWorkspaceCommandSession, sameWorkspaceActor, type ProjectionClock, type WorkspaceCommandDeps } from './command-session';
import { errorText } from './error-text';
import { decodeSourceText, inferredMime } from './source-file';

/**
 * F078-T5a: the command/readback seam is covered here instead of through the rendered component.
 * Every case below is one of the races the component handled implicitly before the extraction.
 */

function tableWorkspace(overrides: Partial<WorkspaceView> = {}): WorkspaceView {
  return {
    id: 'room-a',
    title: 'Table A',
    kind: 'table',
    epoch: 1,
    revision: 'rev-1',
    actor: { actorId: 'owner-a', name: 'Owner', role: 'owner' },
    members: [],
    domain: createTableState(),
    createdAt: 0,
    expiresAt: 9_999_999_999_999,
    ...overrides,
  } as WorkspaceView;
}

function ack(workspace: WorkspaceView, duplicate = false): CommandAck {
  return { ok: true, commandId: 'command-1', duplicate, workspace };
}

const baseCapabilities: TabletopCapabilities = {
  uploads: true,
  tableReadOnly: false,
  tableAssistant: { available: false, reason: 'Not configured in this test.' },
  model: { enabled: false, reason: 'Not configured in this test.' },
};

interface Harness {
  session: ReturnType<typeof createWorkspaceCommandSession>;
  client: {
    command: ReturnType<typeof vi.fn>;
    workspace: ReturnType<typeof vi.fn>;
    upload: ReturnType<typeof vi.fn>;
    importTableSource: ReturnType<typeof vi.fn>;
    confirmTableAssistantAction: ReturnType<typeof vi.fn>;
  };
  clock: ProjectionClock;
  applied: (WorkspaceView | null)[];
  busy: (string | null)[];
  notices: { text: string; tone?: 'info' | 'error' | 'success' }[];
  refreshSession: ReturnType<typeof vi.fn>;
  current(): WorkspaceView | null;
  switchTo(workspace: WorkspaceView | null): void;
  readWorkspace: () => WorkspaceView | null;
}

function harness(options: { workspace?: WorkspaceView | null; capabilities?: Partial<TabletopCapabilities> } = {}): Harness {
  let workspace = options.workspace === undefined ? tableWorkspace() : options.workspace;
  const clock: ProjectionClock = { value: 0 };
  const applied: (WorkspaceView | null)[] = [];
  const busy: (string | null)[] = [];
  const notices: Harness['notices'] = [];
  const client = {
    command: vi.fn(),
    workspace: vi.fn(),
    upload: vi.fn(),
    importTableSource: vi.fn(),
    confirmTableAssistantAction: vi.fn(),
  };
  const refreshSession = vi.fn(async () => undefined);
  const readWorkspace = () => workspace;
  const deps: WorkspaceCommandDeps = {
    client,
    readWorkspace,
    // Mirrors the component setter: a non-null projection bumps the shared clock.
    applyWorkspace: (next) => {
      applied.push(next);
      if (next) { workspace = next; clock.value += 1; } else workspace = null;
    },
    writeWorkspaceRef: (next) => { workspace = next; },
    projectionClock: clock,
    capabilities: () => ({ ...baseCapabilities, ...options.capabilities }),
    setBusy: (key) => { busy.push(key); },
    notify: (text, tone) => { notices.push({ text, ...(tone ? { tone } : {}) }); },
    refreshSession,
    encodeBase64: async () => 'QUJD',
    recordServerRoll: vi.fn(),
    onWorkspaceReset: vi.fn(),
  };
  return {
    session: createWorkspaceCommandSession(deps),
    client,
    clock,
    applied,
    busy,
    notices,
    refreshSession,
    current: () => workspace,
    switchTo: (next) => { workspace = next; clock.value += 1; },
    readWorkspace,
  };
}

describe('workspace command/readback seam', () => {
  it('applies the acknowledgement projection without a second read when nothing newer arrived', async () => {
    const h = harness();
    const accepted = tableWorkspace({ revision: 'rev-2' });
    h.client.command.mockResolvedValue(ack(accepted));

    const result = await h.session.runCommand('table.act', { actionId: 'increment' });

    expect(result).toBe(accepted);
    expect(h.current()).toBe(accepted);
    expect(h.client.workspace).not.toHaveBeenCalled();
    // A foreground command owns the busy marker and always clears it.
    expect(h.busy).toEqual(['table.act', null]);
    expect(h.refreshSession).toHaveBeenCalledTimes(1);
  });

  it('reads the projection back for a duplicate acknowledgement instead of trusting it', async () => {
    const h = harness();
    const staleAck = tableWorkspace({ revision: 'rev-2' });
    const authoritative = tableWorkspace({ revision: 'rev-3' });
    h.client.command.mockResolvedValue(ack(staleAck, true));
    h.client.workspace.mockResolvedValue(authoritative);

    const result = await h.session.runCommand('table.act', {});

    expect(h.client.workspace).toHaveBeenCalledWith('room-a');
    expect(result).toBe(authoritative);
  });

  it('does not overwrite a table the member already switched to while the command was in flight', async () => {
    const h = harness();
    const otherTable = tableWorkspace({ id: 'room-b', revision: 'rev-b' });
    let release: (value: CommandAck) => void = () => undefined;
    h.client.command.mockReturnValue(new Promise<CommandAck>((resolve) => { release = resolve; }));

    const pending = h.session.runCommand('table.act', {});
    h.switchTo(otherTable);
    release(ack(tableWorkspace({ revision: 'rev-2' })));
    const result = await pending;

    expect(result).toBe(otherTable);
    expect(h.current()?.id).toBe('room-b');
    // The acknowledgement belonged to room-a, so it never became the drawn projection.
    expect(h.applied.some((view) => view?.id === 'room-a' && view.revision === 'rev-2')).toBe(false);
  });

  it('reports a conflict once, refreshes, and does not resend the rejected command', async () => {
    const h = harness();
    h.client.command.mockRejectedValue(new ApiFailure('The table changed.', 409, 'STALE_REVISION'));
    const refreshed = tableWorkspace({ revision: 'rev-9' });
    h.client.workspace.mockResolvedValue(refreshed);

    const result = await h.session.runCommand('table.act', {});

    expect(result).toBeNull();
    expect(h.client.command).toHaveBeenCalledTimes(1);
    expect(h.current()).toBe(refreshed);
    expect(h.notices).toHaveLength(1);
    expect(h.notices[0]?.text).toBe('This table changed elsewhere. The latest version is loaded; review and repeat your edit if it still applies.');
    expect(h.notices[0]?.tone).toBe('error');
    expect(h.busy).toEqual(['table.act', null]);
  });

  it('refreshes quietly when only the shared layout moved', async () => {
    const h = harness();
    h.client.command.mockRejectedValue(new ApiFailure('The layout changed.', 409, 'STALE_LAYOUT'));
    h.client.workspace.mockResolvedValue(tableWorkspace({ revision: 'rev-4' }));

    await h.session.runCommand('canvas.layout', {});

    expect(h.notices).toEqual([]);
    // Layout placement is background work: it must not take the foreground busy marker.
    expect(h.busy).toEqual([]);
  });

  it('refuses to send a command while editing is paused', async () => {
    const h = harness({ capabilities: { tableReadOnly: true } });

    const result = await h.session.runCommand('table.act', {});

    expect(result).toBeNull();
    expect(h.client.command).not.toHaveBeenCalled();
    expect(h.notices[0]?.text).toBe('Editing this table is temporarily paused. You can still inspect its current records and rules.');
  });

  it('files a source into an existing table and returns the accepted projection', async () => {
    const h = harness();
    const accepted = tableWorkspace({ revision: 'rev-2' });
    h.client.importTableSource.mockResolvedValue(ack(accepted));

    const result = await h.session.importTableFile(h.current()!, new File(['a,b\n1,2\n'], 'data.csv'));

    expect(h.client.importTableSource).toHaveBeenCalledWith(expect.objectContaining({ id: 'room-a' }), 'data.csv', 'a,b\n1,2\n');
    expect(result).toBe(accepted);
    expect(h.notices[0]?.text).toBe('data.csv was added to Table A. Review the source before using it in a rule change.');
  });

  it('rejects an unsupported source file before reaching the server', async () => {
    const h = harness();

    await expect(h.session.importTableFile(h.current()!, new File(['x'], 'notes.pdf')))
      .rejects.toMatchObject({ status: 415, code: 'TABLE_FILE' });
    expect(h.client.importTableSource).not.toHaveBeenCalled();
  });

  it('refuses to attach a file to a table that was replaced while the picker was open', async () => {
    const h = harness();
    const original = h.current()!;
    h.switchTo(tableWorkspace({ epoch: 2, revision: 'rev-epoch-2' }));

    await expect(h.session.importTableFile(original, new File(['a'], 'data.csv')))
      .rejects.toMatchObject({ status: 409 });
    expect(h.client.importTableSource).not.toHaveBeenCalled();
  });

  it('confirms a stored action proposal and reports the applied result', async () => {
    const h = harness();
    const job: TableAssistantJob = {
      id: 'job-1',
      createdAt: 1,
      prompt: 'Add one to the counter',
      status: 'completed',
      expectedRevision: 'rev-1',
      expectedEpoch: 1,
      result: {
        kind: 'action-proposal',
        text: 'Run increment.',
        actionId: 'increment',
        inputs: {},
        expectedRevision: 'rev-1',
        expectedRuleRevision: 0,
        expectedActionRevision: 0,
        confirmationRequired: true,
      },
    };
    const accepted = tableWorkspace({ revision: 'rev-2' });
    h.client.confirmTableAssistantAction.mockResolvedValue(ack(accepted));

    await h.session.confirmTableAssistantAction(h.current()!, job, 'command-1' as ReturnType<typeof crypto.randomUUID>, false);

    expect(h.client.confirmTableAssistantAction).toHaveBeenCalledWith('room-a', 'job-1', 'rev-1', 1, 'command-1');
    expect(h.current()).toBe(accepted);
    expect(h.notices[0]?.text).toBe('The confirmed action was applied to the shared table.');
  });

  it('refuses a confirmation while another table update is running', async () => {
    const h = harness();
    const job = { id: 'job-1', createdAt: 1, prompt: 'q', status: 'completed', expectedRevision: 'rev-1', expectedEpoch: 1 } as TableAssistantJob;

    await expect(h.session.confirmTableAssistantAction(h.current()!, job, 'command-1' as ReturnType<typeof crypto.randomUUID>, true))
      .rejects.toMatchObject({ status: 409, code: 'STALE_REVISION' });
    expect(h.client.confirmTableAssistantAction).not.toHaveBeenCalled();
  });

  it('refreshes the projection only while it still belongs to the open table', async () => {
    const h = harness();
    const refreshed = tableWorkspace({ revision: 'rev-2' });
    h.client.workspace.mockResolvedValue(refreshed);

    await h.session.refreshWorkspaceProjection('room-a');
    expect(h.current()).toBe(refreshed);

    await expect(h.session.refreshWorkspaceProjection('room-b')).rejects.toMatchObject({ status: 409, code: 'STALE_EPOCH' });
  });
});

describe('workspace command seam helpers', () => {
  it('treats the same table, epoch and member as one seat', () => {
    const base = tableWorkspace();
    expect(sameWorkspaceActor(base, base)).toBe(true);
    expect(sameWorkspaceActor(base, tableWorkspace({ epoch: 2 }))).toBe(false);
    expect(sameWorkspaceActor(base, tableWorkspace({ id: 'room-b' }))).toBe(false);
    expect(sameWorkspaceActor(null, base)).toBe(false);
  });

  it('keeps the user-visible failure wording stable', () => {
    expect(errorText(new ApiFailure('nope', 401))).toBe('Your sign-in session has expired. Sign in again to continue.');
    expect(errorText(new ApiFailure('nope', 413, 'TABLE_FILE_SIZE'))).toBe('Each table source file must be 32 KiB or smaller.');
    expect(errorText(new ApiFailure('custom detail', 500))).toBe('custom detail');
    expect(errorText(new Error('offline'))).toBe('offline');
  });

  it('decodes source text strictly and infers the upload mime only when the browser omits it', () => {
    expect(decodeSourceText(new TextEncoder().encode('hello').buffer)).toBe('hello');
    expect(() => decodeSourceText(new Uint8Array([0xff, 0xfe]).buffer)).toThrow();
    expect(inferredMime('rows.CSV')).toBe('text/csv');
    expect(inferredMime('rows.json')).toBe('application/octet-stream');
  });
});
