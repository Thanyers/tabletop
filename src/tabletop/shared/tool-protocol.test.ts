import { describe, expect, it } from 'vitest';
import {
  TOOL_BRIDGE_LIMITS,
  TOOL_FRAME_METHODS,
  TOOL_HOST_METHODS,
  TOOL_PROTOCOL_VERSION,
  isToolIntentRejection,
  parseToolFrameMessage,
  parseToolHostMessage,
  toolBridgeMessageSize,
  toolFrameNonceMatches,
} from './tool-protocol';

const NONCE = 'a'.repeat(32);
const HASH = 'b'.repeat(64);

const recordsSnapshot = {
  portId: 'plan',
  kind: 'records' as const,
  status: 'live' as const,
  revision: { dataRevision: 3, ruleRevision: 1, grantVersion: 2, readAt: 1_700_000_000_000 },
  sourceLabel: 'Budget table',
  rows: [{ id: 'row-1', values: { room: 'Main hall', area: 120 } }],
};

const initMessage = {
  protocol: TOOL_PROTOCOL_VERSION,
  kind: 'init' as const,
  instanceId: 'layout-instance',
  nonce: NONCE,
  packageId: 'activity-layout',
  packageVersion: 2,
  contentHash: HASH,
  ports: [recordsSnapshot, {
    portId: 'cost',
    kind: 'number' as const,
    status: 'live' as const,
    revision: { dataRevision: 3, ruleRevision: 1, grantVersion: 2, readAt: 1_700_000_000_000 },
    sourceLabel: 'Budget table',
    value: 1250,
  }],
  presentation: { locale: 'th' as const, reducedMotion: false, maxRows: 50 },
};

describe('host -> frame messages', () => {
  it('accepts init, ports, outcome and dispose', () => {
    expect(parseToolHostMessage(initMessage).ok).toBe(true);
    expect(parseToolHostMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ports', ports: [] }).ok).toBe(true);
    expect(parseToolHostMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'outcome', requestId: 'req-12345678', behaviorId: 'allocate', status: 'committed', instanceRevision: 2 }).ok).toBe(true);
    expect(parseToolHostMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'dispose', reason: 'revoked' }).ok).toBe(true);
  });

  it('rejects an unknown kind, an unknown method and a wrong protocol version', () => {
    const unknownKind = parseToolHostMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'exec', source: 'alert(1)' });
    expect(unknownKind.ok).toBe(false);
    if (!unknownKind.ok) expect(unknownKind.code).toBe('BRIDGE_SCHEMA');

    const extraField = parseToolHostMessage({ ...initMessage, allowNetwork: true });
    expect(extraField.ok).toBe(false);

    const wrongVersion = parseToolHostMessage({ ...initMessage, protocol: 99 });
    expect(wrongVersion.ok).toBe(false);
  });

  it('rejects a records snapshot without rows and a scalar snapshot with rows', () => {
    const noRows = parseToolHostMessage({ ...initMessage, ports: [{ ...recordsSnapshot, rows: undefined }] });
    expect(noRows.ok).toBe(false);
    const scalarRows = parseToolHostMessage({ ...initMessage, ports: [{ ...recordsSnapshot, portId: 'cost', kind: 'number' }] });
    expect(scalarRows.ok).toBe(false);
  });

  it('rejects a nonce that is not 32 hex characters', () => {
    expect(parseToolHostMessage({ ...initMessage, nonce: 'short' }).ok).toBe(false);
  });

  it('rejects a message larger than the bridge budget instead of truncating it', () => {
    const huge = 'x'.repeat(TOOL_BRIDGE_LIMITS.maxMessageChars + 1);
    const result = parseToolHostMessage(huge);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('BRIDGE_TOO_LARGE');
  });

  it('rejects more rows than one port may carry', () => {
    const tooMany = Array.from({ length: TOOL_BRIDGE_LIMITS.maxRowsPerPort + 1 }, (_, index) => ({ id: `row-${index}`, values: { room: index } }));
    expect(parseToolHostMessage({ ...initMessage, ports: [{ ...recordsSnapshot, rows: tooMany }] }).ok).toBe(false);
  });

  it('rejects a primitive or array payload', () => {
    expect(parseToolHostMessage(null).ok).toBe(false);
    expect(parseToolHostMessage([]).ok).toBe(false);
    expect(parseToolHostMessage('init').ok).toBe(false);
  });
});

describe('frame -> host messages', () => {
  it('accepts ready, intent, resize and log from the current instance', () => {
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ready', nonce: NONCE }).ok).toBe(true);
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'intent', nonce: NONCE, requestId: 'req-12345678', behaviorId: 'allocate', inputs: { room: 'Main hall', seats: 40, accessible: true } }).ok).toBe(true);
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'resize', nonce: NONCE, height: 480 }).ok).toBe(true);
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'log', nonce: NONCE, level: 'warn', message: 'Budget is tight' }).ok).toBe(true);
  });

  it('rejects an intent that tries to name a method outside the allowlist', () => {
    const result = parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'intent', nonce: NONCE, requestId: 'req-12345678', behaviorId: 'allocate', method: 'workspace.delete', inputs: {} });
    expect(result.ok).toBe(false);
  });

  it('rejects object or array input values, and an unbounded height', () => {
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'intent', nonce: NONCE, requestId: 'req-12345678', behaviorId: 'allocate', inputs: { room: { nested: true } } }).ok).toBe(false);
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'resize', nonce: NONCE, height: TOOL_BRIDGE_LIMITS.maxHeightPx + 1 }).ok).toBe(false);
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'resize', nonce: NONCE, height: 120.5 }).ok).toBe(false);
  });

  it('rejects a log line longer than the accepted size', () => {
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'log', nonce: NONCE, level: 'info', message: 'y'.repeat(TOOL_BRIDGE_LIMITS.maxLogChars + 1) }).ok).toBe(false);
  });

  it('rejects a payload nested too deeply', () => {
    let deep: Record<string, unknown> = { end: true };
    for (let index = 0; index < 40; index += 1) deep = { nested: deep };
    expect(parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'intent', nonce: NONCE, requestId: 'req-12345678', behaviorId: 'allocate', inputs: deep }).ok).toBe(false);
  });
});

describe('channel identity', () => {
  it('drops a message from a frame that no longer holds the live nonce', () => {
    const parsed = parseToolFrameMessage({ protocol: TOOL_PROTOCOL_VERSION, kind: 'ready', nonce: NONCE });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(toolFrameNonceMatches(parsed.message, NONCE)).toBe(true);
      expect(toolFrameNonceMatches(parsed.message, 'c'.repeat(32))).toBe(false);
    }
  });

  it('keeps one allowlist per direction', () => {
    expect(new Set(TOOL_HOST_METHODS).size).toBe(TOOL_HOST_METHODS.length);
    expect(new Set(TOOL_FRAME_METHODS).size).toBe(TOOL_FRAME_METHODS.length);
    for (const method of TOOL_HOST_METHODS) expect(TOOL_FRAME_METHODS as readonly string[]).not.toContain(method);
  });
});

describe('rejection vocabulary', () => {
  it('only accepts declared rejection codes', () => {
    expect(isToolIntentRejection('TOOL_STALE_REVISION')).toBe(true);
    expect(isToolIntentRejection('TOOL_SOURCE_REVOKED')).toBe(true);
    expect(isToolIntentRejection('SOMETHING_ELSE')).toBe(false);
    expect(isToolIntentRejection(42)).toBe(false);
  });

  it('measures a message before posting it', () => {
    expect(toolBridgeMessageSize({ a: 1 })).toBe(7);
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(toolBridgeMessageSize(cyclic)).toBe(Number.POSITIVE_INFINITY);
  });
});
