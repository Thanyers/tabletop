import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CompiledToolPackage } from '../runtime/tools/compile';
import {
  TOOL_BRIDGE_LIMITS,
  TOOL_PROTOCOL_VERSION,
  parseToolFrameMessage,
  toolBridgeMessageSize,
  toolFrameNonceMatches,
  type ToolFrameMessage,
  type ToolHostMessage,
  type ToolIntentOutcome,
  type ToolPortSnapshot,
  type ToolPresentation,
  type ToolScalar,
} from '../shared/tool-protocol';
import { buildToolSandboxDocument } from './tool-sandbox/document';
import { buildToolSandboxInitMessage, parseToolSandboxFrameHello, toolSandboxFrameUrl } from './tool-sandbox/frame-message';
import { createToolHostWatchdog } from './tool-host-watchdog';

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
  /** How long the frame gets to say anything before the host reports that it never started (D-041). */
  readyTimeoutMs?: number;
  /**
   * D-044: serve the frame document from the sandbox's own origin instead of `srcDoc`.
   *
   * Absent means the `srcDoc` path, unchanged. When set to a bare http(s) origin, the frame is loaded
   * from `${sandboxOrigin}/frame.html` — a document whose Content-Security-Policy is the sandbox's own,
   * which is what lets the app page keep `script-src 'self'` — and the host hands it the runtime text
   * and the boot payload in one init message once the frame reports that it is up.
   */
  sandboxOrigin?: string;
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

  /** D-044: the origin-served frame starts from the runtime text, which travels as a message. */
  const sandboxOrigin = props.sandboxOrigin;
  const frameUrl = sandboxOrigin === undefined ? undefined : toolSandboxFrameUrl(sandboxOrigin);
  const originMode = frameUrl !== undefined;
  const [runtimeReady, setRuntimeReady] = useState(false);
  const runtimeRef = useRef<string | undefined>(undefined);
  const initSentRef = useRef(false);

  const portsRef = useRef(props.ports);
  portsRef.current = props.ports;
  const portsSentRef = useRef<ToolPortSnapshot[] | undefined>(undefined);

  /**
   * D-041: a frame blocked by the page's security policy looks exactly like a slow frame. This turns
   * "the tool never answered" into a sentence a person can act on instead of an empty box.
   */
  const watchdog = useMemo(
    () => createToolHostWatchdog({
      timeoutMs: props.readyTimeoutMs ?? 3000,
      // A frame that said why it could not start has already given the user a better sentence.
      onTimeout: message => setFailure(current => current ?? message),
    }),
    [props.readyTimeoutMs],
  );
  useEffect(() => () => watchdog.dispose(), [watchdog]);

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

  /**
   * The boot payload, built at send time so a projection that changed while the runtime was loading
   * is the one the frame starts with. Later changes go through the ports push below.
   */
  const buildInit = useCallback((): Extract<ToolHostMessage, { kind: 'init' }> => ({
    protocol: TOOL_PROTOCOL_VERSION,
    kind: 'init',
    instanceId,
    nonce,
    packageId: compiled.packageId,
    packageVersion: compiled.version,
    contentHash: compiled.contentHash,
    ports: portsRef.current,
    presentation: stablePresentation,
  }), [compiled, instanceId, nonce, stablePresentation]);

  useEffect(() => {
    let cancelled = false;
    setDocument(undefined);
    setFrameLoaded(false);
    setRuntimeReady(false);
    initSentRef.current = false;
    runtimeRef.current = undefined;
    portsSentRef.current = undefined;
    loadToolSandboxRuntime()
      .then(runtimeScript => {
        if (cancelled) return;
        runtimeRef.current = runtimeScript;
        if (originMode) {
          // The frame document is the sandbox origin's; the runtime goes in the init message instead.
          setRuntimeReady(true);
          return;
        }
        setDocument(buildToolSandboxDocument({ runtimeScript, compiled, init: buildInit() }));
      })
      .catch((error: unknown) => {
        if (!cancelled) setFailure(error instanceof Error ? error.message : String(error));
      });
    return () => {
      cancelled = true;
    };
  }, [buildInit, compiled, originMode]);

  /**
   * D-044: hand the frame its runtime and boot payload, once.
   *
   * A named `targetOrigin` can never match this frame — `sandbox="allow-scripts"` without
   * `allow-same-origin` gives it an opaque origin — so the channel is bounded by window identity
   * (checked in the listener below) and by sending exactly once.
   */
  const sendInit = useCallback((): void => {
    const target = frameRef.current?.contentWindow;
    const runtimeScript = runtimeRef.current;
    if (!originMode || !target || runtimeScript === undefined || initSentRef.current) return;
    initSentRef.current = true;
    const built = buildToolSandboxInitMessage({ runtimeScript, compiled, init: buildInit() });
    if (!built.ok) {
      setFailure(built.detail);
      return;
    }
    target.postMessage(built.message, '*');
    // The init already carried these projections; the ports push below only sends newer ones.
    portsSentRef.current = portsRef.current;
    setFrameLoaded(true);
  }, [buildInit, compiled, originMode]);

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
    const message = { protocol: TOOL_PROTOCOL_VERSION, kind: 'ports', ports: props.ports } satisfies ToolHostMessage;
    // A structured-cloned object is not bounded by the protocol's string check, so measure it here.
    if (toolBridgeMessageSize(message) > TOOL_BRIDGE_LIMITS.maxMessageChars) {
      onLog?.('error', 'TOOL_BRIDGE_TOO_LARGE: the projection is too large to send into the tool.');
      return;
    }
    frame.contentWindow.postMessage(message, '*');
    portsSentRef.current = props.ports;
  }, [props.ports, frameLoaded, onLog]);

  const reply = useCallback((message: ToolHostMessage) => {
    frameRef.current?.contentWindow?.postMessage(message, '*');
  }, []);

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      const frame = frameRef.current;
      // Identity first: a message from another window is not ours, whatever it claims.
      if (!frame || event.source !== frame.contentWindow) return;
      // D-044: the origin-served document announces itself (or its refusal) before a runtime exists.
      const hello = parseToolSandboxFrameHello(event.data);
      if (hello?.kind === 'blocked') {
        // It answered, so the watchdog stands down: the frame already gave the user a better sentence.
        watchdog.heard();
        initSentRef.current = true;
        setFailure(hello.reason);
        return;
      }
      if (hello?.kind === 'ready') {
        sendInit();
        return;
      }
      const parsed = parseToolFrameMessage(event.data);
      if (!parsed.ok) return;
      const message: ToolFrameMessage = parsed.message;
      if (!toolFrameNonceMatches(message, nonce)) return;
      // Any well-formed message from this frame proves it started; the watchdog stands down.
      watchdog.heard();
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
  }, [instanceId, nonce, onIntent, onLog, reply, sendInit, watchdog]);

  // A configured origin that is not a bare http(s) origin would point the frame at something else.
  const problem = failure ?? (sandboxOrigin !== undefined && !originMode
    ? 'TOOL_SANDBOX_ORIGIN_INVALID: the configured sandbox origin is not an http(s) origin.'
    : undefined);
  if (problem) {
    return (
      <div role="alert" style={{ padding: 12, border: '1px solid #b3261e', borderRadius: 10, color: '#b3261e', fontSize: 13 }}>
        {`โหลดเครื่องมือไม่สำเร็จ: ${problem}`}
      </div>
    );
  }
  // The origin-served frame must exist before it can talk; the `srcDoc` frame needs its document.
  if (originMode ? !runtimeReady : !document) {
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
      src={originMode ? frameUrl : undefined}
      srcDoc={originMode ? undefined : document}
      onLoad={() => {
        watchdog.started();
        // The document is up: the frame's own handshake may still be in flight, so start it here too.
        if (originMode) sendInit();
        else setFrameLoaded(true);
      }}
      // No allow-same-origin: the frame must stay an opaque origin with no cookie access.
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={{ width: '100%', height, border: 0, display: 'block', background: 'transparent', colorScheme: 'normal' }}
    />
  );
}
