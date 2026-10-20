// Live cursors (F009). Ephemeral: never stored, never part of a projection.
// The client sends world coordinates only; the server adds the sender's actorId
// and relays to the other sockets of the same room. Names come from the
// receiver's own member list, so a client can never claim another identity.

export const CURSOR_MAX_FRAME_BYTES = 128;
/**
 * Clients send at most one frame per CURSOR_SEND_INTERVAL_MS (~12 Hz); the 80 ms CSS
 * transition smooths the gaps. Every frame wakes the hibernating Room DO and counts as
 * billed traffic, so keep this low. The server allows a little jitter below that rate.
 */
export const CURSOR_SEND_INTERVAL_MS = 80;
export const CURSOR_MIN_INTERVAL_MS = 60;
const CURSOR_LIMIT = 90_000;

export type CursorInput = { type: 'cursor'; x: number; y: number } | { type: 'cursor'; leave: true };
export type CursorRelay = { type: 'cursor'; actorId: string; x: number; y: number } | { type: 'cursor'; actorId: string; leave: true };

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= CURSOR_LIMIT;

/** Parse an untrusted client frame. Anything else returns null and is ignored. */
export function parseCursorInput(raw: unknown): CursorInput | null {
  if (typeof raw !== 'string' || raw.length > CURSOR_MAX_FRAME_BYTES) return null;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return null; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (record.type !== 'cursor') return null;
  if (keys === 'leave,type' && record.leave === true) return { type: 'cursor', leave: true };
  if (keys === 'type,x,y' && finite(record.x) && finite(record.y)) return { type: 'cursor', x: Math.round(record.x), y: Math.round(record.y) };
  return null;
}

export function cursorRelay(actorId: string, input: CursorInput): string {
  return JSON.stringify('leave' in input ? { type: 'cursor', actorId, leave: true } : { type: 'cursor', actorId, x: input.x, y: input.y });
}

/** Parse a relayed frame on the client. */
export function parseCursorRelay(value: unknown): CursorRelay | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record.type !== 'cursor' || typeof record.actorId !== 'string' || record.actorId.length > 200) return null;
  if (record.leave === true) return { type: 'cursor', actorId: record.actorId, leave: true };
  if (finite(record.x) && finite(record.y)) return { type: 'cursor', actorId: record.actorId, x: record.x, y: record.y };
  return null;
}

/** Stable per-person colour from a small accessible palette. */
const CURSOR_COLORS = ['#2f7d68', '#3b6fd1', '#b5532f', '#8a4fc4', '#b0862a', '#c2417a', '#2c8aa6'] as const;
export function cursorColor(actorId: string): string {
  let hash = 0;
  for (const char of actorId) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return CURSOR_COLORS[Math.abs(hash) % CURSOR_COLORS.length];
}
