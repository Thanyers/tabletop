import { describe, expect, it } from 'vitest';
import { TOOL_BRIDGE_LIMITS, TOOL_PROTOCOL_VERSION } from '../../shared/tool-bridge';
import {
  buildToolSandboxInitMessage,
  parseToolSandboxFrameHello,
  parseToolSandboxInitMessage,
  toolSandboxFrameUrl,
  type ToolSandboxInitHook,
} from './frame-message';

/**
 * F080 / D-044: the handshake with a frame served from the sandbox's own origin.
 *
 * The frame runs the same parser before it evaluates anything, so these tests stand for both sides:
 * anything refused here is a frame that would have reported `blocked` instead of starting.
 */

const NONCE = 'a'.repeat(32);

const INIT: ToolSandboxInitHook = {
  protocol: TOOL_PROTOCOL_VERSION,
  kind: 'init',
  instanceId: 'room-room-planner-v2',
  nonce: NONCE,
  packageId: 'room-planner',
  packageVersion: 2,
  contentHash: 'c'.repeat(64),
  ports: [{
    portId: 'plan',
    kind: 'records',
    status: 'live',
    revision: { dataRevision: 4, ruleRevision: 0, grantVersion: 1, readAt: 1_760_000_000_000 },
    sourceLabel: 'ผังพื้นที่กิจกรรม',
    rows: [{ id: 'plan-1', values: { room: 'ห้องประชุม', area: 24 } }],
  }],
  presentation: { locale: 'th', reducedMotion: true, maxRows: 10 },
};

const COMPILED = { modules: { 'ui/main.tsx': 'module.exports = { Tool: () => null };' }, uiEntry: 'ui/main.tsx' };

/** The wire view of a message, with one field removed to model a sender that forgot it. */
function without(field: keyof ToolSandboxInitHook): Record<string, unknown> {
  const init: Record<string, unknown> = { ...INIT };
  delete init[field];
  return init;
}

function message(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    protocol: TOOL_PROTOCOL_VERSION,
    kind: 'init',
    runtimeScript: 'globalThis.__TOOL_SANDBOX_START__ = () => {};',
    modules: COMPILED.modules,
    uiEntry: COMPILED.uiEntry,
    init: INIT,
    ...overrides,
  };
}

describe('the sandbox init message', () => {
  it('builds the message the frame starts from', () => {
    const built = buildToolSandboxInitMessage({ runtimeScript: 'void 0;', compiled: COMPILED, init: INIT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.message.protocol).toBe(TOOL_PROTOCOL_VERSION);
    expect(built.message.kind).toBe('init');
    expect(built.message.runtimeScript).toBe('void 0;');
    expect(built.message.modules).toEqual(COMPILED.modules);
    expect(built.message.uiEntry).toBe('ui/main.tsx');
    expect(built.message.init.nonce).toBe(NONCE);
    expect(built.message.init.presentation.locale).toBe('th');
  });

  it('accepts what the host just built, unchanged', () => {
    const built = buildToolSandboxInitMessage({ runtimeScript: 'void 0;', compiled: COMPILED, init: INIT });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(parseToolSandboxInitMessage(built.message)).toEqual(built);
  });

  it('refuses a message that is not an object', () => {
    for (const value of [undefined, null, 'init', 7, [message()]]) {
      const parsed = parseToolSandboxInitMessage(value);
      expect(parsed.ok).toBe(false);
      if (parsed.ok) continue;
      expect(parsed.code).toBe('BRIDGE_NOT_OBJECT');
    }
  });

  it('refuses a message of the wrong kind', () => {
    const parsed = parseToolSandboxInitMessage(message({ kind: 'ports' }));
    expect(parsed).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    if (parsed.ok) return;
    expect(parsed.detail).toContain('kind');
  });

  it('refuses a message for another protocol version', () => {
    const parsed = parseToolSandboxInitMessage(message({ protocol: TOOL_PROTOCOL_VERSION + 1 }));
    expect(parsed).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
  });

  it('accepts an init without runtime text, which the sandbox origin serves itself (D-047)', () => {
    const parsed = parseToolSandboxInitMessage(message({ runtimeScript: undefined }));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.message.runtimeScript).toBeUndefined();
  });

  it('still refuses a runtime text that is present but unusable', () => {
    for (const runtimeScript of ['', 42]) {
      const parsed = parseToolSandboxInitMessage(message({ runtimeScript }));
      expect(parsed).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
      if (parsed.ok) continue;
      expect(parsed.detail).toContain('runtimeScript');
    }
  });

  it('refuses runtime text past the bridge limit', () => {
    const oversized = 'x'.repeat(TOOL_BRIDGE_LIMITS.maxRuntimeScriptChars + 1);
    const parsed = parseToolSandboxInitMessage(message({ runtimeScript: oversized }));
    expect(parsed).toMatchObject({ ok: false, code: 'BRIDGE_TOO_LARGE' });
  });

  it('accepts runtime text exactly at the limit', () => {
    const atLimit = 'x'.repeat(TOOL_BRIDGE_LIMITS.maxRuntimeScriptChars);
    expect(parseToolSandboxInitMessage(message({ runtimeScript: atLimit })).ok).toBe(true);
  });

  it('refuses a message with no uiEntry or with modules that are not text', () => {
    expect(parseToolSandboxInitMessage(message({ uiEntry: '' }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    expect(parseToolSandboxInitMessage(message({ modules: { 'ui/main.tsx': 3 } }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    expect(parseToolSandboxInitMessage(message({ modules: null }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
  });

  it('refuses an init without a nonce', () => {
    const parsed = parseToolSandboxInitMessage(message({ init: without('nonce') }));
    expect(parsed).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    if (parsed.ok) return;
    expect(parsed.detail).toContain('init');
  });

  it('refuses an init without a usable presentation', () => {
    expect(parseToolSandboxInitMessage(message({ init: without('presentation') }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    expect(parseToolSandboxInitMessage(message({ init: without('kind') }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
    expect(parseToolSandboxInitMessage(message({ init: 'init' }))).toMatchObject({ ok: false, code: 'BRIDGE_SCHEMA' });
  });
});

describe('the sandbox frame URL', () => {
  it('points at the frame document on the configured origin', () => {
    expect(toolSandboxFrameUrl('https://tabletop-sandbox.example')).toBe('https://tabletop-sandbox.example/frame.html');
    expect(toolSandboxFrameUrl('https://tabletop-sandbox.example/')).toBe('https://tabletop-sandbox.example/frame.html');
    expect(toolSandboxFrameUrl('http://127.0.0.1:8788')).toBe('http://127.0.0.1:8788/frame.html');
  });

  it('refuses a value that is not a bare http(s) origin', () => {
    for (const value of [
      '',
      'not a url',
      'https://tabletop-sandbox.example/frame.html',
      'https://tabletop-sandbox.example/?token=1',
      'javascript:alert(1)',
      'data:text/html,<p>x</p>',
      'file:///C:/sandbox/frame.html',
    ]) {
      expect(toolSandboxFrameUrl(value)).toBeUndefined();
    }
  });
});

describe('the sandbox frame handshake', () => {
  it('reads the frame saying it is up', () => {
    expect(parseToolSandboxFrameHello({ kind: 'ready' })).toEqual({ kind: 'ready' });
  });

  it('reads the frame saying why it is not', () => {
    expect(parseToolSandboxFrameHello({ kind: 'blocked', reason: 'The runtime text was refused.' }))
      .toEqual({ kind: 'blocked', reason: 'The runtime text was refused.' });
  });

  it('replaces an unusable reason with a sentence the user can read', () => {
    const unknownReason = parseToolSandboxFrameHello({ kind: 'blocked' });
    expect(unknownReason).toMatchObject({ kind: 'blocked' });
    if (unknownReason?.kind !== 'blocked') return;
    expect(unknownReason.reason.length).toBeGreaterThan(0);
    expect(parseToolSandboxFrameHello({ kind: 'blocked', reason: '   ' })).toMatchObject({ kind: 'blocked' });
  });

  it('bounds a long reason instead of trusting its length', () => {
    const parsed = parseToolSandboxFrameHello({ kind: 'blocked', reason: 'x'.repeat(TOOL_BRIDGE_LIMITS.maxDiagnosticChars + 500) });
    expect(parsed?.kind).toBe('blocked');
    if (parsed?.kind !== 'blocked') return;
    expect(parsed.reason.length).toBe(TOOL_BRIDGE_LIMITS.maxDiagnosticChars);
  });

  it('leaves the bridge protocol messages alone', () => {
    // The runtime's own `ready` carries `protocol`; treating it as a handshake would swallow it.
    expect(parseToolSandboxFrameHello({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ready', nonce: NONCE })).toBeUndefined();
    expect(parseToolSandboxFrameHello({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ports', ports: [] })).toBeUndefined();
    expect(parseToolSandboxFrameHello({ kind: 'mounted' })).toBeUndefined();
    expect(parseToolSandboxFrameHello(null)).toBeUndefined();
    expect(parseToolSandboxFrameHello('ready')).toBeUndefined();
  });
});
