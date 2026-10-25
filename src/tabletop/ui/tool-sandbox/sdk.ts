import {
  TOOL_BRIDGE_LIMITS,
  TOOL_PROTOCOL_VERSION,
  type ToolFrameMessage,
  type ToolHostMessage,
  type ToolPortSnapshot,
  type ToolScalar,
  type ToolIntentOutcome,
} from '../../shared/tool-protocol';

/**
 * F080: the SDK a generated package uses inside its sandboxed frame.
 *
 * It is the whole capability surface of a package: read the projections the host decided to
 * share, ask for one declared behaviour, and describe the frame. There is deliberately no
 * DOM access to the host, no storage, no network and no way to name an actor, a workspace or
 * a revision — the host ignores anything a frame claims about identity.
 */

export interface ToolSdk {
  /** Ports the host has projected for this instance, in declaration order. */
  ports(): ToolPortSnapshot[];
  /** Update the frame whenever the projections change. Returns an unsubscribe function. */
  onPorts(listener: (ports: ToolPortSnapshot[]) => void): () => void;
  /** Ask the host to run one declared behaviour. Resolves with the outcome the host reports. */
  intent(behaviorId: string, inputs?: Record<string, ToolScalar>): Promise<ToolIntentOutcome>;
  /** Ask the host to resize the frame to this content height. */
  resize(heightPx: number): void;
  /** A short diagnostic line the host keeps for the author. */
  log(level: 'info' | 'warn' | 'error', message: string): void;
}

export interface ToolSdkOptions {
  /** Carried on every frame message so the host can drop messages from a replaced frame. */
  nonce: string;
  /** The window to post into; the parent in production, a stub in tests. */
  post: (message: ToolFrameMessage) => void;
  /** Called once per projection update so the bootstrap can re-render the package. */
  onRender: (ports: ToolPortSnapshot[]) => void;
}

/** Everything the bootstrap needs; the control half is never handed to package code. */
export interface ToolSdkControl {
  sdk: ToolSdk;
  /** Apply a host message: projections update, an outcome settles its promise. */
  receive(message: ToolHostMessage): void;
  /** Settle every in-flight intent when the instance goes away. */
  abandonAll(reason: string): void;
}

/** A request id the host can match; random so a retried intent is a distinct request. */
export function toolRequestId(random: () => number = Math.random): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let index = 0; index < 12; index += 1) id += alphabet[Math.floor(random() * alphabet.length) % alphabet.length];
  return `req-${id}`;
}

export function createToolSdk(options: ToolSdkOptions): ToolSdkControl {
  let current: ToolPortSnapshot[] = [];
  const portListeners = new Set<(ports: ToolPortSnapshot[]) => void>();
  const pending = new Map<string, (outcome: ToolIntentOutcome) => void>();

  const publish = (ports: ToolPortSnapshot[]): void => {
    current = ports;
    options.onRender(ports);
    for (const listener of portListeners) listener(ports);
  };

  const sdk: ToolSdk = {
    ports: () => current,
    onPorts(listener) {
      portListeners.add(listener);
      listener(current);
      return () => portListeners.delete(listener);
    },
    intent(behaviorId, inputs = {}) {
      const requestId = toolRequestId();
      if (pending.size >= TOOL_BRIDGE_LIMITS.maxPendingIntents) {
        return Promise.resolve({ requestId, behaviorId, status: 'abandoned' as const, code: 'TOOL_BUSY', message: 'Too many requests are already waiting.' });
      }
      const outcome = new Promise<ToolIntentOutcome>(resolve => pending.set(requestId, resolve));
      options.post({ protocol: TOOL_PROTOCOL_VERSION, kind: 'intent', nonce: options.nonce, requestId, behaviorId, inputs });
      // The host drops a malformed message without replying, so the package must never hang.
      setTimeout(() => {
        const resolve = pending.get(requestId);
        if (!resolve) return;
        pending.delete(requestId);
        resolve({ requestId, behaviorId, status: 'abandoned', code: 'TOOL_ABANDONED', message: 'The host did not answer in time.' });
      }, TOOL_BRIDGE_LIMITS.intentTimeoutMs);
      return outcome;
    },
    resize(heightPx) {
      const height = Math.max(1, Math.min(4_000, Math.round(heightPx)));
      options.post({ protocol: TOOL_PROTOCOL_VERSION, kind: 'resize', nonce: options.nonce, height });
    },
    log(level, message) {
      options.post({ protocol: TOOL_PROTOCOL_VERSION, kind: 'log', nonce: options.nonce, level, message: String(message).slice(0, 400) });
    },
  };

  return {
    sdk,
    receive(message) {
      if (message.kind === 'init' || message.kind === 'ports') {
        publish(message.ports);
        return;
      }
      if (message.kind !== 'outcome') return;
      const resolve = pending.get(message.requestId);
      if (!resolve) return;
      pending.delete(message.requestId);
      resolve({
        requestId: message.requestId,
        behaviorId: message.behaviorId,
        status: message.status,
        code: message.code,
        message: message.message,
        instanceRevision: message.instanceRevision,
      });
    },
    abandonAll(reason) {
      for (const [requestId, resolve] of pending) {
        pending.delete(requestId);
        resolve({ requestId, behaviorId: '', status: 'abandoned', code: 'TOOL_ABANDONED', message: reason });
      }
    },
  };
}
