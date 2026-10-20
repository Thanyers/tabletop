import { describe, expect, it } from 'vitest';
import { CURSOR_MAX_FRAME_BYTES, cursorColor, cursorRelay, parseCursorInput, parseCursorRelay } from './cursor-protocol';

describe('live cursor protocol (F009)', () => {
  it('accepts only a point or a leave, rounded and bounded', () => {
    expect(parseCursorInput('{"type":"cursor","x":10.6,"y":-4.2}')).toEqual({ type: 'cursor', x: 11, y: -4 });
    expect(parseCursorInput('{"type":"cursor","leave":true}')).toEqual({ type: 'cursor', leave: true });
    for (const raw of [
      '{"type":"cursor","x":1,"y":1,"actorId":"someone"}',
      '{"type":"cursor","x":1,"y":1,"name":"Admin"}',
      '{"type":"cursor","x":1e9,"y":1}',
      '{"type":"cursor","x":"1","y":1}',
      '{"type":"cursor","leave":false}',
      '{"type":"command","x":1,"y":1}',
      '[1,2]', 'not json', 'ping',
      `{"type":"cursor","x":1,"y":1${' '.repeat(CURSOR_MAX_FRAME_BYTES)}}`,
    ]) expect(parseCursorInput(raw)).toBeNull();
    expect(parseCursorInput(new ArrayBuffer(4))).toBeNull();
  });
  it('stamps the server-known actor on relays and parses them back', () => {
    const relay = JSON.parse(cursorRelay('actor-1', { type: 'cursor', x: 5, y: 6 }));
    expect(relay).toEqual({ type: 'cursor', actorId: 'actor-1', x: 5, y: 6 });
    expect(parseCursorRelay(relay)).toEqual(relay);
    expect(parseCursorRelay(JSON.parse(cursorRelay('actor-1', { type: 'cursor', leave: true })))).toEqual({ type: 'cursor', actorId: 'actor-1', leave: true });
    expect(parseCursorRelay({ type: 'cursor', actorId: 'a', x: Infinity, y: 0 })).toBeNull();
  });
  it('gives each person a stable colour', () => {
    expect(cursorColor('actor-1')).toBe(cursorColor('actor-1'));
    expect(cursorColor('actor-1')).toMatch(/^#[0-9a-f]{6}$/u);
  });
});
