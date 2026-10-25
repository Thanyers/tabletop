import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledToolPackage } from '../runtime/tools/compile';
import {
  TOOL_BRIDGE_LIMITS,
  TOOL_PROTOCOL_VERSION,
  parseToolFrameMessage,
  toolFrameNonceMatches,
  type ToolFrameMessage,
  type ToolHostMessage,
  type ToolIntentOutcome,
  type ToolPortSnapshot,
  type ToolPresentation,
  type ToolScalar,
} from '../shared/tool-protocol';
import { buildToolSandboxDocument } from './tool-sandbox/document';

/**
 * F080: the frame host for one generated tool instance.
 *
 * The host owns the boundary. It builds the document, rejects every message that is not from
 * this frame with this instance's nonce, and never trusts a frame that claims an actor, a
 * workspace or a revision — the only thing a frame can do is ask for a declared behaviour
 * that the host then runs; the authority decides what that behaviour may actually write.
 */

export interface ToolIntentRequest {
  instanceId: string;
  requestId: string;
  behaviorId: string;
  inputs: Record<string, ToolScalar>;
}

export interface GeneratedToolHostProps {
  instanceId: string;
  /** Per-mount random value; a frame from a previous mount can no longer be identified. */
  nonce: string;
  compiled: CompiledToolPackage;
  /** The authorized projections as of right now; later changes are posted, not re-mounted. */
  ports: ToolPortSnapshot[];
  presentation: ToolPresentation;
  /** Runs one declared behaviour through the authority path and reports what happened. */
  onIntent: (request: ToolIntentRequest) => Promise<ToolIntentOutcome>;
  onLog?: (level: 'info' | 'warn' | 'error', message: string) => void;
  /** Accessible name for the frame. */
  title: string;
  initialHeightPx?: number;
}

let runtimePromise: Promise<string> | undefined;

/** Load the sandbox runtime once per page, without credentials. */
export function loadToolSandboxRuntime(): Promise<string> {
  const inline = (globalThis as unknown as { __TOOL_SANDBOX_RUNTIME__?: string }).__TOOL_SANDBOX_RUNTIME__;
  if (typeof inline === 'string' && inline.length > 0) return Promise.resolve(inline);
  runtimePromise ??= fetch('/tool-sandbox-runtime.js', { credentials: 'omit' })
    .then(response => {
      if (!response.ok) throw new Error(`TOOL_RUNTIME_UNAVAILABLE: ${response.status}`);
      return response.text();
    })
    .catch(error => {
      runtimePromise = undefined;
      throw error;
    });
  return runtimePromise;
}

export function GeneratedToolHost(props: GeneratedToolHostProps): React.ReactElement {
  const { instanceId, nonce, compiled, presentation, onIntent, onLog, title } = props;
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [document, setDocument] = useState<string | undefined>();
  const [frameLoaded, setFrameLoaded] = useState(false);
  const [height, setHeight] = useState(props.initialHeightPx ?? 320);
  const [failure, setFailure] = useState<string | undefined>();

  const portsRef = useRef(props.ports);
  portsRef.current = props.ports;
  const portsSentRef = useRef<ToolPortSnapshot[] | undefined>(undefined);

  /**
   * Depend on stable primitives, not object identity: a caller that writes
   * `presentation={{ … }}` inline would otherwise rebuild the document on every parent render
   * and remount the frame, losing the package's own UI state.
   */
  const presentationKey = `${presentation.locale}|${presentation.reducedMotion}|${presentation.maxRows}`;
  const stablePresentation = useMemo<ToolPresentation>(
    () => ({ locale: presentation.locale, reducedMotion: presentation.reducedMotion, maxRows: presentation.maxRows }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the primitive fields on purpose
    [presentationKey],
  );

  useEffect(() => {
    let cancelled = false;
    setDocument(undefined);
    setFrameLoaded(false);
    portsSentRef.current = undefined;
    loadToolSandboxRuntime()
      .then(runtimeScript => {
        if (cancelled) return;
        const init: Extract<ToolHostMessage, { kind: 'init' }> = {
          protocol: TOOL_PROTOCOL_VERSION,
          kind: 'init',
          instanceId,
          nonce,
          packageId: compiled.packageId,
          packageVersion: compiled.version,
          contentHash: compiled.contentHash,
          ports: portsRef.current,
          presentation: stablePresentation,
        };
        setDocument(buildToolSandboxDocument({ runtimeScript, compiled, init }));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [compiled, instanceId, nonce, stablePresentation]);

  /**
   * Push projection changes into the live frame.
   *
   * A projection can change while the document is still being built (loading the runtime is
   * async), so this runs once the frame reports `load` as well as on every change: the frame
   * always ends up with the newest projections it was authorized to see.
   */
  useEffect(() => {
    if (!frameLoaded) return;
    const frame = frameRef.current;
    if (!frame?.contentWindow) return;
    if (portsSentRef.current === props.ports) return;
    frame.contentWindow.postMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ports', ports: props.ports } satisfies ToolHostMessage, '*');
    portsSentRef.current = props.ports;
  }, [props.ports, frameLoaded]);

  const reply = useCallback((message: ToolHostMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = frameRef.current;
      // Identity first: a message from another window is not ours, whatever it claims.
      if (!frame || event.source !== frame.contentWindow) return;
      const parsed = parseToolFrameMessage(event.data);
      if (!parsed.ok) return;
      const message: ToolFrameMessage = parsed.message;
      if (!toolFrameNonceMatches(message, nonce)) return;
      if (message.kind === 'resize') {
        setHeight(Math.min(TOOL_BRIDGE_LIMITS.maxHeightPx, Math.max(120, message.height)));
        return;
      }
      if (message.kind === 'log') {
        onLog?.(message.level, message.message);
        return;
      }
      if (message.kind !== 'intent') return;
      void onIntent({ instanceId, requestId: message.requestId, behaviorId: message.behaviorId, inputs: message.inputs })
        .then(outcome => {
          reply({
            protocol: TOOL_PROTOCOL_VERSION,
            kind: 'outcome',
            requestId: message.requestId,
            behaviorId: message.behaviorId,
            status: outcome.status === 'committed' ? 'committed' : 'rejected',
            // Omit absent fields rather than sending `undefined` across the bridge.
            ...(outcome.code === undefined ? {} : { code: outcome.code }),
            ...(outcome.message === undefined ? {} : { message: outcome.message }),
            ...(outcome.instanceRevision === undefined ? {} : { instanceRevision: outcome.instanceRevision }),
          });
        })
        .catch((error: unknown) => {
          const detail = error instanceof Error ? error.message : String(error);
          reply({
            protocol: TOOL_PROTOCOL_VERSION,
            kind: 'outcome',
            requestId: message.requestId,
            behaviorId: message.behaviorId,
            status: 'rejected',
            code: 'TOOL_BEHAVIOR_FAILED',
            message: detail.slice(0, TOOL_BRIDGE_LIMITS.maxDiagnosticChars),
          });
        });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [instanceId, nonce, onIntent, onLog, reply]);

  if (failure) {
    return (
      <div role="alert" style={{ padding: 12, border: '1px solid #b3261e', borderRadius: 10, color: '#b3261e', fontSize: 13 }}>
        {`โหลดเครื่องมือไม่สำเร็จ: ${failure}`}
      </div>
    );
  }
  if (!document) {
    return (
      <div aria-busy="true" style={{ height, display: 'grid', placeItems: 'center', fontSize: 13, opacity: 0.7 }}>
        กำลังเตรียมเครื่องมือ…
      </div>
    );
  }
  return (
    <iframe
      ref={frameRef}
      title={title}
      srcDoc={document}
      onLoad={() => setFrameLoaded(true)}
      // No allow-same-origin: the frame must stay an opaque origin with no cookie access.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, border: 0, display: 'block', background: 'transparent', colorScheme: 'normal' }}
    />
  );
}
