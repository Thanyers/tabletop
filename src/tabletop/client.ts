import type { CommandAck, CommandEnvelope, SessionView, WorkspaceView } from './shared/contracts';

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
  status: 'queued' | 'running' | 'completed' | 'failed';
  message?: string;
  candidateId?: string;
}

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline';

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

export class TabletopClient {
  private csrfToken = '';
  private openingSession: Promise<SessionView> | null = null;

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

  async invite(workspaceId: string, seat: string): Promise<WorkspaceInvite> {
    return this.postJson<WorkspaceInvite>(`/api/workspaces/${encodeURIComponent(workspaceId)}/invites`, { seat });
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

  async requestModel(view: WorkspaceView, prompt: string, sourceId: string, commandId = crypto.randomUUID()): Promise<ModelJob> {
    return this.postWithRetry<ModelJob>(`/api/workspaces/${encodeURIComponent(view.id)}/model`, {
      prompt,
      sourceId,
      consent: true,
      expectedRevision: view.revision,
      expectedEpoch: view.epoch,
      commandId,
    });
  }

  subscribe(
    workspaceId: string,
    onWorkspace: (workspace: WorkspaceView) => void,
    onStatus: (status: ConnectionState) => void,
  ): () => void {
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
        } catch {
          // Ignore malformed push frames; the next reconnect also reads the current projection.
        }
      };
      socket.onerror = () => socket?.close();
      socket.onclose = () => {
        if (stopped) return;
        retry += 1;
        onStatus(retry > 4 ? 'offline' : 'reconnecting');
        void this.workspace(workspaceId).then(onWorkspace).catch(() => undefined);
        const delay = Math.min(1_000 * 2 ** Math.min(retry, 4), 15_000);
        timer = window.setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
      socket?.close();
    };
  }

  private async getJson<T>(path: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(path, { credentials: 'same-origin' });
    } catch {
      throw new ApiFailure('The table could not be reached. Check your connection and try again.', 0);
    }
    return readResponse<T>(response);
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
