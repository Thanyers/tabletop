import type { CommandAck, CommandEnvelope, SessionView, WorkspaceView } from './shared/contracts';
import { tableAssistantHistoryPageSchema, tableAssistantJobSchema, type TableAssistantConfirmation, type TableAssistantHistoryPage, type TableAssistantJob, type TableAssistantRequest } from './shared/table-assistant-contracts';
import { parseCursorRelay, type CursorRelay } from './shared/cursor-protocol';

export class ApiFailure extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }

  get conflict(): boolean {
    return this.status === 409;
  }
}

export interface WorkspaceInvite {
  ticket: string;
  expiresAt: number;
}

export interface UploadRequest {
  filename: string;
  mime: string;
  kind: 'shipments' | 'invoice' | 'rate-card';
  dataBase64: string;
  expectedRevision: string;
  expectedEpoch: number;
  commandId: string;
}

export interface ModelJob {
  id: string;
  status: 'queued' | 'running' | 'completed' | 'complete' | 'failed';
  message?: string;
  candidateId?: string;
  /** Present when the AI asked the owner one question instead of drafting rules (F012). */
  clarification?: { question: string; options: string[] };
}

export interface TabletopCapabilities {
  uploads: boolean;
  tableReadOnly?: boolean;
  tableAssistant?: { available: boolean; reason?: string };
  model: { enabled: boolean; reason: string };
}

export interface AdminWorkspace {
  id: string;
  kind: WorkspaceView['kind'];
  createdAt: string | number;
  ownerId: string;
  memberCount: number;
  status: 'active' | 'paused';
}

export interface AdminWorkspacePage {
  workspaces: AdminWorkspace[];
  next: string | null;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

export interface GoogleAuthUser {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

export type AuthStatus =
  | { mode: 'guest' }
  | { mode: 'google'; authenticated: boolean; loginUrl: string; user?: GoogleAuthUser };

async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok) {
    const message = typeof body?.message === 'string'
      ? body.message
      : response.status === 409
        ? 'This table changed elsewhere. Refresh to see the latest version.'
        : `The request could not be completed (${response.status}).`;
    throw new ApiFailure(
      message,
      response.status,
      typeof body?.errorCode === 'string' ? body.errorCode : undefined,
      typeof body?.requestId === 'string' ? body.requestId : undefined,
    );
  }
  return body as T;
}

function networkFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof DOMException && error.name === 'NetworkError');
}

function csrfHeaders(token: string, headers?: HeadersInit): Headers {
  const result = new Headers(headers);
  result.set('content-type', 'application/json');
  result.set('x-csrf-token', token);
  return result;
}

function readTableAssistantJob(value: unknown): TableAssistantJob {
  const parsed = tableAssistantJobSchema.safeParse(value);
  if (!parsed.success
      || (parsed.data.status === 'completed') !== (parsed.data.result !== undefined)
      || (parsed.data.result?.kind === 'action-proposal'
        && parsed.data.confirmationStatus === undefined)
      || (parsed.data.result?.kind !== 'action-proposal'
        && parsed.data.confirmationStatus !== undefined)) {
    throw new ApiFailure('The table assistant response could not be verified.', 502);
  }
  return parsed.data;
}

function readTableAssistantHistoryPage(value: unknown): TableAssistantHistoryPage {
  const parsed = tableAssistantHistoryPageSchema.safeParse(value);
  if (!parsed.success) throw new ApiFailure('The table assistant history could not be verified.', 502);
  const items = parsed.data.items.map(readTableAssistantJob);
  return { ...parsed.data, items };
}

export class TabletopClient {
  private csrfToken = '';
  private authMode: 'guest' | 'google' = 'guest';
  private openingSession: Promise<SessionView> | null = null;

  async authStatus(): Promise<AuthStatus> {
    let response: Response;
    try {
      response = await fetch('/api/auth/status', { credentials: 'same-origin' });
    } catch {
      throw new ApiFailure('The sign-in service cannot be reached. Check your connection and try again.', 0);
    }
    // The local development server has no account route; keep its guest flow unchanged.
    if (response.status === 404) {
      this.authMode = 'guest';
      return { mode: 'guest' };
    }
    const body = await readResponse<Partial<AuthStatus>>(response);
    if (body?.mode !== 'google' || typeof body.authenticated !== 'boolean' || typeof body.loginUrl !== 'string') {
      throw new ApiFailure('The sign-in service returned an unexpected response.', response.status || 502);
    }
    let loginUrl: string;
    try {
      const parsed = new URL(body.loginUrl, window.location.origin);
      if (parsed.origin !== window.location.origin || parsed.username || parsed.password) throw new Error('not same-origin');
      loginUrl = `${parsed.pathname}${parsed.search}`;
    } catch {
      throw new ApiFailure('The Google sign-in link could not be verified as a same-site link.', 502);
    }
    const user = body.user;
    if (user && (typeof user.id !== 'string' || typeof user.name !== 'string' || typeof user.email !== 'string' || typeof user.isAdmin !== 'boolean')) {
      throw new ApiFailure('The sign-in service returned invalid account details.', 502);
    }
    this.authMode = 'google';
    return { mode: 'google', authenticated: body.authenticated, loginUrl, ...(user ? { user } : {}) };
  }

  async capabilities(): Promise<TabletopCapabilities> {
    const response = await this.fetchResponse('/api/capabilities', 'The workspace features could not be checked.');
    const unavailableAssistantReason = 'Conversation is not available in this local workspace. You can continue using the Canvas and reviewing rules.';
    if (response.status === 404) return {
      uploads: true,
      tableAssistant: { available: false, reason: unavailableAssistantReason },
      model: { enabled: false, reason: 'AI proposals are not configured on this local server.' },
    };
    const body = await readResponse<{ uploads?: unknown; tableReadOnly?: unknown; tableAssistant?: unknown; model?: { enabled?: unknown; reason?: unknown } }>(response);
    const tableAssistant = body.tableAssistant;
    const validTableAssistant = tableAssistant === undefined || (
      typeof tableAssistant === 'object'
      && tableAssistant !== null
      && !Array.isArray(tableAssistant)
      && typeof (tableAssistant as { available?: unknown }).available === 'boolean'
      && ((tableAssistant as { reason?: unknown }).reason === undefined || typeof (tableAssistant as { reason?: unknown }).reason === 'string')
    );
    if (typeof body.uploads !== 'boolean' || typeof body.model?.enabled !== 'boolean' || body.tableReadOnly !== undefined && typeof body.tableReadOnly !== 'boolean' || !validTableAssistant) {
      throw new ApiFailure('The workspace feature settings could not be read.', 502);
    }
    const assistantCapability = tableAssistant as { available: boolean; reason?: string } | undefined;
    return {
      uploads: body.uploads,
      ...(typeof body.tableReadOnly === 'boolean' ? { tableReadOnly: body.tableReadOnly } : {}),
      tableAssistant: assistantCapability
        ? { available: assistantCapability.available, ...(assistantCapability.reason ? { reason: assistantCapability.reason } : {}) }
        : { available: false, reason: unavailableAssistantReason },
      model: {
        enabled: body.model.enabled,
        reason: typeof body.model.reason === 'string' ? body.model.reason : '',
      },
    };
  }

  async openSession(): Promise<SessionView> {
    if (this.openingSession) return this.openingSession;
    this.openingSession = this.openSessionOnce().finally(() => { this.openingSession = null; });
    return this.openingSession;
  }

  private async openSessionOnce(): Promise<SessionView> {
    let response: Response;
    try {
      response = await fetch('/api/session', { credentials: 'same-origin' });
    } catch {
      throw new ApiFailure('The session service cannot be reached. Check your connection and try again.', 0);
    }

    if (response.status === 401) {
      if (this.authMode === 'google') {
        throw new ApiFailure('Your Google sign-in session has expired. Sign in again to continue.', 401);
      }
      try {
        response = await fetch('/api/session', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({}),
        });
      } catch {
        throw new ApiFailure('The session service cannot be reached. Check your connection and try again.', 0);
      }
    }

    const session = await readResponse<SessionView>(response);
    this.csrfToken = session.csrfToken;
    return session;
  }

  async logout(): Promise<void> {
    try {
      await this.postJson<unknown>('/api/auth/logout', {});
      this.csrfToken = '';
    } catch (error) {
      if (error instanceof ApiFailure && error.status === 401) this.csrfToken = '';
      throw error;
    }
  }

  async adminWorkspaces(after?: string): Promise<AdminWorkspacePage> {
    const suffix = after ? `?after=${encodeURIComponent(after)}` : '';
    const body = await this.getJson<{ workspaces?: unknown; next?: unknown }>(`/api/admin/workspaces${suffix}`);
    if (!Array.isArray(body.workspaces)) throw new ApiFailure('Workspace metadata could not be read.', 502);
    const workspaces = body.workspaces.filter((item): item is AdminWorkspace => {
      if (typeof item !== 'object' || item === null) return false;
      const row = item as Partial<AdminWorkspace>;
      return typeof row.id === 'string'
        && (row.kind === 'invoice' || row.kind === 'teaching' || row.kind === 'encounter' || row.kind === 'table')
        && (typeof row.createdAt === 'string' || typeof row.createdAt === 'number')
        && typeof row.ownerId === 'string'
        && typeof row.memberCount === 'number'
        && (row.status === 'active' || row.status === 'paused');
    });
    if (workspaces.length !== body.workspaces.length) throw new ApiFailure('Workspace metadata contained an invalid entry.', 502);
    return { workspaces, next: typeof body.next === 'string' ? body.next : null };
  }

  async createWorkspace(kind: WorkspaceView['kind'], title?: string): Promise<WorkspaceView> {
    const view = await this.postJson<WorkspaceView>('/api/workspaces', { kind, ...(title ? { title } : {}) });
    return view;
  }

  async workspace(id: string): Promise<WorkspaceView> {
    return this.getJson<WorkspaceView>(`/api/workspaces/${encodeURIComponent(id)}`);
  }

  async command(view: WorkspaceView, type: string, payload: unknown, commandId = crypto.randomUUID()): Promise<CommandAck> {
    const envelope: CommandEnvelope = {
      commandId,
      expectedRevision: view.revision,
      expectedEpoch: view.epoch,
      type,
      payload,
    };
    return this.postWithRetry<CommandAck>(`/api/workspaces/${encodeURIComponent(view.id)}/commands`, envelope);
  }

  async upload(view: WorkspaceView, input: Omit<UploadRequest, 'expectedRevision' | 'expectedEpoch' | 'commandId'>, commandId = crypto.randomUUID()): Promise<CommandAck> {
    const body: UploadRequest = {
      ...input,
      expectedRevision: view.revision,
      expectedEpoch: view.epoch,
      commandId,
    };
    return this.postWithRetry<CommandAck>(`/api/workspaces/${encodeURIComponent(view.id)}/uploads`, body);
  }

  async importTableSource(view: WorkspaceView, filename: string, text: string, commandId = crypto.randomUUID()): Promise<CommandAck> {
    return this.command(view, 'table.import', { filename, text }, commandId);
  }

  async invite(workspaceId: string, seat: string, replaceOutstanding = false): Promise<WorkspaceInvite> {
    return this.postJson<WorkspaceInvite>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, { seat, ...(replaceOutstanding ? { replaceOutstanding: true } : {}) });
  }

  async redeem(ticket: string): Promise<WorkspaceView> {
    const view = await this.postJson<WorkspaceView>('/api/invites/redeem', { ticket });
    await this.openSession();
    return view;
  }

  async export(workspaceId: string, format: 'csv' | 'html'): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/export?format=${format}`, {
        credentials: 'same-origin',
      });
    } catch {
      throw new ApiFailure('The export could not be downloaded. Check your connection and try again.', 0);
    }
    if (!response.ok) await readResponse<never>(response);
    return response.blob();
  }

  async requestModel(view: WorkspaceView, prompt: string, sourceId?: string, commandId: string = crypto.randomUUID()): Promise<ModelJob> {
    const body: { prompt: string; sourceId?: string; consent: true; expectedRevision: string; expectedEpoch: number; commandId: string } = {
      prompt,
      consent: true,
      expectedRevision: view.revision,
      expectedEpoch: view.epoch,
      commandId,
    };
    if (sourceId) body.sourceId = sourceId;
    return this.postWithRetry<ModelJob>(`/api/workspaces/${encodeURIComponent(view.id)}/model`, body);
  }

  async modelJob(workspaceId: string, jobId: string): Promise<ModelJob> {
    const job = await this.getJson<ModelJob>(`/api/workspaces/${encodeURIComponent(workspaceId)}/model/${encodeURIComponent(jobId)}`);
    if (typeof job.id !== 'string' || !['queued', 'running', 'completed', 'complete', 'failed'].includes(job.status)) {
      throw new ApiFailure('The AI proposal status could not be read.', 502);
    }
    return job;
  }

  async requestTableAssistant(view: WorkspaceView, prompt: string, commandId = crypto.randomUUID()): Promise<TableAssistantJob> {
    const body: TableAssistantRequest = {
      commandId,
      expectedRevision: view.revision,
      expectedEpoch: view.epoch,
      prompt,
      consent: true,
    };
    return readTableAssistantJob(await this.postJson<unknown>(
      `/api/workspaces/${encodeURIComponent(view.id)}/assistant`, body,
    ));
  }

  async tableAssistantJob(workspaceId: string, jobId: string): Promise<TableAssistantJob> {
    const body = await this.getJson<unknown>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/assistant/${encodeURIComponent(jobId)}`,
    );
    return readTableAssistantJob(body);
  }

  async tableAssistantHistory(workspaceId: string, before?: string, limit = 20): Promise<TableAssistantHistoryPage> {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', before);
    const body = await this.getJson<unknown>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/assistant?${params.toString()}`,
    );
    return readTableAssistantHistoryPage(body);
  }

  async confirmTableAssistantAction(
    workspaceId: string,
    jobId: string,
    expectedRevision: string,
    expectedEpoch: number,
    commandId = crypto.randomUUID(),
  ): Promise<CommandAck> {
    const body: TableAssistantConfirmation = { commandId, expectedRevision, expectedEpoch };
    return this.postJson<CommandAck>(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/assistant/${encodeURIComponent(jobId)}/confirm`, body,
    );
  }

  subscribe(
    workspaceId: string,
    onWorkspace: (workspace: WorkspaceView) => void,
    onStatus: (status: ConnectionState) => void,
    onCursor?: (cursor: CursorRelay | null) => void,
  ): (() => void) & { sendCursor: (point: { x: number; y: number } | null) => void } {
    let stopped = false;
    let socket: WebSocket | null = null;
    let timer: number | undefined;
    let retry = 0;

    const connect = () => {
      if (stopped) return;
      onStatus(retry === 0 ? 'connecting' : 'reconnecting');
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(`${scheme}//${window.location.host}/api/workspaces/${encodeURIComponent(workspaceId)}/socket`);
      socket.onopen = () => {
        retry = 0;
        onStatus('connected');
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data)) as { type?: string; workspace?: WorkspaceView };
          if (data.type === 'projection' && data.workspace) onWorkspace(data.workspace);
          else if (data.type === 'cursor') { const cursor = parseCursorRelay(data); if (cursor) onCursor?.(cursor); }
        } catch {
          // Ignore malformed push frames; the next reconnect also reads the current projection.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        onCursor?.(null);
        if (stopped) return;
        retry += 1;
        onStatus(retry > 4 ? 'offline' : 'reconnecting');
        void this.workspace(workspaceId).then(onWorkspace).catch(() => undefined);
        const delay = Math.min(1_000 * 2 ** Math.min(retry, 4), 15_000);
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    const stop = () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      socket?.close();
    };
    const sendCursor = (point: { x: number; y: number } | null) => {
      if (socket?.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(point ? { type: 'cursor', x: Math.round(point.x), y: Math.round(point.y) } : { type: 'cursor', leave: true }));
    };
    return Object.assign(stop, { sendCursor });
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await this.fetchResponse(path, 'The table could not be reached. Check your connection and try again.');
    return readResponse<T>(response);
  }

  private async fetchResponse(path: string, failureMessage: string): Promise<Response> {
    try {
      return await fetch(path, { credentials: 'same-origin' });
    } catch {
      throw new ApiFailure(failureMessage, 0);
    }
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: csrfHeaders(this.csrfToken),
        body: JSON.stringify(body),
      });
    } catch {
      throw new ApiFailure('The request could not be sent. Check your connection and try again.', 0);
    }
    return readResponse<T>(response);
  }

  private async postWithRetry<T>(path: string, body: unknown): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response;
      try {
        response = await fetch(path, {
          method: 'POST',
          credentials: 'same-origin',
          headers: csrfHeaders(this.csrfToken),
          body: JSON.stringify(body),
        });
      } catch (error) {
        if (attempt === 0 && networkFailure(error)) continue;
        throw new ApiFailure('The connection dropped before the result arrived. You can safely retry this same action.', 0);
      }
      return readResponse<T>(response);
    }
    throw new ApiFailure('The connection dropped before the result arrived. You can safely retry this same action.', 0);
  }
}

export const tabletopClient = new TabletopClient();

export function clearInviteFragment(): void {
  const url = new URL(window.location.href);
  url.hash = '';
  window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
}

export function inviteFromFragment(): string | null {
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  return fragment.get('invite');
}
